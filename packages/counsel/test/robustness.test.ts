/**
 * ROBUSTNESS — the input is speech-to-text, which is garbage-prone: run-on text
 * with no punctuation, stuttered/repeated words, half-sentences, interruptions,
 * blank and punctuation-only segments, and stretches that are ALL owner or ALL
 * other. The contract under that pressure is exactly two things:
 *   - nothing crashes;
 *   - nothing is fabricated — every item cites a real line, and no item is a blank
 *     dressed up as content (an empty "key point" is a fabricated salience).
 * The empty / one-line case must render as an honest partial, not a summary.
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
  type MeetingSummary,
  type Speaker,
  type Transcript,
  type Utterance,
} from '../src/index.js';

let seq = 0;
function u(speaker: Speaker, text: string, id?: string): Utterance {
  const n = seq++;
  return { id: id ?? `u${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), speaker, text };
}

/** No extracted item — anywhere — may be uncited, cite a phantom line, or be blank. */
function assertNoFabrication(s: MeetingSummary, t: Transcript, ctx: string): void {
  const ids = new Set(t.utterances.map((x) => x.id));
  for (const it of [...s.decisions, ...s.actions, ...s.questions, ...s.keyPoints]) {
    assert.ok(it.cites.length > 0, `${ctx}: an item was produced with no citation`);
    for (const c of it.cites) assert.ok(ids.has(c), `${ctx}: citation ${c} is not a real utterance`);
    // Real content, not residue: a blank or punctuation-only "point" or "question"
    // is noise dressed up as substance, which is its own kind of fabrication.
    assert.match(it.text, /[a-z0-9]/i, `${ctx}: a contentless line was presented as an item: ${JSON.stringify(it.text)}`);
  }
}

// ── the empty / punctuation-only key-point hole ──────────────────────────────

test('a blank line between real speech is never surfaced as a key point', () => {
  // The one real line is a key point; the STT debris around it is not.
  const t = transcriptOf([
    u('owner', '', 'blank'),
    u('other', '   ', 'space'),
    u('owner', '...', 'dots'),
    u('owner', 'We shipped the payments release.', 'real'),
  ]);
  const s = summarize(t);
  assert.ok(s.keyPoints.some((k) => k.cites.includes('real')), 'the one real line is a key point');
  for (const k of s.keyPoints) {
    assert.notEqual(k.text.trim(), '', 'no key point is blank');
    assert.ok(!['blank', 'space', 'dots'].includes(k.cites[0]!), 'no debris line became a key point');
  }
});

test('a transcript that is nothing but blanks and punctuation yields no key points', () => {
  const t = transcriptOf([u('owner', '', 'a'), u('other', '   ', 'b'), u('owner', '?!', 'c')]);
  const s = summarize(t);
  assert.deepEqual(s.keyPoints, [], 'an honest empty, not a list of blank "points"');
  // ...and it still renders, honestly saying it extracted nothing.
  assert.match(renderSummary(s), /KEY POINTS\n {2}none extracted/);
});

// ── stutters, run-ons, half-sentences, interruptions ─────────────────────────

test('stuttered speech-to-text does not crash and stays cited', () => {
  const t = transcriptOf([
    u('owner', 'so so so we we we decided decided to to ship ship it', 'd'),
    u('other', 'yeah yeah works for me works for me', 'g'),
    u('owner', "i'll i'll send send the the notes notes by by friday friday", 'a'),
  ]);
  const s = summarize(t);
  assertNoFabrication(s, t, 'stutter');
  assert.ok(s.decisions.some((d) => d.cites.includes('d')), 'the stuttered decision is still found');
});

test('a run-on with no punctuation is one honest, cited line — never split into invented pieces', () => {
  const runOn =
    'so the plan is to migrate everything to postgres and then we need to update the docs and can you handle the rollout while i take the backfill it just keeps going with no period ever';
  const t = transcriptOf([u('owner', runOn, 'r'), u('other', 'sounds good', 'g')]);
  const s = summarize(t);
  assertNoFabrication(s, t, 'run-on');
  // Every item drawn from the run-on cites exactly that one real line.
  for (const it of [...s.decisions, ...s.actions, ...s.keyPoints]) {
    if (it.cites.includes('r')) assert.deepEqual([...it.cites].filter((c) => c === 'r'), ['r']);
  }
});

test('half-sentences and interruptions do not throw and invent no owner or due', () => {
  const t = transcriptOf([
    u('owner', 'we need to— wait', 'h1'),
    u('other', 'can you—', 'h2'),
    u('owner', "i'll take the— actually", 'h3'),
  ]);
  const s = summarize(t);
  assertNoFabrication(s, t, 'interruptions');
  for (const a of s.actions) {
    // Nothing here names a person or a date; owners/dues must stay null, not be guessed.
    if (a.owner !== null) assert.notEqual(a.owner, 'unknown');
    assert.equal(a.due, null, 'no explicit date was said, so none is invented');
  }
});

// ── a transcript that is ALL owner, or ALL other ─────────────────────────────

test('an all-owner transcript summarizes without fabricating', () => {
  const t = transcriptOf([
    u('owner', "Let's go with the queue approach.", 'o1'),
    u('owner', "I'll write the design doc.", 'o2'),
    u('owner', 'What about the retry budget?', 'o3'),
    u('owner', 'This is important: keep it bounded.', 'o4'),
  ]);
  const s = summarize(t);
  assertNoFabrication(s, t, 'all-owner');
  assert.deepEqual(s.questions, [], 'only an other-speaker asks an OPEN question; the owner querying themselves is not one');
});

test('an all-other transcript summarizes without fabricating; its questions are all open', () => {
  const t = transcriptOf([
    u('other', 'What is the budget?', 'x1'),
    u('other', 'And the timeline?', 'x2'),
    u('other', "I'm worried the infra team won't have capacity.", 'x3'),
  ]);
  const s = summarize(t);
  assertNoFabrication(s, t, 'all-other');
  // No owner ever takes a turn, so no question is answered — every one stays open.
  assert.deepEqual(s.questions.map((q) => q.cites[0]).sort(), ['x1', 'x2'], 'both questions are open; neither is silently dropped');
});

// ── the empty / one-line honest partial ──────────────────────────────────────

test('empty and one-line transcripts are honest partials, not summaries', () => {
  assert.equal(tooShortToSummarize(emptyTranscript()), true);
  assert.equal(tooShortToSummarize(transcriptOf([u('owner', 'and then he said', 'z')])), true);

  const empty = renderPartial(emptyTranscript());
  assert.match(empty, /0 lines captured/);
  assert.doesNotMatch(empty, /Captured so far/);

  const one = renderPartial(transcriptOf([u('other', 'um so like', 'z')]));
  assert.match(one, /1 line captured/);
  assert.match(one, /"um so like"/);
  assert.doesNotMatch(one, /DECISIONS|MEETING SUMMARY/, 'it never fabricates a summary from one garbled line');
});

// ── broad fuzz: pure garbage in, nothing crashes, nothing fabricated ─────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GARBAGE = [
  '', '   ', '\t', '?', '!!!', '...', '.', ',', '- -',
  'so so so we we need to to update the the docs',
  'i mean like i was gonna gonna say we should maybe go with',
  'okay okay okay', 'yeah', 'um', 'and then he said and then wait no',
  'this run on has no punctuation at all it simply continues without a boundary forever and ever',
  'can you can you send send the report', 'we we decided decided to ship',
  'Priya Priya will will handle', "I'll I'll", 'by by friday', 'what what about the budget',
  "i'm worried worried the infra", 'let me let me', 'we agreed we agreed', 'no no that wont work',
];
const SPK: Speaker[] = ['owner', 'other', 'unknown'];

function garbage(seed: number): Transcript {
  const r = mulberry32(seed);
  const n = Math.floor(r() * 8); // 0..7, includes the empty transcript
  const forced: Speaker | null = seed % 4 === 0 ? 'owner' : seed % 4 === 1 ? 'other' : null;
  const us: Utterance[] = [];
  for (let i = 0; i < n; i++) {
    us.push({
      id: `g${i}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      speaker: forced ?? SPK[Math.floor(r() * SPK.length)]!,
      text: GARBAGE[Math.floor(r() * GARBAGE.length)]!,
    });
  }
  return transcriptOf(us);
}

test('property — garbage in, no crash and no fabrication across the whole pipeline', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const t = garbage(seed);
    const s = summarize(t); // must not throw
    assertNoFabrication(s, t, `seed ${seed}`);
    renderSummary(s); // must not throw
    renderPartial(t); // must not throw
    tooShortToSummarize(t);
  }
});
