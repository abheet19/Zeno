/*
 * capsule/fields.js — the header and the plain-data body fields: 1 (what will
 * happen), 2 (action identity), 3 (risk tier + why), 4 (target), 15 (the
 * bound approval tuple) and 16 (expiry) — plus the mount-time identity check
 * that field 2's chip and field 15's tuple feed into.
 *
 * Field 5 (the before/after diff) and field 6 (the exact payload) have their
 * own modules — capsule/diff.js and capsule/payload.js — because
 * packages/daemon/test/capsule-review-model.test.ts asserts on the literal
 * `field(5, …)` / `field(6, …)` call text staying in capsule.js itself.
 */

import { el, add } from './dom.js';
import { chip, field, na, unresolved, tierBadge, copyBtn, nextId } from './widgets.js';
import { truncHash, fmtAbsolute, fmtCountdown, fmtClock } from './format.js';
import { canonicalJSON, sha256Hex, SUBTLE } from './hash.js';
import { pickTuple } from './util.js';
import { addBlocker, clearBlocker, stopTimer } from './state.js';

/* ================= HEADER ================= */
export function buildHeader(ctx, titleId) {
  const { preview, binding } = ctx;

  const head = el('header', 'zn-head');
  const title = el('h2', 'zn-title', preview?.summary || '(this preview carries no summary)');
  title.id = titleId;

  const headRow = el('div', 'zn-headrow');
  const kindChip = chip('■', String(binding.kind ?? 'unknown-kind'), null, 'Action kind, from the binding');
  const hashChip = el('span', 'zn-chip');
  hashChip.dataset.ch = 'gold'; // gold = owner origin: this is the identity you are being asked to sign
  add(
    hashChip,
    el('span', 'zn-gly', '#'),
    el('span', 'zn-mono', truncHash(preview?.actionHash)),
  );
  hashChip.title = String(preview?.actionHash ?? '');
  hashChip.setAttribute('aria-label', `action hash ${preview?.actionHash ?? 'missing'}`);

  const countdownChip = el('span', 'zn-chip');
  add(countdownChip, el('span', 'zn-gly', '◷'), el('span', 'zn-mono', '—'));
  ctx.countdownChip = countdownChip;
  ctx.countdownVal = countdownChip.lastChild;

  add(
    headRow,
    tierBadge(preview || {}),
    kindChip,
    hashChip,
    copyBtn('copy hash', () => preview?.actionHash ?? '', 'copy the full action hash'),
    countdownChip,
  );
  add(head, title, headRow);
  return head;
}

/* --- 1 · What will happen --- */
export function buildWhatField(ctx) {
  const { preview } = ctx;
  const whatVal = el('div', 'zn-val', preview?.summary || '');
  const what = field(1, 'What will happen', whatVal);
  if (!preview?.summary) {
    what.replaceChild(
      unresolved('this preview carried no summary sentence. You cannot approve a sentence nobody wrote.'),
      whatVal,
    );
    addBlocker(ctx, 'summary', 'no summary sentence in this preview');
  } else {
    add(
      what,
      el(
        'div',
        'zn-note',
        'This exact sentence is hashed into provenanceHash, so a receipt can never record wording you did not see. It states what the kernel will attempt — not what the provider will guarantee.',
      ),
    );
  }
  return what;
}

/* --- 2 · Action identity --- */
export function buildIdentityField(ctx) {
  const { preview } = ctx;
  const idRow = el('div', 'zn-hashrow');
  const idFull = el('code', 'zn-hash', String(preview?.actionHash ?? ''));
  const idShort = el('code', 'zn-hash zn-mono', truncHash(preview?.actionHash));
  idFull.hidden = true;
  const idToggle = el('button', 'zn-mini', 'show full');
  idToggle.type = 'button';
  idToggle.setAttribute('aria-expanded', 'false');
  idToggle.addEventListener('click', () => {
    const showing = !idFull.hidden;
    idFull.hidden = showing;
    idShort.hidden = !showing;
    idToggle.textContent = showing ? 'show full' : 'truncate';
    idToggle.setAttribute('aria-expanded', String(!showing));
  });
  add(idRow, idShort, idFull, idToggle, copyBtn('copy', () => preview?.actionHash ?? ''));

  const identityCheck = el('div', 'zn-hashrow');
  const identityChip = chip('◌', 'identity · checking…', null, 'recomputing sha256(canonicalJSON(binding))');
  add(identityCheck, identityChip);
  ctx.identityChip = identityChip;

  return field(
    2,
    'Action identity',
    idRow,
    identityCheck,
    na(
      'version, originating product and originating run are not carried. This kernel has no version counter: identity IS the hash, so any change to payload, base, target, kind or tier is a different action hash, not a new version of this one. The originating agent rides inside provenanceHash and is not transmitted.',
    ),
  );
}

/* --- 3 · Risk tier + WHY (a tier without its reason is forbidden) --- */
export function buildTierField(ctx) {
  const { preview } = ctx;
  const reasons = Array.isArray(preview?.reasons) ? preview.reasons : [];
  let whyNode;
  if (reasons.length === 0) {
    whyNode = unresolved(
      'this preview carried a tier with no reason. §4.5 field 3 forbids a tier without the clause that determined it.',
    );
    addBlocker(ctx, 'reasons', 'tier carries no reason');
  } else {
    whyNode = el('ul', 'zn-reasons');
    for (const r of reasons) add(whyNode, el('li', null, String(r)));
  }
  const tierRow = el('div', 'zn-hashrow');
  add(tierRow, tierBadge(preview || {}));
  return field(3, 'Risk tier — and why', tierRow, whyNode);
}

/* --- 4 · Target --- */
export function buildTargetField(ctx) {
  const { binding } = ctx;
  const targetRow = el('div', 'zn-hashrow');
  add(
    targetRow,
    el('code', 'zn-hash', String(binding.targetRef ?? '')),
    copyBtn('copy', () => binding.targetRef ?? ''),
  );
  const targetField = field(4, 'Target', targetRow);
  if (!binding.targetRef) {
    targetField.replaceChild(
      unresolved('the binding carries no targetRef, so what would be written cannot be named.'),
      targetRow,
    );
    addBlocker(ctx, 'target', 'binding carries no targetRef');
  } else {
    add(
      targetField,
      na(
        'provider, account/workspace, acting identity and region are not carried. The kernel binds to one opaque targetRef (repo@HEAD, ticket@version, resource@etag); no executor slice in this build supplies an account or a region. Nothing here means "your account" — read the ref.',
      ),
    );
  }
  return targetField;
}

/* --- 15 · Approval binding: the full bound tuple, mono and copyable --- */
const TUPLE_KEYS = ['payloadHash', 'baseHash', 'targetRef', 'kind', 'tier', 'provenanceHash'];

export function buildTupleField(ctx) {
  const { preview, binding } = ctx;
  const tuple = el('dl', 'zn-tuple');
  let tupleComplete = true;
  for (const k of TUPLE_KEYS) {
    const v = binding[k];
    add(tuple, el('dt', null, k));
    if (v === undefined || v === null || v === '') {
      tupleComplete = false;
      const dd = el('dd', null);
      add(dd, unresolved('missing from the binding'));
      add(tuple, dd);
    } else {
      add(tuple, el('dd', null, String(v)));
    }
  }
  if (!tupleComplete) addBlocker(ctx, 'tuple', 'the approval binding tuple is incomplete');
  ctx.tupleComplete = tupleComplete;

  const tupleRow = el('div', 'zn-hashrow');
  add(
    tupleRow,
    copyBtn('copy tuple', () => canonicalJSON(pickTuple(binding)), 'copy the bound tuple as canonical JSON'),
    copyBtn('copy hash', () => preview?.actionHash ?? ''),
  );
  return field(
    15,
    'Exactly what you are approving',
    tuple,
    tupleRow,
    el(
      'div',
      'zn-note',
      'The action hash is sha256 over the canonical JSON of exactly this tuple — the check in field 2 recomputes it here, in your browser, so the hash is one you can compare rather than one you must trust. provenanceHash covers the proposing agent, the summary sentence, the provenance record and the policy hash; those inputs are hashed, not transmitted, so they cannot be read back out of it.',
    ),
  );
}

/* --- 16 · Expiry --- */
export function buildExpiryField(ctx) {
  const { opts, root, countdownChip, countdownVal } = ctx;
  const expiresAt = typeof opts.expiresAt === 'string' ? Date.parse(opts.expiresAt) : NaN;
  const expiryField = field(16, 'Expiry');
  if (!Number.isNaN(expiresAt)) {
    const abs = el('div', 'zn-val zn-mono', fmtAbsolute(expiresAt));
    const live = el('div', 'zn-hashrow');
    const liveChip = el('span', 'zn-chip');
    liveChip.dataset.ch = 'amber';
    add(liveChip, el('span', 'zn-gly', '◷'), el('span', 'zn-mono', '—'));
    const liveVal = liveChip.lastChild;
    add(live, liveChip, el('span', 'zn-na', 'single-use · short-lived'));
    add(expiryField, abs, live);

    const tick = () => {
      const left = expiresAt - Date.now();
      const text = left > 0 ? fmtCountdown(left) + ' left' : 'expired';
      liveVal.textContent = text;
      countdownVal.textContent = text;
      liveChip.setAttribute('aria-label', `expiry ${text}`);
      countdownChip.setAttribute('aria-label', `expiry ${text}`);
      if (left <= 0) {
        stopTimer(ctx);
        liveChip.dataset.ch = 'amber';
        if (root.dataset.state === 'awaiting') root.dataset.state = 'expired';
        addBlocker(
          ctx,
          'expired',
          `Expired at ${fmtClock(new Date(expiresAt).toISOString())}; re-preview to decide again.`,
          'expired',
        );
      }
    };
    tick();
    ctx.timer = setInterval(tick, 1000);
  } else {
    countdownVal.textContent = 'no clock';
    countdownChip.setAttribute('aria-label', 'expiry: no clock is running on this preview');
    const ttl = typeof opts.approvalTtlMs === 'number' ? opts.approvalTtlMs : null;
    add(
      expiryField,
      na(
        ttl === null
          ? 'no expiry clock runs on a preview in this kernel, and /state does not expose the approval TTL. The approval this capsule requests is single-use and is created at the moment you approve; it expires on the kernel’s own TTL, which is checked at commit.'
          : `no expiry clock runs on a preview in this kernel. The approval is created at the moment you approve and is single-use, living ${Math.round(
              ttl / 1000,
            )}s from then (World.approvalTtlMs); the kernel re-checks it at commit and writes an "expired" receipt if it has lapsed.`,
      ),
    );
  }
  return expiryField;
}

/**
 * Field 2's own check: does the action hash actually hash from this binding?
 * A preview with no actionHash has no identity to approve at all: the chip
 * must not sit at "checking…" forever (a check that will never land reads as
 * one still in flight), and Approve must be blocked — POSTing
 * {"actionHash": undefined} is a request the owner never authorised.
 *
 * Runs once field 2 (for `ctx.identityChip`) and field 15 (for
 * `ctx.tupleComplete`) exist; not tied to the footer in any way, so it can run
 * any time after those two fields are built.
 */
export function runIdentityCheck(ctx) {
  const { preview, binding, identityChip, tupleComplete } = ctx;
  if (!preview?.actionHash) {
    identityChip.dataset.ch = 'red';
    identityChip.firstChild.textContent = '▲';
    identityChip.lastChild.textContent = 'identity · unresolved — this preview carries no action hash';
    identityChip.title =
      'POST /approvals is bound to one actionHash. This preview does not carry one, so there is no identity to approve and nothing to compare.';
    addBlocker(ctx, 'actionhash', 'this preview carries no action hash, so there is no identity to approve');
  } else if (tupleComplete) {
    addBlocker(ctx, 'identity-pending', 'the action-hash check is still running');
    sha256Hex(canonicalJSON(pickTuple(binding)))
      .then((computed) => {
        clearBlocker(ctx, 'identity-pending');
        if (computed === preview.actionHash) {
          identityChip.dataset.ch = 'cyan';
          identityChip.firstChild.textContent = '≡';
          identityChip.lastChild.textContent = 'identity · hash recomputed from the tuple, and it matches';
          identityChip.title = `sha256(canonicalJSON(binding)) = ${computed}`;
        } else {
          identityChip.dataset.ch = 'red';
          identityChip.firstChild.textContent = '≠';
          identityChip.lastChild.textContent = 'identity · MISMATCH';
          identityChip.title = `action hash ${preview.actionHash}\nrecomputed  ${computed}`;
          addBlocker(
            ctx,
            'identity',
            'the action hash does not recompute from this binding — the preview is not internally consistent',
          );
        }
      })
      .catch(() => {
        clearBlocker(ctx, 'identity-pending');
        identityChip.dataset.ch = '';
        identityChip.firstChild.textContent = '○';
        identityChip.lastChild.textContent = SUBTLE
          ? 'identity · unchecked — the digest could not be computed'
          : 'identity · unchecked — no SubtleCrypto in this context';
      });
  } else {
    // The tuple is incomplete, so the hash cannot be recomputed. The glyph moves
    // off '◌' as well as the words: a spinner-shaped glyph left behind on a
    // check that will never run reads as one still in flight.
    identityChip.firstChild.textContent = '○';
    identityChip.lastChild.textContent = 'identity · uncheckable — the binding tuple is incomplete';
  }
}
