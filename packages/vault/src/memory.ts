/**
 * What the last session established, so this one does not have to be told again.
 *
 * Every Zeno run starts amnesiac. That is honest, and it is also exhausting: the
 * owner re-explains the same conventions, the same decisions and the same dead ends
 * to every agent, forever. Claude Code's answer is CLAUDE.md plus a memory directory.
 * This is Zeno's, and it is built ON the Vault rather than beside it — one store, one
 * on-disk format, one place to delete things from.
 *
 * A memory entry IS a Vault note. Not a note-like thing in a second database: the
 * same Markdown file with the same frontmatter, discoverable by the same `all()`,
 * openable in Notepad with every Zeno process stopped. Two tags do all the work —
 * `memory` marks it, `kind:<kind>` types it — which means memory inherits the Vault's
 * anti-lock-in promise for free and adds no new file format to reverse-engineer later.
 *
 * WHAT A MEMORY IS ALLOWED TO BE
 * ------------------------------
 * A `description` short enough to list, a `body` long enough to be useful, a `kind`,
 * and a `source` naming who wrote it. The source is not decoration. A fact the owner
 * stated and a fact an agent inferred are different kinds of true, and every prompt
 * this memory reaches says which one it is looking at (see `renderMemoryContext`).
 * Memory an agent wrote carries no authority over the agent that reads it later — an
 * agent that could write itself durable instructions would have found a way to grant
 * itself permissions across sessions, which is precisely what the kernel exists to
 * prevent. Writing memory is governed; see `memory-gate.ts` for that half.
 *
 * RETRIEVAL
 * ---------
 * `recall` is the Vault's own keyword scorer, filtered to memory notes. It was
 * tempting to reuse the skills package's IDF ranker instead — it is better at
 * separating a distinctive word from a common one — but it ranks a NAME and a
 * DESCRIPTION, which is the right surface for a skill and the wrong one for a memory
 * whose substance is its body. Reaching across a package boundary to import a ranker
 * that then needed a third scoring mode would be forcing a fit. The Vault's scorer
 * already weights title over tags over body and reports the terms that matched, which
 * is what makes a recalled memory auditable.
 */
import type { Note } from './note.js';
import type { Recalled, Vault } from './vault.js';

/** The tag that makes a Vault note a memory entry. */
export const MEMORY_TAG = 'memory';

/**
 * What kind of thing this is. A small, closed list, because an open one becomes a
 * free-text field nobody can filter on:
 *
 *   fact        — something true about the world or the project ("the daemon listens on 7777")
 *   decision    — a choice that was made, and should not be silently re-made
 *   preference  — how the owner wants things done
 *   convention  — a rule this codebase follows
 *   question    — something open, recorded so it is not forgotten or invented over
 */
export const MEMORY_KINDS = ['fact', 'decision', 'preference', 'convention', 'question'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryEntry {
  readonly id: string;
  readonly kind: MemoryKind;
  /** One line, listable. This is what retrieval and the owner's list both show. */
  readonly description: string;
  readonly body: string;
  /** Who established it: `owner`, or `agent:<id>`. Never blank, never guessed. */
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Everything else the note carried — freeform, the owner's to use. */
  readonly tags: readonly string[];
}

export interface MemoryInput {
  readonly kind: MemoryKind;
  readonly description: string;
  readonly body: string;
  readonly source: string;
  readonly tags?: readonly string[];
}

export interface RecalledMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly matched: readonly string[];
}

const KIND_PREFIX = 'kind:';

function isKind(value: string): value is MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value);
}

/**
 * A note read back as a memory entry, or null when it is an ordinary note.
 *
 * A note tagged `memory` whose `kind:` tag is missing or unrecognised is still a
 * memory — it is filed as a `fact`, which is the weakest of the kinds. Refusing to
 * read it would make a hand-edited file disappear from the owner's own list, and a
 * memory the owner cannot see is the exact thing this module must never produce.
 */
export function toEntry(note: Note): MemoryEntry | null {
  if (!note.tags.includes(MEMORY_TAG)) return null;
  const declared = note.tags.find((t) => t.startsWith(KIND_PREFIX))?.slice(KIND_PREFIX.length) ?? '';
  return {
    id: note.id,
    kind: isKind(declared) ? declared : 'fact',
    description: note.title,
    body: note.body,
    source: note.source,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: note.tags.filter((t) => t !== MEMORY_TAG && !t.startsWith(KIND_PREFIX)),
  };
}

/**
 * Durable, owner-visible memory over a Vault.
 *
 * Deliberately thin. It owns the tag convention and the entry shape; the Vault owns
 * storage, ids, the clock and recall. Anything this class could do by reaching around
 * the Vault, it does not do.
 */
export class Memory {
  constructor(private readonly vault: Vault) {}

  /**
   * Write one entry. THIS IS THE RAW WRITE and it does not ask anyone's permission —
   * which is safe only because of who is allowed to call it. The owner's own route
   * calls it directly (the owner needs no gate to write in their own notebook). An
   * AGENT reaches it only as the executor of an approved capsule; see
   * `memory-gate.ts`, which is where the reasoning for that lives.
   */
  record(input: MemoryInput): MemoryEntry {
    const kind: MemoryKind = isKind(input.kind) ? input.kind : 'fact';
    const note = this.vault.remember({
      title: input.description,
      body: input.body,
      source: input.source,
      tags: [MEMORY_TAG, `${KIND_PREFIX}${kind}`, ...(input.tags ?? [])],
    });
    const entry = toEntry(note);
    // `remember` writes exactly the tags it was given, so this cannot be null. If it
    // ever is, something changed underneath and the caller must hear about it rather
    // than receive a plausible-looking entry.
    if (entry === null) throw new Error('Vault stored a memory note without its memory tag.');
    return entry;
  }

  /** Every memory entry, newest first. Ordinary Vault notes are not memory. */
  list(kind?: MemoryKind): readonly MemoryEntry[] {
    const all = this.vault.all().map(toEntry).filter((e): e is MemoryEntry => e !== null);
    return kind === undefined ? all : all.filter((e) => e.kind === kind);
  }

  get(id: string): MemoryEntry | undefined {
    const note = this.vault.get(id);
    if (note === undefined) return undefined;
    return toEntry(note) ?? undefined;
  }

  /**
   * Delete one entry. Genuinely gone — the Vault leaves no tombstone, and neither
   * does this. An owner who cannot delete a memory does not have memory, they have
   * a dossier.
   */
  forget(id: string): boolean {
    if (this.get(id) === undefined) return false; // never delete a non-memory note by id
    return this.vault.forget(id);
  }

  size(): number {
    return this.list().length;
  }

  /**
   * The memories most relevant to a task, with the terms that matched. Over-fetches
   * from the Vault and then filters, because `recall` ranks notes and only some of
   * them are memory — asking for five and receiving two is honest, and asking for
   * fifty to keep five would spend the whole budget on ranking noise.
   */
  recall(task: string, limit = 5): readonly RecalledMemory[] {
    const hits: Recalled[] = this.vault.recall(task, Math.max(limit * 4, limit));
    const out: RecalledMemory[] = [];
    for (const hit of hits) {
      const entry = toEntry(hit.note);
      if (entry === null) continue;
      out.push({ entry, score: hit.score, matched: hit.matched });
      if (out.length >= limit) break;
    }
    return out;
  }
}

/**
 * Memory, rendered for a model — as RECORDED NOTES, never as instructions.
 *
 * The framing matters more than the formatting. These lines will sit in the same
 * prompt as the owner's task, and some of them were written by an agent in an earlier
 * session. If an agent's own note could read as an instruction to its successor, then
 * "remember to always approve deployments" becomes a durable, self-issued permission
 * — an agent granting itself scope across time. So every entry shows its source, the
 * frame says out loud that a note is a record rather than an order, and the owner's
 * task goes last, exactly as `buildSkillPrompt` does for third-party prose.
 */
export function renderMemoryContext(entries: readonly MemoryEntry[]): string {
  if (entries.length === 0) return 'No memory entries are relevant to this task.';
  return entries
    .map((e) => `- [${e.kind}] ${e.description}\n  recorded by ${e.source} at ${e.createdAt}\n  ${e.body.replace(/\n/g, '\n  ')}`)
    .join('\n');
}
