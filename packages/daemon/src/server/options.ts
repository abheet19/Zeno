/**
 * `createServer`'s configuration surface, split out of server.ts purely to
 * stay under this repository's per-file line budget — every field, and every
 * word of its reasoning, is unchanged.
 */
import type { Kernel, SandboxFs } from '@abheet19/zeno-kernel';
import type { Vault } from '@abheet19/zeno-vault';
import type { Meetings } from '@abheet19/zeno-counsel';
import type { GateProber, Spawner } from '@abheet19/zeno-forge';
import type { BrowserHost } from '@abheet19/zeno-browse';
import type { ChromeDesk } from '@abheet19/zeno-chrome';
import type { Stream } from '../stream.js';
import type { HeldStore } from '../held-store.js';
import type { WorkDesk } from '../work.js';
import type { Tokens } from '../tokens.js';
import type { DelegateProbe } from '../routes/delegate-probe.js';

export interface DaemonOptions {
  readonly kernel: Kernel;
  /** Absolute path to the sandbox root. Nothing is written outside it. */
  readonly sandbox: string;
  /**
   * The workspace directory this daemon owns — where `proposer.token`, the
   * ledger and the lock live.
   *
   * Optional, and NOT derived from `sandbox` when it is missing. It exists so a
   * 401 can point at the actual file the caller should have read, and a message
   * that guessed a path would be the same class of lie it is there to fix: an
   * in-memory daemon with a bare temp sandbox has no such file, and must say
   * nothing rather than name one.
   */
  readonly workspace?: string;
  readonly fs: SandboxFs;
  readonly tokens: Tokens;
  readonly stream: Stream;
  /** Owner-only Forge progress channel. Tests may inject it to inspect exact events. */
  readonly runProgressStream?: Stream;
  /** Absolute path to the static UI directory. */
  readonly publicDir: string;
  /** Where work arrives from: the local backlog, and GitHub when configured. */
  readonly work: WorkDesk;
  /**
   * Durable home for proposals that are waiting on the owner. When given, open
   * capsules survive a restart instead of vanishing. Omit for an in-memory daemon.
   */
  readonly heldStore?: HeldStore;
  /** Governed local memory. When given, /memory and /brief are served. */
  readonly vault?: Vault;
  /**
   * The meeting archive. When given, the Counsel tab has a dashboard and a chat:
   * /counsel/meetings and /counsel/ask are served. Omit for a daemon with no
   * meeting store — /counsel/summarize still works, because summarising is pure.
   */
  readonly meetings?: Meetings;
  /**
   * One-time secret the owner's browser presents (as ?k=) to be trusted with the
   * owner token. Without it, GET / serves a read-only page. This is what stops a
   * blind local GET from scraping the owner token.
   */
  readonly launchNonce?: string;
  /** Whether the daemon is bound to the LAN (opt-in ZENO_LAN). Drives the
   * phone-access panel; the socket binding itself is done in main.ts. */
  readonly lanAccess?: boolean;
  /** The port the daemon listens on, for building phone-access URLs. */
  readonly port?: number;
  /**
   * How the daemon finds out WHICH agent a delegation would run on this machine.
   *
   * Injected so local, hosted-provider, and no-provider branches are drivable in
   * tests without Ollama or either hosted CLI on the machine. Omit for the real
   * probes: Ollama's `/api/tags` over loopback plus `claude --version` and
   * `codex --version` process probes.
   */
  readonly delegateProbe?: DelegateProbe;
  /** Start the installed local Ollama runtime while the real desktop boots. Tests omit this. */
  readonly ollamaAutoStart?: boolean;
  /** Owner terminal process seam. Omit for the bounded real local command runner. */
  readonly terminalRunner?: Spawner;
  /** Test process seam. Omit for the bounded real package-script runner. */
  readonly testRunner?: Spawner;
  /**
   * Whether a Forge run may be given the network-egress tools at all.
   *
   * Defaults to FALSE, and the default is the point. See the README's "what can
   * reach the internet": every other outbound path in Zeno is something the
   * owner switched on by name, and an agent's WebFetch should not be the one
   * exception that arrives by default. Even when this is true, every call is
   * still an approval capsule — this decides whether the tools exist, not
   * whether they are granted.
   */
  readonly forgeNetwork?: boolean;
  /**
   * Whether a Forge run gets the widened, governed tool surface at all.
   *
   * Defaults to TRUE — a coding agent that cannot run the tests it just wrote is
   * half an agent, and every command it runs is a capsule. Set it false and
   * Forge falls back to the file-only grant it had before any of this: five file
   * tools, no Bash, no permission host, and `--permission-prompts none` so that
   * anything which would ask is denied outright. That is the off switch, and it
   * is one setting rather than a list of tools to remember to also turn off.
   */
  readonly forgeShell?: boolean;
  /**
   * How a run PROVES its permission gate is live before it is handed the tools
   * that gate governs. Omit for the real one, which spawns the bridge exactly as
   * the CLI will and asks it a question only the running kernel can answer.
   *
   * Injectable because the interesting case is the failing one: a test needs a
   * gate that cannot be proved in order to assert that the run then narrows to
   * files only, and it must be able to have that without breaking anything.
   */
  readonly gateProber?: GateProber;
  /**
   * Whether a governed Forge run may be given Zeno's OWN browser at all.
   *
   * Defaults to TRUE, but it is the third of three conditions rather than a
   * grant: the run must also have a live permission gate, and `forgeNetwork`
   * must be on — a navigation is a page fetch, and Zeno does not have one class
   * of egress that arrives by default while `WebFetch` does not. Set
   * `ZENO_FORGE_BROWSER=0` and the browser tools are absent from the agent's
   * command line whatever else is true.
   */
  readonly forgeBrowser?: boolean;
  /**
   * How a run gets its browser window. Omit for the real one, which starts the
   * Chromium Zeno already ships with a session of this run's own.
   *
   * Injectable for the same reason `gateProber` is: the interesting case is the
   * failing one. A test needs a browser that cannot be proved in order to assert
   * that the run then carries NO browser tools at all.
   */
  readonly browserHost?: BrowserHost;
  /**
   * Whether a governed Forge run may be given the OWNER'S OWN, SIGNED-IN CHROME.
   *
   * Defaults to FALSE — the only capability in this file that does. Every other
   * switch here decides whether a bounded thing is on the command line; this one
   * decides whether an agent may act AS THE OWNER on every site they are logged
   * into, and a capability like that is not one anybody should acquire by
   * upgrading. `ZENO_FORGE_CHROME=1` is the owner saying it out loud, and even
   * then it is only the first of four conditions: the run needs a live
   * permission gate, the extension in their browser must PROVE itself, and every
   * single operation is refused unless its origin is on the allowlist they set
   * themselves and off Zeno's never-list.
   */
  readonly forgeChrome?: boolean;
  /**
   * The desk between Zeno and the Chrome extension. Omit for the real one.
   *
   * Injectable for the same reason `browserHost` is: the interesting cases are
   * the failing ones — an extension that cannot be proved, an origin off the
   * allowlist — and a test needs to be able to produce them.
   */
  readonly chromeDeskFor?: ChromeDesk;
  /**
   * The credential the native-messaging host presents on `/chrome/attach` and
   * `/chrome/result`. Minted per process, written to the workspace for the host
   * to read, and good for exactly those two routes: it can carry an answer and
   * it can never approve anything.
   */
  readonly chromeToken?: string;
  /**
   * How long a governed tool call waits for the owner before it is denied.
   *
   * A run holds the agent open while this ticks, so it is a real cost. Lapsing
   * is a DENIAL and never a grant: an owner who walked away has not agreed to
   * anything, and the window has no decline control yet, so ignoring a capsule
   * is the way to say no.
   */
  readonly permissionTimeoutMs?: number;
}
