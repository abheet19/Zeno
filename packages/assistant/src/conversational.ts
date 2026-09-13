/**
 * The replies that need no model: a greeting, a thank-you, "help", "what can
 * you do?".
 *
 * The grounded prompt can only refuse these — there is no fact to cite in
 * "hey" — and a chat that answers "hey" with "I cannot answer that from your
 * Zeno." reads as broken, not careful. So they are answered here, before any
 * model is asked. Every number in a reply comes from the SAME snapshot the
 * model would have seen: the owner's real local state, grounded by
 * construction, with nothing guessed.
 *
 * Deliberately narrow. Each pattern must match the WHOLE message, so "hey,
 * can you check the dsa folder" is not a greeting — it falls through to the
 * grounded path, where `fallbackDelegation` reads the instruction in it.
 */
import type { Snapshot } from './snapshot.js';

const GREETING = /^(?:hey|hi|hello|hiya|yo|sup|howdy|good\s+(?:morning|afternoon|evening|night))(?:\s+zeno)?[\s!.,?]*$/i;
const THANKS = /^(?:thanks|thank\s+you|thx|ty|cheers|appreciated)(?:\s+zeno)?[\s!.,?]*$/i;
const ACK = /^(?:ok|okay|got\s+it|nice|great|cool|perfect|sure)[\s!.,?]*$/i;
const HELP = /^(?:help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|who\s+are\s+you|what\s+are\s+you|how\s+do\s+you\s+work|what\s+can\s+i\s+ask(?:\s+you)?)[\s!.,?]*$/i;

const CAN_DO = 'Ask me what’s waiting on you, what’s in the sandbox, what ran today, or what you’ve saved — or describe a task and I’ll run it in Forge.';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The owner's state in one line — every figure read from the snapshot. */
function stateLine(s: Snapshot): string {
  return [
    count(s.pending.length, 'decision waiting on you', 'decisions waiting on you'),
    s.repo === null
      ? 'no sandbox repository'
      : `the sandbox on ${s.repo.branch} with ${count(s.repo.changed.length, 'uncommitted change', 'uncommitted changes')}`,
    count(s.work.length, 'backlog item', 'backlog items'),
    count(s.memory.length, 'saved memory', 'saved memories'),
  ].join(', ');
}

/**
 * A conversational reply for a message that is not a question about state,
 * or `null` when the message should go to the grounded model as usual.
 */
export function conversationalReply(question: string, snapshot: Snapshot): string | null {
  const q = question.trim();
  if (GREETING.test(q)) return `Hi. Right now: ${stateLine(snapshot)}. ${CAN_DO}`;
  if (THANKS.test(q)) return `You’re welcome. ${CAN_DO}`;
  if (ACK.test(q)) return `Okay. ${CAN_DO}`;
  if (HELP.test(q)) {
    return `I’m Zeno. I answer only from your local state — I never guess, and I never approve anything myself. Right now: ${stateLine(snapshot)}. ${CAN_DO}`;
  }
  return null;
}
