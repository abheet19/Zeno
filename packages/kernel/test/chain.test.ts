/** The ledger is tamper-evident: any edit/deletion breaks the chain and verifyChain localizes it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, Ledger } from '../src/index.js';
import type { Receipt } from '../src/types.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

async function seedLedger(): Promise<Receipt[]> {
  const world = new TestWorld();
  const k = new Kernel(world);
  for (let i = 0; i < 6; i++) {
    const req = buildRequest(world, { kind: i % 2 ? 'patch.task' : 'read' });
    const pv = k.preview(req);
    const ap = pv.auto ? pv.actionHash : k.approve(pv.actionHash);
    await k.commit(ap, okExecutor());
  }
  assert.equal(k.verifyChain().ok, true);
  return [...k.receipts()];
}

test('a clean chain verifies', async () => {
  const rows = await seedLedger();
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  assert.equal(Ledger.fromJSONL(jsonl).verify().ok, true);
});

test('editing a past receipt breaks the chain at that index', async () => {
  const rows = await seedLedger();
  // tamper with row 3's reason field
  const tampered = rows.map((r, i) => (i === 3 ? { ...r, reason: 'tampered' } : r));
  const jsonl = tampered.map((r) => JSON.stringify(r)).join('\n');
  const v = Ledger.fromJSONL(jsonl).verify();
  assert.equal(v.ok, false);
  assert.equal(v.firstBreakAt, 3);
});

test('deleting a receipt breaks continuity', async () => {
  const rows = await seedLedger();
  const withHole = rows.filter((_, i) => i !== 2);
  const jsonl = withHole.map((r) => JSON.stringify(r)).join('\n');
  const v = Ledger.fromJSONL(jsonl).verify();
  assert.equal(v.ok, false);
  // the first row whose prevReceipt no longer matches is the old index-3 (now 2)
  assert.equal(v.firstBreakAt, 2);
});
