# Workspace Context Scope Record — v4

> **v2 delta, 2026-08-28 (owner-requested).** Added `edit-stream` and `rest-server` to the declared
> sources. Purpose unchanged. Providers unchanged. Retention unchanged. **Training eligibility remains
> `none`** — the owner asked for the product to "train on" these repos; that intent is served by
> *retrieval and indexing*, which this record authorizes, and NOT by model training, which it does not.
> Any move to weight-level training is a separate delta with its own rights gate (see §6.4 of the master
> prompt and `16-model-and-adaptation-plan.md`). Scope now covers **4 repos / ~24,754 source files**.
>
> **v3 delta, 2026-08-28 (owner-requested).** Jira allowlist extended from `WEBEXT` to
> **`WEBEXT` + `WEBEXTOPS`**. Read-only intent unchanged. See the open question below — an ops
> project's ticket profile differs from a feature project's, and the auto-intake default may not suit both.

Initialized 2026-08-24 under the approved Clarification Gate defaults. This is a scope-and-data-boundary record, not a recurring auth gate. Material deltas (new source/purpose/provider/region/egress/retention/training use) require a concise delta review; unchanged in-scope work is not re-interrupted.

## Declared sources (read-only unless separately approved)
| Source | Location / identity | Status |
|---|---|---|
| browser-add-on repo | `~/Work/browser-add-on` (+ worktrees e.g. `browser-add-on-3514-wt`) | in scope |
| packages webapp repo | `~/Work/packages` (17,665 source files) | in scope |
| edit-stream repo | `~/Work/edit-stream` (1,061 source files) | **added v2, 2026-08-28** |
| rest-server repo | `~/Work/rest-server` (2,719 source files) | **added v2, 2026-08-28** |
| Work-root prompt/docs | `~/Work/ASSISTANT_PROMPT.md`, `DESIGN_PROMPT.md`, `CONTEXT.md`, `MENTOR_PROMPT.md`, related LLD docs | in scope (owner-directed 2026-08-24) |
| Skills | `~/.claude/skills/*` (incl. `quillbot-lt-conventions`, `lld-artifact`) | in scope |
| Graphify | `~/Work/browser-add-on/graphify-out/*`, `scripts/setup/{workflows,tasks}/graphify.js` | in scope, audit pending |
| Jira | site `quillbot.atlassian.net`, projects **WEBEXT** (board 15) **+ WEBEXTOPS**, acting account `abheet.isher@quillbot.com`, accountId `712020:ffe2227d-9292-46ff-81db-6ee44ab6b470` | **declared and identified (2026-08-24)**; read-only intent; **no connector connected in this session** — connecting one is a separate new-service approval |
| NeoSapien MCP | connected session server (officialness verification pending) | schema inspection only; zero data queries in Phase 0 |
| Wispr Flow MCP | connected session server | deferred/undecided — no queries |

## Devices in scope
| Device | Role | Status |
|---|---|---|
| This Mac (Darwin 25.6.0, `/Users/abheet.isher`) | **Work Mac** — Phase-0 artifacts **+ isolated synthetic-fixture Phase-1/2 builds** in a scratch root (owner ruling, 2026-08-28) | Development host for disposable builds. STILL gated, each behind its own approval: no employer data in any build; no macOS permission grant (Accessibility/Screen Recording/Microphone/Automation/Full Disk Access); no login/background item; no Keychain import; no executor pairing; no OS/browser/terminal automation against real employer surfaces. Not yet a privileged Zeno runtime. |
| Windows machine (owner's **personal** machine) | **Phase 1+ pilot executor** | **Specs in, B-002 RESOLVED 2026-08-28:** RTX 3080 12 GB · Ryzen 7 7700X · 32 GB RAM · dual monitor (2K + 4K, 300 Hz) · Windows 11. Personal ownership favourable; employer data still never lands here except under this record. Model-plan note C-042: 12 GB VRAM ⇒ 14B-class fully-resident default, 30B is partial-offload only. |

## Purposes
Task context assembly, LLD/design evidence, **retrieval and indexing**, evaluation.

**Training eligibility: none.** Indexing all four repositories for exact search, symbol/reference
navigation and cited retrieval is authorized. Deriving a fine-tuning dataset from them is **not**, and
would require: a separate delta review, employer authorization for derivative works, the §6.4 rights
gate, and evidence that rungs 0–3 of the adaptation ladder were measured first and found insufficient.

## Providers / egress
Local tools + Anthropic via this Claude Code session. No other provider. No company source content is placed into research artifacts, prototypes, published Artifacts, or web queries.

## Retention / expiry
Phase 0 working artifacts retained locally under `~/Documents/personal-ai-suite-phase0/`. Record expires **2026-11-22** (90 days) unless renewed.

## Open question raised by the v3 delta

`WEBEXTOPS` reads as an operations project. If it carries incidents, deploys, on-call or alert-driven
tickets, the automatic read-only Intake default approved for `WEBEXT` may be wrong for it:

- **Feature tickets** (WEBEXT) benefit from auto-intake — assignment is a reliable signal that context
  assembly is worth starting.
- **Ops tickets** are often higher-volume, shorter-lived, and sometimes assigned for triage rather than
  implementation. Auto-intake there risks noise, and an incident ticket reaching the Intake pipeline is
  a different risk profile entirely (master prompt §6.1.1 routes incidents to a read-only Incident
  Intake that cannot self-remediate).

**RESOLVED, 2026-08-28 (owner).** `WEBEXTOPS` is the **operations board — production bugs**. Both
`WEBEXT` and `WEBEXTOPS` get **automatic read-only Intake** for anything assigned to the owner. An ops
ticket runs a **Bug-Repro Intake variant**: same read-only preparation, but its Context Readiness adds
a reproduction pass — locate the reported behaviour in code, form a hypothesis, and (on owner request)
reproduce it in an isolated QA browser profile against a local build, capturing console/network/steps
as evidence. This remains **preparation**: repro is read-only observation; the *fix* still passes the
full TASK → LLD → plan → build approval chain. A production-severity ticket does not shortcut any gate —
it changes what evidence the intake gathers, not what authority it carries.

Distinction preserved from master prompt §6.1.1: a genuine **incident/alert** (not a Jira bug ticket)
routes to a read-only Incident Intake that cannot acknowledge, assign, remediate or resolve itself.
A WEBEXTOPS *bug ticket* assigned to the owner is ordinary prioritised work with a repro step — not an
incident — unless it is explicitly an incident ticket.

## Explicitly out of scope
Employer Slack/email/meetings content; claude.ai/ChatGPT/Codex/Cursor histories (official export only, not yet requested); NeoSapien memory content; credentials of any kind; any write to Jira/GitLab/Slack.
