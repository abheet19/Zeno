'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  claimDesktopInstance,
  createDaemonEnvironment,
  isTrustedMainFrame,
  protectDiagnosticStream,
  registerGracefulQuit,
  registerSecondInstanceFocus,
  resolveDaemonProject,
  stopDaemonChild,
} = require('../lifecycle.cjs');

test('a closed launcher pipe cannot crash the desktop with EPIPE', () => {
  const stream = new EventEmitter();
  const unexpected = [];
  const dispose = protectDiagnosticStream(stream, error => unexpected.push(error));
  assert.doesNotThrow(() => stream.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })));
  assert.deepEqual(unexpected, []);
  dispose();
  assert.equal(stream.listenerCount('error'), 0);
});

test('non-EPIPE diagnostic failures stay contained and observable in tests', () => {
  const stream = new EventEmitter();
  const unexpected = [];
  protectDiagnosticStream(stream, error => unexpected.push(error));
  const failure = Object.assign(new Error('stream closed'), { code: 'ERR_STREAM_DESTROYED' });
  assert.doesNotThrow(() => stream.emit('error', failure));
  assert.deepEqual(unexpected, [failure]);
});

test('desktop shutdown asks the daemon over IPC before using its hard-kill fallback', async () => {
  const events = [];
  let onExit;
  let fallback;
  const timer = { unref: () => events.push('unref') };
  const child = {
    connected: true,
    once: (event, callback) => { assert.equal(event, 'exit'); onExit = callback; },
    send: (message) => events.push(`send:${message}`),
    kill: (signal) => events.push(`kill:${signal ?? 'SIGTERM'}`),
  };
  const stopped = stopDaemonChild(child, {
    schedule: (callback, timeoutMs) => {
      events.push(`schedule:${timeoutMs}`);
      fallback = callback;
      return timer;
    },
    cancel: (handle) => {
      assert.equal(handle, timer);
      events.push('cancel');
    },
  });

  assert.deepEqual(events, ['schedule:3000', 'unref', 'send:zeno:shutdown']);
  onExit();
  await stopped;
  assert.deepEqual(events, ['schedule:3000', 'unref', 'send:zeno:shutdown', 'cancel']);

  fallback();
  assert.deepEqual(events, ['schedule:3000', 'unref', 'send:zeno:shutdown', 'cancel'], 'a late fallback cannot kill an exited daemon');
});

test('desktop daemon shutdown hard-kills after the bounded IPC deadline', async () => {
  const events = [];
  let fallback;
  const child = {
    connected: true,
    once: () => {},
    send: (message) => events.push(`send:${message}`),
    kill: (signal) => events.push(`kill:${signal}`),
  };
  const stopped = stopDaemonChild(child, {
    timeoutMs: 25,
    schedule: (callback, timeoutMs) => {
      events.push(`schedule:${timeoutMs}`);
      fallback = callback;
      return {};
    },
    cancel: () => events.push('cancel'),
  });

  assert.deepEqual(events, ['schedule:25', 'send:zeno:shutdown']);
  fallback();
  await stopped;
  assert.deepEqual(events, ['schedule:25', 'send:zeno:shutdown', 'kill:SIGKILL', 'cancel']);
});

test('Electron quit waits for cleanup once, then allows the final quit event', async () => {
  let beforeQuit;
  let finishCleanup;
  let cleanupCalls = 0;
  let quitCalls = 0;
  const cleanup = new Promise(resolve => { finishCleanup = resolve; });
  const app = {
    on: (event, callback) => { assert.equal(event, 'before-quit'); beforeQuit = callback; },
    quit: () => { quitCalls++; },
  };
  registerGracefulQuit(app, () => { cleanupCalls++; return cleanup; });

  let prevented = 0;
  beforeQuit({ preventDefault: () => { prevented++; } });
  beforeQuit({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2, 'every quit event is held while cleanup is pending');
  assert.equal(cleanupCalls, 0, 'cleanup begins on the microtask queue once');

  await Promise.resolve();
  assert.equal(cleanupCalls, 1);
  finishCleanup();
  await cleanup;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 1);

  beforeQuit({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 2, 'the final quit event passes through after cleanup');
  assert.equal(cleanupCalls, 1);
});
test('a second desktop process quits before it can start another daemon', () => {
  let quits = 0;
  assert.equal(claimDesktopInstance({ requestSingleInstanceLock: () => false, quit: () => { quits += 1; } }), false);
  assert.equal(quits, 1);
  assert.equal(claimDesktopInstance({ requestSingleInstanceLock: () => true, quit: () => { quits += 1; } }), true);
  assert.equal(quits, 1);
});

test('a second launch restores and focuses the existing Zeno window', () => {
  let callback;
  const actions = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => actions.push('restore'),
    show: () => actions.push('show'),
    focus: () => actions.push('focus'),
  };
  registerSecondInstanceFocus({ on: (event, fn) => { assert.equal(event, 'second-instance'); callback = fn; } }, () => window);
  callback();
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
});

test('a second launch during shutdown never touches a destroyed window', () => {
  let callback;
  let calls = 0;
  const window = { isDestroyed: () => true, isMinimized: () => { calls += 1; }, show: () => { calls += 1; }, focus: () => { calls += 1; } };
  registerSecondInstanceFocus({ on: (_event, fn) => { callback = fn; } }, () => window);
  assert.doesNotThrow(callback);
  assert.equal(calls, 0);
});

test('the project picker accepts only the current loopback main frame', () => {
  const mainFrame = { url: 'http://127.0.0.1:7317/?k=nonce' };
  const sender = { mainFrame };
  const window = { isDestroyed: () => false, webContents: sender };
  assert.equal(isTrustedMainFrame({ sender, senderFrame: mainFrame }, window, 'http://127.0.0.1:7317'), true);
  assert.equal(isTrustedMainFrame({ sender: {}, senderFrame: mainFrame }, window, 'http://127.0.0.1:7317'), false);
  assert.equal(isTrustedMainFrame({ sender, senderFrame: { url: mainFrame.url } }, window, 'http://127.0.0.1:7317'), false);
  mainFrame.url = 'https://example.invalid/';
  assert.equal(isTrustedMainFrame({ sender, senderFrame: mainFrame }, window, 'http://127.0.0.1:7317'), false);
  window.isDestroyed = () => true;
  assert.equal(isTrustedMainFrame({ sender, senderFrame: mainFrame }, window, 'http://127.0.0.1:7317'), false);
});

test('project selection has stable precedence and trims explicit launch paths', () => {
  const dependencies = { readPreference: () => ({ ok: true, path: 'D:\\saved' }), clearPreference() {} };
  assert.deepEqual(resolveDaemonProject({ sessionProject: ' D:\\picked ', environmentProject: 'D:\\env', preferencePath: 'pref' }, dependencies), { path: 'D:\\picked', source: 'session' });
  assert.deepEqual(resolveDaemonProject({ sessionProject: null, environmentProject: ' D:\\env ', preferencePath: 'pref' }, dependencies), { path: 'D:\\env', source: 'environment' });
  assert.deepEqual(resolveDaemonProject({ sessionProject: null, environmentProject: '', preferencePath: 'pref' }, dependencies), { path: 'D:\\saved', source: 'preference' });
});

test('a stale saved project is forgotten and launch falls back to the safe sandbox', () => {
  const cleared = [];
  const result = resolveDaemonProject(
    { sessionProject: null, environmentProject: '', preferencePath: 'C:\\profile\\forge-project.json' },
    { readPreference: () => ({ ok: false, error: 'That folder cannot be read.' }), clearPreference: path => cleared.push(path) },
  );
  assert.deepEqual(result, { path: null, source: 'sandbox' });
  assert.deepEqual(cleared, ['C:\\profile\\forge-project.json']);
});

test('an unreadable stale preference cannot prevent sandbox startup', () => {
  const result = resolveDaemonProject(
    { sessionProject: null, environmentProject: '', preferencePath: 'C:\\profile\\forge-project.json' },
    { readPreference: () => ({ ok: false }), clearPreference: () => { throw new Error('access denied'); } },
  );
  assert.deepEqual(result, { path: null, source: 'sandbox' });
});

test('desktop daemon environment preserves Ollama discovery and selects the canonical project', () => {
  const env = createDaemonEnvironment(
    { PATH: 'C:\\tools', LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local', OLLAMA_HOST: '127.0.0.1:11434', ZENO_PROJECT_DIR: 'D:\\stale' },
    { isPackaged: true, workspacePath: 'C:\\profile\\workspace', project: 'D:\\repo' },
  );
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.ZENO_NO_OPEN, '1');
  assert.equal(env.ZENO_DIR, 'C:\\profile\\workspace');
  assert.equal(env.ZENO_PROJECT_DIR, 'D:\\repo');
  assert.equal(env.PATH, 'C:\\tools');
  assert.equal(env.LOCALAPPDATA, 'C:\\Users\\owner\\AppData\\Local');
  assert.equal(env.OLLAMA_HOST, '127.0.0.1:11434');
});

test('the daemon entry launched by desktop retains Ollama auto-start wiring', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'daemon', 'src', 'main.ts'), 'utf8');
  assert.match(source, /createServer\(\{[\s\S]*?ollamaAutoStart:\s*true[\s\S]*?\}\)/);
});

test('the desktop daemon starts without opening a Windows console window', () => {
  const source = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(source, /spawn\(process\.execPath, \[entry\], \{[\s\S]*?windowsHide:\s*true[\s\S]*?shell:\s*false[\s\S]*?\}\)/);
});

test('the packaged app includes every local module required by the desktop entry point', () => {
  const desktopRoot = join(__dirname, '..');
  const main = readFileSync(join(desktopRoot, 'main.cjs'), 'utf8');
  const builder = JSON.parse(readFileSync(join(desktopRoot, '..', '..', 'electron-builder.json'), 'utf8'));
  const packagedFiles = new Set(builder.files);
  const localRequires = [...main.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)]
    .map(([, relative]) => 'packages/desktop/' + relative);

  assert.ok(localRequires.length > 0, 'the entry point should have local module dependencies');
  for (const requiredFile of localRequires) {
    assert.equal(
      packagedFiles.has(requiredFile),
      true,
      requiredFile + ' is required by main.cjs and must be present in portable and NSIS builds',
    );
  }
});
