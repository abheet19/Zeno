/**
 * The headless run — turn a TASK into a set of changed files for the gate, and
 * nothing more.
 *
 * The safety line this file must never cross: it PROPOSES. It runs the chosen
 * agent inside the isolated worktree it is handed, then reads back what changed.
 * It has no commit verb, no push verb, no path to the real branch — the only git
 * it ever runs is a read-only `status`. Everything it produces is a `RunResult`
 * whose payload is a list of `changedFiles`; landing any of them is a separate,
 * owner-driven act (preview → approval → the kernel's jailed git executor).
 *
 * Pure over an injected `Spawner`: the process boundary arrives as one function,
 * so a test drives a full run — agent invocation AND the post-flight status read
 * — with an in-memory double, and asserts over every command that was spawned.
 * The real spawner lives in `runner-node.ts`. Using the SAME spawner for git as
 * for the agent is deliberate: the whole run then depends on exactly one
 * injected side-effect, and the safety test can prove, over the complete record
 * of spawned commands, that no mutation ever occurred.
 */
import { chooseAgent, type Agent, type AgentId, type Effort } from './agents.js';
import { STATUS_ARGS, parsePorcelainZ } from './status.js';
import {
  GATE_TOOL,
  NEVER_TOOLS,
  WORKTREE_READ_TOOLS,
  WORKTREE_WRITE_TOOLS,
  alwaysAskTools,
  preApprovedTools,
  toolSurface,
} from './tools.js';

/** What the injected spawner reports for one process. It never throws. */
export interface SpawnResult {
  /**
   * Process exit code. Meaningful ONLY when `failedToSpawn` is false; when the
   * process never ran to a normal exit this carries the `SPAWN_FAILED` sentinel,
   * which is not to be read as a real exit status.
   */
  readonly code: number;
  /**
   * True when the command never ran to a normal exit — the binary was missing
   * (ENOENT), not executable (EACCES), killed by the timeout, or refused by
   * `spawnSync` itself (a NUL-byte argument). The one honest way to tell "the
   * binary could not be run" apart from "a binary ran and happened to exit 127":
   * a real process is free to use 127 as its own exit code, so the code alone
   * cannot carry this fact without lying.
   */
  readonly failedToSpawn: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Options for one spawn. `cwd` is the worktree the process runs inside. */
export interface SpawnOptions {
  readonly cwd: string;
  /** Hard ceiling for this one invocation, in milliseconds. Adapter default otherwise. */
  readonly timeoutMs?: number;
  /**
   * Extra environment for the child, layered over the parent's.
   *
   * It exists for exactly one thing: handing the agent process the run-scoped
   * credential its permission host presents when it asks the owner a question.
   * That credential travels in the ENVIRONMENT rather than on the command line
   * or in a config file, because argv is world-readable in a process listing and
   * a config file inside the worktree is a file the agent can read.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The process boundary as one injectable function. ASYNCHRONOUS and total: a
 * missing binary, a crash or a refused argument all come back as a `SpawnResult`
 * (with `failedToSpawn: true`), never as a thrown error.
 *
 * Async is not a style choice, it is the thing that makes a governed run
 * possible at all. A run now asks the owner questions WHILE it runs — every
 * command the agent wants to execute becomes a capsule the owner clicks — and
 * the process that must serve that click is the same one that started the
 * agent. A blocking spawn holds that process for the length of the run, so the
 * agent would wait on an answer from a daemon that cannot answer until the agent
 * finishes. The gate would deadlock on itself.
 */
export interface Spawner {
  run(command: string, args: readonly string[], opts: SpawnOptions): Promise<SpawnResult>;
}

/**
 * The sentinel `code` the adapter parks in `SpawnResult.code` when a process
 * `failedToSpawn` — there is no real exit status to report. Callers decide on the
 * `failedToSpawn` flag, never on this number, precisely because a real process
 * may also exit 127; it survives only as a legible placeholder.
 */
export const SPAWN_FAILED = 127;

/** The program name for the claude-code rung. An external dependency, named honestly. */
export const CLAUDE_BINARY = 'claude';

/** What the local rung reports until a model runtime is wired in. */
export const LOCAL_NOT_CONFIGURED = 'local model runtime not configured';

/**
 * How a run reaches the kernel for the calls that can escape its worktree.
 *
 * Its PRESENCE is what widens the tool surface. Without it a run gets the
 * file-only grant Forge has always had and anything that would prompt is denied
 * outright; with it the run gets Bash — and every command stops at a capsule.
 * There is deliberately no way to widen the surface without also naming the host
 * that governs it, because "more tools" and "a gate on them" must not be two
 * settings that can drift apart.
 */
export interface GateWiring {
  /**
   * The `--mcp-config` value publishing Forge's permission host: a path to a
   * JSON file, or the JSON itself. Forge constructs it; it never comes from the
   * task.
   */
  readonly mcpConfig: string;
  /**
   * Grant the network-egress tools for this run. Defaults to FALSE — see the
   * README's "what can reach the internet". Even when true every call is still
   * governed one at a time; this only decides whether the tools exist.
   */
  readonly network?: boolean;
  /**
   * Publish Zeno's own browser to this run. Defaults to FALSE, and there are
   * two gates in front of it rather than one: the network must be on (a
   * navigation IS egress, and is rated exactly as `WebFetch` is), and the
   * browser subsystem must have PROVED itself live before the agent started —
   * see `@abheet19/zeno-browse`'s probe. When it is false the browser tools are
   * absent from `--tools` entirely, which is a stronger statement than "they
   * would be denied": there is no call to deny.
   */
  readonly browser?: boolean;
  /**
   * Publish the OWNER'S OWN, SIGNED-IN CHROME to this run. Defaults to FALSE and
   * has MORE conditions in front of it than any other capability in this file,
   * because it is the only one that can act AS THE OWNER:
   *
   *   · the owner switched it on deliberately (`ZENO_FORGE_CHROME=1`);
   *   · the extension they installed in their own browser PROVED itself live
   *     before the agent started;
   *   · and every operation is still refused unless its origin is on the
   *     allowlist they set themselves, and off Zeno's never-list.
   *
   * Deliberately NOT gated behind `network`, unlike `browser`. That gate exists
   * because a sandboxed navigation is exactly the egress `ZENO_FORGE_NETWORK`
   * governs; these operations are not rated as egress at all but as acting as
   * the owner, and folding them into the network switch would mean a run that
   * wanted to fetch a URL had quietly asked for a signed-in browser too. Two
   * different questions, two different switches.
   */
  readonly chrome?: boolean;
}

/** What one run needs: which agent, an optional model/effort, the task, the worktree. */
export interface RunSpec {
  readonly agentId: string;
  readonly model?: string;
  readonly effort?: Effort;
  /** The instruction for the agent. Passed as a SINGLE argv element behind an
   * end-of-options `--`, so it is neither a shell string nor a CLI flag. */
  readonly task: string;
  /** Absolute path to the isolated worktree the agent runs inside. */
  readonly worktree: string;
  /** The kernel-backed permission host. Omit it and the run stays file-only. */
  readonly gate?: GateWiring;
  /** Environment handed to the agent process — the run-scoped gate credential. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * The outcome of one run. It is a PROPOSAL: `changedFiles` is what the agent
 * wrote in the worktree, for the owner to review and approve. There is,
 * deliberately, no field here that could carry a committed effect — a run cannot
 * express "I landed this".
 */
export interface RunResult {
  /** True only when the agent exited cleanly AND its changes could be enumerated. */
  readonly ok: boolean;
  /** The resolved agent that ran (or was asked to). */
  readonly agentId: AgentId;
  /** The model passed, or null when none was (the CLI used its own default). */
  readonly model: string | null;
  /** The effort recorded for this run, or null. */
  readonly effort: Effort | null;
  /** Worktree-relative paths the agent changed, sorted. Empty is a valid result. */
  readonly changedFiles: readonly string[];
  /** The agent's combined stdout/stderr — the observable log of what it did. */
  readonly log: string;
  /** Present only when `ok` is false: the one plain reason, and what to do about it. */
  readonly note?: string;
}

/**
 * Build the agent's argv. The task is ALWAYS the LAST element and always sits
 * behind an end-of-options `--`, so it is inert data to the agent on two fronts:
 *
 *   SHELL — a task containing `;`, `|`, `$(…)`, backticks or a newline is one
 *     argv element, never spliced into a shell string; the node adapter runs
 *     `shell: false` on top of that.
 *
 *   OPTIONS — the CLI takes the prompt as a POSITIONAL argument (`-p` is a bare
 *     print flag, not an option that swallows a value), so a task that begins
 *     with a dash — `--add-dir /`, `--allow-dangerously-skip-permissions`,
 *     `--mcp-config …` — would otherwise be parsed as REAL OPTIONS: reaching
 *     outside the worktree, or switching off the permission gate this product
 *     exists to be. The `--` marks end-of-options, so everything after it is the
 *     prompt and can inject no flag. This is the argv analogue of `shell: false`.
 *
 * `--model`/`--effort` are placed BEFORE the `--`: they are option-valued flags
 * that bind their own following token, so a dash-shaped value is consumed as the
 * value (a bogus model or effort the CLI rejects) and can never become a flag of
 * its own. `--model` is added only for a non-empty model — an empty one means
 * "the CLI's own default". `--effort` is added only for an agent that DECLARES
 * `supportsEffort` — no real rung does yet, so it is never sent to the live CLI;
 * the branch is the seam a future effort-capable rung switches on.
 */
export function agentArgv(agent: Agent, spec: RunSpec): string[] {
  const argv = ['-p'];
  const model = spec.model?.trim();
  if (model !== undefined && model !== '') argv.push('--model', model);
  if (agent.supportsEffort && spec.effort !== undefined) argv.push('--effort', spec.effort);
  if (agent.id === 'claude-code') argv.push(...claudeToolFlags(spec.gate));
  // End-of-options: the task is a positional PROMPT after this, never a flag.
  argv.push('--', spec.task);
  return argv;
}

/** A tool list as the CLI's variadic flags take it: ONE comma-joined element. */
function joined(tools: readonly string[]): string {
  return tools.join(',');
}

/**
 * The tool-surface flags, in the order they are safe to emit.
 *
 * Every one of them is built HERE, out of constants in this package. Not one is
 * derived from the task, the model name or anything else a caller supplies, so
 * the `--` guard below is not the only thing standing between an untrusted
 * string and a real option — there is nothing upstream of these flags to inject
 * into.
 *
 * ORDER MATTERS, and for a reason worth stating: `--tools`, `--allowedTools`,
 * `--disallowedTools` and `--mcp-config` are all VARIADIC in the CLI, so each
 * one keeps swallowing argv elements until it meets something that looks like
 * an option. Every value is therefore a single comma-joined token, and the LAST
 * flag emitted is the boolean `--strict-mcp-config` — so the element sitting
 * immediately before the end-of-options `--` can never be a variadic still
 * looking for more. The `--` would stop them anyway; this means it does not have
 * to be the only thing that does.
 *
 * WITHOUT A GATE, the surface is the file-only one Forge has always had, and
 * `--permission-prompts none` now states in the argv what used to be true only
 * by geometry: nothing may prompt, so nothing can be granted mid-run. That is
 * strictly tighter than the old invocation, which left the CLI's default host
 * behaviour in play and relied on the tool list alone.
 *
 * WITH A GATE, the surface widens to include Bash — and every call that could
 * escape the worktree is routed to Forge's own permission host, which turns it
 * into an approval capsule. The two things move together on purpose: there is
 * no argument shape in which the tools widen and the gate does not appear.
 *
 * THE BROWSER, when it is granted, arrives as MCP tools on the SAME
 * `--mcp-config` that publishes the permission host — one flag, one document,
 * two servers — so it is governed by the ordinary MCP path rather than by a
 * second mechanism. Its tools are in `--tools` and deliberately not in
 * `--allowedTools`, and they are additionally named in `permissions.ask`, for
 * the reason `alwaysAskTools` sets out at length: leaving a tool out of the
 * pre-approved list is necessary and NOT sufficient.
 *
 * What is NEVER emitted, at any setting: `--allow-dangerously-skip-permissions`,
 * `--dangerously-skip-permissions`, `--permission-mode bypassPermissions` and
 * `--add-dir`. The first three switch off the thing this product is; the last
 * hands the file tools a second root outside the worktree.
 */
export function claudeToolFlags(gate: GateWiring | undefined): string[] {
  if (gate === undefined) {
    const fileOnly = [...WORKTREE_READ_TOOLS, ...WORKTREE_WRITE_TOOLS];
    return [
      // No ambient settings file joins a run — see the gated branch below, where
      // the same flag is load-bearing. Here it costs nothing and closes the same
      // door: a `hooks` block in a settings file the CLI happened to find runs
      // commands of its own, and a run that is meant to be file-only must not
      // acquire a shell by way of somebody's configuration.
      '--setting-sources', '',
      // The surface a tool may be drawn from. A tool absent here does not exist
      // for this run, which is a stronger statement than "it would be refused".
      '--tools', joined(fileOnly),
      // …and every one of them is pre-granted, because a write in a throwaway
      // worktree is not a decision: it becomes an approval capsule afterwards.
      '--allowedTools', joined(fileOnly),
      // Nobody is listening, so nothing may ask. Anything that would prompt is
      // denied automatically rather than left to a default.
      '--permission-prompts', 'none',
      // No ambient MCP server joins a run. With no --mcp-config, this is "none".
      '--strict-mcp-config',
    ];
  }
  const network = gate.network === true;
  // The browser rides on the network grant and never past it. A caller that
  // asked for a browser without the network gets no browser, decided here in one
  // place rather than trusted to every caller — the whole point of the tool is a
  // page fetch, and a page fetch is egress.
  const browser = network && gate.browser === true;
  // The owner's own Chrome stands on its own switch — see `GateWiring.chrome`.
  const chrome = gate.chrome === true;
  return [
    // NO AMBIENT SETTINGS. The CLI loads user, project and local settings files
    // by default, and those files can carry `permissions.allow` (which
    // pre-grants a tool without asking anyone) and `hooks` (which run commands
    // outright). Either would let a run's real permissions be decided by a file
    // on the machine rather than by this argv. An empty source list means the
    // only settings in force are the ones on the next line.
    '--setting-sources', '',
    // …and those settings exist to say ONE thing: these tools always prompt.
    // Leaving Bash out of --allowedTools is not enough on its own, because the
    // CLI auto-approves commands its own classifier rates read-only and never
    // asks the host about them. See `alwaysAskTools` for the full account.
    '--settings', JSON.stringify({ permissions: { ask: [...alwaysAskTools()] } }),
    // Permission decisions are delegated to a host — Zeno — instead of being
    // auto-denied, and the host is named as a specific MCP tool.
    '--permission-prompts', 'host',
    '--permission-prompt-tool', GATE_TOOL,
    '--mcp-config', gate.mcpConfig,
    '--tools', joined(toolSurface(network, browser, chrome)),
    // The pre-granted subset. Bash is in the surface and deliberately NOT here,
    // which is what makes every command stop at the host.
    '--allowedTools', joined(preApprovedTools()),
    // Off entirely, at any approval: the subagent tool, and the permission host
    // itself — see NEVER_TOOLS for why each one.
    '--disallowedTools', joined(NEVER_TOOLS),
    // Only the host published above. No MCP server the machine happens to have
    // configured joins a governed run.
    '--strict-mcp-config',
  ];
}

/** Combine the two streams into one readable log, dropping an empty one. */
function mergeStreams(r: SpawnResult): string {
  return [r.stdout, r.stderr].filter((s) => s !== '').join('\n');
}

/** git's own words, one line, bounded — for a `note`. */
function detail(r: SpawnResult): string {
  return (r.stderr.trim() || r.stdout.trim()).replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Run the chosen agent headless in the worktree and report what it changed.
 *
 * An unknown agent id THROWS (`UnknownAgentError`) — that is a caller bug, not a
 * run outcome. Every real environmental failure DEGRADES to `ok: false` with a
 * `note`: a missing agent binary names it and offers the local rung; the local
 * rung says it is not configured; a failed post-flight status says the changes
 * could not be enumerated. In none of these does the function crash, and in none
 * does it invent a success.
 */
export async function runAgent(spec: RunSpec, spawner: Spawner): Promise<RunResult> {
  const agent = chooseAgent(spec.agentId);
  const trimmedModel = spec.model?.trim();
  const model = trimmedModel !== undefined && trimmedModel !== '' ? trimmedModel : null;
  const effort: Effort | null = spec.effort ?? null;
  const base = { agentId: agent.id, model, effort } as const;

  // The local rung is a documented seam, not a runtime. It never spawns.
  if (agent.id === 'local') {
    return { ...base, ok: false, changedFiles: [], log: '', note: LOCAL_NOT_CONFIGURED };
  }

  // claude-code: run the CLI headless inside the worktree. Branch on
  // `failedToSpawn`, never on the exit code: a claude that ran and happened to
  // exit 127 is a FAILED RUN whose changeset we still enumerate below, not a
  // missing binary. Reading the sentinel off `code` would fabricate the latter
  // from the former and silently drop the files that run left behind.
  const run = await spawner.run(CLAUDE_BINARY, agentArgv(agent, spec), {
    cwd: spec.worktree,
    ...(spec.env ? { env: spec.env } : {}),
  });
  const log = mergeStreams(run);
  if (run.failedToSpawn) {
    return {
      ...base,
      ok: false,
      changedFiles: [],
      log,
      // The specific cause (ENOENT vs EACCES vs a timeout kill) is in `log`; the
      // note states only what is certain — it never ran — and offers the rung
      // that needs no external binary.
      note: `the ${CLAUDE_BINARY} CLI could not be run — ensure it is installed and runnable, or choose the local rung`,
    };
  }

  // The agent ran (cleanly or not). Enumerate what it changed for the gate,
  // through the SAME spawner and with a READ-ONLY git verb only.
  const status = await spawner.run('git', [...STATUS_ARGS], { cwd: spec.worktree });
  if (status.failedToSpawn) {
    return {
      ...base,
      ok: false,
      changedFiles: [],
      log,
      note: 'git could not be run, so the worktree changes could not be enumerated for review',
    };
  }
  if (status.code !== 0) {
    return {
      ...base,
      ok: false,
      changedFiles: [],
      log,
      note: `git status failed in the worktree — ${detail(status)}`,
    };
  }

  const changedFiles = parsePorcelainZ(status.stdout);
  // A clean exit AND a readable changeset is the only path to ok:true.
  if (run.code === 0) {
    return { ...base, ok: true, changedFiles, log };
  }
  // The agent failed but we could still read what it left behind — hand the
  // changeset to the gate anyway, but say the run did not succeed.
  return {
    ...base,
    ok: false,
    changedFiles,
    log,
    note: `${agent.label} exited with code ${run.code}`,
  };
}
