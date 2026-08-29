/**
 * Determinism / replay: the same inputs through the same injected World produce a
 * byte-identical ledger. This is the property that makes the whole kernel auditable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor, failingExecutor, prng, pick, ALL_KINDS } from './harness.js';

async function run(seed: number): Promise<string> {
  // reset the shared request sequence indirectly by using deterministic targets
  const rnd = prng(seed);
  const world = new TestWorld();
  const k = new Kernel(world);
  for (let i = 0; i < 40; i++) {
    const kind = pick(rnd, ALL_KINDS);
    const target = `repo/det@${i}`;
    world.setBase(target, `base_${i}`);
    const req = {
      kind,
      summary: `det #${i}`,
      targetRef: target,
      payload: { i },
      baseHash: `base_${i}`,
      requestedBy: `agent_${i % 2}`,
      dataZones: ['personal'] as const,
    };
    const pv = k.preview(req);
    let approvalOrHash: ReturnType<Kernel['approve']> | string = pv.actionHash;
    if (!pv.auto && !pv.denied) {
      try {
        approvalOrHash = k.approve(pv.actionHash, { method: 'deferred', ref: 'x' });
      } catch {
        approvalOrHash = pv.actionHash;
      }
    }
    const exec = rnd() < 0.2 ? failingExecutor() : okExecutor();
    await k.commit(approvalOrHash, exec).catch(() => undefined);
  }
  return k.ledgerJSONL();
}

test('same inputs + same injected world => identical ledger', async () => {
  const a = await run(2026);
  const b = await run(2026);
  assert.equal(a, b, 'ledgers must be byte-identical across replays');
  assert.ok(a.length > 0);
});

test('different seeds generally diverge (sanity — the test is not trivially constant)', async () => {
  const a = await run(1);
  const b = await run(2);
  assert.notEqual(a, b);
});
