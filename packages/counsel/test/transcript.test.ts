/**
 * The transcript model: append is immutable, slicing is honest about time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTranscript,
  transcriptOf,
  append,
  sliceByTime,
  type Speaker,
  type Utterance,
} from '../src/index.js';

function u(id: string, at: string, speaker: Speaker, text: string): Utterance {
  return { id, at, speaker, text };
}

test('emptyTranscript has no utterances', () => {
  assert.equal(emptyTranscript().utterances.length, 0);
});

test('append returns a new transcript and never mutates the source', () => {
  const t0 = transcriptOf([u('u1', '2026-01-01T00:00:00.000Z', 'owner', 'hi')]);
  const t1 = append(t0, u('u2', '2026-01-01T00:00:01.000Z', 'other', 'hello'));
  assert.equal(t0.utterances.length, 1, 'the source is untouched');
  assert.equal(t1.utterances.length, 2);
  assert.equal(t1.utterances[1]?.id, 'u2');
});

test('sliceByTime keeps only utterances inside the inclusive window', () => {
  const t = transcriptOf([
    u('u1', '2026-01-01T00:00:00.000Z', 'owner', 'a'),
    u('u2', '2026-01-01T00:00:30.000Z', 'other', 'b'),
    u('u3', '2026-01-01T00:01:00.000Z', 'owner', 'c'),
  ]);
  const mid = sliceByTime(t, '2026-01-01T00:00:15.000Z', '2026-01-01T00:00:45.000Z');
  assert.deepEqual(mid.utterances.map((x) => x.id), ['u2']);
});

test('sliceByTime opens an unparseable bound and drops an unplaceable utterance', () => {
  const t = transcriptOf([
    u('u1', '2026-01-01T00:00:00.000Z', 'owner', 'a'),
    u('u2', 'not-a-time', 'other', 'b'),
  ]);
  const all = sliceByTime(t, 'nope', 'also-nope');
  assert.deepEqual(all.utterances.map((x) => x.id), ['u1'], 'u2 has no placeable time, so it is left out');
});
