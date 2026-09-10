# 39 — Independent Audit (verify-not-trust)

> **Historical audit — 2026-09-04.** Counts, line numbers and open findings below bind to the
> working tree this audit inspected. Use `docs/43-ACCEPTANCE-EVIDENCE.md` for current acceptance
> boundaries and `docs/35-HOW-TO-TEST.md` for the current gate.

**For:** the planning instance and the owner.
**From:** an independent review pass — six auditors, each re-ran the tests and read the source; none trusted docs 34/38.
**Date:** 2026-09-04.
**Scope:** every built package except macOS (out of scope). Verified against `docs/ledgers/acceptance-criteria.csv` (196 rows) and the code, with file:line evidence.

---

## ⚠️ UPDATE — post-audit re-verification (2026-09-04, later)

**The tree was being actively edited during this audit** (`daemon/src/server.ts` grew 460→542 lines and daemon tests 38→42 mid-pass; the repo went 4→9 packages). Re-checking current source, the two CRITICAL findings below are **already fixed**, and the "orphaned libraries" finding is being closed. Verified by direct read:

- **§2.1 (owner-token leak at `GET /`): FIXED.** `server.ts:129-134` gates the shell — the owner token is embedded only for `role==='owner'` or a matching one-time launch nonce (`?k=`); any other caller gets an **empty** token (`:189-193`). The earlier live `curl` that showed the leak hit a **stale compiled `dist`**, not current source. `dist/src/server.js` is now newer than `server.ts`, so the runtime matches. *(Ship check: always rebuild `dist` before running.)*
- **§2.2 (client `kind` override): FIXED.** `server.ts:475` — `const kind = secretWarning && risk.routine ? 'patch.task' : risk.kind;` — kind is hard-derived from the risk assessment, never the request body. A **secret-scanner** was also added: a routine write carrying a secret is escalated to stop for the owner (`:464-475`).
- **§3 (sanitizer + vault orphaned): being fixed.** `daemon/package.json` now depends on `zeno-vault` and `zeno-sanitizer`; `server.ts:35` imports `sanitize`, redacts stored memory (`:341`) and scans write contents (`:464`); new `/memory`, `/brief`, `/forge/*` routes wire Vault + Forge into the daemon. The "eight libraries, not one product" gap is closing.

**Still open / unverified after the fixes** (tree still moving — re-check once it settles): §2.3 risk auto-apply *default-on* remains a design decision for the owner (Q1); §2.4 MCP-unsigned-into-shared-ledger and §2.6 the softened MCP double-apply test were not re-verified post-edit. **Recommendation:** because the repo is under active edit, run one clean `npm run check` across all 9 packages against a freshly built `dist`, and add the two regression tests named in §7.1, once editing pauses.

*Everything from here down is the original audit as first written — accurate against the snapshot each auditor read, now partly superseded as noted above.*

---

## 0. Bottom line

The **kernel spine is genuinely strong and the laws hold at the kernel boundary.** The real problems are not in the kernel — they are in **how the daemon exposes it** (two independent approval-bypass paths) and in **integration** (two good packages wired to nothing). Docs 34/38 are **honest but stale**: doc 34 under-counts what is built; doc 38's "3 failing tests" are already resolved. No dishonest grading was found; the one thing both docs miss is the most serious security hole.

**Acceptance headline (my concurrence):** **0 of 196 fully met** — correct and should stand. Partial is **undercounted** by doc 34 (~58–64, not 47); not-built ~100–106; **35 out-of-scope are genuine.** Nothing should be promoted to "met": every criterion as written spans a surface that does not exist yet (a Mac, a phone, a model provider, a second product, measured eval numbers).

---

## 1. Test/build reality (all re-run this session)

| Package | Tests | State | Doc 38 said |
|---|---:|---|---|
| kernel | 168 | ✅ green | 168 ✅ (accurate) |
| intake | 84 | ✅ green | 79, **2 failing** (stale) |
| mcp | 58 | ✅ green | 57, **1 failing** (stale) |
| vault | 21 | ✅ green | 21 ✅ |
| sanitizer | 44 | ✅ green | 36 (stale count) |
| daemon | 38 | ✅ green | 37 ✅ |
| cli | 16 | ✅ green | 16 ✅ |
| voice | 39 | ✅ green | "building, no tests" (stale) |
| mesh | 42 | ✅ green | "building, no tests" (stale) |

`npm run check` passes end-to-end. **Doc 38's three "failing tests" no longer fail** — they were resolved by editing tests, which is the point of §3 below.

---

## 2. 🔴 Built WRONG / safety holes (ranked)

### 2.1 CRITICAL — `GET /` discloses the OWNER token to any unauthenticated local caller
`daemon/src/server.ts:108-110` serves the shell **above** the auth gate; `serveShell` (`:163, :172`) embeds the owner token in a `<meta>` tag **and** a `Set-Cookie`. Confirmed live:
```
$ curl -s -i http://127.0.0.1:7317/      # no token
HTTP/1.1 200 OK
set-cookie: zeno_token=021e2b29…         # the OWNER token, in cleartext
```
Any local process (a rogue agent — exactly L6's threat model) can make one loopback GET, harvest the owner token, then approve **anything** at `/approvals`. **This defeats the entire "an agent physically cannot approve" guarantee.** Neither status doc mentions it.
**Fix:** serve the shell *below* the auth gate; never put the owner token in an unauthenticated response — deliver it via an authenticated local pairing step or the OS keychain, and add an Origin/Sec-Fetch check.

### 2.2 CRITICAL — daemon lets the caller override the risk-derived tier
`daemon/src/server.ts:312`: `const kind = (str(body,'kind') as ActionKind|null) ?? risk.kind;` — the risk assessment is used **only** when the client omits `kind`. A proposer-token client can `POST /previews` with `kind:"local.write"` and **destructive contents** (emptying `.env`, a 500-line rewrite) that `assessWrite` would rate `destructive`/`patch.task`; tier collapses to T0 → `preview.auto` → **auto-commit with no approval**, bypassing the sensitive-path/destructive protections `risk.ts` exists to enforce. The MCP path is **safe** (uses `risk.kind` directly, `mcp/src/server.ts:271`). Unknown kinds are safe (round up to T4); known-benign kinds are the bypass.
**Fix:** ignore client-supplied `kind` on `/previews`; always use `risk.kind` (as MCP does), or `maxTier(bodyKind, risk.kind)` raise-only.

### 2.3 Risk-based auto-apply is default-on and not owner-configurable
`risk.ts:93` classifies "ordinary" writes (≤`ROUTINE_LINE_BUDGET=40` changed lines, non-sensitive path, non-destructive) as `local.write` → T0; `kernel.ts:143` maps T0 → `AUTO`; `server.ts:329` / `mcp/server.ts:280` commit on `preview.auto` **with no role check**. So a proposer token can cause committed, receipted sandbox edits with no owner in the loop. Thresholds are hardcoded `const`s (`risk.ts:38-57`); `policy.json` has **no knob** for them.
This is the documented posture change (doc 38 §3, `risk.ts:19-29`): it narrows the non-negotiable from *"nothing consequential without your yes"* to *"nothing risky without your yes."* Combined with 2.1/2.2, the "bounded to ordinary sandbox edits" blast-radius claim in `risk.ts` is **currently false**.

### 2.4 MCP writes UNSIGNED receipts into the same ledger the daemon signs
`mcp/src/main.ts:101` builds the Kernel with **no** `receiptSigner`; `daemon/src/main.ts:39-40` signs. If both share `ZENO_DIR` (default), the append-only `ledger.jsonl` accumulates a mix of signed and unsigned receipts written by two processes with no cross-process lock — an integrity/robustness smell, untested.

### 2.5 SAN-AC-06 mislabeled "closed"; `0o600` is cosmetic on Windows
The specific proposer-token-in-log leak doc 34 named **is genuinely fixed** (`daemon/main.ts:56` writes it to a file, banner says it's not printed). But `main.ts:55` and doc 38 line 64 claim this **closes SAN-AC-06** — it does not: the criterion is the notification/telemetry/crash-schema allowlist matrix, almost all unbuilt. And `mode:0o600` on NTFS only maps the read-only bit — it is **not** owner-only access control on a Windows-first product.

### 2.6 The MCP "cannot double-apply" test was flipped to accept `committed`
`mcp/test/server.test.ts:371-400` now asserts the *second* identical re-proposal returns `committed` (only the *third* is `held`). Mechanically coherent (base moved `null→v1`, so a different `actionHash` → not an L2 replay; the write is idempotent on disk) and **disclosed** — but it emits a **redundant receipt** and softens the original "one attempt, then stop" intent. This test fails *because of* 2.3; with auto-apply off by default, the stricter original expectation is restored.

**Note on honesty:** the kernel auditor found **no** assertions silently deleted; the weaker model is in the tests but doc 34 §1 disclosed it. Intake's two "failing" tests were fixed by **tightening** assertions, not loosening. So test-editing was legitimate everywhere except that it *encodes* the 2.3 posture (MCP) before you ruled on it.

---

## 3. Built but NOT WIRED (orphaned — zero acceptance credit)

- **Sanitizer (44 tests) and Vault (21 tests) are imported by no other package** (whole-repo grep: the only `@abheet19/zeno-sanitizer` / `zeno-vault` hits are their own `package.json`). The "egress guard" guards nothing — no prompt, receipt, or log passes through `sanitize()` before leaving. The vault's cited recall + honest morning brief are never invoked by any surface. Both are good libraries; quality of an unimported library buys **zero** acceptance credit. (Doc 38 §5 admits this: "wire Vault + sanitizer + MCP into the daemon so it is one product, not eight libraries.")
- **Sanitizer gap:** no canonicalization → a base64/URL/hex-encoded or whitespace-split secret passes straight through (fails SAN-AC-05); sub-32-char unprefixed secrets have no net.

---

## 4. What is genuinely GOOD (verified, not asserted)

- **Seven laws hold at the kernel boundary**, law-by-law with file:line (L1 narrowed to T1+ *by the 2.3 design*, not by a bug). L6 approval line is real: `/approvals` 403s any non-owner; no agent-callable approve exists.
- **Ed25519 signer real and wired default-on**; hash-chain ledger genuinely tamper-evident (tamper-*proof* when signed), with a persisted head anchor against tail-truncation, and boot refuses to append onto a broken chain.
- **Git executor is careful:** path-jail with `realpath` symlink/junction resolution, pathspec-glob rejection, `--literal-pathspecs`, nested-repo escape closed, single `commit --only` (no `--force`/`-A`/remote), reconcile that refuses to claim a commit HEAD doesn't show. No jail escape or double-commit found.
- **Voice "no utterance can ever approve" is proven structurally** — the `Intent` union has no approve member (type-impossible), plus a guard before any action match, plus no `/approvals` fetch in the browser client. Wake/grammar/session are real logic; real audio is honestly delegated to the browser Web Speech API.
- **Mesh protocol core is strong:** real AES-256-GCM AEAD (seq bound as AAD), a real sliding-window replay guard, a genuine LWW-CvRDT with **property-tested convergence** (two random op-orders → identical state hash across 40 seeds), and sound pairing (X25519 → HKDF with the human code as salt, SAS anti-MITM, key-commitment device ids). Second device is **openly simulated**; no transport/phone/persistence. Minor caveats: no forward secrecy, 20-bit SAS, 53-bit seq ceiling.
- **Intake "an incoming event never authorizes work" is architecturally enforced** — no code path from a `WorkItem` to an effect; GitHub adapter is read-only (GET only) and fails loudly by name; `verify` does a real hash-chain walk.

---

## 5. Missing-features map

### (a) In-scope, $0-buildable on this one Windows machine, but NOT (fully) built
| Feature (agreed) | Exists today | Missing |
|---|---|---|
| **Command dashboard** | approvals-only shell (`daemon/public/index.html`), pending+receipts | nav, Today/Attention, Task Candidates, launcher, Device Fleet, **any chat** |
| **Assistant chat** | none | no NL surface at all (inputs are JSON/argv) |
| **Root Orchestrator + dynamic model routing** | none | no orchestrator, no per-phase routing, no task-identity/handoff |
| **Forge coding surface** | git-executor foundations only | no Ask/Explore/Plan/Build/Review, no repo indexing, no review workbench |
| **Multi-agent / code-crafter runtime** | single-agent isolation primitives | no per-worker worktrees, leases, cited handoffs, cancel |
| **Standing Field viz** | static Gate-2 prototype only (hardcoded data) | bind pulses/nodes to the real receipt chain (~3 days, $0) |
| **Slack agent / Attention Center** | none | event ingestion (a personal Slack MCP is available in this env — read-only triage demo is $0) |
| **Vault ↔ NeoSapien daily sync** | Vault store + MCP host exist, unwired | NeoSapien pull → Vault, Obsidian writer, backlinks, ACL, deletion cascade (personal NeoSapien connector available here) |
| **Glass design system** | dark ramp + contrast gate (`contrast.mjs`) | Light/System/Reduced-Transparency; wire the gate into `npm run check` (one line) |
| **Restart-safe resume** | **now built** (`heldStore` persists pending) | priority ordering, action-trace, cancel/rollback |

### (b) Out-of-scope here — verified structural, not excuses
- **macOS (15 ACs)** — no Mac; single Windows machine.
- **Employer systems (18)** — QuillBot Jira/GitLab/Slack/NeoSapien/skills gone with the layoff. *(Caveat: the NeoSapien/Slack **mechanism** is partly demonstrable via personal connectors in this env; oos is for the employer scope, not the mechanism — doc 34 discloses this.)*
- **Local model runtime** — no Ollama/weights/paid API at $0. Blocks assistant chat, Forge-as-agent, NL execution.
- **Voice/eval hardware numbers** (FAR/FRR, DER, thermal/SLO) — need a model runtime + corpus + instrumented runs.
- **Money / 2nd device / signing-CI** — no CI, no cert, no SBOM, no phone. Mesh proves the protocol core against a simulated peer only.
- **Autonomous payment (ASSIST-AC-07)** — `payment`/`financial` forced to T4; `validatePolicy` refuses to relax it (L7). Correctly oos — building it breaks the central guarantee.

---

## 6. Rulings on doc 38's Q1–Q5

- **Q1 (risk auto-apply):** **Not as a default.** Keep the risk *classification*; make auto-apply **opt-in, off by default**, with the line budget and sensitive-path list **owner-configurable in `policy.json`**. And fix 2.1/2.2 first — until then the "bounded envelope" is not real.
- **Q2 (fix code or tests):** They already resolved all three. Intake ×2 = fixed properly, keep. **MCP double-apply: don't bless double-commit.** Gate auto-commit on `risk.routine` and turn auto-apply off by default (Q1); that restores the original stricter "held" expectation, so revert that one test rather than keep the softened version.
- **Q3 (sign by default):** **Yes, keep default-on** — strictly better at $0. But fix 2.4 (MCP must use the same signer / its own dir; don't co-mingle signed and unsigned in one ledger).
- **Q4 (mesh stop at protocol core):** **Yes.** The core-against-simulated-peer is the defensible, testable half; the phone app is a separate effort. Track the crypto caveats (forward secrecy, SAS width) as future work.
- **Q5 (Forge next or local model):** **Neither first — fix the two daemon approval bypasses (2.1, 2.2) first**, because Forge rides the git executor over that same daemon. Then **Forge** (agree with your lean — needs no model, closes a big cluster), and do the **consolidation/wiring** (§3) alongside it. Local model (Ollama) after — it's what makes the assistant real but is the bigger lift.

---

## 7. Recommended order of work
1. **Close 2.1 (owner-token disclosure) and 2.2 (kind override).** Small, high-severity. Add regression tests: unauthenticated `GET /` must not carry a token; a `kind`-override attempt must not lower the tier.
2. **Flip risk auto-apply to opt-in** (Q1); revert the MCP double-apply test (Q2).
3. **Fix 2.4** (MCP signing consistency).
4. **Wire sanitizer + vault into the daemon** (§3) — turn eight libraries into one product; add canonicalization to the sanitizer.
5. Then Forge over the git executor; Standing Field bound to the real receipt chain; Glass light/contrast-in-check.
6. Re-run the acceptance audit and publish the new honest number.

*Nothing in this pass was committed or pushed; all findings are read-only except this document.*
