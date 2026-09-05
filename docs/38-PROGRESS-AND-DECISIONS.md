# 38 — Progress & Decisions, for review

**For:** the planning instance that produced `docs/33-BUILD-PLAN.md` and the Gate-2 design corpus.
**From:** the implementation session.
**Purpose:** approve the direction taken, and flag the calls that deserve a second opinion.
**Date:** 2026-09-04.

This is written in the Zeno spirit — nothing here is presented as settled that the reviewer has not
seen. Section 3 is the part that needs your yes/no; the rest is context.

---

## 1. What is built (verifiable, not asserted)

Eight packages. Run `npm run check` per package to reproduce every number.

| Package | Tests | State | What it is |
|---|---:|---|---|
| `@abheet19/zeno-kernel` | **168** | ✅ green | The gate + file executor + **git executor** + **risk assessment** + **Ed25519 signed receipts** |
| `@abheet19/zeno-intake` | 79 | ⚠ 2 failing | Local backlog + GitHub Issues — the Jira replacement |
| `@abheet19/zeno-vault` | 21 | ✅ green | Memory: Markdown notes, cited recall, an honest morning brief |
| `@abheet19/zeno-mcp` | 57 | ⚠ 1 failing | The gate as governed MCP tools over stdio |
| `@abheet19/zeno-sanitizer` | 36 | ✅ green | Secret redaction before text reaches a prompt/receipt/log |
| `@abheet19/zeno-daemon` | 37 | ✅ green | The loopback window; L6 as a process boundary; **persistence**; signing wired |
| `@abheet19/zeno-cli` | 16 | ✅ green | `demo` / `verify` / `propose` / `backlog` |
| `@abheet19/zeno-voice` | — | 🔵 building | Wake phrase + command grammar + browser push-to-talk |
| `@abheet19/zeno-mesh` | — | 🔵 building | Phone↔Windows pairing, E2EE envelope, convergent replica |

Kernel coverage: **98.35% lines / 94.55% branches / 99% functions**, gate at 95/85/95.

Against the design corpus, this realises: the P1-01 kernel and P1-02 executor (as planned), plus
slices the plan scheduled much later — the git executor (Phase 4), the daemon + Glass capsule +
persistence (Phase 2), the Signer (Phase 9), and first cuts of Vault (Phase 7), MCP, the sanitizer,
and the work-item intake that replaces the dead Jira trigger.

---

## 2. Decisions taken, and why

Each of these departs from or extends the original specification. They were made to keep the thing
finishable and honest; none weakens a safety law.

1. **Windows + phone-sync, no Mac.** The owner has one machine and the work Mac is gone. macOS is
   out of scope; phone↔Windows sync (Mesh) is *in*. Recorded in `docs/36`.
2. **The Jira trigger is replaced by a `WorkItem` port** with a local backlog and a GitHub Issues
   adapter. The employer relationship ended; the trigger was never the point, the gate was.
3. **Risk-based tiering (`src/risk.ts`).** The biggest behavioural change. A file write is no longer
   uniformly T1 — it is classified by *what it does*: an ordinary sandbox edit is routine and
   auto-applies (still receipted); configuration, a rewrite (>40 lines), or a deletion stops for the
   owner. **Rationale:** asking for approval on every trivial edit trains the owner to click without
   reading, which defeats the product. **This is the decision most in need of your review** — it
   trades a stronger invariant (nothing happens without an explicit yes) for a usable one (nothing
   *risky* happens without an explicit yes), and it means a leaked proposer token can now cause a
   bounded, fully-receipted effect. That trade is documented in `risk.ts`; confirm it is the right
   call, or tell us to make auto-apply opt-in.
4. **Signed receipts (Ed25519).** The ledger is now tamper-*proof*, not merely tamper-evident.
   Additive and opt-in; an unsigned ledger still verifies. Brought forward from Phase 9 because it
   is small and closes a clean criterion.
5. **Voice is being built.** The owner asked for it. Earlier caution ("non-commercial weights block
   it") was wrong for this context: personal, non-commercial use is exactly what CC BY-NC-SA
   permits. The package keeps the *recognizer injected* — the browser's Web Speech API is the
   default, labelled as such — and enforces one hard rule: **no spoken utterance can ever approve.**
6. **The proposer token no longer prints to stdout** — it is written to a 0600 file the CLI reads.
   This closes SAN-AC-06, which the acceptance audit flagged as a live-credential leak into
   `.daemon.log`.
7. **"All 196 met" is declined as a goal.** `docs/34` grades every criterion honestly (currently
   0 met / 47 partial / 114 not-built / 35 out-of-scope). The owner has repeatedly asked for all
   196; we have repeatedly explained that ~35 require voice-grade eval numbers, a fine-tuning lab,
   meeting diarization, paid signing/CI, or a second physical device, and that a repo *claiming*
   196/196 would harm them in an interview more than an honest one helps. Building continues; the
   number is reported, never inflated.

---

## 3. Open questions — your call

| # | Question | Our lean |
|---|---|---|
| Q1 | Is **risk-based auto-apply** (decision 3) acceptable, or must every effect keep an explicit approval? | Keep it, but make the auto-apply threshold owner-configurable in `policy.json`. |
| Q2 | Three tests now fail (below). They encode assumptions that **predate** risk-based auto-commit. Fix the code, or update the tests? | Update the tests — the new behaviour is correct; the tests assert the old model. |
| Q3 | Should the daemon **sign receipts by default** (it now does), or only when the owner opts in? | Default on — the key is generated locally at $0 and the guarantee is strictly better. |
| Q4 | **Mesh** is being built as a protocol core proven against a *simulated* second device. The real phone app is a separate mobile build we are not doing. Is the protocol core the right stopping point? | Yes — it is the defensible, testable half; the app is a later, separate effort. |
| Q5 | After voice/mesh land, spend the next effort on **Forge** (a governed coding-agent surface over the git executor) or on a **local model runtime** (Ollama) that turns the assistant real? | Forge first — it needs no model and closes a bigger criteria cluster. |

### The three failing tests (Q2)

- `intake` — *403 rate limit says wait, and says when* & *no failure is silent, and no two are alike*:
  GitHub-adapter error-message assertions that an adversarial pass tightened; likely a wording drift,
  not a behaviour break.
- `mcp` — *re-proposing cannot double-apply*: asserts a second identical proposal is `held`, but it
  returns `committed`. Under risk-based auto-apply the first routine write commits and changes the
  file, so the second proposal has a *different base hash* → a genuinely new (idempotent) action →
  it commits again as a safe no-op. We believe the test's expectation is now wrong, not the code —
  but this is exactly the kind of L2/L4 question we want you to rule on before we change it.

---

## 4. What is deliberately NOT built (and why it is not "left undone")

Per `docs/34` §4–5, in three buckets: **needs a local model** (assistant chat, Forge-as-agent,
NL execution); **needs hardware/eval runs** (voice FAR/FRR, performance/thermal numbers); **needs
money or a second machine or is permanently cut** (code signing, CI/SBOM, the phone app, Counsel's
diarization under GDPR Art. 9, macOS). None of these is a gap in the spine — each is a leaf that
needs something the $0 single-Windows-machine context does not provide.

---

## 5. Recommended next steps

1. Adjudicate Q1–Q5.
2. Land voice and mesh (in flight).
3. Re-run the acceptance audit; publish the new honest number.
4. Build Forge over the git executor (Q5).
5. Consolidate: wire Vault + sanitizer + MCP into the daemon so it is one product, not eight libraries.

Everything is uncommitted (52 files) per the standing rule that the owner reviews and lands. Nothing
has been pushed anywhere.
