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

test('the two agent-tool kinds are approvable, and never routine', () => {
  const world = new TestWorld();
  // `shell.exec` — a command on the owner's real machine. T3: approvable, but at
  // the top of the approvable range and above every kind whose damage is bounded.
  const shell = classify(buildRequest(world, { kind: 'shell.exec', zones: ['personal'] }), DEFAULT_POLICY);
  assert.equal(shell.tier, 'T3');
  // `net.fetch` — bytes leaving the machine. T2 is the first tier that demands
  // an authenticator, which is the line that matters: nothing about egress can
  // ever be auto-applied.
  const net = classify(buildRequest(world, { kind: 'net.fetch', zones: ['external'] }), DEFAULT_POLICY);
  assert.equal(net.tier, 'T2');
  for (const c of [shell, net]) {
    assert.ok(tierRank(c.tier) >= tierRank('T1'), 'neither may ever fall into the auto-applied T0 band');
  }
});

test('a policy that has never heard of the agent-tool kinds refuses to load', () => {
  // The fail-closed half. An owner carrying forward a policy.json written before
  // these kinds existed must be stopped, not quietly run with a gap — a kind the
  // policy does not mention is a kind whose tier nobody chose.
  for (const missing of ['shell.exec', 'net.fetch'] as const) {
    const kindTier: Record<string, unknown> = { ...DEFAULT_POLICY.kindTier };
    delete kindTier[missing];
    assert.throws(
      () => validatePolicy({ ...DEFAULT_POLICY, kindTier } as unknown as Policy),
      (e) => e instanceof PolicyError && e.message.includes(missing),
      `a policy with no tier for "${missing}" must refuse to load`,
    );
  }
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
