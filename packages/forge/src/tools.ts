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
export const GATE_TOOL = `${MCP_TOOL_PREFIX}${GATE_SERVER}__request_permission`;

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
 */
export const NEVER_TOOLS: readonly string[] = ['Task', GATE_TOOL];

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
        : 'starting a second agent is not something this run can account for, so it is not available';
    return {
      gate: 'refused',
      kind: 'read',
      dataZones: [],
      summary: `"${name}" is not available to a governed run.`,
      reasons: [why],
    };
  }

  // 2. Anything reached through an MCP server. Zeno did not start that process,
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

  // 3. Egress. Named before the shell rules because these tools do nothing else.
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

  // 4. A command on the owner's real machine. Escalation only ever goes UP, and
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

  // 5. Inside the throwaway worktree. No decision, and no exception either: a
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

  // 6. Unknown. Rounds UP, and says so.
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
export function toolSurface(network: boolean): readonly string[] {
  return [
    ...WORKTREE_READ_TOOLS,
    ...WORKTREE_WRITE_TOOLS,
    ...BOOKKEEPING_TOOLS,
    ...SHELL_TOOLS,
    ...(network ? NETWORK_TOOLS : []),
  ];
}

/**
 * The subset that needs no permission prompt — the CLI's `--allowedTools`.
 *
 * Everything else in the surface falls through to the permission host, which is
 * the point: `Bash` is present and NOT here, so every command stops.
 */
export function preApprovedTools(): readonly string[] {
  return [...WORKTREE_READ_TOOLS, ...WORKTREE_WRITE_TOOLS, ...BOOKKEEPING_TOOLS];
}
