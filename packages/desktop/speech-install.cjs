'use strict';

/**
 * speech-install.cjs — a one-click, consented installer for the local Whisper
 * runtime whisper.cjs already knows how to find but this repository has never
 * provisioned. resolveWhisperRuntime() (whisper.cjs) expects
 * `%LOCALAPPDATA%\Zeno\speech\v1.9.2\{gpu-12.4|gpu|cpu}\Release\whisper-server.exe`
 * plus a model at the version root; on a fresh machine none of that exists,
 * which is the whole reason "the voice button does not work". This module
 * downloads exactly those files, from the real whisper.cpp v1.9.2 release and
 * the real ggml-large-v3-turbo-q5_0.bin model, and nothing else.
 *
 * Every asset below (name, byte size, sha256) was verified against
 * https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.2 and
 * https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
 * on 2026-09-14 — the GitHub release API's own asset digests, and the model's
 * `X-Linked-ETag` response header (Hugging Face's sha256 for an LFS/xet file,
 * distinct from the xet content-hash in its plain `ETag`).
 *
 * Nothing in here runs unless a caller (main.cjs, behind an explicit Settings
 * click) invokes installWhisperRuntime(). Pure planning/math is exported
 * separately from the IO so packages/desktop/test/*.test.cjs can exercise it
 * without a network or a real Windows archive extractor, the same split
 * whisper.cjs itself uses (spawnProcess/fetchImpl/fileExists injection).
 */

const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const {
  cp, mkdir, mkdtemp, open, rename, rm, stat,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { Readable } = require('node:stream');
const { resolveWhisperRuntime } = require('./whisper.cjs');

const WHISPER_VERSION = 'v1.9.2';
const RELEASE_BASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}`;

// Each archive's own top-level entry is already `Release/...` (confirmed by
// listing whisper-bin-x64.zip), so extracting it straight into the
// version-root directory named `dir` below reproduces exactly the layout
// resolveWhisperRuntime() looks for — no repacking or renaming needed.
const RUNTIME_ASSETS = {
  cpu: {
    dir: 'cpu',
    name: 'whisper-bin-x64.zip',
    url: `${RELEASE_BASE}/whisper-bin-x64.zip`,
    size: 8_194_445,
    sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
  },
  gpu: {
    dir: 'gpu-12.4',
    name: 'whisper-cublas-12.4.0-bin-x64.zip',
    url: `${RELEASE_BASE}/whisper-cublas-12.4.0-bin-x64.zip`,
    size: 670_611_449,
    sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
  },
};

const MODEL_ASSET = {
  name: 'ggml-large-v3-turbo-q5_0.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  size: 574_041_195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
};

function installError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** The version-root every asset installs under: `%LOCALAPPDATA%\Zeno\speech\v1.9.2`. */
function installRoot(localAppData) {
  const base = String(localAppData || '').trim();
  return base ? join(base, 'Zeno', 'speech', WHISPER_VERSION) : '';
}

/**
 * Where every file of one install would land, and how large that install is —
 * pure path/byte-count planning, computed before anything is downloaded so it
 * can be unit-tested and so a caller can show the plan (or refuse it, with no
 * `%LOCALAPPDATA%`) before committing to a multi-hundred-megabyte transfer.
 */
function describeInstallPlan(gpuDetected, localAppData) {
  const root = installRoot(localAppData);
  const asset = gpuDetected ? RUNTIME_ASSETS.gpu : RUNTIME_ASSETS.cpu;
  const binDestDir = root ? join(root, asset.dir) : '';
  const executablePath = binDestDir ? join(binDestDir, 'Release', 'whisper-server.exe') : '';
  const modelPath = root ? join(root, MODEL_ASSET.name) : '';
  return {
    root, asset, binDestDir, executablePath, modelPath, totalBytes: asset.size + MODEL_ASSET.size,
  };
}

/** Whole-percent progress, or null when the total is not known yet — never
 * NaN/Infinity from a zero or missing total reaching the renderer. */
function progressPercent(received, total) {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(received)) return null;
  return Math.round(Math.max(0, Math.min(1, received / total)) * 100);
}

/** Same truth resolveWhisperRuntime()'s own callers rely on: both the
 * executable AND the model must exist. Exposed here so main.cjs's IPC status
 * handler and installWhisperRuntime() share one definition of "installed". */
function describeStatus(localAppData = process.env.LOCALAPPDATA || '', env = process.env, fileExists = existsSync) {
  const runtime = resolveWhisperRuntime(localAppData, env);
  const installed = Boolean(runtime.executable && runtime.model && fileExists(runtime.executable) && fileExists(runtime.model));
  return {
    installed, executable: runtime.executable, model: runtime.model, version: WHISPER_VERSION,
  };
}

/**
 * Best-effort NVIDIA GPU probe, same shape and same tool as the daemon's own
 * probeGpu() (packages/daemon/src/routes/ollama-lifecycle.ts): nvidia-smi on
 * PATH, bounded by a timeout, and a plain `false` — never a thrown error — when
 * it is absent or slow. An undetected GPU means "install the CPU build", not
 * "this machine has no GPU".
 */
function detectNvidiaGpu({ spawnImpl = spawn, timeoutMs = 4_000 } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = spawnImpl('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return finish(false);
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(false); }, timeoutMs);
    let out = '';
    child.stdout?.on('data', chunk => { out += String(chunk); });
    child.once('error', () => { clearTimeout(timer); finish(false); });
    child.once('exit', code => { clearTimeout(timer); finish(code === 0 && out.trim() !== ''); });
    return undefined;
  });
}

/**
 * Stream one URL to disk: a temp sibling file first, verified for size and
 * (when known) sha256, then an atomic rename into place — so a reader can
 * never observe a partial or corrupt download at the final path, and a
 * cancelled or failed attempt leaves no half-written file behind.
 */
async function downloadFile(url, destPath, options = {}) {
  const {
    expectedSize, expectedSha256, onProgress = () => {}, signal, fetchImpl = globalThis.fetch,
  } = options;
  await mkdir(dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download`;

  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw installError('aborted', 'The download was cancelled.');
    throw installError('offline', `Could not reach ${url} (${error && error.message ? error.message : error}).`);
  }
  if (!response || !response.ok) {
    const status = response ? response.status : 0;
    throw installError(
      status === 404 ? 'not-found' : 'download-failed',
      `${url} answered ${status || 'no response'} — the release may have moved.`,
    );
  }
  if (!response.body) throw installError('download-failed', `${url} sent no response body.`);

  const total = expectedSize || Number(response.headers.get('content-length')) || 0;
  const hash = createHash('sha256');
  let received = 0;
  let lastTick = 0;
  const handle = await open(tmpPath, 'w');
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (signal?.aborted) throw installError('aborted', 'The download was cancelled.');
      hash.update(chunk);
      received += chunk.length;
      await handle.write(chunk);
      const now = Date.now();
      if (now - lastTick > 120 || received === total) { lastTick = now; onProgress({ received, total }); }
    }
  } catch (error) {
    if (error && error.code === 'ENOSPC') throw installError('disk-full', 'There is not enough free disk space to finish this download.');
    throw error;
  } finally {
    await handle.close();
  }
  if (signal?.aborted) { await rm(tmpPath, { force: true }); throw installError('aborted', 'The download was cancelled.'); }

  const stats = await stat(tmpPath);
  if (expectedSize && stats.size !== expectedSize) {
    await rm(tmpPath, { force: true });
    throw installError('size-mismatch', `${url} downloaded ${stats.size} bytes, expected ${expectedSize}. The download may be corrupt, or the release changed.`);
  }
  if (!expectedSize && stats.size === 0) {
    await rm(tmpPath, { force: true });
    throw installError('download-failed', `${url} downloaded an empty file.`);
  }
  if (expectedSha256 && hash.digest('hex') !== expectedSha256) {
    await rm(tmpPath, { force: true });
    throw installError('checksum-mismatch', `${url} did not match its expected checksum — the download may be corrupt.`);
  }
  try {
    await rename(tmpPath, destPath);
  } catch (error) {
    if (error && error.code === 'ENOSPC') throw installError('disk-full', 'There is not enough free disk space to finish this install.');
    throw error;
  }
  return destPath;
}

/** Extract a Windows release zip with the OS's own archiver — Expand-Archive
 * ships with PowerShell on every supported Windows version, so this needs no
 * bundled unzip binary and no extra dependency. */
function extractZip(zipPath, destDir, { spawnImpl = spawn } = {}) {
  const quote = value => `'${String(value).replace(/'/g, "''")}'`;
  const command = `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destDir)} -Force`;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      return reject(installError('extract-failed', `Could not run the Windows archive extractor: ${error && error.message ? error.message : error}`));
    }
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk).slice(0, 4_000); });
    child.once('error', error => reject(installError('extract-failed', `Could not run the Windows archive extractor: ${error && error.message ? error.message : error}`)));
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(installError('extract-failed', `Extracting the whisper.cpp archive failed (exit ${code}). ${stderr.trim()}`.trim()));
    });
    return undefined;
  });
}

/**
 * Install the local Whisper runtime and model, end to end. Never overwrites a
 * working install (an early, cheap existence check returns immediately);
 * downloads a CUDA build only when nvidia-smi actually reports a GPU, the
 * plain CPU build otherwise; verifies every byte before it is renamed into
 * the path resolveWhisperRuntime() will look for next; and leaves nothing
 * behind — success or failure — outside that one final path.
 */
async function installWhisperRuntime(options = {}) {
  const {
    localAppData = process.env.LOCALAPPDATA || '',
    onProgress = () => {},
    signal,
    detectGpu = detectNvidiaGpu,
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    fileExists = existsSync,
  } = options;

  if (!localAppData.trim()) throw installError('no-local-appdata', 'This machine has no %LOCALAPPDATA%, so local Whisper cannot be installed here.');

  const already = describeStatus(localAppData, process.env, fileExists);
  if (already.installed) return { installed: true, alreadyInstalled: true, executable: already.executable, model: already.model, gpu: already.executable.includes(RUNTIME_ASSETS.gpu.dir) };

  const gpuDetected = await detectGpu({ spawnImpl });
  const plan = describeInstallPlan(gpuDetected, localAppData);

  onProgress({ phase: 'runtime', received: 0, total: plan.asset.size });
  const workDir = await mkdtemp(join(tmpdir(), 'zeno-whisper-'));
  try {
    const zipPath = join(workDir, plan.asset.name);
    await downloadFile(plan.asset.url, zipPath, {
      expectedSize: plan.asset.size,
      expectedSha256: plan.asset.sha256,
      signal,
      fetchImpl,
      onProgress: progress => onProgress({ phase: 'runtime', ...progress }),
    });
    if (signal?.aborted) throw installError('aborted', 'The install was cancelled.');

    const extractedDir = join(workDir, 'extracted');
    await extractZip(zipPath, extractedDir, { spawnImpl });
    const extractedExecutable = join(extractedDir, 'Release', 'whisper-server.exe');
    if (!fileExists(extractedExecutable)) throw installError('bad-archive', 'The downloaded whisper.cpp archive did not contain whisper-server.exe.');

    await mkdir(dirname(plan.binDestDir), { recursive: true });
    await rm(plan.binDestDir, { recursive: true, force: true }).catch(() => {});
    try {
      await rename(extractedDir, plan.binDestDir);
    } catch (error) {
      // rename() only works within one volume; the OS temp directory is
      // normally on the same drive as %LOCALAPPDATA%, but fall back to a copy
      // rather than fail an otherwise-good install on the rare box where it is not.
      if (error && error.code === 'EXDEV') {
        await cp(extractedDir, plan.binDestDir, { recursive: true });
      } else {
        throw error;
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  if (signal?.aborted) throw installError('aborted', 'The install was cancelled.');
  onProgress({ phase: 'model', received: 0, total: MODEL_ASSET.size });
  await downloadFile(MODEL_ASSET.url, plan.modelPath, {
    expectedSize: MODEL_ASSET.size,
    expectedSha256: MODEL_ASSET.sha256,
    signal,
    fetchImpl,
    onProgress: progress => onProgress({ phase: 'model', ...progress }),
  });

  return {
    installed: true, alreadyInstalled: false, executable: plan.executablePath, model: plan.modelPath, gpu: gpuDetected,
  };
}

module.exports = {
  MODEL_ASSET,
  RUNTIME_ASSETS,
  WHISPER_VERSION,
  describeInstallPlan,
  describeStatus,
  detectNvidiaGpu,
  downloadFile,
  extractZip,
  installRoot,
  installWhisperRuntime,
  progressPercent,
};
