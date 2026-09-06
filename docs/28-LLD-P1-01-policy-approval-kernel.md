# LLD · P1-01 · Policy & Approval Kernel (the Gateway)

**Slice:** P1-01 — first Phase-1 slice · **Wave A** (needs only Gate 1; no B-002, no UI)
**Gate status:** Gate 1 ✓ · Gate 2 ✓ (2026-08-28). This LLD is the per-slice gate; **no code is written until you approve this document.**
**Target host:** Windows 11 pilot (RTX 3080 12 GB · R7 7700X · 32 GB). Headless. **Nothing on the work Mac.**
**Language:** TypeScript (Node ≥ 20, ESM). Zero network. Zero LLM. Deterministic.
**Author:** Zeno build · 2026-08-29 · **for owner approval.**

---

## In plain words (read this first)

**Think of this as the security desk between Zeno's "thinking" and the real world.** The AI can *think*
anything and *propose* anything — but it can never actually *do* something (push code, write a Jira
ticket, send a message) without walking up to this desk first. The desk: checks how risky the action is,
shows you exactly what will happen, waits for your yes, checks that nothing changed while you were
deciding, lets it through **exactly once**, and stamps a receipt. Payments and anything forbidden don't
get a desk pass at all.

This slice builds **only that desk** — no screens, no AI, no internet. Small, boring, and provable, so
the exciting parts built on top of it can be trusted. Every heading below has a plain-language line before
the technical detail.

---

## 0. Why this slice is first

Every promise in the whole suite — "Reason before action", the approval capsule you clicked, the drift
refusal, the receipt-gated seal — is *this component*. It is the deterministic policy engine that sits
**outside every model** and is the only thing in the system allowed to turn a proposal into an effect.

If it is correct, no agent, no model, no bug, and no prompt-injection can cause an unapproved or
double-applied external effect. If it is wrong, nothing above it can be trusted. So it is built first,
alone, with no UI and no model, where it can be tested exhaustively in isolation.

It depends on nothing. Sanitizer, credential broker, Forge, Counsel and every executor depend on **it**.

---

## 1. Scope

**In scope (this slice builds exactly this):**

1. A **risk-tier classifier** — maps a proposed action to a tier `T0–T4` from a static, declarative policy.
2. A **contract state machine** enforcing `prepare → preview → approve → revalidate → commit(one attempt) → verify/reconcile` for every consequential action.
3. An **approval binding** — an approval is cryptographically bound to one exact action via a hash tuple, and is **single-use**.
4. A **compare-and-swap commit** — at commit, the bound base is re-read; if it drifted, the single attempt is **refused**, not applied (the drift refusal the prototype shows).
5. An **append-only receipt ledger** — every terminal outcome writes a hash-chained receipt (cryptographic signing arrives with the later Signer slice — v1 is tamper-evident, not tamper-proof, and says so). **A success seal may only be derived from a receipt.**
6. A deterministic **decision API** the rest of the system calls; and a headless **simulator** to exercise it.

**Explicitly NOT in this slice (each is its own later slice):**

- No UI. (The Gate-2 prototype is the *design*; this slice is the engine it will later call.)
- No LLM, no model routing, no context assembly.
- No actual executors (no file writes, no Jira calls, no git). This slice decides and records; it hands an **approved, bound token** to an executor slice that does the effect. It never performs the effect itself.
- No credential handling (credential-broker slice).
- No sanitizer (its own slice) — though the ledger is written so the sanitizer can gate egress later.
- No networking of any kind.

---

## 2. Core domain types

```ts
// All ids are opaque, URL-safe, 128-bit. All hashes are SHA-256 hex unless noted.

export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export type ActionKind =
  | 'read'            // no external effect  -> always T0
  | 'local.write'     // writes inside an isolated worktree/scratch root
  | 'patch.task'      // the TASK-section-only patch handoff
  | 'shell.exec'      // a command on the owner's real machine  -> T3
  | 'net.fetch'       // bytes leave this machine, or arrive     -> T2
  | 'vcs.commit' | 'vcs.push' | 'vcs.mr'
  | 'jira.write'
  | 'message.send'
  | 'settings.change'
  | 'payment'         // -> always T4 (denied)
  | 'destructive';    // delete/overwrite/revoke-lease

export interface ActionRequest {
  kind: ActionKind;
  summary: string;            // human sentence shown in the preview
  target: TargetRef;          // what it touches (repo@HEAD, file, ticket, recipient…)
  payload: unknown;           // the exact bytes/fields to be applied
  requestedBy: AgentRef;      // which agent proposed it (never self-approves)
  dataZones: DataZone[];      // personal | company | cloud | external | financial | ephemeral
}

export interface Binding {                 // the tuple an approval is bound to
  // — the four fields the kernel actually VERIFIES at commit —
  payloadHash: string;                      // hash(payload): what will be applied
  baseHash: string;                         // hash of the exact base state to be mutated
  targetRef: string;                        // repo@HEAD | ticket@version | resource@etag
  tier: Tier;
  // — everything else (packHash, skills manifest, model id, permission scopes)
  //   rides as ONE opaque hash: recorded, displayed in the capsule, replayable —
  //   but not individually validated by v1. Fewer moving parts, same actionHash guarantee.
  provenanceHash: string;
}

export type ActionHash = string;            // = sha256(canonicalJSON(Binding))

export interface Approval {
  actionHash: ActionHash;                   // exactly one action
  grantedAt: string;                        // ISO-8601 from injected clock
  grantedByOwner: true;                     // approvals come only from the owner
  authenticator?: AuthEvidence;             // required iff tier >= T2
  singleUse: true;
  expiresAt: string;
}

export interface Receipt {
  id: string;
  actionHash: ActionHash;
  outcome: 'verified' | 'refused' | 'denied' | 'expired' | 'outcome-unknown';
  reason?: string;                          // required on every non-verified outcome
  casBaseObserved: string;                  // base hash actually seen at commit
  externalEffect: EffectSummary;            // provider receipt id, or 'none'
  prevReceipt: string | null;               // hash chain
  selfHash: string;                         // sha256 over the above (chain link)
  at: string;                               // injected clock
}
```

**Determinism rule:** the kernel receives its clock, its id generator and its randomness through an
injected `Env` interface. It never calls `Date.now()`, `Math.random()` or the network directly. This is
what makes the whole thing replayable and testable, and is a hard review criterion.

---

## 3. The contract state machine

One instance per action. States and the **only** legal transitions:

```
                 classify
  (start) ───────────────────────▶ CLASSIFIED
                                       │ tier === 'T4'
                                       ├───────────────▶ DENIED  (terminal, receipt)
                                       │ tier === 'T0'
                                       ├───────────────▶ AUTO_OK (terminal, receipt: verified, no approval)
                                       │ tier T1..T3
                                       ▼
                                    PREVIEWED ──expire──▶ EXPIRED (terminal, receipt)
                                       │ owner approves (binds actionHash)
                                       ▼
                                    APPROVED  ──expire──▶ EXPIRED
                                       │ revalidate()  (re-read base, re-hash tuple)
                     drift / tuple mismatch │             │ tuple still equal
                                            ▼             ▼
                                         REFUSED       COMMITTING
                                        (terminal,        │ exactly ONE attempt
                                         receipt)         ├── effect proven ──▶ VERIFIED (terminal, receipt)
                                                          └── unprovable ─────▶ OUTCOME_UNKNOWN (terminal, receipt, retry frozen)
```

**Laws (each is a test):**

- **L1 — no skip:** a consequential action cannot reach `COMMITTING` without passing `APPROVED` for its own `actionHash`.
- **L2 — one attempt:** `COMMITTING` runs the executor callback exactly once. No retry loop, ever. An unprovable result becomes `OUTCOME_UNKNOWN`, never a silent re-try.
- **L3 — CAS:** entering `COMMITTING` re-reads the base and recomputes the tuple. If `baseHash` changed → `REFUSED`, approval **not** spent, nothing applied.
- **L4 — single-use:** an `Approval` is consumed on the transition out of `APPROVED`. A second use → `DENIED (reason: approval-already-used)`.
- **L5 — seal-after-receipt:** `VERIFIED` is only reachable after a `Receipt` with `outcome:'verified'` is durably written. No caller may render success before that receipt exists.
- **L6 — no self-approval:** `requestedBy` (agent) can never be the approver; approver is always the owner channel.
- **L7 — T4 is absolute:** `payment` and anything classified `T4` reaches only `DENIED`. No override path exists in code.

---

## 4. Risk-tier policy (declarative, static, reviewable)

Policy is data, not code — a single `policy.json` the kernel loads, validates against a schema, and **hash-pins**: the policy file's hash is recorded in every receipt, so you can always prove which policy governed a decision. (Signing the policy file arrives with the Signer slice; v1 does not pretend to have keys it doesn't.)

| Tier | Meaning | Examples | Gate |
|---|---|---|---|
| **T0** | No external effect | read, list, inspect, local worktree write in scratch | auto-proceeds, still receipted |
| **T1** | Effect, low blast radius, reversible | TASK-section patch handoff, draft creation | owner approval, no fresh auth |
| **T2** | External write, real blast radius | `jira.write`, `vcs.push`, `message.send` | owner approval **+ authenticator** |
| **T3** | High blast radius / broad scope | `vcs.mr`, `settings.change`, multi-target | owner approval + authenticator + scope re-confirm |
| **T4** | Prohibited | `payment`, permission bypass, undetectable mode | **DENIED always** |

Classification is deterministic: `classify(req) = max(tier(kind), tier(dataZones), tier(blastRadius))`.
`payment` or `financial` data zone forces `T4`. Ambiguity rounds **up**, never down.

---

## 5. Persistence — the append-only ledger

- A single append-only file (JSONL) on the pilot's local disk. Each line is one `Receipt` or one
  `Approval`, hash-chained via `prevReceipt`/`selfHash`.
- **Tamper-evidence:** any edit or deletion breaks the chain; a `verifyChain()` call walks it and reports
  the first break. (Not tamper-*proof* — that needs the later signing-key slice; this slice leaves the
  seam: `selfHash` is computed by an injected `Signer` that is a plain SHA-256 now and an HSM/keypair later.)
- No secrets, no payloads-in-clear beyond what the receipt needs; raw secrets never enter the ledger
  (enforced by a `redact()` pass — a reproducibility receipt records *that* a value existed, never the value).

---

## 6. Public API (what the rest of the suite calls)

```ts
export interface Kernel {
  classify(req: ActionRequest): { tier: Tier; reasons: string[] };
  preview(req: ActionRequest): Preview;                 // pure; no effect; returns the bound tuple + actionHash
  approve(actionHash: ActionHash, auth?: AuthEvidence): Approval;   // owner-only channel; may throw PolicyError
  commit(approval: Approval, exec: Executor): Promise<Receipt>;     // revalidate → one attempt → receipt
  verifyChain(): { ok: boolean; firstBreakAt?: number };
}
export type Executor = (bound: Binding) => Promise<EffectProof>;    // supplied by an executor slice, never by this one
```

`commit` is the only async method and the only place an effect *can* happen — and even then only through
the injected `Executor`, exactly once, after CAS passes.

---

## 7. Error taxonomy (every one is user-legible, none is a stack trace)

`PolicyError` with a stable `code`: `t4-denied`, `approval-already-used`, `approval-expired`,
`base-drifted`, `tuple-mismatch`, `self-approval-forbidden`, `missing-authenticator`,
`policy-schema-invalid`, `chain-broken`. Each carries the one action that resolves it. No error ever
exposes a raw secret or a payload it was told to redact.

---

## 8. Security properties this slice guarantees

- **No unapproved effect:** L1 + the fact that effects only happen inside `commit(approval, …)`.
- **No double effect:** L2 + L4 (one attempt, single-use approval).
- **No effect on drifted state:** L3 (CAS).
- **No forged success:** L5 (seal derives from a written receipt only).
- **No self-authorization / injection-to-action:** L6 — an instruction found in data can *propose* (agent),
  but only the owner channel approves, and only for one exact `actionHash`. This is the structural answer
  to prompt-injection: a malicious string can reach `PREVIEWED` at most, never `COMMITTING`.
- **No prohibited effect:** L7 (T4 has no code path to commit).

---

## 9. Test & acceptance plan (built with the slice; this is how you'll see it's done)

- **Property tests** (fast-check) for each law L1–L7, over randomized action streams — e.g. *no generated
  sequence ever reaches VERIFIED without a matching single-use approval*, *no sequence double-applies*.
- **CAS test:** approve, mutate base underneath, commit → asserts `REFUSED`, approval unspent, zero effect.
- **Injection test:** feed adversarial payloads/summaries; assert none advances past `PREVIEWED` without an owner approval bound to its exact hash.
- **Chain test:** corrupt one ledger line; `verifyChain()` reports the exact break.
- **Determinism test:** same inputs + same injected `Env` ⇒ byte-identical ledger (replayable).
- **Maps to acceptance IDs:** `SUITE-AC-06` (lease/kill semantics hook), the action-contract IDs, and the
  drift/single-use rows. Full ID mapping table ships in the slice's `acceptance.csv`.

**Definition of done:** all laws green as property tests; simulator can drive every path shown in the
Gate-2 Command capsule (await → commit → verified, and await → drift → refused) headlessly; `verifyChain`
passes on a clean run and localizes a break on a dirtied one; 100% of the public API covered; zero
network imports (enforced by a lint rule); runs on the Windows pilot under Node 20.

---

## 10. Dependencies & seams left for later slices

| Later slice | Seam this LLD leaves |
|---|---|
| Signing-key / attestation | `Signer` interface (SHA-256 now → keypair/HSM later) |
| Credential broker | `AuthEvidence` is opaque here; broker fills it |
| Sanitizer | ledger + `dataZones` present so egress can be gated later |
| Executors (git, Jira, patch) | `Executor` callback contract; this slice never imports one |
| UI (Wave C) | `preview()`/`Receipt` shapes are exactly what the Command capsule renders |

---

## 10.5 Simplicity pass — what v1 deliberately does NOT have

Reviewed for overcomplication (owner asked). v1 has **no** policy-file signing (hash-pinned instead),
**no** receipt signing (hash-chained; Signer slice later), **no** multi-approver or delegation, **no**
per-tier expiry ladder (one TTL), **no** database (one JSONL file), **no** plugin system, **no** config
beyond `policy.json`. Binding verifies four fields; provenance rides as one opaque hash. Every one of
these is a seam, not a wall — each can be added later without changing the seven laws. The laws are the
product; everything else stays as small as honesty allows.

## 11. What I need from you

1. **Approve this LLD** to unlock writing *only this slice's* code (still no commit/push by me; you land git).
2. **One decision:** for **T2** on the pilot, is the "authenticator" a **local OS credential prompt
   (Windows Hello)**, or a **second explicit confirendation step** for now with real auth deferred to the
   credential-broker slice? Default if you don't say: **deferred** — `AuthEvidence` is a typed placeholder
   this slice validates the *presence* of, and the broker slice makes it real.
3. Anything in §1's non-goals you want pulled *into* this slice (I recommend not — keep it small and provable).

Nothing is built until you say approve.
