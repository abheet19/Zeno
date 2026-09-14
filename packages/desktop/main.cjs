/**
 * Zeno desktop — the real application window.
 *
 * This exists so Zeno is a Windows application rather than a browser tab. It is
 * a genuine native window: no address bar, no tabs, no browser chrome, its own
 * taskbar entry and its own icon. The page inside it is the same window the
 * daemon serves, because the UI was always HTML — that is how VS Code, Slack and
 * Obsidian work too.
 *
 * It owns the daemon's lifetime. Launching the app starts the daemon as a child
 * process; closing the window stops it. There is no orphaned server left behind
 * holding port 7317, which is the failure the previous launcher had.
 *
 * SECURITY POSTURE, deliberate and load-bearing:
 *   - `nodeIntegration: false` and `contextIsolation: true`. The page is a web
 *     page; it must never reach Node. Zeno's whole thesis is that an agent
 *     cannot cause an effect it was not granted, and handing the renderer Node
 *     would hand it the filesystem.
 *   - Navigation is pinned to the loopback origin. Any attempt to navigate or
 *     open a window elsewhere is refused and, if it looks like a real link the
 *     owner clicked, handed to the system browser instead.
 *   - No remote content is ever loaded into this window.
 */
const { app, BrowserWindow, shell, dialog, ipcMain, desktopCapturer, session } = require('electron');
const { createWhisperEngine, installWhisperSpeech, resolveWhisperRuntime } = require('./whisper.cjs');
const { describeStatus: describeSpeechInstallStatus, installWhisperRuntime } = require('./speech-install.cjs');
const { inspectProject } = require('./project.cjs');
const {
  claimDesktopInstance,
  createDaemonEnvironment,
  isTrustedMainFrame,
  protectDiagnosticStream,
  registerGracefulQuit,
  registerSecondInstanceFocus,
  stopDaemonChild,
} = require('./lifecycle.cjs');
const { spawn } = require('node:child_process');
const { join, dirname } = require('node:path');
const { existsSync } = require('node:fs');
const { installWorkbenchZoom } = require('./zoom.cjs');
const { createMeetingPresenceHandler } = require('./meeting-presence.cjs');

// A packaged GUI can outlive the terminal or automation pipe that launched it.
// Logging is diagnostic only, so a closed parent pipe must never crash the app
// with an unhandled EPIPE while Whisper is reporting readiness or latency.
protectDiagnosticStream(process.stdout);
protectDiagnosticStream(process.stderr);

// Electron names its per-user data directory after the packaged app's
// package.json `name`, which here is the npm workspace root — so it would
// write to AppData\Roaming\@abheet19\zeno-workspace\. Say the product's name
// once, before anything asks for a path, and it becomes AppData\Roaming\Zeno.
app.setName('Zeno');
app.setAppUserModelId('dev.abheet.zeno');

// A second launcher should focus the Zeno the owner already has instead of
// spawning another daemon, losing the workspace lock, and showing a technical
// PID/port error. This lock belongs to the desktop shell only; the daemon's
// workspace lock remains the final protection against two different hosts
// writing the same receipt ledger.
const ownsDesktopInstance = claimDesktopInstance(app);

const HOST = '127.0.0.1';
const PORT = Number(process.env.ZENO_PORT || 7317);
const ORIGIN = `http://${HOST}:${PORT}`;

/** @type {import('node:child_process').ChildProcess | null} */
let daemon = null;
/** @type {BrowserWindow | null} */
let win = null;
let launchUrl = ORIGIN;
// Held behind a proxy, not a plain const: a successful local Whisper install
// (see the IPC handlers below) replaces the engine underneath so the mic works
// without a restart. installWhisperSpeech captures whatever object it is given
// once, so the object it holds must forward to whichever engine is current
// rather than be the engine itself.
let activeSpeechEngine = createWhisperEngine(resolveWhisperRuntime());
const speechEngineHandle = {
  available: () => activeSpeechEngine.available(),
  ready: () => activeSpeechEngine.ready(),
  transcribe: (...args) => activeSpeechEngine.transcribe(...args),
  stop: () => activeSpeechEngine.stop(),
  status: () => activeSpeechEngine.status(),
};
const stopSpeech = installWhisperSpeech(ipcMain, () => win, ORIGIN, speechEngineHandle);
let speechInstallController = null;

/**
 * Find the daemon entry point. Packaged, it sits beside the app resources;
 * from source, it is the compiled output in the workspace.
 */
function daemonEntry() {
  const packaged = join(process.resourcesPath || '', 'daemon', 'main.js');
  if (existsSync(packaged)) return packaged;
  const fromSource = join(__dirname, '..', 'daemon', 'dist', 'src', 'main.js');
  return existsSync(fromSource) ? fromSource : null;
}

/**
 * Start the daemon and wait for it to print its launch URL.
 *
 * The URL carries a one-time nonce; without it the page is served read-only and
 * cannot approve anything. So the window must not load until that line arrives —
 * opening early would produce a window that silently cannot do its one job.
 */
function startDaemon() {
  return new Promise((resolve, reject) => {
    const entry = daemonEntry();
    if (!entry) return reject(new Error('The Zeno daemon build was not found. Run "npm run build" first.'));

    // Where an installed Zeno keeps its receipts. The daemon's own default is
    // `.zeno` resolved against the working directory, which is exactly right
    // for a checkout and quietly wrong for an installed application: launched
    // from the Start menu the working directory is arbitrary, and under
    // Program Files it is not writable at all. So the packaged app names a
    // per-user location instead. A checkout keeps the old behaviour, and an
    // explicit ZENO_DIR still wins over both.
    //
    // The Forge working folder is NOT decided here any more. The daemon keeps
    // the owner's choice itself (<workspace>/project.json, written by its
    // POST /forge/project route and read back at every start), so the
    // desktop no longer holds a second copy that could disagree with it. An
    // explicit ZENO_PROJECT_DIR in this process's environment still passes
    // through as a per-launch override, exactly as `npm run up` honours it.
    const userDataPath = app.getPath('userData');
    const env = createDaemonEnvironment(process.env, {
      isPackaged: app.isPackaged,
      workspacePath: join(userDataPath, 'workspace'),
      project: process.env.ZENO_PROJECT_DIR,
    });

    const child = spawn(process.execPath, [entry], {
      // ELECTRON_RUN_AS_NODE makes Electron's bundled binary behave as plain
      // Node, so the daemon runs without needing Node installed on the machine.
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      shell: false,
    });
    daemon = child;

    let settled = false;
    const done = (u) => { if (!settled) { settled = true; resolve(u); } };

    // Keep what the daemon says on its way out. When it refuses to start it
    // explains why in plain words — the port is taken, the workspace is held
    // by another copy — and that sentence is the entire diagnosis. Reporting
    // only "exited (code 1)" throws the answer away and leaves the owner with
    // a dead end to guess at.
    let said = '';
    const remember = (text) => { if (said.length < 4000) said += text; };

    child.stdout.on('data', (b) => {
      const text = String(b);
      remember(text);
      // Match against everything the daemon has said so far, not just this
      // chunk: a pipe can split the banner line across two `data` events, and a
      // per-chunk match would then never see the token at all.
      const m = said.match(/http:\/\/127\.0\.0\.1:\d+\/\?k=[a-f0-9]+/);
      if (!m) return;
      launchUrl = m[0];
      if (!settled) return done(m[0]);
      // The banner arrived AFTER the fallback below already opened a window on
      // the bare origin — i.e. a read-only window with no owner token, where
      // chat, Forge and every approval silently fail. That is the one failure
      // this handoff exists to prevent, so upgrade the open window in place.
      if (win && !win.isDestroyed()) void win.loadURL(m[0]);
    });
    child.stderr.on('data', (b) => {
      const text = String(b);
      remember(text);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (daemon === child) daemon = null;
      if (settled) return;
      const explained = said.trim();
      reject(new Error(explained !== ''
        ? explained
        : `The daemon exited before it was ready (code ${code}), and gave no reason.`));
    });

    // If the banner never arrives, fall back to the bare origin rather than
    // hanging forever — a read-only window beats no window, and it says so.
    // 12s was too short: receipt-chain verification, model detection and the
    // speech runtime can take longer on a cold start, and losing that race
    // produced a window with no owner token. Wait longer, and rely on the
    // late-upgrade above to authorise the window whenever the token does land.
    setTimeout(() => done(ORIGIN), 45_000);
  });
}

function stopDaemon() {
  const child = daemon;
  if (!child) return Promise.resolve();
  daemon = null;
  return stopDaemonChild(child);
}

function trustedFrame(event) {
  return isTrustedMainFrame(event, win, ORIGIN);
}

// Whether local Whisper is actually on disk right now — read fresh on every
// call rather than cached, since installing (below) can change the answer.
ipcMain.handle('zeno:speech:install:status', event => {
  if (!trustedFrame(event)) return { installed: false };
  return describeSpeechInstallStatus();
});

// One install at a time. Nothing downloads until the owner clicks Install in
// Settings → Voice; there is no other caller of installWhisperRuntime().
ipcMain.handle('zeno:speech:install:start', async event => {
  if (!trustedFrame(event)) return { ok: false, error: 'not-trusted', message: 'This window cannot install local Whisper.' };
  if (process.platform !== 'win32') return { ok: false, error: 'unsupported-platform', message: 'Local Whisper install is only available in the Windows desktop app.' };
  if (speechInstallController) return { ok: false, error: 'in-progress', message: 'An install is already in progress.' };
  const sender = event.sender;
  speechInstallController = new AbortController();
  try {
    const result = await installWhisperRuntime({
      signal: speechInstallController.signal,
      onProgress: progress => { if (!sender.isDestroyed()) sender.send('zeno:speech:install:progress', progress); },
    });
    // The engine created at launch captured whatever (non-existent) path
    // resolveWhisperRuntime() picked back then; re-resolve now that the files
    // are real, and swap it in behind the handle so the mic works without a
    // restart. The idle-stopped old engine holds no process to leak.
    await activeSpeechEngine.stop().catch(() => {});
    activeSpeechEngine = createWhisperEngine(resolveWhisperRuntime());
    if (!sender.isDestroyed()) sender.send('zeno:speech:install:runtime-changed');
    return { ok: true, alreadyInstalled: Boolean(result.alreadyInstalled), executable: result.executable, model: result.model, gpu: Boolean(result.gpu) };
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : 'install-failed';
    return { ok: false, error: code, message: String(error && error.message ? error.message : error) };
  } finally {
    speechInstallController = null;
  }
});

ipcMain.handle('zeno:speech:install:cancel', event => {
  if (!trustedFrame(event) || !speechInstallController) return false;
  speechInstallController.abort();
  return true;
});

// Counsel receives only recognized meeting-window names. The handler requests
// no thumbnail and exposes neither source ids nor the rest of the user's window
// inventory; the same main-frame origin check protects every desktop bridge.
ipcMain.handle('zeno:meeting:detect', createMeetingPresenceHandler({ desktopCapturer, trustedFrame }));

// The native folder picker for Forge's "Change working folder". This ONLY
// asks the owner and validates the answer (a folder inside a Git repository,
// resolved to its root). It no longer restarts the daemon: the window hands
// the path to POST /forge/project, which switches the repository in place —
// no reload, the session panel keeps its state — and persists the choice in
// the daemon's own workspace, the single place it is remembered.
ipcMain.handle('zeno:project:choose', async (event) => {
  if (!trustedFrame(event)) return { ok: false, error: 'The project picker is not available in this window.' };
  const answer = await dialog.showOpenDialog(win, {
    title: 'Choose the Git repository Forge should work in',
    buttonLabel: 'Open in Forge',
    properties: ['openDirectory'],
  });
  if (answer.canceled || answer.filePaths.length !== 1) return { ok: false, canceled: true };
  return inspectProject(answer.filePaths[0]);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0A0C0E', // the graphite ground, so there is no white flash
    title: 'Zeno',
    icon: join(__dirname, 'resources', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return;
    win.maximize();
    win.show();
  });
  win.on('closed', () => { stopSpeech(); win = null; });

  // The menu bar is intentionally hidden, so own the normal IDE zoom contract
  // here: Ctrl/Cmd +, Ctrl/Cmd -, and Ctrl/Cmd 0. This scales every Forge pane
  // together and keeps the factor bounded by zoom.cjs.
  installWorkbenchZoom(win.webContents);

  // Pin the window to loopback. Anything else is either an attack or a real
  // outbound link; neither belongs inside the application window.
  const isOurs = (u) => { try { return new URL(u).origin === ORIGIN; } catch { return false; } };
  win.webContents.on('will-navigate', (e, u) => { if (!isOurs(u)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOurs(url)) { void shell.openExternal(url); }
    return { action: 'deny' };
  });

  void win.loadURL(launchUrl);
}

if (ownsDesktopInstance) registerSecondInstanceFocus(app, () => win);

if (ownsDesktopInstance) app.whenReady().then(async () => {
  try {
    launchUrl = await startDaemon();
  } catch (err) {
    dialog.showErrorBox('Zeno could not start', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }
  // Load the window's code FRESH every launch. The daemon already serves the UI
  // with `cache-control: no-store`, but Chromium keeps parsed ES modules in a
  // per-origin cache that a normal reload does not clear — so after an update the
  // window could keep running the old modules. Clearing the session cache on
  // startup makes "launch the app" and "see the current build" the same thing.
  try { await session.defaultSession.clearCache(); } catch { /* a cache that will not clear is not fatal */ }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

/** Closing the window closes Zeno — and takes the daemon with it. */
app.on('window-all-closed', () => app.quit());
registerGracefulQuit(app, async () => { await stopSpeech(); await stopDaemon(); });
process.on('exit', () => { stopSpeech(); if (daemon) daemon.kill(); });
