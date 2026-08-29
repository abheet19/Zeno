/**
 * Zeno · P1-01 · Policy & Approval Kernel — domain types.
 *
 * The kernel is the deterministic "security desk": the AI may propose anything,
 * but nothing becomes a real effect except through the state machine defined here.
 * No UI, no LLM, no network. See LLD-P1-01.
 */

/** Risk tiers. Higher = more dangerous. T4 is prohibited outright. */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

/** Kinds of action the kernel can gate. */
export type ActionKind =
  | 'read' // no external effect            -> T0
  | 'local.write' // isolated worktree/scratch write -> T0
  | 'patch.task' // TASK-section-only patch handoff -> T1
  | 'vcs.commit'
  | 'vcs.push'
  | 'vcs.mr'
  | 'jira.write'
  | 'message.send'
  | 'settings.change'
  | 'payment' // -> T4 always (denied)
  | 'destructive'; // delete / overwrite / revoke-lease

/** Which data zones an action touches. `financial` forces T4. */
export type DataZone =
  | 'personal'
  | 'company'
  | 'cloud'
  | 'external'
  | 'financial'
  | 'ephemeral';

/** A proposed action. Produced by an agent; never self-approving. */
export interface ActionRequest {
  readonly kind: ActionKind;
  /** One human sentence shown in the preview. */
  readonly summary: string;
  /** Opaque reference to what is touched: `repo@HEAD`, `ticket@version`, `resource@etag`. */
  readonly targetRef: string;
  /** The exact bytes/fields to be applied. Hashed, never inspected for meaning. */
  readonly payload: unknown;
  /** Hash of the base state this action expects to mutate (as seen at preview). */
  readonly baseHash: string;
  /** Which agent proposed this. The kernel never lets a proposer approve. */
  readonly requestedBy: string;
  readonly dataZones: readonly DataZone[];
  /** Opaque provenance (pack hash, skills manifest, model id, scopes…) — recorded, not verified. */
  readonly provenance?: Readonly<Record<string, string>>;
}

/**
 * The tuple an approval is bound to. Its hash IS the action's identity.
 * Only four fields are safety-verified at commit; everything else rides in
 * `provenanceHash` (recorded + replayable, not individually validated).
 */
export interface Binding {
  readonly payloadHash: string;
  readonly baseHash: string;
  readonly targetRef: string;
  readonly tier: Tier;
  readonly provenanceHash: string;
}

export type ActionHash = string;

/** Evidence that a T2+ approval was authenticated. Opaque here; the broker slice fills it. */
export interface AuthEvidence {
  readonly method: string; // e.g. 'windows-hello' | 'deferred-placeholder'
  readonly ref: string; // opaque token, never a raw secret
}

/** A single-use, hash-bound approval. Issued only by the owner channel. */
export interface Approval {
  readonly actionHash: ActionHash;
  /** Private kernel-issued nonce — proves this approval was issued here, not forged. */
  readonly nonce: string;
  readonly grantedAt: string;
  readonly grantedByOwner: true;
  readonly authenticator: AuthEvidence | null;
  readonly singleUse: true;
  readonly expiresAt: string;
}

export type Outcome =
  | 'verified'
  | 'refused'
  | 'denied'
  | 'expired'
  | 'outcome-unknown';

/** What the executor proves it did. `none` means no external effect occurred. */
export interface EffectProof {
  readonly effect: 'none' | string; // provider receipt id, or 'none'
}

/** An append-only, hash-chained ledger entry. */
export interface Receipt {
  readonly id: string;
  readonly actionHash: ActionHash;
  readonly outcome: Outcome;
  /** Required on every non-verified outcome. */
  readonly reason: string | null;
  /** Base hash actually observed at commit (for CAS transparency). */
  readonly casBaseObserved: string;
  readonly externalEffect: EffectProof;
  /** Hash of the previous receipt (chain link); null for the genesis entry. */
  readonly prevReceipt: string | null;
  /** Hash over this receipt's own content + prevReceipt. */
  readonly selfHash: string;
  readonly at: string;
}

export interface Preview {
  readonly actionHash: ActionHash;
  readonly binding: Binding;
  readonly tier: Tier;
  readonly summary: string;
  readonly reasons: readonly string[];
  /** True when the action is auto-approved (T0) and needs no owner yes. */
  readonly auto: boolean;
  /** True when the action is prohibited (T4) and can never commit. */
  readonly denied: boolean;
}

/**
 * The injected world. The kernel NEVER calls Date.now / Math.random / the network
 * directly — everything non-deterministic arrives here, which is what makes the
 * whole engine replayable and testable.
 */
export interface World {
  /** Monotonic-ish wall clock as ISO-8601. */
  now(): string;
  /** Fresh opaque id. */
  id(): string;
  /** Re-read the CURRENT base hash for a target, for compare-and-swap at commit. */
  readBase(targetRef: string): string;
  /** Approval time-to-live in milliseconds. */
  approvalTtlMs: number;
}

/** The executor callback. Supplied by an executor slice — the kernel never imports one. */
export type Executor = (bound: Binding) => Promise<EffectProof>;

export type PolicyErrorCode =
  | 't4-denied'
  | 'approval-already-used'
  | 'approval-expired'
  | 'base-drifted'
  | 'tuple-mismatch'
  | 'self-approval-forbidden'
  | 'missing-authenticator'
  | 'unknown-action'
  | 'not-previewed'
  | 'policy-schema-invalid'
  | 'chain-broken';

/** A user-legible policy error. Never carries a raw secret or redacted payload. */
export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
    /** The one action that resolves this, in plain words. */
    readonly resolve: string,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}
