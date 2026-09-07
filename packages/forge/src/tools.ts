/**
 * What a tool call can actually reach — the blast-radius classifier.
 *
 * Forge used to hand the headless agent five file tools and nothing else, and
 * the safety argument was entirely geometric: the worktree is a throwaway, the
 * tools cannot leave it, so nothing needs a decision. That argument is sound,
 * and it is also the reason the agent could not run the test suite it had just
 * written. Widening the surface to the real one — Bash, the web tools, MCP —
 * breaks the geometry, so the argument has to be replaced rather than stretched.
 *
 * The replacement is the same one the rest of Zeno uses: SORT BY WHAT ESCAPES.
 *
 *   ROUTINE   the call cannot leave the throwaway worktree. Reads inside it,
 *             writes inside it. Nothing here is a decision, because the worktree
 *             is deleted at the end of the run and every file it holds still has
 *             to become an approval capsule before it reaches the sandbox.
 *
 *   GOVERNED  the call can affect the world outside the worktree — a command on
 *             the owner's real machine, bytes leaving for the network, a call
 *             into a process Zeno did not start. Each one goes through the
 *             kernel: classify -> preview -> the owner approves -> ONE attempt
 *             -> a signed, hash-chained receipt. Per call, not per run.
 *
 *   REFUSED   the call is not available at all, and no approval exists that
 *             makes it available.
 *
 * WHAT THIS IS NOT. The shell rules below RAISE a tier; they are not a sandbox
 * and must never be read as one. A command can be base64'd, aliased, hidden
 * behind a script or spelled in a way no pattern here recognises, and it will
 * classify as an ordinary `shell.exec` — which is still T3, still stops, and
 * still puts the exact command in front of the owner. THAT is the protection:
 * the owner reads the literal string that will run, and one click authorises
 * exactly one attempt at exactly that string. The patterns only decide how loud
 * the capsule is, never whether there is one.
 *
 * Pure and I/O-free, in the manner of `kernel/src/risk.ts`: a tool name and its
 * arguments in, a verdict out. Deciding what a call would cost is separate from
 * asking anyone about it.
 */
import type { ActionKind, DataZone } from '@abheet19/zeno-kernel';
// The browser's own bounds, read from the package that enforces them. The
// classifier and the window must agree on what a navigable URL is, or a capsule
// ends up describing something that never happens.
import { navigableUrl } from '@abheet19/zeno-browse';

/** How a tool call is handled. There is no fourth answer. */
export type ToolGate = 'routine' | 'governed' | 'refused';

/** The verdict on one call: what it costs, and the sentence the owner reads. */
export interface ToolVerdict {
  readonly gate: ToolGate;
  /** The kernel action kind this call is previewed as. Meaningless for `refused`. */
  readonly kind: ActionKind;
  /** The zones it touches — what raises the tier beyond the kind's own floor. */
  readonly dataZones: readonly DataZone[];
  /** One human sentence, the thing that actually appears on the capsule. */
  readonly summary: string;
  /** Why, in the owner's words. Always at least one. */
  readonly reasons: readonly string[];
}

/**
 * Reads that cannot leave the worktree the agent was given.
 *
 * `Read` is on this list and takes an absolute path, which looks like a hole.
 * It is closed one layer up, not here: the run is launched with the worktree as
 * its only working directory and no `--add-dir`, so a path outside it is not a
 * file this tool may open — it is a permission prompt, and a permission prompt
 * arrives at the host below as an unclassified request and is refused.
 */
export const WORKTREE_READ_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'NotebookRead'];

/**
 * Writes that land in the throwaway worktree and nowhere else.
 *
 * Routine, and that is not a weakening: this is exactly the grant Forge has
 * always had. Every file the agent writes is enumerated by a read-only `git
 * status` at the end of the run and turned into an ordinary approval capsule
 * against the sandbox. The worktree itself is deleted either way.
 */
export const WORKTREE_WRITE_TOOLS: readonly string[] = ['Write', 'Edit', 'NotebookEdit'];

/**
 * Calls with no effect on anything outside the model's own turn — its todo
 * list, its plan — plus the two that only ever OBSERVE or STOP a command the
 * owner already approved. `KillShell` reduces an effect and can never start one;
 * `BashOutput` reads the output of a command that already cleared the gate.
 * Asking again for either would be asking about a decision already made.
 */
export const BOOKKEEPING_TOOLS: readonly string[] = ['TodoWrite', 'ExitPlanMode', 'BashOutput', 'KillShell'];

/** The one tool that starts a command on the owner's real machine. */
export const SHELL_TOOLS: readonly string[] = ['Bash'];

/** The tools whose whole purpose is to leave this machine. */
export const NETWORK_TOOLS: readonly string[] = ['WebFetch', 'WebSearch'];

/** The prefix the CLI gives every tool that comes from an MCP server. */
export const MCP_TOOL_PREFIX = 'mcp__';

/**
 * The MCP server name Forge's permission host is published under, and the tool
 * the CLI calls on it. `--permission-prompt-tool` takes the full dotted name.
 */
export const GATE_SERVER = 'zeno_gate';
/** The bare tool name the bridge publishes, before the CLI's server prefix. */
export const GATE_METHOD = 'request_permission';
export const GATE_TOOL = `${MCP_TOOL_PREFIX}${GATE_SERVER}__${GATE_METHOD}`;

/**
 * The MCP server name Zeno's OWN browser is published under, and its operations.
 *
 * WHY THIS IS DIFFERENT FROM EVERY OTHER MCP SERVER. The generic rule below
 * rates an MCP call as egress because "an MCP server is a process outside the
 * worktree that Zeno neither started nor bounds". That sentence is the reason
 * the browser is EMBEDDED rather than reached through an external driver: this
 * particular process Zeno spawns itself (`@abheet19/zeno-browse`), hands a fresh
 * in-memory session with no profile, jails to http(s), drives one operation at a
 * time and kills when the run ends. So it is not rated by the generic rule — it
 * is rated by what each operation actually does, which is strictly more precise
 * and, for `click` and `type`, strictly STRICTER.
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
 * Tools that are never available, whatever anyone approves.
 *
 * `Task` starts a SECOND agent. Forge's whole account of a run is "one agent,
 * one worktree, every escaping call attributed to one capsule the owner read" —
 * and Forge cannot demonstrate, from outside the CLI, that a subagent's calls
 * arrive at this same permission host. An unprovable claim about who is acting
 * is exactly the kind of claim this product exists not to make, so the subagent
 * stays off until it can be proved rather than assumed.
 *
 * `GATE_TOOL` is the permission host itself. The CLI's permission machinery
 * calls it; the MODEL must not be able to. Structurally the host is harmless in
 * the model's hands — it holds no owner authority and can only ever open a
 * capsule — but a model that can open capsules can also FABRICATE one, and an
 * owner reading "may I run npm test?" has no way to know no tool call is behind
 * it. Denying it keeps every capsule the owner sees attributable to a real call.
 *
 * `Task` and `Agent` are the SAME tool under two names: the CLI has carried both
 * across versions, and an unrecognised name in `--tools` is silently ignored
 * rather than refused — so a denial that named only one of them would quietly
 * stop covering the subagent the day the other name won. Both are listed, and
 * `classifyToolCall` refuses either. (The same silence is why naming a tool this
 * CLI version does not have costs nothing: the surface simply does not gain it.)
 */
export const NEVER_TOOLS: readonly string[] = ['Task', 'Agent', GATE_TOOL];

/**
 * Shapes of command that are not merely "running something".
 *
 * Deliberately few and legible, in the spirit of `SENSITIVE_PATHS`: a rule you
 * cannot hold in your head is a rule you cannot audit. Matching one raises the
 * capsule from `shell.exec` to `destructive`; matching none changes nothing
 * about whether the owner is asked.
 */
export const DESTRUCTIVE_SHELL: readonly RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, // rm -rf, rm -fr, rm -r -f
  /\b(rmdir|rd)\b.*\/s\b/i, // Windows recursive remove
  /\bdel\b.*\/[sq]\b/i,
  /\b(mkfs|format)\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot)\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd])/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
];

/**
 * The one place a command reaches back at Zeno itself.
 *
 * The ledger is the evidence; the signing key is what makes it evidence; the
 * proposer token and policy are what decide who may ask for what. A command
 * naming any of them is not an ordinary command, and it is rated `destructive`
 * so the capsule says so in the loudest words the tier model has. It is still
 * only a pattern — the real answer is that the owner sees the command.
 */
export const GOVERNANCE_SURFACE: readonly RegExp[] = [
  /\.zeno\b/i,
  /\bledger\.jsonl\b/i,
  /\bproposer\.token\b/i,
  /\bpolicy\.json\b/i,
  // A `keys` PATH SEGMENT — `ls keys/`, `.zeno\keys`, `cat keys` — and not the
  // ordinary word, so `Object.keys(x)` in a one-liner is left alone.
  /(^|[\s/\\'"])keys([/\\]|$|[\s'"])/i,
];

/** Pull one string field out of an unknown tool input, or '' when it is absent. */
function field(input: unknown, name: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const v = (input as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : '';
}

/** One line, bounded — a capsule summary is read, not scrolled. */
function oneLine(text: string, cap = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > cap ? flat.slice(0, cap) + '…' : flat;
}

/** True when a name is a tool published by some MCP server. */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
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

/**
 * Classify one tool call.
 *
 * FAIL CLOSED is the load-bearing property, and it is why the last branch is a
 * refusal rather than a default. A tool name this function has never heard of
 * is not "probably fine": it is a capability nobody has reasoned about, and the
 * CLI grows new tools on its own schedule. Rounding an unknown DOWN to routine
 * is the one mistake that cannot be recovered from a receipt, so the unknown
 * case rounds up to a refusal the owner can read and Forge can then widen
 * deliberately.
 */
export function classifyToolCall(toolName: string, input: unknown): ToolVerdict {
  const name = toolName.trim();

  if (name === '') {
    return {
      gate: 'refused',
      kind: 'read',
      dataZones: [],
      summary: 'A tool call arrived with no tool name.',
      reasons: ['a permission request that does not say which tool it is for cannot be classified'],
    };
  }

  // 1. The never-list, ahead of everything. No approval reaches these.
  if (NEVER_TOOLS.includes(name)) {
    const why =
      name === GATE_TOOL
        ? 'the approval host is not a tool the agent may call — every capsule the owner sees must come from a real tool call'
        : 'starting a second agent is not something this run can account for, so it is not available under either of its names';
    return {
      gate: 'refused',
      kind: 'read',
      dataZones: [],
      summary: `"${name}" is not available to a governed run.`,
      reasons: [why],
    };
  }

  // 2. Zeno's OWN browser, tiered by what the operation actually does. Ahead of
  //    the generic MCP rule below, which would flatten all five to one tier and
  //    describe none of them accurately.
  if (isBrowseTool(name)) {
    return classifyBrowseCall(name, input);
  }

  // 3. Anything reached through an MCP server. Zeno did not start that process,
  //    cannot bound what it does, and cannot see where it goes — so it is rated
  //    as egress, which is the strongest honest thing to say about it.
  if (isMcpTool(name)) {
    return {
      gate: 'governed',
      kind: 'net.fetch',
      dataZones: ['external'],
      summary: `Call the MCP tool "${name}".`,
      reasons: [
        'an MCP server is a process outside the worktree that Zeno neither started nor bounds',
        'what it reaches cannot be shown here, so it is rated as if it leaves the machine',
      ],
    };
  }

  // 4. Egress. Named before the shell rules because these tools do nothing else.
  if (NETWORK_TOOLS.includes(name)) {
    const where = field(input, 'url') || field(input, 'query') || field(input, 'prompt');
    return {
      gate: 'governed',
      kind: 'net.fetch',
      dataZones: ['external'],
      summary: where === '' ? `${name} — reaches the network.` : `${name}: ${oneLine(where)}`,
      reasons: [
        'this call leaves the machine; what goes out cannot be recalled by refusing the next one',
      ],
    };
  }

  // 5. A command on the owner's real machine. Escalation only ever goes UP, and
  //    the two escalating rules are checked before the ordinary one.
  if (SHELL_TOOLS.includes(name)) {
    const command = field(input, 'command');
    const shown = oneLine(command);
    const summary = command === '' ? 'Run a command (none given).' : `Run: ${shown}`;
    const base = 'a command runs on the real machine with everything this account can reach';

    if (GOVERNANCE_SURFACE.some((rx) => rx.test(command))) {
      return {
        gate: 'governed',
        kind: 'destructive',
        dataZones: ['personal'],
        summary,
        reasons: [base, 'it names Zeno’s own ledger, keys, token or policy — the evidence this run will be judged by'],
      };
    }
    if (DESTRUCTIVE_SHELL.some((rx) => rx.test(command))) {
      return {
        gate: 'governed',
        kind: 'destructive',
        dataZones: ['personal'],
        summary,
        reasons: [base, 'it has the shape of a command that deletes, overwrites or publishes rather than one that reads or builds'],
      };
    }
    return {
      gate: 'governed',
      kind: 'shell.exec',
      dataZones: ['personal'],
      summary,
      reasons: [base, 'no rule here recognised it as destructive — read the command itself, that is the check'],
    };
  }

  // 6. Inside the throwaway worktree. No decision, and no exception either: a
  //    write here still becomes an approval capsule before it reaches anything
  //    the owner keeps.
  if (WORKTREE_READ_TOOLS.includes(name)) {
    return {
      gate: 'routine',
      kind: 'read',
      dataZones: ['ephemeral'],
      summary: `${name} inside the run's worktree.`,
      reasons: ['reads inside the throwaway worktree change nothing and leave nothing'],
    };
  }
  if (WORKTREE_WRITE_TOOLS.includes(name)) {
    return {
      gate: 'routine',
      kind: 'local.write',
      dataZones: ['ephemeral'],
      summary: `${name} inside the run's worktree.`,
      reasons: [
        'the worktree is thrown away at the end of the run',
        'every file it holds still becomes an approval capsule before it reaches the sandbox',
      ],
    };
  }
  if (BOOKKEEPING_TOOLS.includes(name)) {
    return {
      gate: 'routine',
      kind: 'read',
      dataZones: ['ephemeral'],
      summary: `${name} — no effect outside the model's own turn.`,
      reasons: ['this call neither starts an effect nor lets one out of the worktree'],
    };
  }

  // 7. Unknown. Rounds UP, and says so.
  return {
    gate: 'refused',
    kind: 'read',
    dataZones: [],
    summary: `"${name}" is a tool Zeno has not classified.`,
    reasons: [
      'nobody has decided what this call can reach, and an unclassified capability is not a safe one',
      'if it should be available, add it to the surface in forge/src/tools.ts deliberately',
    ],
  };
}

/**
 * The built-in tool surface a governed run is given, as the CLI's `--tools`
 * takes it. A tool that is not on this list does not EXIST for the run, which is
 * a stronger statement than "it would be denied": there is no call to deny.
 *
 * `network` is a separate argument rather than a default because it is a
 * separate decision — see `runner.ts`, where it defaults to off.
 */
export function toolSurface(network: boolean, browser = false): readonly string[] {
  return [
    ...WORKTREE_READ_TOOLS,
    ...WORKTREE_WRITE_TOOLS,
    ...BOOKKEEPING_TOOLS,
    ...SHELL_TOOLS,
    ...(network ? NETWORK_TOOLS : []),
    ...(browser ? browseTools() : []),
  ];
}

/**
 * The subset that needs no permission prompt — the CLI's `--allowedTools`.
 *
 * Everything else in the surface falls through to the permission host, which is
 * the point: `Bash` is present and NOT here, so every command stops.
 *
 * Leaving a tool off this list is NECESSARY for it to reach the host, and — this
 * cost a live fail-open — it is not SUFFICIENT. See `alwaysAskTools`.
 */
export function preApprovedTools(): readonly string[] {
  return [...WORKTREE_READ_TOOLS, ...WORKTREE_WRITE_TOOLS, ...BOOKKEEPING_TOOLS];
}

/**
 * The tools that must reach the permission host on EVERY call, whatever anyone
 * else thinks of them — the CLI's `permissions.ask` setting.
 *
 * This exists because of a fail-open found by running the thing rather than by
 * reading it. Omitting `Bash` from `--allowedTools` looks like it makes every
 * command stop, and it does not: the CLI carries its own judgement about which
 * commands are harmless, and a command it rates read-only (`git log`, `ls`, a
 * plain `cat`) is auto-approved INSIDE the CLI and never offered to the
 * permission host at all. The bridge was up, the tool was registered, the host
 * was correct — and it was simply not asked. Zeno then reported a run in which a
 * command had really executed with no capsule, no click and no receipt.
 *
 * A defensible product cannot have a class of commands it silently does not see.
 * `permissions.ask` is the CLI's own way of saying "this tool always prompts",
 * and a prompt is exactly what routes to Forge's host. It is set for the shell
 * and the egress tools together: the same auto-approval reasoning would apply to
 * a fetch the CLI thought innocuous.
 *
 * Both network tools are named even when the run was not granted the network.
 * A tool that is not in `--tools` does not exist for the run, so asking for it
 * to always prompt costs nothing — and it means the ask-list cannot fall out of
 * step with the surface the day the network flag flips.
 *
 * THE BROWSER TOOLS ARE NAMED HERE FOR EXACTLY THE SAME REASON, and it is worth
 * being explicit that this is not belt-and-braces. `mcp__zeno_browse__read`
 * looks read-only from the outside, and the fail-open that cost a live run was
 * the CLI auto-approving the calls IT rated read-only before consulting the
 * permission host at all. An MCP tool is not exempt from that judgement — the
 * CLI has its own opinions about MCP servers too, and Zeno cannot see them. So
 * every browser operation is named, on every run, whether or not the browser was
 * granted. Same argument, same list, no exceptions for a tool Zeno happens to
 * own.
 */
export function alwaysAskTools(): readonly string[] {
  return [...SHELL_TOOLS, ...NETWORK_TOOLS, ...browseTools()];
}
