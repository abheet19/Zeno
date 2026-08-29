/** L3 — compare-and-swap: drift at commit refuses, approval unspent, zero effect. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor, prng } from './harness.js';

test('drift between approve and commit => REFUSED, unspent, no effect', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'patch.task', targetRef: 'repo/a@head', base: 'v_4b098d6' });
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);

  // someone else changes the base underneath us
  world.setBase('repo/a@head', 'v_d31c7a0');

  const exec = okExecutor();
  const refused = await k.commit(ap, exec);
  assert.equal(refused.outcome, 'refused');
  assert.equal(exec.calls(), 0, 'nothing applied');
  assert.match(refused.reason ?? '', /drift/i);
  assert.equal(refused.casBaseObserved, 'v_d31c7a0');

  // approval was NOT spent: re-preview against the new base and it now commits.
  const req2 = buildRequest(world, { kind: 'patch.task', targetRef: 'repo/a@head', base: 'v_d31c7a0' });
  const pv2 = k.preview(req2);
  const ap2 = k.approve(pv2.actionHash);
  const ok = await k.commit(ap2, exec);
  assert.equal(ok.outcome, 'verified');
  assert.equal(exec.calls(), 1);
});

test('property — under random drift, a drifted commit NEVER applies', async () => {
  const rnd = prng(313);
  for (let i = 0; i < 500; i++) {
    const world = new TestWorld();
    const k = new Kernel(world);
    const req = buildRequest(world, { kind: 'vcs.commit', targetRef: `t${i}`, base: `b${i}` });
    const pv = k.preview(req);
    const ap = k.approve(pv.actionHash);
    const drift = rnd() < 0.5;
    if (drift) world.setBase(`t${i}`, `b${i}_moved`);
    const exec = okExecutor();
    const r = await k.commit(ap, exec);
    if (drift) {
      assert.equal(r.outcome, 'refused');
      assert.equal(exec.calls(), 0);
    } else {
      assert.equal(r.outcome, 'verified');
      assert.equal(exec.calls(), 1);
    }
  }
});
