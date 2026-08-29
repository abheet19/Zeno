# L7c — Trademark Register Evidence (re-run)

**Compiled:** 2026-08-24 · **Scope:** ZENO, SENECA, CATO, ARISTO, ATHENA, ZEUS · **Classes:** Nice 9 (downloadable software), 42 (SaaS / software design), 45 (where relevant)
**Method:** read-only public HTTP. No logins, no CAPTCHA solving, no paywalls, no filings, no spend.

---

> # ⚠ THIS IS PRELIMINARY EVIDENCE AND IS **NOT** TRADEMARK CLEARANCE
>
> **No filing decision, launch decision, or spend may rest on this document.**
>
> This is a mechanical exact-string search of one aggregator's index, restricted to three Nice classes. It does **not** test likelihood of confusion, does **not** cover phonetic/visual near-marks (ZENO/XENO/ZENON, ATHENA/ATENA), does **not** cover common-law/unregistered rights, does **not** cover the ~170 jurisdictions outside the offices sampled, and does **not** verify current maintenance status against the source register. A mark absent from this document may still block you. **A licensed trademark attorney must run a real clearance search before any public use, filing, or spend.**

---

## 1. Register reachability — correcting the prior finding

The prior document (`L7b-brand-collisions.md`, line 12) states that *"Every primary trademark register (USPTO, WIPO, EUIPO, UK IPO, IP India) was **unreachable** during this scan."* **That claim is false and this section retracts it.** Five of six registers returned HTTP 200, and one of them — TMview — served complete structured search results and full ST.66 record detail over plain unauthenticated `curl`, with no browser session.

| # | Register | URL fetched | HTTP | Results without a browser session? | Exact limitation |
|---|---|---|---|---|---|
| 1 | **TMview (EUIPO/TMDN)** | `https://www.tmdn.org/tmview/` → `POST https://www.tmdn.org/tmview/api/search/results` | **200** | ✅ **YES — fully.** JSON search API + XML detail API both open | **None material.** Detail endpoint `GET /tmview/api/trademark/data/{ST13}` returns HTTP **406** unless `Accept` is `*/*`, `application/xml`, or `text/xml` (`text/html` → 406). Serves ST.66 XML, not JSON. |
| 2 | **USPTO — TSDR API** | `https://tsdrapi.uspto.gov/ts/cd/casestatus/sn97102641/info.xml` | **401** | ❌ No | Verbatim body: *"Beginning October 2, you'll need to register for an API key to download bulk data from our TSDR APIs. Register for an API key at https://account.uspto.gov/api-manager/. Learn more about this new requirement at https://developer.uspto.gov/api-catalog."* Key registration = account creation → **out of scope under read-only rules.** |
| 3 | **USPTO — tmsearch UI** | `https://tmsearch.uspto.gov/` | **200** | ❌ No | Site is fully up (125,660 B). It is an Angular SPA served from S3 and fronted by **AWS WAF** (`a434627cf98f.edge.sdk.awswaf.com/…/challenge.js` in the page head). `POST /api-v1-0-0/tmsearch` → **405 MethodNotAllowed** with an S3 `<Error>` body, i.e. that host is object storage, not the API. No API base URL is present in `main.js` (1.88 MB). Needs a WAF-challenged browser session. **US data was obtained via TMview instead.** |
| 4 | **WIPO Global Brand Database** | `https://branddb.wipo.int/` ; `https://branddb.wipo.int/en/quicksearch?q=zeno` | **200** | ❌ No | Site up. Search path serves an **Altcha CAPTCHA** interstitial: `<script async defer src="https://cdn.jsdelivr.net/npm/altcha/dist/altcha.min.js" type="module">` with `let uuid="1787593870502|Rs4IvbTm5yHrOk3s6LoJLKjIllUp7CyIDaSR1r3yGgk"; let redirect = "/en/quicksearch"; let hash_search = localStorage.getItem("gbd.hashSearches");`. **CAPTCHA not attempted, per operating rules.** `POST /api/search` returns the SPA HTML shell (`<title>Global Brand Database</title>`, build 2026-04-27), not an API. |
| 5 | **EUIPO eSearch** | `https://euipo.europa.eu/eSearch/` ; `#basic/1+1+1+1/100+100+100+100/zeno` | **200** | ❌ No | Site up (12,989 B) but serves only the static shell; the query lives in the URL **fragment**, which is never sent to the server, so a plain GET can never return results. Backend probes (`/copla/trademark/data/…`, `/eSearch/api/search?text=…`) drop the connection (curl exit code 0/HTTP 000). **EUIPO data was obtained via TMview office code `EM`.** |
| 6 | **UK IPO** | `https://trademarks.ipo.gov.uk/ipo-tmtext` | **403** | ❌ No | Site is up but returns a **785,788-byte bot-protection CAPTCHA interlock page** under HTTP 403 (body contains `Captcha`). Not a server outage — an anti-bot gate. **CAPTCHA not attempted.** **UK data was obtained via TMview office code `GB`.** |
| 7 | **IP India** | `https://tmrsearch.ipindia.gov.in/tmrpublicsearch/` | **200** | ❌ No | Site up (14,043 B), `<title> - Trade Mark - PublicSearch</title>`. Page embeds a **CAPTCHA** control (ASP.NET WebForms postback). **CAPTCHA not attempted.** **India data was obtained via TMview office code `IN`.** |

**Net verdict:** *one* register (TMview) is fully machine-readable without a session, and because TMview aggregates EUIPO, UK IPO, IP India, WIPO Madrid **and** USPTO, the four CAPTCHA-gated national front-ends did **not** actually block the evidence — their data was reachable through the aggregator. The prior "all registers unreachable" conclusion collapsed *"the search UI is JS/CAPTCHA-gated"* into *"the register is down"*, and abandoned a line of evidence that was in fact open.

### TMview API contract (as reverse-engineered and verified)

```
POST https://www.tmdn.org/tmview/api/search/results
Content-Type: application/json
Referer: https://www.tmdn.org/tmview/
{"page":"1","pageSize":"100","criteria":"E","basicSearch":"<term>",
 "fNiceClass":["9","42","45"],"fOffices":["US","EM","GB","IN","WO"],
 "fTMStatus":["Registered"]}
→ {"tradeMarks":[…],"page":1,"totalPages":N,"totalResults":N}
```
`criteria`: `E` = exact, `C` = contains, `W` = word-ish. (`S`/`A` are rejected.) Verified control: `criteria:"C"` on *zeno* → 4,909 hits; `criteria:"E"` → 711. Status vocabulary observed in the US slice: `Registered` (live), `Filed` (pending), `Ended` (dead).

```
GET https://www.tmdn.org/tmview/api/trademark/data/{ST13}
Accept: */*            ← text/html returns 406
→ ST.66 XML incl. <GoodsServicesDescription> full text
```

---

## 2. Volume overview (TMview, `criteria=E`, exact word, accessed 2026-08-24)

Counts are **records matching the exact string in Nice classes 9/42/45**, across all TMview offices unless noted.

| Name | All classes, all offices | Cl 9 | Cl 42 | Cl 45 | Cl 9/42/45 | US | EUIPO | UK IPO | IP India | Madrid (WO) |
|---|---|---|---|---|---|---|---|---|---|---|
| ZENO | 711 | 92 | 53 | 9 | 131 | 18 | 8 | 12 | 4 | 5 |
| SENECA | 493 | 66 | 43 | 11 | 83 | 14 | 10 | 14 | 0 | 2 |
| CATO | 4,543 | 347 | 273 | 87 | 602 | 50 | 49 | 42 | 5 | 8 |
| ARISTO | 845 | 140 | 35 | 9 | 171 | 16 | 16 | 11 | 4 | 15 |
| ATHENA | 1,912 | 355 | 228 | 36 | 529 | 127 | 42 | 58 | 7 | 20 |
| ZEUS | 2,593 | 472 | 195 | 27 | 611 | 101 | 51 | 48 | 9 | 15 |

**US live/dead split, classes 9/42/45** (all string matches incl. compounds like DATATHENA, SITEZEUS):

| Name | Registered (live) | Filed (pending) | Ended (dead) | Total |
|---|---|---|---|---|
| ZENO | 7 | 4 | 7 | 18 |
| SENECA | 4 | 0 | 10 | 14 |
| CATO | 18 | 2 | 30 | 50 |
| ARISTO | 3 | 0 | 13 | 16 |
| ATHENA | **27** | **12** | 88 | 127 |
| ZEUS | **37** | 4 | 60 | 101 |

**Bare word mark only** (mark text is exactly the candidate, compounds excluded), live + pending, classes 9/42/45:

| Name | US live+pending | of which US reg. | US pending | in Cl 9 | in Cl 42 | EUIPO+UK live+pending |
|---|---|---|---|---|---|---|
| ZENO | 8 | 6 | 2 | 6 | 4 | 10 |
| SENECA | 2 | 2 | 0 | 2 | 1 | 11 |
| CATO | 8 | 6 | 2 | 4 | 3 | 8 |
| ARISTO | 1 | 1 | 0 | 0 | 1 | 12 |
| **ATHENA** | **25** | **19** | **6** | **18** | **7** | **27** |
| **ZEUS** | **25** | **21** | **4** | **15** | **9** | **28** |

---

## 3. Per-name findings

### 3.1 ZENO — the Class 042 lead is **CONFIRMED**, and it is not alone

The prior scan's unconfirmed lead was ZENO, Zeno Technologies Inc., serial 97102641, Class 042. **Confirmed — but it is the least dangerous of four.**

| Mark | Owner | Juris. | Class(es) | Status | Filed / Reg. | Reg. no. | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|---|---|
| **ZENO** *(stylized)* | **Zeno Technologies, Inc.** | US | **042** | **Registered (LIVE)** | 2021-11-01 / **2023-07-11** | **7103057** | "Software as a service (saas) services, featuring software platforms for **energy-related data aggregation and reserve economics modeling**" | [ST13 US500000097102641](https://www.tmdn.org/tmview/api/trademark/data/US500000097102641) |
| **ZENO** *(word)* | **PRONTO.AI, INC.** | US | **042** | **Registered (LIVE)** | 2022-03-30 / 2023-10-31 | 7208869 | "Providing temporary use of a non-downloadable cloud-based (saas) software for use in autonomous and non-autonomous **fleet management** systems **utilizing artificial intelligence and machine learning**" | [ST13 US500000097339310](https://www.tmdn.org/tmview/api/trademark/data/US500000097339310) |
| **ZENO** *(word)* | **Quantum Generative Materials, LLC** | US | **009 + 042** | **Registered (LIVE)** | 2023-06-28 / **2026-01-27** | 8119139 | Cl 9: "…downloadable computer software **using artificial intelligence and machine learning tools** for simulation, discovery, design…of materials; **downloadable computer software development tools**" · Cl 42: "…providing temporary use of non-downloadable software using artificial intelligence and machine learning tools…" | [ST13 US500000098063795](https://www.tmdn.org/tmview/api/trademark/data/US500000098063795) |
| ZENO *(word)* | Zeno Power Systems, Inc. | US | 009, 011, **042** | **Pending — published for opposition** | 2025-09-19 / — | — | Cl 9 "Nuclear batteries"; Cl 42 "…provisioning of operating software for radioisotope power systems…" | [ST13 US500000099402438](https://www.tmdn.org/tmview/api/trademark/data/US500000099402438) |
| ZENO *(word)* | AB Sciex Pte. Ltd. | US / EM / GB | 009 | Registered | 2022-04-25 | 7862861 (US) / EM 018754627 | mass-spectrometry instrumentation software | TMview `fOffices:["US","EM","GB"]` |
| ZENO *(word)* | Anker Innovations Limited | US / EM / GB | 007, 009, 010 | US pending; EM/GB registered | 2024-01-22 | EM 018974224 | consumer-electronics hardware/software | TMview |
| ZENO *(word)* | **ZERORAMP LTD** | GB | **009 + 042** | **Pending** ×2 | **2026-04-29** | UK00004380808, UK00004380802 | (detail not pulled) | TMview `fOffices:["GB"]` |
| ZENO *(word)* | Zeno Group Ltd | GB | 009, 041 | Registered | 2025-09-02 | UK00004258202 | PR agency extending into Cl 9 | TMview |

**Answer to the ZENO question.** The Class 042 mark is real, live, and registered — reg. **7103057**, Zeno Technologies Inc., filed 2021-11-01, registered 2023-07-11, a **stylized-character** mark (not a plain word mark), and its recitation is narrowly confined to **energy data aggregation and reserve economics modeling**. On its own it would be a moderate obstacle. But the search turned up **three more live/pending US ZENO records in Class 42** the prior scan missed, and two are worse:

- **PRONTO.AI's ZENO** is a plain **word mark**, live, in Class 42, explicitly reciting **AI and machine-learning SaaS** — same class, same technology, adjacent field.
- **Quantum Generative Materials' ZENO** registered on **2026-01-27** (seven months ago) across **both** Class 9 and Class 42, and its Class 9 recitation ends with the clause **"downloadable computer software development tools"** with *no field-of-use qualifier attached to that clause*. For a product family that includes a **coding agent**, that is a direct-overlap risk in the exact goods description.
- Two **fresh GB filings by ZERORAMP LTD (2026-04-29)** sit in **Cl 9 + 42** — evidence the name is being actively contested right now, not just historically registered.

### 3.2 ATHENA — crowding quantified; it is the worst or joint-worst of the six

**How many live marks sit in Classes 9/42/45:** In the **US**, 127 exact-string records in classes 9/42/45, of which **27 registered + 12 pending = 39 live/pending**. Restricted to the **bare word ATHENA**: **19 registered + 6 pending = 25 live**, split **18 in Class 9** and **7 in Class 42**. Across **EUIPO + UK IPO**, a further **27 live/pending bare-word ATHENA** records in the same classes. This is a genuinely saturated register position — not a name with one or two obstacles but a name where the software classes are already parcelled out among ~25 unrelated US owners.

**Most senior live owners (US, classes 9/42/45):**

| Mark | Owner | Class | Status | Filed / Reg. | Reg. no. | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|---|
| A ATHENA | ATHENA DIAGNOSTICS, INC. | 042 | Registered | 1997-05-07 / 1998-12-15 | 2210331 | (medical diagnostics services) | TMview US |
| **ATHENA** | **Athena Controls, Inc** | **009** | **Registered** | **2001-12-12** / 2002-12-17 | **2662711** | — | TMview US |
| ATHENA | Rockwell Collins Control Technologies | 009 | Registered | 2005-03-10 / 2006-04-11 | 3079220 | — | TMview US |
| ATHENA | Athena Law Group LLP | **045** | Registered | 2008-01-11 / 2008-08-12 | 3484504 | legal services | TMview US |
| **ATHENA** | **OPEN TEXT CORPORATION** | **042** | **Registered** | **2012-03-28** / 2013-11-19 | **4434663** | "Providing temporary use of non-downloadable software for business document exchanges via global computer and communications networks" | [ST13 US500000085582982](https://www.tmdn.org/tmview/api/trademark/data/US500000085582982) |
| ATHENA | Athena LLC | 009, 035 | Registered | 2016-03-29 / 2018-04-17 | 5445790 | "Computer application software for desktop computers, smart phones, tablet computers…for visualizing and analyzing business-related aspects of data…" | [ST13 US500000086957217](https://www.tmdn.org/tmview/api/trademark/data/US500000086957217) |
| ATHENA | AgYield LLC | 042 | Registered | 2016-06-15 / 2020-03-10 | 6008186 | — | TMview US |
| ATHENA | Integrated Computer Systems, Inc. | 042 | Registered | 2018-01-08 / 2018-08-07 | 5535599 | — | TMview US |
| ATHENA | Athena Labs LLC | 009, 035, 041 | Registered | 2021-10-20 / 2023-05-02 | 7040043 | — | TMview US |

**The most decision-relevant ATHENA marks are the pending ones, and they are aimed squarely at this product category:**

| Mark | Owner | Class | Status | Filed | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|
| **ATHENA** | **Athena Labs LLC** | **041 + 042** | Pending | 2023-09-08 | Cl 42: "Non-downloadable software **using artificial intelligence tools** for use in recruiting, training, vetting and matching **executive assistants** to business professionals" · Cl 41: "…implementation of artificial intelligence tools to **accomplish personal and professional goals and tasks**" | [ST13 US500000098171714](https://www.tmdn.org/tmview/api/trademark/data/US500000098171714) |
| **ATHENA** | **Spartan Companies 300, LLC** | **009 + 042** | Pending | 2025-12-09 | "**Downloadable virtual assistant software using artificial intelligence (ai)** for use in database management and electronic storage and recall of data in the construction industry…" (and the Cl 42 mirror) | [ST13 US500000099538740](https://www.tmdn.org/tmview/api/trademark/data/US500000099538740) |
| ATHENA | L2 Solutions, LLC | 042 | Pending | 2022-10-26 | "Providing on-line non-downloadable software **using artificial intelligence** for use in machine learning, namely, deep learning, reinforcement learning…data modeling and analytics…" | [ST13 US500000097649160](https://www.tmdn.org/tmview/api/trademark/data/US500000097649160) |
| **ATHENA** | **Chainguard, Inc.** | **042** | Pending | **2026-06-15** | "Providing use of online non-downloadable software for the analysis, validation, creation, and delivery of non-disclosed patches prior to any public vulnerability disclosure…" | [ST13 US500000099885872](https://www.tmdn.org/tmview/api/trademark/data/US500000099885872) |
| AMAZON ATHENA | Amazon Technologies, Inc. | 042 | Pending | 2023-12-20 | — | TMview US |

**Athena Labs LLC's pending Class 42 recitation — "AI tools…for executive assistants" and "AI tools to accomplish personal and professional goals and tasks" — is the closest recitation to a personal-assistant product found anywhere in this scan.** Separately, **Chainguard, Inc.** — a well-known developer-tooling/software-supply-chain company — filed ATHENA in Class 42 only **two months ago (2026-06-15)**, meaning the name is being actively claimed in the developer-tools space right now.

**One notable negative result:** **Athena Intelligence** (`athenaintel.com`, the competitor shipping an AI agent called Athena, flagged in L7b) appears to hold **no US trademark registration or application for ATHENA**. Sweeping all 355 US exact-ATHENA records across all classes for an applicant containing "Intelligence" or "Olympus" returned only `76712438 ATHENA — Olympus Seed Treatment Formulator, Inc — status Ended`. *Inferred:* they are operating on **unregistered common-law rights**. That does not reduce risk — common-law rights can still support an infringement claim and can block registration — but it does mean the register does not show them, and any clearance opinion must reach outside the register to assess them.

### 3.3 SENECA — **material correction: the prior "no software hit" finding was wrong**

L7b stated: *"no exact-word software hit surfaced"* and graded SENECA the "quietest of the crowded names". **Refuted.**

| Mark | Owner | Juris. | Class | Status | Filed / Reg. | Reg. no. | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|---|---|
| **SENECA** | **FlowPatterns** | **US** | **009 + 042** | **Registered (LIVE)** | 2021-10-29 / **2026-05-12** | **8253883** | Cl 9: "Downloadable **business process control software for business project and operations management**; downloadable business project management software…" · Cl 42: "Business technology software consultation services; providing temporary use of non-downloadable business process control software…" | [ST13 US500000097099415](https://www.tmdn.org/tmview/api/trademark/data/US500000097099415) |
| SENECA | FlowPatterns | EM / GB | 009, 035, 042 | Registered | 2022-04-21/22 | EM 018690655, UK00003779846 | (EU/UK counterparts of the above) | TMview |
| SENECA | Monotype Imaging Inc. | US / EM / GB | 009 | Registered | 1999-08-27 / 2000-08-29 | 2381277 | "…computer software in the field of desktop publishing; computer software downloadable from global computer information networks for generation of typefaces and fonts" | [ST13 US500000075787318](https://www.tmdn.org/tmview/api/trademark/data/US500000075787318) |
| SENECA | Seneca Business Software GmbH | EM | 009, 035, 042 | Registered | 2011-11-23 | EM 010440444 | business software | TMview EM |
| SENECA | Seneca Learning Ltd | GB / EM | 009, 041, 042 | Registered ×4 | 2017-03-02 → 2019-09-19 | UK00003216128, EM 018126389 et al. | edtech software | TMview |
| SENECA | SENECA PARTNERS LIMITED | GB | 016, 035, 036, 038, 041, 042 | Registered | 2014-06-05 | UK00003058438 | — | TMview GB |

SENECA's US position is thin (**2** bare-word live records in 9/42/45) but the one that matters — **FlowPatterns, reg. 8253883, registered three months ago on 2026-05-12** — covers **downloadable business project/operations management software in Class 9 and the SaaS mirror in Class 42**, with **no narrow field-of-use limiter**. That is broad business-productivity software, which is what a personal-assistant product is. In **EUIPO/UK the position is much worse**: **11** live bare-word records, including a dedicated **Seneca Business Software GmbH** registration in Cl 9/35/42 and four **Seneca Learning Ltd** registrations in Cl 9/41/42.

### 3.4 ARISTO — **material correction: an AI-research Class 42 registration exists**

L7b stated: *"no exact-word live Class 9/42 hit surfaced."* **Refuted.**

| Mark | Owner | Juris. | Class | Status | Filed / Reg. | Reg. no. | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|---|---|
| **ARISTO** | **The Allen Institute for Artificial Intelligence** | **US** | **042** | **Registered (LIVE)** | 2018-03-22 / **2019-05-07** | **5747088** | "**Advanced product research in the field of artificial intelligence**" | [ST13 US500000087846082](https://www.tmdn.org/tmview/api/trademark/data/US500000087846082) |
| ARISTO | ESAB AB | EM / GB | 009 | Registered | 1996-04-01 | EM 000096990 | welding equipment | TMview |
| ARISTO | NIVO Holding GmbH | EM / GB | 035, 038, 041, **042** | Registered | 2015-04-21 | EM 013973219 | — | TMview |
| ARISTO | Aristo Pharma GmbH | EM | 005, 009, 010, 044 | Registered ×2 | 2020-12-23 | EM 018362852/5 | pharma | TMview |
| ARISTO | Hangzhou IECHO Science & Technology | EM / GB | 007, 009, 016, 037 | Registered | 2013-03-20 | EM 011671864 | — | TMview |
| ACUITY ARISTO | FUJIFILM Corporation | US | 007, 009 | Registered | 2025-01-09 | 8387615 | — | TMview US |

ARISTO is the **cleanest of the six in the US** — exactly **one** bare-word live record in classes 9/42/45. But that one record is held by **AI2 (the Allen Institute for AI)** in **Class 42** for **"advanced product research in the field of artificial intelligence"** — the same field as the product. AI2's ARISTO is a well-known QA/reasoning research system, so this is a live mark, in-class, in-field, held by a prominent AI institution. In **EUIPO/UK, ARISTO has 12** live bare-word records in 9/42/45, so the EU position is not clean.

### 3.5 CATO

| Mark | Owner | Juris. | Class | Status | Filed | Reg. no. | Notes / goods excerpt | Source |
|---|---|---|---|---|---|---|---|---|
| CATO | CATO OF TEXAS, L.P. | US | 042 | Registered | 1986-05-08 | 1424401 | most senior US Cl 42 CATO | TMview US |
| CATO | THE S2 SAFETY & INTELLIGENCE INSTITUTE | US | 035–045 incl. **042, 045** | Registered | 2016-10-07 | 5439086 | very broad services span | TMview US |
| CATO | Cato of Texas L.P. | US | 009, 014, 016, 018, 020, 025, 026 | Registered ×3 | 2010–2017 | 4054848, 5639861, 6236108 | apparel/retail portfolio incl. Cl 9 | TMview US |
| CATO | Katu Electronics (Kunshan) Co., Ltd. | US | 009 | Registered | 2019-07-17 | 6097763 | — | TMview US |
| **CATO** | **Cato Supply, Inc.** | US | **042** | **Pending (published)** | 2024-04-18 | — | "**Software as a service (saas) services** featuring software for connecting buyers and sellers to supply chain management service providers" | [ST13 US500000098507805](https://www.tmdn.org/tmview/api/trademark/data/US500000098507805) |
| CATO | Activar Construction Products Group | US | 009 | Pending | 2024-10-29 | — | — | TMview US |
| CATO | Cato Software Solutions GmbH | EM / GB | **042**, 044 | Registered | 2004-09-22 | EM 004040994 | a literally-named *software* company holding CATO in Cl 42 | TMview |
| CATO | CATO Sozietät für Kommunikationsberatung GmbH | EM / GB | 035, 041, 042 | Registered | 2009-09-25 | EM 008616427 | — | TMview |
| CATO | AZMB S.r.l. | EM | **009 + 042** | **Pending** | **2026-07-14** | — | filed six weeks ago | TMview EM |

CATO returns the **largest raw volume of any candidate** (4,543 exact matches all-classes; 602 in classes 9/42/45) but most is compound noise (STACCATO, XICATO, MARCATO, ECOMPLICATO, BD CATO). Bare-word live US records in 9/42/45: **8**. The notable obstacles are **Cato Software Solutions GmbH** (EU, Cl 42, since 2004), **Cato Supply Inc.** (US Cl 42 SaaS, published) and a brand-new EU filing by **AZMB S.r.l.** in Cl 9 + 42 (2026-07-14). Not surfaced in this class-restricted bare-word search but noted in L7b and independently relevant: **Cato Networks** operates a large security-software business under a CATO-formative mark.

### 3.6 ZEUS — **material correction: an exact-product-category filing exists**

| Mark | Owner | Juris. | Class | Status | Filed / Reg. | Reg. no. | Goods/services excerpt | Source |
|---|---|---|---|---|---|---|---|---|
| **ZEUS** | **MySALT AI Inc.** | **US** | **042** | **Pending** | **2026-05-28** | — | "Providing online non-downloadable software for **orchestrating and dispatching tasks to multiple artificial intelligence agents**; software as a service (saas) services featuring software that **interprets natural-language user instructions, plans ordered multi-step workflows, and routes execution to specialized downstream autonomous agents including desktop control, browser automation, and document retrieval agents**; cloud computing featuring artificial intelligence software for centralized routing of…" | [ST13 US500000099850945](https://www.tmdn.org/tmview/api/trademark/data/US500000099850945) |
| ZEUS | ZEUS COMPANY LLC | US | 006, 017, **040, 042** | Registered ×3 | 2010–2021 | 4196611, 6607677, 7045946 | polymer/industrial | TMview US |
| ZEUS | Arrow Electronics, Inc. | US | 035, **042** | Registered | 2012-04-05 | 4300387 | — | TMview US |
| ZEUS | KNITT LLC | US | **042** | Registered ×2 | 2025-01-17 | 8106704, 8106705 | — | TMview US |
| ZEUS | Fidelis Sustainability Distribution, LLC | US | 042 | Registered | 2020-03-05 | 6616015 | — | TMview US |
| ZEUS | Coulter Ventures, LLC | US | 028, 042 | Registered | 2017-12-12 | 5875270 | — | TMview US |
| ZEUS | Activision Publishing, Inc. | US | 009 | Registered | 2000-04-10 | 2521219 | — | TMview US |
| ZEUS | Parsons Corporation | US | 009 | Registered | 2018-10-12 | 5918033 | — | TMview US |
| ZEUS | Snap-on Incorporated | US | 009 | Registered | 2018-05-17 | 5586352 | — | TMview US |
| ZEUS | Zeus CC8 Inc | US | 016, 025, 028, 035, 042 | Pending | 2025-06-11 | — | — | TMview US |
| THE WASHINGTON POST ZEUS | WP Company LLC | US | 042 | Registered ×2 | 2019 | 6997018, 6997028 | — | TMview US |
| ZEUS | Brunswick Corporation | EM / GB | 007, 009, 012 | Registered | 2009-01-13 | EM 007517428 | — | TMview |

ZEUS is joint-worst on volume with ATHENA (**25** bare-word live US records in 9/42/45; **9** of them in Class 42; **28** more in EUIPO/UK). More importantly, **MySALT AI Inc.'s pending Class 42 application (filed 2026-05-28, three months ago) recites almost exactly the product described in this brief** — an AI agent orchestrator that parses natural-language instructions, plans multi-step workflows, and dispatches to desktop-control, browser-automation and document-retrieval agents. **This is the single closest goods/services match to the intended product found anywhere in this scan, under any of the six names.**

---

## 4. Risk re-grade

Grades reflect only what was verified above. Change is measured against L7b's preliminary grades.

| Name | L7b grade | **Re-graded** | Change | One-line reason |
|---|---|---|---|---|
| **ZEUS** | (not graded ≥HIGH) | **SEVERE** | ⬆ **RAISED** | A pending US Class 42 application by MySALT AI Inc. (2026-05-28) recites AI-agent orchestration, natural-language instruction parsing and multi-step workflow dispatch — the product itself — on top of 25 live bare-word US records in the software classes. |
| **ATHENA** | SEVERE | **SEVERE** | = unchanged | 25 live bare-word US records in Cl 9/42/45 (18 in Cl 9, 7 in Cl 42) plus 27 in EU/UK; pending Athena Labs Cl 42 covers "AI tools…for executive assistants…to accomplish personal and professional goals and tasks", and Chainguard filed ATHENA in Cl 42 two months ago. |
| **ZENO** | HIGH | **HIGH** | = confirmed, basis strengthened | Class 042 lead confirmed (reg. 7103057, LIVE) and joined by three more live/pending US Cl 42 ZENOs — including PRONTO.AI's AI/ML SaaS word mark and Quantum Generative Materials' Cl 9 covering unqualified "downloadable computer software development tools". |
| **SENECA** | (quietest / lower) | **HIGH** | ⬆ **RAISED** | L7b's "no exact-word software hit" is refuted: FlowPatterns holds US reg. 8253883 (registered 2026-05-12) over downloadable business project/operations-management software in Cl 9 **and** the Cl 42 SaaS mirror, with EU/UK counterparts and 11 live bare-word EU/UK records. |
| **CATO** | (adjacent-class only) | **MODERATE–HIGH** | ⬆ slightly raised | Cato Software Solutions GmbH has held CATO in EU Class 42 since 2004; Cato Supply's US Cl 42 SaaS application is published; a new EU Cl 9+42 filing landed 2026-07-14 — so the software classes are occupied, not merely adjacent. Political/retail baggage from L7b still applies. |
| **ARISTO** | (no software hit) | **MODERATE** | ⬆ **RAISED** (still best of six) | Cleanest US position of the six (one bare-word live record in 9/42/45), but that record is the Allen Institute for AI's Class 42 registration (reg. 5747088) for "advanced product research in the field of artificial intelligence" — in-class and in-field — and EU/UK carry 12 more live bare-word records. |

**No name graded LOW.** Every one of the six has at least one live or published registration in Class 9 or Class 42.

---

## 5. What remains unknown

Requiring a **browser session** (WAF/CAPTCHA-gated; not attempted under the read-only rules):

1. **USPTO's own live status and prosecution history.** TMview's `Registered`/`Filed`/`Ended` is an aggregator normalization refreshed on TMview's own cycle. It does **not** distinguish a registration that is live-and-maintained from one that is **past a missed §8/§9 deadline but not yet purged**, nor does it show Office Actions, §2(d) refusals, oppositions, or assignments. Confirming true live status requires **TSDR**, which now needs an API key (account creation), or the AWS-WAF-gated `tmsearch.uspto.gov` UI.
2. **Owner names on detail records.** The ST.66 XML returned by TMview did not populate the applicant element in the parser used here; owner names in this document come from the **search index**, not the detail record, and were not cross-checked against the register.
3. **WIPO Global Brand Database** — Altcha CAPTCHA. Madrid-system and national coverage beyond TMview's offices is therefore unverified; only TMview's `WO` slice (5–20 records per name) was seen.
4. **UK IPO, IP India, EUIPO eSearch native interfaces** — CAPTCHA / JS-fragment gated. Their data was read **through TMview**, which may lag the national registers and may omit fields.
5. **TMview's own coverage boundary** was never established — which offices it indexes, and how current each feed is, was not verified. Counts here are lower bounds.

Requiring a **professional search** (outside the reach of any automated string query):

6. **Phonetic and visual near-marks.** Only exact strings were searched. ZENO/XENO/ZENON/ZENNO, ATHENA/ATENA/ATHINA, SENECA/SENECCA, ZEUS/ZEVS were **not** searched, and near-marks are where most §2(d) refusals originate.
7. **Likelihood-of-confusion analysis.** Whether "SaaS for energy reserve economics modeling" (Zeno Technologies) is legally related to a personal-assistant SaaS is a judgment call no count can answer. Several marks found here are narrowly field-limited and may or may not be true obstacles.
8. **Common-law / unregistered rights.** Demonstrated to matter: **Athena Intelligence ships an AI agent named Athena and appears in no US register**. Unregistered use by others under all six names is entirely unmeasured.
9. **Classes outside 9/42/45** — e.g. Class 35 (business services) and Class 38 (telecoms), both plausible for a meeting-copilot product, were not searched.
10. **Jurisdictions outside US/EU/UK/IN/WO**, and the state-level US registers.

---

## 6. Exact queries and URLs fetched

**Reachability probes** (all `GET`, 2026-08-24):
```
https://tmsearch.uspto.gov/                                  → 200 (125660 B)
https://tmsearch.uspto.gov/main.js                           → 200 (1884921 B)
https://branddb.wipo.int/                                    → 200 (1697 B)
https://branddb.wipo.int/en/quicksearch?q=zeno               → 200 (Altcha CAPTCHA interstitial)
https://www.tmdn.org/tmview/                                 → 200 (531 B)
https://euipo.europa.eu/eSearch/                             → 200 (12989 B)
https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/zeno → 200 (static shell)
https://trademarks.ipo.gov.uk/ipo-tmtext                     → 403 (785788 B, CAPTCHA page)
https://tmrsearch.ipindia.gov.in/tmrpublicsearch/            → 200 (14043 B, CAPTCHA control)
https://tsdrapi.uspto.gov/ts/cd/casestatus/sn97102641/info.xml → 401 (API key required)
https://developer.uspto.gov/api-catalog                      → 301 → https://data.uspto.gov/home
```
**Failed backend probes** (recorded so they are not re-attempted):
```
POST https://tmsearch.uspto.gov/api-v1-0-0/tmsearch          → 405 MethodNotAllowed (S3 XML error)
POST https://branddb.wipo.int/api/search                     → 200 but returns SPA HTML shell
GET  https://euipo.europa.eu/copla/trademark/data/zeno       → connection dropped (HTTP 000)
GET  https://euipo.europa.eu/eSearch/api/search?text=zeno    → connection dropped (HTTP 000)
GET  https://www.tmdn.org/tmview/api/trademark/{ST13}        → 404
GET  https://www.tmdn.org/tmview/api/trademark/data/{ST13}  with Accept: text/html → 406
```

**TMview search queries** — `POST https://www.tmdn.org/tmview/api/search/results`, `Referer: https://www.tmdn.org/tmview/`:

1. Criteria calibration: `{"criteria":"E|C|W|S|A","basicSearch":"zeno","pageSize":"5"}` (E=711, C=4909, W=811; S and A rejected)
2. Filter calibration: `fNiceClass:["42"]` (53) · `fNiceClass:[42]` (53) · `fNiceClass:"42"` (rejected) · `fOffices:["US"]` (105) · `fTMStatus:["Registered"]` (365) · `fOffices:["US"]+fNiceClass:["42"]` (7)
3. Per-name class counts, for each of `zeno|seneca|cato|aristo|athena|zeus`:
   `{"criteria":"E","basicSearch":"<name>"}` and the same with `fNiceClass` = `["9"]`, `["42"]`, `["45"]`, `["9","42","45"]`
4. Per-office counts: the above `["9","42","45"]` query with `fOffices` = `["US"]`, `["EM"]`, `["GB"]`, `["IN"]`, `["WO"]`
5. Full US harvest (paged, `pageSize:"100"`): `{"criteria":"E","basicSearch":"<name>","fNiceClass":["9","42","45"],"fOffices":["US"]}` → 18/14/50/16/127/101 records
6. Full EU+UK harvest: same with `fOffices":["EM","GB"]` → 20/24/91/27/100/99 records
7. Applicant sweep for Athena Intelligence: all pages of `{"criteria":"E","basicSearch":"athena","fOffices":["US"]}` (355 records), filtered for applicant containing "Intelligence" or "Olympus"

**TMview detail records fetched** — `GET https://www.tmdn.org/tmview/api/trademark/data/{ST13}`, `Accept: */*`:
```
US500000097102641  ZENO   Zeno Technologies, Inc.
US500000097339310  ZENO   PRONTO.AI, INC.
US500000098063795  ZENO   Quantum Generative Materials, LLC
US500000099402438  ZENO   Zeno Power Systems, Inc.
US500000085582982  ATHENA Open Text Corporation
US500000086957217  ATHENA Athena LLC
US500000097649160  ATHENA L2 Solutions, LLC
US500000098171714  ATHENA Athena Labs LLC
US500000099538740  ATHENA Spartan Companies 300, LLC
US500000099885872  ATHENA Chainguard, Inc.
US500000087846082  ARISTO The Allen Institute for Artificial Intelligence
US500000097099415  SENECA FlowPatterns
US500000075787318  SENECA Monotype Imaging Inc.
US500000098507805  CATO   Cato Supply, Inc.
US500000099850945  ZEUS   MySALT AI Inc.
```

**Web search run:** `USPTO trademark search API tmsearch.uspto.gov public JSON endpoint documentation 2026`

---

*Compiled 2026-08-24. Read-only scan. No accounts created, no logins performed, no CAPTCHAs solved or bypassed, no paid services used, no marks filed or reserved, nothing installed.*

> **Reminder: this document is preliminary evidence, not trademark clearance. No filing decision may rest on it.**
