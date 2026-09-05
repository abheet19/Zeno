# 36 — Scope decision: Windows + phone sync, no Mac

**Decided 2026-09-04 by the owner. Binding on every subsequent slice and on the acceptance grading.**

Zeno's primary surface is **Windows 11**. **Phone-to-Windows sync IS in scope** (Zeno Mesh — pairing,
an end-to-end-encrypted envelope, and a causal replication log, built and proven on the Windows
side against a simulated second device). **macOS is out of scope** — a criterion whose only unmet
clause is a **Mac client** is graded **out-of-scope**; everything else is built.

Revised 2026-09-04 (second owner decision): the earlier "Windows-only, no sync" line is superseded —
the owner asked for phone↔Windows sync explicitly. Only the Mac is excluded.

## Why this is a real decision, not a retreat

- The owner has exactly one machine. Sync between a device and itself is not a feature; a
  reconnect test needs two endpoints that do not exist.
- The work Mac belonged to the former employer and is gone. macOS is not merely deprioritised — it
  is unreachable.
- The original 196 criteria describe five products across three platforms. Scoping to one platform
  does not weaken any criterion that Zeno actually touches; it removes clauses that were never
  buildable here from the denominator that blocks them.

## What this closes

Criteria of the form "works on Mac, phone and web" collapse to "works on Windows". Where the
Windows half is built and proven, the criterion can now close instead of hanging on an absent
platform. The acceptance report (`docs/34-ACCEPTANCE-STATUS.md`) is re-graded under this rule and
records, per row, whether a platform clause was the thing keeping it open.

## What this does NOT change

- No security property is relaxed. The seven laws, the tier model, the jail, the tamper-evident
  chain — all identical.
- Nothing that is genuinely unbuilt (voice, a local model runtime, meetings, a fine-tuning lab)
  becomes "met" by this decision. Out-of-scope is for platform clauses, not for missing products.
- The `WorkItem` port stays multi-source; GitHub over the network is not a "second device".
