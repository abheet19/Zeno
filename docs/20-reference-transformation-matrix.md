# 20 — Reference Transformation & Morphological Matrix (Master Prompt §11.2)

**Phase 0B · Gate 2 design evidence · Worker: Zeno design lane · Date: 2026-08-28**

## 0. What this document is, and the rule it obeys

This is the **clean-room transformation ledger** that stands between the two supplied reel
compilations and any Zeno pixel. Its job is to force every visually meaningful range in both
reels through one gate: *extract the abstract principle, discard the literal rendering, and
re-home the principle inside a Zeno product state — or reject it on the record.*

**The absolute rule (MP §11.2), restated so it governs every row below.** The two reels are
**evidence of principles, never a design to copy**. A Zeno direction FAILS Gate 2 if an
independent reviewer could mistake it for a reskin or collage of a reel. Nothing in the
"Transformation" column may reproduce a reference frame order, camera path, transition timing,
component silhouette, spatial arrangement, or distinctive composition. No reel asset, trade
dress, shader, audio or code is reproduced anywhere; every principle is abstracted to text.

**Evidence base this document is built on (verified, not re-derived here):**

| Source | What it fixes for this matrix |
|---|---|
| `05-video-evidence-manifest.md` | Both compilations hash-verified; clean-room boundary; rights unverified → **abstract-only** |
| `video-evidence/semantic_ranges.json` | The **54 + 21 = 75** ranges enumerated below (verbatim range index) |
| `LEDGER-ASSERTIONS.md` | Contiguous exactly-once frame coverage; boundary corroboration; no silent gaps |
| `research/L4-design-research.md` | Material tiers, WCAG floors, `backdrop-filter`/WebGPU Baseline, licence findings |
| `10-PRD-suite-and-products.md` | The seven products, their capability tiers and destination states |
| `11-journeys-and-information-architecture.md` | The S01–S28 state machine, the ten view states, the Command nav tree |

**Timestamp derivation.** Both sources run at **~59.94 fps** (23-Aug: last PTS 158.993333 s /
9529 intervals = 0.016685 s/frame; 24-Aug: 134.431667 s / 8064 = 0.016671 s/frame), consistent
with the manifest. Range times below are `m:ss` from those measured PTS. Range IDs are prefixed
**23A** (first compilation) / **24A** (second) with the frame span retained for precision.

**Coverage guarantee.** Every one of the 75 ranges resolves to exactly one disposition — a
transformed lesson **or** a documented rejection. §5 is a coverage ledger proving none was
silently copied or ignored.

**Disposition legend.**

| | Meaning |
|---|---|
| **ADOPT** | The abstract principle transfers as a Zeno system law with only a clean-room re-rendering; low re-scoping, low trade-dress risk. |
| **ADAPT** | The principle transfers but is materially re-scoped, split, demoted to a secondary view, or corrected for truthfulness / accessibility / semantic-colour discipline. |
| **REJECT** | The composition or behaviour is not carried — because it is a forbidden composition, decorative, navigation chrome, or a trade-dress hazard. A salvaged abstract lesson, where one exists, is already captured by an ADAPT row elsewhere and is named. |

**Headline tally: 75 ranges → 3 ADOPT · 35 ADAPT · 37 REJECT.** (38 yield a transferable
transformed lesson; 37 are rejected: 17 navigation/grid/end-card chrome, 4 decorative
transitions, 1 environmental, 15 forbidden-composition / decorative-hero / input-as-authorization.
The per-range ledger in §5 is authoritative.)

---

## 1. The forbidden compositions — explicit rejection with reasons (MP §11.2)

These are rejected **as screen-level compositions** before any row is written, because each is a
distinctive reel signature that an independent reviewer would recognise. Where a legitimate
abstract need hides underneath, the need is named and routed to an original ADAPT row; the
*geometry / mapping / effect* is discarded.

| # | Forbidden composition | Reel ranges it appears in | Why it is rejected | Where the underlying need goes instead |
|---|---|---|---|---|
| F1 | **Cyan sphere + full gold halo + radial capability labels** | 23A f175–1115, f7388–7506, f8940–9011; 24A f6639–7097 | Distinctive trade dress; radial label rings around a core are keyboard/screen-reader hostile (WCAG 2.1.1); a perpetual glowing ring violates "no motion without state" and "focus is a border not a glow"; gold-as-status collides with reserved amber semantics | The real need — *a system enumerating its own capabilities/health while waking* — becomes a **list-first capability & health inventory** (Command K5 Explorer, D4 Diagnostics) with an optional secondary topology view (§3 R3–R6) |
| F2 | **Orange brain + concentric department rings** | 23A f2285–2870, f3225–3727 | Named forbidden composition; a central "brain" with concentric rings is a fixed trade-dress silhouette; a free-canvas company graph as the primary surface is prohibited (WCAG 2.1.1, keyboard/SR) | *Multi-agent overview* → **first-class Agents list/table** (Command W3) with optional node view over the same data, same operations (§3 R15–R19) |
| F3 | **Exactly three tilted smoked-glass cards on a curved rail** | 23A f7597–8841 (NEXUS hold + carousel ranges) | Named forbidden composition; tilted glass-on-glass violates the 3-depth / no-glass-on-glass rule; a curved carousel hides items and is weak for keyboard/SR | *Glanceable multi-source briefing* → **threaded, deduplicated, list-first Attention Center** with per-source coverage + age (Command T1/T2); flat non-tilted tiles at most (§3 R31–R35) |
| F4 | **Department-to-red colour mapping ("Sales = red")** | 23A f2404–2870 department DAGs | Red is reserved **only** for blocked / error / destructive / denied. Binding a neutral domain to red destroys the one status channel a user must trust | Domains carry a **single neutral brand accent**; semantic colour (amber, red) stays reserved for meaning, never identity (§3 R16; Axis E) |
| F5 | **Full-screen white particle FLASH** | 23A f1799–1850; partially 24A f7569–7624 collapse | Direct seizure risk (WCAG 2.3.1 three-flashes) and an explicit constraint violation; the single most dangerous frame in the corpus | *Hero reveal* → **bounded dark cross-dissolve** with luminance delta held under threshold; reduced-motion → instant cut, no flash (§3 R11, S12) |
| F6 | **Fabricated telemetry / meaningless numeric callouts** | 23A f1491–1798 metric callouts, f9427–9529 orb telemetry; 24A f394–1649 HUD readouts | "No fabricated telemetry" and "truthful state" are hard constraints; hardware is UNKNOWN (B-002) so no rate/GPU figure may be shown as achieved | Every number is **bound to real inspectable state** (device/mic/model/network/budget/eval) or it does not render; performance is a *target to measure*, never a displayed achievement (§3 R38, S1; Axis H) |
| F7 | **Gesture / voice as authorization** | 23A f56–114 hand summon, f9118–9356 two-hand orb; 24A f394–1649 voiced "Ultron" lock, f1650–3125 voiced "unlock all devices" | Gesture and voice are **presence signals, never authority**; every T2/T3 approval moves to a paired signed-app UI (T3 adds a fresh device factor); remote control cannot approve OS prompts, enter secure fields, or act on a locked target | Summon → explicit **hotkey / wake / push-to-talk with a visible armed state**; approval → hash-bound Approval Capsule (§3 R1, R37, S1, S2; Axis I) |

---

## 2. How to read the matrix

Columns: **Range** (id · time · frames) — **Observed abstract principle** (the lesson, not the
picture) — **Zeno problem it could solve** — **Disp.** — **Transformation → original** (the
clean-room move) — **Destination** (product · nav node · mapped state) — **Trade-dress risk** —
**A11y / perf cost**. States use the workflow grammar (asleep · waking · listening ·
transcribing · retrieving · planning · executing · awaiting-approval · paused · blocked ·
success · error) and/or the ten view states (empty · loading · streaming · approval · stale ·
outcome-unknown · degraded · offline · error · safe-mode).

---

## 3. Matrix — Compilation 23-Aug (54 ranges)

### 3.1 Grouped navigation / grid / end-card chrome — REJECT (source-navigation, not design evidence)

> **23A-NAV** covers ranges f0–25 (0:00 Control Center), f26–55 (0:00–0:01 Saved grid),
> f1270–1325 (0:21 "Follow for more" end card), f1326–1385 (0:22 Saved grid → textura),
> f2215–2229 (0:37 "Enjoy" end card), f2230–2284 (0:37 Saved grid), f7507–7596 (2:05 Saved grid),
> f8842–8860 (2:28 exit), f8861–8939 (2:28 Saved grid), f9012–9117 (2:30 Saved grid),
> f9357–9426 (2:36 Saved grid).
> **Principle:** none of design value — these are Instagram/iOS chrome and creator sign-offs.
> **Disposition: REJECT.** They are evidence of *how the reels were assembled*, not of any product.
> No Zeno destination. Trade-dress risk n/a. A11y note: the full-bleed grid + system chrome is
> exactly the kind of borrowed surface the clean-room boundary exists to keep out.

### 3.2 Environmental — REJECT

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f7160–7231** · 1:59–2:01 | A local physical workstation is the real host of the "company of agents" — local-first is a *place*, not a cloud abstraction | Reinforces Zeno's local-first framing, but is a photograph of hardware, not UI | **REJECT** | No screen composition to transform. Salvaged lesson (local-first execution host) is already carried by Command W5 Workstation Control Center and Mesh device identity — no new geometry taken | — (environmental) | none | Hardware is UNKNOWN (B-002); never claim a device capability from a shot of a device |

### 3.3 The reznikov "System check" sequence (F1 territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f56–114** · 0:01–0:02 · assistant HUD over a monitor, summoned by a hand | An ambient, always-available assistant surface overlays the working environment and can be summoned without opening an app | Zeno needs a summonable HUD/menu-bar surface that never steals focus | **ADAPT** | Free-floating holographic HUD → **docked, edge-anchored tray/menu-bar glass capsule** (Tier-B live-blur, small, short-lived) that never steals typing/selection/IME (DESIGN-MAC-AC-02). Hand-summon → explicit hotkey/wake/PTT with a visible armed state (F7) | Zeno assistant HUD · Command **G1** Status Rail + **G3** chat · asleep→waking→listening | Med (Jarvis-HUD trope) → mitigated by docking + opacity discipline | Tier-B glass only; settled surface stops rendering; Reduce-Transparency toggle → solid |
| **23A f115–174** · 0:02–0:03 · populated map collapses toward a dark reset | A busy state can be visibly *cleared back to a calm baseline* as a dismissal / end-of-task transition | Zeno needs a truthful "returning to idle/asleep" transition | **ADAPT** | Dramatic implosion → **bounded, interruptible dim-to-idle** mapping to the real state (executing→success→asleep, or paused); settled surface then stops rendering | Zeno assistant idle · Command idle/safe-mode · success→asleep / paused | Low | Reduced-motion → opacity-only cross-fade, no z-translation; interruptible |
| **23A f175–249** · 0:03–0:04 · near-black reset, cyan bloom, thin yellow ring ignition | A system "wakes" by igniting a signature form from black | Wake ceremony needs a signature *without* the forbidden geometry | **REJECT** (F1) | Cyan bloom + igniting halo is the forbidden silhouette. Salvaged wake-ignition lesson → Axis I wake ceremony using an **original primitive** (never a sphere or halo), and never gold-as-status | → routed to 23A f1386–1798 brand primitive + Axis I | **Critical** if copied | Ring-glow ≠ focus (WCAG 2.4.13 Note 1); no idle rotation |
| **23A f250–396** · 0:04–0:07 · concentric rings thicken; cyan core; left checklist; radial traces | While waking, a system displays a **running self-inventory** (a checklist) beside its core | Zeno must show boot/permission/health enumeration truthfully | **REJECT** (F1) | Concentric-ring core + radial traces rejected. The *left checklist* is the real value → becomes the list-first inventory below (R6) and the **Capability/OAuth/Permission Explorer** | → Command **K5** Explorer, **D4** Diagnostics · retrieving | **Critical** | Radial label rings are keyboard/SR hostile → list is native |
| **23A f397–1115** · 0:07–0:19 · capability/agent nodes construct around the core; circuit paths, particles | Capabilities/agents can be shown *assembling* around a centre as the system comes online | Command needs to show which agents/tools/connectors are available and healthy | **REJECT** (F1) | "Nodes constructing around a core" is the forbidden radial build. Salvaged: capability enumeration → **W3 Agents list + K1/K2 connector/MCP health**, optional node view *over the list* | → Command **W3 / K1 / K2** · loading→degraded | **Critical** | Perpetual particle build violates "no motion without state"; list-first mandatory |
| **23A f1116–1235** · 0:19–0:21 · completion tile "All clear, 12 of 12 checks" | A discrete, **countable, verifiable** completion summary — *N of M passed* | Zeno must show truthful completion — success reflects verified receipts, never fake completion | **ADOPT** | Cinematic tile → **N-of-M health/preflight panel** where each check is an independently inspectable list row with its own receipt and health state. "All clear" renders **only** after every check returns a verified pass; a missing source is `partial`/`degraded`, never hidden | Counsel **J-C1** preflight · Command **D2/D4** · Forge Context-Readiness · success (verified) / degraded / blocked | Low (a checklist is generic) | Each check text+icon (not colour-only); amber/red reserved |
| **23A f1236–1269** · 0:21 · completed / pass state holds over the map | A resting success state persists and stays inspectable | Zeno success states must be durable and dismissable, not a held frame | **ADAPT** | Held cinematic frame → **durable, dismissable receipt chip** (G6) with `as_of` watermark when snapshotted | Command **G6** receipt chips · success→stale | Low | Reprise of R6; no perpetual hold animation |

### 3.4 The textura.eu landing hero (brand-motion territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f1386–1490** · 0:23–0:25 · black hero; blue/violet + red/orange particle membrane | "Motion instead of chrome": one volumetric object carries brand presence on a near-black field | Zeno needs a signature brand/wake object | **ADAPT** | Adopt the *principle* (motion over chrome), reject the *membrane*. Define **one original signature geometry** (Axis A) — not a membrane, sphere, or helix — reserved for brand + wake + high-level topology; bounded surface, pausable, always a 2D fallback | Zeno **Glass** brand/wake · asleep→waking / idle | **High** (textura is a real studio; membrane is distinctive) | 3D opt-in; WebGPU Baseline limited/no-Firefox → 2D fallback; no fps claim (B-002); reduced-motion freezes |
| **23A f1491–1640** · 0:25–0:27 · membrane narrows to hourglass/column, twists to helix; metric callouts | A single object *reshaping* can signify a system reorganizing, with data labels attached | Topology/graph "reframe" moments need a legible reshape motion; brand needs depth | **ADAPT** | Reject the membrane→helix path and its camera move. Reshape motion → a **bounded morph of the original primitive** used only for major transitions; metric callouts → **real, bound labels** or none (F6) | Glass major-transition · Command **C4** topology (secondary to a list) · executing / streaming | **High** | Callouts must be truthful; motion pausable; 2D fallback |
| **23A f1641–1798** · 0:27–0:30 · helix collapses to terrain, then a particle vortex around a black void | A "collapse into a portal" transition builds anticipation before a reveal | Zeno major transitions (e.g., entering a workspace) | **ADAPT** | Vortex/void spectacle → **restrained depth transition** on a bounded surface, luminance-flat, no swirl loop; the "void" reads as calm graphite, not drama | Glass major-transition · executing→success | Med-High | Flash-safe (leads into F5); pausable; settled surface stops rendering |
| **23A f1799–1850** · 0:30–0:31 · WHITE PARTICLE FLASH into a galaxy/accretion-disk hero | A high-energy flash "reveals" the hero | none — this is a safety hazard, not a lesson | **REJECT** (F5) | The flash is discarded outright. Reveal need → **bounded dark cross-dissolve**, luminance delta under the three-flash threshold; reduced-motion → instant cut | Glass major-transition · (all) | **Reject** (safety) | Direct seizure risk (WCAG 2.3.1); the corpus's most dangerous frame |

### 3.5 The GetLayers-style gallery / builder (artifact-retrieval territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f1851–2000** · 0:31–0:33 · dark template gallery; dense thumbnail grid + filters | A dense, **filterable gallery of retrievable artifacts** with thumbnails and facets | Zeno Vault/Library must browse many generated reports, sessions, skills, artifacts | **ADAPT** | Glass gallery → **near-opaque reading-plane grid that is a view over a first-class list/table** (list primary); filters are real facets; thumbnails optional | Command **W4** Library · Vault **P3** · **K3** skill registry · empty/loading/streaming/degraded | Low-Med (gallery is generic) | Grid must have list equivalent; thumbnails need alt text; content layer is not glass |
| **23A f2001–2135** · 0:33–0:36 · "New Era" detail card; Premium/Commercial-licence badges; tech tags | A per-artifact **detail/inspector** showing metadata, **licence/rights badges**, and tags | Zeno's licensing discipline (four-column rule) and artifact provenance need surfacing | **ADAPT** | Marketing "Premium" badges → **truthful rights/provenance chips** (four-column licence record, §2.5) + data-zone/sensitivity labels; tags become real facets | Vault artifact detail · Command **S8** notices · **K4** model-licence compat · default/stale | Low | Badges text+icon (not colour-only); 4.5:1 on opaque plane |
| **23A f2136–2214** · 0:36–0:37 · dark AI-builder surface; a prompt is pasted into a builder | A **composer that accepts pasted context and hands off** to a generation/build step | Zeno composer → plan → build handoff | **ADAPT** | Immediate "build" → **plan-then-confirm**: composer is an opaque reading plane with **context & egress receipt chips** (G6) showing exactly what will be sent; paste is sanitized/quarantined (raw never auto-used) | Command **G3** composer · Forge **J-F2** handoff · planning→awaiting-approval | Low | Composer keyboard parity; receipts have accessible names |

### 3.6 The bennett.spooner "AI Agent Company" (F2 / F4 territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f2285–2403** · 0:38–0:40 · "27 AI Agent Company" OPTIMAL ENGINE; circular topology opens | An org of many agents can be entered from a single "engine" overview | Command must present the whole multi-agent system without a company metaphor | **REJECT** (F2) | Circular "engine" topology rejected. Overview need → **W2 Tasks & Runs + W3 Agents lists**; a topology may exist only as a *view over* those lists | → Command **W2 / W3** · streaming | **Critical** | Free-canvas primary surface prohibited (WCAG 2.1.1) |
| **23A f2404–2870** · 0:40–0:48 · department DAGs (Sales, Finances, Clients, Marketing, Tech, Comms) | Work per domain can be shown as a **pipeline/DAG**; domains are first-class | Zeno shows per-project/agent pipelines of work | **REJECT** (F2 + F4) | Department rings + **Sales=red** rejected. DAG value → **W2.1 Run Detail dependency list** + optional DAG over the same data; domains carry a neutral accent, red stays reserved | → Command **W2.1 / D1** · streaming/degraded | **Critical** | DAG must have list equivalent; red is meaning, not identity |
| **23A f2871–3170** · 0:48–0:53 · focused communications pipeline; a tall Slack-agent inspector | Zooming from the org to **one agent's inspector** (a focused pipeline) | Command W3 needs a per-agent inspector reachable from the list | **ADAPT** | Keep the drill-down *pattern*, drop the department pipeline. Inspector → **opaque reading-plane panel** opened from the W3 list | Command **W3** agent detail · default | Low (an inspector is generic) | Long text on opaque plane, 4.5:1 |
| **23A f3171–3224** · 0:53–0:54 · inspector fields: autonomy, skills, dependencies, human role, SOP | A single agent's **spec** — autonomy, skills, dependencies, human-in-loop role, procedure | Command W3 agent detail; K3 skills; approval tiers | **ADAPT** | "Autonomy" slider → the real **approval-tier model (T0–T4)** that cannot escalate past a user denylist; fictional "SOP" → linked real config (scopes, leases, budgets, escalation, skills) | Command **W3 / K3 / A3** · default/approval | Low | Typed permissions, not a free "auto" control |
| **23A f3225–3727** · 0:54–1:02 · global multi-ring company graph; dense network around an orange/red core | A whole-system network view centred on a glowing core | Command needs a system-wide relationship view | **REJECT** (F2) | Orange/red core + concentric rings rejected. Need → **C4 Knowledge & Graph as a secondary view over a first-class list**; no central brain; single neutral accent | → Command **C4** · loading/streaming | **Critical** | List equivalent mandatory; core-glow removed |
| **23A f3728–3830** · 1:02–1:04 · the global graph reframes; ingestion / search / filter surfaces | A large graph plus **ingestion + search + filter** controls over it | Zeno search/filter over agents, runs, knowledge | **ADAPT** | Search/filter are **first-class list operations** (G2 launcher, C1/C4 filters); the "reframe" is a bounded camera move on the *secondary* graph only, pausable | Command **G2 / C4** · loading/streaming | Low-Med | Search returns a list; graph motion pausable |
| **23A f3831–4167** · 1:04–1:10 · horizontal department carousel replay | A horizontal **carousel** paging through domains | Zeno sectioning across Today/Work domains | **ADAPT** | Carousel demoted — it hides items and is weak for keyboard/SR. → **paged/filterable list or tab set**; a carousel may exist only as a secondary view with visible pagination + keyboard support | Command **Today / Work** sectioning · default | Low | Carousel is an anti-pattern → list/tabs primary |

### 3.7 The stable "Tech" topology and agent specs

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f4168–4415** · 1:10–1:14 · stable Tech topology; tool/source nodes, worker nodes, dotted fan-in | Tools/sources **fan in** to worker agents — a dependency topology of who-feeds-whom | Zeno must show a run's dependency graph (which tools/MCP/sources feed which workers) | **ADAPT** | Dependency shown **primarily as a list/table** (W2.1 dependencies) with optional DAG over the same data; MCP/tool nodes → **K2 hash-pinned manifests**; dotted fan-in → typed, labelled edges | Command **W2.1 / D1 / K2** · streaming/degraded | Low-Med | List equivalent mandatory; edge labels accessible |
| **23A f4416–5374** · 1:14–1:30 · tech-agent inspector scrolls a knowledge-health agent specification | A long, **scrollable agent/knowledge-health specification** | Command W3 + Vault knowledge verification | **ADAPT** | Knowledge-health → real **C4 verification-state per item + freshness** on an opaque reading plane; spec is bound to config, not fiction | Command **C4 / W3** · default/degraded/stale | Low | Long-form reading plane, 4.5:1; no glass under text |
| **23A f5375–6031** · 1:30–1:41 · personas editor: editable traits left, colour-linked persona graph right | A **split editor** — editable attributes left, a live linked visualization right, colour linking the two | Zeno config/agent-profile editing with a live preview | **ADAPT** | Two-pane editor (**form/list left = primary, preview right = secondary over the same data**); colour *links* an item to its glyph but is never the sole status channel and never maps a reserved semantic. "Personas" → **agent profiles/config** (K3/S1), never synthetic human personas (Counsel forbids trait inference) | Command **S1 / K3 / K7** editor · default/approval | Low | Colour-link needs a non-colour pairing (label/number); edits approval-governed where consequential |

### 3.8 The dashboards (analytics / funnel / finance)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f6032–6202** · 1:41–1:43 · social analytics: KPI cards, time-series, donut, content table | An analytics dashboard: **KPI stat tiles + time-series + donut + backing table** | Command D2 eval dashboards; budgets/quality; run metrics | **ADAPT** | Charts on a **near-opaque reading plane** (data is content, not glass); **every chart has an accessible data table (the table is primary)**; metrics are real evals (coding/retrieval/voice/…), never fabricated (F6); donut avoids tiny-slice ambiguity with labels | Command **D2 / S4** · empty/loading/degraded | Low | Charts need table equivalents + non-colour encoding; dataviz contrast ≥3:1 |
| **23A f6203–6540** · 1:43–1:49 · funnel page: stage circles, a route, moving particles, detail table | A **staged pipeline/funnel** with a flowing route and a backing detail table | Zeno's approval/outbox pipeline; a run's stage progression | **ADAPT** | Stages → a **stepper/list bound to real states** (S01–S28, or A2 outbox stages); "moving particles" removed as decorative, or replaced by one bounded progress indicator mapping to a real in-flight action; detail table primary | Command **A2** Outbox · **W2.1** stepper · streaming/outcome-unknown | Low | No perpetual motion; stepper is a list; outcome-unknown never auto-retries |
| **23A f6541–6630** · 1:49–1:51 · finances dashboard: KPI strip, donut, bars, import, account cards | A finance dashboard with import and account cards | Zeno is **not** a finance app (trades/advice prohibited); the transferable bit is a *budget* dashboard | **ADAPT** | Re-scope entirely: KPI-strip + bars → **Budgets** (time/cost/action per agent/workflow, S4) and cost/latency comparison (K4). **No money movement, no account cards, no financial advice** | Command **S4 / K4** · default/degraded | Low | Same as R25; explicitly not a trading surface |

### 3.9 Agent hierarchy, coding workspace, radial reprise

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f6631–7159** · 1:51–1:59 · Agent Hierarchy: operator → Conductor → departmental agent cards | An explicit **orchestration hierarchy**: human operator → orchestrator → sub-agents | Zeno's multi-agent coordination (Orchestrator/"Conductor", one active executor) | **ADAPT** | Hierarchy → an **indented list/tree (primary)** with optional org-chart view; the owner sits at top holding the kill switch; "Conductor" = the Orchestrator event-log authority; **exactly one active executor per non-idempotent action is visible** (Mesh). No department metaphor | Command **W3 / W2 / G4** · streaming/approval | Low-Med | Tree with keyboard nav, not free canvas; kill switch always operable |
| **23A f7232–7387** · 2:01–2:03 · dark coding workspace: Workspaces/Tasks/Pull requests, log pane, resume | A coding-agent workspace: **task/PR list + log pane + resume** | Zeno Forge workspace + Command W5 | **ADOPT** | Convergent pattern Zeno already mandates, rendered original: **near-opaque reading planes for code/diff/log** (never glass); **resumable embedded Forge** (P1); the **Observable Execution Stream** is the canonical streaming surface — reconnect-safe, gap markers, never hidden chain-of-thought. Do not copy any specific IDE's chrome | Command **P1 / W2.1 / W5** · streaming/error/degraded | Low (IDE tropes generic) | Code planes 4.5:1; focus a real outline; stream reconnect-safe |
| **23A f7388–7506** · 2:03–2:05 · return to the concentric radial agent map; a hand points at the core | Returning to a "home" overview; pointing selects the centre | Zeno "home"/overview navigation and selection | **REJECT** (F1 + F7) | Radial map rejected (F1); "hand points at core" → selection is **keyboard/pointer/explicit**, gesture never authorizes (F7). Home need → **Command G3 chat + T1 Today** as the real home | → Command **G3 / T1** | **Critical** | Gesture never sole input; keyboard parity |

### 3.10 The builtbyruturaj "NEXUS" carousel (F3 territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f7597–7642** · 2:07–2:08 · NEXUS "Intel/Audio/System" cards hold | A **glanceable multi-domain dashboard** of status tiles (domains = Intel, System, Markets, Calendar, Weather, Cognition…) | Zeno's morning briefing / at-a-glance status across the owner's real sources | **REJECT** (F3) | Three tilted smoked-glass cards on a curved rail rejected. Value → **Today & Attention Center**: threaded, deduplicated, **list-first**, per-source coverage + age + why-now; flat non-tilted tiles at most, on a reading plane; domains = the owner's real sources (Jira/Slack/calendar/CI), never "Markets/Sports" | → Command **T1 / T2** · empty/loading/streaming/degraded | **Critical** (reel signature) | Tilt + carousel removed (keyboard/SR, no glass-on-glass); coverage banner is text |
| **23A f7643–7702** · 2:08–2:09 · curved carousel transition, lateral arcs | Lateral **arc transitions** move between card sets | (decorative paging) | **REJECT** (F3) | Curved-rail transition discarded; paging is a plain tab/list change | → subsumed by T1 | **Critical** | Motion without state; hides items |
| **23A f7703–7942** · 2:09–2:13 · System/Social/Markets cards hold | (reprise of the NEXUS tile-set) | same as f7597 | **REJECT** (F3) | Reprise — same transformation as 23A f7597 (list-first Attention Center) | → Command **T1** | **Critical** | as above |
| **23A f7943–7972** · 2:13 · carousel transition | (decorative paging) | — | **REJECT** (F3) | Reprise of the transition rejection | → subsumed by T1 | **Critical** | as above |
| **23A f7973–8316** · 2:13–2:19 · Markets/Projects/Sports cards hold | (reprise of the NEXUS tile-set) | same | **REJECT** (F3) | Reprise — list-first Attention Center | → Command **T1** | **Critical** | as above |
| **23A f8317–8346** · 2:19 · carousel transition | (decorative paging) | — | **REJECT** (F3) | Reprise | → subsumed by T1 | **Critical** | as above |
| **23A f8347–8706** · 2:19–2:25 · Calendar/Weather/Cognition cards hold | (reprise of the NEXUS tile-set) | same | **REJECT** (F3) | Reprise — list-first Attention Center | → Command **T1** | **Critical** | as above |
| **23A f8707–8736** · 2:25 · carousel transition | (decorative paging) | — | **REJECT** (F3) | Reprise | → subsumed by T1 | **Critical** | as above |
| **23A f8737–8841** · 2:25–2:28 · Markets/Projects/Sports return | (reprise; the loop closes) | same | **REJECT** (F3) | Reprise — list-first Attention Center | → Command **T1** | **Critical** | as above |

### 3.11 Closing assistant-face / gesture / multi-monitor clips

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **23A f8940–9011** · 2:29–2:30 · reznikov "Apex"; blue/yellow radial assistant face | An assistant can have a **face/avatar** presence | Zeno's optional avatar ("Strategic Cortex") | **REJECT** (F1) | Radial "face" rejected. Avatar need → **Command Strategic Cortex is roadmap, optional, disableable, driven only by real inspectable state**, and never appears in Counsel's overlay, approvals, payments, errors or secure fields | → Command Strategic Cortex (roadmap) | **Critical** | Never a status channel; fully disableable |
| **23A f9118–9356** · 2:32–2:36 · sagar_builds two-hand gesture framing a cyan orb into a particle field | A deliberate **two-hand gesture "summons"** an assistant object | Zeno wake/summon ceremony | **REJECT** (F7 + F1) | Cyan orb (F1) and gesture-as-control (F7) rejected. Summon → **hotkey/wake/double-clap with a visible armed indicator**; gesture is roadmap only, armed/clutch, local landmark processing, auto-disarm over credentials/payments/approvals, never authentication | → Zeno wake · Command **K6** · asleep→waking | **Critical** | Gesture never sole input; keyboard parity |
| **23A f9427–9529** · 2:37–2:39 · lukebuildsai multi-monitor Jarvis reveal; a persistent upper blue orb + telemetry | A **persistent corner assistant indicator** across multiple monitors, with live readouts | Zeno's persistent status presence + multi-device/monitor awareness | **ADAPT** | Orb + fabricated telemetry rejected (F1/F6). Indicator → the **docked Status Rail / menu-bar glyph** showing *real* device/mic/capture/model/network/privacy state; multi-monitor → **Mesh device fleet / handoff**, per-device state truthful | Command **G1** · **K6** Device Fleet · Mesh · default/degraded/offline | Med (Jarvis trope) → mitigated by docking + truthful state | Status text+icon (not colour-only); no fabricated numbers (B-002) |

---

## 4. Matrix — Compilation 24-Aug (21 ranges)

### 4.1 Grouped navigation / grid chrome — REJECT

> **24A-NAV** covers f0–42 (0:00 profile/nav), f43–239 (0:01–0:04 settings/activity nav),
> f240–393 (0:04–0:07 Saved grid), f3926–3985 (1:05 Saved grid), f6483–6638 (1:48–1:51 Saved grid),
> f7884–8064 (2:11–2:14 Saved grid / end).
> **Principle:** none of design value — Instagram navigation and creator sign-off frames.
> **Disposition: REJECT.** No Zeno destination; trade-dress n/a.

### 4.2 The sagar_builds "Ultron" device-control sequence (review-critical; F6/F7 territory)

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **24A f394–1649** · 0:07–0:27 · a phone call labelled "Ultron"; cyan spherical HUDs; "SYSTEM LOCKED" then amber | (a) a **voice/phone channel** to the assistant; (b) device **lock state** shown by a colour shift (locked → amber) | Zeno J-A6 "call the assistant"; device lock/presence state; amber = warning | **ADAPT** | Adopt call + lock-state signalling; reject voice-as-authorization + the cyan sphere + the hostile-AI "Ultron" framing. Call surface = **spoken briefing + T0 only**; every T2/T3 moves to a paired signed-app UI (T3 adds a fresh device factor) — spoken confirmation is never sufficient (F7). "LOCKED→amber" uses amber correctly, but "locked" is a **real device/privacy state on the Status Rail**; remote control cannot approve OS prompts, enter secure fields, or act on a locked target | Zeno **J-A6** · Command **G1** (lock/privacy) · Mesh signed commands · listening/awaiting-approval/blocked | **High** (Ultron/Jarvis + orb) → reject sphere + naming | Lock state text+icon; amber not the sole channel |
| **24A f1650–3125** · 0:28–0:52 · three phones side by side; captions "unlock all devices" / "all three unlocked" | A single command **fans out to many devices** with a collective success state | Zeno Mesh multi-target action | **ADAPT** | Reject the group "all unlocked" success animation + voice unlock. Multi-target request **previews every device** (acting account, lock/presence/privacy state, action, risk, expected effect), allows deselection, issues **separate idempotency keys**, returns **signed per-device receipts**; one target's failure can never be hidden by a group-level success (LINK-AC-04); cannot act on a locked target | Command **K6** Device Fleet · **W2** (one active executor per non-idempotent action) · Mesh · approval→streaming→per-device success/blocked/outcome-unknown | Low (concept) — mainly a truthfulness correction | Per-device list; no colour-only; no fake collective completion |
| **24A f3126–3925** · 0:52–1:05 · monitor/laptop changes from a HUD to a bright desktop; "desktop visible again" | A **privacy/handoff toggle** — switching a display between an assistant overlay and the normal desktop | Zeno privacy defaults (locked/shared/untrusted display), Counsel overlay visibility, Mesh handoff | **ADAPT** | HUD→desktop "reveal" → a **truthful privacy/overlay-visibility state**: on locked/external/shared displays the surface defaults to generic "Approval needed" with no content (SAN-AC-06); Counsel overlay warns it may still be visible and fails closed when privacy is unverifiable; Mesh handoff shows source/target state. "Desktop visible again" is a real capture indicator, not an effect | Zeno privacy defaults · Counsel overlay preflight · Command **G1** privacy zone · Mesh handoff · default/degraded/safe-mode | Low | Privacy state must be unmistakable text |

### 4.3 The textura.eu / GetLayers / builder repeats

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **24A f3986–4469** · 1:06–1:15 · textura "Motion instead of chrome"; a volumetric mesh/particle object | "Motion instead of chrome": a volumetric object as brand hero rather than heavy UI | Zeno brand/wake signature | **ADAPT** | Reprise of 23A f1386 — adopt the principle, choose **one original primitive** (Axis A), never reproduce textura's mesh or camera path; the principle is ideal for the **wake ceremony** but must honour reduced-motion + no-flash + settled-surfaces-stop-rendering | Glass brand/wake · asleep→waking/idle | **High** (real studio) | Opt-in 3D; 2D fallback; no fps claim |
| **24A f4470–4739** · 1:15–1:19 · GetLayers gallery browsed; a design is selected | Browse a filterable artifact gallery, then **select** one | Zeno Vault/Library browse + launcher selection | **ADAPT** | Reprise of 23A f1851 — list-first artifact gallery on an opaque plane; select via launcher/palette | Command **W4 / G2** · loading/streaming | Low-Med | List equivalent; alt text |
| **24A f4740–4825** · 1:19–1:20 · "Vesper" detail: prompt/source actions, tags, licence-like badges | Per-artifact **detail** with prompt + source + tags + rights badges | Zeno provenance + licensing surfacing | **ADAPT** | Reprise of 23A f2001 — provenance/rights detail, four-column licence, data-zone tags; avoid the "Vesper" name/styling | Vault detail · Command **S8** · default/stale | Low | Text+icon badges |
| **24A f4826–4922** · 1:20–1:22 · selected text is pasted into an AI builder | **Paste selected context → hand off** to a builder | Zeno composer/handoff | **ADAPT** | Reprise of 23A f2136 — sanitized paste + egress receipts + plan-then-confirm | Command **G3** · Forge **J-F2** · planning→awaiting-approval | Low | Composer parity; receipts named |

### 4.4 The dhaibuilds "Jarvis / Fable" hexagonal core and the assistant home

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **24A f4923–5835** · 1:22–1:37 · "Build Jarvis with Fable"; a hexagonal core whose colour shifts blue→violet→red across states | A central object whose **colour state signifies agent state** | Zeno's per-state motion/colour grammar (asleep/listening/planning/executing/blocked/error) | **ADAPT** | Reject the central "core" object + red-as-arbitrary-state + hexagon-as-primary. Define a **state grammar** (Axis H) where each real state has a distinct **non-colour-only** signature (motion + shape + label); semantic colour stays reserved — **red appears only for blocked/error/destructive**, never as a neutral "state 3". The indicator is the small Status-Rail/agent-state chip, not a central core | Glass motion/state grammar · Command **G3** agent-state · **G1** · (all twelve states) | Med (hex core is common) → not central, not sole-colour | State never colour-only; reduced-motion variants per state |
| **24A f5836–6482** · 1:37–1:48 · a Claude Design-like surface resolves to a dark assistant home; composer, model selector, scheduled task | A clean **assistant home**: composer + model/effort selector + a scheduled-task affordance | Command G3 main chat + K4 models + A3 scheduler | **ADOPT** | Convergent assistant-home pattern, rendered original and **explicitly divergent from Claude Design's own chrome** (take architecture, generate values — L5 §7.4). Composer carries context+egress chips (G6); model/effort selector maps to **K4** (local/cloud, licence/hardware compat, egress controls); "scheduled task" maps to **A3** where standing consent covers only scoped T0/T1 and every external effect still gets a fresh T2/T3 | Command **G3 / K4 / A3** · default/planning/approval | **High** ("Claude Design-like") → must diverge | Composer keyboard parity; opaque reading plane |

### 4.5 The reznikov clap + second textura hero + generated preview

| Range | Observed abstract principle | Zeno problem | Disp. | Transformation → original | Destination | Trade-dress | A11y / perf |
|---|---|---|---|---|---|---|---|
| **24A f6639–7097** · 1:51–1:58 · a clap-like event, then a "System check" radial-roles sequence | A **clap (acoustic) event triggers a wake** + a system self-check with roles | Zeno wake (configurable double clap) + preflight/health | **ADAPT** | Adopt the **double-clap wake** (shipped tier) with a RAM-only ring buffer erased on no-trigger and a visible mode indicator; reject the radial-roles composition (F1) → list-first capability/health inventory (23A f1116/K5) | Zeno wake · Command **K6** (clap sensitivity) · **D4/K5** · asleep→waking→listening | **High** (radial) → reject | Clap is one of several wake modes, never sole input |
| **24A f7098–7568** · 1:58–2:06 · second textura editorial hero; red/blue particle membrane; ribbon/horizon/torus | More brand primitives (ribbon, horizon, torus) morphing on a dark field | Zeno brand/wake object vocabulary | **ADAPT** | Reprise of 23A f1386/f1491 — pick **one** original primitive; reject the specific membrane/ribbon/horizon/torus sequence and camera path | Glass brand/wake · idle/major-transition | **High** | One primitive; pausable; 2D fallback |
| **24A f7569–7624** · 2:06–2:07 · dense particles collapse into a black-hole/galaxy transition | A "collapse/implosion" transition into a hero | Zeno major transitions | **ADAPT** | Reprise of 23A f1641, with a hard flash guard (near F5): **bounded, reduced-motion-safe** transition; no white flash; settled surface stops rendering | Glass major-transition · executing→success | Med | Flash-safe; pausable; 2D fallback |
| **24A f7625–7683** · 2:07–2:08 · GetLayers-style gallery | (reprise of the gallery) | Vault/Library browse | **ADAPT** | Reprise of 23A f1851 / 24A f4470 — list-first artifact gallery | Command **W4** · loading/streaming | Low-Med | List equivalent |
| **24A f7684–7805** · 2:08–2:10 · "New Era" prompt/detail; transfer to an AI builder | (reprise of detail → builder handoff) | provenance detail + composer handoff | **ADAPT** | Reprise of 23A f2001 + f2136 — rights/provenance detail; sanitized paste + plan-then-confirm | Vault detail · Command **G3** · default→planning | Low | as prior |
| **24A f7806–7883** · 2:10–2:11 · a generated red/blue particle landing-page preview | A **live preview of a generated output** | Zeno artifact preview (Forge/Command) | **ADAPT** | Preview pane is a **secondary view over the real generated artifact**, with provenance; the red/blue particle decoration is not adopted; a preview **never claims completion before the artifact is verified** (truthful state) | Forge/Command artifact preview · **W2.1** · streaming/success(verified) | Low | Preview has a text/data equivalent |

---

## 5. Coverage ledger — all 75 ranges accounted for

**23-Aug (54):** REJECT-nav = f0–25, f26–55, f1270–1325, f1326–1385, f2215–2229, f2230–2284,
f7507–7596, f8842–8860, f8861–8939, f9012–9117, f9357–9426 (11). REJECT-environmental = f7160–7231 (1).
REJECT-forbidden/decorative = f175–249, f250–396, f397–1115, f1799–1850, f2285–2403, f2404–2870,
f3225–3727, f7388–7506, f7597–7642, f7643–7702, f7703–7942, f7943–7972, f7973–8316, f8317–8346,
f8347–8706, f8707–8736, f8737–8841, f8940–9011, f9118–9356 (19). ADOPT = f1116–1235, f7232–7387 (2).
ADAPT = f56–114, f115–174, f1236–1269, f1386–1490, f1491–1640, f1641–1798, f1851–2000, f2001–2135,
f2136–2214, f2871–3170, f3171–3224, f3728–3830, f3831–4167, f4168–4415, f4416–5374, f5375–6031,
f6032–6202, f6203–6540, f6541–6630, f6631–7159, f9427–9529 (21). **Total 11+1+19+2+21 = 54 ✓**

**24-Aug (21):** REJECT-nav = f0–42, f43–239, f240–393, f3926–3985, f6483–6638, f7884–8064 (6).
ADOPT = f5836–6482 (1). ADAPT = f394–1649, f1650–3125, f3126–3925, f3986–4469, f4470–4739,
f4740–4825, f4826–4922, f4923–5835, f6639–7097, f7098–7568, f7569–7624, f7625–7683, f7684–7805,
f7806–7883 (14). **Total 6+1+14 = 21 ✓**

**Grand total.** ADOPT = 23A f1116–1235, 23A f7232–7387, 24A f5836–6482 = **3**;
ADAPT = 21 + 14 = **35**; REJECT = 31 (23-Aug: 11 nav + 1 environmental + 19 forbidden/decorative)
+ 6 (24-Aug nav) = **37**. **3 + 35 + 37 = 75 ✓.** Transferable-lesson total (ADOPT + ADAPT) = **38**.

---

## 6. Morphological Axes — what the divergence lab permutes

These are the **independent** design axes the Phase-0B divergence lab may combine freely to
generate candidate directions. Independence is the point: a direction is a *tuple*, one choice
per axis, and no single axis choice may reconstruct a reel composition. Every combination must
still satisfy the invariants (dark-first graphite; **≤3 depth layers**, glass only on
nav/controls/overlay/agent-state/wake; **list-primary** everywhere; WCAG 2.2 AA; truthful state;
semantic colour reserved; 2D/no-GPU fallback; reduced-motion + reduced-transparency honoured).

| Axis | What it controls | Independent options to permute (all original; none reproduces a reel) |
|---|---|---|
| **A · Signature geometry** | The one 3D brand/wake/topology primitive | A1 faceted graphite monolith · A2 layered depth-planes (parallax slabs) · A3 a lattice/mesh field with no centre · A4 a folded-ribbon *not* on the textura path · A5 **no hero object** (typographic/luminance brand only). *Forbidden: sphere, full halo, membrane→helix, hex core, orb.* |
| **B · Information architecture** | The top-level navigational spine | B1 section→view→detail (the current Command tree) · B2 verb-first launcher-primary · B3 timeline/attention-primary (Today is home) · B4 object-primary (agents/runs/artifacts as the spine). *All cap depth at 3; all list-first.* |
| **C · Spatial depth** | How the three layers are used | C1 flat reading planes + a single floating control layer · C2 tray/menu-bar-anchored glass + opaque body · C3 modal-overlay depth only (HUD appears on demand) · C4 sidebar-rail depth. *Never glass-on-glass; content never on glass.* |
| **D · Panel composition** | How a view is partitioned | D1 single-column list · D2 list + inspector (master/detail) · D3 three-pane (nav/list/detail) · D4 split editor (form left / secondary preview right). *Secondary view is always over the same data with the same operations.* |
| **E · Material opacity** | The translucency budget | E1 near-solid everywhere (Reduce-Transparency default) · E2 Mica-class static-sample base + small Tier-B live-blur controls · E3 opaque body + translucent transient surfaces (menus/palette/HUD) only. *Accent colour never as text on translucency; scrim required on the clearest variant.* |
| **F · Typography / density** | Reading rhythm and information density | F1 editorial/low-density (briefings, Counsel) · F2 operational/high-density (Command W-views, diagnostics) · F3 code-optimised mono-forward (Forge). *Independently licensed type only — no Apple system fonts/symbols anywhere, mock-ups included.* |
| **G · Topology treatment** | How any graph/DAG/network is rendered | G1 list/tree only (no canvas) · G2 list-primary + optional read-only node overlay · G3 list-primary + interactive node view with full keyboard parity. *Free-canvas node editor as the primary surface is prohibited (WCAG 2.1.1).* |
| **H · Motion / state grammar** | The mapping of the twelve states to signatures | H1 motion-forward (each state a distinct bounded motion) · H2 shape/iconography-forward (motion minimal) · H3 luminance/opacity-forward. *Every animation maps to exactly one real state; success never precedes a verified receipt; semantic colour reserved; reduced-motion variant per state; no perpetual loops; no flash.* |
| **I · Wake ceremony** | The asleep→waking→listening entrance | I1 luminance bloom from graphite (no ring) · I2 the signature primitive assembling once, then settling to static · I3 edge-in from the docked rail · I4 minimal (indicator + earcon, no 3D). *Trigger is always explicit — hotkey/wake/PTT/double-clap with a visible armed state; gesture/voice never authorize; settled surface stops rendering; a 2D fallback ceremony always exists.* |

**Constraint on permutation.** The lab must reject any tuple that, *read as a whole*, resembles
a reel signature — e.g. {A1-with-a-halo + G-canvas + gold-status} reconstructs F1 and is
inadmissible regardless of the individual choices. Each generated direction ships with its own
2D, high-contrast, reduced-motion and reduced-transparency renderings from the start (never
retrofitted), and asserts performance only as a target to measure (B-002), never as achieved.

---

*End 20 — Reference Transformation & Morphological Matrix. Clean-room: no reel asset, trade
dress, shader, audio, layout or code reproduced; every principle abstracted to text and re-homed
in a Zeno product state or rejected on the record. Not legal clearance.*
