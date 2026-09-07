/**
 * Memory over the wire, without a wire.
 *
 * `handle` is a function of strings, so these tests are the routes themselves rather
 * than an HTTP client's opinion of them. What is being pinned is governance: an agent
 * cannot write memory, an agent cannot approve its own proposal, the owner can see and
 * delete everything, and an approved write produces exactly one entry and one receipt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, type Receipt, type World } from '@abheet19/zeno-kernel';
import { CONTEXT_FILE, Memory, MEMORY_TARGET_PREFIX, Vault, type NoteStore, type VaultClock } from '@abheet19/zeno-vault';
import { createMemoryRoutes } from '../src/memory-routes.js';

/** A replayable world. `readBase` mirrors the real one's `memory:` branch. */
class TestWorld implements World {
  private t = 0;
  private n = 0;
  readonly approvalTtlMs = 60_000;
  now(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.t++)).toISOString();
  }
  id(): string {
    return `id_${(this.n++).toString(16).padStart(4, '0')}`;
  }
  readBase(targetRef: string): string {
    return targetRef.startsWith(MEMORY_TARGET_PREFIX) ? targetRef.slice(MEMORY_TARGET_PREFIX.length) : 'base';
  }
}

function harness(projectRoot = tmpdir()) {
  const files = new Map<string, string>();
  let t = 0;
  let n = 0;
  const store: NoteStore = {
    readAll: () => new Map(files),
    write: (id, text) => void files.set(id, text),
    remove: (id) => void files.delete(id),
  };
  const clock: VaultClock = {
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(),
    id: () => `mem_${(n++).toString(16).padStart(4, '0')}`,
  };
  const memory = new Memory(new Vault(store, clock));
  const kernel = new Kernel(new TestWorld());
  const receipts: Receipt[] = [];
  const routes = createMemoryRoutes({
    memory,
    kernel,
    vaultRef: 'test-vault',
    projectRoot,
    onReceipt: (r) => void receipts.push(r),
  });
  const body = (o: Record<string, unknown>) => async () => o;
  const none = async () => ({});
  return { memory, kernel, routes, receipts, body, none, files };
}

const Q = new URLSearchParams();

test('a path this module does not own comes back as null, not a 404', async () => {
  const h = harness();
  assert.equal(await h.routes.handle('GET', '/receipts', Q, 'owner', h.none), null);
});

test('an agent cannot write memory directly', async () => {
  const h = harness();
  const r = await h.routes.handle('POST', '/memory', Q, 'proposer', h.body({ description: 'x', body: 'y' }));
  assert.equal(r?.status, 403);
  assert.equal(h.memory.size(), 0);
});

test('the owner writes their own memory without a gate', async () => {
  const h = harness();
  const r = await h.routes.handle(
    'POST',
    '/memory',
    Q,
    'owner',
    h.body({ kind: 'preference', description: 'Small commits.', body: 'One idea each.' }),
  );
  assert.equal(r?.status, 200);
  assert.equal(h.memory.size(), 1);
  assert.equal(h.receipts.length, 0, 'the owner authorising themselves would be theatre');
});

test('a malformed owner write is refused with the field named', async () => {
  const h = harness();
  const r = await h.routes.handle('POST', '/memory', Q, 'owner', h.body({ description: '  ', body: 'x' }));
  assert.equal(r?.status, 400);
  assert.match(String((r?.body['error'] as { message: string }).message), /needs a description/);
});

test('an agent proposal writes nothing until the owner approves it', async () => {
  const h = harness();
  const proposed = await h.routes.handle(
    'POST',
    '/memory/propose',
    Q,
    'proposer',
    h.body({ kind: 'fact', description: 'Ollama serves on 11434.', body: 'Observed during the run.', requestedBy: 'agent:forge' }),
  );
  assert.equal(proposed?.status, 200);
  const preview = proposed?.body['preview'] as { actionHash: string; tier: string; auto: boolean; summary: string };
  assert.equal(preview.tier, 'T1', 'a memory write is not routine');
  assert.equal(preview.auto, false);
  assert.match(preview.summary, /Remember \(fact\): Ollama serves on 11434\./);
  assert.equal(h.memory.size(), 0, 'proposing is not doing');

  // The agent cannot approve its own proposal. Twice over: by role here, and by L6
  // in the kernel if the role check were ever removed.
  const refused = await h.routes.handle('POST', '/memory/approvals', Q, 'proposer', h.body({ actionHash: preview.actionHash }));
  assert.equal(refused?.status, 403);
  assert.equal(h.memory.size(), 0);

  const approved = await h.routes.handle('POST', '/memory/approvals', Q, 'owner', h.body({ actionHash: preview.actionHash }));
  assert.equal(approved?.status, 200);
  assert.equal(h.memory.size(), 1);
  const receipt = approved?.body['receipt'] as Receipt;
  assert.equal(receipt.outcome, 'verified');
  assert.equal(receipt.kind, 'memory.write');
  assert.equal(receipt.tier, 'T1');
  assert.equal(h.receipts.length, 1);
  assert.equal(h.memory.list()[0]?.source, 'agent:forge', 'the entry names who asked for it');
});

test('an approval can be spent exactly once', async () => {
  const h = harness();
  const proposed = await h.routes.handle(
    'POST',
    '/memory/propose',
    Q,
    'proposer',
    h.body({ kind: 'fact', description: 'Once only.', body: '.', requestedBy: 'agent:forge' }),
  );
  const hash = (proposed?.body['preview'] as { actionHash: string }).actionHash;
  await h.routes.handle('POST', '/memory/approvals', Q, 'owner', h.body({ actionHash: hash }));
  const again = await h.routes.handle('POST', '/memory/approvals', Q, 'owner', h.body({ actionHash: hash }));
  assert.equal(again?.status, 404, 'the capsule is gone once it is spent');
  assert.equal(h.memory.size(), 1);
});

test('a proposal the owner never approves is visible and stored nowhere else', async () => {
  const h = harness();
  await h.routes.handle('POST', '/memory/propose', Q, 'proposer', h.body({ description: 'Waiting.', body: '.' }));
  const waiting = await h.routes.handle('GET', '/memory/pending', Q, 'owner', h.none);
  assert.equal((waiting?.body['pending'] as unknown[]).length, 1);
  assert.equal(h.memory.size(), 0);
});

test('the owner can list, filter, recall and delete', async () => {
  const h = harness();
  await h.routes.handle('POST', '/memory', Q, 'owner', h.body({ kind: 'convention', description: 'Receipts are chained.', body: 'Never edit one.' }));
  await h.routes.handle('POST', '/memory', Q, 'owner', h.body({ kind: 'fact', description: 'The daemon is loopback only.', body: '.' }));

  const all = await h.routes.handle('GET', '/memory', Q, 'owner', h.none);
  assert.equal((all?.body['entries'] as unknown[]).length, 2);

  const filtered = await h.routes.handle('GET', '/memory', new URLSearchParams({ kind: 'fact' }), 'owner', h.none);
  assert.equal((filtered?.body['entries'] as unknown[]).length, 1);

  const recalled = await h.routes.handle('GET', '/memory/recall', new URLSearchParams({ q: 'are receipts chained' }), 'owner', h.none);
  const hits = recalled?.body['hits'] as { entry: { description: string }; matched: string[] }[];
  assert.equal(hits[0]?.entry.description, 'Receipts are chained.');
  assert.ok(hits[0]!.matched.length > 0, 'a recall is never a black box');

  const id = (all?.body['entries'] as { id: string }[])[0]!.id;
  const denied = await h.routes.handle('DELETE', `/memory/${id}`, Q, 'proposer', h.none);
  assert.equal(denied?.status, 403);
  const gone = await h.routes.handle('DELETE', `/memory/${id}`, Q, 'owner', h.none);
  assert.equal(gone?.body['forgotten'], true);
  assert.equal(h.memory.size(), 1);
});

test('recall with no query says what is missing', async () => {
  const h = harness();
  const r = await h.routes.handle('GET', '/memory/recall', Q, 'owner', h.none);
  assert.equal(r?.status, 400);
  assert.match(String((r?.body['error'] as { resolve: string }).resolve), /q=/);
});

test('the context route assembles ZENO.md, the relevant memory, and the framing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ctx-route-'));
  try {
    writeFileSync(join(dir, CONTEXT_FILE), '# This project\n\nCommits are small.\n', 'utf8');
    const h = harness(dir);
    await h.routes.handle('POST', '/memory', Q, 'owner', h.body({ kind: 'decision', description: 'Ledger receipts are chained.', body: 'Never edit one.' }));
    const r = await h.routes.handle('GET', '/memory/context', new URLSearchParams({ task: 'verify the receipts ledger' }), 'proposer', h.none);
    const prompt = String(r?.body['prompt']);
    assert.ok(prompt.includes('Commits are small.'));
    assert.ok(prompt.includes('Ledger receipts are chained.'));
    assert.ok(prompt.includes('RECORDS, not orders'));
    assert.ok(prompt.trimEnd().endsWith('verify the receipts ledger'), "the owner's task is last");
    assert.equal((r?.body['contextFile'] as { path: string }).path, join(dir, CONTEXT_FILE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a project with no ZENO.md still gets a context, and says there is no file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ctx-route-'));
  try {
    const h = harness(dir);
    const r = await h.routes.handle('GET', '/memory/context', new URLSearchParams({ task: 'anything' }), 'owner', h.none);
    assert.equal(r?.body['contextFile'], null);
    assert.match(String(r?.body['prompt']), /no ZENO\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown /memory route lists the ones that exist', async () => {
  const h = harness();
  const r = await h.routes.handle('POST', '/memory/nope', Q, 'owner', h.none);
  assert.equal(r?.status, 404);
  assert.match(String((r?.body['error'] as { resolve: string }).resolve), /\/memory\/propose/);
});
