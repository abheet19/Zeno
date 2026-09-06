/**
 * Zeno · Forge — the governed coding agent. Public surface.
 *
 * The shape of the whole package in one sentence: an agent PROPOSES by editing an
 * isolated worktree (`worktree.ts` makes the sandbox, `runner.ts` runs the agent
 * headless inside it and reads back the changed files), and the owner DISPOSES —
 * preview → approval → the kernel's jailed git executor. Nothing exported here
 * can commit; the most a run produces is a list of files for the gate.
 *
 *   agents.ts     — the two rungs (claude-code, local) and the effort model; what
 *                   the picker reads.
 *   tools.ts      — what a tool call can reach: routine inside the worktree,
 *                   governed when it can escape it, refused when nobody has
 *                   decided. Pure, in the manner of the kernel's risk rules.
 *   permission.ts — the permission host's brain. A tool call the CLI cannot
 *                   decide becomes a question for the owner. It has an `ask`
 *                   verb and no approve verb, which is L6 at the tool doorstep.
 *   permission-gate.ts
 *                 — that host wired to the real kernel: preview, hold, and say
 *                   yes only on the evidence of a verified receipt. It never
 *                   calls approve; an approval arrives as somebody else's
 *                   finished work or not at all.
 *   runner.ts     — the headless run, pure over an injected Spawner. Its result
 *                   is a proposal, never an effect.
 *   worktree.ts   — isolate the work in a throwaway git worktree, or refuse.
 *   status.ts     — the one parser both of the above use to read "what changed".
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
  BOOKKEEPING_TOOLS,
  DESTRUCTIVE_SHELL,
  GATE_SERVER,
  GATE_TOOL,
  GOVERNANCE_SURFACE,
  MCP_TOOL_PREFIX,
  NETWORK_TOOLS,
  NEVER_TOOLS,
  SHELL_TOOLS,
  WORKTREE_READ_TOOLS,
  WORKTREE_WRITE_TOOLS,
  classifyToolCall,
  isMcpTool,
  preApprovedTools,
  toolSurface,
  type ToolGate,
  type ToolVerdict,
} from './tools.js';
export {
  OUTSIDE_WORKTREE_DENIAL,
  decidePermission,
  parsePermissionRequest,
  permissionToolResult,
  type GateAnswer,
  type GovernedCall,
  type PermissionDecision,
  type PermissionGate,
  type PermissionRequest,
} from './permission.js';
export {
  GATE_ENV_RUN,
  GATE_ENV_TOKEN,
  GATE_ENV_URL,
  gateBridgePath,
  gateEnv,
  gateMcpConfig,
} from './gate-config.js';
export {
  AUTO_APPROVED_REFUSAL,
  TOOL_TARGET_PREFIX,
  kernelGate,
  toolPayload,
  toolTargetRef,
  type KernelGateOptions,
  type OwnerChannel,
  type OwnerVerdict,
} from './permission-gate.js';
export {
  CLAUDE_BINARY,
  LOCAL_NOT_CONFIGURED,
  SPAWN_FAILED,
  agentArgv,
  claudeToolFlags,
  runAgent,
  type GateWiring,
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
