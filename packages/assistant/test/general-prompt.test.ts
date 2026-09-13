/**
 * `buildGeneralPrompt` is the OTHER prompt — no FACTS block, no citation rule.
 * These tests pin the two things that keep it from ever being mistaken for
 * the grounded one: it carries no snapshot-shaped content, and it tells the
 * model plainly that it was shown none of the owner's local state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneralPrompt } from '../src/index.js';

test('the general prompt carries no FACTS block', () => {
  const p = buildGeneralPrompt('explain what a closure is');
  assert.doesNotMatch(p, /^FACTS$/m);
  assert.doesNotMatch(p, /\[p1\]|\[m1\]/);
});

test('the general prompt says plainly that no local state was shown', () => {
  const p = buildGeneralPrompt('what is a slugify utility?');
  assert.match(p, /NOT shown/);
  assert.match(p, /approvals, receipts, work items, repository, memory, or/i);
});

test('the question is carried through verbatim when short', () => {
  const p = buildGeneralPrompt('what is 2 + 2?');
  assert.match(p, /what is 2 \+ 2\?/);
});

test('an overlong question is clipped, like the grounded prompt clips its own', () => {
  const long = 'x'.repeat(50);
  const p = buildGeneralPrompt(long, 10);
  assert.match(p, /x{9}…/);
  assert.doesNotMatch(p, /x{10}/);
});
