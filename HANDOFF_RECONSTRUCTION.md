# Zeno — handoff reconstruction

> Written 2026-09-13. This file exists because the prior handoff artefacts were
> created in a previous workspace and are **not present on this machine**. It
> records the honest baseline, what is actually verified, and what is blocked.
> Nothing here is carried over from a summary: every "verified" line names the
> test that produced it.

## 1. Missing prior artefacts

Searched the repository, all of `D:\` and `C:\Users\abhee`. **None of these exist:**

- `MEMORY_FULL.md`
- the original goal file
- `ACCEPTANCE_DELTA_2026-09-10.md`
- `ZENO_FINAL_INTEGRATED_QA_PLAN_20260911.md`
- `ZENO_REQUIREMENTS_TRACEABILITY_LEDGER.md`

Their contents are **not reconstructed or guessed**. Nothing is marked passed on
the strength of a prior summary.

## 2. Active baseline

`D:\Work\Zeno Study Pack\acceptance-inventory.csv` — **196 unique criteria**, and
it is the current local source of truth.

| Class | Count |
|---|---:|
| implemented + verified | **0** |
| implemented, not live-verified | 85 |
| unimplemented / planned | 34 |
| unavailable / blocked | 43 |
| out-of-scope (recorded decision) | 34 |

**The formal result is 0/196 accepted.** That is the starting point, deliberately.

Named priority gaps carried from that audit: `GAP-TERMINAL-WINDOWS` (P0),
`GAP-FORGE-REASONING` (P0), `GAP-COMMAND-GROUNDING`, `GAP-VOICE-COMPOUND`,
`GAP-COUNSEL-PHYSICAL`, `GAP-CONNECTORS-AGENTS`, `GAP-DEVICE-FLEET`,
`GAP-VISUAL-MATRIX`, `GAP-RELEASE-PACKET`.

## 3. Current state of the product

| Thing | State |
|---|---|
| Repository | `D:\code\Zeno`, branch `phase-0-and-p1-01-kernel` |
| Daemon tests | 191/191 pass (`node --test dist/test/*.test.js`) |
| Whole-workspace gate | `npm run check` — 16 gates, **not re-run this session** |
| Packaging | `npm run build:app` succeeded → `dist-app\Zeno-Setup-0.1.0-x64.exe` and `Zeno-0.1.0-x64-portable.exe` (~103 MB) |
| Packaged dependency closure | **Complete** — every `@abheet19/zeno-*` the packaged daemon requires is shipped (this is the exact failure that rejected binary `7ec08e0`) |
| Packaged launch | Binary starts; daemon **listening on 127.0.0.1:7317**; window present |
| Public deployment | None. Zeno has no public web deployment |

### Renderer rewrite (this session)

The renderer was replaced with the design artifact's own markup, CSS and
interaction layer, then re-bound to the daemon through `bind.js` + per-screen
binders. Consequences that matter:

- **Regression introduced and being repaired:** Forge's real Monaco editor was
  left unmounted (measured: `window.monaco` undefined, 0 `.monaco-editor`
  instances, static mock visible). CONTEXT.md documents the lost behaviour —
  two Monaco groups, closeable tabs, dirty state, governed save, dirty-close
  confirmation, resizable split, persisted layout. Repair in progress.
- **Same class of failure already hit the orb** — `field.js` mounted but never
  sized because the artifact does not set `data-zeno-surface`. Fixed and proven
  (canvas sizes to 1200×556 when the tab is visible).

**Rule this establishes:** lifting a design artifact wholesale silently drops
real behaviour the mock merely depicts. After any such lift, enumerate every real
subsystem the previous renderer mounted (Monaco, field.js, capsule.js,
timeline.js, counsel.js, mesh.js, voice.js) and prove each is still mounted.

## 4. Verified this session (with the test that proves it)

| Claim | Evidence |
|---|---|
| 216 interactive controls, **216 wired, 0 inert** | Every control enumerated from the live DOM and cross-referenced against the shipped JS. Proves **wiring only**, not outcomes. |
| P0 `GAP-TERMINAL-WINDOWS` does **not** reproduce | `git --version`, `git status`, `git log` all return full stdout via `/forge/terminal`. (A first run of `git status --short` returned empty — that is correct on a clean tree, not the defect. Nearly filed a false P0.) |
| Mock data removed from Command screens | Scan for artifact markers (`INGEST-12`, `7 receipts`, `patch.task`, …) returns zero on all 10 Command screens. |
| Rail/Forge counts are real | All fake badges cleared; blank when genuinely zero, `Integrations 3` from the real agent list, kernel line reads `0 receipts`. |
| Packaged dependency closure complete | Diff of required vs shipped `@abheet19/*` in `win-unpacked/resources` — zero missing. |
| Compare picker layout fixed | Footer stacks, meter/run-mode 334 px, `Compare 2 →` fully inside the popover, list scrolls internally. |

## 5. Open failures and gaps (not passed)

- **Forge Monaco editor unmounted** — repair in progress. Until proven, every
  Forge editor criterion is FAILED, not blocked.
- **Window title does not vary by surface** — packaged window reports `Zeno`;
  §1 requires `Zeno Command` / `Zeno Forge` / `Zeno Counsel`. Under investigation.
- **Memory import (Claude/Codex)** — §6 requires it; there is **no import route**
  in `server.ts`. The UI no longer fakes a preview. Criterion = unimplemented.
- **Projects** — no `/projects` or `/repos` route exists; only the single sandbox
  repo is shown, stated plainly.
- **Connectors / plugins** — catalogue only; no live OAuth or install path.

## 6. Blocked — exact prerequisite required (never call these passed)

| Path | Prerequisite |
|---|---|
| Codex provider | `codex` CLI is **not installed**. Install + authenticate. |
| Phone / Device Sync | A second device to pair. Deferred by owner to the end. |
| Email summary (Counsel) | No mail transport configured. |
| Authenticode signing | No code-signing certificate; installer is unsigned (SmartScreen warns). |

Available and therefore testable for real: `claude` CLI (present), Ollama with
`qwen3:4b / 8b / 14b`, microphone (owner confirmed).

## 7. Method in force

Per owner instruction: no completion claim from screenshots, code reading or
design intent. A criterion moves only when the UI, the control's real behaviour,
the backend/persistence path, and the failure state are each exercised and the
evidence saved with commit, environment and limitation. Evidence lives in
`evidence/<short-sha>/` (gitignored).

Requirements stated by the owner in conversation but absent from the 196 are
added as new criteria with the source note:
**"User explicit requirement from handoff conversation."**
