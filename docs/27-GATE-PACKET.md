# 27 — Gate 1 and Gate 2 Approval Packet

**For the owner. Date: 2026-08-28. Phase 0 complete; Phase 1 not started.**

This document exists so you can approve with your eyes open. It is not a pitch. Roughly a third of it
is a list of things that are not done, cannot be done yet, or were done differently from the way the
master prompt asked. Read section 5 before you tick anything.

**Nothing has been built.** No repository, no package, no dependency, no service connection, no
purchase, no external contact, no production code, no public identifier. Every artifact named below is
a document on this Mac.

---

# 1. Executive summary — what was produced, in plain language

## 1.1 The shape of the work

Phase 0 had two halves and one interruption in the middle.

**Phase 0A (research and naming, 24 Aug)** answered *"what is actually true?"* before anything was
designed. Nine research lanes went out to the public web. A tenth lane was told to attack the other
nine. Both of your reference videos were decoded frame by frame with cryptographic hashes. Every URL
in the master prompt was inventoried and given a status. The result was a brand shortlist and a stop:
you picked **Zeno**.

**Phase 0B (design of the product, 24–28 Aug)** answered *"what is this thing, precisely?"* — product
requirements, the day-to-day journeys, the architecture, the threat model and permission tiers, the
data-sanitization design, the cost ledger, the model plan, the test plan, the roadmap and risk
register. Then the design track: a transformation matrix that says what may and may not be borrowed
from your reference reels, eleven design seeds, three finished directions, your selection of **B+C**,
and three detailed design specifications for Command, Forge and Counsel in that language.

## 1.2 The numbers, so you can size it

| What | Count | Where |
|---|---|---|
| Acceptance criteria extracted from the master prompt and mapped | **196** | `ledgers/acceptance-criteria.csv` |
| Corrections where research overturned or refined the prompt's own claims | **41** | `03-corrections-log.md` |
| Requirement conflicts recorded with a safe substitute rather than silently resolved | **10** | `02-conflict-and-disposition-register.md` |
| Assumptions in force / contradictions found / genuine unknowns | **8 / 6 / 9** | `04-assumptions-contradictions-unknowns.md` |
| Seed URLs inventoried from the prompt | **233** (121 actually researched — 52%) | `ledgers/seed-coverage-report.md` |
| GitHub repositories censused | **474** | `research/L6-manifest.json` |
| Video frames independently decoded and hashed | **17,595** (9,530 + 8,065) | `video-evidence/` |
| Design seeds permuted before three directions were chosen | **11** | `21-design-divergence-lab.md` |
| Phase-1 implementation slices planned | **31** | `18-roadmap-and-risk-register.md` §5 |
| Owner decisions that only you can make | **15** (+3 new) | §4 below |

## 1.3 The five things worth knowing before you read further

1. **The research changed the plan.** Forty-one corrections are not cosmetic. The prompt's own
   24-Aug video measurement is wrong. There is no official NeoSapien MCP anywhere public, yet a live
   connector sits in this session. The MCP `2026-07-28` release is a breaking rewrite, not a bump.
   Graphiti carries a transitive licence trap (GPLv3 or SSPL v1 via its required database). Obsidian
   is not installed on this machine at all. Each of those would have become a defect later.

2. **The brand decision has a real cost attached.** No candidate name graded LOW. Zeno carries a
   HIGH trademark grade with four live/pending US Class 42 registrations, one of whose Class 9
   recital ends in the unqualified phrase covering downloadable software development tools. The
   mitigation — compound wordmarks, scoped packages, a lawyer before any public act — is in force.

3. **One fact blocks a third of everything: the Windows machine's specifications (B-002).** 57
   acceptance rows are outright blocked on it and 9 more are missing only a number. It is not a
   design question. It is a fact question, and you are the only source.

4. **You chose to build on this Mac.** That decision is recorded, and its consequence is recorded
   with it rather than waved away: Phase-1 code will execute on the work Mac as isolated,
   disposable, synthetic-fixture builds in a scratch root. It does not authorize capture,
   permissions, login items, Keychain access, pairing or automation against employer surfaces.

5. **Gate 2 as literally worded is not yet satisfiable.** The master prompt requires *interactive
   prototypes* and says prose is not an acceptable substitute. What exists is three extremely
   detailed *written specifications* precise enough to build a prototype from — which is not the
   same thing. This is the single largest honest gap in the packet and it is in §5.1.

## 1.4 The complete artifact list

**Phase 0A** — `00-DECISIONS` · `01-workspace-context-scope-record` (now v4) ·
`02-conflict-and-disposition-register` · `03-corrections-log` · `03a-context-bootstrap-report` ·
`03b-existing-knowledge-systems-report` · `04-assumptions-contradictions-unknowns` ·
`05-video-evidence-manifest` · `06-brand-gate-report` · `07-PHASE-0A-PACKET` · `08-BRAND-DECISION` ·
plus `ledgers/`, `research/L1–L9`, `video-evidence/`.

**Phase 0B** — `09-WINDOWS-HANDOVER-PLAN` · `10-PRD-suite-and-products` ·
`11-journeys-and-information-architecture` · `12-architecture-and-adrs` ·
`13-threat-model-and-policy` · `14-context-sanitization-gateway` ·
`15-paid-service-and-hardware-ledger` · `16-model-and-adaptation-plan` ·
`17-evaluation-and-acceptance-plan` · `18-roadmap-and-risk-register` ·
`20-reference-transformation-matrix` · `21-design-divergence-lab` ·
`22-direction-A/B/C` · `24-prototype-command` · `25-prototype-forge` · `26-prototype-counsel`.

*Housekeeping: the file sequence has no `19` and no `23`. Nothing was deleted; those numbers were
simply not used. If you expected an artifact at either, say so and it will be produced or accounted
for.*

---

# 2. Gate 1 checklist — architecture and product

**What you are being asked to approve:** scope, research conclusions, architecture, security and data
boundaries, licences, costs, and the Phase 1 plan. Master prompt §14 requires this approval before any
repository is created or any implementation code is written.

Seven acceptance criteria carry a Gate-1 dependency: SUITE-AC-01, SUITE-AC-03, SUITE-AC-14,
RESEARCH-AC-01, RESEARCH-AC-02, RESEARCH-GITHUB-AC-01, REPO-BOOTSTRAP-AC-01.

**How to use this.** Each line is a claim you are agreeing to, in plain language, with the document
that substantiates it. If a line is wrong, or you disagree, strike it and say so — a struck line
re-opens only the artifact it points at.

## 2.1 Scope — what the first version is, and is not

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **MVP is Phase 1 + Phase 2 only**: one machine, no external writes, no employer systems, Forge working only against a fixture repository | `18-roadmap` §8.1 |
| ☐ | The **"not in MVP" list is a contract**, not a wish list: meetings (Counsel), cross-device, macOS runtime, real integrations and commerce are all out of the first version | `18-roadmap` §8.2–8.4 |
| ☐ | The **permanently-rejected list stays rejected in every future phase** — concealment/undetectable meeting modes, silent voice enrollment of other people, autonomous payments, permission bypass, hidden chain-of-thought, key/quota recycling | `02-conflict-register`, `18-roadmap` §8.4 |
| ☐ | You have read the **honest cost of cutting**: this MVP does not change your working day, and the meeting problem — probably your most acute pain — waits five phases | `18-roadmap` §8.5 |
| ☐ | **Workspace Context Scope Record v4** stands as written: 4 repositories (~24,754 files), work-root prompts, skills, Jira read-only on WEBEXT + WEBEXTOPS, NeoSapien schema-only, **training eligibility: none**, expiry 2026-11-22 | `01-workspace-context-scope-record.md` |
| ☐ | You accept the **open question inside v3**: WEBEXTOPS is an ops project and the auto-intake default approved for WEBEXT may be wrong for it | `01-` closing section |

## 2.2 Research conclusions — the facts that now govern

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **41 corrections govern over the master prompt** wherever they conflict with it | `03-corrections-log.md` |
| ☐ | Specifically: the prompt's **24-Aug video gap profile is wrong** (no 33.333 ms gap exists anywhere in that file) | C-018 |
| ☐ | Specifically: **MCP `2026-07-28` is a breaking rewrite** — budget a port, not a version bump | C-026 |
| ☐ | Specifically: **Graphiti requires Neo4j (GPLv3) or FalkorDB (SSPL v1)** — every lane checked what it recommended, none checked what that thing *requires* | C-027 |
| ☐ | Specifically: **no official NeoSapien MCP exists publicly**, and the live connector is best read as an undocumented vendor-hosted endpoint | C-011 / B-004 |
| ☐ | Specifically: **model weights drift between point releases** and licences change with them; and **openWakeWord's pretrained models are non-commercial + share-alike**, so the framework is usable only with self-trained models | C-028 |
| ☐ | The **ten conflict dispositions stand** and none may be silently re-resolved later | `02-conflict-register` |
| ☐ | The **disclosed research caps are accepted as caps, not as met**: fork deduplication is impossible through GitHub search; page-1 sampling is not coverage; `help.openai.com` is bot-gated | C-014, C-015, C-016 |
| ☐ | **`.atom` feeds become the standard freshness method; SEO listicles are banned as status evidence**, and every remaining `adopt` verdict judged from a rendered landing page gets re-audited by feed with the read date recorded | `18-roadmap` R-10 |

## 2.3 Architecture

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **component architecture, five tiers and trust boundaries** | `12-architecture-and-adrs` §2, §4 |
| ☐ | **Package boundaries enforced by seven `zeno-arch-test` rules as build-failing controls**, each proven by a deliberately planted violation | `12-` §6, SUITE-AC-03 |
| ☐ | **Five independent release trains** (`core` / `services` / `runtime` / `clients` / `brokers`), with brokers validated per host and **no inherited pass** | `12-` §5 |
| ☐ | The **eight cross-cutting invariants**, in particular I-8: *every rejected pattern is denied by a structural control, not by a policy sentence* | `12-` §7 |
| ☐ | The **ADR queue**, with the blocked ones acknowledged as blocked rather than quietly decided: ADR-0002 and ADR-0012 (needs spike + B-002), ADR-0004 (B-002), ADR-0017 and ADR-0020 (you) | `12-` §9 |
| ☐ | Either **adopt or decline the eight phase-exit reviews PER-1…PER-8** — the master prompt names no gate that closes Phases 1, 2, 3, 4, 6 or 8, so without them a phase ends when someone decides it has | `18-roadmap` §1.2 (**D-8**) |

## 2.4 Security and data boundaries

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **Context Sanitization Gateway**: twelve sink classes, two storage classes, the token vault's two-hop indirection, nine enforcement stages | `14-context-sanitization-gateway` |
| ☐ | **"No unregistered raw-to-consumer path exists" becomes a build gate**, not a promise | SAN-AC-01, `14-` §2 |
| ☐ | The **T0–T4 approval tiers** and the single canonical approval-binding schema — including the full list of things approval can **never** be inferred from (a wake phrase, voice identity, opening a notification, silence, gaze, "looks good" outside the bound flow, a prior approval, urgency, model confidence, an agent vote) | `13-threat-model-and-policy` §3, §4 |
| ☐ | **The strict default: with no platform authenticator present, T3 is blocked — never downgraded to T2.** A missing security factor reduces capability; it never reduces the requirement | `13-` §3 (**D-10**) |
| ☐ | The **three preconditions ship before the capabilities they protect**, not as mitigations added afterwards | `18-roadmap` R-03 |
| ☐ | The **voice-biometric lawful-basis, retention and residency design is a precondition** of the voice-identity slice and of Phase 5 — speaker embeddings are special-category data under GDPR Art. 9 and personal data under DPDP | C-032, `13-` §8 |
| ☐ | **The work-Mac gate is asserted per slice, not per phase** | `18-roadmap` R-27 |
| ☐ | The **prompt-injection position**: tool descriptions and tool results are attacker-controlled text entering the model's context, and containers bound execution, not that attack surface | `14-` §8 |

## 2.5 Licences

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **four-column rule** — code / weights / datasets / **required runtime**, each with a fetched primary URL — enforced as a **build-failing gate**, not a checklist | `18-roadmap` R-01, SUITE-AC-09 |
| ☐ | **Graphiti is either restated as self-host-only-never-distribute-never-offer-as-a-service, or excluded outright.** Which applies depends on your productization answer | C-027 (**D-4**) |
| ☐ | **Weights pinned by revision and mirrored**, with the in-product attribution surface CC-BY-4.0 requires | `18-roadmap` R-04 |
| ☐ | **openWakeWord pretrained models are learn-only; Piper is GPL-3.0** — both are constraints on the wake/TTS slices | `18-roadmap` §10 G1.E |
| ☐ | **Apple SF Pro, SF Mono, New York and SF Symbols are rejected outright** — including in mock-ups | `15-ledger`, `18-roadmap` P1-S22 |
| ☐ | The standing disclaimer: **this is not legal clearance.** Every licence statement is a reading of a text fetched on 2026-08-24 | `18-roadmap` closing |

## 2.6 Costs

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | **$0 budget remains in force.** Every paid item is a costed proposal, never an assumption | `15-paid-service-and-hardware-ledger` |
| ☐ | **Code signing and notarization are paid and unbudgeted.** Phase 0 runs unsigned local builds; a personal release is unreachable until funded | N-5 (**D-11**), R-17 |
| ☐ | **The commercial edition is gated on a paid legal step** and stays deferred | N-6, R-18 |
| ☐ | Obsidian Sync ($4–$10/month), a SIP number, hosted meeting-bot time, Neo4j Enterprise and the various Pro tiers are **costed options, none assumed** | `15-` §3 |
| ☐ | **Non-monetary costs are real and will be measured**: disk for weights, RAM, energy, thermals, and token spend per context pack, per answer and per evaluation run | `15-` §6, `16-` §5 |

## 2.7 The Phase 1 plan

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **31 Phase-1 slices** and the four-wave structure with **three genuinely independent unblock conditions** (Wave A needs only Gate 1; Wave B needs B-002; Wave C needs Gate 2) | `18-roadmap` §5 |
| ☐ | The **LLD gate**: no slice writes code before its own approved LLD Artifact, and approving one slice's LLD is never approval of the next | LLD-GATE-AC-01, `18-` §4.3 |
| ☐ | The **slice-size rule and MR discipline** | `18-` §4.2, §7.1 |
| ☐ | The **test strategy, rollout stages and rollback matrix** — including that **a deletion is not rollbackable by design** | `18-` §7.2–7.4 |
| ☐ | **PER-1's nine exit criteria** define what "Phase 1 is finished" means | `18-` §2.1 |
| ☐ | Your **standing rules are carried into the plan**: never `git commit`, never `git push`, never run builds — you land every commit yourself | `18-` §10 G1.G |

## 2.8 Blockers you are acknowledging as open

☐ **B-002** Windows pilot specifications · ☐ **B-004/X-04** NeoSapien officialness · ☐ **U-02**
historical Graphify data egress — *which vendor received employer repository content during the
removed "deep mode" window; this outranks everything in Phase 3* · ☐ **U-03** `graphifyy` security
posture · ☐ **U-04/X-03** Obsidian vault existence · ☐ **U-05** whether local Codex memories are
enabled · ☐ **U-06** Claude Code history before 2026-07-01 (deleted) · ☐ **U-07** GitLab history
(OAuth unauthorized) · ☐ **U-08** Wispr Flow in scope? · ☐ **U-09** employer policy on running an
assistant against QuillBot systems · ☐ Apple Silicon or Intel for the Mac — *on Intel, local speaker
identification does not run at all* · ☐ per-SDK MCP `2026-07-28` support · ☐ ASVspoof 5 dataset
licence, VoxCeleb terms.

## 2.9 What approving Gate 1 unlocks

- Creating the **private `abheet19/zeno` repository**, after an authenticated availability check that
  displays the actual owner to you before anything is created.
- Writing **Phase-1 implementation code — slice by slice, each behind its own approved LLD.**
- Starting **Wave A** (the deterministic spine: types, contracts, policy engine, audit ledger,
  approval binding, credential broker, sanitizer) which needs neither B-002 nor Gate 2.

## 2.10 What approving Gate 1 does NOT unlock

- **No design implementation.** No visual or non-visual production implementation may begin until
  **both** Gate 1 and Gate 2 are approved (DESIGN-GATE-AC-01).
- **No service connection**, no private-history ingestion, no employer repository touched.
- **No Wave B** — that waits on B-002. **No Wave C** — that waits on Gate 2.
- **No work-Mac pilot.** Gate 1 is not that, and cannot become it.
- No public identifier of any kind: no domain, handle, public package, bundle-ID reservation,
  app-store listing or trademark filing. No spending.

---

# 3. Gate 2 checklist — design

**What you are being asked to approve:** one design direction and the prototypes for all three core
apps. **29 acceptance criteria carry a Gate-2 dependency.**

**Read §3.6 first.** Three of the lines below cannot honestly be ticked today, and one of them is
structural.

## 3.1 Video evidence — at the master prompt's literal bar

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | **23-Aug compilation: exactly 9,530 frame rows covering 0–9529.** Independently reproduced — first PTS 0.000000, last 158.993333, gap range 16.666–66.667 ms, exactly ten gaps above 20 ms, 17 duplicates in 11 runs | `video-evidence/LEDGER-ASSERTIONS.md` |
| ☐ | **24-Aug compilation: exactly 8,065 rows covering 0–8064.** Independently reproduced — last PTS 134.431667, 81 duplicates in 44 runs, max run 7 | same |
| ☐ | **The prompt's own 24-Aug gap figure is superseded** — there is no 33.333 ms gap in that file; ~16.667 ms gaps number 8,047 not 8,062; exactly one gap exceeds 20 ms | C-018 |
| ☐ | The method is reproducible and its two traps are recorded: `-fps_mode passthrough` as an **output** option (without it the 23-Aug source silently loses 7 frames), and scene thresholds calibrated to this washed-out second-generation material at 0.10, not a generic 0.40 | C-020, C-021 |
| ☐ | **Desktop-monitor footage is not evidence for mobile, accessibility, gesture or voice behaviour** | VIDEO-AC-14 |
| ☐ | Source video and every derived frame, ledger and annotation are governed by the recorded retention and access rules | `05-video-evidence-manifest.md` |
| ⚠ | **"Unresolved-interval count is zero" — CANNOT BE TICKED TODAY.** Six candidate boundaries remain across 17,595 frames (23-Aug frames 18, 62, 1370, 2035, 2125; 24-Aug frame 4650) and **every row still reads `pending-semantic-review`.** Automated decoding is explicitly not frame-by-frame semantic review | §5.2 |

## 3.2 Originality and the transformation record

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | The **Reference Transformation Matrix covers every supplied clip** — all 75 ranges across both compilations are accounted for, each marked ADAPT or REJECT with a reason | `20-reference-transformation-matrix.md` §3–§5 |
| ☐ | The **seven forbidden compositions are named and rejected with reasons**: F1 cyan sphere + gold halo + radial labels · F2 orange brain + concentric rings · F3 three tilted glass cards on a curved rail · F4 department-to-red · F5 full-screen white flash · F6 fabricated telemetry · F7 gesture/voice as authorization | `20-` §1 |
| ☐ | **No reference is copied, and the frame ledger is never used as a reconstruction storyboard** | VIDEO-AC-03 |
| ☐ | **Eleven design seeds** were permuted across nine morphological axes before three directions were finalized — more than the required nine | `21-design-divergence-lab.md` §3 |
| ☐ | **A / B / C are deliberate original permutations with identical feature coverage** | `22-direction-A/B/C` |
| ☐ | **Architectures adopted, values generated** — no reference system's colour values are taken verbatim | `22-C` §1.1 |
| ⚠ | **"Independent originality and similarity review completed" — CANNOT BE TICKED TODAY.** It has not been run. The design documents themselves flag it as required before this direction ships | §5.3 |

## 3.3 The selected direction and the three specifications

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | **B+C is the selected direction**, recorded 2026-08-28: the 3D Standing Field is the Overview and the way you navigate; the moment you go to work, surfaces become calm, near-opaque, flat planes with luminous edges. *3D where it helps, quiet where you read.* | `00-DECISIONS.md` |
| ☐ | **The seam law is a hard boundary, not a style note.** The Field renders in exactly six places and is prohibited behind or beneath any code, diff, terminal, transcript, table, approval, long text or list | `24-prototype-command` §0.2 |
| ☐ | **The Field adds comprehension, never capability.** Every Field operation exists on its list with the same keyboard, the same tier and the same receipt; a user can run the entire product having never opened it | `24-` §0.2, `22-B` §2.2 |
| ☐ | **The Standing Field is stated against each forbidden composition individually** — no sphere, no halo, no centre, no rings, no tilt, no carousel, no flash, matte and non-emissive, shape-not-colour class encoding, cyan as a flat 1 px accent, gold reserved to owner-selection | `22-B` §2.3, `24-` §1 |
| ☐ | **Counsel takes none of the Field.** It renders entirely in the calm-plane language; rank appears as a text chip, never a rendered axis, because text is the only form that survives a screen reader, a 2D fallback and a shared screen | `26-prototype-counsel` §0.1–0.2 |
| ☐ | **Forge licenses the Field in exactly two bounded places** and bans it from every reading surface; it suspends during runs so a spatial view never stutters a compile | `25-prototype-forge` §0.4, §9.4 |
| ☐ | **Your captured Counsel requirement is fully specified**: speaker-labelled live transcription, a manual Assist button producing one "say this" sentence plus 3–5 points plus cited sources with age and a confidence level, and a private Ask-Counsel lane with Send that never enters the transcript and is never broadcast | `26-` §4, §5, §6 |
| ☐ | **Your Forge requirements are fully specified**: agent chat beside a real editor/diff pane, a visible model + effort selector, per-repository rules and skills loaded by trigger with hashes recorded and conflicts surfaced, an arbitrary folder/workspace picker, and first-class MCP hosting with per-tool allow/ask/deny | `25-` §1, §2, §3 |
| ⚠ | **"Three linked interactive prototypes exist" — CANNOT BE TICKED TODAY.** `24-`, `25-` and `26-` are written specifications, each explicitly describing itself as *"precise enough that an interactive prototype could be built from it."* The master prompt says prose is not an acceptable substitute | §5.1 |

## 3.4 Accessibility and material floors

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | **Dark-first graphite with Dark / Light / System / High-Contrast**, never low-contrast | `22-C` §1.1 |
| ☐ | **Three depth layers maximum. Glass only on floating nav, controls, overlays, agent state and wake — never behind code, diffs, transcripts, tables, approvals or long text. No glass-on-glass** | `22-C` §1.5 |
| ☐ | **Every animation maps to exactly one real state.** The Command specification enumerates all fifteen animations in the direction with their bound state, duration and reduced-motion substitute; anything not on that list does not animate. **No perpetual loops, no fabricated telemetry, no meaningless waveform** | `24-` §8 |
| ☐ | **Truthful state throughout** — heard / received / resolving / checking / waiting / blocked / complete. **A success animation never precedes a verified receipt** | `24-` §5, `26-` §1.6 |
| ☐ | **Semantic colour stays reserved**: amber = approval/warning; red = blocked/error/destructive/denied only; owner-selection is its own gold channel; cyan = information/listening. Never colour-only | `22-C` §1.2 |
| ☐ | **Focus is a real border or outline, never a glow** (WCAG 2.4.13 Note 1 excludes shadow and glow) | `24-` §8, `25-` §10.2 |
| ☐ | **An in-app "solid surfaces" toggle is the mechanism**, because `prefers-reduced-transparency` is Baseline-limited and Chrome/Edge-only | `24-` §8 |
| ☐ | **Reduced-motion, high-contrast, 2D/no-GPU and low-power variants ship from the start**, never retrofitted, and lose **zero function** | `24-` §8, `25-` §9, `26-` §11 |
| ☐ | **A graph is never the primary surface.** List and table parity is mandatory on every graphical surface; the Field's DOM *is* the list, so drift is structurally impossible rather than merely tested | `24-` §1.8, `25-` §3.3 |
| ☐ | **3D is not the substrate.** It is bounded to brand, wake, idle, high-level topology and major transitions; opt-in, pausable, flagged off by default | VIDEO-AC-08, `24-` §8 |
| ☐ | **Settled, hidden, idle and static surfaces stop rendering.** A still Field is documented as *correct*, not broken | DESIGN-PERF-AC-01 |
| ☐ | **No performance number is stated as achieved anywhere.** Hardware is unknown; every figure is a target to measure, and the 2D/list path is the shipped floor | `24-` §9, `25-` §10.2, `26-` §12.2 |

## 3.5 Honesty controls built into the design

These are the parts of the design whose whole purpose is to stop the product from lying, and they are
worth ticking deliberately.

| ✓ | You are approving | Substantiated in |
|---|---|---|
| ☐ | **Particles are unrenderable without a real event id.** Removing the event source produces a still field, not a loop — and a fabrication audit must prove it | `24-` §9 row 6 |
| ☐ | **`not_configured`, `not sampled`, `not metered` and `unknown` are first-class legible values** with a reason and one action — not blanks, not zeros | `25-` §10.1 W10, `26-` §5.6 |
| ☐ | **Honest coverage will demo badly**, and that is accepted: with scope record v4, six of nine event classes are `not_configured`, so the Overview will be sparse and Today will carry a long coverage banner. **The banner is the feature, not the apology.** Every prototype dataset must be labelled synthetic on the surface itself | `24-` §9 row 9 |
| ☐ | **`local preflight` is never rendered as `CI passed`** — the literal string exists at exactly one call site, reachable only from a provider-verified result | `25-` §10.2 |
| ☐ | **The overlay-visibility check can never be complete** — a camera in the room defeats it. Counsel defaults to `assume visible`, carries mandatory warning copy, fails closed, and its platform matrix **ships empty rather than optimistic** | `26-` §12.1 W4, §8.5 |
| ☐ | **Screen-reader users get a deliberately degraded live Counsel experience** (on-demand rather than continuous announcement), stated as a design trade rather than hidden | `26-` §11.3, §12.1 W6 |

## 3.6 The three Gate-2 lines that cannot be ticked, and four more that are thin

**Cannot be ticked** — each is a ⚠ above and is expanded in §5:

1. **Interactive prototypes do not exist.** Only specifications do.
2. **The per-frame semantic video review is outstanding.** Every ledger row is `pending-semantic-review`, six boundaries are unadjudicated.
3. **The independent originality/similarity review has not been run** — and the design documents themselves name it as the highest-risk item in the direction.

**Thin, and you should decide whether they count** — these are Gate-2 criteria the design packet
addresses only partially:

4. **Windows Pilot Surface Map (DESIGN-WINDOWS-AC-01)** and **Mac Surface Map (DESIGN-MAC-AC-01)** —
   the specifications are written platform-neutrally. The Windows Mica-class material inversion, the
   five-condition fallback and the "never steals typing, selection or IME state" rule are all
   present, but there is **no per-platform surface map document**.
5. **Windows→macOS capability-delta map and GlassMaterialAdapter matrix (DESIGN-MATERIAL-AC-01)** and
   the **Cross-Platform Surface Matrix (DESIGN-XPLAT-AC-01)** — not produced.
6. **BRAIN-AC-01 (one Strategic Cortex grammar at tray/menu-bar, HUD and Command scales)** — the
   three scales exist in the design (tray capsule, Status Rail/HUD, Command), but they are not
   delivered under that name as one explicit three-scale sheet.
7. **CEREMONY-AC-01** — the three studies (Abstract Cortex, name-neutral Classical Strategist, Pure
   Instrument) are present as a comparison table in each direction with the reason each was rejected
   or chosen. Whether a table counts as a "study" is your call. Both Athena-conditional branches are
   correctly closed: Zeno of Citium is a Stoic, so no mythological imagery is licensed by the name.

## 3.7 What approving Gate 2 unlocks

- Implementing **the B+C direction** in Phase 1's Wave C surface slices, against the approved tokens
  — starting with the Zeno Glass token set and the 2D HUD/tray substrate.
- Nothing else.

## 3.8 What approving Gate 2 does NOT unlock

- **No Mac runtime. No 3D-as-substrate. No camera capture. No surface that is not in the approved
  direction.**
- **No work-Mac pilot.** Gate 2 is not that either.
- Gate 2 does not retroactively satisfy the three ⚠ lines. If you approve with them open, you are
  approving *a direction and a specification*, and the prototype, the semantic pass and the
  originality review become **conditions on the first surface slice** rather than conditions on the
  gate. That is a legitimate choice — but it should be a stated one, not an accident.

---

# 4. Decisions only you can make

Fifteen were carried into this gate; the evaluation plan surfaced three more. Each has a **default in
force** — what happens if you say nothing — so none of them can stall the work silently. Saying
nothing is a decision, and it is recorded as one.

## 4.1 The five you specifically asked to see

### D-2 · The ASSIST-AC-08 reinterpretation — reports land in a Zeno Vault Markdown root, not Obsidian

**The fact:** Obsidian is **not installed on this machine**. No `.obsidian` directory exists anywhere
under your home directory at depth 5–6, `Obsidian.app` is absent, there is no application-support
directory. Whether a vault exists on another device is open (U-04).

**Why it matters:** the acceptance criterion requires reports to land *"in the authorized Obsidian
Vault"* with evidence including *"Obsidian graph traversal."* Any such evidence produced today would
be fabricated.

**The substitution:** reports land as versioned Markdown in an authorized **Zeno Vault Markdown root**
— Obsidian-*openable* but not Obsidian-*dependent*. Evidence becomes Markdown/frontmatter schema
validation plus link-graph validation over that root. Obsidian stays an optional projection target if
a vault ever appears.

**Status:** you already ruled on this on 2026-08-28 ("Reports location: Zeno Vault Markdown root").
**This line exists so that ruling is recorded as an explicit acceptance-criterion change rather than
an implementation detail** — it changes a criterion, which is exactly why it cannot be done quietly.
Two further criteria (SAN-AC-07, MEMORY-AC-04) are partially affected the same way.

☐ **Ratify** · ☐ Supply the vault's real location instead · ☐ Reject and leave the criterion
unsatisfiable

---

### D-5 · The capability-catalogue deferral

**The contradiction:** the master prompt's §14 puts the Atomic Action Catalogue, the populated
Mac/Windows Capability Catalogues, the Software-Engineering Capability Catalogue, the Developer Tool
Matrix, the destructive-effect threat model and the natural-command corpus in **Phase 0A**. §16.2's
own Phase 0A packet lists six different items and does **not** include them.

**The split taken, flagged rather than chosen silently:** the brand-neutral **schemas and method** are
produced pre-gate; **population is blocked on B-002**, because §5.2.1 makes the Windows machine the
first concrete inventory and expressly forbids inferring one host's capabilities from another.

**Why this is the honest answer:** a populated catalogue built today would be fiction. It would
describe this Mac and be labelled as describing the pilot.

☐ **Confirm the split** (schemas now, population on B-002) · ☐ Require population now and accept it
is inferred · ☐ Re-scope the catalogues

---

### D-1 · The NeoSapien undocumented endpoint

**The fact:** zero results in the official MCP registry. Zero in the claude.ai connector registry.
Nothing on any `neosapien.ai` property. No GitHub organisation. Every findable "neo" MCP server is a
confirmed name collision. **And yet a live, account-bound NeoSapien connector is present in this
session** with `search_memories`, `get_reminders`, `get_memory_transcript` and `export_memories`.

**The gap:** the master prompt's own source-preference ladder has **no rung** for "account-provisioned
but undocumented." NEO-MCP-AC-01's success branch — find an *official* server — is unreachable, so the
only truthful outcome is its other branch: `unavailable / unverified`.

**The proposed new rung:**

> `vendor-provisioned-undocumented` — usable **read-only**, under a task-scoped grant, through the
> sanitization gateway only; **never citable as "verified official documented"**; never a silent
> dependency; and any Forge handoff that depends on it requires a recorded per-task waiver.

**One thing that is easy to miss:** NeoSapien is a **sink as well as a source**. A read-only grant does
not exempt what is *sent* in the query. Egress rules apply in both directions.

Four criteria are blocked behind this decision and two more are partially blocked. Their fixture
halves are testable today; only the live half waits.

☐ **Ratify the rung** · ☐ **Reject the connector** (default: mock-only, never citable) · ☐ Supply
in-account connection documentation that would make it verifiable

---

### D-16 · The build-on-this-Mac scope note *(new — arising from your 2026-08-28 ruling)*

You chose to build on the work Mac rather than the Windows pilot. The consequence was recorded, not
waved away, and it needs your explicit ratification because it moves a boundary:

**What changed:** this Mac moves from *"Phase-0 artifacts only"* to *"Phase-0 artifacts **plus**
isolated synthetic-fixture Phase-1/2 builds in a scratch root."*

**What did not change — the hard line, still in force:** no employer data in any build · no macOS
permission grant (Accessibility, Screen Recording, Microphone, Automation, Full Disk Access) · no
login or background item · no Keychain import · no executor pairing · no OS, browser or terminal
automation against real employer surfaces.

**The honest reading:** the master prompt's Windows-first ordering was a *validation* order, not a
Windows-specific architecture, so the shared headless core is platform-neutral and building on macOS
does not break the design. But §1.2's work-Mac protections were written assuming this Mac stayed an
artifact machine. **Phase-1 code will now execute here.** The Windows pilot becomes a later
cross-platform validation target rather than the first build host; B-002 is de-prioritised, not closed.

☐ **Ratify the v4 scope-record delta** · ☐ Revert to Windows-first and hold Phase 1 until B-002 · ☐
Ratify with additional restrictions you name

---

### D-7 · Cedar or OPA — the policy engine

Recorded by the adversarial review as *"an undecided decision that must not drift."* The architecture
recommends Cedar at medium confidence, contingent on a spike. This must be decided at the gate or the
spike must run first — because the policy engine is the single component allowed to compute an
authorization decision, and it is slice three of the build.

**One consequence to settle here rather than discover in Phase 1:** COMMAND-AC-08 requires a policy
simulator whose answers match production *exactly*. That is only passable if the simulator and the
enforcement point **share one policy artifact**. If they are two implementations of the same rules,
differential testing will find disagreements forever and the criterion can never close.

☐ **Cedar** · ☐ **OPA** · ☐ **Run the spike first**

## 4.2 The remaining open decisions

| ID | Decision | Default if you say nothing | Cost of leaving it open |
|---|---|---|---|
| **D-3** | Record that the product is **Zeno Mesh** while the acceptance-criterion IDs stay `LINK-AC-*` — neither half gets "fixed" | As stated | Someone tidies one half and breaks traceability |
| **D-4** | **Productization intent** — will this ever be distributed or offered as a service? | Assume never; SQLite path only, no graph database | Two ADRs cannot close; and if the answer is ever "yes", Graphiti + Neo4j/FalkorDB become permanently out |
| **D-6** | Coverage gaps: raise a `RELEASE-AC-*` family; raise criteria for §1.1; decide whether eight `WIN-*` criteria mirror the `MAC-*` set | None raised | Phase 8 cannot fail; Windows evidence rests on two generic criteria |
| **D-8** | Adopt or decline the **PER-1…PER-8** phase-exit reviews | Adopt | Phases end when someone decides they have |
| **D-9** | **Phase order** — accept that Counsel is five phases away, or approve an earlier post-hoc, owner-voice-only, no-live-overlay Counsel subset | Accept the order as written | Your most acute pain goes unaddressed longest. Counsel cannot be pulled forward past the voice-identity stack, the consent ledger and the biometric lawful-basis design — but a post-hoc subset genuinely can |
| **D-10** | Confirm **the strict T3 default**: no platform authenticator ⇒ T3 blocked, never downgraded | Strict | A security tier's guarantee could quietly become hollow |
| **D-11** | Accept unsigned Phase-0 builds; require a costed signing line item before any release | Unsigned P0 | A personal release is unreachable |
| **D-12** | **Retain or rename Zeno Vault / Zeno Forge / Zeno Glass**, each shadowed in developer search by HashiCorp Vault, Autodesk APS / SourceForge and Google Glass | Retain | **Renaming is free now and expensive later** |
| **D-13** | Ratify **dual capture off; NeoSapien optional and never required**; Counsel's own artifact is canonical | As stated | Counsel's canonical source stays ambiguous |
| **D-14** | The policy service is an **embeddable library plus a local service, never a remote singleton** — needs its own ADR at this gate | As stated | Two criteria become unsatisfiable together |
| **D-15** | Supply the **minimum viable B-002 subset**: OS edition/build, CPU/GPU/RAM, **platform-authenticator presence**, microphone presence, employer-data confirmation | **None — this is the hard blocker** | Wave B never starts |
| **D-17** *(new)* | **Does a second device of any kind exist?** Ten criteria name a device or display inventory as a blocker — sync, Mesh, cross-device, Vault replication, Review Companion. All require two endpoints; the corpus inventories one machine | None | Ten rows have no second endpoint and cannot be tested at all |
| **D-18** *(new)* | **Approve the sanitizer correctness and utility thresholds.** These are hardware-independent and committable now, and they gate every egress path | None | The sanitizer release gate has no bar to meet |

**Also add to the B-002 question list, both surfaced late:** camera presence and capability (gesture
control has no runtime without it), and **whether this Mac is Apple Silicon or Intel** — ONNX Runtime
dropped macOS x86_64 in 1.24, so on an Intel Mac local speaker identification does not merely run
slowly, it does not run at all.

---

# 5. What is honestly incomplete

Every criterion that is currently unsatisfiable, and why. Nothing here is hidden in a footnote
elsewhere.

## 5.1 The prototypes are specifications, not prototypes

**The requirement (ARTIFACT-FEASIBILITY-AC-01):** three linked *interactive* prototypes for
Assistant/Command, Forge and Counsel. **Static screenshots, moodboards, video and prose are explicitly
not acceptable substitutes** — it must be either official Claude Artifacts or an interactive
equivalent you have specifically approved.

**What exists:** `24-prototype-command.md`, `25-prototype-forge.md` and `26-prototype-counsel.md` —
roughly 280 KB of layouts, states, tokens, keyboard maps, motion inventories, failure behaviour,
budgets and accessibility contracts. Each document describes itself, accurately, as *"precise enough
that an interactive prototype could be built from it."*

**Why it is not the same thing.** Six Gate-2 requirements are only testable by interaction, not by
reading: that tab order equals row order with no orphaned focus at the seam; that a variant toggle
loses no state mid-flow; that the Approval Capsule masks correctly when a screen-share *starts while a
payload is already open*; that the execution stream survives a dropped and resumed connection with a
visible gap marker; that a settled surface actually stops drawing frames; and that the seam between
the Field and the work plane reads as one product rather than two.

**Two honest paths:**
- **(a)** Commission the three interactive artifacts now and hold Gate 2 until they exist. This is
  what the master prompt asks for.
- **(b)** Approve Gate 2 on the specifications, and move the prototype requirement onto the first
  surface slice as a precondition — which means P1-S22 cannot close until the interactive artifacts
  exist and pass the six interaction tests above.

Path (b) is defensible. It is not the same as path (a), and it should be recorded as a choice.

## 5.2 The per-frame semantic video review is outstanding

Both frame ledgers **PASS** on every technical assertion: exactly-once contiguous coverage,
monotonic timestamps, cryptographic per-frame digests, classified duplicate runs, measured gap
distributions, and a semantic-range map under which every decoded frame belongs to exactly one range.

**What is not established:** independent per-frame *semantic* review. **`review_status` is
`pending-semantic-review` on all 17,595 rows and `reviewer_confidence` is empty on every one.**

Six isolated detections remain unadjudicated — 23-Aug frames 18, 62, 1370, 2035, 2125 and 24-Aug frame
4650. All six sit inside plausible intra-range UI transitions rather than unaccounted scene changes,
but "plausible" is not "reviewed." Gate 2's bar is an **unresolved-interval count of zero**, and it is
not zero.

Note the asymmetry, because it is easy to misread as a failure: the 24-Aug table is almost all hard
cuts and 19 of its 21 boundaries land on a measured cut. The 23-Aug table deliberately mixes hard cuts
with soft semantic phase boundaries *inside one continuous shot* — "rings thicken", "nodes construct"
— which **no detector can corroborate by construction**. Only 24 of 54 register. That is expected, not
error.

## 5.3 The independent originality review has not been run

The design's own assessment is blunt: **the Standing Field is the highest originality risk in the
whole set.** A lit node field is the closest surface to F2 (brain + concentric rings) and adjacent to
F1 (sphere + halo + radial labels) — and B+C makes that view **the first thing you see.**

Seven guardrails are designed in: centrelessness, the ordinal provenance axis rather than rings, matte
non-emissive markers, shape-not-colour class encoding, typed labelled edges, strict list-primacy, cyan
as a flat 1 px accent and gold reserved to owner-selection. The non-identity proof against all seven
forbidden compositions is written out.

**But an independent reviewer's snap read is the actual hazard, and no independent reviewer has
looked.** The review must be run against F1 and F2 specifically, name-on and name-off, before this
direction ships. The design documents themselves classify it as a blocker, not a nice-to-have.

## 5.4 The Windows specifications are unknown, and that blocks a third of the plan

**57 acceptance rows are outright blocked on B-002, plus 9 more where only a number is missing — 66
rows, a third of the entire test plan.** Not one of them is a design question. Every design is
written. They are all *fact* questions.

What is blocked: every latency, frame-pacing, GPU, thermal and battery number; the Interaction Latency
Budget's baseline; the frozen hardware set for voice evaluation; the T3 second-factor question; and
truthful population of every capability catalogue.

**Every performance figure in every document is written as a target to measure, never as an
achievement.** That discipline is deliberate and it is the reason the packet reads as cautious about
performance. It should stay that way until the pilot machine is measured.

## 5.5 There is no Obsidian vault

Covered as decision D-2 above. Stated here because it is an *incompleteness*, not only a decision:
one acceptance criterion is **unsatisfiable as written** and two more are partially affected. Until
you ratify the substitution, they stay unsatisfiable.

## 5.6 Signed updates require money that is not budgeted

Code signing and notarization are **paid, unbudgeted, and their amounts are unverified**. The $0
budget is in force. Consequences, stated plainly: Phase 0 runs **unsigned local builds** — acceptable
for a private developer preview — and **a personal release is unreachable until it is funded.** The
anti-downgrade acceptance criterion cannot pass without a signing infrastructure that does not exist.

A related family of release criteria does not exist yet either and must be raised before Gate 1
closes: signed and notarized artifacts with anti-downgrade protection, staged rollout with verified
rollback, restore drills against a declared RPO/RTO, secure uninstall leaving no orphan process, port,
credential or capture permission, the wake-word test matrix for "Zeno" and "Zeno, attend", and the
hard constraint that the ecosystem watch **never auto-installs, never changes a model and never
rewrites scope**.

## 5.7 The research is 52% deep, and the gap has a shape

Of 233 seed URLs, **121 are `researched`** (51.9%), 71 `intentionally-deferred`, 21
`partially-researched`, 17 `inaccessible`, 2 not-applicable, 1 superseded, **0 blank**.

The ledger's assertion is that it is *complete and honest* — every row carries a status and a reason.
It is not an assertion that the research is complete.

**The gap is structural, not random.** Coverage is excellent where a lane owned the family — coding
agents 27/30, personal assistants 29/33, meeting copilots 23/36. It is **zero** in three families no
lane owned: developer workstation / terminal / QA / CI / infrastructure (10 URLs), the referenced
platform projects requiring licence review (8 URLs), and the user-supplied motion references (9 URLs,
all inaccessible by nature). Apple platform / Liquid Glass is 5/34 — largely deferred on purpose,
since the pilot is Windows-first and Apple's fonts are rejected outright.

**One further gap, and it is a named criterion:** RESEARCH-AC-02 requires a *worker-disagreement log*
and a *separate baseline-versus-deep-review split*. The adversarial pass exists and overturned twelve
claims — but that formal split has not been written. **RESEARCH-AC-02 cannot be marked satisfied.**

## 5.8 Three criteria are unsatisfiable exactly as worded

| Criterion | Why | Proposed handling |
|---|---|---|
| **ASSIST-AC-08** | The Obsidian vault does not exist; graph-traversal evidence would be fabricated | D-2 substitution, requires your ratification |
| **NEO-MCP-AC-01** | Its own success state — find an *official* NeoSapien server — is unreachable | D-1 new ladder rung, requires your ratification |
| **RESEARCH-GITHUB-AC-01** | GitHub search excludes forks by default, so fork/mirror deduplication is impossible through the documented interface | Disclosed as a hard cap; dedup key populated by URL canonicalization only |

**Six more are not achievable as implied:** phone/telephony (no endpoint provisioned; any number is a
paid dependency) · commerce T3 (platform-authenticator presence unknown) · fine-tuning (the scope
record sets training eligibility to **none**, so this can only ever run on synthetic corpora) ·
gesture body-diversity evaluation (not achievable with a one-person test population — the limitation
must be *stated*, never simulated) · anti-spoofing (the ASVspoof 5 dataset licence is unverified;
no evaluation may even be *planned* on it until the record is read) · sync and multi-device (need two
devices; one machine is inventoried).

## 5.9 Two things that are true and uncomfortable

**The MVP does not change your working day.** Phase 1 + Phase 2 give you a secure foundation, a
read-only assistant and Forge against a fixture repository. Your real repositories arrive in Phase 3;
meetings arrive in Phase 5. This is the correct safety ordering and it is also, for you personally,
possibly the wrong ordering. That is decision D-9 and it deserves a real answer rather than a nod.

**One employer question outranks everything in Phase 3 and predates this project entirely.** Graphify
once had a paid/LLM "deep mode" that was removed on 2026-06-22. The current report shows zero tokens,
but `cost.json` and a `memory/` directory in the ignore lists prove the mode was once enabled.
**Which vendor received employer repository content during that window is undetermined (U-02).** It is
not caused by this project and it is not this project's to answer — but Phase 3 touches those
repositories, and it should be settled before then.

---

# 6. The first three Phase 1 slices

Chosen because they need **Gate 1 only** — not B-002, not Gate 2. That is the whole point of the wave
structure: three independent unblock conditions so that one blocked condition does not idle the rest.

Each slice has its own LLD gate. **No slice writes code before its own LLD Artifact is approved, and
approving one slice's LLD is never approval of the next.**

## Slice 1 — P1-S00 · Repository and supply-chain floor

**What it delivers.** The private `abheet19/zeno` repository, correctly configured, with a
verification script that proves it.

**Its LLD gate — LLD-P1-S00.** The exact bootstrap sequence, the settings to apply and the
verification order. This is the one LLD that is mostly a checklist.

**What you will see before anything is created.** The authenticated availability check output and the
actual owner and visibility, displayed to you. Then, after creation, a script that asserts: owner is
`abheet19`, visibility is **private**, default branch protected, required reviews on, secret scanning
and push protection on, dependency alerts on, signed-release policy recorded, and that Pages,
packages, Actions artifacts and logs **cannot leak public**. The script fails the bootstrap if any
assertion fails.

**Why it is first.** It decides whether everything after it is private. A wrong owner or a public
default is unrecoverable in the sense that matters — the content was public for some interval.
Rollback is trivial (delete the repository) *only because it is empty*, which is precisely why this is
slice zero.

**Cost:** $0. **Needs:** Gate 1 only.

## Slice 2 — P1-S01 + P1-S02 · The L0/L1 foundation

**What it delivers.** The type and contract floor: branded IDs, zone and tier enums, the fourteen
canonical health states, the hash-chain primitive, the four-column provenance record schema — then
eleven contract packages, each with types, JSON Schema, a conformance suite and a mock.

**Its LLD gates — LLD-P1-S01 and LLD-P1-S02**, approved separately.

**What you will see.** A mocks-only test run under the no-network, no-filesystem-outside-tmp profile,
plus two deliberate failures: a planted architecture violation turning the build red, and a schema
change without a version bump turning the build red.

**Candour about "vertical."** This is a **foundation** slice by the roadmap's own labelling, and it
takes the declared foundation exception to the demo-path rule. It has no user-visible surface. It is
here because the two build-failing controls that make everything afterwards honest — no cycles, no
storage driver outside its package, and the both-ways compatibility job running the previous two minor
versions in each direction — land here or they never land at all.

**Cost:** $0. **Needs:** Gate 1 only.

## Slice 3 — P1-S03 · Zeno Warrant, the deterministic policy engine

**What it delivers.** The single component in the entire suite permitted to compute an authorization
decision. Embeddable, so the host broker re-enforces the same policy in-process rather than trusting
its caller.

**Its LLD gate — LLD-P1-S03. Blocked on your D-7 answer (Cedar or OPA).** The LLD must state which
engine and why, or the spike runs first.

**What you will see — the first genuinely demoable slice.** A policy REPL showing a decision with its
full reasoning for: an allowed T1, a preview-required T2, **a blocked T3 with no authenticator** (the
strict default, visible), and a denied T4. Plus a test proving that **a better model grants no broader
permission**, and a rule that greps every other package for tier literals and authorization verbs and
fails the build on a hit.

**Cost:** $0 — both candidates are open source. The four-column licence record for whichever is chosen
is a slice deliverable, not a footnote.

**Needs:** Gate 1 + D-7.

## If you want to see the design sooner — the fourth candidate

**P1-S22 · Zeno Glass tokens and the 2D HUD/tray substrate** needs **Gate 2 but not B-002**, so it can
run in parallel with the three above the moment Gate 2 passes. Its LLD is **LLD-P1-S22 plus a UI
Design Artifact tracing to the approved direction and its tokens.** Its demo is deliberately unglamorous
and exactly right: the HUD idle for five minutes with a frame counter showing **zero renders**, then
the same surface with the 3D flag on and off.

If §5.1's path (b) is chosen, this is the slice that carries the interactive-prototype precondition.

---

# 7. What happens the moment both gates pass — and what still cannot happen

## 7.1 What becomes possible, in plain language

The **private repository gets created**, after showing you the real owner and visibility first. Then
implementation starts — **one slice at a time, each behind its own approved LLD**, with you landing
every commit yourself, because your standing rules are carried into the plan.

Three streams of work become independently unblocked:

- **The spine (Wave A)** starts immediately: types, contracts, the policy engine, the audit ledger,
  approval binding, the credential broker, the sanitizer, the sink registry, lineage and deletion
  cascade, the capability broker, the orchestrator, the execution stream and kill switch, the model
  gateway. Fourteen slices, none of which needs a host machine or a design.
- **The surfaces (Wave C)** start as soon as Gate 2 passes: the token set and the 2D HUD/tray, the
  Command shell, customization and the policy simulator, Vault v0 and its Markdown projection, the
  read-only briefing, personal utility, one-conversation-many-surfaces.
- **The host edge (Wave B)** stays frozen until you answer B-002. Nothing about the gates changes that.

The end state of Phase 1 is defined and is not vague: **PER-1's nine exit criteria.** Either all 58
Phase-1 acceptance criteria pass, or each unmet one carries an owner-accepted written deferral naming
its new phase. **No criterion is ever closed by reinterpretation without your explicit ratification** —
the D-2 Obsidian substitution is the precedent, and it is a precedent for *asking*, not for
reinterpreting.

## 7.2 What still cannot happen — the list that must not be inferred away

**Neither Gate 1 nor Gate 2 — nor both together, nor a phase approval, nor a passing test, nor a
request to continue, nor an enthusiastic reply — authorizes a work-Mac pilot.**

That requires, in this order: Phases 1 through 5 complete on Windows; **Gate 3, the Windows Pilot
Gate**, with all six of its required contents; and you saying, in your own words, exactly:
**"Approve work-Mac pilot".**

Until all three have happened, the work Mac receives **no suite binary, no login item, no permission
prompt, no pairing, no capture and no privilege test**, and the macOS broker does not exist as a
running artifact.

Also still out of scope after both gates:

- **No real service is connected.** Not Jira, not GitLab, not NeoSapien beyond the mock, not a
  calendar, not a meeting platform. Each is its own separate approval.
- **No private history is ingested.** Not Claude Code transcripts, not Codex memories, not Cursor
  data, not NeoSapien memories.
- **No employer repository is touched.** Every fixture is a copy or synthetic. No test ever schedules
  a run against `~/Work`, and `~/Work/ASSISTANT_PROMPT.md` is never written.
- **No public identifier is created.** No domain, no handle, no public package registry name, no
  bundle-ID reservation, no app-store listing, no trademark filing. The Class 42 exposure goes to a
  lawyer before any of those.
- **No money is spent.**
- **No T3 commerce commit.** That needs its own separate written approval, at Phase 7b, and is
  blocked outright if the pilot machine turns out to have no platform authenticator.
- **No 3D as substrate, no camera capture, no Mac runtime, no surface outside the approved direction.**

## 7.3 The three things that would most change the picture

If you do only three things after reading this:

1. **Supply the minimum B-002 subset** — OS edition/build, CPU/GPU/RAM, platform-authenticator
   presence, microphone presence, camera presence, employer-data confirmation, and whether this Mac
   is Apple Silicon or Intel. That is 66 blocked rows, and it is the highest-leverage unblock in the
   entire plan.
2. **Decide §5.1 — path (a) or path (b)** on the interactive prototypes. Gate 2's honesty depends on
   which one you pick.
3. **Answer D-4 (productization intent) and D-12 (retain or rename Vault / Forge / Glass).** Both are
   free to decide now and expensive to decide later.

---

## Closing statement

Nothing was created, installed, connected, registered or spent to produce this packet. No repository,
package, domain, handle, bundle ID or trademark filing. No dependency installed. No service connected.
`~/Work` untouched. No employer data left this machine. Nothing from the reference reels is
reproduced anywhere in the design.

Every number in these documents that describes future performance is absent on purpose. B-002 is open,
and the first real numbers arrive from measurement, not from estimation.

**This is not legal clearance.** Every licence and trademark statement is a reading of a text fetched
on 2026-08-24. Anything that ships needs counsel review against the actual LICENSE and NOTICE files at
a pinned commit.

> **I have not created a repository, connected production services, ingested unapproved private
> histories, purchased anything, contacted anyone, or started production implementation. Awaiting
> explicit Gate 1 and Gate 2 decisions.**
