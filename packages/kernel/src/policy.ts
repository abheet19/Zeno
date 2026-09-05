/**
 * The risk-tier policy. Policy is DATA, not code: a plain object, schema-checked,
 * hash-pinned into every receipt so you can always prove which policy governed a
 * decision. Classification is deterministic and rounds UP on ambiguity, never down.
 */
import { hashOf } from './hash.js';
import type { ActionKind, ActionRequest, DataZone, Tier } from './types.js';
import { ACTION_KINDS, DATA_ZONES, PolicyError } from './types.js';

const TIER_ORDER: readonly Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

export function tierRank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}

export function maxTier(a: Tier, b: Tier): Tier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export interface Policy {
  readonly version: string;
  /** Base tier per action kind. */
  readonly kindTier: Readonly<Record<ActionKind, Tier>>;
  /** Tier floor forced by a data zone (e.g. financial -> T4). */
  readonly zoneTier: Readonly<Partial<Record<DataZone, Tier>>>;
}

/** The default, reviewable policy. A signed override file replaces this later. */
export const DEFAULT_POLICY: Policy = {
  version: '2026-08-29.1',
  kindTier: {
    read: 'T0',
    'local.write': 'T0',
    'patch.task': 'T1',
    'vcs.commit': 'T1',
    'jira.write': 'T2',
    'vcs.push': 'T2',
    'message.send': 'T2',
    'vcs.mr': 'T3',
    'settings.change': 'T3',
    destructive: 'T3',
    payment: 'T4',
  },
  zoneTier: {
    financial: 'T4',
  },
};

/** Validate policy shape. Throws PolicyError on a malformed policy — never guesses. */
export function validatePolicy(p: Policy): void {
  if (!p || typeof p.version !== 'string' || !p.version) {
    throw new PolicyError(
      'policy-schema-invalid',
      'Policy is missing a version.',
      'Supply a policy.json with a non-empty version string.',
    );
  }
  for (const k of ACTION_KINDS) {
    const t = p.kindTier[k];
    if (!t || !TIER_ORDER.includes(t)) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Policy has no valid tier for action kind "${k}".`,
        `Add "${k}" to policy.kindTier with a tier T0–T4.`,
      );
    }
  }
  // A zone the kernel does not recognise, or a tier it cannot rank, would be
  // silently skipped by classify() — leaving a policy that READS stricter than it
  // behaves. Ambiguity must round up, so refuse to load it at all.
  const zoneTier: Readonly<Partial<Record<string, Tier>>> = p.zoneTier ?? {};
  for (const zone of Object.keys(zoneTier)) {
    if (!(DATA_ZONES as readonly string[]).includes(zone)) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Policy zoneTier names an unknown data zone "${zone}".`,
        `Use one of: ${DATA_ZONES.join(', ')} — a misspelled zone would silently never apply.`,
      );
    }
    const zt = zoneTier[zone];
    if (zt !== undefined && !TIER_ORDER.includes(zt)) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Policy zone "${zone}" has an invalid tier "${String(zt)}".`,
        `Use a tier T0–T4 for "${zone}", or remove it.`,
      );
    }
  }

  // A policy that fails to deny payments is not a valid Zeno policy.
  if (p.kindTier.payment !== 'T4') {
    throw new PolicyError(
      'policy-schema-invalid',
      'Policy must classify "payment" as T4.',
      'Set policy.kindTier.payment = "T4"; payments are prohibited by design.',
    );
  }
  // L7 has two halves. Enforcing only the payment half would let a policy file
  // quietly delete the financial floor, so anything merely TOUCHING financial
  // data would fall back to its kind's tier and become approvable.
  if (zoneTier.financial !== 'T4') {
    throw new PolicyError(
      'policy-schema-invalid',
      'Policy must keep the "financial" data zone at T4.',
      'Set policy.zoneTier.financial = "T4"; anything touching financial data is prohibited by design.',
    );
  }
}

export function policyHash(p: Policy): string {
  return hashOf(p);
}

/**
 * Parse a policy document. Pure: it takes the text, never a path, so file
 * reading stays in `policy-node-fs.ts`.
 *
 * Every failure is a legible `PolicyError` naming the single thing to fix. A
 * policy is never partially applied, guessed at, or quietly replaced by the
 * default — the unreadable one may well be the stricter of the two.
 */
export function loadPolicy(text: string): Policy {
  let parsed: unknown;
  try {
    // Strip a leading UTF-8 byte-order mark. Every Windows editor — Notepad,
    // VS Code's default, PowerShell's `Set-Content -Encoding utf8` — writes one,
    // and it wraps the FILE rather than being part of the policy. Refusing to
    // start because of it would mean the owner cannot edit their own policy with
    // the tools they actually have.
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new PolicyError(
      'policy-schema-invalid',
      `Policy is not valid JSON: ${err instanceof Error ? err.message : 'parse failed'}`,
      'Fix the syntax in policy.json, or delete the file to fall back to the built-in policy.',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PolicyError(
      'policy-schema-invalid',
      'Policy must be a JSON object.',
      'Wrap the policy in { } with "version", "kindTier" and optionally "zoneTier".',
    );
  }
  const p = parsed as Partial<Policy>;
  if (typeof p.kindTier !== 'object' || p.kindTier === null || Array.isArray(p.kindTier)) {
    throw new PolicyError(
      'policy-schema-invalid',
      'Policy is missing a "kindTier" object.',
      'Add "kindTier" mapping every action kind to a tier T0–T4.',
    );
  }
  if (
    p.zoneTier !== undefined &&
    (typeof p.zoneTier !== 'object' || p.zoneTier === null || Array.isArray(p.zoneTier))
  ) {
    throw new PolicyError(
      'policy-schema-invalid',
      '"zoneTier" must be an object when present.',
      'Map each data zone to the tier floor it forces, or omit "zoneTier" entirely.',
    );
  }
  const policy: Policy = {
    version: p.version as string,
    kindTier: p.kindTier,
    zoneTier: p.zoneTier ?? {},
  };
  validatePolicy(policy); // version, every kind, every zone, and payment === T4
  return policy;
}

export interface Classification {
  readonly tier: Tier;
  readonly reasons: readonly string[];
}

/** Deterministically classify a request. Ambiguity rounds up. */
export function classify(req: ActionRequest, policy: Policy): Classification {
  const reasons: string[] = [];
  // Ambiguity rounds UP. A kind the policy has never heard of is not "no rules
  // apply" — an undefined tier would sail straight past the T2 authenticator
  // gate AND the T4 denial, which is the one direction this must never fail in.
  const known = policy.kindTier[req.kind];
  let tier: Tier = known ?? 'T4';
  reasons.push(
    known === undefined
      ? `kind "${req.kind}" is not in the policy -> T4 (prohibited)`
      : `kind "${req.kind}" -> ${tier}`,
  );

  for (const zone of req.dataZones) {
    if (!(DATA_ZONES as readonly string[]).includes(zone)) {
      // Same rule as an unknown kind. A zone nobody has classified is not
      // "harmless by default" — treating it that way fails open.
      if (tierRank('T4') > tierRank(tier)) tier = 'T4';
      reasons.push(`data zone "${zone}" is not recognised -> T4 (prohibited)`);
      continue;
    }
    const zt = policy.zoneTier[zone];
    if (zt && tierRank(zt) > tierRank(tier)) {
      tier = zt;
      reasons.push(`data zone "${zone}" raises tier -> ${zt}`);
    }
  }
  return { tier, reasons };
}
