/**
 * Proving the browser is live BEFORE a run is told it has one.
 *
 * The same discipline, and for the same reason, as `forge/src/gate-probe.ts`.
 * There the failure mode was a permission bridge that silently was not asked;
 * here it is subtler and just as bad: Electron is a devDependency of this
 * workspace and its binary may simply not be on the machine (a fresh clone with
 * `--omit=dev`, a packaged build that shipped without it, a headless CI box with
 * no display). If Forge published the browse tools anyway, the agent would be
 * handed five tools that fail at the moment of use — and the owner would be
 * reading capsules for navigations that could never happen.
 *
 * So the browser is not assumed, it is DEMONSTRATED: the window subprocess is
 * started, `app.whenReady()` is awaited inside it, an isolated session and a real
 * `BrowserWindow` are created, and only then does it answer `ping`. A subsystem
 * that cannot answer costs the run its browser — the tools are ABSENT from the
 * command line, which is stronger than "they would be denied", because there is
 * no call to deny.
 *
 * Pure: the spawning is in `host-node.ts`.
 */

/** The sentence a run carries when the browser could not be proved. Asserted by tests. */
export const BROWSER_UNPROVEN_NOTE =
  'Zeno could not prove its own browser window was live, so this run was given no browser tools at all — ' +
  'they are absent from the agent’s command line rather than merely refused. A browser that cannot be ' +
  'shown to work costs the agent a capability, never you the guarantee.';

/** What the proof came to. `live: false` is a decision the caller acts on, never a throw. */
export interface BrowserProof {
  readonly live: boolean;
  /** One sentence, in the owner's words. Present either way — a proof says what it proved. */
  readonly note: string;
}

/** The sentence a successful proof records. */
export const BROWSER_PROVEN_NOTE = 'a window Zeno started answered a test call before the agent was given any browser tool';

/**
 * Read the window's answer to `ping`.
 *
 * Every path that is not an unambiguous success is `live: false`. The window
 * must say which run it belongs to: a `ping` answered for some OTHER run would
 * mean the session map and the subprocess had drifted apart, and a browser you
 * cannot attribute to a run is not one to hand a run.
 */
export function readBrowserProbe(runId: string, answer: { readonly ok?: unknown; readonly detail?: unknown; readonly title?: unknown } | null): BrowserProof {
  if (answer === null) {
    return { live: false, note: 'the browser subprocess never answered' };
  }
  if (answer.ok !== true) {
    return { live: false, note: `the browser subprocess refused a test call — ${String(answer.detail ?? 'no reason given')}` };
  }
  if (answer.title !== runId) {
    return {
      live: false,
      note: `the browser that answered belongs to "${String(answer.title)}", not to this run`,
    };
  }
  return { live: true, note: BROWSER_PROVEN_NOTE };
}
