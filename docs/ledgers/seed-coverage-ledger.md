# Seed Research Coverage Ledger — skeleton (RESEARCH-AC-01)

**Machine-extracted URL inventory:** `url-seed-inventory.txt` — 233 unique URLs extracted from the master prompt (`grep -oE 'https?://…' | sort -u`, 2026-08-24). This is the baseline "every named URL" universe; named products without URLs (e.g., Wispr Flow, ParakeetAI variants, model names) are expanded by the research lanes and appended here with a `named-seed` source tag.

**Statuses:** researched / partially researched / inaccessible / superseded / duplicate / not applicable / intentionally deferred. Every non-researched row must carry reason, attempted source, consequence, and whether it blocks Gate 1 or Gate 2.

**Lane assignment map:**
| Lane | Owner file | Seed families |
|---|---|---|
| L1 | research/L1-assistants-voice.md | Jarvis/assistant repos, voice/TTS/STT/wake, device transport, policy engines, home/IoT |
| L2 | research/L2-coding-agents-mcp.md | Coding agents, MCP spec/SDKs/gateways, ACP/A2A, code intel, memory engines |
| L3 | research/L3-meetings-voiceid.md | Meeting copilots, NeoSapien product pages, Cluely et al., diarization/anti-spoofing |
| L4 | research/L4-design-research.md | Apple Liquid Glass/HIG, Runway, design benchmarks, WCAG/CWV, Zera |
| L6 | research/L6-github-census.md | Jarvis/Ultron GitHub census (dated, paginated, capped) |
| L7a/L7b | research/L7a-brand-sources.md, L7b-brand-collisions.md | Six brand candidates: sources, collisions, registries, trademark-access limitations |
| L9 | research/L9-platform-revalidation.md | Claude/Codex/ChatGPT/Cursor export-import matrix, Claude Code artifact/skill limits, NeoSapien MCP officialness |
| L5 (fan-in) | research/L5-skeptic-review.md | Skeptical counter-review over L1–L9 outputs; runs after wave 1 |

**Zero-unaccounted assertion:** produced at 0A close by joining lane outputs against `url-seed-inventory.txt` + the named-seed expansion; any row without a status fails the assertion.
