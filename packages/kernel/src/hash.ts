/**
 * Deterministic hashing. Uses node:crypto (local cryptographic primitives — NOT
 * network). Canonical JSON gives a stable, key-order-independent serialization so
 * two equal objects always hash identically.
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
  // "__proto__" hits Object.prototype's inherited accessor instead of creating
  // an own property, so the key — and everything under it — silently vanishes
  // from the serialization and is covered by no hash. `JSON.parse` produces
  // "__proto__" as an ordinary own key, so a single spliced key in a receipt
  // line on disk would otherwise leave the chain verifying as intact.
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
  return out;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Hash any structured value canonically. */
export function hashOf(value: unknown): string {
  return sha256(canonicalJSON(value));
}
