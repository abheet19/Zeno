const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(overrides = {}) {
  const calls = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks };
  const contexts = [];
  class Node {
    connect() { return this; }
    disconnect() {}
  }
  class AudioContext {
    constructor(options) {
      this.sampleRate = options.sampleRate;
      this.state = 'running';
      this.destination = new Node();
      this.source = new Node();
      this.processor = new Node();
      this.processor.onaudioprocess = null;
      this.mute = new Node();
      this.mute.gain = { value: 1 };
      contexts.push(this);
    }
    createMediaStreamSource() { return this.source; }
    createScriptProcessor() { return this.processor; }
    createGain() { return this.mute; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  const bridge = {
    start: async (id, lang, prompt) => { calls.push(['start', id, lang, prompt]); return overrides.start ?? true; },
    transcribe: async (id, bytes) => {
      calls.push(['transcribe', id, bytes]);
      return overrides.transcribe ? overrides.transcribe(id, bytes) : { ok: true, text: 'accurate local transcript' };
    },
    stop: async id => { calls.push(['stop', id]); return true; },
    abort: async id => { calls.push(['abort', id]); return true; },
    idle: async () => true,
  };
  const window = { zenoLocalSpeech: bridge, AudioContext };
  const navigator = {
    mediaDevices: {
      getUserMedia: overrides.getUserMedia || (async () => stream),
    },
  };
  const context = vm.createContext({
    window,
    navigator,
    DOMException,
    queueMicrotask,
    console,
    DataView,
    ArrayBuffer,
    Uint8Array,
    Float32Array,
    Math,
  });
  const source = fs.readFileSync(path.join(__dirname, '../../daemon/public/whisper.js'), 'utf8')
    .replace(/^export /gm, '');
  vm.runInContext(source + '\nthis.exports={SpeechRecognition,localSpeech,waitForSpeechIdle,encodePcm16Wav};', context);
  return { ...context.exports, bridge, calls, contexts, stream, tracks };
}

async function settle(turns = 8) {
  for (let i = 0; i < turns; i += 1) await new Promise(resolve => setImmediate(resolve));
}

function frame(value, length = 1024) {
  const samples = new Float32Array(length);
  samples.fill(value);
  return { inputBuffer: { getChannelData: () => samples } };
}

function quietSpeechFrame(length = 1024) {
  const samples = new Float32Array(length);
  // A quiet waveform can have enough peak energy for speech while its RMS stays
  // below the previous 0.009 voice-activity floor.
  for (let i = 0; i < samples.length; i += 2) samples[i] = 0.0092;
  return { inputBuffer: { getChannelData: () => samples } };
}

test('PCM encoder emits a bounded 16 kHz mono RIFF/WAVE payload', () => {
  const h = load();
  const result = h.encodePcm16Wav([new Float32Array(1600).fill(0.25)], 16_000);
  const view = new DataView(result.bytes.buffer);
  assert.equal(Buffer.from(result.bytes.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(Buffer.from(result.bytes.subarray(8, 12)).toString('ascii'), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(result.bytes.length, 3_244);
});

test('push-to-talk captures in memory, transcribes after release and closes hardware', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  const results = [];
  let ended = false;
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.onend = () => { ended = true; };
  recognition.start();
  await settle();
  assert.deepEqual(h.calls.find(call => call[0] === 'start').slice(2), ['en-US', ''], 'Command/PTT keeps the decoder prompt empty');
  const processor = h.contexts[0].processor;
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(frame(0.08));
  recognition.stop();
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  const upload = h.calls.find(call => call[0] === 'transcribe');
  assert.equal(Buffer.from(upload[2].subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(h.tracks[0].stopped, true);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(ended, true);
});

test('a Counsel vocabulary prompt is bounded and forwarded only for that recognizer', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.initialPrompt = `Zeno, Counsel, Priya, ${'x'.repeat(700)}`;
  recognition.start();
  await settle();
  const start = h.calls.find(call => call[0] === 'start');
  assert.equal(start[3].startsWith('Zeno, Counsel, Priya'), true);
  assert.equal(start[3].length, 512);
  recognition.abort();
  await settle();
});

test('continuous mode waits for speech, keeps pre-roll and flushes after a pause', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  const results = [];
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  for (let i = 0; i < 5; i += 1) processor.onaudioprocess(frame(0.001));
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(frame(0.08));
  for (let i = 0; i < 12; i += 1) processor.onaudioprocess(frame(0.001));
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  assert.equal(h.calls.filter(call => call[0] === 'transcribe').length, 1);
  recognition.abort();
  await settle();
});

test('continuous mode does not learn an immediate utterance as room noise', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  const results = [];
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  // Speech begins inside the 300 ms calibration window. The quieter syllable
  // edges establish the floor; the stronger frames must remain detectable and
  // the retained pre-roll must reach Whisper with the first command intact.
  for (let i = 0; i < 8; i += 1) {
    processor.onaudioprocess(frame(i % 3 === 0 ? 0.02 : 0.06));
  }
  for (let i = 0; i < 6; i += 1) processor.onaudioprocess(frame(0.06));
  for (let i = 0; i < 14; i += 1) processor.onaudioprocess(frame(0.0015));
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  assert.equal(h.calls.filter(call => call[0] === 'transcribe').length, 1);
  recognition.abort();
  await settle();
});

test('continuous mode admits quiet speech above the measured room-noise floor', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  const results = [];
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  // Wake mode normally has time to measure the room before a command. These
  // frames represent roughly five seconds of ambient audio at 16 kHz.
  for (let i = 0; i < 80; i += 1) processor.onaudioprocess(frame(0.0015));
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(quietSpeechFrame());
  for (let i = 0; i < 18; i += 1) processor.onaudioprocess(frame(0.0015));
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  assert.equal(h.calls.filter(call => call[0] === 'transcribe').length, 1);
  recognition.abort();
  await settle();
});

test('continuous mode calibrates above noisy ambient spikes and still closes the utterance', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  const results = [];
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  // Mirrors the observed noisy room envelope: a 0.012 RMS baseline with
  // isolated 0.034 RMS spikes, both above the previous cold-start threshold.
  // Ambient input must not become one endless utterance.
  for (let i = 0; i < 40; i += 1) {
    processor.onaudioprocess(frame(i % 8 === 0 ? 0.034 : 0.012));
  }
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(frame(0.065));
  for (let i = 0; i < 24; i += 1) {
    processor.onaudioprocess(frame(i % 8 === 0 ? 0.034 : 0.012));
  }
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  assert.equal(h.calls.filter(call => call[0] === 'transcribe').length, 1);
  recognition.abort();
  await settle();
});

test('continuous mode silence hangover survives an isolated loud spike', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  const results = [];
  recognition.onresult = event => results.push(event.results[event.resultIndex][0].transcript);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(frame(0.0015));
  for (let i = 0; i < 8; i += 1) processor.onaudioprocess(frame(0.08));
  for (let i = 0; i < 6; i += 1) processor.onaudioprocess(frame(0.0015));
  processor.onaudioprocess(frame(0.08));
  for (let i = 0; i < 6; i += 1) processor.onaudioprocess(frame(0.0015));
  await settle(16);
  assert.deepEqual(results, ['accurate local transcript']);
  assert.equal(h.calls.filter(call => call[0] === 'transcribe').length, 1);
  recognition.abort();
  await settle();
});

test('continuous mode binds segment metadata when speech starts, before transcription finishes', async () => {
  const h = load();
  const recognition = new h.SpeechRecognition();
  recognition.continuous = true;
  let selectedSpeaker = 'owner';
  const speakers = [];
  recognition.onsegmentstart = () => selectedSpeaker;
  recognition.onresult = event => speakers.push(event.segmentMeta);
  recognition.start();
  await settle();
  const processor = h.contexts[0].processor;
  for (let i = 0; i < 5; i += 1) processor.onaudioprocess(frame(0.001));
  for (let i = 0; i < 3; i += 1) processor.onaudioprocess(frame(0.08));
  selectedSpeaker = 'other';
  for (let i = 0; i < 5; i += 1) processor.onaudioprocess(frame(0.08));
  for (let i = 0; i < 12; i += 1) processor.onaudioprocess(frame(0.001));
  await settle(16);
  assert.deepEqual(speakers, ['owner'], 'a later speaker-button click cannot relabel queued audio');
  recognition.abort();
  await settle();
});

test('abort drops captured audio and ignores any later inference result', async () => {
  let release;
  const h = load({ transcribe: () => new Promise(resolve => { release = resolve; }) });
  const recognition = new h.SpeechRecognition();
  let results = 0;
  recognition.onresult = () => { results += 1; };
  recognition.start();
  await settle();
  for (let i = 0; i < 8; i += 1) h.contexts[0].processor.onaudioprocess(frame(0.08));
  recognition.stop();
  await settle();
  recognition.abort();
  release({ ok: true, text: 'late private words' });
  await settle(12);
  assert.equal(results, 0);
  assert.equal(h.calls.filter(call => call[0] === 'abort').length, 1);
});

test('a refused native reservation reports an error and ends without opening the mic', async () => {
  const h = load({ start: false });
  const recognition = new h.SpeechRecognition();
  const errors = [];
  let ended = false;
  recognition.onerror = event => errors.push(event.error);
  recognition.onend = () => { ended = true; };
  recognition.start();
  await settle();
  assert.deepEqual(errors, ['audio-capture']);
  assert.equal(ended, true);
  assert.equal(h.contexts.length, 0);
});

test('a microphone permission denial is reported as not-allowed', async () => {
  const h = load({
    getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
  });
  const recognition = new h.SpeechRecognition();
  const errors = [];
  let ended = false;
  recognition.onerror = event => errors.push(event.error);
  recognition.onend = () => { ended = true; };
  recognition.start();
  await settle();
  assert.deepEqual(errors, ['not-allowed']);
  assert.equal(ended, true);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'abort').length, 1, 'the reserved native session is released');
});
