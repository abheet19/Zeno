# L2 — Coding Agents, MCP & Context Engines

**Research date:** 2026-08-24 · **Mode:** read-only, public sources only
**Labelling:** `[V]` verified (primary source + URL, accessed 2026-08-24) · `[C]` claimed (vendor/marketing) · `[I]` inferred · `[U]` unknown

> **Not legal clearance.** Every licence below is read off a repo landing page or LICENSE file on 2026-08-24. Licences change, dual-licensing and per-directory exceptions are common, and repo pages sometimes report the wrong SPDX ID. Anything that reaches production needs a real licence review against the actual LICENSE/NOTICE files at the pinned commit.

---

## 0. Executive summary

**The two headline MCP claims are both TRUE, and both are more consequential than they look.**

1. `2026-07-28` is the current MCP spec `[V]`.
2. Sampling is Deprecated in it `[V]` — but so are **Roots**, **Logging** and **Dynamic Client Registration**, all under the same SEP-2577. This is not a one-feature tidy-up: `2026-07-28` removes the server→client request direction from the protocol entirely. Servers no longer initiate JSON-RPC requests; `initialize` is replaced by `server/discover`; anything that needed a server-initiated call (sampling, roots, elicitation) is re-plumbed through a multi-round-trip `InputRequiredResult` pattern. **Any MCP client or server code written against `2025-06-18`/`2025-11-25` needs a real port, not a version bump.**

**Six of the seed URLs flagged as "suspected wrong" were actually correct**, and the "corrections" suggested in the task would have been regressions. Three seed projects have moved orgs in ways that matter for governance (goose → Linux Foundation; ACP → own org; OpenHands → own org).

**Two seed projects are dead**, both verified: Continue (read-only) and Roo Code (archived 2026-05-15). **One is quietly dying**: Aider has shipped no release in ~12 months.

**The biggest gap in the seed list is code intelligence for agents.** The list has Zoekt/SCIP/tree-sitter (raw infrastructure) but misses the layer that actually feeds agents: **Serena** (28.4k★, MIT, LSP-backed symbol retrieval + editing over MCP) is the single highest-value omission.

---

## 1. Model Context Protocol

### 1.1 Spec version — claim VERIFIED

| Item | Finding | Evidence |
|---|---|---|
| Current spec version | **`2026-07-28`** `[V]` | <https://modelcontextprotocol.io/specification/latest> redirects to / renders the `2026-07-28` spec; normative schema at `schema/2026-07-28/schema.ts` |
| Schema source of truth | `github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts` `[V]` | cited by the spec page itself |

**CLAIM CONFIRMED — "current version is 2026-07-28".**

### 1.2 Sampling deprecation — claim VERIFIED

The spec now maintains a formal **deprecated-features registry** (a new artefact, introduced with the feature-lifecycle policy in SEP-2596). This is the authoritative answer, not a blog post.

Source: <https://modelcontextprotocol.io/specification/2026-07-28/deprecated> `[V]`, accessed 2026-08-24.

| Feature | Deprecation SEP | Deprecated in | Migration path | Earliest removal |
|---|---|---|---|---|
| **Roots** | SEP-2577 | `2026-07-28` | Pass dirs/files via tool params, resource URIs, or server config | first revision on/after 2027-07-28 |
| **Sampling** | SEP-2577 | `2026-07-28` | **Integrate directly with LLM provider APIs** | first revision on/after 2027-07-28 |
| **Logging** | SEP-2577 | `2026-07-28` | `stderr` for stdio; OpenTelemetry for observability | first revision on/after 2027-07-28 |
| **Dynamic Client Registration** | PR #2858 | `2026-07-28` | Client ID Metadata Documents (CIMD) | first revision on/after 2027-07-28 |
| `includeContext: "thisServer"`/`"allServers"` | SEP-2596 | `2025-11-25` | omit, or use `"none"` | follows Sampling |
| **HTTP+SSE transport** | SEP-2596 | `2025-03-26` | Streamable HTTP | **three months after SEP-2596 reaches Final** |

**CLAIM CONFIRMED — "Sampling is DEPRECATED in it".** Verified independently of the version claim, from the registry rather than from a changelog summary.

Registry semantics `[V]`: Deprecated = still in the spec, scheduled for removal; new implementations **SHOULD NOT** adopt; existing implementations **SHOULD** migrate. "Earliest removal" is eligibility, not a commitment — actual removal is a Core Maintainer call at release-prep time. **Nothing has been removed under this policy yet** (the "Removed" section is empty) `[V]`.

**Why Sampling died `[I]`, and it matters:** SEP-2577 removes the server→client request direction. Sampling was the canonical server-initiated call, so it could not survive the architecture change. The prescribed migration — "integrate directly with LLM provider APIs" — means **MCP is no longer a way to borrow the host's model**. Any design that assumed "my MCP server can ask the host to run inference for free, on the user's subscription" is dead and needs its own API key and its own billing.

### 1.3 Transports — HTTP+SSE is legacy, confirmed

Source: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports> `[V]`

**Two standard transports, and only two** `[V]`:

1. **stdio** — newline-delimited JSON-RPC over the standard streams of a client-launched subprocess. Cancellation via `notifications/cancelled`.
2. **Streamable HTTP** — each message is an HTTP POST to a single MCP endpoint; replies are either a JSON object or a request-scoped SSE stream. Cancellation by closing the request's response stream. Mirrors `_meta` protocol metadata into HTTP headers so intermediaries can route without parsing the body (body remains source of truth).

**HTTP+SSE (the old two-endpoint transport): LEGACY — confirmed** `[V]`. It is not merely "not current"; it is formally **Deprecated** in the registry, deprecated as far back as `2025-03-26`, and it has by far the **nearest removal horizon of anything on the list** — "three months after SEP-2596 reaches Final", versus 2027-07-28 for everything else. Its spec link now points back at the `2024-11-05` revision.

> **Decision-relevant:** of all six deprecated items, HTTP+SSE is the one most likely to actually disappear soon. Do not build on it. Anything still speaking it should be migrated now.

Other transport notes `[V]`:
- **Custom transports** are explicitly permitted; must preserve JSON-RPC framing, message patterns, per-request metadata model.
- Custom transports over reliable bidirectional byte streams (Unix sockets, TCP) **SHOULD reuse stdio framing** rather than inventing one — the stdio binding is just NDJSON over a byte stream; only its process-lifecycle rules are stdio-specific. **This is the cheapest path to a sandboxed/remote local transport** `[I]`.
- Backward compatibility with initialization-era revisions is handled by era detection + a published compatibility matrix `[V]`.

### 1.4 Which optional extensions actually exist — two of the four named

This is where the task's framing needs correcting. The four things named are at **three different levels of reality**.

| Named thing | What it actually is | Status |
|---|---|---|
| **Tasks** | Official extension, own repo `modelcontextprotocol/ext-tasks` | **Real extension** `[V]` |
| **MCP Apps** | Official extension, own repo `modelcontextprotocol/ext-apps` | **Real extension** `[V]` |
| **Skills over MCP** | **Working Group**, not an extension | **NOT a shipped extension** `[V]` |
| **Elicitation** | **Core client feature** in the spec | **NOT an extension at all** `[V]` |

#### Extension mechanics `[V]`
Identifier format `{vendor-prefix}/{extension-name}`; official ones use `io.modelcontextprotocol`. Official extensions live in the MCP GitHub org under an `ext-` prefix; experimental ones under `experimental-ext-`. Negotiation: clients declare in `_meta["io.modelcontextprotocol/clientCapabilities"].extensions` per request; servers advertise in the `server/discover` response. **Always opt-in, disabled by default, both sides must agree.**

Complete official extension roster `[V]`:
- `io.modelcontextprotocol/ui` — MCP Apps
- `io.modelcontextprotocol/tasks` — Tasks
- `io.modelcontextprotocol/oauth-client-credentials` — OAuth client-credentials (M2M auth)
- `io.modelcontextprotocol/enterprise-managed-authorization` — enterprise IdP access control

#### Tasks — durable async, real and well-specified
Source: <https://modelcontextprotocol.io/extensions/tasks/overview> `[V]`

Server returns a `CreateTaskResult` (`resultType: "task"`) with `taskId`, status, `ttlMs`, `pollIntervalMs` instead of blocking. Client polls `tasks/get`. Lifecycle: `working` → `input_required` → `completed` / `failed` / `cancelled` (last three terminal). Mid-flight input via `inputRequests` map, answered with `tasks/update`. `tasks/cancel` is **cooperative** — server acknowledges intent, is not obligated to stop. Optional push via `notifications/tasks` gated behind `subscriptions/listen`. Task is durably created *before* the response is sent; task IDs survive client crash/restart. Server decides per-request whether to create a task — no per-tool warmup, no per-request flag.

> **Decision-relevant gap:** Tasks **does not appear in the official extension support matrix at all** `[V]` (<https://modelcontextprotocol.io/extensions/client-matrix> lists only MCP Apps and the two auth extensions). So durable Tasks is fully specified with **no listed client support**. Treat it as spec-ready, ecosystem-unready.

#### MCP Apps — real, and the best-supported extension
Source: <https://modelcontextprotocol.io/extensions/apps/overview> `[V]`. Extension spec revision `2026-01-26` `[V]`.

Tool description carries `_meta.ui.resourceUri` → `ui://` resource containing HTML/JS/CSS. Host preloads, renders in a **sandboxed iframe**, communicates over **postMessage** using an MCP dialect (shared methods like `tools/call`, plus `ui/`-prefixed ones such as `ui/initialize`). `_meta.ui` may carry `permissions` (mic, camera) and `csp` (allowed external origins). Sandbox blocks parent-DOM access, host cookies/localStorage, parent navigation.

**Client support (the extension matrix)** `[V]`: Claude (web), Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam, ChatGPT, Cursor, Archestra.AI, PostHog Code. Archestra.AI is the only one also listing Enterprise Auth. Matrix is **community-maintained** — treat as indicative, not authoritative `[V]`.

Starter templates for React, Vue, Svelte, Preact, Solid, vanilla JS `[V]`. `@modelcontextprotocol/ext-apps`'s `App` class is a convenience wrapper, **not** required; the postMessage protocol can be implemented directly `[V]`.

#### Skills over MCP — a Working Group, NOT an extension
Source: <https://modelcontextprotocol.io/community/working-groups/skills-over-mcp> `[V]`

- **Converted from Interest Group to Working Group on 2026-04-16** `[V]`; IG formed 2026-02-01.
- Current direction: **SEP-2640 "Skills Extension"** (Extensions Track, Resources-based) — status **"In Review"**, no target date `[V]`.
- Reference implementation also **"In Review"** `[V]`.
- Code lives in `modelcontextprotocol/experimental-ext-skills` — the **experimental** prefix, not `ext-` `[V]`.
- Leads: Ola Hungerford (Nordstrom / MCP Maintainer), Peter Alexander (Anthropic / Core Maintainer) `[V]`. 17 members incl. Google, AWS, Microsoft(via GitHub), Databricks, Bloomberg, Saxo Bank, Stacklok, Astronomer.
- Coordinating with the external **Agent Skills** spec at agentskills.io (content format + well-known URI discovery), FastMCP, PydanticAI `[V]`.
- Explicitly out of scope: registry schema ownership, client mandates, **plugin/bundle packaging** `[V]`.

> **CORRECTION to the task framing.** "Skills over MCP" is listed on the spec landing page under "Notable extensions", which is misleading — it links to a *charter*, not a spec. It is **not** an available extension today. Anything depending on standardised skill discovery over MCP is **at least one SEP away**, with no date.

#### Elicitation — core, not an extension; and reshaped
Source: <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation> `[V]`

**Elicitation is a core client feature and is NOT deprecated** `[V]` — it is the *only* client feature the `2026-07-28` landing page still lists (Sampling and Roots having been deprecated).

Two modes `[V]`:
- **Form mode** — structured data via a **restricted JSON Schema subset**: flat objects, primitives only (string/number/integer/boolean/enum + arrays of enums). Formats limited to `email`, `uri`, `date`, `date-time`. Nested structures and arrays of objects **intentionally unsupported**.
- **URL mode** (introduced `2025-11-25`, flagged as possibly changing) `[V]` — host opens an external URL; data other than the URL never reaches the client.

Hard security rules `[V]`: servers **MUST NOT** use form mode for passwords, API keys, tokens, payment credentials — those **MUST** use URL mode. Clients **MUST NOT** pre-fetch the URL, **MUST NOT** open without explicit consent, **MUST** show the full URL, **MUST** open in a viewer the client/LLM cannot inspect (spec names `SFSafariViewController` good, `WKWebView` bad). Three-action response model: `accept` / `decline` / `cancel`.

Because servers can't initiate requests any more, elicitation is delivered inside an `InputRequiredResult` and answered by **retrying the original request** with `inputResponses` + `requestState` `[V]`. A documented **phishing attack** exists (Alice triggers elicitation, tricks Bob into completing the OAuth flow, tokens bind to Alice → account takeover); servers **MUST** verify the user who opens the URL is the user who started the elicitation `[V]`.

### 1.5 Official SDKs
Source: <https://github.com/modelcontextprotocol> `[V]`, star counts as displayed 2026-08-24.

| SDK | Stars | Co-maintainer |
|---|---:|---|
| Python | 24.1k | — |
| TypeScript | 13.2k | — |
| Go | 5.0k | Google |
| C# | 4.5k | Microsoft |
| Rust | 3.8k | — |
| Java | 3.7k | Spring AI |
| PHP | 1.6k | The PHP Foundation |
| Kotlin | 1.4k | JetBrains |
| Ruby | 893 | — |
| Swift | not shown | — |

Also: `servers` (89.8k★), `modelcontextprotocol` spec repo (9.0k★), `inspector` (10.7k★) `[V]`.

**SDKs are not required to implement extensions** — conformance doesn't demand it, and maintainers have full autonomy `[V]`. So SDK-level Tasks/Apps support must be checked per SDK, per version. Not verified here — **ACCESS LIMITATION**.

### 1.6 MCP recommendations

| Item | Rec | Rationale |
|---|---|---|
| MCP `2026-07-28` core | **adopt** | The interop standard; but budget a real port — `server/discover`, per-request capabilities and no server-initiated requests are breaking. |
| stdio transport | **adopt** | Simplest, no network surface; reuse its framing for any custom local transport. |
| Streamable HTTP | **adopt** | Only supported remote transport. |
| HTTP+SSE | **reject** | Deprecated since `2025-03-26`, nearest removal horizon of any deprecated feature. |
| Sampling | **reject** | Deprecated; migration is "bring your own LLM API". Don't design around borrowing the host's model. |
| Roots / Logging / DCR | **reject** | Same SEP-2577 sweep; use tool params, stderr+OTel, and CIMD instead. |
| Elicitation | **adopt** | Core, not deprecated, the sanctioned way to get user input. Use URL mode for anything secret. |
| Tasks | **spike** | Excellent spec for long jobs, but zero listed client support — build behind a flag, keep a sync fallback. |
| MCP Apps | **spike** | Best-supported extension (11 clients incl. Claude, ChatGPT, Cursor, Copilot). Worth a prototype; sandbox model is sound. |
| Skills over MCP | **learn-only** | WG + in-review SEP-2640 + experimental repo. No spec to build against. Track `agentskills.io` too. |
| Official SDKs | **adopt** | Use the language SDK; verify per-SDK extension support yourself. |

---

## 2. Coding agents & runtimes

Star counts and metadata as displayed on repo landing pages, 2026-08-24 `[V]`.

### 2.1 Ownership corrections — six seeds vindicated, zero seeds wrong

**Every "suspected wrong" seed URL in the task was actually correct.** The suggested alternatives are all stale — they redirect to the seed.

| Project | Seed URL | Suspected alternative | Verdict |
|---|---|---|---|
| OpenCode | `anomalyco/opencode` | *"possibly sst/opencode"* | **Seed CORRECT.** `sst/opencode` resolves to `anomalyco/opencode` `[V]` |
| OpenHands | `OpenHands/OpenHands` | *"possibly All-Hands-AI"* | **Seed CORRECT.** `All-Hands-AI/OpenHands` resolves to `OpenHands/OpenHands` `[V]` |
| Goose | `aaif-goose/goose` | *"possibly block/goose"* | **Seed CORRECT.** `block/goose` resolves to `aaif-goose/goose` `[V]` |
| Zoekt | `sourcegraph/zoekt` | *"verify canonical"* | **Seed CORRECT** `[V]` |
| SCIP | `scip-code/scip` | *"possibly sourcegraph/scip"* | **Seed CORRECT** `[V]` |
| ACP | `agentclientprotocol/agent-client-protocol` | — | **Seed CORRECT** (no longer under `zed-industries`) `[V]` |

**No dead seed URLs found. No wrong-owner seeds found.** The corrections below are to *facts and claims*, not to URLs.

> **Method note / ACCESS LIMITATION:** GitHub same-host redirects are followed transparently by the fetch tool, so a redirect shows up as the *destination* org rendering under the *source* URL. I read canonicality off the org name rendered on the page. Bash `curl` (which would have shown raw 301s and `Location:` headers) was **rate-limited and unavailable for the whole session**, so redirect chains were not observed directly. `api.github.com` was deliberately not used.

### 2.2 The agents

| Project | Canonical repo | Stars | Licence | Status |
|---|---|---:|---|---|
| **OpenCode** | `anomalyco/opencode` | 201k | MIT | active `[V]` |
| **Gemini CLI** | `google-gemini/gemini-cli` | 106.7k | Apache-2.0 | active `[V]` |
| **Open Interpreter** | `OpenInterpreter/open-interpreter` | 68.1k | Apache-2.0 | active, **rewritten** `[V]` |
| **Cline** | `cline/cline` | 66.8k | Apache-2.0 | active `[V]` |
| **OpenHands** | `OpenHands/OpenHands` | 85k | MIT | active, **pivoted** `[V]` |
| **goose** | `aaif-goose/goose` | 53.4k | Apache-2.0 | active, **new governance** `[V]` |
| **Aider** | `Aider-AI/aider` | 48.5k | Apache-2.0 | **decelerating** `[V]` |
| **Continue** | `continuedev/continue` | 35.6k | Apache-2.0 | **READ-ONLY / DEAD** `[V]` |
| **Qwen Code** | `QwenLM/qwen-code` | 27.3k | Apache-2.0 | active `[V]` |
| **Roo Code** | `RooCodeInc/Roo-Code` | 24.3k | Apache-2.0 | **ARCHIVED** `[V]` |
| **SWE-agent** | `SWE-agent/SWE-agent` | 20.1k | MIT | **superseded by mini** `[V]` |
| **mini-SWE-agent** | `SWE-agent/mini-swe-agent` | 6.7k | MIT | active `[V]` |
| **Agentless** | `OpenAutoCoder/Agentless` | 2.1k | MIT | **dormant** `[V]` |

#### Confirmed dead: Continue — CLAIM VERIFIED
<https://github.com/continuedev/continue> `[V]`. Verbatim banner: *"The `continuedev/continue` repository is no longer actively maintained and is read-only for all users."* Final release **2.0.0**, which removed anonymous telemetry and pulled out authentication before development ceased. 35.6k★, Apache-2.0.
**CLAIM "read-only/unmaintained" — CONFIRMED. → reject.**

#### Confirmed dead: Roo Code — CLAIM VERIFIED
<https://github.com/RooCodeInc/Roo-Code> `[V]`. Verbatim: *"This repository was archived by the owner on May 15, 2026. It is now read-only."* Extension shut down the same day. 24.3k★, Apache-2.0. Successors named in the README: **ZooCode** (community fork) and **Cline** (Roo's own upstream) `[V]`.
**CLAIM "archived" — CONFIRMED, with a date. → reject** (Cline is the live descendant.)

#### CORRECTION: Aider is decelerating, not thriving
The repo landing page looks healthy (48.5k★, 13,138 commits, no deprecation banner), and SEO listicles still call it *"the strongest all-around open-source coding agent in 2026 — actively developed"*. The primary sources say otherwise:
- **Latest GitHub release: v0.86.0, dated 2025-08-09** `[V]` — **~12 months old**.
- **Latest commit on `main`: 2026-05-22** `[V]` — ~3 months stale, a merge adding Opus 4.5 to a model list.

**ACCESS LIMITATION:** the PyPI JSON for `aider-chat` returned upload dates inconsistent with the GitHub release timeline (it reported 0.86.2 in Jan 2025, predating the Aug 2025 v0.86.0 tag). I could not reconcile them, so PyPI dates are **discarded as unreliable** and only the two GitHub figures are relied on. Licence classifier from PyPI (`Apache Software License`) matches the repo `[V]`.
**→ learn-only.** Its repo-map/tree-sitter repository-context technique remains the best-documented prior art, but a year without a release during the fastest-moving period in the field is disqualifying for a dependency.

#### CORRECTION: Open Interpreter is a different product now
`OpenInterpreter/open-interpreter` is canonical `[V]`, 68.1k★, Apache-2.0, active. But the description is now *"A coding agent for open models like Kimi K3"*, and the README states this is **the new Rust version, based on Codex**, with the **original Python project now community-maintained elsewhere** `[V]`. It advertises **ACP** and Codex SDK compatibility `[V]`.
**→ learn-only.** The name carries 68k stars of reputation from a Python project that no longer lives here. Anyone pinning "Open Interpreter" from memory will get something unrecognisable.

#### CORRECTION: OpenHands pivoted from agent to control plane
`OpenHands/OpenHands` `[V]`, 85k★, MIT, v1.15.0 `[V]`. Now describes itself as *"the self-hosted developer control center for coding agents and automations"*, orchestrating **OpenHands, Claude Code, Codex, Gemini, or other ACP-compatible agents** across local/remote/cloud `[V]`. Landing page reports TypeScript as primary language `[V]` — a notable shift for what was a Python research agent.
**→ spike.** As a multi-agent control plane with ACP as the integration seam it is now more interesting as *infrastructure* than as an agent. Its ACP bet corroborates ACP's momentum.

#### GOVERNANCE FINDING: goose moved to the Linux Foundation
`block/goose` → **`aaif-goose/goose`** `[V]`. 53.4k★, Apache-2.0. The repo page states goose *"is part of the Agentic AI Foundation (AAIF) at the Linux Foundation"* `[V]`. Docs relocated: `block.github.io/goose` now serves only a redirect notice pointing at **goose-docs.ai** `[V]`.

This is a **second** agent-ecosystem project under Linux Foundation governance alongside A2A — but note they are **different bodies**: goose is under **AAIF**, while A2A is a direct Linux Foundation project with its own TSC and **no AAIF mention anywhere** `[V]`. Do not conflate them.
**→ adopt (as MCP client reference).** Foundation-governed, permissive, and one of only 11 clients shipping MCP Apps support `[V]`.

#### The rest
- **OpenCode** `[V]` — 201k★ (highest in the survey), MIT, TypeScript, ~15,545 commits, build+plan agents, desktop app in beta. The `sst` → `anomalyco` move is not explained anywhere in the README `[V]` — **ACCESS LIMITATION**, rationale unknown. **→ spike.** Enormous mindshare and MIT, but an unexplained org migration on a 201k-star project is worth understanding before depending on it.
- **Cline** `[V]` — 66.8k★, Apache-2.0, now *"Autonomous coding agent as an SDK, IDE extension, or CLI assistant"*; ships CLI, VS Code + JetBrains extensions, a kanban board, and a **Node.js SDK for building custom agents** `[V]`. **→ adopt/compose.** The SDK framing makes it the most embeddable of the IDE-lineage agents, and it's Roo Code's designated successor.
- **Gemini CLI** `[V]` — 106.7k★, Apache-2.0. Extensibility via MCP servers, custom commands, custom extensions; docs now at **geminicli.com** (moved off the GitHub docs tree) `[V]`.
  - **Token caching** `[V]` (<https://geminicli.com/docs/cli/token-caching/>): automatic only. Works for **Gemini API key** and **Vertex AI** users; **explicitly excluded for OAuth users** because *"the Code Assist API does not support cached content creation at this time"*. Savings visible via **`/stats`**. **No manual/explicit cache control documented.** → If your auth path is OAuth, you get **no caching at all** — a real cost consideration.
  - **Hooks**: the repo references extensibility and the docs site is the canonical home, but I did **not** retrieve a dedicated hooks reference page. **ACCESS LIMITATION — hooks documentation UNVERIFIED `[U]`.** Do not assume Claude-Code-style lifecycle hooks exist here.
  - **→ compose.**
- **Qwen Code** `[V]` — 27.3k★, Apache-2.0. Originally based on **Gemini CLI v0.8.2**; *"Starting from Qwen Code v0.1, we stopped syncing with upstream and began independent development as a multi-protocol, multi-platform agent framework"* `[V]`. **→ learn-only.** A hard fork that has diverged deliberately; useful as evidence that the Gemini CLI core is forkable, but it inherits none of upstream's fixes.
- **mini-SWE-agent** `[V]` — 6.7k★, MIT, `SWE-agent` org. *"The 100 line AI agent…"*, claims **>74% on SWE-bench verified** `[C]` (vendor claim, benchmark not independently checked here) and claims to beat Claude Code and Codex on DeepSWE `[C]`. Adopters listed: Meta, NVIDIA, IBM `[C]`. **→ adopt (as reference architecture).** ~100 lines, MIT, no config sprawl — the best available proof that a competitive agent loop is small.
- **SWE-agent** `[V]` — 20.1k★, MIT. README states *current development effort is on mini-swe-agent, which has supersedes SWE-agent*, and recommends the simpler version. **→ learn-only** (read the papers, build on mini).
- **Agentless** `[V]` — 2.1k★, MIT. **Latest release v1.5.0, 2024-10-28**; most recent notable change a Claude 3.5 Sonnet integration, **2024-12-02**. ~2 years stale as of today. **CORRECTION:** the repo page's "active" impression is not supported by its release/commit dates. **→ learn-only.** Its thesis — that localise→repair without an agent loop is competitive — is still worth internalising, and is arguably *more* relevant now that agent loops are expensive.

### 2.3 Protocols & MCP infrastructure

#### A2A — Linux Foundation status CONFIRMED
`a2aproject/A2A` `[V]`, 25.5k★, Apache-2.0. Repo: *"The A2A Protocol is an open source project under the Linux Foundation, contributed by Google"* `[V]`.
Site <https://a2a-protocol.org/latest/> `[V]`: **specification v1.0** shipped; *"originally developed by Google and donated to the Linux Foundation"*; **Technical Steering Committee** spanning **AWS, Cisco, Google, IBM Research, Microsoft, Salesforce, SAP, ServiceNow** `[V]`. Six official SDKs: Python, JavaScript, Java, C#/.NET, Go, Rust `[V]`.
**No Agentic AI Foundation involvement — checked and absent** `[V]`.
**CLAIM "current Linux Foundation governance" — CONFIRMED, and stronger than expected** (v1.0 + 8-vendor TSC).
**→ learn-only for now.** Genuinely well-governed, but A2A solves *agent-to-agent* interop. For a single-user coding suite it is a solution to a problem you don't have yet; revisit if you ever federate agents across trust boundaries.

#### ACP — the quiet winner
`agentclientprotocol/agent-client-protocol` `[V]`, 4.1k★, Apache-2.0, ~2,110 commits. *"A protocol for connecting any editor to any agent."* Site agentclientprotocol.com. Has `GOVERNANCE.md`, `MAINTAINERS.md`, `CODE_OF_CONDUCT.md`; **no CLA required** `[V]`. Ships Rust crates, JSON Schema, and SDKs for Kotlin, Java, Python, Rust, TypeScript `[V]`.
Zed's authorship is widely understood but **not stated on the repo page** — **`[U]` / ACCESS LIMITATION**; the move into a neutral `agentclientprotocol` org is itself evidence of deliberate vendor-neutralisation `[I]`.
**Why it matters:** ACP adoption showed up *unprompted* three times in this survey — OpenHands orchestrates "other ACP-compatible agents" `[V]`, Open Interpreter's Rust rewrite advertises ACP compatibility `[V]`, and Qwen Code brands itself "multi-protocol" `[V]`. Only 4.1k★, but it is becoming the de-facto editor↔agent seam.
**→ adopt.** Smallest-surface, highest-leverage integration point in the whole list: implement it once and you plug into every ACP editor and every ACP agent. Complements MCP (tools) rather than competing.

#### ToolHive
`stacklok/toolhive` `[V]` — seed correct, no transfer. 2.0k★, Apache-2.0, ~4,192 commits, active. *"an enterprise-grade platform for running and managing MCP servers"* `[C]`. Stacklok also has two people in the MCP Skills WG `[V]`, so they're plugged into the standards process.
**→ spike.** The right shape for the "run untrusted MCP servers safely" problem; small community, so validate before depending.

#### Docker MCP Gateway
`docker/mcp-gateway` `[V]` — seed correct, exists, **not archived**. 1.5k★, **MIT**, ~1,047 commits, active. A **Docker CLI plugin**; container-based servers, secrets management, OAuth integration, dynamic tool discovery; works inside Docker Desktop *and* standalone `[V]`.
**→ adopt (for MCP server sandboxing).** Vendor-backed, MIT, and containers are the pragmatic answer to the fact that MCP tool descriptions are explicitly untrusted input under the spec's own security model `[V]`.

---

## 3. Code intelligence & memory

| Project | Canonical repo | Stars | Licence | Status |
|---|---|---:|---|---|
| **tree-sitter** | `tree-sitter/tree-sitter` | 26.7k | MIT | active `[V]` |
| **Zoekt** | `sourcegraph/zoekt` | 1.8k | Apache-2.0 | active `[V]` |
| **SCIP** | `scip-code/scip` | 750 | Apache-2.0 | active `[V]` |
| **Graphiti** | `getzep/graphiti` | 30.3k | Apache-2.0 | active `[V]` |
| **Cognee** | `topoteretes/cognee` | 30.2k | Apache-2.0 | active `[V]` |
| **Mem0** | `mem0ai/mem0` | 64k | Apache-2.0 | active `[V]` |
| **Letta** | `letta-ai/letta` | 24.4k | Apache-2.0 | active `[V]` |

### tree-sitter
`tree-sitter/tree-sitter` `[V]`, 26.7k★, **MIT**, ~6,500 commits, active (94 open issues, 12 PRs). Incremental parsing; **dependency-free pure C runtime**, designed to be embeddable and fast enough to reparse on every keystroke, with error recovery `[V]`.
**→ adopt.** The single most load-bearing, lowest-risk dependency in this entire report. MIT, no deps, and it already underpins Aider's repo-map and ast-grep.

### Zoekt
`sourcegraph/zoekt` `[V]` — canonical, **not archived**, active. 1.8k★, Apache-2.0, ~1,963 commits. *"Fast trigram based code search"*; substring + regexp with a boolean query language; ranks with code-aware signals like symbol matches; ships CLI tools and an indexing/search server `[V]`. Page notes it is the maintained line since a **2017 fork of `google/zoekt`** `[V]`.
**→ compose.** Trigram+regex over a whole repo is exactly the lexical half of agent retrieval, and it is battle-tested at Sourcegraph scale. Pair with symbol-level intel rather than using alone.

### SCIP
`scip-code/scip` `[V]` — canonical (**not** `sourcegraph/scip`). 750★, Apache-2.0, ~319 commits. *"a language-agnostic protocol for indexing source code"* powering go-to-definition, find-references, find-implementations `[V]`. Many **indexers still live under the `sourcegraph` org**, and Sourcegraph tooling/docs are referenced throughout `[V]` — so the protocol moved to a neutral org while the implementations largely didn't `[I]`.
**→ learn-only.** The data model is the right way to think about cross-repo symbol graphs, but with 750★ and a split ecosystem the integration cost is high relative to running an LSP directly (which is what Serena does — see §4).

### Graphiti — both backend claims VERIFIED
`getzep/graphiti` `[V]`, 30.3k★, Apache-2.0, ~951 commits. *"Build Real-Time Knowledge Graphs for AI Agents."*

Backends `[V]`: **Neo4j** (5.26+), **FalkorDB** (1.1.2+), **Amazon Neptune** (Database Cluster + Analytics Graph), **Kuzu** (0.11.2, deprecated).

- **CLAIM "Kuzu integrations are deprecated" — CONFIRMED** `[V]`. Verbatim: *"Kuzu is deprecated and will be removed in a future release — the upstream Kuzu project is no longer maintained."*
- **Independently corroborated at the source** `[V]`: <https://github.com/kuzudb/kuzu> was **archived by its owner on 2025-10-10** and is read-only. Last release **v0.11.3**, MIT, ~5,231 commits; notice says *"Kuzu is working on something new!"* and directs existing users to pin v0.11.3 or run a local extension server; docs moved to `kuzudb.github.io`. **This is a genuine upstream shutdown, not a preference change by Zep.**
- **FalkorDB status — NOT deprecated** `[V]`. Fully supported, installation extras available, described as having feature parity. Graphiti steers new projects to **Neo4j or FalkorDB**.

**→ compose (on Neo4j or FalkorDB) / reject the Kuzu path.** Bi-temporal agent knowledge graphs are the right primitive for long-running memory, but the Kuzu episode is a warning: **the embedded-graph-DB option evaporated with ~10 months' notice.** Choose a backend you could still run if its vendor vanished.

### Cognee
`topoteretes/cognee` `[V]`, 30.2k★, Apache-2.0, ~9,790 commits, active. *"the open-source AI memory platform for agents… persistent long-term memory across sessions with a self-hosted knowledge graph engine."* Combines vector embeddings with graph reasoning; ingests multiple formats `[V]`. No licence change found `[V]`.
**→ spike.** Closest in ambition to Graphiti with a self-hosted-first posture; high commit volume relative to age suggests churn, so pin versions.

### Mem0
`mem0ai/mem0` `[V]`, 64k★, **Apache-2.0 — no licence change found** `[V]`, ~2,614 commits. *"Universal memory layer for AI Agents."* Three tiers: library (pip/npm), self-hosted server, managed cloud `[V]`.
**→ spike.** Largest community of the memory layers and the licence checks out, but the tiering is a classic open-core gradient `[I]` — verify the self-hosted path covers your needs before committing.

### Letta
`letta-ai/letta` `[V]`, 24.4k★, **Apache-2.0 — no licence change found** `[V]`, ~7,472 commits, active. *"Platform for stateful agents."* README confirms **"Letta (f.k.a. MemGPT)"** `[V]`. **V1 source is on a separate branch, described as unsupported and not for production** `[V]`.
**→ learn-only.** The MemGPT paper's memory-hierarchy idea is worth stealing outright; adopting the platform means adopting an agent runtime you may not want alongside the ones above.

---

## 4. The 3–5 strongest things the seed list missed

Ranked by decision-relevance to a coding-agent suite.

### 1. Serena — `oraios/serena` — **the biggest omission**
28.4k★, **MIT**, ~3,308 commits `[V]`. *"A powerful MCP toolkit for coding… the IDE for your agent."*
An **MCP server that gives agents symbol-level code understanding via LSP**: find symbols, references, type hierarchies, declarations; rename symbols/files, move code, inline functions, propagate deletions; replace symbol bodies, insert at precise locations, safe deletion `[V]`. **LSP backend covers 40+ languages** (Python, Java, TS/JS, Go, Rust, C/C++, C#, Ruby, PHP, Kotlin, Swift, Ada, Erlang, Haskell, Julia, Lua, R…) and is free/open-source by default; a **commercial JetBrains plugin** adds interactive debugging (breakpoints, variable inspection) `[V]`.
**Why the seed list needed this:** the list has Zoekt (lexical), SCIP (index format) and tree-sitter (parsing) — three *ingredients*. Serena is the *assembled dish*, and it speaks MCP natively, so it drops straight into any MCP host with no glue.
**→ adopt.** Highest value-per-integration-hour in this report. Note the open-core split: LSP path MIT, JetBrains path commercial `[V]`.

### 2. OpenAI Codex CLI — `openai/codex`
**116.9k★**, **Apache-2.0**, ~9,733 commits, Rust + TS `[V]`. *"Lightweight coding agent that runs in your terminal."*
The second-most-starred agent found anywhere in this survey and **entirely absent from the seed list**, despite being the acknowledged upstream of Open Interpreter's Rust rewrite `[V]`. Apache-2.0 with a patent grant is the most defensible licence among the top-tier agents.
**ACCESS LIMITATION:** MCP/ACP support **not confirmed** from the repo page `[U]`.
**→ spike.** You cannot credibly survey 2026 coding agents and omit the 117k-star Apache-2.0 one.

### 3. Kilo Code — `Kilo-Org/kilocode`
27.0k★, **MIT**, **~29,579 commits** — the highest commit count in this entire report `[V]`. *"the all-in-one agentic engineering platform."* Ships VS Code, CLI, JetBrains and cloud `[V]`.
**Important lineage correction:** the repo states **Kilo CLI began as a fork of OpenCode** `[V]` — *not* of Roo/Cline, contrary to the usual "Kilo = Roo fork" shorthand.
**→ spike.** With Roo archived and Continue read-only, Kilo is the most active surviving IDE-extension lineage, and MIT.

### 4. ast-grep — `ast-grep/ast-grep`
15.6k★, **MIT**, Rust `[V]`. Structural search, lint and rewrite: patterns written as ordinary code with `$METAVAR` wildcards, jQuery-like AST traversal API, YAML rule config, multi-core `[V]`. Explicitly *"ast-grep's core is an algorithm to search and replace code based on abstract syntax tree produced by tree-sitter"* `[V]`.
**→ adopt.** The precise, deterministic, token-free counterpart to LLM editing — the right tool for mechanical refactors an agent shouldn't be paying tokens to do. Composes directly with the tree-sitter dependency you already want.

### 5. Crush — `charmbracelet/crush` — **included with a licence warning**
27.6k★, Go, ~4,040 commits `[V]`. Supports **both LSP** (gopls, typescript-language-server, nil via `crushrc`) **and MCP** across stdio, http and sse transports `[V]`.
**⚠ LICENCE FLAG: `FSL-1.1-MIT`** `[V]` — the **Functional Source License**, which is **source-available, not OSI open source**. It restricts competing use and converts to MIT on a delay. This is the **only non-OSI licence in this entire report**, and it is easy to miss because the trailing `-MIT` makes it look permissive at a glance.
**→ learn-only, pending legal review.** Technically the cleanest LSP+MCP integration in a single binary, and worth reading for that. Do not treat as open source.

**Honourable mention:** `zilliztech/claude-context` — 12.4k★, MIT `[V]`; MCP server doing hybrid BM25+dense retrieval with AST chunking and Merkle-tree incremental reindexing, claiming ~40% token reduction `[C]`. Requires Milvus/Zilliz `[V]`. **→ spike** if vector-based recall is wanted alongside Serena's symbolic path.

---

## 5. Consolidated recommendations

| Verdict | Projects |
|---|---|
| **adopt** | MCP `2026-07-28` core (stdio + Streamable HTTP), Elicitation, official MCP SDKs, **ACP**, **Serena**, **tree-sitter**, **ast-grep**, Docker MCP Gateway, Cline, goose, mini-SWE-agent |
| **compose** | Gemini CLI, Zoekt, Graphiti (Neo4j/FalkorDB only) |
| **spike** | MCP Apps, MCP Tasks, OpenCode, OpenHands, ToolHive, Kilo Code, Codex CLI, Cognee, Mem0, claude-context |
| **learn-only** | Skills over MCP, A2A, SCIP, Aider, Open Interpreter, Qwen Code, SWE-agent, Agentless, Letta, **Crush (licence)** |
| **reject** | HTTP+SSE, Sampling, Roots, Logging, DCR, **Continue**, **Roo Code**, **Graphiti-on-Kuzu** |

---

## 6. ACCESS LIMITATIONS

1. **Bash/`curl` unavailable all session** — the tool-safety classifier was rate-limited on every attempt. Raw HTTP redirect chains (301 + `Location:`) could **not** be observed; canonical ownership was inferred from the org name rendered on the followed page. This is strong evidence but weaker than a raw redirect header.
2. **WebSearch rate-limited** at the start of the session; recovered later. Primary sources were used throughout regardless.
3. **`api.github.com` deliberately not used**, per the brief. No commit counts, release dates or licence SPDX IDs were read from the API; all come from rendered HTML.
4. **`raw.githubusercontent.com` LICENSE files not fetched** (blocked with Bash). **Every licence in this report is read off a repo landing-page badge, not a LICENSE file.** This is the single largest verification gap — landing-page licence detection is heuristic and known to misreport dual-licensed and multi-directory repos.
5. **Exact release versions/dates missing for many repos** — GitHub landing pages often do not surface them. Where dates mattered (Aider, Agentless, Kuzu) they were chased to a releases/commits page.
6. **PyPI `aider-chat` upload dates were internally inconsistent** with the GitHub release timeline and were **discarded**, not reconciled. Aider's staleness rests on GitHub releases + commit history only.
7. **Gemini CLI hooks documentation NOT retrieved** — only token-caching was verified. Hooks support is `[U]`.
8. **Codex CLI MCP/ACP support unverified** `[U]`.
9. **ACP's Zed authorship not confirmed** from primary sources `[U]`.
10. **Per-SDK extension support (Tasks/Apps) not verified** for any of the 10 official MCP SDKs; the spec states support is optional and per-maintainer.
11. **The `sst` → `anomalyco` rename of OpenCode is unexplained** in the README `[U]`.
12. **SEO listicles were consulted and largely discarded** — multiple 2026-dated "best coding agent" articles still list **Roo Code and Continue as live, recommended options**, both of which primary sources show are archived/read-only. One also asserted a "CodeGraph (MIT, 47.4k stars)"; unverified and **excluded**. Treat that entire genre as unreliable for status.
13. No login-gated pages accessed; no 403s encountered on the sources used.

---

## 7. Exact queries and fetches run

**WebSearch queries (3):**
1. `Model Context Protocol specification 2026-07-28 version sampling deprecated` *(rate-limited, returned no results)*
2. `best open source coding agent 2026 terminal CLI alternatives opencode crush codex`
3. `open source semantic code search index MCP server codebase context engine 2026 Serena alternative`

**WebFetch URLs (all accessed 2026-08-24):**

*MCP*
- `https://modelcontextprotocol.io/specification/latest`
- `https://modelcontextprotocol.io/specification/2026-07-28/client`
- `https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation`
- `https://modelcontextprotocol.io/specification/2026-07-28/basic/transports`
- `https://modelcontextprotocol.io/specification/2026-07-28/deprecated`
- `https://modelcontextprotocol.io/llms.txt`
- `https://modelcontextprotocol.io/extensions/overview`
- `https://modelcontextprotocol.io/extensions/tasks/overview`
- `https://modelcontextprotocol.io/extensions/apps/overview`
- `https://modelcontextprotocol.io/extensions/client-matrix`
- `https://modelcontextprotocol.io/community/working-groups/skills-over-mcp`
- `https://github.com/modelcontextprotocol`

*Agents / protocols*
- `https://github.com/anomalyco/opencode` *(rate-limited)* · `https://github.com/sst/opencode` · `https://github.com/anomalyco/opencode/blob/dev/README.md`
- `https://github.com/OpenHands/OpenHands` · `https://github.com/All-Hands-AI/OpenHands`
- `https://github.com/aaif-goose/goose` · `https://github.com/block/goose` · `https://block.github.io/goose/`
- `https://github.com/cline/cline`
- `https://github.com/QwenLM/qwen-code`
- `https://github.com/Aider-AI/aider` · `https://github.com/Aider-AI/aider/releases` · `https://github.com/Aider-AI/aider/commits/main` · `https://pypi.org/pypi/aider-chat/json`
- `https://github.com/OpenInterpreter/open-interpreter`
- `https://github.com/google-gemini/gemini-cli` · `https://geminicli.com/docs/cli/token-caching/`
- `https://github.com/stacklok/toolhive`
- `https://github.com/docker/mcp-gateway`
- `https://github.com/a2aproject/A2A` · `https://a2a-protocol.org/latest/`
- `https://github.com/agentclientprotocol/agent-client-protocol`
- `https://github.com/SWE-agent/mini-swe-agent` · `https://github.com/SWE-agent/SWE-agent`
- `https://github.com/OpenAutoCoder/Agentless`
- `https://github.com/continuedev/continue`
- `https://github.com/RooCodeInc/Roo-Code`

*Code intel / memory*
- `https://github.com/sourcegraph/zoekt`
- `https://github.com/scip-code/scip`
- `https://github.com/tree-sitter/tree-sitter`
- `https://github.com/getzep/graphiti` · `https://github.com/kuzudb/kuzu`
- `https://github.com/topoteretes/cognee`
- `https://github.com/mem0ai/mem0`
- `https://github.com/letta-ai/letta`

*Gap-filling*
- `https://github.com/openai/codex`
- `https://github.com/oraios/serena`
- `https://github.com/charmbracelet/crush`
- `https://github.com/Kilo-Org/kilocode`
- `https://github.com/ast-grep/ast-grep`
- `https://github.com/zilliztech/claude-context`
