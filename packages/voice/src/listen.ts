/**
 * Wake mode — the pure half. A bounded retention buffer and the command-window
 * state machine that sits between "the microphone is armed" and "Zeno heard a
 * command". No audio, no timers, no DOM: the clock is passed in as a number, so
 * every transition is reproducible in a test.
 *
 * WHAT THIS FILE CANNOT DO, SAID PLAINLY. It cannot make recognition local.
 * The engine behind wake mode is the browser's Web Speech API, which in Chrome,
 * Edge and Safari uploads microphone audio to the browser maker's servers to
 * turn it into text. There is no on-device wake model in this project. So while
 * wake mode is on, the room is being streamed to a third party, and nothing in
 * this file changes that.
 *
 * What this file DOES bound is Zeno's own retention. Transcript that arrives
 * while armed and is NOT addressed to Zeno is held here, in memory, for at most
 * `RETENTION_MS`, is never written anywhere, and is dropped the moment the owner
 * disarms (or the moment a wake fires). That is a real, checkable bound on what
 * Zeno keeps — and it is deliberately NOT a claim that the audio stayed on this
 * machine. The two are different promises and the UI must not blur them.
 *
 * THE LAW STILL HOLDS. This machine's only output for a heard command is an
 * `Outcome` from the same pure pipeline push-to-talk uses, and that pipeline's
 * `Intent` union has no approve member. A wake cannot widen what voice may do;
 * it only changes how the utterance was started. "Zeno … approve it" lands on
 * the same `APPROVAL_BY_HAND` refusal as it does on the button.
 */
import { detectWake } from './wake.js';
import { interpretCommand, type Outcome } from './session.js';

/** How long a command window stays open after a wake, in ms. Short on purpose:
 * an armed misfire should cost the owner a couple of seconds of a visible
 * countdown, not an open-ended capture. */
export const WAKE_WINDOW_MS = 8_000;

/** How long untriggered transcript is retained in memory, in ms. */
export const RETENTION_MS = 15_000;

/** A hard cap on retained entries, so a burst of interim results inside the
 * retention window cannot grow the buffer without bound. Time alone is not a
 * bound on memory when the engine emits hundreds of partials a second. */
export const RETENTION_MAX_ENTRIES = 24;

// ---- the bounded retention buffer ------------------------------------------

/** One retained line of untriggered transcript and when it arrived. */
export interface RetainedLine {
  readonly text: string;
  readonly at: number;
}

/**
 * The last `windowMs` of untriggered transcript, in memory only.
 *
 * Eviction is by age first (anything older than the window is gone the next time
 * the buffer is read or written) and by count second. Nothing here persists:
 * there is no storage call in this file, and `clear()` is what disarm calls.
 *
 * Interim results from a speech engine arrive as a growing prefix of the same
 * sentence — "add", "add a", "add a card". Storing each one would fill the
 * buffer with near-duplicates and make the honest "here is what Zeno is holding"
 * display unreadable, so a line that extends the previous line REPLACES it. The
 * retained text then reads like what was actually said.
 */
export class TranscriptRing {
  private lines: RetainedLine[] = [];
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(windowMs: number = RETENTION_MS, maxEntries: number = RETENTION_MAX_ENTRIES) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  /** Retain a line of untriggered transcript. Blank text is not retained. */
  push(text: string, now: number): void {
    const clean = text.trim();
    if (clean === '') return;
    const last = this.lines[this.lines.length - 1];
    if (last !== undefined && clean.startsWith(last.text)) {
      // A growing interim of the same utterance: replace, do not accumulate.
      this.lines[this.lines.length - 1] = { text: clean, at: now };
    } else {
      this.lines.push({ text: clean, at: now });
    }
    this.evict(now);
  }

  /** The lines still inside the retention window, oldest first. */
  entries(now: number): readonly RetainedLine[] {
    this.evict(now);
    return this.lines.slice();
  }

  /** The retained transcript as one string — what the owner is shown when the
   * panel says "this is all Zeno is holding". */
  text(now: number): string {
    return this.entries(now)
      .map((l) => l.text)
      .join(' ');
  }

  /** Drop everything. Called on disarm and on a wake. */
  clear(): void {
    this.lines = [];
  }

  /** How many lines are currently retained. */
  size(now: number): number {
    return this.entries(now).length;
  }

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    let first = 0;
    while (first < this.lines.length && (this.lines[first] as RetainedLine).at <= cutoff) first += 1;
    if (first > 0) this.lines = this.lines.slice(first);
    if (this.lines.length > this.maxEntries) this.lines = this.lines.slice(this.lines.length - this.maxEntries);
  }
}

// ---- the command-window state machine --------------------------------------

/**
 * The three states the owner must be able to see at a glance. There is no
 * fourth, and no hidden one: `off` is the only state in which the microphone is
 * not open, so a UI that renders these three faithfully cannot be listening
 * silently.
 */
export type ListenState =
  /** Not listening. The microphone is not open. */
  | 'off'
  /** Listening for the wake word. Nothing is being captured as a command. */
  | 'armed'
  /** The wake word was heard; a bounded command window is open. */
  | 'open';

/** What one transcript (or one clock tick) did. The front-end renders these and
 * does nothing else — all of the decision lives here, where tests can reach it. */
export type ListenEvent =
  /** Nothing to show: off, or a blank transcript. */
  | { readonly kind: 'none' }
  /** Untriggered speech, retained in the bounded in-memory buffer only. */
  | { readonly kind: 'retained' }
  /** The wake word was heard; the command window is now open. */
  | { readonly kind: 'woke' }
  /** Speech inside the open window that is not final yet. */
  | { readonly kind: 'capturing'; readonly partial: string }
  /** A command was heard. `outcome` is the same pipeline push-to-talk uses. */
  | { readonly kind: 'command'; readonly command: string; readonly outcome: Outcome }
  /** The window closed with nothing said. Back to armed. A cheap misfire. */
  | { readonly kind: 'expired' };

/** Construction options. Both default to the exported constants; tests override
 * them to keep the clock arithmetic obvious. */
export interface WakeListenerOptions {
  readonly windowMs?: number;
  readonly retentionMs?: number;
  readonly maxEntries?: number;
}

/**
 * The wake-mode state machine.
 *
 * off --arm()--> armed --wake heard--> open --command / expiry--> armed
 *                  ^                                                |
 *                  +------------------------------------------------+
 *   any state --disarm()--> off (and the retention buffer is dropped)
 *
 * Two rules are load-bearing:
 *
 *  1. The window is HARD-bounded. Speech arriving inside it does not extend the
 *     deadline. "About eight seconds" has to mean eight seconds, or the bound
 *     the owner was shown is not a bound.
 *
 *  2. A wake never widens authority. The command is handed to `interpretCommand`
 *     — the same function the push-to-talk path uses once the wake word is
 *     stripped — so the approval refusal, and the absence of any approve intent,
 *     apply identically in both modes.
 */
export class WakeListener {
  private current: ListenState = 'off';
  private deadline = 0;
  private readonly ring: TranscriptRing;
  private readonly windowMs: number;

  constructor(opts: WakeListenerOptions = {}) {
    this.windowMs = opts.windowMs ?? WAKE_WINDOW_MS;
    this.ring = new TranscriptRing(opts.retentionMs ?? RETENTION_MS, opts.maxEntries ?? RETENTION_MAX_ENTRIES);
  }

  /** The state the indicator must be showing right now. */
  get state(): ListenState {
    return this.current;
  }

  /** Start listening for the wake word. Idempotent. */
  arm(): void {
    if (this.current !== 'off') return;
    this.current = 'armed';
    this.deadline = 0;
    this.ring.clear();
  }

  /** Stop listening, and drop everything retained. Idempotent. */
  disarm(): void {
    this.current = 'off';
    this.deadline = 0;
    this.ring.clear();
  }

  /** Milliseconds left in the open command window; 0 when no window is open.
   * This is what the countdown renders. */
  remainingMs(now: number): number {
    if (this.current !== 'open') return 0;
    return Math.max(0, this.deadline - now);
  }

  /** The untriggered transcript Zeno is holding right now — bounded, in memory,
   * never written down. Shown to the owner verbatim so the claim is checkable. */
  retained(now: number): string {
    return this.ring.text(now);
  }

  /** How many untriggered lines are retained. */
  retainedCount(now: number): number {
    return this.ring.size(now);
  }

  /**
   * Advance the clock. Returns `expired` exactly once when an open window runs
   * out, and `none` otherwise. The front-end calls this on a short interval so
   * the countdown and the state can never drift out of agreement.
   */
  tick(now: number): ListenEvent {
    if (this.current === 'open' && now >= this.deadline) {
      this.current = 'armed';
      this.deadline = 0;
      return { kind: 'expired' };
    }
    return { kind: 'none' };
  }

  /**
   * Feed one transcript from the recognizer.
   *
   * `final` distinguishes the engine's settled result from a partial. Partials
   * are what wake detection runs on (so the window opens the instant the owner
   * says the word), but only a FINAL transcript is ever turned into a command —
   * acting on a partial would propose from half a sentence.
   */
  hear(text: string, final: boolean, now: number): ListenEvent {
    if (this.current === 'off') return { kind: 'none' };

    // A window that ran out before this transcript arrived is closed here rather
    // than waiting for the next tick, so `hear` and `tick` can never disagree
    // about which state we are in.
    if (this.current === 'open' && now >= this.deadline) {
      this.current = 'armed';
      this.deadline = 0;
    }

    const clean = text.trim();
    if (clean === '') return { kind: 'none' };

    if (this.current === 'armed') {
      const wake = detectWake(clean);
      if (wake === null) {
        this.ring.push(clean, now);
        return { kind: 'retained' };
      }
      // A wake fired: whatever was retained was pre-wake chatter we no longer
      // have any reason to hold. Drop it now rather than at the next disarm.
      this.ring.clear();
      const command = wake.command.trim();
      if (final && command !== '') {
        // Wake and command in one settled utterance — no need to open a window
        // the owner would only watch tick down after they already spoke.
        return { kind: 'command', command, outcome: interpretCommand(command) };
      }
      this.current = 'open';
      this.deadline = now + this.windowMs;
      return { kind: 'woke' };
    }

    // The window is open. The engine often repeats the wake word inside the same
    // utterance, so strip it when present and treat the rest as the command.
    const wake = detectWake(clean);
    const command = (wake === null ? clean : wake.command).trim();
    if (!final || command === '') return { kind: 'capturing', partial: command };

    this.current = 'armed';
    this.deadline = 0;
    return { kind: 'command', command, outcome: interpretCommand(command) };
  }
}
