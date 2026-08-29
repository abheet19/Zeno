# L3 — Meeting Copilots & Speaker Identity / Diarization / Anti-Spoofing

**Phase-0A read-only research. Access date for every URL below: 2026-08-24** (unless a different date is stated inline).

**Evidence labels used throughout:**
- **[V]** verified — I fetched the primary artifact (LICENSE file, model card JSON, vendor page HTML, atom feed) and quote/paraphrase what it actually says.
- **[C]** claimed — vendor marketing or third-party review copy; not independently checkable.
- **[I]** inferred — my reasoning from verified facts; flagged as such.
- **[U]** unknown — could not establish.

**This document is not legal clearance.** Every licence conclusion is a reading of a text I fetched, not advice. Anything that ends up in a shipped product needs counsel review, especially the mixed-licence monorepos (Anarlog), the bespoke commercial licences (Screenpipe), the ELv2 project (Attendee), and every model-weight licence separate from its code licence.

---

## 0. TL;DR — decision table

### Part A — meeting copilots

| Project | Licence (code) | Activity (last commit) | Verdict | One-line rationale |
|---|---|---|---|---|
| **NeoSapien Neo 1** | proprietary | product live | **learn-only** | "Bring Memories to Any AI" is an **MCP connector** — the pattern is right, but there is **zero public schema/connector documentation**, so nothing is reusable. |
| **OpenWhispr** | MIT [V] | 2026-08-21 [V] | **adopt** (reference) / **spike** | Only seed project that already ships local diarization + voice fingerprinting + MCP + enterprise controls under MIT. |
| **Zackriya-Solutions/meetily** | MIT [V] | 2026-06-05 [V] | **learn-only** | Diarization is a **paid PRO feature**, not in the MIT community edition — the headline is misleading for our purposes. |
| **fastrepl/anarlog** (ex-Hyprnote) | MIT + `enterprise/` commercial [V] | 2026-08-24 [V] | **compose** | Cleanest mixed-licence boundary I found; MIT layer is provably enterprise-free by CI rule. Renamed from Hyprnote. |
| **thewh1teagle/vibe** | MIT [V] | 2026-08-24 [V] | **compose** | Batch/file transcription + diarization + HTTP API; no live-meeting capture. Good as a component, not a copilot. |
| **Devleed/meeting-copilot** | **no LICENSE** [V] | 2026-06-01 [V] | **reject** | 2 stars, no licence file → all rights reserved. Unusable. |
| **RageTony4/cue-cluely-alternative** | GPL-3.0 [V] | 2026-07-16 [V] | **reject (wrong seed)** | 0-star fork. Upstream is **Blueturboguy07/cue** (1,229★). GPL-3.0 either way → viral for a desktop product. |
| **joaquingit1/loqui** | MIT [V] | 2026-07-02 [V] | **learn-only** | **It exists** (seed doubted it). Excellent architecture ideas (dual-stream, read-only-AI); 3 stars, one release, bus factor 1. |
| **thepersonalaicompany/amurex** | AGPL-3.0 [V] | **2025-05-27** [V] | **reject** | Dormant ~15 months + AGPL-3.0 → both a maintenance and a licence problem. |
| **Vexa-ai/vexa** | Apache-2.0 [V] | 2026-08-21 [V] | **adopt** (bot lane) | The only Apache-2.0, actively released, self-hostable meeting-**bot** stack in the list. |
| **Screenpipe** | **bespoke commercial** [V] | 2026-08-24 [V] | **reject** | Seed claim **confirmed and worse than stated**: 7-day eval cap, commercial use requires a paid licence, embedding into a customer product prohibited. |

### Part B — speaker identity / diarization / anti-spoofing

| Component | Code licence | Weights licence | Gated? | Verdict |
|---|---|---|---|---|
| **pyannote-audio 4.x** | MIT [V] | `community-1` **CC-BY-4.0**; `3.1`/`segmentation-3.0` **MIT** [V] | **yes — contact-info gate on all three** [V] | **adopt with caveat** — gate is marketing-consent, not a licence restriction, but it blocks unattended CI/offline installs. |
| **NeMo Streaming Sortformer v2** | Apache-2.0 [V] | **CC-BY-4.0**, **not gated** [V] | no | **adopt** — best streaming-diarization licence/gating story in the list. |
| **NeMo Streaming Sortformer v2.1** | Apache-2.0 [V] | **nvidia-open-model-license** [V] | no | **spike** — newer/more robust, but a *different, non-CC* weights licence. Read it before shipping. |
| **NeMo TitaNet-large** | Apache-2.0 [V] | CC-BY-4.0, not gated [V] | no | **adopt** — clean embeddings for enrolment/fingerprinting. |
| **SpeechBrain ECAPA (`spkrec-ecapa-voxceleb`)** | Apache-2.0 [V] | **Apache-2.0**, not gated [V] | no | **adopt** — the least-encumbered speaker-embedding option, full stop. |
| **k2-fsa/sherpa-onnx** | **Apache-2.0** [V] | **per-model, varies** [V] | varies | **adopt (runtime)** — runtime is clean; **audit each model bundle separately**. |
| **ASVspoof** | n/a | ASVspoof 5 data **ODC-By** [C]; papers CC-BY-NC-ND [V] | no | **learn-only** — and **ASVspoof 5 has no replay track** (see §B.5). |

---

## 1. PART A — NeoSapien (the key question)

### 1.1 What the "Bring Neo 1 Memories to Any AI" mechanism actually is

**Answer: it is a Model Context Protocol (MCP) connector. This is verified, but only from the page source — there is no vendor-published documentation, schema, or connector guide anywhere on the public site.**

Verified evidence, all from `https://neosapien.ai/` and `https://neosapien.ai/shop`, fetched 2026-08-24:

- Rendered copy, verbatim [V]:
  > **Bring Neo 1 Memories to Any AI**
  > Use everything Neo 1 remembers inside ChatGPT, Claude and more.

  Preceded by a "New" pill. Appears identically on `/` and `/shop`.
- The HTML source comment naming the component [V]:
  > `<!-- Card F: Bring Neo 1 Memories to Any AI (MCP) — NEW, Figma 4615:65789 -->`
- The image asset filename and its alt text [V]:
  `src="/_astro/mcp-any-ai.vJvUxxQS.webp"`, `alt="Neo 1 memories connected to Claude, ChatGPT and other AI apps"`.

So the vendor's own build artefacts label the feature "MCP" three independent ways. **[V]**

**Corroborating observation, labelled honestly:** this Claude Code session's MCP connector registry contains a live NeoSapien memory server (server id `fd53d8bb-…`) whose published instructions describe it as an "AI assistant with access to NeoSapien memory data" and expose these tools: `search_memories`, `get_latest_memories_by_owner_name`, `search_memories_metadata`, `get_reminders`, `list_all_memories`, `list_filtered_memories`, `get_memory_by_id`, `get_memory_transcript`, `search_owners`, `export_memories`. **[V — observed in this session's connector registry, not on any public page.]** I did **not** invoke any of these tools; the user's personal memory data is out of scope for this research. Note that this surface is a *hosted remote MCP connector* reached through claude.ai's connector settings, i.e. it is an account-linked cloud API wearing an MCP jacket — not a local export.

### 1.2 Does an official export schema or connector doc exist?

**No. This is the load-bearing negative finding.** [V]

| Probe | Result |
|---|---|
| `https://neosapien.ai/mcp` | **404** |
| `https://neosapien.ai/memories` | **404** |
| `https://docs.neosapien.ai/` | **DNS does not resolve** (`Could not resolve host`) |
| `https://neosapien.ai/sitemap.xml` | 404 (real index is `/sitemap-index.xml`, per `robots.txt`) |
| `https://neosapien.ai/llms.txt` | 200 — lists Home, Shop, Privacy, About, Terms, Contact, Desktop App + blog posts. **No MCP, connector, API, or developer page.** |
| `https://neosapien.ai/llms-full.txt` | 200, 80,159 bytes — "Plain-text export of every published NeoSapien article". `grep -i 'mcp\|model context protocol\|connector\|export'` → **zero substantive hits**. |
| The marketing card itself | **not hyperlinked to anything** — it is a static image + text with no `href`. |

Additionally: the Terms of Service (`/terms`) contain **no** developer/API terms at all. §3.2 Restrictions forbid reverse engineering, decompiling, or disassembling any part of the Service. **[V]** The only export-adjacent commitment on the whole site is a marketing bullet on `/shop`:

> **You Own Your Data** — Export everything or delete everything, anytime. Your memories belong to you, not us. **[C — marketing claim, no mechanism, format, or schema specified anywhere]**

…and a Privacy Policy §9 "Privacy Choices" which offers *conversation deletion* and *account-data deletion* but **says nothing about export**. **[V]**

**Bottom line for our programme [I]:** NeoSapien has validated the *product pattern* we care about — wearable/desktop capture → memory store → MCP surface into ChatGPT/Claude. It has published **nothing** we can integrate against, conform to, or reuse. Treat as **learn-only**: it is a competitive/positioning datapoint and a UX proof that "your memories, in any AI, via MCP" is a shippable headline feature. It is not a technical dependency.

### 1.3 Rigorous distinction from `NeoAIResearch/neo-mcp` — completely unrelated

| | NeoSapien | NeoAIResearch/neo-mcp |
|---|---|---|
| What | AI-wearable pendant (Neo 1) + memory platform ("NeoCore", per `llms.txt` [V]) | "MCP server for Neo AI Engineer Agent" — an **autonomous AI/ML engineering agent** [V] |
| Site | `neosapien.ai` | `heyneo.com` / `docs.heyneo.com` [V] |
| Legal entity | ZENITHZEPHYR WELLNESS PRIVATE LIMITED, CIN U86900KA2024PTC183574, Bengaluru [V, /terms] | "Neo AI Research" (LICENSE copyright line) [V] |
| Repo | none public | `github.com/NeoAIResearch/neo-mcp` — MIT [V], 2★, 1 fork, last commit **2026-06-18** [V], **no releases** [V] |
| Domain | meeting/conversation memory | RAG, fine-tuning, CV, data science pipelines [V] |

They share only the token "neo". **There is no relationship.** Do not let a search-result collision put `neo-mcp` into a NeoSapien evaluation.

### 1.4 Other verified NeoSapien facts

- **Pricing** [V, `/shop`]: ₹12,999 (MRP ₹15,999), inclusive of taxes. Colours: Black / Gunmetal / Copper / Silver. "One-time purchase. No subscriptions. Ever."
- **Terms §5.1** [V]: "Neo 1 currently has no monthly subscription or hidden fees… NeoSapien reserves the right to introduce and change subscription rates with prior notice." (i.e. "Ever." on the shop page is contradicted by the Terms.)
- **Desktop app** [V, `/desktop`]: "Now capture online meetings on laptop… Dedicated desktop app to capture all online meetings. **No bots.**" macOS 13+ (Apple Silicon) · Windows 10+. Works with "Zoom, Meet, Teams and even WhatsApp." Calendar sync. **This is the same no-bot local-capture architecture as Granola/Anarlog/Loqui.** [I]
- **Privacy Policy** [V, `/policies` — note `/policies` and `/terms` serve *different* content despite identical byte length in my fetch; `/policies` = Privacy Policy, `/terms` = T&Cs]: raw audio deleted after processing, only transcripts/summaries retained; AES-256 claimed on `/shop` [C]; "We will not train AI models on your conversations without your explicit opt-in consent" [C]; account-deletion propagates to backups with no holding period [C].
- **Speaker handling** [V, Privacy §4]: "Microphone access is essential for voice profile, allowing the app to recognize **only the user's speech**… **other participants' voices are not identified or stored**." This directly contradicts the `/shop` feature bullet "**Speaker Recognition** — Knows who said what — automatically labeled transcripts." **Flagging this as an unresolved vendor self-contradiction [V on both texts, U on which is operative].** It is the single most decision-relevant inconsistency on the site for anyone benchmarking diarization claims.
- Shipping: India only; US via Amazon (`amazon.com/dp/B0H2F1G7XN`) [V]. Governing law India, arbitration in Bangalore [V].
- Site runs PostHog with `session_recording` + `capture_heatmaps` + `autocapture` enabled [V, inline script] — noted only because it is visible in source and relevant to any "privacy-first" positioning comparison.

---

## 2. PART A — open-source meeting copilots

### 2.1 OpenWhispr/openwhispr — **adopt (as reference architecture) / spike**

- **Licence: MIT** [V — `raw.githubusercontent.com/OpenWhispr/openwhispr/main/LICENSE`, "Copyright (c) 2024 OpenWhispr Team"]
- **5,692 ★ / 800 forks** [V]. Last commit **2026-08-21**; releases through **2026-08-18** (`1.8.3`, plus a separate "Windows Mic Listener v1.1.0") [V, atom feeds].
- Description [V]: "Voice-to-text dictation app with local (Nvidia Parakeet/Whisper) and cloud models (BYOK). Privacy-first and available cross-platform."
- Capabilities claimed in README [C, but specific enough to be testable]: global-hotkey dictation; dictation translation; AI agent (GPT-5 / Claude / Gemini / Groq / Tinfoil / OpenRouter / local); **meeting transcription with auto-detect of Zoom, Teams, FaceTime**; **local speaker diarization with voice fingerprint recognition across meetings**; notes with semantic search; team spaces; audio/YouTube import; **enterprise controls (SSO, SCIM, Bedrock/Azure OpenAI)**; **public API + MCP server** (`docs.openwhispr.com/integrations/mcp`).
- **Honest platform caveat in their own README** [V] — worth citing as the standard of disclosure we should hold ourselves to: on Intel Macs, "live speaker identification and voice fingerprinting are unavailable: they depend on ONNX Runtime, which stopped shipping macOS x86_64 binaries in 1.24."
- **Rationale:** this is the only seed project that has, under a permissive licence, *simultaneously* solved local diarization, cross-meeting voice fingerprinting, and an MCP surface — precisely the triangle our programme needs. Adopt as the reference architecture; spike the diarization/fingerprinting path specifically.

### 2.2 Zackriya-Solutions/meetily — **learn-only** (seed claim corrected)

- **Licence: MIT** [V — `main/LICENSE.md`, "Copyright (c) 2024 Zackriya Solutions"]
- **29,832 ★ / 3,187 forks** [V] — by far the largest star count in the seed list.
- **Last commit 2026-06-05**; last release **Meetily v0.4.0, 2026-06-05** [V]. ~2.5 months idle.
- Repo was **renamed**: README badges still point at `Zackriya-Solutions/meeting-minutes` [V].
- **CORRECTION — the GitHub description oversells the open edition.** The repo tagline says "…4x faster Parakeet/Whisper live transcription, **speaker diarization**, and Ollama summarization… 100% local" [V]. But the vendor's own comparison table at `https://meetily.ai/pro/` says [V]:

  | Feature | Community | Pro | Enterprise |
  |---|---|---|---|
  | Price | Free | **$10/user/month billed annually** (60% off $25/mo regular) | Custom |
  | Licence | **MIT (open source)** | **Commercial** | Commercial + custom terms |
  | **Speaker identification** | **No** | **Yes** | Yes |
  | Advanced exports (PDF/DOCX/MD) | No | Yes | Yes |
  | Windows GPU acceleration | No | Yes | Yes |

  The README also still carries a stale line: "Speaker diarization is also planned for PRO in mid-June" [V].
- **Rationale:** diarization — the thing we most need — is behind the paid Commercial tier. The MIT edition is a local Whisper/Parakeet notetaker without speaker labels. Learn from the Rust/Tauri packaging and the Community-vs-Pro boundary; do not plan on inheriting diarization from it.

### 2.3 fastrepl/anarlog (**formerly Hyprnote**) — **compose**; seed claim **VERIFIED**

**CORRECTION — the seed name is stale.** `github.com/fastrepl/hyprnote` **301-redirects to `github.com/fastrepl/anarlog`** [V — `curl -L` reports `final=https://github.com/fastrepl/anarlog`]. The product is renamed: website `anarlog.so`, docs `docs.anarlog.so`, `@anarlogapp`, `r/anarlog`. Repo description is now "Open source Granola AI Alternative" [V]. **9,155 ★ / 731 forks** [V].

Also new [V, README banner]: "**The team is now building [char](https://char.com)**. The **anarlog** community application remains open-source, MIT-licensed, and maintained… Source-visible enterprise components are commercially licensed." → **strategic-direction risk flag**: primary team attention has moved to a different product. **[I]**

**Activity is excellent regardless:** last commit **2026-08-24** (today), release `desktop_v1.4.13` **2026-08-24**, `v1.4.12` 2026-08-23 [V].

**The bracketed claim — "community app MIT, enterprise components separately licensed" — is VERIFIED, and the boundary is unusually well documented.** [V]

- `LICENSE` = **MIT**, "Copyright (c) 2023-present Fastrepl, Inc." [V]
- `LICENSE.enterprise` = **"Anarlog Enterprise Commercial License Notice"** [V]. Verbatim core:
  > The source code and associated documentation under the `enterprise/` directory (the "Enterprise Software") are not licensed under the MIT License that applies to Anarlog's community software… No other rights to use, copy, modify, distribute, sublicense, sell, or operate the Enterprise Software in production are granted except under a written commercial agreement signed by Fastrepl, Inc. or as required by applicable law.
- `LICENSING.md` — **this is the artefact worth stealing wholesale for our own repo** [V]. It states: "This is **path-based mixed licensing**, not a choice between two licences for the same file"; "The nearest licence file controls"; "The MIT layer must build and test without `enterprise/`. It must never import, depend on, generate from, or require a commercially licensed package"; "**CI enforces that rule for Rust and JavaScript package manifests**"; and a third-party-provenance policy that explicitly says "**Do not incorporate AGPL, GPL, SSPL, source-available, or unknown-license material without written legal approval**."
- Root tree confirms `enterprise/` exists alongside `apps/`, `crates/`, `plugins/`, `packages/`, `skills/anarlog`, `agent-plugins/anarlog` [V].

Architecture worth noting [C, README]: Tauri v2 desktop; local SQLite + plain files; **no bot joins the call** (device-audio capture); `crates/*` include "audio capture, transcription, **diarization**, storage"; `apps/cli` is a "Local CLI and MCP server"; cloud transcription currently routes to Deepgram Nova / Soniox, intelligence to "latest Claude Sonnet alias through OpenRouter".

- **Rationale:** compose. The MIT layer is genuinely usable and the enterprise boundary is enforced by CI rather than by assertion — that is the model to copy. Watch the `char.com` pivot as a continuity risk.

### 2.4 thewh1teagle/vibe — **compose**

- **Licence: MIT** [V, "Copyright (c) 2024 thewh1teagle"]. **7,182 ★ / 493 forks** [V].
- **Very active:** last commit **2026-08-24**, release **v3.1.3** 2026-08-24, v3.1.2 2026-08-23 [V].
- Capabilities [C, README]: fully offline transcription; Whisper + **Nemotron 3.5** + **Parakeet TDT v3**; **speaker diarization**; batch files; SRT/VTT/TXT/HTML/PDF/JSON/DOCX; system-audio and mic capture; GPU (CoreML/Vulkan, NVIDIA/AMD/Intel); CLI; **HTTP API with Swagger docs and agent skills**; phone-as-mic over QR.
- **Rationale:** compose, not adopt — it is a transcription *workbench*, not a live meeting copilot (no calendar/meeting-detection layer). Its HTTP API + MIT licence make it a clean drop-in for the batch/import lane.

### 2.5 Devleed/meeting-copilot — **reject**

- **NO LICENSE FILE** at `main` or `master` (404 on LICENSE, LICENSE.md, LICENSE.txt, COPYING) [V]. Under Berne/GitHub ToS defaults that means **all rights reserved** — we may not use or redistribute it. **[I, standard reading]**
- **2 ★ / 0 forks**; last commit **2026-06-01**; **no releases** [V].
- What it is [C, README]: a terminal-only macOS script — BlackHole 2ch virtual audio → Silero VAD → faster-whisper → GPT-4o/Claude suggestions streamed to stdout, with optional RAG. Requires `OPENAI_API_KEY` always.
- **Rationale:** reject. No licence, no traction, no packaging. The only takeaway is the BlackHole multi-output-device recipe for macOS system-audio capture, which is common knowledge.

### 2.6 RageTony4/cue-cluely-alternative — **reject; seed points at the wrong repo**

**CORRECTION — this is a 0-star fork/mirror. The canonical upstream is `Blueturboguy07/cue`.** The seed repo's own README instructs `git clone https://github.com/Blueturboguy07/cue.git` [V].

| | RageTony4/cue-cluely-alternative | **Blueturboguy07/cue** (upstream) |
|---|---|---|
| Stars / forks | **0 / 0** [V] | **1,229 / 285** [V] |
| Licence | GPL-3.0 [V] | **GPL-3.0** [V] |
| Last commit | 2026-07-16 [V] | **2026-08-10** [V] |
| Releases | **none** [V] | `0.2.2` (2026-08-01), `v0.2.1 — signed and notarized` (2026-07-31) [V] |

- **Rationale:** reject either way. **GPL-3.0 is viral for a distributed desktop application** — incompatible with a proprietary product. But the upstream README is the single best piece of counter-evidence to Cluely's marketing and is quoted in §3.1 below. Use it as evidence, not as code.

### 2.7 joaquingit1/loqui — **learn-only**; seed doubt **REFUTED**

**CORRECTION — the seed said "verify it exists at all". It exists.** `github.com/joaquingit1/loqui`, HTTP 200 [V].

- **Licence: MIT** [V, "Copyright (c) 2026 Loqui contributors"].
- **3 ★ / 0 forks**; last commit **2026-07-02**; **one release, v0.1.0 (2026-06-27)** [V]. macOS **Apple Silicon only** [V].
- Its architectural ideas are disproportionately good for a 3-star repo, and three are directly relevant to us [C, README]:
  1. **Two independent never-merged streams** — mic ("You") and system audio via ScreenCaptureKit ("They") transcribed *separately*, with cross-stream echo suppression so speaker attribution never depends on diarization for the local/remote split.
  2. **"The AI can read the transcript but never edits it"** — "enforced structurally (no writer is reachable from any AI code path) and asserted by byte-identical tests."
  3. **"The default diarizer needs no Hugging Face token"** — an explicit design response to the pyannote gating problem documented in §B.1.
- **Rationale:** learn-only. Bus factor 1, one release, single platform — not a dependency. But idea (1) is the cheapest large accuracy win available to us, and idea (3) is the correct posture on gated weights.

### 2.8 thepersonalaicompany/amurex — **reject**

- **Licence: AGPL-3.0** [V — 34,523-byte GNU AFFERO GPL v3].
- **2,867 ★ / 219 forks** [V] — but **last commit 2025-05-27** and **last release v1.0.27 on 2025-03-20** [V]. **~15 months dormant.**
- Scope [C, README]: Chrome extension meeting copilot for Google Meet and MS Teams only; real-time suggestions, summaries, follow-ups.
- **Rationale:** reject on both axes. **AGPL-3.0** is the worst-case licence for anything with a network-served component, and the project is abandoned. Note the seed list's implicit framing of Amurex as a live comparable is out of date.

### 2.9 Vexa-ai/vexa — **adopt** (for the bot-join lane, if we need one)

- **Licence: Apache-2.0** [V]. **2,710 ★ / 439 forks** [V].
- **Actively released:** last commit **2026-08-21**; `v0.12.23 — Calendar auto-join discipline, and Teams CSRC transcription` (2026-08-20); `v0.12.22 — Teams speaker attribution` (2026-08-12) [V].
- Capabilities [C, README, but corroborated by release titles]: real bots join **Google Meet, Microsoft Teams, Zoom** and stream **speaker-attributed** transcripts over WebSocket; Jitsi "join + capture offline-proven, live validation pending" (issue #883) — an unusually honest caveat; meetings compile to **Markdown in a git repo**; sandboxed agents (self-host only); **MCP server**; air-gap-ready.
- **Pricing (hosted)** [V, README]: **$0.30/hr** bot time; new accounts get $5 free credit (~16h).
- **Dependency signal for Part B:** the repo vendors `licenses/onnx-community-pyannote-segmentation-3.0.LICENSE.txt` [V] — i.e. Vexa's diarization is the ONNX export of pyannote segmentation-3.0. Independent corroboration that this is the de-facto open diarization front-end.
- Also present: a `CLA/` directory [V] — contributions require a CLA; relevant if we ever upstream.
- **Rationale:** adopt. Apache-2.0 + active releases + genuine multi-platform bot fleet. The bot-join model is architecturally opposite to the no-bot local-capture model (NeoSapien/Granola/Anarlog/Loqui) — pick deliberately, and note bots create a *consent artefact* (a visible participant) that local capture does not.

### 2.10 Screenpipe — **reject**; seed claim **CONFIRMED (and stricter than stated)**

**CORRECTION — the org was renamed:** `github.com/mediar-ai/screenpipe` **redirects to `github.com/screenpipe/screenpipe`** [V]. **21,204 ★ / 2,128 forks**; last commit **2026-08-24**; releases `Screenpipe App v2.6.81` (2026-08-23) [V]. Repo tagline now includes "YC (S26)" [V].

**Exact current licence — `LICENSE.md` on `main`, titled "Screenpipe Commercial License", Copyright (c) 2024-2026 Mediar, Inc. (dba Screenpipe).** Verbatim, the operative clauses [V]:

- **§2 Free Use** — permitted only for "Personal, non-commercial use; Non-profit, educational, or research use; **Evaluation, development, and testing for up to seven (7) days**, at any organization size."
- **§1 Definitions** — "**Commercial Use**" means any use "(a) in a business or production environment; (b) to generate revenue or to support revenue-generating activity; or (c) by or on behalf of a for-profit entity, after the Evaluation period."
- **§4** — "Any Commercial Use of the Licensed Work requires a separate **paid commercial license**… **regardless of company size, headcount, revenue, or funding**."
- **§5 Prohibited Without a Commercial License** — may not "Sell, sublicense, or distribute the Licensed Work as part of a commercial product or service"; "Provide the Licensed Work as a hosted or managed service to third parties"; "**Embed or integrate the Licensed Work into a product offered to customers**"; "Use the Licensed Work to build, offer, or operate a **competing product or service**."
- **§6 Ownership** — "The Licensor and its licensors retain all right, title, and interest in the Licensed Work, **including any modifications or patches you make**."
- Closing note — "Versions of Screenpipe previously released under the MIT license remain available under the MIT license. This license applies to this version and all later versions."

**Rationale: reject.** The seed's characterisation ("source-available, unsuitable for commercial reuse") is **confirmed**. Three points sharpen it: the evaluation window is only **seven days**; §5 explicitly bans the exact thing we would want (embedding into a customer-facing product); and §6 assigns *our own modifications* to the licensor. The MIT-era history is a trap — pinning an old MIT commit forfeits every subsequent fix and is a decision to take with counsel, not casually. **[I on the last point.]**

---

## 3. PART A — commercial benchmarks (public pages only)

### 3.1 Cluely — **REJECTED PATTERN** (with evidence)

**Pricing** [V, `cluely.com/pricing`, monthly toggle]:

| Plan | Price | Notable |
|---|---|---|
| Starter | **Free** | "Limited AI responses", "Limited meeting notetaking", up to 3 files |
| Pro | **$19.99/month** | Unlimited AI responses, unlimited notetaking, "Unlimited access to latest AI models" |
| **Pro + Undetectability** | **$149.99/month** | "Everything in Pro, plus… **Completely hidden to meeting screen sharing software**" |

*Discrepancy noted [V]: the page `<title>` reads "Cluely Pricing — Free Plan & Pro from $11.99/mo" while the monthly card renders $19.99 — presumably an annual-rate title on a monthly-default page.*

**What the undetectability page claims, verbatim** [V, `cluely.com/undetectability`]:
> **Undetectable in every way** — Suite of features to use Cluely without a trace.
> **Doesn't join meetings.** Cluely never joins your meetings, so there are no bots and no extra people on the guest list.
> **Invisible to screen share.** Cluely never shows up in shared screens, recordings, or external meeting tools.
> **Follows your eyes.** Cluely window is fully moveable so you can position it exactly where you're looking.
> **Compatible with every tool** — Zoom, Slack, Webex, Microsoft Teams, Google Meet
> Open Cluely, turn on undetectability, and interact with the widget. **Cluely Assist is fully undetectable.**

**The stated platform caveats — from Cluely's *own docs*, which materially contradict the above** [V, `docs.cluely.com/feature/undetectability`; note the seed URL `/undectability` is a typo that 301s to the correct page]:
> Cluely is invisible on any screen sharing video conferencing software **by default, as long as the software respects the Windows and MacOS default for privacy & infinite overlays.** Cluely uses the same technology that Zoom does to ensure screen share does not show infinite overlays.
> **Invisibility is now an opt-in feature.** Make sure to enable it if you want to keep Cluely hidden during screen sharing sessions.

**Why this is a REJECTED PATTERN for our programme — the evidence chain [I, built on V facts]:**

1. **The marketing makes an unconditional claim the documentation retracts.** "Never shows up in shared screens, recordings, or external meeting tools" and "Compatible with every tool" (a named list of five) vs. docs' "as long as the software respects the Windows and MacOS default". The condition is not a footnote — it is the entire load-bearing assumption, and it is invisible on the page a buyer reads.
2. **The condition is known to be false on current macOS.** The competing open-source implementation's README states it plainly [V, `github.com/Blueturboguy07/cue`]:
   > cue tries to stay out of screen recordings/shares, but this is **best-effort, not guaranteed** — on **macOS 15.4+ Apple can let modern capture tools see it anyway**, and a phone camera always can.
   > On Zoom specifically, whether cue is hidden depends on one setting — **Settings → Share Screen → Screen capture mode → "Advanced capture with window filtering."**
   Same OS-level mechanism, opposite honesty. A capture path that composites all windows (ScreenCaptureKit-era) is not obliged to honour the legacy per-window exclusion flag. **[I]**
3. **A phone camera defeats it entirely** — acknowledged by the open-source clone [V], never mentioned by Cluely.
4. **The ethical/consent exposure is priced as a feature.** Undetectability is a **7.5× price multiplier** ($19.99 → $149.99). The upstream OSS project puts the warning Cluely omits [V]: "Using a hidden assistant during a **proctored exam, job interview, or recorded meeting** may break that platform's rules and, in some places, **consent laws**."

**Verdict: reject the pattern outright.** Not "implement it more honestly" — reject. Our differentiator should be the inverse: **provable presence** (the participant knows capture is happening) rather than provable absence. Two of our strongest comparables already monetise exactly that — Granola sells "Org-wide notification that Granola is being used" as an *Enterprise* feature [V], and Vexa's bot is a visible participant by construction [V]. Undetectability is a category that invites platform bans, enterprise-procurement rejection, and jurisdiction-specific legal risk, and its central technical claim is not durable across OS versions. **[I]**

### 3.2 Granola — pricing + capabilities [V, `granola.ai/pricing`]

| Plan | Price | Key contents |
|---|---|---|
| Basic | **$0**/user/mo | AI meeting notes, *limited* history, AI chat within & across meetings, shared folders, custom templates, multi-language, "Opt out of model training any time" |
| Business | **$14**/user/mo | Unlimited notes & history, advanced AI thinking models, integrations (Attio, Notion, Slack, HubSpot, Affinity, Zapier), centralized billing, **"MCP integration in all your apps"**, **API access** |
| Enterprise | **$35**/user/mo | SSO, priority support & usage analytics, org-wide auto-deletion, admin controls for sharing & API, org-wide training opt-out, **"Org-wide notification that Granola is being used"** |

**Decision-relevant [I]:** MCP + API are gated at the **paid** tier — the same "memories into any AI" surface NeoSapien markets for free, monetised. And the consent-notification feature at Enterprise is direct market evidence that transparency, not stealth, is what enterprises buy.

### 3.3 Otter — pricing + capabilities [V, `otter.ai/pricing`]

| Plan | Monthly | Annual (their stated) | Key contents |
|---|---|---|---|
| Basic | **Free** | Free | Zoom/Teams/Meet, AI chat, 3 lifetime file imports, live transcription, **speaker identification**, **300 monthly transcription minutes**, **Otter MCP server** |
| Pro | **$16.99**/user/mo | **$8.33**/user/mo | 1,200 in-app recording min, 10 file imports/mo, up to 90 min/meeting, team vocabulary & taggable speakers, Salesforce*/HubSpot*/Zapier |
| Business | **$30**/user/mo (shown $24 w/ "20% off for 3 months") | **$19.99**/user/mo | Unlimited meetings, custom AI workflows, up to 4h/meeting, 3 concurrent meetings, admin analytics |
| Enterprise | quote | quote | SSO/SCIM, HIPAA (add-on), **Otter API & Webhooks**, video replay |

**Decision-relevant [I]:** Otter ships an **MCP server on the free tier** — the most aggressive MCP positioning of the eight. Speaker identification is also free-tier. This sets the floor: MCP + diarization are table stakes, not differentiators.

### 3.4 Fireflies — pricing + capabilities [V, `fireflies.ai/pricing`, annual figures]

| Plan | Annual | Monthly | Key contents |
|---|---|---|---|
| Free | **$0** | $0 | Unlimited transcription & AI summaries, **400 min storage/team**, 20 AI credits, 100+ languages, AskFred, **API access**, 2h recording limit |
| Pro | **$10**/seat/mo | $18 | 8,000 min storage/seat, video recording, downloads, Personal/Email Assistant, AI Skills, Voice Agents, unlimited integrations, 2h limit |
| Business | **$19**/seat/mo | $29 | Unlimited storage, 30 credits, multi-language mode, conversation intelligence, team analytics, 3h limit |
| Enterprise | **$39**/seat/mo (annual only) | — | 50 credits, rules engine, SSO+SCIM, audit logs, HIPAA, private storage, custom retention, **transcript+summary-only mode** |

Notable [V]: "Record using Chrome extension **without Fireflies bot**" appears in the feature matrix — the bot/no-bot duality again. Video capped at 720p except Business (1080p).

### 3.5 Fathom — pricing + capabilities [V]

**CORRECTION — `fathom.video` now 301s to `www.fathom.ai`** [V]. Rebrand; update the seed URL.

| Plan | Monthly | Annual | Key contents |
|---|---|---|---|
| Free (individuals) | **$0** | $0 | **Unlimited** recordings + transcriptions, **"Choice of bot-free (in beta) or bot capture"**, instant AI summaries, clips/playlists/search |
| Premium (individuals) | **$20**/user/mo | **$16** | Advanced summaries, AI action items, conversational assistant, custom meeting bot |
| Team | **$19**/user/mo (2 user min) | **$15** | Global search, playlists, collaboration |
| Business | **$34**/user/mo (2 user min) | **$25** | CRM field sync, Deal View, coaching metrics & AI scorecards, custom summaries |
| Enterprise | quote | — | SSO & SCIM, org-wide security controls, custom retention, dedicated CSM |

Notable [V]: nav lists **"Public API & MCP"** under Integrations, and ChatGPT + Claude as named integrations. Bot-free capture is explicitly labelled "**Beta feature for Mac**" — an honest platform caveat, unlike Cluely's.

### 3.6 Krisp — pricing + capabilities [V, `krisp.ai/pricing/`]

Three distinct product lines: **Meeting AI**, **Call Center AI**, **Developers**. Meeting AI tiers [V]:

| Plan | Monthly | Annual | Key contents |
|---|---|---|---|
| Free Trial | **$0**, **7 days** | — | Unlimited transcription, noise cancellation, A/V recording, AI notes; *limited* accent conversion |
| Core | **$16**/mo/user | **$8**/mo/user | Unlimited AI note-taker, **bot-free**, in-person meeting notes, unlimited noise cancellation, unlimited integrations & webhook, mobile app, multilingual transcript, AI chat, **1 hr/day accent conversion**, **MCP integration (Claude, ChatGPT, Cursor, Custom)**, 10 GB storage |

**Decision-relevant [I]:** Krisp is the only one of the eight whose *core* differentiator is signal-processing (noise cancellation, voice isolation, accent conversion) rather than summarisation — and it sells a **"Voice security — Real-time fraud detection"** line under Call Center AI [V], which is the commercial analogue of the Part-B anti-spoofing work. Also: Krisp has no permanent free tier, only a 7-day trial.

### 3.7 ParakeetAI — **ACCESS LIMITATION on pricing**

**CORRECTION — the official domain is `parakeet-ai.com` (hyphenated), redirecting to `www.parakeet-ai.com`.** `parakeetai.com`, `www.parakeetai.com`, and `parakeet.ai` all **time out** from this network (curl exit 28, three attempts) [V — record as ACCESS LIMITATION].

Capabilities and marketing claims, verbatim from the official site [V, `www.parakeet-ai.com`]:
> Your **Real-Time** AI Call Assistant — "Get the right answer while you're still talking, through interviews, sales calls, or any conversation where freezing up isn't an option."
> **Full Coding Interview Support** — "It can both listen for coding questions and **capture the screen of a LeetCode-style question being screen shared with you**."
> **Blazing Fast Transcription** … **"100% Accurate Responses"**
> Trusted by **1.5M+** people · **4.86** from 340K+ reviews · No. 1 Viral App in India 🇮🇳 · #1 AI Call Assistant on SimilarWeb

All of the above are **[C]** — unverifiable vendor claims. "100% Accurate Responses" is a claim no LLM product can support and should be read as a credibility signal about the whole page. **[I]**

**Pricing: could not verify.** The `#pricing` section renders tier *names* only — "Subscription / Credits", "Weekly", "Monthly (Most popular)", "Unlimited call time", "Full privacy mode", "Top models" — with **no dollar amounts in the static HTML**; `/pricing` merely anchors to `/#pricing` on the SPA [V]. Prices appear to require sign-in, which is out of scope under Phase-0A rules. Third-party review sites report **mutually inconsistent** figures (e.g. "$29.50 for 3 credits / $59 for 6+2 / $88.50 for 9+6" vs "$39.50 for 3 hours"; "$74.90/month" vs "$224.90/year"; a "~$150 lifetime") [C — conflicting, do not cite]. **Free tier is verified: a 10-minute free session, then credits** [V, in-app copy on the marketing page].

**Verdict [I]:** same rejected pattern as Cluely — a real-time answer-feeding tool positioned squarely at live job interviews, with screen-capture of shared coding problems. Record as a competitor to be aware of and a pattern not to copy.

### 3.8 Wispr Flow — pricing + capabilities [V, `wisprflow.ai/pricing`]

| Plan | Monthly | Annual | Key contents |
|---|---|---|---|
| Free | **$0** | $0 | Speech-to-text across all apps, 100+ languages, Mac/Win/iOS/Android, learns names & jargon, **Notetaker (Mac only)**, **Identify speakers in meeting notes**, ask across meetings, **"Use your notes in Claude, ChatGPT, and other AI tools (MCP)"**, calendar + Slack, HIPAA-ready, training opt-out |
| Pro | **$15**/user/mo | **$12**/user/mo | Unlimited dictations, longer meeting retention, advanced thinking models, early access, centralized billing |
| Enterprise | quote | quote | SOC 2 Type II, ISO 27001, HIPAA BAA, audit logs, MDM, SAML SSO, SCIM, volume discounts; *"Notetaker coming soon to Enterprise"* |

Free-tier word limits [V]: 2,000/week desktop, 1,000/week iPhone, unlimited Android. Notetaker features are marked "Coming soon" in the Enterprise column [V].

**Decision-relevant [I]:** Wispr Flow gives away **speaker identification + MCP + cross-meeting Q&A on the free tier** and charges for *volume* and *retention*. Combined with Otter's free MCP server, this is the clearest signal in the whole survey: **the memory-into-any-AI surface is now a free-tier commodity**, and NeoSapien's "New" badge on it is late, not early.

---

## 4. PART B — speaker identity, diarization, anti-spoofing

### B.1 pyannote/pyannote-audio — **adopt, with a gating caveat**

- **Code licence: MIT** [V — `main/LICENSE`, "Copyright (c) 2020 CNRS"].
- **Activity:** last commit **2026-06-30**; releases **4.0.7** (2026-06-30), 4.0.6, 4.0.5, 4.0.4 [V]. Healthy, in the 4.x line.

**Are the community models gated on HuggingFace, and on what terms? — YES, all of them, and the terms are marketing-consent, not licence restrictions.** [V]

| Model | Weights licence | Gated | Gate terms (verbatim from the model card metadata) |
|---|---|---|---|
| `pyannote/speaker-diarization-community-1` (**current 4.x default**) | **CC-BY-4.0** | **yes** (`"gated":"auto"`) | "Your input helps us strengthen the pyannote community and improve our open-source offerings. **This pipeline is released under the CC-BY-4.0 license and will always remain freely accessible.** By providing your details, you agree that we may email you occasionally with important news about pyannote models, invitations to try premium pipelines, and information about specific services designed for researchers and professionals like you." |
| `pyannote/speaker-diarization-3.1` | **MIT** | **yes** | "…Though this pipeline uses MIT license and will always remain open-source, we will occasionnally email you about premium pipelines and paid services around pyannote." Fields collected: **Company/university (text), Website (text)**. |
| `pyannote/segmentation-3.0` | **MIT** | **yes** | Same prompt, "Though this model uses MIT license and will always remain open-source…". Same two fields. |

Every gate renders as: "You need to agree to share your contact information to access this model. This repository is publicly accessible, but you have to accept the conditions to access its files and content." [V]

**Licensing nuance the seed list did not flag [V]:** the 4.x default pipeline moved from **MIT** (3.1) to **CC-BY-4.0** (community-1). CC-BY-4.0 permits commercial use but **requires attribution** — an obligation MIT already implies but which CC states more formally. Do not assume "pyannote = MIT" for 4.x.

**Also note [V, README]:** pyannote-audio has "built-in support for pyannoteAI premium speaker diarization" — `pyannote/speaker-diarization-precision-2` is **a hosted API requiring a pyannoteAI API key and running on pyannoteAI servers**, not local weights. Easy to confuse with the local path; do not.

**Practical local-use viability [I]:**
- ✅ Runs fully locally after download; weights are permissively licensed.
- ⚠️ **The gate breaks unattended installs.** A HuggingFace account + accepted conditions + an access token are required for the *first* fetch. That is incompatible with air-gapped deployment, clean-room CI, and end-user installs unless we mirror the weights ourselves — which CC-BY-4.0/MIT **permit**, provided attribution is preserved. **Mirror-and-vendor is the correct mitigation** and is exactly what Vexa did (vendoring `onnx-community/pyannote-segmentation-3.0` with its LICENSE file) [V] and what Loqui markets as "the default diarizer needs no Hugging Face token" [C].
- ⚠️ 4.x requires `ffmpeg` for `torchcodec` audio decoding [V, README] — an extra native dependency to package.

**Verdict: adopt** — pyannote is the de-facto standard and the licence is clean. **Budget explicitly for a vendored/mirrored weights pipeline** rather than a runtime HF fetch.

### B.2 NVIDIA NeMo diarization (Streaming Sortformer, TitaNet, ECAPA) — **adopt (v2) / spike (v2.1)**

- **Code licence: Apache-2.0** [V — `raw.githubusercontent.com/NVIDIA/NeMo/main/LICENSE`, confirmed header "Apache License Version 2.0, January 2004"].
- **ACCESS LIMITATION:** `github.com/NVIDIA/NeMo/commits/main.atom` and `releases.atom` returned **empty** on my fetch — likely size/rate related. I could not verify NeMo's last-commit date from a primary feed. Treat repo activity as **[U]**; the model cards below are current and were fetched successfully.

**Architecture, from NVIDIA's own docs** [V, `docs.nvidia.com/nemo-framework/.../speaker_diarization/models.html`]:
> Currently NeMo Speech AI supports two types of speaker diarization systems: **End-to-end Speaker Diarization: Sortformer Diarizer** … We offer offline and online versions… **Cascaded (Pipelined) Speaker Diarization: Clustering diarizer with Multi-Scale Diarization Decoder (MSDD)** — the pipeline "involves the use of the **MarbleNet** model for Voice Activity Detection, the **TitaNet** model for speaker embedding extraction, and the Multi-Scale Diarization Decoder."

**Model weights — the licences differ per checkpoint, which is the single most important finding in this section:** [V]

| Model | Weights licence | Gated | Notes |
|---|---|---|---|
| `nvidia/diar_streaming_sortformer_4spk-v2` | **CC-BY-4.0** | **no** (`"gated":false`) | Test **DER 4.88** on ch109 [V, model-index]. **GGUF quantised variants ship** (e.g. `…q8_0.gguf`, ~147 MB) [V]. |
| `nvidia/diar_streaming_sortformer_4spk-v2.1` | **`nvidia-open-model-license`** | no | **Different licence from v2.** Card banner: "A new version of streaming Sortformer **v2.1** has been released, providing **greater robustness for meeting speech**." NOTSOFAR1 eval-sc DER **28.75** (full), **36.76** (5–7 spk) [V]. 306,258 all-time downloads [V]. |
| `nvidia/diar_sortformer_4spk-v1` (offline) | CC-BY-4.0 | no | Original offline Sortformer. |
| `nvidia/speakerverification_en_titanet_large` | **CC-BY-4.0** | **no** | Test DER 6.73 [V]. Trained on VoxCeleb-1/2, Fisher, Switchboard, LibriSpeech, SRE [V]. |
| `nvidia/speakerverification_en_ecapa_tdnn` | — | — | **HTTP 401 — does not exist / not public under that id.** [V — ACCESS LIMITATION] NeMo's ECAPA-TDNN is available as a config/architecture in the toolkit; the *released* NVIDIA speaker-embedding checkpoint is **TitaNet**. If you want a pretrained ECAPA checkpoint, take SpeechBrain's (§B.3), not NVIDIA's. |

**Streaming Sortformer mechanism** [V, model card]: an **Arrival-Order Speaker Cache (AOSC)** stores frame-level acoustic embeddings of previously observed speakers and is filtered each step to retain only high-quality vectors; Sortformer resolves the permutation problem by **arrival-time ordering** of speech segments. Architecture: 17-layer NEST/Fast-Conformer encoder → 18-layer Transformer (hidden 192) → **4 sigmoid outputs per frame** (hence "4spk"). Runs via NeMo, **NeMo-Speech.cpp**, or Riva.

**Practical local-use viability [I]:**
- ✅ Best-in-class licensing for *streaming* diarization: **v2 is CC-BY-4.0 and ungated** — no token, no account, no click-through. This is a materially better packaging story than pyannote.
- ✅ **GGUF variants** and a `NeMo-Speech.cpp` path mean CPU/edge deployment without the full PyTorch+NeMo stack. A **CoreML** community port exists (`FluidInference/diar-streaming-sortformer-coreml`) [C, seen in search results, not fetched].
- ⚠️ **Hard cap of 4 speakers.** The v2.1 NOTSOFAR1 numbers make the degradation explicit: DER **28.75** overall vs **36.76** on 5–7-speaker sessions [V]. For meetings above 4 participants this model is not sufficient alone.
- ⚠️ Installing full NeMo is heavy (`nemo_toolkit[asr]` from git main, plus Cython/ffmpeg/libsndfile) [V, model card install snippet].
- ⚠️ **v2.1's `nvidia-open-model-license` is not CC-BY-4.0.** It generally permits commercial use, but it carries NVIDIA-specific conditions. **Read the actual text before shipping v2.1**; v2 (CC-BY-4.0) is the safer default. **[I]**

**Verdict: adopt v2** for streaming diarization and **TitaNet** for enrolment embeddings. **Spike v2.1** for meeting robustness, gated on a licence read.

### B.3 SpeechBrain ECAPA — **adopt**

- **Code licence: Apache-2.0** [V].
- **Weights: `speechbrain/spkrec-ecapa-voxceleb` is `license: apache-2.0`, `"gated":false`** [V]. 341 likes. Trained on VoxCeleb; paper arXiv:2106.04624 [V].
- **Activity: last commit 2026-03-30; release v1.1.0 (2026-03-30)** [V]. ~5 months idle — slower than pyannote or NeMo, but a stable 1.x line, not abandonment. **[I]**

**Verdict: adopt.** This is the **least-encumbered speaker-embedding option in the entire survey** — Apache-2.0 on both code *and* weights, no gate, no attribution-clause ambiguity, no click-through. If we need one speaker-embedding model we can vendor without a lawyer in the room, it is this one. Its DER/EER is below current SOTA (WavLM-based systems beat it), so treat it as the safe baseline and benchmark TitaNet / 3D-Speaker CAM++ against it.

### B.4 k2-fsa/sherpa-onnx — **adopt (runtime); audit each model bundle separately**

- **LICENSE file checked as instructed: `master/LICENSE` is the Apache License, Version 2.0** (11,358 bytes, standard text) [V]. Note the default branch is **`master`**, not `main` — `main` 404s.
- **Activity: last commit 2026-08-24 (today); releases v1.13.6 (2026-08-18), v1.13.5 (2026-08-11)** [V]. Very healthy.
- **Breadth** [V, README]: speech recognition, TTS, source separation, **speaker identification, speaker diarization, speaker verification**, spoken-language ID, audio tagging, VAD, keyword spotting, punctuation, speech enhancement. Platforms: Android, iOS, Windows, macOS, Linux, **HarmonyOS**; x64/x86/arm64/arm32/riscv64; **WebAssembly**. **12 language bindings** (C++, C, Python, JS, Java, C#, Kotlin, Swift, Go, Dart, Rust, Pascal). NPU backends: Rockchip RKNN, **Qualcomm QNN**, Ascend, Axera.

**The critical caveat [V, `k2-fsa.github.io/sherpa/onnx/speaker-diarization/`]:** the **Apache-2.0 licence covers the runtime, not the models**. Diarization models are downloaded from separate release tags:
- segmentation: `github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-segmentation-models`
- embeddings: `.../releases/tag/speaker-recongition-models` *(sic — the upstream tag is misspelled; use it verbatim)*

Documented bundles include **`sherpa-onnx-pyannote-segmentation-3-0`** (→ inherits pyannote's MIT) and **`sherpa-onnx-reverb-diarization-v1`** (→ inherits **Rev's** terms, see below), each combinable with **3D-Speaker** or **NeMo** embedding models [V].

**⚠️ Specific trap [I]:** `sherpa-onnx-reverb-diarization-v1` is a repackaging of Rev's Reverb diarization weights. On HuggingFace, `Revai/reverb-diarization-v2` is tagged **`license:other`** and is **gated** ("You need to agree to share your contact information… Log in or Sign Up to review the conditions") [V]. I could not read the actual licence text without logging in — **ACCESS LIMITATION**, and Phase-0A forbids logging in. **Do not ship the reverb bundle until someone reads Rev's licence.** Rev's diarization weights are widely reported as non-commercial; I did **not** verify that [U]. The code repo `revdotcom/reverb` is Apache-2.0 [V] — **which tells you nothing about the weights.**

**Verdict: adopt the runtime.** It is the best cross-platform, cross-language, NPU-capable inference substrate available under a clean licence, and it is the natural way to ship diarization on mobile/edge. **Every model bundle needs its own licence review**, and the reverb bundle is a live risk.

### B.5 ASVspoof — current state for replay + deepfake evaluation — **learn-only** (with a significant correction)

**Current state [V, `asvspoof.org` + arXiv]:** the most recent edition is **ASVspoof 5** (2024). The official site's front page still leads with ASVspoof 5, the Phase-2 evaluation plan, and the ASVspoof Workshop 2024 (Interspeech 2024 satellite, 31 Aug 2024). The published schedule ends at that workshop. **No ASVspoof 6 is announced anywhere on the official site as of 2026-08-24** [V].

**⚠️ MAJOR CORRECTION — ASVspoof 5 has no replay / physical-access track.** The seed frames ASVspoof as the venue for "replay+deepfake evaluation". That is **half wrong for edition 5.** [V, arXiv:2502.08857v2 §2.7]:
> "The ASVspoof 5 database was designed to support two different tasks which form a pair of challenge Tracks… **Track 1 is a spoof/deepfake detection task** and concerns the design of CM systems… **Track 2 involves the design of SASV systems** [spoofing-robust automatic speaker verification]."

Replay is explicitly framed as *prior* editions' territory [V, same paper]: "The **ASVspoof 2017** and **2019 Physical Access** databases, which contain data collected from 42 and 106 speakers respectively, **focus on replay spoofing attacks**." ASVspoof 5's novelty is **crowdsourced non-studio speech (~2,000 speakers), 32 TTS/VC attacks, and — for the first time — adversarial attacks** [V, arXiv:2408.08739 abstract], plus neural codec/compression conditions.

**Practical consequence for us [I]:** for a **replay** (loudspeaker-in-the-room) threat model — which is the realistic attack on a meeting/wearable capture device — you must go back to **ASVspoof 2017**, **ASVspoof 2019 PA**, or **ASVspoof 2021 PA**. ASVspoof 5 covers synthetic/converted/adversarial speech only. Planning "ASVspoof 5 for replay+deepfake" would silently leave the replay half unevaluated.

**Licensing / availability [V unless noted]:**
- The design paper states: "With the exception of protocols and tools for the generation of spoofed/deepfake speech, the resources described in this paper… **are now all freely available to the community.**" And: "the generation protocols and access to surrogate systems are **available only upon request**" — deliberately withheld on misuse grounds.
- ASVspoof 5 database DOI: `10.5281/zenodo.14498691`. **ACCESS LIMITATION: Zenodo returned HTTP 403** ("Access to this resource has been restricted due to unusual traffic from your network") on my fetch — I could **not** read the dataset licence field directly. Search results report **ODC-By** for the ASVspoof 5 dataset **[C — not verified, must be confirmed on the Zenodo record before any use]**.
- Older editions are distributed via **Edinburgh DataShare** (`datashare.ed.ac.uk`, handle 10283/3336 now redirects to an item UUID [V]) and the site's own Licence page [V, `asvspoof.org/database`: "To download it, please visit our Licence page."]. Historically these carry **ODC-By / CC-BY-style research terms with per-database variation** — **[U] for the exact current text; must be read per database.**
- The papers themselves are **CC BY-NC-ND 4.0** on arXiv [V] — non-commercial, no-derivatives. That constrains *quoting/redistributing the paper*, not implementing the method.

**Verdict: learn-only.** ASVspoof is the right *evaluation vocabulary* (EER, min t-DCF, the newer SASV metrics) and the right benchmark to report against. It is not a component. Concretely: if we ever claim anti-spoofing, we should report on **ASVspoof 2019 PA + 2021 PA** (replay) **and** **ASVspoof 5 Track 1** (deepfake), and say so explicitly — because those are two different corpora answering two different questions. **[I]**

**Open-source countermeasure implementations worth knowing** [V, licences checked]:
- `clovaai/aasist` — AASIST (spectro-temporal graph attention). 292★. Licence is a **NAVER-modified permissive text** ("Copyright (c) 2021-present NAVER Corp. Permission is hereby granted, free of charge…") — MIT-shaped but **not verbatim MIT; read it** [V].
- `TakHemlata/SSL_Anti-spoofing` — **MIT**, 179★, the wav2vec2-SSL front-end baseline widely used in ASVspoof literature [V].

---

## 5. Stronger current alternatives the seed list missed

Verified 2026-08-24: licence via `raw.githubusercontent.com`, stars via repo HTML, last commit via `commits/<branch>.atom`.

### Part A — meeting / voice capture

| # | Project | Licence | Stars | Last commit | Why it beats a seed entry |
|---|---|---|---|---|---|
| 1 | **cjpais/Handy** | **MIT** [V] | **30,220** [V] | **2026-08-24** [V] | "Free, open source, and extensible speech-to-text application that works **completely offline**" [V]. **Larger than every seed repo** and permissively licensed. The obvious base for the dictation lane instead of anything GPL. |
| 2 | **Beingpax/VoiceInk** | **GPL-3.0** [V] | **6,081** [V] | **2026-08-22** [V] | "The best open-source alternative to Superwhisper & Wispr Flow… macOS, no subscription" [V]. Direct Wispr Flow comparable. **GPL-3.0 → learn-only for a proprietary product**, but the single best UX reference in the category. |
| 3 | **attendee-labs/attendee** | **Elastic License 2.0 (ELv2)** [V] | 713 [V] | **2026-08-23** [V] | "The universal Meeting Bot API" [V] — the direct Vexa competitor. **ELv2 is not OSI-approved**: it bars providing the software as a hosted/managed service and bars circumventing licence keys. Fine to self-host internally, **not** fine to resell as a service. **spike / reject-if-SaaS.** |
| 4 | **collabora/WhisperLive** | **MIT** [V] | 4,237 [V] | **2026-08-04** [V] | "A nearly-live implementation of OpenAI's Whisper" [V] — the mature MIT streaming-ASR server the seed list lacks entirely (every seed either batches or wraps a vendor API). **adopt/compose.** |
| 5 | **Blueturboguy07/cue** | GPL-3.0 [V] | 1,229 [V] | **2026-08-10** [V] | The real upstream of seed #6. **reject as code (GPL-3.0)**, but **cite as evidence** — its README is the honest technical account of why screen-share invisibility is not durable on macOS 15.4+. |

### Part B — diarization / speaker ID / anti-spoofing

| # | Project | Licence | Stars | Last commit | Why it matters |
|---|---|---|---|---|---|
| 1 | **BUTSpeechFIT/DiariZen** | **MIT** [V] | 528 [V] | **2026-08-04** [V] | "A toolkit for speaker diarization" from BUT Speech@FIT — the WavLM-based line that currently posts better DER than pyannote 3.x on standard benchmarks. **MIT + active. spike** — the strongest accuracy-upside candidate in this table. |
| 2 | **modelscope/3D-Speaker** | **Apache-2.0** [V] | 3,115 [V] | 2025-12-08 [V] | "Single- and Multi-modal Speaker Verification, Speaker Recognition and Speaker Diarization" [V]. Home of **CAM++ / ERes2Net**, and already one of sherpa-onnx's two supported embedding families [V]. **adopt** as the Apache-2.0 alternative to TitaNet's CC-BY. ~8 months idle — watch. |
| 3 | **wenet-e2e/wespeaker** | **Apache-2.0** [V] | 1,388 [V] | **2026-07-08** [V] | "Research and Production Oriented Speaker Verification, Recognition and Diarization Toolkit" [V]. Production-oriented ONNX export path; the natural companion to sherpa-onnx. **compose.** |
| 4 | **narcotic-sh/senko** | **MIT** [V] | 291 [V] | 2026-06-11 [V] | "Very fast, accurate speaker diarization" [V]. Small, MIT, speed-focused — the right shape for on-device real-time where Sortformer's 4-speaker cap or NeMo's install weight is a problem. **spike.** |
| 5 | **TakHemlata/SSL_Anti-spoofing** + **clovaai/aasist** | MIT [V] / NAVER-permissive [V] | 179 / 292 [V] | — | The two reference countermeasure implementations for ASVspoof-style evaluation. The seed list named a *challenge* but no *implementation*. **learn-only → spike** if anti-spoofing becomes a requirement. |

---

## 6. Corrections to seed claims — consolidated

| # | Seed said | Reality [V] |
|---|---|---|
| 1 | NeoSapien "Bring Neo 1 Memories to Any AI" — mechanism unknown | It is **MCP**. Proven by the vendor's own HTML comment `Card F: … (MCP)` and asset `mcp-any-ai.webp`. **But no public docs, no schema, no connector guide, no `/mcp` page, no docs subdomain.** |
| 2 | `fastrepl/anarlog` = Hyprnote | **Repo renamed.** `fastrepl/hyprnote` **301s to** `fastrepl/anarlog`; product/site/docs/socials all renamed to Anarlog. Team has moved on to a new product, `char.com`. |
| 3 | Hyprnote: "community app MIT, enterprise components separately licensed" | **VERIFIED.** `LICENSE`=MIT, `LICENSE.enterprise`="Anarlog Enterprise Commercial License Notice", `LICENSING.md` documents path-based mixed licensing with **CI-enforced** dependency direction. |
| 4 | Loqui — "verify it exists at all" | **It exists.** `joaquingit1/loqui`, MIT, 3★, v0.1.0 (2026-06-27), macOS Apple Silicon only. |
| 5 | Screenpipe: "source-available, unsuitable for commercial reuse" | **CONFIRMED and stricter than stated** — 7-day eval cap, paid licence for all commercial use, §5 bans embedding into a customer product, §6 claims ownership of *your* modifications. Also: org renamed `mediar-ai/screenpipe` → **`screenpipe/screenpipe`**. |
| 6 | `RageTony4/cue-cluely-alternative` | **Wrong repo.** 0★ fork; upstream is **`Blueturboguy07/cue`** (1,229★, GPL-3.0, releases through 0.2.2). |
| 7 | Meetily "speaker diarization" (per repo tagline) | **Diarization is PRO-only.** Vendor's own table: Community = **No**, Pro = **Yes** at **$10/user/mo annual** ($25/mo regular), licence "Commercial". Repo also renamed from `meeting-minutes`. |
| 8 | `fathom.video` | **301s to `www.fathom.ai`** — rebranded. |
| 9 | ParakeetAI at `parakeetai.com` | Official domain is **`parakeet-ai.com`**. `parakeetai.com` / `parakeet.ai` **time out**. Pricing is **sign-in-gated** — not verifiable under Phase-0A rules. |
| 10 | Amurex as a live comparable | **Dormant since 2025-05-27** (last release 2025-03-20) and **AGPL-3.0**. |
| 11 | pyannote community models "gated — on what terms?" | **All three gated** (`community-1`, `3.1`, `segmentation-3.0`). Terms are **contact-info + marketing-email consent**, *not* a licence restriction. Fields: Company/university, Website. |
| 12 | pyannote ≈ MIT | **4.x default `community-1` is CC-BY-4.0**, not MIT. Only the older 3.1 / segmentation-3.0 are MIT. |
| 13 | NeMo "Streaming Sortformer" as one thing | **Two checkpoints with two different weights licences.** v2 = **CC-BY-4.0**; **v2.1 = `nvidia-open-model-license`**. Both ungated. |
| 14 | NVIDIA ECAPA checkpoint | `nvidia/speakerverification_en_ecapa_tdnn` returns **HTTP 401 / not public**. NVIDIA's released speaker-embedding checkpoint is **TitaNet**. Use SpeechBrain for a pretrained ECAPA. |
| 15 | ASVspoof for "replay + deepfake" evaluation | **ASVspoof 5 has no replay/PA track** — only Track 1 (deepfake CM) and Track 2 (SASV). Replay lives in **ASVspoof 2017 / 2019 PA / 2021 PA**. No edition 6 announced. |
| 16 | sherpa-onnx licence | **Apache-2.0 on `master`** (not `main` — `main` 404s). **Models are separately licensed**; the bundled `reverb-diarization-v1` inherits Rev's **gated `license:other`** terms. |

---

## 7. ACCESS LIMITATIONS (explicit)

| Resource | Result | Impact |
|---|---|---|
| `https://zenodo.org/records/14498691` (ASVspoof 5 DB) | **HTTP 403** — "restricted due to unusual traffic from your network" | Could **not** verify the ASVspoof 5 dataset licence directly. ODC-By is **[C]**, from search results only. Must be confirmed on the record. |
| `https://huggingface.co/Revai/reverb-diarization-v2` | 200 but **gated** — "Log in or Sign Up to review the conditions" | Could not read Rev's weights licence text (tagged `license:other`). Logging in is forbidden under Phase-0A. **Blocks clearance of the sherpa-onnx reverb bundle.** |
| `https://parakeetai.com/`, `www.parakeetai.com`, `parakeet.ai` | **curl exit 28 — connection timed out** (3 attempts) | Wrong/dead domains. Correct host is `parakeet-ai.com`. |
| `https://parakeet-ai.com/#pricing` | 200, but tier **names only**, no prices in static HTML | ParakeetAI pricing **unverified**; third-party figures are mutually inconsistent. |
| `https://github.com/NVIDIA/NeMo/commits/main.atom` and `/releases.atom` | **empty response** | NeMo repo activity/last-release **unverified [U]**. Model cards fetched fine. |
| `https://docs.neosapien.ai/` | **DNS: could not resolve host** | Confirms no NeoSapien developer documentation site exists. |
| `https://neosapien.ai/mcp`, `/memories`, `/sitemap.xml` | **404** | Confirms no public MCP/connector/export documentation. |
| `https://huggingface.co/nvidia/speakerverification_en_ecapa_tdnn` | **HTTP 401** | Model id does not exist publicly. |
| `raw.githubusercontent.com/Devleed/meeting-copilot/{main,master}/{LICENSE,LICENSE.md,LICENSE.txt,COPYING}` | **404 on all 8** | No licence → all rights reserved. |
| WebFetch / WebSearch / Bash, first ~2 minutes of session | classifier rate-limited (`claude-sonnet-5[1m] temporarily unavailable`) | Mitigated by switching to plain `curl` GETs. No data lost. |
| GitHub REST API (`api.github.com`) | **not used at all** | Per instructions, avoided entirely in favour of `github.com` HTML, `raw.githubusercontent.com`, and `.atom` feeds. **No 403/429 encountered** because no API calls were made. |

**Not attempted, by rule:** no logins, no paywall/robots/CAPTCHA bypass, no cloning or executing any repository, no software installed, no contact with any person or vendor, no purchases, no domain/handle/account registration. The NeoSapien MCP connector present in this session was **not invoked** — its tool names are reported from the session's own connector registry metadata, and no user memory data was read.

---

## 8. Exact queries and fetches run

### WebSearch queries (verbatim)
1. `Cluely undetectability page claims platform caveats screen share`
2. `NeoSapien "Neo 1" memories "any AI" MCP connector export`
3. `NeoSapien Neo 1 "Bring" memories "any AI" MCP server documentation`
4. `ASVspoof 5 challenge 2026 database license deepfake replay evaluation current status`
5. `ASVspoof 5 database Zenodo license CC BY-NC-ND download 2024 no physical access replay track`
6. `NVIDIA NeMo Streaming Sortformer diarization 2026 real-time low latency speaker cache release`
7. `ParakeetAI parakeet.ai interview meeting copilot pricing 2026`
8. `"Parakeet AI" official pricing plans per month interview copilot site:parakeetai.com OR parakeet ai pricing page`

### WebFetch attempts
- `https://neosapien.ai/` — rate-limited, retried via curl
- `https://neosapien.ai/desktop` — rate-limited, retried via curl
- `https://parakeetai.com/pricing` — failed (host times out)

### Direct HTTP GETs (curl, all 2026-08-24)

**NeoSapien:** `neosapien.ai/`, `/desktop`, `/policies`, `/terms`, `/shop`, `/shop/ai-personal-assistant/`, `/mcp` (404), `/memories` (404), `/robots.txt`, `/sitemap.xml` (404), `/sitemap-index.xml`, `/llms.txt`, `/llms-full.txt`; `docs.neosapien.ai/` (NXDOMAIN)

**GitHub repo pages:** `OpenWhispr/openwhispr`, `Zackriya-Solutions/meetily`, `fastrepl/anarlog`, `fastrepl/hyprnote`, `thewh1teagle/vibe`, `Devleed/meeting-copilot`, `RageTony4/cue-cluely-alternative`, `joaquingit1/loqui`, `thepersonalaicompany/amurex`, `Vexa-ai/vexa`, `mediar-ai/screenpipe`, `NeoAIResearch/neo-mcp`, `Blueturboguy07/cue`, `attendee-labs/attendee`, `Beingpax/VoiceInk`, `cjpais/Handy`, `modelscope/3D-Speaker`, `wenet-e2e/wespeaker`, `BUTSpeechFIT/DiariZen`, `narcotic-sh/senko`, `collabora/WhisperLive`, `revdotcom/reverb`, `clovaai/aasist`, `TakHemlata/SSL_Anti-spoofing`, `fastrepl/owhisper` (404), `Vexa-ai/vexa/tree/main/licenses`

**LICENSE files** (`raw.githubusercontent.com/<repo>/{main,master}/{LICENSE,LICENSE.md,LICENSE.txt,COPYING}`) for every repo above, plus `pyannote/pyannote-audio`, `k2-fsa/sherpa-onnx`, `NVIDIA/NeMo`, `speechbrain/speechbrain`; plus `fastrepl/anarlog/main/LICENSING.md` and `/LICENSE.enterprise`

**READMEs:** `fastrepl/anarlog`, `OpenWhispr/openwhispr`, `Zackriya-Solutions/meetily`, `thewh1teagle/vibe`, `Devleed/meeting-copilot`, `RageTony4/cue-cluely-alternative`, `joaquingit1/loqui`, `Vexa-ai/vexa`, `NeoAIResearch/neo-mcp`, `thepersonalaicompany/amurex`, `k2-fsa/sherpa-onnx`, `pyannote/pyannote-audio`

**Atom feeds** (`/commits/<branch>.atom` and `/releases.atom`) for all seed repos + all alternatives

**HuggingFace model cards:** `pyannote/speaker-diarization-3.1`, `pyannote/segmentation-3.0`, `pyannote/speaker-diarization-community-1`, `pyannote/segmentation`, `nvidia/diar_streaming_sortformer_4spk-v2`, `nvidia/diar_streaming_sortformer_4spk-v2.1`, `nvidia/diar_sortformer_4spk-v1`, `nvidia/speakerverification_en_titanet_large`, `nvidia/speakerverification_en_ecapa_tdnn` (401), `speechbrain/spkrec-ecapa-voxceleb`, `Revai/reverb-diarization-v2` (gated)

**ASVspoof:** `asvspoof.org/`, `/database`, `/index2021.html`, `/database2021` (404); `datashare.ed.ac.uk/handle/10283/3336`; `zenodo.org/records/14498691` (403); `arxiv.org/abs/2408.08739`; `arxiv.org/html/2502.08857v2`

**Docs:** `docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/models.html`; `k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html`

**Commercial:** `cluely.com/undetectability`, `cluely.com/pricing`, `docs.cluely.com/feature/undectability` (→ `/undetectability`), `granola.ai/pricing`, `otter.ai/pricing`, `fireflies.ai/pricing`, `fathom.video/pricing` (→ `www.fathom.ai/pricing`), `krisp.ai/pricing/`, `wisprflow.ai/pricing`, `parakeetai.com/` (timeout), `www.parakeetai.com/` (timeout), `parakeet.ai/` (timeout), `parakeet-ai.com/` (→ `www.parakeet-ai.com`), `parakeet-ai.com/pricing`, `meetily.ai/pro/`
