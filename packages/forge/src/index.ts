/**
 * Zeno · Forge — the governed coding agent. Public surface.
 *
 * The shape of the whole package in one sentence: an agent PROPOSES by editing an
 * isolated worktree (`worktree.ts` makes the sandbox, `runner.ts` runs the agent
 * headless inside it and reads back the changed files), and the owner DISPOSES —
 * preview → approval → the kernel's jailed git executor. Nothing exported here
 * can commit; the most a run produces is a list of files for the gate.
 *
 *   agents.ts   — the two rungs (claude-code, local) and the effort model; what
 *                 the picker reads.
 *   runner.ts   — the headless run, pure over an injected Spawner. Its result is
 *                 a proposal, never an effect.
 *   worktree.ts — isolate the work in a throwaway git worktree, or refuse.
 *   status.ts   — the one parser both of the above use to read "what changed".
 *
 * The node adapters (`runner-node.ts`) are the real edges; the kernel already
 * ships the real git edge (`nodeGitRunner`), so `worktree.ts` needs none of its own.
 */
export {
  AGENTS,
  EFFORTS,
  UnknownAgentError,
  chooseAgent,
  isEffort,
  type Agent,
  type AgentId,
  type Effort,
} from './agents.js';
export { STATUS_ARGS, parsePorcelainZ } from './status.js';
export {
  CLAUDE_BINARY,
  LOCAL_NOT_CONFIGURED,
  SPAWN_FAILED,
  agentArgv,
  runAgent,
  type RunResult,
  type RunSpec,
  type SpawnOptions,
  type SpawnResult,
  type Spawner,
} from './runner.js';
export { nodeSpawner, type NodeSpawnerOptions } from './runner-node.js';
export {
  WORKTREE_NAMESPACE,
  WorktreeCleanupError,
  WorktreeUnavailableError,
  createWorktree,
  diffFiles,
  type CreateWorktreeOptions,
  type Worktree,
} from './worktree.js';
