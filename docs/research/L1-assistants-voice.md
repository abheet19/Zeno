# L1 — Assistants + Voice Stack + Control/Transport: Seed Revalidation

Access date for ALL claims below: **2026-08-24**. Method: unauthenticated GitHub API (curl, first 12 repos before the 60/hr anonymous rate limit was hit), then WebFetch of github.com pages + WebSearch. Read-only; nothing cloned, installed, or executed.

Verdict legend — **verified** (primary source fetched, URL given), **inferred** (strong indirect evidence / well-known fact not re-fetched today), **unknown** (could not confirm).

---

## 1. Assistant projects

### isair/jarvis — https://github.com/isair/jarvis
- Activity: pushed 2026-08-17; created 2025-08-19; 1,647 stars; not archived. **verified** (API, 2026-08-24)
- License: custom ("NOASSERTION") — "Personal use: Free forever. Commercial use: Contact us." **verified** (repo page)
- Capabilities: offline voice assistant; wake word, knowledge-graph memory, MCP servers, dictation, Home Assistant, health tracking. Stack: Whisper STT, Piper/Chatterbox TTS, Ollama LLMs. Prebuilt binaries for Win/macOS/Linux. **verified**
- **CLAIM [pynput dictation disabled on macOS 26+ per issue #172]: CONFIRMED.** Issue #172 "Dictation support on macOS 26+ (Tahoe)", opened 2026-04-10, OPEN. pynput keyboard listener on a background thread triggers TSM calls → EXC_BREAKPOINT/SIGTRAP crash; dictation is disabled via version guard in `dictation_engine.py:start()`; maintainer proposes subprocess isolation (helper process with pynput on its main thread). **verified** (https://github.com/isair/jarvis/issues/172)
- Recommendation: **learn-only** — the most mature indie "Jarvis" and a great architecture reference, but the non-OSS commercial-contact license blocks reuse; steal the macOS-26 subprocess-isolation lesson.

### ethanplusai/jarvis — https://github.com/ethanplusai/jarvis
- Activity: pushed 2026-05-15; created 2026-03-26; 702 stars. **verified** (API)
- License: custom — "Free for personal, non-commercial use. Commercial use requires a license — visit ethanplus.ai." **verified** (repo page)
- Capabilities: macOS voice assistant; AppleScript control of Calendar/Mail/Notes, Claude Code sessions, Three.js visualization. Cloud-dependent: Claude API + Fish Audio TTS. **verified**
- **CLAIM [personal/non-commercial license]: CONFIRMED.**
- Recommendation: **reject** (learn-only at most) — non-commercial license + cloud STT/TTS conflicts with a local-first suite.

### modelscope/ultron — https://github.com/modelscope/ultron
- Activity: pushed 2026-07-02; created 2026-04-09; 171 stars; Apache-2.0. **verified** (API)
- Description (verbatim): "Ultron: Collective Intelligence System — Shared Memories, Skills, and Harnesses Across Every Agent."
- **CLAIM [collective memory/skills/harness research]: CONFIRMED** by the repo's own description. **verified**
- Recommendation: **learn-only** — Apache-2.0 research framing worth mining for the memory/skills abstraction; too young (171 stars, 3 months of commits) to build on.

### battlesbudz/jarvis-os — https://github.com/battlesbudz/jarvis-os
- Activity: pushed 2026-08-24 (today); created 2026-05-01; **2 stars**; MIT. Desc: autonomous personal assistant for productivity / executive-function coaching / multi-channel. **verified** (API)
- No PRD claim attached. Maturity: hobby-stage, no adoption. Security posture unknown.
- Recommendation: **reject** — active but undifferentiated 2-star personal project.

### jamesplotts/Mark-XLVIII — https://github.com/jamesplotts/Mark-XLVIII
- Activity: pushed 2026-07-12; created 2026-07-12 (single-day push of 25 commits); 0 stars; GitHub detects **no LICENSE file** (API lic:None). **verified** (API)
- README states: "Personal and non-commercial use only. Licensed under Creative Commons BY-NC 4.0." Python, PyQt6 UI, Ollama/llama.cpp local LLMs, speech-to-speech server; fork of an upstream project. **verified** (repo page)
- **CLAIM [non-commercial license]: CONFIRMED** (README declares CC BY-NC 4.0). Nuance: no LICENSE file is committed, and CC BY-NC is not an OSI code license — legally this is closer to "all rights reserved with an informal NC grant."
- Recommendation: **reject** — NC terms, 0 stars, fork provenance unclear.

### settylokesh/ORB — https://github.com/settylokesh/ORB
- Activity: pushed 2026-07-04; created 2026-06-20; 1 star; API lic:None. **verified** (API)
- README (verbatim): "This project does not yet specify an open-source license. Until a `LICENSE` file is added, all rights are reserved by the author." **verified** (repo page)
- **CLAIM [no open-source license, all rights reserved]: CONFIRMED.**
- Capabilities: macOS menu-bar voice agent — Moonshine Base STT via ONNX Runtime (streaming partials), Gemma E4B 4-bit on Apple MLX for screen-vision planning, confirmation gating, 100% on-device. 27 commits, no releases — prototype. **verified**
- Recommendation: **learn-only** — unusable legally, but the Moonshine+MLX+confirmation-gate pattern is exactly the right shape for a local macOS agent.

### porokka/jarvis-os — https://github.com/porokka/jarvis-os
- Activity: pushed 2026-08-11; created 2026-04-06; 19 stars; **MIT**; 201 commits. **verified** (API + page)
- **CLAIM [memory router, skills, approvals, HUD, n8n, Windows/WSL/NVIDIA assumptions]: CONFIRMED on all six points.** README shows: 4-pass classifier memory/route router; 35+ plug-and-play skills; staging/dev → tested → approved human-approval pipeline; Next.js "Stark Industries HUD"; bidirectional n8n (trigger + webhook back to `/api/events`); explicitly "Windows 11 + WSL2 (recommended)" and "NVIDIA GPU with CUDA (tested on RTX 3090 24GB)". **verified**
- Recommendation: **learn-only** — MIT and architecturally rich (approvals pipeline + memory router are the interesting bits), but its Windows/WSL2/CUDA assumptions clash with a macOS-first suite and it has 19 stars.

### Matanvil/jarvis — https://github.com/Matanvil/jarvis
- Activity: pushed 2026-07-06; created 2026-03-09; 1 star; MIT. "Local-first AI voice assistant for macOS." **verified** (API)
- Recommendation: **reject** — early scaffold, no adoption, nothing not covered by stronger seeds.

### Home Assistant Assist + Wyoming — https://github.com/OHF-Voice/wyoming
- Wyoming: MIT; pushed 2026-07-23; created 2023-09; 391 stars; "Peer-to-peer protocol for voice assistants." **verified** (API)
- Context (inferred, well-documented ecosystem): Wyoming is the Open Home Foundation's transport connecting HA Assist to STT/TTS/wake services (whisper.cpp/faster-whisper wrappers, Piper, openWakeWord, microWakeWord satellites, ESPHome Voice PE hardware). Largest production local-voice ecosystem today.
- Recommendation: **adopt/compose** — the strongest maintained backbone for local voice; even standalone, the Wyoming protocol is a sane integration seam.

### OpenVoiceOS — https://github.com/OpenVoiceOS/ovos-core
- Apache-2.0; pushed 2026-08-17; 284 stars; active. Mycroft successor, modular FOSS voice-assistant platform. **verified** (API)
- Recommendation: **spike** — permissive and modular, but far smaller community than HA voice; evaluate only if HA Assist proves too smart-home-centric.

### Leon — https://github.com/leon-ai/leon
- MIT; pushed 2026-08-24; 17,456 stars; created 2019. **verified** (API)
- Maturity caution (inferred from project history): years of headline stars but repeated core rewrites and no stable "1.0 with rich skill ecosystem"; star count overstates practical maturity.
- Recommendation: **learn-only** — track, don't build on.

### JonathanRReed/Apple-MCPs — https://github.com/JonathanRReed/Apple-MCPs
- MIT; pushed 2026-08-21; created 2026-03-28; 11 stars. MCP servers for macOS apps (Mail, Calendar, Reminders, …). **verified** (API)
- Recommendation: **spike** — right idea (MCP seam to Apple apps), tiny adoption; compare against writing thin AppleScript/JXA MCP servers in-house before depending on it.

---

## 2. Voice stack

### whisper.cpp — https://github.com/ggml-org/whisper.cpp
- MIT; 53.1k stars; very active (4,991 commits; repo home is ggml-org — seed owner correct). **verified** (page)
- Latest releases: v1.9.3 (pre-release), v1.9.2, v1.9.1. The fetch summarizer reported these as 2024 dates, which is inconsistent with repo state; actual dates are almost certainly 2026-08-20 / 2026-08-04 / 2026-06-19 (GitHub relative dates misparsed). Tag names **verified**; exact dates **inferred**.
- Recommendation: **adopt** — the default local STT engine for Apple Silicon/CPU.

### faster-whisper — https://github.com/SYSTRAN/faster-whisper
- MIT; 25.1k stars; maintained but slower cadence (263 commits total). Latest release v1.2.1; summarizer said "Oct 31 2024" but version history (v1.2.0 added distil-large-v3.5, a 2025 model) puts v1.2.1 at 2025-10-31. Tag **verified**; date **inferred**. No 2026 release observed → maintenance-mode cadence.
- Recommendation: **adopt** for server-side/Python batch STT; prefer whisper.cpp or Argmax on-device.

### Argmax open-source Swift stack — **CORRECTION on seed naming**
- The seed's "WhisperKit/argmax-oss-swift" has the wrong owner: the org is **argmaxinc**. Current home: **https://github.com/argmaxinc/argmax-oss-swift** ("Argmax Open-Source SDK Swift", 6.3k stars, **MIT**), a monorepo of three frameworks: **WhisperKit** (STT), **TTSKit** (TTS — notably built on Qwen-TTS), **SpeakerKit** (Pyannote diarization). github.com/argmaxinc/WhisperKit serves the same content (fetched both URLs; same 6.3k-star repo — rename with redirect **inferred**, both URLs live **verified**).
- Commercial split: separate paid "Argmax Pro SDK" (real-time + speakers, custom vocab, local server, Android). OSS core stays MIT. **verified**
- Recommendation: **adopt** for Apple-native builds — MIT STT+TTS+diarization in one Swift package is the strongest on-device Apple stack found.

### Kokoro TTS — https://github.com/hexgrad/kokoro
- Apache-2.0 code, 8.5k stars, active. **CLAIM [weights license]: weights are Apache-2.0 too** — README: "With Apache-licensed weights, Kokoro can be deployed anywhere"; weights at huggingface.co/hexgrad/Kokoro-82M. **verified** (repo page; HF page not separately fetched — HF-side license field **inferred**)
- Recommendation: **adopt** — 82M params, CPU-viable, commercially safe.

### Qwen3-TTS — **CORRECTION: the PRD's doubt is refuted; repo exists**
- **CLAIM [does QwenLM/Qwen3-TTS exist?]: YES.** https://github.com/QwenLM/Qwen3-TTS is live: **Apache-2.0**, 13.1k stars, open-sourced **2026-01-22** as the Qwen3-TTS series (0.6B/1.7B on Qwen3-TTS-Tokenizer-12Hz; base, custom-voice, voice-design variants; 10 languages; voice cloning). **Model weights are Apache-2.0** on HF/ModelScope. **verified** (repo page)
- Context (inferred): before Jan 2026, "Qwen3-TTS(-Flash)" was API-only via Alibaba Cloud — likely what the PRD remembered.
- Recommendation: **spike → likely adopt** — Apache weights + cloning + streaming makes it the main Kokoro challenger; test latency/footprint on target hardware.

### openWakeWord — https://github.com/dscripka/openWakeWord
- Code: **Apache-2.0**; 2.7k stars. **CLAIM [pretrained weights have non-commercial concerns]: CONFIRMED** — README: "All of the included pre-trained models are licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license due to the inclusion of datasets with unknown or restrictive licensing as part of the training data." So: code commercial-OK, bundled models NOT. Training your own models with its synthetic-data pipeline avoids the restriction (subject to your training data). **verified**
- Recommendation: **compose with caution** — use the framework, but train custom wake models (or use microWakeWord) for anything commercial.

---

## 3. Control / transport

| Project | License | Activity (2026-08-24) | Note | Rec |
|---|---|---|---|---|
| browser-use/browser-use | MIT **(v)** | 110.3k stars, 10k commits, very active **(v)** | Docs + cloud product; #1 on Odysseys leaderboard (page claim) | **adopt** for browser control |
| OpenAdaptAI/OpenAdapt | MIT **(v)** | 1.7k stars, 1,142 commits; low PR volume **(v)** | Pivoted to compiling demonstrated GUI workflows into deterministic local programs | **learn-only** — interesting determinism angle, weak traction |
| bytedance/UI-TARS-desktop | Apache-2.0 **(v)** | 38.7k stars, active; last tagged release v0.3.0 (2025-11-05) per releases summary **(v)** | Two products in one repo: Agent TARS (agent stack) + UI-TARS Desktop (GUI automation). Weights: UI-TARS-1.5-7B on HF ByteDance-Seed is **Apache-2.0** (search-verified); larger 32B/72B are application-gated **(i)** | **spike** — best open GUI-agent model line, but ByteDance dependency + desktop app scope creep |
| livekit/agents | Apache-2.0 **(v)** | 13.2k stars, 3,858 commits, active **(v)** | Realtime voice-agent framework; mix-and-match STT/LLM/TTS; telephony | **adopt** if a realtime voice pipeline is needed beyond Wyoming |
| livekit/sip | Apache-2.0 **(v)** | 458 stars, 555 commits, active **(v)** | SIP↔WebRTC bridge into LiveKit rooms | **compose** only if phone calls are in scope |
| tailscale/tailscale | BSD-3-Clause **(v)** | 35.5k stars, 11,187 commits **(v)** | Client/daemon OSS; GUI wrappers + coordination server proprietary | **adopt** for device mesh |
| juanfont/headscale | BSD-3-Clause **(v)** | 43.1k stars, active; explicitly "not associated with Tailscale Inc." (one maintainer works there) **(v)** | Self-hosted control server, single-tailnet scope | **compose** if fully self-hosted control is a requirement; else Tailscale SaaS |
| nats-io/nats-server | Apache-2.0 **(v)** | 20.6k stars, 13k commits; CNCF; Trail of Bits audit Apr 2025 (OSTIF) **(v)** | 2025 Synadia/CNCF trademark dispute resolved, stays Apache under CNCF **(i)** | **adopt** as inter-device message bus |
| cedar-policy/cedar | Apache-2.0 **(v)** | 1.7k stars, active; AWS-maintained; nightly security audits **(v)** | Rust; fine-grained app authz; verification-oriented design | **spike** — strongest fit for per-tool/per-agent permission policies |
| open-policy-agent/opa | Apache-2.0 **(v)** | 12.2k stars, active; **CNCF graduated**; Cure53 audit **(v)** | General-purpose Rego policy engine | **adopt-or-cedar** — pick ONE policy engine; OPA for breadth/maturity, Cedar for typed authz. Don't run both |

**(v)** = verified via fetched page today; **(i)** = inferred.

---

## 4. Strongest 2026-current local STT/TTS/VAD/wake alternatives beyond the seeds

- **STT**: NVIDIA **Parakeet TDT** (fastest high-quality open ASR, ~3.4% WER CV-English, weights CC-BY-4.0; 25 European langs only) and **Canary-Qwen 2.5B** (top English WER) — verified via 2026 comparison roundups; **Moonshine** (Useful Sensors; MIT English model, 245M params, streaming, built for edge — what ORB uses) — verified via same roundups; **Whisper large-v3-turbo** remains the multilingual default (inferred). Runtime: **k2-fsa/sherpa-onnx** — Apache-2.0 all-in-one local STT/TTS/VAD/keyword-spotting across desktop+mobile (inferred; well-established).
- **TTS**: **Chatterbox / Chatterbox-Turbo** (Resemble AI, MIT; blind-test 65.3% preferred vs ElevenLabs per Resemble's own eval — search-verified) is the quality leader among permissive models; **Piper** — CORRECTION-adjacent note: Piper's current home is **OHF-Voice/piper1-gpl**, license now **GPL-3.0** (verified; 5.3k stars, OHF seeking maintainers) — a real licensing change vs the old MIT rhasspy/piper; voice-model licenses vary per voice (unknown). Higgs Audio V2 also cited in 2026 roundups (inferred).
- **VAD**: **Silero VAD** (MIT — inferred, industry default); **TEN VAD** exists as a newer alternative but its exact model-license terms were **not verified** — check before adopting.
- **Wake**: **microWakeWord** (used by ESPHome/HA Voice PE; permissive; the practical commercial-safe alternative to openWakeWord's NC models — inferred); Picovoice Porcupine is the commercial fallback (inferred).

---

## 5. Stronger projects the seed list missed (3–5)

1. **openclaw/openclaw** — MIT (OpenClaw Foundation); the breakout 2026 personal-assistant platform (multi-channel: WhatsApp/Telegram/Slack/iMessage/Matrix/…); actively maintained as of Aug 2026. Directly competes with every "jarvis" seed and outclasses all of them on ecosystem. (search-verified)
2. **pipecat-ai/pipecat** — open-source realtime voice/multimodal agent framework (Daily); v1.0 stable Apr 2026, ~13.4k stars. The main alternative to livekit/agents; license per repo (BSD-2 historically — inferred). (search-verified)
3. **k2-fsa/sherpa-onnx** — Apache-2.0 unified local speech runtime (STT/TTS/VAD/KWS/diarization, mobile+desktop bindings); fills the "one engine, many platforms" gap none of the seeds cover. (inferred, well-established)
4. **NVIDIA NeMo / Parakeet-Canary model family** — the current open-weights ASR accuracy/speed frontier (CC-BY-4.0 weights), absent from the seed list. (search-verified)
5. **OHF-Voice ecosystem beyond wyoming** (piper1-gpl, microWakeWord, Speech-to-Phrase, wyoming-satellite) — the seeds name only the protocol repo; the surrounding OHF repos are where the production-grade local voice components actually live. (partially verified: piper1-gpl fetched)

---

## 6. Corrections and dead-seed flags

- **CORRECTION — Argmax owner**: seed said "WhisperKit/argmax-oss-swift"; correct is **argmaxinc/argmax-oss-swift** (formerly argmaxinc/WhisperKit; both URLs resolve to the same MIT monorepo).
- **CORRECTION — Qwen3-TTS existence doubt**: QwenLM/Qwen3-TTS exists and is fully open (Apache-2.0 code + weights) since 2026-01-22.
- **CORRECTION — Piper license** (context for any PRD assuming MIT Piper): current maintained Piper is GPL-3.0 at OHF-Voice/piper1-gpl.
- **No dead seed URLs**: all 28 seed repos resolved (none 404/archived). settylokesh/ORB and jamesplotts/Mark-XLVIII are license-dead (unusable), not link-dead.
- Note: jamesplotts/Mark-XLVIII coincidentally shares its description string with openclaw ("Your own personal AI assistant. Any OS. Any Platform.") — it is a fork riding that wave; treat provenance carefully.

## 7. Inaccessible / data-quality notes

- GitHub API anonymous rate limit (60/hr, IP 122.161.x) exhausted after 12 repos; remaining 16 verified via WebFetch of github.com pages instead (exact `pushed_at` timestamps unavailable for those — activity judged from page commit counts/recency).
- WebFetch's summarizer mis-converted GitHub relative release dates to 2024 for whisper.cpp (v1.9.x) and faster-whisper (v1.2.1); corrected years are inferred as 2026/2025 respectively from version content.
- `gh` CLI not installed on this machine; GitLab MCP server present but unauthenticated (irrelevant to this task).

## 8. Exact queries/requests used

GitHub API (curl -sL, 2026-08-24): `https://api.github.com/repos/{isair/jarvis, ethanplusai/jarvis, modelscope/ultron, battlesbudz/jarvis-os, jamesplotts/Mark-XLVIII, settylokesh/ORB, porokka/jarvis-os, Matanvil/jarvis, OHF-Voice/wyoming, OpenVoiceOS/ovos-core, leon-ai/leon, JonathanRReed/Apple-MCPs}` (succeeded); same for the 16 voice/control repos (rate-limited, redone via WebFetch).

WebFetch URLs: github.com/isair/jarvis/issues/172; github.com/ethanplusai/jarvis; github.com/ggml-org/whisper.cpp (+ /releases); github.com/SYSTRAN/faster-whisper (+ /releases); github.com/argmaxinc/WhisperKit; github.com/argmaxinc/argmax-oss-swift; github.com/QwenLM/Qwen3-TTS; github.com/dscripka/openWakeWord; github.com/hexgrad/kokoro; github.com/browser-use/browser-use; github.com/OpenAdaptAI/OpenAdapt; github.com/bytedance/UI-TARS-desktop; github.com/livekit/agents; github.com/livekit/sip; github.com/tailscale/tailscale; github.com/juanfont/headscale; github.com/nats-io/nats-server; github.com/cedar-policy/cedar; github.com/open-policy-agent/opa; github.com/jamesplotts/Mark-XLVIII; github.com/porokka/jarvis-os; github.com/settylokesh/ORB; github.com/OHF-Voice/piper1-gpl.

WebSearch queries (verbatim):
1. `best open source local speech-to-text models 2026 parakeet moonshine whisper comparison license`
2. `OpenClaw personal AI assistant github repository license 2026`
3. `UI-TARS-1.5-7B model weights license huggingface bytedance`
4. `pipecat sherpa-onnx voice agent framework license github 2026`
5. `best open source TTS 2026 chatterbox license silero-vad ten-vad license`
