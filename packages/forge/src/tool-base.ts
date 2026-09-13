/**
 * The shared vocabulary every tool classifier in this package returns.
 *
 * Split out of `tools.ts` so `browse-tools.ts` and `chrome-tools.ts` can both
 * produce a `ToolVerdict` without importing the whole dispatcher — this is the
 * leaf every other module in the split depends on, and it depends on nothing
 * of its own beyond the kernel's own vocabulary.
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

/** The prefix the CLI gives every tool that comes from an MCP server. */
export const MCP_TOOL_PREFIX = 'mcp__';
