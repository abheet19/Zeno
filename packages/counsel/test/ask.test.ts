/**
 * The chat, and the honesty boundary underneath it.
 *
 * A prompt is a REQUEST — "cite your ids, refuse when you cannot" — and a model
 * may ignore it. `groundedAnswer` is the part that is not a request: an id the
 * model cited that exists nowhere in the retrieved hits is a fabrication, it is
 * caught here, and it is reported rather than rendered. That is the same rule
 * `summarize` already lives under, applied to a stochastic answerer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnswerPrompt,
  groundedAnswer,
  Meetings,
  NOT_FOUND,
  summarize,
  transcriptOf,
  type Hit,
  type Meeting,
  type MeetingStore,
  type Speaker,
  type Utterance,
} from '../src/index.js';

function memStore(): MeetingStore {
  const files = new Map<string, string>();
  return {
    list: () => [...files.keys()],
    read: (id) => files.get(id) ?? '',
    write: (id, text) => void files.set(id, text),
    remove: (id) => files.delete(id),
  };
}

let seq = 0;
function u(speaker: Speaker, text: string): Utterance {
  const n = seq++;
  return { id: `u${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), speaker, text };
}

function meeting(id: string, title: string, startedAt: string, lines: Utterance[], participants: string[] = []): Meeting {
  return { id, title, startedAt, endedAt: startedAt, participants, utterances: lines, summary: summarize(transcriptOf(lines)) };
}

const L1 = u('owner', "I'll send the migration plan to Sarah by Friday.");
const L2 = u('other', 'What is the storage cost?');
const LEDGER = meeting('m-ledger', 'Ledger storage sync', '2026-01-10T10:00:00.000Z', [L1, L2], ['Abheet', 'Sarah']);

function hitsFor(query: string): Hit[] {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  return lib.recall(query);
}

// ── the prompt ───────────────────────────────────────────────────────────────

test('the prompt puts the excerpts BEFORE the question', () => {
  const p = buildAnswerPrompt('What did I commit to?', hitsFor('migration'));
  const excerpts = p.indexOf('EXCERPTS');
  const question = p.indexOf('QUESTION');
  assert.ok(excerpts >= 0 && question >= 0);
  assert.ok(excerpts < question, 'evidence first, so the model is not answering from its weights');
  assert.ok(p.indexOf('What did I commit to?') > question, 'the question sits last, right before generation');
});

test('every excerpt is labelled with its meeting id and its line ids', () => {
  const p = buildAnswerPrompt('what did I commit to?', hitsFor('migration'));
  assert.match(p, /MEETING m-ledger — "Ledger storage sync" — 2026-01-10T10:00:00\.000Z/);
  assert.match(p, new RegExp(`\\[${L1.id}\\]`), 'the matched transcript line carries its id');
  assert.match(p, /matched on: migration/, 'the prompt says why this meeting came back');
  assert.match(p, /participants: Abheet, Sarah/);
});

test('the prompt demands citations and names the exact refusal sentence', () => {
  const p = buildAnswerPrompt('anything?', hitsFor('migration'));
  assert.match(p, /Cite the id of every excerpt you use/);
  assert.match(p, /Never invent an id/);
  assert.ok(p.includes(NOT_FOUND), 'the model is told the exact words to use when it cannot answer');
});

test('with no hits the prompt says so plainly rather than shipping an empty EXCERPTS block', () => {
  const p = buildAnswerPrompt('what about kubernetes?', []);
  assert.match(p, /\(none — retrieval found no meeting matching this question\)/);
  assert.ok(p.includes(NOT_FOUND));
});

test('a capped context ANNOUNCES the truncation instead of quietly dropping evidence', () => {
  const lib = new Meetings(memStore());
  for (let i = 0; i < 5; i++) {
    lib.save(meeting(`m-${i}`, `Budget ${i}`, `2026-02-0${i + 1}T10:00:00.000Z`, [u('owner', 'budget '.repeat(200))]));
  }
  const hits = lib.recall('budget', 5);
  assert.equal(hits.length, 5);
  const p = buildAnswerPrompt('what is the budget?', hits, { maxChars: 500 });
  assert.match(p, /TRUNCATED: 1 of 5 matching meetings are shown above; 4 more were cut to fit/);
  assert.match(p, /shown excerpt itself was shortened to fit the 500-character context cap/);
  assert.match(p, /If the answer might depend on a meeting not shown, say so/);
});

test('an uncapped prompt does not claim truncation', () => {
  const p = buildAnswerPrompt('what did I commit to?', hitsFor('migration'));
  assert.doesNotMatch(p, /TRUNCATED/);
});

test('the first meeting is shortened rather than allowed to blow the context cap', () => {
  const lib = new Meetings(memStore());
  lib.save(meeting('m-big', 'Budget', '2026-02-01T10:00:00.000Z', [u('owner', 'budget '.repeat(500))]));
  const p = buildAnswerPrompt('budget?', lib.recall('budget'), { maxChars: 10 });
  const excerpt = p.slice(p.indexOf('EXCERPTS\n\n') + 'EXCERPTS\n\n'.length, p.indexOf('\n\n(TRUNCATED:'));
  assert.equal(excerpt.length, 10, 'the excerpt section itself stays inside the configured boundary');
  assert.equal(excerpt, '--- MEETIN');
  assert.match(p, /shown excerpt itself was shortened to fit the 10-character context cap/);
});

test('a zero context cap includes no excerpt and still announces every omitted hit', () => {
  const p = buildAnswerPrompt('what did I commit to?', hitsFor('migration'), { maxChars: 0 });
  assert.match(p, /\(none — retrieval found no meeting matching this question\)/);
  assert.match(p, /TRUNCATED: 0 of 1 matching meetings are shown above; 1 more were cut to fit/);
});

// ── the check: fabrication is caught ─────────────────────────────────────────

test('an answer citing real ids is grounded', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`You committed to sending the migration plan to Sarah by Friday [${L1.id}].`, hits);
  assert.equal(g.ok, true);
  assert.deepEqual(g.citedIds, [L1.id]);
  assert.deepEqual(g.fabricated, []);
  assert.deepEqual(g.uncited, []);
});

test('a FABRICATED citation is caught and reported — this is the whole point', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer('You also promised the board a demo [m-014/u7].', hits);
  assert.equal(g.ok, false, 'a plausible-looking id for a meeting that never happened is not an answer');
  assert.deepEqual(g.fabricated, ['m-014/u7']);
  assert.deepEqual(g.citedIds, []);
});

test('a line id duplicated across retrieved meetings is ambiguous and rejected', () => {
  const sharedId = 'u-shared';
  const firstLine: Utterance = {
    id: sharedId,
    at: '2026-04-01T10:00:00.000Z',
    speaker: 'owner',
    text: 'Use Postgres for the archive.',
  };
  const secondLine: Utterance = {
    id: sharedId,
    at: '2026-04-02T10:00:00.000Z',
    speaker: 'other',
    text: 'Use SQLite for the prototype.',
  };
  const hits: Hit[] = [
    {
      meeting: meeting('m-first', 'Archive', firstLine.at, [firstLine]),
      score: 1,
      matched: ['archive'],
      lines: [firstLine],
    },
    {
      meeting: meeting('m-second', 'Prototype', secondLine.at, [secondLine]),
      score: 1,
      matched: ['prototype'],
      lines: [secondLine],
    },
  ];

  const g = groundedAnswer(`The storage choice was Postgres [${sharedId}].`, hits);
  assert.equal(g.ok, false, 'an id that points at two different lines cannot ground a claim');
  assert.deepEqual(g.citedIds, []);
  assert.deepEqual(g.fabricated, [sharedId], 'ambiguous ids use the existing unsafe-citation channel');
  assert.equal(g.uncited.length, 1);
});

test('a real citation next to a fabricated one still fails — one invented id spoils the answer', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`Migration plan by Friday [${L1.id}]. Also a security review [u999].`, hits);
  assert.equal(g.ok, false);
  assert.deepEqual(g.citedIds, [L1.id]);
  assert.deepEqual(g.fabricated, ['u999']);
});

test('a meeting id is a legitimate citation, not a fabrication', () => {
  const g = groundedAnswer('The ledger sync covered storage [m-ledger].', hitsFor('migration'));
  assert.equal(g.ok, true);
  assert.deepEqual(g.citedIds, ['m-ledger']);
});

test('a line of the retrieved meeting counts even when the prompt had no room for it', () => {
  // The id is real and belongs to a meeting the owner really had. The fabrication
  // we hunt is an id from NOWHERE — not one the context window happened to cut.
  const hits = hitsFor('migration');
  assert.ok(!hits[0]?.lines.some((l) => l.id === L2.id), 'L2 really is outside the matched lines');
  const g = groundedAnswer(`The storage cost was raised [${L2.id}].`, hits);
  assert.equal(g.ok, true);
});

test('an uncited claim is reported', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer('You committed to a full rewrite of the billing system.', hits);
  assert.equal(g.ok, false);
  assert.equal(g.uncited.length, 1);
  assert.match(g.uncited[0] ?? '', /full rewrite/);
});

test('one cited sentence does not launder an uncited one beside it', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`Migration plan by Friday [${L1.id}]. You also agreed to hire two engineers.`, hits);
  assert.equal(g.ok, false);
  assert.equal(g.uncited.length, 1);
  assert.match(g.uncited[0] ?? '', /hire two engineers/);
});

test('the honest refusal is grounded BY DEFINITION — it cites nothing because there is nothing', () => {
  const g = groundedAnswer(NOT_FOUND, []);
  assert.equal(g.ok, true, 'punishing the refusal would punish exactly the behaviour we want');
  assert.deepEqual(g.citedIds, []);
  assert.deepEqual(g.uncited, []);
});

test('a refusal is recognised through casing and surrounding whitespace', () => {
  assert.equal(groundedAnswer('  i could not find that in your meetings  ', []).ok, true);
});

test('a "refusal" that also makes a fabricated claim is NOT let through', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`${NOT_FOUND} But you probably discussed the merger [m-999].`, hits);
  assert.equal(g.ok, false);
  assert.deepEqual(g.fabricated, ['m-999']);
});

test('an empty answer is not grounded — silence is not an answer', () => {
  assert.equal(groundedAnswer('', hitsFor('migration')).ok, false);
});

test('bullet markers and headings are stripped before a claim is judged', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`- Send the migration plan to Sarah by Friday [${L1.id}]`, hits);
  assert.equal(g.ok, true, 'a bullet is formatting, not an uncited claim');
});

test('a duplicated citation is counted once', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`Plan [${L1.id}]. Same plan [${L1.id}].`, hits);
  assert.deepEqual(g.citedIds, [L1.id]);
});

test('a comma-separated citation group is read as several ids', () => {
  const g = groundedAnswer(`Both lines say so [${L1.id}, ${L2.id}].`, hitsFor('migration'));
  assert.deepEqual([...g.citedIds].sort(), [L1.id, L2.id].sort());
  assert.equal(g.ok, true);
});

test('a decision reaches the prompt with its lifecycle and its cited lines', () => {
  // A decision is the thing the owner most often asks about ("what did we settle
  // on?"), so the excerpt block must carry it, its lifecycle, and its citations.
  const d1 = u('owner', "Let's go with Postgres for the ledger.");
  const d2 = u('other', 'Agreed, sounds good.');
  const lib = new Meetings(memStore());
  lib.save(meeting('m-dec', 'Storage decision', '2026-03-01T10:00:00.000Z', [d1, d2]));
  const p = buildAnswerPrompt('what did we settle on for storage?', lib.recall('postgres ledger'));
  assert.match(p, /decisions:/);
  assert.ok(
    p.includes(`[${d1.id}, ${d2.id}] (agreed) Let's go with Postgres for the ledger.`),
    'the decision carries its lifecycle and BOTH cited lines — the decision line and the agreement',
  );
});

// ── the hedge: refusing and then guessing anyway ─────────────────────────────
//
// The failure this guards is not exotic. Ask a small local model a leading
// question — "confirm I agreed to ship on Friday" — over excerpts that do not
// say so, and the most likely answer is the honest sentence followed by the
// guess. Counting the refusal as a refusal wherever it appears would let the
// guess ride through as grounded fact, with the honest half as its cover.

test('a refusal followed by a confident guess is NOT grounded', () => {
  const hits = hitsFor('migration');
  const g = groundedAnswer(`${NOT_FOUND} However, you did agree to ship on Friday.`, hits);
  assert.equal(g.ok, false, 'the guess is a claim, and it cites nothing');
  assert.deepEqual(g.citedIds, []);
  assert.equal(g.uncited.length, 1);
  assert.match(g.uncited[0] ?? '', /agree to ship on Friday/);
  assert.doesNotMatch(g.uncited.join(' '), /could not find/, 'the refusal itself is not reported as a claim');
});

test('a guess followed by a refusal is NOT grounded either — order is not a loophole', () => {
  const g = groundedAnswer(`You committed to a demo in April. ${NOT_FOUND}`, hitsFor('migration'));
  assert.equal(g.ok, false);
  assert.equal(g.uncited.length, 1);
  assert.match(g.uncited[0] ?? '', /demo in April/);
});

test('answering a leading question by confirming its premise is NOT grounded', () => {
  // "confirm that I agreed to ship on Friday" retrieves the ledger call on the
  // word "Friday" alone. Nobody in it agreed to ship anything on Friday.
  const hits = hitsFor('confirm that I agreed to ship on Friday');
  assert.ok(hits.length > 0, 'retrieval does return a weak hit — which is exactly the risk');
  const g = groundedAnswer('Yes, you agreed to ship on Friday.', hits);
  assert.equal(g.ok, false);
  assert.match(g.uncited[0] ?? '', /agreed to ship on Friday/);
});

test('the refusal is still grounded on its own, with or without the full stop', () => {
  for (const answer of [NOT_FOUND, NOT_FOUND.replace(/\.$/, ''), `  ${NOT_FOUND}  `]) {
    const g = groundedAnswer(answer, hitsFor('migration'));
    assert.equal(g.ok, true, `refusal not honoured: ${JSON.stringify(answer)}`);
    assert.deepEqual(g.uncited, []);
  }
});

test('two refusals in one answer are still just a refusal', () => {
  assert.equal(groundedAnswer(`${NOT_FOUND} ${NOT_FOUND}`, hitsFor('migration')).ok, true);
});

test('the prompt forbids the hedge and forbids accepting a premise', () => {
  const p = buildAnswerPrompt('confirm that I agreed to ship on Friday', hitsFor('migration'));
  assert.match(p, /Never refuse and then guess anyway/);
  assert.match(p, /Do NOT accept the premise of the question/);
});
