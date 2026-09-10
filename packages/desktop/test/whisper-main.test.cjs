const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  MAX_INITIAL_PROMPT_CHARS,
  cleanTranscript,
  createWhisperEngine,
  installWhisperSpeech,
  publicErrorCode,
  wavBuffer,
} = require('../whisper.cjs');

function wav(size = 64) {
  const value = Buffer.alloc(size);
  value.write('RIFF', 0, 'ascii');
  value.writeUInt32LE(size - 8, 4);
  value.write('WAVE', 8, 'ascii');
  return value;
}

function harness(t, overrides = {}) {
  const handlers = new Map();
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const sender = new EventEmitter();
  const frame = { url: 'http://127.0.0.1:7391/' };
  sender.mainFrame = frame;
  const window = { webContents: sender, isDestroyed: () => false };
  const calls = [];
  const diagnostics = [];
  const engine = {
    available: () => overrides.available ?? true,
    ready: async () => { calls.push(['ready']); if (overrides.readyError) throw overrides.readyError; },
    transcribe: async (audio, lang, signal, prompt) => {
      calls.push(['transcribe', audio, lang, signal, prompt]);
      if (overrides.transcribe) return overrides.transcribe(audio, lang, signal, prompt);
      return 'local transcript';
    },
    stop: async () => { calls.push(['engine-stop']); },
  };
  const dispose = installWhisperSpeech(
    ipc,
    () => window,
    'http://127.0.0.1:7391',
    engine,
    overrides.platform || 'win32',
    event => diagnostics.push(event),
    overrides.closeTimeoutMs,
    overrides.engineIdleTimeoutMs,
  );
  const event = { sender, senderFrame: frame };
  t.after(dispose);
  return {
    calls,
    diagnostics,
    engine,
    event,
    frame,
    sender,
    start: (request = { id: 1, lang: 'en-US' }, from = event) => handlers.get('zeno:speech:start')(from, request),
    transcribe: (request = { id: 1, audio: wav() }, from = event) => handlers.get('zeno:speech:transcribe')(from, request),
    stop: (id = 1, from = event) => handlers.get('zeno:speech:stop')(from, id),
    abort: (id = 1, from = event) => handlers.get('zeno:speech:abort')(from, id),
    idle: (from = event) => handlers.get('zeno:speech:idle')(from),
  };
}

test('Whisper starts on first use and releases the engine after an idle session', async t => {
  const h = harness(t, { engineIdleTimeoutMs: 5 });
  assert.equal(h.calls.length, 0, 'installing speech does not warm the model');
  assert.equal(await h.start(), true);
  assert.equal(h.calls.filter(call => call[0] === 'ready').length, 1);
  assert.equal(await h.stop(), true);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.calls.filter(call => call[0] === 'engine-stop').length, 1);
});

test('local Whisper text cleaning drops common silence hallucinations and bounds output', () => {
  assert.equal(cleanTranscript('  hello\n world  '), 'hello world');
  assert.equal(cleanTranscript('Zeeno, what is waiting?'), 'Zeno, what is waiting?');
  assert.equal(cleanTranscript('Zeenoth approve it.'), 'Zeno approve it.');
  assert.equal(cleanTranscript('I compared Xeno to another tool.'), 'I compared Xeno to another tool.');
  assert.equal(cleanTranscript('Thank you.'), '');
  assert.equal(cleanTranscript('[BLANK_AUDIO]'), '');
  assert.equal(cleanTranscript('... — ♪ !!!'), '');
  assert.equal(cleanTranscript('१२३'), '१२३', 'Unicode letters or numbers remain real speech');
  assert.equal(cleanTranscript('x'.repeat(20_000)).length, 16_000);
});

test('only a bounded, plain-text optional vocabulary prompt can reserve a session', async t => {
  const h = harness(t);
  assert.equal(await h.start({ id: 1, lang: 'en-US', prompt: 42 }), false);
  assert.equal(await h.start({ id: 1, lang: 'en-US', prompt: 'x'.repeat(MAX_INITIAL_PROMPT_CHARS + 1) }), false);
  assert.equal(await h.start({ id: 1, lang: 'en-US', prompt: 'Zeno\u0000Priya' }), false);
  assert.equal(await h.start({ id: 1, lang: 'en-US', prompt: 'Zeno, Counsel, Priya' }), true);
  assert.deepEqual(await h.transcribe(), { ok: true, text: 'local transcript' });
  const call = h.calls.find(value => value[0] === 'transcribe');
  assert.equal(call[4], 'Zeno, Counsel, Priya');
});

test('only stable local-engine error codes cross the renderer boundary', () => {
  assert.equal(publicErrorCode(Object.assign(new Error('socket details'), { code: 'engine-exited' })), 'engine-exited');
  assert.equal(publicErrorCode(Object.assign(new Error('private timing detail'), { code: 'engine-request-timeout' })), 'engine-request-timeout');
  assert.equal(publicErrorCode(new Error('private runtime detail')), 'engine-request-failed');
});

test('WAV validation accepts RIFF/WAVE bytes and rejects malformed or oversized input', () => {
  assert.equal(wavBuffer(wav()).length, 64);
  assert.equal(wavBuffer(Buffer.from('not audio')), null);
  assert.equal(wavBuffer(wav(1_200_045)), null);
  assert.equal(wavBuffer({ byteLength: 64 }), null);
});

test('only the trusted top-level Windows frame can reserve a speech session', async t => {
  const h = harness(t);
  assert.equal(await h.start(undefined, { sender: new EventEmitter(), senderFrame: h.frame }), false);
  assert.equal(await h.start(undefined, { sender: h.sender, senderFrame: { url: h.frame.url } }), false);
  h.frame.url = 'https://example.invalid/';
  assert.equal(await h.start(), false);
  h.frame.url = 'http://127.0.0.1:7391/';
  assert.equal(await h.start(), true);
  assert.equal(await h.start({ id: 2, lang: 'en-US' }), false);
  assert.equal(h.calls.filter(call => call[0] === 'ready').length, 1);
});

test('invalid requests and an unavailable runtime fail before audio reaches the engine', async t => {
  const unavailable = harness(t, { available: false });
  assert.equal(await unavailable.start(), false);
  const h = harness(t);
  for (const request of [null, {}, { id: 0, lang: 'en-US' }, { id: 1, lang: 'en' }, { id: 1, lang: 'en-US --evil' }]) {
    assert.equal(await h.start(request), false);
  }
  assert.equal(h.calls.length, 0);
});

test('a valid bounded WAV is transcribed once and only safe result fields return', async t => {
  const h = harness(t, { transcribe: async () => '  accurate\n local transcript ' });
  assert.equal(await h.start(), true);
  assert.deepEqual(await h.transcribe(), { ok: true, text: 'accurate local transcript' });
  const call = h.calls.find(value => value[0] === 'transcribe');
  assert.equal(call[1].toString('ascii', 0, 4), 'RIFF');
  assert.equal(call[2], 'en-US');
  assert.equal(call[3] instanceof AbortSignal, true);
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.diagnostics[0].kind, 'transcribed');
  assert.equal(h.diagnostics[0].wavBytes, 64);
  assert.equal(Number.isSafeInteger(h.diagnostics[0].durationMs), true);
});

test('wrong ids, malformed audio and concurrent inference cannot enter the engine', async t => {
  let release;
  const h = harness(t, { transcribe: () => new Promise(resolve => { release = resolve; }) });
  await h.start();
  assert.deepEqual(await h.transcribe({ id: 9, audio: wav() }), { ok: false, error: 'session-closed' });
  assert.deepEqual(await h.transcribe({ id: 1, audio: Buffer.alloc(64) }), { ok: false, error: 'invalid-audio' });
  const first = h.transcribe();
  assert.deepEqual(await h.transcribe(), { ok: false, error: 'busy' });
  release('first');
  assert.deepEqual(await first, { ok: true, text: 'first' });
});

test('navigation aborts inference, suppresses its late result and releases idle waiters', async t => {
  let release;
  const h = harness(t, { transcribe: (_audio, _lang, signal) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve('private late transcript'));
    release = resolve;
  }) });
  await h.start();
  const inference = h.transcribe();
  let idle = false;
  const waiting = h.idle().then(() => { idle = true; });
  h.sender.emit('did-start-navigation');
  await waiting;
  assert.equal(idle, true);
  assert.deepEqual(await inference, { ok: false, error: 'aborted' });
  release('later');
  assert.equal(h.sender.listenerCount('did-start-navigation'), 0);
});

test('the warm engine uses a random loopback route, fixed argv and optional vocabulary multipart', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let spawnCall;
  const fetched = [];
  const engine = createWhisperEngine({
    executable: 'C:\\runtime\\whisper-server.exe',
    model: 'C:\\runtime\\model.bin',
    fileExists: () => true,
    allocatePort: async () => 19876,
    spawnProcess: (file, args, options) => {
      spawnCall = { file, args, options };
      queueMicrotask(() => child.stdout.write('whisper server listening at http://127.0.0.1:19876\n'));
      return child;
    },
    fetchImpl: async (url, options) => {
      fetched.push({ url, options });
      return { ok: true, json: async () => ({ text: ' warm result ' }) };
    },
  });
  assert.equal(await engine.ready(), true);
  const answer = await engine.transcribe(wav(), 'en-IN');
  const prompted = await engine.transcribe(wav(), 'en-IN', undefined, 'Zeno, Counsel, Priya');
  assert.equal(answer, 'warm result');
  assert.equal(prompted, 'warm result');
  assert.equal(spawnCall.options.shell, false);
  assert.equal(spawnCall.options.windowsHide, true);
  assert.deepEqual(spawnCall.args.slice(0, 6), ['--model', 'C:\\runtime\\model.bin', '--host', '127.0.0.1', '--port', '19876']);
  assert.equal(spawnCall.args[spawnCall.args.indexOf('--best-of') + 1], '1');
  assert.equal(
    spawnCall.args.includes('--prompt'),
    false,
    'an initial prompt can both hallucinate commands in silence and erase a softly spoken leading wake word',
  );
  assert.match(fetched[0].url, /^http:\/\/127\.0\.0\.1:19876\/z-[a-f0-9]{48}\/inference$/);
  assert.equal(fetched[0].options.method, 'POST');
  assert.equal(fetched[0].options.body instanceof FormData, true);
  assert.equal(fetched[0].options.body.get('prompt'), null, 'Command/wake use no decoder prompt by default');
  assert.equal(fetched[0].options.body.get('carry_initial_prompt'), null);
  assert.equal(fetched[1].options.body.get('prompt'), 'Zeno, Counsel, Priya');
  assert.equal(fetched[1].options.body.get('carry_initial_prompt'), 'true');
  await engine.stop();
});

test('a stalled Whisper request reaches a stable deadline and aborts its loopback fetch', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let requestSignal;
  const engine = createWhisperEngine({
    executable: 'C:\\runtime\\whisper-server.exe',
    model: 'C:\\runtime\\model.bin',
    fileExists: () => true,
    allocatePort: async () => 19877,
    inferenceTimeoutMs: 5,
    spawnProcess: () => {
      queueMicrotask(() => child.stdout.write('whisper server listening at http://127.0.0.1:19877\n'));
      return child;
    },
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    engine.transcribe(wav()),
    error => error && error.code === 'engine-request-timeout',
  );
  assert.equal(requestSignal.aborted, true);
  await engine.stop();
});

test('closing a session is bounded even when an injected engine ignores cancellation', async t => {
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const h = harness(t, {
    closeTimeoutMs: 5,
    transcribe: () => {
      entered();
      return new Promise(() => {});
    },
  });
  assert.equal(await h.start(), true);
  void h.transcribe();
  await began;
  assert.equal(await h.abort(), true);
  assert.ok(h.diagnostics.some(event => event.kind === 'drain-timeout'));
  assert.ok(h.calls.some(call => call[0] === 'engine-stop'), 'the wedged warm engine is discarded');
  assert.equal(await h.start({ id: 2, lang: 'en-US' }), true, 'a later microphone session is no longer held busy');
});
