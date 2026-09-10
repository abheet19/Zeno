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
 * The project picked during this session wins. An explicit launch-time project
 * comes next, then the last valid saved choice. Invalid saved state is removed
 * so a deleted or moved repository cannot poison every later launch.
 */
function resolveDaemonProject(options, dependencies) {
  const session = nonEmptyPath(options.sessionProject);
  if (session) return { path: session, source: 'session' };

  const environment = nonEmptyPath(options.environmentProject);
  if (environment) return { path: environment, source: 'environment' };

  const saved = dependencies.readPreference(options.preferencePath);
  if (saved && saved.ok && nonEmptyPath(saved.path)) {
    return { path: saved.path.trim(), source: 'preference' };
  }

  // Missing preferences and stale preferences share the same safe fallback.
  // `clearPreference` is idempotent; a read-only profile must not prevent Zeno
  // from opening its built-in sandbox, so cleanup failure stays non-fatal.
  try { dependencies.clearPreference(options.preferencePath); } catch {}
  return { path: null, source: 'sandbox' };
}

function createDaemonEnvironment(baseEnvironment, options) {
  const env = { ...baseEnvironment, ELECTRON_RUN_AS_NODE: '1', ZENO_NO_OPEN: '1' };
  if (options.isPackaged && !nonEmptyPath(env.ZENO_DIR)) {
    env.ZENO_DIR = options.workspacePath;
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
  resolveDaemonProject,
  stopDaemonChild,
};
