/**
 * Proving the owner's Chrome is actually reachable BEFORE a run is told it is.
 *
 * The same discipline, and for the same reason, as `forge/src/gate-probe.ts` and
 * `browse/src/probe.ts`. Here the chain is longer than either of them and every
 * link is outside this repository: Chrome must be running, the extension must be
 * loaded and enabled, the native-messaging host manifest must be registered
 * under the right key with the right extension id, and the host must be able to
 * reach the daemon. Any one of those can be quietly untrue — a disabled
 * extension looks exactly like a working one from here — and the failure would
 * hand the agent tools that fail at the moment of use while the owner reads
 * capsules for actions that never happen.
 *
 * So it is not assumed, it is DEMONSTRATED: the extension answers `ping` and
 * names the profile it is installed in. A subsystem that cannot answer costs the
 * run its Chrome tools — ABSENT from the command line, which is stronger than
 * "they would be denied", because there is no call to deny.
 *
 * Pure: the waiting is in `host-node.ts`.
 */

/** The sentence a run carries when the owner's Chrome could not be proved. Asserted by tests. */
export const CHROME_UNPROVEN_NOTE =
  'Zeno could not prove the Chrome extension in your own browser was live, so this run was given no Chrome tools ' +
  'at all — they are absent from the agent’s command line rather than merely refused. A capability that cannot be ' +
  'shown to work costs the agent the capability, never you the guarantee.';

/** The sentence a successful proof records. */
export const CHROME_PROVEN_NOTE =
  'the Zeno extension in the owner’s own signed-in Chrome answered a test call before the agent was given any Chrome tool';

/** What the proof came to. `live: false` is a decision the caller acts on, never a throw. */
export interface ChromeProof {
  readonly live: boolean;
  /** One sentence, in the owner's words. Present either way — a proof says what it proved. */
  readonly note: string;
  /**
   * The Chrome profile that answered, when one did. It goes on every capsule:
   * the owner must be able to tell "my signed-in browser" from "the throwaway
   * window Zeno started" at a glance, and a profile name is the shortest way to
   * say which one this is.
   */
  readonly profile?: string;
}

/**
 * Read the extension's answer to `ping`.
 *
 * Every path that is not an unambiguous success is `live: false`. The extension
 * must name a profile: an answer that cannot say WHICH browser it came from is
 * not one to put on a capsule that exists to tell the owner exactly that.
 */
export function readChromeProbe(
  answer: { readonly ok?: unknown; readonly detail?: unknown; readonly profile?: unknown } | null,
): ChromeProof {
  if (answer === null) {
    return { live: false, note: 'the Chrome extension never answered — is Chrome running with the Zeno extension enabled?' };
  }
  if (answer.ok !== true) {
    return { live: false, note: `the Chrome extension refused a test call — ${String(answer.detail ?? 'no reason given')}` };
  }
  if (typeof answer.profile !== 'string' || answer.profile.trim() === '') {
    return {
      live: false,
      note: 'the Chrome extension answered without naming the profile it is installed in, and a capsule that cannot say which browser will act is not one to show',
    };
  }
  return { live: true, note: CHROME_PROVEN_NOTE, profile: answer.profile.trim() };
}
