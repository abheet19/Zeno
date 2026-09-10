# ZENO.md — standing context for this project

This file is Zeno's project context convention: the `CLAUDE.md` / `AGENTS.md`
equivalent, read automatically into an agent run alongside the memory entries relevant
to the task. It is plain Markdown at the repository root, it is meant to be edited by
hand, and it is the one file you can point at to answer "what was in the context?".

**How it is read.** `readProjectContext(root)` loads `<root>/ZENO.md` and nothing else
— no upward search through parent directories, no absorbing `CLAUDE.md` or `AGENTS.md`.
Those belong to other tools, were written with a different consent model in mind, and
silently folding them in would make the context unreviewable. The file is capped at
16,000 characters into a prompt; past that a run is told out loud that it is reading a
part. `buildRunContext` puts this file first, memory second, and the owner's task last.

**What it can and cannot do.** It adds to what an agent KNOWS. It cannot add to what an
agent may DO. An agent's edits remain in a disposable worktree until they become project
proposals. Project effects are classified and receipted; bounded T0 direct proposals may
auto-apply, while Forge model output and higher-risk effects are held for owner review.
An agent may propose but never approve. A sentence in here that reads like a permission
is not one.

**One honest edge.** Zeno treats this file as the owner's standing instruction, because
on the owner's own machine it is. A repository cloned from elsewhere brings a
stranger's `ZENO.md` with it, and nothing in the bytes distinguishes the two. What
stops that from mattering is the paragraph above, not this one.

---

## What this project is

Zeno — a private, single-user, local-first personal intelligence suite. Windows-first.
The product thesis is in `README.md`: the boundary between what an agent PROPOSES and
what HAPPENS is structural, enforced by a kernel, not by an agent's good behaviour.

## Conventions an agent should assume

- **Zero external npm runtime dependencies.** CI scans every `packages/*/package.json` for
  a `dependencies` entry that is not `@abheet19/*` and fails. There is no exception.
- **Pure logic, injected IO.** Deciding is separate from doing: the pure module takes a
  reader/store/clock, and one clearly-named `*-node.ts` file is the only thing that
  touches a filesystem. This is what keeps the whole suite testable and replayable.
- **Nothing disappears.** A file that will not parse, a source that cannot be reached,
  a result that was truncated — each is reported as itself. An empty answer and a
  broken one are different facts, and code that reports them identically is a bug.
- **Comments explain WHY, and admit what is missing.** No invented data. Failure
  messages name the one action that resolves them.
- **Every commit is one idea**, with its reasoning in the message.

## Memory

Durable memory lives in the Vault as ordinary Markdown notes tagged `memory`, so it
opens in any text editor with every Zeno process stopped. An agent WRITING a memory is
an effect (`memory.write`, T1): previewed, approved by the owner, receipted. Reading is
not an effect and is not gated. The owner can list, inspect and delete anything stored —
`GET /memory`, `DELETE /memory/<id>`. The reasoning for that tier is written down in
`packages/vault/src/memory-gate.ts`.

## Skills

An agent skill is knowledge, never capability. Skills are `SKILL.md` folders fed to a
model as quoted DATA with the owner's task last. Selection is by name and description
(`selectSkills`), and a skill the screener flagged is never folded into a prompt without
the owner seeing the finding first.
