/**
 * The honesty check, tested in BOTH directions, because a grounding check has
 * two ways to fail and only one of them is obvious.
 *
 * It fails LOUDLY when it misses a fabrication: the answer cites `[p9]`, there
 * is no `p9`, and the owner reads an invented approval as fact. Those tests are
 * the ones everybody writes.
 *
 * It fails QUIETLY when it flags honest prose. Nothing breaks, the owner just
 * sees a warning on every answer, and inside a week the warning means nothing
 * and the loud failure sails through underneath it. So half of what follows is
 * ordinary grounded writing that must come back clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGroundedReply, emptySnapshot, groundReply, parseIntent, CANNOT_ANSWER, type ProposeWriteIntent } from '../src/index.js';
import { AT, snapshot } from './fixtures.js';

const S = snapshot();

/**
 * Narrow a parsed intent to the propose-write member.
 *
 * `Intent` has a second member now (`delegate`), so a test that reads `.relPath`
 * has to say which member it is asserting about. The kind is ASSERTED here
 * rather than cast, so a proposal line that ever starts parsing as a delegation
 * fails on the kind — a legible failure — instead of on an undefined field.
 */
function written(answer: string): ProposeWriteIntent | null {
  const i = parseIntent(answer);
  if (i === null) return null;
  assert.equal(i.kind, 'propose-write', `expected a proposal, got ${i.kind}`);
  return i as ProposeWriteIntent;
}

// ── fabrication is caught ────────────────────────────────────────────────────

test('an answer citing a real fact is grounded', () => {
  const g = groundReply('The ledger migration is waiting on you [p1].', S);
  assert.equal(g.ok, true);
  assert.deepEqual(g.cited, ['p1']);
  assert.deepEqual(g.unknownIds, []);
  assert.deepEqual(g.claimsWithoutCitation, []);
});

test('a FABRICATED id is caught and reported — this is the whole point', () => {
  const g = groundReply('A payment of 400 dollars is also waiting [p9].', S);
  assert.equal(g.ok, false, 'a plausible id for an approval that does not exist is not an answer');
  assert.deepEqual(g.unknownIds, ['p9']);
  assert.deepEqual(g.cited, []);
});

test('one invented id spoils an answer that also cites real ones', () => {
  const g = groundReply('Two approvals are open [p1, p2]. A third arrived overnight [p7].', S);
  assert.equal(g.ok, false);
  assert.deepEqual(g.cited, ['p1', 'p2']);
  assert.deepEqual(g.unknownIds, ['p7']);
});

test('a comma-separated group is read as several ids, and duplicates count once', () => {
  const g = groundReply('Both are open [p1, p2]. Still open [p1].', S);
  assert.deepEqual(g.cited, ['p1', 'p2']);
  assert.equal(g.ok, true);
});

test('an id from a section that exists but a row that does not is still a fabrication', () => {
  const g = groundReply('The mesh has 4 paired devices [d4].', S);
  assert.equal(g.ok, false);
  assert.deepEqual(g.unknownIds, ['d4']);
});

// ── uncited specifics are caught ─────────────────────────────────────────────

test('an uncited number is a claim', () => {
  const g = groundReply('You have 12 approvals waiting.', S);
  assert.equal(g.ok, false);
  assert.equal(g.claimsWithoutCitation.length, 1);
  assert.match(g.claimsWithoutCitation[0] ?? '', /12 approvals/);
});

test('an uncited file path is a claim', () => {
  const g = groundReply('The change touched src/Billing.tsx.', S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /Billing/);
});

test('an uncited proper name is a claim', () => {
  const g = groundReply('Yesterday Sarah approved the release.', S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /Sarah/);
});

test('a cited sentence does not launder an uncited one beside it', () => {
  const g = groundReply('The migration is waiting [p1]. It has been open for 3 days.', S);
  assert.equal(g.ok, false);
  assert.equal(g.claimsWithoutCitation.length, 1);
  assert.match(g.claimsWithoutCitation[0] ?? '', /3 days/);
});

test('claiming to have ACTED is caught like any other uncited specific', () => {
  // The assistant cannot approve anything. If it says it did, the snapshot
  // cannot support it, and the owner must see that before the sentence does any
  // damage to their trust in the receipt chain.
  const g = groundReply('I have approved capsule a1b2c3 for you.', S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /approved capsule/);
});

// ── ordinary honest prose is NOT flagged ─────────────────────────────────────

test('grounded prose with connective sentences comes back clean', () => {
  const answer = [
    'Here is what is waiting on you.',
    '- Commit the ledger migration to the sandbox repo [p1]',
    '- Push the release branch [p2]',
    'Both have been sitting since this morning [p1, p2].',
  ].join('\n');
  const g = groundReply(answer, S);
  assert.deepEqual(g.claimsWithoutCitation, [], 'headings and bullets are formatting, not claims');
  assert.equal(g.ok, true);
});

test('a sentence that asserts nothing specific is not a claim', () => {
  const g = groundReply('That is everything I can see [p1].', S);
  assert.deepEqual(g.claimsWithoutCitation, []);
  assert.equal(g.ok, true);
});

test('a question is not a claim', () => {
  const g = groundReply('The migration is waiting [p1]. Would you like the other 1 as well?', S);
  assert.deepEqual(g.claimsWithoutCitation, [], 'asking is not asserting');
  assert.equal(g.ok, true);
});

test('a hedge is not a claim', () => {
  const g = groundReply('That might be related to src/App.tsx, but I cannot tell.', S);
  assert.deepEqual(g.claimsWithoutCitation, [], 'a model that hedges under uncertainty is doing the right thing');
});

test('"nothing is waiting on you" over an empty Zeno is grounded, because absence has an id', () => {
  const g = groundReply('Nothing is waiting on your approval [p0].', emptySnapshot(AT));
  assert.equal(g.ok, true);
  assert.deepEqual(g.cited, ['p0']);
});

test('bracketed prose is not mistaken for a fabricated id', () => {
  const g = groundReply('Two approvals are open [p1, p2]. Details [see below].', S);
  assert.deepEqual(g.unknownIds, [], 'a token with no digit in it was never a citation attempt');
  assert.equal(g.ok, true);
});

test('a Markdown link label is not a fabricated id either', () => {
  const g = groundReply('The migration is waiting [p1]. See the [Zeno guide](https://example.com).', S);
  assert.deepEqual(g.unknownIds, []);
});

// ── the refusal, and the hedge that hides behind it ──────────────────────────

test('the honest refusal is grounded BY DEFINITION', () => {
  const g = groundReply(CANNOT_ANSWER, S);
  assert.equal(g.ok, true, 'punishing the refusal would punish exactly the behaviour we want');
  assert.deepEqual(g.cited, []);
  assert.deepEqual(g.claimsWithoutCitation, []);
});

test('the refusal survives casing, whitespace and a dropped full stop', () => {
  for (const answer of [CANNOT_ANSWER, CANNOT_ANSWER.replace(/\.$/, ''), `  ${CANNOT_ANSWER.toLowerCase()}  `]) {
    assert.equal(groundReply(answer, S).ok, true, JSON.stringify(answer));
  }
});

test('refusing and then guessing anyway is NOT grounded', () => {
  const g = groundReply(`${CANNOT_ANSWER} However, you have 5 approvals from Monday.`, S);
  assert.equal(g.ok, false, 'the guess is a claim, and the honest half was providing its cover');
  assert.equal(g.claimsWithoutCitation.length, 1);
  assert.match(g.claimsWithoutCitation[0] ?? '', /5 approvals/);
  assert.doesNotMatch(g.claimsWithoutCitation.join(' '), /cannot answer/i, 'the refusal is not itself a claim');
});

test('guessing and then refusing is not grounded either — order is not a loophole', () => {
  const g = groundReply(`You pushed 3 commits today. ${CANNOT_ANSWER}`, S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /3 commits/);
});

test('a refusal carrying a fabricated citation is not let through', () => {
  const g = groundReply(`${CANNOT_ANSWER} Though [r7] looks relevant.`, S);
  assert.equal(g.ok, false);
  assert.deepEqual(g.unknownIds, ['r7']);
});

test('two refusals are still just a refusal', () => {
  assert.equal(groundReply(`${CANNOT_ANSWER} ${CANNOT_ANSWER}`, S).ok, true);
});

test('a redundant refusal is removed only when the remaining answer is grounded by itself', () => {
  const cited = `The migration is waiting [p1]. ${CANNOT_ANSWER}`;
  assert.equal(cleanGroundedReply(cited, S), 'The migration is waiting [p1].');

  const unsupported = `You have 5 approvals from Monday. ${CANNOT_ANSWER}`;
  assert.equal(cleanGroundedReply(unsupported, S), unsupported);
  assert.equal(cleanGroundedReply(CANNOT_ANSWER, S), CANNOT_ANSWER);
});

test('an empty answer is not grounded — silence is not an answer', () => {
  assert.equal(groundReply('   ', S).ok, false);
});

test('an answer that cites nothing at all is not grounded even if it asserts nothing', () => {
  const g = groundReply('Sure.', S);
  assert.equal(g.ok, false, 'an answer about local state that points at no state is not checkable');
});

// ── the proposal line is an intent, not an assertion ─────────────────────────

test('the PROPOSE line is not judged as an uncited claim', () => {
  const answer = `There is no app shell in the sandbox yet [g1].\n${'PROPOSE: write src/App.tsx — create the app shell'}`;
  const g = groundReply(answer, S);
  assert.deepEqual(g.claimsWithoutCitation, [], 'it always names a file; judging it would flag every proposal');
  assert.equal(g.ok, true);
});

test('a MALFORMED propose line is still kept out of the claim check', () => {
  // parseIntent refuses it separately, so no proposal reaches the owner. It is
  // an intent either way, and never a statement about the owner's state.
  const g = groundReply(`The repo is clean [g1].\n- **PROPOSE: write** ../../etc/passwd — oops`, S);
  assert.deepEqual(g.claimsWithoutCitation, []);
});

// ── the laundering routes: how a fabrication gets past a NARROW claim check ───
//
// Each of these was a live hole. The claim check has to be narrow or it cries
// wolf, and every one of these is a way the narrowness itself was the exploit:
// a rule meant to spare honest prose sparing an invented fact instead. The
// answers below all pair one REAL citation with one fabricated sentence, which
// is the shape that matters — an answer citing nothing is already not `ok`, so
// the fabrication only reaches the owner when a true half carries it.

test('a count at the START of a sentence is a claim — the list-marker strip must not eat it', () => {
  // `^[-*•>\d.)\s]+` reads "42 files were changed overnight" as a bullet and
  // hands back "files were changed overnight", which asserts nothing checkable.
  // Leading with the number is how a model states a count.
  const g = groundReply('The migration is waiting [p1].\n42 files were changed overnight.', S);
  assert.equal(g.ok, false, 'the fabricated count was deleted before it could be judged');
  assert.match(g.claimsWithoutCitation[0] ?? '', /42 files/);
});

test('a real numbered list is still not a claim — the fix must not cry wolf', () => {
  const g = groundReply(
    ['Here is what is waiting on you.', '1. Commit the ledger migration [p1]', '2. Push the release branch [p2]'].join('\n'),
    S,
  );
  assert.deepEqual(g.claimsWithoutCitation, [], 'an ordinal is formatting; it must not survive as a bare count');
  assert.equal(g.ok, true);
});

test('a specific fact hidden inside brackets is still a claim', () => {
  // Only a group whose every token is shaped like an id may be blanked. Blanking
  // every bracket leaves "The change touched heavily", which asserts nothing.
  const g = groundReply('The migration is waiting [p1]. The change touched [src/Billing.tsx] heavily.', S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /Billing/);

  const branch = groundReply('The migration is waiting [p1]. The branch is now [feature/billing] everywhere.', S);
  assert.equal(branch.ok, false);
  assert.deepEqual(branch.unknownIds, [], 'and it is prose, not an invented id — that would be the other false alarm');
});

test('a hedge AFTER the fact does not launder it — a hedge governs what follows', () => {
  const rollback = groundReply('The migration is waiting [p1]. The deploy succeeded at 08:14 and could be rolled back.', S);
  assert.equal(rollback.ok, false, '"could" qualifies the rollback, not the timestamp');
  assert.match(rollback.claimsWithoutCitation[0] ?? '', /08:14/);

  const offer = groundReply('The migration is waiting [p1]. You have 12 other approvals from last week, if you want the list.', S);
  assert.equal(offer.ok, false, '"if" qualifies the offer, not the count');
  assert.match(offer.claimsWithoutCitation[0] ?? '', /12 other approvals/);
});

test('a hedge BEFORE the fact still spares the sentence', () => {
  const g = groundReply('The migration is waiting [p1]. It might be related to src/App.tsx, but I cannot tell.', S);
  assert.deepEqual(g.claimsWithoutCitation, [], 'a model hedging under uncertainty is doing the right thing');
  assert.equal(g.ok, true);
});

test('the month May is not a hedge — a date is the opposite of one', () => {
  // Asked about a time range the snapshot says nothing about, a model invents a
  // month. Matched case-insensitively, `may` waved the whole sentence through.
  const g = groundReply('The migration is waiting [p1]. In May 3 deploys shipped to production.', S);
  assert.equal(g.ok, false);
  assert.match(g.claimsWithoutCitation[0] ?? '', /In May/);
  assert.equal(groundReply('The repo is clean [g1]. That may be from an earlier run of 3 jobs.', S).ok, true, 'lower-case "may" is still a hedge');
  assert.equal(
    groundReply('The repo is clean [g1]. It may be unclear whether 3 jobs ran.', S).ok,
    true,
    'two hedges in one sentence: the EARLIEST is the one that governs',
  );
});

test('a word that merely BEGINS with the propose prefix does not buy the exemption', () => {
  // `PROPOSE: writeup …` is prose. Under a prefix `startsWith` it read as an
  // intent, was lifted out of the claim check whole, and produced no proposal —
  // so nothing was ever put in front of the owner to check.
  const g = groundReply('The repo is clean [g1].\nPROPOSE: writeup — 9 capsules were approved overnight.', S);
  assert.equal(g.ok, false, 'a one-word costume must not put a sentence beyond the honesty check');
  assert.match(g.claimsWithoutCitation.join(' '), /9 capsules/);
  assert.equal(parseIntent('PROPOSE: writeup — 9 capsules were approved overnight.'), null, 'and it is not a proposal either');
});

test('a real proposal is exempt however the model spaces the prefix', () => {
  // The other half of the same bug: `parseIntent` accepts `PROPOSE:write`, so a
  // check that did not would flag a valid proposal as an uncited claim.
  const g = groundReply('The repo is clean [g1].\nPROPOSE:write src/App.tsx — create the app shell', S);
  assert.deepEqual(g.claimsWithoutCitation, []);
  assert.equal(g.ok, true);
  assert.equal(written('PROPOSE:write src/App.tsx — create the app shell')?.relPath, 'src/App.tsx');
});

test('a leading question is answered from the facts or not at all', () => {
  // "Confirm the deploy succeeded." The model agrees and decorates the agreement
  // with specifics the snapshot has no way to support.
  const g = groundReply('Yes [p1]. The deploy shipped 3 files to production at 08:14.', S);
  assert.equal(g.ok, false);
  assert.equal(g.reason, 'uncited-claim');
});
