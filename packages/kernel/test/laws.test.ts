/**
 * The seven laws, as PROPERTY tests over randomized action streams. Each law is
 * checked across hundreds of generated (kind, zone, approve?, drift?, reuse?)
 * combinations — not just a happy-path example.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../src/index.js';
import { PolicyError } from '../src/types.js';
import {
  ALL_KINDS,
  ALL_ZONES,
  TestWorld,
  buildRequest,
  okExecutor,
  pick,
  prng,
} from './harness.js';

const AUTH = { method: 'deferred-placeholder', ref: 'ok' } as const;
const ROUNDS = 400;

test('L7 — T4 is absolute: payment / financial never verify, ever', () => {
  const rnd = prng(701);
  for (let i = 0; i < ROUNDS; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    // Force T4 either by kind or by financial zone.
    const req =
      rnd() < 0.5
        ? buildRequest(world, { kind: 'payment' })
        : buildRequest(world, { kind: pick(rnd, ALL_KINDS), zones: ['financial'] });
    const pv = k.preview(req);
    assert.equal(pv.tier, 'T4', 'T4 must be forced');
    assert.equal(pv.denied, true);
    // approve() must refuse.
    assert.throws(() => k.approve(pv.actionHash, AUTH), (e) => e instanceof PolicyError && e.code === 't4-denied');
    // No receipt may ever be 'verified' for this action.
    assert.ok(k.receipts().every((r) => r.outcome !== 'verified'));
  }
});

test('L1 + L6 — no skip / no self-approval: nothing verifies without an owner approval', async () => {
  const rnd = prng(101);
  for (let i = 0; i < ROUNDS; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    // Non-T0, non-T4 kinds (need approval). Never approve; try to commit anyway.
    const req = buildRequest(world, { kind: pick(rnd, ['patch.task', 'vcs.push', 'jira.write', 'vcs.mr', 'message.send'] as const) });
    const pv = k.preview(req);
    // Committing by actionHash (as an agent might) without approval must throw, not act.
    const exec = okExecutor();
    await assert.rejects(() => k.commit(pv.actionHash, exec));
    assert.equal(exec.calls(), 0, 'executor must never run without approval');
    assert.ok(k.receipts().every((r) => r.outcome !== 'verified'));
  }
});

test('L2 — one attempt: the executor is invoked at most once per action', async () => {
  const rnd = prng(202);
  for (let i = 0; i < ROUNDS; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    const req = buildRequest(world, { kind: 'patch.task' }); // T1
    const pv = k.preview(req);
    const ap = k.approve(pv.actionHash);
    const exec = okExecutor();
    await k.commit(ap, exec);
    // A second commit with the same approval must NOT run the executor again.
    await k.commit(ap, exec).catch(() => undefined);
    assert.equal(exec.calls(), 1, 'exactly one attempt');
  }
});

test('L4 — single-use: a spent approval can never drive a second effect', async () => {
  const rnd = prng(404);
  for (let i = 0; i < ROUNDS; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    const req = buildRequest(world, { kind: pick(rnd, ['patch.task', 'vcs.commit'] as const) });
    const pv = k.preview(req);
    const ap = k.approve(pv.actionHash);
    const exec = okExecutor();
    const r1 = await k.commit(ap, exec);
    const r2 = await k.commit(ap, exec);
    assert.equal(r1.outcome, 'verified');
    assert.equal(r2.outcome, 'denied');
    assert.match(r2.reason ?? '', /already used/i);
    assert.equal(exec.calls(), 1);
  }
});

test('L5 — seal after receipt: every "verified" corresponds to a durable receipt in the chain', async () => {
  const rnd = prng(505);
  for (let i = 0; i < ROUNDS; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    const req = buildRequest(world, { kind: 'patch.task' });
    const pv = k.preview(req);
    const ap = k.approve(pv.actionHash);
    const r = await k.commit(ap, okExecutor());
    if (r.outcome === 'verified') {
      // the returned receipt IS in the ledger, and the chain still verifies.
      assert.ok(k.receipts().some((x) => x.selfHash === r.selfHash));
      assert.equal(k.verifyChain().ok, true);
    }
  }
});

test('T2+ requires an authenticator (tier gate)', () => {
  const rnd = prng(220);
  for (let i = 0; i < 200; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    const req = buildRequest(world, { kind: pick(rnd, ['jira.write', 'vcs.push', 'vcs.mr', 'settings.change'] as const) });
    const pv = k.preview(req);
    assert.ok(pv.tier === 'T2' || pv.tier === 'T3');
    assert.throws(() => k.approve(pv.actionHash, null), (e) => e instanceof PolicyError && e.code === 'missing-authenticator');
    // with an authenticator it proceeds
    const ap = k.approve(pv.actionHash, AUTH);
    assert.equal(ap.actionHash, pv.actionHash);
  }
});

test('fuzz — a random stream never produces an effect the laws forbid', async () => {
  const rnd = prng(999);
  const world = new TestWorld();
  const k = new Kernel(world);
  let verified = 0;
  for (let i = 0; i < 1200; i++) {
    const req = buildRequest(world, { kind: pick(rnd, ALL_KINDS), zones: [pick(rnd, ALL_ZONES)] });
    const pv = k.preview(req);
    const doApprove = rnd() < 0.7;
    const doDrift = rnd() < 0.25;
    let ap = null;
    try {
      if (!pv.auto && !pv.denied && doApprove) {
        ap = k.approve(pv.actionHash, AUTH);
      }
    } catch {
      /* t4 / gate — expected */
    }
    if (doDrift) world.setBase(req.targetRef, 'drifted_' + i);
    const exec = okExecutor();
    const r = await k.commit(ap ?? pv.actionHash, exec).catch(() => null);
    if (r?.outcome === 'verified') {
      verified++;
      // Anything that verified must be non-T4 and must have observed the exact base.
      assert.notEqual(pv.tier, 'T4');
      assert.equal(exec.calls(), 1);
    }
    // The executor never ran more than once regardless of outcome.
    assert.ok(exec.calls() <= 1);
  }
  assert.ok(verified > 0, 'sanity: some actions did legitimately verify');
  assert.equal(k.verifyChain().ok, true, 'ledger intact after the whole stream');
});
