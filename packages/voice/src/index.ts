/**
 * Zeno · Voice — the spoken-command layer. Public surface.
 *
 * A leaf package: it depends on no other Zeno package and emits plain, typed
 * `Intent` objects. The daemon is what maps a `propose_write` intent onto
 * `POST /previews` — the voice layer proposes, the gate decides, the owner
 * approves by hand. There is no path from here to an approval, by construction:
 * the `Intent` union has no approve/confirm member.
 *
 * The pure core (wake, grammar, session) is what the browser front-end in
 * `public/voice.js` imports, compiled and served as siblings — so the microphone
 * path and the test path run the exact same interpretation.
 */
export { detectWake, type Wake } from './wake.js';
export {
  parseCommand,
  deriveRelPath,
  APPROVAL_BY_HAND,
  NO_SAFE_NAME,
  NOT_A_COMMAND,
  EMPTY_COMMAND,
  DELEGATE_NEEDS_A_TASK,
  type Intent,
  type ReadTarget,
} from './grammar.js';
export {
  interpret,
  interpretCommand,
  VoiceSession,
  IDLE_NOT_ADDRESSED,
  type Recognizer,
  type Outcome,
  type OutcomeListener,
} from './session.js';
export {
  WakeListener,
  TranscriptRing,
  WAKE_WINDOW_MS,
  RETENTION_MS,
  RETENTION_MAX_ENTRIES,
  type ListenState,
  type ListenEvent,
  type WakeListenerOptions,
  type RetainedLine,
} from './listen.js';
