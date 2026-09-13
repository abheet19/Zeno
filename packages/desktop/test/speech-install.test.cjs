const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { join, sep } = require('node:path');
const {
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
} = require('../speech-install.cjs');
const { resolveWhisperRuntime } = require('../whisper.cjs');

test('installRoot lands under %LOCALAPPDATA%\\Zeno\\speech\\<version>, or nowhere without it', () => {
  assert.equal(installRoot('C:\\Users\\priya\\AppData\\Local'), join('C:\\Users\\priya\\AppData\\Local', 'Zeno', 'speech', WHISPER_VERSION));
  assert.equal(installRoot(''), '');
  assert.equal(installRoot('   '), '');
  assert.equal(installRoot(undefined), '');
});

test('describeInstallPlan picks the GPU asset only when a GPU was actually detected, and lays out the exact path resolveWhisperRuntime() looks for', () => {
  const cpuPlan = describeInstallPlan(false, 'C:\\Users\\priya\\AppData\\Local');
  assert.equal(cpuPlan.asset, RUNTIME_ASSETS.cpu);
  assert.equal(cpuPlan.binDestDir, join(cpuPlan.root, 'cpu'));
  assert.equal(cpuPlan.executablePath, join(cpuPlan.root, 'cpu', 'Release', 'whisper-server.exe'));
  assert.equal(cpuPlan.modelPath, join(cpuPlan.root, MODEL_ASSET.name));
  assert.equal(cpuPlan.totalBytes, RUNTIME_ASSETS.cpu.size + MODEL_ASSET.size);

  const gpuPlan = describeInstallPlan(true, 'C:\\Users\\priya\\AppData\\Local');
  assert.equal(gpuPlan.asset, RUNTIME_ASSETS.gpu);
  assert.equal(gpuPlan.binDestDir, join(gpuPlan.root, 'gpu-12.4'));
  assert.equal(gpuPlan.executablePath, join(gpuPlan.root, 'gpu-12.4', 'Release', 'whisper-server.exe'));

  assert.ok(cpuPlan.root.includes(`Zeno${sep}speech${sep}${WHISPER_VERSION}`));
});

test('progressPercent is a bounded whole percent, or null when the total is not known', () => {
  assert.equal(progressPercent(0, 100), 0);
  assert.equal(progressPercent(50, 100), 50);
  assert.equal(progressPercent(100, 100), 100);
  assert.equal(progressPercent(999, 100), 100, 'never exceeds 100 even if more bytes arrived than expected');
  assert.equal(progressPercent(-5, 100), 0, 'never goes negative');
  assert.equal(progressPercent(10, 0), null);
  assert.equal(progressPercent(10, -1), null);
  assert.equal(progressPercent(10, NaN), null);
  assert.equal(progressPercent(NaN, 100), null);
});

test('describeStatus is only true when BOTH the executable and the model exist, matching resolveWhisperRuntime()', () => {
  const localAppData = 'C:\\Users\\priya\\AppData\\Local';
  // resolveWhisperRuntime() picks its own path independent of any injected
  // fileExists (it uses real fs.existsSync internally) — describeStatus only
  // decides whether to TRUST what it picked, so the test has to agree with it
  // on which path that is, not invent one of its own.
  const { executable: exe, model } = resolveWhisperRuntime(localAppData, {});
  const only = (present) => (path) => present.has(path);

  assert.equal(describeStatus(localAppData, {}, only(new Set())).installed, false);
  assert.equal(describeStatus(localAppData, {}, only(new Set([exe]))).installed, false, 'executable alone is not enough');
  assert.equal(describeStatus(localAppData, {}, only(new Set([model]))).installed, false, 'model alone is not enough');
  const status = describeStatus(localAppData, {}, only(new Set([exe, model])));
  assert.equal(status.installed, true);
  assert.equal(status.executable, exe);
  assert.equal(status.model, model);
  assert.equal(status.version, WHISPER_VERSION);
});

test('the release asset table matches what was verified on GitHub: real names, sizes and sha256 digests', () => {
  assert.equal(RUNTIME_ASSETS.cpu.name, 'whisper-bin-x64.zip');
  assert.equal(RUNTIME_ASSETS.cpu.url, `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-bin-x64.zip`);
  assert.equal(RUNTIME_ASSETS.gpu.name, 'whisper-cublas-12.4.0-bin-x64.zip');
  assert.equal(RUNTIME_ASSETS.gpu.dir, 'gpu-12.4');
  for (const asset of [RUNTIME_ASSETS.cpu, RUNTIME_ASSETS.gpu, MODEL_ASSET]) {
    assert.match(asset.sha256, /^[0-9a-f]{64}$/, `${asset.name} must carry a real sha256`);
    assert.ok(Number.isInteger(asset.size) && asset.size > 0);
  }
  assert.equal(MODEL_ASSET.name, 'ggml-large-v3-turbo-q5_0.bin');
  assert.equal(MODEL_ASSET.url, 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin');
});

test('detectNvidiaGpu resolves true only on a clean exit with a non-empty answer, and never throws when the tool is missing', async () => {
  const spawning = (exitCode, stdout) => () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    queueMicrotask(() => { if (stdout) child.stdout.write(stdout); child.emit('exit', exitCode); });
    return child;
  };
  assert.equal(await detectNvidiaGpu({ spawnImpl: spawning(0, 'NVIDIA GeForce RTX 4070\n') }), true);
  assert.equal(await detectNvidiaGpu({ spawnImpl: spawning(0, '') }), false, 'a clean exit with no GPU line is not a GPU');
  assert.equal(await detectNvidiaGpu({ spawnImpl: spawning(1, '') }), false);
  assert.equal(await detectNvidiaGpu({
    spawnImpl: () => { throw new Error('nvidia-smi is not on PATH'); },
  }), false, 'a missing tool resolves false rather than rejecting');
});

test('detectNvidiaGpu gives up after its timeout rather than hanging forever', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => true;
  const detected = await detectNvidiaGpu({ spawnImpl: () => child, timeoutMs: 5 });
  assert.equal(detected, false);
});

function fakeResponse({ ok = true, status = 200, bodyChunks = [], headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    // Readable.fromWeb() requires a real global ReadableStream instance (Node's
    // adapter checks `instanceof`), so the fake body has to be one rather than
    // a plain object shaped like one.
    body: new ReadableStream({
      start(controller) {
        for (const chunk of bodyChunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

test('downloadFile verifies size and sha256 before the atomic rename, and cleans up on mismatch', async (t) => {
  const os = require('node:os');
  const fs = require('node:fs/promises');
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'zeno-speech-install-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('the quick brown fox');
  const sha256 = require('node:crypto').createHash('sha256').update(payload).digest('hex');

  const dest = join(dir, 'good.bin');
  const progressed = [];
  const result = await downloadFile('https://example.invalid/good.bin', dest, {
    expectedSize: payload.length,
    expectedSha256: sha256,
    fetchImpl: async () => fakeResponse({ bodyChunks: [payload] }),
    onProgress: (p) => progressed.push(p),
  });
  assert.equal(result, dest);
  assert.equal((await fs.readFile(dest)).toString(), payload.toString());
  assert.ok(progressed.some((p) => p.received === payload.length && p.total === payload.length));

  const badSize = join(dir, 'bad-size.bin');
  await assert.rejects(
    downloadFile('https://example.invalid/bad-size.bin', badSize, {
      expectedSize: payload.length + 1,
      fetchImpl: async () => fakeResponse({ bodyChunks: [payload] }),
    }),
    (error) => error.code === 'size-mismatch',
  );
  await assert.rejects(fs.access(`${badSize}.download`), 'the temp file is removed after a failed verification');
  await assert.rejects(fs.access(badSize), 'nothing is left at the final path either');

  const badHash = join(dir, 'bad-hash.bin');
  await assert.rejects(
    downloadFile('https://example.invalid/bad-hash.bin', badHash, {
      expectedSize: payload.length,
      expectedSha256: 'f'.repeat(64),
      fetchImpl: async () => fakeResponse({ bodyChunks: [payload] }),
    }),
    (error) => error.code === 'checksum-mismatch',
  );
});

test('downloadFile turns an HTTP error, a 404 and a network failure into distinct, honest codes', async (t) => {
  const os = require('node:os');
  const fs = require('node:fs/promises');
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'zeno-speech-install-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await assert.rejects(
    downloadFile('https://example.invalid/missing.bin', join(dir, 'missing.bin'), {
      fetchImpl: async () => fakeResponse({ ok: false, status: 404 }),
    }),
    (error) => error.code === 'not-found',
  );
  await assert.rejects(
    downloadFile('https://example.invalid/oops.bin', join(dir, 'oops.bin'), {
      fetchImpl: async () => fakeResponse({ ok: false, status: 500 }),
    }),
    (error) => error.code === 'download-failed',
  );
  await assert.rejects(
    downloadFile('https://example.invalid/offline.bin', join(dir, 'offline.bin'), {
      fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    }),
    (error) => error.code === 'offline',
  );
});

test('downloadFile reports "aborted", not a raw network error, once the signal is already tripped', async (t) => {
  const os = require('node:os');
  const fs = require('node:fs/promises');
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'zeno-speech-install-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadFile('https://example.invalid/cancelled.bin', join(dir, 'cancelled.bin'), {
      signal: controller.signal,
      fetchImpl: async (_url, options) => {
        if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        return fakeResponse({ bodyChunks: [Buffer.from('x')] });
      },
    }),
    (error) => error.code === 'aborted',
  );
});

test('extractZip runs the real Windows archiver (PowerShell Expand-Archive), quoting paths safely, and reports a real failure', async () => {
  let seen;
  await extractZip("C:\\it's a path\\whisper.zip", 'C:\\dest', {
    spawnImpl: (file, args) => {
      seen = { file, args };
      const child = new EventEmitter();
      child.stderr = new PassThrough();
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    },
  });
  assert.equal(seen.file, 'powershell.exe');
  assert.ok(seen.args.includes('-NonInteractive'));
  const command = seen.args[seen.args.length - 1];
  assert.match(command, /Expand-Archive/);
  // A single quote inside the path must be doubled, not left to close the
  // PowerShell string early — this is the same escaping every quoted argument
  // built from a filesystem path needs.
  assert.ok(command.includes("it''s a path"));

  await assert.rejects(
    extractZip('C:\\whisper.zip', 'C:\\dest', {
      spawnImpl: () => {
        const child = new EventEmitter();
        child.stderr = new PassThrough();
        queueMicrotask(() => { child.stderr.write('Access is denied.'); child.emit('exit', 1); });
        return child;
      },
    }),
    (error) => error.code === 'extract-failed' && /Access is denied/.test(error.message),
  );
});

test('installWhisperRuntime never re-downloads a working install', async () => {
  const localAppData = 'C:\\Users\\priya\\AppData\\Local';
  // installWhisperRuntime's own "already installed?" check goes through
  // resolveWhisperRuntime() (whisper.cjs), which resolves its path with the
  // real fs.existsSync and cannot be pointed at a fake path — so "already
  // installed" here has to mean the exact candidate it would pick, existing.
  const existing = resolveWhisperRuntime(localAppData, {});
  const result = await installWhisperRuntime({
    localAppData,
    fileExists: (path) => path === existing.executable || path === existing.model,
    fetchImpl: async () => { throw new Error('must not fetch anything for an already-working install'); },
    spawnImpl: () => { throw new Error('must not spawn anything for an already-working install'); },
  });
  assert.deepEqual(result, {
    installed: true,
    alreadyInstalled: true,
    executable: existing.executable,
    model: existing.model,
    gpu: existing.executable.includes('gpu-12.4'),
  });
});

test('installWhisperRuntime refuses to run with no %LOCALAPPDATA%', async () => {
  await assert.rejects(
    installWhisperRuntime({ localAppData: '' }),
    (error) => error.code === 'no-local-appdata',
  );
});
