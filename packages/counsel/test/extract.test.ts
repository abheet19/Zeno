/**
 * The engine's honesty rules, proven:
 *   - a realistic meeting is summarized correctly and every item is cited;
 *   - a TENTATIVE remark is not upgraded to an agreed decision;
 *   - an action with no named owner stays unassigned;
 *   - a question the owner DID answer is not listed as open;
 *   - a property test: every returned item carries a real, non-empty citation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, transcriptOf, type Speaker, type Transcript, type Utterance } from '../src/index.js';

let seq = 0;
function u(speaker: Speaker, text: string, id?: string): Utterance {
  const n = seq++;
  return { id: id ?? `u${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), speaker, text };
}

// ── a realistic meeting, summarized correctly ────────────────────────────────

test('a realistic meeting is summarized with cited, honest items', () => {
  const t = transcriptOf([
    u('other', 'How are we handling the retry when the pipeline is flaky?', 'q1'),
    u('owner', 'Right now it retries three times with backoff, then surfaces a classified failure.', 'a1'),
    u('owner', 'I think we should go with a bounded retry budget capped by attempts and time.', 'd1'),
    u('other', "Sounds good, let's do that.", 'g1'),
    u('owner', 'Sarah, can you update the runbook by Friday?', 'ac1'),
    u('other', 'We could maybe go with Kafka for the queue later.', 'd2'),
    u('owner', 'We need to document the fallback classification.', 'ac2'),
    u('other', 'What is the CI cost of all these retries?', 'q2'),
    u('other', "Also, I'm worried the infra team won't have capacity.", 'ob1'),
    u('owner', 'This is important: keep the retry budget bounded.', 'k1'),
  ]);
  const s = summarize(t);

  // Decisions: one agreed (cited to its agreement), one tentative that stays proposed.
  const agreed = s.decisions.find((d) => d.cites.includes('d1'));
  assert.ok(agreed, 'the retry-budget decision was extracted');
  assert.equal(agreed!.lifecycle, 'agreed', 'the following "sounds good" makes it agreed');
  assert.ok(agreed!.cites.includes('g1'), 'it cites the agreeing turn, not just its own');

  const tentative = s.decisions.find((d) => d.cites.includes('d2'));
  assert.ok(tentative, 'the Kafka remark was extracted as a decision');
  assert.equal(tentative!.lifecycle, 'proposed', 'a tentative remark is NOT upgraded to agreed');

  // Actions: one owned + dated, one collective with no owner.
  const sarah = s.actions.find((a) => a.owner === 'Sarah');
  assert.ok(sarah, 'the runbook action was extracted');
  assert.equal(sarah!.due, 'friday', 'the explicit day is captured as due');

  const doc = s.actions.find((a) => a.cites.includes('ac2'));
  assert.ok(doc, 'the documentation action was extracted');
  assert.equal(doc!.owner, null, 'an action nobody named stays unassigned');
  assert.equal(doc!.due, null, 'no date said, so no due invented');

  // Questions: the answered one is gone; the unanswered one remains.
  const openIds = s.questions.map((q) => q.cites[0]);
  assert.ok(!openIds.includes('q1'), 'the question the owner answered is not open');
  assert.ok(openIds.includes('q2'), 'the unanswered question is surfaced');

  // Key points exist, are bounded, and are all cited.
  assert.ok(s.keyPoints.length >= 3 && s.keyPoints.length <= 7, 'between 3 and 7 key points');

  // Every item, everywhere, carries a citation.
  for (const it of [...s.decisions, ...s.actions, ...s.questions, ...s.keyPoints]) {
    assert.ok(it.cites.length > 0, 'no item is ever uncited');
  }
});

// ── lifecycle: agreed / disputed / proposed, extracted not invented ──────────

test('a decision agreed in the same breath is agreed and cites only itself', () => {
  const s = summarize(transcriptOf([u('owner', "We've decided to ship behind a flag.", 'x1')]));
  assert.equal(s.decisions[0]?.lifecycle, 'agreed');
  assert.deepEqual(s.decisions[0]?.cites, ['x1']);
});

test('a decision contradicted next turn is disputed and cites the objection', () => {
  const s = summarize(
    transcriptOf([
      u('owner', "Let's go with Postgres for storage.", 'p1'),
      u('other', "I disagree, that won't work at our scale.", 'p2'),
    ]),
  );
  const d = s.decisions.find((x) => x.cites.includes('p1'));
  assert.equal(d?.lifecycle, 'disputed');
  assert.ok(d?.cites.includes('p2'), 'the disputing turn is cited');
});

test('a plain proposal with no reaction stays proposed', () => {
  const s = summarize(
    transcriptOf([
      u('owner', "Let's go with the queue approach.", 'a'),
      u('owner', 'It keeps the workers simple.', 'b'),
    ]),
  );
  assert.equal(s.decisions[0]?.lifecycle, 'proposed');
});

// ── owners: extracted from the sentence, never guessed ───────────────────────

test('owner is read from a vocative at the end of a request', () => {
  const s = summarize(transcriptOf([u('owner', 'Can you send the report, Priya?', 'z')]));
  assert.equal(s.actions[0]?.owner, 'Priya');
});

test('a named subject who takes the task becomes the owner', () => {
  const s = summarize(transcriptOf([u('other', 'Priya will handle the rollout.', 'z')]));
  assert.equal(s.actions[0]?.owner, 'Priya');
});

test('a first-person commitment is owned by the speaker channel', () => {
  const s = summarize(transcriptOf([u('owner', "I'll send the notes tomorrow.", 'z')]));
  assert.equal(s.actions[0]?.owner, 'owner');
  assert.equal(s.actions[0]?.due, 'tomorrow');
});

test('an unknown speaker saying "I will" cannot be attributed — owner stays null', () => {
  const s = summarize(transcriptOf([u('unknown', 'I will draft the doc.', 'z')]));
  assert.equal(s.actions[0]?.owner, null);
});

test('a leading discourse marker before "can you" is not fabricated into an owner', () => {
  // "Also, can you …" is a request to whoever is present, naming no one. The
  // capitalized "Also" sits where a vocative name would, but it is in NOT_A_NAME,
  // so the owner must stay null rather than becoming a person nobody named.
  for (const marker of ['Also', 'So', 'Now', 'Well', 'Next']) {
    const line = `${marker}, can you update the runbook?`;
    const s = summarize(transcriptOf([u('other', line, 'z')]));
    assert.ok(s.actions[0], `"${line}" is an action`);
    assert.equal(s.actions[0]!.owner, null, `"${marker}" is a discourse marker, not an owner`);
  }
  // The same branch still reads a real vocative name.
  const named = summarize(transcriptOf([u('other', 'Sarah, can you update the runbook?', 'z2')]));
  assert.equal(named.actions[0]?.owner, 'Sarah', 'a real leading vocative name is still captured');
});

// ── questions: the answered-vs-open distinction ──────────────────────────────

test('two other-questions in a row: the one with no owner turn between is open', () => {
  const s = summarize(
    transcriptOf([
      u('other', 'What is the budget?', 'q1'),
      u('other', 'And the timeline?', 'q2'),
      u('owner', 'The timeline is two weeks.', 'a1'),
    ]),
  );
  const ids = s.questions.map((q) => q.cites[0]);
  assert.deepEqual(ids, ['q1'], 'q1 got no owner turn before q2; q2 was answered');
});

// ── key points: real lines only, never padded with invented text ─────────────

test('key points come only from real utterances, even when most lines are empty of content', () => {
  const s = summarize(
    transcriptOf([u('owner', 'ok.', 'a'), u('other', 'no.', 'b'), u('owner', 'hi.', 'c'), u('owner', 'We shipped the release.', 'd')]),
  );
  assert.ok(s.keyPoints.length >= 1);
  for (const k of s.keyPoints) assert.ok(k.cites.length === 1, 'each key point cites exactly its line');
});

// ── property test + determinism ──────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DECISION_BANK = ["let's go with option A", 'we decided to use redis', 'the plan is to migrate'];
const ACTION_BANK = ['can you review the pr', 'we need to update the docs', "I'll send the summary tomorrow", 'Priya will handle the rollout'];
const QUESTION_BANK = ['what is the timeline?', 'how does this scale?', 'who owns this?'];
const PLAIN_BANK = ['that makes sense to me', 'the numbers looked fine last week', 'we saw similar results before'];
const BANKS = [DECISION_BANK, ACTION_BANK, QUESTION_BANK, PLAIN_BANK];
const SPEAKERS: Speaker[] = ['owner', 'other', 'unknown'];

function generate(seed: number): Transcript {
  const rnd = mulberry32(seed);
  const n = 3 + Math.floor(rnd() * 10);
  const us: Utterance[] = [];
  for (let i = 0; i < n; i++) {
    const bank = BANKS[Math.floor(rnd() * BANKS.length)]!;
    const base = bank[Math.floor(rnd() * bank.length)]!;
    const text = rnd() < 0.3 ? `${base}. ${PLAIN_BANK[Math.floor(rnd() * PLAIN_BANK.length)]!}` : base;
    us.push({
      id: `u${i}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      speaker: SPEAKERS[Math.floor(rnd() * SPEAKERS.length)]!,
      text,
    });
  }
  return transcriptOf(us);
}

test('property — every extracted item carries at least one real citation', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const t = generate(seed);
    const ids = new Set(t.utterances.map((x) => x.id));
    const s = summarize(t);
    for (const it of [...s.decisions, ...s.actions, ...s.questions, ...s.keyPoints]) {
      assert.ok(it.cites.length > 0, `seed ${seed}: an item was produced with no citation`);
      for (const c of it.cites) assert.ok(ids.has(c), `seed ${seed}: citation ${c} is not a real utterance`);
    }
  }
});

test('summarize is deterministic — same transcript, same summary', () => {
  const t = generate(42);
  assert.deepEqual(summarize(t), summarize(t));
});
