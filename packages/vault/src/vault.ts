/**
 * The Vault: governed local memory over a directory of Markdown notes.
 *
 * Pure logic over an injected store and clock/id, mirroring the kernel's design
 * so it stays testable and replayable. Recall is deliberately simple and honest:
 * a keyword score over titles, tags and bodies, and every returned memory CITES
 * its source. There is no embedding model here, no cloud call, nothing that
 * needs a network or a GPU — the memory is legible, and so is the reason each
 * result came back.
 */
import { parseNote, serializeNote, type Note } from './note.js';

export interface NoteStore {
  /** Every note's raw text, keyed by id (its filename stem). */
  readAll(): ReadonlyMap<string, string>;
  /** Write (or overwrite) one note. */
  write(id: string, text: string): void;
  /** Remove one note. */
  remove(id: string): void;
}

export interface VaultClock {
  now(): string;
  id(): string;
}

export interface Recalled {
  readonly note: Note;
  readonly score: number;
  /** The exact terms that matched — so a result is never a black box. */
  readonly matched: readonly string[];
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'my', 'i', 'with', 'at', 'by',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export class Vault {
  private readonly notes = new Map<string, Note>();

  constructor(
    private readonly store: NoteStore,
    private readonly clock: VaultClock,
  ) {
    for (const [id, text] of store.readAll()) {
      const note = parseNote(text, id);
      if (note) this.notes.set(note.id, note);
    }
  }

  /** Record a fact. Returns the stored note. */
  remember(input: { title: string; body: string; source: string; tags?: readonly string[] }): Note {
    const now = this.clock.now();
    const note: Note = {
      id: this.clock.id(),
      title: input.title.trim() || '(untitled)',
      tags: [...new Set((input.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean))],
      createdAt: now,
      updatedAt: now,
      source: input.source.trim() || 'unknown',
      body: input.body.trim(),
    };
    this.notes.set(note.id, note);
    this.store.write(note.id, serializeNote(note));
    return note;
  }

  /** Forget a fact. A memory the owner deletes is genuinely gone — no tombstone. */
  forget(id: string): boolean {
    if (!this.notes.delete(id)) return false;
    this.store.remove(id);
    return true;
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  all(): readonly Note[] {
    return [...this.notes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  size(): number {
    return this.notes.size;
  }

  /**
   * Recall the notes most relevant to a query. Title and tag hits count for more
   * than body hits. Ties break toward the more recently updated note. Every
   * result carries the terms that matched, so recall can never be a black box.
   */
  recall(query: string, limit = 5): Recalled[] {
    const q = terms(query);
    if (q.length === 0) return [];
    const out: Recalled[] = [];
    for (const note of this.notes.values()) {
      const title = new Set(terms(note.title));
      const tagset = new Set(note.tags.flatMap(terms));
      const bodyset = new Set(terms(note.body));
      const matched: string[] = [];
      let score = 0;
      for (const t of q) {
        if (title.has(t)) {
          score += 5;
          matched.push(t);
        } else if (tagset.has(t)) {
          score += 3;
          matched.push(t);
        } else if (bodyset.has(t)) {
          score += 1;
          matched.push(t);
        }
      }
      if (score > 0) out.push({ note, score, matched: [...new Set(matched)] });
    }
    return out
      .sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt))
      .slice(0, limit);
  }
}
