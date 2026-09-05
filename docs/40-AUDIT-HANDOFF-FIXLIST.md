# 40 — Audit Handoff & Fix-List (for the builder)

**From:** the independent audit (docs/39). **Grounded in:** live on-disk source — 11 packages, ~533 tests, 0 failing.
**Critical caveat:** the tree changed **three times mid-audit** (`server.ts` 460→542; Forge/Counsel packages appeared). Line numbers are "as of this read" — re-confirm before acting. **Freeze the tree during any review.**

## Verdict
Sound safety architecture; the two worst holes are patched **in source**. But this is **mid-build, not shippable**: stale compiled artifact, a shell that contradicts the code, signing claimed-but-unverified, Mesh orphaned. Strong, honest **work-in-progress**. Fix P0/P1 and it becomes both faithful and safe.

## P0 — must fix before anyone runs this
1. **Rebuild and re-verify the daemon `dist`.** Source is fixed, but a running build still leaked the owner token via `GET /` (confirmed with `curl` — real token in `set-cookie` + meta) because `dist` was compiled from the old vulnerable source. Safe source + unsafe artifact = unsafe product. After rebuild: `curl -i http://127.0.0.1:7317/` with no token **must** return an empty `zeno-token` and no owner cookie.
2. **Verify signing end-to-end, or stop claiming it.** The banner prints "signed (Ed25519)" but no shipped tool checks a signature — `ledger:verify` walks only the hash chain. Wire real signature verification into the verify path, or remove the claim. A guarantee nothing checks is worse than honest silence.
3. **MCP writes UNSIGNED receipts into the SAME ledger the daemon signs.** `mcp/src/main.ts:101` builds the Kernel with no `receiptSigner`; `daemon/src/main.ts:39-40` signs. Over one `ZENO_DIR` that's a mixed signed/unsigned chain from two processes to one append-only file, no cross-process lock. Decide: MCP signs too, MCP uses a separate ledger, or signing is explicitly per-writer and documented.

## P1 — correctness / honesty gaps
4. **`index.html` contradicts the shipped code.** The static shell still says *"Forge is not built yet"* / *"Counsel is not built yet… its module is not wired yet"* (`public/index.html:441,451,471,482`) while `public/forge.js` (1009 lines) and `public/counsel.js` (1322 lines) and their routes exist (`server.ts:172-176`). Lazy-init hides it at runtime, but the resting HTML lies about the product's own state. Fix the placeholder copy.
5. **Mesh is orphaned.** `packages/mesh` (43 tests) isn't imported by the daemon or in its deps. Either surface a device/handoff view in the window, or explicitly label Mesh a standalone protocol core not yet surfaced.
6. **Confirm the risk auto-apply trade is intended (owner decision).** With risk-based auto-apply, a holder of the **proposer** token (or anything speaking to the MCP stdio, which has no auth) can cause **bounded T0 auto-commits** with no owner approval. L6 still holds (a proposer cannot mint an approval); but "approve nothing" ≠ "cause no effect." **Owner ruling from docs/39: make auto-apply opt-in, off by default, threshold owner-configurable in `policy.json`.**

## Keep — do NOT regress
- Two prior critical breaches correctly fixed in source: unauthenticated `GET /` owner-token disclosure now gated by owner-role or one-time launch nonce (`server.ts:118-134`); client-`kind` override removed — kind hard-derived from `risk.kind` (`server.ts:~475`), matching what MCP always did.
- Receipt-derived success (never optimistic), fail-closed policy, secret-scan forcing secret-bearing "routine" writes to stop for the owner, constant-time token compare, path jail, SSE gap-declaration. This discipline is the best part of the codebase.
- The MCP "re-proposing cannot double-apply" test correctly encodes content-addressed idempotency (2nd identical proposal = safe no-op, 3rd over unchanged base = held). Not an L2/L4 weakening.

## Feature completeness (196-criterion spec) — materially incomplete, by priority
- **Reasoning/model layer** — no local model → no NL→action, no true assistant chat, no Forge-as-agent. The *action* gate is built; the *reason* engine isn't.
- **Integration breadth** — model gateway, credential broker, OAuth, ~8 connectors, quota/cost caps: none.
- **MCP breadth** (SUITE-AC-07) — governed registry, scoped grants, per-agent isolation, revoke, malicious-server tests, NeoSapien server, Streamable-HTTP. Only thin stdio propose/read exists.
- **Forge/Counsel depth** — real (~1000-line modules) but thin against 25/10-criterion specs (device fleet, streaming chat, DAGs, diarization).
- **Eval/hardware-gated** — voice FAR/FRR, perf/thermal, a real second device (Mesh phone app).
- **Ship infra** — code signing, installer, CI/SBOM, release candidate.
- Per `docs/ledgers/acceptance-criteria.csv`, **all 196 rows still read `not-started`.** Don't inflate.

## Design fidelity vs Gate-2 prototype — faithful tokens, NOT "ditto"
- **Exact match:** full graphite palette, accent tokens, glass material (`blur(26px) saturate(175%)`). Command structure faithful.
- **Diverges (decide if intentional):** signature **IBM Plex Mono + Newsreader serif** dropped for system fonts (consequence of no-web-fonts/no-CDN rule); **cinematic veil + ambient glows** omitted (glass restricted to nav); **light theme** gone (dark-only). If "ditto to Gate-2" is required: bundle the two fonts locally, restore the veil/ambient layer, add the light palette. If the austere look is accepted, record it in the design doc so it stops reading as a regression.

## Process
Docs 34 (and parts of 39's original body) are **stale against current source** — update them or downstream readers re-audit against fiction. **Freeze the tree during review**; a repo that mutates three times per session produces reports obsolete on arrival.

**One-line:** sound safety architecture, worst holes patched in source, but mid-build (stale artifact, self-contradictory shell, unverified signing, orphaned Mesh); fix P0/P1 and it's faithful and safe — not yet a finished product, 0/196 formally met.
