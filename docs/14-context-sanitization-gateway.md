# 14 — Zeno Context Sanitization Gateway

**Phase 0B · Gate 1 design artifact · 2026-08-24**
**Canonical requirement source:** master prompt §9.1 (lines 979–1014), plus the SAN-AC rows at lines 1794–1806.
**Acceptance criteria covered:** SAN-AC-01 … SAN-AC-13 (all thirteen; traceability table in §16).
**Component name:** the gateway is a shared service of the Zeno suite. It is not a separate product; it has no user-facing brand name of its own and is referred to in code and docs as `zeno-gateway`.

---

## How to read this document

Every substantive claim carries one of three labels:

| Label | Meaning |
|---|---|
| **[V] verified** | Sourced from a primary artifact already fetched and recorded in this corpus (`03-corrections-log.md`, `research/L5-skeptic-review.md`, the master prompt itself, or a filesystem check on this machine). The citation is given. |
| **[I] inferred** | A design consequence reasoned from a verified fact. Reasonable, not proven. |
| **[U] unknown** | Genuinely undetermined. Never filled in with a plausible guess. |

Anything without a label is a **design decision taken in this document** — a proposal for Gate 1, not a fact.

**Naming note.** Master prompt §9.1 names the paired-device layer "Link". Following the passed Brand Gate that layer is **Zeno Mesh** (renamed from "Zeno Link" because Eclipse `zenoh` is a homophone pub/sub linking protocol). Where §9.1 is quoted, "Link" is read as **Mesh**. Components referenced here: **Zeno** (assistant), **Zeno Forge** (coding agent), **Zeno Counsel** (meeting copilot), **Zeno Command** (control plane), **Zeno Vault** (memory), **Zeno Mesh** (paired devices), **Zeno Glass** (design system). CLI/protocol `zeno` / `zeno://`. Bundle root `com.abheet19.zeno`. Packages are always scoped `@abheet19/zeno-*`.

**What this document is not.** It is not legal clearance, not a security certification, and not a claim of compliance. §13 produces a compliance *evidence pack*; §15 names where qualified legal, security and privacy review is still required.

---

## 0. The invariant

> ## **SANITIZATION NEVER CREATES AUTHORIZATION.**

This is the load-bearing rule of the entire gateway. It is stated here, restated at the head of every enforcement stage in §7, encoded as a machine-checked property in §2.5 (ARCH-TEST-07), and asserted as a release gate in §12.

Redaction **cannot**:

1. broaden an ACL;
2. permit another provider, region, account or recipient;
3. cross a personal/company/public zone boundary;
4. satisfy a consent that was never obtained;
5. change a retention period or extend an expiry;
6. convert proprietary or employer-confidential content into public data;
7. make a Task Candidate authoritative;
8. lower an action tier (T0 … T4 per master prompt §8, lines 926–930).

Formally, for a source item `x` and any transformation chain `τ` the gateway can apply:

```
authorize(τ(x), sink, purpose) ⊆ authorize(x, sink, purpose)
```

The authorization set of a sanitized derivative is a **subset** of the authorization set of its source — never a superset, never a lateral move. Every policy decision function in `zeno-gateway` returns a decision that is monotonically non-increasing in permission as transformations are applied. This is checked by property test, not by review (§2.5).

**"Local" is not exempt.** Local prompts, local indexes, browser caches, development servers, log files, crash dumps, swap and core dumps all persist and all leak. A local sink is a registered sink with a contract, exactly like an external one.

**When the minimum safe view is insufficient.** If the safe view lacks information required for a reliable result, the gateway does exactly one of four things, in this order of preference:

1. show the exact utility loss and route to an **approved local consumer** that is permitted to see more;
2. request a **narrower explicit authorization** (a scoped delta review, not a blanket one);
3. ask for **human takeover**;
4. **block**.

It never fabricates around a redaction, and it never sends the raw material as a "fallback". There is no fallback path. (SAN-AC-11.)

---

## 1. Position in the suite

The gateway is a single versioned, deterministic service shared by **Zeno**, **Zeno Forge**, **Zeno Counsel**, **Zeno Command**, **Zeno Vault**, **Zeno Mesh**, MCP, model routing, connectors, notifications, observability, support and exports. There is exactly one instance of the policy, one detector set and one registry per host; a second sanitizer is a defect, not a feature.

No source content, prompt fragment, model or tool input or output, screenshot, audio, transcript, generated artifact or derivative may reach a consumer **merely because it passed an earlier import scan**. Passing ingress buys admission to quarantine and nothing else.

```mermaid
flowchart TB
  subgraph SRC["Authoritative sources — preferred: leave in place, keep a revisioned pointer"]
    S1["Jira WEBEXT"]
    S2["Git repos and worktrees"]
    S3["Meeting audio and transcripts"]
    S4["Screen and OCR captures"]
    S5["NeoSapien MCP - undocumented vendor endpoint"]
    S6["Files, clipboard, browser"]
  end

  subgraph GW["zeno-gateway — the only mediator"]
    ING["Stage 1 Ingress"]
    CLS["Classification and detector pipeline"]
    VB["View builder"]
    POL["Policy decision point"]
    LIN["Sanitization Lineage DAG"]
  end

  subgraph RAW["Raw Evidence / Quarantine Zone"]
    RQ["Per-zone encrypted, minimal ACL, short TTL, no model or agent access"]
  end

  subgraph VIEWS["Purpose-bound Sanitized Context Views"]
    V1["view id = HMAC over the 22-field view key"]
  end

  subgraph BRK["zeno-broker — separate process, no model access"]
    TV["Local Token Vault"]
  end

  subgraph SINKS["Registered sinks — 12 classes, §2"]
    K1["models"]
    K2["tools and MCP"]
    K3["browser and GUI workers"]
    K4["UI, HUD, notifications"]
    K5["logs, traces, crash, analytics"]
    K6["Vault and Obsidian"]
    K7["embeddings and vectors"]
    K8["graph"]
    K9["caches, storage, backups"]
    K10["paired devices - Zeno Mesh"]
    K11["training and evaluation"]
    K12["external export and write"]
  end

  SRC --> ING
  ING --> RQ
  ING --> CLS
  CLS --> POL
  POL --> VB
  RQ -.->|"gateway only, never a consumer"| VB
  VB --> V1
  V1 --> SINKS
  VB -.->|"token handles only"| TV
  TV -.->|"just-in-time, adapter only"| K12
  POL --> LIN
  SINKS -.->|"every write records a lineage node"| LIN

  RAW -.->|"DENIED - asserted at 3 independent layers"| SINKS
```

The dashed **DENIED** edge is not decorative. It is asserted at three independent layers — type system, OS process isolation, and runtime egress broker — and tested by a deliberate-bypass corpus (§2.5).

---

## 2. The sink registry (SAN-AC-01)

### 2.1 Definition

A **sink** is any point at which content leaves the gateway's control: crosses a process boundary, crosses a trust boundary, becomes durable, becomes visible to a human on a surface that is not the private authenticated one, becomes visible to a model, or leaves the device.

A sink that is not in the registry does not exist. A code path that reaches a consumer without a registered `sink_id` fails the build (ARCH-TEST-03), fails the runtime broker (ARCH-TEST-05), and fails the negative-test corpus (ARCH-TEST-08).

### 2.2 The twelve sink classes

Exactly as enumerated in master prompt §9.1 line 981. The class determines the *default* contract; each concrete sink narrows it, never widens it.

| # | Class | Prefix | What it covers |
|---|---|---|---|
| 1 | Models | `SK-MODEL-*` | Every inference call — local or remote, chat or embedding or rerank or classify |
| 2 | Tools / MCP | `SK-TOOL-*` | MCP servers, built-in tools, shell executor, Git, Jira, filesystem tools |
| 3 | Browser / GUI workers | `SK-BROWSER-*` | Playwright/DOM drivers, AXUIElement automation, visual computer-use |
| 4 | UI / HUD / notifications | `SK-UI-*` | In-app sheets, Command dashboards, HUD, OS notifications, lock screen, wearables, shared displays |
| 5 | Logs / traces / crash / analytics | `SK-OBS-*` | Structured logs, spans, crash dumps, error reporters, product analytics, support bundles |
| 6 | Vault / Obsidian | `SK-VAULT-*` | Zeno Vault notes and reports; Obsidian Markdown projection |
| 7 | Embeddings / vectors | `SK-EMB-*` | Every vector written to any index |
| 8 | Graph | `SK-GRAPH-*` | Nodes, edges, properties, labels of any knowledge/temporal graph |
| 9 | Caches / storage / backups | `SK-STORE-*` | SQLite stores, disk caches, temp files, swap-adjacent buffers, local and off-device backups |
| 10 | Paired devices | `SK-MESH-*` | Zeno Mesh replication to a device group |
| 11 | Training / evaluation | `SK-TRAIN-*` | Any corpus, adapter experiment, eval set, or benchmark input |
| 12 | External export / write | `SK-EXPORT-*` | Slack, email, Jira, Git remote, file share, support upload, clipboard-to-external, any other external write |

### 2.3 The sink contract schema

The registry is a declarative manifest (`registry/sinks/*.toml`) compiled at build time into typed constructors. Hand-written egress code cannot exist; a sink's transport function is *generated* from its contract and refuses to compile without one.

```toml
[sink]
sink_id            = "SK-MODEL-EXT-ANTHROPIC-CHAT"   # stable, unique, immutable
sink_class         = "models"                         # one of the twelve
component          = "zeno-assistant"                 # owning Zeno component
transport          = "https"                          # stdio | https | ipc | file | display | os-notification | mesh
destination        = { kind = "provider", provider = "anthropic", account = "<opaque-account-id>", region = "<region>" }
trust_of_output    = "untrusted"                      # returned content is ALWAYS untrusted, even from an approved server

zones_permitted    = ["personal"]                     # NOT "company" — see §5.4
classes_permitted  = ["I2:masked", "I3:placeholder"]  # class:transform pairs; anything unlisted is denied
classes_denied     = ["S*", "B*", "H*", "M*", "E*"]   # explicit denials are also asserted, for defence in depth
default_for_unknown = "block"                          # class U policy at this sink

placeholder_scheme = "scoped-v1"                       # §3.5
rehydration        = { allowed = false }               # models NEVER rehydrate — §4
persistence        = { durable = false, provider_retention = "unknown" }
retention_max      = "PT0S"
approval_tier      = "T2"                              # per master prompt §8 lines 926–930
consent_required   = false
policy_version_min = "pol-2026.08"
detector_version_min = "det-2026.08"

rescan_stages      = ["prompt-joined", "model-output"] # §7 stages 2 and 4 mandatory here
manifest_required  = true
lineage_node_kind  = "prompt-egress"
deletion_cascade   = { support = "partial", reason = "provider-side retention is outside our control; disclosed per SAN-AC-09" }
failure_mode       = "fail-closed"

tests              = ["CONF-MODEL-EXT-01", "DENY-MODEL-EXT-01", "CANARY-MODEL-EXT-01"]
status             = "active"                          # active | disabled | declared-absent | proposed
evidence           = "design-decision"                 # verified | inferred | unknown | design-decision
```

Thirty fields. Every one is mandatory. `classes_permitted` is an **allowlist**: a class not named is denied, and `classes_denied` exists only so the denial is also *stated* and separately asserted.

### 2.4 The registry — representative rows

Condensed. Full contracts live in the manifest; this table shows the columns that carry the design decisions. `Zones` = zones this sink may ever receive. `Tier` = approval tier of a write to this sink. `Rehyd.` = may the token vault rehydrate here.

#### Class 1 — Models

| sink_id | Destination | Zones | Max classes after transform | Rehyd. | Tier | Notes |
|---|---|---|---|---|---|---|
| `SK-MODEL-LOCAL-COMPANY` | local runtime, on-device | personal, **company** | E1 code/diff **preserved**, I1–I3, P1 placeholder | no | T1 | The only sink permitted to see minimally-complete employer code. Preserves symbols, types, line mapping (§5.4). |
| `SK-MODEL-LOCAL-PERSONAL` | local runtime, on-device | personal | most classes, S* denied | no | T1 | |
| `SK-MODEL-EXT-<provider>` | remote provider | personal only | I2 masked, I3 placeholder; **E\*, S\*, B\*, H\*, M\* denied** | no | T2 | Company-zone content never reaches an external provider without an explicit T3 cross-zone export approval. |
| `SK-MODEL-EMBED-LOCAL` | local embedding model | per source view | inherits source view classes | no | T1 | Feeds `SK-EMB-*`; see §5.6 on embeddings as derivatives. |
| `SK-MODEL-CLASSIFY-SANDBOX` | local sandboxed classifier | quarantine-adjacent | **only after S\* tokenized** | no | T1 | The model-assisted classifier tier. Cannot see raw credentials, cannot decide policy, cannot override a deterministic block (§6.4). |

#### Class 2 — Tools / MCP

| sink_id | Destination | Zones | Notes |
|---|---|---|---|
| `SK-TOOL-MCP-STDIO-<server>` | local process, stdio | per server | **stdio and Streamable HTTP only.** MCP `2026-07-28` is a breaking rewrite **[V]** — `initialize` removed, protocol sessions and `Mcp-Session-Id` removed, `ping` and `logging/setLevel` removed, `resources/subscribe` replaced, `server/discover` mandatory, Sampling deprecated (C-026; L5 §8 risk 6). HTTP+SSE is rejected at design time. |
| `SK-TOOL-MCP-HTTP-<server>` | Streamable HTTP | per server | Tool manifest is content-hashed and human-approved; a hash change forces re-approval (L5 §3.1). Deny-by-default network egress per server. No host filesystem mount outside an explicit allowlist. |
| `SK-TOOL-MCP-NEOSAPIEN` | **undocumented vendor-hosted endpoint** | personal | See §2.6 — this sink is where a genuine finding lives. |
| `SK-TOOL-SHELL` | local executor | per worktree | Command **plans** carry placeholders; secrets are injected at spawn, never into `argv` (world-readable via `ps`), never into shell history (§4.4). |
| `SK-TOOL-GIT` | local git + remote | per repo zone | Credentials served by a broker credential helper. Never `https://user:token@host`. Push remains T2 with a re-resolved preflight (master prompt line 936). |
| `SK-TOOL-JIRA-READ` | `quillbot.atlassian.net`, WEBEXT only | company | Read-only. Query strings are themselves egress and obtain a view. |

**Untrusted-output rule (all tool sinks).** Server output is untrusted *even after the server is approved*. `trust_of_output = "untrusted"` is not overridable by any registry row. Tool descriptions and tool results are attacker-controlled text that enters the model's context — the MCP specification says so itself **[V]** (L5 §3.1). A container bounds execution; it does not bound this.

#### Class 3 — Browser / GUI workers

| sink_id | Notes |
|---|---|
| `SK-BROWSER-DRIVER` | Dedicated browser profile with **zero employer sessions**, plus a domain allowlist. Never `quillbot.atlassian.net`, never GitLab, never any authenticated employer surface **[V]** (L5 §3.3 — a browser driver rides whatever session cookies the profile holds). |
| `SK-BROWSER-VISUAL` | Visual computer-use fallback. Screenshots taken by the worker are class I4 and re-enter at stage 1 as new ingress, never as trusted. |
| `SK-GUI-AX` | AXUIElement automation. Reads from other applications are ingress; writes are effects governed by the tier policy, not by this gateway. |

#### Class 4 — UI / HUD / notifications

Progressive disclosure. Each row may show strictly less than the row above it.

| sink_id | Surface | What it may contain |
|---|---|---|
| `SK-UI-PRIVATE-SHEET` | Private, unlocked, authenticated, owner-present | The richest view. Still not raw — raw reveal is a separate exceptional authenticated local view (§3.1). |
| `SK-UI-COMMAND` | Zeno Command dashboard on the primary display | Same as above minus anything class S*, B*, or flagged raw-reveal-only. |
| `SK-UI-HUD` | Always-on overlay | No excerpt, no payload; typed placeholders and counts only. |
| `SK-UI-NOTIF-UNLOCKED` | OS notification, device unlocked | Categorical title + action. No person, no ticket, no repository, no branch, no path, no excerpt. |
| `SK-UI-NOTIF-LOCKED` | Lock screen | **Approval needed** and nothing else. |
| `SK-UI-WEARABLE` | Watch / paired wearable | **Approval needed** and nothing else. |
| `SK-UI-SHARED-DISPLAY` | Screen share, external monitor in a meeting, projector | **Approval needed** and nothing else. Fails closed when the display state is unverified. |

**Default for the most exposed surfaces is `Approval needed` with no person, ticket, repository, branch, path, excerpt or payload.** (SAN-AC-06.) When the surface state cannot be verified — display mirroring unknown, screen-share state unknown, lock state stale — the gateway assumes the *most exposed* state. Uncertainty resolves downward, never upward.

#### Class 5 — Logs / traces / crash / analytics

| sink_id | Notes |
|---|---|
| `SK-OBS-LOG` | Allowlisted structured schema only. No free-form message field exists in the type — the logger takes a categorical `event_code` plus typed fields drawn from an enum. There is no `log.info(String)` API in the codebase. |
| `SK-OBS-TRACE` | Span names and attributes from the same allowlist. Random non-secret correlation IDs. Never a prompt, never a model or tool body, never source, never a diff, never a path, never an identity, never audio, never a transcript, never a screenshot, never clipboard. |
| `SK-OBS-CRASH` | Crash handler writes to a local encrypted store. Core dumps disabled by default; if enabled for a debugging session, that session is time-boxed and the dumps are scanned before they are readable. |
| `SK-OBS-ANALYTICS` | **Disabled by default.** Session replay and autocapture **off**. Vendor-side hooks (`beforeSend`, filter functions and equivalents) are defence in depth, **never the primary boundary** — the payload is already schema-constrained before it reaches them. |
| `SK-OBS-SUPPORT-BUNDLE` | Generated locally → scanned → **previewed** → approved → only then shareable. Sharing is a `SK-EXPORT-*` action at T2 or T3 depending on classes present. |

#### Class 6 — Vault / Obsidian

| sink_id | Status | Notes |
|---|---|---|
| `SK-VAULT-NOTE` | active (design) | Only reviewed sink-authorized sanitized facts or evidence pointers. Cross-ref VAULT-AC-01. |
| `SK-VAULT-REPORT` | active (design) | Reports are derivatives; they carry their own lineage nodes. |
| `SK-OBSIDIAN-PROJECTION` | **`declared-absent`** | **Obsidian is not installed on this machine [V]** (X-03: no `.obsidian` directory under `~` at depth 5–6, `Obsidian.app` not installed, no application-support directory). The sink contract exists so that the registry is complete and so that no code path can write to a vault without one; it is **disabled**, and enabling it requires the owner to supply a vault location (U-04). See §15 conflict CSG-C1. |

Never store credentials in Obsidian, vectors, prompts or logs (master prompt line 975). The token vault (§4) is the sole exception to "never store credentials" and it is none of those four things.

#### Class 7 — Embeddings / vectors

| sink_id | Notes |
|---|---|
| `SK-EMB-CODE` | Built **from the authorized sanitized view**. There is no raw-then-redact indexing path; the embedding model call is itself `SK-MODEL-EMBED-LOCAL`, which can only be handed a view. (SAN-AC-07.) |
| `SK-EMB-DOC` | Same. |
| `SK-EMB-MEETING` | Requires meeting-consent state (class MC) to be satisfied at the *view* level before the vector exists. |

**Invariant (§5.6).** An embedding is a **derivative that inherits the classification of its source view**. It is not sanitized by virtue of being a vector. Embedding inversion is a real attack class; treating a float array as non-sensitive is the single most common way a sanitization boundary is defeated in practice. Every vector row stores its `view_id` and its class set, and is subject to the deletion cascade (§9.3).

#### Class 8 — Graph

| sink_id | Status | Notes |
|---|---|---|
| `SK-GRAPH-NODE` / `SK-GRAPH-EDGE` | **`proposed`, not active** | Master prompt line 975: add a graph database only when evaluation shows value. Minimize properties; exclude secrets from labels, vectors and metadata. |

**Licence record required before any graph adoption** — code / weights / datasets / required-runtime, stated separately (L5 §2.1, §8 risk 1, the corpus's single biggest hole).

| Candidate | Code licence | Weights | Datasets | **Required runtime** | Verdict |
|---|---|---|---|---|---|
| Graphiti on Neo4j | Apache-2.0 **[V]** | n/a | n/a | **Neo4j = GPLv3** **[V]** (C-027; L5 §2.1a, verbatim from `neo4j/neo4j/dev/LICENSE.txt`) | Self-host-only, never distribute, never offer as a service — **and even then, a GPLv3 runtime under a proprietary desktop binary needs counsel review before Gate 1 exit** |
| Graphiti on FalkorDB | Apache-2.0 **[V]** | n/a | n/a | **FalkorDB = SSPL v1** **[V]** (C-027; not OSI-approved; §13 conditions offering the software as a service on releasing the entire service stack) | Same posture, worse licence class |
| Graphify (`graphifyy`) | Apache-2.0 **[V]** (C-025) | n/a | n/a | Python ≥3.10 | **Adapter for the report, replace for the store** — verdict already taken. Its committed graph is 48% vendored third-party noise and undirected **[V]**. 217 releases in 4.6 months, still pre-1.0 **[V]**. Do not extend. |
| No graph at all | — | — | — | — | **The Phase-1 default.** SQLite + FTS + a relational edge table answers the Phase-1 queries; a graph is added only if an evaluation shows the marginal value. |

The gateway itself takes **no dependency on any graph database.** A licence trap in an optional store must never be able to infect the mandatory security boundary.

#### Class 9 — Caches / storage / backups

| sink_id | Notes |
|---|---|
| `SK-STORE-VIEW` | The sanitized-view store. Encrypted per zone. |
| `SK-STORE-CACHE` | Every cache entry carries zone, ACL, source lineage, policy/detector version, transformations, TTL and deletion state. A cache key derived from cross-zone material is itself a leak; keys are HMACs under the zone key (§3.4). |
| `SK-STORE-TEMP` | Temp files created in a zone-specific directory with restrictive modes; `O_TMPFILE` where available; never in a shared `/tmp`. |
| `SK-STORE-BACKUP-LOCAL` | Encrypted by zone. Deletion cascade support = `partial` — a backup taken before a deletion still contains the derivative until it expires; the expiry is disclosed, not hidden (§9.3). |
| `SK-STORE-BACKUP-OFFDEVICE` | T3. Cross-zone or bulk export at this sink is explicitly T3 per master prompt line 929. |

Prevent plaintext temp, swap and core-dump leakage: secret-bearing buffers are `mlock`ed where the OS permits and zeroized on drop; core dumps are disabled for `zeno-broker` unconditionally.

#### Class 10 — Paired devices (Zeno Mesh)

| sink_id | Notes |
|---|---|
| `SK-MESH-REPLICATE` | E2EE to an authorized device group only. **Eligibility never overrides a data zone, ACL, retention rule, company policy or owner exclusion** (master prompt line 977). A device's *privacy state* — locked, shared display, untrusted network — is part of the view key (§3.3), so the same record produces a different view for a locked phone than for an unlocked desktop. |
| `SK-MESH-HANDOFF` | Cross-ref LINK-AC-02: handoff preserves task state without cross-zone leakage. T2/T3 never silently migrates. |

#### Class 11 — Training / evaluation

| sink_id | Status | Notes |
|---|---|---|
| `SK-TRAIN-CORPUS` | **`disabled`** | **Training eligibility for the Workspace Context Scope Record v1 is `none` [V]** (`01-workspace-context-scope-record.md`). This sink is registered and disabled. Enabling it is a material delta requiring a fresh scope review. Cross-ref FINE-TUNE-AC-01. |
| `SK-TRAIN-EVAL` | active | The sanitizer's own evaluation corpus (§12) is **synthetic**. It is never harvested from `~/Work` or from any employer source. |

#### Class 12 — External export / write

| sink_id | Tier | Notes |
|---|---|---|
| `SK-EXPORT-SLACK`, `SK-EXPORT-EMAIL`, `SK-EXPORT-JIRA-WRITE`, `SK-EXPORT-GIT-PUSH`, `SK-EXPORT-FILESHARE`, `SK-EXPORT-SUPPORT` | T2 | Each rebuilds a destination-specific view immediately before the write and re-scans it (stage 9). Approval binds to the **final sanitized payload hash** — a changed recipient or a changed payload invalidates it (APPROVAL-BINDING-AC-01). |
| `SK-EXPORT-CROSSZONE`, `SK-EXPORT-BULK`, `SK-EXPORT-ACCOUNT-ARCHIVE` | **T3** | Exact immutable preview plus fresh device biometric. The preview identifies device, destination, data classes, scope, redactions, backup/recovery status and irreversibility (master prompt line 929). |
| `SK-EXPORT-SECRET` | **T4 — does not exist** | Reveal/export secrets is a T4 deny (master prompt line 930). There is no sink_id for it. A false-positive override can never create one (§12.6). |

### 2.5 The architectural test — proving no unregistered raw-to-consumer path exists (SAN-AC-01)

This is the part of SAN-AC-01 that is easy to claim and hard to earn. The honest statement first:

> **[I] On a general-purpose OS, "no unregistered path exists" is not provable in the mathematical sense.** A process with sufficient privilege can always read another process's memory or open a file. The strongest achievable and *defensible* claim is: *no unregistered path exists among the enumerated egress primitives, enforced independently at three layers, with a deliberate-bypass corpus that fails the build if any attempt succeeds.* This document claims exactly that and nothing more.

Three independent layers, so that a defect in one does not open the boundary:

```mermaid
flowchart LR
  A["Layer 1 — TYPE<br/>compile time"] --> B["Layer 2 — PROCESS<br/>OS isolation"] --> C["Layer 3 — BROKER<br/>runtime egress"]
  A -.-> D["ARCH-TEST 01,02,03,07"]
  B -.-> E["ARCH-TEST 04"]
  C -.-> F["ARCH-TEST 05,06"]
  D --> G["ARCH-TEST-08<br/>deliberate bypass corpus"]
  E --> G
  F --> G
  G --> H["Build fails if ANY bypass succeeds"]
```

**Layer 1 — type system.** Raw material is carried only in `Sealed<T>`, which has no public accessor, no `Deref`, no `Debug`/`Display` impl (so it cannot be formatted into a log line), and no serializer. The only function that can open a `Sealed<T>` lives in `zeno-gateway` and is `pub(crate)`. `SanitizedView` has a private constructor; only the view builder can mint one. Every generated transport function takes `&SanitizedView`, never `&Sealed<T>`, never `&str`.

**Layer 2 — process and OS isolation.** The Raw Evidence/Quarantine store and the Token Vault are owned by processes distinct from every model-facing and agent-facing process. Their database files are mode `0600` under a distinct OS user (or, where a separate user is impractical, a distinct keychain-held key that model-facing processes never load). A consumer process attempting to open the raw store gets `EACCES` — a failure at the kernel, not at a lint rule.

**Layer 3 — runtime egress broker.** Every socket, every file write outside a process's own scratch directory, and every IPC send from a consumer process is routed through `zeno-broker` with a `sink_id` token. An unlabeled attempt is denied and recorded.

The eight tests:

| ID | Test | Fails the build when |
|---|---|---|
| **ARCH-TEST-01** | Registry schema + completeness | Any manifest row is missing a mandatory field, has a duplicate `sink_id`, references an unknown class, or names a test that does not exist. |
| **ARCH-TEST-02** | Import/dependency boundary | Any package outside `zeno-gateway` imports `zeno-rawstore`; any package outside `zeno-broker` imports `zeno-tokenvault`; any package constructs `SanitizedView` outside the view builder. Implemented as a dependency-graph assertion in CI, not a convention. |
| **ARCH-TEST-03** | Egress-surface enumeration | A build-time pass enumerates every function performing I/O to a persistent or non-local destination (annotated `#[sink("...")]`) and diffs the set against the registry. Any unannotated egress primitive, or any annotation naming an unregistered `sink_id`, fails. |
| **ARCH-TEST-04** | Process isolation | A test process running as a consumer identity successfully opens the raw store or the token vault. Asserts `EACCES`. |
| **ARCH-TEST-05** | Broker mediation | A synthetic consumer opens a direct outbound socket or writes outside its scratch dir and succeeds. Asserts denial + a recorded denial event. |
| **ARCH-TEST-06** | Taint propagation with canaries | A registered canary planted in a source appears at **any** sink whose contract does not permit its class. Runs against all twelve classes × every active sink. |
| **ARCH-TEST-07** | Monotonicity — *sanitization never creates authorization* | Property test over generated `(item, transform-chain, sink, purpose)` tuples: fails if `authorize(τ(x)) ⊄ authorize(x)` for any tuple. This is the invariant of §0, machine-checked. |
| **ARCH-TEST-08** | Deliberate bypass corpus | ≥ 24 scripted attempts — raw store read, direct provider call, log a `Sealed`, embed raw text, write a graph property from quarantine, notification with a payload on a locked screen, MCP tool result straight to a Vault note, cache key from cross-zone material, temp file in a shared dir, a "debug" flag, an env-var override, a config file that names an unregistered sink, and so on. **All must be denied.** One success fails the build. |

**Coverage rule.** Every registered sink must have at least one passing conformance test **and** at least one passing denial test. A sink with no tests fails ARCH-TEST-01. This prevents the registry from growing rows that are never exercised.

### 2.6 A finding: NeoSapien MCP is a *sink*, not only a source

**[V]** No official NeoSapien MCP exists publicly — 0 results in the official MCP registry, 0 in the claude.ai connector registry, nothing on any neosapien.ai property, no GitHub org — yet a live account-bound connector is present in the owner session (C-011, C-001; B-004; X-04).

The corpus consistently frames this as a **read-only source** whose risk is what comes *back*. That framing is incomplete:

> **A `search_memories` call sends a query string to an undocumented vendor-hosted host.** The query is assembled from task context. If it is assembled from company-zone material — a ticket key, a repository name, a customer name, a branch — then a "read-only" call has just performed an **egress of employer-confidential content to a third party with no published data-flow, no published retention and no published schema**.

Therefore `SK-TOOL-MCP-NEOSAPIEN` is registered with **two** contracts, an egress contract for the request and an ingest contract for the response:

- **Egress (request):** `zones_permitted = ["personal"]`. Company-zone terms may not appear in a query. Queries are built from a sanitized view like any other payload and are re-scanned at stage 9.
- **Ingest (response):** `trust_of_output = "untrusted"`, full stage-1 treatment, class `U` by default.
- **Provenance:** usable read-only under the adapter contract; **never citable as "verified official documented"** (X-04, NEO-MCP-AC-01: *look-alikes are never official*); never a silent dependency; a Forge handoff may not depend on it without a recorded per-task waiver (NEO-MCP-AC-03).
- **Phase-0 state:** zero memory queries. Schema inspection only **[V]** (scope record v1). Before any read, a written data-flow is required: what leaves the device, to which host, retained how long (L5 §3.9).
- **Additional vendor observation [V]:** the vendor's site runs PostHog with `session_recording` + `autocapture` enabled, and its *"Speaker Recognition — knows who said what"* marketing directly contradicts its own Privacy Policy §4 (*"other participants' voices are not identified or stored"*) (L5 §3.9). This is a vendor-consistency signal, not a property of our sink, but it belongs in the contract's evidence notes.

Recommended as a new corrections-log row; see §15, CSG-C4.

---

## 3. The two storage classes (SAN-AC-02)

Physically and logically separated: separate stores, separate keys, separate ACLs, separate processes.

### 3.1 Raw Evidence / Quarantine Zone

**Preference order, strictly:**

1. **Leave the authoritative raw material in its source system** and retain a revisioned pointer. This is the default and it is not a compromise — a pointer that resolves is better provenance than a copy that drifts.
2. Only when an authorized local copy is genuinely necessary, create one.

A local copy is:

- **encrypted with per-zone keys** — `personal`, `company`, `public` never share a key;
- held under **minimal ACLs** and a **short approved TTL**, defaulting to the shortest TTL that satisfies the purpose, never "until deleted";
- **quarantined, hashed, malware-scanned and archive-scanned with bounded parsing** — depth limit, expansion-ratio limit, entry-count limit, total-bytes limit, wall-clock limit. Exceeding any bound is a classification result (`archive-bomb-suspected`), not an exception to swallow;
- **denied** to ordinary model, vector, graph, notification, telemetry, plugin, browser and agent access. Not "discouraged". Denied at layer 2 (§2.5).

**Raw metadata is itself sensitive.** Raw paths, URLs, account IDs and low-entropy hashes may themselves be sensitive. A SHA-256 of an email address, a repo name, or a ticket key is **brute-forceable in seconds** — the input space is tiny. Therefore ordinary receipts use **opaque internal IDs** and **keyed digests** (HMAC under a per-zone key held only by the gateway), never plain hashes of low-entropy values. This is a concrete, testable rule: ARCH-TEST-06 includes a "low-entropy plain-hash" scan across every receipt, manifest and log record.

**Raw reveal** is an exceptional, authenticated, private, local view — an explicit user action on `SK-UI-PRIVATE-SHEET` with a fresh authentication, time-boxed, logged as a non-content event. It is **not** a provenance requirement: provenance is satisfied by the pointer and the keyed digest, not by showing the bytes.

### 3.2 What is stored where

| | Raw Evidence / Quarantine | Sanitized Context Views |
|---|---|---|
| Store | `zeno-rawstore` (own process, own DB, own key per zone) | `zeno-viewstore` (own DB, key per zone) |
| Mutability | append + expire | **immutable** — a change produces a new view with a new `view_id` |
| Readers | `zeno-gateway` only | the one consumer named in the view key, and no other |
| Model access | never | only via the sink the view was built for |
| Default TTL | shortest satisfying the purpose | the view's own `expiry` field |
| Contains | bytes, or a pointer + keyed digest | transformed content + manifest |

### 3.3 The exact view key

A view is identified by a **22-field key**. Two views differing in any single field are different views with different `view_id`s and are **not interchangeable**. Replaying view A into sink B is denied and is a tested failure (ARCH-TEST-06; SAN-AC-02 *"wrong-view replay denial"*).

| # | Field | Type | Why it is in the key |
|---|---|---|---|
| 1 | `source_revision` | source system + stable revision/commit/message-id + span | Content changes ⇒ the view is stale, not merely old |
| 2 | `user` | opaque owner id | Single-user today; still keyed, so multi-identity is not a rewrite |
| 3 | `workspace` | opaque workspace id | |
| 4 | `repository` | opaque repo id | Repo names are class I1 — keyed, never plaintext, in the public part of the key |
| 5 | `task` | opaque task id | A view built for WEBEXT-3514 is not valid for WEBEXT-3462 |
| 6 | `purpose` | enum | `task-context`, `code-edit`, `review`, `briefing`, `meeting-summary`, `retrieval-index`, `notification`, `export`, `support-bundle`, `evaluation` |
| 7 | `consumer` | component id | `zeno-forge`, `zeno-counsel`, … |
| 8 | `sink_class` | enum of 12 | |
| 9 | `sink_id` | registry id | The concrete sink, not just its class |
| 10 | `model` | model id or `none` | |
| 11 | `provider` | provider id or `local` | |
| 12 | `account` | opaque account id | Same provider, different account ⇒ different view |
| 13 | `region` | region code or `on-device` | |
| 14 | `recipient` | opaque recipient id(s) or `none` | Changing a recipient invalidates the view **and** any approval bound to it |
| 15 | `device_privacy_state` | enum | `private-unlocked`, `private-locked`, `wearable`, `shared-display`, `untrusted-network`, `unknown` — `unknown` resolves to the **most exposed** |
| 16 | `policy_version` | `pol-YYYY.MM[.N]` | |
| 17 | `detector_version` | `det-YYYY.MM[.N]` | A detector bump invalidates every view built under the old one for **egress** purposes |
| 18 | `zone` | `personal` \| `company` \| `public` | |
| 19 | `acl` | opaque ACL id | |
| 20 | `consent` | consent-record id or `n/a` | Meeting consent, biometric consent, third-party consent |
| 21 | `retention` | ISO-8601 duration | |
| 22 | `expiry` | absolute instant | Distinct from retention: retention is the policy, expiry is this view's deadline |

**Derivation.**

```
key_object   := { the 22 fields, each already an opaque id or an enum }
canonical    := RFC-8785 JSON Canonicalization Scheme(key_object)
view_id      := HMAC-SHA-256(zone_key, canonical)      # keyed, not plain — field values are low-entropy
key_material := AEAD-encrypt(zone_key, canonical)      # stored beside the view, readable only by the gateway
```

**A tension worth naming.** §9.1 requires the key to bind repository, path, task and account — and §9.1 *also* says those very identifiers may themselves be sensitive and that ordinary receipts must use opaque IDs and keyed digests. Both are correct; taken naively they conflict, because a plain key would leak exactly what receipts must not carry. The resolution above is deliberate: the **public** identifier is a keyed digest (`view_id`), the **field values** live only in AEAD-encrypted key material that no sink ever receives, and receipts quote `view_id` alone. This resolves the tension inside the design; it is not an owner decision. It *is* a rule that will be violated the first time someone logs a view key for debugging, which is why ARCH-TEST-06's low-entropy-plain-hash scan exists.

```mermaid
flowchart TB
  SRC["Source revision + span"] --> RQ["Raw Evidence / Quarantine<br/>encrypted per zone, short TTL"]
  RQ --> DET["Detector pipeline §6<br/>deterministic first"]
  DET --> CL["Class set + confidence + spans"]
  CL --> PDP["Policy decision point<br/>zone, ACL, consent, tier, sink contract"]
  K["22-field view key §3.3"] --> PDP
  PDP --> TR["Transformation plan<br/>per span, per class §3.4"]
  TR --> VW["SanitizedView<br/>immutable, view_id = HMAC(zone_key, JCS(key))"]
  VW --> MAN["Context manifest §3.6"]
  VW --> SINK["The one sink named in the key"]
  TR -.->|"tokenized spans only"| TV["Token Vault §4<br/>separate process"]
```

### 3.4 The transformation vocabulary

Exactly nine. No others exist. A transformation not in this list cannot be expressed in the policy language.

| Transform | Semantics | Reversible? | By whom | Leakage profile |
|---|---|---|---|---|
| **allow** | Verbatim | n/a | — | Full content. Only for classes the sink contract permits verbatim. |
| **omit** | Span removed; the *fact of removal* is recorded in the manifest with class and count, not in the text | no | — | Length and position may leak; the manifest carries the count so the consumer knows something was removed. |
| **mask** | Structure-preserving partial reveal, e.g. `****1234` | no | — | **Leaks a prefix/suffix.** Forbidden for every S* class (§3.7) — the last four characters of a token are confirmation material for a guess. Permitted for F* (payment card last-4) and some P* where the sink contract explicitly names it. |
| **typed placeholder** | Replaced by `<CLASS:ROLE:NN>`; the index `NN` is scoped to the view | no | — | Leaks class, role and count. That is the point: it preserves referential structure so a model can reason about "the API token" without seeing it. |
| **pseudonymize** | Stable surrogate derived as `HMAC(scope_key, normalized_value)` truncated to a readable label | not by the consumer | gateway, within scope only | Stable **within a declared scope** — one task, one meeting, one repository. **Never a universal pseudonymous identity graph.** Scope keys are rotated per scope; the same person is a different pseudonym in a different scope, by construction. |
| **tokenize** | Replaced by a placeholder plus an opaque **handle**; the real value is in the Token Vault | **yes**, and only there | the authorized destination adapter, just in time (§4) | The only reversible transform. The handle is useless without the vault and the adapter. |
| **summarize** | Lossy model-derived abstraction | no | — | **Model-derived ⇒ mandatorily re-scanned at stage 4.** A summary can reconstruct what the source redacted. |
| **aggregate** | Counts/statistics over ≥ k items | no | — | Small-`k` aggregates re-identify. Minimum `k` is a policy parameter with a floor of 5 for personal data; below the floor the transform degrades to `block`. |
| **block** | The item does not enter the view at all; the view records the omission and the utility loss | no | — | The strongest transform. Where a required item is blocked, §0's four-option ladder applies. |

### 3.5 Placeholder grammar

```
placeholder := "<" CLASS ":" ROLE ":" INDEX ">"
CLASS       := one of the class codes in §5
ROLE        := UPPER_SNAKE, drawn from a closed per-class vocabulary
INDEX       := 2-digit, scoped to this view
```

Examples from §9.1, adopted verbatim: `<SECRET:API_TOKEN:01>`, `<PERSON:PM:02>`, `<PATH:WORKTREE:01>`.

Rules:

- The **index is view-scoped**, so `<PERSON:PM:02>` in view A and view B need not be the same person. Cross-view stable identity requires `pseudonymize` with an explicit declared scope, and even then the scope is bounded.
- `ROLE` comes from a closed vocabulary so that a role cannot itself become a leak (`<PERSON:CEO_OF_ACME:01>` is not expressible).
- A placeholder is **not** a secret. It is safe in prompts, plans, UI and manifests. That is what makes typed placeholders the default transform for S* classes.
- Placeholders are **round-trip stable within a view**: the same source span always yields the same placeholder in that view, so a model can refer back to it.

### 3.6 The context manifest

Every view ships with a manifest. The manifest is the honesty surface — it is what makes an omission *visible* rather than silent.

```jsonc
{
  "view_id": "<keyed digest>",
  "included_classes":  [{"class":"E1","transform":"allow","spans":37}],
  "excluded_classes":  [{"class":"S2","transform":"block","count":2,"reason":"sink contract denies S* at SK-MODEL-EXT"}],
  "transformed_classes":[{"class":"P1","transform":"typed placeholder","count":4}],
  "source_version":   "<opaque source rev id>",
  "consumer_version": "zeno-forge@<semver>",
  "sink_version":     "SK-MODEL-EXT-...@<contract hash>",
  "detector_version": "det-2026.08",
  "policy_version":   "pol-2026.08",
  "destination":      {"provider":"<id>","account":"<opaque>","region":"<code>"},
  "residual_risk":    {"reidentification":"low|medium|high","basis":"<rule id>"},
  "expiry":           "<instant>",
  "evidence_pointer": "zeno://evidence/<opaque>",   // locally resolvable only
  "utility_loss":     [{"measure":"symbol_mapping","delta":0.00}]
}
```

`evidence_pointer` is **locally resolvable only**. It is a `zeno://` URI that means nothing off-device and cannot be dereferenced by a model or an external recipient.

### 3.7 Class × transform eligibility matrix (abridged)

The full matrix is generated from the policy and asserted in tests. The rows that carry hard rules:

| Class | allow | omit | mask | placeholder | pseudonymize | tokenize | summarize | aggregate | block |
|---|---|---|---|---|---|---|---|---|---|
| **S\*** secrets | **never** | ✓ | **never** | ✓ default | never | ✓ (adapter-only) | never | never | ✓ |
| **B\*** biometric/voiceprint | never off-device | ✓ | never | ✓ | scope-bounded | never | never | ✓ (k≥5) | ✓ |
| **H, M** health, minor | never external | ✓ | never | ✓ | never | never | never | ✓ (k≥5) | ✓ default |
| **P\*** personal identity | sink-specific | ✓ | sink-specific | ✓ | ✓ scoped | never | ✓ + rescan | ✓ | ✓ |
| **E1** employer code/diff | ✓ **local company zone only** | ✓ | never | ✓ | never | never | ✓ + rescan | ✓ | ✓ |
| **I2** paths/filenames | company-local ✓ | ✓ | ✓ | ✓ | ✓ scoped | never | ✓ | ✓ | ✓ |
| **U** unclassified | never | ✓ | never | ✓ | never | never | never | never | ✓ default |

Two rules deserve emphasis because they are the ones most likely to be argued away later:

- **`mask` is never valid for a secret.** Showing `sk-...4f2a` narrows an attacker's search space and confirms a guess. If a human needs to identify *which* token, the placeholder role does that job (`<SECRET:API_TOKEN:01>` plus a manifest line naming the credential's registry entry).
- **`allow` on E1 is not over-redaction; it is the requirement.** §9.1 is explicit: *"Do not over-redact authorized company code inside the approved local company zone: preserve the minimum complete symbols, types, line mapping and surrounding logic needed for Forge."* Over-redaction inside the company zone is a **defect measured by the utility gate** (§12.4), on the same footing as a leak.

---

## 4. The local token vault and just-in-time rehydration (SAN-AC-03)

### 4.1 Position

The Token Vault is a store **inside `zeno-broker`**, a process that:

- has **no model client** linked into it — not disabled, *absent*, asserted by ARCH-TEST-02;
- has **no logging sink** other than a categorical event counter;
- has **core dumps disabled** unconditionally;
- **zeroizes** secret buffers on drop and `mlock`s them where the OS permits;
- is unavailable to models, plugins, logs and external providers — by process boundary, not by policy text.

### 4.2 Two-hop indirection

```
view text     :  Authorization: Bearer <SECRET:API_TOKEN:01>
view manifest :  { placeholder: "<SECRET:API_TOKEN:01>", handle: "h_9f3c…" }   // opaque, single-use-bound
token vault   :  handle → { credential_ref, zone, allowed_sinks[], allowed_adapters[], tier_required }
```

The **handle is not the secret** and is not even a stable identifier for the secret — it is minted per view, bound to that view's `view_id`, and expires with the view. A handle that leaks buys nothing: without the adapter identity, the approval hash and the TTL, it exchanges for nothing.

### 4.3 The rehydration rule

Rehydration is permitted **only** when all seven conditions hold. Any one failing is a denial, and denial is the default.

1. The caller is a **registered destination adapter** whose `sink_id` appears in the handle's `allowed_sinks`.
2. The adapter's identity is verified by the broker (process attestation / socket peer credentials), not asserted by the caller.
3. **Policy already authorizes the effect** — the T2/T3 approval exists, is fresh, and is bound to the final payload hash. Rehydration does not authorize; it executes something already authorized. (§0.)
4. The payload hash presented to the broker **matches** the approved hash.
5. The handle is **within TTL** and **single-use**; the broker marks it consumed atomically.
6. The target of injection is a **transport-level slot** — an HTTP header, a spawn-time environment variable, a credential-helper response, a file descriptor — never a serialized payload field.
7. The materialization happens **below the logging/tracing layer**, so the traced payload is the pre-rehydration one.

### 4.4 The six places a secret may never be rehydrated into

Stated as an enumerated prohibition because it is the rule most likely to be eroded by a convenience patch:

1. a **prompt** (any part of any message to any model, local or remote);
2. a **command plan** (the shell/tool plan the agent produces or the user reviews);
3. a **UI trace** (execution stream, Observable Execution Stream, debug panel, Workstation Control Center);
4. a **notification** (any surface in `SK-UI-*`);
5. an **export** (any `SK-EXPORT-*`);
6. a **model-visible tool result**.

```mermaid
sequenceDiagram
  participant M as Model
  participant A as Zeno agent
  participant G as zeno-gateway
  participant H as Human approval
  participant B as zeno-broker + Token Vault
  participant D as Destination adapter
  participant X as External system

  A->>G: request view for purpose+sink
  G-->>A: SanitizedView with "<SECRET:API_TOKEN:01>" + handle in manifest
  A->>M: prompt containing the placeholder only
  M-->>A: proposed request, still carrying the placeholder
  A->>G: stage 9 rebuild + rescan destination-bound view
  G-->>H: exact preview, recipient, classes, omissions, residual risk
  H-->>G: approve, bound to final payload hash
  G->>D: payload with placeholder + handle + approval hash
  D->>B: exchange handle, present adapter identity + payload hash
  B-->>B: verify 7 conditions §4.3
  B-->>D: credential material, transport slot only, single use
  D->>X: HTTP header carries the credential
  Note over M,H: The model, the plan, the UI, the trace,<br/>the notification and the log never contained it.
```

### 4.5 Concrete adapter rules

- **HTTP:** credential goes into a header set by the transport layer after serialization of the logged body. Never into a query string, never into a URL path, never into a JSON body field.
- **Shell:** never in `argv` — `argv` is world-readable via `ps` on both macOS and Windows. Injected as a spawn-time environment variable for the child only, or written to a pipe FD the child reads. Never appended to shell history. The plan the human reviews shows `<SECRET:…>`.
- **Git:** served through a credential helper the broker implements. Never `https://user:token@host` in a remote URL — that form lands in `.git/config`, in reflog output, and in error messages.
- **Cloud / Kubernetes:** short-lived credential materialized into an ephemeral, zeroized config the child process reads once; never a long-lived kubeconfig or credentials file left on disk.
- **Database:** connection strings are class S8; the DSN in the plan is `<SECRET:DSN:01>` and the adapter assembles the real one at connect time.

### 4.6 T4 boundary

Reveal or export of secrets is **T4 — deny** (master prompt line 930). There is no sink, no override, no flag, no debug mode and no false-positive override (§12.6) that produces a path from the Token Vault to a human-readable or exportable surface. A secret *rotation* workflow, if ever built, is a separate design with its own ADR — not a relaxation of this one.

---

## 5. Classification taxonomy

Class codes are stable, machine-readable, and appear in placeholders, manifests, policies and metrics. **`U` is the default for anything unrecognized, and `U` takes the most restrictive applicable persistence and egress policy.**

### 5.1 Secrets and credentials — `S`

| Code | Class | Primary detector |
|---|---|---|
| S1 | **Registered secret** — a value the owner has registered with the gateway | Registered-secret index (§6.2); **zero release-suite escapes required** (§12.3) |
| S2 | Credential formats with checksums/prefixes — provider tokens, API keys | Format + checksum parsers |
| S3 | Private-key material — PEM, PKCS#8, OpenSSH, JWK with `d`, PGP secret blocks | Structural parsers |
| S4 | Cookies, session identifiers, authorization headers, bearer/JWT | Header/format parsers |
| S5 | Recovery codes, backup codes, one-time seeds, TOTP secrets | Format + context |
| S6 | Signed/pre-signed URLs, capability URLs | Query-parameter signature detection |
| S7 | Environment secrets — `.env`, CI variables, keychain exports | File-type + key-name + entropy |
| S8 | Database connection strings / DSNs | Scheme + credential-bearing URI parse |
| S9 | Cloud and Kubernetes credentials — access keys, service-account JSON, kubeconfig, cloud CLI caches | Structural parsers |

### 5.2 Person-related

| Code | Class | Notes |
|---|---|---|
| P1 | Identity — names, government identifiers, employee IDs | |
| P2 | Contact — email, phone, handles, addresses | |
| P3 | Location — precise or inferable | |
| P4 | Device/account identifiers tied to a person | |
| F | Financial / payment | |
| H | Health | Fail-closed on uncertainty |
| HR | HR / employment — performance, compensation, disciplinary | |
| L | Legal / privileged | |
| **B** | **Biometric / voiceprint — speaker embeddings** | **[V]** Speaker embeddings are **Art. 9 GDPR special-category data** and personal data under India's DPDP Act; owner and the NeoSapien vendor are both India-domiciled (C-032; L5 §3.5, §8 risk 7). Controls: embeddings **never leave the device**; **own retention clock independent of transcripts**; **independently deletable** without deleting the meeting record. Additionally, the cloning path must be **structurally unable to read from the meeting-capture store** — enforced by data-path separation, not policy text (L5 §3.6). |
| MC | Meeting-consent state | A view over meeting content is invalid unless the consent record referenced in view-key field 20 is satisfied. Cross-ref COUNSEL-AC-04. |
| M | Minor data | Fail-closed |

### 5.3 Employer-confidential — `E`

| Code | Class |
|---|---|
| E1 | Code and diffs |
| E2 | Designs and design intent |
| E3 | Incidents and postmortems |
| E4 | Customer material |
| E5 | Internal endpoints, infrastructure, topology |

### 5.4 The E1 asymmetry — the most misunderstood rule in this design

E1 has **two opposite correct behaviours** depending on the sink:

- At `SK-MODEL-LOCAL-COMPANY` — inside the approved local company zone — E1 is `allow`, and the gateway must **preserve the minimum complete symbols, types, line mapping and surrounding logic Forge needs**. Redacting a variable name here does not make anything safer; it makes Forge produce a wrong patch. This is measured as **utility loss** and gated at release (§12.4).
- At `SK-MODEL-EXT-*` and every `SK-EXPORT-*` — E1 is reduced or blocked.

Getting this backwards in either direction is a release-blocking defect. Over-redaction is not the safe side of the trade; it is the *other* failure mode, and §12 measures both.

### 5.5 Identifiers and metadata — `I`

| Code | Class |
|---|---|
| I1 | Repository / workspace / account identifiers |
| I2 | Paths and filenames |
| I3 | Branch names |
| I4 | Screenshots and OCR text |
| I5 | Audio and transcripts |
| I6 | Identifying metadata — EXIF, document properties, timestamps precise enough to identify |

### 5.6 Derivatives, licensed material, and unknown

| Code | Class | Notes |
|---|---|---|
| T | Third-party licensed / copyrighted, and purpose-limited content | Cross-ref: the corpus already carries a hard example — Apple's font licence forbids non-Apple-OS mock-ups and any embedding **[V]** (L5 §1.A.15). |
| **U** | **Unknown / unclassified** | **Takes the restrictive applicable persistence and egress policy.** Never "allow because nothing matched." |

**The derivative rule.** Any artifact produced *from* a classified item inherits that item's class set until it is re-classified by a fresh detector pass. This applies to summaries, embeddings, graph properties, cache entries, screenshots of a rendered view, and model output. There is no transformation that launders a class by producing a new representation of it.

---

## 6. The detector pipeline — deterministic first (SAN-AC-04, SAN-AC-05)

### 6.1 Ordering

```mermaid
flowchart TB
  IN["Input bytes"] --> T0["Type and size validation<br/>bounded"]
  T0 --> S1["Pre-canonicalization scan"]
  S1 --> CAN["Bounded canonicalization and decoding<br/>depth, ratio, entry, byte, time limits"]
  CAN --> S2["Post-canonicalization scan"]
  S2 --> D1["1 Registered-secret match<br/>never logs secret values"]
  D1 --> D2["2 Credential formats, checksums, private-key parsers"]
  D2 --> D3["3 Entropy plus context rules"]
  D3 --> D4["4 Repository and code-aware parsers"]
  D4 --> D5["5 Organization DLP and classification metadata"]
  D5 --> D6["6 Data-zone and consent policy"]
  D6 --> D7["7 PII and entity detectors"]
  D7 --> D8["8 Destination allowlists"]
  D8 --> D9["9 Attachment, malware, type validation"]
  D9 --> AMB{"Residual ambiguity<br/>on a non-secret class?"}
  AMB -- no --> OUT["Class set, spans, confidence"]
  AMB -- yes --> MC["10 Model-assisted classifier<br/>local sandbox, AFTER S* tokenized<br/>advisory only"]
  MC --> OUT
  OUT --> POL["Policy decision point"]
```

Deterministic detectors 1–9 run **always**. The model-assisted tier 10 is optional, advisory, and structurally subordinate.

### 6.2 Registered-secret matching without logging secret values

The index never stores a secret. For each registered secret it stores:

```
{ id, hmac_full = HMAC(index_key, normalize(secret)),
  hmac_ngrams  = [HMAC(index_key, normalize(g)) for g in rolling_ngrams(secret, n=16)],
  length, charset_profile, registered_at, zone }
```

Matching runs a rolling HMAC over normalized input and compares against `hmac_ngrams`. This gives three properties that matter:

- the secret is **never at rest** in the detector;
- **partial** and **split** occurrences are caught — a credential broken across two chunks, or across a template boundary, still matches on n-grams;
- a detection event records `{id, span, class}` and never the matched text.

`n = 16` is a design parameter chosen so that a 16-character window has enough entropy to make false collisions negligible for real credentials while still catching a secret split roughly in half. It is tuned against the corpus at release (§12).

### 6.3 Scanning before and after bounded canonicalization

Scanning only after decoding misses content that decoding destroys; scanning only before misses content decoding reveals. Both passes run.

**Bounded** is not a hedge — it is a hard set of limits, and exceeding one produces a classification, not a crash:

| Limit | Default | Exceeding it means |
|---|---|---|
| Archive nesting depth | 4 | `archive-bomb-suspected` → class U → restrictive policy |
| Expansion ratio | 200:1 | same |
| Entry count | 10,000 | same |
| Total decompressed bytes | 256 MiB | same |
| Decode chain length (base64 → gzip → base64 …) | 3 | `encoding-chain-exceeded` → class U |
| Wall clock per item | 10 s (target; see §12.5 on B-002) | `parse-timeout` → class U → **fail closed** |

Forms covered: encoded (base64, URL, hex, quoted-printable), compressed, nested archives, structured fields (JSON/YAML/TOML/XML values, JWT segments), image/OCR, and audio/transcript. **No recursive decoding without a bound, ever.**

### 6.4 The model-assisted classifier tier — four hard constraints

1. It runs **in an approved local sandbox** (`SK-MODEL-CLASSIFY-SANDBOX`), never at a remote provider.
2. It runs **only after prohibited secrets are tokenized** — it can never see raw credentials.
3. It **cannot decide policy**. Its output is a class-confidence hint consumed by the policy decision point.
4. It **cannot override a deterministic block**. If detector 1–9 says block, the item is blocked, full stop.

**[U] / blocked on B-002:** whether this tier can run at all on the pilot machine is unknown, because the Windows pilot machine's CPU/GPU/RAM are unknown (U-01/B-002). The tier is therefore **off by default**, and the gateway's correctness targets in §12 are stated for the deterministic pipeline alone. No release threshold in this document depends on the model tier existing.

---

## 7. The nine enforcement stages

> **Sanitization never creates authorization.** Restated at every stage below, because every stage is a place where someone will eventually be tempted to treat a redaction as a permission.

```mermaid
flowchart LR
  S1["1 INGRESS"] --> S2["2 PROMPT / MODEL"]
  S2 --> S3["3 TOOL / MCP"]
  S3 --> S4["4 MODEL OUTPUT"]
  S4 --> S5["5 UI / NOTIFICATIONS"]
  S4 --> S6["6 LOGS / TELEMETRY / SUPPORT"]
  S4 --> S7["7 MEMORY / VAULT / EMBEDDINGS / GRAPH"]
  S7 --> S8["8 STORAGE / CACHES / BACKUPS / DEV PREVIEW"]
  S4 --> S9["9 EXPORTS / TRAINING / EXTERNAL ACTION"]
  S3 -.->|"tool output re-enters as untrusted"| S1
  S4 -.->|"generated artifacts re-enter as untrusted"| S1
  S9 -.->|"approval binds to FINAL payload hash"| S9
```

### Stage 1 — Ingress

`inventory/authorize → raw quarantine or authoritative pointer → bounded type/archive parsing and canonicalization → pre/post scans → classification/ACL/consent → purpose-bound view.`

Authorization is checked *first*: an item outside the Workspace Context Scope Record is not ingested and then filtered — it is not ingested. Passing ingress admits an item to quarantine only; it grants no consumer anything. *(Sanitization never creates authorization.)*

### Stage 2 — Prompt / model

Assemble only consumer-bound views, plus a manifest naming source, scope, omissions and expiry.

> **Re-scan the final joined prompt.** This is not redundant with stage 1. Templating and chunk joining **can reconstruct a secret** that no individual fragment contained: a template writes `Authorization: Bearer ` and a retrieved chunk supplies the token; two adjacent chunks each hold half of a key; a system preamble supplies the prefix a detector needed for context. Fragment-level scanning is structurally incapable of catching these. The joined-prompt scan runs the full deterministic pipeline over the **exact bytes that will be sent**, after every substitution, with the rolling n-gram matcher of §6.2 spanning fragment boundaries.

Bind model, provider, account, region and retention to the **view hash**. A provider swap, an account swap or a region change produces a different view key (§3.3 fields 10–13) and therefore requires a different view — a model-routing fallback cannot silently move content to another provider. Cross-ref CAP-AC-03 (automatic plan repair may choose only an equal-or-lower-risk authorized path in the same identity, scope and data zone) and PROVIDER-ETHICS-AC-01 (no key cycling, no account farming, no rate-limit evasion). *(Sanitization never creates authorization.)*

### Stage 3 — Tool / MCP

Sanitize **arguments** before the call and **every returned text, file, image and link** before the model sees them. Broker required secrets directly to the adapter (§4) — never through the model, never through the plan.

Keep server output **untrusted even after the server is approved**. Approval of a server is approval to *call* it; it is never a statement about what it returns. MCP-specific posture, all consequences of **[V]** C-026 and L5 §8 risk 6:

- **stdio and Streamable HTTP only.** HTTP+SSE rejected at design time.
- **Sampling rejected at design time** — deprecated, and any design assuming free inference on the owner's subscription is dead (L5 §7.8).
- `server/discover` output — the tool manifest — is **content-hashed and human-approved**; a hash change forces re-approval (L5 §3.1).
- Deny-by-default network egress per server; no host filesystem mount outside an explicit allowlist.
- Budget a **port, not a bump**, when the SDKs catch up; per-SDK support for the new revision is **[U]** for all SDKs (L5 §8 risk 6).

*(Sanitization never creates authorization: an approved tool cannot grant itself a broader scope by returning text that says it may.)*

### Stage 4 — Model output

Re-scan generated **text, code, patch, command, image/screenshot, attachment and citation** before display, preview, persistence or action. A model can reconstruct or repeat sensitive material: it can echo a placeholder's real value if it saw it in an earlier turn, infer a redacted name from context, or reproduce a licensed passage.

Model output re-enters the pipeline as **untrusted ingress** (the dashed edge in the stage diagram). A patch Forge generates is not automatically safe to write to disk, to show in a HUD, or to attach to an MR. *(Sanitization never creates authorization: the model saying an action is fine is not an approval.)*

### Stage 5 — UI / notifications

Derive a **surface-specific view**. The `SK-UI-*` ladder of §2.4 is the policy; `device_privacy_state` (view-key field 15) is the input. `unknown` resolves to the most exposed state.

The most exposed surfaces default to **Approval needed** with no person, no ticket, no repository, no branch, no path, no excerpt, no payload. (SAN-AC-06.) *(Sanitization never creates authorization: a notification tap can navigate to a review, and can never carry an approval token or cause execution — master prompt line 934.)*

### Stage 6 — Logs / telemetry / support

Allowlisted structured schemas, random non-secret correlation IDs, categorical error codes. Excluded by default: prompts, model and tool bodies, source, diffs, paths, identities, audio, transcripts, screenshots, clipboard.

Vendor hooks (`beforeSend`, filter functions, scrubbers) are **defence in depth, not the primary boundary** — the payload is schema-constrained before it reaches them, so a hook misconfiguration cannot open a leak on its own. Session replay and autocapture **disabled by default**.

Support bundles are generated locally, scanned, **previewed**, and approved before sharing. *(Sanitization never creates authorization: a support bundle does not become shareable because it was redacted; it becomes shareable when the owner approves the specific redacted bundle.)*

### Stage 7 — Memory / Vault / embeddings / graph

Commit only reviewed sink-authorized sanitized facts or evidence pointers.

- **Embeddings are built from the authorized sanitized view** — never embed raw then redact the results. There is no code path that hands raw text to an embedding model; the embedding model call is itself a registered sink taking a `SanitizedView`.
- Minimize graph properties; exclude secrets from labels, vectors and metadata. Note that a **graph label** is a common leak — `Person:"jane.doe@acme.com"` puts a P2 value into a schema element, where it survives property-level redaction.
- Obsidian and externally synced Vaults receive **separate approved projections** — never the same view as the local one. (Obsidian sink is `declared-absent`; see §2.4 class 6 and §15 CSG-C1.)
- Cross-ref MEMORY-AC-02: only explicit statements, accepted corrections, approved outcomes and reviewed repeated evidence may be promoted to durable memory. A raw meeting transcript cannot become a permanent preference.

*(Sanitization never creates authorization: a sanitized fact does not acquire the right to be replicated to a paired device; that is `SK-MESH-*` with its own contract.)*

### Stage 8 — Storage / caches / backups / dev previews

Propagate **zone, ACL, source lineage, policy/detector version, transformations, TTL and deletion state** with every stored item. Encrypt by zone. Prevent plaintext temp, swap and core-dump leakage. Prevent cross-zone cache leakage — including via cache **keys**, which are HMACs under the zone key.

**Local dev preview containment (SAN-AC-12).** A Flask/FastAPI/Vite/Next preview:

- runs **unprivileged**, as a distinct low-privilege identity;
- binds **loopback only**, on a random port, with a lease;
- has **debug console and reloader disabled** — Werkzeug's debugger is a remote code execution surface by design, and Vite/Next dev servers expose filesystem paths;
- enforces `Host`/`Origin` checks (DNS-rebinding defence), CORS, CSRF, WebSocket-origin checks, auth and rate limits as applicable;
- serves from a **narrow sanitized-view API** and **cannot reach raw quarantine or the privileged executor** — enforced at layer 2, so a path-traversal bug in the preview yields `EACCES` rather than raw bytes;
- runs against **sanitized fixtures**, never live data (cross-ref DEV-SERVER-AC-01);
- uses a **clean QA browser profile** with no employer sessions (cross-ref L5 §3.3).

> **[U] SAN-AC-12 cannot be verified on this machine before Gate 3.** This Mac is the work Mac; Phase-0 artifacts only; no suite runtime, permission request or privileged action before Gate 3 **and** the owner's exact sentence "Approve work-Mac pilot" **[V]** (A-02, scope record v1). The verification is designed here and executed on the Windows pilot. See §15 CSG-C5.

### Stage 9 — Exports / training / external action (SAN-AC-08)

**Rebuild and re-scan a destination-specific view immediately before** any model training or evaluation, provider call, Slack/email/Jira/Git publication, file share, support upload or other external write. Not "reuse the view from stage 2" — **rebuild**, because recipients, policy version, detector version and device state may all have changed since.

Show: exact recipient and provider, included classes, transformations, omissions, residual re-identification risk, and irreversible effects.

**Bind approval to the final sanitized payload hash.** A changed recipient or a changed payload invalidates the approval (APPROVAL-BINDING-AC-01). One commit attempt per approval; a timeout or crash with uncertain effect becomes **Outcome unknown** and blocks automatic retry (OUTBOX-AC-01).

*(Sanitization never creates authorization — and this stage is where that matters most. A redacted export to a **new** recipient is a **new** authorization decision, not a continuation of the old one.)*

---

## 8. Prompt injection is a separate problem from secrecy (SAN-AC-04)

Secrecy asks *what may leave*. Injection asks *what may command*. A perfect redactor provides no injection defence, and a perfect injection detector provides no secrecy. They share a pipeline and nothing else.

**Structural isolation, not delimiters.** Source content is carried as typed, quoted **untrusted data** in a structurally separate channel from system/developer/tool policy. Wrapping hostile text in `<untrusted>…</untrusted>` prose markers is not isolation — the markers are themselves text the attacker can forge. Isolation means the content occupies a message role and a schema field that the policy layer never reads as instruction.

**Neutralized at parse time:** hidden text (zero-width, white-on-white, off-screen, HTML comments), bidirectional control characters, Unicode confusables and homoglyphs, HTML/script/macros, embedded links, tool-like JSON that mimics a function call, encoded instructions, and **instructions split across chunks**. A quarantined evidence pointer to the original is preserved where authorized, so the neutralization is auditable.

**The seven things a source can never do**, regardless of what it says:

1. broaden access;
2. disable or reconfigure sanitization;
3. alter an allowlist;
4. choose a provider;
5. authorize a tool;
6. supply an approval;
7. change an action tier.

**The backstop.** Deterministic policy still blocks the effect **even when the injection detector misses it**. This is the design's most important injection property: injection defence is not load-bearing for safety. If a poisoned MCP tool description convinces the model to exfiltrate a repository, the model can *ask*; the request fails at `SK-EXPORT-*`, which requires a T2 approval bound to a payload hash that a human saw. Detection reduces noise and improves the audit trail; the policy engine prevents the effect.

Cross-ref SWE-SEC-AC-01 (prompt-injection boundary tests in security review) and L5 §3.1.

---

## 9. The Sanitization Lineage DAG and the deletion cascade (SAN-AC-09)

### 9.1 Node and edge types

```mermaid
graph TD
  SRC["SourceRevision<br/>system + rev + span"] --> RAW["RawItem<br/>quarantine or pointer"]
  RAW --> PARSE["ParsedElement<br/>post-canonicalization"]
  PARSE --> VIEW["SanitizedView<br/>view_id"]
  VIEW --> FRAG["PromptFragment"]
  FRAG --> JOINED["JoinedPrompt<br/>rescanned §7.2"]
  JOINED --> MOUT["ModelOutput"]
  VIEW --> TOUT["ToolOutput"]
  TOUT --> MOUT
  MOUT --> SUM["Summary"]
  SUM --> PACK["ContextPack"]
  MOUT --> PACK
  PACK --> MEM["Memory"]
  PACK --> NOTE["Vault / Obsidian note"]
  VIEW --> EMB["Embedding / vector"]
  VIEW --> GNODE["Graph node or edge"]
  MOUT --> CACHE["Cache entry"]
  PACK --> EXP["Export"]
  PACK --> CAND["Eval or training candidate"]
  NOTE --> REPL["Mesh replica"]
  MEM --> REPL
  ANY["any durable node"] --> BAK["Backup"]

  EXP -.-> EXT["External system<br/>outside our control"]
  JOINED -.-> PROV["Provider retention<br/>outside our control"]
```

Every node carries: `node_id` (opaque), `kind`, `parents[]`, `view_id` where applicable, `class_set`, `zone`, `policy_version`, `detector_version`, `created_at`, `expiry`, `deletion_state`.

Every node is created **by the gateway**, at the moment the corresponding sink write happens. A sink write that does not produce a lineage node fails ARCH-TEST-03. This is what makes the DAG complete rather than best-effort: it is a side effect of the only path that exists, not a bookkeeping discipline.

### 9.2 Triggers

Six events start a cascade:

1. **source correction** — the upstream content changed;
2. **classification change** — a re-scan under a newer detector reclassifies an item upward;
3. **ACL change**;
4. **consent change or withdrawal** — including a meeting participant withdrawing consent, which takes effect at once (COUNSEL-AC-04);
5. **expiry**;
6. **revocation or deletion** — owner-initiated.

### 9.3 The cascade algorithm

```mermaid
flowchart TB
  T["Trigger on node N"] --> R["Compute forward reachability<br/>all descendants of N in the DAG"]
  R --> P["Partition descendants by store"]
  P --> A["Deletable now<br/>raw, views, prompts, caches, memories,<br/>Vault notes, graph nodes, candidates"]
  P --> B["Requires index rebuild<br/>vectors"]
  P --> C["Requires device reachability<br/>Mesh replicas"]
  P --> D["Requires expiry<br/>backups"]
  P --> E["Outside our control<br/>provider retention, already-sent exports,<br/>model weights"]
  A --> DEL["Delete content, write tombstone"]
  B --> REB["Tombstone the row, then rebuild the index<br/>within the disclosed SLA"]
  C --> QUE["Queue a revocation per device;<br/>report each device state independently"]
  D --> EXPY["Record the backup set and its expiry date;<br/>disclose it, do not hide it"]
  E --> DISC["Disclose the limitation honestly<br/>SAN-AC-09"]
  DEL --> INV["Invalidate every pending export/action<br/>bound to a deleted payload hash"]
  REB --> INV
  QUE --> INV
```

**Vector deletion deserves its own note [I].** Removing a row from an approximate-nearest-neighbour index does not remove that vector's influence on the graph structure in HNSW-family indexes, and a "deleted" vector can remain reachable as a traversal waypoint. The honest design is: tombstone immediately (so it is never *returned*), then **rebuild the index** within a disclosed SLA, and state that between tombstone and rebuild the deletion is logical, not physical. Claiming otherwise would be the kind of plausible-sounding falsehood this corpus exists to prevent.

**Pending exports and actions.** Any queued or approved-but-uncommitted external action whose payload hash includes a deleted derivative is **revoked**, not merely warned about. Cross-ref OUTBOX-AC-01.

### 9.4 Resolving append-only audit against erasure

The audit ledger is append-only. Erasure requires removing content. Both requirements are real; the resolution is that **the ledger never contained the content in the first place**.

On deletion, the content is destroyed and only a **minimal non-content tombstone** remains:

```jsonc
{
  "tombstone_id":       "<opaque>",
  "source_id":          "<opaque source id — NOT a path, URL, ticket key or plain hash>",
  "policy_version":     "pol-2026.08",
  "transformation_version": "det-2026.08",
  "deletion_reason":    "revocation | expiry | consent-withdrawal | correction | acl-change | classification-change",
  "deleted_at":         "<instant>",
  "receipt":            "<signed receipt id>"
}
```

**Six fields. Nothing else.** Explicitly **not** retained: deleted raw text, any excerpt, any reversible identifier, any plain hash of a low-entropy value, any class-level content, any recipient name, any path.

The tombstone is scanned by ARCH-TEST-06's tombstone content scan (SAN-AC-09 names it explicitly), which fails if any field carries recoverable content.

### 9.5 Honest disclosure of limits

The gateway **discloses**, in the deletion receipt, every limitation it cannot overcome:

- **Provider retention** — content sent to an external provider is subject to that provider's retention; we can request deletion where an API exists and must state where it does not.
- **Already-sent exports** — a Slack message, an email, a pushed commit. Deletion of our derivative does not retract these; a retraction is a **new separately approved action**, not part of the cascade.
- **Backups** — enumerated with their expiry dates.
- **Offline devices** — each device's revocation state reported independently; an offline device shows `pending`, never `done`.
- **Model weights** — if any training ever occurred (currently `SK-TRAIN-CORPUS` is **disabled**; training eligibility is `none` **[V]**), weight-level deletion is generally not achievable and must be stated as such.

Cross-ref MEMORY-AC-04 (source revocation/deletion cascades through Vault, indexes, graph projections, Obsidian, caches and paired devices).

---

## 10. Fail-closed behaviour (SAN-AC-11)

> **Sanitization never creates authorization** — and neither does the *absence* of sanitization. A gateway that is down does not become permissive.

| Condition | Blocked | Still permitted |
|---|---|---|
| Gateway process unavailable | new model egress, new persistence, all external action | local no-context controls: pause, stop, kill switch, view existing local UI, quit |
| Policy or detector version skew between components | as above | as above |
| Detector timeout on an item | that item only | everything not depending on it |
| Unclassified high-risk content (class U with high-risk signals) | egress and persistence of that item | |
| Disk full in the view store | new persistence and egress | reads of existing views |
| Token vault unavailable | every rehydration → every external action requiring a credential | |

**There is no unsafe fallback.** SAN-AC-11's verification is a *zero unsafe-fallback assertion* — the test suite asserts that no code path exists which, on gateway failure, proceeds with unsanitized content. This is stronger than "the fallback is safe": the fallback does not exist.

**The UI explains the exact degraded state**, in the Zeno Glass truthful-state vocabulary: which component is unavailable, what is consequently blocked, what remains available, and what the owner can do. Unknown checks say **Unknown**, never **Pass** (master prompt line 1359).

---

## 11. Latency and performance posture — blocked on B-002

> **[U] The Windows pilot machine's specifications are UNKNOWN (blocker B-002 / U-01)** — edition/build, CPU, GPU, RAM, storage, displays, audio devices, WSL2/Docker/Hyper-V availability, admin status, security software. **[V]** L5 §5.2 and §8 risk 2: *"every performance and latency claim in this corpus is currently unfalsifiable"* and *"Gate 1 must not accept any latency budget or real-time diarization commitment until B-002 is answered."*

Therefore this document states **no absolute latency commitment**. Instead:

- **Targets, conditional on B-002.** The gateway's per-item scan and per-prompt joined re-scan are *targeted* to be small relative to model time. Numbers will be set once the hardware is known.
- **A relative regression gate, valid today.** Release-to-release, on the *same* machine and the *same* corpus, no p50/p95/p99 may regress by more than 10%. A relative gate is hardware-independent and is therefore committable now (§12.5).
- **Additional [U]:** whether this Mac is Apple Silicon or Intel is not recorded anywhere in the corpus **[V]** (L5 §5.4). It does not affect the gateway's correctness, but it affects every local-model tier, so it belongs on U-01.

---

## 12. Evaluation corpus and release thresholds (SAN-AC-10)

### 12.1 The corpus

**Frozen, versioned, real-shaped, and entirely synthetic.** It is never harvested from `~/Work`, from any employer system, from meeting recordings, or from NeoSapien. This is a hard constraint of the work-Mac boundary **[V]** (A-02) and of the scope record's `training eligibility: none` **[V]**.

| Segment | Contents | Purpose |
|---|---|---|
| **C-CANARY** | Registered-secret canaries across HTTP, shell, Git, cloud, Kubernetes and database fixtures | The zero-escape gate |
| **C-BENIGN-ENTROPY** | Hashes, UUIDs, git SHAs, base64 images, minified bundles, lockfile digests, random test data | The false-positive gate — this is what makes a naive entropy detector unusable |
| **C-CODE** | Source, diffs, paths, logs, stack traces, build output | Utility measurement for Forge |
| **C-MEDIA** | Screenshots with rendered secrets, OCR text, transcripts | Stage 1 image/audio coverage |
| **C-ENCODED** | base64, URL-encoded, hex, gzip, split-across-chunks credentials, template-reconstructed secrets | Stage 2 joined-prompt coverage |
| **C-INJECT** | Unicode/bidi/confusable, hidden text, HTML/script, tool-like JSON, cross-chunk instructions, malicious MCP tool descriptions and results | SAN-AC-04 |
| **C-ARCHIVE** | Nested archives, zip bombs, decode chains at and beyond the bounds | §6.3 bounds |
| **C-PERSONAL** | Representative synthetic personal data across P, F, H, HR, L, B, MC, M | Class coverage |
| **C-COMPANY** | Representative synthetic employer-shaped material across E1–E5 | The **over-redaction** gate — §5.4 |

Every corpus item carries ground-truth spans and classes, so precision and recall are measured per class per span, not per document.

### 12.2 Metrics reported at every detector/policy release

Per class: **precision, recall, false-positive rate, false-negative rate**. Plus **residual leakage** (canary or ground-truth-span tokens observed at a sink whose contract denies that class, per 10k tokens) and **calibration** (model-assisted tier only; expected calibration error over 10 bins, plus a count of over-confident bins).

### 12.3 Correctness thresholds — proposed release gates

These are **hardware-independent** and therefore committable today. They are proposals for owner approval at Gate 1.

| Class | Recall | Precision | FPR ceiling | Notes |
|---|---|---|---|---|
| **S1 registered secrets** | **1.000** | — | — | **Zero release-suite escapes. Non-negotiable, and not overridable by any waiver.** |
| S2–S9 credential formats | ≥ 0.995 | ≥ 0.98 | ≤ 0.02 on C-BENIGN-ENTROPY | FNR ≤ 0.005 |
| B biometric / voiceprint | ≥ 0.99 | ≥ 0.95 | — | Uncertainty fails closed |
| H health, M minor | ≥ 0.99 | ≥ 0.95 | — | Uncertainty fails closed |
| P1–P4, F, HR, L | ≥ 0.97 | ≥ 0.90 | — | |
| E1–E5 (external-provider sinks) | ≥ 0.98 | ≥ 0.92 | — | |
| I1–I6 identifiers | ≥ 0.95 | ≥ 0.90 | — | |
| U unknown routing | — | — | — | 100% routed to restrictive policy — a structural test, not a statistic |

**Residual leakage:** exactly **0** for all S* classes. For non-S classes, ≤ 1 ground-truth-span token per 10k tokens at any sink whose contract denies that class.

**Calibration (model-assisted tier only):** ECE ≤ 0.05 over 10 bins; **zero** over-confident bins (confidence ≥ 0.9 with accuracy < 0.9) for S, B, H and M.

### 12.4 Utility-loss thresholds — the other half of the gate

Measured against an **unsanitized oracle** run on the same corpus. A sanitizer that scores perfectly on leakage and destroys Forge's ability to patch code has failed, and §5.4 is why.

| Measure | Definition | Proposed gate |
|---|---|---|
| **Citation fidelity** | Fraction of citations that resolve to the correct source revision **and** span | ≥ 0.98 of oracle |
| **Symbol / line mapping** | Fraction of symbols, types and line numbers preserved intact inside the approved local company zone | ≥ 0.99 of oracle |
| **Retrieval recall** | recall@10 over the C-CODE and C-COMPANY retrieval task set | ≥ 0.95 of oracle |
| **Answer correctness** | Task-set accuracy on questions answerable from the sanitized view | ≥ 0.95 of oracle |
| **Code / test success** | Patch-applies rate × test-pass rate on the fixture repository | ≥ 0.97 of oracle |
| **Latency** | p50/p95/p99 of scan and joined-rescan | **BLOCKED on B-002** — see §12.5 |

### 12.5 The latency gate, stated honestly

**[U]** No absolute latency threshold can be set, because B-002 is open. Setting one now would be fiction.

**What can be committed today** is a *relative* gate, which is hardware-independent:

> On the same machine and the same corpus, no release may regress p50, p95 or p99 by more than **10%** against the previous release. Absolute p50/p95/p99 budgets are set once B-002 is answered and become additional gates at that point.

### 12.6 Overrides, failure handling and rollback

- **High-risk uncertainty fails closed** or requests private review. There is no "probably fine" branch.
- A **false-positive override** is **source-specific, purpose-specific and sink-specific**; it **expires**; it is **audited**; and it **can never override a T4 secret export**. An override is a narrow exception to one detection at one sink, never a mode.
- Any hard-gate failure — a single canary escape, a class below its recall floor, a utility measure below its floor — **blocks the release**. Not a warning; a block.
- Views carry `policy_version` and `detector_version` in their key (fields 16–17), so a **rollback** is a version pin, and views built under a rolled-back version are invalidated for egress purposes automatically.

---

## 13. Compliance evidence pack, not a compliance claim (SAN-AC-13)

The gateway produces an **evidence pack**. It never asserts legal compliance, and no technical control in it may be described in product language as making the suite "GDPR compliant", "DPDP compliant" or "secure".

Contents:

1. **Data inventory and flow map** — generated from the sink registry and the Lineage DAG, not hand-maintained.
2. **Classification, purpose, authority and consent** per source.
3. **Provider, subprocessor, region and cross-border path** per model and export sink.
4. **Retention, legal hold, deletion and export state.**
5. **Access and revoke audit** — non-content events only.
6. **Incident controls** — kill switch, revocation, key rotation.
7. **Organization-policy mapping** — the Workspace Context Scope Record v1 as the current authority.
8. **Current policy and detector versions.**

**Where qualified review is still required** — stated, not assumed away:

- **jurisdiction** — owner is India-domiciled; DPDP and, where EU data subjects appear in meetings, GDPR;
- **employer policy** — **[V] U-09 is open**: whether the employer permits running an assistant against QuillBot systems at all is the owner's own assessment, flagged and not assumed away;
- **biometrics** — Art. 9 GDPR / DPDP treatment of speaker embeddings has **no lawful-basis, retention or residency design yet [V]** (C-032; L5 §8 risk 7);
- **meeting capture** — consent regimes vary by participant jurisdiction;
- **payments and consumer transactions** — out of scope here, in scope for the tier policy;
- **commercialization** — every licence question in §14 changes if this is ever distributed.

---

## 14. The gateway's own dependency posture

Per **L5 §8 risk 1** (the corpus's single biggest hole): *no `adopt`/`compose` verdict is valid without a four-column record — **code / weights / datasets / required-runtime** — each with a fetched primary URL.* **[V]**

This document does **not** issue adopt verdicts, because no licence was fetched today for these candidates. Every row below is marked accordingly. The point of the table is to make the four-column requirement structural for this component.

| Need | Candidate approach | Code | Weights | Datasets | Required runtime | Status |
|---|---|---|---|---|---|---|
| Gateway/broker language | A memory-safe systems language with zeroization and a strong type system (for `Sealed<T>`) | **[U] unverified** | n/a | n/a | **[U]** | Decide at Gate 1 with a fetched licence record |
| Encrypted local store | SQLite-family with an encryption layer | **[U] unverified** | n/a | n/a | **[U]** | Same |
| Keyed digest / HMAC / canonical JSON | Standard primitives + RFC 8785 JCS | **[U] unverified** | n/a | n/a | n/a | Same |
| Secret detectors | Existing OSS secret scanners as a *supplement* to the in-house registered-secret index | **[U] unverified** | n/a | **[U]** | **[U]** | Same. Do not depend on a scanner's rule pack without reading its licence and its rule-data licence separately |
| PII / entity detection | Existing OSS PII framework | **[U] unverified** | **[U]** — many ship NER models with separate weight licences | **[U]** | **[U]** | Same. **The weights column is where this class of dependency bites** |
| Policy engine | **OPA or Cedar — pick exactly one** | **[U] unverified** | n/a | n/a | **[U]** | **UNDECIDED — see §15 CSG-C3.** L5 disagreement log #10 records this as an open Gate-1 decision that *must not drift*. This document deliberately does not resolve it and specifies an interface that either can satisfy |
| Graph store | **none** | — | — | — | — | The gateway takes no graph dependency (§2.4 class 8) |

**Budget.** Everything above must be $0 **[V]** (A-05, budget ceiling $0 for Phase 0; free/open-source only). Anything paid is a proposal with a costed alternative, never an assumption.

---

## 15. Unknowns, blockers and conflicts requiring an owner decision

### 15.1 Unknowns carried forward (not filled in)

| ID | Unknown | Effect on this design |
|---|---|---|
| **B-002 / U-01** | Windows pilot machine specifications | No absolute latency threshold (§11, §12.5); model-assisted classifier tier off by default (§6.4) |
| **U-04** | Whether an Obsidian vault exists at all, and where | `SK-OBSIDIAN-PROJECTION` is `declared-absent`; part of SAN-AC-07's verification cannot run |
| **B-004 / X-04** | NeoSapien MCP officialness | Sink registered read-only with a dual contract; never citable as verified official (§2.6) |
| **U-09** | Employer policy on running an assistant against QuillBot systems at all | §13 flags it; the gateway cannot resolve it |
| **[U] new** | Whether this Mac is Apple Silicon or Intel | Does not affect gateway correctness; affects every local-model tier. Belongs on U-01 **[V]** L5 §5.4 |

### 15.2 Conflicts the owner must resolve

| ID | Conflict | Why it cannot be resolved here |
|---|---|---|
| **CSG-C1** | **SAN-AC-07 names Obsidian in its verification method, and Obsidian is not installed [V]** (X-03). The criterion as written cannot be fully verified. | Either (a) the owner supplies a vault location and the sink is enabled, or (b) the Obsidian half of SAN-AC-07 is formally marked *not-applicable-until-vault-exists* and the criterion's verification method is amended. Silently passing it would be a false green. |
| **CSG-C2** | **SAN-AC-10 requires a latency utility-loss measure; B-002 makes an absolute latency threshold unfalsifiable [V]** (L5 §8 risk 2). | Proposed resolution: accept the **relative 10% regression gate** now (§12.5) and add absolute budgets when B-002 closes. Requires owner acceptance, because it changes what SAN-AC-10 means at Gate 1. |
| **CSG-C3** | **Policy engine: OPA vs Cedar is undecided [V]** (L5 disagreement log #10 — *"pick ONE… Don't run both"*, recorded as an undecided decision that must not drift). The gateway needs a policy decision point. | This is a Gate-1 architecture decision that spans more than the gateway. This document specifies the interface and refuses to pick, so the decision is made once, deliberately, and in the open. |
| **CSG-C4** | **NeoSapien MCP is an egress, not only an ingest.** A `search_memories` query built from company-zone context sends employer-confidential terms to an undocumented vendor-hosted host with no published data-flow, retention or schema **[V]** (C-011, B-004; L5 §3.9). The corpus consistently frames it as "read-only". | Read-only is a statement about the *response*. The *request* is an egress. Recommend a new corrections-log row and an explicit owner decision on whether any query may ever contain company-zone terms. The design's current answer is **no** (`zones_permitted = ["personal"]`), which may be more restrictive than the owner intends and will visibly reduce intake quality. |
| **CSG-C5** | **SAN-AC-12 cannot be verified on this machine before Gate 3 [V]** (A-02 work-Mac boundary; scope record v1). | The dev-preview containment tests require running a suite runtime. Designed here; executed on the Windows pilot. Owner should confirm SAN-AC-12 is scheduled to Gate 3 rather than Gate 1. |
| **CSG-C6** | **Owner-initiated erasure vs legal hold.** §9 requires deletion to cascade; §13 requires legal-hold state to be recorded. When employer material is under a hold, a deletion request and a hold conflict directly. | Precedence between the owner's erasure and an employer legal hold is a **legal** question, not an engineering one. The gateway must implement whichever precedence the owner sets, and must disclose the conflict rather than resolve it silently. Flagged for counsel per §13. |

### 15.3 Dispositions I did **not** re-open

Per instruction, the following are carried as already disposed and were not silently re-resolved: register rows #1 (undetectable Counsel mode — rejected), #2 (silent biometric enrolment — rejected), #3 (autonomous payments — modified), #4 (Forge pipeline/permission bypass — modified/rejected), #5 (chain-of-thought — modified), #6 (scope record — accepted with bounds), #7 (zero latency — modified), #8 (reel-claimed capabilities — rejected), #9 (capability catalogues — deferred with partial delivery, owner decision pending), #10 (fork deduplication — technically impossible, disclosed).

---

## 16. Acceptance-criterion traceability

| AC | Where satisfied | Verification designed |
|---|---|---|
| **SAN-AC-01** | §2 (registry: 12 classes, 30-field contract, representative rows), §2.5 (three enforcement layers, ARCH-TEST-01…08) | Machine-checked registry (01), dependency test (02), egress enumeration (03), OS isolation (04), broker mediation (05), taint canaries (06), monotonicity (07), deliberate-bypass corpus (08) |
| **SAN-AC-02** | §3.1 (raw zone), §3.2 (separate stores/keys/ACLs), §3.3 (22-field view key, keyed `view_id`, AEAD key material) | Cross-zone/provider/account denial tests, storage inspection, wrong-view replay denial, low-entropy plain-hash scan (ARCH-TEST-06) |
| **SAN-AC-03** | §4 (token vault, two-hop indirection, 7 rehydration conditions, 6 prohibited targets, adapter rules), §3.4 `tokenize` | Canary credentials across HTTP/shell/Git/cloud/K8s/database fixtures; token-vault isolation (ARCH-TEST-04); adapter-only rehydration |
| **SAN-AC-04** | §8 (structural isolation, neutralization set, the seven prohibitions, deterministic backstop), §2.4 class 2 (untrusted tool output) | C-INJECT corpus segment (§12.1); malicious-MCP tool-description and tool-result fixtures |
| **SAN-AC-05** | §6.1 (pre/post canonicalization scans), §6.3 (bounds table), §7 stage 2 (**joined-prompt rescan**), §7 stage 4 (all model-derived output) | C-ENCODED and C-ARCHIVE segments; split/template-reconstructed secrets; screenshot/OCR; model-regurgitation tests |
| **SAN-AC-06** | §2.4 class 4 (UI ladder, `Approval needed` default), §2.4 class 5 (schema-only observability, replay/autocapture off), §7 stages 5–6 | Lock/unlock/screen-share/device matrix; error-reporter and analytics configuration audit; crash-dump scan; preview-before-share support bundle |
| **SAN-AC-07** | §2.4 classes 6–8, §5.6 (derivative rule), §7 stage 7 (embeddings built from the view; no raw-then-redact) | Seeded-secret scans of DB, vector neighbours, graph properties and labels; useful-code-context retrieval; cross-zone denial. **Obsidian portion blocked — CSG-C1** |
| **SAN-AC-08** | §7 stage 9 (rebuild + rescan + approval bound to final payload hash), §2.4 class 12 | Slack/email/Jira/Git/support/training fixtures; changed-recipient and changed-payload invalidation; re-identification warning tests |
| **SAN-AC-09** | §9 (DAG node/edge types, six triggers, cascade partitioning, six-field tombstone, honest limits) | Derivative inventory before/after; index rebuild; offline-device and backup expiry; provider-limitation disclosure; tombstone content scan |
| **SAN-AC-10** | §12 (corpus, metrics, correctness thresholds, utility-loss thresholds, overrides, rollback) | Versioned golden/adversarial corpus; baseline comparison; threshold approval; false-positive override review; rollback. **Latency portion — CSG-C2** |
| **SAN-AC-11** | §10 (fail-closed table, zero-unsafe-fallback, truthful degraded UI), §0 (four-option ladder) | Gateway outage, version skew, timeout, disk-full tests; zero unsafe-fallback assertion |
| **SAN-AC-12** | §7 stage 8 (dev-preview containment: unprivileged, loopback, debugger/reloader off, Host/Origin/CORS/CSRF, sanitized-view API only) | Listener/process/environment scan; `0.0.0.0`/LAN/tunnel, debugger, DNS-rebinding, CSRF/WebSocket, path-traversal, privileged-access denial. **Execution blocked before Gate 3 — CSG-C5** |
| **SAN-AC-13** | §13 (evidence pack contents; explicit non-claim of legal compliance; named review needs) | Data inventory/flow map generated from the registry and DAG; consent/retention fixtures; cross-border/provider delta; legal-hold/deletion conflict (**CSG-C6**); product-language audit |

**Adjacent criteria this design also serves:** MEMORY-AC-02 (memory promotion), MEMORY-AC-04 (deletion cascade through Vault/indexes/graph/Obsidian/caches/devices), CAP-AC-03 (plan repair may not mutate provider/account/zone), PROVIDER-ETHICS-AC-01 (no key cycling or quota evasion), APPROVAL-BINDING-AC-01 (payload-hash-bound approvals), OUTBOX-AC-01 (one commit attempt, outcome-unknown handling), VAULT-AC-01 (E2EE sync isolation), DEV-SERVER-AC-01 (loopback dev server with sanitized fixtures), NEO-MCP-AC-01…03 (NeoSapien adapter contract), COUNSEL-AC-04 (consent preflight and immediate withdrawal), SWE-SEC-AC-01 (prompt-injection boundary in security review), LINK-AC-02 (handoff without cross-zone leakage), FINE-TUNE-AC-01 (training corpus governance).

---

## 17. One-paragraph statement of the design

The Zeno Context Sanitization Gateway is a single deterministic, versioned service that mediates every boundary in the suite. Nothing reaches a consumer except as a **purpose-bound sanitized view**, identified by a 22-field key and delivered to exactly one registered sink from a registry of twelve classes whose completeness is enforced at the type system, the OS process boundary and a runtime egress broker, and proved by a deliberate-bypass corpus that fails the build. Raw material stays in its source system wherever possible and in an encrypted, short-TTL, model-inaccessible quarantine when it cannot. Nine transformations — allow, omit, mask, typed placeholder, pseudonymize, tokenize, summarize, aggregate, block — are the only vocabulary; `tokenize` is the sole reversible one, and its reversal happens only inside an authorized destination adapter, at transport level, after approval, never into a prompt, plan, trace, notification, export or model-visible tool result. Deterministic detectors run first and a local model tier may only supplement ambiguity after secrets are already tokenized. Nine enforcement stages re-scan the **final joined prompt**, because templating reconstructs secrets that no fragment contained, and re-scan every model-derived output before display, persistence or action. A Sanitization Lineage DAG makes deletion a graph traversal, and the append-only audit survives erasure because it never held the content — only a six-field non-content tombstone. Releases are gated on per-class precision, recall, FPR, FNR, residual leakage and calibration **and** on citation fidelity, symbol/line mapping, retrieval recall, answer correctness and code/test success, because over-redaction inside the approved company zone is a defect on exactly the same footing as a leak; registered-secret canaries must escape zero times. And through all of it, one rule holds and is checked by property test rather than by review: **sanitization never creates authorization.**
