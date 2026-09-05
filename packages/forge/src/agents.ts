/**
 * The agent registry and the effort model — the pure catalogue the model/effort
 * picker reads, and the one place the two agent RUNGS are named.
 *
 * A "rung" is a way of turning a TASK into file edits inside the isolated
 * worktree. There are two, and the picker chooses between them:
 *
 *   claude-code — the real Claude Code CLI, run headless. It is an external
 *     BINARY dependency, exactly like git: named honestly here, spawned through
 *     an injected `Spawner` in `runner.ts` so nothing shells out in a test, and
 *     — when it is not on PATH — reported as missing with the local rung offered,
 *     never faked.
 *
 *   local — a placeholder for a local model runtime (Ollama). A documented seam
 *     and nothing more: it returns "not configured" until a runtime lands, and
 *     it never fabricates model output to look busy.
 *
 * Pure and dependency-free on purpose: no spawn, no fs, no PATH lookup. Deciding
 * *what could run* is separate from *running it*; this file only describes the
 * choices, and `runner.ts` carries one out.
 */

/** The two rungs. A closed union so the runner's dispatch is exhaustively checked. */
export type AgentId = 'claude-code' | 'local';

/**
 * How hard the agent is asked to think. Recorded on every run for the receipt;
 * whether it also reaches the agent's argv is the agent's own business — see
 * `supportsEffort`, which is honest about the fact that no rung has a real effort
 * flag yet.
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
 * `supportsEffort` is `false` for Claude Code and `true` for the local rung, and
 * both are truthful about today: the Claude Code CLI exposes no effort flag in
 * headless (`-p`) mode, while a local Qwen3 model has a real thinking budget the
 * daemon drives through Ollama's `think`. Effort is recorded on the run either
 * way. The field is the SEAM — when a rung gains a real effort
 * control, flipping this to `true` is what both offers it in the picker and lets
 * the runner pass it through (`runner.ts`, `agentArgv`).
 */
export const AGENTS: readonly Agent[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    models: ['opus', 'sonnet', 'haiku'],
    supportsEffort: false,
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
