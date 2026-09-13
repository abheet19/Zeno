/**
 * The OWNER'S OWN, SIGNED-IN CHROME (`mcp__zeno_chrome__*`) — the tool surface
 * and the classifier for it, split out of `tools.ts` for the same reason as
 * `browse-tools.ts`: the sandboxed window's rules and this browser's rules are
 * long enough, and different enough, that interleaving them in one file made
 * the contrast between the two harder to see, not easier.
 *
 * Re-exported unchanged from `tools.ts`, so nothing importing `./tools.js` —
 * in this package or in `@abheet19/zeno-forge`'s consumers — needs to change.
 */
import { decideOrigin, type OriginPolicy } from '@abheet19/zeno-chrome';
import { MCP_TOOL_PREFIX, type ToolVerdict } from './tool-base.js';
import { field, oneLine } from './tool-text.js';

/**
 * The MCP server name the OWNER'S OWN, SIGNED-IN CHROME is published under.
 *
 * A SEPARATE NAMESPACE FROM `zeno_browse`, AND THAT IS THE POINT. The two look
 * alike and are not alike, and merging them would be the single most damaging
 * simplification available in this file:
 *
 *   `mcp__zeno_browse__*` drives a window Zeno started — fresh session, NO
 *     PROFILE, no cookies, no logins. The worst it can do on a page is what a
 *     stranger with a brand-new browser can do.
 *
 *   `mcp__zeno_chrome__*` drives the browser the owner is LOGGED INTO. Every
 *     request carries their cookies. An agent acting there acts AS THEM on every
 *     site they are signed into.
 *
 * Two blast radii, two namespaces, two sets of capsule wording — so that an
 * owner reading a receipt weeks later can tell which browser acted, and so that
 * the tool NAME itself, which appears on every capsule, says which one it is.
 */
export const CHROME_SERVER = 'zeno_chrome';

/** Reads of the page in front — of AUTHENTICATED content. */
export const CHROME_READ_METHODS: readonly string[] = ['read', 'screenshot'];
/** The one operation that fetches, with the owner's session attached. */
export const CHROME_NAV_METHODS: readonly string[] = ['navigate'];
/** Operations that make the page ACT, as the owner. */
export const CHROME_ACT_METHODS: readonly string[] = ['click', 'type'];

/** Every Chrome operation, in the order the surface lists them. */
export const CHROME_METHODS: readonly string[] = [
  ...CHROME_NAV_METHODS,
  ...CHROME_READ_METHODS,
  ...CHROME_ACT_METHODS,
];

/** The full tool name the CLI gives one operation in the owner's Chrome. */
export function chromeToolName(method: string): string {
  return `${MCP_TOOL_PREFIX}${CHROME_SERVER}__${method}`;
}

/** The Chrome tools' names, as `--tools` takes them. */
export function chromeTools(): readonly string[] {
  return CHROME_METHODS.map(chromeToolName);
}

/** True when a name is one of the owner's-Chrome tools, known or not. */
export function isChromeTool(toolName: string): boolean {
  return toolName.startsWith(`${MCP_TOOL_PREFIX}${CHROME_SERVER}__`);
}

/**
 * The allowlist a classification is made against when the caller supplies none.
 *
 * EMPTY, and that is a decision rather than a placeholder. An origin policy is
 * owner state; a code path that lost it must not thereby widen anything. An
 * empty allowlist refuses every origin, so the failure mode of forgetting to
 * thread the policy through is "nothing works", never "everything is allowed".
 */
export const NO_CHROME_ORIGINS: OriginPolicy = { allowed: [] };

/**
 * Classify one call to the OWNER'S OWN, SIGNED-IN CHROME.
 *
 * THE TIERING, AND WHY EVERY RUNG IS ABOVE ITS `zeno_browse` TWIN.
 *
 * The single fact that decides all of it: this browser has the owner's identity
 * and the sandboxed window has none. Everything below follows from that, and the
 * binding rule is that NOTHING HERE MAY BE T2 OR BELOW — because even a read is
 * a read of authenticated content, and T2 is the tier the product uses for
 * "bytes crossed the boundary", not for "an agent looked at your mail".
 *
 *   `read`, `screenshot` — T3, `shell.exec`, zones `external` and `personal`.
 *     Its twin is T2. It is raised for a reason that is not symmetry: what is on
 *     the page is whatever the owner is SIGNED IN TO — an inbox, an admin
 *     console, a private repository, a half-filled form with their address in
 *     it. Rating that as "an external fetch" would describe the wrong event
 *     entirely. It sits with `shell.exec` because the argument for that tier
 *     applies exactly: the harmless case and the catastrophic case are the SAME
 *     ACTION, and only the owner reading the literal origin tells them apart.
 *
 *   `navigate` — T3, `shell.exec`, same zones. Its twin is T2 and is honestly
 *     rated there, because that fetch is anonymous. This one is not: the request
 *     carries the owner's session cookies, so a GET can BE a state change — a
 *     logout link, an unsubscribe link, a one-click confirmation, an
 *     `?action=delete` a page author never expected a robot to follow. "It is
 *     only a navigation" stops being true the moment the browser is signed in.
 *
 *   `click`, `type` — T3, `destructive`, same zones. Its twin is `shell.exec`,
 *     and this is a strictly louder KIND at the same tier — exactly the move
 *     `DESTRUCTIVE_SHELL` makes for a command that deletes or publishes. A click
 *     as the owner sends the mail, transfers the money, accepts the terms,
 *     deletes the repository, in their name, from their account, with their
 *     cookies. There is no honest wording weaker than `destructive` for that,
 *     and T3 is the top of the approvable range: T4 is refused outright rather
 *     than approvable, and a capability the owner deliberately switched on
 *     should be approvable or absent, not permanently denied theatre.
 *
 * THE ORIGIN IS DECIDED HERE, BEFORE A CAPSULE EXISTS. An origin that is not on
 * the owner's allowlist, or that is on the never-list, is REFUSED — never put in
 * front of the owner as a question, exactly as a `file:` URL is refused for the
 * sandboxed window today. Adding an origin is an owner act performed in the Zeno
 * window, and deliberately not something an agent can ask for mid-run: a
 * standing decision that can be requested in the moment is not a standing
 * decision, it is one more capsule in a stream of capsules.
 *
 * EVERY CAPSULE NAMES THE ORIGIN AND SAYS WHOSE BROWSER THIS IS. The summary
 * leads with `Your signed-in Chrome`, names the origin in full, and the reasons
 * say in as many words that this is the authenticated profile and not the
 * throwaway window. An owner must never have to work out which browser a capsule
 * means.
 */
export function classifyChromeCall(toolName: string, input: unknown, policy: OriginPolicy): ToolVerdict {
  const method = toolName.slice(`${MCP_TOOL_PREFIX}${CHROME_SERVER}__`.length);
  if (!CHROME_METHODS.includes(method)) {
    return {
      gate: 'refused',
      kind: 'read',
      dataZones: [],
      summary: `"${toolName}" is not an operation Zeno performs in your own Chrome.`,
      reasons: [
        'nobody has decided what this call can reach, and an unclassified capability is not a safe one',
        `Zeno’s Chrome bridge does exactly these: ${CHROME_METHODS.join(', ')}`,
      ],
    };
  }

  // The origin, first and before everything. `navigate` states a whole URL; the
  // rest state the origin they expect to be acting on, and the extension refuses
  // them if the tab in front is somewhere else.
  const stated = method === 'navigate' ? field(input, 'url') : field(input, 'origin');
  const decided = decideOrigin(stated, policy);
  if (!decided.ok) {
    return {
      gate: 'refused',
      kind: 'read',
      dataZones: [],
      summary: 'Zeno will not act on that site in your own Chrome.',
      reasons: [decided.reason, 'an action Zeno would refuse is never put in front of the owner as a question'],
    };
  }
  const origin = decided.origin;

  // The sentence that must appear on every one of these capsules, and never on
  // a `zeno_browse` one. The owner has two browsers in play; the capsule says
  // which.
  const whose =
    'THIS IS YOUR OWN SIGNED-IN CHROME — not the throwaway window Zeno starts. It carries your cookies and ' +
    'your sessions, so anything done here is done AS YOU, on an account you are logged into';

  if (CHROME_NAV_METHODS.includes(method)) {
    return {
      gate: 'governed',
      kind: 'shell.exec',
      dataZones: ['external', 'personal'],
      summary: `Your signed-in Chrome · ${origin} — open ${oneLine(field(input, 'url'))}`,
      reasons: [
        whose,
        'a signed-in navigation is not an anonymous fetch: the request carries your session, so a plain link can log you out, unsubscribe you or confirm something',
        `${origin} is on the Chrome allowlist you set yourself`,
      ],
    };
  }

  if (CHROME_READ_METHODS.includes(method)) {
    const what = method === 'screenshot' ? 'take a picture of' : 'read the visible text of';
    return {
      gate: 'governed',
      kind: 'shell.exec',
      dataZones: ['external', 'personal'],
      summary: `Your signed-in Chrome · ${origin} — ${what} the page in front of you.`,
      reasons: [
        whose,
        'what is on that page is whatever you are signed in to, so this is a read of your own private content, not of a public page',
        'and what comes back is untrusted text that goes straight into the agent’s context',
      ],
    };
  }

  const selector = oneLine(field(input, 'selector'), 120);
  const shown = selector === '' ? '(no element named)' : `"${selector}"`;
  const summary =
    method === 'type'
      ? `Your signed-in Chrome · ${origin} — type "${oneLine(field(input, 'text'), 120)}" into ${shown}`
      : `Your signed-in Chrome · ${origin} — click ${shown}`;
  return {
    gate: 'governed',
    kind: 'destructive',
    dataZones: ['external', 'personal'],
    summary,
    reasons: [
      whose,
      'a click here sends the message, accepts the terms, places the order or deletes the thing — in your name, from your account',
      'no rule can tell a harmless control from a consequential one — read the element and the site, that is the check',
    ],
  };
}
