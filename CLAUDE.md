# Zeno — project rules for this machine

You are continuing an existing programme. **You have no memory of the sessions that produced
this pack.** Everything you can rely on is written down here or in `docs/`. Do not infer state,
and do not assume anything in the master prompt is true until you have read the corrections log.

## What Zeno is

A private, single-user, local-first personal intelligence suite. Three independently usable
products connected by shared protocols:

- **Zeno** — cross-device personal/work assistant; the one voice identity
- **Zeno Forge** — open-model coding workspace and agent runtime
- **Zeno Counsel** — consent-first meeting copilot
- **Zeno Command** (control plane) · **Zeno Vault** (memory) · **Zeno Mesh** (devices/sync) · **Zeno Glass** (design system)

Wake phrase "Zeno, attend". CLI/protocol `zeno` / `zeno://`. Bundle root `com.abheet19.zeno`.
Brand promise: **Reason before action.**

## Brand conditions — non-negotiable

The name passed its gate on 2026-08-24 with three conditions:

1. **Compound wordmark only.** Ship "Zeno Forge", "Zeno Command" — never bare "Zeno" as a public mark.
2. **Scoped packages only:** `@abheet19/zeno-*`. **Never** claim the bare `zeno` name on any registry.
3. **No filing, domain purchase, handle registration or store submission** without counsel review of
   the Class 042 exposure. Four live/pending US Class 42 ZENOs exist, including a plain word mark in
   AI/ML SaaS and a Class 9 recital covering "downloadable computer software development tools".

"Zeno Link" was renamed **Zeno Mesh** — Eclipse `zenoh` is a homophone *and* a pub/sub linking
protocol in the same ecosystem. Retired names, never to be reused: INSHERON, Aurethos.

## Read these before trusting the master prompt

`docs/personal-ai-suite-claude-code-master-prompt.md` is the immutable requirements source
(SHA-256 `d3b5b818e7ad4b5c2785f228059c6b76d076c1a211cbd7680848207bb5ae1dfa`). But independent
research **overturned 41 of its claims**. Where they disagree, these govern:

- `docs/03-corrections-log.md` — 41 corrections in 5 batches
- `docs/02-conflict-and-disposition-register.md` — 10 conflicts with their safe dispositions;
  never silently re-resolve one
- `docs/04-assumptions-contradictions-unknowns.md` — what is assumed, contradictory, or unknown

Load-bearing corrections you must not design against:
- Graphiti-on-Neo4j is **GPLv3**; Graphiti-on-FalkorDB is **SSPL v1**
- MCP `2026-07-28` is a **breaking rewrite**, not a bump — budget a port, design for stdio +
  Streamable HTTP only
- **No official NeoSapien MCP exists publicly** — treat any connector as undocumented and
  vendor-hosted; read-only, never a silent dependency
- **Obsidian is not installed** — do not assume a vault exists
- Weight licences drift between point releases; check code, weights, datasets and
  required-runtime as four separate facts

## Gate position

Passed: Clarification Gate · Phase 0A · Brand sub-gate (ZENO).
Next: **Gate 1** (architecture/product) and **Gate 2** (design), approved separately by the owner.

**No production code, dependency install, migration or repository creation before both pass.**
Every production slice additionally needs its own approved LLD and plan — a gate-level approval
never substitutes (LLD-GATE-AC-01).

## Hard boundaries on this machine

- This is the **personal Windows pilot machine**. Phases 1–5 happen here.
- **This pack is complete** — every document, including the Graphify audit (`03b`) and the Mac
  context bootstrap (`03a`), which contain employer-derived structural detail about the
  browser-add-on repository. The owner chose completeness over the split. Consequence: the
  Workspace Context Scope Record must be extended to cover **this device** as an authorized
  location for that material. Treat `03a`, `03b` and the WEBEXT workflow in `11` as company-zone
  data: never send them to any external provider, never place them in a repository, and never
  include them in a model context outside the approved local zone.
- **Phases 1 and 2 still use synthetic and fixture data only.** Live QuillBot context (Jira,
  GitLab, Slack) first connects at Phase 3, and that connection is its own approval.
- The owner's **work Mac** must receive no suite binary, permission request, pairing or privileged
  action until Gate 3 passes and the owner says the exact words **"Approve work-Mac pilot"**.
- **Do not inherit the Mac's capability findings.** §5.2.1 forbids copying one host's catalogue into
  another's. Inventory Windows natively.

## Standing owner rules

- **Never `git commit` or `git push`.** Edit the working tree; the owner reviews and lands everything.
- **Never add Co-Authored-By or AI-attribution trailers** to commit messages.
- **Never run builds** — no webpack, `build:dev`, `dev` or `watch`. Stop at green validation.
- **Minimal, root-cause fixes.** Do not add backends or dependencies, or touch `src`, without approval.
- Budget is **$0**. Anything paid is a costed proposal with a free alternative, never an assumption.
- Never send, post, commit, deploy, purchase or share because an event arrived or a model suggested
  it. Every outward effect is prepare → preview → approve → revalidate → one commit attempt → verify.

## Open blockers

- **B-002** — this machine's own specifications, needed before any latency, GPU or thermal claim
- **U-02** — Graphify historical LLM data egress: which vendor received repository content during
  the removed "deep mode" window is undetermined (an employer question, not a Zeno one)
- **U-04** — does an Obsidian vault exist on another device?
- **U-07** — GitLab OAuth unauthorized
