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
const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const { join, dirname } = require('node:path');
const { existsSync } = require('node:fs');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ZENO_PORT || 7317);
const ORIGIN = `http://${HOST}:${PORT}`;

/** @type {import('node:child_process').ChildProcess | null} */
let daemon = null;
/** @type {BrowserWindow | null} */
let win = null;
let launchUrl = ORIGIN;

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

    daemon = spawn(process.execPath, [entry], {
      // ELECTRON_RUN_AS_NODE makes Electron's bundled binary behave as plain
      // Node, so the daemon runs without needing Node installed on the machine.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ZENO_NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const done = (u) => { if (!settled) { settled = true; resolve(u); } };

    daemon.stdout.on('data', (b) => {
      const text = String(b);
      process.stdout.write(text);
      const m = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?k=[a-f0-9]+/);
      if (m) done(m[0]);
    });
    daemon.stderr.on('data', (b) => process.stderr.write(String(b)));
    daemon.on('error', reject);
    daemon.on('exit', (code) => {
      daemon = null;
      if (!settled) reject(new Error(`The daemon exited before it was ready (code ${code}).`));
    });

    // If the banner never arrives, fall back to the bare origin rather than
    // hanging forever — a read-only window beats no window, and it says so.
    setTimeout(() => done(ORIGIN), 12_000);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0A0C0E', // the graphite ground, so there is no white flash
    title: 'Zeno',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win && win.show());
  win.on('closed', () => { win = null; });

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

app.whenReady().then(async () => {
  try {
    launchUrl = await startDaemon();
  } catch (err) {
    dialog.showErrorBox('Zeno could not start', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

/** Closing the window closes Zeno — and takes the daemon with it. */
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (daemon) { daemon.kill(); daemon = null; } });
process.on('exit', () => { if (daemon) daemon.kill(); });
