# @zeno/policy-kernel — slices P1-01 + P1-02

The deterministic **Policy & Approval Kernel** (P1-01) plus the **Executor & Worktree
Adapter** (P1-02) — the decision core, and its first real "hand" that carries out an
approved file write (jailed, atomic, proven). No UI, no LLM, no network.
See `../LLD-P1-01-*.md` and `../LLD-P1-02-*.md`.

## Run it

```bash
npm install          # dev-only: typescript + @types/node (nothing else)
npm run check        # typecheck (strict) + lint + tests   ← the one command
```

Individual steps:

```bash
npm run typecheck    # tsc --noEmit, strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess
npm run lint         # dependency-free: forbids network imports & ambient non-determinism in src/
npm run test         # compiles, then node --test over the suite
```

## What's proven

| File | Proves |
|---|---|
| `test/laws.test.ts` | L1–L7 as property tests over randomized action streams |
| `test/cas.test.ts` | L3 compare-and-swap: drift refuses, approval unspent, zero effect |
| `test/injection.test.ts` | adversarial payloads never advance past PREVIEWED |
| `test/chain.test.ts` | ledger tamper-evidence; `verifyChain()` localizes the break |
| `test/determinism.test.ts` | same inputs + injected world ⇒ byte-identical ledger |
| `test/e2e.test.ts` | the full Command-capsule journeys, headless (verified / refused / unknown / T0 / T4) |
| `test/policy.test.ts` | tier math, policy validation, expiry, error paths |
| `test/executor.test.ts` | P1-02 jail (property), integrity, base-check, idempotency, reconcile, atomic |
| `test/executor-e2e.test.ts` | kernel drives the executor: approve → real file change → verified; drift → untouched |
| `test/executor-node-fs.test.ts` | the real fs adapter against an OS temp sandbox |

Latest: **47 tests pass · ~3,000 generated scenarios · 99.6% line coverage · strict typecheck · lint clean.**

## Shape

`Kernel(world, {policy?, signer?})` with:

- `classify(req)` → `{ tier, reasons }` (pure)
- `preview(req)` → `Preview` (pure; computes the bound `actionHash`)
- `approve(actionHash, auth?)` → `Approval` (owner channel; T4 throws; T2+ needs `auth`)
- `commit(approval, exec)` → `Receipt` (revalidate → one attempt → receipt)
- `verifyChain()` → `{ ok, firstBreakAt? }`

Everything non-deterministic (clock, ids, base re-reads) is injected via `World`,
which is what makes the whole kernel replayable and testable.

## Deliberately deferred (seams, not walls)

No signing keys (hash-pinned/chained now; Signer slice later), no multi-approver,
no database (one JSONL ledger), no plugins, no config beyond `policy.json`. The
seven laws are the product; everything else stays as small as honesty allows.
