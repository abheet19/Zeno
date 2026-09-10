// Browser capture for the native desktop's local Whisper service. Audio remains
// in memory, crosses the context-isolated preload as bounded PCM16 WAV bytes,
// and is transcribed by the loopback-only engine owned by Electron's main process.
const bridge = window.zenoLocalSpeech;
const TARGET_RATE = 16_000;
const FRAME_SIZE = 512;
const MIN_UTTERANCE_SECONDS = 0.18;
const MAX_UTTERANCE_SECONDS = 18;
const SILENCE_SECONDS = 0.55;
const PRE_ROLL_SECONDS = 0.36;
const CALIBRATION_SECONDS = 0.3;
const ONSET_FRAMES = 3;
const MAX_INITIAL_PROMPT_CHARS = 512;
let sequence = 0;

export const localSpeech = Boolean(bridge);

export async function waitForSpeechIdle() {
  if (!bridge || typeof bridge.idle !== 'function') return;
  try { await bridge.idle(); } catch { /* closing the window already releases capture */ }
}

function flatten(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function resample(samples, sourceRate, targetRate = TARGET_RATE) {
  if (sourceRate === targetRate) return samples;
  const length = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < length; i += 1) {
    const at = i * ratio;
    const left = Math.floor(at);
    const right = Math.min(samples.length - 1, left + 1);
    const mix = at - left;
    output[i] = samples[left] * (1 - mix) + samples[right] * mix;
  }
  return output;
}

export function encodePcm16Wav(chunks, sourceRate) {
  const samples = resample(flatten(chunks), sourceRate);
  const wav = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(wav);
  const word = (offset, value) => view.setUint16(offset, value, true);
  const dword = (offset, value) => view.setUint32(offset, value, true);
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  dword(4, wav.byteLength - 8);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dword(16, 16);
  word(20, 1);
  word(22, 1);
  dword(24, TARGET_RATE);
  dword(28, TARGET_RATE * 2);
  word(32, 2);
  word(34, 16);
  ascii(36, 'data');
  dword(40, samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return { bytes: new Uint8Array(wav), samples };
}

function level(samples) {
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(energy / Math.max(1, samples.length)), peak };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function clampNoiseFloor(value) {
  return Math.max(0.001, Math.min(0.04, value));
}

function onsetThreshold(noiseFloor) {
  // A fixed multiplier from a cold 0.003 floor treats a fan or open speaker as
  // speech forever. Calibrate first, then require a small absolute and relative
  // rise so quiet speech in a quiet room and normal speech in a noisy room both
  // remain detectable.
  return Math.max(0.006, Math.min(0.065, noiseFloor * 1.65 + 0.002));
}

function releaseThreshold(noiseFloor) {
  // Release is intentionally closer to the ambient floor than onset. This
  // hysteresis lets normal room noise count as silence after speech starts.
  return Math.max(0.0045, Math.min(0.055, noiseFloor * 1.35 + 0.001));
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

class WhisperRecognition {
  constructor() {
    this.lang = 'en-US';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    // Optional vocabulary bias for one capture. Counsel supplies meeting names
    // and Zeno product terms; Command and wake leave this empty by default.
    this.initialPrompt = '';
    this.active = false;
    this.id = 0;
    this.results = [];
    this.context = null;
    this.source = null;
    this.processor = null;
    this.mute = null;
    this.stream = null;
    this.sampleRate = TARGET_RATE;
    this.chunks = [];
    this.preRoll = [];
    this.segment = [];
    this.segmentSamples = 0;
    this.silenceSamples = 0;
    this.aboveFrames = 0;
    this.speaking = false;
    this.segmentMeta = undefined;
    this.noiseFloor = 0.003;
    this.calibrated = false;
    this.calibrationLevels = [];
    this.calibrationSamples = 0;
    this.queue = Promise.resolve();
    this.queuedSegments = 0;
    this.stopping = false;
    this.aborted = false;
  }

  start() {
    if (this.active) throw new DOMException('Recognition has already started', 'InvalidStateError');
    this.active = true;
    this.stopping = false;
    this.aborted = false;
    this.id = ++sequence;
    this.results = [];
    this.chunks = [];
    this.resetSegment();
    this.resetVad();
    void this.open(this.id);
  }

  async open(id) {
    let reserved = false;
    let stream = null;
    try {
      const prompt = typeof this.initialPrompt === 'string'
        ? this.initialPrompt.trim().slice(0, MAX_INITIAL_PROMPT_CHARS)
        : '';
      reserved = await bridge.start(id, this.lang || 'en-US', prompt);
      if (!reserved || !this.active || this.id !== id || this.stopping) throw new Error('capture-unavailable');
      stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.active || this.id !== id || this.stopping) {
        stopStream(stream);
        await bridge.abort(id);
        return;
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('capture-unavailable');
      this.stream = stream;
      const context = new AudioContext({ latencyHint: 'interactive', sampleRate: TARGET_RATE });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.onaudioprocess = event => this.capture(event.inputBuffer.getChannelData(0));
      source.connect(processor);
      processor.connect(mute);
      mute.connect(context.destination);
      this.context = context;
      this.source = source;
      this.processor = processor;
      this.mute = mute;
      this.sampleRate = context.sampleRate;
      if (context.state === 'suspended') await context.resume();
      if (!this.active || this.id !== id || this.stopping) {
        await this.releaseHardware();
        await bridge.abort(id);
        return;
      }
      this.onstart?.({});
    } catch (error) {
      stopStream(stream);
      await this.releaseHardware();
      if (reserved) await bridge.abort(id).catch(() => false);
      if (this.active && this.id === id) {
        const denied = error && typeof error === 'object' &&
          (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        this.onerror?.({ error: denied ? 'not-allowed' : 'audio-capture' });
        this.finish();
      }
    }
  }

  capture(input) {
    if (!this.active || this.stopping) return;
    const chunk = new Float32Array(input);
    if (!this.continuous) {
      if (this.chunks.length === 0) this.segmentMeta = this.onsegmentstart?.();
      this.chunks.push(chunk);
      return;
    }
    this.captureContinuous(chunk);
  }

  captureContinuous(chunk) {
    const meter = level(chunk);
    if (!this.speaking) {
      this.preRoll.push(chunk);
      const maxPreRoll = Math.ceil(PRE_ROLL_SECONDS * this.sampleRate / chunk.length);
      while (this.preRoll.length > maxPreRoll) this.preRoll.shift();

      // Measure a short slice of the actual room before opening the gate. These
      // samples stay in pre-roll so audio just before detected onset is retained.
      // A percentile resists both isolated clicks and very quiet frames.
      if (!this.calibrated) {
        this.calibrationLevels.push(meter.rms);
        this.calibrationSamples += chunk.length;
        if (this.calibrationSamples < CALIBRATION_SECONDS * this.sampleRate) return;
        // Use the quiet side of the opening window as the room floor. If the
        // owner speaks as soon as the visible listening state appears, the
        // upper quartiles contain their voice; treating those as ambient makes
        // the first command raise its own threshold and disappear. A lower
        // quartile still tracks sustained fan/room noise while leaving speech
        // in the pre-roll available to cross the onset gate.
        this.noiseFloor = clampNoiseFloor(percentile(this.calibrationLevels, 0.25));
        this.calibrated = true;
      }

      const threshold = onsetThreshold(this.noiseFloor);
      if (meter.rms < threshold) {
        // Track slow room changes without allowing a voice burst to teach the
        // detector that speech is the new ambient floor.
        this.noiseFloor = clampNoiseFloor(this.noiseFloor * 0.975 + meter.rms * 0.025);
      }
      this.aboveFrames = meter.rms >= threshold
        ? this.aboveFrames + 1
        : Math.max(0, this.aboveFrames - 1);
      if (this.aboveFrames < ONSET_FRAMES) return;
      this.speaking = true;
      // Capture caller metadata at voice onset. In Counsel this is the selected
      // speaker label; keeping it beside the PCM prevents a later UI click from
      // relabelling audio while local Whisper is still transcribing it.
      this.segmentMeta = this.onsegmentstart?.();
      this.segment = this.preRoll.splice(0);
      this.segmentSamples = this.segment.reduce((sum, value) => sum + value.length, 0);
      this.silenceSamples = 0;
      return;
    }
    this.segment.push(chunk);
    this.segmentSamples += chunk.length;
    // Accumulate a silence confidence rather than demanding 0.55 seconds of
    // perfectly consecutive quiet. A fan spike leaks a little confidence but
    // cannot reset the whole hangover; sustained speech drains it quickly.
    this.silenceSamples = meter.rms < releaseThreshold(this.noiseFloor)
      ? this.silenceSamples + chunk.length
      : Math.max(0, this.silenceSamples - chunk.length * 1.5);
    if (this.silenceSamples >= SILENCE_SECONDS * this.sampleRate || this.segmentSamples >= MAX_UTTERANCE_SECONDS * this.sampleRate) {
      this.flushSegment();
    }
  }

  resetSegment() {
    this.preRoll = [];
    this.segment = [];
    this.segmentSamples = 0;
    this.silenceSamples = 0;
    this.aboveFrames = 0;
    this.speaking = false;
    this.segmentMeta = undefined;
  }

  resetVad() {
    this.noiseFloor = 0.003;
    this.calibrated = false;
    this.calibrationLevels = [];
    this.calibrationSamples = 0;
  }

  flushSegment() {
    const chunks = this.segment;
    const segmentMeta = this.segmentMeta;
    this.resetSegment();
    if (chunks.length) this.enqueue(chunks, segmentMeta);
  }

  enqueue(chunks, segmentMeta) {
    const sourceRate = this.sampleRate;
    const id = this.id;
    const prepared = encodePcm16Wav(chunks, sourceRate);
    const meter = level(prepared.samples);
    if (prepared.samples.length < MIN_UTTERANCE_SECONDS * TARGET_RATE || meter.peak < 0.008 || meter.rms < 0.0025) return;
    // The main process also serializes inference. Keeping at most three pending
    // utterances here prevents a noisy room from turning latency into memory use.
    if (this.queuedSegments >= 3) {
      this.onerror?.({ error: 'audio-capture' });
      return;
    }
    this.queuedSegments += 1;
    this.queue = this.queue.then(async () => {
      if (!this.active || this.id !== id || this.aborted) return;
      const answer = await bridge.transcribe(id, prepared.bytes);
      if (!this.active || this.id !== id || this.aborted) return;
      if (!answer?.ok) {
        if (answer?.error !== 'aborted') this.onerror?.({ error: answer?.error || 'audio-capture' });
        return;
      }
      const text = String(answer.text || '').trim();
      if (!text) return;
      const result = [{ transcript: text, confidence: 0 }];
      result.isFinal = true;
      const index = this.results.length;
      this.results.push(result);
      this.onresult?.({ resultIndex: index, results: this.results.slice(), segmentMeta });
    }).catch(() => {
      if (this.active && this.id === id && !this.aborted) this.onerror?.({ error: 'audio-capture' });
    }).finally(() => {
      this.queuedSegments = Math.max(0, this.queuedSegments - 1);
    });
  }

  stop() {
    if (!this.active || this.stopping) return;
    this.stopping = true;
    void this.complete();
  }

  async complete() {
    if (this.continuous) {
      if (this.speaking && this.segment.length) this.enqueue(this.segment, this.segmentMeta);
    } else if (this.chunks.length) {
      this.enqueue(this.chunks, this.segmentMeta);
    }
    await this.releaseHardware();
    await this.queue;
    if (!this.aborted) await bridge.stop(this.id).catch(() => false);
    this.finish();
  }

  abort() {
    if (!this.active) return;
    this.aborted = true;
    this.stopping = true;
    this.chunks = [];
    this.resetSegment();
    void this.releaseHardware();
    void bridge.abort(this.id).catch(() => false);
    this.finish();
  }

  async releaseHardware() {
    if (this.processor) this.processor.onaudioprocess = null;
    try { this.source?.disconnect(); } catch {}
    try { this.processor?.disconnect(); } catch {}
    try { this.mute?.disconnect(); } catch {}
    stopStream(this.stream);
    const context = this.context;
    this.source = null;
    this.processor = null;
    this.mute = null;
    this.stream = null;
    this.context = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
  }

  clearResults() {
    this.results = [];
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.stopping = false;
    this.chunks = [];
    this.resetSegment();
    queueMicrotask(() => this.onend?.({}));
  }
}

export const SpeechRecognition = localSpeech
  ? WhisperRecognition
  : window.SpeechRecognition || window.webkitSpeechRecognition || null;
