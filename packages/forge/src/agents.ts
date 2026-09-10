/**
 * The agent registry and the effort model — the pure catalogue the model/effort
 * picker reads, and the one place the three agent RUNGS are named.
 *
 * A "rung" is a way of turning a TASK into file edits inside the isolated
 * worktree. There are three, and the picker chooses between them:
 *
 *   claude-code — the real Claude Code CLI, run headless. It is an external
 *     BINARY dependency, exactly like git: named honestly here, spawned through
 *     an injected `Spawner` in `runner.ts` so nothing shells out in a test, and
 *     — when it is not on PATH — reported as missing with the local rung offered,
 *     never faked.
 *
 *   codex — the installed Codex CLI in ephemeral, non-interactive mode. Forge
 *     gives it only the throwaway worktree through Codex's auto-reviewed
 *     workspace-write mode and ignores ambient Codex configuration. The CLI may still discover global Agent Skills and reports that discovery in its run log. Commands inside
 *     that disposable worktree are reviewed by Codex; the files still reach
 *     the selected repository only through Zeno's ordinary proposal gate.
 *
 *   local — the daemon-backed Ollama runtime. The registry deliberately keeps
 *     its model list empty because `/forge/agents` discovers the models Ollama
 *     has installed at request time. The daemon executes the selected model on
 *     loopback, parses its bounded answer/file envelope, and never fabricates
 *     output when the runtime or model is unavailable.
 *
 * Pure and dependency-free on purpose: no spawn, no fs, no PATH lookup. Deciding
 * *what could run* is separate from *running it*; this file only describes the
 * choices. `runner.ts` carries out the hosted CLI rungs; the daemon carries out
 * the loopback Ollama rung.
 */

/** The three rungs. A closed union so the runner's dispatch is exhaustively checked. */
export type AgentId = 'claude-code' | 'codex' | 'local';

/**
 * How hard the agent is asked to think. Recorded on every run for the receipt;
 * whether it also reaches the agent's argv is the agent's own business — see
 * `supportsEffort`, which is honest about whether the selected runtime has a
 * real effort control.
 */
export type Effort = 'low' | 'medium' | 'high';

/** The effort levels, low → high, in order. */
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high'];

/** Narrow an untrusted string (a UI selection, a stored value) to an `Effort`. */
export function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

/**
 * One selectable agent. `models` is the set of `--model` choices the picker may
 * offer for this rung; an empty list means "this rung has no model to choose".
 * `supportsEffort` tells the picker whether to show an effort control at all —
 * it does not, by itself, put effort on the command line (that is the runner's
 * decision, and it declines to invent a flag no real CLI accepts).
 */
export interface Agent {
  readonly id: AgentId;
  readonly label: string;
  readonly models: readonly string[];
  readonly supportsEffort: boolean;
}

/**
 * The catalogue.
 *
 * `claude-code`'s models are the CLI's stable FAMILY aliases, not pinned
 * version ids: the `--model` flag accepts them, and pinning a dated id here is a
 * thing that goes stale and lies. An empty `model` on a run means "let the CLI
 * use its own configured default", which is why the runner omits `--model`
 * rather than guessing one.
 *
 * All three current rungs support effort. Claude Code accepts `--effort` in
 * headless (`-p`) mode, Codex accepts `model_reasoning_effort`, and the local
 * Qwen3 rung maps low to no extended thinking and higher levels to its Ollama
 * thinking path. The field remains the capability seam so a future agent cannot
 * accidentally receive an option it does not implement.
 */
export const AGENTS: readonly Agent[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    models: ['opus', 'sonnet', 'haiku'],
    supportsEffort: true,
  },
  {
    id: 'codex',
    label: 'Codex',
    // Current aliases exposed by the installed Codex host. Leaving the picker
    // on its blank default still lets a newer CLI choose its configured model.
    models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    supportsEffort: true,
  },
  {
    id: 'local',
    label: 'Local model (Ollama)',
    models: [],
    // TRUE, and load-bearing. A Qwen3-class model is a THINKING model, and the
    // daemon maps effort straight onto Ollama's `think`: low disables reasoning
    // for a fast answer, medium and high let it reason before it replies. Saying
    // false here greyed the effort control out in Forge, so a real, working dial
    // looked broken — the registry was still describing an older build in which
    // the local rung ran nothing at all.
    supportsEffort: true,
  },
];

/**
 * Raised when a caller asks for an agent id the registry does not hold. It is a
 * caller BUG — the picker only ever offers ids from `AGENTS` — so the runner
 * lets it throw loudly rather than folding it into an ordinary "the run did not
 * succeed" result, which is reserved for real environmental facts (a missing
 * binary, an unconfigured runtime).
 */
export class UnknownAgentError extends Error {
  /** The id that was asked for and not found. */
  readonly id: string;

  constructor(id: string) {
    const known = AGENTS.map((a) => a.id).join(', ');
    super(`Unknown agent "${id}". Known agents: ${known}.`);
    this.name = 'UnknownAgentError';
    this.id = id;
  }
}

/** Resolve an agent id to its `Agent`, or throw `UnknownAgentError` legibly. */
export function chooseAgent(id: string): Agent {
  const agent = AGENTS.find((a) => a.id === id);
  if (agent === undefined) throw new UnknownAgentError(id);
  return agent;
}
