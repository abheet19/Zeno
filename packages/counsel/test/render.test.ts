/**
 * Rendering: every item shows its citation ids; a too-short transcript renders an
 * honest partial that says so and invents nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  renderSummary,
  renderPartial,
  tooShortToSummarize,
  emptyTranscript,
  transcriptOf,
  type Speaker,
  type Utterance,
} from '../src/index.js';

function u(id: string, speaker: Speaker, text: string): Utterance {
  return { id, at: '2026-01-01T00:00:00.000Z', speaker, text };
}

test('renderSummary shows every item with its citation ids', () => {
  const t = transcriptOf([
    u('d1', 'owner', "Let's go with Postgres."),
    u('g1', 'other', 'Sounds good.'),
    u('ac1', 'owner', 'Sarah, can you send the notes by Friday?'),
    u('q1', 'other', 'What is the cost?'),
  ]);
  const text = renderSummary(summarize(t));
  assert.match(text, /MEETING SUMMARY/);
  assert.match(text, /\[agreed\] Let's go with Postgres\./);
  assert.match(text, /owner: Sarah/);
  assert.match(text, /due: friday/);
  assert.match(text, /\[d1, g1\]/, 'the agreed decision shows both cited lines');
  assert.match(text, /\[q1\]/, 'the open question shows its citation');
});

test('an empty summary renders "none extracted" rather than blank sections', () => {
  const text = renderSummary(summarize(emptyTranscript()));
  assert.equal((text.match(/none extracted/g) ?? []).length, 4, 'all four sections say so honestly');
});

test('tooShortToSummarize flags an empty or one-line transcript', () => {
  assert.equal(tooShortToSummarize(emptyTranscript()), true);
  assert.equal(tooShortToSummarize(transcriptOf([u('a', 'owner', 'hi')])), true);
  assert.equal(tooShortToSummarize(transcriptOf([u('a', 'owner', 'hi'), u('b', 'other', 'hello')])), false);
});

test('renderPartial on a one-line transcript says so and shows the line, inventing nothing', () => {
  const text = renderPartial(transcriptOf([u('a', 'owner', 'let us get started')]));
  assert.match(text, /TRANSCRIPT TOO SHORT/);
  assert.match(text, /1 line captured/);
  assert.match(text, /"let us get started"   \[a\]/);
  assert.doesNotMatch(text, /DECISIONS|SUMMARY/, 'it does not fabricate a summary');
});

test('renderPartial on an empty transcript reports zero lines and shows nothing captured', () => {
  const text = renderPartial(emptyTranscript());
  assert.match(text, /0 lines captured/);
  assert.doesNotMatch(text, /Captured so far/);
});
