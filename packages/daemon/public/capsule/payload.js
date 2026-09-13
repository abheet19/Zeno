/*
 * capsule/payload.js — content for field 6, "The exact change it will write",
 * plus the browser-side hash verification it triggers.
 *
 * capsule.js keeps the literal `field(6, 'The exact change it will write')`
 * call itself (see capsule/diff.js's header comment for why), and fills the
 * field with the nodes this module builds.
 */

import { el, add } from './dom.js';
import { chip, unresolved, copyBtn } from './widgets.js';
import { canonicalJSON, sha256Hex, SUBTLE } from './hash.js';
import { addBlocker, clearBlocker } from './state.js';

/** browser-side hash verification (field 6's payload hash check) */
function verifyHash(ctx, value, text, expected, chipEl, label, blockerId, mismatchText) {
  if (!expected) {
    chipEl.dataset.ch = '';
    chipEl.lastChild.textContent = `${label} · n/a — the binding carries no hash to compare`;
    chipEl.firstChild.textContent = '○';
    return;
  }
  if (!SUBTLE) {
    chipEl.dataset.ch = '';
    chipEl.firstChild.textContent = '○';
    chipEl.lastChild.textContent = `${label} · unchecked — no SubtleCrypto in this context`;
    chipEl.title =
      'The browser exposes crypto.subtle only in a secure context. Served over http from a non-localhost origin, this comparison cannot run. That is an environment limit, not a mismatch — it does not block approval, and it does not confirm anything either.';
    return;
  }
  if (text !== null && text !== undefined) {
    // Raw bytes: the kernel hashes the canonical form of a VALUE, so a
    // pre-serialised string cannot be compared without guessing. Say so.
    chipEl.dataset.ch = '';
    chipEl.firstChild.textContent = '○';
    chipEl.lastChild.textContent = `${label} · n/a — supplied as text, not as the value the kernel hashed`;
    chipEl.title =
      'payloadHash is sha256 over the canonical JSON of the payload VALUE. Given pre-serialised text, this UI cannot reconstruct that canonical form without guessing, and it will not guess. Pass opts.payload to enable the comparison.';
    return;
  }
  // The check is genuinely in flight; Approve stays blocked until it lands.
  addBlocker(ctx, blockerId + '-pending', `the ${label} check is still running`);
  sha256Hex(canonicalJSON(value))
    .then((computed) => {
      clearBlocker(ctx, blockerId + '-pending');
      if (computed === expected) {
        chipEl.dataset.ch = 'cyan';
        chipEl.firstChild.textContent = '≡';
        chipEl.lastChild.textContent = `${label} · matches the binding`;
        chipEl.title = `recomputed sha256(canonicalJSON(…)) = ${computed}`;
        clearBlocker(ctx, blockerId + '-hash');
      } else {
        chipEl.dataset.ch = 'red';
        chipEl.firstChild.textContent = '≠';
        chipEl.lastChild.textContent = `${label} · MISMATCH`;
        chipEl.title = `expected ${expected}\nrecomputed ${computed}`;
        addBlocker(ctx, blockerId + '-hash', mismatchText);
      }
    })
    .catch(() => {
      clearBlocker(ctx, blockerId + '-pending');
      chipEl.dataset.ch = '';
      chipEl.firstChild.textContent = '○';
      chipEl.lastChild.textContent = `${label} · unchecked — the digest could not be computed`;
    });
}

/** @returns {Node[]} the child nodes to append to field 6 */
export function buildPayloadFieldContent(ctx) {
  const { opts, binding } = ctx;
  const hasText = typeof opts.payloadText === 'string';
  const hasValue = Object.prototype.hasOwnProperty.call(opts, 'payload');

  let payloadText = null;
  let payloadOrigin = null;

  if (hasText) {
    payloadText = opts.payloadText;
    payloadOrigin = 'The exact bytes, as supplied by the daemon.';
  } else if (hasValue) {
    const p = opts.payload;
    if (typeof p === 'string') {
      payloadText = p;
      payloadOrigin = 'The exact string value carried by the preview.';
    } else if (p === undefined) {
      payloadText = 'undefined';
      payloadOrigin =
        'The preview carries the literal value `undefined` as its payload. That is what the kernel hashed.';
    } else {
      payloadText = JSON.stringify(p, null, 2);
      payloadOrigin =
        'Rendered from the preview’s payload value as indented JSON. Indentation and key order are for reading only — the bound bytes are the canonical form, and the check above recomputes that form and compares it to payloadHash.';
    }
  }

  const nodes = [];
  if (payloadText === null) {
    nodes.push(
      unresolved(
        'this preview did not carry the payload. The daemon does serve one — GET /state and the "preview" event both send the payload alongside each Preview — so its absence here means this preview reached the page without it.',
      ),
      el(
        'div',
        'zn-note',
        'Resolve: check that the daemon serving this window is a build whose /state and "preview" event carry the payload beside each Preview, and that it was passed to renderCapsule as opts.payload (or opts.payloadText). Until the bytes are here this capsule refuses rather than guesses — there is no configuration that approves an unseen payload.',
      ),
    );
    addBlocker(ctx, 'payload', 'the payload body is unresolved — nothing here shows what would be sent');
  } else {
    const pre = el('pre', 'zn-payload', payloadText);
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'the complete exact payload');
    const prow = el('div', 'zn-hashrow');
    const payloadChip = chip('◌', 'payload hash · checking…', null, 'recomputing sha256(canonicalJSON(payload))');
    add(prow, payloadChip, copyBtn('copy payload', () => payloadText));
    nodes.push(pre, prow, el('div', 'zn-note', payloadOrigin));

    // Verify the bytes on screen actually hash to the bound payloadHash.
    verifyHash(
      ctx,
      hasText ? null : opts.payload,
      hasText ? payloadText : null,
      binding.payloadHash,
      payloadChip,
      'payload hash',
      'payload',
      'the bytes rendered above do not hash to the payloadHash in the binding — what you are reading is not what would be sent',
    );
  }
  return nodes;
}
