/*
 * capsule/state.js — the mutable state one renderCapsule() call owns.
 *
 * Unlike field/state.js (the Standing Field's module-level singleton — there
 * is exactly one field on screen at a time), a page can hold many pending
 * capsules at once. So this is a FACTORY, not a singleton: each
 * renderCapsule() call gets its own context object, and every field builder,
 * the footer, and the mount-time checks all import and mutate that SAME
 * object — exactly as they mutated the same closure variables when all of
 * this lived in one function.
 *
 *   blockers      the §4.5 completeness ledger: id -> {text, kind}.
 *   spent         L-ONCE: latched forever on the first Approve click.
 *   timer         the live countdown's setInterval handle, if one is running.
 *   approveReady / notify   addBlocker/clearBlocker must not call back into
 *                 syncApprove before the footer (and syncApprove itself)
 *                 exist. `notify` is wired to syncApprove once the footer is
 *                 built; `approveReady` flips true right before the first
 *                 sync, so every blocker raised while the body was under
 *                 construction is already accounted for in that first render.
 */
export function createCapsuleContext(preview, opts) {
  return {
    preview,
    opts,
    binding: preview?.binding || {},
    endpoint: opts.endpoint || '/approvals',
    root: null,
    blockers: new Map(),
    spent: false,
    timer: null,
    approveReady: false,
    notify: null,
    // stashed by one field builder, read by another — see fields.js
    countdownChip: null,
    countdownVal: null,
    identityChip: null,
    tupleComplete: true,
  };
}

export function addBlocker(ctx, id, text, kind) {
  ctx.blockers.set(id, { text, kind: kind || 'incomplete' });
  if (ctx.approveReady && ctx.notify) ctx.notify();
}

export function clearBlocker(ctx, id) {
  if (ctx.blockers.delete(id) && ctx.approveReady && ctx.notify) ctx.notify();
}

export function stopTimer(ctx) {
  if (ctx.timer !== null) {
    clearInterval(ctx.timer);
    ctx.timer = null;
  }
}
