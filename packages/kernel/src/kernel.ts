/**
 * The Policy & Approval Kernel — the state machine and the seven laws.
 *
 *   classify -> preview -> approve -> commit(revalidate -> one attempt -> receipt)
 *
 * Nothing external can happen except inside commit(), after CAS passes, exactly
 * once, and (for T1+) only with a single-use approval bound to that exact action.
 */
import { hashOf } from './hash.js';
import { Ledger, type LedgerStore, type Signer } from './ledger.js';
import type { ReceiptSigner } from './signer.js';
import {
  classify,
  DEFAULT_POLICY,
  policyHash,
  tierRank,
  validatePolicy,
  type Classification,
  type Policy,
} from './policy.js';
import {
  PolicyError,
  type ActionHash,
  type ActionRequest,
  type Approval,
  type AuthEvidence,
  type Binding,
  type EffectProof,
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

interface PendingAction {
  readonly req: ActionRequest;
  readonly binding: Binding;
  /** The action's identity — hashOf(binding), computed once at preview. */
  readonly actionHash: ActionHash;
  state: State;
  approval: Approval | null;
  /** Kernel-private nonce that a valid approval must match (anti-forgery). */
  nonce: string | null;
}

export interface ApproveOptions {
  /**
   * Who is granting this approval. Supplying it enables the L6 self-approval
   * check — an agent that proposed an action can never also approve it.
   */
  readonly approver?: string;
}

export interface KernelOptions {
  readonly policy?: Policy;
  readonly signer?: Signer;
  /**
   * Durable home for the receipt chain. When given, an existing ledger is read
   * and verified at construction and every new receipt is written through, so
   * receipts survive a restart. Omit it for a purely in-memory kernel (tests).
   */
  readonly store?: LedgerStore;
  /**
   * When given, every receipt is Ed25519-signed, making the ledger tamper-PROOF
   * (not merely tamper-evident). Verify with `verifyReceiptSignatures(pubKey)`.
   */
  readonly receiptSigner?: ReceiptSigner;
}

export class Kernel {
  private readonly policy: Policy;
  /** Hash of the governing policy — recorded on every receipt. Computed once. */
  private readonly govPolicyHash: string;
  private readonly ledger: Ledger;
  private readonly receiptSigner: ReceiptSigner | null;
  private readonly pending = new Map<ActionHash, PendingAction>();

  constructor(
    private readonly world: World,
    opts: KernelOptions = {},
  ) {
    this.policy = opts.policy ?? DEFAULT_POLICY;
    validatePolicy(this.policy); // fail fast on a malformed policy
    this.govPolicyHash = policyHash(this.policy);
    this.receiptSigner = opts.receiptSigner ?? null;
    this.ledger = opts.store
      ? Ledger.load(opts.store, opts.signer, this.receiptSigner)
      : new Ledger(opts.signer, null, this.receiptSigner);
    // Read AND verify on boot. Appending real effects onto a ledger that is
    // already broken would bury the evidence of whatever broke it, and welds
    // new receipts onto a damaged tail.
    const status = this.ledger.verify();
    if (!status.ok) {
      throw new PolicyError(
        'chain-broken',
        `The receipt ledger is broken at index ${status.firstBreakAt} — ${status.reason}.`,
        'Inspect it with `zeno verify`, then move the damaged ledger aside to start a fresh chain. Do not edit it back into shape.',
      );
    }
  }

  /** Pure classification — no state change. */
  classify(req: ActionRequest): Classification {
    return classify(req, this.policy);
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
      // `kind` is part of the identity: without it two actions with the same
      // payload and target at the same tier share one actionHash.
      kind: req.kind,
      tier,
      provenanceHash: hashOf({
        requestedBy: req.requestedBy,
        // The sentence the owner is shown is part of what they approved. Leave
        // it out and a receipt can record wording nobody ever agreed to.
        summary: req.summary,
        provenance: req.provenance ?? {},
        policyHash: this.govPolicyHash,
      }),
    };
    const actionHash = hashOf(binding);
    const existing = this.pending.get(actionHash);
    // Memory OR the durable ledger. Consulting only memory meant a restart —
    // or a swept pending map — handed a spent action a second life.
    const spent = existing?.state === 'SPENT' || this.ledger.hasTerminal(actionHash);
    const state: State = tier === 'T4' ? 'DENIED' : tier === 'T0' ? 'AUTO' : 'PREVIEWED';
    // L2/L4: this exact action already had its one attempt. Re-previewing must
    // not hand it a second life, or "no retry after an unknown outcome" becomes
    // "retry by asking again".
    if (spent) {
      // Keep it visible as SPENT so a commit attempt produces an auditable
      // `denied` RECEIPT rather than an exception. After a restart the pending
      // map is empty but the ledger still knows, and the owner deserves the
      // refusal on the record either way.
      this.pending.set(actionHash, {
        req,
        binding,
        actionHash,
        state: 'SPENT',
        approval: existing?.approval ?? null,
        nonce: existing?.nonce ?? null,
      });
    } else {
      this.pending.set(actionHash, { req, binding, actionHash, state, approval: null, nonce: null });
    }
    return {
      actionHash,
      binding,
      tier,
      summary: req.summary,
      reasons,
      auto: !spent && state === 'AUTO',
      denied: state === 'DENIED',
    };
  }

  /**
   * The OWNER channel. Binds a single-use approval to one exact action.
   * L7: T4 can never be approved. T2+ requires an authenticator.
   * There is no agent-callable approve — that is L6 in structure.
   */
  approve(
    actionHash: ActionHash,
    auth: AuthEvidence | null = null,
    opts: ApproveOptions = {},
  ): Approval {
    const rec = this.mustFind(actionHash);
    // L6, in the type system rather than by convention: whoever proposed an
    // action can never be the one who approves it. The daemon additionally
    // makes this a process boundary, but the rule belongs here too.
    if (opts.approver !== undefined && opts.approver === rec.req.requestedBy) {
      throw new PolicyError(
        'self-approval-forbidden',
        `"${opts.approver}" proposed this action and so cannot also approve it.`,
        'An approval must come from the owner channel, never from the agent that asked for it.',
      );
    }
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
      approvedBy: opts.approver ?? null,
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
    let proof: EffectProof;
    try {
      proof = await exec(rec.binding);
    } catch (err) {
      const reason =
        err instanceof Error ? `executor error: ${err.message}` : 'executor failed';
      return this.write(rec, 'outcome-unknown', reason, observed, { effect: 'none' });
    }
    // Deliberately OUTSIDE that catch. A failure to RECORD a real effect must
    // surface as a thrown error; recording it as "the executor failed and
    // nothing happened" would be the exact opposite of the truth.
    return this.write(rec, 'verified', null, observed, proof);
  }

  verifyChain(): { ok: boolean; firstBreakAt?: number } {
    return this.ledger.verify();
  }

  /** Tamper-PROOF check: every receipt was signed by the key holder. */
  verifyReceiptSignatures(publicKeyPem: string): { ok: boolean; firstBadAt?: number; unsigned: number } {
    return this.ledger.verifySignatures(publicKeyPem);
  }

  /** The public key receipts are signed with, or null when unsigned. */
  signerPublicKey(): string | null {
    return this.receiptSigner?.publicKeyPem ?? null;
  }

  receipts(): readonly Receipt[] {
    return this.ledger.all();
  }

  ledgerJSONL(): string {
    return this.ledger.toJSONL();
  }

  private mustFind(actionHash: ActionHash): PendingAction {
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
    rec: PendingAction,
    outcome: Receipt['outcome'],
    reason: string | null,
    casBaseObserved: string,
    externalEffect: Receipt['externalEffect'],
  ): Receipt {
    if (outcome !== 'refused') rec.state = 'SPENT';
    return this.ledger.append({
      id: this.world.id(),
      actionHash: rec.actionHash,
      outcome,
      reason,
      casBaseObserved,
      externalEffect,
      at: this.world.now(),
      // v2: everything a capsule or a history row needs, from this line alone.
      schemaVersion: 2,
      kind: rec.req.kind,
      tier: rec.binding.tier,
      targetRef: rec.binding.targetRef,
      summary: rec.req.summary,
      policyHash: this.govPolicyHash,
    });
  }
}
