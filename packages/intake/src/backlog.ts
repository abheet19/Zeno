/**
 * The LOCAL work-item source: a backlog you own, on your own disk, that no
 * employer can switch off.
 *
 * Pure logic over an injected store, exactly like the kernel's `LedgerStore` and
 * `PendingStore` — this file never touches a filesystem, so every behaviour below
 * is testable without one, and the node:fs adapter in `backlog-node-fs.ts` is the
 * only place that can fail for I/O reasons.
 *
 * THE FILE IS A LOG, NOT A TABLE. Each line is a complete snapshot of one item as
 * of one revision; the state of the backlog is the fold of those revisions, last
 * one per id winning. Closing an item APPENDS a closed revision. Nothing is ever
 * removed, including lines this parser cannot read — a backlog you can silently
 * rewrite is not a record, and the first time it matters will be the time someone
 * asks what you were actually working on.
 */
import type { WorkItem, WorkItemSource } from './work-item.js';

/**
 * Where backlog lines are durably kept. Injected, mirroring `PendingStore`.
 * The whole file is replaced on every write rather than appended to, because the
 * append here is logical (a revision) and a torn append would leave a half-line
 * in the middle of a record the fold depends on.
 */
export interface BacklogStore {
  /** The whole file as JSONL. Empty string when there is none yet. */
  readAll(): string;
  /** Replace the whole file. Implementations must be atomic and flush. */
  writeAll(text: string): void;
}

/** ISO-8601 wall clock, injected so the backlog itself stays deterministic. */
export type Clock = () => string;

export type BacklogState = 'open' | 'closed';

/** The adapter name a local item reports as its `WorkItem.source`. */
export const LOCAL_SOURCE = 'local';

/** One line of the backlog: a full snapshot of an item at one revision. */
export interface BacklogEntry {
  /** Always `local:${seq}`. Derived, never free text. */
  readonly id: string;
  /** Sequential and stable. Never reused, never renumbered by a close. */
  readonly seq: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: BacklogState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BacklogParse {
  /** Every readable revision, in file order. */
  readonly revisions: readonly BacklogEntry[];
  /** How many lines could not be read. Reported, never thrown. */
  readonly skipped: number;
  /**
   * The highest sequence number ANY line claims — including lines that could not
   * be read. This is what the next id must be derived from, never
   * `max(revisions)`. See `claimedSeq`.
   */
  readonly highestSeq: number;
}

/** The canonical id for a sequence number. */
export function localId(seq: number): string {
  return `${LOCAL_SOURCE}:${seq}`;
}

/**
 * The sequence number a line CLAIMS, even when the line is otherwise unreadable.
 *
 * A torn or hand-mangled line already costs its item; it must not ALSO cost the
 * id. `reload` derives the next sequence number from the highest one ever
 * written, and a damaged line's seq is still "ever written" — if it were
 * invisible here, the next `add` would REUSE that number and put two unrelated
 * items under one id, in a file that still holds a record for the first. That is
 * the one thing this log promises never to do.
 *
 * `JSON.stringify` writes `id` and `seq` first, so a line torn anywhere after
 * them still yields its number; both are read because a line may have been cut
 * or mangled across either one.
 *
 * Over-counting is the SAFE direction. A skipped id costs nothing at all; a
 * reused id silently grafts one item's history onto another.
 */
const SEQ_CLAIM = /"seq"\s*:\s*([0-9]{1,15})/;
const ID_CLAIM = /"id"\s*:\s*"local:([0-9]{1,15})"/;

function claimedSeq(line: string): number {
  let claimed = 0;
  for (const pattern of [SEQ_CLAIM, ID_CLAIM]) {
    const found = pattern.exec(line)?.[1];
    if (found === undefined) continue;
    const seq = Number(found);
    if (Number.isSafeInteger(seq) && seq > claimed) claimed = seq;
  }
  return claimed;
}

/**
 * Accept either the canonical id or the bare number a human types at a prompt.
 * Anything else is passed through untouched so `get` simply misses.
 */
export function normalizeId(id: string): string {
  const trimmed = id.trim();
  return /^[0-9]+$/.test(trimmed) ? localId(Number(trimmed)) : trimmed;
}

function cleanLabels(labels: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label.length > 0 && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Every field checked, because a hand-edited line is an expected input here. */
function asEntry(value: unknown): BacklogEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Partial<BacklogEntry>;
  if (typeof r.seq !== 'number' || !Number.isSafeInteger(r.seq) || r.seq < 1) return null;
  // The id is DERIVED from the sequence number. A line whose id disagrees with
  // its seq has been edited into a shape the fold cannot reason about, so it is
  // treated as damage rather than quietly trusted.
  if (r.id !== localId(r.seq)) return null;
  if (typeof r.title !== 'string' || typeof r.body !== 'string') return null;
  if (r.state !== 'open' && r.state !== 'closed') return null;
  if (typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string') return null;
  if (!Array.isArray(r.labels) || r.labels.some((l) => typeof l !== 'string')) return null;
  return {
    id: r.id,
    seq: r.seq,
    title: r.title,
    body: r.body,
    labels: cleanLabels(r.labels as readonly string[]),
    state: r.state,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Parse the file. A line that cannot be read is SKIPPED and counted, never
 * fatal — same rule as the kernel's pending set, and the opposite of the receipt
 * ledger. One unreadable backlog line costs you one item; refusing to start
 * costs you the whole day's work. The line itself stays in the file.
 *
 * Tolerates CRLF and a leading BOM: this is a Windows-first product and Notepad
 * writes both.
 */
export function parseBacklog(text: string): BacklogParse {
  const revisions: BacklogEntry[] = [];
  let skipped = 0;
  // Tracked across BOTH readable and damaged lines. See `claimedSeq`: an id that
  // only a corrupt line remembers is still an id that has been handed out.
  let highestSeq = 0;
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      highestSeq = Math.max(highestSeq, claimedSeq(line));
      continue;
    }
    const entry = asEntry(parsed);
    if (entry === null) {
      skipped++;
      highestSeq = Math.max(highestSeq, claimedSeq(line));
    } else {
      revisions.push(entry);
      highestSeq = Math.max(highestSeq, entry.seq);
    }
  }
  return { revisions, skipped, highestSeq };
}

/** Fold revisions into the current state: last revision per id wins, seq order. */
export function foldBacklog(revisions: readonly BacklogEntry[]): BacklogEntry[] {
  const byId = new Map<string, BacklogEntry>();
  for (const rev of revisions) byId.set(rev.id, rev);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Project a backlog entry onto the port. A local item has nowhere to link to. */
export function toWorkItem(entry: BacklogEntry): WorkItem {
  return {
    id: entry.id,
    source: LOCAL_SOURCE,
    title: entry.title,
    body: entry.body,
    url: null,
    updatedAt: entry.updatedAt,
    labels: entry.labels,
  };
}

/**
 * The backlog itself. Construct it and it loads; every mutation writes through
 * the store BEFORE it touches memory, so a failed write leaves this object
 * exactly as it was rather than holding an item that exists nowhere on disk.
 * That ordering is copied from `Ledger.append` for the same reason.
 */
export class Backlog {
  private text = '';
  private revisions: readonly BacklogEntry[] = [];
  private folded: readonly BacklogEntry[] = [];
  private damaged = 0;
  private nextSeq = 1;

  constructor(
    private readonly store: BacklogStore,
    private readonly now: Clock,
  ) {
    this.reload();
  }

  /** Re-read the file. A poll is a read: another process may have edited it. */
  reload(): void {
    const text = this.store.readAll();
    const { revisions, skipped, highestSeq } = parseBacklog(text);
    this.text = text;
    this.revisions = revisions;
    this.folded = foldBacklog(revisions);
    this.damaged = skipped;
    // Highest seq EVER written, not the highest still open — ids must never be
    // reused, or a closed item's history would silently graft onto a new one.
    //
    // It counts DAMAGED lines too. Deriving this from `revisions` alone would
    // hand the next `add` an id that a torn line in the very same file already
    // holds — the precise failure an interrupted write produces, and the one
    // this log exists to survive.
    this.nextSeq = highestSeq + 1;
  }

  /** Every item, open and closed, in id order. */
  list(): readonly BacklogEntry[] {
    return this.folded;
  }

  /** Only the items still asking for work. This is what the port publishes. */
  listOpen(): readonly BacklogEntry[] {
    return this.folded.filter((e) => e.state === 'open');
  }

  /** Accepts "local:7" or "7". Returns null rather than throwing on a miss. */
  get(id: string): BacklogEntry | null {
    const wanted = normalizeId(id);
    return this.folded.find((e) => e.id === wanted) ?? null;
  }

  /** How many lines in the file could not be read. A CLI should surface this. */
  skippedLines(): number {
    return this.damaged;
  }

  add(title: string, body = '', labels: readonly string[] = []): BacklogEntry {
    const clean = title.trim();
    // An untitled item cannot be shown in an approval capsule, so it cannot
    // become work. Refuse at the door rather than write a record that no
    // downstream surface can render.
    if (clean.length === 0) throw new Error('a backlog item needs a title');
    const at = this.now();
    const seq = this.nextSeq;
    return this.append({
      id: localId(seq),
      seq,
      title: clean,
      body,
      labels: cleanLabels(labels),
      state: 'open',
      createdAt: at,
      updatedAt: at,
    });
  }

  /** Mark an item done. Appends a closed revision; deletes nothing. */
  close(id: string): BacklogEntry {
    return this.transition(id, 'closed');
  }

  /** Put a closed item back. Appends an open revision; deletes nothing. */
  reopen(id: string): BacklogEntry {
    return this.transition(id, 'open');
  }

  private transition(id: string, state: BacklogState): BacklogEntry {
    const current = this.get(id);
    if (current === null) throw new Error(`no backlog item ${normalizeId(id)}`);
    // Already there. Writing a revision that changes nothing would bump
    // `updatedAt`, and `updatedAt` is what dedupe keys on — an idempotent call
    // would then wake every downstream poller for no reason.
    if (current.state === state) return current;
    return this.append({ ...current, state, updatedAt: this.now() });
  }

  /**
   * Append one revision. The prior bytes are carried through UNCHANGED — including
   * lines the parser skipped — so a write can never quietly drop a record it
   * merely failed to understand.
   */
  private append(revision: BacklogEntry): BacklogEntry {
    const base = this.text === '' || this.text.endsWith('\n') ? this.text : `${this.text}\n`;
    const next = `${base}${JSON.stringify(revision)}\n`;

    // DURABLE FIRST. If the store throws, every field below is untouched and
    // this backlog still describes exactly what is on disk.
    this.store.writeAll(next);

    this.text = next;
    this.revisions = [...this.revisions, revision];
    this.folded = foldBacklog(this.revisions);
    if (revision.seq >= this.nextSeq) this.nextSeq = revision.seq + 1;
    return revision;
  }
}

/**
 * The backlog as a `WorkItemSource`. Only OPEN items are published: a closed item
 * is a record, not a request. `list()` re-reads first, so editing the file by
 * hand in another window is a supported way to use this product.
 */
export function localSource(backlog: Backlog): WorkItemSource {
  return {
    name: LOCAL_SOURCE,
    // `async` is load-bearing, not decoration. `reload()` is a disk read and can
    // throw, and a port method declared to return a Promise that throws
    // SYNCHRONOUSLY escapes every `.catch()` and `Promise.allSettled` a
    // multi-source poller is built out of — one locked file would then take down
    // the whole fan-out instead of degrading to one failed source. The GitHub
    // adapter's `list` is already async, so this is also what keeps the two
    // implementations of one port failing the same way.
    async list(): Promise<readonly WorkItem[]> {
      backlog.reload();
      return backlog.listOpen().map(toWorkItem);
    },
  };
}
