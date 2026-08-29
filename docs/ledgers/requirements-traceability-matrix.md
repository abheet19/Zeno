# Requirements Traceability Matrix — Phase 0A skeleton

**Satisfies groundwork for:** SUITE-AC-01, RESEARCH-AC-01
**Produced:** 2026-08-24 · local, read-only worker · no web access, no writes outside `ledgers/`
**Status of every row produced:** `not-started`

## 0. Source of truth

| Property | Value |
|---|---|
| Path | `/Users/abheet.isher/Downloads/personal-ai-suite-claude-code-master-prompt.md` |
| SHA-256 | `d3b5b818e7ad4b5c2785f228059c6b76d076c1a211cbd7680848207bb5ae1dfa` |
| Bytes | 554,098 |
| Lines | 2,286 (`wc -l`; a trailing newline makes a naive `split("\n")` report 2,287 elements — same file, no discrepancy) |
| First sentinel | L1 `# Master Build Prompt for Claude Code — Brand Family Decision Required` |
| Last sentinel | L2286 `## END PROMPT` |

The hash was recomputed at parse time inside the generator and matches the hash supplied in the task. No other copy of the file was read.

## 1. Deliverables

| # | File | Rows |
|---|---|---|
| 1 | `/Users/abheet.isher/Documents/personal-ai-suite-phase0/ledgers/acceptance-criteria.csv` | 196 (one per unique AC ID) |
| 2 | `/Users/abheet.isher/Documents/personal-ai-suite-phase0/ledgers/requirement-sections.csv` | 81 (one per `###`/`####`/`#####` heading in Sections 1–16) |
| 3 | this report | — |

---

## 2. Total AC count and how it was verified

**Result: exactly 196 unique acceptance-criterion IDs. This agrees with the 196 stated in the task.**

Four independent checks were run, all agreeing:

1. **Regex extraction over Section 15.1 only** (source lines 1749–1990) using a full-prefix pattern that keeps multi-segment prefixes intact → **196 unique**.
2. **Occurrence count** in the same range → **196 occurrences**. Every ID appears exactly once; there are no duplicate rows.
3. **Whole-document extraction** → **196 unique**, and `comm -23` between the whole-document set and the 15.1 set is **empty**. No acceptance-criterion ID exists anywhere outside Section 15.1.
4. **Structured table parse** — walking lines 1749–1990, tracking the current `#####` heading, splitting each `|`-delimited row and accepting only cells whose first field fully matches the ID pattern → **196 rows, 196 unique IDs**, asserted in code.

### A parsing trap that was ruled out

A naive pattern such as `[A-Za-z0-9]+-AC-[0-9]+` reports false duplicates because it matches only the **last** prefix segment:

- `WORK-MAC-GATE-AC-01`, `LLD-GATE-AC-01`, `DESIGN-GATE-AC-01` all contain the substring `GATE-AC-01`
- `FORGE-HANDOFF-AC-01` and `AGENT-HANDOFF-AC-01` both contain `HANDOFF-AC-01`
- `COMMAND-AC-01` and `NATURAL-COMMAND-AC-01` both contain `COMMAND-AC-01`
- `WORK-AC-02` also matches inside prose at L18 and L493

The anchored pattern `\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?\b` resolves all of these. **No AC ID was invented, merged, or split.**

---

## 3. Per-group AC distribution

Group = the `#####` subsection heading the row lives under, recorded verbatim in the `group` column.

| Group | Line | ACs |
|---|---:|---:|
| Shared suite | 1755 | 54 |
| Assistant execution, communications, phone, commerce, and Vault | 1832 | 38 |
| Voice identity, adaptation, and video-design evidence | 1894 | 28 |
| Forge coding product | 1946 | 25 |
| QuillBot work intake, NeoSapien MCP, and Forge handoff | 1875 | 14 |
| Design synthesis, macOS, and Artifact gate | 1927 | 14 |
| Personal assistant and Command | 1814 | 13 |
| Counsel meeting product | 1976 | 10 |
| **Total** | | **196** |

---

## 4. Per-product-module distribution

`product_module` is the module that owns the capability, judged from the criterion text and its defining requirement section — **not** from the table it happens to sit in. Where those disagree, the disagreement is disclosed in §7.

| Module | ACs | Share |
|---|---:|---:|
| Assistant | 48 | 24.5% |
| Shared | 46 | 23.5% |
| Forge | 26 | 13.3% |
| Platform | 21 | 10.7% |
| Glass | 21 | 10.7% |
| Command | 15 | 7.7% |
| Counsel | 10 | 5.1% |
| Link | 5 | 2.6% |
| Vault | 4 | 2.0% |
| **Total** | **196** | |

`Platform` covers build-process obligations (ledgers, research, brand, repository bootstrap, video-evidence handling, licensing) rather than a runtime product surface. `Shared` covers cross-cutting runtime services (policy, sanitization, capability broker, memory/state, approvals, outbox, MCP).

---

## 5. Per-phase distribution

**Definition used for `earliest_phase`:** the earliest phase in the Section 14 plan at which work on the criterion must *begin* (first touched), not the phase at which it is finally satisfied. This is stated explicitly because the column is otherwise ambiguous, and it is applied consistently across all 196 rows.

| Phase | ACs | Notes |
|---|---:|---|
| 0A | 19 | Ledgers, research, brand, video evidence, catalogue schemas, scope record |
| 0B | 21 | Design synthesis, Glass system, Gate 2 design contracts |
| 1 | 58 | Windows pilot foundation: voice, policy gateway, sanitization, broker, memory, Command |
| 2 | 30 | Forge MVP, supervised executor, MCP, Obsidian reports |
| 3 | 24 | Real integrations, work intake, classifier, drafts and approvals |
| 4 | 9 | Expanded execution and the broader engineering mission families |
| 5 | 14 | Counsel, diarization, consented speaker profiles |
| 6 | 20 | Work-Mac promotion, Mac-native surfaces, Link, Vault sync |
| 7 | 1 | Travel and commerce commit (ASSIST-AC-07) |
| 8 | **0** | **See §7.1 — no acceptance criterion in 15.1 is scoped to Phase 8** |
| **Total** | **196** | |

### Gate dependency distribution

| Gate | ACs |
|---|---:|
| None | 142 |
| Gate2 (design approval) | 29 |
| WorkMac (explicit "Approve work-Mac pilot") | 12 |
| Gate1 (architecture/product approval) | 7 |
| Gate3 (Windows Pilot Gate) | 2 |
| SliceLLD (per-slice LLD/design approval) | 2 |
| Brand (family-name selection) | 2 |
| **Total** | **196** |

---

## 6. ZERO-UNMAPPED ASSERTION

> **Every one of the 196 acceptance-criterion IDs in Section 15.1 is mapped to at least one requirement section of the master prompt. The count of ACs mapping to no section is ZERO.**

Supporting figures, all produced by the generator and asserted in code:

- 196 / 196 ACs carry at least one **requirement-origin** section link. `unmapped_ac == []`.
- 133 ACs map to exactly one source section and 63 map to two or more, giving **262 requirement-origin links** spread over **58 distinct sections**.
- Every AC additionally carries a **containment** link to the `15.1.x` table heading that physically holds its row, so `linked_ac_ids` across `requirement-sections.csv` accounts for all 196 IDs twice over — once by origin, once by containment (458 links in total).
- The generator hard-fails (`sys.exit(1)`) on an unknown section reference, a duplicate AC ID, an unclassified AC, an over-length summary, or an invalid module/phase/gate enum value. It exited 0.

### Important methodological disclosure

**No acceptance-criterion ID is cited anywhere in the prompt outside Section 15.1.** Check 3 in §2 proves the whole-document ID set and the 15.1 ID set are identical. Therefore the AC → section mapping in `requirement-sections.csv` is **analyst-derived from subject matter**, not read off explicit cross-references in the source. It is defensible and evidence-anchored (see §9 for the concept-location greps used), but it is a judgment layer and should be reviewed by the owner before Gate 1, not treated as extracted fact. The AC IDs, groups, criterion text and evidence text in `acceptance-criteria.csv` **are** extracted fact.

---

## 7. Ambiguous mappings and coverage gaps

Nothing here is unmapped. These are the places where the mapping required a judgment call, or where a *section* has no AC — recorded so a reviewer can overturn them.

### 7.1 Requirement sections with body text but ZERO linked acceptance criteria

These are real coverage gaps in the prompt's own acceptance matrix, not gaps in this ledger.

| Section | Line | Why this matters |
|---|---:|---|
| **1.1 Productization and commercial-readiness boundary** | 89 | Defines private developer preview vs personal release vs commercial/team release, distribution, support, data portability and monetization gating. **No AC in 15.1 tests any of it.** Highest-value gap. |
| **7.4 Deferred visible participant-bot capture mode** | 914 | Explicitly deferred and excluded from MVP, so absence of an AC is consistent by design. Flagged so it is not silently lost. |
| **16.2 Phase 0A/0B output packet sequence** | 2007 | Prescribes the exact contents and order of the Phase 0A and 0B packets. No AC asserts packet completeness or ordering. |
| **4 My work context and required daily workflow** | 191 | Parent narrative; its testable content is carried by 4.1 (12 ACs) and 4.2 (6 ACs). Low risk. |
| **14.a Clarification Gate** | 1608 | Process gate. Nearest coverage is SUITE-AC-14 and 16.1, but no AC tests the Clarification Gate's own constraints (no prototypes, no service connections, no repository). |
| **14.d–14.j (Phases 2, 3, 4, 5, 7, 8)** | 1669–1724 | Phase containers. Their content is tested through the requirement sections instead, which is normal — **except Phase 8**, below. |
| 5, 6, 14, 16 | 299, 633, 1606, 1991 | Container headings with no body text of their own. No action needed. |

**Phase 8 has zero acceptance criteria.** Section 14's Phase 8 mandates performance, accessibility, reliability, security, privacy, licensing, prompt-injection and red-team testing, signed/notarized staged releases, operator runbooks, disaster recovery, the opt-in ecosystem watch, and wake-word false-accept/false-reject testing before the spoken product name is finalised. Several of these are partly reachable through SUITE-AC-09 (licensing), SUITE-AC-12 (recovery), VIDEO-AC-10 / DESIGN-PERF-AC-01 (performance) and SAN-AC-04 (injection), but **no AC covers release signing/notarization, staged rollout, operator runbooks, disaster recovery, the ecosystem watch, or wake-word phonetic testing.** Recommend raising this before Gate 1 as a candidate `RELEASE-AC-*` family.

### 7.2 AC whose defining requirement lives OUTSIDE the Sections 1–16 range

| AC | Issue |
|---|---|
| **BRAND-AC-01** | Its governing requirement is the un-numbered `### Brand Gate — one coherent product family` section at **line 25**, which sits before Section 1 and is therefore outside Deliverable 2's declared scope ("Sections 1 through 16"). It is mapped instead to **14.b**, which restates the Brand sub-gate as Phase 0A item 6. The line-25 section is deliberately **not** added as a row, to honour the stated row rule. Recommend the owner decide whether to widen Deliverable 2 to include the pre-Section-1 material (`## BEGIN PROMPT` L10, `### Brand Gate` L25). |

### 7.3 AC where the containing table and the owning module disagree

| AC | Sits in table | Classified as | Reason |
|---|---|---|---|
| FINE-TUNE-AC-01 | Forge coding product | **Command** | The criterion text literally says "Command's Model/Evaluation Lab implements…". Origin section 6.4. |
| VIDEO-AC-06 | Voice identity / video-design evidence | **Assistant** | Camera gesture control; its requirement is defined at L453–455 in **5.3**, not in 11.3.x. |
| VIDEO-AC-09 | Voice identity / video-design evidence | **Command** | Gallery provenance/licensing; requirement is the "Design Recipe Lab" at L1445 in **11.3.3**. |
| VIDEO-AC-11 | Voice identity / video-design evidence | **Command** | Truthful resume state in Command and Forge; origin 5.8 and 6.1. |
| TERMINAL-AC-01…05, DEV-SERVER-AC-01, DESTRUCTIVE-AC-01, REPRO-AC-01 | Assistant execution | **Assistant** | Defined in 5.2.2 / 5.2.3 under Product A, but first *ship* with Phase 2's supervised PTY/Command Plan executor. Phase recorded as 2 (except TERMINAL-AC-01 = 1, named explicitly in Phase 1). |
| SAN-AC-12 | Shared suite | **Shared** | Sanitized local dev preview. Origin 9.1, with a secondary link to 5.2.2; overlaps DEV-SERVER-AC-01 which is Forge/Assistant-side. |
| NEO-MCP-AC-04 | QuillBot work intake | **Shared** | Meeting-evidence analysis; requirement text spans 7.3 (Counsel after-meeting) and 4.1 (intake reconciliation). Dual-linked. |

### 7.4 AC with more than one genuine gate dependency (column holds one value)

| AC | Recorded | Also depends on |
|---|---|---|
| REPO-BOOTSTRAP-AC-01 | `Gate1` | **Brand** — the repository name `abheet19/{{family_slug}}` cannot exist before family-name selection. Criterion text says "Only after Brand and Gate 1 approval". |
| DESIGN-MAC-AC-01, DESIGN-MAC-AC-02 | `Gate2` | **WorkMac** — both stay labelled unvalidated until the Windows Pilot Gate and explicit work-Mac approval permit native review. |
| CEREMONY-AC-01 | `Gate2` | **Brand** — Athena-specific classical cues are conditional on ATHENA passing the Brand Gate. |
| WIN-FIRST-AC-01, WIN-FIRST-AC-02 | `Gate3` | These two *constitute* Gate 3's evidence rather than merely depending on it. |

### 7.5 The `MAC-*` naming vs Windows-first ordering

Ten criteria are named `MAC-*` (MAC-COVERAGE, MAC-NATIVE, MAC-TARGET-01/02, MAC-FILES, MAC-WEB, MAC-CONTENT, MAC-SYSTEM, MAC-AUTOMATION, MAC-A11Y, MAC-RECOVERY) yet Sections 1.2 and 14 make Windows the first pilot and forbid Mac runtime use until the work-Mac approval. They are recorded as `earliest_phase 6` / `gate WorkMac`, **except MAC-COVERAGE-AC-01 = 0A** because the Surface Matrix itself is a Phase 0A item 3 deliverable. The functionally equivalent Windows behaviour is only covered generically by WIN-FIRST-AC-01/02 — there is **no `WIN-*` counterpart to the eight per-surface Mac criteria**. This is a second candidate gap for Gate 1 review.

### 7.6 Other judgment calls worth review

- **SUITE-AC-14** requires proof "before Phase 0"; the enum's earliest value is `0A`, so `0A` is used.
- **WORK-MAC-GATE-AC-01** is a *negative* criterion that must hold from the first binary onward; recorded as phase `1`, gate `WorkMac`.
- **APPROVAL-BINDING-AC-01 / OUTBOX-AC-01** are recorded as phase `1` because Section 14 Phase 1 names "approval/audit ledger and transactional outbox" explicitly, even though their comms-facing use begins in Phase 3.
- **SUITE-AC-02** requires all three products; recorded as phase `1` under the first-touched rule (Assistant/Command standalone), fully satisfiable only at Phase 5.
- **FORGE-AC-02** binds skill loading to design activity that occurs in 0A/0B, but the actor is Forge, which first exists in Phase 2; recorded as `2`.

---

## 8. Nothing was BLOCKED

All work was local and read-only. No web access was required or attempted. No file outside `/Users/abheet.isher/Documents/personal-ai-suite-phase0/ledgers/` was written, and the source file was opened read-only. There are no blocked items.

---

## 9. Reproduction method — exact commands

All commands are run from a shell; `$SRC` is the master prompt and `$OUT` the ledgers directory.

```bash
SRC=/Users/abheet.isher/Downloads/personal-ai-suite-claude-code-master-prompt.md
OUT=/Users/abheet.isher/Documents/personal-ai-suite-phase0/ledgers
```

### 9.1 Integrity receipt

```bash
shasum -a 256 "$SRC"          # d3b5b818e7ad4b5c2785f228059c6b76d076c1a211cbd7680848207bb5ae1dfa
wc -c -l "$SRC"               # 554098 bytes, 2286 lines
sed -n '1p;2286p' "$SRC"      # first/last sentinels
```

### 9.2 Heading map (drives Deliverable 2)

```bash
grep -n '^#\{1,6\} ' "$SRC"                      # all 97 headings with line numbers
grep -nE '^#{3,5} ' "$SRC" | awk -F: '$1>=59 && $1<=2027' | wc -l    # 81 headings in Sections 1-16
```

Section 1 starts at L59; the numbered-section region ends at L2027, immediately before `## Research source index for the receiving agent` (L2028).

### 9.3 The four AC-count checks

```bash
# (1) unique IDs inside Section 15.1 only
sed -n '1749,1990p' "$SRC" \
  | grep -oE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?\b' | sort -u | wc -l      # 196

# (2) total occurrences in the same range (proves no duplicates)
sed -n '1749,1990p' "$SRC" \
  | grep -oE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?\b' | wc -l                # 196

# (3) whole-document set is identical to the 15.1 set
grep -oE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?\b' "$SRC" | sort -u > /tmp/all.txt
sed -n '1749,1990p' "$SRC" \
  | grep -oE '\b[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?\b' | sort -u > /tmp/151.txt
wc -l < /tmp/all.txt                       # 196
comm -3 /tmp/all.txt /tmp/151.txt          # empty -> identical sets

# per-group counts
awk 'NR>=1749 && NR<=1990' "$SRC" | awk '
  /^##### /{grp=substr($0,7)}
  { line=$0
    while (match(line, /[A-Z][A-Z0-9]*(-[A-Z0-9]+)*-AC-[0-9]+[A-Za-z]?/)) {
      print grp "\t" substr(line,RSTART,RLENGTH); line=substr(line,RSTART+RLENGTH) } }' \
  | sort -u | cut -f1 | sort | uniq -c
```

Check (4) is the structured table parse inside the generator (§9.5).

### 9.4 Concept-location evidence for the AC → section mapping

Each defining concept was located before the mapping was assigned, rather than guessed:

```bash
for t in "Observable Execution Stream" "Capability Broker" "Context Sanitization Gateway" \
         "Atomic Action Catalogue" "Review Companion" "Task Candidate" "Source Requirement Matrix" \
         "Trigger Registry" "State Authority" "Workspace Context Scope Record" "Reproducibility Receipt" \
         "Approval Capsule" "Second Brain" "Device Fleet" "Attention Center" "Model/Evaluation Lab" \
         "Workstation Control Center" "GlassMaterialAdapter" "Divergence Lab" "Feature Observation Ledger" \
         "Frame Ledger" "Seed Research Coverage Ledger" "Artifact Index" "Speaker Profile Consent Record" \
         "Interaction Latency Budget" "Work Context Assembler" "Generic Manual Coding Intake" \
         "Personal Overlay" "gesture" "galler"; do
  printf '%-38s' "$t"; grep -n "$t" "$SRC" | awk -F: '$1<1750' | cut -d: -f1 | tr '\n' ' '; echo
done
```

Selected results that decided a mapping: `Device Fleet` → L620 (§5.8) · gesture control → L453–455 (§5.3) · template gallery → L1445 (§11.3.3) · `Speaker Profile Consent Record` → L334 (§5.1.1) · `Reproducibility Receipt` → L437 (§5.2.3) · `Model/Evaluation Lab` appears **only** at L1960 inside 15.1, so it was mapped to its nearest governing requirement, §6.4.

### 9.5 Generator

Three scratch files drive the build and are retained for audit:

| File | Role |
|---|---|
| `.../scratchpad/ac_class.py` | 196-entry table: summary, evidence summary, module, phase, gate, source sections |
| `.../scratchpad/sec_class.py` | 81-entry table: line, scope, module, phase, notes |
| `.../scratchpad/build.py` | Parses the source, cross-checks, emits both CSVs |

```bash
python3 /private/tmp/claude-502/-Users-abheet-isher/28f022ad-0337-404c-895e-513d54e636da/scratchpad/build.py
```

Assertions enforced by `build.py`, any of which aborts the run:

- parsed AC rows == unique AC IDs (no duplicates)
- every parsed AC ID has a classification row, and every classification row corresponds to a parsed AC ID
- `criterion_summary` and `required_evidence_summary` are each ≤ 200 characters
- `product_module`, `earliest_phase`, `gate_dependency` are drawn only from the permitted enums
- the declared section line set is **identical** to the actual `###`/`####`/`#####` line set in L59–L2027
- every section reference from an AC resolves to a declared section

### 9.6 Post-hoc validation of the emitted CSVs

```bash
python3 - <<'PY'
import csv
r=list(csv.DictReader(open("acceptance-criteria.csv")))
assert len(r)==196 and len({x["ac_id"] for x in r})==196
assert {x["status"] for x in r}=={"not-started"}
assert max(len(x["criterion_summary"]) for x in r)<=200
assert max(len(x["required_evidence_summary"]) for x in r)<=200
assert not [k for x in r for k,v in x.items() if not v]      # no empty cells
s=list(csv.DictReader(open("requirement-sections.csv")))
assert len(s)==81 and len({x["section_id"] for x in s})==81
print("OK", len(r), len(s))
PY
```

### 9.7 Derived section IDs

Sections 12, 14 and 15.1 contain **unnumbered** `####`/`#####` headings. Stable IDs were derived by document order and recorded in the `notes` column of every affected row:

| Derived | Heading | Line |
|---|---|---:|
| 12.a…12.e | fan-out research · GitHub census · coding runtimes · assistant/voice · meeting/dictation | 1519, 1531, 1537, 1553, 1574 |
| 14.a…14.j | Clarification Gate · Phase 0 · Phase 1 … Phase 8 | 1608, 1612, 1659, 1669, 1684, 1691, 1699, 1705, 1712, 1718 |
| 15.1.a…15.1.h | the eight acceptance-matrix table headings | 1755, 1814, 1832, 1875, 1894, 1927, 1946, 1976 |

Gate definitions live inside phase sections rather than in their own headings: **Brand Gate, Gate 1 and Gate 2** in 14.b, **Gate 3 (Windows Pilot Gate)** in 14.g. Both are noted in the CSV.

---

## 10. Recommended follow-ups before Gate 1

1. Raise a `RELEASE-AC-*` family for Phase 8 (signing/notarization, staged rollout, runbooks, disaster recovery, ecosystem watch, wake-word phonetic testing) — §7.1.
2. Raise acceptance criteria for **1.1 Productization and commercial-readiness boundary** — §7.1.
3. Decide whether `WIN-*` per-surface criteria should mirror the eight `MAC-*` surface criteria, or whether WIN-FIRST-AC-01/02 are intended to carry that load alone — §7.5.
4. Confirm the `earliest_phase` semantics chosen in §5 (first-touched, not fully-satisfied) before the column is used for scheduling.
5. Decide whether Deliverable 2 should widen to include the pre-Section-1 `Brand Gate` heading at L25 — §7.2.
6. Owner review of the 262 analyst-derived AC → section origin links, given that the prompt contains no explicit AC cross-references — §6.
