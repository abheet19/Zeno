/**
 * Recognising a `PROPOSE:` or `DELEGATE:` line in the model's answer.
 *
 * Split out of `intent.ts`: building the two regexes, stripping markdown
 * bolding first, and the loosest-honest "was this even meant as one" tests are
 * one cohesive unit, used both by `parseIntent` (in the entry module) and by
 * `ground.ts`, which keeps an intent line out of its claim check.
 */
import { DELEGATE_PREFIX, PROPOSE_PREFIX } from './prompt.js';

/**
 * The one line shape the model was told to use, in `prompt.ts`:
 *
 *     PROPOSE: write src/App.tsx — create the app shell
 *
 * A quoted path is allowed, because a filename with a space has no other way to
 * be written unambiguously. The separator before the summary must have spaces
 * around it, so a hyphen inside `my-file.ts` is not mistaken for one.
 */
function escapeForPattern(prefix: string): string {
  return prefix
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:\s*/g, '\\s*:\\s*')
    .replace(/ +/g, '\\s+');
}

function prefixPattern(): string {
  return escapeForPattern(PROPOSE_PREFIX);
}

/** The same treatment for `DELEGATE:`, so `DELEGATE :` and `**DELEGATE:**` parse. */
function delegatePattern(): string {
  return escapeForPattern(DELEGATE_PREFIX);
}

export const LINE = new RegExp(
  `^\\s*(?:[-*>]\\s*)?${prefixPattern()}\\s+` +
    '(?:"([^"]{1,200})"|`([^`]{1,200})`|(\\S{1,200}))' +
    '(?:\\s+[\\u2014\\u2013:-]\\s+(.*))?\\s*$',
  'i',
);

/** Markdown bolding is stripped before matching, so `**PROPOSE: write x**` still parses. */
export function bare(line: string): string {
  return line.replace(/\*\*/g, '');
}

/**
 * The prefix, a space, and then SOMETHING — the loosest honest test for "this
 * line was meant as a proposal".
 *
 * `\s+\S` is the load-bearing part. Without it the test is a bare string
 * `startsWith`, and `PROPOSE: writeup — the deploy succeeded and 9 capsules
 * were approved` reads as a proposal because it happens to begin with the same
 * fourteen characters.
 */
const PROPOSAL_START = new RegExp(`^\\s*(?:[-*>]\\s*)?${prefixPattern()}\\s+\\S`, 'i');

/**
 * Was this line MEANT as a proposal? Used by `ground.ts` to keep an intent out
 * of the claim check, which judges assertions about the owner's state.
 *
 * Deliberately looser than `parseIntent`: a malformed proposal — an escaping
 * path, an unquoted path with a space in it, a missing summary — is still an
 * intent rather than a statement of fact, and `parseIntent` refuses it
 * separately so no proposal reaches the owner either way.
 *
 * But it is not a bare `startsWith`. The prefix must END where the prefix ends.
 * A model that writes `PROPOSE: writeup …`, `PROPOSE: writes …` or
 * `PROPOSE: writer …` is writing prose, and treating that prose as an intent
 * would hand it a one-word way to put any sentence beyond the honesty check —
 * with no proposal produced to show the owner what it smuggled through.
 */
export function looksLikeProposalLine(line: string): boolean {
  return PROPOSAL_START.test(bare(line));
}

/**
 * One `DELEGATE: <task>` line. There is no path and no separator to get wrong —
 * everything after the prefix is the task — so the shape is just "the prefix,
 * then something".
 */
export const DELEGATE_LINE = new RegExp(`^\\s*(?:[-*>]\\s*)?${delegatePattern()}(\\S.*?)\\s*$`, 'i');

/**
 * The same loosest-honest test as `looksLikeProposalLine`, for a delegation.
 *
 * No `\s+` between the prefix and the task: `delegatePattern` already ends in
 * `\s*`, and a model that writes `DELEGATE:build a parser` with no space means
 * exactly what one that writes `DELEGATE: build a parser` means. The prefix must
 * still END where the prefix ends, which is what keeps `DELEGATED: …` — prose
 * about having delegated something — out.
 */
const DELEGATE_START = new RegExp(`^\\s*(?:[-*>]\\s*)?${delegatePattern()}\\S`, 'i');

/**
 * Was this line MEANT as a delegation?
 *
 * Same job as `looksLikeProposalLine` and used in the same place: `ground.ts`
 * removes intent lines before judging claims, because an intent says what the
 * model would LIKE to happen, which no fact about the owner's state could ever
 * support. A delegation left in would be flagged as an uncited claim on every
 * answer that made one.
 */
export function looksLikeDelegateLine(line: string): boolean {
  return DELEGATE_START.test(bare(line));
}

/** Either intent line. This is what `ground.ts` exempts from the claim check. */
export function looksLikeIntentLine(line: string): boolean {
  return looksLikeProposalLine(line) || looksLikeDelegateLine(line);
}
