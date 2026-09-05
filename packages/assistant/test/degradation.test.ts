/**
 * HONEST DEGRADATION AND SIZE.
 *
 * The other test files check the assistant on a normal morning: a handful of
 * approvals, an English question, an answer with citations in it. This one
 * checks the edges, because the edges are where an assistant stops being wrong
 * in a way you can see and starts being wrong in a way you cannot.
 *
 * The rule under test is one sentence: at every size, in every language, and on
 * every empty input, the package must be LEGIBLE. Not a throw, not a silent
 * empty, and — the one that actually costs the owner something — not a lie. A
 * lie here is specific and it does not look like a lie: it is a fact line that
 * asserts absence over a section that was clipped to nothing, a count taken
 * after the clipping rather than before, a refusal in one script followed by a
 * fabrication in another, a snapshot pushed out of the model's window by a
 * question nobody bounded. Each of those reads, downstream, as a confident
 * grounded answer about the owner's own machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssistantPrompt,
  buildSnapshot,
  emptySnapshot,
  factsOf,
  factIds,
  groundReply,
  parseIntent,
  CANNOT_ANSWER,
  NO_QUESTION,
  QUESTION_MAX,
  type PendingFact,
  type ReceiptFact,
} from '../src/index.js';
import { AT, snapshot } from './fixtures.js';

const S = snapshot();

// ── nothing at all: a Zeno installed ten seconds ago ─────────────────────────

test('a brand-new Zeno answers rather than throwing or going blank', () => {
  const empty = emptySnapshot(AT);
  assert.deepEqual(empty.truncated, [], 'nothing was clipped, so nothing is claimed to have been');

  const p = buildAssistantPrompt('what is waiting on me?', empty);
  assert.doesNotMatch(p, /TRUNCATED/, 'an empty machine is complete, not truncated');
  for (const id of ['p0', 'r0', 'w0', 'g0', 'm0', 'd0']) {
    assert.ok(factIds(empty).has(id), `${id} must exist so absence can be cited`);
  }

  const g = groundReply('Nothing is waiting on you. [p0]', empty);
  assert.equal(g.ok, true, 'the honest good-news answer on day one must not read as ungrounded');
  assert.equal(g.reason, null);
});

// ── a section clipped to NOTHING must not assert absence ─────────────────────

test('a section clipped to nothing says so instead of claiming there is nothing', () => {
  // The dangerous shape, and it is one line of budget away: the queue holds a
  // T4, the cap drops it, and the zero-fact — which the model will cite, and
  // which the grounding check will accept, because it is a real fact — says
  // "nothing is waiting on your approval".
  const pending: PendingFact[] = [
    { id: 'a1', summary: 'Push the release branch', tier: 'T3', ageMin: 5 },
    { id: 'a2', summary: 'Wipe the vault', tier: 'T4', ageMin: 9 },
  ];
  const s = buildSnapshot({ at: AT, pending }, { pending: 0 });

  assert.equal(s.pending.length, 0);
  assert.deepEqual(s.truncated, [{ section: 'pending', kept: 0, total: 2, shortened: 0 }]);

  const zero = factsOf(s)[0]?.facts[0];
  assert.equal(zero?.id, 'p0', 'there is still something to cite — a refusal is not the answer here');
  assert.doesNotMatch(
    zero?.text ?? '',
    /nothing is waiting on your approval/,
    'a clipped-away T4 must never be rendered as an empty queue',
  );
  assert.match(zero?.text ?? '', /2 were dropped/, 'the count that was dropped is stated');
  assert.match(zero?.text ?? '', /not evidence that there are none/);
});

test('an EMPTY section and a CLIPPED-TO-NOTHING section do not read the same', () => {
  const emptyText = factsOf(emptySnapshot(AT))[2]?.facts[0]?.text;
  const clippedText = factsOf(
    buildSnapshot({ at: AT, work: [{ id: 'w', title: 'Wire the route', labels: [], state: 'open' }] }, { work: 0 }),
  )[2]?.facts[0]?.text;
  assert.equal(emptyText, 'the backlog is empty');
  assert.notEqual(clippedText, emptyText, 'these are different facts and must not share a sentence');
});

// ── a count is taken BEFORE the clipping, not after ──────────────────────────

test('the repo states how many files changed, not how many survived the cap', () => {
  const changed = Array.from({ length: 100 }, (_, i) => `src/f${i}.ts`);
  const s = buildSnapshot({ at: AT, repo: { branch: 'main', head: 'abc1234', changed } });
  const text = factsOf(s).find((x) => x.title === 'SANDBOX REPO')?.facts[0]?.text ?? '';

  assert.match(text, /100 changed, 25 shown:/, 'counting the clipped list would state a wrong number as a fact');
  assert.doesNotMatch(text, /— 25 changed:/);
  assert.match(buildAssistantPrompt('what is dirty?', s), /repo: 25 of 100 shown, 75 not shown/);
});

// ── ten thousand receipts ────────────────────────────────────────────────────

test('ten thousand receipts are clipped, announced, and cannot blow the prompt', () => {
  const receipts: ReceiptFact[] = Array.from({ length: 10_000 }, (_, i) => ({
    id: `rc-${i}`,
    outcome: 'COMMITTED',
    summary: `thing ${i} happened`,
    at: AT,
  }));
  const s = buildSnapshot({ at: AT, receipts });
  assert.equal(s.receipts.length, 20);

  const p = buildAssistantPrompt('what happened today?', s);
  assert.ok(p.length < 20_000, `a ledger must not be able to become the prompt (was ${p.length})`);
  assert.match(p, /receipts: 20 of 10000 shown, 9980 not shown/, 'the 9,980 the model never saw are stated');
  assert.match(p, /If the answer might depend on something not shown above, say so/);
});

// ── the question is state too, and it was the one thing not bounded ──────────

test('a 100KB question is clipped, and the clipping is announced like any other', () => {
  // The snapshot budgets every fact so a big ledger cannot blow the window, and
  // then the question — pasted in whole — could do it single-handed: a 105KB
  // paste made the question 98% of the prompt, so an 8B model never reached the
  // facts and answered from its weights about the owner's machine.
  const huge = 'why did zeno do that '.repeat(5_000);
  assert.ok(huge.length > 100_000);

  const p = buildAssistantPrompt(huge, S);
  assert.ok(p.length < 10_000, `the question must not be able to become the prompt (was ${p.length})`);
  assert.match(p, /TRUNCATED — you were NOT shown all of the owner's state:/);
  assert.match(p, new RegExp(`question: ${huge.length - 1} characters, shortened to ${QUESTION_MAX}`));
  assert.ok(p.indexOf('[p1]') > 0, 'and the facts are still there, which is the whole point');
});

test('a question that fits is not announced as clipped', () => {
  const p = buildAssistantPrompt('x'.repeat(QUESTION_MAX), S);
  assert.doesNotMatch(p, /TRUNCATED/);
});

test('the question budget can be tightened, and a silly one still yields a prompt', () => {
  assert.match(buildAssistantPrompt('what is waiting on me?', S, 10), /question: 22 characters, shortened to 10/);
  assert.match(buildAssistantPrompt('what is waiting on me?', S, 0), /QUESTION\n…/, 'never a throw, never empty');
});

// ── an empty question ────────────────────────────────────────────────────────

test('an empty question is stated as one, not left as a blank line under QUESTION', () => {
  // A blank question slot hands the model the owner's private state, the
  // instruction to answer, and nothing to answer — an invitation to free
  // associate over exactly the material that must not be guessed at.
  for (const blank of ['', '   ', '\n\n\t ']) {
    const p = buildAssistantPrompt(blank, S);
    assert.ok(p.includes(`QUESTION\n${NO_QUESTION}\n`), JSON.stringify(blank));
    assert.ok(p.trimEnd().endsWith('ANSWER'));
  }
});

test('the empty-question line points at the refusal the model is meant to give', () => {
  assert.match(NO_QUESTION, /rule 5/);
  assert.equal(groundReply(CANNOT_ANSWER, S).ok, true, 'and that refusal is grounded when it arrives');
});

// ── another language ─────────────────────────────────────────────────────────

test('a question in another language survives into the prompt intact', () => {
  const q = 'मेरी मंज़ूरी का इंतज़ार क्या कर रहा है?';
  assert.ok(buildAssistantPrompt(q, S).includes(q));
});

test('an answer in another language that cites a real fact is grounded', () => {
  const g = groundReply('रिलीज़ ब्रांच पुश करना बाकी है। [p1]', S);
  assert.equal(g.ok, true, 'the owner may be answered in their own language');
  assert.deepEqual(g.cited, ['p1']);
});

test('REFUSING IN ENGLISH AND THEN GUESSING IN ANOTHER SCRIPT IS NOT A REFUSAL', () => {
  // The hole this file was written for. The refusal sentence is deleted and
  // what is left is inspected — and the inspection used to be `/[a-z0-9]/i`,
  // which is blind to every non-Latin script. So a fabricated count plus a
  // claim to have APPROVED two capsules left "nothing" behind and came back
  // ok: true, on the most likely question to provoke it.
  for (const guess of [
    '您有三个待批准的项目，我已经批准了它们。', // "you have three pending, I approved them"
    'आपके पास ३ मंज़ूरियाँ बाकी हैं।', // Devanagari digit
    'لديك ٣ موافقات معلقة.', // Arabic-Indic digit
  ]) {
    const g = groundReply(`${CANNOT_ANSWER} ${guess}`, S);
    assert.equal(g.ok, false, `a refusal followed by "${guess}" is not a refusal`);
    assert.notEqual(g.reason, null);
  }
});

test('a digit is a specific claim in any script', () => {
  const g = groundReply('لديك ٣ موافقات معلقة.', S);
  assert.deepEqual(g.claimsWithoutCitation, ['لديك ٣ موافقات معلقة.']);
  assert.equal(g.reason, 'uncited-claim');
});

test('a pure refusal is still grounded, in whatever whitespace and casing it arrives', () => {
  assert.equal(groundReply(`  ${CANNOT_ANSWER.toUpperCase()}  `, S).ok, true, 'the fix must not punish honesty');
});

// ── an empty or whitespace model reply ───────────────────────────────────────

test('an empty reply is reported AS empty, not as an argument that failed to convince', () => {
  for (const silence of ['', '   ', '\n\n \t\n', '...']) {
    const g = groundReply(silence, S);
    assert.equal(g.ok, false, JSON.stringify(silence));
    assert.equal(g.reason, 'empty-answer', 'the owner is told the model said nothing, not that it was ungrounded');
    assert.equal(parseIntent(silence), null, 'and silence proposes nothing');
  }
});

test('every way of failing has its own name, so the UI can say which one happened', () => {
  assert.equal(groundReply('It is waiting [p9].', S).reason, 'fabricated-id');
  assert.equal(groundReply('You have 12 approvals waiting.', S).reason, 'uncited-claim');
  assert.equal(groundReply('Sure.', S).reason, 'nothing-cited');
  assert.equal(groundReply('', S).reason, 'empty-answer');
  assert.equal(groundReply('The migration is waiting [p1].', S).reason, null, 'and success is not a failure');
});

// ── no clip anywhere is silent ───────────────────────────────────────────────

test('even the capture timestamp announces its own clipping', () => {
  // It will never fire against a real ISO-8601 instant. It is here because the
  // clip existed with its tally thrown away, and "every clip is announced" is
  // either true with no exceptions or it is a sentence in a comment.
  const s = buildSnapshot({ at: 'X'.repeat(500) });
  assert.equal(s.at.length, 200);
  assert.deepEqual(s.truncated, [{ section: 'at', kept: 1, total: 1, shortened: 1 }]);
  assert.match(buildAssistantPrompt('when?', s), /at: 1 entry was shortened/);
});

test('a snapshot that lost something says so somewhere the model will read it', () => {
  // The whole lens in one assertion: for every section, clipping ANYTHING puts a
  // notice in the prompt. A snapshot that quietly saw half the owner's state and
  // answered confidently is strictly worse than one that says it saw part.
  const p = buildAssistantPrompt(
    'what is going on?',
    buildSnapshot(
      {
        at: AT,
        pending: [{ id: 'a', summary: 'a', tier: 'T1', ageMin: 1 }, { id: 'b', summary: 'b', tier: 'T1', ageMin: 2 }],
        receipts: [{ id: 'r', outcome: 'OK', summary: 's', at: AT }, { id: 'r2', outcome: 'OK', summary: 's', at: AT }],
        work: [{ id: 'w', title: 't', labels: [], state: 'open' }, { id: 'w2', title: 't', labels: [], state: 'open' }],
        memory: [{ id: 'm', title: 't', body: 'b' }, { id: 'm2', title: 't', body: 'b' }],
        devices: [{ name: 'd', paired: true }, { name: 'd2', paired: false }],
        repo: { branch: 'main', head: 'abc', changed: ['a.ts', 'b.ts'] },
      },
      { pending: 1, receipts: 1, work: 1, memory: 1, devices: 1, changed: 1 },
    ),
  );
  for (const section of ['pending', 'receipts', 'work', 'memory', 'devices', 'repo']) {
    assert.match(p, new RegExp(`${section}: 1 of 2 shown, 1 not shown`), section);
  }
});
