/**
 * End-to-end: the headless simulator drives exactly the two journeys the Gate-2
 * Command capsule shows — with no UI and no model — and asserts the whole receipt
 * story, including the OUTCOME_UNKNOWN and T0 auto paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor, failingExecutor } from './harness.js';

const AUTH = { method: 'windows-hello', ref: 'hello_ok' } as const;

test('E2E happy path: await -> approve -> commit -> VERIFIED with a receipt', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);

  // A TASK patch, exactly like WEBEXT-3514 in the prototype.
  const req = buildRequest(world, {
    kind: 'patch.task',
    targetRef: 'browser-add-on@4b098d6',
    base: 'file_4b098d6',
    payload: { file: 'InsertReplace.tsx', hunk: 'wrap <p> on single block' },
  });

  const pv = k.preview(req);
  assert.equal(pv.tier, 'T1');
  assert.equal(pv.auto, false);
  assert.equal(pv.denied, false);

  const ap = k.approve(pv.actionHash); // T1 needs no authenticator
  const exec = okExecutor('jira_tsk_5f2');
  const r = await k.commit(ap, exec);

  assert.equal(r.outcome, 'verified');
  assert.equal(r.externalEffect.effect, 'jira_tsk_5f2');
  assert.equal(exec.calls(), 1);
  assert.equal(k.verifyChain().ok, true);
  // the seal (verified) is backed by a real chained receipt
  assert.equal(k.receipts().at(-1)?.selfHash, r.selfHash);
});

test('E2E drift path: await -> approve -> base moves -> REFUSED, unspent, nothing applied', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, {
    kind: 'patch.task',
    targetRef: 'browser-add-on@4b098d6',
    base: 'file_4b098d6',
  });
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);

  world.setBase('browser-add-on@4b098d6', 'file_d31c7a0'); // teammate pushed

  const exec = okExecutor();
  const r = await k.commit(ap, exec);
  assert.equal(r.outcome, 'refused');
  assert.equal(r.externalEffect.effect, 'none');
  assert.equal(exec.calls(), 0);
  assert.match(r.reason ?? '', /drift/i);
});

test('E2E T2 push requires Windows Hello, then verifies', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'vcs.push', targetRef: 'origin/main', base: 'remote_1' });
  const pv = k.preview(req);
  assert.equal(pv.tier, 'T2');
  const ap = k.approve(pv.actionHash, AUTH);
  const r = await k.commit(ap, okExecutor('push_ok'));
  assert.equal(r.outcome, 'verified');
  assert.equal(r.externalEffect.effect, 'push_ok');
});

test('E2E outcome-unknown: executor fails once -> OUTCOME_UNKNOWN, retry frozen', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'message.send', base: 'm1' });
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash, AUTH);
  const exec = failingExecutor();
  const r = await k.commit(ap, exec);
  assert.equal(r.outcome, 'outcome-unknown');
  assert.equal(exec.calls(), 1);
  // approval is spent; no automatic retry occurs.
  const again = await k.commit(ap, exec);
  assert.equal(again.outcome, 'denied');
  assert.equal(exec.calls(), 1);
});

test('E2E T0 read auto-proceeds without an approval, still receipted', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'read', base: 'r1' });
  const pv = k.preview(req);
  assert.equal(pv.auto, true);
  const r = await k.commit(pv.actionHash, okExecutor('read_done'));
  assert.equal(r.outcome, 'verified');
  assert.equal(k.receipts().length, 1);
});

test('E2E payment is denied end to end', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'payment', base: 'p1' });
  const pv = k.preview(req);
  assert.equal(pv.denied, true);
  const exec = okExecutor();
  const r = await k.commit(pv.actionHash, exec); // commit a denied action
  assert.equal(r.outcome, 'denied');
  assert.equal(exec.calls(), 0);
});
