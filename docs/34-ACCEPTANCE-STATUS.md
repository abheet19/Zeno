# 34 — Acceptance Status

> **Historical snapshot — 2026-09-04.** Package counts, test results and implementation states
> below describe that frozen tree and are not current evidence. See
> `docs/43-ACCEPTANCE-EVIDENCE.md` for the current evidence boundary. The original assessment is
> retained here as an audit record.

**The honest traceability report.**

| | |
|---|---|
| **Document** | `docs/34-ACCEPTANCE-STATUS.md` |
| **Snapshot frozen** | 2026-09-04, 18:53 IST |
| **Assessed against** | `docs/ledgers/acceptance-criteria.csv` — 196 rows, ids cross-checked one-for-one against this report (0 missing, 0 extra, 0 duplicates) |
| **Machine** | Windows 11 Pro 26200, Node ≥ 22, `D:\code\Zeno` |
| **Repository state** | one commit (`b847a60`); `packages/daemon`, `packages/cli`, `packages/intake` and the git-executor slice are still untracked |

> **This is a snapshot of a moving tree.** Three source files landed *while this report was being
> written* — `src/executor-git.ts` (18:49), `test/executor-git.test.ts` (18:50), `src/risk.ts` and
> `test/risk.test.ts` (18:52). Two criteria moved from *not-built* to *partial* between the first
> pass and the freeze, and the daemon suite went from green to red in the same window. Every number
> below carries the command that reproduces it. Re-run them before quoting this document.

---

## 0. The grading rule

Four statuses, and one rule that governs all of them.

**An acceptance criterion is MET only if every clause of it can be demonstrated by pointing at code
that runs or a test that passes.** Not "the design covers it". Not "the mechanism is obviously
there". Not "it works when you try it". If a clause of the criterion has no artifact behind it, the
criterion is not met — however impressive the part that *is* built.

| Status | Means |
|---|---|
| **met** | Every clause demonstrable. Nothing is claimed that a reader cannot check in ten minutes. |
| **partial** | Some clauses are genuinely proven — usually by a named test — and the rest have nothing behind them. The row names both halves. |
| **not-built** | No implementation. In most cases a grep for the subject returns zero hits in `packages/`. |
| **out-of-scope** | Permanently uncloseable here, for a stated structural reason. Not "later" — *never*, in this repository. |

A criterion is graded against **the whole criterion as written**, not against the part of it that
was attempted. This is the reason for the headline below, and it is a deliberate choice: an
acceptance ledger that grades on effort is not an acceptance ledger.

---

## 1. Headline

| Status | Count | Share of 196 |
|---|---:|---:|
| **met** | **0** | 0.0% |
| **partial** | **47** | 24.0% |
| **not-built** | **114** | 58.2% |
| **out-of-scope** | **35** | 17.9% |
| **Total** | **196** | 100% |

**Zero acceptance criteria are met, and that number is correct rather than modest.** These 196
criteria were written to describe a five-product suite — Command, Forge, Counsel, Vault and Link —
running across Windows, macOS and a phone, with voice, local models, MCP, connectors to eight
external services and cryptographically signed receipts. What exists is one product on one machine:
a deterministic policy-and-approval kernel, a loopback daemon, a browser approval surface and a
CLI, together 203 tests. Because almost every criterion spans surfaces that were never built, no
single criterion is closed end to end — even the ones whose *hard* half is finished and proven.
Forty-seven rows are partial, and a good number of those are partial only because the criterion also
demands a Mac client, a phone, a model provider or a second product. That is an honest description
of a nine-day-old codebase against a suite-scale specification, and inflating any of it to "met"
would make the other 195 rows worthless as evidence.

**What is true instead** is in §2: forty-five invariants enforced in code and pinned by named,
passing tests, plus three more that are enforced but untested and are labelled as such. That table
is the actual work. It is smaller than the specification and much
harder than it looks.

### Build state at the freeze

```
cd D:\code\Zeno && npm run check
```

**Re-verified 2026-09-04 19:20 IST, after the in-flight slice landed. The tree is GREEN.**

| Package | Tests | Result |
|---|---:|---|
| `@abheet19/zeno-kernel` | 143 | **pass** — coverage 98.75% lines / 94.41% branches / 100% functions against gates of 95 / 85 / 95 |
| `@abheet19/zeno-intake` | 64 | **pass** |
| `@abheet19/zeno-daemon` | 17 | **pass** |
| `@abheet19/zeno-cli` | 8 | **pass** |
| **Total** | **232** | **232 pass, 0 fail — the root check exits zero** |

† *Recorded for honesty, since the original freeze quoted red numbers.* At 18:53 the daemon suite
was 11/14. Three tests failed for minutes because `src/risk.ts` had just landed: writes are now
escalated by what they actually **do** (an ordinary edit is routine and applies unattended;
configuration, a rewrite, or a deletion stops for the owner). Those three tests were written when
every write demanded approval, so the new behaviour correctly broke their premise. They were
rewritten to state the real rule — `ROUTINE` applies without asking and is still receipted, `RISKY`
waits — plus three new tests covering routine / risky / destructive. Nothing was suppressed to go
green. **Re-run `npm run check` before quoting any of this.**

---

## 2. There are no MET rows. Here is what is actually proven instead.

The table below is not a substitute claim that anything is met. Every line is a **clause** of one or
more criteria — a property that is enforced in code and pinned by a test that passes today. Where a
property is enforced but *not* covered by an automated test, it says so in the Proof column, and it
should be read as weaker evidence.

Reproduce the whole table with:

```
cd D:\code\Zeno && npm run check                      # kernel, intake, daemon, cli
node packages/daemon/public/glass/contrast.mjs        # the accessibility gate
npm run demo                                          # a live approve -> commit -> receipt journey
npm run ledger:verify                                 # re-verify the hash chain on disk
```

### Authority — who may cause an effect

| # | The property, as a falsifiable claim | Enforced in | Proof |
|---|---|---|---|
| P1 | Nothing above T0 reaches the executor without an explicit owner approval. | `kernel/src/kernel.ts` | `laws.test.ts` — *L1 + L6 — no skip / no self-approval: nothing verifies without an owner approval* (asserts `exec.calls() === 0`) |
| P2 | A proposing agent cannot approve its own proposal; the proposer token gets 403 on `/approvals` and is told why. | `kernel.ts`, `daemon/src/tokens.ts` | `laws.test.ts` L1+L6; `daemon/server.test.ts` — *L6 — the PROPOSER token cannot approve* † red at freeze |
| P3 | An approval is bound by content hash to exactly one action and cannot be replayed onto another. | `kernel/src/types.ts` `Binding` | `injection.test.ts` — *an approval for one action cannot be replayed onto another* |
| P4 | An approval is single-use. A spent approval can never drive a second effect. | `kernel.ts` | `laws.test.ts` — *L4 — single-use* |
| P5 | An approval expires, and an expired one yields EXPIRED with no effect. | `kernel.ts` | `policy.test.ts` — *an expired approval yields EXPIRED, no effect* |
| P6 | Approving the same action twice is rejected by a state guard. | `kernel.ts` | `policy.test.ts` — *approving twice is rejected (state guard)* |
| P7 | T2+ actions require an authenticator before they can verify. | `kernel.ts` tier gate | `laws.test.ts` — *T2+ requires an authenticator (tier gate)*; `e2e.test.ts` — *E2E T2 push requires Windows Hello, then verifies* |
| P8 | A random stream of legal and illegal operations never produces an effect the laws forbid. | `kernel.ts` | `laws.test.ts` — *fuzz — a random stream never produces an effect the laws forbid* |

### Binding — an approval means one exact thing

| # | The property | Enforced in | Proof |
|---|---|---|---|
| P9 | If the world drifts between approve and commit, the commit REFUSES, nothing applies, and the approval is left unspent. | `kernel.ts` compare-and-swap on `world.readBase()` | `cas.test.ts` — *drift between approve and commit => REFUSED, unspent, no effect* and *property — under random drift, a drifted commit NEVER applies* (500 random cases) |
| P10 | The executor is invoked at most once per action. There is no retry loop anywhere in the commit path. | `kernel.ts` `commit()` | `laws.test.ts` — *L2 — one attempt* |
| P11 | "Exactly one attempt" survives a process restart — the ledger remembers, not just memory. | `ledger.ts` `hasTerminal()` | `tamper.test.ts` — *ONE ATTEMPT survives a restart* |
| P12 | A refusal is *not* terminal: a refused action stays re-previewable across a restart. | `ledger.ts` | `tamper.test.ts` — *a REFUSED action stays re-previewable across a restart* |
| P13 | A payload that is not the approved one is refused by the executor itself, and the effect tool is never invoked. | `executor.ts`, `executor-git.ts` | `executor.test.ts` — *integrity — a payload that is not the approved one is refused*; `executor-git.test.ts` — *integrity — a tampered payload is refused and git is never invoked* |
| P14 | Action identity covers KIND and SUMMARY, not only the payload — an approved action cannot be relabelled. | `hash.ts` + `types.ts` | `tamper.test.ts` — *the action identity covers KIND and SUMMARY, not just the payload* |
| P15 | Canonical hashing is prototype-safe and order-correct: `__proto__` keys are hashed rather than dropped, key order is irrelevant, array order is not. | `hash.ts` | `hash.test.ts` — five named tests |

### Truthfulness — a failure is never dressed as a success

| # | The property | Enforced in | Proof |
|---|---|---|---|
| P16 | A lying filesystem (write reports success, bytes never land) is caught by reconciliation. | `executor.ts` | `executor.test.ts` — *PROVEN — a lying fs (write silently drops) is caught by reconcile* |
| P17 | A lying git (reports success, HEAD never moves) is caught. | `executor-git.ts` | `executor-git.test.ts` — *PROVEN — a lying git ... is caught* |
| P18 | HEAD moving while git reports failure is never claimed as a success. | `executor-git.ts` | `executor-git.test.ts` — *PROVEN — HEAD moved but git reported failure* |
| P19 | An executor failure produces OUTCOME_UNKNOWN with retry frozen — never "done", never a silent retry. | `kernel.ts` | `e2e.test.ts` — *E2E outcome-unknown: executor fails once -> OUTCOME_UNKNOWN, retry frozen*; `tamper.test.ts` — *an OUTCOME_UNKNOWN cannot be retried by simply previewing again* |
| P20 | Re-applying an already-applied payload writes nothing, and "nothing to commit" is a success, not a failure. | `executor.ts`, `executor-git.ts` | `executor.test.ts` and `executor-git.test.ts` — two idempotence property tests |
| P21 | A ledger write failure surfaces as an error, never as "nothing happened", and the in-memory chain never runs ahead of disk. | `ledger.ts`, `ledger-node-fs.ts` | `tamper.test.ts` — two named tests |
| P22 | The verified seal cannot render without a durable receipt behind it. | `glass/tokens.css` (`.state-verified[data-receipt]:not([data-receipt=""])`) | `laws.test.ts` — *L5 — seal after receipt: every "verified" corresponds to a durable receipt in the chain* |

### The record — tamper-evident, restart-safe, replayable

| # | The property | Enforced in | Proof |
|---|---|---|---|
| P23 | The receipt ledger is hash-chained; editing or deleting any past receipt breaks the chain **at that index**. | `ledger.ts` | `chain.test.ts` — three tests; `cli/demo.test.ts` — *editing one line of the audit log is caught at exactly that index* |
| P24 | Deleting receipts from the END is detected, via a truncation anchor. | `ledger.ts` | `tamper.test.ts` — *DELETING RECEIPTS FROM THE END is detected* |
| P25 | A damaged ledger makes the kernel REFUSE TO BOOT rather than continue on a broken record. | `kernel.ts` constructor | `tamper.test.ts` — *the kernel REFUSES TO BOOT on a damaged ledger* |
| P26 | A crash-truncated last line is localized at its index and is never welded onto by the next append. | `ledger-node-fs.ts` | `ledger-durable.test.ts` and `tamper.test.ts` — *REAL FS — a crash-truncated line is not welded onto* |
| P27 | A new kernel continues the chain from the pre-restart tip; receipts survive a real process restart. | `ledger-node-fs.ts` | `ledger-durable.test.ts` — *RESTART* and *REAL FS — receipts survive a process restart* |
| P28 | Windows reality is handled: CRLF ledgers and UTF-8-BOM policy files load correctly, and a BOM does not mask a bad policy. | `ledger.ts`, `policy-node-fs.ts` | `ledger-durable.test.ts`, `policy-load.test.ts` — three tests |
| P29 | Full replay determinism: same inputs plus the same injected world produce a byte-identical ledger. | injected `World` | `determinism.test.ts` — two tests; `cli/demo.test.ts` — *re-running the demo is deterministic* |
| P30 | No ambient non-determinism and no network primitive can enter `kernel/src` — the build fails on `Date.now`, `Math.random`, `fetch`, sockets. | `kernel/scripts/lint.mjs`, wired into `npm run check` | lint passes over all 15 source files. **Caveat:** the script implements 2 of the 3 checks its own header documents — tsconfig coverage is not implemented, and it does not check npm dependencies |

### Policy — fail-closed, wildcard-free, absolute at the top

| # | The property | Enforced in | Proof |
|---|---|---|---|
| P31 | T4 is absolute: `payment` and the `financial` data zone never verify, end to end. | `policy.ts` | `laws.test.ts` — *L7 — T4 is absolute*; `e2e.test.ts` — *E2E payment is denied end to end* |
| P32 | A policy file that relaxes either half of T4 is refused at load — the guarantee cannot be configured away. | `policy.ts` `validatePolicy()` | `policy-load.test.ts` — *a policy that fails to deny payments is rejected* and *a policy that drops the financial floor is rejected* |
| P33 | An unknown action kind or a misspelled data zone rounds **up** to T4 — never to `undefined`, never silently ignored. | `policy.ts` `classify()` | `policy-load.test.ts` — two named tests |
| P34 | Authority is 100% enumerated and wildcard-free: a policy missing one action kind, one tier, or a version is rejected. | `validatePolicy()` | `policy-load.test.ts` — 11 fail-closed cases; `policy.test.ts` — *validatePolicy rejects malformed policies*, *the kernel refuses to construct with a bad policy* |
| P35 | A broken or unreadable policy file refuses to start rather than falling back to a looser default. | `policy-node-fs.ts` | `policy-load.test.ts` — *malformed JSON refuses to start, legibly*, *readPolicyFile ... present-but-broken throws* |
| P36 | The governing policy is hash-pinned into every receipt, and editing the policy changes the pin. | `policy.ts` `policyHash()` | `policy-load.test.ts` — *DONE — editing the policy raises the tier and changes the pinned hash* |
| P37 | Risk escalation reads what a write actually does — sensitive paths, breadth, emptying a file — and only ever escalates upward. | `kernel/src/risk.ts` (landed 18:52) | `risk.test.ts` — *escalation only ever goes UP*, *emptying a file is DESTRUCTIVE, however small*, *destructive beats sensitive*, *a routine action is still RECEIPTED* |

### Containment — the jail, the loopback, the payload

| # | The property | Enforced in | Proof |
|---|---|---|---|
| P38 | An injected payload cannot self-authorize an effect, cannot raise or lower its own tier, and cannot survive as a T0 auto-approval. | `policy.ts` reads only `kind` and `dataZones`; payload is hashed, never interpreted | `injection.test.ts` — three named tests |
| P39 | The write executor is path-jailed against every adversarial path (property test), escaping symlinks, and Windows device-name traps. | `executor.ts` `jail()` | `executor.test.ts` — three JAIL tests; `executor-node-fs.test.ts` — *jail accepts inside, rejects climbing out* |
| P40 | The git executor is jailed the same way, and additionally refuses pathspec glob magic, the repository root itself, an empty pathspec ("add everything"), and a repoRoot nested in someone else's checkout. | `executor-git.ts` | `executor-git.test.ts` — seven JAIL tests, incl. *JAIL — pathspec glob magic is refused (one approval cannot widen itself)* |
| P41 | There is no code path from the git executor to a remote — no upload verb, no `--force`, no history rewrite — asserted statically over the file's own source. | `executor-git.ts` | `executor-git.test.ts` — *there is no code path to a remote, and none was ever taken* |
| P42 | The daemon socket is loopback-only; a wrong token is refused; a near-miss does not leak by timing; a proposal that escapes the sandbox is refused by the jail over HTTP. | `daemon/src/server.ts`, `tokens.ts` | `daemon/server.test.ts` — *the socket must be loopback-only, never 0.0.0.0*, *a wrong token is refused, and a near-miss does not leak by timing*, *a proposal that escapes the sandbox is refused by the jail* |
| P43 | The activity stream is ordered and reconnect-safe: monotonic ids, exact replay by `Last-Event-ID`, and an explicit `gap` event when a gap cannot be replayed — never a silent stitch. | `daemon/src/stream.ts` | `daemon/server.test.ts` — three named tests, incl. *a gap that cannot be replayed is DECLARED, never silently stitched* |
| P44 | Untrusted item text is neutralized before it reaches a capsule: bidi overrides stripped, length-bounded, one line. | `intake/src/work-item.ts` | `intake/work-item.test.ts` — *toSummary strips bidi overrides*, *toSummary is length-bounded* |
| P45 | The local backlog is crash-safe: an interrupted write costs one revision and nothing else, a corrupt line is skipped and counted, a parser bug cannot eat a record, and a temp file left by a crash is ignored rather than merged. | `intake/src/backlog.ts`, `backlog-node-fs.ts` | `intake/backlog.test.ts` — six named tests |

### Enforced in code, but **not** covered by an automated test

These three are real and they work; they are listed separately because their evidence is weaker and
a reader should treat them accordingly.

| # | The property | Where | Why it is weaker |
|---|---|---|---|
| P46 | The approval capsule refuses to enable Approve unless the rendered payload re-hashes to the binding and every field resolved. | `daemon/public/capsule.js` `verifyHash()` / `addBlocker()` | `public/` has no test runner. Verified by hand in a browser only. This is the single most valuable untested line in the product. |
| P47 | Every one of 86 colour pairs meets the contrast budget (4.5:1 text, 3:1 graphic, plus a fill-delta floor). | `daemon/public/glass/contrast.mjs` — **re-run today: PASS 86/86** | The script is not wired into `npm run check`, so nothing stops a regression. |
| P48 | The kernel has zero runtime npm dependencies. | `packages/kernel/package.json` declares none | Enforced by the file, not by a check. `lint.mjs` blocks network imports, not dependencies. |

---

## 3. PARTIAL — 47 criteria

Read the middle column as the honest limit of the claim.

### Suite and platform

| AC | What exists | What is missing | What it would take |
|---|---|---|---|
| **SUITE-AC-01** Requirement ledger covers 100% of the prompt | 196-row `acceptance-criteria.csv`, 81-row `requirement-sections.csv`, traceability matrix with a zero-unmapped assertion, conflict/disposition register, corrections log | The generator that produced the assertion is not in the repo (`tools/` holds only video-frame scripts) and the master prompt is absent, so nothing is re-runnable; §6 discloses the AC-to-section mapping is analyst judgment, not extracted fact | Commit the generator and a hash-pinned copy of the source prompt so the assertion re-runs from `npm run check`. ~1 day |
| **SUITE-AC-03** Independently versioned packages with contract tests | Four workspace packages at 0.1.0, each with its own build/test/check; kernel has zero package dependencies; acyclic graph; injected-port mock adapters (`kernel/test/harness.ts`, `daemon/src/world.ts`) | Orchestrator, context/Vault, model gateway, MCP, connectors and Link do not exist; Glass tokens are static CSS inside the daemon rather than a package; no automated no-cycle check; no contract-test suite; no independent release evidence | A dependency-cycle check and per-port contract tests are ~2 days. The rest waits on packages that do not exist |
| **SUITE-AC-05** Reconnect-safe Observable Execution Stream | Ordered SSE with monotonic ids, `Last-Event-ID` replay and an explicit gap declaration (P43); receipt timeline in the UI | The stream carries only preview/receipt/chain events on one web surface — no goal, phase, editable plan, agent/model, budget, checkpoint or redaction layer; no Mac or phone client | The transport is right; the payload needs an orchestrator to describe. Blocked on Forge, not on effort |
| **SUITE-AC-12** Failures visible and recoverable; partial work never shown as complete | Crash mid-append, a lying filesystem, a failed ledger write and a failed executor all surface as OUTCOME_UNKNOWN or a hard refusal; restart recovery tested (P11, P16, P19, P21, P26, P27) | Nothing for offline, connector, model, device, low disk, thermal pressure or network partition; no rollback or compensation reporting | Nothing to add for the local slice; the rest needs subsystems that do not exist |
| **SUITE-AC-13** Workspace Context Scope Record | `01-workspace-context-scope-record.md` v4: declared sources, devices, purposes, providers, egress, retention with a 2026-11-22 expiry, and recorded v2/v3 deltas | No code reads or enforces it; none of the five required test families (lifecycle, expiry, scope change, revocation, cross-zone denial); its declared sources are employer repositories that no longer exist | Rewrite the record against surviving sources first, then wire `zoneTier` to it and add the five families. ~3 days after the rewrite |
| **SUITE-AC-14** Master-file load receipt | Matrix §0 records path, SHA-256 `d3b5b818…`, 554,098 bytes, 2,286 lines, both sentinels; §2 four independent parse checks all yielding 196 | The forced-truncation test the AC names was never run; neither the source file nor the generator is in the repo, so the receipt cannot be re-verified by a reader | Commit the file (or a hashed fixture) and run the truncation test. ~half a day |
| **LLD-GATE-AC-01** Approved LLD before first code | Two shipped slices have cited LLD artifacts (`28-`, `30-`); the UI work has design artifacts (`21-`, `22-A/B/C`, `23-`) | Neither LLD carries a Plan hash; no approval ledger event exists (both say only "for owner approval"); the daemon and the Glass UI are production code with no LLD; no changed-scope invalidation tests; the chronology is unprovable from a single commit that adds docs and code together | Going forward: hash each LLD and record its approval as a receipt in Zeno's own ledger. Retroactive proof is impossible |

### Kernel, memory and sanitization

| AC | What exists | What is missing | What it would take |
|---|---|---|---|
| **CAP-CATALOG-AC-01** Versioned atomic action catalogue | 13 action kinds in a versioned, schema-validated, hash-pinned catalogue; unknown kind or zone rounds up to T4 (P33); wildcard-free authority (P34) | Entries carry no adapter, pre/postconditions, scopes, idempotency key or fallback; no natural-language step to resolve because there is no model; only `local.write` and `vcs.commit` have executors, and the daemon exposes only the first | Widen the catalogue entry type and add one adapter per kind. Weeks, and only as adapters land |
| **MEMORY-AC-03** Causal parents, versions, idempotency, leases, fencing | Causal parents (`prevReceipt`), compare-and-swap on `baseHash` with a 500-case property test, single-use spend before the attempt, `hasTerminal` across restarts, exactly-one-executor (P9–P12) | No leases, epochs or fencing tokens anywhere; no exclusive writer lock on `ledger.jsonl` (`ledger-node-fs.ts` fsyncs but never locks); no replica, partition, clock-skew or out-of-order tests — there is one machine and one process | An OS file lock plus a lease type is ~1 day. The distributed half needs a second machine that does not exist |
| **SAN-AC-04** Untrusted instructions stay structurally data | Payload is hashed and never interpreted; `classify()` reads only `kind` and `dataZones`; the capsule renders with `textContent`, never `innerHTML`; intake strips bidi overrides (P38, P44) | Three plain-JSON injection tests, not the corpus the AC names: no Unicode confusables, encoded payloads, HTML/script, image/OCR, transcript, cross-chunk or malicious-MCP cases; sanitizer configuration, provider, tools and recipients do not exist to be attacked | An adversarial corpus against the existing surface is ~2 days and would materially strengthen the strongest claim in the repo |
| **SAN-AC-08** Egress rebuilt, rescanned, approved against the final hash | The capsule recomputes `sha256(canonicalJSON(payload))` in the browser and blocks Approve on mismatch or an unresolved field; the executor independently refuses a non-approved payload; identity covers kind and summary (P13, P14, P46) | No external egress of any kind — no model provider, Slack, email, Jira, Git push or export; no destination-bound view, no rescan, no changed-recipient or re-identification test; the capsule rule has no automated test | A headless-browser test of the capsule rule is ~1 day and converts the demo's weakest link into evidence |
| **SAN-AC-11** Fail-closed on gateway or policy failure | Fail-closed discipline is real for the two components that exist: a broken policy refuses to start, an unclassified kind or zone rounds up, a failed ledger write is surfaced with a resolve line that reaches the UI (P21, P33, P35) | No sanitization gateway or model egress to block; no version-skew or timeout test; the failure mode is *total* — a damaged ledger throws in the constructor so the daemon will not start, which is exactly the "without blocking unrelated local controls" half the AC demands | A read-only degraded mode so history stays viewable when the ledger is damaged. ~1 day |
| **DESTRUCTIVE-AC-01** Classify by effect, not by tool name | **Upgraded from not-built at 18:52.** `risk.ts` assesses what a write actually does — sensitive-path patterns, changed-line breadth, emptying or gutting a file — escalation only ever goes up, and a routine action is still receipted (P37) | No breadth-across-mounts, protected-target or production-target analysis; no backup and no dry-run; the executors can write and commit but cannot delete anything, so the destructive class is asserted rather than exercised against real deletion | Extend `assessWrite` to targets and mounts, and add a backup path before any delete executor is written |
| **GIT-SAFETY-AC-01** Record and preserve git state; never hide rewrites | **Upgraded from not-built at 18:50.** `makeCommitPayload` binds the payload to the repository's current HEAD; a competing commit between approve and commit refuses with the tree untouched; only named paths are staged and an empty pathspec is refused; force-push is denied by construction and asserted statically (P17, P18, P40, P41) | No recording of branch, remote or full dirty state; nothing for worktree switch, rebase, cherry-pick, revert, bisect or conflict; no untracked/ignored preservation matrix; no signing; no crash/reconnect journey | A dirty-state snapshot in the binding plus the rebase/conflict matrix. ~1 week for the honest subset |

### Research, brand and documentation

| AC | What exists | What is missing | What it would take |
|---|---|---|---|
| **RESEARCH-AC-01** Every named seed accounted for | 233 URL seeds (S001–S233) each with a stable id, a non-blank status and a reason — I re-ran the check: 0 blank statuses, 0 blank reasons on non-researched rows; canonical-home corrections documented | The ledger covers URLs only; report Appendix A lists 16 named tools (Obsidian, Jira, Codex, tree-sitter, Ollama, Graphify and others) that it says each need a seed id before the AC can be claimed; `url-seed-inventory.txt`, `L6-manifest.json` and `L6-raw/` are not in the repo, so the assertion cannot be re-run | Add the 16 rows and commit the machine-extracted inventory. ~half a day |
| **RESEARCH-AC-02** Per-seed identity, access, version, licence, maturity | Zero-blank-status ledger with per-row reasons and cited lane files L1–L9; the adversarial L5 pass genuinely ran and overturned or refined 12 of 38 re-fetched claims; itemized inaccessible list | No access-date/result, version, licence, security, maturity or verified-capability column at all; only 20 of 233 rows carry any date; query manifests absent; §8 states the worker-disagreement log and the baseline-versus-deep-review split remain unwritten | Six more columns and a re-pass over 233 rows. ~2 days |
| **RESEARCH-GITHUB-AC-01** Per-repo census evidence | 10-query log with UTC timestamps, `total_count`, a recorded rate-limit incident, §2 cap/gap disclosure, dedup summary (500 rows fetched, 474 unique by repo id), cited shortlist | The per-repo evidence the AC actually demands is absent: `L6-raw/*.json`, `L6-raw/fetch-log.txt` and `L6-manifest.json` do not exist under `docs/research`, so no per-repo id, rank, fork/archived state, dedup key or include/exclude reason is verifiable; page 1 only | Commit the raw JSON if it still exists, or re-run the census. ~1 day |
| **ARTIFACT-DOC-AC-01** Artifact index and portable companions | Two HTML artifacts (`28-`, `30-`) have dated, versioned Markdown companions with citations and verified/inferred labels | No Artifact Index anywhere in the repo; no review or version-diff trail; no capability-fallback report; no private/synthetic-data access audit; `23-gate2-prototype.html` has no companion | An index file plus a companion for the prototype. ~1 day |
| **BRAND-AC-01** Six candidates, correct labels, one coherent family | Dated ranked evidence table over 11 weighted axes covering all six candidates; correct Stoic / Stoic-associated / mythological labels; collision and trademark-register receipts; placeholder-only pre-gate usage; selected-family manifest | Wake-word scoring is explicitly labelled `inferred` analyst judgment with no measured pronunciation or false-wake corpus; the retired-name rule (INSHERON, Aurethos) lives only as prose with no automated regression test | A grep test for the retired names in `npm run check` is one hour. The wake-word corpus needs a wake engine that does not exist |

### Command, approvals and the running product

| AC | What exists | What is missing | What it would take |
|---|---|---|---|
| **COMMAND-AC-01** One registry-driven surface for every capability | A typed preview/approval surface driven by the action registry; `validatePolicy` enforces enumerated wildcard-free authority over 11 kinds; a real end-to-end daemon test — owner approves, the file on disk changes, a receipt lands | Two kinds have executors in the kernel and the daemon exposes only one — `POST /previews` accepts just `relPath`/`contents`/`summary`; there is no persistent streaming chat of any kind; Forge and Counsel do not exist, so "a dashboard for all three products" is one product | Generalize `/previews` to the catalogue. Blocked on adapters, not on design |
| **COMMAND-AC-08** Policy and capability simulator | `classify()` returns tier plus reasons against the exact production policy with zero side effects, tested; L1+L6 proves the executor never runs without an approval | No simulator surface in the UI; the policy model has no device, account or MCP dimension — it is action-kind × data-zone only; it explains single actions, never workflows | A read-only `/classify` endpoint and a panel. ~1 day for the honest subset |
| **COMMAND-AC-10** Dark, System, Light, High Contrast, Reduced Transparency, Reduced Motion | Dark-first palette, twelve-state grammar, `forced-colors: active` and `prefers-reduced-motion` paths, and a contrast gate that passes 86/86 (re-run today) | `tokens.css` states outright that only the dark ramp ships; no Light, System or Reduced Transparency; no visual-regression, keyboard, screen-reader, 200% zoom or frame-time evidence; the gate is not wired into `npm run check` | Wire the gate in (one line) and port the light ramp from the prototype. ~2 days |
| **REVIEW-COMPANION-AC-01** Same canonical draft in every surface | One approval capsule showing the full payload, refusing Approve unless the rendered bytes re-hash to the binding; single-use duplicate prevention proven (P4, P10, P46) | It is the only surface — no Mac capsule, no paired phone — so version reconciliation and concurrent-device approval cannot be tested; `capsule.js:865` states outright that the §5.4.3 controls (Edit, Regenerate, Explain, Open source, Deny, Snooze, Dismiss, Do-not-draft-similar) are absent | Deny and Explain are cheap and close the most visible gap in a demo. ~1 day |
| **COMM-DRAFT-AC-01** Prepare, preview, bound approval, revalidate, one attempt | The full invariant is built and heavily tested: exact preview, hash-bound approval, CAS revalidation, exactly one commit attempt, no blind retry, outcome-unknown frozen (P9–P13, P19) | Proven only against a local filesystem and a local git repository: no Slack, email, GitHub, GitLab, Jira, Figma, calendar or CI adapter, no inbound event to draft from, and zero provider-audit evidence for the deny/edit/expire matrix | One real adapter — GitHub issues through the new intake port is the cheapest — converts this from "proven in a sandbox" to "proven against a provider". ~3 days |
| **APPROVAL-BINDING-AC-01** Binding covers every field that matters | Single-use, short-lived, hash-bound and mutation-invalidating, all directly tested; the binding covers payload, base, target, kind, tier and a provenance hash folding in the proposing agent, the shown summary and the policy hash | No account, attachments, visibility, side-effect declaration or executor identity in the binding, and no device concept at all — so distribution-list expansion, attachment replacement and wrong-device denial cannot be tested | Add executor identity now (~1 day); the rest needs providers and devices |
| **OUTBOX-AC-01** Durable action id, provider idempotency, no auto-retry on unknown | The content-addressed `actionHash` is a durable action id; the approval is spent before the attempt; an executor throw writes an outcome-unknown receipt with no retry loop; `hasTerminal()` keeps the action frozen across a restart; idempotence proven by property test | No outbox queue, no external provider, no provider idempotency key, no timeout handling; no duplicate-click, concurrent-device or provider-without-idempotency test | Same as COMM-DRAFT-AC-01: one real provider |
| **PRESENCE-CONTROL-AC-01** Truthful state, and the ability to steer or stop | Twelve-state grammar giving every state a glyph, a label and a fill so colour is never the only channel; the verified seal cannot animate without a receipt id; L5 asserts every "verified" is a durable chained receipt; outcome-unknown renders "retry frozen" | Exactly one interface; **no steer, pause, stop, cancel or takeover control exists anywhere** — a grep returns zero; no automated test exercises any UI state because `public/` has no test runner | A headless UI runner plus a Deny/cancel path. ~2 days |
| **FORGE-AC-05** Slice discipline: artifact, approval, build, review | Two slices really did run LLD artifact → owner approval → build → unit, property and e2e green, and the decision log records the approval preceding the code | No UI Design Artifact; no Explore/Plan-Mode/Review-QA machinery; no unchanged-worktree pre-gate proof; no artifact version or hash linked to a first implementation change; `33-BUILD-PLAN.md` §4.4 has since replaced the LLD gate with a one-page slice contract; and no Forge product enforces any of this for a user | This AC describes a product feature. The process half is as good as a one-commit repository allows |
| **FORGE-AC-09** Multi-agent isolation, leases, cited handoffs | Two of the five required test classes exist for a single agent: injection cannot self-authorize or replay an approval, self-approval is refused by law, a conflicting edit is refused by CAS, and the executor is lexically and symlink jailed | No multi-agent runtime at all — no per-worker worktree isolation, no leases or stale-lease handling, no typed cited handoffs, no credential or context separation between workers, no cancellation path | The isolation primitives exist; the runtime is Phase 5 |

### Design and video evidence

| AC | What exists | What is missing | What it would take |
|---|---|---|---|
| **VIDEO-AC-01** Canonicalized, deduplicated asset manifest | Per-asset access results, named duplicate relations, an explicit official-export request for account-gated artifacts, and a plain statement that no reel was described from its URL, thumbnail or caption | It does not enumerate all supplied URLs — only aggregate counts (7 unique from 9 submissions) — which is exactly what the required evidence names | Paste the URL list into §1. One hour |
| **VIDEO-AC-02** Frame ledger, one row per decoded frame | `tools/build_full_ledger.py` genuinely computes per-frame SHA-256, monotonic PTS, exactly-once contiguous coverage, duplicate runs, cut/motion classification and a 54+21 transition index; the manifest reports hash and frame counts plus per-source audio status | The machine-readable ledgers and `LEDGER-ASSERTIONS.md` exist nowhere in the repo or on this machine, and the script hardcodes `/opt/homebrew` paths, so nothing is re-derivable here | Requires the source videos and a POSIX ffmpeg. If the sources are not on personal storage, this row is permanently partial |
| **VIDEO-AC-03** No copying; every adopted principle transformed | Seven forbidden compositions rejected on the record with reasons and re-homed needs; all 75 ranges carry a transformation with trade-dress-risk and a11y/perf columns; `git ls-files` confirms no reference asset is checked in | No Motion/Material Evidence Matrix; no asset, code or provenance scan; no chronological-similarity or side-by-side review; no A/B/C comparison; no p50/p95/p99 frame or jank evidence; `27-GATE-PACKET.md` §5.3 states the independent originality review has not been run | The originality review needs a second pair of eyes; the performance evidence needs instrumentation that does not exist |
| **VIDEO-AC-05** Every topology element resolves to real provenance | The Gate-2 prototype implements a documented legend, an aria-labelled canvas and a real field-to-list parity toggle whose rows carry `role=option` and `tabindex=0` | Every node is hardcoded demo data resolving to no provenance; no legend contract tests, fabricated-event or ambient-particle negative tests, and no graph-to-audit reconciliation; the shipped daemon UI has no topology surface at all | Bind the graph to the receipt chain — that is the honest version of this feature. ~3 days |
| **VIDEO-AC-07** One tested mapping for all sixteen named states | Twelve states ship with three redundant non-colour channels each (distinct glyph, DOM/a11y label, measured fill-delta plus key bar) and forced-colors handling; `capsule.js` drives `data-state` from real kernel receipts | Twelve is not sixteen; no state-machine test, no snapshot/motion/earcon matrix, no assistive-technology assertions, no colour-blind test, no tool-event-to-visible-state reconciliation; the contrast gate is not in `npm run check` | Reconcile twelve against sixteen (or amend the requirement) and add a state-machine test. ~2 days |
| **VIDEO-AC-08** 3D confined; code, diffs and transcripts stay flat and readable | Payload, code, diff, table, transcript and longform planes force `backdrop-filter: none` even inside glass chrome; the only animation is one non-looping keyframe gated on a real receipt id; reduced motion honoured globally | No Command/Forge/Counsel journeys at 3D on and off; no 200% zoom, reduced-transparency, contrast-journey or visual-regression evidence. No 3D exists anywhere, so the limit is held vacuously rather than demonstrated | Needs the other two products to be testable |
| **VIDEO-AC-11** Truthful priority-ordered resume state | `GET /state` reports pending, receipts and chain together; SSE replay declares unreplayable gaps; stale-approval invalidation under drift proven by `cas.test.ts`; `--resume` keeps the prior chain | The pending set lives in an in-memory `Map` at `server.ts:58` and does **not** survive a daemon restart — a post-restart approval returns 404. The kernel already has a durable `PendingStore` (`kernel/src/pending.ts`) and the daemon does not wire it. No priority ordering, repository/worktree, agent, action trace, resume/cancel/rollback, or device handoff | **Wire the existing `PendingStore` into the daemon. ~half a day, and it removes the most embarrassing gap in the running product** |
| **VIDEO-AC-13** Evidence stays private and out of repos | The repository negative scan passes — I ran `git ls-files` across the repo and no video, frame, framehash, scene, contact sheet or OCR artifact is tracked; `.gitignore` excludes them by pattern; §6 states the private, no-training, no-redistribution rule | No artifact inventory, ACL or access log; no expiry job; no deletion receipts; the artifacts are not on this machine, so their handling cannot be verified from here | An inventory and expiry job where the artifacts actually live |
| **VIDEO-AC-14** Footage is not evidence for behaviour it cannot show | The discipline is written down and visibly applied: §5 states plainly that automated decode is not semantic analysis, F6 rejects fabricated telemetry because the hardware is UNKNOWN, F7 rejects gesture and voice as authorization, and the architecture marks every performance row blocked rather than inferring it | No artifact named or shaped as a claim-to-evidence matrix exists; none of the five required test families (mobile, accessibility, input causality, security, performance) has been written | The matrix is a document; the five families need subsystems |
| **VIDEO-AC-15** Photosensitivity, vestibular, focus and colour hazards designed out | Status is never colour-alone (glyph + label + measured fill-delta, all three verified by a gate passing 86/86 against 4.5:1 text, 3:1 graphic and a fill-delta floor); exactly one non-looping receipt-gated animation, so no flash exists; long text on forced-opaque planes; reduced-motion and forced-colors handled; focus-visible outlines and `aria-live`/`role=status` present | **Not one of the required tests exists** — no photosensitivity, vestibular, focus-order, screen-reader/live-region, 200% zoom or reduced-mode journey test — and the contrast gate is a manual script | Wire the gate into `check` and add an axe plus keyboard pass. ~2 days |
| **DESIGN-EVIDENCE-AC-01** Per-frame ledgers with reviewer sign-off | The generator produces exactly the specified columns and asserts zero-gap, exactly-once contiguous coverage, monotonic PTS and duplicate classification; the manifest records 9,530 and 8,065 rows, the decoder version and a per-source audio status showing the 24-Aug track is effectively silent | Reviewer sign-off is explicitly absent — `review_status` is pending-semantic-review on every row and `reviewer_confidence` is empty by the document's own statement; unresolved visual intervals stand at 6, not zero; both ledger CSVs are absent from the repo and this machine | Human review of files that are not here |
| **DESIGN-SYNTHESIS-AC-01** Transformation matrix covers every clip | I diffed §5 against `tools/semantic_ranges.json`: all 75 ranges (54 + 21) map exactly, zero unmapped, zero extras, each row carrying observed principle, workflow problem, disposition, transformation, destination product/state, trade-dress risk and a11y/perf cost with m:ss timestamps | The machine-checked report is not a retained artifact — the tally in §5 is hand-written prose and the check I ran lives nowhere in the repo; the seven inaccessible reels contribute no mapped rows | Committing the diff as `tools/check-transformation-matrix.mjs` is ~2 hours and closes the machine-checked half. The inaccessible reels keep it partial permanently |
| **DESIGN-SYNTHESIS-AC-02** Three original directions, same feature coverage | Three substantively different written specifications, each testing its named hypothesis, plus one 1,885-line interactive prototype of the selected B+C system with real reduced-motion and flat-surface toggles | No same-scenario interactive comparison of A against B against C — the gate packet concedes at §1.3.5 that prose specifications are not prototypes; §5.3 states the independent screen-level originality review has not been run; no owner-selected artifact ids, versions or hashes are recorded | Two more prototypes and a reviewer. Weeks |
| **DESIGN-SYNTHESIS-AC-03** Nine-plus seeds across permuted axes | Eleven seeds, each with a hypothesis and an explicit ADVANCE/PARK decision over nine permuted axes; exactly three advance; every parked seed is given a home inside an advancing one | The lab is an unversioned Markdown file rather than a versioned artifact; there is no cosmetic-variant rejection test — the "at least 3 axes differ" claim is asserted prose; §5.3 originality review never run | A script computing axis distance between seeds. ~half a day |
| **DESIGN-GATE-AC-01** No code before the approved prototype | `00-DECISIONS.md` D-GATE (2026-08-28) records owner approval of a single interactive prototype covering all three apps and asserts that no repository, package, dependency or code existed at that moment; D-P1-01-APPROVED follows on 2026-08-29 | No artifact id, version or hash is pinned anywhere, so "any change invalidates it" is unenforceable; no unchanged-worktree, dependency or infrastructure proof; a single commit cannot evidence that the first implementation change followed the approval | Hash the prototype file and record the hash in `00-DECISIONS.md`. One hour, and the claim becomes checkable from here on |
| **ARTIFACT-FEASIBILITY-AC-01** Artifacts stay static, honest prototypes | The prototypes are demonstrably static client-side single files (152 KB) with no backend, auth or connector — the only external references are Google Fonts; D-GATE records the owner approving the locally-runnable equivalent the AC allows | No current official capability receipt; no network, storage or auth negative tests; no size test; no connector-only live-data proof; no local-fallback parity matrix; QM-2 is logged as an unresolved discrepancy; and the prototype does keep durable per-device state in `localStorage` (lines 777–778), which cuts against "never claim durable state" | A negative-test script over the HTML (grep for fetch, XHR, storage) wired into `check`. ~2 hours |
| **BRAIN-AC-01** One original cortex grammar driven only by real events | An original grammar exists in the prototype — an off-centre orchestrator field whose pulses are bound to node state, with a keyboard-reachable list equivalent of the same nodes | Activity comes from hardcoded arrays, not real events; a pulse opens a node card and never a timestamped source receipt; only the Command scale is drawn, and the packet admits the three scales are not delivered as one sheet; no runtime, no event-to-visual contract test, no fabricated-activity negative test, no degraded-source state | Bind pulses to the receipt stream — the same work as VIDEO-AC-05 |
| **CEREMONY-AC-01** Three wake studies, selectable, skippable | All three named studies are specified per direction with a stated choice, a skip path and reduced-motion floor, and the Athena branch is correctly closed | They are prose comparison tables: the interactive prototype contains no wake surface at all — zero occurrences of "wake" or "ceremony" in `23-gate2-prototype.html`; no clean-room originality review, no locked/unlocked/failure/focus test, no name-on/name-off variant, no measured duration or energy | A wake surface requires a wake-word engine. Out of reach this cycle |

---

## 4. NOT-BUILT — 114 criteria, grouped

Not a list of shame. Each group is one honest sentence about why nothing is there.

| Group | Count | Why nothing exists |
|---|---:|---|
| **Zeno Counsel** — meetings, transcription, consent, overlays, meeting memory | 10 | The entire product is unstarted. It needs audio capture, diarization, a consent ledger and a screen overlay, none of which exist; `patch.task` is an action-kind label and the `.zg-transcript` CSS class is a payload-opacity rule with no data behind it. |
| **Voice** — wake phrase, dictation, enrolment, diarization, speaker identity, adaptation | 14 | There is no audio path at all: greps for voice, audio, VAD, TTS, diariz and speaker return zero hits in `packages/`. Every one of these criteria also requires measured FAR/FRR, DER/JER or WER numbers, which need a model runtime and an evaluation corpus that were both cut. |
| **Zeno Vault** — memory, recall, briefings, E2EE sync, conflict resolution, note writing | 7 | Nothing persists except the receipt chain. There is no memory store, no Obsidian writer, no embedding index and no vault workspace; the criteria about sync additionally need a second device. |
| **Zeno Mesh / Link** — pairing, capability negotiation, command signing, handoff, multi-target, phone | 8 | The owner has one machine. The daemon binds `127.0.0.1` and addresses nothing beyond its own process, so there is no transport for a device concept to sit on — the only `device` matches in the codebase are Win32 reserved device names in the executor's path jail. |
| **Senior-engineer tool surfaces** — terminal, dev server, IDE, test runner, browser QA, API, data, infra, CI, observability, security, release, on-call, end-to-end journeys | 19 | Zeno never starts a process. Greps for `child_process`, `spawn` and `execFile` return zero hits across all packages, and no external service client exists. Everything in this group presupposes a process supervisor and an adapter layer that were scheduled after the surfaces that shipped. |
| **Context Sanitization Gateway** — sink registry, quarantine store, credential placeholders, scanning, lineage, metrics, notifications, preview-server isolation, compliance fields | 10 | `docs/14-context-sanitization-gateway.md` is design prose with no implementation; a grep for `sanitiz` returns zero files. The gateway mediates model egress, and there is no model, no provider and no egress to mediate. One counterexample is worth naming: `daemon/src/main.ts` prints the live proposer token in cleartext to stdout and into `.daemon.log`, which is the opposite of what SAN-AC-06 requires — the file is gitignored, but the token is on disk. |
| **Zeno Forge** — coding surface, context packs, modes, review workbench, completion contract, agent handoff, capability matrix | 8 | The product is unstarted (Phase 5, unbegun). What exists of its foundations — the jailed executors, the CAS refusal, the injection tests — is real, but there is no Ask/Explore/Plan/Build/Review surface, no repository indexing and no multi-agent runtime for those primitives to serve. |
| **Command surfaces beyond approvals** — navigation, chat, attention centre, launcher, customization, workflow debugger, workstation control | 7 | The shipped UI is a single-column approvals shell titled "Zeno Command · approvals". Every other named surface needs an event source, an orchestrator or a model; the only user action in the product today is Approve. |
| **Assistant execution and communications** — app control, activity awareness, inbound events, telephony, message classification, timers and utilities, natural-language commands | 7 | There is no natural-language layer and no OS automation: the only two input surfaces are a typed JSON body on `POST /previews` and `process.argv` in the CLI. `message.send` and `jira.write` exist as tier labels with no adapter behind them. |
| **Capability broker, model gateway, MCP and connectors** | 6 | No credential broker, model provider, quota, cost cap or OAuth code exists, and the MCP subsystem was deferred out of the eleven weeks entirely — a grep for `mcp` returns zero hits. `AuthEvidence` in `types.ts` is an opaque placeholder the daemon satisfies by hardcoding `method: 'owner-token'`. |
| **Suite-level platform obligations** — independent product launch, task identity and handoff, steer/pause/kill, licensing and SBOM, download quarantine, ephemeral retention, repo bootstrap receipt | 7 | These describe a suite of products and a release pipeline. There is one product, no CI at all (no `.github/`), no LICENSE, no SBOM and no provenance report; `18-roadmap-and-risk-register.md` records the repo-creation receipt (E1-5) as not started. |
| **Windows pilot, packaging and platform proof** | 4 | There is no signed build, no installer, no host manifest and no release candidate. The only Windows fact provable today is that the test suite runs green on the Windows 11 pilot machine, which is a test run, not a piloted primary journey. |
| **Performance and real-time budgets** | 3 | Not one frame-time, jank, latency-percentile, CPU/GPU, power or thermal number is measured anywhere; a grep for `performance.now`, `hrtime`, `p95` and `latency` in source matches only a DOM id generator and an expiry countdown. `12-architecture-and-adrs.md` records the whole family as blocked on an unanswered hardware question. |
| **Design and video evidence still owed** — unlock ceremony, gesture control, gallery provenance, feature observation ledgers | 4 | Three need subsystems that do not exist (a wake surface, a camera pipeline, a gallery). The fourth, the Feature Observation Ledger, is a document the manifest itself lists as outstanding before Gate 2. |
| **Total** | **114** | |

---

## 5. OUT-OF-SCOPE — 35 criteria permanently cut

These are not "later". They cannot be closed in this repository, ever, and leaving them open as
future work would be dishonest. Three structural reasons account for all but one.

### Reason 1 — the employer relationship ended (18 criteria)

The owner was laid off on **2026-09-02**. Jira, GitLab, Slack, NeoSapien, the WEBEXT project, the
`/quillbot-lt-conventions` skill and Graphify were employer systems accessed with employer
credentials. They are gone, and no personal substitute exists, so criteria written *about those
systems by name* can never be satisfied.

`CAP-AC-04`, `JIRA-CREATE-AC-01`, `WORK-AC-01` … `WORK-AC-05`, `TASK-CANDIDATE-AC-01` … `-03`,
`NEO-MCP-AC-01` … `-04`, `FORGE-HANDOFF-AC-01`, `FORGE-AC-02`, `FORGE-AC-03`, `FORGE-AC-04`.

The design lesson has been acted on rather than mourned. The flagship journey was written as
*Jira → Intake → context → TASK → Forge*, which welded one vendor into the trigger; the trigger was
never Jira, it was **a work item arriving**. `packages/intake` (38 tests, added 2026-09-04) is that
seam extracted as a port, with a local JSONL backlog as the first adapter. The journey survives; the
criteria naming Jira do not.

### Reason 2 — the work Mac went with it, and one person cannot carry a second platform (15 criteria)

macOS was cut permanently on 2026-09-04 (`33-BUILD-PLAN.md` §6). Two independent causes, either of
which is sufficient: the Mac was the employer's machine and is gone, and a second native platform
cannot be built, tested and kept honest by one person in eleven weeks alongside the first.

`WORK-MAC-GATE-AC-01`, `MAC-COVERAGE-AC-01`, `MAC-TARGET-AC-01`, `MAC-TARGET-AC-02`,
`MAC-FILES-AC-01`, `MAC-WEB-AC-01`, `MAC-CONTENT-AC-01`, `MAC-SYSTEM-AC-01`,
`MAC-AUTOMATION-AC-01`, `MAC-A11Y-AC-01`, `MAC-RECOVERY-AC-01`, `DESIGN-MAC-AC-01`,
`DESIGN-MAC-AC-02`, `DESIGN-MATERIAL-AC-01`, `DESIGN-XPLAT-AC-01`.

One of these deserves saying plainly rather than quietly retiring: `WORK-MAC-GATE-AC-01` must
**not** be recorded as "held". `00-DECISIONS.md` records the owner authorizing Phase-1 code to
build and run on that employer machine, and no negative-inventory receipt, device registry or
build-hash-bound approval event was ever produced. The gate was not satisfied; it was overtaken.

### Reason 3 — the budget is zero, and the evidence could never have licensed the claim (1 criterion)

`FINE-TUNE-AC-01`. The model and evaluation lab, PEFT/LoRA adapters and the promotion ladder were
dropped for a reason stronger than cost: with a 40–80 task corpus, an evaluation can only detect a
12–24 point effect, so a promotion decision could never have been licensed by the evidence
available. Shipped scope stops at rung 3 of the adaptation ladder — retrieval and rules, never
weights. There is no paid API, no GPU budget and no cloud spend anywhere in this project.

### A fourth, of a different kind — forbidden by construction (1 criterion)

`ASSIST-AC-07` asks for autonomous commerce: checkout, price revalidation, 3-D Secure, biometric
confirmation. Zeno permanently forbids exactly that. `payment` is T4 and the `financial` data zone
forces T4; `validatePolicy()` refuses to even load a policy file that relaxes either half, and
`laws.test.ts` L7 plus `e2e.test.ts` prove it end to end. This row is out of scope not because it
was too hard but because building it would break the product's central guarantee.

---

## 6. What Zeno provably does today

*The paragraph the owner can read aloud, and defend line by line. Read it only when
`npm run check` is green — see §1.*

> Zeno is a governance kernel for AI agents, and it works. An agent proposes an action; a
> deterministic kernel classifies it against a hash-pinned policy and returns a preview with no side
> effects; I approve it in a browser capsule that refuses to enable the Approve button unless the
> payload rendered on my screen re-hashes to the exact bytes the approval binds; a path-jailed
> executor performs it once; and a hash-chained receipt records what happened. That chain is
> tamper-evident — edit any past receipt, or delete one from the end, and verification names the
> exact index that broke. The properties I care about are enforced by construction and pinned by
> tests: nothing above the lowest tier reaches the executor without my explicit approval, an agent
> can never approve its own proposal, an approval is single-use and expires and is bound by content
> hash to one action, and if the world moves between my approval and the commit the commit refuses
> rather than applying to a file I did not see. The executor attempts exactly once — there is no
> retry loop anywhere — and if it cannot prove what happened, the receipt says `outcome-unknown`
> and the action stays frozen across a process restart. It catches a filesystem that lies about a
> write and a git that reports a commit HEAD never took. Payments are unreachable by construction,
> and a policy file that tries to relax that is refused at load. Today that is 203 tests across four
> packages, the kernel at 98.75% line coverage with zero runtime dependencies, an accessibility gate
> passing 86 of 86 contrast pairs, and a full replay-determinism guarantee enforced by a lint that
> fails the build on an ambient clock.
>
> What it does not do, I will say before you ask. There is no Counsel, no Vault, no Mesh and no
> Forge — those are four of the five products in the specification and none of them has a line of
> code. There is no voice, no local model, no MCP and no connector to any external service, so
> everything I have proven is proven against a local filesystem and a local git repository, not
> against a provider. There is one machine, so there is no pairing, no handoff and nothing
> distributed. Receipts are tamper-*evident* through SHA-256 chaining, not tamper-*proof* — nothing
> is signed. Of 196 acceptance criteria I wrote for the full suite, zero are fully met, 47 are
> partial, 114 are unbuilt and 35 are permanently cut. I would rather show you a kernel whose
> guarantees survive a hostile test than five products that survive a demo.

---

## Appendix — reproducing every number in this report

```
cd D:\code\Zeno

npm run check                                   # 203 tests across kernel, intake, daemon, cli
npm run demo                                    # one verified + one refused receipt, deterministic
npm run ledger:verify                           # re-verify the chain on disk
npm run up                                      # the daemon + Glass UI on 127.0.0.1:7317

node packages/daemon/public/glass/contrast.mjs  # PASS 86/86

git log --oneline                               # one commit: b847a60
git status --short                              # daemon, cli, intake, git-executor untracked
git ls-files | grep -Ei '\.(mp4|mov|png|jpg)$'  # empty — the VIDEO-AC-13 negative scan
```

**Counts in §1 were verified mechanically**, not by hand: the 196 ids in this report were diffed
against `docs/ledgers/acceptance-criteria.csv` (0 missing, 0 extra, 0 duplicates) and tallied by
status.

**Known staleness risks.** Three files landed during the writing of this document and two criteria
changed status as a result. The daemon suite is red at the freeze for the same reason. Anything in
this report can be checked in under two minutes with the commands above — check before you quote.
