/**
 * The permission host — the seam where a tool call the agent wants to make
 * becomes a question the owner answers.
 *
 * Headless Claude Code, run with `--permission-prompts host`, does not
 * auto-deny the calls it cannot decide for itself: it asks a host. This module
 * is that host's brain. It is deliberately pure — a request in, a decision out,
 * over an injected `PermissionGate` — so the whole protocol is exercised in
 * memory and nothing here can ever be the thing that quietly says yes.
 *
 * Three properties this file exists to hold:
 *
 *   IT CANNOT APPROVE. There is no approve verb in `PermissionGate`, only
 *     `ask`. The answer comes from somewhere this module cannot reach: the
 *     daemon, over the owner's own channel, from a click. That is L6 drawn one
 *     more time, at the tool-call doorstep — the same line the MCP edge draws by
 *     having no `zeno.approve` method.
 *
 *   AN ALLOW ECHOES THE INPUT IT WAS SHOWN. `updatedInput` is what the CLI
 *     actually runs, and the protocol lets a host REWRITE it. Forge never does.
 *     The owner approved a specific command; handing back a different one would
 *     make the capsule they read a description of something else. The echo is
 *     asserted in the tests, not merely intended.
 *
 *   REACHING THIS HOST IS ITSELF EVIDENCE. A file tool classified `routine` is
 *     routine BECAUSE it cannot leave the worktree. If such a call arrives here,
 *     the CLI has decided it needs permission — which means the geometry that
 *     made it routine did not hold for this call. So it is refused rather than
 *     rubber-stamped. The agent that genuinely needs something outside its
 *     worktree can ask for it as a command, where the owner reads the literal
 *     string.
 */
import { classifyToolCall, type ToolVerdict } from './tools.js';

/** One permission question, as the CLI poses it. */
export interface PermissionRequest {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The CLI's id for the call being decided, when it supplied one. */
  readonly toolUseId: string | null;
}

/**
 * The answer the CLI expects back. `allow` carries the input the call will
 * actually run with; `deny` carries a sentence the model is shown, which is why
 * the refusals below say what to do instead rather than only saying no.
 */
export type PermissionDecision =
  | { readonly behavior: 'allow'; readonly updatedInput: Readonly<Record<string, unknown>> }
  | { readonly behavior: 'deny'; readonly message: string };

/** One governed call, on its way to the owner. */
export interface GovernedCall {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * The CLI's id for THIS call, or null when it sent none.
   *
   * It is part of what the owner approves, and that is not bookkeeping. A
   * kernel action is content-addressed: without something that distinguishes one
   * call from the next, `npm test` run twice in a run would be the SAME action,
   * the second attempt would collide with the first one's spent approval, and a
   * perfectly ordinary command would become permanently un-runnable. Two runs of
   * a command are two events, and each deserves its own decision, its own single
   * attempt and its own receipt.
   */
  readonly callId: string | null;
  /** What the classifier said — the kind, zones and sentence the capsule is built from. */
  readonly verdict: ToolVerdict;
}

/** What came back from the owner's channel. */
export interface GateAnswer {
  readonly allowed: boolean;
  /** Why, in words the model is shown when the answer is no. */
  readonly reason: string;
  /** The receipt this grant was written into, when there is one. */
  readonly receiptId: string | null;
}

/**
 * The one thing a permission host may do: ASK.
 *
 * There is no `approve`, and the omission is the design. An implementation of
 * this port carries a run-scoped credential that the approval route rejects, so
 * the strongest thing it can cause is a capsule appearing in the owner's queue.
 */
export interface PermissionGate {
  ask(call: GovernedCall): Promise<GateAnswer>;
}

/**
 * Read the CLI's parameters into a request, or return null.
 *
 * Null means "this could not be understood", and every caller turns that into a
 * DENIAL. A permission host that guessed at a malformed request would be
 * guessing about the one question it exists to answer carefully.
 */
export function parsePermissionRequest(params: unknown): PermissionRequest | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  // The CLI sends `tool_name`; accept `toolName` too, because a protocol that
  // renames a field should cost a denial, not a silent misread of a different one.
  const rawName = p['tool_name'] ?? p['toolName'];
  if (typeof rawName !== 'string' || rawName.trim() === '') return null;
  const rawInput = p['input'] ?? p['tool_input'];
  const input =
    typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};
  const rawId = p['tool_use_id'] ?? p['toolUseId'];
  return {
    toolName: rawName.trim(),
    input,
    toolUseId: typeof rawId === 'string' && rawId !== '' ? rawId : null,
  };
}

/** A denial that names the reason and, where there is one, the honest alternative. */
function deny(message: string): PermissionDecision {
  return { behavior: 'deny', message };
}

/**
 * What is said when a file tool arrives here at all.
 *
 * Kept as a constant because it is asserted by the test that proves the
 * escape-hatch is closed, and a message the test writes for itself proves
 * nothing about the message an agent is shown.
 */
export const OUTSIDE_WORKTREE_DENIAL =
  'This run is confined to its throwaway worktree, and this call asked for permission — which means ' +
  'it is not an ordinary edit inside it. Work inside the worktree, or ask for what you need as a ' +
  'command: a command is shown to the owner in full and can be approved once.';

/**
 * Decide one permission request.
 *
 * The order is the safety order. Everything that can end in a refusal is
 * settled before anything is put in front of a human, so the owner is only ever
 * interrupted by a call that could actually be allowed.
 */
export async function decidePermission(
  params: unknown,
  gate: PermissionGate,
): Promise<PermissionDecision> {
  const req = parsePermissionRequest(params);
  if (req === null) {
    return deny(
      'Zeno could not read that permission request — it named no tool. Nothing was run, and nothing was ' +
        'asked of the owner.',
    );
  }

  const verdict = classifyToolCall(req.toolName, req.input);

  if (verdict.gate === 'refused') {
    return deny(`${verdict.summary} ${verdict.reasons.join('; ')}.`);
  }
  if (verdict.gate === 'routine') {
    // See the file header: arriving here is the evidence. A routine tool that
    // needs permission is a routine tool that is not, this time, routine.
    return deny(OUTSIDE_WORKTREE_DENIAL);
  }

  const answer = await gate.ask({
    toolName: req.toolName,
    input: req.input,
    callId: req.toolUseId,
    verdict,
  });
  if (!answer.allowed) {
    return deny(answer.reason);
  }
  // The input is echoed BYTE-FOR-BYTE. The protocol would let this host rewrite
  // it; rewriting it would mean the command that runs is not the command on the
  // capsule the owner read.
  return { behavior: 'allow', updatedInput: req.input };
}

/**
 * Wrap a decision the way an MCP tool result carries it: one text block whose
 * body is the decision as JSON. This shape is the wire contract, so it lives
 * beside the decision rather than being re-typed at the stdio edge.
 */
export function permissionToolResult(decision: PermissionDecision): {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
} {
  return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
}
