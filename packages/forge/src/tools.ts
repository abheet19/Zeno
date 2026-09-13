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
 *
 * THE SPLIT. This file is the dispatcher (`classifyToolCall`) plus the tool
 * groups it does not delegate elsewhere. Zeno's own browser and the owner's
 * signed-in Chrome are each tiered by a substantial set of rules of their own,
 * so those live in `browse-tools.ts` and `chrome-tools.ts`; the shell escalation
 * patterns live in `shell-risk.ts`; the shared `ToolVerdict` shape lives in
 * `tool-base.ts`; and the two string helpers every classifier needs live in
 * `tool-text.ts`. Every one of those is re-exported below unchanged, so nothing
 * that imports `./tools.js` — inside this package or in `@abheet19/zeno-forge`'s
 * consumers — needs to know the file split happened.
 */
import type { OriginPolicy } from '@abheet19/zeno-chrome';
import { MCP_TOOL_PREFIX, type ToolGate, type ToolVerdict } from './tool-base.js';
import { field, oneLine } from './tool-text.js';
import {
  BROWSE_ACT_METHODS,
  BROWSE_METHODS,
  BROWSE_NAV_METHODS,
  BROWSE_READ_METHODS,
  BROWSE_SERVER,
  browseToolName,
  browseTools,
  classifyBrowseCall,
  isBrowseTool,
} from './browse-tools.js';
import {
  CHROME_ACT_METHODS,
  CHROME_METHODS,
  CHROME_NAV_METHODS,
  CHROME_READ_METHODS,
  CHROME_SERVER,
  chromeToolName,
  chromeTools,
  classifyChromeCall,
  isChromeTool,
  NO_CHROME_ORIGINS,
} from './chrome-tools.js';
import { DESTRUCTIVE_SHELL, GOVERNANCE_SURFACE } from './shell-risk.js';

// Re-exported so every one of these stays importable from `./tools.js` exactly
// as before the split. See the file comment above for where each now lives.
export type { ToolGate, ToolVerdict };
export {
  BROWSE_ACT_METHODS,
  BROWSE_METHODS,
  BROWSE_NAV_METHODS,
  BROWSE_READ_METHODS,
  BROWSE_SERVER,
  browseToolName,
  browseTools,
  classifyBrowseCall,
  isBrowseTool,
};
export {
  CHROME_ACT_METHODS,
  CHROME_METHODS,
  CHROME_NAV_METHODS,
  CHROME_READ_METHODS,
  CHROME_SERVER,
  chromeToolName,
  chromeTools,
  classifyChromeCall,
  isChromeTool,
  NO_CHROME_ORIGINS,
};
export { DESTRUCTIVE_SHELL, GOVERNANCE_SURFACE };
export { MCP_TOOL_PREFIX };

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

/**
 * The MCP server name Forge's permission host is published under, and the tool
 * the CLI calls on it. `--permission-prompt-tool` takes the full dotted name.
 */
export const GATE_SERVER = 'zeno_gate';
/** The bare tool name the bridge publishes, before the CLI's server prefix. */
export const GATE_METHOD = 'request_permission';
export const GATE_TOOL = `${MCP_TOOL_PREFIX}${GATE_SERVER}__${GATE_METHOD}`;

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

/** True when a name is a tool published by some MCP server. */
export function isMcpTool(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
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
export function classifyToolCall(
  toolName: string,
  input: unknown,
  /**
   * The owner's Chrome allowlist, when the caller has one. Defaults to an EMPTY
   * one, which refuses every origin — a caller that forgets to thread the policy
   * through loses the capability and never gains one. See `NO_CHROME_ORIGINS`.
   */
  chromeOrigins: OriginPolicy = NO_CHROME_ORIGINS,
): ToolVerdict {
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

  // 2b. The owner's OWN, signed-in Chrome. Named separately from the sandboxed
  //     window on purpose and rated strictly above it at every rung — see
  //     `classifyChromeCall`, and `CHROME_SERVER` for why these are two
  //     namespaces and never one.
  if (isChromeTool(name)) {
    return classifyChromeCall(name, input, chromeOrigins);
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
export function toolSurface(network: boolean, browser = false, chrome = false): readonly string[] {
  return [
    ...WORKTREE_READ_TOOLS,
    ...WORKTREE_WRITE_TOOLS,
    ...BOOKKEEPING_TOOLS,
    ...SHELL_TOOLS,
    ...(network ? NETWORK_TOOLS : []),
    ...(browser ? browseTools() : []),
    // The owner's own Chrome, last, and its own separate decision. See
    // `runner.ts` — it defaults to off and has more conditions in front of it
    // than any other capability in this file.
    ...(chrome ? chromeTools() : []),
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
  // The Chrome tools are named on the same terms and with even less room for
  // argument: `mcp__zeno_chrome__read` is the single most read-only-LOOKING tool
  // in this whole surface and it reads the owner's authenticated pages. If the
  // CLI's own classifier ever decided that one for itself, the fail-open would
  // be an agent quietly reading a signed-in browser with no capsule at all.
  return [...SHELL_TOOLS, ...NETWORK_TOOLS, ...browseTools(), ...chromeTools()];
}
