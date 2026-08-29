# Phase 0A Packet — index and canonical companion

**Date:** 2026-08-24 · **Stops at:** the Brand sub-gate (§16.2 item 6) · **Status:** awaiting owner name selection

**Artifact:** *Brand Gate Dossier* — https://claude.ai/code/artifact/13e2ff03-7021-4f5e-b498-105d59bcd6fc (private by default)
This Markdown file plus the artefacts it indexes are the **system of record**. The Artifact is a review surface, never the sole record (ARTIFACT-DOC-AC-01).

## Master-prompt integrity receipt (SUITE-AC-14)

| Field | Value |
|---|---|
| Path | `~/Downloads/personal-ai-suite-claude-code-master-prompt.md` |
| SHA-256 | `d3b5b818e7ad4b5c2785f228059c6b76d076c1a211cbd7680848207bb5ae1dfa` |
| Size / lines | 554,098 bytes / 2,286 lines |
| Sentinels | `## BEGIN PROMPT` line 10 · `## END PROMPT` line 2,286 (final line) |
| Acceptance IDs | **196**, verified four independent ways (regex over §15.1, occurrence count, whole-document extraction with empty `comm -23`, structured table parse) |
| Ingestion | **Complete** |

## §16.2 Phase 0A packet — item-by-item

| # | Required item | Delivered in | State |
|---|---|---|---|
| 1 | Confirmed scope, answers, assumptions, unknowns, decisions | `00-DECISIONS.md`, `01-workspace-context-scope-record.md`, `04-assumptions-contradictions-unknowns.md` | complete |
| 2 | Context/Data Source Manifest + minimum bootstrap request | `03a-context-bootstrap-report.md` (5 loaded / 24 discoverable-not-read / 6 unavailable / 11 user-must-supply, plus the Human Data Request Manifest) | complete |
| 3 | Requirement ledger, acceptance matrix and conflicts | `ledgers/requirements-traceability-matrix.md`, `ledgers/acceptance-criteria.csv` (196 rows), `ledgers/requirement-sections.csv`, `02-conflict-and-disposition-register.md` (10 entries) | complete — **zero-unmapped assertion satisfied** |
| 4 | Corrections and rejected-pattern register | `03-corrections-log.md` — **32 corrections** in 4 batches | complete |
| 5 | Independent research dossier | `research/L1…L9` (8 lanes + adversarial review), `ledgers/seed-coverage-report.md` + `.csv` (233 rows, zero blank), `research/L6-manifest.json` (474 repos) + `L6-raw/` (10 dated queries), `05-video-evidence-manifest.md`, `video-evidence/LEDGER-ASSERTIONS.md` | complete — see caveats below |
| 6 | Brand Gate shortlist and **stop** | `06-brand-gate-report.md`, `research/L7a`, `L7b`, `L7c` | **awaiting owner selection** |

## Artefact index

| File | What it holds |
|---|---|
| `00-DECISIONS.md` | Decision log, answered blockers, session-limit interruption record |
| `01-workspace-context-scope-record.md` | Scope record v1 — sources, devices, purposes, providers, retention, exclusions |
| `02-conflict-and-disposition-register.md` | 10 conflicts with safe dispositions and acknowledgment points |
| `03-corrections-log.md` | 32 corrections: verified / corroborated / overturned / method |
| `03a-context-bootstrap-report.md` | Context inventory by class + Human Data Request Manifest |
| `03b-existing-knowledge-systems-report.md` | Graphify audit, 10 BLOCKED items, reuse verdict |
| `04-assumptions-contradictions-unknowns.md` | 8 assumptions, 6 contradictions, 9 unknowns |
| `05-video-evidence-manifest.md` | Video provenance, integrity, ledger scope, rights and retention |
| `06-brand-gate-report.md` | Six-candidate scoring, vetoes, family renderings, recommendation |
| `ledgers/` | Acceptance criteria, requirement sections, seed coverage, URL inventory |
| `research/` | L1–L9 lane dossiers + L5 adversarial counter-review |
| `video-evidence/` | Frame ledgers, assertions, semantic ranges, reproducible scripts |

## Honest caveats attached to this packet

1. **Seed coverage ≠ research completeness.** 233 rows carry a status and none is blank, but only 121 (52%) are `researched`; 71 are `intentionally-deferred`, 21 `partially-researched`, 17 `inaccessible`. The assertion says the ledger is complete and honest, not that the research is.
2. **RESEARCH-AC-02 is not yet satisfied.** The worker-disagreement log and the baseline-versus-deep-review split are not written. L5 exists and overturned 12 claims, but the formal split does not.
3. **Trademark evidence was nearly abandoned for a wrong reason** (C-024) — and recovering it (`research/L7c-trademark-registers.md`) **raised four of the six risk grades**. TMview proved fully machine-readable and aggregates USPTO/EUIPO/UK IPO/IP India/Madrid, so the CAPTCHA-gated national front-ends never actually blocked the evidence; none were bypassed. Final grades: ZEUS and ATHENA **SEVERE**, ZENO and SENECA **HIGH**, CATO **MODERATE–HIGH**, ARISTO **MODERATE**. **No name grades LOW** — all six carry at least one live or published Class 9 / Class 42 registration. Still preliminary evidence, never clearance.
4. **The capability catalogues are deliberately not populated** — see conflict register #9 and blocker B-002.
5. **Frame ledgers are technical, not semantic.** Every row is `pending-semantic-review`.

## What this packet does not authorize

No repository, no service connection, no private-history ingestion, no spending, no external contact, no production implementation, and no candidate name carried into any identifier or permanent mark. The next step is the owner's explicit family-name selection, or an instruction to widen the field.
