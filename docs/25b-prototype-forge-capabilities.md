# 25b — Zeno Forge: **capability specification addendum** (B+C)

**Phase 0B · Gate 2 · Detailed prototype spec · Date: 2026-08-28 · Direction: B+C (owner-selected, `00-DECISIONS.md`)**

**What this is.** A build-ready design specification for the **Forge capability surfaces** the owner named
explicitly on 2026-08-28 (`00-DECISIONS.md` § "owner requirements for Zeno Forge"), plus the remaining
master-prompt §6.1 / §6.1.1 / §6.1.2 requirements the owner asked to have covered. It is an **addendum**,
not a replacement: `25-prototype-forge.md` (authored concurrently) owns the Forge narrative, journeys and
hero screens; **this file owns the capability surfaces** — workspace picker, three-region shell, runtime
selector, loaded-context panel, MCP subsystem, and the sixteen "everything else" surfaces. Where the two
files touch the same object, the object is the same object; neither invents a second one.

**Not product code, and authorizes no build.** Phases are followed strictly (`00-DECISIONS.md`,
2026-08-28): nothing is built until the owner reviews design + LLDs and says so.

**What it obeys and does not re-derive.** The shared **Zeno Glass** token family (`22-C` §1 — palette,
four-channel semantic law, type, spacing, depth budget, motion tokens, twelve states); the Forge plane
layout and identity bar (`22-C` §4); product scope, capability tiers and the independence contract
(`10-PRD` §4); the canonical IA node IDs (`11-` §7 — `P1`, `W1`–`W5`, `A1`–`A3`, `C1`–`C4`, `K1`–`K7`,
`D1`–`D4`, `S1`–`S8`); intake routing and the four independent paths (`11-` §10); the MCP `2026-07-28`
breaking-rewrite findings (`12-` K-5, ADR-0003, §MCP); and the forbidden compositions `F1`–`F7` (`20-` §1).

---

## 0. How B+C lands on these surfaces

### 0.1 The eight laws every screen in this file obeys

| # | Law | Consequence here |
|---|---|---|
| 1 | **3D Standing Field is Overview/navigation only** | Nothing in this file is 3D. Not one surface. The Field is where you *choose* a workspace from Command; the moment a workspace opens, you are on flat opaque planes |
| 2 | **Glass never behind code, diffs, terminals, transcripts** | Regions A/B/C/D/F, every inspector, every table: opaque `graphite-2` or `graphite-3`, no blur. The **only** translucent things in Forge are the command palette, the Approval Capsule, and the trust modal — all Layer 2, small, short-lived (`22-C` §1.5) |
| 3 | **≤ 3 depth layers** | Ground (`graphite-1` app chrome) → reading planes (`graphite-2`) → the one control layer. A popover over a panel that is already a popover is a defect |
| 4 | **Every animation maps to exactly one real state** | Determinate bars bound to real step counts; no spinner past 10 s without a typed reason; **ghost text does not fade in** (a per-keystroke fade maps to no state); no idle motion anywhere |
| 5 | **The list is primary; every graph is secondary with keyboard parity** | The run DAG, the session lineage graph, the task board, the dependency graph, the a11y tree: each is a toggle over a list that is the default and carries the full tab order |
| 6 | **WCAG 2.2 AA; focus is a real border, never a glow** | 2 px `edge-active` cyan border, offset 1 px, on every focusable. Never a shadow, never a bloom. ≥ 24×24 px targets |
| 7 | **Semantic colour is reserved** | cyan = system/current object · gold = owner selection · **amber = a decision is owed to you** (approval, conflict, reduced capability, drift) · **red = blocked/error/destructive/denied only** · `verify-green` seal = *a verified receipt exists*, never before |
| 8 | **Hardware is UNKNOWN (B-002)** | Every millisecond, token, MB and FPS in this document is a **target to measure**, printed as a target. A figure with no measurement renders in the UI as `— not yet measured`, never as a zero and never as a guess |

### 0.2 Two reconciliations, named rather than silently chosen

**R-1 — the frame is `25-`'s, not this document's.** `25-prototype-forge.md` §1.1–1.2 defines the
canonical Forge frame as **six regions**: `A · Navigator` · `B · Work plane` · `C · Inspector`
(Conversation / Plan / Actions / the Lens) · `D · Drawer` (Terminal / Tests / CI / Processes & Ports) ·
`E · Identity strip` · `F · Observable Execution Stream`. **That frame is authoritative.** Where this
document says "three regions", it is shorthand for the owner's requirement — navigator, primary opaque
editor/diff plane, contextual chat + action stream — and it maps onto the canonical frame exactly:

| This document's shorthand | Canonical region (`25-` §1.2) |
|---|---|
| Navigator | **A · Navigator** — this document adds the workspace switcher, per-repo isolation strip (§1.5) and the eight rail panels (§2.1) |
| Primary opaque editor/diff plane | **B · Work plane** — this document adds the tab types, split rules and diff/preimage behaviour (§2.2) |
| Contextual **chat** | **C · Inspector ▸ Conversation** — this document adds the composer, the follow-up classifier and the citation contract (§2.3, §2.5) |
| Contextual **action stream** | **F · Observable Execution Stream** — a separate bottom band, *not* a track inside C. This document adds four event kinds and the filter set (§2.3) |
| Terminal drawer | **D · Drawer**, splitting under B, collapsed by default, opening on owner action or on a `blocked`/`error` event that names it (§2.4) |
| Mode · model · permission bar | **E · Identity strip** — this document adds the runtime chip and the egress chip (§3.1, §3.5) |

`22-C` §4.1's older sketch (terminal as the third column, OES as a bottom band) is superseded by
`25-` §1.1; this document does not re-open it.

**R-2 — Forge's context panel vs `C1`.** `10-PRD` §4.3 forbids a second context truth. The Loaded Context
panel (§4) is therefore a **projection of `C1` scoped to the current session**, reading the same context
manifest object. It adds no retrieval of its own; "Open full inspector" hands off to `C1` with the same
manifest hash.

### 0.3 The geometry — sizing and behaviour this document adds

The frame itself is `25-` §1.1. What this addendum contributes is the **sizing, collapse and focus
behaviour** of the capability surfaces that live inside it:

| Region | Default | Range | Collapse | Focus treatment |
|---|---|---|---|---|
| **A · Navigator** | 48 px icon rail + 280 px panel | 240–420 | `Cmd/Ctrl+B` → rail only | selected row `edge-select` gold |
| **B · Work plane** | flex, ≥ the measured minimum (§8 #1) | — | never collapses | focused pane `edge-active` cyan |
| **C · Inspector** | 380 px | 320–560 | `Cmd/Ctrl+J` | focused pane `edge-active` cyan |
| **D · Drawer** | closed | `0 / 240 px / full`, `Ctrl+\`` cycles | collapsed by default | `edge-key` on its top edge only |
| **E · Identity strip** | 28 px | fixed | never | chrome, not a pane; every field tab-reachable |
| **F · Execution stream** | 22 px collapsed summary / 200 px open | resizable | summary row always visible | `edge-key` top |

Every border is a **Foundry Edge** (`22-C` §1.5): 1 px `edge-key` top/left, 1 px `edge-shadow`
bottom/right, `edge-active` cyan on the focused region only. Depth is read from edge luminance. There is
no shadow, no blur, no translucency anywhere in the frame.

---

## 1. The Cursor-class workspace — open **any** folder

The owner's requirement #4. Forge is not a launcher for four known repositories; it opens arbitrary
folders and multi-root workspaces, and the *choice of folder* is what routes the intake.

### 1.1 `F0` — the Workspace Picker

Reached from: Forge cold start (it **is** the cold-start view), `Cmd/Ctrl+Shift+O`, the workspace name in
the Identity Bar, or the Standing Field in Command (the one place 3D touches this flow — you fly to a
workspace node, and the moment it opens you are on flat planes).

Full-window, opaque `graphite-1` ground with one `graphite-2` reading plane. Three stacked sections,
list-primary throughout:

| Section | Contents | Row anatomy |
|---|---|---|
| **Open** | Two buttons and a path field | `Open Folder…` · `Open Workspace File…` · a monospace path field that accepts a typed/pasted absolute path and validates on blur (`exists` / `not a directory` / `no read permission` / `symlink → resolved target shown`) |
| **Recent** | Up to 40 rows, newest first, filterable by a single search field (fuzzy over name + path) | `[trust glyph] name · dirname` · `roots: N` · `branch` (if git) · `last opened, relative + absolute on hover` · `index: fresh / stale / none` · `zone chip Z1/Z2` · pin toggle (gold when pinned — owner selection) |
| **Saved workspaces** | `.zeno-workspace.json` multi-root definitions | name · `N roots` · the root list on expand · `edit` · `duplicate` · `remove from list` (never deletes the file — deletion is not offered here at all) |

**Row states:** `available` · `moved or deleted` (row dims, red glyph, offers *Locate…* / *Remove from list*) ·
`on an unmounted volume` (amber, offers *Retry*) · `open in another Forge window` (gold "you are here" chip,
click focuses that window rather than opening a second session — the duplicate-session failure mode
`6.1.1` calls out by name).

**Empty state:** proven-empty only — "No recent workspaces" appears when the store was read successfully
and is empty. If the store failed to read, the section shows `degraded — recent-workspace store unreadable
(reason)` with a *Retry*, never a blank list (`11-` §8.1 `empty` vs `degraded`).

**Forbidden:** a hard-coded repository list; a "QuillBot" section that implies those four repos are
privileged citizens of the picker; any 3D object on this screen; a carousel of workspace cards (`F3`).

### 1.2 Multi-root

A workspace is an **ordered list of roots**. Add/remove without restarting the session:

- **Add root** — `+` in the Region-A workspace header → folder picker → the trust flow (§1.4) runs for the
  new root **alone**; already-trusted roots are untouched.
- **Remove root** — row overflow → *Remove from workspace*. If a session has open buffers, running tasks,
  or a loaded rule set from that root, the confirm dialog lists them by name and says exactly what will be
  closed, cancelled or unloaded. Removal never deletes files, never touches git.
- **Reorder** — drag or `Alt+↑/↓`. Order is meaningful: it is the tie-break in rule precedence (§4.4) and
  the default order of per-repo lanes in a cross-repo plan (§6.12).
- Each root carries its own identity chip everywhere it appears. **There is no merged view.** No merged
  file tree, no merged search index, no merged rule namespace, no merged source-control list.

### 1.3 How the four QuillBot repos differ from an arbitrary personal folder

They differ in exactly three ways, and the UI states all three on the row:

| | QuillBot workflow repo | Arbitrary folder |
|---|---|---|
| **Zone** | `Z2` company-authorized. Chip is drawn on every row, tab, diff header and receipt | `Z1` personal. Same chip design, different value |
| **Intake route** | `ASSISTANT_PROMPT.md` chain is **mandatory** (`11-` §10.5) — any edit/build request must attach to a canonical Intake | **Generic Manual Coding Intake** (`11-` §10.2) |
| **Declared-source profile** | Jira (`WEBEXT`+`WEBEXTOPS`, read-only), NeoSapien, Graphify (browser-add-on only), the repo's checked-in rules | Owner-approved goal + acceptance tests substitute for Jira; each of the four upstream sources may be marked `not_applicable` **individually, with a recorded reason** |

Detection is **evidence-based and shown**, never inferred from a name. The workspace header expands to a
**Route Card**:

```
ROUTE · QuillBot workflow repository
  matched: remote host gitlab.<host> ∈ workspace-policy allowlist        [evidence: git remote -v]
  matched: ~/Work/ASSISTANT_PROMPT.md present and configured authoritative [evidence: path + sha256 4f2a…]
  matched: .cursor/rules/ present (20 files)                              [evidence: dir listing]
  → Intake chain: MANDATORY. Build requires an Intake ID + approved plan hash.
  [ Not this route? Report a mis-route ]   [ View policy ]
```

For an arbitrary folder the card reads `ROUTE · Generic Manual Coding Intake` and lists the four sources
with their per-source marks. **Forge cannot set a `not_applicable` mark** — the control is owner-only and
renders disabled with the reason "owner or policy sets this mark; Forge cannot" (`10-PRD` §4.4 J-F3).
Mis-route reporting opens `S6` Work Intake Policy; it never silently downgrades the route.

**The interlock, stated as UI:** a Generic Intake cannot be started on a folder whose Route Card says
QuillBot workflow repo. The button is `blocked` (red), the reason line is
`MP §4.2 — the complete chain is mandatory for this repository`, and the only way through is `S6` policy,
which requires the owner.

### 1.4 Trust, on first open of an unknown folder

A Layer-2 modal (legitimate glass: small, short-lived, over a dimmed ground — no glass over code because
no code is loaded yet). It is a **blocking, focus-trapped** dialog with the safe option focused.

```
UNKNOWN FOLDER
/Users/abheet.isher/Personal Projects/thing            [copy path]

git remote   none                                        (not a known-trusted remote)
files        2,411 · 38 MB · largest tracked 2.1 MB
detected agent-configuration surfaces
  .cursor/rules/*.mdc        4 files    [view]
  AGENTS.md                  absent
  CLAUDE.md                  absent
  .mcp.json / .cursor/mcp.json  1 file  [view]     → servers start DISABLED regardless of choice
  git hooks (.git/hooks)     2 non-sample  [view]
  package lifecycle scripts  preinstall, postinstall  [view]
  devcontainer / compose     .devcontainer/devcontainer.json  [view]

[ Open read-only (untrusted) ]   [ Trust this folder ]   [ Cancel ]
  ^ default, focused
```

**Untrusted mode — what is off, shown as UI state, not as prose in a doc:**

| Surface | Untrusted behaviour |
|---|---|
| Repository hooks, git hooks, package lifecycle scripts | **Disabled.** Rendered in `S`→Automation with a hatch fill (not dimming alone — high-contrast requirement) and the label `disabled — repository untrusted`. They do not run because the folder was opened. Ever |
| Repo `.mcp.json` servers | Listed in `K2` as `imported · disabled · untrusted source`. No transport is opened |
| Checked-in rules `.mdc` / `AGENTS.md` / `CLAUDE.md` | **Listed but not applied.** They appear in the Loaded Context panel with state `untrusted — not applied` and a `[review & apply]` per file that shows the full content and records the hash on acceptance. Rationale: a checked-in rule is untrusted *text*, and the corpus treats poisoned text as a real threat |
| Modes | `Ask` / `Explore` only. `Plan` is available; `Build`, `Debug`, `QA` are `blocked` with the reason `folder untrusted` |
| Terminal drawer | Opens, but the shell starts from the pinned sanitized environment profile and the drawer header says `untrusted workspace — sanitized env` |
| Egress | Unchanged (governed by the model/provider posture, §3.8), but the workspace zone defaults to `Z1` and cross-zone reads are refused |

Trust is per **absolute resolved path**, recorded in a **Trust Ledger** row (path, decision, timestamp,
who, the config-surface fingerprint at decision time). If any listed surface's fingerprint changes later,
the workspace drops to a `trust-stale` state: an amber band appears in the Identity Bar reading
`repository configuration changed since you trusted it · [review diff]`, and hooks are suspended until the
diff is reviewed. Trust is revocable from `S3`, and revoking closes the write capability immediately.

**Forbidden:** remembering trust for a *parent* directory and silently applying it to children; a "trust
all folders in ~/Work" bulk switch; a trust dialog whose primary (focused) button is the trusting one;
running anything at all before the dialog resolves.

### 1.5 The per-repo isolation strip (Region A header)

Always visible, one row per root, collapsed to a single line, expanding to the isolation record. This is
the UI expression of "never flatten repositories into one index/memory".

```
▾ browser-add-on          Z2  ● indexed 24,7xx  main@a91f3c2  wt: /…-3514-wt   rules 20  skills 6  MCP 0
    ACL / zone            Z2 company-authorized · training eligibility: none
    index                 fresh · schema v3 · built 14:02 · 1 branch, 1 worktree isolated
    rules                 20 .mdc (set hash 8c2e…) · 4 active now
    skills                6 repo + 7 user (out-of-repo provenance flagged)
    remote / account      <remote> · <acting account>              [verify]
    branch / worktree     feat/… @ a91f3c2 · worktree /…-3514-wt
    test commands         resolved: <lint> <typecheck> <unit>       [from repo config, not assumed]
    Graphify scope        report-scope adapter, read-only · cache is never authority
    approvals             3 recorded for this session               [open A1]
```

`● / ○ / ◐` = index fresh / none / building, each with a determinate bar when a count is known. The
`Graphify scope` row appears **only** on `browser-add-on`, because Graphify exists only there
(`03b` §13.2 confirms zero references in `packages`) — an absent capability is rendered `not applicable`
on the other roots, never silently omitted.

---

## 2. Agent chat beside a real IDE surface

The owner's requirement #1: the agent conversation and its action stream sit **beside** an editor/diff
pane, not in place of it.

### 2.1 Region A — Navigator

48 px icon rail + 280 px panel (240–420, drag or `Cmd/Ctrl+B` to collapse). One panel at a time; the rail
holds: **Explorer · Search · Source Control · Runs · Review · Context · MCP · Automation**. Each icon
carries a numeric badge only when the number is real and non-zero (a badge is a claim).

- **Explorer** — per-root sections, never merged, each with its own header from §1.5. Collapsed roots keep
  their identity chip visible. Dirty buffers carry a dot; generated/ignored/vendored paths are dimmed with
  a `generated` tag and are **excluded from edit scope by default**.
- **Search** — exact first (`ripgrep`), with a visible engine chip: `exact` / `symbol` / `semantic`. The
  semantic tab is explicitly labelled `complement — not primary truth` (`10-PRD` §4.5). Results are grouped
  per root; a result row shows `path:line · symbol · commit · date`.
- **Runs** — the `W2` task list projected to this workspace (§6.8).
- **Review / Context / MCP / Automation** → §6.13, §4, §5, §6.11.

### 2.2 Region B — the primary plane. This is what must never be covered

Opaque `graphite-2`. Tab strip on top (`13 px` Inter, mono for file names). Tab types: **file editor**,
**diff**, **Run Detail**, **Review Workbench**, **Debug Ledger**, **Preview Inspector**, **Capability
Matrix**, **Environment Profile**. Splits: vertical/horizontal, max 3 panes (depth budget applies to
information density too); the focused pane takes `edge-active`.

- **Editor:** JetBrains Mono 13/1.35, `tabular-nums` off in code, line numbers `graphite-9`, current line
  a `graphite-3` fill (never a coloured wash), selection `graphite-5` + 1 px `edge-select` gold.
- **Diff:** side-by-side (default) or inline, per-hunk stage/revert controls in the gutter. Added/removed
  use **gutter glyphs `+`/`−` plus a left edge marker in a neutral non-reserved pair** — green/red are not
  the only signal and red stays free for *blocked* (`22-C` §4.1). Intra-line changes are **underlined**,
  not merely tinted. A word-level diff never re-flows whitespace silently; whitespace-only hunks carry a
  `whitespace` tag and can be filtered.
- **Agent-authored vs owner-authored** edits are distinguishable in the gutter (`▎agent` / `▎you`) and in
  the checkpoint layer (§6.2). An agent edit to a buffer the owner has dirty triggers a **conflict-aware
  preimage check**: if the preimage hash no longer matches, the write is refused and rendered as an amber
  card in Region C offering *re-read and re-plan* — never a silent overwrite.

### 2.3 The conversation (`C · Inspector ▸ Conversation`) and the action stream (`F`)

Two **separate** canonical regions (`25-` §1.2), not two tracks in one dock — C is the dock the owner
types into; F is the always-visible typed band across the bottom. A shared timeline links them: selecting
a turn in C scrolls F to the events that turn produced, and selecting an event in F highlights its turn.
C is opaque `graphite-2`, 380 px default (320–560), `Cmd/Ctrl+J` to collapse.

**Header (28 px):** session name (editable inline) · branch chip · child-session count · `⌥⇧S` search ·
overflow (`branch from here`, `rename`, `export`, `archive`, `duplicate`, `new child session`).

**Conversation (C).** Turn cards on `graphite-3`. An assistant turn carries: streamed text; **citation
chips** (§2.6); a proposed-edit block rendered as a **compact diff strip** with `open in editor` — the
full diff always opens in Region B, never expands inside the chat column (a diff inside a 380 px column is
a legibility failure); and a footer strip `model · effort · tokens in/out · elapsed · manifest hash`.

**Action stream (F).** The Observable Execution Stream, typed and reconnect-safe. **`25-` §5.1 is
authoritative for the event-type set, the row anatomy and the per-type focus policy** (`thought` renders a
summary and never moves focus; `elicitation` stops the run and does move focus). This document adds four
kinds only — `mcp`, `budget`, `compaction`, `child` — and the filter set. Rows are mono `11 px`:

```
14:02:31  tool   rg               "useComposer(" · 3 roots · 41 hits            0.3s   ✓
14:02:33  read   src/x/y.tsx      L120–188 · commit a91f3c2                     0.1s   ✓
14:02:40  edit   src/x/y.tsx      +12 −4 · preimage ok · checkpoint ck-14       0.2s   ✓
14:02:41  test   pnpm -w test     unit · 52 passed · 0 failed                   9.4s   ✓
14:03:02  mcp    figma.get_file   ask → APPROVED by you 14:03:01 · receipt r-88 1.1s   ✓
14:03:10  gap    reconnected · 2 events may be missing between 14:03:04–14:03:10
```

`gap` rows are mandatory on reconnect. Every row is expandable to sanitized inputs/outputs; **no row ever
contains raw hidden chain-of-thought** — a `thought` row is a summary, and everything else is *actions and
evidence*. Filters added here: kind, root, agent, "only failures", "only approvals", "only MCP".

**Composer.** Multi-line, `Cmd/Ctrl+Enter` sends. Above it, permanently: the **Context & Egress receipt
chip** (`G6`) — `pack: 41 items · 18.2k tok · Z2 · local · no egress`, click → §4. Left of it, the mode
selector; right, the runtime chip (§3). While a run is live the composer **stays enabled** — this is the
"persistent live build conversation" requirement — and a follow-up is classified before it is applied:

> `Your message will be applied as: ● redirect ○ add requirement ○ remove requirement ○ answer a question
> ○ edit plan ○ pause ○ resume ○ cancel ○ stop after current safe step` — the classifier's pick is
> pre-selected, the owner can change it, and the choice is shown in the action stream as an `approval`-kind
> row. **Barge-in** (`Esc`) always pauses at the next safe step and says which step that is; `G4` Global
Pause / Kill (`25-` §1.1) remains present and ungated regardless.

### 2.4 The drawer (`D`) — terminal and browser-QA

`D · Drawer` splits under `B`, **never overlays it**, and is collapsed by default — it opens on an owner
action or on a `blocked`/`error` event that names it (`25-` §1.2), never on output. Heights: `0` (closed) / `240 px` / `full` (`Ctrl+\``,
`Ctrl+Shift+\`` cycles). Tabs: one per PTY or QA session, each labelled with **cwd + root + host/container**
(`browser-add-on · /…-3514-wt · local`). Header row per tab: exit code of the last command, elapsed,
`running` state with a determinate bar only when the command reports progress. Controls: send signal,
terminate **process tree** (never a bare kill of the leader), reconnect, copy sanitized transcript.

The drawer is opaque `graphite-2` with `edge-key` on its top edge only. It **never floats over the editor** and never
opens over the diff during an approval — an approval capsule and a terminal cannot occupy the same pixels;
the capsule is Layer 2 and appears anchored to the Identity Bar, not over the code.

### 2.5 Chat ↔ editor synchronisation: the citation contract

Every claim the agent makes about the code carries a **citation chip**:

```
[ browser-add-on · src/x/y.tsx:214 · a91f3c2 · read 14:02 ]
```

Five fields, always: **root · path:line · commit · when-read**, and a freshness marker. Behaviour:

- **Click** → Region B opens that file at that line, in the pane that had focus before Region C did,
  scrolls the line to the *upper third*, flashes a 1 px `edge-active` line marker for `dur-2` (one state:
  "this is the cited line"), and leaves the caret there.
- **Hover** → a 3-line peek in a Layer-2 popover anchored to the chip (small, short-lived — allowed).
- **Reverse sync** — selecting text in Region B and pressing `Cmd/Ctrl+L` inserts the same five-field
  citation into the composer. The agent therefore receives exactly the reference the owner is looking at.
- **Staleness** — if the file changed on disk or in the buffer since `when-read`, the chip turns amber and
  reads `stale · file changed at 14:07`. Clicking offers *jump anyway* / *re-read*. If the commit no longer
  exists (rebase), the chip turns red `commit missing after rebase` and jump is disabled.
- A citation to a line **outside** the workspace roots is refused at render time and shows
  `out of scope — not in this workspace`.

### 2.6 The overlap law

**Nothing may overlap `B`, `D` or `F`, or the conversation in `C`.** Not a toast, not a
notification, not an approval, not a progress HUD, not a model picker, not a preview. Enumerated:

| Thing | Where it goes instead |
|---|---|
| Approval request | Approval Capsule anchored under the Identity Bar (Layer 2, ≤ 420 px wide), **plus** an `approval` row in the action stream. Never over the diff it concerns — the diff is what you are reading to decide |
| Notification | Status Rail, left segment, with a queue count. Click opens the list in Region C |
| Progress | Determinate bar in the Status Rail + the live row in the action stream |
| Model picker, palette, trust dialog | Layer 2, allowed, **but only over Region A/C or the ground** — the palette is centred over the window and dims the ground; it is the one full-attention control and it is short-lived |
| Tooltips / peeks | Layer 2 popovers anchored to their trigger, ≤ 320 px, dismiss on blur |
| Anything else | Becomes a Region-B tab or a Region-C card |

**Narrow windows.** `25-` §1.5 is authoritative for the collapse order (Wide `A·B·C` → Medium: `A` to a
56 px rail and `C` to a **slide-over on the same opaque plane** → Narrow: `A`, `C`, `D` as full-width
sheets from a fixed tab bar, `B` at full width → Minimum: the stream and the identity strip). Two things
this document adds:

1. **The overlap law is about translucency and uninvited chrome, not about an opaque sheet the owner
   opened.** A Medium-band slide-over `C` is legal precisely because it is opaque, owner-invoked and
   dismissible; a toast, an approval or a progress HUD floating over `B` is not, at any width.
2. **The band boundaries must be measured, not chosen.** The Wide→Medium boundary is defined as *the
   width below which `B` can no longer show the target reading measure* (100 columns of JetBrains Mono 13
   plus gutters — §8 #1). Until that is measured on real hardware the boundary is a placeholder, and the
   identity strip states the consequence honestly at Medium and below:
   `chat is a slide-over at this window size · widen to restore the side-by-side view`.

The owner's requirement — chat *beside* code — is a **Wide-band** guarantee. Below Wide it degrades
visibly and says so; it is never silently satisfied by an overlay.

### 2.7 Keyboard map (parity is not optional)

`Cmd/Ctrl+P` file · `Cmd/Ctrl+Shift+P` palette · `Cmd/Ctrl+Shift+F` search · `Cmd/Ctrl+B` Region A ·
`Cmd/Ctrl+J` Region C · `Ctrl+\`` drawer · `F6` cycle regions · `Cmd/Ctrl+K M` mode · `Cmd/Ctrl+K R`
runtime · `Cmd/Ctrl+K C` loaded context · `Cmd/Ctrl+K T` MCP registry · `Alt+↑/↓` prev/next action-stream
row · `Enter` on a row expands · `Cmd/Ctrl+L` cite selection · `Esc` barge-in. Every graph view's
operations are reachable from its list; the graph is never the only route to an action.

---

## 3. Model + effort selector

The owner's requirement #2. One chip, one popover, and one law: **the UI never claims a capability the
runtime has not demonstrated.**

### 3.1 The chip (Identity Bar, always visible)

```
Build │ qwen3-coder-30b Q5_K_M │ LOCAL │ ctx ▓▓▓░░░░░░░ 34k/128k │ effort M │ ⛨ no egress │ ⚠ REDUCED
```

Mono, `11 px`, `tabular-nums`. Fields, left to right: **mode** (colour-neutral; Ask/Explore render with a
read-only glyph) · **model id + quantization** · **LOCAL / CLOUD** (see §3.8) · **context meter**
(determinate, real token count, turns amber at 80 %, red at 95 %) · **effort tier** · **egress posture** ·
and, only when true, an amber `REDUCED` token. Click or `Cmd/Ctrl+K R` opens the popover.

### 3.2 The popover (Layer 2, ≤ 520 px, list-primary)

Seven rows, each stating a fact and its provenance:

| Row | Contents | Truth rule |
|---|---|---|
| **Model family / id** | Grouped list: `Local (Ollama · llama.cpp/MLX)` and `Remote (approved providers)`. Each entry: id, revision/model-card hash, quantization, weight licence + code licence as **separate** columns (`10-PRD` §2.5 four-column rule), and a hardware-fit marker | A model whose licence column is `noncommercial / research-only / ambiguous` carries an amber flag and cannot be selected for `Z2` work |
| **Local vs remote badge** | `LOCAL` (runs on this machine) / `CLOUD · <provider> · <region>` | Never inferred from the name. Derived from the resolved runtime endpoint |
| **Context size** | `used / window`, plus the **packer budget** — `system 1.2k · rules 3.4k · skills 2.1k · code 9.8k · transcript 4.1k · reserve 3k` | Segments come from the real context manifest (§4), not an estimate. If the packer has not run, the row reads `— not yet packed` |
| **Cost** | Metered provider: `in $X / 1M · out $Y / 1M · session: 41.2k in / 8.9k out = $Z` against the `S4` budget. Local: `local — no per-token cost`, plus measured energy/thermal **when a measurement exists** | Never a projected or typical cost. `— not yet measured` until this machine has produced a sample |
| **Latency** | `first token p50 · tok/s p50 · n samples` measured **on this machine in this session** | Same rule. B-002 means every latency figure here starts as `— not yet measured` |
| **Effort / reasoning tier** | `Minimal · Low · Medium · High · Max`, each with its concrete mapping shown: max tool iterations, plan depth, self-review passes, retry budget, token ceiling, and the harness's reasoning-parameter mapping | The tier is a **harness mapping**, and the popover says which harness maps it. A model with no reasoning control shows the tier as `not supported by this model — effort affects loop budget only` |
| **Harness profile** | `name · version · content hash` (e.g. `qwen-coder / 2.3.1 · a91f…`) with `view profile` → system/tool prompting, tool-schema dialect, patch/edit protocol, planning loop, context packing/compaction, retry policy, stop rules, effort mapping. Selector: `automatic (measured routing)` / a pinned profile | Weights, provider adapter and harness are three separately versioned components and are shown as three rows, never as one "model" |

Footer of the popover: **`Run conformance`** (§3.6) and **`Compare`** → `K4` (latency/cost/quality
comparison across candidates, with `D2` eval evidence).

### 3.3 Per-session and per-agent override

- **Per session:** the popover's selection applies to the current session only and is stamped into the
  session record; the chip shows a gold `overridden` dot when the session differs from the workspace
  default (gold = owner selection).
- **Per agent:** `W3`-projected **Agent Roster** panel — rows `planner · explorer · implementer · reviewer ·
  browser-QA · security · CI · release` plus any ad-hoc child session. Columns: model, effort, harness,
  tool grants, MCP grants (§5.7), data zone, worktree, budget. Each cell is individually overridable; an
  unset cell shows `inherits: session` explicitly — **inheritance is displayed, never assumed**.
- Precedence, printed at the bottom of the roster: `policy > per-agent override > per-session override >
  workspace default > global default`. Policy caps (e.g. "no cloud model for `Z2` without the egress path")
  render the offending cell red with the policy name.

### 3.4 Capability negotiation, made visible

The conformance suite (`MP` §6.5) tests nine axes. Six are **task-required** and are the ones the owner
named: **tool calling · structured output · streaming · cancellation · context length · vision**. Three
more are recorded but not blocking on their own: **embeddings · reasoning/effort control · error
recovery**.

Each axis, per `model × harness × runtime build`, has exactly one of four states:

| State | Render | Meaning |
|---|---|---|
| `verified` | `verify-green` seal + `verified · HH:MM` | The conformance suite ran against **this** model+harness+runtime build and passed. The seal is the only green in the system and it never appears before the receipt exists |
| `failed` | red glyph + one-line reason + `view transcript` | Ran and failed |
| `unverified` | neutral glyph, `never measured` | Has not been run. **Not** a pass |
| `not applicable` | dimmed, with reason | e.g. vision on a text-only model |

**The rule the owner asked to be visible:** a model that fails a **required** capability for a task either
enters a **visible reduced-capability mode** or is **rejected for that task**. Never silently degraded.
Which of the two is decided by whether the task can be honestly performed without the axis:

| Failed axis | Reduced-capability mode | Rejected for |
|---|---|---|
| **Tool calling** | none — there is no honest reduction | `Plan · Build · Review · Debug · QA`. Only `Ask`/`Explore` remain, and the mode selector shows the others `blocked · model cannot call tools` |
| **Structured output** | Plans render as **unvalidated text**; the plan editor is read-only; approvals that bind to a plan **hash** still work, approvals that bind to plan *fields* are blocked | Any workflow node with typed inputs/outputs; MCP calls with strict schemas |
| **Streaming** | Turns arrive whole. The action stream still emits per-tool rows; the transcript shows `buffered — no token streaming` instead of a fake progressive reveal | Nothing outright, but the "live build conversation" is degraded and says so |
| **Cancellation** | **Hard stop.** No reduced mode is offered for long-running work: `Build`, `QA` and any workflow with a budget are blocked, because an uncancellable agent cannot honour barge-in or a budget | `Build · QA · workflows` |
| **Context length** (below the packer's floor for this task) | The packer drops the lowest-precedence tiers and **lists exactly what it dropped** in the manifest with a `dropped for context` state | The task, if a `required`-marked source cannot fit — Forge refuses rather than silently truncating a required rule |
| **Vision** | Screenshot/visual-diff evidence is captured and stored but **not shown to the model**; the transcript says `image evidence withheld — model has no vision` | Visual-acceptance and visual-diff review steps |

**Rendering of reduced mode.** Three simultaneous, non-dismissible signals: (1) the amber `REDUCED` token
in the Identity Bar; (2) an amber band at the top of Region C naming the axis, the model, and the exact
consequence in one sentence; (3) an amber marker on **every control the reduction touches**, with the same
reason on hover. Entering reduced mode writes a row to the action stream and to `D3` Audit Search. It never
expires silently — it clears only when a re-run of the conformance suite passes, and the clearing is itself
an event.

**Forbidden:** a capability shown as available because the model *usually* supports it; a green seal from a
different quantization, harness version or runtime build; falling back to another model without saying so
(a fallback is a *routing decision* and renders as a `model changed` row in the action stream plus a chip
change); "runs on any model" claimed anywhere in the UI.

### 3.5 Provider / egress chip

The right-hand segment of the Identity Bar, and it is the single most important chip in Forge:

| State | Render | Means |
|---|---|---|
| `⛨ no egress` | neutral | Every model call in this session has been local. Nothing has left the machine |
| `⛨ local-only (enforced)` | neutral + padlock | Policy forbids remote calls for this workspace/zone. A remote model cannot be selected; the attempt shows the policy |
| `↗ CLOUD · <provider> · <region>` | **amber** while a remote call is in flight, neutral otherwise | Context is leaving, or has left. Click → the per-call egress ledger: destination, sanitized payload **hash**, classes included/omitted/transformed, retention, approval id |
| `↗ blocked` | red | A remote call was attempted and refused by policy. The reason and the policy name are shown |

Every remote call is per-call, destination-bound, and its approval binds to the **final sanitized payload
hash** (`10-PRD` §4.8, SAN-AC-08). The chip changes **before** the call, never after. Prompt-cache state is
shown here too: `cache: hit 62 % · keyed by user/model/harness/policy/zone/repo@rev/rules-hash/manifest-hash`
— and a key mismatch purges rather than reuses.

---

## 4. Rules and skills from the codebase, on demand

The owner's requirement #3. The panel is `Region A → Context`, and it is a projection of `C1` (R-2).

### 4.1 Why per-repo keying is mandatory — the evidence, stated honestly

The owner's ruling: the four in-scope repos carry **38 Cursor `.mdc` rules**, plus **7 user skills**, and
**same-named rules genuinely diverge** — `identity-rule.mdc` has **three distinct content hashes**.
A global rule namespace is therefore not a simplification; it is a **defect** that would let one
repository's conventions govern another.

**What the Phase-0 record independently verifies, and what it does not:**

| Claim | Status in the Phase-0 artifacts |
|---|---|
| `browser-add-on` — 20 `.mdc` rules (~280 KB), 6 repo skills, 3 commands, no `.mcp.json` | **Verified** (`03b` §13.1) |
| `packages` — 7 `.mdc` rules (~29 KB) incl. `identity-rule`, `.cursor/mcp.json` present (323 B), no `AGENTS.md`/`CLAUDE.md` | **Verified** (`03b` §13.2) |
| `edit-stream`, `rest-server` — the remaining ~11 `.mdc` rules | **Not inventoried.** Both roots entered scope in the v2 delta of 2026-08-28 (`01-` §v2) after `03b` was written |
| `identity-rule.mdc` × 3 distinct hashes | **Owner-stated**, not re-verified in these artifacts |
| 7 user skills at `~/.claude/skills` (`quillbot-lt-conventions` is 137,906 B) | **Verified** (`03b` §13.3) |

Design consequence: the panel is built around hashes it computes itself, so it is correct whether the count
is 27, 38 or 44. The two unverified rows are carried into §8 as measurement items, not papered over.

**A second, sharper reason for per-repo keying, already in the record:** `browser-add-on` operates a
documented **three-surface sync contract** — `.cursor/rules/*.mdc` (authoritative) → `AGENTS.md` mirrors →
`CLAUDE.md` mirrors, all required to move in one commit per `agent-config-sync.mdc` (`03b` §13.1). A global
namespace would flatten three intentionally distinct mirror surfaces into one and destroy the contract.
`packages` has **no** `AGENTS.md`/`CLAUDE.md` layer at all — so "the same rule" does not even have the same
surfaces in two repos.

### 4.2 Panel anatomy

```
LOADED CONTEXT · session s-2291 · manifest 7d13…c04 · packed 14:02:11 · 18,212 tok / 24,000 budget
[ all ] [ rules ] [ skills ] [ instructions ] [ code ] [ memory ] [ conflicts 2 ]      [ open C1 ↗ ]

⚠ CONFLICTS (2)                                                              [ resolve ]
  identity-rule.mdc — 2 divergent versions active across roots
  test-command — repo config and user skill disagree

▾ RULES · browser-add-on  (20 present · 4 active · set hash 8c2e…)
  ● identity-rule.mdc          always      4f2a…c19   R3 repo-root   1,204 tok   [why] [exclude]
  ● e2e-testing.mdc            glob        9b71…3ff   R4 path        3,980 tok   [why] [exclude]
  ○ pdf-tools.mdc              glob (no match)         —             0 tok       [why] [include]
  ⊘ graphify.mdc               always      c0d2…8a1   R3 repo-root   —           [why] — excluded by you 13:58

▾ RULES · packages  (7 present · 1 active · set hash 55ad…)
  ● identity-rule.mdc          always      e77b…412   R3 repo-root   1,118 tok   [why] [exclude]
        ⚠ same name, different content from browser-add-on/identity-rule.mdc — see conflicts

▾ SKILLS · repo  (browser-add-on · 6 present · 1 active)
  ● code-explorer.md           triggered by "explore"/symbol query   2f90…77c   R5   890 tok

▾ SKILLS · user  (~/.claude/skills · 7 present · 1 active)
  ● quillbot-lt-conventions    triggered by root=browser-add-on      1a4e…b20   R6   4,100 tok
        ⓘ out-of-repo provenance · employer-derived · Z2 · 137,906 B source, 4,100 tok packed

▾ INSTRUCTIONS  AGENTS.md (browser-add-on) · CLAUDE.md (browser-add-on) · [packages: absent]
▾ OMITTED (11)   what was considered and left out, with the reason for each
```

**Never omit the omissions.** The `OMITTED` group is mandatory and lists every candidate the packer
considered and dropped, each with one of: `no trigger match` · `excluded by you` · `below relevance
threshold (score)` · `dropped for context budget` · `zone-filtered (Z1↛Z2)` · `untrusted — not applied` ·
`superseded by precedence (by whom)`.

### 4.3 Row anatomy

`[state] [name] [trigger] [content hash, 8 chars, click to copy full] [precedence rank] [token cost] [why] [include/exclude]`

- **State:** `●` active · `○` present, not triggered · `⊘` excluded by owner · `⚠` in conflict ·
  `🔒` policy-pinned (cannot be excluded) · `untrusted — not applied`.
- **Scope chip:** every row is inside a root-scoped group and additionally carries the root name in its
  tooltip and in the manifest. Scope is **never** colour-coded per repo (that would be `F4`, a domain-to-hue
  mapping); it is a text chip.
- **Hash:** `sha256`, first 8 shown, full on click. The **set hash** per root covers the ordered list of
  (path, hash) pairs, so a rule added or removed changes the set hash even if no file content changed.
- **`[why]`** opens a card: the trigger that fired (`alwaysApply: true` · glob `src/**/*.tsx` matched
  `src/x/y.tsx` · semantic match score `0.71` over query `…` · explicit owner pin · required by
  precedence rank), the exact matched text or glob, the resolved path, the file's mtime and git commit, and
  **what it contributed to the pack** (token count and the first/last lines actually included, since a
  108 KB rule like `e2e-testing.mdc` is necessarily excerpted — the card shows *which* excerpt, by line
  range).

### 4.4 Precedence — declared, ranked, and printed

```
R0  policy library (enforced)              cannot be weakened by any repo rule, skill, model output, or bypass
R1  owner session pins / exclusions        this session only, gold marker
R2  workspace configuration                .zeno-workspace.json
R3  repo-root checked-in rules             .cursor/rules/*.mdc with alwaysApply, per root
R4  repo path-scoped rules                 glob-matched; deepest matching path wins
R5  repo skills                            .cursor/skills/*.md, triggered on demand, per root
R6  user skills                            ~/.claude/skills/*/SKILL.md — lowest, flagged out-of-repo
R7  harness / model defaults
tie-break within a rank: workspace root order (§1.2), then path depth, then filename
```

The ladder is printed at the bottom of the panel — it is not tribal knowledge. `R0` rows render with a lock
and no toggle. **`R6` is deliberately lowest and deliberately flagged**: the user skills live outside every
repository and, in at least one case (`quillbot-lt-conventions`), duplicate employer-derived content across
a trust boundary (`03b` §13.3). A user skill never outranks a checked-in repo rule.

**Cross-repo application is structurally refused.** A rule from root A cannot enter the pack for a file in
root B. If the packer is asked to, the manifest records `cross-scope grant required` and the run blocks with
the reason — never a silent flatten.

### 4.5 Conflicts are surfaced, never silently won

A conflict is: two active items with the **same name** and different hashes; or two items whose directives
contradict on the same subject (detected by the packer's directive extractor, which is allowed to be
imperfect — it flags candidates, it does not adjudicate).

The conflict card:

```
⚠ CONFLICT · identity-rule.mdc
  A  browser-add-on/.cursor/rules/identity-rule.mdc   4f2a…c19   modified 2026-07-21   1,204 tok
  B  packages/.cursor/rules/identity-rule.mdc         e77b…412   modified 2026-05-02   1,118 tok
  ⟂  same filename, divergent content. These are two rules, not one.

  contradicting directives (extracted, both quoted with line refs):
    A:14  "…"                                        B:9   "…"

  RESOLVE
   ( ) Keep both, scoped per root      ← recommended; this is what per-repo keying is for
   ( ) Use A for this session          ( ) Use B for this session
   ( ) Ask me each time                (default until resolved)
   [ ] Remember for this workspace  → writes a receipt to D3 and shows in S1 config diff

  Until resolved: BOTH are marked ⚠ and neither is applied to a file in the other's root.
  Build in an affected root is BLOCKED with reason "unresolved rule conflict".
```

Amber, not red — an unresolved conflict is *a decision owed to you*. It turns red only at the point it
**blocks** a Build step, and then the red is on the blocked step, citing the amber conflict. A conflict is
never auto-resolved by recency, size, specificity or model judgement. "Keep both, scoped per root" is
recommended because in this workspace it is almost always the truth: `identity-rule.mdc` in two repos is
two different rules that share a filename.

### 4.6 Manual include / exclude, and change detection

- Every row (except `R0`) has `include` / `exclude` for the session, and `pin` to force inclusion at `R1`.
- Exclusions are visible (`⊘`) and counted in the panel header, so a quiet exclusion cannot masquerade as
  "not triggered". Excluding an item that another item declares a dependency on shows the dependency and
  asks.
- **Hash change → re-review.** If a rule/skill file changes on disk mid-session, its row turns amber with
  `changed since packed · [diff] [re-pack]`, and the manifest hash in the header goes amber. Any approval
  that was bound to the previous manifest hash is invalidated and says so. This is the same law MCP servers
  live under (§5.1) applied to instructions.
- The whole manifest is exportable (`json` + human-readable `md`) and is attached to every run receipt and
  every LLD/plan approval.

---

## 5. MCP and connectors as first-class surfaces

The owner's requirement #5. Two IA nodes: **`K2` MCP Registry & Inspector** and **`K1` Integrations &
Connector Health**. Both are reachable inside Forge (Region A → MCP) and in Command; **it is the same
registry object**, scoped by a global/per-workspace toggle.

### 5.1 `K2` — the registry list

Columns (list-primary, sortable, filterable): **name · namespace · state · transport · origin & pin ·
scopes · roots · zone · health · last use · owner**.

```
state       ● enabled   ○ disabled   ⧗ pending review   ⚠ quarantined   ✕ failed
transport   stdio | Streamable HTTP        (only these two exist — see §5.8)
origin&pin  package/URL + version + sha256 checksum, all three, all shown
scopes      the exact declared scopes, never "standard"
roots       the exact filesystem roots granted, absolute, never "workspace"
zone        Z1 / Z2 — a server may not read across zones
health      ok · degraded(reason) · unreachable · schema-changed
```

**The change interlock, as UI.** Any change to a server's **tool set, resource set, prompt set, schema,
scopes, transport, endpoint, version or checksum** flips the row to `⧗ pending review`, **disables it
immediately**, and blocks every agent grant that referenced it. The row reads
`disabled — tool schema changed (3 added, 1 removed) · [review diff]`. Approval is per-change and writes a
receipt. There is no "always allow updates" switch.

Bulk actions: `disable all` (one click, always available, no confirm — turning things off is never gated),
`export registry` (no secrets), `import…` (§5.6). Bulk **enable** does not exist.

### 5.2 The Inspector

Opens as a Region-B tab (opaque, full width — schemas and receipts need the room). Seven sections:

1. **Identity & provenance** — declared name, namespace, publisher, source URL/package, pinned version,
   **sha256 of the artifact**, signature status if any, licence (four-column), install date, who approved,
   and the diff since last approval. `unverified provenance` is a state, printed, not hidden.
2. **Capabilities** — three tables: **tools**, **resources**, **prompts**. Each tool row: name, one-line
   description, **full JSON Schema** (collapsed, monospace, copyable), destructive/idempotent hints,
   and a **description-risk marker** if the sanitizer finds imperative text aimed at the model inside the
   description (the poisoned-tool-description surface, `12-` §7). Marked descriptions are shown with the
   suspect span highlighted and are treated as untrusted data.
3. **Scopes & roots** — requested vs granted, side by side. Granting is per item, never "grant all". A root
   outside the workspace is refused at grant time.
4. **Credentials** — **destination only**: which store holds it (`Keychain: zeno.mcp.<server>`), which
   account it authenticates as, expiry, and last rotation. **A value is never displayed, never copied,
   never logged, never placed in a prompt.** Controls: `re-broker`, `revoke now`.
5. **Policy** — the per-tool matrix (§5.3).
6. **Health, logs & quotas** — start/stop/restart, reconnect, timeout/retry/cancel settings, quotas
   (calls/min, tokens, wall-clock, output bytes), current usage against them, and a sanitized log tail.
7. **Receipts** — every call this server has served: time, agent, tool, **argument digest** (not arguments),
   result size, duration, approval id, outcome. Exportable. Immutable, hash-chained to `D3`.

Persistent footer, always reachable: **`Disable` · `Revoke credentials` · `Uninstall`**. All three are
single-click and immediate. Uninstall additionally removes grants and says how many were removed.

### 5.3 Per-tool allow / ask / deny

A three-state control on every **tool**, not on the server:

| | Meaning |
|---|---|
| **allow** | Runs without an interruption. Still fully audited, still policy-checked before **and** after, still counted against quotas |
| **ask** | Default for everything. Raises an Approval Capsule showing server · tool · **the exact resolved arguments** · destination · zone · estimated cost — with a diff against the last approved call of the same tool, so a changed argument is visible |
| **deny** | Refused deterministically at the gateway. The model is told the tool is unavailable; it is not told "ask the user to enable it" |

Defaults on install: **every tool `ask`**, every read-only tool still `ask` until the owner has seen one
result. Bulk `allow` on a server does not exist; bulk `deny` does. A tool added by a later version arrives
as `ask` **and** the server is `pending review` (§5.1) — a new tool cannot inherit an old tool's `allow`.

### 5.4 Sandboxed test call

Inside the Inspector, under each tool:

```
TEST CALL  (sandboxed)                      profile: no network · temp root · 10s · 64KB out
 arguments   [ form generated from the JSON Schema · required fields marked · example prefilled ]
 [ Dry run ]  → validates arguments against the schema, resolves the transport, and stops.
               Shows exactly what would be sent (argument digest + rendered payload) and where.
 [ Run in sandbox ] → executes with the profile above. Result is rendered in a QUARANTINE FRAME:
               monospace, links inert, images not fetched, any imperative text flagged
               "instructions detected in tool output — treated as data".
 Result never enters the session context unless you press [ Attach to session ], which
 records an attach receipt and shows the sanitizer's classification.
```

The distinction between **dry run** (nothing leaves) and **sandboxed run** (something may) is stated on the
buttons, not in a tooltip.

### 5.5 A live call

While a call is in flight: an action-stream row with a **determinate** progress bar if the server reports
progress and an elapsed counter if it does not (never a fake bar); a `Cancel` control that is always
present and that the gateway honours by closing the call and recording `cancelled by you at T+2.1s`; and
on completion, a receipt row. If the server supports no cancellation, the row says
`server does not support cancellation — cancel will abandon the response and close the transport`, which is
the truth rather than a disabled button.

**Every returned payload is untrusted.** Text, files, images, links and embedded instructions are sanitized
and rendered as data. The gateway validates arguments and authorization **before and after** every call.
Models never connect directly to a server and never receive raw credentials.

### 5.6 Import from Claude Code / Cursor / Codex — dry-run diff only

`K2` → `Import…`. Sources detected and listed with paths, e.g. `~/.claude.json`, `<root>/.mcp.json`,
`<root>/.cursor/mcp.json` (note: `packages` **has** one at 323 B; `browser-add-on` has **none** — `03b`
§13.1/13.2), Codex config. Then a three-column diff:

```
SOURCE  ~/Work/packages/.cursor/mcp.json                     [ change source ]

  server            in source                 in Zeno now        action
  figma             stdio · npx <pkg>@latest  —                  [ import ] [ skip ]
                    ⚠ unpinned version "@latest" → will be pinned to the resolved
                      version + checksum at import; the tag itself is not imported
  internal-http     HTTP+SSE · https://…      —                  [ blocked ]
                    ✕ legacy transport. Not importable. See §5.8.
  env: FIGMA_TOKEN  <present in source>       —                  NOT IMPORTED
                    credentials are never copied. Re-broker via Keychain after import.
  trust decisions   <3 tools marked allow>    —                  NOT IMPORTED
                    every imported tool starts at "ask".

IMPORTED SERVERS START DISABLED.  Nothing connects as a result of this import.
[ Import selected (1) ]   [ Cancel ]
```

Three laws visible on the screen itself: **no credentials**, **no ambient environment**, **no trust
decisions** — and **imported servers start disabled**. After import each server sits at `⧗ pending review`
until the owner opens the Inspector, reviews identity/schemas/scopes, and enables it.

### 5.7 Per-agent grants — subagents inherit nothing

A matrix in the Agent Roster (§3.3): rows = agents and child sessions, columns = servers (expandable to
tools), cells = `allow / ask / deny / —`. `—` renders as **`no grant`**, and the column header carries the
law: **"subagents inherit nothing — every cell is explicit"**.

The child-session spawn dialog is where this becomes real:

```
NEW CHILD SESSION · "explore packages test setup"
  parent           s-2291 (implementer)
  model / effort   inherits: session   [ override ]
  roots            [ ] browser-add-on   [x] packages          ← must be chosen, none by default
  MCP grants       none                                        ← default, and it is a real default
                   [ + grant a tool… ]  (choose server → tool → allow/ask)
  filesystem       read: packages/**    write: none
  network          deny
  budget           tokens 20k · wall 5m · tool calls 40
  approval state   inherits: NOTHING. Parent approvals do not carry.
[ Create ]
```

The dialog cannot be dismissed into a "same as parent" shortcut, because the ambient-inheritance failure is
precisely what `6.1.2` prohibits. **Bypass permissions never bypasses MCP policy** — when a bypass sandbox
profile is active, the MCP column of the roster shows `bypass does not apply to MCP` in plain text.

### 5.8 Protocol posture panel — designed for the breaking rewrite

A small always-visible card at the top of `K2`, because this is a spec-version-sensitive subsystem
(`12-` K-5, ADR-0003):

```
MCP  spec 2026-07-28 (breaking rewrite, not a bump)   SDK <name> <version> [pinned]
  transports        stdio · Streamable HTTP                    only these two
  capability        server/discover (servers MUST implement)   negotiated at runtime, per server
  sessions          none at protocol level — session identity is zeno-protocol's, never MCP's
  Sampling          DEPRECATED — not implemented. A server advertising it is not a reason to adopt it.
  Roots / Logging / DCR   deprecated — not implemented
  HTTP+SSE          rejected at design time. A server requiring it is BLOCKED, not adapted,
                    unless a separately audited compatibility adapter is approved (none is).
  Tasks / Skills-over-MCP / MCP Apps    version-gated, flagged OFF, zero client support assumed
```

A server advertising a deprecated primitive renders it in the Inspector as
`advertised · not implemented by Zeno · no adapter` — visible, so the owner is never puzzled by a missing
feature, and never tempted into it.

**Tool selection.** Not every enabled schema is injected every turn. After deterministic authorization and
zone filtering, a selector picks by exact namespace/tag plus a measured router; the Loaded Context panel
shows a `TOOLS` group listing exactly which tool schemas entered the pack, their token cost, and why, plus a
**`discover more`** control for low-confidence turns. The router can *reduce* exposure; it can never hide a
mandatory safety control or widen authority. Metrics (`D2`): selection recall, wrong-tool rate, schema-token
savings, latency, failure recovery — all `— not yet measured`.

### 5.9 `K1` — connectors

Same discipline, different objects (Jira, GitLab, Figma, Sentry, calendar). Row: **provider · acting
account · scopes · token owner & expiry · webhook verification state · last sync · data retained ·
health**, with `pause · reconnect · revoke`. Two facts stated on every row because the record demands it:

- **Jira** — `site quillbot.atlassian.net · projects WEBEXT + WEBEXTOPS · acting account
  abheet.isher@quillbot.com · read-only`, and, until a connector is actually authorized,
  `not connected — connecting is a separate new-service approval` (`00-` 2026-08-24).
- **NeoSapien** — rendered with a persistent provenance note: `undocumented vendor endpoint (B-004) ·
  read-only · results labelled as coming from an unverified interface`. It is usable and it is labelled;
  it is never called "official".

**Forbidden across §5:** enabling anything as a side effect of import, install or workspace open; a server
that self-describes its risk tier (risk tier is assigned by policy, shown as such); credential values
anywhere in the UI, logs, prompts or receipts; a green seal on a server that has not passed a conformance
run; a "trust this publisher" switch that pre-approves future versions.

---

## 6. Everything else from §6.1 — concrete UI treatments

### 6.1 Named chats, branching, child sessions, resume

**Session Library** (`W4`, projected into Region A → Runs → *Sessions*): rows carry name, workspace, roots,
mode, model, state (`running · paused · idle · archived`), last activity, token/cost totals, and lineage
depth. Controls: `open · resume · fork · rename · archive · export · delete` (delete demands typing the
name; it is the one destructive control here).

- **Multiple named chats** — a session is a first-class named object from creation; unnamed sessions get a
  provisional `s-2291` id and a proposed name the owner can accept or edit. Names are unique per workspace.
- **Branching** — `branch from here` on any turn creates a sibling session that shares history up to that
  turn and diverges after. Lineage renders as an **indented list** (primary): `s-2291 › s-2291.a › s-2291.a1`,
  each row showing the branch point (turn number + timestamp + manifest hash). A lineage **graph** exists as
  a toggle with full keyboard parity, and is never the default.
- **Child sessions / subagents** — created through the dialog in §5.7. A child appears in the parent's
  action stream as a `child` row with live state, and in Region C's header as a count. Opening a child swaps
  Region C to it with a **back to parent** breadcrumb; the parent keeps running. Children exchange **cited
  handoff packets** — a packet is a structured object (goal, cited evidence, constraints, produced
  artifacts), rendered as a card, never a raw transcript dump.
- **Resume** — a session reopens with: transcript, plan, manifest, checkpoints, worktree state, and a
  **rehydration banner** listing what changed since it was last open (`files changed on disk: 3 · branch
  moved · 2 rules changed hash · 1 MCP server pending review`). Nothing auto-resumes execution; resuming a
  *run* is a separate, explicit action with a fresh budget confirmation.

### 6.2 Checkpoints (layered) and compaction

**Checkpoints** are automatic before every write batch, plan change, and mode transition, and manual via
`Cmd/Ctrl+K S`. Each appears as a `checkpoint` row in the action stream and in a Checkpoint list with
`ck-14 · 14:02:40 · before "edit 4 files" · layers: 1 2 3 4`.

**`25-` §5.6 is authoritative for the four-layer ladder and for layer 4's non-negotiable copy.** What this
document specifies is the **restore dialog** built on it — four layers, four separate truths, four separate
controls:

| Layer | Restore **will** | Restore **will not** |
|---|---|---|
| **1 · Conversation & plan** | messages, plan version, loaded-context manifest, mode | — |
| **2 · Files & worktree** | tracked + untracked files under the scoped roots, as of the snapshot | files outside scoped roots; **your** edits made after the snapshot (each is listed by name and needs an explicit `overwrite` tick); anything already committed and pushed |
| **3 · Environment & data** | container image digest, service versions, and a local DB snapshot **if one was taken** (says so per service) | external/shared databases; any service with no snapshot — listed individually as `no snapshot — will not be restored` |
| **4 · Already-executed external effects** | **nothing** | pushes, MRs/PRs, review comments, CI runs, deploys, messages, tickets, purchases |

Layer 4 is not a checkbox. It is a **list**, one row per effect, each with its receipt, its provider, its
timestamp, and — where one exists — a **`compensating action`** button labelled exactly
`compensating action — not a rollback` (e.g. *close the MR*, *revert commit as a new commit*, *delete the
comment*). Where none exists, the row says `no compensating action available`.

There is **no single "Restore" button**. The primary action reads `Restore selected layers (1, 2)` and the
dialog's footer restates, in one sentence, what will remain changed.

**Compaction** never deletes. It inserts a **seam row** in the transcript:
`━ compacted · 41 turns → 1 summary · 62.1k → 4.3k tok · manifest 7d13… · [view original] [undo compaction]`.
Original turns stay in the session store and are reachable. Citations and approvals survive compaction as
pinned rows that are **never** compacted. A compaction event fires the `pre-compaction` hook and is recorded
in `D3`. Auto-compaction triggers at the amber context threshold and always announces itself first.

### 6.3 Session search, export, archive

- **Search** (`⌥⇧S`) — scope selector `this session / this workspace / all sessions`, filters by kind
  (`message · action · file · citation · approval · receipt`), root, agent, date, and outcome. Results are a
  list of rows with a 2-line excerpt; click jumps to the exact turn or action row. Search runs over the
  local session store only; it never re-queries a provider.
- **Export** — `Markdown` (human), `JSON` (typed, protocol-versioned), `bundle` (transcript + manifest +
  diffs + receipts + evidence). A **sanitization preview** is mandatory before an export leaves the
  workspace directory: classes included/omitted/transformed, secrets scan result, zone check, and the
  destination path. `Z5` never appears in any export.
- **Archive** — moves a session out of the active list into `Archived`, keeps everything, releases worktrees
  and stops watchers. Reversible. Archiving a session with a running task is refused with the reason.

### 6.4 Explicit context inspection

§4 is the panel; `C1` is the full inspector. Two things this addendum adds:

- The **manifest hash** is printed in the composer chip, the run receipt, the plan approval, the checkpoint
  and the export. Approvals bind to it: if the manifest changes, the approval is invalidated and the UI says
  which item changed.
- A **"what did the model actually see"** view: the assembled pack in order, with per-item boundaries,
  token counts, and the exact excerpt ranges — plus the `OMITTED` list. This is the antidote to a context
  panel that lists sources without proving what was sent.

### 6.5 The separate latency-critical IDE completion / next-edit path

**It is a different product surface with a different model, a different budget, a different chip, and a
different eval suite.** It shares nothing with the long-running agent except the workspace.

**Ghost text.** `graphite-9` on `graphite-2`, no background fill, no border, no italic, **no fade-in**
(a per-keystroke animation maps to no state — law 4). It appears at `dur-0` and disappears at `dur-0`.
It is never cyan (cyan means *the system is speaking about the current object*; a completion is a
proposal, not a state) and never gold (gold is the owner's selection).

**Acceptance and rejection.**

| Key | Action |
|---|---|
| `Tab` | Accept all |
| `Cmd/Ctrl+→` | Accept next word |
| `Cmd/Ctrl+↓` | Accept next line (multiline suggestions) |
| `Esc` | Reject; the suggestion does not return until the next real edit |
| `Cmd/Ctrl+Z` | Undo restores the pre-accept buffer as **one atomic edit**, never token by token |
| `Alt+]` / `Alt+[` | Cycle proposed **edit sites** without accepting anything |

**Multiline** renders as ghost lines below the caret, capped (default 12) with `+N more lines` — and the
viewport **never scrolls on its own** to reveal them.

**Cross-file / next-edit.** A **next-edit chip** anchors at the caret:
`next edit · packages/src/foo.ts:214 · rename follow-up  ⇥ jump`. **Two presses, two meanings:** the first
`Tab` **navigates** (and the chip becomes `⇥ apply`), the second **applies**. A jump is never an edit.
A gutter ribbon in the current file marks other proposed sites. Cross-file suggestions never cross a
**workspace root** unless the owner has enabled cross-root completion for that pair, which is off by default.

**Import assistance** is a separate ghost hunk pinned at the import block with its own `Cmd/Ctrl+.` accept.
It is never bundled into the completion's `Tab`.

**Visible context and provider status** — the **completion chip** lives in the Status Rail, distinct from
the agent's runtime chip:

```
cmpl · qwen2.5-coder-1.5b · LOCAL · p50 62ms · ctx: current file + 3 open · local-only 🔒
```

Click → the completion context panel: exactly which buffers, symbols and imports contributed, with byte
counts, plus the toggles:

| Context source | Default |
|---|---|
| Current file | **ON** |
| Open tabs in the **same root** | ON |
| LSP symbol neighbourhood of the caret | ON |
| Same-root import graph, 1 hop | ON |
| **Unrelated files** (not open, not imported) | **OFF** |
| **Clipboard** | **OFF** |
| Terminal scrollback | OFF |
| Other workspace roots | OFF |
| Git diff of other branches | OFF |

**Local-only mode** is a hard switch, per workspace and per repo. When ON, the provider list is filtered to
local runtimes and the chip shows the padlock. If no local completion model is available, the chip reads
`off — no local completion model` and completion is **disabled**; it never silently falls back to a remote
provider. When OFF and a remote provider is in use, the chip is amber and the egress chip (§3.5) reflects
it — completion egress is egress.

**Per-repo / per-language controls** (`S`→Completion): a matrix, rows `root × language`, columns
`enabled · local-only · multiline · cross-file · max lines · debounce`.

**Evaluated separately.** A `completion/*` group in `D2`, never merged with `agent/*`:

| Metric | Definition |
|---|---|
| Latency | p50 / p95 / p99 from keystroke to first ghost glyph, **on this machine** |
| Acceptance | accepted / shown, and **retained-at-30s** (an accepted line still present 30 s later) |
| Correctness | accepted lines that compile / type-check / pass the file's tests |
| Leakage | bytes of disabled-source context that reached a provider — **must be 0** when the toggle is off; a non-zero reading is a defect, not a metric |
| Battery / thermal | Wh per hour of continuous typing |
| Distraction | typed-through rate (suggestions dismissed by continuing to type) and suggestion-churn per keystroke |

**Forbidden:** completion invoking agent tools, MCP, or the terminal; a spinner in the editor; a completion
that edits a file the owner is not in; completion running in an **untrusted** workspace with any source
beyond the current file; sharing the agent's context pack.

### 6.6 LSP integration

Per-root LSP servers, never merged. Region A → Explorer footer shows `LSP · <server> · ready · 12,401
symbols · v<x>` per root, with `restart` and a log. Surfaces:

- **Diagnostics** — gutter glyphs + a Problems tab in Region B grouped by root then severity, with
  `source` (compiler / linter / rule) on every row. Never colour-only: each severity has a distinct glyph.
- **Hover types**, **go to definition / references / implementations / type**, **call hierarchy** — all open
  in Region B; references render as a **list first**, with the call hierarchy tree as a secondary view.
- **Code actions / organize imports** — a list, each with a preview diff before applying.
- **Semantic rename and structural refactors** — **mandatory affected-file preview**: every file, every
  hunk, count of occurrences, and any file outside the scoped roots highlighted red and excluded. Applying a
  refactor creates a checkpoint first.
- **Debugger (DAP)** — launch/attach with the exact resolved configuration shown, breakpoints, stepping,
  threads, call stacks, variables and watches. **Expression evaluation is labelled and treated as code
  execution** (its own approval in a scoped worktree; it appears in the action stream as `shell`-class).
- **Serena-class LSP symbol editing** stays `partial, gated` (`10-PRD` §4.5): only inside a dedicated
  worktree, never the primary checkout, with the owner's standing *never commit or push* rule enforced
  **mechanically** — the UI shows the enforcement mechanism by name (credential-less worktree / hook), not a
  promise.

### 6.7 Source-control UI and review comments

Region A → Source Control, **per root, never merged**. Each root section header:
`<root> · <remote> · <acting account> · <branch> · ↑2 ↓0 · worktree <path>` with a `verify` control that
re-resolves remote + account live.

Body: `Staged / Changes / Untracked / Conflicts`, per-file rows with per-hunk staging done in the diff plane
(§2.2). Commit box shows the resolved author identity. **Commit and push render according to policy**: with
the owner's standing rule in force (default ON for `Z2` roots), both are `blocked` (red) with
`Owner rule: never commit or push — enforced mechanically` and the alternative offered is `export patch` /
`prepare review packet`. Where the rule is off, push is **T2** with the mandatory preflight: re-resolved
owner/remote/account/branch/destination/commits/diff plus secrets, PII/DLP, large-file, generated-artifact
and cross-zone checks — and the approval binds to that preflight result; a changed diff or remote
invalidates it (GIT-SAFETY-AC-01).

`force-push · history rewrite · repository deletion` are **`prohibited` by default** and render as such —
not as buttons that ask.

**Review comments** — drafted inline on a diff line, collected in a **Publish queue**. Publishing is **T2**
with an exact preview: provider, project, MR/PR IID, commit SHA, file, line, and the **verbatim body** that
will be posted, plus the acting account. Approving publishes exactly that; editing after approval
invalidates it. Nothing posts as a side effect of a review run.

### 6.8 The task board

`W2` projected into Forge. **The list is the default**; the board is a toggle (`Cmd/Ctrl+K B`) with full
keyboard parity — every card action exists as a list-row action, tab order equals list order.

List columns: `id · title · intake id · roots · mode · agent · state · budget spent/limit · elapsed ·
last event · blocked-by`. States: `queued · running · paused · awaiting-approval · blocked · failed ·
done`. Board columns are those states; drag is a state change **only where a state change is legal** (you
cannot drag a task out of `awaiting-approval` — approving is an approval, not a drag). Grouping: by state
(default), root, agent, or intake.

Row/card detail opens `W2.1` Run Detail as a Region-B tab: editable plan, dependencies, worktree/branch,
budget, evidence, artifacts, checkpoints, cancel, retry-from-safe-step.

### 6.9 Typed server API / SDK and headless mode

`S`→**API & Clients**, four sections:

1. **Endpoint** — the local socket path and/or loopback-bound port (random high port, loopback only),
   `zeno-protocol` version, and `stop`/`start`. Bound to loopback by construction; a non-loopback bind is
   not offered.
2. **Client tokens** — rows: name, scopes (per product, per capability), created, last used, expiry,
   `revoke`. Tokens are shown **once** at creation and never again. Scopes are explicit (`forge.sessions.read`,
   `forge.runs.create`, …); there is no `*`.
3. **Schema browser** — the typed protocol surface: sessions, events, artifacts, approvals, device commands,
   streaming. Each type with its version and a copyable schema. Deprecated fields are marked with their
   removal version.
4. **Attached clients** — live list: client name, transport, token, scopes in use, connected since. A
   headless client is a **visible** client; its runs appear in the same task board with an `origin:
   headless` chip, and its approvals route to the same `A1` queue. **A headless run can never
   self-approve** — if no interactive surface is attached, an approval-requiring step **parks** in
   `awaiting-approval` rather than proceeding.

### 6.10 One versioned agent protocol across clients

A **Capability Matrix** view (Region B tab; also `K5`-linked) — the `Forge Host/Client Capability Matrix`
the master prompt requires, as a real screen. Rows: `Terminal/TUI · Desktop · Web (inside Command) · IDE
adapter (per editor, one row each) · Headless/SDK · Remote worker`. Columns: **where the model runs · where
the index lives · where tools execute · where the shell runs · which filesystem · which browser · where
credentials live · where checkpoints are stored · native permissions · sandbox/network limits · offline
behaviour · degraded/unavailable features · session-handoff semantics · update/signing · security owner**.

Cell values are only ever `supported (location)` · `degraded — reason` · `unsupported — not applicable`.
A bare check mark is not a legal cell value. Two laws are printed on the view: **a web client never implies
that browser-sandbox code controls a host OS**, and **a capability verified on one platform is not marked
tested on another**. Handoff to a paired executor requires capability negotiation, exact target display and
policy approval — rendered as a three-step confirm, not a button.

### 6.11 Versioned lifecycle hooks and reusable commands

`S`→**Automation**, two tabs.

**Hooks** — grouped by event: `session start/end · before/after agent · before/after model · before tool
selection · before/after tool · pre-compaction · checkpoint · notification`. Row: name · source (repo path
or user) · **fingerprint hash** · version · trust state · ordering index · `fail-open`/`fail-closed` ·
sandbox profile · time/output budget · last run + outcome. Controls: enable/disable, reorder within the
event, `view diff since approved`, `test run (sandboxed)`.

Three laws as UI state: **untrusted repository → every repo hook is disabled and hatched**, and it does not
run because the folder was opened; **any change to a hook flips it to `pending review` with a diff**; and
**enforced policy hooks appear in a locked group with no toggle**, above everything else, with a note that
model output, a repo hook and bypass mode cannot weaken them. Ordering is deterministic and printed; ties
are resolved by (scope rank, then name), shown, not implicit. Hook I/O is strict typed JSON; a malformed
payload is a hook failure, rendered as such, and fail-closed hooks block the event.

**Commands** — reusable user/project commands (`~/.claude/commands`-class and `<root>/.cursor/commands/*.md`,
of which `browser-add-on` has 3). Row: name · scope (user/project/root) · version · hash · what it does ·
required grants. Invoked from the palette or the composer with `/`. A project command from an untrusted root
is listed and disabled. A command **cannot** hide commands, inherit credentials, or collapse approval tiers
— the palette shows the tier each command's steps will hit before it runs.

### 6.12 Multi-repository workspaces with per-repo isolation

The isolation strip (§1.5) is the always-on expression. A cross-repo task adds:

- **One cited cross-repository plan**, rendered as a single plan with **per-root lanes**. Each step is
  tagged with its root; a step with no root is illegal.
- **Change ordering + compatibility contracts** — the plan header states the order and the contract
  (`packages must ship the SSR field before browser-add-on reads it`), with an explicit
  `if partially applied:` recovery line. The order is enforced: a later-ordered root's build step is
  `blocked` until the earlier one's gate is satisfied, showing the dependency.
- **Per-root everything downstream**: separate diffs (one tab per root), separate commits, separate checks,
  separate MR approvals, separate receipts. There is no "commit all".
- **Partial-failure recovery** — a dedicated card listing what landed, what did not, per root, with the
  compensating actions from §6.2's layer 4.
- **The interlock:** an attempt to apply root A's rules, index, memory, remote or test commands to root B is
  refused with `cross-scope grant required` and a named policy. There is never a merged index or a merged
  memory.

### 6.13 The Review Workbench

Region B tab. **Findings table (list-primary)**: `id · severity · confidence · category · rule/model +
version · file:line@commit · owner · state · freshness · duplicate-of`. IDs are **stable across reruns** —
the same defect keeps its id, so `dismissed` and `waived` decisions survive.

Detail pane (right, inside the tab, not a floating panel): evidence excerpt with a citation chip, the
**suggested patch previewed as a real diff — never applied from Review** (applying returns to Build,
`25-` §4.6), suggested tests, the rule text that
produced it, and history of state changes with who and when.

Controls: `resolve · dismiss (reason) · waive (reason + expiry) · rerun this finding · rerun all`.
Freshness: a finding whose file changed since it was produced is marked `stale — file changed at HH:MM`
and is re-run before it can be acted on. Duplicates collapse under a parent with a count.

**Publishing a review comment is T2** with the exact-preview flow of §6.7. Bulk-publish exists only as
"publish these N, previewed one by one" — never a single approval covering unseen bodies.

### 6.14 Evidence-first Debug mode

Entering `Debug` replaces Region C's free composer with a **Debug Ledger**: a fixed, ordered set of
sections that must be filled, each row cited.

```
1 SYMPTOM        one statement, owner- or evidence-sourced                      [required]
2 REPRODUCIBLE   exact command / steps / URL / fixture · last run result        [required]
                 status: reproduced ✓ 14:12  |  not yet reproduced
3 HYPOTHESES     H1 … H2 … H3   each with:  discriminating check · expected if true /
                 if false · result (pending / supported / refuted)              [≥1 required]
4 INSTRUMENTATION each temporary edit, file:line, added at, [ remove ]          [tracked]
5 EVIDENCE       logs · traces · profiles · bisect result — each a citation chip
6 ROOT CAUSE     one statement + ≥1 evidence citation                           [gates step 7]
7 MINIMAL FIX    the diff · why it is minimal · what it does not change
8 REGRESSION TEST the test that fails before and passes after (both runs shown)
9 CLEANUP        every step-4 row removed ✓ / outstanding ⚠
```

Interlocks: **`Build` is blocked from Debug until §6 has at least one evidence citation** — the reason line
is `evidence-first: no root cause with evidence`. **Completing a debug task is blocked while §9 has an
outstanding row** (amber, with the file:line list). The number of edit-then-test cycles is counted and
shown; crossing a threshold raises an amber `iteration without a new discriminating check` prompt. This
structure is the mechanism that prevents "random edits until tests pass"; for a trivial bug there is an
explicit `minimal ledger` variant (symptom, repro, root cause, fix, test) chosen at entry — an escape hatch
that is *declared*, not a bypass.

### 6.15 Reproducible environment profiles

`S`→**Environments**, and a per-root chip in the isolation strip. Profile card: name · **profile hash** ·
kind (devcontainer / rootless container / Nix / native) · toolchain and model versions · services with
health checks · prebuild/cache policy · secret grants (destinations only) and **egress allowlist** ·
resource caps · image digests · migrations · history of changes with diffs.

States: `healthy` (all health checks pass, hashes match) · `drift — N differences [diff]` (amber) ·
`unreproducible — reason` (red) · `not configured`.

**The refusal, as UI:** while a root's environment is `unreproducible`, `Build`, `QA` and `Debug` steps in
that root are `blocked`, and the Identity Bar carries a red band naming the root and the reason. While it is
`drift`, work continues in a **visibly degraded** mode: an amber band, and every run receipt records
`environment: drift (hash A ≠ hash B)` so no result from a drifted environment can later be mistaken for a
reproducible one. Never a silent proceed.

### 6.16 The Live Preview Inspector

Region B tab, opaque, for web and extension work. Left: the rendered target. Right: an inspector column
(inside the tab; nothing floats over the code plane).

- **Element selection** — picker, plus a **list-primary** DOM tree with an accessibility-tree toggle and a
  computed-CSS list. Every node row shows its selector and can be cited into the composer.
- **Responsive / device modes** — presets and custom sizes, DPR, locale, timezone, colour scheme, reduced
  motion/transparency, forced-colours, and offline/throttled network — the same axes Zeno's own design must
  survive.
- **Screenshot and visual diff** — capture, baseline, diff with a threshold and a **mask editor** for known
  dynamic regions; the diff shows changed-pixel count and the mask coverage so a masked-away failure is
  visible as coverage, not silence.
- **Traces** — console, network (with request/response bodies redacted per policy), storage/cookies/IndexedDB
  — always in a **disposable profile**. A red banner and a refusal if anyone points it at the everyday
  authenticated profile (`SWE-QA-AC-01`).
- **Interaction recording** → replayable steps.
- **Design-acceptance annotations** — pinned to elements, each carrying the design source it is checked
  against, and exportable into the review packet.
- **QA proof bundle** — steps, expected vs actual, screenshots, traces, environment hash, browser+OS
  versions, and a **redaction report**. The bundle is what makes a QA claim inspectable rather than asserted.

For the browser extension specifically: install / load-unpacked / update / uninstall in a disposable
profile, MV3 service-worker suspension and restart, content-script isolation, CSP and host permissions,
extension storage and schema migration, popup / options / side panel / toolbar / inline card, multi-tab and
multi-window, offline, performance and accessibility — each rendered as a checklist row with its own
evidence, and any browser without an equivalent surface marked `unsupported — not applicable` rather than
claimed as parity.

---

## 7. Coverage table

`specified` = concretely designed here or in a named sibling section · `partial` = the surface is designed
but a named part is not · `deferred-with-reason` = deliberately not designed at Gate 2, with the reason.

### 7.1 §6.1 — required experiences

| § 6.1 requirement | Where | Status |
|---|---|---|
| Terminal/TUI, desktop, web, IDE, headless over one versioned protocol | §6.10, §6.9 | **specified** (matrix + API surface). Per-IDE adapter UI: `partial` — one row per editor is specified, the editor-side UI is per-adapter LLD |
| Project/workspace picker | §1.1–1.3 | **specified** |
| Multiple named chats | §6.1 | **specified** |
| Branchable conversations | §6.1 | **specified** |
| Child sessions / subagents | §6.1, §5.7 | **specified** |
| Resume | §6.1 | **specified** |
| Checkpoints | §6.2 | **specified** (four-layer restore) |
| Compaction | §6.2 | **specified** |
| Session search / export / archive | §6.3 | **specified** |
| Explicit context inspection | §4, §6.4 | **specified** |
| Model selector, local/remote, context size, cost/latency, effort | §3.1–3.3 | **specified**; every cost/latency figure renders `— not yet measured` until B-002 |
| Tool permissions | §5.3, §5.7, §3.3 | **specified** for MCP + agents. The six typed permission categories × four levels (`22-C` §4.2) are referenced, not re-specified here — `partial` |
| Plan/act modes (`Ask·Explore·Plan·Build·Review·Debug·QA`) | §2.3 header, §3.4, `22-C` §4.2, `25-` | **specified** in the identity bar and blocking rules; the mode-by-mode screen design lives in `25-` |
| Constrained "bypass permissions" | §5.7 note, `10-PRD` §4.5 | **partial** — the MCP-immunity and the visible sandbox badge are specified; the bypass profile's own screen is `25-`/LLD |
| Streaming output | §2.3 | **specified** (incl. gap markers) |
| Editable plans | §6.8 (`W2.1`), §3.4 | **partial** — the plan editor's own anatomy is `25-`; degraded behaviour under failed structured output is specified here |
| Cited code navigation | §2.5 | **specified** |
| Inline diffs / file editing | §2.2 | **specified** |
| Terminal | §2.4 | **specified** |
| Tests | §2.3 action stream, §6.14 | **partial** — test rows and the debug interlock are specified; the test-runner panel (select/filter/shard/coverage/flake classification) is `deferred-with-reason`: it is a dense surface of its own and belongs to the Build/QA slice LLD |
| Browser + screenshots | §6.16 | **specified** |
| MCP | §5 | **specified** |
| LSP | §6.6 | **specified** |
| Source-control UI | §6.7 | **specified** |
| Review comments | §6.7, §6.13 | **specified** |
| Task board | §6.8 | **specified** |
| Persistent live build conversation + follow-up classification + barge-in + reconnect | §2.3 | **specified** |
| Multi-agent workflow graphs and templates (DAG, event stream, artifact board, cited handoff packets) | §3.3 roster, §6.1 packets, `22-C` §4.3 | **partial** — the roster, grants, handoff-packet card and the DAG-as-secondary law are specified; the **workflow template authoring UI** (typed inputs/outputs, fan-out/fan-in, retries, leases, approval nodes, reusable named runs) is **deferred-with-reason**: it is a product-sized authoring surface and designing it at Gate 2 would outrun the MVP journeys |
| Worktrees / containers / snapshot / rollback / allowlists / artifact capture / deterministic timeouts | §1.5, §6.2, §6.15 | **partial** — worktree identity, checkpoints and environment profiles are specified; the artifact-capture browser is `deferred-with-reason` (belongs with `W2.1` in `25-`) |
| Multi-repository workspaces | §1.2, §1.5, §6.12 | **specified** |
| Full GitHub/GitLab workflows under approval tiers | §6.7 | **partial** — commit/push/MR/comment surfaces and tiers are specified; pipeline/CI panels are `deferred-with-reason` (CI/CD slice LLD) |
| Browser QA (DOM/Playwright → a11y → visual) | §6.16 | **specified** for the inspector; the Playwright run panel is `partial` |
| ACP or an open versioned interoperability boundary | §6.9, §6.10 | **specified** as UI (protocol version, schema browser, attached clients); the protocol itself is ADR-0003, not a design question |
| Typed server API and SDK | §6.9 | **specified** |
| Versioned lifecycle hooks + reusable commands, untrusted repo disabled | §6.11, §1.4 | **specified** |

### 7.2 §6.1.1 — complete software-engineering workstation

| §6.1.1 element | Where | Status |
|---|---|---|
| Software-Engineering Capability Catalogue | §6.10 Capability Matrix | **partial** — the client/host matrix is specified; the per-capability catalogue browser is `deferred-with-reason` (it is `K5`'s job and `K5` is Command-side) |
| Toolchain / Environment Resolver — discover before planning, never assume | §1.5 (`test commands` resolved, not assumed), §6.15 | **specified** for the resolved-values display and the refusal-on-unhealthy; the resolver's own progress/conflict UI is `partial` |
| Task and workspace setup (exact folder/IDE/file/line/terminal/browser, no duplicate sessions) | §1.1 (`open in another window` interlock), §2.5 | **partial** — the anti-duplicate and exact-target rules are specified; the "open everything for this task" orchestration screen is `25-`'s J-F2 |
| Explore and understand code | §2.1 Search, §6.6 | **specified** |
| IDEs and editors (adapters, buffers, diagnostics, DAP) | §6.6, §6.10 | **partial** — DAP and LSP surfaces specified; per-editor adapter behaviour (Xcode schemes, JetBrains, Vim) is `deferred-with-reason`: one row per editor in the matrix, one LLD each |
| Edit and refactor (minimal patches, preimage checks, no silent overwrite, generated-code boundaries) | §2.2, §6.6 | **specified** |
| Terminal and processes (PTY contract, process trees, ports, logs) | §2.4 | **partial** — the drawer and process-tree rules are specified; the ports/processes/watchers console is `W5` (Command-side) |
| Git and source control | §6.7 | **specified** |
| Languages, dependencies, toolchains | — | **deferred-with-reason** — dependency review UI (provenance, transitive diff, licences, advisories) is a distinct surface with its own approval semantics; scheduled with the supply-chain slice |
| Build, static checks and tests | §2.3, §6.14 | **partial** (see the tests row in §7.1) |
| Debugging and performance | §6.14, §6.6 | **specified** for debug; **benchmarking/profiling UI** is `deferred-with-reason` (needs B-002 to have any honest axis) |
| Browser, web and extension QA | §6.16 | **specified** |
| APIs and integrations | §5.9 | **partial** — connector health is specified; an HTTP/GraphQL/gRPC request workbench is `deferred-with-reason` |
| Local services and data | §6.15 | **partial** — service health and snapshots are specified; a DB query/migration surface is `deferred-with-reason` (T3-shaped; needs its own approval design) |
| Containers, VMs, reproducible environments | §6.15 | **specified** |
| Cloud, infrastructure, Kubernetes | — | **deferred-with-reason** — out of the MVP journeys; a context-resolution UI that is wrong here is dangerous, and there is no authorized cloud context in the scope record |
| CI/CD and release | §6.7 | **deferred-with-reason** — pipeline panels belong with the GitLab connector, which is not yet authorized (`U-07`, `QF-6`) |
| Security, privacy, supply chain | §5.2 (description-risk, provenance), §6.3 (export scan) | **partial** — the inline controls are specified; a findings/SBOM surface reuses §6.13's table and is `partial` |
| Observability, on-call, incidents | — | **deferred-with-reason** — Sentry and alerting are not in the current scope record; an incident surface is read-only by policy and belongs to a later slice |
| Product, collaboration, documentation | §6.3 export, §6.13 | **partial** |
| Completion and handoff ("done" = verified outcome) | §6.13, §6.14 §9, §6.2 layer X | **specified** — the interlocks (outstanding instrumentation, unpublished findings, orphan state) are named |
| Skills accelerate but never hide commands / inherit credentials / collapse tiers | §4.4 (`R5`/`R6` ranks), §6.11 (command tier preview) | **specified** |
| Ask a targeted question or offer takeover rather than improvising | §1.3 route card, §3.4 rejection modes, §6.15 refusal | **specified** as the refusal pattern; the takeover-handoff card is `partial` |

### 7.3 §6.1.2 — MCP as a first-class subsystem

| §6.1.2 element | Where | Status |
|---|---|---|
| Pin spec/SDK versions; runtime capability + protocol negotiation; version-gated extensions | §5.8 | **specified** |
| **Sampling deprecated — not adopted** | §5.8 | **specified** |
| stdio + Streamable HTTP only; legacy behind an audited adapter | §5.8, §5.6 (import blocks HTTP+SSE) | **specified** |
| Remote auth, redirect/origin validation, SSRF/DNS-rebinding, session binding, cert validation, egress allowlists | §5.1 (`origin & pin`), §5.8, §6.15 (egress allowlist) | **partial** — surfaced as registry fields and states; the security behaviour itself is `12-` TB-07, not a design question |
| Global + per-workspace registry, namespace/collision, pin/checksum, transport, capabilities, schemas, scopes, roots, zone, owner, licence, status, health, lifecycle, quotas, limits, logs, last use, degraded mode | §5.1, §5.2 | **specified** |
| Change detection → new review before use | §5.1 interlock | **specified** |
| MCP Inspector: identity/provenance, schemas, scopes/roots, credential destination, examples, risk tier, connection test, sandboxed call, per-tool allow/ask/deny, live progress + cancellation, audit receipt, disable/revoke/uninstall | §5.2–5.5 | **specified** |
| Import from Claude Code / Codex / Cursor via dry-run diff; no credentials, no ambient env, no trust; imported start disabled | §5.6 | **specified** |
| Per-task and per-agent grants; subagents inherit nothing; gateway validates before and after; returns sanitized as untrusted; budgets; bypass cannot bypass MCP policy; models never connect directly | §5.5, §5.7 | **specified** |
| Do not inject every schema; namespace/tag + measured router; `discover more`; measure recall/wrong-tool/token savings | §5.8 (tool selection) | **partial** — the panel and the metric names are specified; the router's own tuning UI is `deferred-with-reason` until there is a measurement to tune against |
| Narrow, policy-limited Forge **MCP server** + SDK | §6.9 | **partial** — token scopes and attached-client surfaces are specified; the "expose these sessions/resources/prompts/tools" picker is `deferred-with-reason` (it is an outward-facing authority surface; it should not be designed before the policy engine choice `QF-1` is settled) |
| Authoring + conformance kit for repo adapters; adversarial test matrix | — | **deferred-with-reason** — a developer-tooling surface, not an owner-facing one; belongs with the adapter slice. The *consumption* side (§5.1–5.5) is what protects the owner today |

### 7.4 The owner's five explicit requirements

| Requirement | Where | Status |
|---|---|---|
| 1 · Agent chat alongside a real IDE surface | §2 | **specified** |
| 2 · Model + effort selector, per-session and per-agent, visible reduced-capability mode | §3 | **specified** |
| 3 · Rules and skills from the codebase, per-repo keyed, hashed, conflicts surfaced | §4 | **specified** |
| 4 · Open any folder / multi-root picker, intake routing, trust | §1 | **specified** |
| 5 · MCP and connectors first-class | §5 | **specified** |

---

## 8. Honest weaknesses, and what must be measured once hardware is known

### 8.1 Weaknesses

1. **Six regions is a lot of window.** The collapse order (`25-` §1.5, §2.6 here) is honest but below the
   Wide band it sacrifices exactly the thing the owner asked for — chat *beside* code. On a 13" laptop at
   13 px there may be no width at which `A`, `B` and `C` are all comfortable. **Where the Wide→Medium
   boundary actually falls is the single most load-bearing unmeasured number in this document**, because
   it decides how often the owner's headline requirement is in force.
2. **The rule inventory is two-thirds verified.** 27 of the stated 38 `.mdc` rules are inventoried in
   `03b` (20 in `browser-add-on`, 7 in `packages`); the remaining ~11 in `edit-stream` and `rest-server`
   entered scope after that report and have never been listed. The three divergent `identity-rule.mdc`
   hashes are owner-stated and not independently re-verified here. The panel design is hash-driven so it is
   correct regardless — but the *count* in this document should not be quoted as verified.
3. **Hashing everything on every pack has an unmeasured cost.** `e2e-testing.mdc` alone is 108 KB;
   `quillbot-lt-conventions` is 137,906 B; the four roots together are ~24,754 source files. Per-item
   `sha256` plus set hashes plus excerpt selection on every re-pack could be the dominant latency in the
   composer. Unmeasured.
4. **Conformance badges will mostly read `unverified` at first.** That is the honest state, but a screen
   full of `never measured` reads as broken to a fresh eye. Mitigation is a first-run conformance pass with
   a visible cost estimate — which is itself a token/time cost nobody has measured.
5. **The per-tool allow/ask/deny matrix does not scale visually.** At ~10 servers × ~20 tools the matrix is
   200 cells. Grouping, search and a "changed since last review" filter are named but not designed.
6. **The Debug Ledger can feel bureaucratic.** The `minimal ledger` escape hatch exists, but if the full
   ledger is the default for a two-minute bug, the owner will route around Debug mode entirely — which
   destroys its purpose. Which variant is default should be decided from measured usage, not taste.
7. **`— not yet measured` everywhere is correct and unsatisfying.** The runtime popover, the completion
   chip and the environment card will all show placeholders until B-002 is answered and a first run happens.
   The design commits to that honesty; it should be framed to the owner as a feature of the instrument, not
   apologised for.
8. **Two secondary graph views (run DAG, session lineage) plus the board double the keyboard-parity
   surface.** Every one of them must carry full parity, and parity is the first thing that rots.
9. **The Live Preview Inspector and the completion path are both `roadmap` in `10-PRD` §4.5.** They are
   specified here at Gate-2 fidelity, which is deliberate — the owner asked for them — but specifying them
   does not promote them, and this document must not be read as changing their tier.

### 8.2 Figures that must be measured once hardware is known (all currently targets)

| # | Figure | How |
|---|---|---|
| 1 | **Minimum `B` width** for comfortable code at JetBrains Mono 13/1.35 (target: 100 columns + gutters) — which sets the Wide→Medium band boundary of `25-` §1.5 | Render at the pilot machine's real displays and DPI; measure, then set the breakpoint from the measurement |
| 2 | **INP ≤ 200 ms** while `C` streams, the action stream appends, and an LSP indexes | Interaction-latency trace under that exact concurrent load |
| 3 | **Completion latency** p50/p95/p99, keystroke → first ghost glyph | Instrumented editor, 1,000-keystroke session per language, per repo |
| 4 | **Completion leakage = 0** when the unrelated-file/clipboard toggles are OFF | Byte-level audit of the outgoing completion payload; any non-zero is a defect |
| 5 | **Context-pack assembly time** and hash cost per re-pack, across 4 roots / ~24,754 files / ~310 KB of rules | Time the packer with real rule sets; break down by exact-search, symbol, hashing, excerpting |
| 6 | **Index build and incremental update** per root, plus memory footprint of 4 concurrent LSP servers | Cold build and warm update on the pilot machine, with thermal readings |
| 7 | **Conformance-suite cost** (tokens + wall clock) per model × harness across the nine axes | One full run per candidate, recorded as the receipt that earns the seal |
| 8 | **First-token latency and tok/s** per local model + quantization, and the thermal/battery curve over a 30-minute Build | Measure; never quote a vendor figure in the UI |
| 9 | **MCP round trip**: sandboxed test call, live call with progress, cancellation-to-close time per transport | Per server, recorded into the health row |
| 10 | **Foundry Edge non-text contrast ≥ 3:1** for `edge-key` / `edge-active` / `edge-select` on `graphite-2` and `graphite-3`, plus every text pairing at 4.5:1 | Automated WCAG 2.2 sweep + APCA cross-check, in dark / high-contrast / 2D variants |
| 11 | **Ghost text legibility floor** — `graphite-9` on `graphite-2` must be readable as a proposal yet clearly subordinate to real code, and must not fail 4.5:1 for anyone relying on it | Contrast measurement plus a real typing session; if it fails, ghost text gains a glyph, not a colour |
| 12 | **Diff colour independence** — the neutral added/removed pair must be distinguishable under protanopia/deuteranopia/tritanopia and in forced-colours mode, with the glyph carrying the meaning alone | Simulated and forced-colours rendering of a real diff |

---

**End of `25b`.** Companion to `25-prototype-forge.md` (Forge journeys and hero screens) and
`26-prototype-counsel.md`. Nothing here authorizes a build.
