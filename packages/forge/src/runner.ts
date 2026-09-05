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
}

/**
 * The process boundary as one injectable function. Synchronous and total: a
 * missing binary, a crash or a refused argument all come back as a `SpawnResult`
 * (with `failedToSpawn: true`), never as a thrown error.
 */
export interface Spawner {
  run(command: string, args: readonly string[], opts: SpawnOptions): SpawnResult;
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
  // Let it actually EDIT. Headless claude will not touch the filesystem without
  // being told which tools it may use, so without this it answered in prose and
  // changed nothing — a coding agent that cannot write is not one. The grant is
  // deliberately NARROW: read, write and search inside the worktree it was given.
  // Bash is NOT granted; this agent proposes file changes, it does not run
  // commands. And the grant is safe because the worktree is a throwaway — every
  // file it writes still returns as an approval capsule the owner must accept.
  if (agent.id === 'claude-code') {
    argv.push('--allowedTools', 'Read,Write,Edit,Glob,Grep');
  }
  // End-of-options: the task is a positional PROMPT after this, never a flag.
  argv.push('--', spec.task);
  return argv;
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
export function runAgent(spec: RunSpec, spawner: Spawner): RunResult {
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
  const run = spawner.run(CLAUDE_BINARY, agentArgv(agent, spec), { cwd: spec.worktree });
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
  const status = spawner.run('git', [...STATUS_ARGS], { cwd: spec.worktree });
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
