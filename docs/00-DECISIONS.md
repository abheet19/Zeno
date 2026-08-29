# Decision Log — Personal Intelligence Suite (Phase 0)

All times local (Asia/Kolkata assumed until confirmed). Master prompt: `~/Downloads/personal-ai-suite-claude-code-master-prompt.md`, SHA-256 `d3b5b818e7ad4b5c2785f228059c6b76d076c1a211cbd7680848207bb5ae1dfa`.

## 2026-08-24 — Clarification Gate approved
- Owner approved the Section 16.1 plan (`~/.claude/plans/zesty-forging-puddle.md`). Scope unlocked: **Phase 0A public research + disposable synthetic prototypes only.**
- Owner mid-turn directives: (1) the assistant prompt lives under the work directory — found at `~/Work/ASSISTANT_PROMPT.md`; (2) proceed per the master prompt, ask questions only when stuck.
- §4 defaults in force (owner may override any time; overrides re-open only affected artifacts):
  1. MVP journeys = Jira→Intake→Context→TASK→Forge (draft-only through Phase 3); Forge MVP on fixture repo; briefing + Review Companion drafts.
  2. Windows pilot machine: **unknown — still needed before Phase 1** (Phase 0 unaffected).
  3. This Mac treated as the work Mac; Phase-0-only use.
  4. Workspace Context Scope Record v1 initialized as proposed (see `01-workspace-context-scope-record.md`).
  5. Paths: ASSISTANT_PROMPT.md / DESIGN_PROMPT.md found (see below); `code-review-reflexes` presumed folded into `quillbot-lt-conventions` pending confirmation; Obsidian vault path unknown.
  6. Jira: WEBEXT-only allowlist, auto read-only Intake ON — **site URL + acting account still needed before Phase 3.**
  7. NeoSapien MCP: schema/capability inspection only in Phase 0; zero memory queries. Wispr Flow: deferred/undecided.
  8. Gate 2 medium = Claude Code Artifacts (+ Figma where useful); dark-first; reduced-motion/high-contrast variants always.
  9. Budget: $0 in Phase 0; free/open-source only.
  10. Boundaries: as written in the master prompt.

## Verified file inventory (metadata only)
| File | SHA-256 (16) | Lines / bytes | Note |
|---|---|---|---|
| `~/Work/ASSISTANT_PROMPT.md` | `b986bcc67916821b` | 322 / 23,495 | Has `# TASK` section, lines 250–290, bounded by stable headings — validates the Section-4 TASK-only patch design |
| `~/Work/DESIGN_PROMPT.md` | `c205da7b3ee34534` | 211 / 14,072 | Exists (prompt treated it as optional/absent) |
| `~/Work/CONTEXT.md` | `d71e6b0b475f95fb` | 229 / 12,501 | Companion context file; role to confirm |
| Master prompt | `d3b5b818…` | 2,286 / 554,098 | Hash-verified receipt in approved plan |
| 23-Aug video | `ce330c45…` | 21,098,344 B | Matches §11.3.2 manifest |
| 24-Aug video | `c21e6fc6…` | 14,575,808 B | Matches §11.3.3 manifest |

Also at `~/Work` root: MENTOR_PROMPT.md, SKILL.md, MY_REVIEW_LEDGER.md, several LLD/deep-dive docs — inventoried, unread.

## 2026-08-24 (evening) — blockers answered + session-limit interruption

Owner supplied three answers:
- **B-001 RESOLVED.** ffmpeg 9.0.1 installed at `/opt/homebrew/bin/ffmpeg` (verified 22:22 IST). Frame-ledger generation for both evidence videos now unblocked and running.
- **B-002 PARTIALLY RESOLVED.** A Windows pilot machine **exists and is the owner's personal machine** (therefore not employer-managed — favourable for §1.2 least-privilege pilot). **Still needed before Phase 1:** exact edition/build, CPU/GPU/RAM/storage, displays + refresh, microphone/audio devices, Windows Terminal / PowerShell / WSL2 / Docker / Hyper-V availability, admin status, security software, and confirmation it holds no employer data.
- **B-003 RESOLVED.** Jira authority:
  - site `quillbot.atlassian.net`
  - project **WEBEXT**, board 15
  - acting account email `abheet.isher@quillbot.com`
  - Jira accountId `712020:ffe2227d-9292-46ff-81db-6ee44ab6b470` (from the supplied board URL's assignee filter)
  - Auto read-only Intake accepted on the stated default; allowlist = WEBEXT only.
  - *Note:* no Jira connector/MCP is connected to this session. Connecting one is a separate new-service approval, not needed for Phase 0A.

**Session-limit interruption (~21:09 IST):** six of eight research lanes were terminated mid-flight by an API session limit (reset 22:20 IST). Survivors, verified complete and untruncated: **L1** (assistants/voice), **L6** (GitHub census, 474-repo manifest + 10 raw JSON responses), **L7a** (brand classical sources), **L9** (platform export/import revalidation). Lost and relaunched at 22:25 IST via workflow `phase0a-completion`: **L2** (coding agents/MCP), **L3** (meetings/voice-ID), **L4** (design), **L7b** (brand collisions) — plus three new local-audit workers (Graphify/knowledge systems, requirements traceability, context bootstrap) and three synthesis workers (brand ranking, seed-coverage ledger, L5 skeptical counter-review). Model switched to Opus 5 for this continuation.

## Open blockers
- **B-002 (open, narrowed): Windows pilot machine specifications** → blocks Phase 1+, not Phase 0.
- **B-004 (new): NeoSapien MCP officialness.** L9 found **no public official NeoSapien MCP anywhere** (0 results in the official MCP registry, 0 in the claude.ai connector registry, nothing on any neosapien.ai property, no GitHub org) — yet this session has a live account-bound NeoSapien connector exposing search/export/transcript/reminder tools. Most plausible reading: an undocumented vendor-hosted remote MCP endpoint provisioned per account. Consequence: it may be **used read-only** under the adapter contract, but cannot be called a *verified official documented* interface until the vendor publishes docs or the owner supplies in-account connection instructions. Does not block Phase 0A.

## Stop points ahead
Brand sub-gate (owner name selection) → Gate 1 (architecture) → Gate 2 (design) → per-slice LLD gates → Gate 3 Windows Pilot → explicit "Approve work-Mac pilot".

## 2026-08-28 — owner decisions

- **Language: TypeScript for the shared core, Python only where necessary** (ML tooling, ffmpeg/audio pipelines, anything with no viable TS equivalent). Owner-confirmed, resolves the language question ahead of the architecture ADR — the ADR now documents rather than proposes it. Every Python component must justify why TS was not viable.
- **Phases followed strictly.** No build begins until the owner has reviewed the design and LLDs and explicitly says so. Confirmed 2026-08-28.
- **Repo created** at `~/Personal Projects/zeno` — documentation only, staged not committed, no remote. Employer-derived reports (`03a`, `03b`), source videos and secrets are gitignored.

## 2026-08-28 — owner rulings (Gate-1 checklist items answered early)

1. **Four docs reviewed → "all good, proceed."** Brand decision, conflict register (10 softened items), corrections log (41), assumptions (8) all ratified. None reopened.
2. **Build location: THIS MAC.** Owner chose to build on the work Mac rather than the Windows pilot.
   - Consequence recorded and NOT waved away: the master prompt's Windows-first ordering (§1.2) was a *validation* order, not a Windows-specific architecture, so building on macOS does not break the design — the shared headless core is platform-neutral. BUT the work-Mac protections in §1.2 were written assuming the Mac stayed a Phase-0 artifact machine. Building here means Phase 1 code executes on the work Mac. This still does NOT authorize: continuous voice/screen/activity capture, login/background items, Keychain import, pairing as an executor, or OS/browser/terminal automation against employer surfaces — those remain gated. Phase-1 code = an isolated, disposable, synthetic-fixture build in a scratch root, no employer data, no OS-permission prompts, no persistence. A scope-record note is required (added below).
   - Windows pilot is not abandoned — it becomes a later cross-platform validation target rather than the first build host. B-002 (Windows specs) is de-prioritised, not closed.
3. **Reports location: Zeno Vault Markdown root** (owner asked for the recommendation → recommended and taken; see reasoning in this turn's reply). Ratifies the N-3 reinterpretation of ASSIST-AC-08. Obsidian remains an optional projection target if a vault ever appears (U-04).
4. **Design track: START** — transformation matrix → divergence lab → three A/B/C directions.

### Build-location scope note (v4 delta)
This Mac moves from "Phase-0 artifacts only" to "Phase-0 artifacts + isolated synthetic-fixture
Phase-1/2 builds in a scratch root." The hard line is unchanged: no employer data in any build, no
macOS permission grant (Accessibility, Screen Recording, Microphone, Automation, Full Disk Access),
no login/background item, no Keychain import, no executor pairing, no OS/browser/terminal automation
against real employer surfaces — all still gated behind their own approvals. The work Mac is now a
development host for disposable builds; it is NOT yet a privileged Zeno runtime.

## 2026-08-28 — captured design requirement (Counsel), NOT built

Owner described the Counsel interaction they want. Recorded here as a DESIGN requirement to fold into
the Counsel spec; deliberately NOT implemented in the prototype (we are in the design phase — the
prototype is a direction-chooser only).

**Counsel live-assist requirement:**
- **Transcription** — Counsel transcribes what other speakers say, whatever it is: a spoken question,
  a technical/code question, or interview questions. Speaker-labelled, on screen.
- **Assist button (Cluely-style)** — a manual "Assist / generate what to say" control. On press, Counsel
  generates the answer on screen: a "say this" sentence, key points, citations, and a confidence level.
  It is **on-demand**, not auto-spoken and not auto-sent (consistent with §7.2 and conflict-register row 1).
- **Input + Send** — a private "Ask Counsel" text field with a Send button, so the owner can type a
  private follow-up during the meeting without it entering the transcript or being broadcast.
- **Output covers both** answering questions AND surfacing content (code, status, interview answers),
  always cited to the owner's authorized context (repos, tickets, prior meetings).

This is captured for the Counsel design; it will be reflected in the interactive prototype only AFTER
a direction is selected, and built only after the gates. No code was added to the product.

## 2026-08-28 — DESIGN DIRECTION SELECTED: B+C

Owner selected **B+C** from the Gate-2 direction board (A Cinematic Instrument / B Spatial Observatory
/ C Obsidian Foundry / B+C recommended). B+C = the 3D Standing Field for the Overview and navigation
(the hero-object navigation the owner wanted, clean and original), calm opaque planes for the work
surfaces (Command lists, Forge code, Counsel). "3D where it helps, quiet where you read."

This is the direction that gets carried into the detailed interactive prototypes. It is a design
selection, NOT Gate 2 approval and NOT permission to build product code — the three linked interactive
prototypes (Assistant/Command, Forge, Counsel) in the B+C language come next, then Gate 2 approval,
then (with Gate 1) implementation.

## 2026-08-28 — owner requirements for Zeno Forge (explicit, must be in the spec)

Owner confirmed Forge must be a Claude-Code-class / Cursor-class coding product, not a chat box. Required:

1. **Agent chat visible alongside an IDE surface** — a real editor/diff pane like Cursor, with the agent
   conversation and its action stream beside it, not replacing it.
2. **Model + effort selector** — user-visible, per-session and per-agent, showing local vs remote, context
   size, cost/latency, and the active harness profile. A model failing a required capability enters a
   visible reduced-capability mode or is rejected for that task (never silently degraded).
3. **Rules and skills from the codebase, applied on demand** — the 38 Cursor `.mdc` rules across the four
   repos plus the 7 user skills, loaded by trigger, keyed per repository, hashes recorded in the context
   manifest, conflicts surfaced rather than silently resolved. Same-named rules DIVERGE across repos
   (identity-rule.mdc has 3 distinct hashes) so per-repo scoping is mandatory, never global.
4. **Open any folder / workspace picker, Cursor-style** — arbitrary folder or multi-root workspace, not a
   fixed repo list. Includes non-QuillBot and personal projects, which route to the Generic Manual Coding
   Intake rather than the ASSISTANT_PROMPT chain.
5. **MCP and connector friendly** — first-class MCP host/client with the registry, inspector, per-tool
   allow/ask/deny, dry-run config import, and per-agent grants; connectors surfaced with provider, acting
   account, scopes, health, reconnect and revoke.

Also required from the master prompt and to be covered explicitly in the Forge prototype spec (owner asked
"any other spec you missed"): multiple named chats with branchable conversations and child sessions/subagents;
resume; checkpoints and compaction; session search/export/archive; explicit context inspection; the separate
latency-critical IDE completion / next-edit path (inline ghost text, multiline and cross-file suggestions,
local-only mode, evaluated separately from the long-running agent); LSP integration; source-control UI and
review comments; a task board; the typed server API/SDK and headless mode; terminal/TUI, desktop, web and IDE
clients over one versioned agent protocol; versioned lifecycle hooks and reusable user/project commands
(untrusted repo hooks disabled by default); multi-repository workspaces with per-repo isolation; the Review
Workbench; evidence-first Debug mode; reproducible environment profiles; layered checkpoints; and the Live
Preview Inspector.

---

## D-GATE — Gate 1 and Gate 2 APPROVED by owner (2026-08-28)

**Owner instruction, verbatim: "gate 1 2 approved."** Recorded as an explicit dual approval.

### Gate 1 — architecture & product: APPROVED
Unlocks (master prompt §14): private repository creation, and **Phase-1 implementation code slice by
slice, each behind its own approved LLD Artifact**. Approving Gate 1 does NOT approve any individual
slice's LLD, and does NOT authorise Wave B (needs B-002) or the work-Mac pilot (needs Gate 3).
Substantiates: SUITE-AC-01/03/14, RESEARCH-AC-01/02, RESEARCH-GITHUB-AC-01, REPO-BOOTSTRAP-AC-01.

Folded into this approval (they are Gate-1 checklist lines): the 41 corrections govern over the prompt;
the 10 conflict dispositions stand; **build-on-this-Mac scope** (isolated synthetic-fixture builds only);
**NeoSapien treated as an undocumented vendor endpoint** (C-011). MVP = Phase 1 + Phase 2 only. The
permanently-rejected list stays rejected in every future phase.

### Gate 2 — design: APPROVED
Unlocks: implementing **direction B+C** in Phase-1 Wave C surface slices against the approved Zeno Glass
tokens and the three prototype specs. Does NOT unlock: Mac runtime, camera/screen capture, 3D-as-substrate,
or any surface not in the approved set.

Design of record = the three interactive prototypes (Command / Forge / Counsel), B+C language, as built
and iterated through 2026-08-28. Owner-directed design changes now baked in and thereby approved:
- **Home = Field only** (Horizon/Focus variants removed at owner request).
- **Counsel**: no scenario tabs; compact top-centre Cluely-style overlay; live transcript of other
  speakers; Assist resolves the latest transcribed question; private ask+Send; masked = bare "listening"
  pill only. **Counsel overlay is liquid-glass by OWNER OVERRIDE** — the B+C "no glass behind transcripts"
  rule is waived for the Counsel overlay only; Command/Forge code, diff and output surfaces stay opaque.
- **Per-ticket status**: each assigned Jira carries its own independent status pill + a queue tally
  (answers "which status with multiple tickets": every ticket keeps its own; Command never collapses them).
- **Theme** is a first-class in-product control (System/Dark/Light), persisted per-device.
- **Forge**: proper IDE grid — agent inspector full-height on the right; terminal only under the editor,
  **draggable/collapsible**, never overriding the agent panel. Contextual node card (Orchestrator = core,
  not a workspace; repo/agent = Open in Forge). Field model enlarged slightly.

### Two approved deviations from the literal spec (owner may still reverse)
1. Forge's **Execution Stream** (spec region F) is folded into the Actions tab + drawer rather than a
   sixth standalone region.
2. Counsel "understands the question" is prototype-deterministic (targets the latest transcribed
   question); real question-understanding is Phase-5 Counsel model work.

### Still OUTSTANDING after this approval (unchanged by the gates)
- **B-002 — Windows specs.** Still blocks 57 acceptance rows + Wave B. Owner is the only source.
- **Gate 3 + exact sentence "Approve work-Mac pilot"** — required before ANY work-Mac runtime.
- **Two standalone rulings not inside either gate checklist:** Vault-Markdown-reports (assumed adopted,
  reflected in the design) and capability-catalogue-deferral. Treat as ratified-by-silence unless the
  owner says otherwise.
- **Per-slice LLD gates** for every Phase-1 slice.

### What was NOT done (standing rules preserved)
No repository was committed or pushed (owner lands all git). No build was run. No code was written. No
service connected. Repo at ~/Personal Projects/zeno remains staged, uncommitted.

---

## B-002 RESOLVED — Windows pilot machine specs (owner, 2026-08-28)

| Component | Spec |
|---|---|
| GPU | **NVIDIA RTX 3080 12 GB** (GA102, ~12 GB VRAM) |
| CPU | **AMD Ryzen 7 7700X** (8C/16T, Zen 4) |
| RAM | **32 GB** |
| Displays | **2 monitors** — one 2K + one 4K; **300 Hz** capable |
| OS | **Windows 11** |

Unblocks the 57 B-002-gated acceptance rows and Wave B. Latency targets (previously "unmeasured
(B-002)") are now measurable against real hardware rather than promised.

**Correction C-042 (hardware ⇒ model plan): the "30B local" default does not fit 12 GB VRAM.**
A 30B coder at Q4 is ~18–19 GB — it cannot be fully GPU-resident on a 3080 12 GB. Consequences for
`16-model-and-adaptation-plan.md`:
- **Fully-GPU-resident default becomes a 14B-class coder** (e.g. Qwen2.5-Coder-14B Q4/Q5 ≈ 9–10.5 GB),
  leaving VRAM headroom for context KV cache.
- A **30–32B model is a partial-offload / spillover profile** (VRAM + 32 GB system RAM), accepted only
  where its quality justifies the tok/s cost; it is a *measured* option, not the default.
- The Zen-4 CPU + 32 GB RAM make CPU-offload viable for burst tasks; the 300 Hz displays make the
  design system's motion budget and the latency-critical IDE completion path meaningfully testable.
- Real numbers replace every "unmeasured (B-002)" chip in the Forge model popup once measured on-box.

---

## D-PARALLEL — Parallel agents → best-output selection (owner request, 2026-08-29)

Owner wants a task run by **multiple agents in parallel** (Cursor-style), then **Forge picks the best
output**. Accepted; fits the architecture cleanly and is added to the Forge spec/roadmap and prototype.

**Design (fan-out → judge → single approval):**
1. The Orchestrator spawns **N candidate agents** on the *same* task, **each in its own isolated
   worktree**. They run at T0/local — they only *propose*, they change nothing outside their sandbox.
2. Each candidate produces a diff + test result + a one-line approach rationale.
3. **Selection** ranks them by objective signals first (tests passed, diff minimality, rule/lint
   conformance) and a judge-model rationale; Forge marks a recommended winner. **You can override.**
4. The **winning candidate is the only thing that enters the approval contract** (preview → approve →
   revalidate → one commit → receipt). Losers are discarded with their receipts.

**Why it's safe:** N proposals do not mean N effects. Every candidate is sandboxed and none can commit;
exactly one winner reaches the kernel, and the kernel gates it exactly as it gates a single proposal.
**This does NOT change P1-01** — the kernel still sees one approved action. Parallelism is a Forge
orchestration feature layered above the kernel.

**Honest constraint (hardware):** N parallel *local* agents = N× memory. On the 3080 (12 GB) only ~1
14B model fits at a time, so "parallel" there is staggered/queued, not truly simultaneous, or uses
smaller models. The Mac (48 GB) can run more genuinely in parallel. Cloud models parallelise freely but
cost money and are barred on company code. Default: **2–3 candidates**, sized to the host; the count is
a measured setting, never silently maxed.

**Placement:** Forge capability, Wave C (a Forge slice), its own LLD later. Added to the prototype now as
a visible "Runs" view for design review.

## D-ROUTING — Best-fit model routing per task (owner request, 2026-08-29)

Owner: "it will choose best fit of models for different tasks and then give best result." Accepted —
this is **model routing**, and it composes with D-PARALLEL:

- The Orchestrator classifies the **task type** (code-edit, reasoning/planning, quick-completion,
  speech, vision…) and **routes to the model best suited** to it — a coder model for code, a reasoning
  model for planning, a small fast model for inline completion, Whisper for speech. Provider-neutral.
- For hard tasks it can **fan out across several best-fit models in parallel** (D-PARALLEL) and return
  the **best result** after ranking.
- **Which model is "best fit" is measured, not declared** — the evaluation harness (doc 17) scores
  candidates per task type; routing tables are data, updated as models drift (C-028), never hardcoded.
- **Guardrails unchanged:** routing never sends company code to a cloud model (data-zone policy); the
  winning output still passes the full approval contract via the kernel. Routing chooses *who drafts*;
  the kernel still governs *what gets applied*.

Added to the Forge prototype Runs panel: each parallel agent shows the model it used, with a "task type
→ routed to coder models" line. Forge capability, Wave C, own LLD later. Does not affect P1-01.

## D-CHAT — Agent chat UX + Auto mode + system chat (owner requests, 2026-08-29)

- **Rich formatted output (Claude-Code-style):** Forge chat renders markdown, fenced code blocks with
  language tag, bullet lists, collapsible tool-call rows (e.g. "⚙ read InsertReplace.tsx:138–145 ✓"),
  a subtle thinking line, clickable citations, and a streaming state. Added to prototype.
- **Message queueing:** messages sent while the agent is working **queue and run in order** (visible
  "N queued" strip); a **Stop** button appears while running. Added.
- **Better composer:** attach button, model chip, Enter=send / Shift+Enter=newline, effort shown.
- **Auto mode (owner):** default model selection is **Auto** — Zeno picks the *lightest model that fits
  each task* (small/fast for a rename or lookup, 14B for a normal edit, 32B-offload only for hard ones).
  User can pin a model to override. Shown in the model popup + identity strip + composer.
- **Minimal/clean selection rule (owner):** Forge's winner-selection prefers the **smallest, cleanest
  change that passes tests and follows repo conventions (rules + lint)** — not cleverest/largest; ties
  break toward less churn. Made explicit in the Runs panel.
- **Ask Zeno — system-wide chat (owner "chat with whole system"):** a Command view that talks to the
  **Orchestrator across all products** — reaches Forge/Counsel/Vault/devices, cites what it finds, and
  **routes** work to the right product ("that's a coding task → Forge"). Distinct from Forge's per-run
  chat (scoped to one repo/run). It answers; it never acts without approval. Added as Command nav item.

All Forge/assistant UX; Wave C surface slices; own LLDs later. None affect P1-01.

---

## D-EXEC-CLAUDE — Claude Code as a first-class executor (owner, 2026-08-29)

Owner: "a jira comes to me and i want to push to claude code — can i do that?" **Yes — and this was the
master prompt's original shape** (ASSISTANT_PROMPT → TASK → hash-verified handoff → Claude Code). Zeno
Forge automates it: Jira → read-only Intake → sealed context pack → TASK → **owner approval** → Zeno
launches Claude Code headless (`claude -p` / Agent SDK) in the isolated worktree with the hash-verified
prompt → Zeno watches, receipts, shows the diff → owner lands git. Claude Code appears in the executor
roster and the parallel-runs panel like any other agent; kernel gates its *effects* identically.

**Correction C-043 (important):** my earlier claim "company code never goes to a cloud model" was
STRICTER than the recorded scope. Workspace Context Scope Record v4 lists providers = "Local tools +
Anthropic via this Claude Code session" — the owner's sanctioned daily practice IS Anthropic on company
repos. So: **Anthropic (Claude Code) = an approved provider for company code**; other cloud providers
and GPU-rental hosts remain out of scope for company data without a new scope delta.

## D-CLOUD — production-grade + hosting posture (owner, 2026-08-29)

Production-grade: yes — that is what the phase/LLD/test/receipt discipline is for. Hosting:
- **Zeno itself stays local-first** on owner machines (Mesh syncs devices E2EE). No server hosting
  required; an optional E2EE cloud relay is a later slice, not a dependency.
- **Model tiers:** (1) local light, (2) local 14B/32B, (3) **Claude (Anthropic) as the sanctioned
  cloud rung** for the hardest tasks — already paid/approved via existing Claude Code access, $0 new.
- **GPU rental (RunPod/Modal/etc.) for self-hosted 70B: NOT adopted.** New provider + new cost + company
  data may never go there without a scope delta. If ever wanted for personal experiments → costed
  proposal per the $0 rule.

## D-32B — honest capability read for QuillBot tasks (owner asked "think hard", 2026-08-29)

A local Qwen2.5-Coder-32B on the owner's real work (large TS/React monorepos; cross-file features like
insert/replace formatting drift, 15-site compose alignment; review-grade judgment calls) is **a capable
mid-level pair, not Claude-Code-class**: strong on scoped, well-specified edits, test writing, refactors
with tests, parallel first-drafts; **below the bar** for ambiguous cross-file features, root-cause
debugging in 17k-file repos, and review-quality judgment. Zeno's scaffolding (sealed packs, per-repo
rules, minimal-diff selection, tests as gate) narrows but does not close the gap. Hence the routing
ladder above, with **eval harness (doc 17) measuring on the owner's own repos** as the deciding evidence
— expectations set now so the 32B is used where speed/privacy suffice and escalated where quality matters.

---

## D-P1-01-APPROVED — first slice approved + standing test mandate (owner, 2026-08-29)

Owner: **"approved"** (P1-01) + T2 authenticator = **defer** (default, owner did not override) +
**standing rule for ALL code from now on: holistic testing, e2e testing, and all checks.**

**Standing test/quality bar (applies to every slice henceforth):**
- Unit tests + **property-based tests** (the invariants/laws), not just happy-path examples.
- **E2E / integration** test that drives the full flow the slice claims (headless).
- **All checks green before "done":** type-check, lint, tests, coverage, determinism/replay where
  applicable. Report real command output — never claim green without showing it.
- Still: **I never `git commit`/`git push`** (owner lands git) and I **stop at green validation** — no
  production bundler/deploy build. Running the test/type/lint suite IS the requested validation, distinct
  from the barred webpack/`build:dev` builds.

Unlocks: writing slice **P1-01** code now. Does not unlock the next slice (its own LLD first), Wave B
runtime specifics beyond the kernel, or the work-Mac *product* pilot (Gate 3). The kernel is a headless,
zero-network, zero-model library = an **isolated synthetic-fixture build**, which the owner authorised on
this Mac.

---

## P1-01 BUILT — kernel implemented + fully tested (2026-08-29)

Slice P1-01 code written and validated in an **isolated scratch root**:
`~/Documents/personal-ai-suite-phase1/kernel/` (NOT the git repo — owner lands git).

- **Stack:** TypeScript strict (exactOptionalPropertyTypes, noUncheckedIndexedAccess), Node 20,
  ESM. Runtime deps: **zero**. Dev deps: **typescript + @types/node only** (installed --ignore-scripts).
- **Source (6 files):** types, hash (canonical JSON + sha256 via node:crypto), policy (declarative +
  classifier + validation + hash-pin), ledger (append-only hash-chained + verifyChain), kernel (the
  state machine + 7 laws), index.
- **Tests (7 files):** L1–L7 property tests, CAS drift, prompt-injection, ledger tamper-evidence,
  determinism/replay, e2e simulator (all Command-capsule journeys headless), policy/error paths.
- **Results:** **32 tests pass · ~2,300 generated scenarios · 99.4% line coverage · strict typecheck
  clean · dependency-free lint (no network imports, no ambient non-determinism in src/) clean.**
- **Standing test mandate (D-P1-01-APPROVED) satisfied:** unit + property + e2e + all checks, real
  output shown, single `npm run check` command.
- **NOT committed/pushed** (owner lands git). **No production build run** — stopped at green validation.

**Next:** owner reviews the kernel; then the second slice's LLD (candidate: the Sanitizer, or the
Executor-adapter that consumes the kernel's approved bound token). Each still gated by its own LLD.

## D-WATCH — live activity view (owner "excited, proceed", 2026-08-29)
Added a "Watch live" view: click the Work Agent in Agents & runs to watch a multi-surface task
(fix → run → verify in browser) unfold live. Shows **Claude Code as the executor with its output
streaming nested inside the run** (read files → hypothesis → wrote fix → 12 tests passed), the driven
**isolated QA browser** panel (before/after), read-only + claude-code badges per step, a **0 external
effects** tally, and **Pause/Kill** controls. Ends: "Claude Code drafted in a sandbox, Zeno verified,
nothing shipped — push/MR await your approval." Answers the recent scenario questions visually. Design
only; Wave C surface; no P1-01 impact.

## D-COMMIT — first commit landed (owner-directed, 2026-08-29)
Owner: "prepare what we've done, keep in 1 folder, commit in a branch, not the company one but abheet19."
Consolidated everything into `~/Personal Projects/zeno` and committed:
- Branch **phase-0-and-p1-01-kernel** (root commit 291661b), NOT main.
- Author **abheet19 <abheet19@gmail.com>** (personal; company identity untouched as global default).
- No AI-attribution trailer. **Pushed** 2026-08-29 to github.com/abheet19/Zeno (feature branch only; main/master empty).
- 79 files: refreshed docs/ (29 md, current), Gate-2 prototype + LLD HTML, docs/28 LLD + docs/29 model note,
  packages/kernel (full tested code). Excluded by .gitignore: employer docs 03a/03b, evidence videos, secrets, node_modules.

## D-FIELD — Standing Field made a live, meaningful map (owner request, 2026-08-29)
Owner: "is there logic in the 3D graph — does it link tickets/agents; make it dynamic, smart, usable;
what needs attention should glow." Rebuilt the field from decorative topology into a live map:
- **Ticket nodes added**, each **linked** to the agent working it (worked-by), the repo it touches, and
  its Jira source. 17 nodes / 25 edges now carry real relationships.
- **Attention glow:** every node has a live state — needs-you (amber), blocked (red), running (cyan),
  verified (green) — and glowing/pulsing = wants your attention. WEBEXT-3514's glow tracks the journey
  stepper (running → needs-you → building → verified).
- **Connection highlighting:** hover/select a node and its links + neighbours brighten while the rest
  dim — the logic becomes visible.
- **Smart clicks:** ticket → View intake; repo → Forge; agent → its run; device → Devices; source → view.
- **Legend** under the field explains the glow. Design only; Wave C; no P1-01/02 impact.

## D-SOLAR — Standing Field becomes the Zeno solar system (owner-directed, 2026-08-29)
Owner: "inspired by a solar-system type in the spec; best 3D design; bigger; it's the Orchestrator,
aware of everything." **Owner override recorded:** the original C-direction language said "centreless";
the owner now directs a SUN-centred orbital layout — aligned with the spec's own R-ring vocabulary.
Layout: Orchestrator = the sun (white-hot core, breathing double corona). Orbits BY ROLE:
R1 agents · R2 live work/tickets · R3 repos · R4 sources & devices — position now MEANS something.
Kepler-ish motion (inner rings orbit faster), faint projected orbit rings with names, deterministic
parallax starfield (seeded, no Math.random), comet-tail motion trails per node, attention glow
(amber=needs-you · red=blocked · cyan=running · green=verified), hover = trace links, smart clicks
(ticket→intake, repo→Forge). Stage enlarged to 64vh. Reduce-motion: static, no orbit/twinkle/trails.
**FROZEN pre-solar design preserved** at design-freezes/2026-08-29-living-field-PRE-SOLAR.html and as
artifact version label "living-field-map" (roll back anytime).

## D-NEURAL — Standing Field final form: the neural brain (owner-directed, 2026-08-29)
Owner reviewed both versions side by side and chose: "like before but with the new features — smart,
dynamic, changing, act as a neo brain." Final form = the ORGANIC CONSTELLATION layout (pre-solar
"living field" positions; solar rings/sun/starfield removed) + all smart features + three neural
behaviours:
1. **Organic drift** — nodes breathe around their home positions (golden-angle phases, never chaotic).
2. **Synaptic firing** — pulses travel the edges like signals in a brain; edges touching active or
   attention nodes fire fast (~2.6s), quiet edges rarely (9–16s); pulses swell and die, alternate
   direction, and take the attention colour of their endpoint.
3. **Spreading activation** — a node adjacent to an attention node warms with a faint sympathetic halo.
Kept: ticket nodes + links, attention glow (amber/red/cyan/green), hover-to-trace with dimming, smart
clicks, legend, list fallback, masked redaction, reduce-motion = fully static. Solar version remains
retrievable (artifact label "solar-system-field"); pre-solar freeze retained on disk.

## D-NEURAL-2 — final field: glowing constellation, no moving balls (owner, 2026-08-29)
Owner: "remove the moving balls which go node to node" + "keep it constellation with glowing and smart."
Removed the traveling pulse dots (synaptic-firing pulses AND the old live-edge packets). KEPT: organic
constellation layout, attention GLOW (amber/red/cyan/green, breathing pulse), breathing node drift,
spreading-activation halos, ticket links, hover-to-trace connection highlight with dimming, smart clicks,
legend, list fallback, masked redaction, reduce-motion=static. Result = a calm, glowing, smart living
map with no darting dots. Zero errors across full sweep.

## D-ATTENTION — field state system + attention beacon (owner, 2026-08-29)
Owner: "different color codes for stuck etc, something smart that immediately takes my attention."
Added: (1) expanded state palette — needs-you (amber), blocked/error (red), running (cyan), verified
(green), waiting (dim grey); (2) distinct PULSE RHYTHMS per state (needs=quick, error=sharp flash,
blocked=slow labored 'stuck', active=gentle, verified/waiting=steady) so the motion itself signals mood;
(3) PRIORITY SIZING (needs/error nodes render 16% bigger, blocked 8%); (4) the ATTENTION BEACON — the
single most-urgent-for-YOU node gets an expanding radar ping + a turning dashed reticle; it dynamically
follows the top-priority item (verified beaconTrajectory across the 5 journey steps: t5122→t5122→t3514
→t5122→t5122 — correctly lands on the approval-needed ticket at the Approve step); (5) legend updated
with all codes + "⊚ ping = act now". Reduce-motion: static (no ping/reticle spin/pulse). Zero errors.

## D-AGE-EGRESS — age urgency + egress edges (owner "yes add age, egress", 2026-08-29)
- **Age urgency:** each ticket carries a wait time (t3514 4m · t812 14m · t5122 2h · t3488 1d). Older =
  more urgent: it amplifies the attention glow and, among equal-priority items, wins the beacon (verified:
  the beacon now sticks to the 2h-old !5122 over the 4m-old ticket — oldest needs-you is most urgent).
  Node card shows "waiting 2h" etc.
- **Egress edges:** the connections that cross to an external system (work→Jira write, !5122→Jira merge)
  are drawn amber + dashed with a ⚡ gated glyph at midpoint — you can SEE which links leave the machine
  (the ones the kernel gates). Legend gains "⚡ egress". Reduce-motion static. Zero errors full sweep.

## P1-02 BUILT — executor & worktree adapter (owner "proceed to next step", 2026-08-29)
Interpreted as: approve + build P1-02 with the default sandbox. Built in the same package
(~/Documents/personal-ai-suite-phase1/kernel/):
- **src/executor.ts** — WorktreeExecutor (jailed · atomic · proven), path-jail, WritePayload,
  integrity + base-check + idempotency + reconcile. Pure logic, injected SandboxFs.
- **src/executor-node-fs.ts** — the real node:fs adapter (temp→fsync→rename atomic write, symlink-aware
  realpath). Isolated from the pure core.
- **3 test files** — unit + property (jail escape ×400, idempotency ×300), kernel↔executor e2e
  (approve→REAL file change→verified; drift→refused→untouched; T0 auto; failing exec→outcome-unknown),
  real-fs smoke test against an OS temp sandbox.
- **Results: 47 tests pass · ~3,000 property scenarios · 99.6% line coverage (executor core 100%) ·
  strict typecheck clean · dependency-free lint clean.** Standing test mandate satisfied.
- NOT committed/pushed (owner lands git; last commit was owner-directed). No production build run.
Next: 3rd slice LLD (candidate: the git executor — same interface, real repo effects, OR the sanitizer).
