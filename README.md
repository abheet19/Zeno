# Zeno

A private, single-user, local-first personal intelligence suite.

**Zeno** (assistant) · **Zeno Forge** (coding agent) · **Zeno Counsel** (meeting copilot)
**Zeno Command** (control plane) · **Zeno Vault** (memory) · **Zeno Mesh** (devices & sync) · **Zeno Glass** (design system)

Brand promise: *Reason before action.*

---

## Status — documentation only

**There is no product code in this repository, and there must not be yet.**
Gate 1 (architecture) and Gate 2 (design) are both unapproved. Every production slice
additionally requires its own approved LLD and plan before any code is written.

| Gate | State |
|---|---|
| Clarification Gate | ✅ passed |
| Phase 0A — research | ✅ complete |
| Brand sub-gate | ✅ passed — ZENO |
| Phase 0B — design | 🔵 6 of 9 documents complete |
| **Gate 1** — architecture/product | ⬜ not requested |
| **Gate 2** — design | ⬜ not started |
| Phase 1+ — implementation | ⬜ blocked on both gates |

## Where to start reading

1. `CLAUDE.md` — project rules, brand conditions, hard boundaries
2. `docs/08-BRAND-DECISION.md` — the name and the three conditions attached to it
3. `docs/02-conflict-and-disposition-register.md` — safety decisions taken on the owner's behalf
4. `docs/03-corrections-log.md` — 41 claims in the source specification that research overturned
5. `docs/18-roadmap-and-risk-register.md` — the plan and both gate checklists

## Standing rules

- Never `git commit` or `git push` — the owner reviews and lands everything
- No AI-attribution trailers in commit messages
- Never run builds
- Minimal, root-cause changes only
- Budget: $0 — anything paid is a costed proposal, never an assumption

## Deliberately absent

- **Product code** — gated behind Gates 1 and 2
- **Source design videos** — owner-supplied, rights unverified, gitignored
- **Employer-derived reports** (`03a`, `03b`) — QuillBot structural detail stays out of a personal repo
