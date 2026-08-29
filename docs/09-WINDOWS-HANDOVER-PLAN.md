# Windows Handover Plan — moving from the work Mac to the Zeno pilot machine

**Why this document exists.** Every Phase-0 artifact was produced on the **work Mac**. Every Phase 1–5 implementation happens on the **personal Windows machine**. That is a device boundary *and* a data boundary, and the second one is easy to cross by accident.

## 1. The one thing that actually matters

The Windows machine is the owner's **personal** machine. Master prompt §1.2 is explicit: Windows-first "does not authorize employer data on Windows — QuillBot sources remain subject to the Workspace Context Scope Record and sink/provider policies."

So the handover is **not** "copy the folder across." It is a deliberate split.

**The load-bearing fact that makes this easy: Phases 1 and 2 need zero employer data.**

- Phase 1 is the secure foundation plus a read-only voice slice, on synthetic and personal fixtures.
- Phase 2 is the Zeno Forge MVP against **non-sensitive fixture repositories and test accounts**.
- Employer context first appears in **Phase 3**, and only under the scope record.

That means the initial Windows bootstrap can be entirely employer-data-free, and the scope question can be deferred to the point where it is actually a decision rather than an accident.

## 2. The split

### Pack A — Zeno Build Pack (moves to Windows)

Everything needed to build the product. No employer identifiers beyond the owner's own description of their workflow.

| Contents | Size | Why it moves |
|---|---|---|
| `personal-ai-suite-claude-code-master-prompt.md` | 554 KB | The immutable requirements source. Hash-verified on arrival. |
| `06-brand-gate-report.md`, `08-BRAND-DECISION.md` | 42 KB | The brand decision and its conditions |
| `10-PRD`, `12-architecture-and-adrs`, `14-sanitization-gateway` | 386 KB | The Gate 1 design record |
| `13`, `15`, `16`, `17`, `18` (on completion) | ~400 KB | Threat model, cost ledger, model plan, evaluation plan, roadmap |
| `research/L1–L4, L6, L7a–c, L9` | 415 KB | Public web research — no employer content |
| `research/L5-skeptic-review.md` | 63 KB | Adversarial review — 19 employer mentions, all workflow context; review before sending |
| `ledgers/` | 385 KB | Requirements traceability, acceptance criteria, seed coverage |
| `video-evidence/` sources + scripts + `semantic_ranges.json` | 36 MB | Gate 2 design evidence. **Ledgers are regenerated, not copied** — see §4 |
| `02-conflict-and-disposition-register.md`, `03-corrections-log.md`, `04-assumptions` | 29 KB | The safety and correction record — must travel or its rulings get lost |

### Pack B — Work Context Pack (stays on the Mac by default)

| File | Employer identifiers | Disposition |
|---|---|---|
| `03b-existing-knowledge-systems-report.md` | **144** | **Stays.** The Graphify audit: repository structure, node counts, CI job behaviour, commit SHAs. Genuine employer-derived structural detail. Its *conclusions* (adapter-for-report, replace-for-store) travel in the ADR; the audit body does not. |
| `03a-context-bootstrap-report.md` | 59 | **Stays.** Inventories `~/Work` paths and memory-index titles naming WEBEXT tickets. Its Windows equivalent gets regenerated natively anyway. |
| `00-DECISIONS.md`, `01-workspace-context-scope-record.md` | 28 | **Travels redacted** — the scope record must exist on Windows, but with the Jira accountId and site held back until Phase 3. |
| `11-journeys-and-IA` (in progress) | TBD | **Travels redacted for Phases 1–2.** The WEBEXT state machine is only needed at Phase 3. |

Everything else scanned shows QuillBot only as *workflow context the owner themselves described* — not employer IP. It travels.

## 3. Transfer method — owner's choice, nothing is assumed

Ranked by how little they expose:

1. **Direct USB / local disk** — nothing leaves either machine. **Recommended.**
2. **LAN transfer over the private mesh** — no third party, but needs the mesh working before it exists.
3. **A cloud drive already approved** — this sends data to a provider and needs explicit approval per rule 3. None is approved today.
4. **A Git repository** — repository creation is gated behind Gate 1, and a *product* repo is not the right vehicle for a document handover anyway.

**Nothing is transferred until the method is chosen.** The pack is assembled locally with a SHA-256 manifest so the Windows side can prove it arrived intact.

## 4. What gets regenerated instead of copied — and why that is a free test

The two frame ledgers (11.9 MB) are **deterministic outputs** of ffmpeg over two hash-verified source videos. Rather than copying them:

1. Copy only the two source `.mp4` files plus `build_full_ledger.py`, `semantic_ranges.json` and the shell scripts.
2. On Windows, install ffmpeg and re-run the pipeline.
3. **Compare the resulting `frame-ledger.csv` SHA-256 against the Mac's.**

If they match, cross-platform reproducibility is proven for free and VIDEO-AC-02's "retained ledger and generation script/config/version" requirement gains real evidence. If they differ, that is a genuine finding about decoder determinism worth knowing before Gate 2 depends on it.

The same applies to `ledgers/acceptance-criteria.csv` — regenerate from the master prompt and diff.

## 5. Windows environment parity — the bootstrap checklist

Blocked on **B-002** until the specs arrive, but the shape is known:

| Need | Purpose | Notes |
|---|---|---|
| Claude Code for Windows | The agent itself | Fresh install; no session history carries over |
| Git | Everything | — |
| Node LTS + a Python 3.12+ | Toolchains | Versions pinned per repo, not globally assumed |
| ffmpeg | Ledger regeneration | Verify the same major version, or expect digest drift |
| Windows Terminal + PowerShell | The §5.2.2 terminal contract | WSL2 **must not be assumed** — §1.2 says so explicitly |
| A disposable test account/profile | Least-privileged baseline | Non-admin by default |
| Skills folder | `quillbot-lt-conventions`, `lld-artifact` etc. | Copy `~/.claude/skills`; the QuillBot skill is Phase-3 material |

## 6. Claude Code continuity — the part people forget

A fresh Claude Code on Windows has **no memory of this conversation**. Session transcripts are per-machine and there is no supported cross-machine session import. What carries is only what is written down.

The bootstrap pack therefore includes:

- **`CLAUDE.md`** at the pack root — the standing rules, the brand decision, the gate ladder position, the blockers, and an explicit "read the corrections log before trusting the master prompt" instruction.
- **The memory files** — `~/.claude/projects/…/memory/` copied and re-pointed, minus the WEBEXT-ticket entries that belong to Pack B.
- **A first-run instruction** telling the new instance to verify the master-prompt hash, read the corrections log and the conflict register, and re-derive its own context bootstrap natively rather than inheriting the Mac's.

That last point matters: §5.2.1 forbids copying one host's capability findings into another's catalogue. The Windows instance must inventory Windows itself.

## 7. Sequence

1. Finish Phase 0B and pass **Gate 1** and **Gate 2** — still on the Mac, since design work needs no pilot hardware.
2. Owner supplies the **B-002 specifications**.
3. Assemble Pack A locally with its manifest; owner picks the transfer method.
4. Bootstrap Windows; verify the manifest; regenerate the ledgers and diff.
5. Windows Claude Code runs its own native context bootstrap and capability inventory.
6. Phase 1 begins — on Windows, with synthetic fixtures, no employer data.
7. Phase 3 is the point at which the scope record needs a **delta review** to add the Windows device as an authorized location for QuillBot context. That is a decision, and it gets asked then.

## 8. What this plan does not do

It does not transfer anything, create a repository, install software, or send data to any provider. It does not extend the Workspace Context Scope Record to the Windows device — that is a Phase-3 delta review. And it does not touch the work Mac's status: this Mac stays a Phase-0 artifact machine until Gate 3 and the owner's exact sentence.
