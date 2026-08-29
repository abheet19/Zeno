# LLD · P1-02 · Executor & Worktree Adapter (the first hand)

**Slice:** P1-02 — second Phase-1 slice · **Wave A** (needs only Gate 1)
**Depends on:** P1-01 kernel (implements its `Executor` contract). **Nothing else.**
**Target host:** Windows 11 pilot / this Mac as isolated synthetic build. Headless. Local-only.
**Language:** TypeScript strict, Node ≥ 20, ESM. **Zero network. Zero LLM.**
**Author:** Zeno build · 2026-08-29 · **for owner approval.**

---

## In plain words (read this first)

The kernel (P1-01) is the **security desk that decides**. This slice is the first **hand** that actually
*does* the thing the desk approved — but a very careful hand:

- it only ever works **inside a sandbox** (a scratch folder it cannot escape),
- it does **exactly one thing, all-or-nothing** (no half-finished writes),
- and it **proves what it did** by re-reading the result — rather than just *claiming* success.

If it can't prove the effect really happened, it **says so honestly** ("outcome unknown") instead of
pretending. This is the piece that turns "approve → verified" from a test stub into a **real file
changing on disk** — and it's the exact pattern every future hand (git, Jira, browser) will copy.

---

## 0. Why this slice is next

P1-01 can classify, preview, approve and commit — but in its tests the `Executor` is a stub. The loop
isn't closed: an approval has never driven a *real* effect. P1-02 gives the kernel its **first real
executor**, so the whole chain runs end to end and you can *see* the result. It's deliberately the
**smallest possible real effect** — a sandboxed file write — so the risky part (touching the world) is
introduced in the most contained, reversible, verifiable form before anything bigger (git, network).

---

## 1. Scope

**In scope:**

1. A **`WorktreeExecutor`** implementing the kernel's `Executor` type — applies an approved payload
   (a file write / patch) to a target **inside an isolated scratch worktree**.
2. A **reconcile step** — after the one attempt, re-read the target and *prove* the post-state matches
   what was approved; return honest `EffectProof`, or fail loudly so the kernel records `outcome-unknown`.
3. A **path-jail guard** — the executor refuses any target that resolves (after symlink resolution)
   outside its configured sandbox root. A malicious payload cannot escape.
4. **Atomic, idempotent application** — write-temp → fsync → atomic rename, so a crash never leaves a
   partial file; re-applying an already-applied effect is a safe no-op, never a double-write.
5. A **headless demo** wiring the kernel + this executor to show `approve → real file change → verified`
   and `drift → refused → file untouched`.

**Explicitly NOT in this slice (each a later executor, same interface):**

- **No git** (commit/push/MR) — the next executor slice.
- **No network, no Jira, no Slack, no browser.**
- **No multi-file transactions** beyond the single approved payload.
- **No real repositories** — synthetic fixtures only, in the sandbox.
- No undo of an already-completed effect (this slice *prevents partials*; rollback-of-committed is a
  separate concern for the git executor).

---

## 2. The interface it implements (from P1-01)

```ts
// P1-01 already defines:  type Executor = (bound: Binding) => Promise<EffectProof>
// P1-02 provides a concrete one:

export interface WorktreeSpec {
  /** Absolute path to the sandbox root. Nothing may be written outside it. */
  readonly root: string;
  /** Injected filesystem + clock, so the executor is testable and deterministic. */
  readonly fs: SandboxFs;
}

/** The payload an approved file-write action carries (hashed into the Binding at preview). */
export interface WritePayload {
  /** Path RELATIVE to the sandbox root. Absolute or climbing paths are rejected. */
  readonly relPath: string;
  /** Exact bytes to write. */
  readonly contents: string;
  /** Expected hash of the file BEFORE the write (matches Binding.baseHash) — belt-and-braces vs CAS. */
  readonly expectBaseHash: string;
  /** Expected hash of the file AFTER the write — what reconcile() checks against. */
  readonly expectPostHash: string;
}

export function makeWorktreeExecutor(spec: WorktreeSpec): Executor;
```

`makeWorktreeExecutor` returns a function the kernel can call as its `exec`. The executor never imports
the kernel — it only satisfies the callback shape, exactly like the LLD for P1-01 promised.

---

## 3. Reconcile — prove it, don't claim it

The heart of trust here: **the executor's word is not evidence; the re-read is.**

```
apply(payload):
  1. jail-check   : resolve(root/relPath) must stay inside root       (else PolicyError path-escape)
  2. base-check   : hash(current file) === payload.expectBaseHash     (else base-drift; refuse)
  3. write-atomic : write temp → fsync → rename over target           (all-or-nothing)
  4. reconcile    : hash(re-read file) === payload.expectPostHash ?
        yes → EffectProof{ effect: 'file:'+postHash }
        no  → throw ReconcileError  → kernel records OUTCOME_UNKNOWN
```

Step 4 is what makes a lying or buggy executor harmless: if the file on disk doesn't actually match the
approved post-state, the executor **refuses to report success**. The kernel then writes an
`outcome-unknown` receipt (retry frozen) — never a false `verified`.

---

## 4. One attempt, atomic, idempotent

The kernel guarantees the executor is called **exactly once** (law L2). The executor's job is to make
that one call safe:

- **Atomic:** the real file is only ever replaced by an atomic `rename` of a fully-written temp file.
  A crash mid-write leaves the **original intact** — never a half-file.
- **Idempotent:** if the post-state hash already matches (the effect is somehow already present), the
  write is a **no-op success** — applying twice can never double-append or corrupt.
- **Honest on failure:** any error (disk full, permission, mismatch) surfaces as a thrown error →
  `outcome-unknown`. The executor **never silently retries** — that's the kernel's law, and this slice
  respects it.

---

## 5. The sandbox path-jail

A hard boundary, tested adversarially:

```
jail(root, relPath):
  const target = realpathResolve(join(root, relPath))
  if !target.startsWith(realpathResolve(root) + sep) : throw PolicyError('path-escape')
```

`../../etc/passwd`, an absolute `/tmp/x`, a symlink pointing outside — all rejected. Even if a malicious
payload reaches the executor (it can't, without an approval bound to its exact hash — but defense in
depth), it **cannot write outside the sandbox**.

---

## 6. Testing (holistic — per the standing mandate)

- **Unit:** apply happy path, reconcile pass/fail, jail accept/reject, atomic-rename, idempotent re-apply.
- **Property (randomized):**
  - *no generated relPath ever writes outside the jail* (adversarial `../`, absolute, symlink cases),
  - *a claimed-but-unreal post-state is always caught by reconcile* (inject a tampering fs),
  - *re-applying an already-applied payload never changes the file a second time*,
  - *an injected mid-write failure always leaves the original bytes intact*.
- **E2E (kernel + executor together):**
  - approve a `local.write` → **the file actually changes** → `verified` receipt carries the real post-hash;
  - base drifts before commit → `refused` → **file on disk is untouched**;
  - executor is fed a tampering fs → `outcome-unknown`, file consistent, retry frozen.
- **All checks green:** `tsc` strict, dependency-free lint (no network / no ambient non-determinism —
  extended to also forbid `node:fs` sync-without-injection in the core), full test run, coverage,
  determinism.

**Definition of done:** the kernel drives a real, sandboxed file change end to end; every property above
holds under randomized runs; nothing writes outside the jail; a dishonest executor can never produce a
`verified`; `npm run check` is green on the pilot.

---

## 7. Simplicity pass — what v1 deliberately does NOT have

Reviewed for overcomplication. No git, no network, no Jira/Slack/browser, no multi-file transactions, no
database, no rollback-of-committed, no config beyond the `WorktreeSpec`. One executor, one payload shape,
one sandbox. Every omission is a seam for a later executor — none changes the kernel's seven laws or this
adapter's three guarantees (**jailed · atomic · proven**).

---

## 8. What I need from you

1. **Approve this LLD** to unlock building *only this slice*. (Still no `git commit`/`push` by me beyond
   what you direct; still stop at green validation.)
2. **One decision — the sandbox root.** Where may sandboxed real effects write? Default:
   a scratch dir `~/Documents/personal-ai-suite-phase1/sandbox/` (synthetic fixtures only, disposable,
   never a real repo, never an employer surface). Say the word if you'd prefer elsewhere.

Nothing is built until you say approve.
