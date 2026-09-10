/**
 * Ask Zeno — the assistant over the owner's own local state. Public surface.
 *
 * NOTHING EXPORTED HERE CAN CAUSE AN EFFECT.
 *
 * That is a property of the package, not a promise about how it is used, and it
 * is worth being exact about why. This package has no dependencies, opens no
 * file, makes no network call, holds no clock, and imports nothing from the
 * kernel — so there is no approval it could reach and no executor it could
 * drive. Every export takes text or plain data and returns text or plain data:
 *
 *   `buildSnapshot`          shapes what the assistant is allowed to know
 *   `buildAssistantPrompt`   turns that into a string for the local model
 *   `groundReply`            reads the model's answer back and reports whether
 *                            it is supported by the snapshot it was given
 *   `parseIntent`            reads a SUGGESTION out of that answer — either one
 *                            file to write, or one job to hand to a coding
 *                            agent. Both are text; neither is an act.
 *
 * The daemon owns the parts this package deliberately does not: reading the
 * pending set, calling Ollama, and — separately, and only by the owner's hand —
 * putting a proposal through classify → preview → approve → commit. Law L6 is
 * kept here by construction: the assistant may propose, and there is no code
 * path, in this package or reachable from it, by which it could approve.
 *
 * If a future change gives something in here a side effect, this comment is
 * wrong and the package has stopped being what it was built to be.
 */
export {
  buildSnapshot,
  emptySnapshot,
  factsOf,
  factIds,
  DEFAULT_BUDGET,
  type Budget,
  type DeviceFact,
  type Fact,
  type FactSection,
  type MemoryFact,
  type PendingFact,
  type ReceiptFact,
  type RepoFact,
  type Snapshot,
  type SnapshotParts,
  type SnapshotSection,
  type SnapshotTier,
  type Truncation,
  type WorkFact,
} from './snapshot.js';

export {
  buildAssistantPrompt,
  describeTruncation,
  CANNOT_ANSWER,
  NO_QUESTION,
  PROPOSE_PREFIX,
  DELEGATE_PREFIX,
  QUESTION_MAX,
} from './prompt.js';

export { cleanGroundedReply, groundReply, type Grounding, type GroundingFailure } from './ground.js';

export {
  parseIntent,
  normalizeRelPath,
  INTENT_KINDS,
  type Intent,
  type ProposeWriteIntent,
  type DelegateIntent,
} from './intent.js';
