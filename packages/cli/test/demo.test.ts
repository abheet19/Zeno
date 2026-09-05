/**
 * S1.4 — the demo is the smoke test. If these pass, the governance argument the
 * demo makes on screen is literally true rather than merely printed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Receipt } from '@abheet19/zeno-kernel';
import { demoProblems, runDemo } from '../src/demo.js';
import { verifyLedger } from '../src/verify.js';

const quiet = (): void => {};

/**
 * Run `fn` against a throwaway workspace and always clean up.
 *
 * The `await` matters: without it a `finally` fires the instant an async `fn`
 * hits its first suspension point, deleting the directory out from under the
 * work still running inside it.
 */
async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-demo-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the demo produces exactly one verified and one refused receipt', async () => {
  await withTempDir(async (dir) => {
    const r = await runDemo({ dir, resume: false, log: quiet });
    assert.deepEqual(demoProblems(r), [], 'the demo must pass its own invariants');
    assert.equal(r.verified.outcome, 'verified');
    assert.equal(r.refused.outcome, 'refused');

    const v = verifyLedger(dir);
    assert.equal(v.ok, true);
    assert.equal(v.count, 2);
    assert.deepEqual(
      v.rows.map((x) => x.outcome),
      ['verified', 'refused'],
    );
  });
});

test('the refused journey never invoked the executor and left the file untouched', async () => {
  await withTempDir(async (dir) => {
    const r = await runDemo({ dir, resume: false, log: quiet });
    assert.equal(r.refusedExecutorCalls, 0, 'a refused action must not reach the executor at all');
    assert.match(
      r.driftTargetContents ?? '',
      /aria-label="Zeno"/,
      'the target still holds the other edit, not ours',
    );
    assert.doesNotMatch(r.driftTargetContents ?? '', /role="toolbar"/, 'our change was never applied');
  });
});

test('the verified journey really changed a file on disk', async () => {
  await withTempDir(async (dir) => {
    await runDemo({ dir, resume: false, log: quiet });
    const written = readFileSync(join(dir, 'sandbox', 'src', 'Editor.tsx'), 'utf8');
    assert.match(written, /wrapIfSingleBlock/, 'the approved change is on disk');
  });
});

test('re-running the demo is deterministic — always exactly two receipts', async () => {
  await withTempDir(async (dir) => {
    await runDemo({ dir, resume: false, log: quiet });
    await runDemo({ dir, resume: false, log: quiet });
    const v = verifyLedger(dir);
    assert.equal(v.count, 2, 'a fresh run starts from a clean ledger');
    assert.equal(v.ok, true);
  });
});

test('--resume keeps the prior chain and links the new receipts onto it', async () => {
  await withTempDir(async (dir) => {
    const first = await runDemo({ dir, resume: false, log: quiet });
    const tip = first.refused.selfHash;

    const second = await runDemo({ dir, resume: true, log: quiet });
    assert.equal(second.priorReceipts, 2, 'the prior receipts were loaded, not discarded');
    assert.equal(second.verified.prevReceipt, tip, 'the new chain links onto the old tip');

    const v = verifyLedger(dir);
    assert.equal(v.count, 4);
    assert.equal(v.ok, true, 'a chain spanning two runs still verifies end to end');
  });
});

test('editing one line of the audit log is caught at exactly that index', async () => {
  await withTempDir(async (dir) => {
    await runDemo({ dir, resume: false, log: quiet });
    const path = join(dir, 'ledger.jsonl');
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const row = JSON.parse(lines[0]!) as Receipt;
    lines[0] = JSON.stringify({ ...row, summary: 'something else entirely' });
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');

    const v = verifyLedger(dir);
    assert.equal(v.ok, false);
    assert.equal(v.firstBreakAt, 0);
  });
});

test('a truncated audit log is reported as broken, not as a shorter one', async () => {
  await withTempDir(async (dir) => {
    await runDemo({ dir, resume: false, log: quiet });
    const path = join(dir, 'ledger.jsonl');
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    writeFileSync(path, lines[0]! + '\n' + lines[1]!.slice(0, 30), 'utf8');

    const v = verifyLedger(dir);
    assert.equal(v.ok, false);
    assert.equal(v.firstBreakAt, 1);
  });
});

test('an empty workspace verifies as an empty chain rather than erroring', async () => {
  await withTempDir((dir) => {
    const v = verifyLedger(dir);
    assert.equal(v.ok, true);
    assert.equal(v.count, 0);
  });
});
