/**
 * The file-write capsule lifecycle: propose (preview + risk assessment),
 * approve, and decline. THE line the whole package exists to draw — approval
 * requires the owner token, structurally, at the route.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  assessWrite,
  jail,
  makeWritePayload,
  worktreeExecutor,
  type ActionKind,
  type ActionRequest,
} from '@abheet19/zeno-kernel';
import { sanitize } from '@abheet19/zeno-sanitizer';
import type { Role } from '../tokens.js';
import { persistHeld, publishPending, type Held, type ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { buildForgeFileReview, unavailableForgeFileReview, type ForgeFileReview } from './forge-review.js';

/**
 * The capsule renders the exact payload and re-hashes it against the binding
 * before it will enable Approve. So the payload has to travel WITH the
 * preview — a capsule that cannot see the bytes correctly refuses to approve.
 */
export function withPayload(ctx: ServerCtx, h: Held): Record<string, unknown> {
  let review: ForgeFileReview;
  try {
    const abs = jail(ctx.opts.fs, ctx.opts.sandbox, h.payload.relPath);
    review = buildForgeFileReview(h.payload, ctx.opts.fs.readFile(abs));
  } catch {
    review = unavailableForgeFileReview(h.payload);
  }
  return { ...h.preview, payload: h.payload, review };
}

export async function postPreview(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const relPath = str(body, 'relPath');
  const contents = str(body, 'contents');
  const summary = str(body, 'summary');
  if (relPath === null || contents === null || summary === null) {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'A proposal needs relPath, contents and summary.',
        resolve: 'POST {"relPath":"src/App.tsx","contents":"...","summary":"what this does"}.',
      },
    });
  }
  // Label the SURFACE that asked, never the person. L6 refuses when the
  // proposer and the approver are the same identity — which is right for an
  // agent, and wrong for the owner's own window. Labelling an owner-side
  // proposal "owner" made the owner unable to approve it, so anything the
  // window itself proposed (a spoken command, most visibly) was held forever
  // with no way to ever say yes. Voice's documented contract is exactly this:
  // speaking PROPOSES and the hand APPROVES — two deliberate acts by one
  // person. A real agent still carries the proposer token and still cannot
  // approve, because that is enforced by role at the route, not by this label.
  const requestedBy = str(body, 'requestedBy') ?? (role === 'owner' ? 'window' : 'agent');
  const out = await proposeFileWrite(ctx, relPath, contents, summary, requestedBy);
  json(res, 200, out);
}

/**
 * The one gated path a file change takes, whoever proposed it — a POST to
 * /previews, or a file the Forge agent wrote in its worktree. Jail, assess
 * risk, scan for secrets, preview through the kernel, hold as a capsule (or
 * auto-apply when routine), and stream it. Returns the same shape /previews does.
 */
export async function proposeFileWrite(
  ctx: ServerCtx,
  relPath: string,
  contents: string,
  summary: string,
  requestedBy: string,
): Promise<Record<string, unknown>> {
  const abs = jail(ctx.opts.fs, ctx.opts.sandbox, relPath);
  const before = ctx.opts.fs.readFile(abs);
  const payload = makeWritePayload(relPath, before, contents);
  const risk = assessWrite(relPath, before, contents);
  const secrets = sanitize(contents).findings;
  const secretWarning =
    secrets.length > 0 ? { count: secrets.length, kinds: [...new Set(secrets.map((f) => f.label))] } : null;
  // ASSESSED, never client-supplied (that was a live L1 breach). A secret in a
  // routine write escalates it to needing the owner. Agent output always does
  // too: a model may propose a harmless-looking file, but it cannot approve or
  // auto-land its own output merely because the path happened to score T0.
  const fromAgent = requestedBy.startsWith('forge:');
  const kind: ActionKind = (fromAgent || secretWarning) && risk.routine ? 'patch.task' : risk.kind;
  const request: ActionRequest = {
    kind, summary, targetRef: abs, payload, baseHash: payload.expectBaseHash, requestedBy, dataZones: ['personal'],
  };
  const preview = ctx.opts.kernel.preview(request);
  ctx.held.set(preview.actionHash, { preview, payload, req: request });
  persistHeld(ctx);
  publishPending(ctx);
  if (preview.auto) {
    const receipt = await ctx.opts.kernel.commit(
      preview.actionHash,
      worktreeExecutor({ root: ctx.opts.sandbox, fs: ctx.opts.fs }, payload),
    );
    ctx.held.delete(preview.actionHash);
    persistHeld(ctx);
    publishPending(ctx);
    ctx.opts.stream.publish('receipt', receipt);
    ctx.opts.stream.publish('chain', ctx.opts.kernel.verifyChain());
    return { preview, receipt, risk, secretWarning };
  }
  ctx.opts.stream.publish('preview', { ...withPayload(ctx, { preview, payload, req: request }), secretWarning });
  return { preview, risk, secretWarning };
}

export async function postApproval(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  // THE line this whole package exists to draw.
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'self-approval-forbidden',
        message: 'The proposer token cannot approve. Only the owner token can.',
        resolve: 'Approve from the Zeno window. An agent is structurally unable to grant this.',
      },
    });
  }
  const body = await readJson(req);
  const actionHash = str(body, 'actionHash');
  if (actionHash === null) {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'An approval needs an actionHash.', resolve: 'POST {"actionHash":"..."}.' },
    });
  }
  // A TOOL CALL waiting on this same queue. Same route, same owner-only check
  // above, same kernel — the only difference is what the effect IS. For a file
  // write the executor writes the file; here the effect Zeno performs is the
  // AUTHORISATION itself, and the agent's blocked call is released on the
  // strength of the receipt that records it. Nothing about the command's own
  // result is claimed: the CLI runs it, and the run log says what happened.
  const waiting = ctx.gateHeld.get(actionHash);
  if (waiting !== undefined) {
    const approval = ctx.opts.kernel.approve(actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
    const receipt = await ctx.opts.kernel.commit(approval, async () => ({
      effect: `tool-grant:${actionHash.slice(0, 12)}`,
    }));
    waiting.settle({ approved: true, receipt });
    ctx.opts.stream.publish('receipt', receipt);
    ctx.opts.stream.publish('chain', ctx.opts.kernel.verifyChain());
    return json(res, 200, { approval, receipt });
  }

  const item = ctx.held.get(actionHash);
  if (item === undefined) {
    return json(res, 404, {
      error: {
        code: 'unknown-action',
        message: 'No previewed action with that hash is waiting.',
        resolve: 'Re-preview the action; a preview may have expired or the daemon restarted.',
      },
    });
  }

  // The owner token IS the authenticator at this stage. A real platform
  // authenticator (Windows Hello) is a later slice; saying so plainly beats
  // pretending the tier gate is stronger than it is.
  const approval = ctx.opts.kernel.approve(actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
  const receipt = await ctx.opts.kernel.commit(
    approval,
    worktreeExecutor({ root: ctx.opts.sandbox, fs: ctx.opts.fs }, item.payload),
  );

  ctx.held.delete(actionHash);
  persistHeld(ctx);
  publishPending(ctx);
  ctx.opts.stream.publish('receipt', receipt);
  ctx.opts.stream.publish('chain', ctx.opts.kernel.verifyChain());
  json(res, 200, { approval, receipt });
}

/**
 * Refuse a held action.
 *
 * Approval had no opposite. A previewed write could be approved or left to sit
 * in the queue for ever, which makes "Deny" in the window a button with nothing
 * behind it and leaves the owner unable to clear a proposal they have judged
 * and rejected. Saying no is half of a decision.
 *
 * A refusal DISCARDS the held capsule and writes NO receipt. That is deliberate
 * and matches the ledger's meaning: a receipt records an effect that actually
 * happened, and nothing happened here. The proposal simply ceases to be
 * available — the next attempt must be previewed again, so a refused action can
 * never be revived by replaying its hash.
 */
export async function postApprovalDecline(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner token can refuse a held action.',
        resolve: 'Refuse it from the Zeno window. An agent cannot decide its own proposal either way.',
      },
    });
  }
  const body = await readJson(req);
  const actionHash = str(body, 'actionHash');
  if (actionHash === null) {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'A refusal needs an actionHash.', resolve: 'POST {"actionHash":"..."}.' },
    });
  }
  if (!ctx.held.has(actionHash)) {
    return json(res, 404, {
      error: {
        code: 'unknown-action',
        message: 'No previewed action with that hash is waiting.',
        resolve: 'It may already have been approved, refused, or expired.',
      },
    });
  }
  ctx.held.delete(actionHash);
  persistHeld(ctx);
  // State changed even though no effect ran: the queue is shorter, so anything
  // showing a pending count has to hear about it.
  publishPending(ctx);
  json(res, 200, { declined: { actionHash, at: new Date().toISOString() }, receipt: null });
}
