/**
 * The input model: a meeting transcript as an ordered list of utterances.
 *
 * An Utterance's `speaker` is a CHANNEL fact, never a biometric one. `owner` is
 * the owner's own microphone channel; `other` is an authorized meeting-audio
 * channel; `unknown` is exactly that — Counsel says `unknown` rather than
 * guessing a person from a voice (26-prototype-counsel §4.3, the right to say
 * "unknown"). Time (`at`) and ids are supplied by the caller so the whole
 * pipeline stays pure and replayable.
 */

export type Speaker = 'owner' | 'other' | 'unknown';

export interface Utterance {
  /** Stable id supplied by the caller; every extracted item cites these. */
  readonly id: string;
  /** ISO-8601 timestamp of when the line was spoken. */
  readonly at: string;
  /** Channel-derived speaker class — not a name, not a biometric identity. */
  readonly speaker: Speaker;
  readonly text: string;
}

export interface Transcript {
  readonly utterances: readonly Utterance[];
}

export function emptyTranscript(): Transcript {
  return { utterances: [] };
}

export function transcriptOf(utterances: readonly Utterance[]): Transcript {
  return { utterances: [...utterances] };
}

/** Append one utterance, returning a new Transcript. The source is never mutated. */
export function append(t: Transcript, u: Utterance): Transcript {
  return { utterances: [...t.utterances, u] };
}

/**
 * The utterances whose timestamp falls within [fromIso, toIso], inclusive.
 * Tolerant: an unparseable bound opens that side; an utterance with an
 * unparseable timestamp is left out rather than mis-placed.
 */
export function sliceByTime(t: Transcript, fromIso: string, toIso: string): Transcript {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const lo = Number.isNaN(from) ? -Infinity : from;
  const hi = Number.isNaN(to) ? Infinity : to;
  const within = t.utterances.filter((u) => {
    const at = Date.parse(u.at);
    return !Number.isNaN(at) && at >= lo && at <= hi;
  });
  return { utterances: within };
}
