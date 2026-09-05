/**
 * LENS — privacy & scope. The discipline invariants of 26-prototype-counsel,
 * locked so they cannot silently regress:
 *
 *   1. `speaker` is a plain CHANNEL label — never diarization, never biometrics, never
 *      stored audio. Identity is read from WORDS, never from a voice: a first-person
 *      commitment on the `unknown` channel is never attributed (§4.3, the right to say
 *      "unknown"), while a NAMED subject is still read from the text on ANY channel —
 *      because a name in the words is not a voiceprint. A leading discourse marker
 *      ("Also, …", "Now, …") is never mistaken for a person (honesty rule 3).
 *
 *   2. Speech-to-text debris is never dressed up as content.
 *
 * The live-assist invariants that used to live here are gone with the feature: Counsel
 * takes notes and nothing more, so there is no suggestion path left to constrain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  transcriptOf,
  type Speaker,
  type Utterance,
} from '../src/index.js';

let seq = 0;
function u(speaker: Speaker, text: string, id?: string): Utterance {
  const n = seq++;
  return { id: id ?? `u${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), speaker, text };
}

// ── 1. speaker is a channel label; identity comes from words, never a voice ──────

test('a leading discourse marker before a request is never mistaken for an owner', () => {
  // "Also"/"Now"/"So"/"First" are capitalized and sit exactly where a vocative name
  // would ("Sarah, can you …"). None of them names a person, so the owner stays null —
  // an action nobody named is never assigned one.
  for (const text of [
    'Also, can you send the notes?',
    'Now, will you check the logs?',
    'So, could you update the doc?',
    'First, can you review the PR?',
  ]) {
    const s = summarize(transcriptOf([u('owner', text, 'x')]));
    assert.ok(s.actions[0], `an action was extracted from: ${text}`);
    assert.equal(s.actions[0]!.owner, null, `no person is invented from a discourse marker: ${text}`);
  }
});

test('a real vocative name is still read — the guard does not over-reject', () => {
  const s = summarize(transcriptOf([u('owner', 'Sarah, can you update the runbook?', 'x')]));
  assert.equal(s.actions[0]?.owner, 'Sarah');
});

test('a named subject is read from the WORDS, on any channel — even `unknown`', () => {
  // The name is in the text, not the voice. An unknown CHANNEL does not blind Counsel to
  // a name that was actually spoken, so this is attributed — no biometrics are involved.
  const s = summarize(transcriptOf([u('unknown', 'Priya will handle the rollout.', 'z')]));
  assert.equal(s.actions[0]?.owner, 'Priya');
});

test('a first-person commitment is owned by the CHANNEL, and the unknown channel yields null', () => {
  // "I will …" names no one; the only thing that could say who "I" is is the channel.
  // So the owner is the channel label itself — never a fabricated identity — and when
  // the channel is `unknown`, Counsel genuinely cannot attribute it: null, not a guess.
  const expected: Record<Speaker, string | null> = { owner: 'owner', other: 'other', unknown: null };
  for (const sp of ['owner', 'other', 'unknown'] as Speaker[]) {
    const s = summarize(transcriptOf([u(sp, "I'll draft the doc.", 'z')]));
    assert.ok(s.actions[0], `a first-person action was extracted on channel ${sp}`);
    assert.equal(s.actions[0]!.owner, expected[sp], `first-person owner on channel ${sp}`);
  }
});

// ── honest-partial: STT debris is never dressed up as content ────────────────────

test('a blank or whitespace-only line is never surfaced as a key point', () => {
  // The empty strings a speech-to-text engine emits between real speech have no key
  // point in them; the "aim for three" padding must never reach for one.
  const s = summarize(
    transcriptOf([u('owner', '   ', 'a'), u('other', 'We shipped the release.', 'b'), u('owner', '\t', 'c')]),
  );
  assert.ok(s.keyPoints.length >= 1, 'the one real line is a key point');
  for (const k of s.keyPoints) {
    assert.notEqual(k.text.trim(), '', 'no key point is blank');
    assert.equal(k.cites.length, 1, 'each key point cites exactly its line');
  }
  const ids = s.keyPoints.map((k) => k.cites[0]);
  assert.ok(!ids.includes('a') && !ids.includes('c'), 'the whitespace debris lines are not key points');
});
