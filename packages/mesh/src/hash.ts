/**
 * Deterministic canonical hashing — the state-convergence proof rests on it.
 *
 * Two replicas that have merged the same set of ops must produce a BYTE-identical
 * state hash, or "the devices converge" is unfalsifiable. That requires a
 * serialization that does not depend on key insertion order, so this sorts object
 * keys recursively before hashing. Arrays keep their order (order is data there).
 *
 * node:crypto is a LOCAL primitive (not network) and is explicitly allowed in the
 * Mesh package. This file is a leaf copy on purpose: Mesh depends on no other Zeno
 * package, so it carries its own tiny hash rather than importing the kernel's.
 */
import { createHash } from 'node:crypto';

/** Stable stringify: object keys sorted recursively; arrays preserve order. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  // Object.create(null), NOT {}. On a plain object literal, assigning the key
  // "__proto__" hits Object.prototype's inherited accessor instead of creating an
  // own property, so the key — and everything under it — would silently vanish
  // from the serialization and be covered by no hash. A synced payload could then
  // smuggle content past the state hash and two replicas could disagree while
  // hashing identically. JSON.parse produces "__proto__" as an ordinary own key,
  // so this is a real wire-reachable path, not a curiosity.
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
  return out;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash any structured value canonically. */
export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJSON(value));
}
