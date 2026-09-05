/**
 * The glue: transcript in, an outcome out. Pure — the recognizer is INJECTED as
 * a tiny interface, so every line of interpretation is testable against fixed
 * transcripts and nothing here ever touches audio.
 *
 * `interpret` is the whole pipeline in one pure function: wake detection, then
 * the grammar. It returns either an Intent to act on, or the reason it did
 * nothing — and "did nothing" is a first-class, explained outcome, because the
 * owner needs to know the difference between "Zeno is not listening", "Zeno
 * heard the wake word but nothing after it", and "Zeno heard a command it did
 * not understand" (that last one is an `Unrecognized` INTENT, not idle silence).
 */
import { detectWake } from './wake.js';
import { parseCommand, EMPTY_COMMAND, type Intent } from './grammar.js';

/**
 * The recognizer port. The browser front-end supplies an adapter over
 * `webkitSpeechRecognition`; tests supply one that replays fixed strings. Either
 * way, all this layer knows is "a transcript arrived".
 */
export interface Recognizer {
  /** Register a callback invoked once per final transcript. */
  onTranscript(cb: (text: string) => void): void;
}

/**
 * What one transcript produced. `intent` still needs the owner's approval before
 * any effect; `idle` is a transcript that was not a command for Zeno, with a
 * human reason.
 */
export type Outcome =
  | { readonly kind: 'intent'; readonly intent: Intent }
  | { readonly kind: 'idle'; readonly reason: string };

/** No wake phrase at all — not addressed to Zeno. The common case, and silent
 * by design in the UI, but explained here so a caller can log it. */
export const IDLE_NOT_ADDRESSED = 'No wake phrase — not addressed to Zeno.';

/**
 * Run one transcript through wake detection and the grammar.
 *
 * An `Unrecognized` command is returned as an `intent` outcome, not folded into
 * `idle`: it IS something Zeno heard and must show back to the owner (including
 * the safety refusal for "approve it"). Only a missing wake, or a wake with an
 * empty command, is genuinely idle.
 */
export function interpret(transcript: string): Outcome {
  const wake = detectWake(transcript);
  if (wake === null) return { kind: 'idle', reason: IDLE_NOT_ADDRESSED };
  return interpretCommand(wake.command);
}

/**
 * Interpret a command whose wake phrase has ALREADY been stripped.
 *
 * This is the seam wake mode needs. In push-to-talk the wake word and the
 * command arrive in one utterance, so `interpret` does both jobs; in wake mode
 * the wake fired earlier and the command arrives on its own, with no wake word
 * left to detect. Both modes must land on the SAME grammar — otherwise the
 * safety guarantees (no approve intent, the by-hand refusal) would hold on one
 * path and be re-implemented, and eventually diverge, on the other. So
 * `interpret` is defined in terms of this function rather than beside it: there
 * is exactly one place a spoken command becomes an Intent.
 */
export function interpretCommand(command: string): Outcome {
  if (command.trim() === '') return { kind: 'idle', reason: EMPTY_COMMAND };
  return { kind: 'intent', intent: parseCommand(command) };
}

/** Notified once per transcript with the outcome and the raw text that produced
 * it (the raw text lets the UI show exactly what it heard). */
export type OutcomeListener = (outcome: Outcome, transcript: string) => void;

/**
 * A session: subscribe to a recognizer, run each transcript through `interpret`,
 * hand the outcome to a listener. It owns no audio and no policy — it is the
 * wire between an injected recognizer and the pure pipeline, and exists so the
 * front-end and the tests drive the SAME path.
 */
export class VoiceSession {
  constructor(recognizer: Recognizer, listener: OutcomeListener) {
    recognizer.onTranscript((text) => listener(interpret(text), text));
  }
}
