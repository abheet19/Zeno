import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface CapsuleReviewModel {
  fileReviewModel(review: unknown, payload: unknown): {
    readonly state: string;
    readonly blocker: string | null;
    readonly diff: string | null;
    readonly truncated: boolean;
  } | null;
  pendingCapsuleNeedsRefresh(current: unknown, next: unknown): boolean;
}

const moduleUrl = new URL('../../public/capsule.js', import.meta.url).href;
const { fileReviewModel, pendingCapsuleNeedsRefresh } = await import(moduleUrl) as CapsuleReviewModel;

const payload = {
  relPath: 'src/a file.ts',
  contents: 'new\n',
  expectBaseHash: 'base-hash',
  expectPostHash: 'post-hash',
};

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    state: 'ready',
    relPath: payload.relPath,
    expectedBaseHash: payload.expectBaseHash,
    observedBaseHash: payload.expectBaseHash,
    expectedPostHash: payload.expectPostHash,
    observedPostHash: payload.expectPostHash,
    diff: '--- a/src/a file.ts\n+++ b/src/a file.ts\n-old\n+new',
    truncated: false,
    omittedDiffLines: 0,
    omittedCharacters: 0,
    note: 'base matched',
    ...overrides,
  };
}

test('capsule accepts only a ready review bound to this file payload', () => {
  const ready = fileReviewModel(review(), payload);
  assert.equal(ready?.state, 'ready');
  assert.equal(ready?.blocker, null);
  assert.match(ready?.diff ?? '', /a file\.ts/);

  assert.match(fileReviewModel(null, payload)?.blocker ?? '', /review is missing/);
  assert.match(fileReviewModel(review({ relPath: 'src/other.ts' }), payload)?.blocker ?? '', /different path/);
  assert.match(fileReviewModel(review({ expectedBaseHash: 'other' }), payload)?.blocker ?? '', /different base hash/);
  assert.match(fileReviewModel(review({ observedPostHash: 'other' }), payload)?.blocker ?? '', /different proposed bytes/);
  assert.match(fileReviewModel(review({ state: 'drifted', observedBaseHash: 'moved' }), payload)?.blocker ?? '', /drifted/);
  assert.match(fileReviewModel(review({ truncated: true }), payload)?.blocker ?? '', /truncation state/);
  assert.match(fileReviewModel(review({ omittedDiffLines: -1 }), payload)?.blocker ?? '', /omitted-content counts/);
  assert.equal(fileReviewModel({}, { command: 'npm test' }), null, 'tool-call capsules do not require a file diff');
});

test('bounded review remains explicit and blocks approval before the action', () => {
  const bounded = fileReviewModel(review({ truncated: true, omittedDiffLines: 80, omittedCharacters: 20 }), payload);
  assert.equal(bounded?.state, 'ready');
  assert.equal(bounded?.truncated, true);
  assert.match(bounded?.blocker ?? '', /truncated.*narrow or split/,
    'an excerpt cannot authorize a write whose complete before/after comparison is not visible');

  const capsule = readFileSync(new URL('../../public/capsule.js', import.meta.url), 'utf8');
  const reviewField = capsule.indexOf("field(5, 'Before / after diff')");
  const payloadField = capsule.indexOf("field(6, 'The exact change it will write')");
  const footer = capsule.indexOf('/* ================= FOOTER ================= */');
  assert.ok(reviewField > 0 && reviewField < payloadField && payloadField < footer,
    'the bound diff is in the capsule body before the exact payload and approval footer');

  // Command's approvals screen (packages/daemon/public/bind/approvals.js) is the
  // one place the shipped renderer still turns a held action's `review` into a
  // diff — Forge no longer renders its own inline capsule at all; it shows a
  // summary count and hands the owner to Command → Approvals to review it
  // there (one bounded-review path instead of two that could disagree).
  const approvals = readFileSync(new URL('../../public/bind/approvals.js', import.meta.url), 'utf8');
  assert.match(approvals, /fileReviewModel\(review, preview\.payload\)/,
    'the before/after diff is bound through capsule.js\'s own fileReviewModel, not re-derived');
  assert.match(approvals, /Approval stays blocked until a narrower change exposes the complete diff/,
    'a bounded review renders as an explicit, still-blocking warning rather than a silently truncated diff');
});

test('the same action hash refreshes its capsule when the observed file review drifts', () => {
  const ready = { actionHash: 'same-action', payload, review: review() };
  const reordered = { actionHash: 'same-action', payload: { ...payload }, review: { ...review() } };
  const drifted = {
    actionHash: 'same-action',
    payload,
    review: review({ state: 'drifted', observedBaseHash: 'new-sandbox-bytes', diff: null }),
  };
  assert.equal(pendingCapsuleNeedsRefresh(ready, reordered), false, 'key order and object identity do not cause a refresh');
  assert.equal(pendingCapsuleNeedsRefresh(ready, drifted), true, 'ready to drifted must replace the visible approval capsule');
  assert.equal(pendingCapsuleNeedsRefresh(ready, { ...drifted, actionHash: 'other-action' }), false, 'different actions reconcile separately');

  // bind/approvals.js does not diff an open capsule against the next preview at
  // all — every settle (Allow/Deny, or a live-update tick) re-reads /state and
  // rebuilds every capsule from what it actually reads, so a drifted review can
  // never be left showing stale. That is a different (simpler) way of reaching
  // the same guarantee pendingCapsuleNeedsRefresh exists for, not a caller of it.
  const approvals = readFileSync(new URL('../../public/bind/approvals.js', import.meta.url), 'utf8');
  assert.match(approvals, /Re-read the real queue rather than guessing what changed locally/,
    'a settled action re-reads the real queue instead of patching a stale capsule in place');
  assert.match(approvals, /fill\(pbody, \.\.\.nodes\)/,
    'every visible capsule is rebuilt from the freshly read queue, so a drifted review cannot be shown stale');
});
