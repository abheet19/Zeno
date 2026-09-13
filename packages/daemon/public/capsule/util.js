/*
 * capsule/util.js — small shared utilities: the evidence key/value list, the
 * bound-tuple picker, and the owner-token reader.
 */

import { el, add } from './dom.js';

/**
 * The evidence list under a seal — receipt id, self hash, prev receipt, policy
 * hash. It is built INSIDE `outcomeSlot`, which is aria-live="polite", so
 * without this a settled capsule made a screen reader spell out four 64-character
 * hexadecimal digests, unprompted, character by character. `aria-live="off"`
 * exempts the subtree from the announcement while leaving every value in the
 * accessibility tree, exactly where a reader browsing the capsule will find it.
 * The event itself is still announced: the seal line above it is inside the
 * live region, and app.js separately announces the outcome in one sentence.
 */
export function kvList() {
  const dl = el('dl', 'zn-kv');
  dl.setAttribute('aria-live', 'off');
  return dl;
}

export function kvAdd(dl, k, v) {
  add(dl, el('dt', null, k), el('dd', null, v === null || v === undefined ? '(none)' : String(v)));
}

/** Exactly the six bound fields, in the order the kernel's Binding declares them. */
export function pickTuple(binding) {
  return {
    payloadHash: binding?.payloadHash,
    baseHash: binding?.baseHash,
    targetRef: binding?.targetRef,
    kind: binding?.kind,
    tier: binding?.tier,
    provenanceHash: binding?.provenanceHash,
  };
}

export function readMetaToken() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return m ? m.getAttribute('content') : null;
}
