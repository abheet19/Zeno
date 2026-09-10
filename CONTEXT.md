# Zeno — current implementation context

> Evidence snapshot: 10 September 2026 IST. Canonical repository: `D:\Code\Zeno`; branch `phase-0-and-p1-01-kernel`; verified implementation commit `068e9cfbaf64b9bb54c51ff272a4ceb7e2c35c4c`.
>
> This is the short, AI-readable map. The verified implementation commit, current source, and retained executable evidence win if an older design note disagrees. A configured URL or stale binary is not proof that current code is deployed.

## Product contract

Zeno is a Windows-first, local-first personal intelligence suite. Command is the home, search, memory, status, and approval surface. Forge is a governed coding-agent workbench. Counsel is a consent-gated meeting notebook with cited post-meeting Q&A. All three share a loopback daemon, a deterministic policy kernel, Vault, capability limits, one-attempt approvals, and a signed receipt ledger. Zeno aims for a familiar Devin/Cursor-style workbench while retaining its own Glass visual language and stricter effect boundary; current evidence does not establish full parity with those products.

## Architecture and end-to-end flow

```text
owner -> Electron shell -> nonce-authenticated loopback daemon
      -> Command / Forge / Counsel renderers
      -> bounded context + policy kernel
      -> provider or deterministic local subsystem
      -> held proposal capsule
      -> exact owner approval + compare-and-swap recheck
      -> one executor attempt -> signed, hash-chained receipt
```

Electron owns the single-instance lock, project/workspace selection, application zoom, context-isolated preload bridge, microphone/Whisper lifecycle, meeting-title discovery, and daemon process. The daemon owns canonical state and exposes scoped loopback APIs plus SSE invalidation signals. Models may read bounded context and propose effects; they receive no approval capability.

Forge runs Claude Code, Codex, or a discovered Ollama model in a disposable worktree. The selected repository does not change while the model runs. Valid file output becomes a held capsule, and approval revalidates its target/base/context hashes. The Editor view now keeps multiple closeable file tabs in two real Monaco groups, with independent cursor/viewport state, focus-aware Explorer/Search, governed save, dirty-close confirmation, resizable split, keyboard group focus, persisted layout, and mobile collapse. Agent view uses the same sessions. Terminal tabs are bounded one-shot processes, not persistent PTYs; Tests runs discovered safe scripts; external VSIX, debugger, and CI hosts are not wired.

Codex is invoked with `codex exec --ephemeral --ignore-user-config --strict-config`, and Zeno disables ambient MCP and web configuration for that run. This is narrower than complete ambient isolation: the installed Codex binary still attempted to discover globally installed Agent Skills, and one malformed global canvas skill was observed in the log. Treat global skill discovery as an open boundary until it is explicitly blocked or allowlisted; do not claim that all ambient user material or skills are disabled.

Ask Zeno sends typed or locally transcribed questions to the bounded assistant route and can delegate a task to Forge. Local system speech synthesis can read the reply. Voice capture uses local `whisper.cpp` when installed. Hold-to-talk records while held; Listen for Zeno transcribes bounded segments then requires the wake phrase at the first token. Counsel takes exclusive microphone ownership, requires declared consent, saves transcript text only, extracts cited items deterministically, and enables cited Q&A only after the meeting is ended and saved.

Vault stores readable Markdown memories and uses transparent keyword retrieval with citations. It has no embeddings, vector database, hidden cross-chat profile, or provider key. Owner-authored records may be written directly; agent-authored memory remains a governed effect.

## Code map

| Path | Responsibility |
| --- | --- |
| `packages/kernel/src` | risk classification, preview binding, single-use approvals, CAS execution, and receipt ledger |
| `packages/desktop` | Electron lifecycle, preload boundary, local Whisper, zoom, meeting titles, and packaging entry point |
| `packages/daemon/src` | loopback API, scoped tokens, SSE, canonical state, and subsystem orchestration |
| `packages/daemon/public` | Command, Forge, Counsel, Voice, Vault, settings, and Glass UI |
| `packages/forge/src` | provider registry/routing, isolated worktrees, output parsing, permission gate, and held edits |
| `packages/assistant/src` | bounded snapshot, grounding, citations, and inert intent classification |
| `packages/voice/src` | wake matching, command grammar, retention, and capture state |
| `packages/counsel/src` | transcript model, deterministic extraction, citations, and post-meeting Q&A |
| `packages/vault/src` | Markdown memory, keyword recall, context assembly, and governed writes |
| `packages/skills/src; packages/mcp/src` | untrusted skill screening and bounded read/propose tool surface |
| `electron-builder.json; .github/workflows/ci.yml` | Windows portable/NSIS packaging and the Windows Node 22 quality gate |

## Invariants and trust boundaries

- A model cannot approve its own action; Tier 4 payment/biometric effects remain unreachable.
- Approval binds exact payload, capability, target, context hash, and base state; stale state refuses before execution.
- One approval permits one attempt. Only executor return can create a durable receipt.
- File effects stay inside the selected project after path, symlink, and junction checks.
- Project files, Vault records, skills, web/MCP content, transcripts, and model output are untrusted data, never authority.
- Hosted provider and browser egress is explicit per run; local Ollama/Whisper use loopback and do not imply zero hardware cost.
- Counsel requires declared consent, captures microphone input only, and cannot answer live interview/meeting questions.

## User workflows to preserve

- Navigate every Command rail item; inspect meaningful orb nodes, provider/model locality, pending work, receipts, Vault, integrations, devices, and modern settings.
- Ask by text or voice; inspect grounded citations or an explicit ungrounded label; hear an optional system-voice reply; delegate a real task to Forge without bypassing hosted confirmation.
- Switch Forge Agent/Editor, create/select sessions, run two local sessions independently, cancel the exact run, and review answer-only versus edit output.
- Open several Explorer/Search files, split to a second Monaco group, focus groups, edit/save the exact active file through previews, test dirty-close refusal, restore/unsplit, and verify mobile collapse.
- Run bounded Terminal tabs, a discovered test script, skills/rules selection, extension/theme catalog, and run-scoped MCP connector inventory; verify honest unwired labels.
- Use hold-to-talk, first-utterance wake, ordinary-speech non-trigger, capture handoff, and explicit microphone close.
- Start Counsel only after preflight/consent, label speakers manually, end/save, inspect cited decisions/actions, ask a saved-call question, delete with confirmation, and verify discard writes nothing.

## Concepts this project teaches

| Concept | How it appears here |
| --- | --- |
| Capability security | separate scoped tokens and model-facing read/propose tools keep authority out of prompts |
| Content-addressed actions | canonical payload/context/base hashes define what one approval means |
| Optimistic concurrency | compare-and-swap rejects a held change when the base has moved |
| Event sourcing and tamper evidence | post-execution receipts form an Ed25519-signed hash chain |
| Process isolation | Electron, daemon, Whisper, provider runners, and disposable worktrees have explicit lifecycles |
| Local speech pipeline | PCM16/WAV bounds, VAD/pre-roll, local inference, wake grammar, and explicit capture ownership |
| Grounded retrieval | keyword memory and transcript Q&A preserve inspectable citations without embeddings |
| IDE state modeling | tabs, split groups, dirty state, focus, persisted layout, and save target are separate state machines |

## CI, packaging, deployment, and rollback

`npm run check` executes all 16 workspace gates. `npm run build` compiles the workspace chain and vendors Monaco/Voice/Glass assets. `npm run build:app` runs electron-builder and emits an x64 portable executable and NSIS installer under `dist-app`. `.github/workflows/ci.yml` runs on Windows with Node 22 and rejects unexpected external runtime dependencies; it does not package or publish a release.

The final runtime build emitted `Zeno-0.1.0-x64-portable.exe` (`CDD87998C21DCD82BE55769113C46E769018E3339C397D6120EF8FEB814C6165`) and `Zeno-Setup-0.1.0-x64.exe` (`5839960EF070D4C6DB03993D88C8AD5AB260C5F3F0C7BEC1F046A4F3FA026E2E`) from the runtime sources now committed at `068e9cfbaf64b9bb54c51ff272a4ceb7e2c35c4c`. The packaged renderer passed 21/21 interaction checks, and the physical hold-to-talk probe heard the complete target phrase and released capture cleanly. This proves artifact creation and the retained journeys, not certificate trust, a clean-profile installation, updater behavior, public distribution, or rollback compatibility. Zeno has no public web deployment. Test install/launch/uninstall on a clean Windows profile and sign a release before public distribution. Roll back with a previously verified executable while preserving a format-compatible copy of workspace data and keys.

## Current measured evidence

| Result | Evidence |
| --- | --- |
| Exact implementation commit gate: 16 workspace summaries, 1,455 tests, 1,453 passed, 2 explicit Windows symlink skips, 0 failed | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-release-068e9cf-check.log` (SHA-256 `8F0C67948B94500CDA51AE2288B8D1124E4CE5F446060EE34A7B2E895D9F70B4`) |
| Packaged UI: 21/21 Command, settings, Forge Agent/Editor, Explorer chevrons, multi-file tabs, two-group split, resizers, terminal/test/catalog surfaces, zoom, and mobile checks; zero page/console errors | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-f10-output\zeno-packaged-ui-acceptance.json` (SHA-256 `94EFC894CE788618115A8583B48F72958A61EE67EBB3F9E6FC13C80B53489E41`) |
| Windows package build completed for portable and NSIS targets | portable SHA-256 `CDD87998C21DCD82BE55769113C46E769018E3339C397D6120EF8FEB814C6165`; installer SHA-256 `5839960EF070D4C6DB03993D88C8AD5AB260C5F3F0C7BEC1F046A4F3FA026E2E` |
| Packaged physical hold-to-talk heard “Zeno, what is waiting?”, routed to pending, returned to Idle, and released the microphone with zero page/console errors | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-hold-to-talk-f10.json` (SHA-256 `FB9883530BBE88466357CFCD8EFE23C9D3E4B042C07D85BD574C1523E4CC0941`) |
| Packaged wake accepted the first post-start utterance; ordinary speech without “Zeno” produced no action | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-wake-first-utterance-final.json (B14A6CF0…1380); zeno-packaged-wake-nontrigger-final.json (5475142E…E1AF)` |
| Packaged Counsel saved two local lines, produced cited extraction/Q&A, enforced mic exclusion, deleted the test call, and made discard write nothing | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-counsel-final.json (SHA-256 60EFDA81…0E45)` |
| Local Forge `qwen3:4b` created one exact held file in 8.94 s; repository stayed unchanged until approval; zero page/console errors | `%USERPROFILE%\OneDrive\Documents\ChatGPT\code\verification-work\zeno-packaged-forge-local-final.json (SHA-256 A66DD4E8…1124)` |

The evidence above belongs to the named local working-tree snapshot unless it explicitly names a release/image. It does not become live evidence merely because a deployment configuration exists.

## Open limits

- There is no speaker biometric, voice enrollment, owner-voice learning, automatic diarization, acoustic wake engine, or guarantee against television/call/noise activation.
- The retained utterances are narrow functional probes, not word-error-rate, false-accept/false-reject, noisy-room, accent, device-fleet, or latency benchmarks; ChatGPT Voice speed/accuracy parity is unproven.
- Counsel microphone capture does not capture system audio; a matching meeting-window title proves only a capturable window exists, not that the owner joined or that remote audio is captured.
- Local Ollama quality and latency vary by model/hardware. A detached Ollama server can outlive Zeno. Cold-start and provider outage coverage remains bounded.
- Forge has no external VSIX/Marketplace host, persistent PTY, external debugger, or external CI runner. Multiple session records exist; broad parallel-provider scale is not established.
- Hosted Codex/Claude behavior, account allowance, and egress require the product's exact per-run confirmation. The current final evidence set does not establish a fresh Claude edit on this package.
- Codex strict/ephemeral configuration and disabled ambient MCP/web do not currently prevent the installed Codex binary from attempting global Agent Skill discovery; one malformed global canvas skill was logged.
- The formal acceptance ledger remains separate. Do not promote rows solely from test counts or polished UI evidence.
- No Sentry/PostHog/remote dashboard is verified; current observability is local logs, timings, state, and receipts.

## Reading order

1. `CONTEXT.md` — keep the current product, trust, and evidence boundary in working memory
2. `README.md` — understand the product promise, examples, limitations, and user entry points
3. `docs/44-STUDY-PACK.md` — trace current packages and concepts
4. `docs/12-architecture-and-adrs.md; docs/13-threat-model-and-policy.md` — learn architectural decisions and threats
5. `packages/kernel/src; packages/daemon/src; packages/desktop` — follow proposal to approval/receipt and desktop lifecycle
6. `packages/forge/src; packages/daemon/public/forge.js` — follow provider execution and IDE state
7. `packages/voice; packages/counsel; packages/vault` — study speech, ethical meetings, and memory
8. `docs/35-HOW-TO-TEST.md; docs/SANITY.md; docs/43-ACCEPTANCE-EVIDENCE.md` — run evidence and understand its limits

Use `docs/SANITY.md` in the repository, or `09_SANITY_CHECK.md` in the Study Pack, before claiming that a new change works.

## Rules for the next coding agent

1. Read the exact acceptance row and current source before changing behavior; target-state design notes are not implementation evidence.
2. Preserve model-cannot-approve, one attempt, CAS-before-effect, receipt-after-return, Tier 4 unreachable, and project-root containment.
3. Never reuse the personal workspace/ledger for tests or print nonce URLs, bearer tokens, signing keys, provider credentials, or private transcripts.
4. Use one capture owner at a time and keep Counsel consent-gated, microphone-only, and post-meeting for Q&A.
5. Exercise a CTA and verify canonical state/receipt; visible controls alone are not evidence.
6. Keep changes small. Never reset unreviewed work. Require the owner’s explicit authorization for new hosted-provider egress, public distribution, or a release that spends money.
