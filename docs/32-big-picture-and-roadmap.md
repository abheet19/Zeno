# Zeno — The Big Picture (the plan, how it connects, what's next)

> **Historical implementation note.** This document describes the Phase 1 P1-01/P1-02 slice,
> not the current complete product surface. Use [the current study pack](44-STUDY-PACK.md) for the
> present architecture and [the test guide](35-HOW-TO-TEST.md) for reproducible behavior.

Read this *before* the code walkthrough. It's the map. The walkthrough is the
street-level detail; this is the view from above.

---

## 1. What Zeno is

**One private, local-first personal intelligence suite — three products, one brain,
built on a single promise: "Reason before action."** Nothing consequential happens
without your approval; your data stays on your machines; you own all of it.

The three products:

| Product | In one line | Think of it as |
|---|---|---|
| **Zeno Command** | your dashboard + assistant + approvals | mission control |
| **Zeno Forge** | the coding agent + IDE | Claude Code / Cursor, but governed |
| **Zeno Counsel** | the meeting copilot | a live, consent-first advisor |

They share one set of organs underneath.

---

## 2. How everything connects (the architecture)

Read top to bottom. Each layer only talks to the one below it.

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  SURFACES — what you see & touch                                   │
 │  Command (field, approvals)   Forge (code)   Counsel (meetings)    │
 │  + HUD / tray / launcher / phone                                   │
 └───────────────────────────────┬──────────────────────────────────┘
                                  │  you approve · you watch
 ┌───────────────────────────────▼──────────────────────────────────┐
 │  ORCHESTRATOR — the brain / the "sun" of the field                │
 │  routes each task, dispatches agents, owns the task graph          │
 └───────────────────────────────┬──────────────────────────────────┘
                                  │  dispatches
 ┌───────────────────────────────▼──────────────────────────────────┐
 │  AGENTS (untrusted) — they PROPOSE, never act on their own         │
 │  Work Agent · Design agent · Counsel agent · (Claude Code, local   │
 │  models — chosen per task by Auto routing, run in parallel)        │
 └───────────────────────────────┬──────────────────────────────────┘
                                  │  proposes an ActionRequest
 ┌───────────────────────────────▼──────────────────────────────────┐
 │  ★ POLICY KERNEL (P1-01) — the deterministic GATE  ◀── BUILT       │
 │  classify → preview → (you) approve → compare-and-swap → commit    │
 │  the seven laws · single-use approvals · receipts                  │
 └───────────────────────────────┬──────────────────────────────────┘
                                  │  hands an approved, sealed Binding
 ┌───────────────────────────────▼──────────────────────────────────┐
 │  ★ EXECUTORS (the "hands") — they DO the effect, jailed & proven   │
 │  Worktree/file executor (P1-02) ◀── BUILT                          │
 │  git executor · Jira executor · message executor · … (next)        │
 └───────────────────────────────┬──────────────────────────────────┘
                                  │  every effect writes a receipt
 ┌───────────────────────────────▼──────────────────────────────────┐
 │  MEMORY & SAFETY (cross-cutting)                                   │
 │  Vault (governed memory, cited) · Sanitizer (egress guard) ·       │
 │  Credential broker · Mesh (E2EE device sync) · Glass (design)      │
 └──────────────────────────────────────────────────────────────────┘
```

**The one rule that governs the whole stack:** a proposal can flow *down* freely
(reading, drafting, thinking), but to become a real effect it must pass the **Kernel
gate** — and the risky ones need *your* approval. That's why an agent (or a hacker's
injected instruction) can suggest anything but cause nothing on its own.

**Where the code we've written sits:** the two ★ layers — the **Kernel** and the first
**Executor**. That's the spine: *decide → do → prove*. Everything else plugs into it.

---

## 3. The action contract (the heartbeat that runs through it all)

Every consequential thing — a code change, a push, a Jira write, a message — follows
the exact same seven-step rhythm. You've seen it as the Approval Capsule.

```
 prepare → PREVIEW → APPROVE → revalidate → commit(one attempt) → VERIFY → reconcile
  (agent)  (you see)  (you say  (re-read     (the hand acts       (receipt) (Vault log)
                       yes)      the base)     once, in a sandbox)
```

Same contract for all three products. Learn it once, it works everywhere.

---

## 4. Where we are right now

```
 PHASE 0  ██████████████████  DONE   research · brand (Zeno) · design · Gate 1 & 2 ✓
 PHASE 1  ████░░░░░░░░░░░░░░  STARTED
          ✓ P1-01  Policy Kernel        (the gate)         47 tests
          ✓ P1-02  Worktree Executor    (the first hand)   green
          ▢ next slices  →  section 5
```

Two slices of Phase 1 are real, tested code in your repo. The rest of the suite
(Forge's screens, Counsel, Vault, sync…) is fully *designed* — that's the prototype
you've been shaping — and gets built slice by slice on top of this spine.

---

## 5. What comes next (the roadmap)

Phase 1 continues as small, provable slices — each with its own LLD you approve first.
The order follows dependencies (each needs the one before it):

```
 ✓ P1-01  Policy Kernel .............. the gate                        [done]
 ✓ P1-02  Worktree Executor ......... first hand: real file writes     [done]
 ▷ P1-03  Git Executor .............. same interface, real git ops     ← recommended next
   P1-04  Sanitizer ................. egress guard (what may leave)
   P1-05  Credential Broker ........ real T2 auth (Windows Hello)
   P1-06  Context Assembly ......... sealed, cited context packs
   P1-07  Signer ................... real signed receipts (tamper-PROOF)
   P1-08+ First Forge surface ...... the IDE shell wired to the spine
   …      Counsel, Vault projection, Mesh sync … (later waves)
```

**The three waves** (from the roadmap):
- **Wave A** — the spine (needs only Gate 1). *We're here.* Kernel, executors, sanitizer, broker.
- **Wave B** — the Windows runtime (needs your pilot; B-002 specs are in). Where the product actually *runs*.
- **Wave C** — the surfaces (needs Gate 2, done). The Command/Forge/Counsel UIs, mapped to the approved design.

**The gates still ahead:**
- **Per-slice LLD** — every slice, like the two you've approved.
- **Gate 3 + your sentence "Approve work-Mac pilot"** — before *anything* runs on this Mac. Until then, the product runtime lives on the Windows pilot.

**The immediate choice in front of you:** approve **P1-03 (the git executor)** next —
it makes the kernel drive a *real version-control effect* end to end — or pick the
**sanitizer** if you'd rather build the egress-safety piece first. Either way: I write
the LLD → you approve → I build + test with all checks → you land it.

---

## 6. One paragraph to hold onto

Zeno is three products over one brain, and the brain's spine is a **deterministic gate
that separates thinking from doing**. Agents (including Claude Code) propose; you
approve the risky ones; a jailed, honest hand performs them; a receipt proves it. We've
built that spine — the gate (P1-01) and its first hand (P1-02). Everything ahead —
git, Jira, the IDE, meetings, memory, sync — is another hand or another surface
plugged into the same spine, one approved slice at a time.
