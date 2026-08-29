# L6 — GitHub Census: Jarvis/Ultron-class Personal-Assistant Projects

**Snapshot date:** 2026-08-24 (all timestamps UTC)
**Method:** Unauthenticated GET requests to `https://api.github.com/search/repositories`, `sort=stars&order=desc&per_page=50&page=1` — page 1 only, per the 10-search-request cap.
**Raw data:** every response body saved verbatim in `L6-raw/*.json`; request log in `L6-raw/fetch-log.txt`; deduplicated manifest (all 474 repos, all fields, per-query provenance) in `L6-manifest.json`.
**Claim labels:** *verified* = read directly from API responses; *inferred* = analyst judgment from the verified fields; *unknown* = not determinable from this snapshot.

---

## 1. Query log (verified)

All 10 queries returned HTTP 200 with 50 items and `incomplete_results: false`.

| # | Query (`q=`) | Timestamp (UTC) | total_count | Raw file |
|---|---|---|---|---|
| Q1 | `jarvis in:name` | 2026-08-24T15:32:35Z | 62,731 | `01-jarvis-in-name.json` |
| Q2 | `ultron in:name` | 2026-08-24T15:33:26Z | 2,311 | `02-ultron-in-name.json` |
| Q3 | `topic:personal-assistant` | 2026-08-24T15:33:33Z | 1,167 | `03-topic-personal-assistant.json` |
| Q4 | `topic:voice-assistant` | 2026-08-24T15:33:40Z | 4,657 | `04-topic-voice-assistant.json` |
| Q5 | `ai-os in:name,description` | 2026-08-24T15:33:46Z | 18,012 | `05-ai-os-in-name-description.json` |
| Q6 | `computer-use in:name,description` | 2026-08-24T15:33:53Z | 97,727 | `06-computer-use-in-name-description.json` |
| Q7 | `meeting-copilot OR meeting-assistant in:name,description` | 2026-08-24T15:34:01Z | 4,459 | `07-meeting-copilot-or-meeting-assistant.json` |
| Q8 | `local-first assistant in:description` | 2026-08-24T15:34:08Z | 2,016 | `08-local-first-assistant-in-description.json` |
| Q9 | `desktop-agent in:name,description` | 2026-08-24T15:34:15Z | 8,002 | `09-desktop-agent-in-name-description.json` |
| Q10 | `jarvis assistant in:description` | 2026-08-24T15:34:22Z | 5,315 | `10-jarvis-assistant-in-description.json` |

Full URL template (substitute the URL-encoded `q`):
`https://api.github.com/search/repositories?q=<Q>&sort=stars&order=desc&per_page=50&page=1`
(exact per-query URLs are recorded in `L6-raw/fetch-log.txt`).

**Rate-limit incident (verified):** at 15:32:38Z the first attempts at Q2–Q4 returned HTTP 403 ("API rate limit exceeded for 122.161.241.243") after only one successful call — the unauthenticated search quota (10/min) is per-IP and this connection sits behind a shared/CGNAT IP whose window was already partially consumed by other tenants. `/rate_limit` showed the quota reset at 15:34:00Z; Q2–Q10 were reissued paced ~5–7 s apart within the fresh window and all succeeded. Totals: **10 successful search requests + 3 rate-limited attempts that returned no data** (all logged). No other endpoint was rate-limited.

## 2. Documented caps, gaps, and limitations

This census is a **snapshot of page 1 of ten star-sorted searches — not "all of GitHub".**

1. **10-search-request cap, page 1 only, per_page=50.** Q1 alone matches 62,731 repos; we see its top 50 by stars. The long tail (thousands of small Jarvis clones) is counted but unsampled.
2. **Star-sorted bias.** New, promising, low-star projects are structurally invisible in this snapshot.
3. **Hyphen tokenization noise.** GitHub search tokenizes hyphens, so `computer-use` also matches "computer" + "use" ("computer vision", "use your computer…"). This inflates Q5/Q6/Q9 `total_count` massively and injects high-star off-domain hits (flameshot, PostHog, gocv, ua-parser-js, autopsy, robotgo, Weylus…). Off-domain repos were excluded from the shortlist by manual review of the top results (inferred, not exhaustive below the top ~120 by stars).
4. **Fork detection is void.** GitHub search **excludes forks by default** (no `fork:true` was used), so every one of the 474 records has `fork=false` (verified). "Clone" in this census can therefore only mean *independent reimplementation/tutorial*, never a literal GitHub fork.
5. **`total_count` is approximate** by GitHub's own documentation, though `incomplete_results=false` on all 10 responses (verified).
6. **Q7 OR-qualifier ambiguity.** In `A OR B in:name,description`, GitHub's grammar does not clearly scope `in:` to both terms; results looked sane but the query semantics are not guaranteed (unknown).
7. **One-shot snapshot.** Stars/pushed_at drift daily; reproduce with the URLs above and expect slightly different numbers.
8. No authentication, no cloning, no code execution — descriptions and metadata only. Depth claims about code quality are **out of scope** (unknown until Phase-0B deep review).

## 3. Census manifest — headline numbers (verified)

- **500 rows fetched → 474 unique repos** after dedup by repo `id` (23 repos surfaced by ≥2 queries).
- **16 archived**, **0 forks** (see cap #4), **336 pushed within the last 12 months**, **107 not-archived but stale >18 months**.
- **167 of 474 have no usable license** (`null` or `NOASSERTION`) — a real adoption hazard for the suite (verified count; hazard is inferred).
- Full per-repo records (full_name, id, stars, forks, fork, archived, pushed_at, license spdx_id, description, surfacing queries) are in **`L6-manifest.json`** — the markdown intentionally does not duplicate all 474 rows.

**Cross-query repeaters (strongest domain-relevance signal):** leon-ai/leon (Q3,Q4), MycroftAI/mycroft-core (Q3,Q4), sukeesh/Jarvis (Q1,Q3), Priler/jarvis (Q1,Q4), isair/jarvis (Q1,Q10), NanmiCoder/cc-haha (Q6,Q9), memohai/Memoh (Q3,Q9), RedPlanetHQ/core (Q3,Q5), DicioTeam/dicio-android (Q3,Q4), project-alice-assistant/ProjectAlice (Q3,Q4).

**The Ultron name is dead weight (verified):** Q2's page 1 is almost entirely off-domain (Android UI-test framework, LMS, text editors, blockchain). The only domain-adjacent hit is `modelscope/ultron` (171★, "Collective Intelligence System — shared memories/skills across agents") — worth a skim, nothing more. Serious projects do not brand as Ultron.

## 4. Original-vs-thin heuristic (stated explicitly)

Classification applied to the 474 manifest rows (all thresholds inferred/judgment):

- **Likely-original, alive:** ≥300 stars AND pushed ≤18 months ago AND not archived AND a specific ≥30-char description naming concrete capabilities/stack. → **195 repos** (before manual off-domain removal).
- **Thin tutorial/clone tail:** <100 stars (154 repos), and/or template descriptions ("inspired by Iron Man", "voice assistant in Python", Hacktoberfest/student-project phrasing), and/or years-stale push dates. Q1/Q10 are dominated by this class below ~600★.
- **Off-domain false positive:** high stars but unrelated to assistants (tokenization noise, cap #3) — removed manually from shortlisting only.
- **Archived-but-instructive:** archived with ≥1000★ and real architecture history — 7 repos, 3 of them on-domain (bytebot, mycroft-core, olivia).
- Fork flag intentionally **not** used (cap #4).

## 5. Shortlist — 15 repos most worth deep review (Phase-0B)

Ordered by pillar, then stars. Stars/pushed/license verified 2026-08-24; "why" is inferred.

| Repo (id) | ★ | Pushed | License | Why review it |
|---|---|---|---|---|
| **openclaw/openclaw** (1103012935) | 387,345 | 2026-08-24 | NOASSERTION | The de-facto standard "own personal AI assistant, any OS"; the architecture (gateway, channels, skills) every suite gets compared against. License unclear — verify before reuse. |
| **zeroclaw-labs/zeroclaw** (1156956890) | 32,646 | 2026-08-24 | Apache-2.0 | The minimal counterpoint: fast, small Rust personal-assistant infrastructure; instructive for a lean local-first core. |
| **leon-ai/leon** (169975410) | 17,456 | 2026-08-24 | MIT | Longest-lived structured OSS personal assistant still active; mature skill/NLU module design. |
| **Fosowl/agenticSeek** (935604638) | 26,985 | 2026-08-11 | GPL-3.0 | Fully-local autonomous agent (browse/code/plan) with an explicit no-cloud-API stance — the local-first thesis proven at scale. |
| **open-jarvis/OpenJarvis** (1158198234) | 8,964 | 2026-08-24 | Apache-2.0 | "Personal AI, on personal devices" — the highest-starred living Jarvis-branded project; on-device focus matches the suite. |
| **moltis-org/moltis** (1145420469) | 2,834 | 2026-08-24 | MIT | Secure persistent personal-agent *server* in Rust: one binary, sandboxed execution, multi-provider, voice — a model for the suite's daemon layer. |
| **isair/jarvis** (1040940947) | 1,647 | 2026-08-17 | NOASSERTION | 100% private, offline voice Jarvis on your own machine — small but exactly on-thesis; surfaced by two queries. |
| **pipecat-ai/pipecat** (736272311) | 14,622 | 2026-08-24 | BSD-2-Clause | The production-grade voice/realtime pipeline framework; the voice pillar shouldn't be rebuilt from scratch. |
| **trycua/cua** (925270205) | 21,856 | 2026-08-24 | MIT | Computer-use infrastructure: cross-OS drivers, sandboxes, benchmarks — the plumbing under any "use my computer" feature. |
| **simular-ai/Agent-S** (870189331) | 12,188 | 2026-08-01 | Apache-2.0 | Leading open computer-use agent framework ("uses computers like a human"); research-grade planning/grounding to learn from. |
| **Zackriya-Solutions/meetily** (908589694) | 29,826 | 2026-06-05 | MIT | Privacy-first meeting assistant with local Whisper/Parakeet transcription + diarization — the reference for the meeting-copilot pillar. |
| **Blueturboguy07/cue** (1302077273) | 1,227 | 2026-08-10 | GPL-3.0 | macOS overlay copilot that sees/hears meetings; instructive UX (floating, screen-share-hidden) for ambient assistance. |
| **MemTensor/MemOS** (1014729376) | 10,950 | 2026-08-24 | Apache-2.0 | Persistent-memory "OS" layer for agents (hybrid retrieval, skill reuse) — the memory pillar. |
| **Mirix-AI/MIRIX** (964567893) | 3,434 | 2026-08-20 | Apache-2.0 | Multi-agent personal assistant that builds memory from on-screen activity — closest existing thing to an ambient local Jarvis. |
| **NanmiCoder/cc-haha** (1197569406) | 14,202 | 2026-08-23 | MIT | Local-first desktop workspace orchestrating coding agents (multi-agent, worktrees, diffs) — the coding-agent pillar's UX benchmark. |

### Archived-but-instructive (deliberate inclusions)

| Repo | ★ | Archived / last push | Why still read it |
|---|---|---|---|
| **bytebot-ai/bytebot** (926709003, Apache-2.0) | 11,086 | archived, 2025-09-12 | A complete self-hosted AI desktop agent that got to 11k★ and stopped — the best available post-mortem for full desktop automation scope. |
| **MycroftAI/mycroft-core** (59299524, Apache-2.0) | 6,611 | archived, 2024-09-08 | A decade of open voice-assistant architecture (wake word, skills, enclosure) and a documented sustainability failure; both matter. |

### Near-misses (kept in manifest, one line each — inferred)

microsoft/JARVIS (25.2k★, research HuggingGPT artifact, effectively dormant since 2025-07); the-open-agent/openagent (5.6k★, RAG+computer-use assistant); KunAgent/Kun (6.2k★, no license); memohai/Memoh (2.1k★, per-agent desktop/computer isolation); amurex (2.9k★, meeting copilot, stale since 2025-05); pluely / natively-cluely (Cluely-alternative overlays); RedPlanetHQ/core & OpenDAN (personal-AI-OS framing); sukeesh/Jarvis + Priler/jarvis (venerable but slowing); eclaire-labs/eclaire, siddsachar/row-bot, qhkm/zeptoclaw, ShenSeanChen/waku-agent (Q8's local-first cluster, all <1.6k★ but thesis-aligned); szczyglis-dev/py-gpt (kitchen-sink desktop assistant); huangjunsen0406/py-xiaozhi (voice ecosystem, CN-centric); modelscope/ultron (shared-memory experiment).

---
*Worker: Phase-0A L6 census. Read-only; no logins, no cloning, no execution. Reproduce via §1 URLs.*
