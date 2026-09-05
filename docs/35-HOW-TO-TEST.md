# How to test Zeno

Every command below was run on this machine, in **PowerShell**. Copy them as they are.

> The old design triggered work from a Jira ticket. There is no Jira any more, so the trigger is
> now **you**, from a second terminal — `zeno propose` is an agent asking for something. That is a
> complete test of the product: the gate does not care whether the request came from Jira, GitHub,
> a local backlog or a person typing.

---

## 0. One command to prove the whole thing is sound

```powershell
cd D:\code\Zeno; npm run check
```

**Expect:** three packages, all green. Roughly `99 pass` (kernel), `14 pass` (daemon), `8 pass`
(CLI), zero failures, plus a coverage table. The build FAILS if kernel coverage drops below
95% lines / 85% branches / 95% functions — so a green run is a real statement, not a vibe.

---

## 1. The ninety-second version, no browser

```powershell
cd D:\code\Zeno; npm run demo
```

**Expect** five numbered steps:

1. an agent proposes a change — tier **T1**, `needs YOUR approval — no agent can grant this`
2. you approve → `VERIFIED` → the changed line is printed from the file on disk
3. a second change is approved… and someone else edits that exact file
4. `REFUSED` · `executor invoked 0 times` · the other person's edit is intact
5. the receipt chain, `VERIFIED — 2 receipts`

The single most persuasive moment is step 4: it **refuses rather than clobbering**, and the file is
byte-identical to what the other person wrote.

---

## 2. Prove the audit log cannot be quietly edited

```powershell
cd D:\code\Zeno; npm run ledger:verify
```
**Expect:** `VERIFIED — 2 receipts, every link intact.` Exit code 0.

Now break it. Open it, change any single character, save, close:

```powershell
cd D:\code\Zeno; notepad .zeno\ledger.jsonl
```

```powershell
cd D:\code\Zeno; npm run ledger:verify
```
**Expect:** `BROKEN at index 0 — that record no longer matches its own hash.`, the offending row
marked `<-- FIRST BREAK`, exit code **1**.

Three more tampers, each caught with a *different* message:

```powershell
cd D:\code\Zeno; npm run demo --silent > $null; (Get-Content .zeno\ledger.jsonl)[0] | Set-Content .zeno\ledger.jsonl; npm run ledger:verify
```
Deleting the last receipt → `receipts were removed from the end`. A plain hash chain cannot see its
own tail being cut off; a small head record makes it visible.

```powershell
cd D:\code\Zeno; npm run demo --silent > $null; Remove-Item .zeno\ledger.jsonl; npm run ledger:verify
```
Deleting the whole log → still **BROKEN**, not "0 receipts, all fine".

Reset whenever you like — `npm run demo` starts a fresh ledger every run.

---

## 3. The browser — this is the interview demo

```powershell
cd D:\code\Zeno; npm run up
```

It prints the window address and a **proposer token**. Open <http://127.0.0.1:7317>.

**Expect** a dark graphite window: *Zeno Command · APPROVAL KERNEL*, a chain badge top-right, a
`live` chip (the SSE stream is connected), and *"Nothing awaiting approval."*

Now be the agent. In a **second** PowerShell window, paste the proposer token it printed:

```powershell
cd D:\code\Zeno; npm run propose -- --token PASTE_PROPOSER_TOKEN --rel "src/Toolbar.tsx" --summary "add an ARIA role to the toolbar" --contents "export const Toolbar = () => <div role='toolbar' />;" --prove
```

**Expect, in the terminal:**
- `PROPOSED — and nothing has happened yet.` · tier T1 · `needs the owner, in the Zeno window`
- then, because of `--prove`, that **same token pointed at `/approvals`**:
  `HTTP 403 — The proposer token cannot approve. Only the owner token can.`

**Expect, in the browser, instantly and with no refresh** — a capsule showing:

| Field | What you should see |
|---|---|
| 01 What will happen | the exact sentence, and a note that it is hashed into the binding |
| 02 Action identity | the action hash, with `identity · hash recomputed from the tuple, and it matches` |
| 03 Risk tier — and why | `T1 · approval owed`, **with the reason** — a tier is never shown without one |
| 04 Target | the absolute path inside the sandbox |
| 06 Payload body | the complete exact bytes, and `payload hash · matches the binding` |
| 15 Approval binding | the full bound tuple, copyable |
| footer | `✓ Approve this exact hash — single use · one attempt` |

**Click Approve once.**

- the **verified seal appears only now** — never on click, only when the receipt lands
- it shows receipt id, external effect, base observed, self hash, `prev receipt: null · genesis entry`, policy hash
- the control latches: `✓ Approved — already used · single-use: this approval is spent`
- the chain badge updates live to `chain verified — 1 receipt`

Then confirm it was real, not theatre:

```powershell
cd D:\code\Zeno; Get-Content .zeno\sandbox\src\Toolbar.tsx
```

---

## 4. Prove that proposing causes nothing

Raise a proposal and **do not** approve it:

```powershell
cd D:\code\Zeno; npm run propose -- --token PASTE_PROPOSER_TOKEN --rel "src/NeverApproved.tsx" --summary "this one you will ignore" --contents "export const X = 1;"
```

```powershell
cd D:\code\Zeno; Test-Path .zeno\sandbox\src\NeverApproved.tsx
```

**Expect:** `False`. The capsule sits in the window; the file does not exist. Opening a capsule is
not approving, and an unapproved proposal leaves no trace but a record of having been asked.

---

## 5. Prove payments are impossible, not merely refused

There is no "deny payments" setting to switch off. Try to write a policy that allows one:

```powershell
cd D:\code\Zeno; '{"version":"lax","kindTier":{"read":"T0","local.write":"T0","patch.task":"T1","vcs.commit":"T1","vcs.push":"T2","vcs.mr":"T3","jira.write":"T2","message.send":"T2","settings.change":"T3","payment":"T1","destructive":"T3"},"zoneTier":{"financial":"T4"}}' | Set-Content .zeno\policy.json; npm run demo
```

**Expect:** it refuses to start —
`PolicyError: Policy must classify "payment" as T4.` with a `fix:` line. The kernel will not run
under a policy that permits payments.

```powershell
cd D:\code\Zeno; Remove-Item .zeno\policy.json; npm run demo --silent > $null; Write-Output "back to normal"
```

---

## 6. Prove the policy is real and pinned into the record

```powershell
cd D:\code\Zeno; node -e "const{DEFAULT_POLICY}=require('./packages/kernel/dist/src/index.js');" 2>$null; npm run demo --silent | Select-String "policy"
```

**Expect:** `policy  built-in default · e196aab1e8ff`. Drop a valid `policy.json` in `.zeno\` and the
line changes to `policy.json · <a different hash>` — and **that hash is written into every receipt**,
so a receipt proves which rules governed it, not merely what happened.

---

## What this does NOT do yet

Being straight with you, so nothing here surprises you in an interview:

- **No AI model.** Nothing generates the proposals — you do, or a script does. The local-model
  runtime is a later phase.
- **No Forge, no Counsel, no Vault, no Mesh.** Designed in `docs/`, not built.
- **No voice, no meetings, no device sync, no MCP.**
- **Tamper-EVIDENT, not tamper-proof.** The chain proves an edit happened and points at it. Real
  cryptographic signatures are the Signer slice, later. The seam for them already exists.
- **The owner token is the authenticator.** Windows Hello is a later slice, and the code says so
  rather than implying the T2 gate is stronger than it is.

`docs/34-ACCEPTANCE-STATUS.md` holds the honest count against all 196 original acceptance criteria.
