# Zeno study pack — the Forge Agent/Editor switch & GPU-gated Compare

> **Snapshot: 2026-09-14.** This pack explains two Forge features as they actually ship today:
> (1) the **Agent / Editor** switch in Forge's top bar, and (2) **Compare**, which runs several local
> models on one task and is honest about whether the GPU can hold them at once. Both are built and
> covered by the end-to-end suite. Design fidelity is measured against the design artifact `b551a806`.
> This is written plainly, for my own reading before an interview.

---

## 1. The one-paragraph mental model

Zeno has **three surfaces** that share one "nothing happens without your approval" path:

| Surface | Its one job |
|---|---|
| **Command** | The conversation, the orchestrator, and approvals. I talk to Zeno; it proposes effects; I approve them; every approval is sealed into a signed receipt chain. Command also opens and tracks the Forge agents. |
| **Forge** | The code. A real IDE — file tree, editor, terminal — plus an AI coding agent that runs in an isolated worktree and only ever *proposes* file changes. |
| **Counsel** | The meeting notebook. Consent-first local transcription with cited Q&A after the meeting. |

The invariant that makes Zeno *Zeno*: **a model can propose an effect, but it can never approve its
own effect.** Approvals live in Command; Forge only proposes.

---

## 2. The Forge Agent / Editor switch

Forge's top-left has a two-button switch: **Agent** and **Editor**. It is a real mode, kept on
purpose — not removed. The choice is persisted in `localStorage` under `zeno-forge-view`, so Forge
reopens in whichever mode I last used.

- **Agent** (chat-first): the session panel takes the whole workbench and the code editor is hidden.
  This is the "just talk to the agent about the task" view. In CSS this is the `mode-agent` class on
  the `.ide` element — `index.html` hides the side bar and the editor for it
  (`.ide.mode-agent .vsside, .ide.mode-agent .vsed{display:none}`), and it also hides the editor's
  status footer (Problems/Ports/exit code), because that footer is editor chrome and there is no
  editor to report on in this mode.
- **Editor** (classic IDE): the full layout — activity rail, file explorer, code editor, the docked
  session panel, and the bottom drawer (Terminal/Ports/Problems). This is the "read and edit the
  code while the agent works" view.

Both modes use the **same** sessions — switching does not throw away a run. The switch is wired in
`packages/daemon/public/bind/forge/session.js` (`VIEW_KEY = 'zeno-forge-view'`, `applyForgeView`
toggles the class, and the `#forge-viewseg [data-forge-view]` buttons drive it).

**Why keep a switch at all, when Command is already a chat?** Because the two chats have different
jobs. Command is the *governance* console — the place approvals live and where you orchestrate every
agent. Forge's Agent mode is a *focused* view of one coding session in its own worktree. Keeping the
switch lets me collapse the editor away when I only want the conversation, and bring it back the
moment I want to read the diff — without leaving Forge. (There is a separate control, **Ctrl+Alt+B**,
that toggles the secondary side bar — the session panel — inside Editor mode; don't confuse the two.)

The *content* of the agent view follows the best-in-class patterns: tool cards ("Edited
src/ingest.ts"), a diff card, and the approval capsule — but the effect still can't land until I
approve it in Command.

---

## 3. Compare: running several models at once — honestly

**Compare** gives one task to several local models, runs each in its own isolated worktree, and shows
the diffs side by side so I can keep the best one. It is fully wired: each column is a real
`POST /forge/run`, the wall time is measured, and nothing is applied until I pick a winner
(`packages/daemon/public/bind/compare.js`; end-to-end coverage in `e2e/flows/07-compare.mjs`).

### Why the GPU is the whole story

A local model has to be **loaded into the GPU's video memory (VRAM)** to run fast. The card has a
fixed VRAM budget. Running two models at the same time means both sets of weights sit in VRAM
together. If they don't both fit, they can't truly run in parallel — the runtime would unload one and
reload the other, which is just sequential and slow.

So Compare **measures before it promises**, via `GET /forge/models/host`, which reports:

1. the GPU and its total/free VRAM, and
2. an estimated VRAM footprint per installed model,

and only offers true parallel when the estimated sum fits. Otherwise it says so plainly and runs the
models one after another — it never *pretends* to run them together.

### Where the numbers actually come from (the real backend)

This is the part doc drafts got wrong before, so here is what the code does
(`packages/daemon/src/routes/ollama-lifecycle.ts`, surfaced by `serveForgeModelHost`):

- **GPU probe** — a single best-effort call to `nvidia-smi
  --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits`. No NVIDIA GPU (CPU-only)
  → Compare degrades gracefully to sequential and says why. System RAM is read too (reliable,
  cross-platform), because a model spills to RAM when VRAM is short.
- **Per-model footprint** — an estimate from the on-disk weight size Ollama reports:
  `estVram ≈ sizeBytes × 1.1 + 300 MB` (weights + ~10% KV cache + ~300 MB CUDA context). It is
  explicitly an *estimate for the meter*, never a guarantee — the real allocation is whatever the
  runtime does at load time.

### Illustrative example (an RTX 3080, 12 GB)

Using the formula above, on a 12 GB card the answer genuinely changes with the models you pick — which
is the whole point of gating it:

| You pick… | Rough estimate | On a 12 GB card |
|---|---|---|
| `qwen3:4b` + `qwen3:8b` | fits comfortably | runs in parallel |
| `qwen3:8b` + `qwen3:14b` | exceeds 12 GB | sequential |
| `4b` + `8b` + `14b` | well over | sequential |
| `qwen3:14b` alone | fits | single |

(These are illustrative estimates from the formula, not a hardware benchmark.)

### What the picker shows

A small **VRAM meter**: the GPU budget as a bar, each selected model as a segment, and a running total
with a plain verdict — "fits, runs in parallel" or "exceeds VRAM, will run sequentially". The colour
is always paired with words, never colour alone.

---

## 4. Accessibility & responsiveness (WCAG notes)

- **Never colour alone.** The VRAM verdict pairs green/amber/red with words ("fits" / "tight" /
  "won't fit") and a number. *(WCAG 1.4.1 Use of Color.)*
- **Keyboard-operable.** Every control in the session panel and the Compare picker is reachable by
  Tab with a visible focus ring; Ctrl+Alt+B toggles the secondary side bar. *(WCAG 2.1.1, 2.4.7.)*
- **Honest, specific labels.** Buttons say what will happen ("Run in parallel", "Run sequentially"),
  and a disabled control explains *why* ("GPU can't hold both models at once"). *(WCAG 3.3.2.)*
- **Responsive.** The docked panel and the context rail collapse on narrow widths so the editor never
  scrolls sideways; Compare columns stack when the window is small. *(WCAG 1.4.10 Reflow.)*
- **Respect reduced motion.** Any "working…" animation honours `prefers-reduced-motion`.

---

## 5. Where this sits in the codebase

| Concern | File(s) |
|---|---|
| Agent/Editor switch, session panel, layout, keybindings | `packages/daemon/public/bind/forge/session.js` and the rest of `bind/forge/*` (activitybar, dom, editor, explorer, menu, modelpicker, terminal, state) |
| All Forge CSS (inline), including `.ide.mode-agent` rules | `packages/daemon/public/index.html` |
| Compare UI (per-column runs, the VRAM meter) | `packages/daemon/public/bind/compare.js` |
| GPU/VRAM capability + local model sizes | `packages/daemon/src/routes/ollama-lifecycle.ts` (`installedModelSizes`, the `nvidia-smi` probe), served by `/forge/models/host` |
| A run itself (isolated worktree, provider) | `packages/forge/src`, via `POST /forge/run` |
| The design source of truth | design artifact `b551a806` |

## 6. Honestly-open items

- The VRAM number is an **estimate for the meter**, not a measured allocation; a model can still spill
  to system RAM at load time. The meter says "estimate", and the run reports the real wall time.
- Broad parallel scale is bounded by the machine. Compare proves the gate and side-by-side runs; it is
  not a benchmark harness.
- Hosted providers (Claude Code / Codex) can be columns too, but each hosted run still shows its own
  per-run confirmation before it spends anything.
