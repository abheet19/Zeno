/**
 * P1-02 end to end: the KERNEL drives the WorktreeExecutor. An approval turns into
 * a real (sandboxed) file change with a verified receipt — and drift leaves the
 * file untouched. This is "approve → verified" producing an actual effect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve as pResolve, sep } from 'node:path';
import { Kernel } from '../src/index.js';
import { hashOf } from '../src/hash.js';
import type { ActionRequest, World } from '../src/types.js';
import { worktreeExecutor, makeWritePayload, type SandboxFs, type SandboxFs as _Fs } from '../src/executor.js';
import { TestWorld } from './harness.js';

/** Platform-native sandbox root: "/sandbox" on POSIX, "<drive>:\sandbox" on Windows. */
const ROOT = pResolve(sep + 'sandbox');
/** Build a path inside the sandbox the same way jail() does. */
const at = (rel: string): string => pResolve(ROOT, rel);

/** A memory fs shared by BOTH the executor (to write) and the world (to CAS-read). */
function sharedFs(init: [string, string][] = []) {
  const files = new Map<string, string>(init);
  const fs: _Fs = {
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeAtomic: (p, c) => files.set(p, c),
    realpath: (p) => p,
  };
  return { files, fs };
}

function hashFile(c: string | null): string {
  return c === null ? 'base_absent' : hashOf(c);
}

/** A world whose readBase() reads the SAME fs the executor writes — so CAS is real. */
function worldOver(files: Map<string, string>): World & { tw: TestWorld } {
  const tw = new TestWorld();
  return {
    now: () => tw.now(),
    id: () => tw.id(),
    readBase: (targetRef) => hashFile(files.get(targetRef) ?? null),
    approvalTtlMs: 60_000,
    tw,
  };
}

function writeRequest(abs: string, base: string | null, next: string): { req: ActionRequest; payload: ReturnType<typeof makeWritePayload> } {
  const rel = abs.slice(ROOT.length + 1);
  const payload = makeWritePayload(rel, base, next);
  const req: ActionRequest = {
    kind: 'patch.task', // T1 — needs your approval
    summary: `write ${rel}`,
    targetRef: abs,
    payload,
    baseHash: payload.expectBaseHash,
    requestedBy: 'work-agent',
    dataZones: ['personal'],
  };
  return { req, payload };
}

test('E2E: approve → the file really changes → VERIFIED with the real post-hash', async () => {
  const { files, fs } = sharedFs([[at('Editor.tsx'), 'OLD']]);
  const k = new Kernel(worldOver(files));
  const { req, payload } = writeRequest(at('Editor.tsx'), 'OLD', 'NEW');

  const pv = k.preview(req);
  assert.equal(pv.tier, 'T1');
  const ap = k.approve(pv.actionHash);
  const r = await k.commit(ap, worktreeExecutor({ root: ROOT, fs }, payload));

  assert.equal(r.outcome, 'verified');
  assert.equal(files.get(at('Editor.tsx')), 'NEW', 'the file actually changed');
  assert.equal(r.externalEffect.effect, 'file:' + hashOf('NEW'));
  assert.equal(k.verifyChain().ok, true);
});

test('E2E: base drifts after approve → REFUSED → file untouched, approval unspent', async () => {
  const { files, fs } = sharedFs([[at('a.tsx'), 'OLD']]);
  const k = new Kernel(worldOver(files));
  const { req, payload } = writeRequest(at('a.tsx'), 'OLD', 'NEW');
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);

  files.set(at('a.tsx'), 'SOMEONE_ELSE_EDITED_IT'); // drift between approve and commit

  const r = await k.commit(ap, worktreeExecutor({ root: ROOT, fs }, payload));
  assert.equal(r.outcome, 'refused');
  assert.equal(files.get(at('a.tsx')), 'SOMEONE_ELSE_EDITED_IT', 'executor never ran; file untouched by us');
});

test('E2E: T0 local.write auto-applies in the sandbox, still receipted', async () => {
  const { files, fs } = sharedFs([[at('scratch.txt'), 'a']]);
  const k = new Kernel(worldOver(files));
  const { req, payload } = writeRequest(at('scratch.txt'), 'a', 'b');
  const t0req = { ...req, kind: 'local.write' as const };
  const pv = k.preview(t0req);
  assert.equal(pv.auto, true); // sandbox write needs no owner approval
  const r = await k.commit(pv.actionHash, worktreeExecutor({ root: ROOT, fs }, payload));
  assert.equal(r.outcome, 'verified');
  assert.equal(files.get(at('scratch.txt')), 'b');
});

test('E2E: a failing executor yields OUTCOME_UNKNOWN, retry frozen', async () => {
  const { files } = sharedFs([[at('a.tsx'), 'OLD']]);
  const flaky: SandboxFs = {
    readFile: (p: string) => (files.has(p) ? files.get(p)! : null),
    writeAtomic: () => {
      throw new Error('disk full');
    },
    realpath: (p: string) => p,
  };
  const k = new Kernel(worldOver(files));
  const { req, payload } = writeRequest(at('a.tsx'), 'OLD', 'NEW');
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);
  const r = await k.commit(ap, worktreeExecutor({ root: ROOT, fs: flaky }, payload));
  assert.equal(r.outcome, 'outcome-unknown');
  // approval is spent; a second commit does not retry.
  const again = await k.commit(ap, worktreeExecutor({ root: ROOT, fs: flaky }, payload));
  assert.equal(again.outcome, 'denied');
});
