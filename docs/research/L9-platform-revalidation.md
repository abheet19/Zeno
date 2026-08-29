# L9 — Platform Export/Import Landscape Revalidation

Phase-0A research worker output. Access date for all URLs: **2026-08-24**. Read-only public research; no logins, no purchases, no state changes.

Claim labels: **[verified]** = read directly from official vendor doc (URL given); **[inferred]** = reasonable conclusion from verified facts or secondary corroboration; **[unknown]** = could not be verified against a primary source; **[observed]** = seen directly in a live environment, not in public docs.

---

## 1. Source → Direction Matrix

| Source | Item types | Export path | Import path (into it) | Direction supported | Limits | Authorization | Status |
|---|---|---|---|---|---|---|---|
| **Claude (claude.ai)** | Conversation data + account user data (projects/artifacts not explicitly listed) | Settings → Privacy → Export data → email download link | None documented for personal accounts ("Exported data can't be imported into another personal Claude account") | Export-only (one-way out) | Link expires 24 h; not available from mobile apps | Free/Pro/Max: self-serve. Team/Enterprise: Primary Owner only | **[verified]** support.claude.com/en/articles/9450526 |
| **Claude Code — CLAUDE.md / rules** | Plain Markdown instruction files | Copy files (plain text on disk) | `/init` reads `.cursor/rules/`, `.cursorrules`, `.github/copilot-instructions.md`; with `CLAUDE_CODE_NEW_INIT=1` also `AGENTS.md`, `.devin/rules/`, `.windsurf/rules/`, `.clinerules`. `/import` (v2.1.213+) brings a supported agent's config: instruction files → CLAUDE.md, plus MCP servers, commands, subagents, skills | Bidirectional at file level (plain files); documented **import from Cursor/Copilot/others into Claude Code** | — | Local file access only; external `@` imports in project files prompt an approval dialog | **[verified]** code.claude.com/docs/en/memory |
| **Claude Code — auto memory** | `MEMORY.md` index + per-topic `.md` files, YAML frontmatter (`type`, `modified`) | Plain Markdown at `~/.claude/projects/<project>/memory/` — copyable | Editable/plantable by hand ("plain markdown you can edit or delete at any time") | File-level both ways; machine-local, "not shared across machines or cloud environments" | Index load capped at first 200 lines / 25 KB; topic files loaded on demand | None (local files) | **[verified]** code.claude.com/docs/en/memory |
| **Claude Code — sessions** | JSONL transcripts at `~/.claude/projects/<project>/<session-id>.jsonl` (`<project>` = cwd path, non-alphanumerics → `-`) | `/export` (clipboard or plain-text file); `claude -p --output-format json`; hooks' `transcript_path`; SDK `listSessions()`/`getSessionMessages()` | Move the `.jsonl` file into any dir under `~/.claude/projects/` on another machine, then `--resume` (documented); SDK `SessionStore` adapter for shared backends | Export + documented cross-host restore | 30-day retention (`cleanupPeriodDays`); JSONL entry format "internal … can break on any release" | None (local) | **[verified]** code.claude.com/docs/en/sessions + /agent-sdk/sessions |
| **Claude Code — checkpoints** | File snapshots per user prompt | Not exportable; rewind-only via `/rewind` | n/a | Internal only | 100 most recent checkpoints/session; deleted with session after 30 days; bash-command and subagent edits not tracked | None | **[verified]** code.claude.com/docs/en/checkpointing |
| **Claude Code — skills** | `SKILL.md` dirs: personal `~/.claude/skills/<name>/`, project `.claude/skills/<name>/`, plugin `<plugin>/skills/<name>/`; claude.ai-synced → `~/.claude/skills/synced/` | Plain files; symlinks supported; shareable via git/plugins/marketplaces | Copy dirs; `CLAUDE_CODE_SYNC_SKILLS` pulls claude.ai-enabled skills down | Bidirectional (plain files); ChatGPT desktop can import them (see below) | `synced` folder name reserved | Project skills-as-plugins need workspace trust | **[verified]** code.claude.com/docs/en/skills |
| **Claude Code — artifacts** | Published HTML/MD pages on claude.ai (`claude.ai/code/artifact/...`) | Source file stays local in project; org-level Compliance API `GET /v1/compliance/code/artifacts` (+ per-version content, DELETE) | Republish from file; `/artifacts` lists/attaches | Hosted, source-file recoverable; org compliance export exists | 16 MiB page cap; retention set by org policy | claude.ai login; Pro/Max/Team/Enterprise; not on Bedrock/Vertex/Foundry, ZDR orgs | **[verified]** code.claude.com/docs/en/artifacts |
| **ChatGPT (consumer)** | Chat history + account data | Settings → Data Controls → Export data → email link; ZIP w/ `conversations.json` + `chat.html` | (See desktop import row) | Export-only out | Link expires 24 h; processing up to 7 days | Account owner | **[inferred]** — official article help.openai.com/en/articles/7260999 returned **HTTP 403 twice** (bot-gated); details corroborated by multiple secondary sources only |
| **ChatGPT desktop app — Import** | Instruction files (`AGENTS.md`), config (`settings.json`, `config.toml`), skills, plugins, project folders, project memories, chat sessions, MCP server config, hooks, slash commands, subagents | **No export to other agents documented anywhere** | Settings → Import; sources: **Claude Code, Claude Cowork, Cursor**; optional "automatic updates to keep imported work in sync with the original agent"; import history reviewable | **One-way IN only** (with optional standing one-way sync) | "Last 30 days of chats" (no numeric cap stated for desktop) | Post-import status card; plugins/connections needing auth completed via Finish flow | **[verified]** learn.chatgpt.com/docs/import |
| **Codex CLI — `/import`** | Same item classes as desktop (setup, project files, recent chats) | None documented | `/import` in local TUI; sources: **Claude Code, Cursor** | One-way IN only | **Up to 50 chats from the last 30 days**; unavailable during a running task, remote session, or app-server daemon | Interactive selection | **[verified]** learn.chatgpt.com/docs/import |
| **Codex — memories** | Summaries, durable entries, recent inputs, supporting evidence under `~/.codex/memories/` (`$CODEX_HOME/memories/`) | Files inspectable ("review memory files before sharing your Codex home directory"); no export tooling; "treat as generated state," don't hand-edit as primary control | Generated by Codex only | Local generated state; no documented portability | **Off by default**; enable via Settings → Personalization or `memories = true` in `[features]` of `config.toml`; `/memories` for per-chat control | Regional note: doc opens "Memories are off by default. In the European Economic Area, the United …" **[inferred — seen in search snippet only; full regional text not captured]** | **[verified]** learn.chatgpt.com/docs/customization/memories (308-redirect target of developers.openai.com/codex/memories) |
| **Codex — Computer History** | Interaction events (clicks, typing, shortcuts, app context via macOS accessibility) → generated Markdown memories | Memories are plain unencrypted Markdown at `$CODEX_HOME/memories/extensions/skysight/` — copyable | n/a | Local files out; events transit OpenAI servers | Off by default; **macOS desktop app only**; requires Memories on; not via API key or Bedrock. Event files kept locally "up to 48 hours" in ChatGPT App Group container; sent periodically to OpenAI for summarization; "OpenAI does not retain those event files after processing unless required by law." No screenshots/mic/system audio; private browsing excluded | Pro opt-in; **Business/Enterprise: admin must "explicitly grant access" in Workspace Settings first** | **[verified]** learn.chatgpt.com/docs/customization/computer-history |
| **Cursor** | Chats, rules, config; server-side: embeddings + metadata (hashes, file names) | **No official export of chats/rules/config documented** on the data-use page. Local artifacts (`.cursor/rules/`, `.cursorrules`) are plain files other agents read (Claude Code `/init`, ChatGPT/Codex import) | Cursor is an import *source* for ChatGPT desktop, Codex CLI, and Claude Code `/import` | Others pull FROM Cursor; Cursor documents no pull/push of its own | Privacy Mode: no training, zero-data-retention with providers; embeddings + metadata stored permanently even though plaintext deleted post-embedding | Privacy Mode toggle | **[verified]** cursor.com/data-use (page: "Data Use & Privacy Overview," updated 2026-07-15) |
| **NeoSapien (Neo 1)** | Voice-captured "memories," summaries, action items, reminders | Marketing: "Export everything or delete everything, anytime"; "Bring Neo 1 Memories to Any AI — Use everything Neo 1 remembers inside ChatGPT, Claude and more" — **no mechanism, API, or MCP documentation published** | No public import path | Claimed export; undocumented mechanism | — | — | **[verified claims, unknown mechanism]** neosapien.ai (see §2) |
| **Obsidian** | Vault = plain local Markdown files (+ settings, themes, plugins, attachments via Sync) | None needed — vault is already plain `.md` on disk | Drop `.md` files in vault | Fully bidirectional by design | Sync Standard: 1 vault, 1 GB, 5 MB/file, 1-mo history. Plus: 10 vaults, 10 GB (→100 GB), 200 MB/file, 12-mo history | Sync Standard **$4/mo annual / $5 monthly**; Plus **$8/$10**; E2E AES-256 | **[verified]** obsidian.md/sync |

---

## 2. NeoSapien MCP officialness — the key question

**Verdict: no publicly documented, vendor-published MCP server or package exists for NeoSapien Neo 1 as of 2026-08-24.**

Evidence:
- Official MCP registry API (`registry.modelcontextprotocol.io/v0/servers?search=neosapien`): **0 servers** ("servers":[], count 0). **[verified]**
- claude.ai connector-registry search (keywords neosapien/neo/memories/wearable): **0 results**. **[observed]**
- Web + GitHub searches for a NeoSapien-published MCP repo or connection doc: nothing. neosapien.ai, shop.neosapien.ai, pdp.neosapien.ai, terms, privacy — no mention of MCP or Model Context Protocol anywhere. **[verified]**
- Name collisions confirmed unrelated: **NeoAIResearch/neo-mcp** (heyneo.com — "Neo" autonomous ML-engineering agent by NEO Research Inc.), neo4j MCP servers, r3e-network/neo-n3-mcp (Neo blockchain), projectdiscovery "neo," neomjs/neo. None relate to the wearable. **[verified]**
- User reviews explicitly complain there is "no bulk export of notes … no easy way to connect the data into broader workflows through something like an MCP-style connector." **[verified, secondary]**
- Countervailing direct evidence: this research session itself has a live "NeoSapien" MCP connector attached exposing `search_memories`, `export_memories`, `get_memory_transcript`, `get_reminders`, etc. **[observed — not public documentation]**

**What a user connecting "NeoSapien" from their account would most plausibly be using in 2026 [inferred]:** a vendor-hosted **remote MCP endpoint tied to their NeoSapien account** (added as a custom connector by URL, or surfaced in-app), fulfilling the site's "Bring Neo 1 Memories to Any AI" claim — but one that NeoSapien has **not** published in the official registry, on GitHub, or in any public connection doc. Any design should treat its endpoint URL, auth, schema, and stability as **unknown/undocumented**, with the observed tool surface (search/export/transcript/reminders, timezone handled server-side at sign-in) as the only schema signal.

---

## 3. Direction gaps (no documented reverse path)

- **Codex/ChatGPT → Claude (any surface): none.** learn.chatgpt.com/docs/import documents zero export-to-other-agent capability; imports are one-way in, optionally continuously synced one-way. Escape hatches are file-level only: `$CODEX_HOME/memories/` and `AGENTS.md` are plain files (Claude Code reads `AGENTS.md` via `@AGENTS.md` import or symlink).
- **Codex chat history → anything: none documented.** Claude Code `/import` documents config/MCP/commands/subagents/skills, not Codex chat transcripts.
- **Claude personal-account export → any Claude account: explicitly unsupported** ("can't be imported into another personal Claude account").
- **Cursor: export-silent.** It is everyone's favorite import *source* (ChatGPT desktop, Codex CLI, Claude Code) but documents no export or import of its own; server-side embeddings/metadata are permanently retained and not user-exportable.
- **ChatGPT consumer export → Claude:** Claude's `anthropic-skills:import-memory`-style flows exist client-side, but OpenAI documents no assisted path; the ZIP (`conversations.json`) is the only interchange object. **[inferred]**

---

## 4. Limitations

- **help.openai.com is bot-gated (HTTP 403)** — article 7260999 could not be read directly (tried both bare-ID and full-slug URLs). ChatGPT export details (ZIP contents, 24-h link, ≤7-day processing) are corroborated by multiple secondary sources but not primary-verified.
- **Codex memories regional (EEA/UK) clause**: the `.md` doc visibly opens with "Memories are off by default. In the European Economic Area, the United …" in search snippets, but the fetched extraction did not return the full regional sentence — regional specifics **[unknown]**.
- Memory file **formats** under `$CODEX_HOME/memories/` (other than skysight's stated Markdown) are not specified in the doc.
- Desktop-app import chat cap: doc gives "last 30 days" but no numeric limit (the 50-chat cap is stated only for Codex CLI).
- NeoSapien connector endpoint/auth details: observable only from an authenticated account; nothing public to cite.
- Claude data-export file format is not specified in article 9450526.

---

## 5. Five biggest corrections / surprises vs seed claims

1. **The OpenAI Codex docs moved mid-flight.** `developers.openai.com/codex/memories` and `/codex/memories/chronicle` now 308-redirect to `learn.chatgpt.com/docs/customization/memories` and `/docs/customization/computer-history`. The seed's "chronicle" slug is the giveaway of the old tree; cite learn.chatgpt.com going forward. (All seed Computer History claims — off by default, macOS-only, Memories prerequisite, admin grant for Business/Enterprise, ~48-h local event files, server-side summarization, `$CODEX_HOME/memories/extensions/skysight/` Markdown — verified intact, with two sharpenings: event files live in the sandboxed ChatGPT App Group container, and the skysight Markdown is explicitly **unencrypted** and readable by any same-user process.)
2. **The 50-chats/30-days limit is CLI-only.** The desktop-app import documents "last 30 days of chats" with **no numeric cap**, and adds something the seed missed entirely: an optional **standing one-way sync** ("automatic updates to keep imported work in sync with the original agent") — OpenAI doesn't just import your Claude Code setup once, it can continuously mirror it. Import scope is also broader than seeded: hooks, slash commands, subagents, MCP config, and project memories are all listed.
3. **Codex local memories are off by default** (opt-in via Settings → Personalization or `memories = true` in `config.toml`), with an EEA/UK regional clause at the top of the doc — a bigger adoption gate for Codex-side context than the seed implied, and OpenAI explicitly tells users to treat the files as generated state, not a control surface.
4. **The migration asymmetry is now fully bilateral at the config layer but one-way at the chat layer.** Claude Code has grown its own `/import` (v2.1.213+: instruction files, MCP servers, commands, subagents, skills from other agents) and `/init` reads Cursor/Copilot/Windsurf/Devin/Cline rule files — so *configs* flow both directions. But **chat history** flows only into OpenAI: Codex imports Claude Code chats; nothing documented imports Codex chats. Meanwhile Claude Code's own transcripts are the most migration-friendly substrate of all: documented JSONL paths, a documented cross-host restore recipe, SDK `listSessions()`/`getSessionMessages()`, and an org Compliance API for artifacts — though the JSONL entry format is explicitly declared unstable.
5. **NeoSapien's MCP is real but officially invisible.** The site now markets "Bring Neo 1 Memories to Any AI (ChatGPT, Claude and more)" and "Export everything… anytime," and a live account-bound NeoSapien MCP connector demonstrably exists (observed in this session with search/export/transcript/reminder tools) — yet there is **zero** public documentation: no listing in the official MCP registry (0 results), no claude.ai registry hit, no GitHub org, no connection doc. Every "neo" MCP a user would find by searching (NeoAIResearch/neo-mcp, neo4j, neo-n3, heyneo) is a name collision. A design must treat NeoSapien as an undocumented vendor-hosted remote MCP, not a packaged integration. Bonus surprise: `help.openai.com` itself is bot-gated (403), making ChatGPT's own export article the only seed source that couldn't be primary-verified, while Cursor's data-use page confirms **no official chat/rules/config export exists** and that code embeddings + filename metadata are retained permanently even in Privacy Mode.

---

## Appendix — exact queries run (2026-08-24)

WebFetch (primary sources):
1. `https://support.claude.com/en/articles/9450526`
2. `https://help.openai.com/en/articles/7260999` → 403
3. `https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data` → 403
4. `https://code.claude.com/docs/en/memory`
5. `https://code.claude.com/docs/en/checkpointing`
6. `https://code.claude.com/docs/en/sessions`
7. `https://code.claude.com/docs/en/skills`
8. `https://code.claude.com/docs/en/agent-sdk/sessions`
9. `https://code.claude.com/docs/en/artifacts`
10. `https://learn.chatgpt.com/docs/import`
11. `https://developers.openai.com/codex/memories.md` → 308 → `https://learn.chatgpt.com/docs/customization/memories.md?surface=app` (fetched)
12. `https://developers.openai.com/codex/memories/chronicle` → 308 → `https://learn.chatgpt.com/docs/customization/computer-history` (fetched)
13. `https://www.cursor.com/data-use`
14. `https://obsidian.md/sync`
15. `https://registry.modelcontextprotocol.io/v0/servers?search=neosapien`
16. `https://neosapien.ai/`
17. `https://github.com/NeoAIResearch/neo-mcp`

WebSearch:
1. `ChatGPT "export data" help.openai.com how to export chats JSON format download link 24 hours`
2. `ChatGPT desktop app import chats from Claude Code Cursor "import" coding agents OpenAI documentation`
3. `Codex CLI "/import" Claude Code Cursor import chats limit developers.openai.com`
4. `Codex "CODEX_HOME" memories documentation openai`
5. `Codex "computer history" feature macOS "skysight" OR memories openai documentation`
6. `NeoSapien MCP server Neo 1 memories official model context protocol`
7. `"NeoSapien" "Neo 1" wearable pendant MCP OR API OR export memories`
8. `github "neosapien" mcp server OR "neo-mcp" NeoAIResearch`
9. `NeoSapien connect Claude ChatGPT "MCP" memories integration how to neosapien.ai`
10. `site:neosapien.ai OR site:shop.neosapien.ai mcp OR "model context protocol" OR "bring neo 1 memories"`

Other:
- claude.ai MCP connector-registry search: keywords `["neosapien","neo","memories","wearable"]` → `{"results":[]}`
