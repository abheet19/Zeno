# What Zeno actually is (plain language)

You've been building this for a while, so a straight answer is overdue.

## The one-sentence version

**Zeno is a safety layer that sits between an AI and your computer, so the AI can suggest anything
but can't *do* anything without your say-so — and everything it does is written to a log you can
prove was never edited.**

## The problem it solves

Right now, when you let an AI agent work on your machine — Cursor, Claude Code, Copilot, whatever —
it can edit your files, run commands, and commit code, and you mostly just… trust it. You watch a
diff fly by and hit accept. Nobody keeps a real record. If a prompt injection hides in a web page
the AI read, or the model just gets it wrong, the damage is already done by the time you notice.

Zeno changes the shape of that. The AI **proposes**. Zeno **classifies** how risky the proposal is.
Anything genuinely risky **stops and shows you exactly what it would do** — the precise bytes, the
file, why it's risky — and waits for one click. Then it does the thing **once**, in a sandbox, and
writes a **tamper-evident receipt**. Edit that log by one character and Zeno tells you which line.

The tagline is the whole idea: **reason before action.**

## How you actually use it — and no, not only when employed

You had a real worry here, so let me kill it: **the employer/Jira thing is dead and gone.** That
was one *trigger* — "a work ticket arrived" — and it was never the point. The point is the gate. The
trigger can be anything:

- **You, typing** — `zeno propose ...` (or just talking to it, once voice lands).
- **A GitHub issue** on one of your own repos.
- **A local backlog** — `zeno backlog add "fix the router bug"`.
- **An AI agent** connected over MCP, asking to make a change.

You use Zeno on **your own projects**, employed or not. Building Weft? Vantage? Any repo at all?
Point an AI at it *through Zeno*, and now every risky edit is previewed and logged instead of
blindly accepted. It is a personal tool for anyone who lets AI touch their computer — which, going
forward, is everyone.

### A real "day with Zeno" that has nothing to do with a job

1. You run `zeno up`. A window opens. It's quiet — nothing waiting.
2. You're building Weft. You tell your AI agent (through Zeno) "add a keyboard shortcut for undo."
3. Small edit to a component → Zeno sees it's routine, **applies it, logs it, doesn't interrupt you.**
4. The agent then wants to change `package.json` to add a dependency. That's **not** routine → a
   card appears in the window. You read it: exact change, why it stopped. You approve. It happens.
5. The agent, misreading something, tries to delete a file. **Red card, T3, stops hard.** You say no.
6. End of day: `zeno verify` — every action you took today, in order, provably untampered.

No employer anywhere in that story. It's just you, an AI, and a gate you trust.

## Why *you* are building it (the honest second reason)

Two reasons, both real:

1. **It's a genuine tool** you'll actually use on your own projects.
2. **It's your portfolio centrepiece.** You were laid off and you're interviewing. This one repo
   demonstrates — with running code and hundreds of tests — security thinking, systems design,
   determinism, cryptography, real-time streaming, and a clean multi-package architecture. That is
   *exactly* the profile that gets a frontend-leaning full-stack engineer hired. In an interview you
   don't say "I built a to-do app"; you say "I built a deterministic policy kernel that makes an AI
   agent physically unable to act without an approval, with a tamper-evident audit chain," and then
   you *show it running in a browser.* That is the use, today, and it is a strong one.

## What it is NOT

- It's not a chatbot. (An AI chat *sits on top* of it, later — the gate is the foundation.)
- It's not a cloud service. Everything runs on your machine; nothing phones home.
- It's not finished. It's a real spine with several products growing on it — see
  `docs/33-BUILD-PLAN.md` for the map and `docs/34-ACCEPTANCE-STATUS.md` for the honest status.

## The shape of the whole thing

```
   You  ◀──────────────  approve / deny (the only thing only you can do)
    │
    ▼
  ┌─────────────────────────────────────────────┐
  │  Zeno Command — the window you look at        │
  └───────────────────────┬─────────────────────┘
                          │
  ┌───────────────────────▼─────────────────────┐
  │  The kernel — the gate. classify → preview → │
  │  approve → do-it-once → receipt.  7 laws.     │
  └───────────────────────┬─────────────────────┘
        proposals in            effects out (jailed)
   ┌────────┬────────┬─────┴─────┬─────────┬──────────┐
   you    GitHub  backlog   an AI (MCP)  voice     a file/git
                                                    executor
```

Everything you build from here — voice, the assistant, the coding agent — is another way to *propose*
or another *hand* to carry out an approved action. The gate in the middle never changes. That's the
design, and it's a good one.
