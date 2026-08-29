# L4 — Design Evidence Research (Phase 0A)

**Worker:** L4 (design lane)
**Access date for every row below unless otherwise stated:** **2026-08-24** (all fetches performed this date, Asia/Kolkata evening)
**Target:** an ORIGINAL dark-first "3D glass" design system spanning (P1) personal assistant + command center, (P2) coding workspace, (P3) meeting overlay. Windows pilot first; macOS as the eventual reference-quality target.
**Method:** read-only public-source research. No logins, no paywall bypass, no asset/CSS/shader scraping. Patterns abstracted to text only. Apple documentation was read through the site's own public DocC JSON endpoints (`/tutorials/data/…`) because the HTML pages are client-rendered and return only `<head>` to a plain fetch.

## Evidence labels used in every row

| Label | Meaning |
|---|---|
| **verified** | I read the primary source at the exact URL on the access date and the claim is stated there. |
| **claimed** | Vendor marketing / vendor help-desk assertion, not independently checkable. |
| **inferred** | My reasoning from verified facts. Explicitly not a source claim. |
| **unknown** | Could not establish from public sources. |
| **excerpt-only** | The official URL is correct but direct fetch was blocked; text comes from a search-engine excerpt **of that official page**. Treated as weaker than *verified*. |

> **This document is not legal clearance.** Every license/IP note below is a research note about published license text, not a legal opinion. Anything that would ship needs counsel review.

---

## ACCESS LIMITATIONS (recorded, not worked around)

| # | Resource | What happened | Consequence |
|---|---|---|---|
| AL-1 | `https://help.runwayml.com/hc/en-us/articles/...` (Runway Agent, Workflows) | **HTTP 403** to WebFetch *and* to curl with a desktop browser UA. Bot protection. | Runway Agent + Workflows rows are **excerpt-only**, from search-engine excerpts of the official help URLs. Not upgraded to *verified*. |
| AL-2 | `https://www.notion.com/help/review-and-approve-plans-before-notion-ai-runs` | HTTP 200 but serves the generic **Notion AI hub page**, not the named article. `/help/notion-agent` also lacked plan-mode text. | Notion Plan-mode row is **excerpt-only**. |
| AL-3 | `https://developer.apple.com/design/human-interface-guidelines/*` and `/documentation/technologyoverviews/*` | Client-rendered SPA; plain HTML fetch returns `<head>` only. | Resolved by using Apple's own JSON: HIG at `/tutorials/data/design/human-interface-guidelines/<page>.json`, DocC at `/tutorials/data/documentation/<path>.json`. Content is *verified* (same origin, same content the page renders). |
| AL-4 | `.../swiftui/view/glasseffect(_:in:isenabled:).json` | **HTTP 404** (symbol-path encoding). | `View.glassEffect` availability not directly confirmed; `GlassEffectContainer` JSON **was** retrieved and carries the platform matrix. |
| AL-5 | `https://m3.material.io/styles/motion/overview` | Client-rendered; no content returned. | **Material 3 motion tokens / reduced-motion guidance NOT verified. Excluded from the matrix rather than guessed.** |
| AL-6 | `https://carbondesignsystem.com/elements/color/overview/` | Content truncated / client-rendered. | **IBM Carbon dark-theme layering NOT verified. Excluded.** Only its LICENSE (Apache-2.0) was verified via raw.githubusercontent. |
| AL-7 | `https://docs.warp.dev/agents/permissions` | **HTTP 404**. | Current paths are `/agent-platform/agent/using-agents/agent-profiles-permissions` and `/agents/capabilities/agent-profiles-permissions/`; both fetched successfully. |
| AL-8 | `https://support.claude.com/en/articles/9945119-using-artifacts-to-create-and-manage-content` | **HTTP 404**. | Superseded by `9487310-what-are-artifacts-and-how-do-i-use-them`, which was fetched. |
| AL-9 | SF Symbols License Agreement full text | Ships inside the SF Symbols app; not published as a standalone public page I could fetch. | Restriction quoted **excerpt-only** via developer.apple.com search excerpt. Flagged for counsel. |
| AL-10 | WCAG "general flash and red flash thresholds" definition | My extraction isolated the SC text but not the threshold definition block. | SC 2.3.1 text is *verified*; the numeric flash-threshold definition is **unknown** here and must be read at `https://www.w3.org/TR/WCAG22/#dfn-general-flash-and-red-flash-thresholds` before any flashing/pulsing motion is specified. |
| AL-11 | Zera Software Studio | Only marketing/portfolio/terms pages exist; no engineering or design documentation. | Section 5 is principles-only by necessity, as instructed. |
| AL-12 | GitHub API | Not used at all (per worker rules). All license checks used `raw.githubusercontent.com/<org>/<repo>/<branch>/LICENSE`. | No 403/429 encountered. |
| AL-13 | Bash tool | Temporarily unavailable early in the session ("classifier rate-limited"); recovered. | No data loss; retried. |

---

## INDEX — disposition at a glance

| ID | Reference | Disposition |
|---|---|---|
| A1 | Apple — Liquid Glass technology overview | **Adapt** (principles) / **Reject** (name & trade dress) |
| A2 | Apple — Adopting Liquid Glass | **Adapt** |
| A3 | Apple — `UIDesignRequiresCompatibility` | **Adopt** (as a scheduling fact) |
| A4 | Apple HIG — Materials | **Adopt** (rules) / **Reject** (visual copying) |
| A5 | SwiftUI — `GlassEffectContainer` | **Adapt** (batching principle) |
| A6 | Apple HIG — Panels / HUD-style | **Adopt** for P3 meeting overlay |
| A7 | Apple HIG — The Menu Bar (menu bar extras) | **Adopt** for P1 macOS surface |
| A8 | Apple HIG — Notifications | **Adapt** |
| A9 | Apple HIG — Accessibility (Reduce Motion list) | **Adopt** (hard floor) |
| A10 | Apple HIG — App Icons / Icon Composer | **Adapt** (layered-depth method) |
| A11 | Apple font + SF Symbols licenses | **Reject** (cannot use) — blocking IP finding |
| B1 | Claude Code — Artifacts page constraints | **Adopt** (Gate-2 medium constraints) |
| B2 | claude.ai Artifacts — storage / MCP / AI-powered | **Adopt** |
| B3 | Claude Design — get started | **Adopt** (beta caveats) |
| B4 | Claude Design — design system setup | **Adopt** |
| C1 | Runway Agent — ask-before-generation + cost preview | **Adopt** (interaction concept) |
| C2 | Runway Workflows — DAG, single-node run, lock, history | **Adopt** (interaction concept) |
| C3 | Runway MCP — commercial, credit-metered | **Reject** as a dependency; **Adopt** the metering-transparency idea |
| D1 | Linear — agents in Linear (delegation) | **Adopt** |
| D2 | Linear — Agent Interaction Guidelines (session/activity model) | **Adopt** — strongest agent-progress vocabulary found |
| D3 | Warp — agent permissions | **Adapt** (with one safety correction) |
| D4 | Cursor — Plan Mode | **Adopt** |
| D5 | Raycast — AI surfaces | **Adapt** |
| D6 | Granola — no-bot capture + enhance | **Adopt** for P3 |
| D7 | Wispr Flow — hold-to-talk / hands-free | **Adapt** for P1 voice |
| D8 | Figma AI — credits, First Draft limits | **Adapt** (cautionary) |
| D9 | Notion — Plan mode | **Adopt** |
| D10 | Perplexity — inline citations + streaming sources | **Adopt** |
| D11 | ChatGPT desktop — Work with Apps | **Adapt** |
| E1 | Zera Software Studio | **Reject** (proprietary) / **Adapt** principles only |
| F1 | WCAG 2.2 | **Adopt** (binding floor) |
| F2 | Core Web Vitals | **Adopt** (web/Electron surfaces only) |
| F3 | Apple Reduce Motion guidance | **Adopt** (binding floor) |
| F4 | `prefers-reduced-motion` / `prefers-reduced-transparency` baseline | **Adopt** with correction |
| F5 | NN/g progress-indicator thresholds | **Adopt** |
| G1 | Windows 11 Mica | **Adopt** — primary Windows material |
| G2 | Windows 11 Acrylic | **Adapt** — transient surfaces only |
| G3 | Electron `backgroundMaterial` / `vibrancy` | **Adopt** (implementation seam) |
| G4 | MDN `backdrop-filter` Baseline + backdrop-root | **Adopt** |
| G5 | WebGPU baseline status | **Adapt** (progressive enhancement only) |
| G6 | Radix Colors — 12-step + APCA | **Adopt** (scale architecture) |
| G7 | Vercel AI Elements | **Adapt** (vocabulary, not code) |
| G8 | NN/g — AI Agents as Users | **Adopt** |
| G9 | three.js / R3F / shadcn-ui licenses | **Adopt** (IP-clean route to real 3D) |

---

# SECTION 1 — Apple current Liquid Glass documentation + HIG

### The headline answer to "what is actually PUBLIC API in 2026, and what is the fallback story?"

**Public API: yes, broadly.** Liquid Glass is exposed as first-class public API across SwiftUI, UIKit and AppKit — `View.glassEffect(_:in:)`, `GlassEffectContainer`, `PrimitiveButtonStyle.glass` / `.glassProminent`, `View.backgroundExtensionEffect()`, `View.scrollEdgeEffectStyle(_:for:)`, `ToolbarSpacer`, `ConcentricRectangle`; `UIGlassEffect`, `UIButton.Configuration.glass()/.prominentGlass()/.clearGlass()/.prominentClearGlass()`, `UIBackgroundExtensionView`, `UICornerConfiguration`, `UIScrollEdgeElementContainerInteraction`; `NSGlassEffectView`, `NSButton.BezelStyle.glass`, `NSBackgroundExtensionView`. (verified — A2)

**OS availability: 26.0 across the board.** `GlassEffectContainer` declares **iOS 26.0, iPadOS 26.0, Mac Catalyst 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0** (verified — A5). `UIDesignRequiresCompatibility` declares **iOS/iPadOS/macOS/tvOS 26.0+** (verified — A3).

**Fallback story: there is essentially none, and the escape hatch has an expiry.** Apple documents no automatic pre-26 fallback for the new look; the only documented lever is the `UIDesignRequiresCompatibility` Info.plist key, and Apple states **"The system ignores this key when you build for iOS 27 or later, iPadOS 27 or later, Mac Catalyst 27 or later, macOS 27 or later, or tvOS 27 or later."** (verified — A3). Degradation is therefore *sideways* (accessibility settings strip effects) not *backwards* (older OS).

---

### A1 — Apple: Liquid Glass technology overview

- **Exact URL:** `https://developer.apple.com/documentation/technologyoverviews/liquid-glass` (read via `https://developer.apple.com/tutorials/data/documentation/technologyoverviews/liquid-glass.json`)
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Liquid Glass is described as "a new dynamic material… which combines the optical properties of glass with a sense of fluidity." Standard framework components "pick up the appearance and behavior of this material automatically"; custom elements can opt in. The page is a landing/hub — it carries **no** API names, **no** version numbers, **no** accessibility settings, and **no** performance guidance. It links five WWDC25 sessions (219 "Meet Liquid Glass", 284 UIKit, 310 AppKit, 323 SwiftUI, 356 "Get to know the new design system") and the Landmarks sample.
- **Which product/state:** Sets the *conceptual frame* for the whole system: a floating functional layer over a content layer. Applies to P1 command center chrome, P2 workspace chrome, P3 overlay.
- **Originality / IP + license:** "Liquid Glass" is Apple's product/design-system name and its rendering is Apple trade dress. **Do not name our material "Liquid Glass", do not reproduce Apple's specular/refraction signature, do not ship screenshots of Apple UI as our own reference art.** Sample code (Landmarks) is under Apple's sample-code license — not evaluated; do not vendor it.
- **Accessibility / performance:** none stated on this page (that's a finding, not an omission on my part).
- **Disposition:** **Adapt** the layer-separation principle; **Reject** the name and the visual signature.
- **Rationale:** This page is the correct citation for "there is an official 2026 material language and it is a *layer* concept, not a decoration", which is exactly the defensible thing to borrow.

### A2 — Apple: Adopting Liquid Glass

- **Exact URL:** `https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Four load-bearing instructions:
  1. **"Avoid overusing Liquid Glass effects… Limit these effects to the most important functional elements in your app."**
  2. **"Check for crowding or overlapping of controls… avoid overcrowding or layering Liquid Glass elements on top of each other."**
  3. **"Combine custom Liquid Glass effects to improve rendering performance"** — via a `GlassEffectContainer`, "which helps optimize performance while fluidly morphing Liquid Glass shapes into each other."
  4. **"Test your interface with a variety of display and accessibility settings… people can choose a preferred look for Liquid Glass in their device's settings, or turn on accessibility settings that reduce transparency or motion… These settings can remove or modify certain effects."** Standard components adapt automatically; **custom elements do not** and must be tested.
  Also: tvOS Liquid Glass requires **Apple TV 4K (2nd gen) or newer**; "On older devices, your app maintains its current appearance." watchOS picks up changes without rebuilding.
- **Which product/state:** Every glass surface in all three products; especially P3 meeting overlay (most tempting to over-glass) and P2 coding workspace (dense controls → crowding risk).
- **Originality / IP + license:** Guidance text is Apple copyright — paraphrase, don't lift. The *rules* themselves are not protectable.
- **Accessibility / performance:** This is the single best-sourced perf principle available: **batch glass surfaces into one render pass; don't stack them.** And a hard a11y truth: **custom glass is not covered by system adaptation.**
- **Disposition:** **Adapt** — encode as three system laws: (a) glass budget per screen, (b) never glass-on-glass, (c) one container/one composite pass per glass cluster.
- **Rationale:** These are the only *quantifiable-adjacent* constraints Apple publishes, and they map 1:1 onto our GPU budget on a Windows pilot machine of unknown spec (B-002 still open).

### A3 — Apple: `UIDesignRequiresCompatibility`

- **Exact URL:** `https://developer.apple.com/documentation/BundleResources/Information-Property-List/UIDesignRequiresCompatibility`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Boolean. `YES` → "compatibility mode… displays the app as it looks when built against previous versions of the SDKs." Absence or `NO` is the default for apps linking the latest SDKs. **Availability: iOS 26.0+, iPadOS 26.0+, macOS 26.0+, tvOS 26.0+.** Warning: **"Temporarily use this key while reviewing and refining your app's UI."** And: **"The system ignores this key when you build for iOS 27 or later… macOS 27 or later, or tvOS 27 or later."**
- **Which product/state:** Only matters if/when a native macOS or iOS build exists (macOS is the "eventual reference-quality target").
- **Originality / IP:** None — it's a plist key.
- **Accessibility / performance:** n/a.
- **Disposition:** **Adopt** as a planning fact.
- **Rationale:** It kills the "we'll opt out of the new design language indefinitely on Apple platforms" option. Any macOS-native track must be designed *for* the 26+ material model, with a schedule assumption that the opt-out is gone at 27.

### A4 — Apple HIG: Materials

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/materials` (JSON: `.../tutorials/data/design/human-interface-guidelines/materials.json`)
- **Access date:** 2026-08-24. Page change log: **"September 9, 2025 — Updated guidance for Liquid Glass"**, "June 9, 2025 — Added guidance for Liquid Glass".
- **Observed pattern + evidence:** *verified.* The rules that matter for a glass design system:
  - Two material families: **Liquid Glass** (functional layer: controls + navigation, floats above content) and **standard materials** (structure *within* the content layer).
  - **"Don't use Liquid Glass in the content layer."** Exception: transient interactive elements (sliders, toggles) take on the glass appearance *while being manipulated*.
  - **"Use Liquid Glass effects sparingly… overusing this material in multiple custom controls can provide a subpar user experience by distracting from that content."**
  - **Two variants:** **regular** — "blurs and adjusts the luminosity of background content to maintain legibility… Use the regular variant when background content might create legibility issues, or when components have a significant amount of text, such as alerts, sidebars, or popovers." **clear** — "highly translucent… Use this variant for components that float above media backgrounds — such as photos and videos."
  - **Dimming rule for clear glass:** "If the underlying content is bright, consider adding a dark dimming layer of **35% opacity**." Not needed if content is already dark or if AVKit playback controls supply their own dimming.
  - Variant appearance changes "in response to certain system settings, like… accessibility settings that reduce transparency or increase contrast."
  - Scroll edge effects "further enhance legibility by blurring and reducing the opacity of background content."
- **Which product/state:** P1 command palette + sidebar (regular), P2 editor chrome (regular; content pane must NOT be glass), P3 overlay over shared screen/video (clear + dimming layer).
- **Originality / IP + license:** Rules are unprotectable; the *rendered look* is Apple's. Our system must derive its own tint/noise/edge recipe. Note also Apple's HIG art is copyrighted — don't reuse images.
- **Accessibility / performance:** The 35% dimming rule is the most directly reusable **legibility floor** I found anywhere. "Regular for text-heavy surfaces" is effectively a contrast-preservation rule that we can test against WCAG 1.4.3 (F1).
- **Disposition:** **Adopt** the rule set verbatim-as-behavior; **Reject** the visual reproduction.
- **Rationale:** It gives us a two-variant token architecture (`glass.regular` / `glass.clear` + `scrim.35`) that is defensible, testable, and independent of Apple's rendering.

### A5 — SwiftUI: `GlassEffectContainer`

- **Exact URL:** `https://developer.apple.com/documentation/swiftui/glasseffectcontainer`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **Platforms: iOS 26.0; iPadOS 26.0; Mac Catalyst 26.0; macOS 26.0; tvOS 26.0; watchOS 26.0.** "A view that combines multiple Liquid Glass shapes into a single shape that can morph individual shapes into one another." "SwiftUI renders the effects together, **improving rendering performance** and allowing the effects to interact with and morph into one another." Container `spacing` controls how early neighbouring shapes blend.
- **Which product/state:** The architectural analogue for our toolbar clusters, the P1 command-center dock, and the P3 overlay control cluster.
- **Originality / IP:** API name is Apple's; the *technique* (single composite pass for a cluster of translucent shapes) is a standard graphics practice.
- **Accessibility / performance:** Confirms, from Apple's own API docs, that **N separate blurred surfaces cost more than one merged surface.** This is the strongest available justification for a "glass cluster" primitive in our system rather than per-element glass.
- **Disposition:** **Adapt.**
- **Rationale:** Directly transferable to CSS/Electron: one `backdrop-filter` root per cluster, children painted on top, instead of one per control (see G4 — backdrop roots make the naive approach *also* visually wrong).

### A6 — Apple HIG: Panels (HUD-style)

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/panels`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* macOS-only ("Not supported in iOS, iPadOS, tvOS, visionOS, or watchOS"). A HUD is a panel whose "appearance is darker and translucent." Restraint rules: **"Prefer standard panels… use a HUD only: in a media-oriented app…; when a standard panel would obscure essential content; when you don't need to include controls — with the exception of the disclosure triangle, most system-provided controls don't match a HUD's appearance."** Plus **"Use color sparingly in HUDs. Too much color in the dark appearance of a HUD can be distracting… you need only small amounts of high-contrast color to highlight important information."** And **"Keep HUDs small… Don't let a HUD obscure the content it adjusts."**
- **Which product/state:** **P3 meeting overlay** — this is the single closest official precedent for what a meeting overlay *is*.
- **Originality / IP:** Guidance only; NSPanel is macOS API. Nothing to copy visually.
- **Accessibility / performance:** "Use color sparingly… small amounts of high-contrast color" is a dark-first accent-budget rule that aligns with WCAG 1.4.11 (3:1 for UI components) rather than fighting it.
- **Disposition:** **Adopt** as the P3 design contract.
- **Rationale:** It pre-answers the biggest P3 risk: an overlay that grows into a second app. Apple's own guidance says HUDs shouldn't carry many controls and shouldn't get large — which is exactly the discipline a meeting overlay needs.

### A7 — Apple HIG: The Menu Bar (menu bar extras)

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/the-menu-bar`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* "A menu bar extra exposes app-specific functionality using an icon that appears in the menu bar when your app is running, even when it's not the frontmost app." **"The menu bar's height is 24 pt."** Critical constraints: **"When necessary, the system hides menu bar extras to make room for app menus. Similarly, if there are too many menu bar extras, the system may hide some."** **"Display a menu — not a popover — when people click your menu bar extra."** **"Let people — not your app — decide whether to put your menu bar extra in the menu bar."** **"Avoid relying on the presence of menu bar extras… you can't be sure which other menu bar extras people have chosen to display or predict the location of your menu bar extra."** Suggests a Dock menu as an always-available complement.
- **Which product/state:** P1 command center's macOS always-on surface; also the "is the assistant listening?" indicator for P3.
- **Originality / IP:** None.
- **Accessibility / performance:** 24 pt height is a hard layout constraint; combined with WCAG 2.5.8 (24×24 CSS px minimum target, F1) a menu-bar-extra icon is *exactly at* the target-size floor — no room for a multi-control strip up there.
- **Disposition:** **Adopt** — and **Reject** any design that makes the menu bar extra load-bearing.
- **Rationale:** Corrects a very common assumption ("we'll live in the menu bar"): Apple explicitly says the system may hide it and you may not rely on it. Every menu-bar affordance needs a redundant path.

### A8 — Apple HIG: Notifications

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/notifications`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **"Use an alert — not a notification — to display an error message."** Notifications may appear as "a banner or view on a Lock Screen, Home Screen, Home View, or desktop." Sound is supplementary: "don't rely on it to communicate important information, because people may not hear it." Long-look notifications can use interruptible SwiftUI animations.
- **Which product/state:** P1 briefing/nudges; P2 long-running-task completion; P3 "meeting starting / recording state changed".
- **Originality / IP:** None.
- **Accessibility / performance:** "Don't rely on sound" is a direct multi-channel requirement; pairs with WCAG 1.4.1-style non-colour redundancy for our agent-state indicators.
- **Disposition:** **Adapt.**
- **Rationale:** Gives a clean split for our notification taxonomy: errors → modal/inline alert, progress → in-app surface, ambient → OS notification. Prevents the failure mode where an agent's failures are delivered as easily-missed toasts.

### A9 — Apple HIG: Accessibility (Reduce Motion + contrast table)

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/accessibility`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Apple's own contrast table: **≤17 pt any weight → 4.5:1; 18 pt any weight → 3:1; any size Bold → 3:1.** "If your app doesn't provide this minimum contrast by default, ensure it at least provides a higher contrast color scheme when the system setting Increase Contrast is turned on… check the minimum contrast in both light and dark appearances."
  Reduce Motion best-practice list (verbatim bullets):
  - "Tightening animation springs to reduce bounce effects"
  - "Tracking animations directly with people's gestures"
  - **"Avoiding animating depth changes in z-axis layers"**
  - **"Replacing transitions in x-, y-, and z-axes with fades to avoid motion"**
  - **"Avoiding animating into and out of blurs"**
  Also: "Allow people to opt out of flashing lights in video playback" (Dim Flashing Lights setting).
- **Which product/state:** Every animated state in all three products; especially the "glass materialises" entrance we would otherwise reach for.
- **Originality / IP:** None.
- **Accessibility / performance:** **This is the most consequential row in the document for a "3D glass" system.** "Avoiding animating into and out of blurs" and "avoiding animating depth changes in z-axis layers" together outlaw the two signature moves of glassmorphic motion under Reduce Motion. Our reduced-motion variant cannot be "the same animation, slower" — it must be *fade-only, blur-static, depth-static*.
- **Disposition:** **Adopt** as a hard floor.
- **Rationale:** It converts the §4-default requirement ("reduced-motion/high-contrast variants always") from a checkbox into a concrete spec: two motion tiers where tier-2 changes only opacity, never blur radius, never z-translation.

### A10 — Apple HIG: App Icons / Icon Composer

- **Exact URL:** `https://developer.apple.com/design/human-interface-guidelines/app-icons`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Layered icons "take on Liquid Glass attributes like specular highlights, refraction, and translucency" applied **by the system**. Design rules: **"Let the system handle blurring and other visual effects… there's no need to include specular highlights, drop shadows between layers, beveled edges, blurs, glows… custom effects are static, whereas the system supplies dynamic ones."** **"Prefer clearly defined edges in foreground layers… avoid soft and feathered edges."** **"Vary opacity in foreground layers to increase the sense of depth."** **"Consider basing your icon design around filled, overlapping shapes."** **"Prefer vector graphics… (such as SVG or PDF)."** Appearance variants: default, dark, clear, tinted — "the system automatically generates variants you don't provide"; keep core features consistent across them.
- **Which product/state:** Product marks and in-app iconography for all three; the *method* also generalises to our surface design.
- **Originality / IP:** Icon Composer is an Apple tool for Apple-platform icons; its outputs are for Apple platforms. Do not use it to author Windows assets.
- **Accessibility / performance:** Vector-first + no baked effects = smaller assets, crisper at all DPI, and appearance variants are cheap. "Avoid extremely thin line weights and sharp corners" protects small-size legibility.
- **Disposition:** **Adapt** — as our **depth authoring method**: express depth as *separated, opaque-authored, hard-edged layers with per-layer opacity*, and let the runtime apply highlight/refraction, rather than painting glass into artwork.
- **Rationale:** This is the most original-safe way to get "3D" without imitating anyone: the depth lives in a layer graph we own, and the optical treatment is a runtime parameter we can dial to zero for Reduce Transparency.

### A11 — Apple system fonts + SF Symbols licensing ⚠ BLOCKING IP FINDING

- **Exact URLs:** `https://developer.apple.com/fonts/` and `https://developer.apple.com/design/resources/`; SF Symbols restriction via `https://developer.apple.com/licensing-trademarks/` search excerpt
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (fonts): the Apple Font license grants use **"solely for creating mock-ups of user interfaces to be used in software products running on Apple's iOS, OS X or tvOS operating systems"**, and expressly: **"The grants set forth in this License do not permit you to… install, use or run the Apple Font for the purpose of creating mock-ups of user interfaces to be used in software products running on any non-Apple operating system."** Also **"You may not embed the Apple Font in any software programs or other products"** and no redistribution. Registered-Apple-Developer requirement stated.
  *excerpt-only* (SF Symbols, AL-9): symbols may not be used "in your app icons, logos, or any other trademark-related use", and the software is "to be used solely for creating user interfaces for software products running on Apple's iOS, iPadOS, macOS, tvOS or watchOS operating systems."
  *verified*: `developer.apple.com/design/resources/` publishes UI Kits (Figma/Sketch/PS/AI), system fonts, SF Symbols (7,000+), Icon Composer and product bezels, and points to the Marketing Resources and Identity Guidelines for bezel use.
- **Which product/state:** Typography and iconography for **all** products — and specifically the **Windows pilot**, which is the first thing we ship.
- **Originality / IP + license:** **We cannot use SF Pro / SF Mono / New York, and cannot use SF Symbols, in a Windows-first product — not in the shipped app, and not even in mock-ups of the Windows UI.** Nor in our logo. Nor may Apple UI Kits be used to author non-Apple UI.
- **Accessibility / performance:** Neutral, but it forces an early typography decision, which is good: an SIL-OFL or Apache-licensed type family chosen on legibility-at-small-size-on-dark grounds, and an icon set we own or license explicitly.
- **Disposition:** **Reject** Apple type/symbols entirely for this program.
- **Rationale:** This is the kind of assumption that silently poisons a design system if it is made in week 1 and discovered in month 6. Flagging it now costs nothing; discovering it later costs a re-skin.

---

# SECTION 2 — Claude Design + Claude Code Artifacts: documented capabilities AND limits

### Direct answer: what interactive prototypes CAN and CANNOT do today

| Question | Answer (2026-08-24) | Source |
|---|---|---|
| Backend? | **No.** "An artifact is a static page. It can't store data submitted through a form or authenticate viewers itself." | B1 (verified) |
| Auth? | **No** self-auth. Connector calls run through **the viewer's** claude.ai account, and claude.ai performs the network call. "The page never sees anyone's credentials." | B1 (verified) |
| Persistence? | **Yes, but only on claude.ai conversation artifacts, and only after publishing.** Pro/Max/Team/Enterprise, web + desktop. "Persistent storage is only available for published artifacts. During development and testing, storage operations will not succeed until the artifact is published." **20 MB per artifact, text-only, personal vs shared storage isolated, unpublishing permanently deletes storage.** Claude **Code** artifacts docs say the opposite for form data — treat Code artifacts as stateless. | B2 (verified), B1 (verified) |
| Size cap? | **Rendered page ≤ 16 MiB** (Claude Code artifacts). Separately, **20 MB** storage cap per artifact (claude.ai storage feature). | B1, B2 (verified) |
| Connector / MCP calls? | **Yes**, and this is the *only* outbound path. Declared at publish time; page can't call undeclared connectors; local `.mcp.json` servers can feed the build but **cannot be called by the published page**. A connector-backed artifact **can't be shared to a public link on any plan.** | B1 (verified) |
| External network? | **No.** Strict CSP blocks scripts/styles/fonts/images from other hosts plus `fetch`, XHR and WebSocket. **Only exception: Google Fonts** (`fonts.googleapis.com` + `fonts.gstatic.com`). | B1 (verified) |
| Routes? | **No.** "Relative links do not resolve… Claude uses in-page anchors rather than separate files." | B1 (verified) |
| File types? | `.html`, `.htm`, `.md` only. | B1 (verified) |

### B1 — Claude Code: "Share session output as artifacts"

- **Exact URL:** `https://code.claude.com/docs/en/artifacts` (fetched as `.../artifacts.md`)
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Beyond the table above: artifacts are versioned, republish to the same URL, and the Share control chooses which version viewers see. Comments require **Claude Code v2.1.221+** and a **Team or Enterprise** plan (only org-shared artifacts take comments); auto-reply requires **v2.1.228+** and stops after **60 sent comments/activations per artifact per hour**. Connector calls require **v2.1.209+**. `/artifacts` listing requires **v2.1.208+**. Artifacts themselves require **CLI v2.1.183+** or desktop **1.13576.0+**, an Anthropic-API-backed claude.ai login (API key / gateway / Bedrock / Vertex / Foundry sessions **cannot** publish), and org policy without CMEK/HIPAA/ZDR. Viewer origin is a sandboxed `*.claudeusercontent.com`. Claude applies a built-in design skill (**v2.1.182+**) and reads a project design system from `CLAUDE.md` or a theme file, with precedence: **prompt > your design system > Claude's own choices**.
- **Which product/state:** This *is* the Gate-2 medium (§4 default #8). It constrains every prototype we will produce for P1/P2/P3.
- **Originality / IP + license:** Anthropic-hosted; content visible only to authenticated members of the publishing org unless shared publicly. Compliance API can list/retrieve/delete. Nothing here restricts *our* design IP.
- **Accessibility / performance:** Two hard implications for a glass system: (1) **all CSS/JS inline, images as data URIs, 16 MiB ceiling** — so heavy raster "glass" backplates are self-defeating; SVG/CSS gradients are the economical path (the docs say exactly this: "Prefer SVG, or HTML and CSS, for diagrams over embedded raster images"). (2) **Google Fonts is the one external host** — our chosen typeface must either be on Google Fonts or be inlined as a `@font-face` data URI, with a real fallback stack.
- **Disposition:** **Adopt** as binding constraints for all Phase-0 design artifacts.
- **Rationale:** Removes ambiguity about what a "prototype" can demonstrate: interaction, motion, states, tokens — yes; real auth, real persistence, real backends — no. Design the demos around that.

### B2 — claude.ai: "What are artifacts and how do I use them?"

- **Exact URL:** `https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Types: documents, code snippets, single-page HTML sites, SVG, diagrams/flowcharts, **interactive React components**. Requires **Settings > Capabilities > Code execution and file creation** on. AI-powered artifacts: "Users of your artifacts can access Claude's intelligence through a text-based API"; **"no API keys required, and no costs to you… Usage counts against each user's own Claude subscription limits, not yours."** MCP integration: Pro/Max/Team/Enterprise, web + desktop; **"Each user must authenticate MCP servers independently"**; org admins can toggle artifact MCP access but "cannot manage which specific MCP servers artifacts can use." Persistent storage as in the table above.
- **Which product/state:** Enables genuinely interactive P1/P2/P3 prototypes with live-feeling AI behaviour, without us standing up infrastructure — matching the $0 Phase-0 budget.
- **Originality / IP:** Anthropic infrastructure; our design content remains ours.
- **Accessibility / performance:** React artifacts inherit the same CSP/no-network posture; interactive artifacts still need keyboard/focus/reduced-motion handling by us — nothing is automatic.
- **Disposition:** **Adopt.**
- **Rationale:** The "each viewer pays with their own subscription" model means a shared design prototype has no marginal cost to us — genuinely useful for a stakeholder review of P1/P2/P3 variants.

**⚠ Documented contradiction between two official Anthropic sources (recorded, not resolved):**
`support.claude.com/en/articles/9487310` states **"Artifacts are available in Claude Code on Team and Enterprise plans"** and **"they can't be shared publicly."** `code.claude.com/docs/en/artifacts` states availability on **"Pro, Max, Team, or Enterprise"** and describes public sharing as the *only* sharing route on Pro/Max. Both read 2026-08-24. *Inferred:* the Claude Code docs page is the more specific and more recently detailed source, but this must be confirmed against the actual account before any plan-dependent commitment. Do not treat either as settled.

### B3 — Claude Design: get started

- **Exact URL:** `https://support.claude.com/en/articles/14604416-get-started-with-claude-design`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **"Claude Design is now available in beta to Pro, Max, Team, and Enterprise plans"**; Enterprise **default off**; web (`claude.ai/design`) and Claude Desktop sidebar only. Chat on the left, canvas on the right. Three editing modalities, explicitly differentiated: **direct canvas manipulation** (drag/resize/align) for visual/aesthetic shifts, **inline comments** for targeted component-level changes, **chat** for structural changes or anything needing explanation. Outputs: dashboards, mobile app flows, landing pages, forms, internal tools, interactive prototypes; responsive across mobile/tablet/desktop. Export: `.zip`, PDF, PPTX, standalone HTML; send to Adobe, Base44, Canva, Gamma, Lovable, Miro, Replit, Vercel, Wix; handoff to Claude Code via local or web agents. Stated limitations: **"Availability: Claude Design is available on web and desktop only"**; **"Multi-person editing: Two or more people editing a design project at the same time is still basic and may not work reliably"**; **"Comment persistence: Inline comments occasionally don't appear on the page"**; **"Large codebases: Consider linking very large repositories from Claude Code to avoid lag or browser issues"**; **"Chat errors: If you hit a 'chat upstream error,' try starting a new chat tab."**
- **Which product/state:** The Gate-2 companion medium alongside Artifacts.
- **Originality / IP:** Beta product; no license implications for our output.
- **Accessibility / performance:** The three-modality split is itself a transferable interaction pattern (see D-section synthesis): **direct manipulation for form, comments for local intent, language for structure.** That maps cleanly onto P2's "edit code directly vs. comment vs. instruct the agent".
- **Disposition:** **Adopt**, with beta caveats logged.
- **Rationale:** The documented flakiness (comments, concurrent editing) means Claude Design should hold *exploration*, while the canonical decided spec lives in a Claude Code artifact or a repo file.

### B4 — Claude Design: set up your design system

- **Exact URL:** `https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Accepts codebases (e.g. a React component library — "link or upload the repository"), prototypes/screenshots/web flows/design files, documents ("PowerPoint or PDF that reflects your brand"), and individual assets (logos, palettes, type specimens). Extracts "reusable components, colors, typography, and patterns", producing colour palettes (primary/secondary/accent), typography specs, UI components (buttons, cards, navigation), and layout patterns/spacing. **No token limits, file-size restrictions or component-count maxima are published** (*unknown*, not "unlimited"). Stated limitation from B3: **"Design system import is only as good as its source. A messy codebase or an incomplete file will show up in the output."**
- **Which product/state:** How our own token set becomes reusable across P1/P2/P3 mockups.
- **Originality / IP:** Only upload assets we own. Do **not** upload Apple UI Kits, competitor design files, or Zera's site as "the design system" — that is precisely how derivative work happens by accident.
- **Accessibility / performance:** Because extraction is source-quality-bound, our tokens should be authored as an explicit, small, correct set (colour ramps, glass tiers, motion tiers, focus ring) rather than scraped from a prototype.
- **Disposition:** **Adopt.**
- **Rationale:** Combined with B1's "record design tokens in `CLAUDE.md`" precedence rule, this gives a single canonical token source that both Claude Design and Claude Code artifacts will honour.

---

# SECTION 3 — Runway MCP / Agent / Workflows (transferable INTERACTION concepts only)

> **Status note, recorded up front:** Runway is a **commercial, credit-metered** product. **"MCP uses your Runway credits, just like the Runway app, and the cost depends on the model, resolution and other settings"** (excerpt-only, AL-1); the MCP announcement says **"generations are tied to your existing Runway plan"** (verified). **We take interaction concepts only. We do not adopt Runway as a dependency, and nothing in Phase 0 spends money (§4 default #9).**

### C1 — Runway Agent: brief → clarifying questions → visible plan → ask-before-generation → cost preview

- **Exact URL:** `https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent`
- **Access date:** 2026-08-24 — **excerpt-only (AL-1: 403 to both WebFetch and curl)**
- **Observed pattern + evidence:** *excerpt-only.* "After submitting your initial message, Agent analyzes your request to build a plan and may ask questions to ensure it generates what you want." **"Agent shows you its plan for each step — including the model, prompt, and estimated credit cost — and waits for your go-ahead before generating."** This behaviour is a **user-settable mode**: **"Ask before generating media"** vs **"Automatically generate"** which "skips the confirmation step." Feedback on the plan is given "directly through the chat for automated updates."
- **Which product/state:** P1 assistant (any action with a real-world side effect), P2 coding workspace (before a multi-file edit or a command), P3 overlay (before posting/sending anything).
- **Originality / IP:** Interaction concept only; no assets, no copy, no visual reference taken.
- **Accessibility / performance:** A pre-execution plan is also an accessibility win: it is text, screen-reader-friendly, and it gives a keyboard-only user a single decisive control instead of racing a running process.
- **Disposition:** **Adopt** the concept; generalise "estimated credit cost" to **"estimated cost of the action"** — for us: tokens/time, files touched, external calls, irreversibility.
- **Rationale:** This is the same shape as Cursor Plan Mode (D4) and Notion Plan mode (D9). Three independent vendors converging on *plan-then-confirm* is the strongest single signal in this entire research lane.

### C2 — Runway Workflows: DAG nodes, single-node runs, node locking, execution history

- **Exact URL:** `https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows` (and `.../45769159004691-Building-your-first-Workflows`, `.../47184761711379-Using-Utility-Nodes-in-Workflows`)
- **Access date:** 2026-08-24 — **excerpt-only (AL-1)**
- **Observed pattern + evidence:** *excerpt-only.* "Nodes are the building blocks within the Workflow Editor, with each node performing a unique function or using a specific generative model." Free pan/zoom canvas; click to move nodes; delete to remove. **Partial rerun:** "Individual nodes can be run to process just that single node… helpful when testing, troubleshooting, or regenerating one part of your pipeline **without rerunning everything**." **Freezing outputs:** "You can freeze a node's output so it won't regenerate on Workflow re-runs by selecting the ellipsis (…) in the top-right corner of the node, and clicking **Lock node**." **Provenance/history:** an **execution history** "lets you easily compare results and **restore any generation** without starting over."
- **Which product/state:** P2 coding workspace (a task graph: intake → context → plan → edit → test → review, with per-stage rerun) and P1 command center (recurring pipelines like briefing generation).
- **Originality / IP:** Node-graph editors are a decades-old, widely implemented idiom (shader graphs, DAW routing, CI pipelines). No exclusivity concern in the *concept*; do not copy Runway's node chrome.
- **Accessibility / performance:** Free-canvas node editors are notoriously bad for keyboard and screen-reader users. **If we adopt a graph, the graph must have a first-class linear/list projection with the same operations** — otherwise it fails 2.1.1 Keyboard and is unusable at high zoom.
- **Disposition:** **Adopt** three primitives: **(a) run-this-node-only**, **(b) lock/pin an output so a rerun can't clobber it**, **(c) execution history with restore**. **Reject** free-canvas-as-the-only-view.
- **Rationale:** (b) is the underrated one. In an agentic coding workspace the expensive failure is "the rerun destroyed the good result." A lock affordance is cheap and directly prevents it.

### C3 — Runway MCP (commercial / credit-based status)

- **Exact URL:** `https://runway.com/news/mcp` (redirected from `runwayml.com/news/mcp`); connector endpoint published as `https://mcp.runwayml.com/mcp`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (announcement): an MCP server that "connect[s] Runway to all of the agents and coding tools you already work in"; models named include Gen-4.5, Seedance 2.0, GPT Image 2, Kling 3.0, Nano Banana Pro; **"generations are tied to your existing Runway plan."** Setup is "add as a custom connector and sign in with existing credentials." **The announcement contains no statement about an approval or confirmation step before generation** — i.e. the ask-before-generation guarantee documented for the Agent surface is *not* documented for the MCP surface.
- **Which product/state:** Cautionary reference for our own MCP/adapter design.
- **Originality / IP:** Commercial product; credit-metered; not adopted.
- **Accessibility / performance:** n/a.
- **Disposition:** **Reject** as a dependency. **Adopt** the negative lesson.
- **Rationale:** The gap between "Agent asks before spending" and "MCP just spends" is exactly the trap our own tool surfaces could fall into: **a guarantee that lives in one UI is not a guarantee.** Cost/consent gating belongs in the adapter layer, not in a single front-end.

---

# SECTION 4 — Current UX patterns from official docs / changelogs / public pages (no logins)

### D1 — Linear: agents in Linear (delegation model)

- **Exact URL:** `https://linear.app/docs/agents-in-linear`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **"Assigning an issue to an agent delegates the issue to that agent while the human teammate remains the primary assignee and owner."** Delegated issues still appear in the human's **My Issues** — "so you maintain visibility and control." Agent user pages show "issue activity and contributions" like a teammate's; custom views and Insights can filter/segment by **Delegate**. Agents **cannot** "sign in to the app, access admin functionality or manage users." The page does **not** describe a stop/pause control (*unknown*).
- **Which product/state:** P1 task delegation; P2 background coding sessions.
- **Originality / IP:** Product behaviour, freely describable; do not copy Linear's visual language.
- **Accessibility / performance:** "Delegated work stays in the human's own list" is a low-cost, high-value pattern — no new surface, no new notification channel.
- **Disposition:** **Adopt.**
- **Rationale:** It solves accountability without inventing UI: the agent never becomes the owner of record. That is exactly the posture a personal assistant suite needs.

### D2 — Linear: Agent Interaction Guidelines — the session/activity model ★ best-in-class

- **Exact URLs:** `https://linear.app/developers/agents`, `https://linear.app/developers/agent-best-practices`, `https://linear.app/developers/aig`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* The **Agent Session** "tracks the lifecycle of a given agent task"; created automatically on mention or delegation. **"Session state is visible to users, and updated automatically based on the agent's emitted activities. No manual state management is required."** Agents emit **five** semantic activity types: **`thought`**, **`action`** (tool call: action name, parameter, optional result), **`elicitation`** (request clarification or confirmation from the user), **`response`** (work complete), **`error`**. Timing contract: **"Emit a `thought` activity within 10 seconds to acknowledge the session has begun"** — **"The first response must be sent within 10 seconds of receiving the `created` event, or the agent will be shown as unresponsive."** Session lifetime: **"Follow-up activities after the first response can still be sent for up to 30 minutes before the session is considered stale."** Also: **"Comments may not be reliable to read from"** — reconstruct conversation from Agent Activities, which are "frozen-in-time snapshots of user input."
- **Which product/state:** **The canonical progress model for P1 and P2, and the state machine our glass "agent card" should render.**
- **Originality / IP:** A published integration contract, intended for third parties to implement against. Adopting the *vocabulary* is normal interoperability; do not copy Linear's UI.
- **Accessibility / performance:** A typed activity stream is inherently accessible: each activity is a labelled region, announceable via `aria-live` at an appropriate politeness, and gives a screen-reader user the same information as the animation does for a sighted user. **The 10-second acknowledgement rule is a concrete, testable latency budget** — and it dovetails with F5 (NN/g: feedback within ~1 s, looped indicator 2–10 s, percent-done beyond 10 s).
- **Disposition:** **Adopt** as our internal agent-progress vocabulary.
- **Rationale:** Of everything surveyed, this is the only source that gives a **typed, time-bounded, user-visible** progress contract. It converts "show a spinner" into a specification. It also names `elicitation` as a first-class state — which is precisely the state our approval UX needs to render distinctly (blocked-on-you, not blocked-on-machine).

### D3 — Warp: agent permission / approval model

- **Exact URL:** `https://docs.warp.dev/agent-platform/agent/using-agents/agent-profiles-permissions` (also served at `/agents/capabilities/agent-profiles-permissions/`; `/agents/permissions` is **404**, AL-7)
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **Six permission categories**, each independently configurable: **Apply code diffs, Read files, Create plans, Execute commands, Interact with running commands, Ask clarifying questions.** **Four autonomy levels:** **"Agent Decides"** — "Agent will act autonomously when it's confident, but prompt for approval when uncertain"; **"Always ask"** — "Agent will request explicit user approval before taking any action"; **"Always allow"** — "Agent will perform the action without ever requesting explicit confirmation"; **"Never"** — "Agent will not ever take the action." The *Ask questions* permission has its own scale: **"Never ask," "Ask unless auto-approve," "Always ask."** Command **allowlist** (regex, e.g. `ls(\s.*)?`) and **denylist** (e.g. `rm(\s.*)?`); **"The denylist takes precedence over both the allowlist and `Agent decides`."** In-session escalation: **"Auto-approve all Agent actions with `CMD + SHIFT + I`"** (`CTRL + SHIFT + I` on Windows/Linux) — and, critically, **this "Run until completion" mode bypasses the denylist unless explicitly disabled in settings.**
- **Which product/state:** **P2 coding workspace approval UX**, and the general consent model for P1 actions.
- **Originality / IP:** Product behaviour; describable. Do not copy Warp's chrome.
- **Accessibility / performance:** A per-category matrix is more accessible than a single "autonomy slider" because each row is an independently labelled, keyboard-reachable control with an explicit value — no hidden semantics.
- **Disposition:** **Adapt** — take the **six-category × four-level matrix** and the **allowlist/denylist with denylist-wins precedence**. **Reject** the one-chord escalation that can override the denylist.
- **Rationale:** Two lessons, one positive and one negative. Positive: *permissions should be typed by action class, not by a global trust level.* Negative: **a "run until completion" chord that silently overrides the user's own denylist inverts the safety model** — the one rule the user wrote down by hand is the one that gets discarded. Our equivalent must make the denylist non-overridable, or at minimum require a distinct, explicit, non-chord confirmation naming what will be bypassed. This is a deliberate divergence from a shipped product, recorded as such.

### D4 — Cursor: Plan Mode

- **Exact URL:** `https://cursor.com/docs/agent/plan-mode` (review/diff: `https://cursor.com/docs/agent/review`; CLI: `https://cursor.com/docs/cli/using`)
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **"Plan Mode creates detailed implementation plans before writing any code."** **"Agent asks clarifying questions to understand your requirements."** The plan is an **editable, persistent artifact**: "review and edit the plan through chat or markdown files"; plans are "saved by default in your home directory", with **"Save to workspace"** to preserve them for team sharing and "future reference, team sharing, and documentation." Entry: **"Press Shift+Tab from the chat input to rotate to Plan Mode"** or the mode picker. Execution: **"Click to build the plan when ready."** In the CLI, terminal commands require approve (`y`) / reject (`n`); review changes with `Ctrl+R`.
- **Which product/state:** P2 coding workspace — this is the closest direct analogue to our TASK→Forge flow.
- **Originality / IP:** Product behaviour; describable.
- **Accessibility / performance:** **The plan-as-a-file idea is the accessibility unlock:** the plan is not a transient panel, it is a document — navigable, searchable, diffable, re-readable, and reviewable in any editor. That serves screen-reader users, users who need more time (2.2.1), and asynchronous review equally.
- **Disposition:** **Adopt.**
- **Rationale:** Converges with C1 and D9. The differentiator worth stealing is *durability*: the plan outlives the session.

### D5 — Raycast: AI surfaces and keyboard-first entry

- **Exact URL:** `https://manual.raycast.com/ai`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Four distinct AI entry points, each with a different commitment level: **Quick AI** — "Ask a one-off question from Root Search"; **AI Chat** — "Start a conversation with Raycast AI"; **AI Commands** — "Turn favorite prompts into one-press commands"; **AI Extensions** — "Talk to extensions, get things done." Keyboard-first throughout (⌘K / Ctrl K search bar); an **Action Panel** is the structured list of what can be done with the current selection. **Bring Your Own Keys** for Anthropic/Google/OpenAI models. Explicit pre-action confirmation for AI Extensions is **not documented on this page** (*unknown*).
- **Which product/state:** **P1 command entry.** The four-tier ladder is the most directly reusable idea here.
- **Originality / IP:** Command-palette + action-panel is an established idiom (Spotlight, VS Code, Slack, Linear). Not exclusive. Do not copy Raycast's visual design.
- **Accessibility / performance:** Root-search-first entry is excellent for keyboard and switch users, and it means the *primary* interaction path never depends on hover, pointer precision, or the glass chrome rendering correctly.
- **Disposition:** **Adapt** the four-tier ladder: **one-off ask → conversation → saved command → tool-using agent**, with escalating confirmation requirements as you move right.
- **Rationale:** It gives a principled answer to "one input box or many?" — one box, four commitment levels, and the level determines how much consent UI appears.

### D6 — Granola: no-bot capture, rough-notes-in / enhanced-notes-out

- **Exact URLs:** `https://www.granola.ai/security`, `https://docs.granola.ai/help-center/consent-security-privacy/getting-consent`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (security page). **"You have to manually start Granola for a meeting (it won't auto-join or auto-record anything)."** **"It does not add a bot to your video call"** — it captures microphone audio and system meeting audio locally. **"Granola doesn't store the audio from meetings — it transcribes in real time on macOS/Windows, or after your meeting using temporarily cached audio on Mobile. It only stores the transcript and any notes you provide from a call."** Notes are "private by default, until you choose to share them"; US-hosted AWS VPC, encrypted at rest and in transit, daily backups; **SOC 2 Type 2**. *claimed* (marketing): the interaction shape — "rough notes in, structured output out… you type short bullets on what matters while you stay present, then click **enhance** once and the AI fills in supporting detail from the full transcript."
- **Which product/state:** **P3 meeting overlay — the whole product thesis.**
- **Originality / IP:** Behaviour and privacy posture; describable. Do not copy Granola's UI or copy.
- **Accessibility / performance:** Two strong implications. (1) **Manual start + no bot** means the overlay's most important state is *"am I capturing?"* — that state must be unmissable, non-colour-dependent, and legible on any background, which argues *against* rendering it in glass. (2) The user's own sparse bullets remaining as the durable spine is a cognitive-load win and a trust win: the human's words are never overwritten.
- **Disposition:** **Adopt** for P3: manual arm, no meeting bot, transcript-not-audio retention, user notes as the immutable spine with AI enrichment as a separate layer.
- **Rationale:** It is the one pattern here that is simultaneously a UX decision, a privacy decision and a consent decision — and it sidesteps the entire "a bot joined the call" social problem.

### D7 — Wispr Flow: hold-to-talk vs hands-free, and the floating indicator

- **Exact URLs:** `https://docs.wisprflow.ai/articles/2772472373-what-is-flow`, `https://docs.wisprflow.ai/articles/9192039587-using-wispr-flow-discreetly-microphone-guide`, `https://wisprflow.ai/data-controls`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Desktop input model: **on Mac press `fn`; on Windows press `Ctrl + Win` together. Hold to dictate, release to stop; double-tap the same keys for hands-free mode.** Mobile: tap once for a hands-free session and tap the checkmark to finish, or hold to push-to-talk; **a cancel option appears after about 3 seconds during a hold.** Surface: "a floating bubble above the on-screen keyboard whenever you focus a text field." Handles "speech as quiet as a whisper," with the caveat that mic proximity governs how quietly you can speak; "Earbuds and AirPods work fine at normal speaking volume but struggle with whispers." Privacy: **Privacy Mode** (dictation data not used for training) and **Cloud Sync** (whether transcripts/audio/history are stored on Wispr servers) are separate, user-controlled switches.
- **Which product/state:** P1 voice entry; P3 whisper-to-assistant during a live meeting.
- **Originality / IP:** Interaction pattern; describable. `fn` / `Ctrl+Win` are OS-level keys, not proprietary.
- **Accessibility / performance:** **Hold-to-talk is a sustained-press gesture** — it must have a tap-toggle equivalent for users who cannot hold a key (this is why the double-tap hands-free mode exists, and we should treat that as mandatory, not optional). The **"cancel appears after ~3 s"** detail is a nice affordance: an escape hatch that doesn't clutter short interactions.
- **Disposition:** **Adapt** — ship both modes from day one, with the toggle mode as the accessible default path; separate "don't train on this" from "don't store this" as two independent controls.
- **Rationale:** Splitting training-consent from storage-consent is a genuinely better privacy model than one blended switch, and it costs nothing to copy the *structure*.

### D8 — Figma AI: credits, First Draft's design-system limit, and an agent migration date

- **Exact URLs:** `https://help.figma.com/hc/en-us/articles/23955143044247-Use-First-Draft-with-Figma-AI`, `https://help.figma.com/hc/en-us/articles/24919293730327-Figma-AI-FAQ`, `https://help.figma.com/hc/en-us/articles/33459875669015` (AI credits)
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (FAQ): "Enabling AI features grants access to AI tools across Figma Design, FigJam, Figma Slides, Figma Buzz, and Figma Sites. It also includes Figma Make." "Some AI features may have limited availability for Education users." The FAQ **defers** credits and content-training details to separate articles (I did not fetch those two → those specifics are *unknown* here). *claimed/excerpt-only* (First Draft article): First Draft uses **Figma-built** wireframing/design libraries as its building blocks, and **"It's not possible to generate designs using your own design system"**; **"Beginning May 20, 2026, Figma's agent will be the new entry point for First Draft"** (agent in beta, rolling out gradually). Figma AI uses a **credit system shared across all Figma AI features**.
- **Which product/state:** Only relevant as a *secondary* medium (§4 default #8: "Figma where useful").
- **Originality / IP + license:** **Material caution:** if First Draft composes from Figma's own libraries and cannot use our design system, then First Draft output is **not** our design system — it is Figma-library-derived geometry wearing our colours. It must not be treated as a source of truth for our tokens or components.
- **Accessibility / performance:** Credit metering means iteration cost is non-zero and variable — bad for the "generate 20 variants" workflow, which pushes exploration back toward Artifacts/Claude Design (free at $0 Phase-0 budget).
- **Disposition:** **Adapt (cautiously)** — Figma for handoff/specimen work, not for generating the system.
- **Rationale:** Prevents a specific, plausible mistake: mistaking generated Figma frames for a design system, then discovering they don't correspond to any real component.

### D9 — Notion: Plan mode (read-only planning, multiple-choice clarifications, plan-as-page)

- **Exact URL:** `https://www.notion.com/help/review-and-approve-plans-before-notion-ai-runs`
- **Access date:** 2026-08-24 — **excerpt-only (AL-2: URL serves the Notion AI hub page instead of the article)**
- **Observed pattern + evidence:** *excerpt-only.* "When you turn on Plan mode, your Notion Agent will ask clarifying questions about what you want, then create a **plan page** describing what it will do." **"Planning is read-only: Notion Agents won't make edits until you approve the plan."** **"To reduce ambiguity, Notion Agent may ask questions before it writes a plan, and sometimes these questions will be multiple choice."** **"Plan pages are regular Notion pages: You can keep them for reference or share them with your team."** Enabled at **Settings → Mode → Plan**.
- **Which product/state:** P1 assistant; P2 workspace; anywhere an agent would mutate the user's data.
- **Originality / IP:** Product behaviour; describable.
- **Accessibility / performance:** **Multiple-choice clarifying questions** are a meaningful a11y and speed improvement over free-text back-and-forth: fewer keystrokes, unambiguous targets, trivially keyboard-navigable, and they impose an upper bound on the clarification loop.
- **Disposition:** **Adopt.**
- **Rationale:** Three properties worth taking together: **planning is a read-only mode** (a guarantee, not a convention), **clarifications are structured** (not an open chat), and **the plan is a first-class object in the user's own workspace** (not a chat bubble).

### D10 — Perplexity: inline citations + progressive source disclosure

- **Exact URLs:** `https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations/README`, `https://www.perplexity.ai/hub/getting-started`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (docs, on the API/streaming shape): answers carry inline numbered references (`[1]`, `[2]`) in the text with corresponding source URLs delivered in a `search_results` output item; the cookbook covers consuming streaming responses, "extract[ing] citations as they arrive, validat[ing] source URLs, and build[ing] a fully cited output"; **"streaming is essential for responsive UIs and long-running searches so you can display text and sources progressively."** *claimed* (marketing): every answer is grounded in real-time web sources "so responses are checkable rather than opaque."
- **Which product/state:** P1 briefing and any assistant answer drawn from the user's own corpus; P2 "why did the agent do this" traces; P3 meeting recall.
- **Originality / IP:** Citation-with-superscript-marker is a scholarly convention, not proprietary.
- **Accessibility / performance:** Two constraints. (1) A bare `[1]` is a poor accessible name — it needs an accessible label naming the source, or the citation is meaningless to a screen-reader user. (2) **Progressive disclosure of sources while text streams is a layout-shift hazard** — sources must be reserved space or appended below, or we break CLS ≤ 0.1 (F2) and cause a visual jolt for everyone.
- **Disposition:** **Adopt** inline provenance markers + a sources rail.
- **Rationale:** Provenance is the single cheapest trust mechanism available, and it is the natural counterpart to Runway's "output history" (C2): *where did this come from* and *which run produced it* are the same user question.

### D11 — ChatGPT desktop: the companion window / Work with Apps

- **Exact URL:** `https://help.openai.com/en/articles/10119604-work-with-apps-on-macos`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* **"To work with your active app, just open the ChatGPT Chat Bar by pressing Option+Space or by clicking the ChatGPT menu bar icon."** Rebindable at **ChatGPT → Settings → Keyboard Shortcut**. A **Work with Apps** button in the ChatGPT window manually connects to apps. Supported apps are an explicit allowlist by category — text editors (Apple Notes, Notion, TextEdit, Quip) and code editors (Xcode; VS Code family including Code, Code Insiders, VSCodium, Cursor, Windsurf; the JetBrains family). Documented gaps: "you can't launch advanced voice mode from the companion window yet and voice mode doesn't yet support code edits." **A single global off switch exists: "You can flip the 'Enable Work with Apps' switch in ChatGPT settings on macOS to fully disable the functionality and remove the icon from the prompt window."**
- **Which product/state:** P1 command center's global invocation; P2's relationship to whatever editor the user is actually in.
- **Originality / IP:** Global-hotkey-summons-a-bar is ubiquitous (Spotlight, Alfred, Raycast, Quicksilver). Not exclusive.
- **Accessibility / performance:** A **rebindable** global shortcut is an accessibility requirement, not a nicety — `Option+Space` may collide with an existing assistive tool. And a **single, discoverable, global kill switch** for a feature that reads other apps' content is the right consent posture; we should match it.
- **Disposition:** **Adapt.**
- **Rationale:** Three transferable rules: rebindable summon, explicit per-app allowlist rather than "reads everything", and one obvious global off switch that also removes the affordance from the UI.

### Cross-cutting synthesis of Section 4 — the convergent patterns

*inferred, from the verified/excerpt-only rows above:*

1. **Plan-then-confirm is the industry consensus.** Cursor (verified), Notion (excerpt-only), Runway (excerpt-only) and Warp's "Create plans" permission (verified) all implement it independently. **Adopt as a system-level law, not a feature.**
2. **The plan should be a durable object.** Cursor saves plans as markdown files; Notion makes them normal pages. Both outlive the session. **Adopt.**
3. **Progress should be typed, not decorative.** Linear's five activity types (verified) + Vercel AI Elements' component vocabulary (G7, verified) agree on roughly the same taxonomy: thought/reasoning, tool call, plan/task, elicitation/confirmation, response, error. **Adopt.**
4. **Approval should be scoped by action class.** Warp's six categories (verified) beat any single autonomy dial.
5. **Motion restraint is near-universal in these docs.** Notably, **none** of Linear's, Cursor's, Warp's, Notion's or Raycast's public docs advertise motion as a feature; the only motion guidance found anywhere in this lane came from Apple (A9) and it is entirely *restrictive*. *inferred:* for this product class, expressive motion is not a differentiator and is a liability under Reduce Motion.
6. **Empty/loading/degraded states are documented mostly as *failure* affordances**, e.g. Claude Code artifacts' guidance to "include a fallback message in each live section that names the connector it needs" so a viewer missing a connection "sees what to connect instead of an empty section" (B1, verified). **Adopt that exact shape: a degraded state must name the missing thing and the action to fix it.**

---

# SECTION 5 — Zera Software Studio (high-level principles only; proprietary)

### E1 — Zera Software Studio

- **Exact URLs:** `https://zerasoftwarestudio.com/`, `https://zerasoftwarestudio.com/portfolio`, `https://zerasoftwarestudio.com/terms`; showcase subdomains observed: `https://portfolio5.zerasoftwarestudio.com/` (Vector Bloom), `https://portfolio7.zerasoftwarestudio.com/`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified* (portfolio page): a named showcase set with one-line descriptions — **Horizon** ("an immersive developer portfolio built around a Three.js 3D planet scene, animated skill islands"), **Vector Bloom** ("a real-time WebGL interactive playground where users orbit a parametric scene"), **Nexus** ("a studio portfolio featuring hand-written GLSL shaders rendered via Three.js"), **Orion** ("a cinematic single-page 3D experience featuring an orbiting planet built with React Three Fiber"), **Specimen** ("an award-winning portfolio featuring a real-time fluid simulation overlaid above all content"), **Aero** ("an interactive particle field experience with a glass morphism loading sequence"), plus Naveera, Reel, Visio, Detail Driven, Delphi Markets. Footer: **"@2026 Zera Studio. All rights reserved"** with Terms and Privacy links. *No* "Lumen Atlas" was found; there **is** a **Nexus** and there **is** a **Vector Bloom** — the seed's "Lumen Atlas/nexus" appears to conflate two things (see Corrections, X-6).
  *verified* (terms, effective 2025-08-20, last updated 2026-07-24): **§5.1** "Upon full payment, the Client shall own rights to the final deliverables." **§5.2** "Zera Studio retains ownership of pre-existing code, proprietary frameworks, libraries, methodologies, and development tools" and may reuse them without restriction. **§5.3** deliverables "may incorporate third-party libraries, APIs, or open-source code subject to their respective licenses." **§20.1** the company may showcase projects in its portfolio unless the client prohibits it in writing. The terms do **not** contain an explicit clause about copying the site's own designs (*unknown* — absence of a clause is not permission).
- **Which product/state:** Aesthetic reference class for "premium 3D/glass web craft"; a useful proof that the look is achievable with an ordinary open-source stack.
- **Originality / IP + license:** **Proprietary. "All rights reserved."** Their shaders, scenes, motion and compositions are their work product and, per §5.2, explicitly retained. **Take nothing but abstract principles.** No screenshots, no timing curves copied from their pages, no shader code, no naming.
- **Accessibility / performance:** *inferred:* continuously animated WebGL/fluid/particle backgrounds behind primary content are the highest-risk pattern in this whole document. They implicate **WCAG 2.2.2 Pause, Stop, Hide (Level A)** — anything moving that starts automatically, lasts >5 s and sits in parallel with other content needs a pause/stop/hide mechanism — and they cost GPU continuously, which on a Windows laptop means fan noise, battery drain and thermal throttling of the *actual work*. This is the opposite of what a productivity suite should do.
- **Disposition:** **Reject** as a template. **Adapt** three principles only: (a) **depth is earned by parallax and layered translucency, not by literal 3D geometry**; (b) **a single hero moment can carry the whole aesthetic** — the rest of the interface stays quiet; (c) **the premium feel comes from edge quality, light behaviour and restraint**, not from motion quantity.
- **Rationale:** The observed stack (three.js, React Three Fiber, GLSL) is entirely MIT-licensed and available to us (G9). What is *theirs* is the specific artistry. Recording that distinction cleanly is what keeps our system original.

---

# SECTION 6 — Accessibility and performance floors

### F1 — WCAG 2.2 (the criteria that actually bind this product class)

- **Exact URL:** `https://www.w3.org/TR/WCAG22/`
- **Access date:** 2026-08-24. **Status: W3C Recommendation, 12 December 2024** (this version: `https://www.w3.org/TR/2024/REC-WCAG22-20241212/`).
- **Observed pattern + evidence:** *verified*, quoted from the normative text:

| SC | **Level** | Normative requirement (abridged, verbatim phrases) | Why it binds a dark glass HUD |
|---|---|---|---|
| **1.4.3 Contrast (Minimum)** | **AA** | text "has a contrast ratio of at least **4.5:1**"; large-scale text **3:1**; logotypes and *inactive* components exempt | Text over any translucent surface must be measured **against the worst-case backdrop**, not the design mock |
| **1.4.11 Non-text Contrast** | **AA** | "**at least 3:1** against adjacent color(s)" for "Visual information required to identify user interface components and **states**" and for graphical objects needed to understand content | Glass borders, focus rings, agent-state dots, waveform indicators all qualify |
| **2.2.2 Pause, Stop, Hide** | **A** | for moving/blinking/scrolling that "(1) starts automatically, (2) lasts more than **five seconds**, and (3) is presented in parallel with other content, there is a mechanism for the user to **pause, stop, or hide** it"; also applies to auto-updating info. **Non-Interference**: failing it "can interfere with a user's ability to use the whole page" | Ambient shimmer, animated gradients, a perpetually breathing "thinking" glow, and a live-updating agent log **all** hit this |
| **2.3.1 Three Flashes or Below Threshold** | **A** | "do not contain anything that flashes more than **three times in any one second period**, or the flash is below the general flash and red flash thresholds." Also **Non-Interference** | Pulsing recording indicators and specular sweeps must be rate-limited (threshold definition itself: **AL-10** — read before specifying) |
| **2.4.7 Focus Visible** | **AA** | keyboard focus indicator is visible | Focus rings over glass need their own contrast treatment |
| **2.4.11 Focus Not Obscured (Minimum)** | **AA** (New in 2.2) | "the component is **not entirely hidden** due to author-created content" | **Directly aimed at floating overlays.** A P3 meeting HUD that covers a focused control fails this |
| **2.5.8 Target Size (Minimum)** | **AA** (New in 2.2) | "at least **24 by 24 CSS pixels**", with Spacing / Equivalent / Inline / User-Agent / Essential exceptions | Compact HUD controls and menu-bar-adjacent affordances |
| **2.3.3 Animation from Interactions** | **AAA** — *not AA* | "Motion animation triggered by interaction can be disabled, unless… essential" | See correction X-1 |
| **2.4.13 Focus Appearance** | **AAA** — *not AA* | ≥ 2 CSS px perimeter equivalent area, **3:1** focused-vs-unfocused. Note 1: the perimeter "does not include **shadow and glow effects** outside the component's content, background, or border" | See correction X-2 — and note the glow exclusion directly affects a glass aesthetic |

- **Which product/state:** All three products, all states.
- **Originality / IP:** W3C Recommendation; free to implement and cite.
- **Accessibility / performance:** The two *new-in-2.2* AA criteria — **2.4.11 Focus Not Obscured** and **2.5.8 Target Size** — are the ones a floating-glass-overlay product is most likely to fail, and they are the ones least likely to be in an existing team checklist.
- **Disposition:** **Adopt** as the binding floor: **AA, with 2.3.3 and 2.4.13 adopted voluntarily** (see rationale).
- **Rationale:** 2.3.3 and 2.4.13 are AAA and therefore not required for an AA claim — but for a motion-heavy, glow-heavy dark HUD they are exactly the two AAA criteria that map onto our actual risk. Adopting them deliberately (and labelling them as *voluntary AAA*, not as AA) is both honest and cheap.

### F2 — Core Web Vitals thresholds

- **Exact URL:** `https://web.dev/articles/vitals`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* Three stable metrics, each judged **at the 75th percentile** of page loads across mobile and desktop: **LCP ≤ 2.5 s**, **INP ≤ 200 ms**, **CLS ≤ 0.1**. INP "became a stable Core Web Vital metric in 2024", having been promoted from experimental to pending in 2023; it replaced FID. **No 2025 or 2026 metric changes are announced on this page** (*verified absence*, as of the access date).
- **Which product/state:** Any web-technology surface — Claude artifacts, Claude Design prototypes, and an Electron shell if that is the Windows implementation route (G3).
- **Originality / IP:** Google/web.dev documentation; thresholds freely usable.
- **Accessibility / performance:** **INP ≤ 200 ms is the one that a glass design system will break first.** Every `backdrop-filter` surface that must recomposite on interaction is INP pressure, and the effect is worst on exactly the low-end Windows hardware whose specs are still unknown (B-002).
- **Disposition:** **Adopt** for web/Electron surfaces. *inferred:* for native surfaces, substitute a frame-budget target (Apple HIG's motion page notes 30–60 fps as the smoothness band for games; for UI, a 60 Hz+ display implies a ~16.7 ms budget — treat as *inferred*, not as an Apple UI requirement).
- **Rationale:** Gives Gate 2 a numeric pass/fail rather than an aesthetic argument.

### F3 — Apple Reduce Motion / Reduce Transparency behaviour

- **Exact URLs:** `https://developer.apple.com/design/human-interface-guidelines/accessibility`, `https://developer.apple.com/design/human-interface-guidelines/motion`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.* From the Motion page: **"Add motion purposefully… Gratuitous or excessive animation can distract people and may make them feel disconnected or physically uncomfortable."** **"Make motion optional… avoid using it as the only way to communicate important information."** **"Aim for brevity and precision in feedback animations."** **"In apps, generally avoid adding motion to UI interactions that occur frequently."** **"Let people cancel motion. As much as possible, don't make people wait for an animation to complete before they can do anything, especially if they have to experience the animation more than once."** From Accessibility: the Reduce Motion list quoted in A9, including **"Avoiding animating into and out of blurs"** and **"Avoiding animating depth changes in z-axis layers."** From Materials (A4): variant appearance changes when users "turn on accessibility settings that reduce transparency or increase contrast."
- **Which product/state:** Every animated or translucent surface.
- **Originality / IP:** None.
- **Accessibility / performance:** "Let people cancel motion" is a usability requirement that also *helps* INP: an interruptible animation returns control immediately instead of blocking on a transition.
- **Disposition:** **Adopt** as the definition of our reduced-motion tier.
- **Rationale:** Turns "reduced-motion variant" into a testable spec: **tier 2 = opacity-only transitions, static blur radii, no z-translation, no repeating idle animation, all transitions interruptible.**

### F4 — `prefers-reduced-motion` and `prefers-reduced-transparency`: availability ⚠ correction

- **Exact URLs:** `https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency`; `https://api.webstatus.dev/v1/features/prefers-reduced-transparency`; `https://api.webstatus.dev/v1/features/prefers-reduced-motion`
- **Access date:** 2026-08-24
- **Observed pattern + evidence:** *verified.*
  - **`prefers-reduced-motion`: Baseline "widely available"** — low date 2020-01-15, high date 2022-07-15. Chrome 74, Edge 79, Firefox 63, Safari 10.1, plus Android equivalents. **Safe to rely on.**
  - **`prefers-reduced-transparency`: Baseline status "limited" — NOT Baseline.** webstatus.dev records support only in **Chrome 119 (2023-10-31), Chrome Android 119, Edge 119 (2023-11-02)**. **No Firefox entry, no Safari entry.** MDN's banner reads: **"Limited availability — This feature is not Baseline because it does not work in some of the most widely-used browsers"**, and the page is flagged **"Experimental… Check the Browser compatibility table carefully before using this in production."**
- **Which product/state:** Every glass surface rendered with web technology (artifacts, Claude Design prototypes, Electron).
- **Originality / IP:** None.
- **Accessibility / performance:** **We cannot detect "reduce transparency" reliably on the web.** On a Chromium-only Electron shell we *can* use it (Chromium ≥ 119) — but on artifacts viewed in Safari or Firefox we cannot. **Therefore the design system must ship an explicit in-app "Reduce transparency / Solid surfaces" setting**, and treat the media query as an *auto-detect nicety* layered on top, never as the mechanism.
- **Disposition:** **Adopt** with that correction (see X-4).
- **Rationale:** This is a classic assumption trap: `prefers-reduced-motion` works everywhere, so people assume its sibling does. It does not, and the sibling is the one that matters most for a glass system.

### F5 — NN/g: progress-indicator time thresholds

- **Exact URL:** `https://www.nngroup.com/articles/progress-indicators/`
- **Access date:** 2026-08-24. **Article publication date: 26 October 2014** (recorded so its age is visible).
- **Observed pattern + evidence:** *verified.* Provide immediate feedback on every initiated action; use a progress indicator for delays beyond roughly one second. **Under ~1 s: no looped animation** ("it is distracting"). **~2–10 s: looped animation** ("This indicator should be reserved for actions that take between 2-10 seconds"). **10 s or more: percent-done indicator** ("should be used for longer processes that take 10 or more seconds"), because a looped animation carries no duration information and "users quickly grow impatient."
- **Which product/state:** Every agent operation in P1/P2/P3.
- **Originality / IP:** Public article; cite, don't reproduce.
- **Accessibility / performance:** Percent-done indicators need `role="progressbar"` with real `aria-valuenow`; indeterminate loops need a text status that is announced, not just a spinning glyph. And per WCAG 2.2.2, a long-running looped animation presented alongside other content needs a pause/stop/hide path.
- **Disposition:** **Adopt**, and **fuse with D2's 10-second acknowledgement rule** into one budget: **≤1 s → no indicator, just state change; ≤10 s → indeterminate indicator + a named current step; >10 s → determinate progress or an itemised step list with completed/current/pending; and in all cases the first typed acknowledgement inside 10 s or the agent is presented as unresponsive.**
- **Rationale:** These two independent sources (a 2014 usability finding and a 2026 platform contract) land on the same 10-second boundary. That is a strong, cheap, testable rule.

---

# SECTION 7 — BEYOND THE SEEDS (8 references, each earning its row)

### G1 — Microsoft: Mica material (Windows 11) ★ most decision-relevant for the pilot

- **Exact URL:** `https://learn.microsoft.com/en-us/windows/apps/design/style/mica`
- **Access date:** 2026-08-24. Page metadata: `ms.date: 2026-07-22`, `updated_at: 2026-07-17`.
- **Why it earns a row:** **The Windows pilot ships first, and Windows already has a first-party, documented, performance-tuned material system.** Designing an Apple-derived glass language and then porting it to Windows is backwards; this is the platform we land on first.
- **Observed pattern + evidence:** *verified.* Mica is **"an opaque, dynamic material that incorporates theme and desktop wallpaper to paint the background of long-lived windows."** **"Mica is specifically designed for app performance as it only samples the desktop wallpaper once to create its visualization."** It "helps users focus on the current task by **falling back to a neutral color when the app is inactive**." **Mica Alt** = stronger wallpaper tint, for tabbed title bars; needs Windows App SDK 1.1+ on Windows 11 build 22000+. **Documented fallback matrix** — Mica renders as a solid colour (`SolidBackgroundFillColorBase`, or `…BaseAlt` for Mica Alt) when: transparency is off in **Settings > Personalization > Color**; **Battery Saver** is on; the app runs on **low-end hardware**; the **window deactivates**; or the **Windows version is below 22000**. High Contrast replaces Mica with the user's chosen background colour. Layering model: **Mica as base layer → content layer using `LayerFillColorDefaultBrush`** (Standard or Card pattern); with Mica Alt, **base → commanding layer (`LayerOnMicaBaseAltFillColorDefaultBrush`) → content layer**. Rules: **"Do set the background to transparent for all layers where you want to see Mica"**; **"Don't apply backdrop material more than once in an application"**; **"Don't apply backdrop material to a UI element."**
- **Which product/state:** P1 command center window, P2 workspace window on Windows; the base layer of the whole Windows visual system.
- **Originality / IP:** Microsoft design guidance; APIs are public. Mica's own rendering is Microsoft's — we implement *our* material, informed by these rules. WinUI 3 Gallery source is on GitHub (license not checked here → *unknown*; don't vendor it).
- **Accessibility / performance:** This row is worth the whole section. **Windows already defines a five-condition degraded state** (transparency off / battery saver / low-end hardware / window inactive / old OS) — which is a ready-made, real-world specification for our "degraded state" design work, and it is *mandatory* behaviour on Windows, not optional polish. **"Sample the wallpaper once"** is also the cheapest possible glass: a static, one-time-captured backdrop rather than a live blur.
- **Disposition:** **Adopt** Mica (or a Mica-equivalent static-sample backdrop) as the **Windows base material**, with the documented two/three-layer model.
- **Rationale:** It gets us "dark-first, personalised, depthful, essentially free" — and it hands us the degraded-state matrix, the inactive-window behaviour, and the "one backdrop per app, never on an element" rule that our own system should mirror on every platform.

### G2 — Microsoft: Acrylic material ⚠ the perf warning

- **Exact URL:** `https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic`
- **Access date:** 2026-08-24. Page metadata: `ms.date: 2026-07-22`.
- **Why it earns a row:** It is the Windows analogue of "real" live-blur glass, and Microsoft publishes an explicit cost warning that no other vendor in this survey states so plainly.
- **Observed pattern + evidence:** *verified.* Two blend types: **background acrylic** (reveals wallpaper and windows behind) and **in-app acrylic** (depth within the frame). **"Rendering acrylic surfaces is GPU-intensive, which can increase device power consumption and shorten battery life. Acrylic effects are automatically disabled when a device enters Battery Saver mode."** Usage: **background acrylic for transient UI** (context menus, flyouts, non-modal popups, light-dismiss panes); **in-app acrylic for supporting UI** that content scrolls under. **"Avoid layering multiple acrylic surfaces: multiple layers of background acrylic can create distracting optical illusions."** **"Don't put desktop acrylic on large background surfaces of your app."** **"Don't place multiple acrylic panes next to each other because this results in an undesirable visible seam."** **"Don't place accent-colored text over acrylic surfaces"** — "these combinations are likely to not pass minimum contrast ratio requirements at the default 14px font size"; also "try to avoid placing hyperlinks over acrylic elements." For vertical panes that section off content, **"we recommend you use an opaque background instead of acrylic."** The published recipe: **background → blur → exclusion blend → colour/tint overlay → noise.** APIs: `AcrylicBrush`, `Window.SystemBackdrop`, `DesktopAcrylicBackdrop`.
- **Which product/state:** P1 command palette / flyouts, P3 overlay — the *transient* surfaces only.
- **Originality / IP:** Guidance and API names are Microsoft's; the recipe layers named are generic compositing operations.
- **Accessibility / performance:** **"Don't place accent-colored text over acrylic"** is the single most concrete legibility warning found in this research, and it directly contradicts the instinctive glass-UI move (coloured accent text on a translucent card). Combined with Apple's "use color sparingly in HUDs" (A6) and Apple's 35%-dim rule (A4), a consistent cross-platform law emerges.
- **Disposition:** **Adapt** — acrylic-class live blur reserved for **small, transient, short-lived** surfaces; never for base layers, never edge-to-edge with another blurred pane, never behind accent-coloured text.
- **Rationale:** Microsoft has already paid for the lesson that a beautiful live-blur base layer costs battery and legibility. Taking the lesson for free is the entire point of this research lane.

### G3 — Electron: `backgroundMaterial` and `vibrancy`

- **Exact URL:** `https://www.electronjs.org/docs/latest/api/base-window`
- **Access date:** 2026-08-24
- **Why it earns a row:** It is the concrete implementation seam between "we designed a glass system" and "it runs on the Windows pilot" without writing native code twice.
- **Observed pattern + evidence:** *verified.* **`backgroundMaterial` (Windows):** values **`auto`, `none`, `mica`, `acrylic`, `tabbed`**; "sets the browser window's system-drawn background material, including behind the non-client area"; **"only supported on Windows 11 22H2 and up."** **`vibrancy` (macOS):** `appearance-based`, `titlebar`, `selection`, `menu`, `popover`, `sidebar`, `header`, `sheet`, `window`, **`hud`**, `fullscreen-ui`, `tooltip`, `content`, `under-window`, `under-page`; passing null/empty removes the effect. **`transparent`** defaults to `false` and **"On Windows, does not work unless the window is frameless."** With `transparent`, child views need `view.setBackgroundColor` with a transparent colour. BaseWindow + WebContentsView has a documented memory-leak footgun if `webContents` isn't explicitly closed.
- **Which product/state:** All three products, if the Windows pilot is Electron.
- **Originality / IP:** MIT-licensed project (license not re-verified in this session → *unknown*; verify before relying on it).
- **Accessibility / performance:** Native `backgroundMaterial: 'mica'` gets us Windows' **entire documented degraded-state matrix for free** (G1) — battery saver, transparency-off, low-end hardware, inactive window — whereas a CSS `backdrop-filter` re-implementation gets us none of it and costs GPU on every frame. **This is a strong argument for OS-material-first, CSS-glass-second.** Note the **Windows 11 22H2 floor**: below that, we must ship a solid fallback, which is another reason B-002 (pilot machine build) is worth closing.
- **Disposition:** **Adopt** as the architecture: **OS backdrop for the window base; CSS/canvas glass only for in-window transient surfaces.**
- **Rationale:** It converts a visual ambition into a two-tier technical contract with a documented fallback on each platform, and note `vibrancy: 'hud'` on macOS maps directly onto Apple's HUD-panel guidance (A6).

### G4 — MDN: `backdrop-filter` Baseline status and the backdrop-root trap

- **Exact URL:** `https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter`
- **Access date:** 2026-08-24
- **Why it earns a row:** It is the actual primitive any web-technology glass will be built from, and it has a non-obvious correctness trap that produces "why is my glass not blurring anything?" bugs.
- **Observed pattern + evidence:** *verified.* Banner: **"Baseline 2024 — Newly available. Since September 2024, this feature works across the latest devices and browser versions. This feature might not work in older devices or browsers."** webstatus.dev corroborates: Chrome 76 (2019-07-30), Edge 79, Firefox 103 (2022-07-26), **Safari 18 (2024-09-16)** — Safari is what moved it to Baseline. **The trap:** backdrop-filter effects "are limited to the nearest **backdrop root** ancestor." Backdrop roots include `<html>` and any element with `filter`, `opacity < 1`, `mask`/`mask-image`/`mask-border`, `clip-path`, `backdrop-filter`, `mix-blend-mode` other than `none`, or `will-change` set to any of those. So **a parent with `opacity: 0.9` becomes a backdrop root and its child's `backdrop-filter` blurs only the content between parent and child — not the content behind the parent.**
- **Which product/state:** Every web-rendered glass surface in P1/P2/P3 and every Claude artifact prototype.
- **Originality / IP:** MDN content is CC-BY-SA; cite, don't paste.
- **Accessibility / performance:** Two consequences. (1) **A nested glass element inside a faded/animated parent silently degrades** — which is exactly what happens when someone animates a panel's opacity on entrance. This is a concrete reason the entrance animation should move/scale, or (under reduced motion) cross-fade a *pre-composited* surface, rather than fading a container that holds glass children. (2) It reinforces A5/A2: **one glass root per cluster**, children painted normally.
- **Disposition:** **Adopt** as an implementation rule in the design system's engineering notes.
- **Rationale:** It is the kind of platform detail that turns a design system's glass tokens from "looks right in the mock" into "renders right in the app", and it independently arrives at the same architecture Apple's `GlassEffectContainer` encodes.

### G5 — WebGPU baseline status (webstatus.dev)

- **Exact URL:** `https://api.webstatus.dev/v1/features/webgpu` (human page: `https://webstatus.dev/features/webgpu`)
- **Access date:** 2026-08-24
- **Why it earns a row:** If "3D" means literal 3D, this is the delivery mechanism, and its availability decides whether 3D can be a *requirement* or only an *enhancement*.
- **Observed pattern + evidence:** *verified* (API response): **Baseline status: `limited`.** Recorded availability: **Chrome 144 (2026-01-13), Chrome Android 121 (2024-01-23), Edge 144 (2026-01-15), Safari 26 (2025-09-15), Safari iOS 26 (2025-09-15). No Firefox entry.** *inferred, flagged:* the Chrome desktop date of 2026-01-13 most likely reflects the point at which WebGPU became available across **all** desktop Chrome platforms rather than first-ever ship; I did not verify the earlier per-OS ship history, so treat "WebGPU has been in Chrome on Windows since 2023" as **unverified** here.
- **Which product/state:** Any true-3D element in P1/P2/P3.
- **Originality / IP:** W3C spec; open.
- **Accessibility / performance:** **Limited Baseline ⇒ WebGPU cannot be a hard dependency.** And on a Windows laptop, a persistent GPU pipeline competes with the user's compiler, their video call, and their battery — see G2's battery-saver behaviour for the platform's own view of this.
- **Disposition:** **Adapt** — WebGPU (and WebGL/three.js) permitted **only** as a bounded, opt-in, pausable enhancement on a single hero surface, never as the substrate of routine UI.
- **Rationale:** This is the guardrail that keeps "3D Liquid Glass" from becoming "a game engine behind your task list." Combined with WCAG 2.2.2 (F1) — anything continuously moving needs pause/stop/hide — the honest design is: depth is *implied* by layering and light, and real 3D appears only where the user asked for it.

### G6 — Radix Colors: the 12-step scale and APCA-targeted text steps

- **Exact URLs:** `https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale`, `https://www.radix-ui.com/themes/docs/theme/dark-mode`; license `https://raw.githubusercontent.com/radix-ui/colors/main/LICENSE`
- **Access date:** 2026-08-24
- **Why it earns a row:** It is the best-documented public answer to "how do you build a dark-first colour system where every step has a defined job and text contrast is *guaranteed* rather than eyeballed."
- **Observed pattern + evidence:** *verified* (license: **MIT**, "Copyright (c) 2021-2022 Modulz / Copyright (c) 2022-Present WorkOS"). *verified* (docs): each accent is a **12-step scale with a solid and a transparent variant of each colour** — the transparent variants are the part that matters for glass. Step roles: **3/4/5** = component backgrounds (normal / hover / pressed-or-selected); **6/7/8** = borders (6 = subtle borders on non-interactive elements such as sidebars, headers, cards, alerts, separators; 7 = subtle borders on interactive components); **9** = highest chroma, the "purest" step; **11/12** = text. Guarantee: **"Steps 11 and 12 — which are designed for text — are guaranteed to Lc 60 and Lc 90 APCA contrast ratio on top of a step 2 background from the same scale."** Step 11 = low-contrast text; step 12 = high-contrast text.
- **Which product/state:** The colour architecture for all three products in dark mode.
- **Originality / IP + license:** **MIT — usable, modifiable, redistributable with attribution.** But note: adopting Radix's *values* verbatim makes our palette recognisably Radix. **Adopt the architecture (12 steps, fixed roles per step, solid+alpha pairs, guaranteed text steps); generate our own values.**
- **Accessibility / performance:** The **alpha variants are the key insight for a glass system**: a translucent surface tinted with `accentA3` over an unknown backdrop behaves predictably in a way that a hand-picked `rgba()` does not. And note the important caveat: **APCA is not WCAG 2.2.** Lc 60 / Lc 90 are *not* substitutes for 4.5:1 / 3:1 (F1). We must ship **WCAG 2.2 ratios as the compliance floor** and may use APCA as an additional perceptual check.
- **Disposition:** **Adopt** the scale architecture; **generate original values**; **do not** substitute APCA for WCAG.
- **Rationale:** It gives us a token system where "which grey is this border?" has one right answer, which is the difference between a design system and a palette.

### G7 — Vercel AI Elements: a published component vocabulary for agent progress

- **Exact URLs:** `https://elements.ai-sdk.dev/`, `https://github.com/vercel/ai-elements`; license `https://raw.githubusercontent.com/vercel/ai-elements/main/LICENSE`
- **Access date:** 2026-08-24
- **Why it earns a row:** It is an independent, publicly enumerated answer to "what are the *nouns* of an agentic interface" — and it converges strikingly with Linear's activity types (D2).
- **Observed pattern + evidence:** *verified* (license: **Apache License 2.0**, "Copyright 2023 Vercel, Inc."). *verified* (component index): a component library built on shadcn/ui, organised into groups.
  - **Chat:** Conversation, Message, Prompt Input, Suggestion, Inline Citation, **Sources**, Attachments, **Model Selector**.
  - **Agent progress:** **Chain of Thought** ("displays reasoning steps"), **Reasoning**, **Task** (current work item + completion status), **Tool** (external tool usage and results), **Context**, **Plan** (task breakdown and execution sequence), **Checkpoint** (progress milestones within workflows), **Confirmation** (user approval gates for actions).
  - **Code:** **Artifact**, Code Block, Sandbox, Terminal, JSX Preview, Web Preview, File Tree, Commit, Stack Trace, Test Results, Environment Variables, Package Info, Schema Display.
  - **Voice:** Speech Input, Transcription, Audio Player, Persona, Voice Selector, Mic Selector.
  - **Workflow:** **Canvas, Node, Connection, Edge**, Panel, Toolbar.
- **Which product/state:** P1 (Conversation/Task/Confirmation/Sources/Model Selector), P2 (Plan/Tool/Terminal/Test Results/Stack Trace/Commit/File Tree/Artifact), P3 (Speech Input/Transcription), and the Workflow group maps directly onto Runway's DAG concepts (C2).
- **Originality / IP + license:** **Apache-2.0** — permissive, includes an express patent grant, requires attribution and a NOTICE-preserving practice. Built on shadcn/ui (**MIT**, verified). **We can legitimately use or study this code.** But adopting it wholesale would make our product look like every other AI SDK app — the opposite of the brief.
- **Accessibility / performance:** Having *named component types* per agent state is what makes an accessible implementation tractable: each type gets one live-region policy, one focus behaviour, one collapsed/expanded default. An undifferentiated chat log cannot be made accessible after the fact.
- **Disposition:** **Adapt** — take the **vocabulary and state taxonomy**, build our own components with our own visual language.
- **Rationale:** Two independent sources (Linear's five activity types; Vercel's eight agent-progress components) converge on the same taxonomy. That is strong evidence it is the *right* decomposition, and it lets us design a set of glass "state cards" whose semantics are settled before a single pixel is drawn. The **Confirmation** and **Checkpoint** components in particular are the missing UI counterparts to the plan-then-confirm law (C1/D4/D9) and to Runway's node-lock (C2).

### G8 — NN/g: "AI Agents as Users" — the contrarian finding

- **Exact URL:** `https://www.nngroup.com/articles/ai-agents-as-users/`
- **Access date:** 2026-08-24. **Published 10 April 2026.**
- **Why it earns a row:** It reframes accessibility work as *also* being agent-compatibility work — which changes the internal cost-benefit argument for doing it properly.
- **Observed pattern + evidence:** *verified.* **"A core assumption needs updating: 'user' is no longer synonymous with 'human.'"** Recommendations are accessibility recommendations: clear descriptive labelling — **"Avoid icon-only buttons, ambiguous link text ('click here'), and labels that depend on visual context"**; predictable, consistent navigation and form patterns; semantic markup that reflects visual grouping so agents understand relationships. **"None of these recommendations are new. They are the same principles that make interfaces more usable for humans with disabilities."** And: **"Investing in accessibility has been the right thing to do, but now there's a clear business case for it."** *Recorded honestly:* the article **does not** provide recommendations for agent plans, progress, permissions, steering or provenance — it treats agent compatibility as an accessibility problem, not as a distinct design surface.
- **Which product/state:** Cross-cutting; particularly P2, where our own agents will operate on our own UI, and P1, where the assistant may drive other apps.
- **Originality / IP:** Public article; cite, don't reproduce.
- **Accessibility / performance:** **"Avoid icon-only buttons"** is in direct tension with a minimal glass HUD aesthetic, which naturally trends toward unlabelled icons. Resolution: icon + accessible name always (echoing Apple's "Provide an accessibility label for every icon", A2), with visible labels appearing on a delay/hover/expanded state rather than never existing.
- **Disposition:** **Adopt.**
- **Rationale:** It supplies the internal argument that keeps the accessibility floor from being cut under schedule pressure: a HUD that a screen reader can't parse is also a HUD our own agent can't parse.

### G9 — Licence-verified open-source route to real 3D and to component scaffolding

- **Exact URLs (LICENSE files, fetched via raw.githubusercontent per worker rules):**
  - three.js — `https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE` → **MIT** ("Copyright © 2010-2026 three.js authors")
  - React Three Fiber — `https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/LICENSE` → **MIT** ("Copyright (c) 2019-2025 Poimandres")
  - shadcn/ui — `https://raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md` → **MIT** ("Copyright (c) 2023 shadcn")
  - Radix Colors — **MIT** (see G6); Vercel AI Elements — **Apache-2.0** (see G7); IBM Carbon — `https://raw.githubusercontent.com/carbon-design-system/carbon/main/LICENSE` → **Apache-2.0** (license verified; **its dark-theme documentation was NOT verified — AL-6**)
- **Access date:** 2026-08-24
- **Why it earns a row:** The originality question for this program is not "can we build it" but "can we build it **without** deriving from anyone's protected work." This row establishes that the entire technical substrate observed in the premium-3D reference class (E1: three.js, R3F, GLSL) is permissively licensed and available to us directly.
- **Observed pattern + evidence:** *verified* — all six LICENSE files read at the URLs above on the access date.
- **Which product/state:** Implementation substrate for any 3D hero moment and for component scaffolding.
- **Originality / IP + license:** **MIT and Apache-2.0 are both permissive.** Apache-2.0 adds an express patent grant and a NOTICE/attribution obligation; MIT requires the copyright notice be retained. Neither is copyleft. **What is *not* available is anyone's specific shader artistry, scene composition, motion timing or trade dress** — see E1.
- **Accessibility / performance:** Availability is not permission to use heavily; G5 and F1 (2.2.2) still bind. A 3D scene must be pausable, must not autoplay indefinitely alongside content, and must have a non-3D equivalent.
- **Disposition:** **Adopt** as the licensed toolchain; **Reject** any lift of specific creative output.
- **Rationale:** It closes the loop on the brief's originality requirement with primary-source evidence rather than assumption: the *tools* are free, the *taste* has to be ours.

---

# CORRECTIONS TO SEED CLAIMS

Recorded explicitly, per worker rules. "Seed claim" = an assertion or framing carried in the task brief, or an interim conclusion I formed mid-research and then corrected against a primary source.

| # | Seed claim / assumption | Correction (with source) |
|---|---|---|
| **X-1** | The brief lists **"motion"** among "WCAG 2.2 AA criteria that bind this product class." | **Partly wrong as stated.** The motion criterion people usually mean — **2.3.3 Animation from Interactions — is Level AAA, not AA** (verified, `w3.org/TR/WCAG22/#animation-from-interactions`). The criteria that genuinely bind at **AA** and constrain motion are **2.2.2 Pause, Stop, Hide (Level A)** and **2.3.1 Three Flashes or Below Threshold (Level A)** — both of which also carry the **Non-Interference** conformance requirement, meaning a failure taints the whole page. Recommendation: adopt 2.3.3 **voluntarily**, and label it as voluntary AAA rather than claiming it as AA. |
| **X-2** | Implicit in "focus" as an AA binding: that **Focus Appearance** sets the AA focus-ring bar. | **Wrong. 2.4.13 Focus Appearance is Level AAA** (verified). The AA focus criteria are **2.4.7 Focus Visible** and the new **2.4.11 Focus Not Obscured (Minimum)**. Additionally, 2.4.13's Note 1 states the measured perimeter **"does not include shadow and glow effects outside the component's content, background, or border"** — so a glow-based focus treatment, which is the natural instinct for a glass HUD, **does not count** toward it. |
| **X-3** | Implied by the brief's framing (Apple docs first, Windows pilot second): that the design system should be derived from Apple's material model and then ported to Windows. | **Inverted priority.** Windows 11 publishes its own first-party, performance-tuned material system — **Mica** (opaque, samples wallpaper **once**) and **Acrylic** (live blur, **"GPU-intensive… automatically disabled when a device enters Battery Saver mode"**) — with a **documented five-condition fallback matrix** (transparency off / battery saver / low-end hardware / inactive window / pre-22000) that Apple's docs have no equivalent of (verified: learn.microsoft.com mica + acrylic, both `ms.date: 2026-07-22`). Since the pilot is Windows-first, the base material should be **Mica-class (static-sample)**, not Acrylic-class (live-blur), and Apple's model should be the *macOS mapping*, not the source of truth. |
| **X-4** | Common assumption implied by "reduced-motion/high-contrast variants always" (00-DECISIONS §4 default #8) and by web practice: that the OS "reduce transparency" preference can be detected the way reduced motion can. | **Wrong on the web.** **`prefers-reduced-motion` is Baseline "widely available"** (Chrome 74 / Edge 79 / Firefox 63 / Safari 10.1; widely-available since 2022-07-15). **`prefers-reduced-transparency` is Baseline `limited` — Chrome/Edge 119 only, no Firefox, no Safari** (verified: MDN banner "Limited availability… not Baseline", plus `api.webstatus.dev/v1/features/prefers-reduced-transparency`). **Consequence: the design system must ship an explicit in-app "solid surfaces" toggle**; the media query is a bonus, not the mechanism. |
| **X-5** | Implicit assumption in any Apple-referenced design language: that Apple's system typography and symbols are available to draw on. | **Blocked.** The Apple Font license permits use **"solely for creating mock-ups of user interfaces to be used in software products running on Apple's iOS, OS X or tvOS operating systems"** and expressly forbids using it "for the purpose of creating mock-ups of user interfaces to be used in software products running on **any non-Apple operating system**", plus **"You may not embed the Apple Font in any software programs or other products"** (verified, `developer.apple.com/fonts/`). SF Symbols carries an equivalent Apple-platforms-only restriction plus a ban on use "in your app icons, logos, or any other trademark-related use" (excerpt-only, AL-9). **For a Windows-first product this rules out SF Pro / SF Mono / New York and SF Symbols entirely — including in mock-ups.** |
| **X-6** | The brief names Zera showcases as **"Horizon, Vector Bloom, Lumen Atlas/nexus."** | **Partly incorrect.** On `zerasoftwarestudio.com/portfolio` (verified, 2026-08-24) the named showcases include **Horizon**, **Vector Bloom**, **Nexus**, **Orion**, **Specimen**, **Aero**, **Naveera**, **Reel**, **Visio**, **Detail Driven**, **Delphi Markets**. **There is no "Lumen Atlas."** "Nexus" is a separate, real project ("hand-written GLSL shaders rendered via Three.js"). The seed appears to conflate a non-existent name with the real "Nexus". Also worth recording: the studio brands itself **"Zera Studio"** in its own footer (**"@2026 Zera Studio. All rights reserved"**), not "Zera Software Studio", though the domain uses the longer form. |
| **X-7** | My own interim reading (from a search excerpt of an older Warp docs path) that Warp offers **four** autonomy levels: "Let the agent decide / Always prompt for confirmation / Always allow / Never." | **Corrected against the live page.** The current doc names them **"Agent Decides", "Always ask", "Always allow"**, plus **"Never"** ("Agent will not ever take the action") — and the *Ask questions* permission has a **different** three-value scale: **"Never ask", "Ask unless auto-approve", "Always ask."** There are **six** permission categories, not four: Apply code diffs, Read files, Create plans, Execute commands, Interact with running commands, Ask clarifying questions (verified). |
| **X-8** | Reasonable-sounding assumption that Claude Code artifacts can persist form/user state, since claude.ai artifacts document persistent storage. | **Wrong — they are different products with different guarantees.** claude.ai conversation artifacts: persistent storage on Pro/Max/Team/Enterprise, **20 MB per artifact, text-only, only after publishing**, unpublishing deletes it (verified, support.claude.com 9487310). Claude **Code** artifacts: **"An artifact is a static page. It can't store data submitted through a form"**; the only outbound path is declared MCP connectors, which run **through the viewer's account** (verified, code.claude.com/docs/en/artifacts). Design Phase-0 prototypes as **stateless**. |
| **X-9** | Implicit assumption that the two official Anthropic sources agree on Claude Code artifact availability. | **They do not, as of 2026-08-24.** `support.claude.com/en/articles/9487310` says Claude Code artifacts are **"available in Claude Code on Team and Enterprise plans"** and **"can't be shared publicly."** `code.claude.com/docs/en/artifacts` says **Pro, Max, Team, or Enterprise**, and describes public links as the *only* sharing route on Pro/Max. Recorded as an open discrepancy — **not** resolved, and not to be relied on either way without checking the actual account. |
| **X-10** | Implied by "3D Liquid Glass": that real-time 3D can be a baseline capability. | **Not supportable as a baseline.** **WebGPU Baseline status is `limited`** — Chrome 144 / Chrome Android 121 / Edge 144 / Safari 26 / Safari iOS 26, **no Firefox** (verified, `api.webstatus.dev/v1/features/webgpu`). Meanwhile Apple's own guidance is to use its glass material **"sparingly"** and to **"combine custom Liquid Glass effects to improve rendering performance"** (verified), and Microsoft's is that live-blur acrylic is **"GPU-intensive"** and auto-disabled on battery saver (verified). **3D must be an opt-in, pausable enhancement on a bounded surface, never the substrate.** |
| **X-11** | Reasonable expectation that Runway's "ask before generating" safety behaviour applies across Runway's surfaces including MCP. | **Not documented.** The ask-before-generation + credit-estimate behaviour is documented for the **Agent** surface (excerpt-only, AL-1). The **MCP** announcement (verified, `runway.com/news/mcp`) describes setup and credit consumption but **contains no approval/confirmation statement**. *inferred lesson:* consent and cost gating must live in the adapter/tool layer, not in one front-end. |
| **X-12** | Working assumption (mine) that Apple's HIG could be read at its published URLs. | **Method correction.** Apple's HIG and Technology Overviews are client-rendered SPAs that return `<head>`-only HTML to a plain fetch. The content is served from Apple's own JSON endpoints: HIG at `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` and DocC at `https://developer.apple.com/tutorials/data/documentation/<path>.json`. All Apple rows above were read this way. Recorded so the next worker doesn't repeat the dead ends. |

---

# DERIVED DESIGN CONSTRAINTS (the floors this research establishes)

*inferred from the verified rows above; offered as candidate system laws for Gate 2, not as findings.*

1. **Two material tiers, not one.** Tier A = window base, static-sample or solid (Mica-class on Windows, `vibrancy` on macOS, solid everywhere else). Tier B = transient live-blur surfaces only (menus, palettes, the P3 HUD), small and short-lived. *(G1, G2, G3, A4)*
2. **Never glass on glass; one composite root per cluster.** *(A2, A5, G2, G4)*
3. **Glass never carries the content layer.** *(A4)*
4. **Clear/most-translucent variant requires a scrim** — start from Apple's 35% dark dimming over bright backdrops and verify against WCAG 1.4.3. *(A4, F1)*
5. **No accent-coloured text on translucent surfaces.** *(G2, A6)*
6. **Two motion tiers.** Tier 1 full; Tier 2 (reduced) = opacity-only, static blur radius, no z-translation, no idle loop, everything interruptible. *(A9, F3)*
7. **Anything auto-moving > 5 s alongside content ships with pause/stop/hide.** *(F1: WCAG 2.2.2, Level A, Non-Interference)*
8. **Targets ≥ 24×24 CSS px; focus never fully obscured by the overlay; focus indicator is a real border/outline, not a glow.** *(F1: 2.5.8, 2.4.11, 2.4.13 Note 1)*
9. **Explicit in-app "Reduce transparency" and "Reduce motion" toggles**, because the OS signal is undetectable on most web runtimes. *(F4)*
10. **Agent progress is typed, not decorative:** thought / action(tool) / plan / elicitation / response / error, each with its own live-region and focus policy; first acknowledgement within 10 s; indeterminate 1–10 s; determinate beyond 10 s. *(D2, G7, F5)*
11. **Plan-then-confirm is a system law.** Planning is read-only; clarifications are structured (multiple choice where possible); the plan is a durable, shareable document; the confirmation names the cost and the irreversibility. *(C1, D4, D9, G7 Confirmation)*
12. **Permissions are typed by action class** with a user-owned denylist that **cannot** be overridden by a one-key "run until completion" escalation. *(D3, and the deliberate divergence recorded there)*
13. **Degraded states name the missing thing and the fix**, following the connector-fallback pattern; and the Windows five-condition matrix is the canonical list of degraded conditions to design for. *(B1, G1)*
14. **Provenance everywhere:** inline source markers with real accessible names, an execution/output history with restore, and lockable outputs so a rerun cannot destroy a good result. *(D10, C2)*
15. **Type and icons must be independently licensed** — no Apple system fonts or symbols anywhere, including mock-ups. *(A11 / X-5)*

---

# EXACT QUERIES AND FETCHES RUN

### WebSearch queries (in order)
1. `support.claude.com Artifacts create manage content limitations network requests` (allowed_domains: support.claude.com)
2. `code.claude.com docs artifacts publish capabilities limits` (allowed_domains: code.claude.com, docs.claude.com)
3. `Claude Design official documentation support.claude.com canvas design` (allowed_domains: support.claude.com, claude.com, docs.claude.com, code.claude.com)
4. `Runway MCP server docs agent workflows credits` (allowed_domains: docs.dev.runwayml.com, help.runwayml.com, runwayml.com, academy.runwayml.com)
5. `Runway Agent clarifying questions plan before generating credits estimate` (allowed_domains: help.runwayml.com, runwayml.com)
6. `Runway Workflows nodes canvas rerun node output history version` (allowed_domains: help.runwayml.com, runwayml.com, docs.dev.runwayml.com)
7. `Warp docs agent mode permissions autonomy allowlist command approval` (allowed_domains: docs.warp.dev, warp.dev)
8. `Linear docs command menu keyboard shortcuts agents delegate issue status` (allowed_domains: linear.app)
9. `Linear agent session activity thought action elicitation response developer docs` (allowed_domains: linear.app)
10. `Granola notes app how it works no bot joins meeting privacy docs` (allowed_domains: granola.ai, go.granola.ai, docs.granola.ai)
11. `Wispr Flow docs dictation how it works push to talk indicator whispering privacy` (allowed_domains: wisprflow.ai, docs.wisprflow.ai, support.wisprflow.ai)
12. `Cursor docs agent mode plan review diff accept reject terminal command approval` (allowed_domains: cursor.com, docs.cursor.com)
13. `Perplexity Comet or answer UI sources citations streaming docs help center` (allowed_domains: perplexity.ai, docs.perplexity.ai, www.perplexity.ai)
14. `Figma help center AI features first draft make designs limits 2026` (allowed_domains: help.figma.com, figma.com)
15. `Zera Software Studio Horizon Vector Bloom Lumen Atlas nexus terms`
16. `Notion AI agents help docs how agents work review approve steps` (allowed_domains: notion.com, notion.so, www.notion.com)
17. `ChatGPT desktop app macOS companion window "work with apps" help docs` (allowed_domains: help.openai.com, openai.com)
18. `prefers-reduced-transparency CSS media query baseline browser support` (allowed_domains: developer.mozilla.org, w3.org, webstatus.dev, web.dev)
19. `Nielsen Norman Group 2025 AI agent progress transparency loading states article` (allowed_domains: nngroup.com)
20. `Radix Colors dark theme 12 step scale documentation contrast steps` (allowed_domains: radix-ui.com, www.radix-ui.com)
21. `Vercel AI Elements open source components license shadcn agent chat` (allowed_domains: vercel.com, ai-sdk.dev, github.com)
22. `SF Symbols license agreement "may not be used" Apple trademark app icon restriction` (allowed_domains: developer.apple.com, apple.com)

### WebFetch / curl targets (in order; all 2026-08-24)
**Apple:** `developer.apple.com/documentation/technologyoverviews/liquid-glass` · `.../adopting-liquid-glass` · JSON forms of both under `/tutorials/data/documentation/technologyoverviews/` · `/documentation/BundleResources/Information-Property-List/UIDesignRequiresCompatibility` (+ JSON) · `/design/human-interface-guidelines/materials` (HTML probe + JSON) · HIG JSON path discovery probes (5 candidate paths, 4× 404) · `/tutorials/data/design/human-interface-guidelines.json` (index) · HIG JSON for `notifications`, `panels`, `motion`, `accessibility`, `dark-mode`, `windows`, `the-menu-bar`, `live-activities`, `status-bars`, `app-icons` (`menu-bar-extras`, `menu-bar-menus` → 404) · `/tutorials/data/documentation/swiftui/glasseffectcontainer.json` · `.../swiftui/view/glasseffect(_:in:isenabled:).json` (404) · `developer.apple.com/design/resources/` · `developer.apple.com/fonts/`
**W3C / web platform:** `w3.org/TR/WCAG22/` (full HTML, SC sections extracted locally) · `web.dev/articles/vitals` · `developer.mozilla.org/.../@media/prefers-reduced-transparency` · `developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter` · `api.webstatus.dev/v1/features/{prefers-reduced-transparency, backdrop-filter, prefers-reduced-motion, webgpu}`
**Anthropic:** `code.claude.com/docs/en/artifacts.md` · `support.claude.com/en/articles/9945119-…` (404) · `support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them` (WebFetch + raw curl) · `support.claude.com/en/articles/11649438-…` → redirect chain → `academy.claude.com/tutorials/prototype-ai-powered-apps-with-claude-artifacts` · `support.claude.com/en/articles/14604416-get-started-with-claude-design` · `.../14604397-set-up-your-design-system-in-claude-design`
**Runway:** `runwayml.com/news/mcp` → `runway.com/news/mcp` · `help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent` (403, WebFetch + curl UA) · `.../45763528999699-Introduction-to-Workflows` (403, WebFetch + curl UA)
**Vendor UX:** `docs.warp.dev/agents/permissions` (404) · `docs.warp.dev/agent-platform/agent/using-agents/agent-profiles-permissions` · `docs.warp.dev/agents/using-agents/agent-profiles-permissions` · `linear.app/docs/agents-in-linear` · `linear.app/developers/agents` · `linear.app/developers/agent-best-practices` · `linear.app/changelog/2025-06-04-agents` (404) · `cursor.com/docs/agent/plan-mode` · `manual.raycast.com/ai` · `www.granola.ai/security` · `www.notion.com/help/review-and-approve-plans-before-notion-ai-runs` (WebFetch + curl; serves hub page) · `www.notion.com/help/notion-agent` · `help.figma.com/hc/en-us/articles/24919293730327-Figma-AI-FAQ` · `zerasoftwarestudio.com/portfolio` · `zerasoftwarestudio.com/terms`
**Beyond seeds:** `learn.microsoft.com/en-us/windows/apps/design/style/mica` · `.../style/acrylic` · `www.electronjs.org/docs/latest/api/base-window` · `www.radix-ui.com` (via search) · `elements.ai-sdk.dev/` · `www.nngroup.com/articles/progress-indicators/` · `www.nngroup.com/articles/ai-agents-as-users/` · `carbondesignsystem.com/elements/color/overview/` (content not retrievable) · `m3.material.io/styles/motion/overview` (content not retrievable)
**LICENSE checks (raw.githubusercontent.com, per worker rules — GitHub API not used):** `vercel/ai-elements/main/LICENSE` (Apache-2.0) · `carbon-design-system/carbon/main/LICENSE` (Apache-2.0) · `radix-ui/colors/main/LICENSE` (MIT) · `mrdoob/three.js/dev/LICENSE` (MIT) · `pmndrs/react-three-fiber/master/LICENSE` (MIT) · `shadcn-ui/ui/main/LICENSE.md` (MIT)

---

*End of L4 design-evidence research. Nothing in this document constitutes legal clearance. No assets, CSS, shaders or trade dress were copied; all patterns are abstracted to text.*
