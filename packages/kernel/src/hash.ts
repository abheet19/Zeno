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
  const out: Record<string, unknown> = {};
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
