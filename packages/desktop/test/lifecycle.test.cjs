'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const {
  claimDesktopInstance,
  createDaemonEnvironment,
  isTrustedMainFrame,
  protectDiagnosticStream,
  registerGracefulQuit,
  registerSecondInstanceFocus,
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

test('without an explicit override the daemon decides the project itself — no ZENO_PROJECT_DIR is invented', () => {
  const env = createDaemonEnvironment({ PATH: 'C:\\tools' }, { isPackaged: true, workspacePath: 'C:\\profile\\workspace', project: undefined });
  assert.equal(env.ZENO_PROJECT_DIR, undefined);
  assert.equal(env.ZENO_DIR, 'C:\\profile\\workspace');
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

test('the desktop opens its primary window maximized without kiosk mode', () => {
  const source = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8');
  const readyHandler = source.match(/win\.once\('ready-to-show',[\s\S]*?\n  \}\);/);
  assert.ok(readyHandler, 'the primary window must wait until it is ready before showing');
  assert.match(readyHandler[0], /win\.maximize\(\);[\s\S]*?win\.show\(\);/);
  assert.doesNotMatch(source, /\bkiosk\s*:\s*true\b|\.setKiosk\(true\)/);
});

test('Forge lets the owner pick real skills for a run, and Lens stays a separate context inspector', () => {
  // packages/daemon/public/forge.js — the pre-rebuild renderer this test used
  // to read — is dead code (the app loads bind/forge.js) and has been deleted.
  // bind/forge.js re-expresses the same underlying guarantee ("Skills you pick
  // are the real selection sent with a run, and Lens is a separate exact-context
  // view") against the design artifact's markup, but not as a searchable-catalog
  // modal opened from the composer's Skills CTA — the artifact's own ZENO
  // sidebar panel already lists rules/skills/schedule/connectors, so this binder
  // wires ticking a skill THERE into the real `selectedSkillIds` a run sends,
  // rather than duplicating a second catalog UI. That is a real, deliberate
  // simplification of the pre-rebuild design (confirmed: no searchable Skills
  // catalog markup or `openSkillsCatalog`-style modal exists anywhere under
  // packages/daemon/public/bind) — asserted here as what actually ships, not
  // reworded to sound like the old modal still exists.
  // bind/forge.js was split into bind/forge/*.js; selectedSkillIds now lives in
  // the shared bind/forge/state.js and renderLens in a session module. Read the
  // whole forge surface so this pins the GUARANTEE (real skill selection is what
  // a run sends; Lens stays separate; no resurrected catalog modal) wherever the
  // code lives, not the file it happens to be in.
  const forgeDir = join(__dirname, '..', '..', 'daemon', 'public', 'bind', 'forge');
  const source = [join(__dirname, '..', '..', 'daemon', 'public', 'bind', 'forge.js')]
    .concat(readdirSync(forgeDir).filter((f) => f.endsWith('.js')).map((f) => join(forgeDir, f)))
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  assert.match(source, /selectedSkillIds: new Set\(\)/,
    'ticking a skill in the ZENO sidebar is the real selection, not a fixed mock count');
  assert.match(source, /selectedSkillIds\.size/,
    'the composer\'s "N skills" pill reads the real selection size');
  assert.match(source, /skillIds: \[\.\.\.S\.selectedSkillIds\]/,
    'a run is sent with exactly the skills the owner ticked');
  assert.match(source, /function renderLens\(session\)/,
    'Lens remains its own function, separate from the skills selector');
  assert.doesNotMatch(source, /openSkillsCatalog/,
    'the old searchable-catalog modal was not silently resurrected under a new name');
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

test('the packaged daemon closes over every runtime workspace dependency', () => {
  const repoRoot = join(__dirname, '..', '..', '..');
  const packagesRoot = join(repoRoot, 'packages');
  const builder = JSON.parse(readFileSync(join(repoRoot, 'electron-builder.json'), 'utf8'));
  const resources = new Map(builder.extraResources.map(resource => [resource.to, resource]));
  const workspaces = new Map();

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageFile = join(packagesRoot, entry.name, 'package.json');
    let manifest;
    try { manifest = JSON.parse(readFileSync(packageFile, 'utf8')); } catch { continue; }
    workspaces.set(manifest.name, { directory: entry.name, manifest });
  }

  const visited = new Set();
  const verify = name => {
    if (visited.has(name)) return;
    visited.add(name);
    const workspace = workspaces.get(name);
    assert.ok(workspace, name + ' must resolve to a workspace package');
    const destination = 'node_modules/' + name;
    const resource = resources.get(destination);
    assert.ok(resource, name + ' must be copied into the packaged runtime');
    assert.equal(resource.from, 'packages/' + workspace.directory);
    for (const required of ['package.json', 'dist/**/*']) {
      assert.ok(resource.filter.includes(required), name + ' must package ' + required);
    }
    for (const dependency of Object.keys(workspace.manifest.dependencies || {})) {
      if (dependency.startsWith('@abheet19/zeno-')) verify(dependency);
    }
  };

  const daemon = JSON.parse(readFileSync(join(packagesRoot, 'daemon', 'package.json'), 'utf8'));
  for (const dependency of Object.keys(daemon.dependencies || {})) {
    if (dependency.startsWith('@abheet19/zeno-')) verify(dependency);
  }

  const browse = resources.get('node_modules/@abheet19/zeno-browse');
  assert.ok(browse.filter.includes('session-main.cjs'), 'Browse must package its Electron session entry point');
});
