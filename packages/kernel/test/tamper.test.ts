/**
 * The hardening suite: everything an adversarial review found that the happy
 * path never touches.
 *
 * Each of these was a real defect. A hash chain cannot see its own tail being
 * cut off; a reader that throws on a hand-edited line cannot report the break it
 * exists to report; a kernel that boots on a damaged ledger buries the evidence;
 * and a policy that fails OPEN is worse than no policy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Kernel,
  Ledger,
  PolicyError,
  nodeLedgerFiles,
  nodeLedgerStore,
  readPolicyFile,
} from '../src/index.js';
import type { LedgerStore } from '../src/index.js';
import { TestWorld, buildRequest, failingExecutor, okExecutor } from './harness.js';

/** In-memory store WITH the truncation anchor, as the node one has. */
function memStore(seedText = ''): LedgerStore & { text(): string; set(t: string): void } {
  let text = seedText;
  let head: string | null = null;
  return {
    append: (line) => {
      text += line + '\n';
    },
    readAll: () => text,
    readHead: () => head,
    writeHead: (h) => {
      head = h;
    },
    text: () => text,
    set: (t) => {
      text = t;
    },
  };
}

async function seed(store: LedgerStore, world: TestWorld, n: number): Promise<Kernel> {
  const k = new Kernel(world, { store });
  for (let i = 0; i < n; i++) {
    const pv = k.preview(buildRequest(world, { kind: i % 2 ? 'patch.task' : 'read' }));
    const ap = pv.auto ? pv.actionHash : k.approve(pv.actionHash);
    await k.commit(ap, okExecutor());
  }
  return k;
}

// ── the chain cannot see its own tail without an anchor ─────────────────────

test('DELETING RECEIPTS FROM THE END is detected', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 4);
  const lines = store.text().split('\n').filter(Boolean);
  store.set(lines.slice(0, 2).join('\n') + '\n'); // drop the last two

  const v = Ledger.load(store).verify();
  assert.equal(v.ok, false, 'a truncated tail is still a broken chain');
  assert.match(v.reason ?? '', /removed from the end/);
});

test('a store with no anchor simply cannot detect tail truncation', async () => {
  // Documenting the honest limit: without the head record, the remaining prefix
  // is perfectly self-consistent and nothing can tell.
  const store = memStore();
  await seed(store, new TestWorld(), 4);
  const lines = store.text().split('\n').filter(Boolean);
  const anchorless: LedgerStore = {
    append: () => {},
    readAll: () => lines.slice(0, 2).join('\n') + '\n',
  };
  assert.equal(Ledger.load(anchorless).verify().ok, true);
});

// ── a reader must REPORT damage, never crash on it ──────────────────────────

test('a literal null line is reported, not thrown', () => {
  const v = Ledger.fromJSONL('null').verify();
  assert.equal(v.ok, false);
  assert.equal(v.firstBreakAt, 0);
});

test('lines that are valid JSON but not receipts are reported, not thrown', () => {
  for (const junk of ['42', '"a string"', '[1,2,3]', 'true']) {
    const v = Ledger.fromJSONL(junk).verify();
    assert.equal(v.ok, false, `${junk} must not verify`);
    assert.equal(v.firstBreakAt, 0);
  }
});

test('an object with no selfHash is reported at its index', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 2);
  const lines = store.text().split('\n').filter(Boolean);
  lines[1] = JSON.stringify({ id: 'x', outcome: 'verified' });
  const v = Ledger.fromJSONL(lines.join('\n')).verify();
  assert.equal(v.ok, false);
  assert.equal(v.firstBreakAt, 1);
  assert.match(v.reason ?? '', /no hash of its own/);
});

// ── the kernel must not build on a broken foundation ────────────────────────

test('the kernel REFUSES TO BOOT on a damaged ledger', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 3);
  const lines = store.text().split('\n').filter(Boolean);
  store.set(lines[0] + '\n' + lines[1]!.slice(0, 20)); // crash mid-append

  assert.throws(
    () => new Kernel(new TestWorld(), { store }),
    (e: unknown) => e instanceof PolicyError && e.code === 'chain-broken',
    'appending onto a damaged chain would bury the evidence of what broke it',
  );
});

// ── a failed write must never fork the chain or become a lie ────────────────

test('a ledger write failure surfaces as an error, never as "nothing happened"', async () => {
  const world = new TestWorld();
  let armed = false;
  const store: LedgerStore = {
    append: () => {
      if (armed) throw new Error('EBUSY: the ledger is locked');
    },
    readAll: () => '',
  };
  const k = new Kernel(world, { store });
  const pv = k.preview(buildRequest(world, { kind: 'patch.task' }));
  const ap = k.approve(pv.actionHash);

  armed = true;
  const exec = okExecutor('REAL_EFFECT_THAT_HAPPENED');
  await assert.rejects(() => k.commit(ap, exec), /ledger is locked/);
  assert.equal(exec.calls(), 1, 'the effect really did happen');
  assert.equal(k.receipts().length, 0, 'and nothing entered the chain claiming otherwise');
});

test('a failed append leaves the in-memory chain level with disk, never ahead', async () => {
  const world = new TestWorld();
  let armed = false;
  let written = 0;
  const store: LedgerStore = {
    append: () => {
      if (armed) throw new Error('disk full');
      written++;
    },
    readAll: () => '',
  };
  const k = new Kernel(world, { store });
  const first = k.preview(buildRequest(world, { kind: 'read' }));
  await k.commit(first.actionHash, okExecutor());
  assert.equal(written, 1);

  armed = true;
  const second = k.preview(buildRequest(world, { kind: 'read' }));
  await assert.rejects(() => k.commit(second.actionHash, okExecutor()));
  assert.equal(k.receipts().length, written, 'memory never runs ahead of the store');
  assert.equal(k.verifyChain().ok, true, 'so the chain never forks');
});

// ── one attempt means one attempt ───────────────────────────────────────────

test('re-previewing a SPENT action does not grant it a second attempt', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'patch.task' });

  const pv = k.preview(req);
  const exec = okExecutor();
  const r1 = await k.commit(k.approve(pv.actionHash), exec);
  assert.equal(r1.outcome, 'verified');
  assert.equal(exec.calls(), 1);

  const again = k.preview(req); // the identical action, asked for a second time
  assert.equal(again.actionHash, pv.actionHash, 'identical action, identical identity');
  assert.throws(() => k.approve(again.actionHash), (e: unknown) => e instanceof PolicyError);
  const r2 = await k.commit(again.actionHash, exec);
  assert.equal(r2.outcome, 'denied');
  assert.equal(exec.calls(), 1, 'the executor never ran twice for one action');
});

test('an OUTCOME_UNKNOWN cannot be retried by simply previewing again (L2)', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = buildRequest(world, { kind: 'patch.task' });
  const pv = k.preview(req);
  const flaky = failingExecutor();
  const r1 = await k.commit(k.approve(pv.actionHash), flaky);
  assert.equal(r1.outcome, 'outcome-unknown');
  assert.equal(flaky.calls(), 1);

  const retry = k.preview(req);
  const ok = okExecutor();
  const r2 = await k.commit(retry.actionHash, ok);
  assert.equal(r2.outcome, 'denied', 'an unprovable result stays frozen');
  assert.equal(ok.calls(), 0);
});

// ── the identity must cover what the owner was shown ────────────────────────

test('the action identity covers KIND and SUMMARY, not just the payload', () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const base = buildRequest(world, { kind: 'vcs.commit', summary: 'commit the fix' });

  const a = k.preview(base);
  const differentSentence = k.preview({ ...base, summary: 'delete the branch' });
  const differentKind = k.preview({ ...base, kind: 'patch.task' }); // also T1

  assert.notEqual(a.actionHash, differentSentence.actionHash, 'the owner approves a SENTENCE');
  assert.notEqual(a.actionHash, differentKind.actionHash, 'and a KIND of action');
});

// ── policy and ledger must fail CLOSED, not open ────────────────────────────

test('an unreadable policy file throws instead of falling back to the looser default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-pol-'));
  try {
    // A directory where a file is expected: readable path, unreadable content.
    assert.throws(
      () => readPolicyFile(dir),
      (e: unknown) => e instanceof PolicyError && /cannot be read/.test((e as Error).message),
      'the unreadable policy is often the STRICTER one',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REAL FS — a deleted ledger is caught, not reported as a clean empty chain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-del-'));
  try {
    const path = join(dir, 'ledger.jsonl');
    const world = new TestWorld();
    await seed(nodeLedgerStore(path), world, 2);

    rmSync(path, { force: true }); // the receipts are gone; the anchor remains
    const v = Ledger.load(nodeLedgerStore(path)).verify();
    assert.equal(v.ok, false, 'deleting the audit log must not read as "nothing ever happened"');
    assert.match(v.reason ?? '', /removed from the end/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REAL FS — a crash-truncated line is not welded onto by the next append', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-weld-'));
  try {
    const path = join(dir, 'ledger.jsonl');
    const world = new TestWorld();
    await seed(nodeLedgerStore(path), world, 2);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    // simulate a crash mid-append: a partial line with no trailing newline
    writeFileSync(path, lines.join('\n') + '\n' + '{"id":"partial","act', 'utf8');

    nodeLedgerStore(path).append('{"appended":"later"}');
    const after = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    assert.equal(after.length, 4, 'the new line is its own line, not glued to the fragment');
    assert.equal(after[3], '{"appended":"later"}');
    assert.equal(after[2], '{"id":"partial","act', 'the damaged fragment is left intact for inspection');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nodeLedgerFiles names every file a reset must remove', () => {
  const files = nodeLedgerFiles('/x/ledger.jsonl');
  assert.equal(files.length, 2);
  assert.ok(files.includes('/x/ledger.jsonl'));
  assert.ok(files.some((f) => f.endsWith('.head.json')));
});

test('a UTF-8 BOM is an encoding wrapper, not damage', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 2);
  // Windows editors (and PowerShell's Set-Content -Encoding utf8) add this.
  const withBom = '﻿' + store.text();
  const v = Ledger.fromJSONL(withBom).verify();
  assert.equal(v.ok, true, 'a re-encoded but unedited ledger must still verify');
  assert.equal(Ledger.fromJSONL(withBom).size(), 2);
});

test('a BOM does not mask a real edit — the hash reason still wins', async () => {
  const store = memStore();
  await seed(store, new TestWorld(), 2);
  const lines = store.text().split('\n').filter(Boolean);
  const row = JSON.parse(lines[0]!) as { summary?: string };
  lines[0] = JSON.stringify({ ...row, summary: 'reworded' });
  const v = Ledger.fromJSONL('﻿' + lines.join('\n')).verify();
  assert.equal(v.ok, false);
  assert.equal(v.firstBreakAt, 0);
  assert.match(v.reason ?? '', /no longer matches its own hash/, 'the REAL reason, not a parse error');
});

test('ONE ATTEMPT survives a restart — the ledger remembers, not just memory', async () => {
  const store = memStore();
  const w1 = new TestWorld();
  const k1 = new Kernel(w1, { store });
  const req = buildRequest(w1, { kind: 'patch.task' });
  const pv = k1.preview(req);
  const exec1 = okExecutor();
  assert.equal((await k1.commit(k1.approve(pv.actionHash), exec1)).outcome, 'verified');

  // the process dies; a fresh kernel has an EMPTY pending map
  const restarted = new Kernel(new TestWorld(), { store });
  const again = restarted.preview(req);
  assert.equal(again.actionHash, pv.actionHash, 'the same action has the same identity');

  const exec2 = okExecutor();
  assert.throws(() => restarted.approve(again.actionHash), (e: unknown) => e instanceof PolicyError);
  const r = await restarted.commit(again.actionHash, exec2);
  assert.equal(r.outcome, 'denied', 'a restart must not hand a spent action a second life');
  assert.equal(exec2.calls(), 0);
});

test('a REFUSED action stays re-previewable across a restart (refusal is not terminal)', async () => {
  const store = memStore();
  const world = new TestWorld();
  const k = new Kernel(world, { store });
  const req = buildRequest(world, { kind: 'patch.task' });
  const pv = k.preview(req);
  const ap = k.approve(pv.actionHash);
  world.setBase(req.targetRef, 'someone_else_moved_it'); // drift
  assert.equal((await k.commit(ap, okExecutor())).outcome, 'refused');

  const restarted = new Kernel(new TestWorld(), { store });
  const fresh = restarted.preview(req);
  assert.equal(fresh.denied, false);
  assert.doesNotThrow(() => restarted.approve(fresh.actionHash), 'a refusal invites a fresh decision');
});
