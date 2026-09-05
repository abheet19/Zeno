/**
 * S1.1 + S1.2 — the receipt chain survives a restart, a damaged ledger is
 * localized to the exact line, and a v1 line written before the self-describing
 * fields existed still verifies alongside a v2 one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, Ledger, hashOf, nodeLedgerStore, sha256Signer } from '../src/index.js';
import type { LedgerStore, Receipt } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

/** An in-memory store honouring the same contract as the node:fs one. */
function memStore(seedText = ''): LedgerStore & { text(): string; set(t: string): void } {
  let text = seedText;
  return {
    append: (line) => {
      text += line + '\n';
    },
    readAll: () => text,
    text: () => text,
    set: (t) => {
      text = t;
    },
  };
}

/** Drive n real actions through a kernel writing to `store`. */
async function seed(store: LedgerStore, world: TestWorld, n: number): Promise<Kernel> {
  const k = new Kernel(world, { store });
  for (let i = 0; i < n; i++) {
    const req = buildRequest(world, { kind: i % 2 ? 'patch.task' : 'read' });
    const pv = k.preview(req);
    const ap = pv.auto ? pv.actionHash : k.approve(pv.actionHash);
    await k.commit(ap, okExecutor());
  }
  return k;
}

test('receipts are written through to the store as they are appended', async () => {
  const store = memStore();
  const k = await seed(store, new TestWorld(), 4);
  const lines = store.text().split('\n').filter(Boolean);
  assert.equal(lines.length, 4, 'one line per receipt');
  assert.equal(lines.length, k.receipts().length);
  // the file ends with a newline, so the last line is complete
  assert.ok(store.text().endsWith('\n'));
});

test('append then load round-trips to a byte-identical, verifying chain (property)', async () => {
  for (const n of [1, 2, 3, 5, 8, 13]) {
    const store = memStore();
    const k = await seed(store, new TestWorld(), n);
    const expected = k.receipts().map((r) => r.selfHash);

    const reloaded = Ledger.load(memStore(store.text()));
    assert.equal(reloaded.verify().ok, true, `n=${n} reloaded chain must verify`);
    assert.equal(reloaded.size(), n);
    assert.deepEqual(
      reloaded.all().map((r) => r.selfHash),
      expected,
      `n=${n} reloaded chain must be identical`,
    );
  }
});

test('RESTART — a new kernel continues the chain from the pre-restart tip', async () => {
  const store = memStore();
  const first = await seed(store, new TestWorld(), 3);
  const tip = first.receipts().at(-1)!.selfHash;

  // process dies; a brand-new Kernel over the same store is the restart
  const world = new TestWorld();
  const restarted = new Kernel(world, { store });
  assert.equal(restarted.verifyChain().ok, true, 'prior receipts load and verify');
  assert.equal(restarted.receipts().length, 3, 'prior receipts are present');

  const pv = restarted.preview(buildRequest(world, { kind: 'read' }));
  const r = await restarted.commit(pv.actionHash, okExecutor());
  assert.equal(r.prevReceipt, tip, 'the next receipt links to the pre-restart tip');
  assert.equal(restarted.verifyChain().ok, true);
  assert.equal(restarted.receipts().length, 4);
  assert.equal(store.text().split('\n').filter(Boolean).length, 4);
});

test('a half-written last line (crash mid-append) is localized at its index', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 4);
  const lines = store.text().split('\n').filter(Boolean);
  // three intact receipts, then a truncated fourth
  store.set(lines.slice(0, 3).join('\n') + '\n' + lines[3]!.slice(0, 25));

  const v = Ledger.load(store).verify();
  assert.equal(v.ok, false, 'a truncated tail is a broken chain, not a shorter one');
  assert.equal(v.firstBreakAt, 3, 'the break is the index of the damaged record');
});

test('an edited line on disk breaks the chain at that index', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 5);
  const lines = store.text().split('\n').filter(Boolean);
  const row = JSON.parse(lines[2]!) as Receipt;
  lines[2] = JSON.stringify({ ...row, summary: 'quietly reworded' });
  store.set(lines.join('\n') + '\n');

  const v = Ledger.load(store).verify();
  assert.equal(v.ok, false);
  assert.equal(v.firstBreakAt, 2);
});

test('CRLF line endings load correctly (this is a Windows-first product)', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 3);
  const crlf = store.text().split('\n').filter(Boolean).join('\r\n') + '\r\n';

  const reloaded = Ledger.load(memStore(crlf));
  assert.equal(reloaded.size(), 3);
  assert.equal(reloaded.verify().ok, true);
});

test('v1 and v2 receipts verify together in one chain', async () => {
  // A receipt exactly as v1 wrote them: no schemaVersion, no self-describing fields.
  const v1Body = {
    id: 'id_legacy',
    actionHash: 'action_legacy',
    outcome: 'verified' as const,
    reason: null,
    casBaseObserved: 'base_legacy',
    externalEffect: { effect: 'provider_receipt_legacy' },
    prevReceipt: null,
    at: '2026-01-01T00:00:00.000Z',
  };
  const v1 = { ...v1Body, selfHash: sha256Signer(hashOf(v1Body)) } as unknown as Receipt;
  assert.equal('schemaVersion' in v1, false, 'the fixture really is a v1 line');

  const store = memStore(JSON.stringify(v1) + '\n');
  const world = new TestWorld();
  const k = new Kernel(world, { store });
  assert.equal(k.verifyChain().ok, true, 'the v1 line alone verifies');

  const pv = k.preview(buildRequest(world, { kind: 'read' }));
  const r = await k.commit(pv.actionHash, okExecutor());

  assert.equal(r.schemaVersion, 2);
  assert.equal(r.prevReceipt, v1.selfHash, 'v2 links onto the v1 tip');
  assert.equal(k.verifyChain().ok, true, 'a mixed-version chain verifies end to end');
});

test('GOLDEN — one receipt line carries everything a capsule needs', async () => {
  const store = memStore();
  const world = new TestWorld();
  const k = new Kernel(world, { store });
  const req = buildRequest(world, {
    kind: 'patch.task',
    summary: 'rewrap a single block in Editor.tsx',
    targetRef: 'demo-repo@a1b2c3d',
  });
  const pv = k.preview(req);
  await k.commit(k.approve(pv.actionHash), okExecutor('provider_receipt_x'));

  // Parse the LINE, not the in-memory object — a renderer only gets this.
  const line = store.text().split('\n').filter(Boolean).at(-1)!;
  const row = JSON.parse(line) as Receipt;

  assert.equal(row.schemaVersion, 2);
  assert.equal(row.kind, 'patch.task');
  assert.equal(row.tier, 'T1');
  assert.equal(row.targetRef, 'demo-repo@a1b2c3d');
  assert.equal(row.summary, 'rewrap a single block in Editor.tsx');
  assert.equal(row.outcome, 'verified');
  assert.equal(row.reason, null);
  assert.equal(row.externalEffect.effect, 'provider_receipt_x');
  assert.equal(row.actionHash, pv.actionHash);
  assert.equal(typeof row.policyHash, 'string');
  assert.ok(row.policyHash.length > 0, 'the governing policy is pinned into the line');
  assert.equal(typeof row.at, 'string');
  assert.equal(typeof row.selfHash, 'string');
});

test('a ledger with no store still works (in-memory kernels are unchanged)', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const pv = k.preview(buildRequest(world, { kind: 'read' }));
  await k.commit(pv.actionHash, okExecutor());
  assert.equal(k.verifyChain().ok, true);
  assert.equal(k.receipts().length, 1);
});

test('REAL FS — receipts survive a process restart through an actual file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ledger-'));
  try {
    const path = join(dir, '.zeno', 'ledger.jsonl');
    const world = new TestWorld();
    const first = new Kernel(world, { store: nodeLedgerStore(path) });
    const pv = first.preview(buildRequest(world, { kind: 'patch.task' }));
    const r1 = await first.commit(first.approve(pv.actionHash), okExecutor());

    // the file exists, is one line, and is what we think it is
    const onDisk = readFileSync(path, 'utf8');
    assert.equal(onDisk.split('\n').filter(Boolean).length, 1);
    assert.equal((JSON.parse(onDisk.split('\n')[0]!) as Receipt).selfHash, r1.selfHash);

    // a fresh kernel over the same path picks the chain back up
    const world2 = new TestWorld();
    const second = new Kernel(world2, { store: nodeLedgerStore(path) });
    assert.equal(second.receipts().length, 1);
    assert.equal(second.verifyChain().ok, true);
    const pv2 = second.preview(buildRequest(world2, { kind: 'read' }));
    const r2 = await second.commit(pv2.actionHash, okExecutor());
    assert.equal(r2.prevReceipt, r1.selfHash);
    assert.equal(readFileSync(path, 'utf8').split('\n').filter(Boolean).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REAL FS — a missing ledger file reads as empty, not as an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ledger-'));
  try {
    const store = nodeLedgerStore(join(dir, 'nope', 'ledger.jsonl'));
    assert.equal(store.readAll(), '');
    assert.equal(Ledger.load(store).verify().ok, true, 'an empty chain is a valid chain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
