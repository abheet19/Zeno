/*
 * capsule/hash.js — canonical hashing, an exact mirror of
 * packages/kernel/src/hash.ts.
 *
 * The kernel computes  actionHash = sha256(canonicalJSON(binding))  and
 * payloadHash = sha256(canonicalJSON(payload)). Both are reproducible here,
 * which is the whole point of §4.5 field 15: "Never — a hash the owner
 * cannot compare." So we compare them, in front of the owner, and a mismatch
 * blocks approval.
 */

function sortValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const out = Object.create(null);
  for (const key of Object.keys(v).sort()) out[key] = sortValue(v[key]);
  return out;
}

/** Stable stringify: object keys sorted recursively; arrays preserve order. */
export function canonicalJSON(value) {
  return JSON.stringify(sortValue(value));
}

/**
 * The server can refresh a held action without changing its actionHash. That is
 * expected when a file's observed base moves: the governed action is the same,
 * but its review changes from ready to drifted. Keep the comparison DOM-free
 * so both Command and Forge use one tested rule instead of caching a stale,
 * still-enabled approval capsule.
 */
export function pendingCapsuleNeedsRefresh(current, next) {
  if (!current || !next || typeof current !== 'object' || typeof next !== 'object') return false;
  if (typeof current.actionHash !== 'string' || current.actionHash !== next.actionHash) return false;
  const presented = (preview) => ({
    payload: Object.prototype.hasOwnProperty.call(preview, 'payload')
      ? { present: true, value: preview.payload }
      : { present: false },
    payloadText: Object.prototype.hasOwnProperty.call(preview, 'payloadText')
      ? { present: true, value: preview.payloadText }
      : { present: false },
    review: Object.prototype.hasOwnProperty.call(preview, 'review')
      ? { present: true, value: preview.review }
      : { present: false },
  });
  return canonicalJSON(presented(current)) !== canonicalJSON(presented(next));
}

export const SUBTLE =
  typeof globalThis.crypto === 'object' && globalThis.crypto
    ? globalThis.crypto.subtle
    : undefined;

export async function sha256Hex(input) {
  if (!SUBTLE) throw new Error('no-subtlecrypto');
  const bytes = new TextEncoder().encode(input);
  const digest = await SUBTLE.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
