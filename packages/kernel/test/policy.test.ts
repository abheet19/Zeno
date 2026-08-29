/** Policy validation, tier math, zone escalation, and kernel error paths. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, DEFAULT_POLICY, maxTier, tierRank, validatePolicy, classify, type Policy } from '../src/index.js';
import { PolicyError } from '../src/types.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

test('tier math: rank and max', () => {
  assert.equal(tierRank('T0'), 0);
  assert.equal(tierRank('T4'), 4);
  assert.equal(maxTier('T1', 'T3'), 'T3');
  assert.equal(maxTier('T2', 'T0'), 'T2');
});

test('validatePolicy rejects malformed policies', () => {
  assert.throws(() => validatePolicy({} as unknown as Policy), (e) => e instanceof PolicyError && e.code === 'policy-schema-invalid');
  // missing a kind
  const noKind = { ...DEFAULT_POLICY, kindTier: { ...DEFAULT_POLICY.kindTier, 'vcs.push': undefined } } as unknown as Policy;
  assert.throws(() => validatePolicy(noKind), (e) => e instanceof PolicyError);
  // payment not T4 is rejected
  const softPay = { ...DEFAULT_POLICY, kindTier: { ...DEFAULT_POLICY.kindTier, payment: 'T1' } } as unknown as Policy;
  assert.throws(() => validatePolicy(softPay), (e) => e instanceof PolicyError && /payment/i.test(e.message));
});

test('the kernel refuses to construct with a bad policy', () => {
  const bad = { version: '', kindTier: {}, zoneTier: {} } as unknown as Policy;
  assert.throws(() => new Kernel(new TestWorld(), { policy: bad }), (e) => e instanceof PolicyError);
});

test('classify: company zone does not raise by default; financial forces T4', () => {
  const world = new TestWorld();
  const a = classify(buildRequest(world, { kind: 'patch.task', zones: ['company'] }), DEFAULT_POLICY);
  assert.equal(a.tier, 'T1');
  const b = classify(buildRequest(world, { kind: 'read', zones: ['financial'] }), DEFAULT_POLICY);
  assert.equal(b.tier, 'T4');
  assert.ok(b.reasons.some((r) => /financial/.test(r)));
});

test('committing an unknown (never previewed) action throws', async () => {
  const k = new Kernel(new TestWorld());
  await assert.rejects(() => k.commit('deadbeef', okExecutor()), (e) => e instanceof PolicyError && e.code === 'unknown-action');
});

test('approving twice is rejected (state guard)', () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const pv = k.preview(buildRequest(world, { kind: 'patch.task' }));
  k.approve(pv.actionHash);
  assert.throws(() => k.approve(pv.actionHash), (e) => e instanceof PolicyError && e.code === 'not-previewed');
});

test('an expired approval yields EXPIRED, no effect', async () => {
  const world = new TestWorld();
  world.approvalTtlMs = 5_000; // 5s TTL
  const k = new Kernel(world);
  const pv = k.preview(buildRequest(world, { kind: 'patch.task', targetRef: 'r/exp', base: 'e1' }));
  const ap = k.approve(pv.actionHash);
  world.tick(30); // advance 30s past expiry
  const exec = okExecutor();
  const r = await k.commit(ap, exec);
  assert.equal(r.outcome, 'expired');
  assert.equal(exec.calls(), 0);
});

test('classify() on the kernel returns tier + reasons without side effects', () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const c = k.classify(buildRequest(world, { kind: 'vcs.mr' }));
  assert.equal(c.tier, 'T3');
  assert.equal(k.receipts().length, 0, 'classify writes no receipts');
});
