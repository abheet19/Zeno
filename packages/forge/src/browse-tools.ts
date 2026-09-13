/**
 * Zeno's OWN browser (`mcp__zeno_browse__*`) — the tool surface and the
 * classifier for it, split out of `tools.ts` so the sandboxed-window rules and
 * the owner's-own-Chrome rules (`chrome-tools.ts`) each live somewhere a
 * reader can see in one screen, rather than interleaved in one long file.
 *
 * Re-exported unchanged from `tools.ts`, so nothing importing `./tools.js` —
 * in this package or in `@abheet19/zeno-forge`'s consumers — needs to change.
 */
import { navigableUrl } from '@abheet19/zeno-browse';
import { MCP_TOOL_PREFIX, type ToolVerdict } from './tool-base.js';
import { field, oneLine } from './tool-text.js';

/**
 * The MCP server name Zeno's OWN browser is published under, and its operations.
 *
 * WHY THIS IS DIFFERENT FROM EVERY OTHER MCP SERVER. The generic rule in
 * `tools.ts` rates an MCP call as egress because "an MCP server is a process
 * outside the worktree that Zeno neither started nor bounds". That sentence is
 * the reason the browser is EMBEDDED rather than reached through an external
 * driver: this particular process Zeno spawns itself (`@abheet19/zeno-browse`),
 * hands a fresh in-memory session with no profile, jails to http(s), drives one
 * operation at a time and kills when the run ends. So it is not rated by the
 * generic rule — it is rated by what each operation actually does, which is
 * strictly more precise and, for `click` and `type`, strictly STRICTER.
 *
 * Being Zeno's own process is not a licence to be routine. Every one of these is
 * governed; the tiering only decides how loud the capsule is.
 */
export const BROWSE_SERVER = 'zeno_browse';

/** Reads of a page ALREADY open. No new bytes leave; external bytes come in. */
export const BROWSE_READ_METHODS: readonly string[] = ['read', 'screenshot'];
/** The one operation that fetches. This IS network egress. */
export const BROWSE_NAV_METHODS: readonly string[] = ['navigate'];
/** Operations that make the page ACT — submit a form, post, spend, log in. */
export const BROWSE_ACT_METHODS: readonly string[] = ['click', 'type'];

/** Every browser operation, in the order the surface lists them. */
export const BROWSE_METHODS: readonly string[] = [
  ...BROWSE_NAV_METHODS,
  ...BROWSE_READ_METHODS,
  ...BROWSE_ACT_METHODS,
];

/** The full tool name the CLI gives one browser operation. */
export function browseToolName(method: string): string {
  return `${MCP_TOOL_PREFIX}${BROWSE_SERVER}__${method}`;
}

/** The browser's tool names, as `--tools` takes them. */
export function browseTools(): readonly string[] {
  return BROWSE_METHODS.map(browseToolName);
}

/** True when a name is one of Zeno's browser tools, known or not. */
export function isBrowseTool(toolName: string): boolean {
  return toolName.startsWith(`${MCP_TOOL_PREFIX}${BROWSE_SERVER}__`);
}

/**
 * Classify one call to Zeno's own browser.
 *
 * THE TIERING, AND WHY EACH RUNG IS WHERE IT IS. "It's all just a browser" is
 * exactly the flattening this function refuses. Three genuinely different things
 * happen behind one window:
 *
 *   `read`, `screenshot` — T2, `net.fetch`, zone `external`. No new bytes leave:
 *     the page is already open, and the owner approved the navigation that
 *     opened it. But bytes ARRIVE — the kernel's own definition of `net.fetch`
 *     is "bytes leave this machine, or arrive from off it" — and what arrives is
 *     untrusted text that goes straight into the agent's context, where it can
 *     try to instruct it. That is not routine, and it is not T0: a T0 kind would
 *     be `auto` under the default policy, and `permission-gate.ts` refuses an
 *     auto-rated governed call outright rather than running it unattended.
 *
 *   `navigate` — T2, `net.fetch`, zone `external`, AND it exists only when the
 *     network is switched on. This is the fetch. It is gated at least as
 *     strictly as `WebFetch`: same kind, same tier, same `ZENO_FORGE_NETWORK`
 *     off-switch, and the capsule carries the literal URL — the whole URL, as it
 *     will be requested, in the spirit of `shell.exec` showing the literal
 *     command. A URL Zeno's browser would not open (a `file:` path, a `data:`
 *     document, a credential in the authority) is REFUSED here, before any
 *     capsule exists: an owner should never be asked to approve a navigation
 *     that the window would then reject, and should never be shown a secret.
 *
 *   `click`, `type` — T3, `shell.exec`, zones `external` and `personal`. A click
 *     is not a read. It submits the form, sends the message, places the order,
 *     accepts the terms; typing puts the agent's words into somebody else's
 *     system. Like a command, the harmless and the catastrophic are the same
 *     ACTION and only the owner reading the literal target tells them apart —
 *     which is precisely the argument for rating `shell.exec` at T3, so these
 *     are rated there too. The capsule names the exact selector and, for `type`,
 *     the exact text.
 *
 * An operation this function does not know is REFUSED, and deliberately not
 * allowed to fall through to the generic MCP rule: something calling itself
 * Zeno's browser and asking for a verb Zeno's browser does not have is the last
 * thing to round down.
 */
export function classifyBrowseCall(toolName: string, input: unknown): ToolVerdict {
  const method = toolName.slice(`${MCP_TOOL_PREFIX}${BROWSE_SERVER}__`.length);
  const bounded = 'the page runs in a window Zeno started: a fresh session with no profile, no cookies and no logins, and it can open nothing but http and https';

  if (BROWSE_NAV_METHODS.includes(method)) {
    const asked = field(input, 'url');
    const url = navigableUrl(asked);
    if (!url.ok) {
      return {
        gate: 'refused',
        kind: 'net.fetch',
        dataZones: [],
        summary: `Zeno’s browser will not open that address.`,
        reasons: [url.reason, 'a navigation Zeno would refuse is never put in front of the owner as a question'],
      };
    }
    return {
      gate: 'governed',
      kind: 'net.fetch',
      dataZones: ['external'],
      summary: `Open in Zeno’s browser: ${oneLine(url.url)}`,
      reasons: [
        'this is a page fetch — it leaves the machine, and what goes out cannot be recalled by refusing the next one',
        bounded,
      ],
    };
  }

  if (BROWSE_READ_METHODS.includes(method)) {
    const what = method === 'screenshot' ? 'take a picture of' : 'read the visible text of';
    return {
      gate: 'governed',
      kind: 'net.fetch',
      dataZones: ['external'],
      summary: `Zeno’s browser: ${what} the page it already has open.`,
      reasons: [
        'no new request is made — this reads the page the owner already approved opening',
        'what comes back is untrusted text from off this machine, and it goes into the agent’s context',
      ],
    };
  }

  if (BROWSE_ACT_METHODS.includes(method)) {
    const selector = oneLine(field(input, 'selector'), 120);
    const shown = selector === '' ? '(no element named)' : `"${selector}"`;
    const summary =
      method === 'type'
        ? `Zeno’s browser: type "${oneLine(field(input, 'text'), 120)}" into ${shown} on the page it has open.`
        : `Zeno’s browser: click ${shown} on the page it has open.`;
    return {
      gate: 'governed',
      kind: 'shell.exec',
      dataZones: ['external', 'personal'],
      summary,
      reasons: [
        'this makes the page ACT — a click can submit a form, send a message, accept terms or place an order',
        'no rule here can tell a harmless control from a consequential one — read the element and the page, that is the check',
        bounded,
      ],
    };
  }

  return {
    gate: 'refused',
    kind: 'read',
    dataZones: [],
    summary: `"${toolName}" is not an operation Zeno’s browser has.`,
    reasons: [
      'nobody has decided what this call can reach, and an unclassified capability is not a safe one',
      `Zeno’s browser does exactly these: ${BROWSE_METHODS.join(', ')}`,
    ],
  };
}
