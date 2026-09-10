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
const { app, BrowserWindow, shell, dialog, ipcMain, desktopCapturer } = require('electron');
const { createWhisperEngine, installWhisperSpeech, resolveWhisperRuntime } = require('./whisper.cjs');
const { clearProjectPreference, inspectProject, readProjectPreference, writeProjectPreference } = require('./project.cjs');
const {
  claimDesktopInstance,
  createDaemonEnvironment,
  isTrustedMainFrame,
  protectDiagnosticStream,
  registerGracefulQuit,
  registerSecondInstanceFocus,
  resolveDaemonProject,
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
let sessionProject = null;
let projectSwitching = false;
const speechEngine = createWhisperEngine(resolveWhisperRuntime());
const stopSpeech = installWhisperSpeech(ipcMain, () => win, ORIGIN, speechEngine);

/**
 * Give the local recognizer a short head start before the owner can press a
 * voice control. The two-second ceiling keeps a missing/broken runtime from
 * delaying the desktop; the ordinary capture path still reports that failure.
 */
async function warmSpeech(maxMs = 2_000) {
  if (!speechEngine.available()) return;
  await Promise.race([
    speechEngine.ready().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, maxMs)),
  ]);
}

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
    const userDataPath = app.getPath('userData');
    const project = resolveDaemonProject({
      sessionProject,
      environmentProject: process.env.ZENO_PROJECT_DIR,
      preferencePath: join(userDataPath, 'forge-project.json'),
    }, {
      readPreference: readProjectPreference,
      clearPreference: clearProjectPreference,
    });
    const env = createDaemonEnvironment(process.env, {
      isPackaged: app.isPackaged,
      workspacePath: join(userDataPath, 'workspace'),
      project: project.path,
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
      const m = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?k=[a-f0-9]+/);
      if (m) done(m[0]);
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
    setTimeout(() => done(ORIGIN), 12_000);
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

// Counsel receives only recognized meeting-window names. The handler requests
// no thumbnail and exposes neither source ids nor the rest of the user's window
// inventory; the same main-frame origin check protects every desktop bridge.
ipcMain.handle('zeno:meeting:detect', createMeetingPresenceHandler({ desktopCapturer, trustedFrame }));

ipcMain.handle('zeno:project:choose', async (event) => {
  if (!trustedFrame(event) || projectSwitching) return { ok: false, error: 'The project picker is not available in this window.' };
  const answer = await dialog.showOpenDialog(win, {
    title: 'Choose the Git repository Forge should work in',
    buttonLabel: 'Open in Forge',
    properties: ['openDirectory'],
  });
  if (answer.canceled || answer.filePaths.length !== 1) return { ok: false, canceled: true };
  const inspected = inspectProject(answer.filePaths[0]);
  if (!inspected.ok) return inspected;
  const preference = join(app.getPath('userData'), 'forge-project.json');
  const previous = readProjectPreference(preference);
  writeProjectPreference(preference, inspected.path);
  sessionProject = inspected.path;
  projectSwitching = true;
  setTimeout(() => {
    void (async () => {
      try {
        await stopSpeech();
        await stopDaemon();
        launchUrl = await startDaemon();
        await warmSpeech();
        if (win && !win.isDestroyed()) await win.loadURL(launchUrl);
      } catch (error) {
        sessionProject = previous.ok ? previous.path : null;
        if (previous.ok) writeProjectPreference(preference, previous.path);
        else clearProjectPreference(preference);
        try {
          launchUrl = await startDaemon();
          if (win && !win.isDestroyed()) await win.loadURL(launchUrl);
        } catch { /* the error box below is the useful diagnosis */ }
        dialog.showErrorBox('Forge could not open that project', String(error && error.message ? error.message : error));
      } finally {
        projectSwitching = false;
      }
    })();
  }, 100);
  return { ok: true, path: inspected.path };
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

  win.once('ready-to-show', () => win && win.show());
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
  // Load the local model alongside the daemon so the first press does not lose
  // the beginning of a sentence while Whisper boots. `ready()` is idempotent;
  // a missing runtime remains a visible, handled capture failure in the UI.
  const speechWarm = warmSpeech();
  try {
    launchUrl = await startDaemon();
  } catch (err) {
    dialog.showErrorBox('Zeno could not start', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }
  await speechWarm;
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

/** Closing the window closes Zeno — and takes the daemon with it. */
app.on('window-all-closed', () => app.quit());
registerGracefulQuit(app, async () => { await stopSpeech(); await stopDaemon(); });
process.on('exit', () => { stopSpeech(); if (daemon) daemon.kill(); });
