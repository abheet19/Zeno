/**
 * Smoke test for the REAL filesystem adapter, against an actual OS temp dir.
 * Confirms the atomic write, read, realpath and jail all work on real files,
 * then drives one full kernel→executor cycle that changes a real file on disk.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Kernel } from '../src/index.js';
import { nodeSandboxFs } from '../src/executor-node-fs.js';
import { hashOf } from '../src/hash.js';
import { jail, worktreeExecutor, makeWritePayload } from '../src/executor.js';
import type { ActionRequest, World } from '../src/types.js';
import { TestWorld } from './harness.js';

const root = mkdtempSync(join(tmpdir(), 'zeno-sbx-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('real fs: atomic write + read round-trips, missing file reads null', () => {
  const fs = nodeSandboxFs();
  const p = join(root, 'sub', 'a.txt');
  assert.equal(fs.readFile(p), null);
  fs.writeAtomic(p, 'hello');
  assert.equal(fs.readFile(p), 'hello');
  fs.writeAtomic(p, 'world'); // overwrite atomically
  assert.equal(fs.readFile(p), 'world');
});

test('real fs: jail accepts inside, rejects climbing out', () => {
  const fs = nodeSandboxFs();
  assert.equal(jail(fs, root, 'ok/inside.txt'), join(root, 'ok/inside.txt'));
  assert.throws(() => jail(fs, root, '../escape.txt'));
  assert.throws(() => jail(fs, root, '/etc/passwd'));
});

test('real fs E2E: approve → a real file on disk changes → verified', async () => {
  const fs = nodeSandboxFs();
  const abs = join(root, 'InsertReplace.tsx');
  fs.writeAtomic(abs, 'OLD');

  const tw = new TestWorld();
  const world: World = {
    now: () => tw.now(),
    id: () => tw.id(),
    readBase: (ref) => {
      const c = fs.readFile(ref);
      return c === null ? 'base_absent' : hashOf(c);
    },
    approvalTtlMs: 60_000,
  };
  const k = new Kernel(world);

  const payload = makeWritePayload('InsertReplace.tsx', 'OLD', 'NEW');
  const req: ActionRequest = {
    kind: 'patch.task',
    summary: 'write InsertReplace.tsx',
    targetRef: abs,
    payload,
    baseHash: payload.expectBaseHash,
    requestedBy: 'work-agent',
    dataZones: ['personal'],
  };
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);
  const r = await k.commit(ap, worktreeExecutor({ root, fs }, payload));

  assert.equal(r.outcome, 'verified');
  assert.equal(readFileSync(abs, 'utf8'), 'NEW', 'the real file on disk changed');
  assert.ok(root.startsWith(tmpdir())); // sanity: we only ever touched a temp sandbox
  assert.ok(!abs.includes('..' + sep));
});
