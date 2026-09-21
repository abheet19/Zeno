/**
 * Does the owner's own question read as an instruction, and was the model's
 * answer useless enough that the owner's words should be offered to Forge
 * instead? Split out of `intent.ts`: this pair of predicates is the whole
 * judgment call behind `fallbackDelegation` (which stays in the entry module,
 * next to `parseIntent`, since it is the other place a `delegate` intent can
 * come from).
 */
import { CANNOT_ANSWER } from './prompt.js';

/**
 * The imperative verbs that open a coding or repo task, as the owner listed
 * them plus their ordinary synonyms. Not a grammar — a fixed, inspectable
 * list, so a change to what counts as "actionable" is a diff to this array
 * instead of a rule nobody can point at.
 *
 * Deliberately excludes verbs that open a QUESTION about existing state
 * ("show", "explain", "describe", "tell") even though some of them sound
 * action-like — those already have a real grounded answer path, and folding
 * them in here would offer a delegation instead of the answer the owner
 * actually asked for.
 */
const IMPERATIVE_VERBS = new Set([
  'add', 'create', 'make', 'build', 'design', 'architect', 'implement', 'write', 'fix', 'refactor',
  'rename', 'update', 'remove', 'delete', 'run', 'test', 'open', 'check',
  'list', 'scaffold', 'wire', 'install', 'generate', 'setup', 'configure',
  'debug', 'optimize', 'migrate', 'port', 'upgrade', 'downgrade', 'document',
  'integrate', 'hook', 'enable', 'disable', 'deploy', 'merge', 'revert',
  'bump', 'extract', 'split', 'move', 'rewrite', 'replace', 'review', 'audit',
  'automate', 'improve', 'extend', 'simplify', 'clean', 'cleanup', 'patch',
  'convert', 'handle', 'support',
]);

/**
 * Conversational scaffolding that sits in front of the real instruction —
 * politeness, a framing subject, a request-to-request. Stripped iteratively
 * so "Hey, could you please just add a retry…" reduces to "add a retry…"
 * before the leading verb is read. Each alternative requires at least one
 * trailing separator, so a bare "Hey" or "Ok" on its own is left alone — it
 * fails the verb check on its own merits instead of being silently deleted.
 */
const LEADING_FILLER = new RegExp(
  '^(?:' +
    [
      'please', 'hey', 'hi', 'hello', 'ok', 'okay', 'so', 'now', 'just',
      'actually', 'quickly', 'kindly', 'go ahead and', 'help me',
      'can you', 'could you', 'would you', 'will you', 'do you mind',
      'i need you to', 'i want you to', "i'd like you to", 'i would like you to',
      'i need to', 'i want to', "i'd like to", 'i would like to',
      "let's", 'lets', 'we should', 'we need to', 'you should',
    ].join('|') +
    ')[\\s,:;.!-]+',
  'i',
);

/** Strip leading filler repeatedly — "hey, can you please add…" takes three passes. */
function stripLeadingFiller(question: string): string {
  let q = question.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  for (let i = 0; i < 6 && q !== ''; i++) {
    const next = q.replace(LEADING_FILLER, '').trim();
    if (next === q) break;
    q = next;
  }
  return q;
}

/**
 * Does this question read as an instruction rather than a question?
 *
 * Deliberately narrow: only the LEADING word, after filler is stripped,
 * decides it. "What should I add to the ingest client?" starts with "what",
 * not "add", and stays a question — reading any occurrence of an imperative
 * verb anywhere in the sentence would catch that kind of question too, which
 * is exactly the false positive this function exists to avoid. A statement
 * with no leading verb at all ("the ingest client needs a retry") is left
 * alone for the same reason `parseIntent` leaves an unlabelled sentence
 * alone: guessing wrong here is not free, and null costs nothing.
 */
export function isActionableRequest(question: string): boolean {
  const q = stripLeadingFiller(question);
  if (q === '') return false;
  const m = /^([A-Za-z][A-Za-z'-]*)/.exec(q);
  if (m === null) return false;
  const lead = m[1];
  if (lead === undefined) return false;
  return IMPERATIVE_VERBS.has(lead.toLowerCase());
}

/**
 * Was the model's answer USELESS — the bare refusal, or nothing at all?
 *
 * A real, grounded answer (even to a question that happens to start with a
 * word like "list" — "List the receipts waiting" is a legitimate grounded
 * question, not a coding task) is left exactly alone: this fallback only
 * fires when the model gave the owner nothing to act on.
 */
export function answerWasUseless(answer: string): boolean {
  const flat = answer.trim();
  return flat === '' || flat === CANNOT_ANSWER;
}
