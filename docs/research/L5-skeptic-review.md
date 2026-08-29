# L5 — Skeptical Counter-Review (fan-in over L1, L2, L3, L4, L6, L7a/b, L9 + 02/03 registers)

**Role:** adversarial reviewer. My job is to find what the optimistic lanes got wrong or glossed over, not to re-praise what they got right.
**Access date for every re-fetch below: 2026-08-24.** Method: plain `curl` GETs to public endpoints (`raw.githubusercontent.com`, `github.com` HTML + `.atom` feeds, `huggingface.co/api/models/*`, `pypi.org/pypi/*/json`, `api.webstatus.dev`, `modelcontextprotocol.io`, `w3.org`) plus WebFetch for client-rendered pages. **`api.github.com` was not used at all.** No logins, nothing cloned, installed or executed.

**Labels:** **[V]** verified (I fetched the primary artifact today, URL given) · **[C]** claimed (vendor marketing) · **[I]** inferred · **[U]** unknown.

> **This is not legal clearance.** Every licence statement is a reading of a text I fetched today. Licences change, weights and datasets carry terms separate from code, and repo landing pages misreport SPDX IDs. Anything that ships needs counsel review against the actual LICENSE/NOTICE files at a pinned commit.

---

## 0. Headline verdict

**The corpus is, on citation quality, better than I expected — and worse than it looks on the two things that actually bite.**

- Of **38 material claims** I re-fetched, **30 survived verbatim or substantively**, **6 were upgraded** from `inferred` to `verified`, and **12 were overturned, materially refined, or shown to be over-labelled** (some claims fall in two buckets). L4 is the strongest lane on citation discipline; L3 is the strongest on the code-vs-weights distinction; **L2 carries the largest verification debt** and one flatly wrong `[V]`-labelled number.
- **The two things that bite are (a) transitive licence surface and (b) unknown pilot hardware.** Every lane checked the licence of the thing it recommended. **No lane checked the licence of what that thing requires.** That is how a `compose` verdict landed on Graphiti-on-Neo4j (**GPLv3**) and Graphiti-on-FalkorDB (**SSPL v1**) — §2.1. And every GPU-dependent recommendation was made against a pilot machine whose GPU is recorded as **UNKNOWN (B-002)** — §5.2.
- **I closed one lane blocker outright**: 03b's BLOCKED-3 (`graphifyy` provenance, "web access out of scope for that audit") — §1.C.32.
- **I overturned L7b's blanket access limitation**: the primary trademark registers are *reachable*, not unreachable — §1.B.J. That changes what the Brand sub-gate is allowed to accept as its evidence ceiling.

---

## 1. CITATION AUDIT

### 1.A — Claims re-fetched that SURVIVED

| # | Lane | Claim | Re-fetch result |
|---|---|---|---|
| 1 | L2 | Current MCP spec is `2026-07-28` | `modelcontextprotocol.io/specification/latest` → **HTTP 200, final URL `/specification/2026-07-28`**. Page renders "Version 2026-07-28 (latest)". **[V]** |
| 2 | L2 | Deprecation registry: Roots / Sampling / Logging / DCR (SEP-2577 & PR #2858, deprecated in `2026-07-28`, earliest removal "first revision on or after 2027-07-28"); `includeContext` (SEP-2596, `2025-11-25`); HTTP+SSE (SEP-2596, `2025-03-26`, "three months after SEP-2596 reaches Final") | **Every row, SEP number, date and migration string matches verbatim.** L2's table is a faithful transcription. **[V]** |
| 3 | L2 | Tasks has **zero** listed client support | `/extensions/client-matrix` lists only **MCP Apps, OAuth Client Credentials, Enterprise-Managed Authorization**. Tasks is absent. **[V]** |
| 4 | L2 | `2026-07-28` removes server-initiated requests; `initialize` replaced by `server/discover` (partly `[I]`) | `/specification/2026-07-28/changelog`, verbatim: *"Make MCP stateless: remove the `initialize` / `notifications/initialized` handshake"*; *"Add `server/discover`: servers MUST implement this RPC"*; *"Multi Round-Trip Requests (MRTR) pattern introduced which replaces the previous approach of sending server-initiated requests, such as `roots/list`, `sampling/createMessage`, or `elicitation/create`."* **L2's `[I]` upgrades to `[V]`.** |
| 5 | L2 | 19 code licences read off landing-page badges (L2's self-declared "single largest verification gap", ACCESS LIMITATION #4) | **I fetched all 19 LICENSE files.** All 19 match: Serena MIT · Crush **FSL-1.1-MIT** · tree-sitter MIT · ast-grep MIT · Cline Apache-2.0 · goose Apache-2.0 · openai/codex Apache-2.0 · Kilo Code MIT · Mem0 Apache-2.0 · Graphiti Apache-2.0 · Letta Apache-2.0 · Cognee Apache-2.0 · docker/mcp-gateway MIT · ToolHive Apache-2.0 · Zoekt Apache-2.0 · SCIP Apache-2.0 · ACP Apache-2.0 · mini-swe-agent MIT · OpenCode MIT. **L2's biggest gap is now closed and L2 was right on all 19.** |
| 6 | L2 | Six "suspected wrong" seed URLs were actually correct (L2 could only infer this from rendered org names — ACCESS LIMITATION #1) | **Raw 301 `Location:` headers, observed directly:** `sst/opencode`→`anomalyco/opencode`; `All-Hands-AI/OpenHands`→`OpenHands/OpenHands`; `block/goose`→`aaif-goose/goose`; `zed-industries/agent-client-protocol`→`agentclientprotocol/agent-client-protocol`; `sourcegraph/scip`→`scip-code/scip`. Plus L3's two: `mediar-ai/screenpipe`→`screenpipe/screenpipe`; `fastrepl/hyprnote`→`fastrepl/anarlog`. **All seven confirmed at the header level. L2's ACCESS LIMITATION #1 is closed.** |
| 7 | L2 | Kilo CLI began as a fork of **OpenCode**, not Roo/Cline | Kilo's own LICENSE carries two copyright lines: *"Copyright (c) 2026 Kilo Code / Copyright (c) 2025 opencode"* — independent corroboration from a source L2 never read. **[V]** |
| 8 | L2 | Continue read-only; Roo archived 2026-05-15; Kuzu archived 2025-10-10; Agentless ~2 y stale | Continue banner live: *"no longer actively maintained and is read-only for all users."* Roo last commit **2026-05-15T18:04:45Z**. Kuzu last commit **2025-10-10T13:09:14Z**. Agentless last commit **2024-12-22**, last release **2024-10-29**. **[V]** |
| 9 | L3 | Screenpipe licence: 7-day eval cap, paid licence for all commercial use, §5 bans embedding into a customer product | `LICENSE.md` fetched. **Verbatim match** on §1 Definitions, §2 Free Use ("up to seven (7) days"), §4 ("regardless of company size, headcount, revenue, or funding"), §5 ("Embed or integrate the Licensed Work into a product offered to customers"). L3 also **understated** one term: §3 caps individual licences at **four users per company** before a Team/Enterprise plan is required. **[V]** |
| 10 | L3 | Meetily diarization is PRO-only, contradicting the repo tagline | `meetily.ai/pro/` table: Speaker Identification — Community **"No"**, Pro **"Yes"**; Pro price **"$10/user/month billed annually"**; Licence — Community **"MIT (open source)"**, Pro **"Commercial"**. **[V]** |
| 11 | L3 | pyannote weights: `community-1` CC-BY-4.0 **gated**; `3.1` and `segmentation-3.0` MIT **gated** | HF model API: `community-1` → `license: cc-by-4.0, gated: auto`; `3.1` → `mit, gated: auto`; `segmentation-3.0` → `mit, gated: auto`. **[V]** |
| 12 | L3 | Sortformer v2 = CC-BY-4.0 ungated; **v2.1 = a different, non-CC licence**; TitaNet CC-BY-4.0; SpeechBrain ECAPA Apache-2.0 ungated; Revai reverb `license:other` **gated** | HF API, all five confirmed: v2 `cc-by-4.0/gated:False`; v2.1 `other/gated:False`; TitaNet `cc-by-4.0/gated:False`; `spkrec-ecapa-voxceleb` `apache-2.0/gated:False`; `Revai/reverb-diarization-v2` `other/gated:auto`. **L3's per-checkpoint licence finding is the most valuable single result in the corpus.** **[V]** |
| 13 | L4 | WCAG levels: 2.3.3 Animation from Interactions = **AAA**; 2.4.13 Focus Appearance = **AAA**; 2.4.11 & 2.4.7 & 2.5.8 = AA; 2.2.2 & 2.3.1 = A | Parsed from `w3.org/TR/WCAG22/`. **All seven exact.** L4's X-1 and X-2 corrections stand. **[V]** |
| 14 | L4 | `prefers-reduced-motion` widely available; `prefers-reduced-transparency` Baseline **limited** (Chrome/Edge only); WebGPU Baseline **limited**, no Firefox | `api.webstatus.dev`: reduced-motion `status=widely, high_date=2022-07-15`; reduced-transparency `status=limited, impl={chrome:119, chrome_android:119, edge:119}`; webgpu `status=limited, impl={chrome:144, chrome_android:121, edge:144, safari:26, safari_ios:26}`. **All exact.** *(Bonus L4 missed: `backdrop-filter` is Baseline **newly** available, low_date 2024-09-16, Firefox 103 / Safari 18 — so the glass material has a real floor on older Safari and older Electron/Chromium.)* **[V]** |
| 15 | L4 | Apple Font licence blocks non-Apple-OS mock-ups and embedding | Verbatim from `developer.apple.com/fonts/`: *"solely for creating mock-ups of user interfaces to be used in software products running on Apple's iOS, OS X or tvOS operating systems"*; *"do not permit you to … install, use or run the Apple Font for the purpose of creating mock-ups of user interfaces to be used in software products running on any non-Apple operating system"*; *"You may not embed the Apple Font in any software programs or other products."* Also surfaced two clauses L4 did not quote: one-user-at-a-time, no network availability, and **registered-Apple-Developer requirement**. **This is the single strongest legal finding in the corpus and it survives intact.** **[V]** |
| 16 | L9 | Obsidian Sync $4/$5 (Standard) and $8/$10 (Plus) | `obsidian.md/sync` renders `$4 $5 $8 $10`. **[V]** |
| 17 | L9 | Cursor: no export of chats/rules/config; embeddings + filename metadata not deleted with plaintext; page updated 2026-07-15 | `cursor.com/data-use`: *"The embeddings and metadata about your codebase (hashes, file names) may be stored in our database."* Page last updated **July 15, 2026**. No export section exists. **Survives — but see 1.B.G for L9's over-labelling of "permanently".** |
| 18 | L1 | isair/jarvis issue #172 open, macOS 26 / pynput TSM crash, dictation disabled by version guard, subprocess-isolation proposed | Issue #172 *"Dictation support on macOS 26+ (Tahoe)"*, **Open**, opened **2026-04-10**; `CGEventTap` on a background thread → `EXC_BREAKPOINT`/`SIGTRAP`; four options listed with subprocess isolation recommended. **Exact.** **[V]** |
| 19 | L1 | openWakeWord: code Apache-2.0, **pretrained models CC BY-NC-SA-4.0** | README §License, verbatim: *"All of the code in this repository is licensed under the **Apache 2.0** license. All of the included pre-trained models are licensed under the Creative Commons Attribution-NonCommercial-**ShareAlike** 4.0 International license due to the inclusion of datasets with unknown or restrictive licensing as part of the training data."* **[V]** — and note L1 dropped the **ShareAlike** half (see §2.2). |
| 20 | L1 | Piper's maintained home is `OHF-Voice/piper1-gpl` and it is now **GPL-3.0** | `COPYING` = GNU GPL v3. **[V]** — the most under-weighted licence trap in L1 (see §2.2). |
| 21 | L1/L3 | Wyoming MIT · browser-use MIT · Vexa Apache-2.0 · OpenWhispr MIT · sherpa-onnx Apache-2.0 (on `master`, not `main`) · pyannote-audio MIT · Anarlog MIT · modelscope/ultron Apache-2.0 · Kokoro code Apache-2.0 | All nine LICENSE files fetched and confirmed. **[V]** |
| 22 | L2/L6 | Star counts | `openclaw/openclaw` **387,365** · `anomalyco/opencode` **200,953** · `openai/codex` **116,882** · `oraios/serena` **28,445** · `zeroclaw-labs/zeroclaw` **32,645**. All within drift of the reported figures. **[V]** |
| 23 | L3 | Alternatives' licences: attendee **ELv2**, Blueturboguy07/cue GPL-3.0, VoiceInk GPL-3.0, Handy MIT, DiariZen MIT, senko MIT | All six LICENSE files fetched and confirmed (attendee's file opens *"Elastic License 2.0 (ELv2)"*). **[V]** |
| 24 | L6 | Shortlist licences: agenticSeek GPL-3.0, cua MIT, MemOS Apache-2.0, cc-haha MIT, moltis MIT, OpenJarvis Apache-2.0, MIRIX Apache-2.0, Agent-S Apache-2.0 | All eight confirmed at the LICENSE file. **[V]** |

### 1.B — Claims OVERTURNED or materially refined

| ID | Lane | What the lane said | What the primary source says today | Severity |
|---|---|---|---|---|
| **A** | **L2** | *"Latest GitHub release: **v0.86.0, dated 2025-08-09** `[V]` — **~12 months old**"* — the sole load-bearing number behind "a year without a release … is disqualifying for a dependency." | **Wrong.** `Aider-AI/aider/releases.atom` entries, newest first: **`v0.86.3.dev` 2026-02-12**, **`v0.86.2` 2026-02-12**, `v0.86.2.dev` 2025-08-13, `v0.86.1` 2025-08-13, `v0.86.1.dev` 2025-08-09. The latest release is **v0.86.2 on 2026-02-12 — ~6.4 months old, not ~12**. Last commit 2026-05-22 confirmed. Aggravating: L2 **discarded the PyPI data as "unreliable" for reporting 0.86.2**, and PyPI was the closer source. | **Medium.** The *direction* (decelerating) survives; the *magnitude* and the "disqualifying" framing do not. A `[V]` label on a wrong number is the worst failure mode in this corpus. |
| **B** | **L2** | *"**Nothing has been removed under this policy yet** (the 'Removed' section is empty) `[V]`"* — presented as reassurance. | **Literally true, materially misleading.** The Removed section of the *deprecation registry* is indeed empty. But `2026-07-28`'s changelog removes, outright: `initialize` / `notifications/initialized`, protocol-level sessions + the `Mcp-Session-Id` header, `ping`, `logging/setLevel`, `notifications/roots/list_changed`, the HTTP GET endpoint, `resources/subscribe` / `resources/unsubscribe`, `tasks/result` and `tasks/list`. **Removals happened; they simply did not travel through the registry.** | **Medium.** Anyone planning a port off L2's registry table alone will under-scope it. |
| **C** | **L1 vs L6** | L1: openclaw is *"MIT (OpenClaw Foundation)"* (search-verified). L6: `license: NOASSERTION` — *"License unclear — verify before reuse."* | **Both partial; now resolved.** The LICENSE file is **verbatim MIT, "Copyright (c) 2026 OpenClaw Foundation"**, plus one non-standard trailing sentence: *"Third-party notices for incorporated or adapted code are recorded in THIRD_PARTY_NOTICES.md."* **That trailing sentence is why GitHub's detector returns NOASSERTION.** `THIRD_PARTY_NOTICES.md` (fetched) records that *"Portions of OpenClaw were adapted from Pi / pi-mono"* (MIT, © 2025 Mario Zechner) plus a dependency on `@earendil-works/pi-tui`. **Grant = MIT. Diligence item = read the notices file, not a blocker.** | **Low-Medium.** Resolves a cross-lane conflict and removes a false blocker on the highest-star project in the space. |
| **D** | **L1** | isair/jarvis licence summarised as *"Personal use: Free forever. Commercial use: Contact us."* | **Understated.** The full text adds clause 3: *"**Any derivative works are also licensed under these same terms.**"* This is a **viral non-commercial** licence, not merely a dual-track offer. "learn-only" must therefore mean *read, do not copy* — lifting even the macOS-26 subprocess-isolation implementation would create a derivative bound by NC + copyleft. | **Medium.** L1 explicitly recommends stealing that lesson. |
| **E** | **L1** | faster-whisper = **adopt** for server-side/Python batch STT; *"maintained but slower cadence"*. | **Dormant, not slow.** Last commit **2025-11-19T14:40:46Z**; last release **2025-10-31**. That is **~9 months of zero commits**. **Downgrade adopt → spike/learn-only, or accept it as a fork liability.** | **Medium.** A named `adopt` on a dormant dependency. |
| **F** | **L1** | Argmax `argmax-oss-swift` = *"**MIT** STT+TTS+diarization in one Swift package… the strongest on-device Apple stack"* → **adopt**. | **Code/weights conflation.** The LICENSE is MIT (code) — confirmed. But the README states: *"**SpeakerKit** for speaker diarization **with Pyannote**."* There is **no `argmaxinc/speakerkit` weights repo** on HF; the diarization weights are pyannote-derived, which drags in exactly the gate + CC-BY-4.0/MIT attribution regime L3 documented. L1 issued an `adopt` on a model-bearing package **without a weights audit**, in a lane that never separated code from weights. | **High.** This is the corpus's structural failure in miniature: L3 built the right framework and L1 never applied it. |
| **G** | **L9** | C-010: *"Embeddings **and filename metadata are retained permanently** even under Privacy Mode"* — labelled **verified**. | **Over-labelled.** The page says: *"The embeddings and metadata about your codebase (hashes, file names) **may be stored in our database**."* There is **no permanence language on the page.** The defensible claim is: *not deleted with the plaintext, not user-exportable, retention period unstated.* | **Low.** But it is a `verified` label on an inference, and C-010 is quoted forward into `04-…§D.3`. |
| **H** | **L6** | Shortlist row: meetily = *"local Whisper/Parakeet transcription **+ diarization**"*. | **Wrong — L6 copied the repo tagline.** L3 proved and I re-confirmed at `meetily.ai/pro/` that Community = **"No"** on Speaker Identification. **L3 wins; the L6 shortlist row must be corrected** or it will propagate into Phase-0B as a reason to deep-review meetily for diarization it does not ship. | **Medium.** |
| **I** | **L6** | `zeroclaw-labs/zeroclaw` → `Apache-2.0`. | **Incomplete.** Default branch is **`master`**, there is **no plain `LICENSE` file** (404 on `LICENSE`, `.md`, `.txt`, `COPYING` on every branch tried), and the repo page shows **two** licence tabs — `LICENSE-APACHE` (Apache-2.0) and an MIT tab. This is the standard Rust **dual Apache-2.0/MIT** convention. A naive `raw.githubusercontent…/LICENSE` fetch 404s here — worth recording as a method note. | **Low.** |
| **J** | **L7b** | Banner: *"Every primary trademark register (USPTO, WIPO, EUIPO, UK IPO, IP India) was **unreachable** during this scan."* Whole doc downgraded to aggregator snippets on that basis. | **Overturned.** Fetched today: `tmsearch.uspto.gov/` **200** · `www.uspto.gov/trademarks` **200** · `branddb.wipo.int/en/` **200** · `euipo.europa.eu/eSearch/` **200** · `tmdn.org/tmview/` **200**. They are **client-rendered SPAs that a text fetcher cannot query** — which is a completely different limitation from "unreachable", and one that a browser session or the registers' own data APIs can defeat. **The Brand sub-gate must not treat aggregator snippets as the evidence ceiling.** | **High for the Brand sub-gate.** A wrong limitation caused a whole evidence class to be abandoned. |
| **K** | **L3** | SpeechBrain *"last commit 2026-03-30 … ~5 months idle"*. | **Understated activity.** `commits/develop.atom` → last commit **2026-06-15T11:24:25Z**. 2026-03-30 is the *release* date. ~2.3 months idle. Correction in the project's favour. | **Low.** |
| **L** | **L3** | `modelscope/3D-Speaker` → **adopt** *"as the Apache-2.0 alternative to TitaNet's CC-BY"*. | **Not supportable as `adopt`.** `releases.atom` returns **zero entries** — the project has **never cut a GitHub release** — and last commit is **2025-12-08** (8.5 months). Recommending a no-release, 8-month-silent repo as a production embedding dependency inverts the standard L3 itself applied to Amurex. **Downgrade adopt → spike.** | **Medium.** |
| **M** | **L1** | whisper.cpp / faster-whisper release dates recorded as **inferred** after the fetch summariser misparsed GitHub relative dates to 2024. | **Both now resolvable.** whisper.cpp: last commit **2026-08-24T10:36:17Z**, most recent release **2026-08-20** — L1's inference was right, and whisper.cpp's `adopt` is safe. faster-whisper: see **1.B.E**. `.atom` feeds are the cheap fix for this class of error and should be the standard method going forward. | **Low.** |

### 1.C — Claims UPGRADED (lane said inferred/unknown; I verified)

| # | Lane | Was | Now |
|---|---|---|---|
| 25 | L1 | Kokoro **weights** Apache-2.0 — *"HF-side license field inferred"* | `hexgrad/Kokoro-82M` → `license: apache-2.0, gated: False`. **[V]** |
| 26 | L1 | Qwen3-TTS weights Apache-2.0 (read off the repo page only) | Weights **[V]** — but the HF ids are `Qwen/Qwen3-TTS-12Hz-{0.6B,1.7B}-{Base,CustomVoice,VoiceDesign}` and `Qwen3-TTS-Tokenizer-12Hz`, **all `license:apache-2.0`**. `Qwen/Qwen3-TTS-0.6B` (the id L1's naming implies) **does not exist**. Fix the id before anyone pins it. |
| 27 | L1 | UI-TARS-1.5-7B Apache-2.0 — `[i]` | `ByteDance-Seed/UI-TARS-1.5-7B` → `license: apache-2.0, gated: False`. **[V]** (larger 32B/72B gating still **[U]** — not checked.) |
| 28 | L1 | Silero VAD MIT — *"inferred, industry default"* | `snakers4/silero-vad` LICENSE = MIT. **[V]** |
| 29 | L1 | pipecat BSD-2 — *"inferred"* | LICENSE = **BSD 2-Clause, © 2024–2026 Daily**. **[V]** (matches L6's independent record.) |
| 30 | L1 | microWakeWord = *"the practical commercial-safe alternative to openWakeWord's NC models — **inferred**"* | **Supported, with a caveat L1 could not have known.** `kahrendt/microWakeWord` LICENSE = Apache-2.0; the *model files* live in `esphome/micro-wake-word-models`, whose LICENSE is also **Apache-2.0**. **But**: that repo's README says nothing about training data, and openWakeWord's own NC statement exists *precisely because* of training-data provenance. So the Apache-2.0 grant on the `.tflite` files is **asserted without a documented data lineage**. Usable, but not the clean win it looks like. **[V] + [U] on provenance.** |
| 31 | L1 | Parakeet-TDT CC-BY-4.0; Moonshine MIT — *"search-verified"* via roundups | `nvidia/parakeet-tdt-0.6b-v2` → `cc-by-4.0, gated:False`; `usefulsensors/moonshine-base` → `mit, gated:False`. **[V] at source.** |
| 32 | **03b BLOCKED-3** | *"Upstream provenance: publisher, licence, repository, maintenance status, security posture of a pre-1.0 PyPI package that runs in CI with push credentials to `master`. … **Web access is out of scope for this audit.**"* | **CLOSED.** `pypi.org/pypi/graphifyy/json`: `license_expression: **Apache-2.0**`; `project_urls.Repository: github.com/**Graphify-Labs/graphify**`; `requires_python >=3.10`; **217 releases**, first `0.1.1` on **2026-04-04**, current **`0.9.49` uploaded 2026-08-24T13:19Z (today)**; **no author/maintainer email in metadata**. Upstream repo exists, **110,065★**, default branch `v8`, LICENSE = Apache-2.0. **The CI pin `0.8.39` was uploaded 2026-06-12 — it is ~2.5 months and dozens of releases behind a package shipping ~1.5 releases/day and still pre-1.0.** See §3.8. |

---

## 2. LICENCE AND RIGHTS RISK

### 2.1 The un-checked layer: **transitive licence surface** — the corpus's single biggest hole

Every lane checked the licence of the *thing it recommended*. **No lane checked the licence of what that thing requires to run.** Two live consequences:

**(a) L2's `compose` on Graphiti steers into GPLv3 or SSPL.** L2 wrote: *"**→ compose (on Neo4j or FalkorDB)** / reject the Kuzu path."* Graphiti itself is Apache-2.0 (confirmed). The two backends it steers to are not:

- **Neo4j — GPLv3.** `raw.githubusercontent.com/neo4j/neo4j/dev/LICENSE.txt`, verbatim: *"The software … developed and owned by Neo4j Sweden AB … is licensed under the **GNU GENERAL PUBLIC LICENSE Version 3** to all third parties … However, if you have executed an End User Software License and Services Agreement … the terms of the license in such Commercial Agreement will supersede the GNU GENERAL PUBLIC LICENSE Version 3."* **[V]** So: GPLv3, or pay.
- **FalkorDB — Server Side Public License v1.** `raw.githubusercontent.com/FalkorDB/FalkorDB/master/LICENSE.txt` opens *"Server Side Public License, VERSION 1, OCTOBER 16, 2018."* **[V]** SSPL is **not OSI-approved**; its §13 conditions offering the software as a service on releasing the entire service stack.

L2 correctly rejected Kuzu for being *archived* and then recommended two backends it never licence-checked. For a single-user, non-distributed, self-hosted suite this is survivable — **but it is not a `compose` verdict, it is a `compose, self-host-only, never distribute, never offer as a service` verdict, and it must be written that way.**

**(b) Argmax SpeakerKit ships MIT code over pyannote weights** — §1.B.F.

**Required control:** every `adopt`/`compose` verdict must carry a **three-column licence record — code / weights / datasets — plus a named runtime dependency licence**. L3 built two of those columns. Nobody built the fourth.

### 2.2 Projects that must be downgraded or hard-gated

| Project | Lane verdict | My verdict | Reason (all **[V]** today unless noted) |
|---|---|---|---|
| **openWakeWord pretrained models** | L1 "compose with caution" | **Models: learn-only. Framework: adopt only with self-trained models.** | CC BY-**NC**-**SA** 4.0. L1 reported NC and dropped **ShareAlike** — SA means a model you derive from theirs must also be SA. Shipping any bundled model in a commercial product breaches; deriving from one infects. |
| **Piper (`OHF-Voice/piper1-gpl`)** | L1 lists it as a TTS option with a "CORRECTION-adjacent note" | **learn-only for a proprietary distributed app.** | `COPYING` = **GPL-3.0**. Anyone carrying "Piper = MIT" from the old `rhasspy/piper` will ship GPLv3 in a desktop binary. Per-voice model licences additionally **[U]**. |
| **Argmax `SpeakerKit`** | L1 **adopt** | **Gate on a pyannote weights audit before adopt.** | MIT code; README: *"SpeakerKit for speaker diarization **with Pyannote**"*; no Argmax weights repo on HF. |
| **pyannote `community-1`** | L3 "adopt with caveat" | **Adopt only with a vendored/mirrored weights pipeline + a NOTICE/attribution surface in-product.** | `cc-by-4.0, gated:auto`. CC-BY-4.0 is an **affirmative attribution obligation in the shipped artefact**, not just a permission. L3 flagged the gate; nobody specified where the attribution renders. |
| **NeMo Sortformer v2.1** | L3 "spike" | **Correct — and hold the line.** | `license: other` (nvidia-open-model-license), **not** CC-BY-4.0 like v2. **A weights licence changed between point releases of the same model line.** That is the general lesson, not a v2.1 footnote. |
| **sherpa-onnx `reverb-diarization-v1` bundle** | L3 "live risk" | **Reject until read.** | `Revai/reverb-diarization-v2` → `license: other`, **`gated: auto`**. Cannot be read without login; login is forbidden in Phase-0A. |
| **`modelscope/3D-Speaker`** | L3 **adopt** | **spike** | Zero GitHub releases ever; last commit 2025-12-08. |
| **`faster-whisper`** | L1 **adopt** | **spike / fork-liability** | No commit since 2025-11-19. |
| **`isair/jarvis`** | L1 learn-only | **learn-only meaning *read, never copy*** | Viral NC: *"Any derivative works are also licensed under these same terms."* |
| **`openclaw/openclaw`** | L6 "license unclear" | **MIT grant; read `THIRD_PARTY_NOTICES.md` before composing** | MIT + a non-standard notices pointer (adapted Pi/pi-mono, MIT). |
| **Crush** | L2 learn-only | **Correct.** | `FSL-1.1-MIT` confirmed at the LICENSE file. Source-available, not OSI. |
| **Screenpipe** | L3 reject | **Correct, and stricter than reported.** | Plus §3: **four individual licences per company** before Team/Enterprise is required. |
| **attendee (ELv2)** / **cue, VoiceInk, agenticSeek (GPL-3.0)** | L3/L6 | **Correct as recorded.** | ELv2 fine self-hosted, fatal as a hosted service; GPL-3.0 fatal for a proprietary distributed desktop app. |
| **Neo4j / FalkorDB** | L2 **compose** | **compose, self-host-only, never distribute, never offer as a service** | GPLv3 / SSPL v1 — §2.1. |
| **Apple SF Pro / SF Mono / New York / SF Symbols** | L4 **reject** | **Correct — the strongest legal finding in the corpus.** | Verified verbatim. Applies **including to mock-ups**, and the licence additionally requires registered-Apple-Developer status. |
| **Radix Colors** | L4 adopt (architecture) | **Correct as qualified.** | MIT — but L4's own caution stands: adopting the *values* makes the product recognisably Radix. Architecture yes, values no. |
| **`graphifyy`** | 03b: adapter-for-report, replace-for-store; *extend* rejected | **Correct, now with evidence.** | Apache-2.0, real 110k★ upstream — so the rejection rests on **velocity and pinning**, not obscurity. §3.8. |

### 2.3 DATASET terms — the column nobody filled in

- **ASVspoof 5 dataset licence is UNVERIFIED.** L3 recorded Zenodo **HTTP 403**; ODC-By is **[C]** from search results only. **No anti-spoofing evaluation claim may be planned on it** until the record is read.
- **ASVspoof papers are CC BY-NC-ND 4.0** — constrains quoting/redistribution, not method implementation. L3 got this right.
- **VoxCeleb — [U], and nobody asked.** Both recommended speaker-embedding models (`speechbrain/spkrec-ecapa-voxceleb`, `nvidia/…titanet_large`) are VoxCeleb-trained. The *weights* are Apache-2.0 / CC-BY-4.0, which is what matters for inference. **But the moment anyone fine-tunes on VoxCeleb themselves, VoxCeleb's own distribution terms bind.** I did not fetch them; recording as **[U] — must be read before any enrolment-model fine-tuning.**
- **The general lesson is written on openWakeWord's own README** — models went NC *"due to the inclusion of datasets with unknown or restrictive licensing as part of the training data."* **No lane applied that reasoning to any other model.** `micro-wake-word-models` asserts Apache-2.0 over `.tflite` files with **zero** training-data statement (§1.C.30). That is the same risk shape, one assertion away.

---

## 3. SECURITY AND PRIVACY — highest-risk proposals and the control that must exist FIRST

Ordered by blast radius. Each control is a **precondition**, not a mitigation to add later.

**3.1 Untrusted MCP servers (L2 `adopt` Docker MCP Gateway; `spike` ToolHive).**
Containers bound *execution*. They do not bound the actual MCP attack surface, which the spec itself declares untrusted: **tool descriptions and tool results are attacker-controlled text that enters the model's context.** A container cannot stop a poisoned tool description.
→ **Control first:** a **human-approved tool manifest with a content hash per server**, re-approval on hash change; plus **deny-by-default network egress per server**; plus **no host filesystem mount outside an explicit allowlist**. Treat every tool description as data, never as instruction.

**3.2 Serena — LSP-backed symbol *editing* over MCP (L2 `adopt`, "highest value-per-integration-hour").**
This grants an agent structured **write** access to source: rename, move, inline, "propagate deletions", "safe deletion".
→ **Control first:** run only inside a **dedicated git worktree**, never the primary checkout (the owner's shared-checkout memory already warns several agent sessions drive `~/Work/browser-add-on` concurrently). And the owner's standing "never commit or push" rule must be enforced **mechanically** — a hook or a credential-less worktree — not by prompt instruction.

**3.3 browser-use (L1 `adopt` for browser control).**
A browser driver rides whatever session cookies the profile holds. Pointed at a logged-in profile it is an employer-credential exfiltration path with a friendly name.
→ **Control first:** a **dedicated browser profile with zero employer sessions**, plus a **domain allowlist**. Never `quillbot.atlassian.net`, GitLab, or any authenticated employer surface.

**3.4 Meeting capture — third-party audio (L3 `adopt` Vexa bot-lane; `compose` Anarlog; `adopt` OpenWhispr reference).**
→ **Controls first, all three:** (i) consent preflight per meeting-policy profile with a **fail-closed platform matrix** (register row #1 already mandates this — the L3 evidence now *justifies* it: `Blueturboguy07/cue`'s README states screen-share invisibility is *"best-effort, not guaranteed — on macOS 15.4+ Apple can let modern capture tools see it anyway, and a phone camera always can"*); (ii) **raw audio deleted after transcription by default**; (iii) **bot-join vs local-capture chosen deliberately** — a bot is a visible consent artefact by construction, local capture is not.

**3.5 Voice enrolment / fingerprinting (TitaNet, ECAPA, pyannote; register row #2).**
Register row #2 already rejects silent enrolment. **What no lane said:** a speaker embedding is a **biometric identifier** — Art. 9 GDPR special-category data, and personal data under India's DPDP Act (the owner and NeoSapien's vendor are both India-domiciled).
→ **Control first:** voice embeddings **never leave the device**, get their **own retention clock independent of transcripts**, and are **deletable independently** of the meeting record.

**3.6 Voice cloning + speaker ID in the same product (L1 `spike → likely adopt` Qwen3-TTS "voice cloning"; L3's whole Part B).**
Nobody flagged the composition. A suite that can *identify* a voice and *clone* a voice is a deepfake-capable stack, in a product that is simultaneously recording other people.
→ **Control first:** cloning is **owner-voice only**, gated on a **live enrolment** the owner performs deliberately, and **structurally unable to read from the meeting-capture store**. Enforce by data-path separation, not policy text.

**3.7 The local executor / Forge sandbox profile (register row #4).**
"Bypass only as a visible sandbox profile" is the right disposition, but a profile is a UI state, not a boundary.
→ **Control first:** the bypass profile runs as a **separate OS user or in a VM**, with **no access to the credential store** holding Jira/GitLab tokens.

**3.8 `graphifyy` in employer CI with push credentials to `master` (03b).**
Now evidenced: **217 releases in 4.6 months, still pre-1.0**, current `0.9.49` shipped *today*, pin is `0.8.39` from 2026-06-12, installed from PyPI at CI time with **no lockfile and no hash pin**, in a job that runs `git push origin HEAD:master`. Provenance is better than feared (Apache-2.0, 110k★ upstream) — the risk is **velocity + unpinned install + write access**, not obscurity. **BLOCKED-5 (whether the removed "deep mode" egressed repository content to an LLM vendor, and to which vendor) remains open and is the more serious question.**
→ **Control first:** hash-pin or vendor the wheel, and **remove `push` capability from the job** (emit an artefact; let a human land it).

**3.9 NeoSapien MCP (B-004).**
An **undocumented, vendor-hosted remote endpoint** holding the owner's personal memory, with `export_memories` in its tool surface. L3 additionally observed the vendor's site runs **PostHog with `session_recording` + `autocapture` enabled**, and that the site's *"Speaker Recognition — knows who said what"* marketing **directly contradicts** its own Privacy Policy §4 (*"other participants' voices are not identified or stored"*).
→ **Control first:** hold the Phase-0 "zero memory queries" rule. Before any read, require a written data-flow: what leaves the device, to which host, retained how long. **It may never be cited as a "verified official documented" interface** (X-04 is correct).

**3.10 Claude Code Artifacts as the Gate-2 medium (L4 X-8/X-9).**
Code artifacts are **static** — *"An artifact is a static page. It can't store data submitted through a form"* — and their only outbound path is declared MCP connectors that run **through the viewer's account**.
→ **Control first:** **no Gate-2 artifact may declare an MCP connector that touches employer data.** And L4's X-9 discrepancy (support.claude.com says Team/Enterprise-only and not publicly shareable; code.claude.com says Pro/Max/Team/Enterprise with public links) is **unresolved** — check the actual account before promising a sharing model.

---

## 4. MAINTENANCE RISK — every recommended dependency that is a fork liability

| Class | Projects | Evidence (today) | Disposition |
|---|---|---|---|
| **Archived / read-only** | Roo Code (2026-05-15), Continue (read-only banner), kuzudb/kuzu (2025-10-10), bytebot (2025-09-12), mycroft-core (2024-09-08) | All confirmed | Already rejected — correct |
| **>12 months, no release AND no commit** | Agentless (rel 2024-10-29, commit 2024-12-22) | Confirmed | learn-only — correct |
| **Dormant but recommended `adopt`** | **faster-whisper** — no commit since **2025-11-19** | Confirmed | **Downgrade (§1.B.E)** |
| **Never released, recommended `adopt`** | **`modelscope/3D-Speaker`** — `releases.atom` = **0 entries**, last commit 2025-12-08 | Confirmed | **Downgrade (§1.B.L)** |
| **Decelerating** | Aider — last release 2026-02-12, last commit 2026-05-22 | Confirmed, **figures corrected** | learn-only stands, rationale corrected |
| **Bus factor 1 / no adoption** | loqui (3★, 1 release), Apple-MCPs (11★), Matanvil/jarvis (1★), battlesbudz/jarvis-os (2★), settylokesh/ORB (1★), Mark-XLVIII (0★), Devleed/meeting-copilot (2★, no LICENSE) | As recorded | learn-only/reject — correct. **But L1 marks Apple-MCPs `spike`; at 11★ that is a bus-factor-1 dependency on the Apple-app integration seam — write the AppleScript/JXA MCP servers in-house instead.** |
| **Strategic-continuity risk** | **Anarlog** — team publicly *"now building char.com"*; community app *"remains open-source… and maintained"* | L3 **[V]**; last commit 2026-08-24 | `compose` is defensible **today**; record that its maintenance is a stated side-project |
| **Governance churn (unexplained)** | **OpenCode `sst` → `anomalyco`** on a 201k★ project, **no rationale anywhere** | 301 confirmed; reason **[U]** | L2's `spike` is right. Understand the move before depending |
| **Open-core gradient — the generalisable risk** | Serena (JetBrains plugin commercial), Mem0 (managed cloud), Anarlog (`enterprise/`), Argmax (Pro SDK), **meetily (already moved diarization to Pro)** | All **[V]** | **meetily is the proof that this risk is real, not theoretical.** Every open-core dependency can move the exact feature you depend on behind the paid tier. Depend only on features that already exist in the permissive tier, and pin |
| **Pre-1.0, extreme velocity** | **`graphifyy`** — 217 releases / 4.6 months, still `0.9.x` | **[V]** | Do not extend. Adapter only |
| **Weights-licence drift** | **NeMo Sortformer v2 (CC-BY-4.0) → v2.1 (`license:other`)** | **[V]** | Pin weights by revision, re-read the licence on every bump |
| **Foundation moves (low risk, note only)** | goose → AAIF/Linux Foundation; ACP → neutral org; A2A → Linux Foundation TSC | **[V]** | Favourable. But AAIF ≠ LF-direct — L2 is right not to conflate them |

---

## 5. FEASIBILITY AND COST — capabilities the lanes treated as achievable that are not (yet)

**5.1 "$0 in Phase 0, free/open-source only" (A-05) vs. what the lanes actually recommend.**
- **Vexa `adopt` is not free.** Hosted Vexa is **$0.30/hr** bot time; self-hosting means running a bot fleet against Meet/Teams/Zoom. Neither is $0-with-no-infra. **Flag as a paid-or-infra decision, not an adoption.**
- **pyannote's gate breaks unattended installs** → the mitigation (mirror the weights ourselves) is **hosting cost + a CC-BY attribution surface**, not free.
- **Obsidian Sync $4–$10/mo** if chosen — moot until X-03 resolves (Obsidian is **not installed on this machine**).
- **Trademark clearance is a paid decision** the Brand sub-gate cannot proceed past — and §1.B.J means the *free* evidence available is better than L7b concluded.
- **Neo4j Enterprise / Screenpipe / meetily Pro / Argmax Pro / Granola Business** — all paid tiers sitting behind features a lane referenced.

**5.2 The largest feasibility hole: every GPU-dependent recommendation is unbudgeted against UNKNOWN hardware.**
**B-002 / U-01 record the Windows pilot machine's CPU/GPU/RAM as UNKNOWN.** Yet the lanes recommend, without conditioning on it: NeMo Sortformer (heavy install), full `nemo_toolkit[asr]`, real-time diarization, WebGPU-based 3D, and Acrylic live-blur (Microsoft's own docs: **"GPU-intensive… automatically disabled when a device enters Battery Saver mode"**). `porokka/jarvis-os` — cited as an architecture reference — assumes an **RTX 3090 24GB**. **No lane wrote "conditional on B-002".** Every performance and latency claim in this corpus is currently unfalsifiable.
→ **Gate 1 must not accept any latency budget or real-time diarization commitment until B-002 is answered.**

**5.3 Real-time 3D cannot be a baseline.** WebGPU Baseline = **limited**, **no Firefox** (confirmed). Apple's own guidance is to use its glass material *"sparingly"*; Microsoft's is that live-blur is GPU-intensive and auto-disabled on battery saver. L4's X-10 is right — **it must be promoted from a design note to a Gate-1 architectural constraint**: 3D is an opt-in, pausable enhancement on a bounded surface, never the substrate.

**5.4 Platform entitlements and OS floors.**
- Apple Liquid Glass requires **OS 26.0**, and the `UIDesignRequiresCompatibility` escape hatch is **ignored from OS 27**. A macOS "reference-quality" target implies a hardware/OS floor.
- **Intel-Mac cliff, unaddressed:** OpenWhispr's own README (L3 **[V]**) states that on Intel Macs *"live speaker identification and voice fingerprinting are unavailable: they depend on ONNX Runtime, which stopped shipping macOS x86_64 binaries in 1.24."* **Whether this Mac is Apple Silicon is not recorded anywhere in the corpus.** If it is Intel, the entire local diarization lane does not run here. **[U] — add to U-01.**
- `joaquingit1/loqui` is **Apple-Silicon-only**; `ORB` uses **MLX** (Apple-Silicon-only) — two of the three most-praised architecture references are unrunnable on Intel.

**5.5 Undocumented / unstable APIs the lanes lean on.**
- **NeoSapien MCP** — undocumented endpoint, schema and stability **[U]** (B-004).
- **Claude Code session JSONL** — L9 correctly notes the format is *"internal … can break on any release."* Any migration tooling built on it is on sand.
- **MCP `2026-07-28` itself** — a genuine breaking rewrite (§1.B.B). Budget a **port**, not a bump, and expect SDK support for Tasks/Apps to lag per-SDK (**[U]** — never verified for any of the 10 SDKs).

---

## 6. DISAGREEMENT LOG

| # | Conflict | Which evidence is stronger | What would settle it |
|---|---|---|---|
| 1 | **openclaw licence** — L1: MIT. L6: NOASSERTION, *"license unclear."* | **Neither, alone.** I read the file: **MIT text + a non-standard trailing notices sentence** (which is *why* the detector says NOASSERTION). L1 is right on the grant; L6 is right that the detector flags it. | **Settled** (§1.B.C). Record as "MIT grant; `THIRD_PARTY_NOTICES.md` is a diligence item." |
| 2 | **meetily diarization** — L6 shortlist says it ships diarization; L3 says PRO-only. | **L3, decisively.** L6 quoted the repo tagline; L3 read the vendor's own pricing table. I re-confirmed L3. | **Settled.** Correct the L6 shortlist row before Phase-0B. |
| 3 | **NeoSapien MCP** — L9: *"no publicly documented MCP exists"* **[V]**. L3: *"it is MCP — verified"* **[V]**. | **Complementary, not contradictory, and L3's evidence is stronger in kind.** L9 proved the *absence of documentation*; L3 found the vendor's own build artefacts (`<!-- Card F: … (MCP) -->`, `mcp-any-ai.webp`) proving the *mechanism*. | **Merge them.** B-004 should record L3's HTML-comment evidence — it upgrades "most plausible reading" to "vendor-labelled MCP with zero published schema." |
| 4 | **Aider staleness magnitude** — L2: last release 2025-08-09, ~12 months. | **The `.atom` feed**, which I read directly: **v0.86.2, 2026-02-12**. | **Settled** (§1.B.A). Verdict unchanged, rationale corrected. PyPI, which L2 discarded, was closer. |
| 5 | **Argmax stack** — L1: *"MIT STT+TTS+diarization"* → adopt. L3's framework: weights are licensed separately from code. | **L3's framework wins.** The README names Pyannote as SpeakerKit's diarizer; no Argmax weights repo exists on HF. | Fetch SpeakerKit's actual model-resolution path (which HF repo / bundled `.mlmodelc`) and licence it. **Open.** |
| 6 | **faster-whisper** — L1 `adopt`, *"maintained but slower cadence."* | **The commit feed.** Nine months of zero commits. | **Settled** (§1.B.E). Downgrade. |
| 7 | **Trademark evidence ceiling** — L7b: registers *"unreachable"*, so aggregators only. | **My reachability probes.** All five registers return **HTTP 200**; they are SPAs, not down. | **Settled** (§1.B.J). Re-run the brand scan via a browser session or the registers' data APIs before the Brand sub-gate. |
| 8 | **Material priority** — L4 X-3 inverts the brief: Windows Mica-class (static-sample), not Apple/Acrylic live-blur, as the base material. | **L4.** Microsoft publishes a documented **five-condition fallback matrix**; Apple publishes no equivalent; the pilot is Windows-first. | **Accept L4's inversion as a Gate-1 constraint.** |
| 9 | **Policy engine** — L1 lists both Cedar (`spike`) and OPA (`adopt-or-cedar`) with *"pick ONE… Don't run both."* | L1's own instruction is correct. | Pick at Gate 1. OPA for breadth/maturity (CNCF graduated, Cure53 audited), Cedar for typed authz + verification. **Not a real conflict, but an undecided decision that must not drift.** |
| 10 | **Where the capability catalogues belong** (register #9 / X-01) | The register's reasoning is sound: §5.2.1 forbids inferring one host's capabilities from another, and B-002 is open, so a populated catalogue today **would be fiction**. | **Owner decision at the Brand sub-gate.** I endorse the deferral. |

---

## 7. FASHIONABLE-BUT-HARMFUL — patterns to REJECT explicitly

1. **Undetectability / concealed presence (Cluely, ParakeetAI).** Already rejected (register #1) — **keep it rejected, and now for a technical reason, not only an ethical one.** The central claim is not durable: the open-source clone's README states invisibility is *"best-effort, not guaranteed — on macOS 15.4+ Apple can let modern capture tools see it anyway, and a phone camera always can."* Cluely's marketing says *"never shows up in shared screens, recordings, or external meeting tools"* while its own docs retract it to *"as long as the software respects the Windows and MacOS default."* **Build provable presence, and treat "we make it invisible" as a product-integrity failure, not a feature gap.**

2. **"100% accurate", "zero latency", "unlock all devices".** Register rows #7 and #8 already reject these. ParakeetAI's *"100% Accurate Responses"* is the calibration example: a claim no LLM product can support, and its presence is a signal about the whole page. **Never ship an unfalsifiable performance claim.**

3. **Free-canvas node/graph editors as the primary agent UI.** L4 D2/C2 makes graph workflows attractive. L4's own warning is the one to enforce: *"Free-canvas node editors are notoriously bad for keyboard and screen-reader users."* → **Reject the graph-as-primary-surface.** If a graph exists, it is a *view* over a first-class linear list with the same operations, or it fails WCAG 2.1.1 Keyboard outright.

4. **Copying Radix's colour *values* (or any reference system's tokens) rather than its architecture.** Adopting Radix values verbatim makes the product recognisably Radix, which defeats the originality brief. Same trap with Vercel AI Elements (*"adopting it wholesale would make our product look like every other AI SDK app"*) and Figma First Draft (*"not our design system — Figma-library-derived geometry wearing our colours"*). **Take architectures; generate values.**

5. **Glass-on-glass / 3D as the substrate.** Reject. WebGPU Baseline limited, Apple says "sparingly", Microsoft auto-disables live blur on battery saver (§5.3).

6. **Glow as a focus indicator.** The natural instinct for a glass HUD, and it **does not count** — WCAG 2.4.13 Note 1 excludes *"shadow and glow effects outside the component's content, background, or border."* Focus must be a real border/outline.

7. **Relying on `prefers-reduced-transparency`.** Baseline **limited**, Chrome/Edge only. **An in-app "solid surfaces" toggle is the mechanism; the media query is a bonus.**

8. **MCP Sampling — "borrow the host's model."** Deprecated; prescribed migration is *"Integrate directly with LLM provider APIs."* **Any design assuming free inference on the user's subscription is dead.** Reject at design time, not at port time.

9. **HTTP+SSE transport.** Deprecated since `2025-03-26` with the **nearest removal horizon of anything on the list** ("three months after SEP-2596 reaches Final"). Reject.

10. **Standing one-way sync into another vendor's agent (ChatGPT desktop Import).** L9 **[V]**: OpenAI's desktop import offers *"automatic updates to keep imported work in sync with the original agent"*, with **no documented export in the reverse direction, ever.** **Reject enabling it** — it is a continuous, one-way, un-revocable-by-export mirror of the owner's entire agent configuration into a third party.

11. **"Deduplicate forks and mirrors" in the census.** Register #10 is right: GitHub search excludes forks by default, so the requirement is unsatisfiable as written. **Keep it disclosed; do not let a later lane quietly claim it was met.**

12. **Treating SEO listicles as status evidence.** L2's ACCESS LIMITATION #12 found 2026-dated "best coding agent" articles still recommending **Roo Code and Continue**, both archived/read-only, and inventing a *"CodeGraph (MIT, 47.4k stars)"*. **Ban the genre from status determinations.**

---

## 8. TOP 10 RISKS FOR GATE 1

| # | Risk | Severity | Evidence | Recommended mitigation |
|---|---|---|---|---|
| **1** | **Transitive licence surface is unchecked across the whole corpus.** A `compose` verdict already steers into **GPLv3 (Neo4j)** and **SSPL v1 (FalkorDB)**; an `adopt` verdict already ships MIT code over pyannote weights (Argmax SpeakerKit). | **Critical** | Neo4j `LICENSE.txt` — *"licensed under the GNU GENERAL PUBLIC LICENSE Version 3 … unless … a Commercial Agreement"* **[V]**. FalkorDB `LICENSE.txt` = **SSPL v1** **[V]**. `argmax-oss-swift` README — *"SpeakerKit for speaker diarization with Pyannote"* **[V]**. | **Gate 1 exit criterion:** no `adopt`/`compose` verdict is valid without a **four-column record — code / weights / datasets / required-runtime** — each with a fetched primary URL. Re-run every existing verdict through it. Restate Graphiti as *"self-host-only, never distribute, never offer as a service."* |
| **2** | **Every GPU/latency/real-time commitment is unfalsifiable — B-002 is open and no lane conditioned on it.** | **Critical** | U-01/B-002 record CPU/GPU/RAM as UNKNOWN; NeMo/Sortformer/WebGPU/Acrylic all assume capable GPUs; `porokka/jarvis-os` assumes RTX 3090 24GB **[V]**. | **Block** any latency budget, real-time-diarization or 3D commitment at Gate 1 until B-002 is answered. Add **"is this Mac Apple Silicon or Intel?"** to U-01 — on Intel, local speaker ID does not run at all (ONNX Runtime dropped macOS x86_64 in 1.24) **[V]**. |
| **3** | **Untrusted MCP servers + an LSP write-capable agent + a credentialed browser driver are all `adopt`, with no named control.** | **Critical** | L2 `adopt` docker/mcp-gateway + Serena; L1 `adopt` browser-use; MCP spec declares tool descriptions untrusted input **[V]**. | Ship the three preconditions **before** any of the three lands: (a) hash-pinned, human-approved tool manifests + deny-by-default egress; (b) Serena confined to a dedicated worktree with mechanically-enforced no-push; (c) browser-use on a zero-employer-session profile with a domain allowlist. |
| **4** | **Model-weight and dataset licences drift under you, and one already did.** | **High** | Sortformer **v2 = CC-BY-4.0 → v2.1 = `license:other`** between point releases **[V]**. pyannote 4.x default moved **MIT → CC-BY-4.0** **[V]**. openWakeWord models are **NC + ShareAlike** **[V]**. Revai reverb weights `license:other` + **gated** **[V]**. | Pin weights **by revision**, mirror them (permitted by CC-BY/MIT with attribution preserved), re-read the licence on every bump, and build the in-product **NOTICE/attribution surface** CC-BY-4.0 requires. Reject the reverb bundle until read. |
| **5** | **The Brand sub-gate is about to be decided on an evidence base that was abandoned for a wrong reason.** | **High** | L7b: *"Every primary trademark register … was unreachable."* Today: `tmsearch.uspto.gov` **200**, `branddb.wipo.int` **200**, `euipo.europa.eu/eSearch` **200**, `tmdn.org/tmview` **200**, `uspto.gov/trademarks` **200** **[V]**. | Re-run the collision scan against the **actual registers** (browser session or their data APIs) before the sub-gate. Keep L7b's "not legal clearance" banner — but do not let a wrong access limitation lower the bar. **ZENO's Class 042 SaaS hit and ATHENA's multiple software-class hits are the two that most need a real look.** |
| **6** | **MCP `2026-07-28` is a breaking rewrite, and the corpus's own summary under-reports the breakage.** | **High** | Changelog **[V]**: `initialize` removed, protocol sessions + `Mcp-Session-Id` removed, `ping` / `logging/setLevel` / `notifications/roots/list_changed` removed, `resources/subscribe` replaced, `server/discover` mandatory, MRTR replaces server-initiated requests. L2's *"nothing has been removed yet"* refers only to the deprecation registry. | Budget a **port, not a bump**. Design to **stdio + Streamable HTTP only**. Reject Sampling/Roots/Logging/DCR/HTTP+SSE at design time. Treat **Tasks as spec-ready / ecosystem-unready** (zero listed client support **[V]**) — build behind a flag with a sync fallback. Verify extension support **per SDK, per version** — currently **[U]** for all 10. |
| **7** | **Biometric voice data has no lawful-basis, retention or residency design.** | **High** | Register #2 rejects silent enrolment, but nothing addresses that speaker embeddings are Art. 9 GDPR special-category data / DPDP personal data; owner and NeoSapien vendor both India-domiciled **[I]**. NeoSapien's own site contradicts itself on whether other participants are identified **[V, both texts]**. | Embeddings never leave the device; independent retention clock; independent deletion. **Structurally separate the cloning path from the meeting-capture store** — a suite that both identifies and clones voices while recording third parties is deepfake-capable by composition (§3.6). |
| **8** | **`graphifyy` runs unpinned-by-hash in employer CI and pushes to `master`; and BLOCKED-5 (historical LLM data egress) is still open.** | **High** | **[V]** today: Apache-2.0, upstream `Graphify-Labs/graphify` 110,065★, **217 releases since 2026-04-04**, current `0.9.49` shipped today, CI pin `0.8.39` from 2026-06-12; installed from PyPI at CI time with no lockfile/hash. 03b: job runs `git push origin HEAD:master`; it has twice destabilised merge trains. | Hash-pin or vendor the wheel; **remove push capability** (emit an artefact, let a human land it). Escalate **BLOCKED-5** — *which vendor received repository content* during the removed "deep mode" window is an employer-data question that outranks everything else in 03b. |
| **9** | **Open-core dependencies can move the exact feature you depend on behind the paid tier — and one already did.** | **Medium-High** | **meetily moved speaker identification to a $10/user/mo Commercial tier** while its repo tagline still advertises diarization **[V]**. Same gradient present in Serena, Mem0, Anarlog, Argmax **[V]**. | Depend only on features **already shipping in the permissive tier**, pin versions, and record a replacement for each. **Correct the L6 shortlist row on meetily before Phase-0B deep review.** |
| **10** | **Two named `adopt` dependencies are effectively unmaintained, and one `[V]`-labelled staleness figure is wrong.** | **Medium** | faster-whisper: **no commit since 2025-11-19** **[V]** (L1 `adopt`). 3D-Speaker: **zero releases ever**, last commit 2025-12-08 **[V]** (L3 `adopt`). Aider: latest release **2026-02-12**, not 2025-08-09 **[V]** (L2 `[V]`-labelled, wrong). | Downgrade both to `spike`. **Adopt `.atom` feeds (`/commits/<branch>.atom`, `/releases.atom`) as the standard freshness method** — they are cheap, unauthenticated, and would have caught all three. Re-audit any remaining `adopt` whose activity was judged from a rendered landing page. |

---

## ACCESS LIMITATIONS (this review)

| Resource | Result | Consequence |
|---|---|---|
| `api.github.com` | **Not used at all**, per worker rules | No `pushed_at`, no SPDX IDs, no commit counts from the API. All freshness read from `.atom` feeds; all licences from `raw.githubusercontent.com`. No 403/429 encountered. |
| `tmsearch.uspto.gov`, `branddb.wipo.int`, `euipo.europa.eu/eSearch`, `tmdn.org/tmview` | HTTP **200**, but **client-rendered SPAs** | I established **reachability**, which overturns L7b's stated limitation. I did **not** run trademark searches — that needs a browser session and is still not legal clearance. |
| `ped.uspto.gov/api/queries` | Connection failed (curl exit 0 code 000) | One USPTO API endpoint is down; the search UI and main site are up. |
| `huggingface.co/Revai/reverb-diarization-v2` | `gated: auto` | Licence text unreadable without login (forbidden). The sherpa-onnx reverb bundle remains uncleared. **[U]** |
| VoxCeleb dataset terms | **Not fetched** | Recorded as **[U]**. Affects only self-fine-tuning, not inference on released weights. |
| `zenodo.org/records/14498691` (ASVspoof 5) | Not re-attempted (L3 recorded **403**) | ASVspoof 5 dataset licence remains **[C]**, unverified. |
| `modelcontextprotocol.io/specification/2026-07-28/basic/message-patterns` | **HTTP 404** | The nav lists "Message Patterns"; the slug differs. Not load-bearing — the changelog and `/deprecated` carried the claims. |
| Per-SDK MCP extension support (10 SDKs) | Not checked | Inherited **[U]** from L2. Still open. |
| Argmax SpeakerKit model-resolution path | Not traced | Which HF repo / bundled artefact supplies the diarization weights is **[U]** — §6 row 5. |
| `zeroclaw-labs/zeroclaw` `LICENSE` | 404 on all four conventional names, all branches | Resolved via repo HTML: files are `LICENSE-APACHE` (+ an MIT tab). Method note for future workers. |
| Everything else | — | No logins, no paywall/robots/CAPTCHA bypass, nothing cloned, installed or executed, no contact with any person or vendor, no purchases, no registrations. The NeoSapien MCP connector present in this session was **not invoked**. |

---

## EXACT QUERIES AND FETCHES RUN (2026-08-24)

**WebSearch:** none. Every claim in this review was checked against a primary artifact directly.

**WebFetch (client-rendered pages only):**
`https://meetily.ai/pro/` · `https://www.cursor.com/data-use` · `https://github.com/isair/jarvis/issues/172` · `https://developer.apple.com/fonts/`

**curl — LICENSE files (`raw.githubusercontent.com/<repo>/<branch>/{LICENSE,LICENSE.md,LICENSE.txt,COPYING}`):**
`oraios/serena` · `charmbracelet/crush` · `tree-sitter/tree-sitter` · `ast-grep/ast-grep` · `cline/cline` · `aaif-goose/goose` · `openai/codex` · `Kilo-Org/kilocode` · `mem0ai/mem0` · `getzep/graphiti` · `letta-ai/letta` · `topoteretes/cognee` · `docker/mcp-gateway` · `stacklok/toolhive` · `sourcegraph/zoekt` · `scip-code/scip` · `agentclientprotocol/agent-client-protocol` · `SWE-agent/mini-swe-agent` · `anomalyco/opencode` · `openclaw/openclaw` (+ `THIRD_PARTY_NOTICES.md`) · `isair/jarvis` · `zeroclaw-labs/zeroclaw` (404 ×8) · `modelscope/ultron` · `hexgrad/kokoro` · `dscripka/openWakeWord` (+ `README.md`) · `OHF-Voice/piper1-gpl` · `QwenLM/Qwen3-TTS` · `OHF-Voice/wyoming` · `browser-use/browser-use` · `Vexa-ai/vexa` · `fastrepl/anarlog` · `OpenWhispr/openwhispr` · `k2-fsa/sherpa-onnx` · `pyannote/pyannote-audio` · `kahrendt/microWakeWord` (+ `README.md`) · `esphome/micro-wake-word-models` (+ `README.md`) · `snakers4/silero-vad` · `pipecat-ai/pipecat` · `argmaxinc/argmax-oss-swift` (+ `README.md`) · `screenpipe/screenpipe` · `attendee-labs/attendee` · `Blueturboguy07/cue` · `Beingpax/VoiceInk` · `cjpais/Handy` · `BUTSpeechFIT/DiariZen` · `narcotic-sh/senko` · `Fosowl/agenticSeek` · `trycua/cua` · `MemTensor/MemOS` · `NanmiCoder/cc-haha` · `moltis-org/moltis` · `open-jarvis/OpenJarvis` · `Mirix-AI/MIRIX` · `simular-ai/Agent-S` · `Graphify-Labs/graphify` (`master` + `v8`) · `neo4j/neo4j` (`dev/LICENSE.txt`, `dev/README.asciidoc`) · `FalkorDB/FalkorDB` (`master/LICENSE.txt`)

**curl — redirect-chain probes (`-o /dev/null -w "%{http_code} %{redirect_url}"`):**
`github.com/{sst/opencode, All-Hands-AI/OpenHands, block/goose, zed-industries/agent-client-protocol, sourcegraph/scip, mediar-ai/screenpipe, fastrepl/hyprnote}`

**curl — `.atom` freshness feeds (`/commits/<branch>.atom` and `/releases.atom`):**
`Aider-AI/aider` · `OpenAutoCoder/Agentless` · `continuedev/continue` · `RooCodeInc/Roo-Code` · `kuzudb/kuzu` · `speechbrain/speechbrain` · `modelscope/3D-Speaker` · `Zackriya-Solutions/meetily` · `oraios/serena` · `SYSTRAN/faster-whisper` · `ggml-org/whisper.cpp`

**curl — repo HTML (star counts, default branch, licence tabs):**
`github.com/{openclaw/openclaw, anomalyco/opencode, openai/codex, oraios/serena, zeroclaw-labs/zeroclaw, continuedev/continue, Graphify-Labs/graphify}`

**curl — HuggingFace model API (`huggingface.co/api/models/<id>`):**
`hexgrad/Kokoro-82M` · `Qwen/Qwen3-TTS-0.6B` (404) · `pyannote/speaker-diarization-community-1` · `pyannote/speaker-diarization-3.1` · `pyannote/segmentation-3.0` · `nvidia/diar_streaming_sortformer_4spk-v2` · `nvidia/diar_streaming_sortformer_4spk-v2.1` · `nvidia/speakerverification_en_titanet_large` · `speechbrain/spkrec-ecapa-voxceleb` · `ByteDance-Seed/UI-TARS-1.5-7B` · `Revai/reverb-diarization-v2` · `nvidia/parakeet-tdt-0.6b-v2` · `usefulsensors/moonshine-base`
Plus listings: `?search=Qwen3-TTS&author=Qwen&limit=20` · `?author=argmaxinc&limit=12`

**curl — other primary sources:**
`pypi.org/pypi/graphifyy/json` · `modelcontextprotocol.io/specification/latest` · `/specification/2026-07-28/deprecated` · `/specification/2026-07-28/changelog` · `/extensions/client-matrix` · `/specification/2026-07-28/basic/message-patterns` (404) · `w3.org/TR/WCAG22/` · `api.webstatus.dev/v1/features/{prefers-reduced-transparency, prefers-reduced-motion, webgpu, backdrop-filter}` · `obsidian.md/sync`

**curl — reachability probes (HEAD-equivalent, no queries run):**
`tmsearch.uspto.gov/` · `ped.uspto.gov/api/queries` · `tmsearch.uspto.gov/api-v1-0-0/tmsearch` · `www.uspto.gov/trademarks` · `branddb.wipo.int/en/` · `euipo.europa.eu/eSearch/` · `tmdn.org/tmview/`

---

*End of L5 skeptical counter-review. Nothing here is legal clearance. Read-only throughout: no logins, no bypasses, no installs, no execution, no purchases, no registrations.*
