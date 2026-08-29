/**
 * The risk-tier policy. Policy is DATA, not code: a plain object, schema-checked,
 * hash-pinned into every receipt so you can always prove which policy governed a
 * decision. Classification is deterministic and rounds UP on ambiguity, never down.
 */
import { hashOf } from './hash.js';
import type { ActionKind, ActionRequest, DataZone, Tier } from './types.js';
import { PolicyError } from './types.js';

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
  const kinds: ActionKind[] = [
    'read',
    'local.write',
    'patch.task',
    'vcs.commit',
    'vcs.push',
    'vcs.mr',
    'jira.write',
    'message.send',
    'settings.change',
    'payment',
    'destructive',
  ];
  for (const k of kinds) {
    const t = p.kindTier[k];
    if (!t || !TIER_ORDER.includes(t)) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Policy has no valid tier for action kind "${k}".`,
        `Add "${k}" to policy.kindTier with a tier T0–T4.`,
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
}

export function policyHash(p: Policy): string {
  return hashOf(p);
}

export interface Classification {
  readonly tier: Tier;
  readonly reasons: readonly string[];
}

/** Deterministically classify a request. Ambiguity rounds up. */
export function classify(req: ActionRequest, policy: Policy): Classification {
  const reasons: string[] = [];
  let tier: Tier = policy.kindTier[req.kind];
  reasons.push(`kind "${req.kind}" -> ${tier}`);

  for (const zone of req.dataZones) {
    const zt = policy.zoneTier[zone];
    if (zt && tierRank(zt) > tierRank(tier)) {
      tier = zt;
      reasons.push(`data zone "${zone}" raises tier -> ${zt}`);
    }
  }
  return { tier, reasons };
}
