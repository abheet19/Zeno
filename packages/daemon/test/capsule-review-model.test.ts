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

  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const forge = readFileSync(new URL('../../public/forge.js', import.meta.url), 'utf8');
  assert.match(app, /opts\.review = preview\.review/);
  assert.match(forge, /review: p\.review/);
  assert.match(forge, /\(\[\^\\r\\n\]\*\?\\S\)/, 'emitted file paths may contain spaces');
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

  const app = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
  const forge = readFileSync(new URL('../../public/forge.js', import.meta.url), 'utf8');
  assert.match(app, /pendingCapsuleNeedsRefresh\(existing\.preview, preview\)/);
  assert.match(app, /existing\.detail\.replaceChildren\(node\)/, 'an open Command capsule is replaced in place');
  assert.match(forge, /pendingCapsuleNeedsRefresh\(previous, p\)/);
  assert.match(forge, /gatePreviews\.set\(hash, p\)/, 'Forge retains the preview used by the visible node');
  assert.match(forge, /oldNode\?\.destroy\?\.\(\)/, 'Forge destroys the stale node before repainting');
});
