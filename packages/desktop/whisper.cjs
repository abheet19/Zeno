'use strict';

const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const { createConnection, createServer } = require('node:net');
const { availableParallelism } = require('node:os');
const { dirname, join } = require('node:path');

const MAX_WAV_BYTES = 1_200_044; // 37.5 s of 16 kHz mono PCM16, including header.
const MAX_TRANSCRIPT_CHARS = 16_000;
const MAX_INITIAL_PROMPT_CHARS = 512;
const INFERENCE_TIMEOUT_MS = 45_000;
const CLOSE_TIMEOUT_MS = 50_000;
function engineError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function publicErrorCode(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  return [
    'aborted',
    'engine-exited',
    'engine-request-failed',
    'engine-request-timeout',
    'engine-rejected',
    'engine-response-invalid',
    'engine-start-failed',
    'engine-start-timeout',
    'runtime-unavailable',
  ].includes(code) ? code : 'engine-request-failed';
}

function resolveWhisperRuntime(localAppData = process.env.LOCALAPPDATA || '', env = process.env) {
  const root = join(localAppData, 'Zeno', 'speech', 'v1.9.2');
  const executable = (env.ZENO_WHISPER_SERVER || '').trim();
  const model = (env.ZENO_WHISPER_MODEL || '').trim() || join(root, 'ggml-large-v3-turbo-q5_0.bin');
  const candidates = executable ? [executable] : [
    join(root, 'gpu-12.4', 'Release', 'whisper-server.exe'),
    join(root, 'gpu', 'Release', 'whisper-server.exe'),
    join(root, 'cpu', 'Release', 'whisper-server.exe'),
  ];
  return { executable: candidates.find(existsSync) || candidates[0], model };
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.unref();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForLoopbackListener(process, port, inspect) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;
    let timer = null;
    const timeout = setTimeout(() => finish(engineError('engine-start-timeout', 'Local Whisper did not become ready in time.')), 60_000);
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timer) clearTimeout(timer);
      if (socket) socket.destroy();
      error ? reject(error) : resolve();
    };
    const probe = () => {
      if (settled) return;
      socket = createConnection({ host: '127.0.0.1', port });
      socket.unref();
      socket.setTimeout(250);
      socket.once('connect', () => finish());
      const retry = () => {
        if (socket) socket.destroy();
        if (!settled) timer = setTimeout(probe, 100);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    const output = chunk => {
      inspect(chunk);
      if (String(chunk).includes(`whisper server listening at http://127.0.0.1:${port}`)) finish();
    };
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', output);
    process.stderr.on('data', output);
    process.once('error', () => finish(engineError('engine-start-failed', 'Local Whisper could not start.')));
    process.once('exit', code => finish(engineError('engine-exited', `Local Whisper exited before it was ready (${Number.isInteger(code) ? code : 'unknown'}).`)));
    probe();
  });
}

function cleanTranscript(value) {
  const text = String(value || '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Punctuation-only decoder noise ("...", "♪", em dashes) is not speech.
  // Unicode properties keep real words and numbers in every supported language.
  if (!text || !/[\p{L}\p{N}]/u.test(text) || /^\[(?:blank_audio|silence|music)\]$/i.test(text)) return '';
  if (/^(?:thank you|thanks for watching)[.!]?$/i.test(text)) return '';
  // Whisper can spell the product name phonetically even when it understood the
  // rest perfectly. Canonicalise only the leading wake token; mid-sentence words
  // remain untouched, so this cannot turn an incidental mention into a wake.
  return text
    .replace(/^(?:zeeno|zeenoth|xeno|zino|zenno|znote|zee[ -]?(?:no|know|noh))\b/i, 'Zeno')
    .slice(0, MAX_TRANSCRIPT_CHARS);
}

function createWhisperEngine({
  executable,
  model,
  spawnProcess = spawn,
  fetchImpl = globalThis.fetch,
  allocatePort = reserveLoopbackPort,
  threads = Math.min(8, availableParallelism()),
  fileExists = existsSync,
  inferenceTimeoutMs = INFERENCE_TIMEOUT_MS,
} = {}) {
  let child = null;
  let endpoint = '';
  let readyPromise = null;
  let lastExitCode = null;

  const available = () => Boolean(executable && model && fileExists(executable) && fileExists(model));

  function ready() {
    if (!available()) return Promise.reject(engineError('runtime-unavailable', 'Local Whisper runtime is not installed.'));
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const port = await allocatePort();
      const route = `/z-${randomBytes(24).toString('hex')}`;
      const args = [
        '--model', model,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--request-path', route,
        '--threads', String(threads),
        '--language', 'en',
        '--best-of', '1',
        '--no-fallback',
        '--suppress-nst',
        '--no-speech-thold', '0.65',
        '--no-timestamps',
      ];
      const process = spawnProcess(executable, args, {
        cwd: dirname(executable),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child = process;
      lastExitCode = null;
      let diagnostics = '';
      await waitForLoopbackListener(process, port, chunk => {
        diagnostics = (diagnostics + String(chunk)).slice(-32_000);
      });
      endpoint = `http://127.0.0.1:${port}${route}/inference`;
      process.once('exit', code => {
        lastExitCode = Number.isInteger(code) ? code : null;
        if (child === process) {
          child = null;
          endpoint = '';
          readyPromise = null;
        }
      });
      return true;
    })().catch(error => {
      if (child) { try { child.kill(); } catch {} }
      child = null;
      endpoint = '';
      readyPromise = null;
      throw error;
    });
    return readyPromise;
  }

  async function transcribe(wav, lang = 'en-US', signal, initialPrompt = '') {
    await ready();
    const requestEndpoint = endpoint;
    if (!child || !requestEndpoint) {
      throw engineError('engine-exited', 'Local Whisper stopped before transcription began.');
    }
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('temperature', '0');
    form.append('temperature_inc', '0');
    form.append('response_format', 'json');
    form.append('language', String(lang).toLowerCase().startsWith('en') ? 'en' : 'auto');
    const prompt = typeof initialPrompt === 'string' ? initialPrompt.trim().slice(0, MAX_INITIAL_PROMPT_CHARS) : '';
    if (prompt) {
      // Whisper's initial prompt is vocabulary context, not an instruction. It
      // is opt-in per recording. Wake listening deliberately keeps the neutral
      // decoder that avoids hallucinating a wake phrase into silence; explicit
      // push-to-talk, Ask and Counsel captures may use bounded vocabulary hints.
      form.append('prompt', prompt);
      form.append('carry_initial_prompt', 'true');
    }
    if (signal?.aborted) throw engineError('aborted', 'Local Whisper transcription was cancelled.');
    const request = new AbortController();
    let rejectDeadline;
    let timedOut = false;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const onAbort = () => {
      request.abort();
      rejectDeadline(engineError('aborted', 'Local Whisper transcription was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      request.abort();
      rejectDeadline(engineError('engine-request-timeout', 'Local Whisper did not finish this audio segment in time.'));
    }, inferenceTimeoutMs);
    // Keep the deadline referenced: a wedged loopback request must still settle even
    // when no other Node handle happens to be alive.
    let response;
    try {
      response = await Promise.race([
        fetchImpl(requestEndpoint, { method: 'POST', body: form, signal: request.signal }),
        deadline,
      ]);
      if (!response.ok) throw engineError('engine-rejected', 'Local Whisper rejected the audio segment.');
      let result;
      try { result = await Promise.race([response.json(), deadline]); }
      catch (error) {
        if (error && typeof error.code === 'string') throw error;
        throw engineError('engine-response-invalid', 'Local Whisper returned an invalid response.');
      }
      return cleanTranscript(result && result.text);
    } catch (error) {
      if (signal?.aborted || error?.code === 'aborted') throw engineError('aborted', 'Local Whisper transcription was cancelled.');
      if (timedOut || error?.code === 'engine-request-timeout') {
        throw engineError('engine-request-timeout', 'Local Whisper did not finish this audio segment in time.');
      }
      // An AbortError that did not come from the caller or our deadline is an
      // engine/transport failure. Calling it a user cancellation would hide a
      // broken loopback request from diagnostics.
      if (error?.name === 'AbortError') throw engineError('engine-request-failed', 'Local Whisper could not process this audio segment.');
      if (error?.code === 'engine-rejected' || error?.code === 'engine-response-invalid') throw error;
      if (!child || !endpoint) throw engineError('engine-exited', 'Local Whisper stopped during transcription.');
      throw engineError('engine-request-failed', 'Local Whisper could not process this audio segment.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function stop() {
    const process = child;
    child = null;
    endpoint = '';
    readyPromise = null;
    if (!process) return;
    try { process.kill(); } catch {}
  }

  return {
    available,
    ready,
    transcribe,
    stop,
    status: () => ({ running: Boolean(child && endpoint), lastExitCode }),
  };
}

function wavBuffer(value) {
  let bytes;
  if (Buffer.isBuffer(value)) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = Buffer.from(value);
  else if (ArrayBuffer.isView(value)) bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  else return null;
  if (bytes.length < 44 || bytes.length > MAX_WAV_BYTES) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
  return bytes;
}

/** One renderer-owned microphone session and one bounded local inference queue. */
function installWhisperSpeech(
  ipcMain,
  getWindow,
  origin,
  engine,
  platform = process.platform,
  diagnostic = () => {},
  closeTimeoutMs = CLOSE_TIMEOUT_MS,
) {
  let active = null;

  function trusted(event) {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
    try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
  }

  function finish(session) {
    if (session.ended) return;
    session.ended = true;
    session.sender.removeListener('did-start-navigation', session.onGone);
    session.sender.removeListener('render-process-gone', session.onGone);
    session.sender.removeListener('destroyed', session.onGone);
    if (active === session) active = null;
    session.resolveClosed();
  }

  async function close(session, abort) {
    if (!session || session.ended) return true;
    session.closing = true;
    session.valid = false;
    if (abort) for (const controller of session.controllers) controller.abort();
    const pending = Promise.allSettled([...session.pending]);
    if (session.pending.size > 0) {
      let timer;
      const drained = await Promise.race([
        pending.then(() => true),
        new Promise(resolve => {
          timer = setTimeout(() => resolve(false), abort ? Math.min(1_000, closeTimeoutMs) : closeTimeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!drained) {
        for (const controller of session.controllers) controller.abort();
        diagnostic({ kind: 'drain-timeout', pending: session.pending.size });
        // A server that ignored the cancelled request must not keep the next
        // microphone session busy. Killing the warm process is safe: ready()
        // starts a fresh one on the next capture.
        await engine.stop();
      }
    }
    finish(session);
    return true;
  }

  ipcMain.handle('zeno:speech:start', async (event, request) => {
    if (!trusted(event) || platform !== 'win32' || !engine || !engine.available()) return false;
    if (
      !request ||
      !Number.isSafeInteger(request.id) ||
      request.id < 1 ||
      typeof request.lang !== 'string' ||
      !/^[a-z]{2,3}-[A-Z]{2}$/.test(request.lang) ||
      (request.prompt !== undefined && (typeof request.prompt !== 'string' || request.prompt.length > MAX_INITIAL_PROMPT_CHARS || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(request.prompt)))
    ) return false;
    if (active) return false;
    const session = {
      id: request.id,
      lang: request.lang,
      prompt: typeof request.prompt === 'string' ? request.prompt.trim() : '',
      sender: event.sender,
      valid: true,
      closing: false,
      ended: false,
      pending: new Set(),
      controllers: new Set(),
    };
    session.closed = new Promise(resolve => { session.resolveClosed = resolve; });
    session.onGone = () => { void close(session, true); };
    session.sender.on('did-start-navigation', session.onGone);
    session.sender.on('render-process-gone', session.onGone);
    session.sender.on('destroyed', session.onGone);
    active = session;
    try {
      const cold = typeof engine.status === 'function' ? !engine.status().running : false;
      const readyStartedAt = Date.now();
      await engine.ready();
      if (cold) diagnostic({ kind: 'ready', durationMs: Date.now() - readyStartedAt });
      if (active !== session || session.closing || !trusted(event)) { await close(session, true); return false; }
      return true;
    } catch (error) {
      diagnostic({ kind: 'startup-error', code: publicErrorCode(error) });
      await close(session, true);
      return false;
    }
  });

  ipcMain.handle('zeno:speech:transcribe', async (event, request) => {
    if (!trusted(event) || !request || !Number.isSafeInteger(request.id)) return { ok: false, error: 'invalid-request' };
    const session = active;
    const wav = wavBuffer(request.audio);
    if (!session || session.id !== request.id || session.closing || !session.valid) return { ok: false, error: 'session-closed' };
    if (!wav) return { ok: false, error: 'invalid-audio' };
    if (session.pending.size > 0) return { ok: false, error: 'busy' };
    const controller = new AbortController();
    session.controllers.add(controller);
    const work = engine.transcribe(wav, session.lang, controller.signal, session.prompt);
    session.pending.add(work);
    const transcribeStartedAt = Date.now();
    try {
      const text = await work;
      diagnostic({ kind: 'transcribed', durationMs: Date.now() - transcribeStartedAt, wavBytes: wav.length });
      if (!session.valid || session.closing || active !== session || !trusted(event)) return { ok: false, error: 'aborted' };
      return { ok: true, text: cleanTranscript(text) };
    } catch (error) {
      const code = controller.signal.aborted ? 'aborted' : publicErrorCode(error);
      if (code !== 'aborted') {
        const state = typeof engine.status === 'function' ? engine.status() : { running: null, lastExitCode: null };
        diagnostic({
          kind: 'transcription-error',
          code,
          wavBytes: wav.length,
          engineRunning: state.running,
          engineExitCode: state.lastExitCode,
        });
      }
      return { ok: false, error: code };
    } finally {
      session.pending.delete(work);
      session.controllers.delete(controller);
    }
  });

  ipcMain.handle('zeno:speech:stop', async (event, id) => {
    if (!trusted(event) || active?.id !== id) return false;
    return close(active, false);
  });
  ipcMain.handle('zeno:speech:abort', async (event, id) => {
    if (!trusted(event) || active?.id !== id) return false;
    return close(active, true);
  });
  ipcMain.handle('zeno:speech:idle', async event => {
    if (!trusted(event)) return false;
    if (active) await active.closed;
    return true;
  });

  return async () => {
    await close(active, true);
    await engine.stop();
  };
}

module.exports = {
  CLOSE_TIMEOUT_MS,
  INFERENCE_TIMEOUT_MS,
  MAX_INITIAL_PROMPT_CHARS,
  MAX_WAV_BYTES,
  cleanTranscript,
  createWhisperEngine,
  publicErrorCode,
  installWhisperSpeech,
  resolveWhisperRuntime,
  wavBuffer,
};
