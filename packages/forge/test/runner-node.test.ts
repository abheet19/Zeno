/**
 * The real process adapter. Three things must hold on a live subprocess: it runs
 * a binary and reports its output faithfully, a binary that cannot be run is
 * REPORTED (code 127) and never thrown, and it does not hold the event loop
 * while the child runs — the property the whole permission host depends on.
 * Plus one static guard: `shell: false` is present and no argv is ever joined
 * into a shell string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeSpawner } from '../src/runner-node.js';
import { SPAWN_FAILED } from '../src/runner.js';

test('runs a real binary and reports stdout and exit code faithfully', async () => {
  const spawner = nodeSpawner();
  // Spawn THIS node — always present, on every platform — with a tiny program.
  const r = await spawner.run(process.execPath, ['-e', 'process.stdout.write("hello-forge")'], {
    cwd: tmpdir(),
  });
  assert.equal(r.code, 0);
  assert.equal(r.failedToSpawn, false, 'a process that ran did not fail to spawn');
  assert.equal(r.stdout, 'hello-forge');
});

test('a non-zero exit is reported as the real code, not swallowed', async () => {
  const r = await nodeSpawner().run(process.execPath, ['-e', 'process.exit(3)'], { cwd: tmpdir() });
  assert.equal(r.code, 3);
  assert.equal(r.failedToSpawn, false);
});

test('a real process that EXITS 127 is a run, not a spawn failure', async () => {
  // The sharp case: 127 is a legitimate exit code. The adapter must report it as
  // a real exit (`failedToSpawn: false`) so the runner never mistakes a run that
  // chose 127 for a binary that could not be launched.
  const r = await nodeSpawner().run(process.execPath, ['-e', 'process.exit(127)'], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED, 'the number 127 — but from a process that ran');
  assert.equal(r.failedToSpawn, false, 'a chosen exit code is never a spawn failure');
});

test('a MISSING binary is reported as failedToSpawn (code 127), never thrown', async () => {
  const r = await nodeSpawner().run('zeno-forge-no-such-binary-zzz', [], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED);
  assert.equal(r.failedToSpawn, true, 'the binary never ran — say so, do not lean on the code');
  assert.match(r.stderr, /could not be run/);
});

test('an argument spawn itself refuses (a NUL byte) is reported, not thrown', async () => {
  const r = await nodeSpawner().run(process.execPath, ['-e', 'x\0y'], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED);
  assert.equal(r.failedToSpawn, true);
  assert.match(r.stderr, /could not be run/);
});

test('extra environment reaches the child, layered over the parent\'s', async () => {
  // This is how the run-scoped gate credential reaches the agent: not on the
  // command line (a process listing is world-readable) and not in a file inside
  // the worktree (the agent can read those).
  const r = await nodeSpawner().run(
    process.execPath,
    ['-e', 'process.stdout.write(String(process.env.ZENO_TEST_GATE) + "/" + (process.env.PATH ? "has-path" : "no-path"))'],
    { cwd: tmpdir(), env: { ZENO_TEST_GATE: 'run-token-xyz' } },
  );
  assert.equal(r.stdout, 'run-token-xyz/has-path', 'the child gets the extra value AND keeps the parent environment');
});

test('optional stdin reaches the child exactly and then closes', async () => {
  const input = '--add-dir /; $(whoami)\nsecond line';
  const r = await nodeSpawner().run(
    process.execPath,
    ['-e', 'let s=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c => s += c); process.stdin.on("end", () => process.stdout.write(s))'],
    { cwd: tmpdir(), stdin: input },
  );
  assert.equal(r.code, 0);
  assert.equal(r.failedToSpawn, false);
  assert.equal(r.stdout, input, 'stdin is data, with no shell or option parsing');
});

test('Windows tree-kill mode preserves output from native commands launched by cmd.exe', {
  skip: process.platform !== 'win32',
}, async () => {
  const shell = process.env['ComSpec'] ?? 'cmd.exe';
  const r = await nodeSpawner({ timeoutMs: 30_000, killTreeOnTimeout: true }).run(
    shell,
    ['/d', '/s', '/c', 'where.exe cmd.exe'],
    { cwd: tmpdir() },
  );
  assert.equal(r.code, 0);
  assert.equal(r.failedToSpawn, false);
  assert.match(r.stdout, /cmd\.exe/i, 'native child stdout reaches the owner terminal');
  assert.equal(r.stderr, '');
});

test('a child that overruns its ceiling is stopped and reported as never having completed', async () => {
  const r = await nodeSpawner({ timeoutMs: 200 }).run(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)'],
    { cwd: tmpdir() },
  );
  assert.equal(r.failedToSpawn, true, 'a run that had to be killed did not run to a real exit');
  assert.match(r.stderr, /still running after 200ms/, 'and the reason says which of the failures it was');
});

test('Windows shim fallback refuses cmd metacharacters instead of executing them', {
  skip: process.platform !== 'win32',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-cmd-safe-'));
  const marker = join(dir, 'injected.txt');
  const command = 'zeno-safe-shim-test';
  writeFileSync(join(dir, command + '.cmd'), '@echo off\r\necho shim-ran\r\n', 'utf8');
  try {
    const inherited = process.env['PATH'] ?? '';
    const r = await nodeSpawner().run(command, ['safe', '&', 'echo', 'injected>', marker], {
      cwd: dir,
      env: { PATH: dir + ';' + inherited, Path: dir + ';' + inherited },
    });
    assert.equal(r.failedToSpawn, true, 'unsafe argv is refused with the original spawn failure');
    assert.equal(existsSync(marker), false, 'cmd.exe never saw the injected command');
    assert.doesNotMatch(r.stdout, /shim-ran/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an owner cancellation stops the process tree promptly and is not reported as a spawn failure', async () => {
  const controller = new AbortController();
  const began = Date.now();
  const pending = nodeSpawner({ timeoutMs: 30_000 }).run(
    process.execPath,
    ['-e', 'process.stdout.write("began\\n"); setTimeout(() => {}, 30000)'],
    { cwd: tmpdir(), signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 100);
  const r = await pending;
  assert.equal(r.cancelled, true);
  assert.equal(r.failedToSpawn, false, 'the process did run; the owner stopped it');
  assert.equal(r.code, 128);
  assert.match(r.stdout, /began/);
  assert.match(r.stderr, /cancelled/i);
  assert.ok(Date.now() - began < 4_000, 'cancellation cannot leave a descendant holding the request open');
});

test('an already-cancelled signal does not start a process', async () => {
  const controller = new AbortController();
  controller.abort();
  const r = await nodeSpawner().run(process.execPath, ['-e', 'process.stdout.write("should-not-run")'], {
    cwd: tmpdir(), signal: controller.signal,
  });
  assert.equal(r.cancelled, true);
  assert.equal(r.stdout, '');
});

test('an opted-in timeout stops descendants that retain the parent output pipes', async () => {
  const script = [
    "const { spawn } = require('node:child_process')",
    "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: ['ignore', 'inherit', 'inherit'] })",
    'setTimeout(() => {}, 5000)',
  ].join(';');
  const began = Date.now();
  const r = await nodeSpawner({ timeoutMs: 200, killTreeOnTimeout: true }).run(
    process.execPath,
    ['-e', script],
    { cwd: tmpdir() },
  );
  assert.equal(r.failedToSpawn, true);
  assert.match(r.stderr, /still running after 200ms/);
  assert.ok(Date.now() - began < 4_000, 'the descendant cannot keep the request open after its parent times out');
});

test('NON-BLOCKING — the event loop keeps turning while a child runs', async () => {
  // The property the permission host is built on. A governed run asks the owner
  // a question mid-run, and the process that must serve that question is the one
  // that started the agent. If this adapter blocked, the agent would wait on an
  // answer that could not be given until the agent exited.
  let ticks = 0;
  const ticker = setInterval(() => { ticks += 1; }, 10);
  try {
    await nodeSpawner().run(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { cwd: tmpdir() });
  } finally {
    clearInterval(ticker);
  }
  assert.ok(ticks > 5, `the loop must keep running during a spawn — it ticked ${ticks} times`);
});

test('STATIC — the adapter runs shell:false and never builds a shell string', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', '..', 'src', 'runner-node.ts'), 'utf8');
  assert.match(src, /shell:\s*false/, 'no argument may ever be re-parsed by a shell');
  assert.doesNotMatch(src, /args\.join\(/, 'argv is passed as a list, never joined');
});
