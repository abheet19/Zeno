/**
 * The Policy & Approval Kernel — the state machine and the seven laws.
 *
 *   classify -> preview -> approve -> commit(revalidate -> one attempt -> receipt)
 *
 * Nothing external can happen except inside commit(), after CAS passes, exactly
 * once, and (for T1+) only with a single-use approval bound to that exact action.
 */
import { hashOf } from './hash.js';
import { Ledger, type Signer } from './ledger.js';
import {
  classify,
  DEFAULT_POLICY,
  policyHash,
  tierRank,
  validatePolicy,
  type Policy,
} from './policy.js';
import {
  PolicyError,
  type ActionHash,
  type ActionRequest,
  type Approval,
  type AuthEvidence,
  type Binding,
  type Executor,
  type Preview,
  type Receipt,
  type World,
} from './types.js';

type State =
  | 'PREVIEWED'
  | 'AUTO' // T0, not yet run
  | 'DENIED' // T4
  | 'APPROVED'
  | 'SPENT'; // consumed: a commit attempt happened (verified / unknown / denied / expired)

interface Record_ {
  readonly req: ActionRequest;
  readonly binding: Binding;
  state: State;
  approval: Approval | null;
  /** Kernel-private nonce that a valid approval must match (anti-forgery). */
  nonce: string | null;
}

export interface KernelOptions {
  readonly policy?: Policy;
  readonly signer?: Signer;
}

export class Kernel {
  private readonly policy: Policy;
  private readonly ledger: Ledger;
  private readonly pending = new Map<ActionHash, Record_>();

  constructor(
    private readonly world: World,
    opts: KernelOptions = {},
  ) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    validatePolicy(this.policy); // fail fast on a malformed policy
    this.ledger = new Ledger(opts.signer);
  }

  /** Pure classification — no state change. */
  classify(req: ActionRequest): { tier: Policy['kindTier'][keyof Policy['kindTier']]; reasons: readonly string[] } {
    const c = classify(req, this.policy);
    return { tier: c.tier, reasons: c.reasons };
  }

  /**
   * Prepare an action: compute its binding + identity, record it as PREVIEWED
   * (or AUTO for T0 / DENIED for T4). PURE with respect to the outside world —
   * looking at a preview never causes an effect. (L6: proposing ≠ doing.)
   */
  preview(req: ActionRequest): Preview {
    const { tier, reasons } = classify(req, this.policy);
    const binding: Binding = {
      payloadHash: hashOf(req.payload),
      baseHash: req.baseHash,
      targetRef: req.targetRef,
      tier,
      provenanceHash: hashOf({
        requestedBy: req.requestedBy,
        provenance: req.provenance ?? {},
        policyHash: policyHash(this.policy),
      }),
    };
    const actionHash = hashOf(binding);
    const state: State = tier === 'T4' ? 'DENIED' : tier === 'T0' ? 'AUTO' : 'PREVIEWED';
    this.pending.set(actionHash, { req, binding, state, approval: null, nonce: null });
    return {
      actionHash,
      binding,
      tier,
      summary: req.summary,
      reasons,
      auto: state === 'AUTO',
      denied: state === 'DENIED',
    };
  }

  /**
   * The OWNER channel. Binds a single-use approval to one exact action.
   * L7: T4 can never be approved. T2+ requires an authenticator.
   * There is no agent-callable approve — that is L6 in structure.
   */
  approve(actionHash: ActionHash, auth: AuthEvidence | null = null): Approval {
    const rec = this.mustFind(actionHash);
    if (rec.binding.tier === 'T4') {
      throw new PolicyError(
        't4-denied',
        'This action is prohibited (T4) and cannot be approved.',
        'There is no path to perform this. Do it yourself outside Zeno if it is legitimate.',
      );
    }
    if (rec.state !== 'PREVIEWED') {
      throw new PolicyError(
        'not-previewed',
        `Cannot approve an action in state ${rec.state}.`,
        'Re-preview the action, then approve the fresh preview.',
      );
    }
    if (tierRank(rec.binding.tier) >= tierRank('T2') && !auth) {
      throw new PolicyError(
        'missing-authenticator',
        `Tier ${rec.binding.tier} requires an authenticator.`,
        'Approve again with an authenticator (e.g. Windows Hello, or the deferred placeholder).',
      );
    }
    const nonce = this.world.id();
    const now = this.world.now();
    const approval: Approval = {
      actionHash,
      nonce,
      grantedAt: now,
      grantedByOwner: true,
      authenticator: auth,
      singleUse: true,
      expiresAt: new Date(Date.parse(now) + this.world.approvalTtlMs).toISOString(),
    };
    rec.approval = approval;
    rec.nonce = nonce;
    rec.state = 'APPROVED';
    return approval;
  }

  /**
   * Commit an action. For T0 this auto-proceeds; for T1+ it requires the exact
   * single-use approval issued for this action. Then:
   *   revalidate (CAS) -> if base drifted, REFUSE (approval UNSPENT) ->
   *   otherwise spend the approval and run the executor EXACTLY ONCE ->
   *   write a receipt. The success state derives only from that receipt (L5).
   */
  async commit(
    approvalOrActionHash: Approval | ActionHash,
    exec: Executor,
  ): Promise<Receipt> {
    const actionHash =
      typeof approvalOrActionHash === 'string'
        ? approvalOrActionHash
        : approvalOrActionHash.actionHash;
    const rec = this.mustFind(actionHash);

    // T4: prohibited. No path to commit. (L7)
    if (rec.binding.tier === 'T4' || rec.state === 'DENIED') {
      return this.write(rec, 'denied', 'Action is prohibited (T4).', rec.binding.baseHash, {
        effect: 'none',
      });
    }

    // T1+: require the exact approval this kernel issued. (L1, L4, L6)
    if (rec.state !== 'AUTO') {
      if (rec.state === 'SPENT') {
        return this.write(
          rec,
          'denied',
          'Approval already used (single-use).',
          rec.binding.baseHash,
          { effect: 'none' },
        );
      }
      if (typeof approvalOrActionHash === 'string' || rec.state !== 'APPROVED') {
        throw new PolicyError(
          'not-previewed',
          'This action has no valid owner approval.',
          'Preview then approve the action before committing.',
        );
      }
      const supplied = approvalOrActionHash;
      if (!rec.approval || supplied.nonce !== rec.nonce) {
        throw new PolicyError(
          'tuple-mismatch',
          'Approval does not match a kernel-issued approval for this action.',
          'Approvals cannot be forged or reused across actions — re-approve here.',
        );
      }
      if (Date.parse(this.world.now()) > Date.parse(rec.approval.expiresAt)) {
        return this.write(rec, 'expired', 'Approval expired before commit.', rec.binding.baseHash, {
          effect: 'none',
        });
      }
    }

    // Compare-and-swap: re-read the CURRENT base. If it drifted, refuse — and do
    // NOT spend the approval, so the owner can re-preview against the new base. (L3)
    const observed = this.world.readBase(rec.binding.targetRef);
    if (observed !== rec.binding.baseHash) {
      // approval stays unspent; return the action to PREVIEWED for a fresh cycle.
      if (rec.state === 'APPROVED') rec.state = 'PREVIEWED';
      return this.write(
        rec,
        'refused',
        `Base drifted (${rec.binding.baseHash.slice(0, 7)} -> ${observed.slice(0, 7)}); nothing applied.`,
        observed,
        { effect: 'none' },
      );
    }

    // Spend BEFORE the attempt, so a crash cannot yield a reuse. (L4)
    // Applies to both the APPROVED (T1+) and AUTO (T0) paths.
    rec.state = 'SPENT';

    // Exactly one attempt. No retry loop — an unprovable result is OUTCOME_UNKNOWN. (L2)
    try {
      const proof = await exec(rec.binding);
      return this.write(rec, 'verified', null, observed, proof);
    } catch (err) {
      const reason =
        err instanceof Error ? `executor error: ${err.message}` : 'executor failed';
      return this.write(rec, 'outcome-unknown', reason, observed, { effect: 'none' });
    }
  }

  verifyChain(): { ok: boolean; firstBreakAt?: number } {
    return this.ledger.verify();
  }

  receipts(): readonly Receipt[] {
    return this.ledger.all();
  }

  ledgerJSONL(): string {
    return this.ledger.toJSONL();
  }

  private mustFind(actionHash: ActionHash): Record_ {
    const rec = this.pending.get(actionHash);
    if (!rec) {
      throw new PolicyError(
        'unknown-action',
        'No previewed action with that hash.',
        'Call preview() first; commit only what was previewed.',
      );
    }
    return rec;
  }

  private write(
    rec: Record_,
    outcome: Receipt['outcome'],
    reason: string | null,
    casBaseObserved: string,
    externalEffect: Receipt['externalEffect'],
  ): Receipt {
    if (outcome !== 'refused') rec.state = 'SPENT';
    return this.ledger.append({
      id: this.world.id(),
      actionHash: hashOf(rec.binding),
      outcome,
      reason,
      casBaseObserved,
      externalEffect,
      at: this.world.now(),
    });
  }
}
