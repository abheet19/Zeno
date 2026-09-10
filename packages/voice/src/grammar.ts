/**
 * The command grammar. Pure — a spoken command in, a typed Intent out.
 *
 * THE LOAD-BEARING RULE OF THIS PACKAGE lives here: the Intent union has no
 * approve / confirm / yes member, and it never will. Speaking is a way to
 * PROPOSE; a proposal is turned into an effect only by the owner's eyes and
 * click in the window. So an utterance like "approve it" or "yes, do it" does
 * not map to a weaker approval — it maps to `Unrecognized` with a reason that
 * says approval is by hand. There is no code path from a microphone to a commit,
 * because the type that a commit would need is not one this file can produce.
 *
 * `delegate` does not weaken that. It is the one intent that starts a PROCESS —
 * a coding agent, run headless — and it still carries nothing but the sentence
 * the owner spoke. Every file that agent writes comes back as an ordinary
 * capsule awaiting a click, so delegating buys the owner work, never an effect.
 * What it CAN spend is real (a local model spends GPU; a hosted one spends money
 * and sends the code off the machine), and that is why this file only names the
 * task: which agent runs, and whether the owner must confirm it first, is the
 * daemon's decision and the owner's to see before anything hosted starts.
 *
 * Everything the grammar does not understand becomes `Unrecognized` carrying the
 * raw text, never silence. A dropped command the owner has to repeat is a small
 * cost; a command silently swallowed — so they think Zeno heard them when it did
 * not — is the failure this package is built to avoid.
 */

/** What a `read` intent wants surfaced. The daemon already exposes exactly these. */
export type ReadTarget = 'pending' | 'receipts' | 'chain';
export type NavigationTarget = 'command' | 'forge' | 'counsel';

/**
 * A spoken command, understood. A discriminated union so a consumer must handle
 * every case — and so that the ABSENCE of an approval case is a compile-time
 * fact, not a convention.
 */
export type Intent =
  | { readonly kind: 'propose_write'; readonly relPath: string; readonly summary: string; readonly hint: string }
  | { readonly kind: 'add_task'; readonly title: string }
  | { readonly kind: 'navigate'; readonly target: NavigationTarget }
  | {
      /**
       * "Build me a slugify utility" — a job for a coding agent, too big to be
       * one scaffolded file.
       *
       * IT CARRIES TEXT AND NOTHING ELSE. No agent id, no model, no command, no
       * path: `task` is the sentence the owner spoke, and the only thing a
       * consumer can do with it is hand it to an agent as a prompt. That matters
       * because this is the one intent that starts a PROCESS, and the process it
       * starts must not be describable from here — which agent runs, whether it
       * costs money, and whether the code leaves the machine are decisions the
       * daemon makes and the owner sees BEFORE anything hosted begins.
       *
       * Delegating is still not approving. An agent that runs produces file
       * changes in a throwaway worktree, and every one of them arrives as an
       * ordinary capsule the owner approves by hand. Speaking cannot shorten
       * that chain by one step.
       */
      readonly kind: 'delegate';
      readonly task: string;
    }
  | { readonly kind: 'read'; readonly what: ReadTarget }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'acknowledge'; readonly text: string }
  | { readonly kind: 'unrecognized'; readonly text: string; readonly reason: string };

/** The reason string for the safety refusal. Exported so the test asserts the
 * exact contract, and so the front-end can show the owner why it did nothing. */
export const APPROVAL_BY_HAND =
  'Approval is by hand in the Zeno window — never by voice. Nothing was approved.';

/** Reason when a propose_write was understood but no safe file name could be
 * derived from the spoken name (e.g. the name was all punctuation). */
export const NO_SAFE_NAME =
  'I understood a file proposal but could not derive a safe name from what I heard.';

/** The catch-all reason: heard, but not a command in the grammar. */
export const NOT_A_COMMAND = 'That is not a command I recognize.';

/**
 * Reason when a delegation verb arrived with nothing but a pronoun after it —
 * "build it", "make that".
 *
 * A task is the whole instruction an agent is given, and "it" names nothing this
 * grammar can see: there is no conversation history here, and inventing a
 * referent would send an agent off on a job the owner never described. So the
 * refusal is legible and the owner says the noun.
 */
export const DELEGATE_NEEDS_A_TASK =
  'I heard a build request but not what to build. Say what you want built, in full.';

/** Reason for a wake with nothing after it. */
export const EMPTY_COMMAND = 'I heard the wake word but no command followed.';

// ---- the safety guard -----------------------------------------------------

// Approval by voice is refused, always and loudly. This guard is deliberately
// BROAD: any utterance whose purpose is to approve, confirm, commit, authorise,
// or "just do it now" is caught here and turned into the APPROVAL_BY_HAND
// refusal, so the owner is TOLD — in words — that the one act which turns a
// proposal into an effect happens with their eyes and their click, never by
// microphone. A refusal the owner hears ("approval is by hand") is worth far
// more than a generic "not a command", which they might mistake for a mis-hear
// and simply repeat, or escalate.
//
// Breadth is safe by construction. Every legitimate Zeno command begins with a
// different, specific keyword: a proposal with create/add/write/make/new/build/
// generate/scaffold, a task with remind/remember/note, a read with what/read/
// show/list/verify/check/audit/is, a cancel with never/forget/scratch/cancel/
// abort/stop. None of the approval verbs below begin any of those, so catching
// them can never swallow a real command — and a task that merely MENTIONS
// approval ("remind me to approve the budget") begins with "remind" and is
// untouched, which the tests pin.

// An optional run-up a person may put in FRONT of an approval — a confirmation
// ("yes approve it", "ok ship it"), an urging adverb ("just approve it"), a
// polite request ("can you approve it", "i need you to approve it") or a
// first-person-plural nudge ("let's ship it"). None of these begin a real
// command either — every legitimate command starts with its own keyword — so
// stripping past them to judge what FOLLOWS is safe. The group repeats, so
// "can you please just approve it" is stripped down to "approve it".
//
// This only ever feeds the approval guard: when what follows is not an approval
// the stripped form is discarded and the original utterance is parsed as it was
// spoken, so "can you create a login component" is unaffected.
const CONFIRM_PREFIX =
  /^(?:(?:yes|yeah|yeh|yep|yup|ok|okay|okey|sure|alright|all right|please|just|simply|go ahead and|go on and|can you|could you|would you|will you|you can|you may|i want you to|i need you to|i(?:'|’)?d like you to|i would like you to|let(?:'|’)?s|lets|let us),?\s+)+/i;

// Asking Zeno to work the CONTROL rather than naming the act — "click approve",
// "hit confirm", "press the green button". This is an approval attempt by any
// honest reading, and it is the phrasing a person reaches for precisely because
// the approve button is right there on screen. No legitimate command begins with
// a click verb, and the object must be an approval control, so this cannot
// swallow a real one ("create an approve button component" starts with "create").
const OPERATE_CONTROL =
  /^(?:click|clicks|clicking|press|presses|pressing|hit|hits|tap|taps|push|pushes|select|choose)\s+(?:on\s+)?(?:the\s+)?(?:approve|approval|confirm|confirmation|accept|allow|ok|okay|yes|commit|merge|apply|submit|green(?:\s*light)?|green\s+button)\b/i;

// Verbs of approval / commitment that, as the first real word, ARE an approval
// attempt and begin no legitimate command. Matched with the morphology speech-to-
// text throws at us (approve/approves/approved/approving/approval, commit/
// committed, authorise/authorize, merge, apply, proceed, …).
const APPROVAL_LEAD =
  /^(?:approv(?:e|es|ed|ing|al)?|confirm(?:s|ed|ing)?|accept(?:s|ed|ing)?|authori[sz]e?(?:s|d|ing)?|commit(?:s|ted|ting)?|merg(?:e|es|ed|ing)|appl(?:y|ies|ied)|proceed(?:s|ed|ing)?|sign(?:s|ed)?\s+off)\b/i;

// Standalone confirmations and "act on it now" phrasings that carry no approval
// verb of their own — bare assents ("yes", "sure", "lgtm", "sounds good"), and
// commit idioms ("ship it", "send it", "run it", "push it", "make the change",
// "green light it", "trust me"). Matched as (near-)whole utterances, with an
// optional trailing softener, so these everyday words can never over-catch a
// longer real command.
const APPROVAL_WHOLE =
  /^(?:yes|yeah|yeh|yep|yup|ok|okay|okey|sure|fine|aye|absolutely|definitely|affirmative|roger(?:\s+that)?|of course|agreed?|approved|confirmed|accepted|do it|do that|do the last one|do everything|do it all|just do it|go ahead|go for it|go on|carry on|ship it|send it|just send it|push it|run it|execute it|save it|make it so|make the change|apply the change|let it (?:through|ride|go)|allow it|permit it|allow all|accept all|approve all|(?:say\s+)?yes to all|sounds? good|looks? good|that works|that(?:'|’)?s fine|that is fine|works for me|fine by me|all good|no objections?|i have no objections?|i(?:'|’)?m (?:good|happy|fine) with (?:it|that|this)|lgtm|thumbs up|trust me(?: on this)?|green ?light(?: it)?|give it the green light|you have my approval|i (?:approve|agree|authori[sz]e|accept|confirm)|(?:i\s+)?sign(?:s|ed)?(?:\s+(?:it|this|that))?\s+off(?:\s+on\s+(?:it|this|that))?)(?:\s+(?:it|that|this|one|now|please|do it))*[.!]?$/i;

/**
 * True when one clause is an attempt to approve / confirm / commit by voice.
 * A leading run-up ("yes …", "just …", "can you …") is stripped first, so
 * "yes approve it" and "can you ship it" are judged on the approval that
 * follows; the full utterance is tested too, so a bare "yes" or "yes please"
 * still counts.
 */
function isApprovalClause(cmd: string): boolean {
  const core = cmd.replace(CONFIRM_PREFIX, '');
  const hit = (s: string) => APPROVAL_LEAD.test(s) || APPROVAL_WHOLE.test(s) || OPERATE_CONTROL.test(s);
  return hit(cmd) || (core !== cmd && hit(core));
}

/**
 * True when the utterance is an attempt to approve by voice.
 *
 * Beyond the single-clause test, a person stacks approvals with a conjunction —
 * "do it and commit it", "yes approve it then merge". The rule for those is
 * strict on purpose: it is an approval only when EVERY clause is one. That is
 * what keeps the breadth from eating a real command with an assent in front of
 * it — "go ahead and create a login component" splits into an approval and a
 * proposal, so it is not an approval and goes on to be parsed as spoken.
 */
function isApprovalAttempt(cmd: string): boolean {
  if (isApprovalClause(cmd)) return true;
  const clauses = cmd
    .split(/\s+(?:and|then)\s+/i)
    .map((c) => c.trim())
    .filter((c) => c !== '');
  return clauses.length > 1 && clauses.every(isApprovalClause);
}

// ---- the other intents ----------------------------------------------------


/**
 * A greeting, or a phrase that only asks for attention. "Zeno wake up", "Zeno,
 * are you there?", "Zeno hello".
 *
 * These are NOT commands, but they are not mistakes either, and answering them
 * with "that is not a command I recognize" is simply wrong: the owner did the
 * one thing the product asked of them — they addressed it by name — and got an
 * error. Treated as an acknowledgement, the microphone stays open and the owner
 * can just say what they wanted next.
 */
const GREETING =
  /^(?:wake(?:\s+up)?|hi|hey|hello|yo|you\s+there|are\s+you\s+(?:there|awake|listening|up)|listen(?:ing)?\??|status)\s*[.!?]*$/i;

const CANCEL =
  /^(?:never\s?mind|nevermind|forget it|scratch that|cancel|abort|stop)(?:\s+(?:that|it|this|please))?[.!]?$/i;

// Navigation changes only the visible Zeno surface. It has no filesystem,
// process or approval power, but it lets the wake flow finish the ordinary
// sentence "Zeno, open Forge" instead of reporting a false grammar failure.
// Local Whisper has also produced "open porch" for that exact sentence, so the
// measured homophone is accepted only inside this explicit navigation shape.
const NAVIGATE =
  /^(?:open|go to|show|switch to)\s+(?:the\s+)?(command|forge|porch|counsel)(?:\s+(?:tab|workspace|screen|view))?(?:\s+and\s+(?:show|focus)(?:\s+me)?\s+(?:the\s+)?selected\s+(?:repository|project))?[.!?]?$/i;

const READ_PENDING =
  /^(?:what(?:'s| is| are)?\s+waiting|what(?:'s| is)?\s+pending|what(?:'s| is)?\s+(?:in\s+the\s+)?queue|what(?:'s| is)?\s+in\s+my\s+queue|what\s+needs\s+approval|what\s+is\s+awaiting(?:\s+approval)?|anything\s+waiting|show(?:\s+me)?\s+(?:the\s+)?(?:pending\s+)?approvals?|show(?:\s+me)?\s+(?:the\s+)?queue)[.!?]?$/i;
const READ_RECEIPTS =
  /^(?:read\s+(?:my\s+|the\s+)?receipts|show(?:\s+me)?\s+(?:the\s+|my\s+)?receipts|list\s+(?:the\s+|my\s+)?receipts|show\s+receipts|what\s+have\s+you\s+done)[.!?]?$/i;
const READ_CHAIN =
  /^(?:verify(?:\s+the)?\s+(?:chain|ledger)|check(?:\s+the)?\s+(?:chain|ledger)|audit(?:\s+the)?\s+(?:chain|ledger)|is\s+the\s+(?:chain|ledger)\s+(?:intact|ok|okay|valid|good))[.!?]?$/i;

const ADD_TASK =
  /^(?:remind me(?:\s+to)?|remember to|note to self(?:\s+to)?|add(?:\s+a)?\s+task(?:\s+to)?|new task(?:\s+to)?|create a task(?:\s+to)?|make a task(?:\s+to)?|add a reminder(?:\s+to)?|add a to-?do(?:\s+to)?)\s+(.+?)[.!]?$/i;

// "<verb> a <name> component/file [that ...]" — the primary shape.
const PROPOSE_NAME_FIRST =
  /^(?:create|add|write|make|new|build|generate|scaffold)\s+(?:a|an|the)?\s*(.+?)\s+(component|file)(?:\s+(?:that|which|to|for|so that)\s+(.+?))?[.!]?$/i;
// "<verb> a component/file called <name> [that ...]" — the "called/named" shape.
const PROPOSE_KIND_FIRST =
  /^(?:create|add|write|make|new|build|generate|scaffold)\s+(?:a|an|the)?\s*(component|file)\s+(?:called|named)\s+(.+?)(?:\s+(?:that|which|to|for|so that)\s+(.+?))?[.!]?$/i;

/**
 * The delegation shape: a build verb, then a job.
 *
 * It is matched LAST of the action intents, which is what keeps it from stealing
 * the two that are narrower than it. `add_task` runs first, so "add a task to
 * build a login form" is still a task. `propose_write` runs first, so "create a
 * card component" and "write a rate limiter file" are still single-file
 * proposals — both of those END in the word `component` or `file`, and that
 * ending is the whole difference between "scaffold me one file" and "go do a
 * piece of work". Whatever is left over — "build me a slugify utility",
 * "implement retry with backoff" — is a job for an agent.
 *
 * The verbs are exactly the five a person uses to ask for work, and every one of
 * them is already a `propose_write` verb, so this adds no new first word to the
 * grammar and cannot collide with the approval guard (which owns approve /
 * confirm / commit / ship / yes and is matched long before this line).
 */
const DELEGATE = /^(?:build|make|write|implement|create)\s+(.+?)[.!?]?$/i;

/**
 * What is left after the verb when the owner named no work: a bare pronoun, with
 * or without a "me". "Build it" is not a task, it is half a sentence.
 */
const DELEGATE_PRONOUN_ONLY =
  /^(?:me\s+)?(?:it|that|this|one|them|these|those|everything|anything|something|the rest|the thing|all of it)$/i;

// ---- relPath derivation (sandbox-safe by construction) --------------------

/** Break a spoken name into lower-case alphanumeric words. Because the ONLY
 * characters that survive are [a-z0-9], nothing a name can contain — "..",
 * "/etc/passwd", "C:\\", a leading slash — can survive into the path. The safety
 * is structural, not a blacklist that has to anticipate every attack. */
function slugWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** A spoken name is bounded before it becomes a file base. A long ramble that
 * happens to end in "component" ("zeno, create a really really … long component")
 * would otherwise mint a path thousands of characters long — sandbox-safe, but a
 * garbage filename no filesystem accepts (a path segment caps near 255 bytes).
 * Cap the word count AND the base length so a single very long word cannot bloat
 * the path either. The bounds are far above any real name, so legitimate commands
 * are untouched; only a mis-segmented ramble is trimmed. */
const MAX_NAME_WORDS = 12;
const MAX_BASE_LEN = 64;

/**
 * Derive a sandbox-relative path from a spoken name, or null when nothing usable
 * remains. Components land in `src/components/<PascalName>.tsx`; everything else
 * in `src/<kebab-name>.ts`. Deterministic: the same spoken name always yields
 * the same path, so a repeated command previews the same target.
 */
export function deriveRelPath(name: string, kind: 'component' | 'file'): string | null {
  const words = slugWords(name).slice(0, MAX_NAME_WORDS);
  if (words.length === 0) return null;
  if (kind === 'component') {
    const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('').slice(0, MAX_BASE_LEN);
    return `src/components/${pascal}.tsx`;
  }
  // Trim to the cap, then drop a hyphen the cut may have left dangling.
  const kebab = words.join('-').slice(0, MAX_BASE_LEN).replace(/-+$/, '');
  return `src/${kebab}.ts`;
}

// ---- the entry point ------------------------------------------------------

function unrecognized(text: string, reason: string): Intent {
  return { kind: 'unrecognized', text, reason };
}

/**
 * Map a spoken command (already stripped of the wake phrase) to an Intent.
 *
 * Order is deliberate. `cancel` and the approval guard are matched first as
 * whole-utterance shapes, so an explicit "cancel" or "approve it" is never
 * mistaken for a task or a write. `add_task` is matched BEFORE `propose_write`
 * on purpose: "add a task to build a login component" ends in the word
 * "component", and only the earlier, explicit "task" keyword keeps it a task
 * instead of a file proposal.
 *
 * `delegate` is matched LAST, for the same reason and one step further out. It
 * shares its verbs with `propose_write` and would swallow both of the intents
 * above it if it ran first: "add a task to build a login form" would become a
 * job for an agent instead of a line on the backlog, and "create a card
 * component" would become one too. Running it last means it gets only what the
 * narrower two did not recognise — which is exactly the set of requests that
 * need an agent rather than a scaffold.
 */
export function parseCommand(command: string): Intent {
  // The transcript is untrusted and speech-to-text is lossy: a mis-hearing (or a
  // hostile one) can carry control characters — a NUL, a backspace, an ANSI/OSC
  // terminal escape like ESC "]0;…" BEL — that `\s+` does NOT fold, because they
  // are not whitespace. Left in, they ride `summary`/`hint`/`title`/`text` into a
  // scaffold file, a receipt and the daemon, and can rewrite a terminal that
  // later prints them. So strip C0 (incl. DEL) and C1 controls to a space FIRST,
  // then collapse whitespace — every derived field is a substring of `cmd`, so
  // one cleanse at the boundary makes all of them safe.
  const cmd = command
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cmd === '') return unrecognized(cmd, EMPTY_COMMAND);

  if (CANCEL.test(cmd)) return { kind: 'cancel' };

  // THE safety line: an approval by voice is refused, loudly, before anything
  // else can interpret it as an action.
  if (isApprovalAttempt(cmd)) return unrecognized(cmd, APPROVAL_BY_HAND);

  const navigation = NAVIGATE.exec(cmd);
  const spokenTarget = navigation?.[1]?.toLowerCase();
  const target = spokenTarget === 'porch' ? 'forge' : spokenTarget;
  if (target === 'command' || target === 'forge' || target === 'counsel') {
    return { kind: 'navigate', target };
  }

  if (READ_PENDING.test(cmd)) return { kind: 'read', what: 'pending' };
  if (READ_RECEIPTS.test(cmd)) return { kind: 'read', what: 'receipts' };
  if (READ_CHAIN.test(cmd)) return { kind: 'read', what: 'chain' };

  const task = ADD_TASK.exec(cmd);
  if (task) {
    const title = (task[1] ?? '').trim();
    if (title.length > 0) return { kind: 'add_task', title };
  }

  const nameFirst = PROPOSE_NAME_FIRST.exec(cmd);
  if (nameFirst) {
    const name = nameFirst[1] ?? '';
    const kind = (nameFirst[2] ?? '').toLowerCase() === 'file' ? 'file' : 'component';
    const relPath = deriveRelPath(name, kind);
    if (relPath === null) return unrecognized(cmd, NO_SAFE_NAME);
    return { kind: 'propose_write', relPath, summary: cmd, hint: (nameFirst[3] ?? '').trim() };
  }

  const kindFirst = PROPOSE_KIND_FIRST.exec(cmd);
  if (kindFirst) {
    const kind = (kindFirst[1] ?? '').toLowerCase() === 'file' ? 'file' : 'component';
    const name = kindFirst[2] ?? '';
    const relPath = deriveRelPath(name, kind);
    if (relPath === null) return unrecognized(cmd, NO_SAFE_NAME);
    return { kind: 'propose_write', relPath, summary: cmd, hint: (kindFirst[3] ?? '').trim() };
  }

  // LAST of the action intents, on purpose — see DELEGATE. The task handed on is
  // the sentence as spoken, cleansed and trimmed and nothing else: this grammar
  // does not summarise, rewrite or "improve" an instruction that is about to be
  // read by an agent and shown to the owner. What they said is what runs.
  //
  // A sentence with an approval bolted on — "build a login form and approve it" —
  // is a delegation whose task text happens to end in words that ask for
  // something this system will not do. It is carried verbatim rather than
  // refused, for the same reason "go ahead and create a login component" is
  // still a proposal: a mixed sentence keeps its real intent and the approval
  // half is simply not honoured, because there is no approval to honour. The
  // agent that reads it edits a throwaway worktree, holds no owner token, and
  // has no route to /approvals — so those words are prose to it, and every file
  // it writes still stops at the gate for a human click.

  const delegate = DELEGATE.exec(cmd);
  if (delegate) {
    const job = (delegate[1] ?? '').trim();
    if (job === '' || DELEGATE_PRONOUN_ONLY.test(job)) return unrecognized(cmd, DELEGATE_NEEDS_A_TASK);
    return { kind: 'delegate', task: cmd.replace(/[.!?]+$/, '').trim() };
  }

  if (GREETING.test(cmd)) return { kind: 'acknowledge', text: cmd };
  return unrecognized(cmd, NOT_A_COMMAND);
}
