/**
 * The desk between the daemon and the extension — one operation at a time.
 *
 * THE TRANSPORT, AND WHY IT IS SHAPED LIKE THIS. A native-messaging host is
 * spawned BY CHROME, not by Zeno. Zeno cannot call it; it can only be called.
 * So the direction is inverted from `browse/src/host-node.ts`, where the daemon
 * spawns the window and writes to it: here the host reaches OUT to the daemon's
 * existing loopback address and asks "is there anything for me?", parks until
 * there is, performs it through the extension, and posts the answer back.
 *
 * That inversion is the reason the README's "no inbound surface at all" survives
 * this feature. A helper that LISTENED — even on 127.0.0.1 — would be a port any
 * process on the machine could reach, and would make that sentence false. Long-
 * polling an address Zeno already binds adds no listener at all.
 *
 * ONE AT A TIME, and never a queue. If an operation is already outstanding, a
 * second is refused rather than parked behind it. A queue would mean an approval
 * the owner gave five minutes ago firing into a page they have since navigated
 * away from — and a capsule describes a moment, not an intention.
 *
 * The desk decides nothing about permission. By the time `ask` is called the
 * owner has read a capsule naming the origin and the profile, approved it once,
 * and a receipt exists. What is left is to do the thing, or to say honestly that
 * it could not be done.
 */
import { parseChromeCall, type ChromeRequest, type ChromeResponse } from './protocol.js';
import { readChromeProbe, type ChromeProof } from './probe.js';
import type { OriginPolicy } from './origins.js';

/** How long the extension is given to answer one operation before it is abandoned. */
export const OPERATION_TIMEOUT_MS = 30_000;
/** How long a `ping` is given. Short: a live extension answers instantly. */
export const PROBE_TIMEOUT_MS = 4_000;
/**
 * How long the native host's poll is parked before it is answered with "nothing".
 *
 * Under the timeout any sane proxy or keep-alive imposes, and long enough that a
 * host which has gone away is noticed within one cycle rather than forever.
 */
export const POLL_PARK_MS = 20_000;

/** What the desk needs from the outside. Injected, so a test drives all of it. */
export interface ChromeDeskOptions {
  /** The owner's current origin policy, read fresh on every call — the allowlist can change mid-run. */
  readonly policy: () => OriginPolicy;
  readonly operationTimeoutMs?: number;
  readonly probeTimeoutMs?: number;
  readonly pollParkMs?: number;
}

/** One outstanding operation, waiting for the extension. */
interface Outstanding {
  readonly request: ChromeRequest;
  readonly settle: (r: ChromeResponse) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface ChromeDesk {
  /**
   * Perform one operation the owner has already approved. Total: every failure
   * is a `ChromeResponse` with `ok: false` and a sentence, never a throw.
   */
  ask(op: string, input: unknown): Promise<ChromeResponse>;
  /** Prove the extension is live and say which profile answered. */
  prove(): Promise<ChromeProof>;
  /** The native host's long poll: the next operation, or null when there is none. */
  take(): Promise<ChromeRequest | null>;
  /** The native host's answer. False when nothing was waiting for this id. */
  settle(answer: ChromeResponse): boolean;
  /** True when a native host has polled recently enough to be considered present. */
  attached(): boolean;
  /** Abandon everything outstanding. Idempotent. */
  close(): void;
}

export function chromeDesk(opts: ChromeDeskOptions): ChromeDesk {
  const operationTimeoutMs = opts.operationTimeoutMs ?? OPERATION_TIMEOUT_MS;
  const probeTimeoutMs = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const pollParkMs = opts.pollParkMs ?? POLL_PARK_MS;

  let nextId = 1;
  let outstanding: Outstanding | null = null;
  /** A poll parked with nothing to give it, waiting for the next request. */
  let parked: ((r: ChromeRequest | null) => void) | null = null;
  let lastPollAt = 0;
  let closed = false;

  function dispatch(request: ChromeRequest): void {
    const waiting = parked;
    if (waiting !== null) {
      parked = null;
      waiting(request);
    }
    // No parked poll: the request simply waits in `outstanding` and the next
    // `take()` finds it. Nothing is dropped and nothing is queued behind it.
  }

  function send(request: Omit<ChromeRequest, 'id'>, timeoutMs: number): Promise<ChromeResponse> {
    const id = nextId++;
    if (closed) return Promise.resolve({ id, ok: false, detail: 'the run this Chrome bridge belonged to has ended' });
    if (outstanding !== null) {
      return Promise.resolve({
        id,
        ok: false,
        detail:
          'another Chrome operation is still outstanding. Zeno drives your real browser one operation at a time, ' +
          'so that every approval you give matches the page as it is at that moment.',
      });
    }
    const full: ChromeRequest = { ...request, id };
    return new Promise<ChromeResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (outstanding?.request.id === id) outstanding = null;
        resolve({ id, ok: false, detail: `your Chrome did not answer within ${timeoutMs}ms, so nothing was done` });
      }, timeoutMs);
      outstanding = {
        request: full,
        timer,
        settle: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      dispatch(full);
    });
  }

  return {
    async ask(op: string, input: unknown): Promise<ChromeResponse> {
      // Validated HERE and not in the extension: the bounds are a pure decision
      // and belong on this side, where they are tested. The extension enforces
      // the origin again anyway — a rule that only worked when someone
      // remembered to call it would be decoration.
      const call = parseChromeCall(op, input, opts.policy());
      if (!call.ok) return { id: 0, ok: false, detail: `Zeno refused this in your real Chrome: ${call.reason}` };
      return await send(call.request, operationTimeoutMs);
    },
    async prove(): Promise<ChromeProof> {
      const answer = await send({ op: 'ping' }, probeTimeoutMs);
      return readChromeProbe(answer);
    },
    take(): Promise<ChromeRequest | null> {
      lastPollAt = Date.now();
      if (closed) return Promise.resolve(null);
      const ready = outstanding;
      if (ready !== null && parked === null) {
        // Hand it over exactly once — clearing the parked slot is what stops a
        // second poll from being given the same request.
        return Promise.resolve(ready.request);
      }
      return new Promise<ChromeRequest | null>((resolve) => {
        const mine = (r: ChromeRequest | null): void => {
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => {
          // Clear the slot only if it is still THIS poll's — a request that
          // arrived in the meantime already took it, and stamping null over a
          // successor's slot would strand the next one.
          if (parked === mine) parked = null;
          resolve(null);
        }, pollParkMs);
        parked = mine;
      });
    },
    settle(answer: ChromeResponse): boolean {
      const waiting = outstanding;
      if (waiting === null || waiting.request.id !== answer.id) return false;
      outstanding = null;
      waiting.settle(answer);
      return true;
    },
    attached(): boolean {
      // "Recently" is one park cycle plus a margin. A host that stopped polling
      // is gone, and gone must not read as present — the liveness proof is what
      // actually decides, and this only keeps a status line honest.
      return lastPollAt !== 0 && Date.now() - lastPollAt < pollParkMs * 2;
    },
    close(): void {
      closed = true;
      const waiting = outstanding;
      outstanding = null;
      if (waiting !== null) {
        clearTimeout(waiting.timer);
        waiting.settle({ id: waiting.request.id, ok: false, detail: 'the run this Chrome bridge belonged to has ended' });
      }
      const poll = parked;
      parked = null;
      if (poll !== null) poll(null);
    },
  };
}
