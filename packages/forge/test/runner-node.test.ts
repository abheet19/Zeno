/**
 * The real process adapter. Two things must hold on a live subprocess: it runs a
 * binary and reports its output faithfully, and a binary that cannot be run is
 * REPORTED (code 127), never thrown. Plus one static guard: `shell: false` is
 * present and no argv is ever joined into a shell string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeSpawner } from '../src/runner-node.js';
import { SPAWN_FAILED } from '../src/runner.js';

test('runs a real binary and reports stdout and exit code faithfully', () => {
  const spawner = nodeSpawner();
  // Spawn THIS node — always present, on every platform — with a tiny program.
  const r = spawner.run(process.execPath, ['-e', 'process.stdout.write("hello-forge")'], {
    cwd: tmpdir(),
  });
  assert.equal(r.code, 0);
  assert.equal(r.failedToSpawn, false, 'a process that ran did not fail to spawn');
  assert.equal(r.stdout, 'hello-forge');
});

test('a non-zero exit is reported as the real code, not swallowed', () => {
  const r = nodeSpawner().run(process.execPath, ['-e', 'process.exit(3)'], { cwd: tmpdir() });
  assert.equal(r.code, 3);
  assert.equal(r.failedToSpawn, false);
});

test('a real process that EXITS 127 is a run, not a spawn failure', () => {
  // The sharp case: 127 is a legitimate exit code. The adapter must report it as
  // a real exit (`failedToSpawn: false`) so the runner never mistakes a run that
  // chose 127 for a binary that could not be launched.
  const r = nodeSpawner().run(process.execPath, ['-e', 'process.exit(127)'], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED, 'the number 127 — but from a process that ran');
  assert.equal(r.failedToSpawn, false, 'a chosen exit code is never a spawn failure');
});

test('a MISSING binary is reported as failedToSpawn (code 127), never thrown', () => {
  const r = nodeSpawner().run('zeno-forge-no-such-binary-zzz', [], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED);
  assert.equal(r.failedToSpawn, true, 'the binary never ran — say so, do not lean on the code');
  assert.match(r.stderr, /could not be run/);
});

test('an argument spawnSync itself refuses (a NUL byte) is reported, not thrown', () => {
  const r = nodeSpawner().run(process.execPath, ['-e', 'x\0y'], { cwd: tmpdir() });
  assert.equal(r.code, SPAWN_FAILED);
  assert.equal(r.failedToSpawn, true);
  assert.match(r.stderr, /could not be run/);
});

test('STATIC — the adapter runs shell:false and never builds a shell string', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', '..', 'src', 'runner-node.ts'), 'utf8');
  assert.match(src, /shell:\s*false/, 'no argument may ever be re-parsed by a shell');
  assert.doesNotMatch(src, /args\.join\(/, 'argv is passed as a list, never joined');
});
