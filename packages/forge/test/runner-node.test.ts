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
import { readFileSync } from 'node:fs';
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

test('a child that overruns its ceiling is stopped and reported as never having completed', async () => {
  const r = await nodeSpawner({ timeoutMs: 200 }).run(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)'],
    { cwd: tmpdir() },
  );
  assert.equal(r.failedToSpawn, true, 'a run that had to be killed did not run to a real exit');
  assert.match(r.stderr, /still running after 200ms/, 'and the reason says which of the failures it was');
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
