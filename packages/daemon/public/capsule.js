/**
 * Zeno · daemon UI · THE APPROVAL CAPSULE
 * =======================================
 * One capsule = one previewed action. Binding spec: docs/24-prototype-command.md PART IV.
 * Wire types: packages/kernel/src/types.ts (Preview, Binding, Receipt).
 *
 * The laws this file is written to obey, each one testable:
 *
 *   L-OPEN      Opening a capsule NEVER approves. Nothing in this module performs a
 *               network write except the one click handler on the Approve control.
 *   L-ONCE      The Approve control is permanently spent after ONE click. It is
 *               disabled synchronously, before `await`, behind a re-entrancy guard.
 *   L-SEAL      The verified seal renders ONLY from a receipt whose outcome is
 *               'verified'. Never on click. Never optimistically.
 *   L-T4        A T4 capsule renders Approve DISABLED with the reason on the control.
 *   L-COMPLETE  §4.5: a field that does not apply renders `n/a` WITH A REASON; a field
 *               that cannot be resolved renders `unresolved` AND DISABLES Approve with
 *               that reason on the control. There is no expert-mode override.
 *   L-COLOUR    amber = approval/warning · red = blocked/error · gold = owner origin
 *               · cyan = information · green = A VERIFIED RECEIPT EXISTS, nothing else.
 *   L-GLASS     No glass anywhere in this component. A capsule is text and consequence:
 *               shell is opaque --g3, the payload plane is fully opaque --g2.
 *   L-GREYSCALE Status is never colour alone — always glyph + label + fill delta.
 *
 * No framework. No build step. Plain DOM APIs. Every colour is a token from
 * glass/tokens.css; the only literals are the approved palette used as var() fallbacks
 * so the component still renders if the stylesheet has not loaded.
 *
 * This file is the thin entry point. The engine lives under capsule/ in cohesive
 * modules, each holding the shared state it needs by importing the same
 * references rather than a private copy (see capsule/state.js):
 *
 *   capsule/dom.js       — el()/add(), the two DOM primitives everything else uses
 *   capsule/hash.js       — canonicalJSON, pendingCapsuleNeedsRefresh, sha256Hex
 *   capsule/format.js     — truncHash, fmtClock, fmtAbsolute, fmtCountdown
 *   capsule/styles.js     — the injected <style>, once per page
 *   capsule/widgets.js    — copyBtn, chip, field, na/unresolved, tierBadge
 *   capsule/review.js     — fileReviewModel, the DOM-free before/after review model
 *   capsule/util.js       — kvList/kvAdd, pickTuple, readMetaToken
 *   capsule/state.js      — createCapsuleContext + the blocker-ledger helpers
 *   capsule/diff.js       — field 5's content (the before/after diff)
 *   capsule/payload.js    — field 6's content (the exact payload) + its hash check
 *   capsule/fields.js     — the header and fields 1, 2, 3, 4, 15, 16 + the
 *                           mount-time action-hash identity check
 *   capsule/approve.js    — the footer: Approve's state machine, the committing
 *                           strip, the receipt/outcome renderers, and the one
 *                           write this component makes (POST /approvals)
 *   capsule/refused.js    — renderRefused + the drift-refused block, reused by
 *                           both the standalone export and approve.js
 *
 * packages/daemon/test/capsule-review-model.test.ts asserts on the literal
 * source text of the `field(5, …)` and `field(6, …)` calls below, and on the
 * FOOTER comment's position after both — so those two calls and that comment
 * stay in this file rather than moving into capsule/diff.js or capsule/payload.js.
 *
 * Exports:
 *   renderCapsule(preview, opts) -> HTMLElement   (+ .applyReceipt(receipt), .destroy())
 *   renderRefused(receipt, preview) -> HTMLElement
 */

import { el, add } from './capsule/dom.js';
import { ensureStyles } from './capsule/styles.js';
import { field, nextId } from './capsule/widgets.js';
import { createCapsuleContext, stopTimer } from './capsule/state.js';
import {
  buildHeader,
  buildWhatField,
  buildIdentityField,
  buildTierField,
  buildTargetField,
  buildTupleField,
  buildExpiryField,
  runIdentityCheck,
} from './capsule/fields.js';
import { buildReviewFieldContent } from './capsule/diff.js';
import { buildPayloadFieldContent } from './capsule/payload.js';
import { buildFooter } from './capsule/approve.js';

export { canonicalJSON, pendingCapsuleNeedsRefresh } from './capsule/hash.js';
export { fileReviewModel } from './capsule/review.js';
export { renderRefused } from './capsule/refused.js';

/* ------------------------------------------------------------------ *
 * renderCapsule                                                       *
 * ------------------------------------------------------------------ */

/**
 * @param {object} preview  a Preview from GET /state or the "preview" SSE event
 * @param {object} [opts]
 *   payload       {unknown}  the exact payload value. Presence checked with `in`.
 *   payloadText   {string}   pre-serialised exact bytes (preferred when the daemon
 *                            has the literal bytes rather than the parsed value).
 *   review        {object}   server-built, hash-bound before/after review for a
 *                            file-write payload. Missing or drifted review blocks it.
 *   expiresAt     {string}   ISO-8601 — drives the live countdown when present.
 *   approvalTtlMs {number}   World.approvalTtlMs, for an honest expiry statement
 *                            when no clock is running yet.
 *   ownerToken    {string}   sent as `x-zeno-token`. Falls back to the daemon's
 *                            <meta name="zeno-token"> injection.
 *   endpoint      {string}   default '/approvals'
 *   onApprove     {function} async (preview) => {approval, receipt} — overrides the fetch.
 *   onRePreview   {function} (info) => void — also emitted as a 'zeno:re-preview' event.
 * @returns {HTMLElement} with .applyReceipt(receipt) and .destroy()
 */
export function renderCapsule(preview, opts = {}) {
  ensureStyles();

  const ctx = createCapsuleContext(preview, opts);
  const root = el('section', 'zn-caps');
  ctx.root = root;
  const titleId = nextId();
  root.setAttribute('role', 'group');
  root.setAttribute('aria-labelledby', titleId);
  root.dataset.actionHash = String(preview?.actionHash ?? '');
  root.dataset.tier = String(preview?.tier ?? '');
  root.dataset.state = preview?.denied ? 'blocked' : preview?.auto ? 'auto' : 'awaiting';

  /* ================= HEADER ================= */
  const head = buildHeader(ctx, titleId);

  /* ================= BODY ================= */
  const body = el('div', 'zn-body');

  add(body, buildWhatField(ctx));
  add(body, buildIdentityField(ctx));
  add(body, buildTierField(ctx));
  add(body, buildTargetField(ctx));

  /* --- 5 · Exact before/after review for file writes --- */
  const reviewContent = buildReviewFieldContent(ctx);
  if (reviewContent !== null) {
    root.dataset.reviewState = reviewContent.state;
    const reviewField = field(5, 'Before / after diff');
    add(reviewField, ...reviewContent.nodes);
    add(body, reviewField);
  }

  /* --- 6 · Payload body: the complete exact payload, opaque --g2 plane --- */
  const payloadField = field(6, 'The exact change it will write');
  add(payloadField, ...buildPayloadFieldContent(ctx));
  add(body, payloadField);

  add(body, buildTupleField(ctx));
  add(body, buildExpiryField(ctx));

  // Field 2's chip and field 15's tuple both feed the mount-time identity
  // check; it has no dependency on the footer, so it can run any time after
  // the body above is built.
  runIdentityCheck(ctx);

  /* ================= FOOTER ================= */
  const { foot, syncApprove, applyReceipt } = buildFooter(ctx);
  ctx.notify = syncApprove;
  ctx.approveReady = true;
  syncApprove();

  add(root, head, body, foot);

  root.applyReceipt = applyReceipt;
  root.destroy = () => stopTimer(ctx);
  return root;
}
