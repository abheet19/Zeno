# 06 — Brand Gate Report

**Program:** personal AI suite (personal assistant + coding agent + meeting copilot).
**Brand character being tested against:** calm, exact, candid, deliberate. **Promise:** "Reason before action."
**Candidate set (fixed by the gate, not by me):** ZENO · SENECA · CATO · ARISTO · ATHENA · ZEUS.
**Synthesis date:** 2026-08-24. **Synthesis worker:** Phase-0A fan-in (read-only).

**Primary inputs (read in full before scoring):**
- `/Users/abheet.isher/Documents/personal-ai-suite-phase0/research/L7a-brand-sources.md` — classical verification, product-signal fit, pronunciation / wake-word, cross-language negatives, cultural risk.
- `/Users/abheet.isher/Documents/personal-ai-suite-phase0/research/L7b-brand-collisions.md` — software/company collisions, GitHub, package registries, app stores, domains, trademark attempts, social handles.

**Scope note:** two earlier working names were retired before this gate. They are not carried here and are not options; this report evaluates exactly the six names above and nothing else.

---

> ## ⚠️ NO TRADEMARK CLEARANCE HAS BEEN PERFORMED
>
> Nothing in this document is a trademark clearance, a freedom-to-operate opinion, or legal advice, and no web search may be presented as any of those things. **Every primary trademark register (USPTO, WIPO, EUIPO, UK IPO, IP India) was unreachable during the underlying scan** — see §9. All trademark statements below are inherited from secondary aggregator snippets and are **unconfirmed leads**. A registered mark that does not appear here may still exist and may still block you. See §8 for what a real clearance would have to cover.

---

## 1. Classification — stated explicitly, as required

| Candidate | Classification | Basis (from L7a, verified) |
|---|---|---|
| **ZENO** (of Citium) | **Stoic — founder of the school** | SEP "Stoicism": the Stoic school was founded ~300 BCE by Zeno of Citium. Distinct person from **Zeno of Elea** (the paradoxes). |
| **SENECA** (the Younger) | **Stoic — philosopher and imperial counselor** | SEP "Seneca": Roman Stoic philosopher, c. 1 BCE–65 CE; tutor/advisor to Nero; forced suicide 65 CE. |
| **ARISTO** (of Chios) | **Stoic — heterodox pupil of Zeno** | Encyclopedia.com: 3rd c. BCE pupil of Zeno of Citium; ethics-only doctrine; **dismissed logic and physics as irrelevant**. |
| **CATO** (the Younger) | **Stoic-ASSOCIATED statesman — NOT a school philosopher** | EBSCO Research Starter: "a devoted practitioner, not merely a philosopher"; he *studied* Stoicism and practised it as a Roman politician. He founded no school and wrote no philosophy. |
| **ATHENA** | **Greek MYTHOLOGICAL figure — not a Stoic, not a philosopher** | World History Encyclopedia: goddess of wisdom, strategic warfare and crafts; born from Zeus's head. |
| **ZEUS** | **Greek MYTHOLOGICAL figure — not a Stoic, not a philosopher** | World History Encyclopedia: king of the Olympians; sky, thunder, law, order. (The Stoics *used* the name Zeus for cosmic reason — Cleanthes' *Hymn* — but that does not make Zeus a Stoic figure; `inferred`.) |

Any brand story that calls Cato "a Stoic philosopher", or Athena/Zeus "Stoic", is factually wrong and should not be written.

---

## 2. Scoring method

Eleven axes, each scored **1–5** (5 = best for this product), with an explicit weight. Weights sum to 100; the weighted total is out of **500**.

| # | Axis | Weight | Why this weight |
|---|---|---:|---|
| 1 | Source significance & product meaning | 12 | The whole point of a classical name is the story it licenses; a name whose namesake contradicts the promise is worse than a neutral coinage. |
| 2 | Distinctiveness | 11 | Whether the name can ever mean *your* product rather than someone else's. |
| 3 | Memorability | 6 | Real, but the least differentiating axis across six short classical names. |
| 4 | Spelling-from-hearing | 7 | Users must type it after hearing it — docs, installs, support. |
| 5 | Global pronunciation | 7 | India-first usage plus international speech; a cross-language negative is unfixable. |
| 6 | Wake-word quality ("`<NAME>`, attend") | 9 | This is a voice product; the wake phrase is used dozens of times a day. |
| 7 | Collision risk | **18** | The only axis that can kill the program *after* launch. Highest weight by design. |
| 8 | Domain / handle / package feasibility | 10 | Determines whether the name is shippable at all in npm/PyPI/domain/social space. |
| 9 | Product extensibility across the family | 5 | All six are stems that take a noun; genuinely low variance. |
| 10 | Cultural fit vs calm/exact/deliberate | 12 | A name that fights the brand character costs you on every touchpoint forever. |
| 11 | Visual-identity potential | 3 | Solvable with design budget; least decisive. |

**Gates.** Weighted score is advisory. A **hard gate** is applied separately and is a veto, not a deduction: a candidate is gated if there is a verified, currently-shipping product in the *same category* under the *same name*, or a category-defining negative association that positioning cannot repair. Gates are named in §5.

---

## 3. Per-candidate scorecards (one line of justification per axis)

### 3.1 ZENO — *Stoic, founder of the school*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 4 | Founder of Stoicism, and the assent doctrine ("action follows assent") is the closest thing in the whole set to "Reason before action" `verified doctrine` — docked because the Zeno the public knows is **Elea**, whose paradoxes conclude that motion never completes, an unhelpful story for an agent that must act. |
| Distinctiveness | 3 | Inherently arbitrary for software, but AI-space crowding is severe and *recent*: Zeno ML (CMU model-evaluation platform), Zeno.ai, a Rotterdam legal-AI Zeno, AIZENO, plus Zeno Group PR `verified`. |
| Memorability | 4 | Two syllables, hard "Z" onset, one clean shape; sticks after one hearing `inferred`. |
| Spelling-from-hearing | 3 | Zeno / **Xeno** / Zeeno / Zino — the Xeno- prefix is a permanent dictation tax `inferred`. |
| Global pronunciation | 3 | Spanish/Italian seseo maps it onto **"seno" = breast/bosom** `verified word`; Indian-English /z/→/dʒ/ can yield "Jeeno" `inferred`. |
| Wake-word ("Zeno, attend") | 3 | 4 syllables meets the ~3–4 syllable guidance, but /z/ is a fricative onset (plosives preferred) `verified guidance` and **Eclipse zenoh documents its pronunciation as /zeno/** — an exact homophone in the same Rust/ROS ecosystem `verified`. |
| Collision risk | 2 | A **ZENO word mark in Class 042 SaaS** (Zeno Technologies Inc., ser. 97102641) is the exact class a SaaS assistant files in `unconfirmed secondary`; crates.io `zeno` has **10.38M downloads** as a load-bearing Rust rasterizer `verified`; npm/PyPI both occupied. |
| Domain / handle / package | 2 | `zeno.com` 1995, `zeno.net` 2003, `zeno.dev` live personal page, `@zeno` on X taken, npm/PyPI/crates taken; **only Docker Hub `zeno` is free** (verified 404, re-verified this session). Compound fallbacks also gone: `usezeno.com` registered 2025-10-30, `zenohq.com` 2018 `verified this session`. |
| Product extensibility | 5 | Best stem in the set: short + hard onset means "Zeno Forge / Counsel / Command / Vault / Link / Glass" all stay two-beats-plus-one `inferred`. |
| Cultural fit (calm/exact/deliberate) | 4 | Incidental "Zen" resonance and the assent doctrine both push calm-and-deliberate; docked for the "reasons forever, never acts" joke that Elea (and "Zeno behavior" in control theory) hands to a critic `inferred`. |
| Visual identity | 4 | Z is one of the strongest single-letter marks available; the Stoa colonnade is a usable secondary motif `inferred`. |

### 3.2 SENECA — *Stoic, philosopher and counselor*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 5 | The only candidate whose actual historical job **was trusted personal advisor**; the *Letters* are the exact register (calm, candid, practical) the brand claims `verified role`. |
| Distinctiveness | 3 | Distinctive as a word, but three heavyweight owners already hold the meaning: Seneca Learning (UK edtech), Seneca Polytechnic (Toronto, renamed 2023), and the Seneca Nation `verified`. |
| Memorability | 4 | Three syllables, familiar cadence, easy to say aloud repeatedly `inferred`. |
| Spelling-from-hearing | 4 | A known English word/place-name; Senaca/Senecca are the only common slips `inferred`. |
| Global pronunciation | 5 | Cleanest of the six: no cross-language negative found in any checked language, and actively **positive recognition in Spanish** (Córdoba-born) `inferred over verified biography`. |
| Wake-word ("Seneca, attend") | 5 | Best shape in the set — 3 syllables + intro word = 5, with an internal /k/ plosive to anchor detection `verified guidance, inferred application`. |
| Collision risk | 2 | **npm `seneca` is the actively maintained Node.js microservices framework at v3.38.0** `verified` — disqualifying-grade for a slug in a coding-agent family; plus an exact-match iOS app (Seneca Learning Ltd.) and arXiv 2604.19425 *"seneca: A Personalized Conversational Planner"* — literally this product category, this slug `verified`. |
| Domain / handle / package | 2 | `seneca.com` 1994, `seneca.net` 1996, `.ai` unclear (no response), npm/PyPI/crates/Docker/GitHub all taken; compounds gone too — `useseneca.com` registered 2025-07-22, `senecahq.com` 2010 `verified this session`. |
| Product extensibility | 4 | "**Seneca Counsel**" is the single best name-to-role fit produced by this exercise; docked because 3+2 syllables makes "Seneca Command" a five-syllable mouthful in speech `inferred`. |
| Cultural fit | 4 | Practical counsel and mastery of anger are on-character; docked for the **Seneca Nation** naming sensitivity (a living federally recognised Native nation) and the Nero/hypocrisy attack line `verified facts, inferred risk`. |
| Visual identity | 3 | No natural glyph — no owl, no thunderbolt, no strong initial; would need a wholly typographic identity `inferred`. |

### 3.3 CATO — *Stoic-ASSOCIATED statesman, not a school philosopher*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 3 | Legendary incorruptibility and blunt candor are a genuine trust story `verified`, but he is history's most famous **obstructionist**, his obstruction backfired, and he is not a philosopher of the school. |
| Distinctiveness | 2 | Three large simultaneous owners — Cato Networks (security), Cato Institute (politics), The Cato Corporation (retail) — plus the surname Kato `verified`. |
| Memorability | 4 | Two hard plosive syllables; punchy and machine-modern `inferred`. |
| Spelling-from-hearing | 2 | Cato / **Kato** / Kaito is unrecoverable by ear, and Kato is a common real surname `inferred`. |
| Global pronunciation | 2 | Indian-English rendering ≈ **काटो (kāṭo) = the imperative "cut!" / "bite!"** `verified verb form, inferred mapping` — a voice product whose wake word is a Hindi command is a real defect for this user's primary market. |
| Wake-word ("Cato, attend") | 3 | Excellent K…T plosive acoustics and 4 syllables, undone by **"keto"** — an extremely high-frequency token that language-model-biased ASR will prefer `inferred`. |
| Collision risk | 2 | **Cato Networks** holds CATO NETWORKS reg 5348949 covering network security *and non-downloadable cloud software*, ships a "Cato Client" iOS app, runs Cato AI Labs, and already operates an **internal agentic assistant over Slack/Confluence/Git/Jira** — adjacency of product, not just of name `verified/claimed`. `cato.ai` is Cato Digital (GPU infra for AI). |
| Domain / handle / package | 2 | `cato.com` held via Amazon Registrar since 1994; `.ai` in use; Docker/GitHub taken. Only the package squats are soft (npm/crates/PyPI are all low-traffic and abandoned) `verified`. |
| Product extensibility | 4 | Crisp compounds, but "Cato Command" reads military-political, which is exactly the association to avoid `inferred`. |
| Cultural fit | 2 | The **Cato Institute** gives the word a specific and one-sided US political valence a neutral productivity tool cannot control; "Cato Fong" carries a documented Asian-stereotype critique; obstruction ≠ deliberate action `verified associations`. |
| Visual identity | 3 | Strong hard-C letterform, but Cato Networks already occupies the enterprise visual space for this word `inferred`. |

### 3.4 ARISTO — *Stoic, heterodox pupil of Zeno*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 2 | The namesake **rejected logic and physics as irrelevant** `verified doctrine` — a reasoning product cannot honestly cite him for "Reason before action"; near-zero public recognition, and encyclopedias confuse him with Aristo of Ceos. |
| Distinctiveness | 2 | Blank to the public but **not** blank in AI: Ai2's flagship reasoning program is named Aristo, and `aristo.ai` is a live AI startup `verified`. |
| Memorability | 3 | Pleasant three syllables that collapse in memory into "Aristotle" `inferred`. |
| Spelling-from-hearing | 2 | Aristo / Aristow / Arristo, plus autocorrect pull to Aristotle and to **Arista** `inferred`. |
| Global pronunciation | 2 | **Nigerian English "aristo" = a wealthy married man who keeps much younger mistresses** `verified (Wiktionary)`; French/English "aristo" = clipping of aristocrat; Arabic أرسطو *is* Aristotle. |
| Wake-word ("Aristo, attend") | 3 | 5 syllables with a usable /st/ cluster, but ASR language models will complete the far more frequent "Aristotle" `inferred`. |
| Collision risk | 3 | Best of the six on registries, worst on *conceptual* proximity: **Ai2's Aristo is a live, senior program** — its lead Peter Clark has been Ai2 interim CEO since March 2026 and Aristo now sits in Ai2's Asta team building "interactive research assistants" `verified this session`; crates.io `aristo` (338,684 dl) is owned by an AI company; **ARISTA reg 4893674** is one letter away in networking/software; and the historic **ARISTO** instrument mark passed to Schneider Schreibgeräte GmbH on 1 July 2025 `verified this session`. |
| Domain / handle / package | 3 | The only free-signal PyPI name (404, re-verified), a dormant 0-repo GitHub shell, no bare iOS app, and **`getaristo.com` / `aristohq.com` are both unregistered** (RDAP 404, control-tested) `verified this session` — offset by `aristo.com` (1993), `aristo.net`, `aristo.ai` in use, and Docker Hub taken. |
| Product extensibility | 3 | "Aristo Counsel" reads like a law firm and the stem already sounds like a brand prefix (Aristocrat, Ariston) `inferred`. |
| Cultural fit | 2 | An elitist ring ("aristo") is the opposite of calm-and-plain, and the namesake's anti-logic position quietly undercuts every piece of copy you would write `inferred over verified`. |
| Visual identity | 2 | No distinctive glyph; wordmark would sit uncomfortably close to Arista's `inferred`. |

### 3.5 ATHENA — *Greek MYTHOLOGICAL figure, not a Stoic*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 4 | Instantly readable as wisdom + strategy, and her mythic role is literally counselor to heroes `verified` — but there is no doctrine here, only iconography, and she is still a war goddess. |
| Distinctiveness | 1 | The most diluted name in the set by a wide margin: AWS Athena, athenahealth (four exact-prefix apps), Athena Intelligence, Athena AI, Athena Bitcoin, Lockheed's ATHENA laser `verified`. |
| Memorability | 4 | Effortless recall as a *word* — though recall of *your product* is a different matter (scored under distinctiveness) `inferred`. |
| Spelling-from-hearing | 5 | Famous, unambiguous, spelled correctly by nearly everyone `inferred`. |
| Global pronunciation | 5 | Established transliterations in every checked language, no negative meaning found `inferred`. |
| Wake-word ("Athena, attend") | 3 | 5 syllables, but two vowel joints blur the phrase ("Athena‿attend"), and in developer/enterprise rooms people say "Athena" about AWS all day — a false-accept environment `inferred`. |
| Collision risk | 1 | **Athena Intelligence (athenaintel.com) ships an AI agent named Athena on a platform named Olympus, with a meeting agent (multi-language transcription, July 2026) and code-review agents** `verified` — the same three product legs, same name, in market now. Plus the worst trademark crowding of the six in software classes. |
| Domain / handle / package | 1 | `athena.com` since 1991, Docker org taken, `@athena` on Instagram taken, npm/PyPI/crates taken, `athena.app` parked, four athenahealth iOS apps `verified`. |
| Product extensibility | 2 | The Greek-pantheon family device is **already in use by the direct competitor** (Athena → Olympus), so "Athena Forge/Vault/Glass" reads as an echo of them `verified premise, inferred conclusion`. |
| Cultural fit | 3 | Wisdom and strategic restraint fit well; docked for the war-goddess/weapon-system register and for walking straight into the female-voiced-servile-assistant critique `verified uses, inferred risk`. |
| Visual identity | 2 | Owl, helmet and aegis are rich but exhausted motifs; ownability near zero `inferred`. |

### 3.6 ZEUS — *Greek MYTHOLOGICAL figure, not a Stoic*

| Axis | Score | Justification |
|---|:--:|---|
| Source significance & product meaning | 2 | Law, order and oath-keeping are on-message, but the actual mythology is impulse, wrath, coercion and abduction — the inverse of "Reason before action" `verified traits`. |
| Distinctiveness | 1 | "AI employee named Zeus" is already a crowded, undifferentiated position (zeus.rocks, withzeus.com, get-zeus.com, a Product Hunt Zeus agent, ml-energy/zeus) `verified`. |
| Memorability | 5 | Maximal recall; one syllable; nobody forgets it `inferred`. |
| Spelling-from-hearing | 3 | Famous but chronically misspelled "Zues"; zoos/Seuss homophones `inferred`. |
| Global pronunciation | 3 | Recognised everywhere, but Indian-English /z/→/dʒ/ makes **"Zeus, attend" ≈ "juice attend"** `inferred`. |
| Wake-word ("Zeus, attend") | 1 | **One syllable fails the ~3-syllable minimum outright**; the full phrase is 3 syllables with a weak fricative onset — the worst wake-word candidate in the set `verified guidance, inferred application`. |
| Collision risk | 1 | **Zeus/Zbot is one of the most documented banking-trojan families in existence** (GameOver ZeuS ≈ $100M in fraud damages; explainer pages maintained by Kaspersky, CrowdStrike, Proofpoint, SentinelOne, BSI) `verified` — an EDR/SOC/procurement problem for a product that wants calendar, transcript and account access. Plus **ZEUS reg 5277620 (Vonage) covering unified-communications software** — the meeting-copilot class. |
| Domain / handle / package | 1 | `zeus.com` 1993; `zeus.ai` → SiteZeus; npm `zeus` **actively maintained**, v3.3.3 published 2025-12-05; Docker Hub and GitHub `zeus` held by the *same* person, so there is no split-namespace fallback `verified`. |
| Product extensibility | 3 | Compounds work mechanically but read as gaming/gym/energy-drink branding; "Zeus Command" is a thunderbolt cliché `inferred`. |
| Cultural fit | 1 | Near-total mismatch with calm/exact/candid/deliberate; the myth is "act first, punish loudly" `verified traits, inferred conflict`. |
| Visual identity | 2 | The thunderbolt is instantly legible and completely exhausted `inferred`. |

---

## 4. Weighted totals and ranked table

Cell values are the raw 1–5 score; the total is Σ(score × weight), out of 500.

| Axis (weight) | ZENO | SENECA | CATO | ARISTO | ATHENA | ZEUS |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Source significance & product meaning (12) | 4 | 5 | 3 | 2 | 4 | 2 |
| Distinctiveness (11) | 3 | 3 | 2 | 2 | 1 | 1 |
| Memorability (6) | 4 | 4 | 4 | 3 | 4 | 5 |
| Spelling-from-hearing (7) | 3 | 4 | 2 | 2 | 5 | 3 |
| Global pronunciation (7) | 3 | 5 | 2 | 2 | 5 | 3 |
| Wake-word quality (9) | 3 | 5 | 3 | 3 | 3 | 1 |
| **Collision risk (18)** | 2 | 2 | 2 | 3 | 1 | 1 |
| Domain / handle / package (10) | 2 | 2 | 2 | 3 | 1 | 1 |
| Product extensibility (5) | 5 | 4 | 4 | 3 | 2 | 3 |
| **Cultural fit (12)** | 4 | 4 | 2 | 2 | 3 | 1 |
| Visual identity (3) | 4 | 3 | 3 | 2 | 2 | 2 |
| **WEIGHTED TOTAL / 500** | **315** | **358** | **246** | **248** | **260** | **177** |

### Ranked

| Rank | Candidate | Classification | Total /500 | Normalised /5 | Hard gate? |
|:--:|---|---|:--:|:--:|---|
| 1 | **SENECA** | Stoic — philosopher/counselor | **358** | 3.58 | No gate. Severe *namespace* problem (npm). |
| 2 | **ZENO** | Stoic — founder | **315** | 3.15 | No gate. Sharpest single-name trademark lead (Class 042 SaaS). |
| 3 | **ATHENA** | Greek mythological | **260** | 2.60 | **GATED** — same name, same three product legs, shipping now (Athena Intelligence). |
| 4 | **ARISTO** | Stoic — heterodox pupil | **248** | 2.48 | No gate. Best availability, weakest story; Ai2 owns the AI meaning. |
| 5 | **CATO** | Stoic-**associated** statesman | **246** | 2.46 | No gate. Enterprise incumbent + political valence + Hindi imperative. |
| 6 | **ZEUS** | Greek mythological | **177** | 1.77 | **GATED** — banking-trojan namespace; fails the wake-word floor. |

**Sensitivity check (honest disclosure of weight dependence).** If this stays a *private, non-commercial* suite — halving collision (18→9) and availability (10→5) and moving those points to source meaning, cultural fit and wake-word — the totals become: SENECA 396, ZENO 339, ATHENA 294, CATO 256, ARISTO 238, ZEUS 183. **The top two are stable under both weightings.** Only ARISTO moves materially, because its entire advantage is availability rather than merit.

---

## 5. Hard gates (vetoes, applied outside the score)

- **ATHENA — GATED.** Athena Intelligence markets an AI agent called *Athena* on a platform called *Olympus*, with a meeting agent (multi-language transcription, shipped July 2026) and code-review agents `verified`. That is not a name collision, it is a product collision, in all three of your legs, with the Greek-family naming device already spent. No positioning fixes this.
- **ZEUS — GATED.** Sharing a name with the Zeus/Zbot banking trojan is a category-defining negative for software that will hold calendar, transcript and account access; search and enterprise-security channels are permanently owned by higher-authority sources `verified`. Independently, one syllable fails the wake-word floor for the product's core interaction.

Gated names should not proceed to identity work regardless of their weighted score. ATHENA scoring third is a property of the scoring, not a recommendation.

---

## 6. Coherent family rendering — top three ranked, plus first ungated alternate

The family pattern under test: `<NAME>` · `<NAME> Forge` · `<NAME> Counsel` · `<NAME> Command` · `<NAME> Vault` · `<NAME> Link` · `<NAME> Glass`.

**#1 SENECA**

> **Seneca** — the assistant · **Seneca Forge** — coding agent · **Seneca Counsel** — advisory/decision surface · **Seneca Command** — control plane · **Seneca Vault** — memory & secrets · **Seneca Link** — connectors · **Seneca Glass** — observability

*Reads:* the most coherent set in the exercise. "Seneca Counsel" is the single best name-to-role pairing produced here — the historical Seneca *was* a counselor, so the sub-brand earns its name rather than borrowing it. *Costs:* every compound is 5–6 syllables spoken ("Seneca Command"), so the spoken product family is heavy; and the bare stem `seneca` is not usable as an npm package name.

**#2 ZENO**

> **Zeno** · **Zeno Forge** · **Zeno Counsel** · **Zeno Command** · **Zeno Vault** · **Zeno Link** · **Zeno Glass**

*Reads:* the crispest family — a two-syllable hard-onset stem keeps every compound short and typeable, and "Zeno Forge" / "Zeno Command" are the strongest individual names in the whole rendering. *Costs:* **"Zeno Link" is actively unsafe** — Eclipse **zenoh** (pronounced /zeno/) *is* a pub/sub linking protocol in the same Rust/robotics ecosystem, so that one sub-brand is a homophone of a real competitor product in its own category. Rename that leg if ZENO is chosen.

**#3 ATHENA — rendered for completeness only; this name is GATED**

> **Athena** · **Athena Forge** · **Athena Counsel** · **Athena Command** · **Athena Vault** · **Athena Link** · **Athena Glass**

*Reads:* fluent and instantly legible. *Costs:* the competitor already runs Athena-on-Olympus, so a Greek-named family under Athena reads as a derivative of a live product; "Athena Vault" and "Athena Command" additionally sit near athenahealth's and AWS's documented surfaces. Do not build on this.

**First ungated alternate — #4 ARISTO**

> **Aristo** · **Aristo Forge** · **Aristo Counsel** · **Aristo Command** · **Aristo Vault** · **Aristo Link** · **Aristo Glass**

*Reads:* mechanically fine and the only stem with real registry headroom (`getaristo.com`, `aristohq.com` and PyPI `aristo` all free-signal, verified this session). *Costs:* "Aristo Counsel" reads as a law firm; the stem carries an aristocratic ring; and Ai2 already owns "Aristo" as an AI reasoning system.

**Cross-cutting finding on the suffixes themselves** (applies to whichever stem wins). Three of the seven family words are already major product names: **Vault** (HashiCorp Vault — developer-infrastructure product, `developer.hashicorp.com/vault` HTTP 200, 2026-08-24 `verified existence`), **Forge** (Autodesk's platform, now APS, `aps.autodesk.com` HTTP 200; also SourceForge), and **Glass** (Google Glass, `google.com/glass/start/` HTTP 200). Compounding with a distinctive stem is the normal, defensible way to use them, but expect **"<NAME> Vault" search results to be shadowed by HashiCorp Vault** in developer channels `inferred`. "Counsel", "Command" and "Link" are generic-descriptive and weak as marks on their own `inferred`.

---

## 7. Recommendation stance

**Split by intended use, because the evidence genuinely splits that way.**

**A. For a public, commercial launch of this three-leg product family: NO CLEAR CANDIDATE.**
All six carry a HIGH or SEVERE preliminary risk grade except ARISTO (MODERATE), two are hard-gated, and the two leaders each have a specific finding that would show up in the first hour of a real clearance search — a live ZENO word mark in **Class 042 SaaS** for ZENO, and an actively maintained npm package called `seneca` plus an arXiv paper using the exact slug for the exact product category for SENECA. Not one of the six is available as a bare one-word mark on `.com`, on the primary package registry a coding-agent family needs, or as a bare social handle. Recommending one for commercial launch on this evidence would be presenting a web search as clearance, which it is not.

**B. For the private/personal build this program actually is right now, the evidence does support a ranked pair, with conditions:**

- **First recommendation: SENECA**, on condition that (i) the shipped identity is a **compound wordmark** ("Seneca Counsel", not bare "Seneca"), (ii) all packages are **scoped** (`@<org>/seneca-*`), never the bare `seneca` name, which belongs to a live Node framework, and (iii) the **Seneca Nation** sensitivity is treated as a real reputational question and not waved away before anything goes public. Rationale: it is the only candidate whose namesake's actual job is the product, it has the best wake-word shape in the set, and it is the only name with **no cross-language negative found anywhere**.
- **Second recommendation: ZENO**, on condition that (i) the same compound-wordmark and scoped-package rules apply, (ii) **"Zeno Link" is renamed** because of the zenoh homophone, and (iii) the Class 042 SaaS lead is the *first* thing a lawyer is asked about. Rationale: the strongest doctrinal warrant for "Reason before action" in the entire set, the crispest family, the best visual-identity potential, and the only free Docker Hub namespace.

**No additional alternatives are proposed.** The gate's trigger condition — *all six badly compromised* — is not met: SENECA and ZENO remain workable under a compound wordmark, and ARISTO is graded only MODERATE. Inventing or pseudo-classicising a seventh name would be exactly the failure mode this gate exists to prevent. If the program later decides it wants a wider field, the correct next step is a professional naming exercise paired with clearance, not another desk search.

---

## 8. Decisive risks, per candidate

| Candidate | The one risk that decides it | Other risks that matter |
|---|---|---|
| **SENECA** | **npm `seneca` is a live, maintained Node.js microservices framework (v3.38.0)** — the bare slug is unusable in the exact developer population a coding agent targets `verified`. | arXiv 2604.19425 *"seneca: A Personalized Conversational Planner"* = same slug, same category; exact-match iOS app (Seneca Learning Ltd.); Seneca Polytechnic; **Seneca Nation of Indians** naming sensitivity; the Nero-advisor and wealth-hypocrisy attack lines. |
| **ZENO** | **A ZENO word mark sitting in Class 042 (SaaS)** — the exact filing class for this product `unconfirmed secondary lead, and unresolvable without a real search`. | Eclipse **zenoh** is an exact homophone in the same ecosystem; crates.io `zeno` at 10.38M downloads; Zeno ML is an AI-evaluation platform (AI-tooling category); Spanish/Italian "seno"; the Zeno-of-Elea "never completes" joke. |
| **CATO** | **Cato Networks** — a Gartner-MQ-Leader security vendor holding CATO NETWORKS in cloud-software classes, shipping a "Cato Client" app, and already running its own internal agentic assistant `verified/claimed`. | Hindi **kāṭo = "cut!/bite!"** for an India-first voice product; "keto" as the dominant ASR capture; Cato Institute political valence; Cato/Kato indistinguishable by ear. |
| **ARISTO** | **The namesake rejected logic** — the brand story contradicts the product promise, and Ai2's Aristo already owns "Aristo" as a *reasoning system* in AI (program still live under Ai2's Asta team, 2026) `verified`. | **ARISTA reg 4893674** at one letter's distance in networking/software; ARISTO instrument marks moved to Schneider Schreibgeräte 1 July 2025; `aristo.ai` is a live AI startup; Nigerian-English sugar-daddy slang; elitist ring. |
| **ATHENA** | **Athena Intelligence is shipping an AI agent named Athena with a meeting agent and code-review agents right now** — a product collision, not a name collision `verified`. | AWS Athena poisons developer search/docs; athenahealth's four exact-prefix apps; the worst software-class trademark crowding of the six; Lockheed's ATHENA laser weapon; gendered-assistant critique. |
| **ZEUS** | **Zeus/Zbot banking trojan** — an unfixable security-namespace association for a product that wants account, calendar and transcript access `verified`. | One syllable fails the wake-word floor; **ZEUS reg 5277620 (Vonage) in unified communications** = the meeting-copilot class; "juice" in Indian English; crowded AI-employee positioning; myth is the inverse of the brand character. |

---

## 9. Trademark status: plainly stated

**No trademark clearance has been performed, by me or by either sibling worker.** No primary register was successfully searched at any point in this program. Specifically (inherited from L7b, 2026-08-24): USPTO TMSearch returned only a JavaScript shell with no interface; WIPO Global Brand DB was CAPTCHA-gated and **the CAPTCHA was not attempted or bypassed**; EUIPO eSearch returned only its landing page; UK IPO returned **HTTP 403**; IP India required **login + CAPTCHA** and **no login was performed**. The secondary aggregator (Justia) returned **403** on both its search path and individual record pages, so not one trademark record was opened directly. Every mark, serial number and class in this report is therefore an **unconfirmed lead whose live/dead status, class list and goods/services text could not be checked**, and the true set of relevant registrations should be assumed to be **larger** than what appears here.

**What a professional search would still have to cover, before any public use, filing, launch or spend:**

1. **Full-text *and* phonetic/near-miss searches** in each register that matters — USPTO (US), EUIPO (EU), UK IPO, **IP India** (this program's primary market), and WIPO Madrid for international extensions.
2. **Classes 9** (downloadable software), **42** (SaaS / software-as-a-service), **38** (telecommunications — relevant because a meeting copilot touches communications services), and **35/45** if advisory or workflow services are ever sold. Filing in 42 alone is not enough for a product that ships a desktop binary and an extension.
3. **Named likelihood-of-confusion opinions** on the specific leads this program surfaced: ZENO ser. 97102641 (Class 042 SaaS); **ARISTA reg 4893674** vs ARISTO; CATO NETWORKS reg 5348949; **ZEUS reg 5277620 (Vonage, unified communications)**; and the ATHENA cluster (regs 5445790, 4272212, 4370075; sers. 79373833, 98171714).
4. **Common-law / unregistered-use searches** — an unregistered but actively used mark can still block you. Athena Intelligence, Zeno ML, Seneca Learning, Cato Networks and Aristo AI are all live commercial users whose rights do not depend on anything found in a register.
5. **Company-name and business-register checks** in the jurisdictions of incorporation, plus **domain, package-registry, app-store and social-handle sweeps** re-run at filing time (this program's sweep is a snapshot; `usezeno.com` and `useseneca.com` were both registered within the last 14 months, so the landscape is moving).
6. **Design-mark search** if a logo will be filed alongside the word mark.
7. A **non-legal cultural review** of the Seneca Nation question if SENECA proceeds. That is a reputational judgement, not a trademark one, and no attorney search will surface it.

Until items 1–6 are done by a licensed practitioner in each relevant jurisdiction, treat every name in this report as **unclear**, not as available.

---

## 10. Verification performed by this synthesis pass (new evidence, 2026-08-24)

Everything else is inherited from L7a/L7b. These checks were run to close gaps the two files left open.

| Check | Result | Label |
|---|---|---|
| RDAP `.com`, compound fallbacks (Verisign) | `useseneca.com` registered **2025-07-22** · `senecahq.com` **2010-09-07** · `usezeno.com` registered **2025-10-30** · `zenohq.com` **2018-02-28** · **`getaristo.com` 404** · **`aristohq.com` 404** | **verified** |
| RDAP control test | `zzqxnonexistentbrandtest.com` → **404**, `google.com` → **200** — confirms 404 genuinely means unregistered on this endpoint (the failure mode L7b caught with `.dev`) | **verified** |
| RDAP `.net`, bare names | `zeno.net` 2003-10-12 · `seneca.net` 1996-06-06 · `aristo.net` 2003-06-15 — all taken | **verified** |
| Ai2 Aristo project still live? | Yes — Aristo's lead **Peter Clark has been Ai2 interim CEO since March 2026**; Aristo now sits within Ai2's **Asta** research team building "interactive research assistants". This makes the ARISTO collision *more* live, not less. | **verified via search summary** (en.wikipedia.org/wiki/Allen_Institute_for_AI and Ai2 job-board/team pages) |
| ARISTO instrument-mark ownership | Aristo (technical drawing instruments, brand in use since 1952) — **"On 1 July 2025, Schneider Schreibgeräte GmbH will take over the trademark rights for ARISTO and STANDARDGRAPH"**; Aristo Graphic Systeme GmbH & Co. KG holds older ARISTO registrations for mathematical instruments | **verified** (https://schneiderpen.com/uk/blog/changes-at-aristo-and-standardgraph, fetched 2026-08-24) — an ARISTO mark family L7b did not surface |
| Family-suffix products exist? | `developer.hashicorp.com/vault` **200** · `aps.autodesk.com` **200** · `google.com/glass/start/` **200** | **verified existence**; the search-shadowing conclusion is **inferred** |
| Re-verification of key L7b signals | PyPI `aristo` **404** (free-signal) · PyPI `zeno` **200** (taken) · Docker Hub user `zeno` **404** (free) · Docker Hub user `aristo` **200** (taken) — all four L7b verdicts reproduce | **verified** |

## 11. ACCESS LIMITATIONS

- **All limitations recorded in L7b §5 carry forward unchanged and are not restated in full here** — most importantly the **total failure of all five primary trademark registers**, the Justia 403s, X.com HTTP 402, JS-gated YouTube, login-walled Instagram, npmjs.com web UI 403, and the deliberate avoidance of the GitHub API under this program's rate-limit rule.
- All L7a dead links carry forward: `iep.utm.edu/zenocit/` 404, `plato.stanford.edu/entries/aristo-chios/` 404 (**no SEP entry for Aristo of Chios exists**), Britannica 403 on Cato/Athena/Zeus, `cato.org/about` 403, `sni.org` DNS failure.
- **`.ai`, `.app` and `.dev` status remains non-authoritative** — no working RDAP endpoint was found for those TLDs in either pass. `seneca.ai` and `athena.ai` remain **unclear**, not free.
- **Not checked in any pass:** Google Play (no open search API), Homebrew casks, Maven, NuGet, RubyGems, Go module paths, Chrome Web Store, and — a real gap for a coding-agent family — the **VS Code Marketplace** publisher namespace.
- **Vendor and press claims were not independently audited:** Athena Intelligence's shipped-feature dates, Cato Networks' Gartner/GigaOm placements, the Zeno funding rounds, and all product capability descriptions are reproduced as **claimed**.
- The Ai2/Aristo status finding in §10 comes from a **search summary**, not from a fetched Ai2 project page; treat the leadership detail as `verified via secondary` rather than from a primary Ai2 source.
- No login, paywall bypass, or CAPTCHA solve was attempted at any point. No domain, handle, package name or account was registered or reserved. No money was spent.

## 12. Exact queries and fetches run by this synthesis pass

**WebSearch (verbatim):**
1. `Allen Institute for AI Aristo project status 2026 allenai.org aristo reasoning`
2. `"Aristo" trademark Aristo Graphic Systeme drawing instruments class 9 EU registration`

**WebFetch (verbatim):**
- `https://schneiderpen.com/uk/blog/changes-at-aristo-and-standardgraph`

**Direct HTTP GETs (curl, status/JSON only):**
- `https://rdap.verisign.com/com/v1/domain/{useseneca,senecahq,usezeno,zenohq,getaristo,aristohq}.com`
- `https://rdap.verisign.com/com/v1/domain/{zzqxnonexistentbrandtest,google}.com` *(control test)*
- `https://rdap.verisign.com/net/v1/domain/{zeno,seneca,aristo}.net`
- `https://pypi.org/pypi/{aristo,zeno}/json`
- `https://hub.docker.com/v2/users/{zeno,aristo}/`
- `https://developer.hashicorp.com/vault` · `https://aps.autodesk.com/` · `https://www.google.com/glass/start/`

---

*Compiled 2026-08-24 by the Phase-0A brand-gate fan-in worker. Read-only. Primary inputs: L7a-brand-sources.md and L7b-brand-collisions.md, both read in full.*
***This report is not legal clearance. No trademark clearance has been performed.***
