/*
 * capsule/review.js — the file-write before/after review model.
 *
 * Kept DOM-free so the binding and refusal states are unit-testable
 * (packages/daemon/test/capsule-review-model.test.ts imports fileReviewModel
 * straight off capsule.js's re-export of this module).
 */

function isWritePayload(payload) {
  return payload !== null && typeof payload === 'object' &&
    typeof payload.relPath === 'string' &&
    typeof payload.contents === 'string' &&
    typeof payload.expectBaseHash === 'string' &&
    typeof payload.expectPostHash === 'string';
}

/**
 * Validate the daemon's file-review envelope against the exact write payload.
 */
export function fileReviewModel(review, payload) {
  if (!isWritePayload(payload)) return null;
  const fail = (state, blocker) => ({
    state, blocker, diff: null, truncated: false, omittedDiffLines: 0,
    omittedCharacters: 0, note: '', review: review || null,
  });
  if (review === null || typeof review !== 'object') {
    return fail('missing', 'the exact before/after review is missing for this file write');
  }
  if (review.version !== 1) return fail('mismatch', 'the file review has an unsupported version');
  if (review.relPath !== payload.relPath) return fail('mismatch', 'the file review names a different path than the payload');
  if (review.expectedBaseHash !== payload.expectBaseHash) {
    return fail('mismatch', 'the file review is bound to a different base hash than the payload');
  }
  if (review.expectedPostHash !== payload.expectPostHash || review.observedPostHash !== payload.expectPostHash) {
    return fail('mismatch', 'the file review is bound to different proposed bytes than the payload');
  }
  if (review.state === 'drifted') {
    return fail('drifted', 'the workspace base drifted after this action was proposed; re-propose before approving');
  }
  if (review.state === 'unavailable') {
    return fail('unavailable', 'the workspace base could not be read and verified; re-propose before approving');
  }
  if (review.state !== 'ready') return fail('mismatch', 'the file review carries an unknown state');
  if (review.observedBaseHash !== payload.expectBaseHash) {
    return fail('mismatch', 'the reviewed workspace bytes do not match the payload’s expected base hash');
  }
  if (typeof review.diff !== 'string' || typeof review.truncated !== 'boolean') {
    return fail('mismatch', 'the ready file review does not carry a bounded diff and truncation state');
  }
  const countsAreValid =
    Number.isSafeInteger(review.omittedDiffLines) && review.omittedDiffLines >= 0 &&
    Number.isSafeInteger(review.omittedCharacters) && review.omittedCharacters >= 0;
  if (!countsAreValid) {
    return fail('mismatch', 'the file review does not carry valid omitted-content counts');
  }
  const omittedDiffLines = review.omittedDiffLines;
  const omittedCharacters = review.omittedCharacters;
  if (review.truncated !== (omittedDiffLines > 0 || omittedCharacters > 0)) {
    return fail('mismatch', 'the file review truncation state contradicts its omitted-content counts');
  }
  return {
    state: 'ready',
    blocker: review.truncated
      ? 'the before/after diff is truncated; narrow or split the change and re-propose it before approving'
      : null,
    diff: review.diff,
    truncated: review.truncated,
    omittedDiffLines,
    omittedCharacters,
    note: typeof review.note === 'string' ? review.note : '',
    review,
  };
}
