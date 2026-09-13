/**
 * The propose seam — the only door out of the assistant, and it does not open.
 *
 * Law L6: an agent may PROPOSE but NEVER approve. This module is where that law
 * is expressed as a TYPE rather than as a check that could be forgotten. There
 * are exactly two members in the `Intent` union — `propose-write` and
 * `delegate` — and there is deliberately no `approve`, no `commit`, no `delete`,
 * no `run`. A future caller cannot accidentally route an assistant's answer into
 * an effect, because there is no shape for that answer to arrive in. Adding one
 * would mean editing this file and deleting the comment you are reading, which
 * is the point.
 *
 * `delegate` is the second member and it does not widen that. Read it as the
 * long form of `propose-write`: where one suggests a FILE, the other suggests a
 * JOB, and a job is carried out by a coding agent in a throwaway worktree whose
 * every edit comes back through the same gate as an ordinary capsule. So a
 * delegation buys the owner a stack of proposals, never an effect. And note what
 * it does NOT carry: no agent id, no model, no command, no path, no shell — it
 * is a task in the owner's words and nothing else. Which agent runs, what that
 * costs, and whether the owner must confirm before a hosted one starts are
 * decisions made outside this package, where the owner can see them.
 *
 * What an intent IS: a sentence the model wrote, parsed into structure. What it
 * is NOT: an action, a decision, or anything the owner has agreed to. The daemon
 * turns it into an ordinary proposal, the kernel previews it, and the owner
 * approves it by hand or does not. Between here and any byte on disk sit the
 * whole classify → preview → approve → commit chain and a human.
 *
 * Returning `null` is ALWAYS safe: it means the owner is shown an answer and no
 * proposal, which is the same thing that happens on any ordinary question. So
 * `null` is the default whenever anything is ambiguous, malformed, duplicated or
 * merely unusual. There is no cost to refusing to parse and there is a real cost
 * to parsing something wrong.
 *
 * Pure: a string in, structure or nothing out. Touches no filesystem, and never
 * checks whether the path exists — that is the kernel's business at preview.
 *
 * THE SPLIT. Recognising a `PROPOSE:`/`DELEGATE:` line (the two regexes, the
 * markdown-bolding strip, and the loosest-honest tests `ground.ts` also uses)
 * lives in `intent-lines.ts`. Whether a suggested path is safe to write lives in
 * `path-safety.ts`. The invisible/reordering character classes both of those and
 * this file scrub live in `invisible-chars.ts`. The deterministic fallback's two
 * predicates — is this question an instruction, was the model's answer
 * useless — live in `actionable-request.ts`. This file is the entry point:
 * the `Intent` shapes themselves, `parseIntent`, and `fallbackDelegation`, with
 * every helper re-exported unchanged from where it used to live.
 */
import { INVISIBLE_ALL } from './invisible-chars.js';
import {
  bare,
  DELEGATE_LINE,
  LINE,
  looksLikeDelegateLine,
  looksLikeIntentLine,
  looksLikeProposalLine,
} from './intent-lines.js';
import { normalizeRelPath } from './path-safety.js';
import { answerWasUseless, isActionableRequest } from './actionable-request.js';

// Re-exported so these stay importable from `./intent.js` exactly as before the
// split. See the file comment above for where each now lives.
export { looksLikeProposalLine, looksLikeDelegateLine, looksLikeIntentLine };
export { normalizeRelPath };

/**
 * A suggestion that a file be written. The owner approves it by hand or it never
 * happens.
 */
export interface ProposeWriteIntent {
  readonly kind: 'propose-write';
  /** Repo-relative, forward-slashed, proven not to escape. Never absolute. */
  readonly relPath: string;
  /** One sentence for the approval preview. */
  readonly summary: string;
}

/**
 * A suggestion that a piece of WORK be handed to a coding agent.
 *
 * The whole shape is one string. That is the safety property, not an omission:
 * a task is prose a coding agent reads as its prompt, and there is no field here
 * for a command to run, a binary to spawn, an agent to pick or a price to
 * accept. The agent edits an isolated throwaway worktree and every file it
 * touches arrives as an ordinary approval capsule, so the most a delegation can
 * produce is a queue of things the owner may say no to.
 */
export interface DelegateIntent {
  readonly kind: 'delegate';
  /** What to build, in one sentence, as the owner would say it. */
  readonly task: string;
}

/**
 * Every intent the assistant can express. Two members, on purpose.
 *
 * DO NOT add a member that approves, commits, deletes, runs, sends or pushes.
 * The assistant has no path to `/approvals` and no executor; a union member for
 * one of those would be the first half of building it. `delegate` is not that
 * member: it names a task, and naming a task is not naming a command. The
 * difference is that nothing in this package, or reachable from it, can turn
 * `task` into a process — the daemon decides which agent runs, and a hosted one
 * does not start without the owner's click.
 */
export type Intent = ProposeWriteIntent | DelegateIntent;

/**
 * The kinds, as data, so the safety test can assert the union's contents at
 * runtime instead of trusting a comment. A type cannot be inspected after
 * compilation; this array can.
 */
export const INTENT_KINDS = ['propose-write', 'delegate'] as const;

/** How long a suggested path's summary is kept. */
const MAX_SUMMARY = 200;

/**
 * How long a delegated task may be.
 *
 * Unlike a summary, an over-long task is REFUSED rather than clipped. A summary
 * is a description of a proposal the owner is looking at, so a clipped one still
 * describes the right file; a task is the INSTRUCTION an agent is about to work
 * from, and half an instruction is a different instruction. Producing no
 * delegation costs the owner one more sentence; producing a truncated one would
 * send an agent off to build something nobody asked for.
 */
const MAX_TASK = 500;

/**
 * Clean up raw task text the same way regardless of where it came from — a
 * `DELEGATE:` line the model wrote, or the owner's own question read back by
 * `fallbackDelegation`. Scrubbed for the same two reasons twice over: this
 * string is shown to the owner BEFORE any run starts (a reordering character
 * would let it read as a different job than the one that runs) and it is
 * printed to a terminal by the CLI (an ANSI escape would rewrite the line
 * above it). Each invisible or reordering character becomes a SPACE — never
 * removed outright — so nothing closes up into a word nobody wrote.
 */
function sanitizeTask(raw: string): string {
  return raw
    .replace(INVISIBLE_ALL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

/**
 * Read an intent out of a model's answer, or return `null`.
 *
 * `null` when: there is no intent line; the line is malformed; the path escapes;
 * or there is MORE THAN ONE intent line — two proposals, two delegations, or one
 * of each. All of those are ambiguous, and the safe reading of an ambiguous
 * suggestion is no suggestion — the owner asks again and gets one they can
 * actually check, which costs a round trip and nothing else.
 *
 * Counting the two kinds TOGETHER is the load-bearing part. A proposal and a
 * delegation in one answer are not "a small file plus a job": they are a model
 * that has said two different things about what should happen, and picking
 * either one for the owner would be this seam deciding on their behalf. The
 * bigger of the two is the one that starts an agent, so guessing wrong is not
 * symmetrical, and the answer is to guess neither.
 */
export function parseIntent(answer: string): Intent | null {
  const matches: RegExpMatchArray[] = [];
  const delegations: RegExpMatchArray[] = [];
  for (const line of answer.split(/\r?\n/)) {
    const flat = bare(line);
    const m = LINE.exec(flat);
    if (m !== null) matches.push(m);
    const d = DELEGATE_LINE.exec(flat);
    if (d !== null) delegations.push(d);
  }
  if (matches.length + delegations.length !== 1) return null;

  if (delegations.length === 1) {
    const d = delegations[0];
    if (d === undefined) return null;
    const task = sanitizeTask(d[1] ?? '');
    // Nothing to build, or more instruction than one line should carry — see
    // MAX_TASK. Refusing costs a round trip; a half task costs the wrong work.
    if (task === '' || task.length > MAX_TASK) return null;
    return { kind: 'delegate', task };
  }

  const m = matches[0];
  if (m === undefined) return null;
  const rawPath = m[1] ?? m[2] ?? m[3] ?? '';
  const relPath = normalizeRelPath(rawPath);
  if (relPath === null) return null;

  // A missing summary is not ambiguity about the action — the path is the
  // action — so it gets a plain default rather than costing the owner the
  // proposal. The preview shows the path either way.
  //
  // Invisible and reordering characters are SCRUBBED rather than refused. The
  // summary is prose the owner reads in the approval preview, and the CLI prints
  // it straight to a terminal: left in, an ESC "[2K" "[1G" pair would let the
  // model erase and rewrite the line above its own — the line showing the path,
  // which is the one thing the owner is deciding about. A right-to-left override
  // does the same job without an escape code. A summary is a sentence and a
  // sentence has none of these, so dropping them costs nothing, and dropping
  // them rather than refusing costs the owner no proposal.
  //
  // Each becomes a SPACE, not nothing: removing them outright would let
  // "app<zero-width space>roved" close up into a word the model never wrote.
  const said = (m[4] ?? '')
    .replace(INVISIBLE_ALL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  const summary = said === '' ? `Write ${relPath}` : said.slice(0, MAX_SUMMARY);

  return { kind: 'propose-write', relPath, summary };
}

// ── the deterministic fallback ───────────────────────────────────────────────
//
// `parseIntent` trusts the model to write a `DELEGATE:` line. It usually does
// not: a small local model asked to "add a retry with backoff" is far more
// likely to find nothing in the FACTS to cite and obey rule 5 — reply with the
// bare refusal — than to remember rule 8 and end with the one line this
// package looks for. The result, without this fallback, is that every
// actionable request the owner types dead-ends on "I cannot answer that from
// your Zeno.", which is a fact about the model's obedience, not about what the
// owner asked for.
//
// This is NOT a second way to read intent out of the model's prose — it never
// looks at what the model said beyond whether it said anything. It looks at
// what the OWNER said. If the question itself reads as an instruction — a
// leading verb like "add" or "fix" — and the model came back with nothing
// (the refusal, or empty), the safe, honest move is to offer the owner's own
// words to Forge, not to pretend a question was answered when it was not.
//
// Same law as everywhere else in this file: this produces a `delegate`
// INTENT, one member of the same two-member union `parseIntent` returns,
// `null` is always the safe default, and a delegation is still only ever an
// OFFER — `resolveDelegation` decides what, if anything, may start, and a
// hosted agent still waits on the owner's click.

/**
 * The deterministic fallback: when the model said nothing usable AND the
 * owner's own question reads as an instruction, offer the owner's words to
 * Forge as a `delegate` intent instead of leaving the request dead-ended on
 * the refusal.
 *
 * Pure, like everything else here — two strings in, structure or `null` out.
 * Called from the daemon only when `parseIntent(answer)` already
 * returned `null`, and only ever PRODUCES the same `delegate` shape
 * `parseIntent` can produce, so every downstream consumer — `resolveDelegation`,
 * the approval gate, the "needs confirm" rule for a hosted agent — sees the
 * identical shape and cannot tell which path produced it. That sameness is
 * the point: this is not a second, weaker kind of delegation, it is the same
 * one, reached a different way.
 *
 * The task carried is the OWNER's sentence, not the model's — sanitised the
 * same way a model-written task is (`sanitizeTask`), and refused outright
 * rather than clipped if it is empty or longer than one instruction should be
 * (`MAX_TASK`), for the same reason: half an instruction is a different
 * instruction, and refusing costs one round trip while truncating would send
 * an agent off to build the wrong thing.
 */
export function fallbackDelegation(question: string, answer: string): Intent | null {
  if (!answerWasUseless(answer)) return null;
  if (!isActionableRequest(question)) return null;
  const task = sanitizeTask(question);
  if (task === '' || task.length > MAX_TASK) return null;
  return { kind: 'delegate', task };
}
