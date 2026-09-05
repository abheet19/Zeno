# Acceptance audit — 2026-09-05

Graded against the tree as it stands, by running it, not by reading it. Where a
claim below says "verified", something was executed and its output observed.

**Headline: 196 criteria. 106 are gated on things this machine does not have.
90 are in principle achievable here, and roughly half of those are genuinely met.**

---

## 1. What is structurally out of reach (106)

Not "not done yet" — **cannot be done on a single Windows laptop with no budget.**

| Gate | Criteria | Why |
|---|---:|---|
| Hardware / eval numbers | 60 | FAR/FRR, DER/JER, p95 latency, thermal, calibration on frozen consented hardware |
| macOS | 18 | Cut permanently by scope decision |
| External services | 13 | Slack, Jira, Figma, GitLab, OAuth, WebRTC/SIP, Obsidian, calendar, email |
| Ship infrastructure | 9 | Code signing, notarisation, installer, SBOM, release candidate |
| A second physical device | 6 | Pairing, hand-off, cross-device continuity |

Reporting these as "failing" would be dishonest: no amount of code closes them.
They need a lab, a second machine, paid accounts, or a Mac.

---

## 2. The 90 achievable — graded

### Met, and verified by running it

**The gate (the kernel's seven laws).** Every one has a test that fails if it is
violated, and each was also exercised end-to-end tonight against a live daemon:

- **L1** nothing verifies without an owner approval — verified
- **L2** exactly one execution attempt — verified
- **L3** compare-and-swap refuses on drift — verified (`base-drifted`)
- **L4** approvals are single-use — verified: replaying a spent approval is refused
- **L5** "verified" only where a durable receipt exists — verified
- **L6** an agent may propose, never approve — verified: the proposer token gets
  `403 self-approval-forbidden`, and a *hosted* agent cannot even be started by
  voice or by the assistant
- **L7** payment/financial can never be approved — enforced by tier, tested

**The ledger.** 1,053 unit tests green. `zeno verify` walks the chain *and* every
Ed25519 signature; editing one character names the exact broken line.

**Risk tiering.** A routine sandbox edit auto-applies; config, deletion, gutting
and **anything carrying a credential** stop for the owner — verified live for each.

**Secret handling.** A token-shaped string in a proposed change escalates it out
of "routine". A spoken credential is redacted *before* the meeting file is
written — verified by grepping the file on disk for the raw secret.

**Forge.** Real repo status, a real file tree from `git ls-files`, a
line-numbered code pane reading real bytes through a jailed route, an agent that
runs headless in a throwaway worktree, its changes returning as ordinary approval
capsules, and a commit that lands a real git sha through the gate. The local
model wrote a `slugify` implementation that **passed 4/4 behavioural checks when
executed**.

**Counsel.** Summarises a transcript where every decision, action and open
question cites the line it came from; persists calls; lists them; deletes one and
the `.md` really leaves the disk.

**Work intake.** The Jira trigger was replaced by a `WorkItem` port: a local
backlog plus a read-only GitHub Issues adapter that distinguishes 404 from 403
from rate-limit from network failure, and never reports a failure as an empty list.

**Honest degradation** (a cross-cutting requirement, and the one most often
faked). Verified: with `/state` unreachable the window says *"The daemon did not
answer"* and draws `—`, **not** "Nothing is waiting on you" and `0`.

### Partial

- **Command as a control plane** — the surface, the queue, the receipt timeline,
  memory, the brief and the standing field are real; there is no persistent chat
  and no device fleet.
- **Voice** — wake word, command grammar and the "no utterance can ever approve"
  law are real and tested. Identity, adaptation and anti-spoofing are not built,
  and the accuracy criteria need eval hardware.
- **Ask Zeno** — answers grounded in real state and refuses what the facts do not
  support. It is not a general assistant and has no long conversation memory.
- **MCP** — a working stdio propose/read server. The specification's governed
  registry, scoped grants, per-agent isolation and revoke are absent.
- **Mesh** — pairing, sealed envelopes and convergent replication are built and
  tested against a *simulated* peer. No phone app exists, and the window says so.
- **Design** — the Gate-2 prototype's chrome, rail, standing field, Forge IDE and
  Counsel surfaces are ported and running on live data.

### Not built

Model gateway · credential broker · the ~8 external connectors · quota and cost
caps · NeoSapien MCP server · Streamable-HTTP transport · persistent chat ·
device fleet UI · the policy simulator surface.

---

## 3. Bugs found and fixed while auditing

Every one of these was found by *using* the product, not by reading it:

1. **Claude Code could never run on Windows.** npm ships it as `claude.cmd`, and
   Node ≥20 refuses to spawn a batch file without a shell (CVE-2024-27980), so
   `spawnSync('claude')` was ENOENT and `claude.cmd` was EINVAL. It resolved in a
   terminal, so it looked installed. Now launched via `cmd.exe /c` with every
   argument still a separate argv element, so owner-supplied task text is never
   re-parsed for shell metacharacters. A missing binary is still reported as
   `failedToSpawn`, not as "the agent ran and failed".
2. **Two daemons could share one workspace and fork the receipt ledger** — and the
   daemon's own `EADDRINUSE` message *suggested* running a second copy on another
   port. A real forked chain was produced. Closed with an exclusive lock on
   `ZENO_DIR`; stale locks are taken over so a crash cannot lock the owner out.
3. **Forge could never commit** — the daemon staged paths itself, tripping the
   executor's guard against consuming work a human staged by hand.
4. **The effort control was greyed out** although effort genuinely drives a Qwen3
   thinking budget: the registry still described a build where the local rung ran
   nothing.
5. **"Zeno wake up" was answered with "that is not a command I recognize"** — the
   owner did the one thing the product asks and got an error.
6. **"Begin capture" gave no reason when disabled**, though it has four
   preconditions. A dead control is indistinguishable from a broken one.
7. **Anything the window proposed could never be approved** — it was labelled
   `requestedBy: "owner"`, so L6 refused the owner's own approval and voice was
   permanently dead-ended.
8. **The most urgent state never rendered.** Pending approvals drew calm grey
   because the code read a `state` field the route never sends. Measured: 0 amber
   pixels with three approvals waiting; 4,838 after the fix.

---

## 4. Where I was wrong

- I twice reported a **dead animation loop** from measurements taken in an
  embedded browser pane that fires zero `requestAnimationFrame` callbacks while
  reporting itself visible. In a real headed browser: **300 rAF/sec**. The
  instrument was broken, not the product.
- I "fixed" the Forge commit by adding a `git add`, which **caused** the failure I
  was chasing. The raw receipt had the answer the whole time.
- I told the owner the Claude Code rung was live because the binary was on PATH.
  I had checked that it *resolved*, never that it *ran*. It did not.

---

## 5. The honest headline

The **deterministic safety spine is real, heavily attacked, and works**: an agent
cannot cause an effect the owner did not approve, and every effect leaves a signed
receipt that names itself if it is altered.

The **suite-of-products breadth is partial**, and what is missing is mostly gated
on money, hardware, a second device or a Mac — not on unwritten code.

Per the canonical CSV every row still reads `not-started`, because that file is
the criteria definition and was never a live scorecard. Inflating it would not
survive an interview; this document is the defensible version.
