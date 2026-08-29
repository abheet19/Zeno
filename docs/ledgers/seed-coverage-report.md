> **CORRECTION APPENDED 2026-08-24 (post-generation).** This report states that L5 (the adversarial
> counter-review) is MISSING and that "no adversarial pass has been run over any lane claim". That was
> true at the moment of generation only — the seed-ledger worker and the L5 worker ran **concurrently**,
> so L5's file did not yet exist on disk when this was written. **L5 has since completed**
> (`research/L5-skeptic-review.md`, 63 KB). It re-fetched 38 material claims: 30 survived, 6 were
> upgraded, 12 were overturned or materially refined. The conclusion that "RESEARCH-AC-02 cannot be
> marked satisfied on this ledger alone" still stands, but for the narrower reason that the
> disagreement log and baseline-vs-deep-review split are not yet written — not because no adversarial
> pass exists. Every "researched" row should now be read against L5's overturns (corrections C-024…C-032).

# Seed Research Coverage Report — RESEARCH-AC-01 / RESEARCH-AC-02

**Produced:** 2026-08-24 · **Method:** local join/reconciliation only (no web access).
**Inputs:** `ledgers/url-seed-inventory.txt` (233 machine-extracted unique URLs), the eight lane files present in `research/`, `05-video-evidence-manifest.md`, and the master prompt at `~/Downloads/personal-ai-suite-claude-code-master-prompt.md` (SHA-256 `d3b5b818…`, used **only** to resolve each URL's owning prompt section — every heading path in the ledger is read from the prompt, not guessed).
**Output:** `ledgers/seed-coverage-ledger.csv` — 233 rows, one per seed URL, zero blank statuses.

> **This report is a coverage audit, not a research finding.** Nothing here re-verifies a lane's claim. It records *whether a lane looked*, *what it found*, and *what nobody looked at*. Where a lane's own text says "unverified", "inferred", "excerpt-only" or "ACCESS LIMITATION", that weaker label is carried through rather than laundered into "researched".

---

## 1. Lane files: present and missing

| Lane | Expected file | Present | Size |
|---|---|---|---|
| L1 — assistants + voice | `research/L1-assistants-voice.md` | **yes** | 20 KB |
| L2 — coding agents + MCP | `research/L2-coding-agents-mcp.md` | **yes** | 44 KB |
| L3 — meetings + voice ID | `research/L3-meetings-voiceid.md` | **yes** | 69 KB |
| L4 — design | `research/L4-design-research.md` | **yes** | 126 KB |
| L6 — GitHub census | `research/L6-github-census.md` (+ `L6-manifest.json`, `L6-raw/`) | **yes** | 12 KB + 172 KB + 10 raw JSON |
| L7a — brand sources | `research/L7a-brand-sources.md` | **yes** | 31 KB |
| L7b — brand collisions | `research/L7b-brand-collisions.md` | **yes** | 37 KB |
| L9 — platform revalidation | `research/L9-platform-revalidation.md` | **yes** | 19 KB |
| **L5 — skeptical counter-review** | `research/L5-skeptic-review.md` | **MISSING** | — |

**L5 is the only missing lane.** The ledger skeleton (`ledgers/seed-coverage-ledger.md`) assigns L5 the fan-in "skeptical counter-review over L1–L9 outputs; runs after wave 1". Its absence means **no adversarial pass has been run over any lane claim in this ledger**. Every "researched" row below therefore rests on a single worker's self-report. RESEARCH-AC-02 explicitly requires a "worker disagreement log and separate baseline-versus-deep-review report" — neither exists yet, so **RESEARCH-AC-02 cannot be marked satisfied on this ledger alone**.

---

## 2. Totals and status distribution

**Total rows: 233** (one per unique seed URL; no row omitted, no row merged).

| Status | Count | Share |
|---|---:|---:|
| `researched` | **121** | 51.9% |
| `intentionally-deferred` | **71** | 30.5% |
| `partially-researched` | **21** | 9.0% |
| `inaccessible` | **17** | 7.3% |
| `not-applicable` | **2** | 0.9% |
| `superseded` | **1** | 0.4% |
| `duplicate` | **0** | 0.0% |
| *(blank)* | **0** | 0.0% |
| **Total** | **233** | **100%** |

`duplicate` is legitimately zero: `url-seed-inventory.txt` was produced by `sort -u`, so every row is already a distinct canonical URL. Duplication exists only at the *submission* level in the video-evidence family (reels `DcElx3fuTTf` and `DZC-H3tRH7C` supplied twice; artifact `5ee3a68b-…` supplied twice) and is recorded in `05-video-evidence-manifest.md`, not by collapsing rows here.

### Coverage by prompt section

| Prompt section | n | researched | partial | inaccessible | superseded | n/a | deferred |
|---|---:|---:|---:|---:|---:|---:|---:|
| Design, performance, privacy, and legal references | 39 | 20 | 8 | 2 | 0 | 0 | 9 |
| Meeting copilots and dictation | 36 | 23 | 3 | 0 | 0 | 0 | 10 |
| Apple platform and Liquid Glass | 34 | 5 | 4 | 0 | 0 | 1 | **24** |
| Personal assistants, voice, device control, automation | 33 | **29** | 2 | 0 | 0 | 0 | 2 |
| Coding agents and context | 30 | **27** | 3 | 0 | 0 | 0 | **0** |
| Speaker identity, diarization, consent, anti-spoofing | 15 | 7 | 1 | 0 | 0 | 0 | 7 |
| History and data controls | 10 | 8 | 0 | 1 | 0 | 0 | 1 |
| Developer workstation, terminal, QA, CI, infrastructure | 10 | **0** | 0 | 0 | 0 | 1 | 9 |
| Naming, philosophy, and clearance | 9 | 2 | 0 | **5** | 1 | 0 | 1 |
| 11.3.1 User-supplied motion references / video | 9 | **0** | 0 | **9** | 0 | 0 | 0 |
| Referenced platform projects requiring license review | 8 | **0** | 0 | 0 | 0 | 0 | **8** |

**The shape of the gap is structural, not random.** Coverage is excellent where a lane owned the family (Coding agents 27/30, Personal assistants 29/33, Meeting copilots 23/36) and is **zero** in three families that no lane owned:

- **Developer workstation / terminal / QA / CI / infrastructure** (10 URLs) — no lane was assigned it.
- **Referenced platform projects requiring license review** (8 URLs) — the prompt's own heading states the required work; the licence review was never performed.
- **The legal/regulatory cluster** (GDPR ×2, ICO, CA Penal 632, Illinois, India DPDP ×2, NIST 800-63B, FTC ×2 = 10 URLs, spread across two sections) — no lane owned law.

A fourth family — **Apple API documentation** (24 deferred of 34) — was partially in L4's remit, but L4 correctly read its brief as *design evidence* and covered the HIG/Liquid Glass rows while leaving every AppKit/Speech/UserNotifications/Accessibility **API** doc unread.

**42 of 233 rows (18%) have `assigned_lane = (unassigned)`** — no lane in the current plan was ever responsible for them.

---

## 3. ZERO-UNACCOUNTED-SEED ASSERTION

> **ASSERTION — SATISFIED.**
> All **233** URLs in `ledgers/url-seed-inventory.txt` appear exactly once in `ledgers/seed-coverage-ledger.csv`, each with a non-blank `status` drawn from the permitted enum, and each non-`researched` row carries a non-empty `reason_if_not_researched`. **Unaccounted rows: 0. Blank statuses: 0.**

Machine checks run against the emitted CSV:

| Check | Result |
|---|---|
| Row count == seed count (233) | **PASS** |
| Every `seed_id` unique, `S001`–`S233` in inventory order | **PASS** |
| Every `canonical_url` non-empty and byte-identical to its inventory line | **PASS** |
| Every `status` non-blank and in the enum | **PASS** (0 blanks) |
| Every non-`researched` row has a non-empty `reason_if_not_researched` | **PASS** (0 blanks) |
| Every `evidence_note` ≤ 160 chars | **PASS** (max 160) |
| Every `blocks_gate` in {Gate1, Gate2, none} | **PASS** |

**What the assertion does NOT claim.** *Accounted for* ≠ *researched*. 112 of 233 rows (48%) are something other than `researched`. The assertion says the ledger is complete and honest; it does not say the research is.

---

## 4. Gate impact

| `blocks_gate` | Count | Rows |
|---|---:|---|
| **Gate1** | **20** | S062, S069, S073, S074, S095, S109, S114, S127, S128, S138, S149, S154, S161, S170, S182, S205, S206, S210, S220, S221 |
| **Gate2** | **2** | S002, S003 |
| none | 211 | — |

### Gate 1 (architecture) is blocked by three clusters

**(a) The consent-and-privacy law cluster — 10 rows, none read by any lane.**
`S073`/`S074` GDPR (consolidated + original CELEX), `S161` ICO lawful-basis consent, `S170` California Penal Code §632, `S210` Illinois eavesdropping, `S220` India DPDP Act 2023, `S221` the companion MeitY PDF, `S182` NIST SP 800-63B, `S205`/`S206` FTC guidance on privacy commitments and voice cloning.

This programme's centre of gravity is *always-on capture of conversations involving people who are not the user*. The only consent evidence anywhere in the corpus is **commercial**: L3 verified that Granola sells "Org-wide notification that Granola is being used" as an Enterprise feature and that Vexa's bot is a visible participant by construction, and L3 quotes `Blueturboguy07/cue`'s warning that hidden assistants "in some places" break consent laws. That is market evidence that transparency sells. It is not a legal basis. **No statute, regulation or regulator guidance was read by any lane** — including India's DPDP Act, which is the home-jurisdiction law (L3 verified NeoSapien ships India-only under Bangalore arbitration; `00-DECISIONS.md` places the owner in Asia/Kolkata).

Separately, `S182` matters because nothing in the corpus treats voice as an *authenticator*. L3 evaluated speaker ID as a **labelling** technology (who said what). If voice-ID gates any privileged action — and the prompt's "unlock" ceremony implies it might — the assurance-level decision has no evidence behind it.

**(b) The unperformed licence review — 8 rows.**
`S095` Stirling-PDF, `S109` Coolify, `S114` Maxun, `S127` Langflow, `S128` Dify, `S138` Open WebUI, `S149` Supabase, `S154` Crawl4AI. The prompt files these under the heading **"Referenced platform projects requiring license review"** and the prompt body names Supabase 5×, Maxun/Dify 2× each. Every other lane produced meticulous licence work (L2's whole report carries a licence disclaimer; L3 read LICENSE files at `raw.githubusercontent.com` for 24 repos; L4 verified six LICENSE files). This family got none of it. An architecture that composes any of these cannot be approved without knowing their terms — and one of them (Supabase) is named in the prompt's own optional-control-plane row.

**(c) Two agent-security documents behind decisions already taken.**
`S062` Docker Compose trust model — L2 **adopted** `docker/mcp-gateway` for MCP sandboxing, reasoning from the MCP spec's "tool descriptions are untrusted input" model, without reading the container trust boundary that makes the sandbox meaningful. `S069` OpenHands SDK security guide — L2 recommends OpenHands as a **spike** for a multi-agent control plane while its security/permission model went unread.

### Gate 2 (design) is blocked by two rows

`S002`/`S003` — the two `claude.ai/code/artifact/...` design references are **account-gated** and were never opened. `05-video-evidence-manifest.md` records the correct remedy: *"If their design content matters, an HTML/ZIP export must be supplied."* Unlike the Instagram reels, the manifest gives **no** "not needed for Gate 2" reassurance for these, and no substitute evidence exists.

---

## 5. Canonical-home corrections (old → new)

Every case where a lane found the seed's location, name or owner wrong, or found the content living somewhere else. **Sixteen of these are direct corrections to a seed URL or a seed-named entity; the rest are corrections to a URL a lane reached in the course of covering a seed.**

### 5.1 Corrections to a seed URL or seed-named entity

| # | Seed | Old (as prompted) | New (verified) | Lane |
|---|---|---|---|---|
| 1 | S102 | `WhisperKit/argmax-oss-swift` | **`argmaxinc/argmax-oss-swift`** — wrong owner; also the former `argmaxinc/WhisperKit`, same 6.3k★ MIT monorepo | L1 |
| 2 | S113 | `fastrepl/hyprnote` (and the name "Hyprnote") | **`fastrepl/anarlog`** — 301 redirect; product, site, docs and socials all renamed to Anarlog | L3 |
| 3 | S144 | `mediar-ai/screenpipe` | **`screenpipe/screenpipe`** — org renamed | L3 |
| 4 | S155 | `fathom.video` | **`www.fathom.ai`** — 301, rebrand | L3 |
| 5 | S224 | `parakeetai.com`, `www.parakeetai.com`, `parakeet.ai` — **all three time out** (curl exit 28, 3 attempts) | **`parakeet-ai.com` → `www.parakeet-ai.com`** | L3 |
| 6 | S090 | `RageTony4/cue-cluely-alternative` — a **0★ fork** | **`Blueturboguy07/cue`** — 1,229★ upstream, releases through 0.2.2 | L3 |
| 7 | S097 | repo formerly `Zackriya-Solutions/meeting-minutes` (badges still point there) | **`Zackriya-Solutions/meetily`** | L3 |
| 8 | S060 | `docs.cluely.com/undectability` — **prompt typo** | **`docs.cluely.com/undetectability`** (301) | L3 |
| 9 | S126 | `.../sherpa-onnx/blob/**main**/LICENSE` would 404 | default branch is **`master`** — `master/LICENSE` is Apache-2.0, 11,358 bytes | L3 |
| 10 | S139 | `openinterpreter/openinterpreter` | **`OpenInterpreter/open-interpreter`** — and the product behind the name is now a **Rust rewrite based on Codex**; the original Python project is community-maintained elsewhere | L2 |
| 11 | S118 | `github.com/google-gemini/gemini-cli/blob/main/docs/cli/token-caching.md` | **`geminicli.com/docs/cli/token-caching/`** — Gemini CLI docs moved off the GitHub tree | L2 |
| 12 | S167 | (prompt's "chronicle" slug) `developers.openai.com/codex/memories/chronicle` | **308 → `learn.chatgpt.com/docs/customization/computer-history`** | L9 |
| 13 | S168 | `developers.openai.com/codex/memories` | **308 → `learn.chatgpt.com/docs/customization/memories`** | L9 |
| 14 | S187 | `runwayml.com/news/mcp` | **`runway.com/news/mcp`**; connector endpoint is `mcp.runwayml.com/mcp` | L4 |
| 15 | S232 | prompt names Zera showcases "Horizon, Vector Bloom, **Lumen Atlas**/nexus" | **"Lumen Atlas" does not exist.** The real project is **Nexus**; the portfolio also lists Orion, Specimen, Aero, Naveera, Reel, Visio, Detail Driven, Delphi Markets | L4 |
| 16 | S229/S230 | "Zera Software Studio" | studio brands itself **"Zera Studio"** in its own footer ("@2026 Zera Studio. All rights reserved"), though the domain uses the longer form | L4 |

### 5.2 Corrections to related URLs reached while covering a seed

| # | Old | New / result | Lane |
|---|---|---|---|
| 17 | `sst/opencode` | redirects to `anomalyco/opencode` — **the seed was right**, the suspected "correction" would have been a regression | L2 |
| 18 | `All-Hands-AI/OpenHands` | redirects to `OpenHands/OpenHands` — **seed right** | L2 |
| 19 | `block/goose` | redirects to `aaif-goose/goose` — **seed right**; goose is now governed under the Linux Foundation's AAIF | L2 |
| 20 | `sourcegraph/scip` | canonical is `scip-code/scip` — **seed right**; many indexers still live under the `sourcegraph` org | L2 |
| 21 | `block.github.io/goose` | now serves only a redirect notice → **`goose-docs.ai`** | L2 |
| 22 | Graphiti's Kuzu backend | **`kuzudb/kuzu` archived by its owner 2025-10-10**, read-only, last release v0.11.3 — a genuine upstream shutdown, not a vendor preference | L2 |
| 23 | `docs.warp.dev/agents/permissions` | **404** → `docs.warp.dev/agent-platform/agent/using-agents/agent-profiles-permissions` (also served at `/agents/capabilities/agent-profiles-permissions/`) | L4 |
| 24 | `support.claude.com/en/articles/9945119-using-artifacts-…` | **404** → superseded by `9487310-what-are-artifacts-and-how-do-i-use-them` (= seed S195) | L4 |
| 25 | Apple HIG / Technology Overviews HTML | client-rendered SPAs returning `<head>` only → content lives at **`developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`** and **`/tutorials/data/documentation/<path>.json`** | L4 |
| 26 | HIG `menu-bar-extras`, `menu-bar-menus` | **404** → the content is at HIG **`the-menu-bar`** | L4 |
| 27 | `iep.utm.edu/zenocit/` | **404** — no standalone IEP biography; coverage found at `iep.utm.edu/stoa/` and `/stoicmind/` | L7a |
| 28 | `plato.stanford.edu/entries/aristo-chios/` | **404** — no standalone SEP entry for Aristo of Chios exists at all | L7a |
| 29 | "Seneca College" | renamed **Seneca Polytechnic in 2023** (legal name unchanged) | L7b |
| 30 | "Zeno Group" (framed as an independent agency) | founded as **PR21**, renamed ZENO in **2004**; a **subsidiary of Daniel J. Edelman Holdings** | L7b |
| 31 | Docker Hub existence test `/v2/repositories/<name>/` | **wrong method** — returns `count: 0` for namespaces that don't exist; corrected to `/v2/users/<name>/`. Would have produced six false "free" verdicts | L7b |
| 32 | `www.registry.google/rdap/domain/<d>` | **invalid endpoint** — a control test on `web.dev` (certainly registered) also 404'd; all `.dev` results discarded rather than reported | L7b |
| 33 | `nvidia/speakerverification_en_ecapa_tdnn` | **HTTP 401 — does not exist publicly.** NVIDIA's released speaker-embedding checkpoint is TitaNet; for a pretrained ECAPA use `speechbrain/spkrec-ecapa-voxceleb` | L3 |
| 34 | "pyannote ≈ MIT" | the **4.x default `community-1` is CC-BY-4.0**, not MIT; only 3.1 / segmentation-3.0 are MIT | L3 |
| 35 | "Piper is MIT" | current maintained Piper is **`OHF-Voice/piper1-gpl`, GPL-3.0** | L1 |
| 36 | NeoSapien developer surface | `neosapien.ai/mcp` **404**, `/memories` **404**, `docs.neosapien.ai` **NXDOMAIN**, `/sitemap.xml` 404 (real index is `/sitemap-index.xml`) | L3 |
| 37 | MCP `initialize` handshake | replaced by **`server/discover`** in `2026-07-28`; the server→client request direction is removed entirely (SEP-2577) | L2 |

---

## 6. Inaccessible URLs — every one, with reason and gate impact

**17 rows.** Every one was blocked by the source, not by a lane's choice, and in every case the lane recorded the block rather than working around it (no logins, no CAPTCHA solves, no paywall bypass).

| Seed | URL | Reason | Mitigation actually obtained | Blocks |
|---|---|---|---|---|
| S001 | `branddb.wipo.int/` | **CAPTCHA-gated** — served an Altcha widget with redirect logic. Not solved, not bypassed | none for WIPO; trademark evidence came from Justia snippets only | brand sub-gate |
| S072 | `euipo.europa.eu/eSearch/` | Fragment-based routing; server returned only the landing page for every term | none | brand sub-gate |
| S197 | `tmrsearch.ipindia.gov.in/tmrpublicsearch/` | **Login-with-OTP + CAPTCHA** before any query | none | brand sub-gate |
| S198 | `tmsearch.uspto.gov/` | JavaScript app shell; rendered content was the heading "Trademark search" and nothing else | none | brand sub-gate |
| S199 | `trademarks.ipo.gov.uk/ipo-tmtext` | **HTTP 403 Forbidden** | none | brand sub-gate |
| S002 | `claude.ai/code/artifact/5ee3a68b-…` | **Account-gated** | none | **Gate2** |
| S003 | `claude.ai/code/artifact/7c874197-…` | **Account-gated** | none | **Gate2** |
| S156 | `help.openai.com/en/articles/7260999-…` | **HTTP 403 twice** (bare-ID and full-slug URLs both tried); help.openai.com is bot-gated | ChatGPT export facts corroborated by multiple secondary sources; L9 kept them at `[inferred]` | none |
| S157 | `help.runwayml.com/.../Introduction-to-Workflows` | **HTTP 403** to WebFetch *and* to curl with a desktop UA (L4 AL-1) | excerpt-only from search excerpts **of that official page**; L4 refused to upgrade to *verified* | none |
| S159 | `help.runwayml.com/.../Creating-with-Runway-Agent` | **HTTP 403**, same bot protection | excerpt-only; the ask-before-generation + credit-estimate behaviour | none |
| S211–S217 | `instagram.com/reel/…` ×7 | **Login/robots gated** | **none, deliberately** — the manifest states no reel was described from its URL, thumbnail, caption or a third-party summary | none |

**Two honest qualifications on the "none" verdicts:**

1. **The five trademark registers are a single correlated failure, and it is the largest evidence gap in the whole programme.** L7b's own banner says it plainly: *every* primary register was unreachable, so every trademark statement in the corpus comes from Justia aggregator snippets surfaced via web search — and Justia's own search path and record pages both returned 403, so **not one trademark record was opened directly**. Serial numbers, live/dead status, class lists and goods/services text are all unconfirmed. The true set of blocking registrations is probably **larger** than what is listed. This does not block Gate 1 or Gate 2 under the enum used here, but it blocks the **brand sub-gate**, which `00-DECISIONS.md` places *before* Gate 1 in the stop-point sequence.
2. **The seven reels are correctly non-blocking**, because `05-video-evidence-manifest.md` establishes the substitute: both WhatsApp compilations are present, SHA-256-verified against the prompt's own manifests, and fully frame-ledgered (9,530 + 8,065 rows, exactly-once contiguous coverage). Only optional per-reel canonical-ID mapping is lost. The **artifacts** have no such substitute, which is why they are the two Gate-2 blockers.

### Adjacent: access limitations that did not produce a hard block

These are `partially-researched`, not `inaccessible`, but the lanes flagged them as access problems and they should be read alongside the table above:

- **S119** `gemini-cli/docs/hooks/index.md` — L2 ACCESS LIMITATION #7, verbatim: *"Gemini CLI hooks documentation NOT retrieved — only token-caching was verified. Hooks support is [U]."* Do not assume Claude-Code-style lifecycle hooks exist there.
- **S223** `notion.com/product/ai/use-cases` — L4 AL-2: the named help URL returns HTTP 200 but serves the **generic Notion AI hub**, not the article. All Notion Plan-mode facts are excerpt-only.
- **S203** ASVspoof 5 evaluation plan PDF — not fetched; and the dataset's Zenodo record (`zenodo.org/records/14498691`) returned **HTTP 403** ("restricted due to unusual traffic from your network"), so the ODC-By licence claim is **unverified**.
- **S224** ParakeetAI pricing — sign-in-gated; `#pricing` renders tier names only, and third-party figures are mutually inconsistent.
- `huggingface.co/Revai/reverb-diarization-v2` (not a seed) — gated `license:other`; **blocks clearance of the sherpa-onnx reverb diarization bundle**.
- `github.com/NVIDIA/NeMo/commits/main.atom` and `releases.atom` returned **empty**, so NeMo's repo activity is `[U]`.
- L2 lost **Bash/`curl` for its entire session** (classifier rate-limited), so no raw HTTP redirect chain was ever observed; all canonicality in §5.2 items 17–20 is inferred from the org name rendered on the followed page. Strong evidence, weaker than a `Location:` header.
- L2 read **every licence off a repo landing-page badge, not a LICENSE file** — its own "single largest verification gap". L3 and L4 did fetch raw LICENSE files; L2 did not.

---

## 7. INDEPENDENT DISCOVERY LEDGER

References the lanes surfaced that are **not** in `url-seed-inventory.txt`. Each is something the prompt's seed list missed. Sixty-one entries, grouped by discovering lane.

### 7.1 From L1 — assistants and voice

| Reference | Why it matters |
|---|---|
| `openclaw/openclaw` | MIT, the breakout 2026 personal-assistant platform (WhatsApp/Telegram/Slack/iMessage/Matrix). **387,345★ in L6's census — the single highest-starred repo found anywhere.** Directly competes with and outclasses every "jarvis" seed on ecosystem. Licence reads NOASSERTION — verify before reuse |
| `pipecat-ai/pipecat` | Realtime voice/multimodal agent framework (Daily), v1.0 stable Apr 2026, BSD-2-Clause, 14.6k★. The main alternative to `livekit/agents`; the seed list names only LiveKit |
| `k2-fsa/sherpa-onnx` (the repo) | The seed list contains only its LICENSE file. The runtime itself is the "one engine, many platforms" answer no seed covers: STT/TTS/VAD/KWS/diarization, 12 language bindings, WASM, Qualcomm/Rockchip/Ascend NPU backends |
| `OHF-Voice/piper1-gpl` | Piper's **current** home — and the licence changed to **GPL-3.0**. Any PRD assuming "Piper is MIT" is wrong |
| NVIDIA **Parakeet TDT** / **Canary-Qwen 2.5B** | The current open-weights ASR accuracy/speed frontier (CC-BY-4.0 weights), absent from the seed list entirely |
| **Moonshine** (Useful Sensors) | MIT English STT, 245M params, streaming, built for edge — what the `settylokesh/ORB` seed actually runs on |
| **Chatterbox / Chatterbox-Turbo** (Resemble AI) | MIT; the quality leader among permissive TTS. The seed list names only Kokoro and Qwen3-TTS |
| **microWakeWord** | The practical commercial-safe alternative to openWakeWord's CC-BY-NC-SA models — which is the exact problem L1 found in the seed |
| **Silero VAD**, **TEN VAD** | The VAD layer is entirely missing from the seed list. TEN VAD's model licence is explicitly **unverified** — check before adopting |
| **Picovoice Porcupine** | The commercial wake-word fallback if no permissive path works |
| Rest of the **OHF-Voice** org (`microWakeWord`, `Speech-to-Phrase`, `wyoming-satellite`) | The seed names only the `wyoming` protocol repo; the production-grade components live in the sibling repos |

### 7.2 From L2 — coding agents, MCP, code intelligence

| Reference | Why it matters |
|---|---|
| **`oraios/serena`** | **L2 calls this the single biggest omission in the seed list.** 28.4k★ MIT: an MCP server giving agents symbol-level code understanding via LSP across 40+ languages. The seeds have Zoekt (lexical), SCIP (index format) and tree-sitter (parsing) — three *ingredients*. Serena is the assembled dish, and it speaks MCP natively |
| **`openai/codex`** | **116.9k★, Apache-2.0** — the second-most-starred agent in the entire survey and entirely absent from the seed list, despite being the acknowledged upstream of Open Interpreter's Rust rewrite |
| `Kilo-Org/kilocode` | 27.0k★ MIT, **29,579 commits — the highest commit count in L2's whole report**. With Roo archived and Continue read-only, it is the most active surviving IDE-extension lineage. Lineage correction: Kilo CLI began as a fork of **OpenCode**, not of Roo/Cline |
| `ast-grep/ast-grep` | 15.6k★ MIT. The deterministic, token-free counterpart to LLM editing — the right tool for mechanical refactors an agent shouldn't pay tokens for. Composes directly with tree-sitter |
| `charmbracelet/crush` | 27.6k★, cleanest single-binary LSP+MCP integration — **but licensed `FSL-1.1-MIT`, the only non-OSI licence in L2's report.** The trailing `-MIT` makes it look permissive at a glance. Flagged, not adopted |
| `zilliztech/claude-context` | 12.4k★ MIT MCP server: hybrid BM25+dense retrieval, AST chunking, Merkle-tree incremental reindex, ~40% claimed token reduction. Requires Milvus/Zilliz |
| `kuzudb/kuzu` | **Archived 2025-10-10.** Independent corroboration that Graphiti's Kuzu deprecation is a genuine upstream shutdown. The warning generalises: the embedded-graph-DB option evaporated with ~10 months' notice |
| `modelcontextprotocol/ext-tasks`, `ext-apps`, `experimental-ext-skills` | The actual MCP extension repos. Note the `experimental-` prefix on skills — **"Skills over MCP" is a Working Group and an in-review SEP-2640, not a shipped extension** |
| `modelcontextprotocol.io/extensions/client-matrix` | The community-maintained support matrix. Decision-relevant negative: **Tasks does not appear on it at all** — fully specified, zero listed client support |
| `agentskills.io` | The external Agent Skills spec the MCP WG is coordinating with. Track alongside SEP-2640 |
| `geminicli.com`, `goose-docs.ai`, `a2a-protocol.org`, `agentclientprotocol.com` | The four projects' real documentation homes, all moved off GitHub |
| **ZooCode** | The community fork named in Roo Code's own archive notice as a successor (alongside Cline) |
| `tree-sitter/tree-sitter` (repo) | Named in the prompt body twice but with **no URL**. L2 verified it: 26.7k★, MIT, dependency-free pure-C runtime — "the single most load-bearing, lowest-risk dependency in this entire report" |

### 7.3 From L3 — meetings, diarization, anti-spoofing

| Reference | Why it matters |
|---|---|
| `cjpais/Handy` | **MIT, 30,220★ — larger than every seed repo in the meeting/dictation family.** Fully-offline STT. The obvious base for the dictation lane instead of anything GPL |
| `Beingpax/VoiceInk` | GPL-3.0, 6,081★. The direct Wispr Flow comparable and the best UX reference in the category — but GPL-3.0 makes it learn-only for a proprietary product |
| `attendee-labs/attendee` | "The universal Meeting Bot API", the direct Vexa competitor. **Elastic License 2.0 — not OSI-approved**: self-host internally yes, resell as a service no |
| `collabora/WhisperLive` | MIT, 4,237★ — the mature streaming-ASR server the seed list lacks entirely (every seed either batches or wraps a vendor API) |
| `Blueturboguy07/cue` | 1,229★ GPL-3.0, the real upstream of seed S090. **Cite as evidence, not code**: its README is the honest technical account of why screen-share invisibility is not durable on macOS 15.4+ — the direct counter-evidence to Cluely's marketing |
| `BUTSpeechFIT/DiariZen` | MIT, 528★, active. The WavLM-based line currently posting better DER than pyannote 3.x — the strongest accuracy-upside candidate in the diarization table |
| `modelscope/3D-Speaker` | Apache-2.0, 3,115★. Home of CAM++/ERes2Net and already one of sherpa-onnx's two supported embedding families. The Apache alternative to TitaNet's CC-BY |
| `wenet-e2e/wespeaker` | Apache-2.0, 1,388★, production-oriented ONNX export path — the natural companion to sherpa-onnx |
| `narcotic-sh/senko` | MIT, 291★, speed-focused diarization. The right shape where Sortformer's **4-speaker cap** or NeMo's install weight is a problem |
| `TakHemlata/SSL_Anti-spoofing` (MIT) + `clovaai/aasist` (NAVER-permissive, **not verbatim MIT — read it**) | The two reference countermeasure implementations. The seed list named a *challenge* but no *implementation* |
| `revdotcom/reverb` + `Revai/reverb-diarization-v2` | **A live licence trap.** sherpa-onnx ships a `reverb-diarization-v1` bundle; the weights are gated `license:other` and unreadable without a login. The code repo being Apache-2.0 tells you nothing about the weights. Do not ship this bundle |
| **ASVspoof 2017 / 2019 PA / 2021 PA** | **The correction that matters most in Part B.** ASVspoof 5 has **no replay/physical-access track** — only deepfake CM (Track 1) and SASV (Track 2). For a replay threat model (a loudspeaker in the room — the realistic attack on a meeting device) you must go back to these earlier editions |
| HF model cards: `nvidia/diar_streaming_sortformer_4spk-v2` **and** `-v2.1` | **Two checkpoints, two different weights licences.** v2 is CC-BY-4.0 and ungated; **v2.1 is `nvidia-open-model-license`** — a different, non-CC licence. Read it before shipping v2.1 |
| `pyannote/speaker-diarization-community-1`, `-3.1`, `segmentation-3.0` cards | All three are **contact-info gated** — marketing consent, not a licence restriction, but it breaks unattended installs, clean-room CI and air-gapped deployment. Mirror-and-vendor is the mitigation, and CC-BY-4.0/MIT permit it |
| `FluidInference/diar-streaming-sortformer-coreml` | A community CoreML port of streaming Sortformer — the on-device Apple path |
| `meetily.ai/pro/` | The vendor's own pricing table, which is what proves the seed repo's "speaker diarization" tagline oversells the MIT edition |
| `char.com` | The Anarlog team's **new** product. A continuity risk flag on a project L3 otherwise recommends composing with |
| `arxiv.org/abs/2408.08739`, `arxiv.org/html/2502.08857v2` | The ASVspoof 5 design papers — the only readable source once Zenodo 403'd |

### 7.4 From L4 — design, materials, agent UX

| Reference | Why it matters |
|---|---|
| **`learn.microsoft.com/.../style/mica`** | **L4 calls this the most decision-relevant row in its whole report, and it inverts the prompt's priority (correction X-3).** The Windows pilot ships first, and Windows already has a first-party, performance-tuned material system. Mica **samples the wallpaper once**, and Microsoft publishes a **five-condition degraded-state matrix** (transparency off / battery saver / low-end hardware / inactive window / pre-build-22000) that Apple's docs have no equivalent of |
| `learn.microsoft.com/.../style/acrylic` | The explicit GPU cost warning no other vendor states so plainly: acrylic is "GPU-intensive… automatically disabled when a device enters Battery Saver mode". Plus the concrete legibility rule **"Don't place accent-colored text over acrylic surfaces"** |
| `electronjs.org/docs/latest/api/base-window` | The implementation seam: `backgroundMaterial: mica/acrylic/tabbed` (Windows 11 22H2+) and `vibrancy: hud` (macOS). Using the OS material inherits the entire degraded-state matrix for free; a CSS `backdrop-filter` re-implementation inherits none of it |
| `developer.mozilla.org/.../backdrop-filter` | **The backdrop-root trap.** A parent with `opacity < 1` (or `filter`, `mask`, `clip-path`, `mix-blend-mode`…) becomes a backdrop root, so a child's `backdrop-filter` silently blurs the wrong thing. Directly outlaws "fade in a panel that contains glass" |
| `api.webstatus.dev/v1/features/{webgpu, prefers-reduced-transparency, prefers-reduced-motion, backdrop-filter}` | The machine-readable baseline source behind two corrections: **WebGPU is Baseline `limited`** (no Firefox) so 3D cannot be a requirement; and **`prefers-reduced-transparency` is Baseline `limited`** — Chrome/Edge 119 only, no Firefox, no Safari — so the OS "reduce transparency" signal **cannot be detected on the web**, and an explicit in-app toggle is mandatory |
| `radix-ui.com/colors` (MIT) | The best-documented answer to dark-first colour architecture: 12 steps with fixed roles, **solid + alpha variants of every colour** (the alpha ones are what make a translucent surface predictable), and steps 11/12 guaranteed to Lc 60 / Lc 90 APCA. Caveat L4 records: **APCA is not WCAG 2.2** — ship WCAG ratios as the floor |
| `elements.ai-sdk.dev` / `vercel/ai-elements` (Apache-2.0) | An independently published component vocabulary for agent progress — Chain of Thought, Reasoning, Task, Tool, Context, Plan, Checkpoint, **Confirmation**. Converges strikingly with Linear's five activity types, which is strong evidence it is the right decomposition |
| `linear.app/developers/agents`, `/agent-best-practices`, `/aig` | **The single best find in L4's UX section.** The only source giving a *typed, time-bounded, user-visible* agent progress contract: five activity types (`thought`/`action`/`elicitation`/`response`/`error`), a **10-second first-acknowledgement rule**, a 30-minute staleness window, and "comments may not be reliable to read from" |
| `nngroup.com/articles/progress-indicators/` (2014) | The other half of the timing budget: <1 s no indicator, 2–10 s looped, ≥10 s percent-done. Two independent sources twelve years apart landing on the same 10-second boundary |
| `nngroup.com/articles/ai-agents-as-users/` (pub. 2026-04-10) | The contrarian reframing: accessibility work **is** agent-compatibility work. Supplies the internal argument that keeps the a11y floor from being cut under schedule pressure. Recorded honestly: it offers nothing on agent plans, permissions, steering or provenance |
| `docs.warp.dev/agent-platform/.../agent-profiles-permissions` | The **six-category × four-level** permission matrix and the allowlist/denylist with denylist-wins precedence — plus the negative lesson L4 deliberately diverges from: a one-chord "run until completion" that **bypasses the user's own denylist** inverts the safety model |
| `cursor.com/docs/agent/plan-mode` (+ `/agent/review`, `/cli/using`) | Plan-as-a-durable-file. The plan outlives the session, is diffable and reviewable in any editor — an accessibility unlock as much as a UX one |
| `docs.perplexity.ai/.../streaming-citations` | Inline numbered provenance + progressive source disclosure — with the layout-shift hazard L4 flags (sources must be space-reserved or appended, or CLS ≤ 0.1 breaks) |
| `help.openai.com/en/articles/10119604-work-with-apps-on-macos` | Three transferable rules for a companion window: a **rebindable** global summon, an **explicit per-app allowlist** rather than "reads everything", and one obvious global kill switch that also removes the affordance |
| `help.figma.com` Figma AI FAQ + First Draft | The material caution: **First Draft cannot use your own design system** — its output is Figma-library geometry wearing your colours, and must never be treated as a token source |
| `granola.ai/security`, `docs.wisprflow.ai/*`, `wisprflow.ai/data-controls` | The product-behaviour primary sources behind D6/D7; notably Wispr Flow separates "don't train on this" from "don't store this" as two independent switches — a strictly better privacy model than one blended toggle |
| `three.js`, `react-three-fiber`, `shadcn/ui`, `carbon-design-system` LICENSE files | Licence-verified proof (MIT/MIT/MIT/Apache-2.0) that the entire technical substrate behind the premium-3D reference class is available. **The tools are free; the taste has to be ours** |
| `academy.claude.com/tutorials/prototype-ai-powered-apps-with-claude-artifacts` | Where `support.claude.com/en/articles/11649438-…` actually redirects to |

### 7.5 From L6 — GitHub census (474 unique repos; shortlist highlights)

The full manifest is `research/L6-manifest.json` (474 repos, all fields, per-query provenance) with the ten raw API responses in `research/L6-raw/`. Non-seed repos worth naming:

| Reference | Why it matters |
|---|---|
| `zeroclaw-labs/zeroclaw` | 32,646★ Apache-2.0 — the minimal Rust counterpoint to openclaw; a model for a lean local-first core |
| `Fosowl/agenticSeek` | 26,985★ GPL-3.0 — fully-local autonomous agent with an explicit no-cloud-API stance; the local-first thesis proven at scale |
| `open-jarvis/OpenJarvis` | 8,964★ Apache-2.0 — "Personal AI, on personal devices", the highest-starred *living* Jarvis-branded project. Every Jarvis seed in the prompt is smaller |
| `moltis-org/moltis` | 2,834★ MIT — a secure persistent personal-agent **server** in Rust: one binary, sandboxed execution, multi-provider, voice. The model for the suite's daemon layer |
| `trycua/cua` | 21,856★ MIT — computer-use infrastructure: cross-OS drivers, sandboxes, benchmarks. The plumbing under any "use my computer" feature |
| `simular-ai/Agent-S` | 12,188★ Apache-2.0 — leading open computer-use agent framework; research-grade planning/grounding |
| `MemTensor/MemOS` | 10,950★ Apache-2.0 — persistent-memory "OS" layer for agents. The memory pillar, and none of the seed memory engines frames itself this way |
| `Mirix-AI/MIRIX` | 3,434★ Apache-2.0 — multi-agent assistant that builds memory from on-screen activity; the closest existing thing to an ambient local Jarvis |
| `NanmiCoder/cc-haha` | 14,202★ MIT — local-first desktop workspace orchestrating coding agents (multi-agent, worktrees, diffs). **The coding-agent pillar's UX benchmark**, and absent from the seed list |
| `bytebot-ai/bytebot` (**archived** 2025-09-12, 11,086★) | Deliberately included: a complete self-hosted AI desktop agent that reached 11k★ and stopped. The best available post-mortem for full desktop-automation scope |
| `MycroftAI/mycroft-core` (**archived** 2024-09-08, 6,611★) | A decade of open voice-assistant architecture *and* a documented sustainability failure. Both halves matter |
| `microsoft/JARVIS` (25.2k★) | Research HuggingGPT artifact, effectively dormant since 2025-07. Named-adjacent to the programme and worth knowing is dead |
| `RedPlanetHQ/core`, `memohai/Memoh`, `KunAgent/Kun`, `the-open-agent/openagent`, `sukeesh/Jarvis`, `Priler/jarvis`, `DicioTeam/dicio-android`, `project-alice-assistant/ProjectAlice`, `pluely`/`natively-cluely`, `eclaire-labs/eclaire`, `szczyglis-dev/py-gpt`, `huangjunsen0406/py-xiaozhi` | The near-miss tier. Also the census's own hard finding: **167 of 474 repos have no usable licence** (`null` or `NOASSERTION`) — a real adoption hazard, and **the "Ultron" name is dead weight**: Q2's page 1 is almost entirely off-domain |

### 7.6 From L7a / L7b — brand

| Reference | Why it matters |
|---|---|
| **`athenaintel.com`** — Athena Intelligence | **The single most decision-relevant brand finding.** A funded company already shipping an AI agent named **Athena** on an infrastructure platform named **Olympus** — with a meeting agent (multi-language transcription, July 2026), code review with agents as "first-class engineers", and a cross-system assistant. That is this programme's exact triad, already branded Athena, already using Greek-pantheon sibling naming. **Not a name collision — a product collision.** The prompt did not name it |
| `eclipse-zenoh/zenoh` | **An exact homophone** — Eclipse zenoh documents its own pronunciation as /zeno/ — and it is a widely deployed Rust pub/sub protocol used as ROS 2 middleware. In any spoken infra context, "zeno" and "zenoh" are indistinguishable, and both are Rust projects |
| `zeno-ml/zeno` + `zenoml.com` | A Carnegie Mellon **AI model-evaluation platform** — squarely in the AI-tooling category |
| `crates.io/crates/zeno` | **10,380,272 downloads** as a 2D path rasterizer, transitively pulled into much of the Rust font/graphics ecosystem. Naming a Rust-adjacent tool `zeno` would actively confuse Rust developers |
| `registry.npmjs.org/seneca` | **v3.38.0, actively maintained** Node.js microservices framework. `npm i seneca` already resolves to something else, in exactly the developer population a coding agent targets |
| arXiv **2604.19425** — *"seneca: A Personalized Conversational Planner"* | CHI '26 workshop, April 2026, using the lowercase slug `seneca` for a conversational planning assistant with a persistent goal database. Conceptually the same product |
| `seneca.tech`, `openseneca.cc`, **Seneca Learning Ltd.** (exact-match iOS app) | The rest of the Seneca crowding — edtech owns the consumer association |
| `allenai/aristo-mini` + AI2's **Aristo** project | **In AI research circles, "Aristo" already means something specific**: AI2's flagship reasoning project, named for Aristotle, famous for passing the NY Regents science exam. The association is already commercially claimed |
| `aristo.ai` | A live AI startup — same name, same industry, currently operating |
| `crates.io/crates/aristo` | 338,684 downloads, co-owned by `github:aretta-ai:release` — the crate belongs to an **AI company**, not a hobbyist |
| **Arista Networks** (ARISTA reg 4893674) | One letter from ARISTO and near-identical in speech, in a software/networking class — precisely the similarity an examiner or opposing counsel looks at |
| **Cato Networks** — Gartner MQ SASE Leader 2026 (3rd year), `CATO NETWORKS` reg 5348949, a "Cato Client" iOS app, Cato AI Labs, and its own internal agentic assistant ("Savanti") | The prompt named it; L7b found it **materially understated**. It is not just a name clash — it is an enterprise incumbent in your buyers' security stack that is *already building an agentic assistant over developer tools* |
| `cato.ai` → **Cato Digital** | The most desirable domain is taken **by an AI-infrastructure company** |
| **The Cato Corporation** | A **third** significant CATO (US retail chain, own mark portfolio) — the prompt listed only two |
| `en.wikipedia.org/wiki/Zeus_(malware)` + Kaspersky / CrowdStrike / Proofpoint / SentinelOne / Radware / Cynet / German BSI explainer pages | **Zeus/Zbot**: banking trojan since 2007, GameOver ZeuS tied to ~$100M in fraud. Two engineering consequences: organic search is unwinnable against those domains, and shipping a binary/service/npm artifact named `zeus` invites EDR false positives and procurement conversations — with exactly the buyers a meeting copilot must clear |
| `ml-energy/zeus`, `test-zeus-ai/testzeus-hercules`, `joeledwards/node-zeus`, `zeus.rocks`, `withzeus.com`, `get-zeus.com`, SiteZeus | "AI employee named Zeus" is a crowded, undifferentiated 2026 position. Bonus: the npm package `zeus` (v3.3.3, published 2025-12-05) is *"Utility functions and CLI for AWS Athena"* — **two of the six candidates collide inside one npm package** |
| `Athena-AI-Lab/athena-core`, `winstonkoh87/Athena-Public`, **athenahealth** (4 exact-prefix iOS apps + its own AI Support Assistant), **Amazon Athena**, **Lockheed Martin ATHENA** laser weapon, Athena rocket family, **Athena** virtual-EA service (~$3,000/mo) | Total saturation. For a developer tool, "Athena query" and "Athena error" already resolve to AWS — the documentation and support channels are poisoned before launch |
| `en.wiktionary.org/wiki/काटना`, `/seno`, `/aristo` | The three verified cross-language negatives: Hindi **काटो = imperative "cut!/bite!"** (an India-market voice hazard for CATO); Spanish/Italian **"seno" = breast** (ZENO); **Nigerian-English "aristo" = sugar-daddy slang** (ARISTO) |
| `soundhound.com` wake-word guide, `sensory.com` 2026 custom-wake-word guide, `futurebeeai.com` wake-word length | The ~3-syllable / plosive-onset baseline L7a used to score every candidate — and the basis for the finding that **ZEUS (1 syllable) fails the guidance outright** |
| `worldhistory.org/athena/`, `/zeus/`; `encyclopedia.com/.../aristo-chios-…`; `ebsco.com/research-starters/history/cato-younger`; `plato.stanford.edu/entries/seneca/`, `/paradox-zeno/`, `/marcus-aurelius/`; `en.wikipedia.org/wiki/Legacy_of_Cato_the_Younger` | The substitute primaries L7a used after **Britannica returned 403 on four separate pages** and two seed slugs 404'd |
| **Seneca Nation of Indians** (`sni.org`, DNS-failed; confirmed via secondary) | Naming a commercial AI after a living federally recognized Indigenous nation is a real sensitivity consideration the prompt did not raise |

### 7.7 From L9 — platform export/import

| Reference | Why it matters |
|---|---|
| `registry.modelcontextprotocol.io/v0/servers?search=neosapien` | **0 servers.** Combined with 0 results in the claude.ai connector registry, nothing on any neosapien.ai property, and no GitHub org, this is the load-bearing negative that produced blocker **B-004** |
| `code.claude.com/docs/en/sessions` + `/agent-sdk/sessions` | The documented JSONL path, the cross-host restore recipe, `listSessions()`/`getSessionMessages()`, and the `SessionStore` adapter. **Claude Code's transcripts are the most migration-friendly substrate in the whole matrix** — though the JSONL entry format is explicitly declared unstable |
| `obsidian.md/sync` | The only fully bidirectional item in the matrix (a vault is already plain `.md` on disk) — and the prompt names Obsidian **46 times** with no URL. Sync tiers: Standard $4/mo annual, Plus $8; E2E AES-256 |
| `learn.chatgpt.com/docs/import` — the **standing one-way sync** | The prompt anticipated a one-time import. The doc offers "automatic updates to keep imported work in sync with the original agent": OpenAI can **continuously mirror** your Claude Code setup. Scope is also broader than seeded — hooks, slash commands, subagents, MCP config and project memories are all listed |
| The 50-chats/30-days cap | **CLI-only.** The desktop app documents "last 30 days" with no numeric cap |
| The live NeoSapien MCP connector in this session (`search_memories`, `export_memories`, `get_memory_transcript`, `get_reminders`, …) | Observed, **not** public documentation. Treat NeoSapien as an undocumented vendor-hosted remote MCP with unknown endpoint, auth, schema and stability — never as a packaged integration. Neither lane invoked it; no user memory data was read |

---

## 8. Honest limitations of this ledger

1. **No lane claim was re-verified.** This is a join, not a re-audit. If a lane misread a page, this ledger faithfully propagates the error.
2. **`researched` is a coverage verdict, not a confidence rating.** Several rows marked `researched` rest on evidence the lane itself labelled weaker than *verified* — L2 read **every** licence off a landing-page badge rather than a LICENSE file, and never observed a raw redirect header because Bash was unavailable for its whole session. Read `evidence_note` and the lane's own ACCESS LIMITATIONS section together.
3. **`intentionally-deferred` is the honest word for "nobody looked."** It records a scoping decision (or the absence of one), not a judgment that the URL is unimportant. 42 rows had no owning lane at all.
4. **L5 has not run.** No adversarial pass, no worker-disagreement log, no baseline-versus-deep-review report — all three are named requirements of RESEARCH-AC-02.
5. **`blocks_gate` uses only the enum given** (`Gate1 | Gate2 | none`). The five trademark registers therefore read as `none` even though they block the **brand sub-gate**, which `00-DECISIONS.md` sequences *before* Gate 1. Do not read `none` there as "unimportant".
6. **The gate assignments are this worker's judgment**, applied by one rule: a row blocks a gate only where a decision belonging to that gate demonstrably rests on the unresearched or inaccessible seed. Reasonable reviewers could move individual rows; the three Gate-1 clusters in §4 are the load-bearing claim, not any single row.

---

## Appendix A — Named-seed expansion candidates

Products, projects and entities the master prompt **names in its body with no URL**, and which therefore do not appear in `url-seed-inventory.txt` or in the ledger CSV. Each needs a seed ID of its own before RESEARCH-AC-01 can claim it covers "every named tool, model, MCP, repo, site, video and source". Prompt-body mention counts are exact.

| # | Named seed | Mentions | Where / how it appears | Lane coverage today | Why it needs a row |
|---|---|---:|---|---|---|
| A1 | **Obsidian** (vault, knowledge graph) | **46** | §6.3 "Memory, graph, skills, and Obsidian vault"; workspace-search instructions | **L9 only**, via `obsidian.md/sync` — a URL nobody seeded | The most-mentioned unseeded product in the prompt, and `00-DECISIONS.md` records the vault path as **unknown**. It is a first-class data substrate with no seed URL |
| A2 | **Jira** | **132** | Intake → Context → TASK journey; WEBEXT allowlist | none (B-003 resolved the site + account, not the API) | The MVP journey starts here. No lane researched Jira's API, permissions model or rate limits |
| A3 | **Codex / Codex CLI** (OpenAI) | **31** | History-and-data-controls; agent comparisons | L9 (memories, Computer History, `/import`); **L2 found the repo independently** | `openai/codex` is **116.9k★ Apache-2.0** — L2 calls it inexcusable to survey 2026 coding agents without it. It has no seed URL |
| A4 | **"Lumen Atlas"** (Zera showcase) | 1 | §11 design references, alongside Horizon and Vector Bloom | L4 (X-6) | **It does not exist.** L4 verified the real Zera portfolio; the prompt conflates a non-existent name with the real **Nexus**. A named seed that must be retired, not researched |
| A5 | **tree-sitter** | 2 | §"Code intelligence" stack row; symbol-graph row | L2 verified the repo unprompted | 26.7k★ MIT, "the single most load-bearing, lowest-risk dependency" in L2's report — and it has no seed URL |
| A6 | **Ollama**, **llama.cpp/MLX**, **vLLM** | 2+ | §"Local inference" stack row | none directly (L1 saw Ollama in repo descriptions) | The entire local-inference runtime row is unseeded and unresearched |
| A7 | **Hyprnote** | 2 | Named as the seed identity of `fastrepl/anarlog` | L3 (rename verified) | A **stale alias**. Retire the name; the URL row S113 already carries the correction |
| A8 | **WhisperKit** | 1 | Named as the owner in "WhisperKit/argmax-oss-swift" | L1 (owner corrected) | A **wrong-owner alias**. Retire; S102 carries the correction |
| A9 | **Whisper** (OpenAI) | 2 | Local STT candidates | L1 covered `whisper.cpp` and `large-v3-turbo` (the latter **inferred**) | The upstream model family has no seed URL; only the C++ port does |
| A10 | **Neo4j**, **FalkorDB**, **Kuzu** | 2 / 2 / 1 | §"only after Graphify is audited may you evaluate Graphiti with FalkorDB…" | L2 (all three, via Graphiti) | **Kuzu is archived.** The graph-backend choice is live and unseeded |
| A11 | **Graphify** | (named repeatedly with an explicit "not interchangeable with Graphiti" warning) | §6.3 | none | An **internal/repository** contract the prompt insists must be audited *before* proposing Graphiti. No lane audited it. See `03b-existing-knowledge-systems-report.md` |
| A12 | **Radix**, **shadcn**, **Vercel**, **Electron**, **Tauri 2**, **Three.js / React Three Fiber** | 1–2 each | §"Desktop shell" ADR row and §"UI" stack row | **L4 covered all of them as "beyond the seeds"** and licence-verified four | The entire UI/desktop-shell stack row is named without URLs. L4's G3/G6/G7/G9 rows should be promoted to seeded rows |
| A13 | **Sortformer**, **TitaNet**, **ECAPA** | 1 each | §"Benchmark pluggable, local-capable candidates…" | L3 verified all three via HF model cards | Model *names* with no URL — and L3 found **two Sortformer checkpoints under two different weights licences** and that NVIDIA's ECAPA checkpoint **does not exist publicly** |
| A14 | **Parakeet / ParakeetAI** | 4 / 4 | STT model **and** a competitor product — two different things sharing a token | L1 (model), L3 (product) | The name is ambiguous in the prompt itself. Split into two seeds before anyone conflates NVIDIA Parakeet TDT with parakeet-ai.com |
| A15 | **Cato Networks**, **Cato Institute**, **AWS Athena**, **Seneca College** | inline in the brand table | §brand-candidate table's "crowded" column | L7b — and it **corrected all four** | The brand table names collision entities without URLs. L7b found a third CATO (The Cato Corporation), renamed Seneca College → Seneca Polytechnic (2023), and found **Athena Intelligence**, which the prompt never named and which is a worse collision than AWS Athena |
| A16 | **JARVIS / Ultron** (as naming concepts) | 7+1 / 9 | Programme framing and the L6 census brief | L6 | L6's verdict is worth promoting: **"Serious projects do not brand as Ultron"** — Q2's page 1 is almost entirely off-domain |

**Recommended action:** assign IDs `N001`–`N016` (or fold them into the `S###` series as `S234+`) and re-run this join. Nine of the sixteen already have real lane evidence attached and would move straight to `researched`; A2 (Jira), A6 (local inference), A11 (Graphify) and A1 (Obsidian, beyond `obsidian.md/sync`) would not.

---

*End of report. Ledger: `ledgers/seed-coverage-ledger.csv` — 233 rows, 0 blank statuses, 0 unaccounted seeds.*
