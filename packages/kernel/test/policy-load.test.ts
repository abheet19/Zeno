/**
 * S1.3 — policy read from a file, validated, and hash-pinned into every receipt.
 *
 * The theme of these tests: a policy document is only useful if a mistake in it
 * is LOUD. A policy that reads stricter than it behaves is the worst outcome, so
 * every ambiguity is a refusal to start rather than a silently ignored line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_POLICY,
  Kernel,
  PolicyError,
  loadPolicy,
  policyHash,
  readPolicyFile,
} from '../src/index.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

/** Assert a PolicyError that actually tells the owner what to do about it. */
function assertLegible(fn: () => unknown, match: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof PolicyError, 'must be a PolicyError');
    assert.equal(e.code, 'policy-schema-invalid');
    assert.match(e.message, match);
    assert.ok(e.resolve.length > 0, 'every policy error names the fix');
    return true;
  });
}

test('the default policy round-trips through JSON unchanged', () => {
  const loaded = loadPolicy(JSON.stringify(DEFAULT_POLICY));
  assert.deepEqual(loaded, DEFAULT_POLICY);
  assert.equal(policyHash(loaded), policyHash(DEFAULT_POLICY));
});

test('malformed JSON refuses to start, legibly', () => {
  assertLegible(() => loadPolicy('{ this is not json '), /not valid JSON/);
});

test('a policy that is not an object refuses to start', () => {
  assertLegible(() => loadPolicy('[]'), /must be a JSON object/);
  assertLegible(() => loadPolicy('"a policy"'), /must be a JSON object/);
  assertLegible(() => loadPolicy('null'), /must be a JSON object/);
});

test('a policy with no kindTier refuses to start', () => {
  assertLegible(() => loadPolicy('{"version":"x"}'), /missing a "kindTier"/);
});

test('a policy with no version refuses to start', () => {
  const p = JSON.stringify({ kindTier: DEFAULT_POLICY.kindTier });
  assertLegible(() => loadPolicy(p), /missing a version/);
});

test('a policy that fails to deny payments is rejected', () => {
  const p = JSON.stringify({
    version: 'lax',
    kindTier: { ...DEFAULT_POLICY.kindTier, payment: 'T3' },
  });
  assertLegible(() => loadPolicy(p), /must classify "payment" as T4/);
});

test('a policy missing one action kind is rejected', () => {
  const kindTier: Record<string, string> = { ...DEFAULT_POLICY.kindTier };
  delete kindTier['vcs.push'];
  assertLegible(
    () => loadPolicy(JSON.stringify({ version: 'gappy', kindTier })),
    /no valid tier for action kind "vcs.push"/,
  );
});

test('a MISSPELLED data zone is rejected, never silently ignored', () => {
  // "financal" would quietly never match, leaving a policy that reads as
  // forbidding financial actions while actually permitting them.
  const p = JSON.stringify({
    version: 'typo',
    kindTier: DEFAULT_POLICY.kindTier,
    zoneTier: { financal: 'T4' },
  });
  assertLegible(() => loadPolicy(p), /unknown data zone "financal"/);
});

test('an unrankable tier value is rejected', () => {
  const p = JSON.stringify({
    version: 'bad-tier',
    kindTier: DEFAULT_POLICY.kindTier,
    zoneTier: { financial: 'T9' },
  });
  assertLegible(() => loadPolicy(p), /invalid tier "T9"/);
});

test('a zoneTier that is not an object is rejected', () => {
  const p = JSON.stringify({
    version: 'x',
    kindTier: DEFAULT_POLICY.kindTier,
    zoneTier: ['financial'],
  });
  assertLegible(() => loadPolicy(p), /"zoneTier" must be an object/);
});

test('a policy that drops the financial floor is rejected (L7 has two halves)', () => {
  // Omitting zoneTier entirely leaves anything merely TOUCHING financial data
  // at its kind's own tier — which makes it approvable. Enforcing only the
  // payment half of L7 would let a policy file delete the other half.
  assertLegible(
    () => loadPolicy(JSON.stringify({ version: 'minimal', kindTier: DEFAULT_POLICY.kindTier })),
    /"financial" data zone at T4/,
  );
});

test('an unknown action kind classifies to T4, never to undefined', () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = { ...buildRequest(world, {}), kind: 'totally.made.up' as never };
  const pv = k.preview(req);
  assert.equal(pv.tier, 'T4', 'ambiguity rounds UP');
  assert.equal(pv.denied, true);
  assert.throws(() => k.approve(pv.actionHash), (e) => e instanceof PolicyError && e.code === 't4-denied');
});

test('DONE — editing the policy raises the tier and changes the pinned hash', async () => {
  // Baseline: a sandbox write is T0, so it needs no owner approval.
  const w1 = new TestWorld();
  const base = new Kernel(w1);
  const pvBase = base.preview(buildRequest(w1, { kind: 'local.write' }));
  assert.equal(pvBase.tier, 'T0');
  assert.equal(pvBase.auto, true);
  await base.commit(pvBase.actionHash, okExecutor());
  const hashBefore = base.receipts().at(-1)!.policyHash;
  assert.equal(hashBefore, policyHash(DEFAULT_POLICY));

  // Now the owner edits policy.json to demand approval for sandbox writes.
  const raised = loadPolicy(
    JSON.stringify({
      version: '2026-09-04.stricter',
      kindTier: { ...DEFAULT_POLICY.kindTier, 'local.write': 'T1' },
      zoneTier: DEFAULT_POLICY.zoneTier,
    }),
  );
  const w2 = new TestWorld();
  const stricter = new Kernel(w2, { policy: raised });
  const pvRaised = stricter.preview(buildRequest(w2, { kind: 'local.write' }));

  assert.equal(pvRaised.tier, 'T1', 'the file edit really changed the classification');
  assert.equal(pvRaised.auto, false, 'and it really removed auto-approval');
  await stricter.commit(stricter.approve(pvRaised.actionHash), okExecutor());

  const hashAfter = stricter.receipts().at(-1)!.policyHash;
  assert.equal(hashAfter, policyHash(raised));
  assert.notEqual(hashAfter, hashBefore, 'the receipt proves WHICH rules governed it');
});

test('readPolicyFile: absent is null, present is parsed, present-but-broken throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-policy-'));
  try {
    assert.equal(readPolicyFile(join(dir, 'nope.json')), null, 'absent falls back to the default');

    const good = join(dir, 'policy.json');
    writeFileSync(good, JSON.stringify(DEFAULT_POLICY), 'utf8');
    assert.deepEqual(readPolicyFile(good), DEFAULT_POLICY);

    // A corrupt file must NOT quietly become the built-in policy — the corrupt
    // one may have been the stricter of the two.
    const bad = join(dir, 'broken.json');
    writeFileSync(bad, '{ "version": ', 'utf8');
    assertLegible(() => readPolicyFile(bad), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unknown DATA ZONE also rounds up to T4, never silently ignored', () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const req = { ...buildRequest(world, { kind: 'read' }), dataZones: ['made-up-zone' as never] };
  const pv = k.preview(req);
  assert.equal(pv.tier, 'T4', 'an unclassified zone is not a harmless zone');
  assert.equal(pv.denied, true);
});

test('a policy saved by a Windows editor (UTF-8 BOM) still loads', () => {
  // PowerShell's Set-Content -Encoding utf8, Notepad, and VS Code all write this.
  // Refusing it would mean the owner cannot edit their own policy with the tools
  // they have.
  const withBom = '﻿' + JSON.stringify(DEFAULT_POLICY);
  assert.deepEqual(loadPolicy(withBom), DEFAULT_POLICY);
});

test('a BOM does not mask a genuinely bad policy', () => {
  const bad = '﻿' + JSON.stringify({ version: 'x', kindTier: { ...DEFAULT_POLICY.kindTier, payment: 'T1' } });
  assertLegible(() => loadPolicy(bad), /must classify "payment" as T4/);
});
