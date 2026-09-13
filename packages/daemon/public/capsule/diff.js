/*
 * capsule/diff.js — content for field 5, "Before / after diff".
 *
 * capsule.js keeps the literal `field(5, 'Before / after diff')` call itself
 * (packages/daemon/test/capsule-review-model.test.ts asserts on that exact
 * source text and its position relative to field 6 and the footer), and
 * fills the field with the nodes this module builds.
 */

import { el, add } from './dom.js';
import { chip, unresolved, copyBtn } from './widgets.js';
import { fileReviewModel } from './review.js';
import { addBlocker } from './state.js';

/**
 * @returns {null} when this preview carries no file-write review at all
 * @returns {{state: string, nodes: Node[]}} the review's state (for
 *   root.dataset.reviewState) and the child nodes to append to field 5
 */
export function buildReviewFieldContent(ctx) {
  const { opts } = ctx;
  const hasValue = Object.prototype.hasOwnProperty.call(opts, 'payload');
  const review = fileReviewModel(
    Object.prototype.hasOwnProperty.call(opts, 'review') ? opts.review : null,
    hasValue ? opts.payload : undefined,
  );
  if (review === null) return null;

  const nodes = [];

  const reviewRow = el('div', 'zn-hashrow');
  const tone = review.state === 'ready' ? (review.truncated ? 'amber' : 'cyan') : 'red';
  const glyph = review.state === 'ready' ? (review.truncated ? '△' : '≡') : '▲';
  const label = review.state === 'ready'
    ? (review.truncated ? 'base matched · bounded excerpt' : 'base matched · complete diff')
    : `review · ${review.state}`;
  add(reviewRow, chip(glyph, label, tone));
  nodes.push(reviewRow);

  const details = review.review;
  if (details) {
    const hashes = el('dl', 'zn-tuple');
    add(hashes, el('dt', null, 'path'), el('dd', null, String(details.relPath ?? '')));
    add(hashes, el('dt', null, 'expected base'), el('dd', null, String(details.expectedBaseHash ?? '')));
    add(hashes, el('dt', null, 'observed base'), el('dd', null, String(details.observedBaseHash ?? 'unavailable')));
    add(hashes, el('dt', null, 'proposed state'), el('dd', null, String(details.expectedPostHash ?? '')));
    if (details.observed && details.proposed) {
      add(
        hashes,
        el('dt', null, 'size'),
        el('dd', null, `${details.observed.bytes} → ${details.proposed.bytes} bytes · ${details.observed.lines} → ${details.proposed.lines} lines`),
      );
    }
    nodes.push(hashes);
  }

  if (review.diff !== null) {
    const diff = el('pre', 'zn-diff', review.diff);
    diff.tabIndex = 0;
    diff.setAttribute('aria-label', review.truncated ? 'bounded before and after diff excerpt' : 'complete before and after diff');
    const controls = el('div', 'zn-hashrow');
    add(controls, copyBtn('copy diff', () => review.diff));
    nodes.push(diff, controls);
    nodes.push(
      el('div', 'zn-note',
        'Line-ending marks are explicit: ␍␊ is CRLF, ␊ is LF, ␍ is CR, and ∅ means no final newline.'),
    );
  }
  if (review.truncated) {
    nodes.push(
      el('div', 'zn-note',
        `Bounded review: ${review.omittedDiffLines.toLocaleString()} diff lines and ${review.omittedCharacters.toLocaleString()} characters are omitted. Approval is disabled until a narrower or split proposal exposes the complete comparison.`),
    );
  }
  if (review.note) nodes.push(el('div', 'zn-note', review.note));
  if (review.blocker) {
    nodes.push(unresolved(review.blocker));
    addBlocker(ctx, 'file-review', review.blocker);
  }

  return { state: review.state, nodes };
}
