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
 */
import { CANNOT_ANSWER, DELEGATE_PREFIX, PROPOSE_PREFIX } from './prompt.js';

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

/** How long a suggested path may be, and how long its summary is kept. */
const MAX_PATH = 200;
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
 * Windows device names. `CON`, `NUL`, `COM1` and friends are not files: opening
 * `src/NUL` opens the null device, and a path ending in one is a way to make a
 * write go somewhere nobody previewed. Windows-first means this is a real case,
 * not a curiosity, and the check is on the stem so `NUL.txt` is caught too.
 *
 * The list is Microsoft's, not a memory of it: `COM0`/`LPT0`, the superscript
 * `COM¹`/`COM²`/`COM³` forms, and the console handles `CONIN$`/`CONOUT$` are all
 * reserved. `CONOUT$` in particular is live on Windows 11 today — redirecting to
 * it writes to the console and produces no file at all, so a preview that said
 * "creates src/CONOUT$" would have described a write that never happened.
 */
const DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
  'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'COM\u00b9', 'COM\u00b2', 'COM\u00b3', 'LPT\u00b9', 'LPT\u00b2', 'LPT\u00b3',
]);

/**
 * The device name Windows would actually see in this segment.
 *
 * Win32 cuts the name at the first `.` and THEN discards trailing spaces, so
 * `NUL .txt` and `NUL` are the same name. Reading the stem without that trim
 * lets a device through behind one space.
 */
function deviceStem(segment: string): string {
  return (segment.split('.')[0] ?? '').replace(/[ \t]+$/, '').toUpperCase();
}

/**
 * Characters that are invisible, or that reorder what is drawn around them.
 *
 * A path is not just a lookup key — it is the sentence the owner reads in the
 * approval preview before deciding. `src/exe\u202Etxt.js` draws as `src/exesj.txt`,
 * a zero-width space hides a segment boundary, and a C0/C1 escape can move the
 * cursor in a terminal preview. None of these is a legal part of a filename
 * anybody meant to write, so they are refused rather than rendered.
 */
const INVISIBLE_CLASS =
  '[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e' +
  '\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]';

/** For a yes/no on a path. Never `/g` — a sticky `lastIndex` would skip every other test. */
const INVISIBLE = new RegExp(INVISIBLE_CLASS);

/**
 * For scrubbing a summary. `/g` is safe here only because it is handed to
 * `String.replace`, which resets `lastIndex` itself.
 */
const INVISIBLE_ALL = new RegExp(INVISIBLE_CLASS, 'g');

/** Characters Windows forbids outright. Colon also kills `C:\…` and `file.ts:ads`. */
const FORBIDDEN = /[:*?"<>|]/;

/**
 * Is this string safe read as a repo-relative path? No normalising, no repair —
 * a yes or a no, so it can be asked of more than one reading of the same text.
 */
function shapeIsSafe(candidate: string): boolean {
  if (candidate === '' || candidate.length > MAX_PATH) return false;
  if (FORBIDDEN.test(candidate) || INVISIBLE.test(candidate)) return false;

  const slashed = candidate.replace(/\\/g, '/');
  if (slashed.startsWith('/')) return false; // absolute, or a UNC share once backslashes are folded
  if (slashed.startsWith('~')) return false; // a home-relative path is not repo-relative

  for (const seg of slashed.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (/[. ]$/.test(seg)) return false; // Windows strips these; the preview would lie
    if (DEVICE_NAMES.has(deviceStem(seg))) return false;
  }
  return true;
}

/**
 * Normalise a suggested path, or refuse it.
 *
 * The jail is proved by SHAPE, before anything touches a filesystem: a path that
 * cannot escape textually cannot escape at all. Refused: anything absolute
 * (`/etc`, `C:\`, a UNC `\\server\share`), anything containing `..`, anything
 * with a character Windows forbids, an invisible or a reordering character, an
 * empty or `.` segment, a Windows device name, and a segment ending in a dot or
 * a space (Windows silently strips those, so `evil.ts.` and `evil.ts` are the
 * same file — which is exactly how a preview and a write end up disagreeing).
 *
 * THE SHAPE IS CHECKED TWICE: once as written, and once as Unicode NFKC. `‥／‥／`
 * is four ordinary characters here and `../../` after any consumer folds it, and
 * `Ｃ：` becomes a drive letter the same way. Nothing in this package normalises
 * a path, but this string is handed onward and something downstream might — so a
 * string that is safe in one reading and an escape in the other is refused in
 * both. The value RETURNED is always derived from what the model actually wrote:
 * refusing is safe, but silently handing the owner a path to approve that is not
 * the one they were shown would be the exact failure this seam exists to prevent.
 */
export function normalizeRelPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!shapeIsSafe(trimmed)) return null;
  if (!shapeIsSafe(trimmed.normalize('NFKC'))) return null;
  return trimmed.replace(/\\/g, '/');
}

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

const LINE = new RegExp(
  `^\\s*(?:[-*>]\\s*)?${prefixPattern()}\\s+` +
    '(?:"([^"]{1,200})"|`([^`]{1,200})`|(\\S{1,200}))' +
    '(?:\\s+[\\u2014\\u2013:-]\\s+(.*))?\\s*$',
  'i',
);

/** Markdown bolding is stripped before matching, so `**PROPOSE: write x**` still parses. */
function bare(line: string): string {
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
const DELEGATE_LINE = new RegExp(`^\\s*(?:[-*>]\\s*)?${delegatePattern()}(\\S.*?)\\s*$`, 'i');

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
  'add', 'create', 'make', 'build', 'implement', 'write', 'fix', 'refactor',
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
function isActionableRequest(question: string): boolean {
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
function answerWasUseless(answer: string): boolean {
  const flat = answer.trim();
  return flat === '' || flat === CANNOT_ANSWER;
}

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
