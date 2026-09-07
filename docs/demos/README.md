# Demos

Four recordings of Zeno doing the thing it exists to do.

**Every frame is a real screenshot of the real product.** The recorder starts a daemon, proposes
through the same HTTP routes an agent uses, clicks the same buttons the owner clicks, and
photographs whatever comes back. Nothing here is a mockup, a drawing, or a state the product cannot
reach on its own. If a flow broke, the GIF would show it breaking.

| | What it shows |
|---|---|
| [`gate.gif`](gate.gif) | **The whole thesis.** An agent proposes a change to `package.json`. It is held at tier **T1** — nothing has happened. The capsule states the exact sentence that was hashed into `provenanceHash`, the action hash, why the tier is what it is, and the literal target path. The owner approves once, and a **signed receipt** lands in the ledger: `verified`, with its own hash, the base it observed, and `prev receipt · null · genesis entry`. |
| [`self-approval.gif`](self-approval.gif) | **The refusal.** The same capsule, but the client posting the approval carries the **proposer** token — the credential an agent holds. The daemon answers `403 self-approval-forbidden`: *"The proposer token cannot approve. Only the owner token can."* The panel under it still reads **the ledger is empty; nothing has been committed yet**. This is structural, not prompted: the approval route has no branch that says yes. |
| [`shell.gif`](shell.gif) | **A command through the same gate.** A governed Forge run asks to run a shell command. It does not get to run it. The capsule carries the **literal command string** — `Run: node --version` — at tier **T3**, kind `shell.exec`. One approval, one attempt, and a `verified` receipt with `external effect  tool-grant:…` sitting in the same ledger as every file edit. |
| [`forge.gif`](forge.gif) | **The coding agent, end to end.** A task goes in; the agent runs headless in a throwaway git worktree it cannot escape; the file it wrote comes back readable in the editor. An ordinary source file is a routine edit, so it is applied and receipted **without interrupting anyone** — `local.write · T0 · verified`. The commit is a separate act and takes its own path: `vcs.commit · T1`, previewed and receipted. The chain ends verified over both. |

## Why there is no `verify.gif`

Tamper evidence was the fifth demo and it was dropped, because filming it honestly is not possible
and filming it dishonestly is worse than not filming it.

The behaviour is real and it works. Alter one byte of one receipt in `ledger.jsonl` and the daemon
**refuses to start**, naming the record:

```
PolicyError: The receipt ledger is broken at index 1 — that record no longer matches its own hash.
fix: Inspect it with `zeno verify`, then move the damaged ledger aside to start a fresh chain.
```

That is exactly the right behaviour and exactly why it cannot be recorded here. A daemon that will
not start serves no window, so there is no page to screenshot; and signature verification
(`zeno verify`) lives in the CLI, which has no browser surface either. The only way to produce a
`verify.gif` would be to typeset the command output into a web page and photograph that — a picture
of a terminal that never existed. This repo's own doctrine is that a panel which invents a passing
run is worse than an absent panel. The same rule applies to its README.

## Re-recording

```powershell
npm install                    # playwright is a devDependency
npx playwright install chromium
npm run build

node tools/record-demos.mjs              # all four
node tools/record-demos.mjs gate shell   # just these
```

`shell` and `forge` start a **governed Forge run**, so they need the `claude` CLI on `PATH` and
signed in. `gate` and `self-approval` need nothing but the daemon and take about a minute between
them.

The recorder starts its own daemon on its own workspace (`.zeno-demo`) and its own port (`7399`,
override with `ZENO_DEMO_PORT`), so it never contends with a Zeno you already have running — two
daemons on one workspace would fork the receipt chain, and the daemon correctly refuses. The
workspace is deleted afterwards. Set `PYTHON` if `python` is not the interpreter with Pillow on it.

Frames land in `.demo-scratch/frames/<name>/` alongside a `manifest.json`. To retime or re-quantise
a demo without re-recording it, edit that manifest and run the assembler on its own:

```powershell
python tools/gif-assemble.py .demo-scratch/frames/gate/manifest.json
```

## How they are built

- **Playwright** drives a real Chromium at a **1040×700** viewport, captured at 2× and emitted at
  1560px wide. GitHub lays README images out in a column about 850px wide, so a 1600px-wide page
  would arrive at roughly half size with every label smeared; 1040 arrives at ~82%, and the extra
  capture density is what keeps the small type resolving rather than smearing.
- **Pillow** assembles the frames. **ffmpeg is not used and is not required.**
- Size comes from **per-frame durations**, not frame count: a three-second hold on the receipt is
  one picture that says `3000ms`, not thirty identical ones. Every GIF here is a couple of dozen
  frames and around a megabyte.
- One shared 224-colour palette, **no dithering**. These are flat UI, not photographs — Floyd
  Steinberg speckles every run of solid colour, doubles the file, and puts noise on exactly the
  small type that has to stay readable. The palette is sampled at full resolution so the amber
  "approval owed" chip and the green verified seal survive quantisation; the window says things in
  colour that it also says in words, and a palette that greys those out edits meaning out of the
  picture.

## Theme

**Dark**, in all four. Both themes were recorded and compared. Dark wins here for two reasons: the
semantic accents the UI leans on — amber for *approval owed*, green for a *verified* seal, red for
*blocked* — carry far more contrast against the dark ground, and they survive GIF quantisation
better; and a README is read against a page of prose, where a dark panel reads as an *instrument*
rather than as another document. The window itself follows the machine (`prefers-color-scheme`) and
neither theme is hardcoded — `packages/daemon/public/glass/tokens.css` carries both, and the
recorder simply asks Chromium for the dark one.
