/**
 * THE HONESTY CHECK.
 *
 * The prompt asks the model to cite its facts. A prompt is a request, and a 7B
 * model running on the owner's laptop will sometimes ignore it — cheerfully, and
 * in fluent, confident prose. This module is the part that is not a request.
 *
 * Two failures are worth catching, and they are different:
 *
 *   A FABRICATED CITATION. The answer says `[p7]` and there is no `p7`. The
 *   model has invented an approval that does not exist and dressed it in the
 *   costume of evidence. This is the dangerous one, because the citation is what
 *   makes the reader stop checking, and it is caught exactly.
 *
 *   AN UNCITED SPECIFIC CLAIM. The answer states a number, a file name or a
 *   name, and points at nothing. It might be true; there is no way to tell, and
 *   an answer nobody can check is not an answer about the owner's own machine.
 *
 * The second check is deliberately NARROW. Flagging every sentence without a
 * citation would flag "Here is what is waiting on you:" and every connective the
 * model writes, the owner would see a warning on every answer, and the warning
 * would stop meaning anything within a day. A check that cries wolf is a check
 * that gets ignored, which is worse than no check at all — so a hedge is not a
 * claim, a question is not a claim, and a sentence that asserts nothing specific
 * is not a claim. What IS a claim is a sentence that puts a concrete fact on the
 * record: a number, a file name or path, a proper name, a quoted identifier.
 *
 * Pure. Text and a snapshot in, a verdict out.
 */
import { looksLikeIntentLine } from './intent.js';
import { CANNOT_ANSWER } from './prompt.js';
import { factIds, type Snapshot } from './snapshot.js';

/**
 * Why an answer failed, in one word the UI can render.
 *
 * Without this, "the model returned nothing at all" and "the model wrote a
 * paragraph that points at no state" arrive as the SAME value — `ok: false`
 * with three empty arrays — and the owner is told an answer is ungrounded with
 * no way to learn whether there even was one. A verdict nobody can act on is
 * only half honest.
 */
export type GroundingFailure = 'empty-answer' | 'fabricated-id' | 'uncited-claim' | 'nothing-cited';

export interface Grounding {
  /**
   * True when the answer is safe to render: it invented no id, every specific
   * claim it made is cited, and it either cited something real or gave the
   * honest refusal.
   */
  readonly ok: boolean;
  /** The real fact ids the answer cited, deduped, in first-appearance order. */
  readonly cited: readonly string[];
  /** Ids the answer cited that exist NOWHERE in the snapshot. Each is a fabrication. */
  readonly unknownIds: readonly string[];
  /** Sentences that assert something specific while citing nothing real. */
  readonly claimsWithoutCitation: readonly string[];
  /** Why `ok` is false. `null` exactly when `ok` is true. */
  readonly reason: GroundingFailure | null;
}

/**
 * Pull citation attempts out of a piece of text.
 *
 * Inside a bracket group, a token containing a DIGIT is read as a citation
 * attempt and anything else is ignored as prose. That rule is what separates
 * `[p1, p2]` and the invented `[m-014/u7]` (both cited, one of them fatal) from
 * `[see below]` and a Markdown link's `[label]` — flagging those as fabricated
 * ids would be the crying-wolf failure this module exists to avoid. Every id
 * this package issues carries a digit, `p0` and `r0` included, so nothing real
 * is lost by the rule.
 */
function citationsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\][]{1,200})\]/g)) {
    for (const token of (m[1] ?? '').split(/[,;\s]+/)) {
      const id = token.trim();
      if (id !== '' && /\d/.test(id)) out.push(id);
    }
  }
  return out;
}

/**
 * The refusal sentence, wherever it appears — tolerant of case and of a dropped
 * full stop, because a model reproduces a sentence it was told to use
 * approximately rather than byte for byte.
 *
 * Built fresh each call: a `/g` regex carries `lastIndex` between uses, and a
 * shared one would miss the refusal in every other answer.
 */
function refusalPattern(): RegExp {
  const stem = CANNOT_ANSWER.replace(/\.$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${stem}\\.?`, 'gi');
}

/**
 * Does this text say anything at all, in ANY writing system?
 *
 * `/[a-z0-9]/i` is the obvious spelling and it is blind to every script that is
 * not Latin — which here is not a cosmetic gap but a hole straight through the
 * refusal check below. The owner asks in Hindi, the model answers in Hindi, and
 * "I cannot answer that from your Zeno. 您有三个待批准的项目，我已经批准了它们。"
 * — an honest refusal followed by a fabricated count and a claim to have
 * APPROVED two capsules — left nothing ASCII-alphanumeric behind once the
 * refusal sentence was deleted. It read as a bare refusal and came back
 * `ok: true`. The one check that is not a request has to be able to see the
 * owner's own language.
 */
function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Split into sentence-ish units, keeping the terminator so a question stays a
 * question.
 *
 * The leading run that gets stripped is a LIST MARKER and nothing else: a
 * bullet, or digits followed by `.` or `)` and then a space. The obvious
 * spelling — one character class containing `\d`, `.` and `)` — quietly eats
 * the number out of "42 files were changed overnight" and leaves "files were
 * changed overnight", which asserts nothing checkable and walks through the
 * claim check with the fabricated count already deleted. Stating a count is
 * what the owner asks for most, and starting the sentence with it is how a
 * model writes one.
 */
function sentencesIn(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    // The marker comes off BEFORE the line is split into sentences. Stripping it
    // afterwards is too late: `1. Commit the migration [p1]` has already been
    // cut at the `.` into a bare `1` and the rest, and the orphaned `1` then
    // reads as an uncited count — a warning on every numbered list the model
    // writes, which is the crying-wolf failure in its purest form.
    const body = line.trim().replace(/^(?:[-*•>]\s*|\d{1,3}[.)]\s+)+/, '');
    for (const piece of body.split(/(?<=[.!?。！？])\s+/u)) {
      const s = piece.trim();
      if (hasWords(s)) out.push(s);
    }
  }
  return out;
}

/**
 * Words that turn an assertion into a guess. A model that hedges is doing the
 * right thing under uncertainty; punishing it would train the owner to ignore
 * the warning, and would push the honest answer and the confident wrong one into
 * the same bucket.
 *
 * `may` is NOT in this list. Matched case-insensitively it also matches the
 * month, and "In May you approved 9 capsules" — a fabricated answer to a
 * question about a time range with no data behind it — read as a hedge and went
 * through untouched. A date is the opposite of a hedge. Lower-case `may` is a
 * real hedge and is matched separately, by `MAY_HEDGE`.
 */
const HEDGE =
  /\b(might|maybe|perhaps|possibly|probably|could|would|seems?|appears?|likely|unclear|unsure|not sure|don't know|do not know|cannot tell|can't tell|no way to tell|if)\b/i;

/** The hedge `may`, and only the hedge: capitalised `May` is a month. */
const MAY_HEDGE = /\bmay\b/;

/** Where the sentence first hedges, or -1. */
function firstHedgeAt(s: string): number {
  const a = s.search(HEDGE);
  const b = s.search(MAY_HEDGE);
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/**
 * Capitalised words that carry no identity. Without this list, "You", "The" and
 * "Zeno" would each read as a proper name and every second sentence would be
 * flagged.
 */
const NOT_A_NAME = new Set([
  'A', 'An', 'And', 'Ask', 'But', 'Both', 'Every', 'For', 'From', 'However', 'I', 'If', 'It', 'Its',
  'Never', 'No', 'Not', 'Nothing', 'Only', 'Or', 'So', 'That', 'The', 'Their', 'There', 'They',
  'This', 'Those', 'To', 'What', 'When', 'Which', 'While', 'Why', 'Yes', 'You', 'Your', 'Zeno',
]);

/**
 * Is this bracket group a citation ATTEMPT — every token in it shaped like an id
 * this package could have issued, and carrying a digit?
 *
 * Only such a group may be blanked before the claim check. Blanking every
 * bracket instead is a hole with a one-character key: `[feature/billing]`,
 * `[src/Billing.tsx]` and `[three capsules]` are not citations of anything, they
 * are the specific fact the sentence is asserting, and erasing them leaves
 * "The branch is now everywhere" — which asserts nothing and is waved through.
 * A model that has been told to wrap its evidence in brackets reaches for
 * brackets.
 */
function isCitationGroup(group: string): boolean {
  const tokens = group.slice(1, -1).split(/[,;\s]+/).filter((t) => t !== '');
  return tokens.length > 0 && tokens.every((t) => /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(t) && /\d/.test(t));
}

/**
 * Blank out the citation groups, keeping the sentence's LENGTH, so `[p1]` does
 * not read as "contains a digit" and turn its own sentence into a claim — and so
 * every offset below still points at the same character of the original.
 */
function maskCitations(sentence: string): string {
  return sentence.replace(/\[[^\][]{0,200}\]/g, (g) => (isCitationGroup(g) ? ' '.repeat(g.length) : g));
}

/**
 * Where the sentence first puts a concrete, checkable fact on the record, or -1.
 *
 * A POSITION rather than a yes/no, because the hedge rule needs to know which
 * came first. Takes an already-masked sentence.
 */
function firstSpecificAt(s: string): number {
  let at = -1;
  const mark = (i: number): void => {
    if (i >= 0 && (at === -1 || i < at)) at = i;
  };

  // `\p{N}` rather than `\d`: "لديك ٣ موافقات معلقة" states a count exactly as
  // "you have 3 approvals waiting" does, and an uncited number is an uncited
  // number in every script. Proper-name detection below stays Latin-only on
  // purpose — `NOT_A_NAME` is an English list, so widening the name rule would
  // read ordinary function words in other scripts as names and flag honest
  // prose, which is the crying-wolf failure this module exists to avoid.
  mark(s.search(/\p{N}/u)); // a count, a tier, a date, a duration
  mark(s.search(/[\w-]{2,}\.[A-Za-z]{2,8}\b/)); // App.tsx, server.ts
  mark(s.search(/[\w-]+[/\\][\w.-]+/)); // src/App, packages\daemon
  mark(s.search(/`[^`]+`|"[^"]+"/)); // a quoted identifier or literal

  // A proper name — but never the first word, which is capitalised only because
  // it starts the sentence.
  for (const m of [...s.matchAll(/\S+/gu)].slice(1)) {
    const w = (m[0] ?? '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (w === '' || NOT_A_NAME.has(w)) continue;
    // Sarah, Friday, Forge — or a CamelCase identifier.
    if (/^[A-Z][a-z]{2,}$/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w)) {
      mark(m.index ?? -1);
      break;
    }
  }
  return at;
}

/**
 * Is the specific fact in this sentence hedged?
 *
 * A hedge only counts when it comes BEFORE the fact it is supposed to qualify.
 * Testing the sentence as a whole — "does a hedge word appear anywhere in it?" —
 * lets one clause launder another, and that is not a theoretical shape: it is
 * how a fluent model answers a leading question.
 *
 *   "The deploy to prod succeeded at 08:14 and could be rolled back."
 *   "You have 12 other approvals from last week, if you want the list."
 *
 * Both put a hard fact on the record and then trail a courtesy clause that
 * happens to contain a hedge word, and both used to come back clean. `could`
 * qualifies the rollback, not the timestamp; `if` qualifies the offer, not the
 * count. Read left to right, a hedge governs what follows it.
 */
function hedgedBefore(masked: string, specificAt: number): boolean {
  const hedgeAt = firstHedgeAt(masked);
  return hedgeAt >= 0 && hedgeAt < specificAt;
}

/**
 * Check that the model actually cited real facts.
 *
 * The honest refusal is grounded BY DEFINITION — "I cannot answer that from your
 * Zeno" cites nothing because there is nothing to cite, and treating it as
 * ungrounded would punish exactly the behaviour we want.
 *
 * But only when the refusal is the WHOLE answer. The hedge — refusing and then
 * guessing anyway, "I cannot answer that from your Zeno. But you have three
 * approvals waiting." — is the single most likely way a small local model
 * answers a leading question, and counting it as a refusal would wave the guess
 * through as fact while the honest half provided the cover. So the refusal is
 * deleted from the text first: if only punctuation survives, it really was a
 * refusal; if a claim survives, that claim is judged like any other.
 *
 * The `PROPOSE:` line is likewise removed before claims are judged, and so is a
 * `DELEGATE:` line. Both are intents, not assertions about the owner's state —
 * they say what the model would LIKE to happen, which is precisely the thing no
 * fact could support, and one always names a file while the other always names a
 * job, so leaving either in would flag every suggestion ever made. What they
 * turn into is `parseIntent`'s business.
 *
 * That exemption is the widest thing this module grants, so it is granted on the
 * intent's SHAPE (`looksLikeIntentLine`) and not on a prefix `startsWith`. The
 * difference is a real hole: `PROPOSE: writeup — the deploy to production
 * succeeded and 9 capsules were approved` begins with the same fourteen
 * characters, is not a proposal, produces nothing for the owner to approve, and
 * used to buy a whole line of fabricated state a pass through the claim check.
 *
 * The exemption still covers the summary the model writes after the em dash, and
 * a fabricated one there reaches the owner in the approval preview. That is a
 * bounded surface — the owner is looking at a suggestion they must approve by
 * hand, and `parseIntent` caps it at 200 characters — but it is not zero, and
 * narrowing it further would flag the many honest summaries that name the file
 * they are about.
 */
export function groundReply(answer: string, snapshot: Snapshot): Grounding {
  const text = answer.trim();
  const known = factIds(snapshot);

  const cited: string[] = [];
  const unknownIds: string[] = [];
  for (const id of citationsIn(text)) {
    const bucket = known.has(id) ? cited : unknownIds;
    if (!bucket.includes(id)) bucket.push(id);
  }

  const withoutProposal = text.split(/\r?\n/).filter((line) => !looksLikeIntentLine(line)).join('\n');

  const beside = withoutProposal.replace(refusalPattern(), ' ');
  const refused = beside !== withoutProposal;
  if (refused && !hasWords(beside)) {
    // `unknownIds` is empty on this path in practice — a bracketed id would have
    // survived the deletion and left something alphanumeric behind — but the
    // verdict is derived from it rather than hard-coded, so no future change to
    // the refusal pattern can turn this into a hole.
    const ok = unknownIds.length === 0;
    return { ok, cited: [], unknownIds, claimsWithoutCitation: [], reason: ok ? null : 'fabricated-id' };
  }

  const claimsWithoutCitation = sentencesIn(beside).filter((s) => {
    if (/[?？]$/u.test(s)) return false; // a question is not a claim
    const masked = maskCitations(s);
    const specificAt = firstSpecificAt(masked);
    if (specificAt < 0) return false; // connective prose is not a claim
    if (hedgedBefore(masked, specificAt)) return false; // a hedge is not an assertion
    return !citationsIn(s).some((id) => known.has(id));
  });

  const ok = unknownIds.length === 0 && claimsWithoutCitation.length === 0 && cited.length > 0;
  return { ok, cited, unknownIds, claimsWithoutCitation, reason: ok ? null : failure() };

  /**
   * The most serious thing wrong, named. A fabricated id outranks an uncited
   * claim, which outranks having cited nothing; and an answer with no words in
   * it at all is reported as the silence it is rather than as an argument the
   * owner is invited to go and check.
   */
  function failure(): GroundingFailure {
    if (unknownIds.length > 0) return 'fabricated-id';
    if (claimsWithoutCitation.length > 0) return 'uncited-claim';
    return hasWords(text) ? 'nothing-cited' : 'empty-answer';
  }
}
