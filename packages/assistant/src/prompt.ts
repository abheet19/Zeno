/**
 * The prompt: the snapshot laid out as labelled FACTS, then the rules, then the
 * question.
 *
 * Order is load-bearing. A model that reads the question first starts composing
 * an answer out of its weights and treats the evidence that follows as
 * decoration. So the facts come first, the rules come next while the facts are
 * still in view, and the question lands LAST — immediately before generation, so
 * it is the operative instruction and the facts are what the model is holding
 * when it obeys it. This is the same shape `counsel/src/ask.ts` uses.
 *
 * Everything here is a REQUEST. The model may ignore every line of it. That is
 * precisely why `ground.ts` exists: the prompt asks for citations, the check
 * enforces them. Nothing in this file is a guarantee.
 *
 * Pure: a string in, a string out. No model call lives here — the daemon owns
 * the call to Ollama.
 */
import { factsOf, type Snapshot, type Truncation } from './snapshot.js';

/** The exact sentence the model is told to use when the snapshot cannot answer. */
export const CANNOT_ANSWER = 'I cannot answer that from your Zeno.';

/**
 * The one line the model may write to express an INTENT to change something.
 *
 * It is a sentence, not an action. `intent.ts` parses it into a proposal that
 * the owner approves by hand through the ordinary gate. The assistant has no
 * path to `/approvals` and no way to cause an effect, so the very worst this
 * line can do is put a preview in front of the owner that they then decline.
 */
export const PROPOSE_PREFIX = 'PROPOSE: write';

/**
 * The one line the model may write to express an intent to DELEGATE a job to a
 * coding agent.
 *
 * The distinction from `PROPOSE:` is a distinction of size, not of power.
 * `PROPOSE:` names one file the owner might want written; this names a piece of
 * WORK — "a slugify utility with unicode support" — that a coding agent is
 * asked to attempt inside a throwaway worktree. Every file that agent writes
 * comes back as an ordinary approval capsule, so a delegation still produces
 * proposals and nothing else; the owner's click is still the only thing that
 * turns any of them into an effect.
 *
 * What it carries is a TASK, in the owner's own words. It cannot name an agent,
 * a model, a command, a shell, or a path. Which agent runs — and, when that
 * agent is hosted and would spend the owner's money and send their code off the
 * machine, whether it may start at all — is the daemon's decision and the
 * owner's confirmation, never a string this model gets to write.
 */
export const DELEGATE_PREFIX = 'DELEGATE:';

/**
 * How much question the prompt will carry.
 *
 * `snapshot.ts` budgets every fact so that a ledger with nine thousand receipts
 * cannot blow the local model's context window — and then the question, which
 * this file pastes in whole, could do it single-handed. A 100KB paste (a stack
 * trace, a log, a whole file the owner meant to attach) made the question 98% of
 * the prompt: the facts were still technically present, and an 8B model with an
 * 8K window never saw them. The failure mode is the ugly one — the snapshot is
 * silently gone and the model answers from its weights, fluently, about the
 * owner's machine. So the question is clipped like everything else, and, like
 * everything else, the clip is said out loud.
 *
 * 4000 characters is far longer than any question a person types and far short
 * of a window.
 */
export const QUESTION_MAX = 4000;

/**
 * What is asked when the owner asks nothing.
 *
 * An empty question used to render an empty line under the `QUESTION` heading —
 * so the model was handed the owner's private state, the instruction to answer,
 * and no question, which is an invitation to free-associate over exactly the
 * material that must not be guessed about. Saying that no question arrived is
 * both true and the one input that reliably produces the refusal.
 */
export const NO_QUESTION = '(no question was asked — reply with rule 5 and nothing else)';

/** Human-readable form of one truncation notice, for the prompt and for the UI. */
export function describeTruncation(t: Truncation): string {
  const dropped = t.total - t.kept;
  const parts: string[] = [];
  if (dropped > 0) parts.push(`${t.kept} of ${t.total} shown, ${dropped} not shown`);
  if (t.shortened > 0) parts.push(`${t.shortened} entr${t.shortened === 1 ? 'y was' : 'ies were'} shortened`);
  return `${t.section}: ${parts.join('; ')}`;
}

/**
 * Build the grounded prompt for one question over one snapshot.
 *
 * Every fact carries a short stable id (`p1`, `r3`, `w2`…) assigned by
 * `factsOf`, which is the same list `groundReply` validates against.
 */
export function buildAssistantPrompt(question: string, snapshot: Snapshot, maxQuestion = QUESTION_MAX): string {
  const out: string[] = [];

  // Read first, because whether the question was clipped has to be announced up
  // in the TRUNCATED block along with everything else that was.
  const cap = Math.max(1, Math.floor(maxQuestion));
  const flat = question.replace(/\s+/g, ' ').trim();
  const overlong = flat.length > cap;
  const asked = flat === '' ? NO_QUESTION : overlong ? flat.slice(0, cap - 1).trimEnd() + '…' : flat;

  out.push('You are Ask Zeno: the owner\'s assistant for their OWN Zeno installation.');
  out.push(
    'Everything you know about their Zeno is in the FACTS below, captured at ' +
      `${snapshot.at}. You have no other source — no memory of earlier questions, no web, no filesystem.`,
  );
  out.push('');

  out.push('FACTS');
  out.push('');
  for (const section of factsOf(snapshot)) {
    out.push(section.title);
    for (const fact of section.facts) out.push(`  [${fact.id}] ${fact.text}`);
    out.push('');
  }

  if (snapshot.truncated.length > 0 || overlong) {
    // Said out loud, because a silently truncated context is exactly how a
    // grounded answer quietly becomes a confident wrong one.
    out.push('TRUNCATED — you were NOT shown all of the owner\'s state:');
    for (const t of snapshot.truncated) out.push(`  ${describeTruncation(t)}`);
    if (overlong) {
      out.push(`  question: ${flat.length} characters, shortened to ${cap} — you were not shown all of it`);
    }
    out.push('  If the answer might depend on something not shown above, say so.');
    out.push('');
  }

  out.push('RULES');
  out.push('1. Answer ONLY from the facts above. Do not use anything you know from elsewhere.');
  out.push('2. Cite the id of every fact you use, in square brackets, like [p1] or [r3].');
  out.push('   Use the ids exactly as they appear above. Never invent an id.');
  out.push('3. Every specific claim — a number, a file name, a branch, a person — must carry a citation.');
  out.push(
    '4. Do NOT accept the premise of the question. If it assumes something the facts do not show, ' +
      'say the facts do not show it instead of confirming it.',
  );
  out.push(`5. If the facts do not support an answer, reply with exactly this and nothing else: ${CANNOT_ANSWER}`);
  out.push('   Those words must then be your WHOLE answer. Never refuse and then guess anyway.');
  out.push('6. You CANNOT approve anything and you CANNOT change anything. You have no ability to act.');
  out.push(
    '   Never say you have done, approved, committed, sent, deleted or run something. ' +
      'You did not. Only the owner can approve, and only by hand.',
  );
  out.push(
    `7. To suggest a file the owner might want written, end your answer with one line of exactly this form:\n` +
      `     ${PROPOSE_PREFIX} <relative/path.ts> — <one sentence saying why>\n` +
      '   That line is a SUGGESTION the owner must approve. Writing it changes nothing. ' +
      'Use it at most once, only when the owner asked for something to be created, and never for ' +
      'deleting, running, committing or approving — none of those are things you can suggest.',
  );
  out.push(
    `8. When the owner asks for a piece of WORK — something bigger than one file, like "build me a\n` +
      `   slugify utility" — end your answer with one line of exactly this form instead:\n` +
      `     ${DELEGATE_PREFIX} <the task, in one sentence>\n` +
      '   That hands the task to a coding agent that edits a throwaway copy of the repo. Everything ' +
      'it writes comes back as a separate change for the owner to approve by hand, so this line ' +
      'still changes nothing on its own. Use it at most once, and never together with a ' +
      `${PROPOSE_PREFIX} line — one or the other, or neither. You do not choose which agent runs, ` +
      'and you cannot start a paid one: naming a task is all this line does.',
  );
  out.push('9. Be brief. No preamble, no apology, no restating the question.');
  out.push('');

  out.push('QUESTION');
  out.push(asked);
  out.push('');
  out.push('ANSWER');

  return out.join('\n');
}
