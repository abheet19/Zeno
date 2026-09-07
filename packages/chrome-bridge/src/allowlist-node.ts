/**
 * Where the owner's Chrome allowlist lives, and what adding to it costs.
 *
 * One small JSON file in the workspace, next to `policy.json` and the ledger:
 *
 *     .zeno/chrome-origins.json
 *     { "allowed": ["https://github.com"], "neverExtra": ["mybank.example"] }
 *
 * A FILE, AND ON PURPOSE. The owner has to be able to read the whole of their
 * own consent in one glance, and delete it with one keystroke. A list held only
 * in a running process is a list nobody can audit after the fact.
 *
 * AN ABSENT OR UNREADABLE FILE IS AN EMPTY ALLOWLIST, never an error and never a
 * default of "anything". A first run therefore has Chrome tools that refuse
 * every origin, which is the correct starting position for a capability that
 * acts as the owner: it exists, it is proved live, and it can reach nowhere
 * until the owner names somewhere.
 *
 * WHO MAY WRITE IT. `addOrigin` is called from an OWNER-token route in the
 * daemon and from nowhere else. An agent cannot request an allowlist entry — see
 * the argument in `origins.ts`. It also cannot quietly become one: an origin on
 * the never-list is refused here as well as at use, so a widening that would
 * never take effect is not written down as though it had.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { neverCategory, parseOrigin, type OriginPolicy } from './origins.js';

/** The file name, relative to the workspace directory. Named here so both ends agree. */
export const ALLOWLIST_FILE = 'chrome-origins.json';

/** Read the owner's policy. Total: anything unreadable is an empty allowlist. */
export function readOriginPolicy(path: string): OriginPolicy {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { allowed: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { allowed: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) return { allowed: [] };
  const doc = parsed as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  const neverExtra = strings(doc['neverExtra']);
  // Omitted rather than empty, so a policy the owner never extended reads as one
  // list and not as two — the file, and every place that echoes it, says exactly
  // what they decided and nothing they did not.
  return { allowed: strings(doc['allowed']), ...(neverExtra.length > 0 ? { neverExtra } : {}) };
}

/** What an attempt to widen the allowlist came to. Never a throw. */
export type AddResult =
  | { readonly ok: true; readonly origin: string; readonly policy: OriginPolicy }
  | { readonly ok: false; readonly reason: string };

/**
 * Add one origin to the owner's allowlist, or say why not.
 *
 * The never-list is checked here as well as at use. An entry that would be
 * refused every time it was reached is not a grant, it is a misleading line in a
 * file the owner is supposed to be able to trust at a glance.
 */
export function addOrigin(path: string, raw: string): AddResult {
  const parsed = parseOrigin(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const current = readOriginPolicy(path);
  const never = neverCategory(new URL(parsed.origin).hostname, current.neverExtra ?? []);
  if (never !== null) {
    return {
      ok: false,
      reason: `${parsed.origin} is on Zeno's never-list (${never}), and the never-list is not something an allowlist can override.`,
    };
  }
  if (current.allowed.some((e) => { const p = parseOrigin(e); return p.ok && p.origin === parsed.origin; })) {
    return { ok: true, origin: parsed.origin, policy: current };
  }
  const next: OriginPolicy = {
    allowed: [...current.allowed, parsed.origin].sort(),
    ...(current.neverExtra ? { neverExtra: current.neverExtra } : {}),
  };
  writePolicy(path, next);
  return { ok: true, origin: parsed.origin, policy: next };
}

/** Remove one origin. Narrowing always succeeds — an origin that was never there is already gone. */
export function removeOrigin(path: string, raw: string): OriginPolicy {
  const parsed = parseOrigin(raw);
  const current = readOriginPolicy(path);
  if (!parsed.ok) return current;
  const next: OriginPolicy = {
    allowed: current.allowed.filter((e) => { const p = parseOrigin(e); return !(p.ok && p.origin === parsed.origin); }),
    ...(current.neverExtra ? { neverExtra: current.neverExtra } : {}),
  };
  writePolicy(path, next);
  return next;
}

function writePolicy(path: string, policy: OriginPolicy): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(policy, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** True when the owner has ever named an origin. Used only to say so out loud on startup. */
export function hasAllowlist(path: string): boolean {
  return existsSync(path) && readOriginPolicy(path).allowed.length > 0;
}
