/**
 * The permission host, wired to the real kernel.
 *
 * `permission.ts` decides WHETHER a tool call needs a human. This decides what
 * happens when it does, and it does it through the one path every consequential
 * action in Zeno takes: classify -> preview -> the owner approves -> exactly one
 * attempt -> a signed, hash-chained receipt. There is no second approval
 * mechanism here, and that is deliberate — a governed `Bash` call is previewed,
 * held, clicked and receipted by the same kernel that governs a file write, so a
 * command the agent ran is exactly as auditable as an edit it made.
 *
 * THE LINE THIS FILE DOES NOT CROSS. It never calls `kernel.approve()`. It
 * cannot: an approval arrives only as somebody else's finished work, through
 * `OwnerChannel`, and the gate then checks the RECEIPT before it says yes. So
 * the strongest thing an agent's permission request can cause is a capsule
 * appearing in the owner's queue. That is law L6 — an agent may propose but
 * never approve — drawn at the tool-call doorstep, in the same shape the daemon
 * draws it at the HTTP boundary and the MCP edge draws it by having no approve
 * method at all.
 *
 * WHAT A RECEIPT HERE PROVES, EXACTLY. That the owner authorised THIS call —
 * this tool with these arguments, hashed into the binding — once. It does not
 * prove what the command then did: the CLI runs it, and its result is in the run
 * log like everything else the agent did. Claiming more would be claiming Zeno
 * watched something it did not watch.
 */
import { hashOf, PolicyError, type ActionRequest, type Kernel, type Preview, type Receipt } from '@abheet19/zeno-kernel';
import type { GateAnswer, GovernedCall, PermissionGate } from './permission.js';

/**
 * The target-ref prefix for a governed tool call.
 *
 * Zeno's other targets are things it can re-read: a file it can hash, a
 * repository whose HEAD it can ask git for. A command about to run on the
 * owner's machine has no such base — the world outside the worktree is not
 * something this product can hash, and inventing a stand-in would be theatre.
 * So the ref CARRIES the call's own identity, `readBase` hands it straight back,
 * and compare-and-swap here degenerates honestly to "this approval belongs to
 * this exact call and no other". The protection for a command is L2 (exactly one
 * attempt) and L4 (single use), not L3 — and the ref says so out loud rather
 * than letting a reader assume drift detection that is not happening.
 */
export const TOOL_TARGET_PREFIX = 'tool:';

/** Build the target ref for a call. The daemon's `World` reads it straight back. */
export function toolTargetRef(payloadHash: string): string {
  return TOOL_TARGET_PREFIX + payloadHash;
}

/**
 * The bytes a governed tool call is bound to: the tool, its exact arguments,
 * and WHICH call this is.
 *
 * The call id is in the payload rather than merely beside it because a kernel
 * action is content-addressed. Leave it out and `npm test`, asked for twice in
 * one run, is one action — the second ask collides with the first's spent
 * approval and an ordinary command becomes permanently un-runnable. Two asks are
 * two events; each gets its own capsule, its own single attempt and its own
 * receipt, and the payload the owner reads says which one they are looking at.
 */
export function toolPayload(call: GovernedCall, callId: string): {
  readonly tool: string;
  readonly input: unknown;
  readonly callId: string;
} {
  return { tool: call.toolName, input: call.input, callId };
}

/** What the owner's channel came back with. */
export type OwnerVerdict =
  | { readonly approved: true; readonly receipt: Receipt }
  | { readonly approved: false; readonly reason: string };

/**
 * The owner's own channel, as one injected function.
 *
 * Its implementation is the daemon: it holds the capsule, streams it to the
 * window, waits for a click, and calls `kernel.approve` + `kernel.commit` behind
 * the owner token — the token this side of the boundary does not have. Injected
 * rather than imported so the whole gate is drivable in memory, and so that
 * nothing in this file can reach an approval by accident.
 */
export interface OwnerChannel {
  decide(preview: Preview, call: GovernedCall): Promise<OwnerVerdict>;
}

export interface KernelGateOptions {
  readonly kernel: Kernel;
  readonly owner: OwnerChannel;
  /** Recorded as who asked. Never as who agreed — see the file header. */
  readonly requestedBy: string;
  /** Which run this call belongs to, recorded as provenance. */
  readonly runId: string;
}

/** Said when a policy has been edited until a governed call would need no owner. */
export const AUTO_APPROVED_REFUSAL =
  'The policy in force rates this call as routine, which would let an agent run it with nobody asked. ' +
  'Zeno refuses it instead: a call that can reach outside the worktree is never applied unattended, ' +
  'whatever a policy file says.';

/**
 * A `PermissionGate` over the real kernel.
 *
 * Every branch that ends in "no" is taken before the owner is disturbed, and
 * every branch that ends in "yes" has a verified receipt behind it. There is no
 * third way out of this function.
 */
export function kernelGate(opts: KernelGateOptions): PermissionGate {
  // A fallback identity for a CLI that sent no `tool_use_id`. Counting is the
  // whole of it: the id only has to make two asks distinguishable, and inventing
  // randomness would cost the replayability the kernel is built on.
  let asked = 0;
  return {
    async ask(call: GovernedCall): Promise<GateAnswer> {
      asked += 1;
      const callId = call.callId ?? `${opts.runId}#${asked}`;

      let preview: Preview;
      try {
        // Hashing is inside the guard, not merely previewing. `hashOf` is where
        // an argument shape the canonical form cannot express (a value JSON
        // refuses, a cycle) actually throws, and an exception on the way to a
        // decision must land as a refusal rather than as an unhandled crash in
        // whatever is holding the agent's tool call open.
        const payload = toolPayload(call, callId);
        const baseHash = hashOf(payload);
        const request: ActionRequest = {
          kind: call.verdict.kind,
          summary: call.verdict.summary,
          targetRef: toolTargetRef(baseHash),
          payload,
          baseHash,
          requestedBy: opts.requestedBy,
          dataZones: call.verdict.dataZones,
          provenance: { runId: opts.runId, tool: call.toolName, callId, why: call.verdict.reasons.join('; ') },
        };
        preview = opts.kernel.preview(request);
      } catch (err) {
        // A malformed request is a refusal, never a pass. The message reaches the
        // model, so it says what happened rather than only that something did.
        const why = err instanceof PolicyError ? err.message : `the gate could not preview this call — ${(err as Error).message}`;
        return { allowed: false, reason: `Zeno refused this call: ${why}`, receiptId: null };
      }

      if (preview.denied) {
        return {
          allowed: false,
          reason: `This call is prohibited (${preview.tier}) and there is no approval that permits it. ${preview.reasons.join('; ')}.`,
          receiptId: null,
        };
      }
      if (preview.auto) {
        // The fail-closed seam. `preview.auto` means the policy put this action
        // in the band that applies without asking — right for an ordinary edit
        // in a sandbox, and never right for a call that can leave the worktree.
        return { allowed: false, reason: AUTO_APPROVED_REFUSAL, receiptId: null };
      }

      const verdict = await opts.owner.decide(preview, call);
      if (!verdict.approved) {
        return { allowed: false, reason: verdict.reason, receiptId: null };
      }

      // L5, checked rather than trusted: allowed ONLY on the evidence of a
      // receipt, and only one that settles THIS action. A channel that came back
      // "approved" with a receipt for something else, or with an outcome that is
      // not `verified`, has not shown that the owner agreed to this call.
      const receipt = verdict.receipt;
      if (receipt.actionHash !== preview.actionHash) {
        return {
          allowed: false,
          reason: 'Zeno refused this call: the approval that came back settles a different action.',
          receiptId: null,
        };
      }
      if (receipt.outcome !== 'verified') {
        return {
          allowed: false,
          reason: `Zeno refused this call: the gate recorded "${receipt.outcome}"${receipt.reason ? ` — ${receipt.reason}` : ''}.`,
          receiptId: receipt.id,
        };
      }
      return {
        allowed: true,
        reason: `The owner approved this call once; receipt ${receipt.id}.`,
        receiptId: receipt.id,
      };
    },
  };
}
