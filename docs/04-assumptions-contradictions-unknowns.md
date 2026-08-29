# Assumptions, Contradictions and Unknowns — Phase 0A

Maintained from the Clarification Gate onward. Every row is either **verified** (evidence cited), **assumed** (a default in force that the owner may overturn), or **unknown** (genuinely undetermined — never quietly filled in).

## A. Assumptions currently in force

These are defaults taken from the approved Clarification Gate. Each is reversible; overturning one re-opens only the artifacts that depend on it.

| ID | Assumption | Basis | What breaks if wrong |
|---|---|---|---|
| A-01 | MVP journeys are (a) Jira→Intake→Context→TASK→Forge handoff (draft-only through Phase 3), (b) Forge MVP on a fixture repo, (c) morning briefing + Review Companion drafts | Clarification Gate default, unchallenged | Roadmap sequencing and the Phase 1/2 slice order |
| A-02 | This Mac is the **work Mac**; Phase-0 artifacts only, no suite runtime ever before Gate 3 + the exact sentence | Default accepted; consistent with `~/Work` employer repos present | If it were personal, the Windows-first ordering would be a preference rather than a hard boundary |
| A-03 | Workspace Context Scope Record v1 as written (browser-add-on + packages + skills + Jira read + NeoSapien read; retention 90 days; **training eligibility none**) | Clarification Gate default | Any ingestion beyond the record requires a delta review |
| A-04 | Jira allowlist is **WEBEXT only**, auto read-only Intake ON, dedupe by issue+version | Owner supplied the WEBEXT board URL; auto-intake default unchallenged | Trigger Registry defaults and noisy-event controls |
| A-05 | Budget ceiling **$0** for Phase 0; free/open-source only | Clarification Gate default | Any paid dependency (Obsidian Sync, SIP number, cloud vectors) needs its own costed approval |
| A-06 | Gate 2 medium is Claude Code Artifacts (+ Figma where useful), dark-first, with reduced-motion/high-contrast variants always produced | Clarification Gate default; both capabilities verified present | Gate 2 deliverable format |
| A-07 | `code-review-reflexes` is folded into `quillbot-lt-conventions` rather than missing | Skill directory listing + the skill's own description mentioning "code-review reflexes" | If it is a separate skill the owner holds elsewhere, QuillBot review work would be missing a required input |
| A-08 | The connected NeoSapien MCP is the owner's own account connector | It is bound to this session's account | If it were a third-party bridge, it would be prohibited outright (§4 forbids private-backend bridges) |

## B. Contradictions and ambiguities found — recorded, not silently resolved

| ID | Contradiction | Disposition |
|---|---|---|
| X-01 | **Where the capability catalogues belong.** §14 Phase 0 item 3 places the Atomic Action Catalogue, Mac/Windows Capability Catalogues, Developer Tool Matrix and command corpus in Phase 0A; §16.2's Phase 0A packet lists six items and excludes them | Register entry #9. Schemas/method produced pre-gate; **population blocked on B-002** because §5.2.1 makes the Windows machine the first concrete inventory and forbids inferring one host's capabilities from another. A "populated" catalogue today would be fiction. **Owner decision requested.** |
| X-02 | **"Deduplicate forks and mirrors"** in the census requirement | Technically impossible — GitHub search excludes forks by default, so every record returns `fork=false`. Disclosed as a cap (C-014), not silently passed |
| X-03 | **Obsidian is assumed to exist** throughout the prompt (Vault projection, reports land as Markdown, Obsidian Sync ADR) | **It does not exist on this machine.** No `.obsidian` directory anywhere under `~` (depth 5–6), `Obsidian.app` not installed, no application-support directory. Either the vault is on another device (→ owner must supply) or the Obsidian projection is aspirational. This materially affects the Vault design and several acceptance criteria |
| X-04 | **NeoSapien MCP** is required to be a "verified official" interface before use | No official MCP exists publicly (0 in the official registry, 0 in the claude.ai registry, no GitHub org, nothing on the vendor site) yet a live account-bound connector is present. The prompt's own preference order has no rung for "account-provisioned but undocumented" | Recorded as B-004. Proposal: treat it as usable read-only under the adapter contract but **never citable as "verified official documented"**, and never allow a Forge handoff to depend on it without the recorded per-task waiver. **Owner decision requested.** |
| X-05 | The prompt's own 24-Aug video manifest states two ~33.333 ms gaps | Independently disproved — no such gap exists (C-018). The prompt's factual seed is wrong; the corrected measurement governs |
| X-06 | Prompt frames Graphify as possibly an in-house "component, tool, package or service" with owners, tests, schemas and version history to inventory | It is a **third-party pre-1.0 PyPI package** (`graphifyy==0.8.39`) whose source is never checked in. Most of the requested inventory fields resolve to "upstream, unread" rather than to repository artifacts |

## C. Unknowns — explicitly undetermined

| ID | Unknown | Why it matters | How it gets resolved |
|---|---|---|---|
| U-01 | **Windows pilot machine specifications** (B-002) — edition/build, CPU/GPU/RAM/storage, displays/refresh, audio devices, Terminal/PowerShell/WSL2/Docker/Hyper-V, admin status, security software, employer-data status | Blocks Phase 1 entirely and blocks truthful population of every capability catalogue and the Interaction Latency Budget baseline | Owner supplies |
| U-02 | **Historical Graphify data egress** (BLOCKED-5) — a paid/LLM "deep mode" existed and was removed 2026-06-22; the current report shows `0 input · 0 output` tokens, but `cost.json` and `memory/` in the ignore lists prove the mode was once enabled. **Which vendor received repository content during that window is undetermined** | A genuine employer-data question that predates this project and is independent of it | Historical `cost.json`, `graphify-out/memory/`, or CI logs from before commit `da2729279` |
| U-03 | Upstream `graphifyy` provenance — publisher, licence, repository, maintenance, security posture of a pre-1.0 package that runs in CI with push credentials to `master` | Supply-chain exposure in the employer repo; also determines whether an "extend" path was ever viable | Owner-side PyPI/upstream check (web access was out of scope for that audit) |
| U-04 | Obsidian vault location and contents, if one exists | Vault design, report projection, several acceptance criteria | Owner confirms whether a vault exists on another device |
| U-05 | Whether local Codex memories are actually **enabled** (directory exists; docs say off by default; contents deliberately unread) | Determines whether a Codex import path exists at all | Owner runs the documented check, or authorises a metadata-only read |
| U-06 | Claude Code transcript history before 2026-07-01 | Deleted by local retention sweep; longitudinal work-history analysis is blocked locally | Official Claude export only (owner-initiated) |
| U-07 | GitLab MR/pipeline history | Needed for Graphify job reliability (BLOCKED-8) and later CI work | OAuth authorisation via `/mcp` in an interactive session |
| U-08 | Whether the owner wants Wispr Flow in scope at all (dictation source? meeting source? out of scope?) | Affects Counsel's canonical-source design and duplicate-capture avoidance | Owner decision, deferred until Counsel design |
| U-09 | Employer policy on running an assistant against QuillBot systems at all | Every action tier assumes the owner has authority they assert; the scope record captures scope, not employer permission | Owner's own assessment; flagged, not assumed away |

## D. Verified facts that overturned a prompt assumption

Consolidated in `03-corrections-log.md` (C-001 … C-023). The load-bearing ones for Phase 0B:

1. **No official NeoSapien MCP exists publicly** — the adapter's "mode zero" rung is occupied by an undocumented endpoint (C-011).
2. **OpenAI documents zero export-to-another-agent path** — context migration is strictly one-way *into* OpenAI products (C-009).
3. **Cursor has no official export** and retains embeddings + filename metadata permanently even under Privacy Mode (C-010).
4. **Graphify is ~48% vendored third-party noise** and its "insight" sections are demonstrably false-positive-generating; verdict is adapter-for-report, replace-for-store (§03b).
5. **Obsidian is absent from this machine** (X-03).
6. **The 24-Aug video gap profile in the prompt is wrong** (C-018).
7. **`openclaw/openclaw` (~387k★) exists and the prompt never names it** — the seed list is not a complete map of this space (C-015).
