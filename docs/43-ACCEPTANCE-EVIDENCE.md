# Acceptance evidence boundary — 2026-09-10

This document maps current focused checks and retained live observations to clauses in the
canonical 196-row acceptance ledger. It does not award acceptance. A row is complete only when
every clause and every item in its `required_evidence_summary` has a retained artifact.

## Current canonical status

| Item | Current fact |
|---|---|
| Canonical ledger | `docs/ledgers/acceptance-criteria.csv` |
| Ledger rows | 196 |
| Canonical statuses | 196 `not-started` |
| Whole rows proved by this audit | 0 |
| Status edits made by this audit | 0 |

Evidence below is split by scope. The complete workspace gate was rerun on clean implementation commit
`db674c0bd1112786eae70bbbce2ec39e44365b52` (tree `c904c41019f754051b12bd04cae2b775dcd95824`).
The rebuilt dark package then received fresh-profile theme, 21-check UI, exact answer-only, and held-edit probes in an isolated Zeno directory. The physical hold-to-talk probe predates the theme-only commit and is labelled separately.

| Command | Observed result | Evidence boundary |
|---|---|---|
| `npm run check` | Exit 0; 16 workspace summaries; 1,456 tests, 1,454 passed, 2 skipped, 0 failed | Exact clean commit `db674c0bd1112786eae70bbbce2ec39e44365b52`; the two skips are Windows symlink-fixture creation denied by the OS |
| `npm run build:app` | Portable and NSIS artifacts emitted | Build occurred before the theme changes were committed; packaged `index.html` and `theme-boot.js` byte-match clean `db674c0`, but the build log did not record a Git SHA and the package is not claimed reproducible byte-for-byte |
| Fresh-profile theme | Graphite dark before CSS; System, Light, and Dark saved choices round-tripped; zero page/console errors | Current dark package on this Windows machine |
| Packaged UI acceptance | 21/21 passed; zero page/console errors and no protected mutation | Current dark package; Command, Settings, Forge Agent/Editor, panels, split, catalogs, zoom, and mobile |
| Exact answer-only prompt | `WRITE A for loop` returned valid JavaScript in 4.376 s; no proposed files or repository/approval change | Current dark package; one `qwen3:8b` low-effort prompt |
| Local held edit | One file proposed in 825 ms; fixture unchanged before approval; exact 48 bytes landed after approval; signed receipt outcome `verified` | Current dark package; one `qwen3:8b` low-effort fixture task |
| Physical hold-to-talk | Exact phrase heard and routed; status returned to Idle; microphone released | Immediately preceding F10 package on this Windows machine; `db674c0` did not change voice code; no post-dark physical rerun |

A clean-profile installer/uninstaller test has not been performed. The retained package checks prove
the named journeys on this machine; they are not a public-release certificate or broad device/audio
quality benchmark.

`docs/34-ACCEPTANCE-STATUS.md` and `docs/42-ACCEPTANCE-AUDIT.md` are historical snapshots.
Their counts and conclusions must not be combined or quoted as current status. In particular,
`docs/42-ACCEPTANCE-AUDIT.md` did not retain the row-by-row artifacts needed to reproduce its
“roughly half met” headline.

## Retained current-session evidence

The following files are retained outside the repository in the shared validation workspace. Their
hashes let a reviewer detect later replacement. The probe URLs have ephemeral owner tokens redacted.
The JSON probes do **not** record a Git commit or complete dirty-tree hash, so they substantiate the
observed journey only. For the dark change, packaged `index.html` and `theme-boot.js` were separately
byte-compared with clean `db674c0`; this still does not make the whole package a reproducible build.

| Artifact | SHA-256 | What it observed | What it does not prove |
|---|---|---|---|
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-release-db674c0-check.log` | `79BF6C66FBE53A5FAA934D8831878C30BF9E68ED350685D8B8650CE79B405AA4` | Exact clean commit `db674c0`: all 16 workspace gates, 1,456 tests, 1,454 passed, 2 explicit Windows symlink skips, 0 failed | Electron rendering, clean-profile installation, or external providers |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-dark-default-report.json` | `F46CA811D68B7D3D558D448D66ECF188520351E03CAD412C8B2F352D045C1F6E` | Fresh profile defaulted to Graphite dark before CSS; System, Light, and Dark preferences round-tripped; zero page/console errors | Every OS theme, contrast certification, reduced-motion certification, or installer behavior |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-dark-full-output\zeno-packaged-ui-acceptance.json` | `ECF99FF6CE7408C55C10A7E9CDEC962F671B95484C0BECA4AC23CF331D339770` | 21/21 current dark-package UI checks across Command, Settings, Forge Agent/Editor, tabs, split, panels, catalogs, zoom, and mobile; retained URL token redacted | A hosted run, destructive action, assistive-technology certification, or every viewport |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-dark-answer-only.json` | `F4CEB07371D4954231CAA33B61572A87724D6B7CA910509F86EB4C15E20F67AA` | Exact `WRITE A for loop` prompt on local `qwen3:8b` low returned valid JavaScript in 4,376 ms; no proposed files, repository/head or pending-approval change; zero page/console errors | Answer quality beyond that prompt, editing, concurrency, or other models/hardware |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-dark-local-held-edit.json` | `8304BE73E862A2C6FCA25C841405AD7B441A123683401A9732CBAF3CC86C17B1` | Local `qwen3:8b` low produced one exact held file in 825 ms; fixture remained unchanged before approval; exact expected bytes landed after approval | Arbitrary tasks/repositories, multi-file edits, conflicts, cancellation, or hosted providers |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-dark-local-held-edit-receipt.json` | `E115895A2C93F849F31402E4B5F23D3EB6AF3BFD943045204D3B77D28D422225` | Matching `patch.task` receipt: action hash `78f20c48…6ce454`, target fixture path, external effect hash for the exact 48 bytes, outcome `verified`, signed/hash-chained record retained | Independent key attestation, external timestamp authority, or broad edit reliability |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-hold-to-talk-f10.json` | `FB9883530BBE88466357CFCD8EFE23C9D3E4B042C07D85BD574C1523E4CC0941` | Physical pre-dark F10 hold-to-talk heard the full target phrase, routed it, replied, returned to Idle, and released capture; voice source is unchanged in `db674c0` | A post-dark physical rerun, speaker identity, false-accept rate, noisy-room accuracy, accents, or ChatGPT Voice parity |
| `D:\Code\Zeno\dist-app\Zeno-0.1.0-x64-portable.exe` | `4F23B7C053E8BE63398A564069901B2FE12107787B279D564393912373B0EBE1` | Current dark portable Windows artifact was emitted | Code signing, clean-profile install, updater, public distribution, or reproducible bytes |
| `D:\Code\Zeno\dist-app\Zeno-Setup-0.1.0-x64.exe` | `3653BDF41934921985DEF7AB49BBFF40A402D7C79EF880FD185989407266A322` | Current dark NSIS installer was emitted | Code signing trust, install/uninstall on a clean account, updater, rollback, or reproducible bytes |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\zeno-forge-tests-2026-09-10.log` | `B1A56A0A395E245D4E1BE7C88D74523EED824AC6A12511AD9E013D190537FE9C` | Forge package: 140/140 passed, 0 failed, 0 skipped | Other workspaces, Electron rendering, or a hosted provider |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\zeno-daemon-tests-2026-09-10.log` | `18EF07C6AD714ADFC764C2C9A42DB239D7B813D4F444CDDEB783F8DEF189F09F` | Daemon package: 161/161 passed, 0 failed, 0 skipped | Whole-workspace check/build or real external services |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\zeno-forge-repository-answer-final.json` | `7B2001E4B8C96CCFF879C959F42B87F2BA62C8259EC2C329EEA9DFEB2F4F46FE` | Earlier live local `qwen3:8b` repository read answered the fixture README heading; 2,919 ms; repository unchanged | Current dark-package binding, arbitrary repository comprehension, or mutation |
| `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\zeno-forge-capabilities-final.json` | `C4491712B79C8007666445BE284948B7E4DC55C2F8B99D44BCFC6DD4E2756387` | Earlier live Forge terminal one-shot exit code, independent tabs/close, one discovered test, honest unwired CI and process inventory; no page errors | Current dark-package binding, persistent PTYs, wired CI/debugger, or every terminal command |
| `docs/demos/forge.gif` | `8F0C86659E7899A0EAD7896FA9C8FEB50D9DF614961B79EA759032F730B6CCAA` | Current 1,560 x 1,050 Forge recording from a disposable Git fixture: isolated file proposal, held T1 review, owner approval, verified receipt, and real terminal `git status --short` with exit code 0 | Hosted-provider quality, arbitrary repositories, concurrent runs, cancellation, or persistent PTYs |

The current dark-package local answer and held-edit probes used the packaged Electron renderer and
Ollama on loopback. The held edit's expected post-hash matches the landed bytes, and its companion
receipt records a verified external-effect hash. The retained files do not include a comparable
current-tree hosted Claude Code or Codex edit, multi-file/conflict/cancellation/concurrency coverage,
a post-dark microphone corpus, or a real meeting-app capture. Those claims remain open.

`docs/demos/forge.gif` was re-recorded from the current Forge layout and owner-review policy. The
recorder creates a disposable committed Git fixture, submits a real file proposal through the
daemon, waits for owner approval, verifies the resulting receipt, and runs a real terminal command.
It does not mutate the Zeno repository or fabricate terminal output. `forge` is part of the default
scene list in `tools/record-demos.mjs`; the generated artifact is 291,307 bytes at SHA-256
`8F0C86659E7899A0EAD7896FA9C8FEB50D9DF614961B79EA759032F730B6CCAA`.

## What the automated checks substantiate

The IDs below are exact ledger rows whose **individual clauses** are exercised by tests. They are
not fully accepted rows. The last column names representative evidence and the principal evidence
still missing from the row.

| Area | Acceptance rows with tested clauses | Representative automated evidence | Why the rows remain open |
|---|---|---|---|
| Approval and effect safety | `CAP-CATALOG-AC-01`, `COMMAND-AC-01`, `COMMAND-AC-08`, `COMM-DRAFT-AC-01`, `APPROVAL-BINDING-AC-01`, `OUTBOX-AC-01`, `REVIEW-COMPANION-AC-01`, `WORK-AC-05`, `VOICE-AC-05`, `SAN-AC-04`, `SAN-AC-08`, `SAN-AC-11`, `DESTRUCTIVE-AC-01`, `GIT-SAFETY-AC-01`, `FORGE-AC-09` | `packages/kernel/test/laws.test.ts`, `cas.test.ts`, `e2e.test.ts`, `injection.test.ts`, `policy-load.test.ts`, `risk.test.ts`, `executor-git.test.ts`; `packages/daemon/test/forge-permissions.test.ts` | The rows also require registry-wide coverage, live product journeys, browser inspection, hostile or external targets, and retained receipts. |
| Stream, recovery and interruption | `SUITE-AC-05`, `SUITE-AC-06`, `SUITE-AC-12`, `MEMORY-AC-03`, `PRESENCE-CONTROL-AC-01`, `COMMAND-AC-09`, `VIDEO-AC-11` | `packages/daemon/test/server.test.ts`; `packages/kernel/test/ledger-durable.test.ts`, `tamper.test.ts`; `packages/cli/test/demo.test.ts`; `packages/forge/test/runner-node.test.ts` | Required evidence includes live and replayed multi-product runs, crashes and reconnects on supported clients, performance limits, and visible degraded states. |
| Packages, capabilities and MCP | `SUITE-AC-02`, `SUITE-AC-03`, `SUITE-AC-07`, `CAP-AC-02`, `CAP-AC-03`, `PROVIDER-ETHICS-AC-01`, `FORGE-AC-10` | Workspace checks; `packages/mcp/test/server.test.ts`, `rpc.test.ts`; `packages/forge/test/routing.test.ts`, `agents.test.ts` | Independent launch/recovery, dependency and no-cycle reports, provider terms/licensing artifacts, full capability conformance, and live adapter evidence are outstanding. |
| Vault and grounded memory | `MEMORY-AC-01`, `MEMORY-AC-02`, `MEMORY-AC-04`, `ASSIST-AC-08`, `VAULT-AC-03`, `SUITE-AC-11`, `COUNSEL-AC-05` | `packages/vault/test/vault.test.ts`, `memory.test.ts`; `packages/daemon/test/memory-routes.test.ts`, `forge-memory-context.test.ts`, `forge-context-model.test.ts`; `packages/assistant/test/snapshot.test.ts`, `ground.test.ts`; `packages/desktop/test/capture-lifecycle.test.cjs` | The Forge contract now proves task-only cited recall from a reloaded Markdown Vault, sanitized exact-prompt preflight/run parity, default-on per-session opt-out, and stale-context refusal before provider execution. Multi-device conflict, external-editor, deletion/undo, access-control, migration, lock/crash and full export/recovery evidence remains outstanding. |
| Sanitization | `SAN-AC-03`, `SAN-AC-04`, `SAN-AC-05`, `SAN-AC-07`, `SAN-AC-09`, `SAN-AC-10`, `SAN-AC-12` | `packages/sanitizer/test/sanitize.test.ts`; `packages/skills/test/screen.test.ts`; `packages/daemon/test/server.test.ts`, `counsel.test.ts` | The rows require broader frozen corpora, logs/receipts/telemetry scans, multilingual and file-format coverage, repair/override journeys, and measured quality thresholds. |
| Assistant, voice, browser and intake | `ASSIST-AC-01`, `ASSIST-AC-02`, `ASSIST-AC-03`, `ASSIST-AC-05`, `ASSIST-AC-09`, `NATURAL-COMMAND-AC-01`, `VOICE-AC-11`, `WORK-AC-04`, `COMMAND-AC-04`, `COMMAND-AC-05` | `packages/voice/test/listen.test.ts`, `wake.test.ts`, `grammar.test.ts`, `safety.test.ts`, `indicator.test.ts`; desktop speech and Whisper tests; browse, Chrome bridge, intake and daemon work tests | Microphone/hardware evidence, live provider/browser journeys, destructive/ambiguous utterance corpora, accessibility checks, and external-service recovery evidence are outstanding. |
| Counsel | `COUNSEL-AC-01`, `COUNSEL-AC-02`, `COUNSEL-AC-05`, `COUNSEL-AC-06`, `COUNSEL-AC-08`, `COUNSEL-AC-09`, `NEO-MCP-AC-04` | `packages/counsel/test/transcript.test.ts`, `meeting.test.ts`, `extract.test.ts`, `render.test.ts`, `library.test.ts`, `ask.test.ts`, `robustness.test.ts`; `packages/daemon/test/counsel.test.ts` | Real meeting capture, consent and retention journeys, source/provider failure, diarization and quality thresholds, accessibility, export and canonical-Assembler evidence are outstanding. |
| Forge and terminal | `FORGE-AC-01`, `FORGE-AC-06`, `FORGE-AC-07`, `FORGE-AC-09`, `FORGE-AC-10`, `TERMINAL-AC-02`, `TERMINAL-AC-03` | Forge worktree, status, runner, permission, gate-probe, routing, browse, Chrome and tools tests; `packages/daemon/test/forge-memory-context.test.ts` binds the Lens-reviewed context to the executed run by hash; retained live artifacts cover the exact answer-only prompt, one approved local held edit, one earlier fixture-repository read, independent terminal tabs and one discovered test | The JSON probes are not bound to a complete tree hash. Hosted-provider current-tree evidence, adversarial repositories, retained complete context receipts, shell matrix, credential broker, multi-file/conflict/cancellation/concurrency and review/merge evidence remain outstanding. |
| Visual state and accessibility | `VIDEO-AC-07`, `VIDEO-AC-15` | Conditional served-panel checks in `packages/voice/test/indicator.test.ts`; focus preservation in `packages/desktop/test/capture-lifecycle.test.cjs` | Sixteen-state inspection, assistive technology, keyboard, contrast, zoom, motion and photosensitivity evidence remains manual. |

Document and manual work in the older status report can support design review, but does not become
automated acceptance evidence. This includes `SUITE-AC-01`, `SUITE-AC-13`, `SUITE-AC-14`,
`LLD-GATE-AC-01`, `RESEARCH-AC-01`, `RESEARCH-AC-02`, `RESEARCH-GITHUB-AC-01`,
`ARTIFACT-DOC-AC-01`, `BRAND-AC-01`, `FORGE-AC-05`, `COMMAND-AC-10`,
`VIDEO-AC-01`, `VIDEO-AC-02`, `VIDEO-AC-03`, `VIDEO-AC-05`, `VIDEO-AC-08`,
`VIDEO-AC-13`, `VIDEO-AC-14`, `DESIGN-EVIDENCE-AC-01`,
`DESIGN-SYNTHESIS-AC-01`, `DESIGN-SYNTHESIS-AC-02`, `DESIGN-SYNTHESIS-AC-03`,
`DESIGN-GATE-AC-01`, `ARTIFACT-FEASIBILITY-AC-01`, `BRAIN-AC-01` and
`CEREMONY-AC-01`.

## Known requirement conflicts

These are blockers, not acceptance evidence.

1. **`VOICE-AC-06`: two-second wake-only buffer.** The row requires at most two seconds of
   untriggered audio and no transcript or network attempt. `packages/voice/src/listen.ts` sets
   `RETENTION_MS` to 15 seconds, `packages/voice/test/listen.test.ts` deliberately asserts that
   value, and the browser disclosure says an untriggered transcript can be retained for 15 seconds.
   The passing test proves the current behavior conflicts with the row.
2. **`TERMINAL-AC-04`: secrets in child process state.** The row forbids raw tokens in child
   `argv`, environment and standard input. Forge runner and gate-config tests require
   `ZENO_GATE_TOKEN` in the child environment. Those tests cannot support this row.
3. **`VAULT-AC-02`: conflict preservation.** The row forbids silent last-write-wins and requires
   conflicting versions to survive. `packages/mesh/test/replica.test.ts` asserts that a newer
   local write wins and lower-stamped operations lose. The replica is not evidence for this row
   until a conflict-preserving layer is demonstrated.
4. **`ASSIST-AC-07`: purchase commit.** The row requires a biometric, hash-bound purchase commit
   flow, while current policy makes payment and financial actions T4 and unreachable. Product scope
   and the row must be reconciled before implementation can satisfy it.

## Test-gate boundary

`npm run check` is the canonical workspace gate and includes all 16 workspaces, including
`@abheet19/zeno-desktop`. A green run supports only the clauses listed above. It does not execute:

- an Electron launch, packaged installer or clean-machine installation;
- `packages/daemon/public/glass/contrast.mjs`;
- `tools/live-*-probe.mjs` or `tools/forge-connections-ui.mjs`;
- a machine check that ties every test artifact to every acceptance-ledger row.

Some tests conditionally skip when real Git behavior, symlinks, installed skills or a served voice
panel are unavailable. Record skips with any acceptance claim. Coverage thresholds are not uniform
across all packages.

The live-probe scripts are useful maintainer tools, but their presence is not evidence. A probe
counts only after its command, environment, timestamp and output are retained. Use the live
procedure in `docs/35-HOW-TO-TEST.md` to collect the remaining evidence.
