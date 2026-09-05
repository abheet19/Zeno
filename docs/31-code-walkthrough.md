# Zeno — Code Walkthrough (Phase 1, slices P1-01 + P1-02)

A guided tour of everything we've built so far, written so you can *understand* it —
not just trust it. It explains each piece, the idea behind it, and the concepts we
leaned on. Read it top to bottom once; it builds up.

---

## Part 0 — The one big idea

> **The AI is separated from the ability to act. A small, dumb, predictable engine —
> not the AI — is the only thing allowed to cause a real effect.**

Everything here serves that. The AI can *think* and *propose* anything. But to
actually push code, write a ticket, or change a file, the proposal must walk through
a deterministic gate we built by hand. That gate is the **kernel** (P1-01). The
kernel doesn't *do* effects itself either — it hands an approved, sealed instruction
to a **hand** (P1-02) that carries it out, carefully.

Two components, one loop:

```
  AI proposes  ─▶  KERNEL decides & seals  ─▶  HAND performs & proves  ─▶  RECEIPT
   (untrusted)      (P1-01, deterministic)      (P1-02, sandboxed)         (evidence)
                          ▲
                          └── only YOU approve the risky ones
```

---

## Part 1 — The vocabulary (`src/types.ts`)

Before logic, we define the *nouns*. Good types make illegal states hard to build.

```ts
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
```
**Concept — risk tiers.** Every action is sorted into one of five buckets, from
"harmless" (T0) to "prohibited" (T4). The tier decides how much ceremony is needed.

```ts
export interface ActionRequest {        // what an agent PROPOSES
  kind: ActionKind;                     // 'vcs.push' | 'jira.write' | 'read' | …
  summary: string;                      // one human sentence for the preview
  targetRef: string;                    // WHAT it touches: repo@HEAD, ticket@version
  payload: unknown;                     // the exact bytes/fields to apply
  baseHash: string;                     // hash of the state it expects to change
  requestedBy: string;                  // which agent — used to forbid self-approval
  dataZones: DataZone[];                // personal | company | financial | …
}
```
This is a *proposal*, nothing more. Notice it carries **who proposed it** and **the
exact state it expects** — both matter later.

```ts
export interface Binding {              // the tuple an approval is bound to
  payloadHash: string;                  // hash(payload)  — WHAT will be applied
  baseHash: string;                     // hash(base)     — the exact state to mutate
  targetRef: string;                    // WHERE
  tier: Tier;                           // HOW risky
  provenanceHash: string;               // everything else (model, skills…) as one hash
}
export type ActionHash = string;        // = sha256(canonicalJSON(Binding))
```
**Concept — content-addressed identity.** We hash the whole Binding to get one
`ActionHash`. That hash *is* the action's identity. Change any bound field — the
payload, the base, the target — and you get a *different* action. This is what makes
"you approved it" mean "you approved *this exact thing*."

```ts
export interface Approval {
  actionHash: ActionHash;               // bound to exactly one action
  nonce: string;                        // secret the kernel issued — anti-forgery
  singleUse: true;                      // usable once
  expiresAt: string;
  grantedByOwner: true;                 // only you grant these
}
```
**Concept — a single-use capability.** An approval is like a one-time key cut for one
specific door. It can't open another door (wrong `actionHash`), can't be forged (the
`nonce`), and self-destructs after one turn (`singleUse`).

```ts
export interface Receipt {
  outcome: 'verified' | 'refused' | 'denied' | 'expired' | 'outcome-unknown';
  reason: string | null;
  casBaseObserved: string;              // the base actually seen at commit
  externalEffect: EffectProof;          // provider receipt id, or 'none'
  prevReceipt: string | null;           // link to the previous receipt
  selfHash: string;                     // hash of this receipt + prevReceipt
}
```
**Concept — the receipt is the evidence.** Nothing is "done" until a receipt says so,
and receipts are *chained* (each links to the one before). More on that in Part 4.

```ts
export interface World {                // the INJECTED outside world
  now(): string;                        // the clock
  id(): string;                         // fresh ids
  readBase(targetRef: string): string;  // re-read current state (for CAS)
  approvalTtlMs: number;
}
```
**Concept — dependency injection for determinism.** The kernel never calls
`Date.now()` or `Math.random()` or the filesystem directly. Anything that could
differ between two runs arrives through `World`. Because of this, the *same inputs +
the same World = the exact same output, every time*. That's what makes the whole
engine **replayable and testable** — and it's enforced by a lint rule (Part 8).

```ts
export type Executor = (bound: Binding) => Promise<EffectProof>;
```
**Concept — the seam.** The kernel doesn't know *how* effects happen. It calls this
callback. The "hand" (P1-02) implements it. The kernel **never imports an executor** —
that separation is deliberate.

---

## Part 2 — Hashing (`src/hash.ts`)

```ts
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));   // keys sorted recursively
}
export function hashOf(value: unknown): string {
  return sha256(canonicalJSON(value));
}
```
**Concept — canonical (stable) hashing.** `{a:1, b:2}` and `{b:2, a:1}` are the same
object but `JSON.stringify` would give different strings — and thus different hashes.
So we sort keys first. Now equal things *always* hash equal. This underpins every
"does X still match?" check in the system. We use `node:crypto`'s SHA-256 — a local
cryptographic primitive, no network.

---

## Part 3 — The policy (`src/policy.ts`)

```ts
export const DEFAULT_POLICY: Policy = {
  version: '2026-08-29.1',
  kindTier: { read:'T0', 'patch.task':'T1', 'jira.write':'T2', 'vcs.mr':'T3', payment:'T4', … },
  zoneTier: { financial: 'T4' },
};
```
**Concept — policy is DATA, not code.** The rules live in a plain object (later a
signed `policy.json`), so you can read, diff, and audit them without reading program
logic. Its hash is stamped into every receipt, so you can always prove *which* policy
governed a decision.

```ts
export function classify(req, policy) {
  let tier = policy.kindTier[req.kind];              // base tier from the kind
  for (const zone of req.dataZones)
    if (rank(policy.zoneTier[zone]) > rank(tier)) tier = policy.zoneTier[zone];  // zones can only RAISE
  return { tier, reasons };
}
```
**Concept — fail safe / round up.** Ambiguity always rounds *up* to more caution,
never down. Touching `financial` data forces T4 (prohibited) no matter what the kind
was. `validatePolicy()` even refuses to load a policy that doesn't classify `payment`
as T4 — a safety rule that can't be edited away by accident.

---

## Part 4 — The ledger (`src/ledger.ts`)

```ts
append(r) {
  const prevReceipt = this.entries.at(-1)?.selfHash ?? null;   // link to the tip
  const body = { …r, prevReceipt };
  const selfHash = sign(hashOf(body));                         // hash of body incl. the link
  this.entries.push({ …body, selfHash });
}
```
**Concept — a hash chain (the idea behind a blockchain, minus the blockchain).** Each
receipt contains the hash of the previous one, and its own `selfHash` covers that link.
So the receipts form a chain where every entry vouches for its predecessor.

```ts
verify() {
  let prev = null;
  for (let i = 0; i < entries.length; i++) {
    if (entry.selfHash !== recompute(entry) || entry.prevReceipt !== prev)
      return { ok: false, firstBreakAt: i };     // exact break located
    prev = entry.selfHash;
  }
  return { ok: true };
}
```
**Concept — tamper-evidence.** Edit or delete any past receipt and the chain no longer
recomputes — `verify()` points at the exact broken link. It's *tamper-evident*, not
tamper-*proof* (that needs real signing keys, a later slice) — and the code says so
honestly. The `sign()` function is injected, so swapping SHA-256 for a keypair later
changes nothing else.

---

## Part 5 — The kernel: the state machine + the seven laws (`src/kernel.ts`)

This is the heart. One `ActionRequest` walks a fixed path:

```
 classify → PREVIEWED → (you) APPROVED → [re-check base] → COMMITTING → VERIFIED
                │ T4                         │ drifted           │ one attempt
                └▶ DENIED                    └▶ REFUSED           └▶ OUTCOME_UNKNOWN
```

### `preview(req)` — pure preparation
```ts
const binding = { payloadHash: hashOf(req.payload), baseHash: req.baseHash,
                  targetRef: req.targetRef, tier, provenanceHash: hashOf(…) };
const actionHash = hashOf(binding);
this.pending.set(actionHash, { binding, state: tier==='T4'?'DENIED':tier==='T0'?'AUTO':'PREVIEWED' });
```
It computes the Binding and its `actionHash`, records the action, and returns a preview.
**It causes no effect** — looking is not doing. *(Law L6 in structure: an agent can
reach here, but no further, on its own.)*

### `approve(actionHash, auth)` — the OWNER channel
```ts
if (tier === 'T4') throw 't4-denied';                       // L7: prohibited, no path
if (rank(tier) >= rank('T2') && !auth) throw 'missing-authenticator';
const nonce = world.id();                                    // the anti-forgery secret
this.pending.get(actionHash).approval = { actionHash, nonce, singleUse, expiresAt };
```
Only this method mints approvals, and it's the *owner's* channel. There is **no
agent-callable approve** — that's how "the AI can't approve itself" is true by
construction, not by policy.

### `commit(approval, exec)` — the only place an effect can happen
```ts
if (tier === 'T4') return receipt('denied');                        // L7
if (state === 'SPENT') return receipt('denied: already used');      // L4
if (approval.nonce !== stored.nonce) throw 'tuple-mismatch';        // L1/L6: can't forge/replay
if (now > approval.expiresAt) return receipt('expired');

const observed = world.readBase(binding.targetRef);                 // ← RE-READ the base
if (observed !== binding.baseHash) {                                // L3: it drifted
  state = 'PREVIEWED';                                              //   approval stays UNSPENT
  return receipt('refused: base drifted');                         //   nothing applied
}

state = 'SPENT';                                                    // L4: spend BEFORE the attempt
try {
  const proof = await exec(binding);                               // L2: EXACTLY ONE attempt
  return receipt('verified', proof);                              // L5: seal only after this receipt
} catch {
  return receipt('outcome-unknown');                              // no silent retry, ever
}
```

**The seven laws, each visible above:**
| Law | Meaning | Where |
|---|---|---|
| **L1** | No effect without approval | commit requires a matching approval |
| **L2** | Exactly one attempt | `exec` called once, in a try, no loop |
| **L3** | Compare-and-swap | re-read base; drift → refuse, unspent |
| **L4** | Single-use approval | spent before the attempt |
| **L5** | Seal only from a receipt | `verified` is a written receipt, not a flag |
| **L6** | No self-approval | approve is owner-only; nonce can't be forged |
| **L7** | T4 is absolute | no code path from T4 to an effect |

**Concept — compare-and-swap (L3), the crown jewel.** Between your approval and the
commit, the world can change. So right before acting, the kernel *re-reads* the base
and checks it still matches what you approved. If a teammate pushed in the meantime,
the base moved — the kernel **refuses** and doesn't spend your approval. This is the
same idea databases use for safe concurrent writes: *only swap if the value is still
what I expected.* It's why "you approved it" can never silently become "applied to
something you never saw."

---

## Part 6 — The hand: the executor (`src/executor.ts`)

The kernel decides; this carries out one approved file write. Three guarantees:
**jailed · atomic · proven.**

```ts
export function jail(fs, root, relPath) {
  const abs = resolve(root, relPath);
  if (!abs.startsWith(resolve(root) + sep)) throw 'path-escape';        // lexical: blocks ../ and absolute
  if (!fs.realpath(abs).startsWith(fs.realpath(root))) throw 'path-escape'; // symlink-aware
  return abs;
}
```
**Concept — a path jail (sandboxing).** No matter what path arrives, it must resolve
*inside* the sandbox root — checked both lexically (`../../etc/passwd` fails) and after
resolving symlinks (a link pointing outside fails). Even a malicious payload can't
write outside the box.

```ts
async (bound) => {
  if (hashOf(payload) !== bound.payloadHash) throw 'tuple-mismatch';   // integrity: I hold the approved payload
  const abs = jail(fs, root, payload.relPath);
  const before = hashFile(fs.readFile(abs));
  if (before === payload.expectPostHash) return proof(before);         // idempotent: already applied → no-op
  if (before !== payload.expectBaseHash) throw 'base-drifted';         // belt-and-braces vs CAS
  fs.writeAtomic(abs, payload.contents);                              // atomic: temp → rename
  const after = hashFile(fs.readFile(abs));
  if (after !== payload.expectPostHash) throw 'reconcile failed';      // PROVEN: re-read & confirm
  return proof(after);
}
```
**Concept — reconciliation ("prove, don't trust").** After acting, it *re-reads* the
file and checks it truly matches what was approved. A buggy or dishonest hand that
claims success without really writing gets caught here — the executor refuses to
report `verified`, and the kernel records `outcome-unknown` instead. **The re-read is
the evidence; the hand's word is not.**

**Concept — idempotency.** If the file already equals the target (the effect is
somehow already present), applying again is a safe no-op — never a double-write.

**Concept — atomicity.** The real write is temp-file → rename (Part 7), so a crash
mid-write leaves the original intact. All-or-nothing.

---

## Part 7 — Pure core, impure edge (`src/executor-node-fs.ts`)

```ts
writeAtomic(absPath, contents) {
  const tmp = absPath + '.' + randomBytes(6).hex() + '.tmp';
  writeSync(fd, contents); fsyncSync(fd);         // fully write the temp
  renameSync(tmp, absPath);                       // atomic replace
}
```
**Concept — isolate the side effects.** All the *logic* (jail, reconcile, idempotency)
lives in `executor.ts` and is pure — it talks to an injected `SandboxFs`. The *actual*
disk operations live only here, in the real adapter. Tests inject an in-memory fs and
never touch the disk; production uses this. Keeping the impure part small and separate
is what let us reach 100% coverage on the logic.

---

## Part 8 — How we *prove* it: property testing (`test/`)

We don't just test one happy example. We test *laws over thousands of random cases*.

```ts
test('L3 — under random drift, a drifted commit NEVER applies', () => {
  for (let i = 0; i < 500; i++) {                 // 500 randomized scenarios
    …approve; maybe mutate the base;
    if (drift) assert(outcome === 'refused' && executor.calls() === 0);
    else       assert(outcome === 'verified');
  }
});
```
**Concept — property-based testing.** Instead of "given X, expect Y", we assert an
*invariant that must hold for all inputs* — "no random stream ever produces an effect
the laws forbid" — and throw ~3,000 generated cases at it. The random generator is
**seeded**, so a failure is perfectly reproducible. This is how you gain confidence in
a security boundary: not by checking a few cases, but by trying to *break* it many ways.

We also lint for the rules the code must never violate:
```
✓ no network imports anywhere in src/     (the zero-network guarantee)
✓ no Date.now()/Math.random() in src/     (everything non-deterministic is injected)
```
A dependency-free script enforces these — so the guarantees can't rot silently.

---

## Part 9 — The concepts, in one place

| Concept | What it means | Why it's here |
|---|---|---|
| **Separation of decision from action** | the AI proposes; a dumb engine decides; a hand acts | injection & bugs can't cause unapproved effects |
| **Content-addressed identity** | hash the whole action → that's its id | "approved *this exact thing*" |
| **Dependency injection** | clock/ids/fs arrive from outside | determinism → replayable, testable |
| **Compare-and-swap** | re-check the base before acting | never act on state you didn't approve |
| **Single-use capability** | an approval is a one-time key for one door | no reuse, no forging, no drift |
| **Hash chain** | each receipt links to the last | tamper-evident history |
| **Path jail / sandbox** | writes confined to one folder | blast-radius control |
| **Reconciliation** | re-read to prove the effect | catch dishonest/buggy hands |
| **Idempotency** | re-doing is a safe no-op | crashes/retries stay safe |
| **Atomicity** | temp → rename | no half-finished writes |
| **Fail safe** | ambiguity rounds up; T4 has no path | the safe default is the only default |
| **Property testing** | invariants over thousands of cases | prove a boundary, don't spot-check it |

---

## Part 10 — This IS the thing you clicked

The **Approval Capsule** in the Command prototype — *"TASK-101 — TASK patch · Approve"*,
and the *drift → refused* you toggled — is a picture of **this exact code**:

- the capsule you read  = `preview()` returning a Binding
- the **Approve** button = `approve()` minting a single-use approval
- the ✓ verified seal    = a `verified` **Receipt** from `commit()`
- *simulate drift*        = compare-and-swap (**L3**) refusing
- "nothing else moved"   = the receipt's `externalEffect: none`

The prototype is the *face*; these ~1,400 lines are the *engine* underneath it. That's
Phase 1 so far: the decision core, and its first careful hand — both real, both tested,
both proven.
