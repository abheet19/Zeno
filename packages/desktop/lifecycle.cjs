'use strict';

/**
 * A desktop app can outlive the terminal or automation pipe that launched it.
 * Node treats an unhandled stream "error" event as fatal, so diagnostic output
 * must have a listener even though the GUI does not depend on that output.
 */
function protectDiagnosticStream(stream, reportUnexpected) {
  if (!stream || typeof stream.on !== 'function') return () => {};
  const onError = error => {
    if (error && error.code === 'EPIPE') return;
    if (typeof reportUnexpected === 'function') reportUnexpected(error);
  };
  stream.on('error', onError);
  return () => {
    if (typeof stream.off === 'function') stream.off('error', onError);
    else if (typeof stream.removeListener === 'function') stream.removeListener('error', onError);
  };
}

/**
 * Ask the daemon to run its own graceful shutdown path. Windows child.kill()
 * cannot deliver a catchable SIGTERM, so the private Node IPC channel is the
 * ordinary path; a hard kill remains the bounded last resort.
 */
function stopDaemonChild(child, options = {}) {
  if (!child) return Promise.resolve();
  const timeoutMs = options.timeoutMs ?? 3000;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;

  return new Promise(resolve => {
    let complete = false;
    let timer = null;
    const finish = () => {
      if (complete) return;
      complete = true;
      if (timer !== null) cancel(timer);
      resolve();
    };
    const terminate = signal => {
      try { child.kill(signal); } catch { finish(); }
    };
    const hardKill = () => {
      if (complete) return;
      terminate('SIGKILL');
      finish();
    };

    timer = schedule(hardKill, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    child.once('exit', finish);
    try {
      if (child.connected && typeof child.send === 'function') {
        child.send('zeno:shutdown', error => { if (error) terminate(); });
      } else {
        terminate();
      }
    } catch {
      terminate();
    }
  });
}

/** Keep Electron alive until the bounded speech and daemon cleanup completes. */
function registerGracefulQuit(app, cleanup) {
  let draining = false;
  let readyToQuit = false;
  app.on('before-quit', event => {
    if (readyToQuit) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    Promise.resolve()
      .then(cleanup)
      .catch(() => { /* cleanup is best-effort; its own fallbacks are bounded */ })
      .finally(() => {
        readyToQuit = true;
        app.quit();
      });
  });
}
function claimDesktopInstance(app) {
  const owns = app.requestSingleInstanceLock();
  if (!owns) app.quit();
  return owns;
}

function focusExistingWindow(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}

function registerSecondInstanceFocus(app, getWindow) {
  app.on('second-instance', () => focusExistingWindow(getWindow()));
}

function isTrustedMainFrame(event, window, origin) {
  if (!window || window.isDestroyed()) return false;
  if (!event || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}

function nonEmptyPath(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The daemon's environment. `project` is an explicit per-launch override
 * (ZENO_PROJECT_DIR) and nothing else: the owner's saved working folder is
 * the daemon's own state (<workspace>/project.json), so the desktop no
 * longer resolves or remembers one.
 */
function createDaemonEnvironment(baseEnvironment, options) {
  const env = { ...baseEnvironment, ELECTRON_RUN_AS_NODE: '1', ZENO_NO_OPEN: '1' };
  if (options.isPackaged && !nonEmptyPath(env.ZENO_DIR)) {
    env.ZENO_DIR = options.workspacePath;
  }
  if (options.isPackaged && options.buildIdentity) {
    // Never trust ambient variables for an installed app. The package stamp is
    // generated from the exact checkout before electron-builder runs.
    env.ZENO_BUILD_SHA = options.buildIdentity.sha;
    env.ZENO_VERSION = options.buildIdentity.version;
  }
  const project = nonEmptyPath(options.project);
  if (project) env.ZENO_PROJECT_DIR = project;
  else delete env.ZENO_PROJECT_DIR;
  return env;
}

module.exports = {
  claimDesktopInstance,
  createDaemonEnvironment,
  focusExistingWindow,
  isTrustedMainFrame,
  protectDiagnosticStream,
  registerGracefulQuit,
  registerSecondInstanceFocus,
  stopDaemonChild,
};
