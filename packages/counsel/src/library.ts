/**
 * The meeting archive: past calls, and honest keyword retrieval over them.
 *
 * Pure logic over an injected store, mirroring `packages/vault/src/vault.ts` so
 * the two memories of Zeno behave the same way and are tested the same way.
 * Retrieval is a keyword score — no embedding model, no cloud call, no GPU — and
 * every hit carries the exact terms that matched, so a result is never a black
 * box the owner has to take on faith.
 *
 * The one thing this does that the Vault does not: it keeps a `failed` list. A
 * meeting file that will not parse is NEVER silently dropped. "You have no
 * meetings" and "one of your meetings is unreadable" are different facts about
 * the owner's own life, and conflating them would be the archive lying by
 * omission — the same sin as an uncited summary item.
 */
import { parseMeeting, serializeMeeting, type Meeting } from './meeting.js';
import type { Utterance } from './transcript.js';

export interface MeetingStore {
  /** The ids of every stored meeting. A missing archive is an empty list, not an error. */
  list(): string[];
  /** The raw text of one meeting. May throw; the caller records that as a failure. */
  read(id: string): string;
  /** Write (or overwrite) one meeting. */
  write(id: string, text: string): void;
  /**
   * Remove one meeting, answering whether a file actually LEFT THE DISK.
   *
   * The boolean is the whole point. A store that quietly does nothing — because
   * the name was one it would not touch, or the file was already gone — must say
   * `false`, so the archive above it can never report a deletion that did not
   * happen. May throw when the disk refuses; a refusal is a fact, not a `false`.
   */
  remove(id: string): boolean;
}

/** A file in the archive that could not be read or understood, and why. */
export interface Failure {
  readonly id: string;
  readonly reason: string;
}

export interface Hit {
  readonly meeting: Meeting;
  readonly score: number;
  /** The exact query terms that matched — so a hit is never a black box. */
  readonly matched: readonly string[];
  /**
   * The transcript lines that actually matched, in transcript order. These carry
   * the line ids an answer must cite, which is why retrieval returns lines and
   * not just meetings.
   */
  readonly lines: readonly Utterance[];
}

/** Words too common to say anything about which meeting the owner means. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'it', 'my', 'i', 'with', 'at', 'by',
  'what', 'did', 'do', 'was', 'were', 'we', 'that', 'this', 'about', 'from', 'have', 'has', 'had',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Every word of a summary, flattened — decisions, actions, questions, key points. */
function summaryText(m: Meeting): string {
  const s = m.summary;
  return [
    ...s.decisions.map((d) => d.text),
    ...s.actions.map((a) => `${a.text} ${a.owner ?? ''} ${a.due ?? ''}`),
    ...s.questions.map((q) => q.text),
    ...s.keyPoints.map((k) => k.text),
  ].join(' ');
}

/** How many transcript lines one hit may carry. A whole call is not an excerpt. */
const MAX_LINES_PER_HIT = 12;

export class Meetings {
  private readonly meetings = new Map<string, Meeting>();
  private readonly broken: Failure[] = [];
  private readonly archiveError: string | null = null;
  /**
   * Which FILE each meeting came out of, keyed by the id the archive knows it by.
   *
   * These are two different names and conflating them lost recordings. A meeting
   * file is `<stem>.md`, but the id the archive uses is the one in the file's own
   * frontmatter — and a file the owner renamed in Explorer, or edited in Notepad
   * (both of which this format exists to allow), has a stem that is not that id.
   * Deleting by id then aimed `store.remove` at a filename that did not exist,
   * which quietly removed nothing while the archive reported success.
   */
  private readonly stems = new Map<string, string>();

  constructor(private readonly store: MeetingStore) {
    let ids: string[];
    try {
      ids = store.list();
    } catch (err) {
      // A store that cannot even be listed must not crash startup — the daemon
      // still boots and the owner still has every other tab. But it is NOT an
      // empty archive, and reporting it as one is the exact lie this class
      // exists to prevent: an unreadable meetings folder would look identical to
      // never having recorded a call. The reason is kept and surfaced.
      this.archiveError = err instanceof Error ? err.message : 'unknown error';
      ids = [];
    }
    for (const id of ids) {
      let raw: string;
      try {
        raw = store.read(id);
      } catch (err) {
        this.broken.push({ id, reason: `Could not be read: ${err instanceof Error ? err.message : 'unknown error'}` });
        continue;
      }
      const parsed = parseMeeting(raw, id);
      if (parsed.ok) {
        this.meetings.set(parsed.meeting.id, parsed.meeting);
        // Remember the file it actually came from, which is not always its id.
        this.stems.set(parsed.meeting.id, id);
      } else this.broken.push({ id, reason: parsed.reason });
    }
  }

  /** Persist a finished call. Writes through to the store before it is in memory. */
  save(meeting: Meeting): Meeting {
    this.store.write(meeting.id, serializeMeeting(meeting));
    this.meetings.set(meeting.id, meeting);
    this.stems.set(meeting.id, meeting.id);
    return meeting;
  }

  /** Every meeting, newest first. */
  all(): readonly Meeting[] {
    return [...this.meetings.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): Meeting | undefined {
    return this.meetings.get(id);
  }

  /**
   * Delete a recording. This really deletes — no tombstone, no archive folder,
   * nothing left behind for a later feature to resurrect.
   *
   * `true` means a file LEFT THE DISK, and it is never returned for any other
   * reason. Forgetting a meeting in memory is not deleting it: the archive used
   * to drop the entry and answer `true` even when the store had removed nothing,
   * so a recording the owner had been told was destroyed came back on the next
   * restart — and was sitting in the folder, readable, the whole time. Two
   * things caused that, and both are closed here: the file is addressed by the
   * STEM it was loaded from rather than by its frontmatter id, and the store's
   * own answer decides what this returns.
   */
  remove(id: string): boolean {
    const known = this.meetings.has(id);
    // It may instead be a file that failed to parse — the owner can see it in
    // `failed()`, so they must be able to delete it too.
    const i = known ? -1 : this.broken.findIndex((f) => f.id === id);
    if (!known && i < 0) return false;
    // The DISK first, exactly as `save` writes through before it changes memory.
    // The other order dropped the meeting from the archive and then discovered
    // the disk had refused: the owner was shown a shelf with the recording gone
    // while the file was still sitting there, until a restart brought it back.
    // Now a refusal throws with the archive still describing what is real.
    const stem = this.stems.get(id) ?? id;
    if (!this.store.remove(stem) && this.stillOnDisk(stem)) {
      // The store removed nothing AND the file is still listed: it refused the
      // name. Saying `true` here is the exact lie this method exists to prevent.
      // (A `false` with the file already GONE is the owner having deleted it in
      // Explorer first — the recording is off the disk, which is what they asked
      // for, so that one falls through and the archive forgets it.)
      return false;
    }
    if (known) {
      this.meetings.delete(id);
      this.stems.delete(id);
    } else this.broken.splice(i, 1);
    return true;
  }

  /** Whether the store still lists that file. An unlistable store is treated as "yes". */
  private stillOnDisk(stem: string): boolean {
    try {
      return this.store.list().includes(stem);
    } catch {
      // We cannot see the folder, so we cannot claim anything left it.
      return true;
    }
  }

  size(): number {
    return this.meetings.size;
  }

  /** The files in the archive that could not be read or understood. Never empty by accident. */
  failed(): readonly Failure[] {
    return [...this.broken];
  }

  /**
   * Why the archive itself could not be listed, or null when it could.
   *
   * This is a different fact from `failed()`, which is about individual files
   * INSIDE a folder that was read. This one says the folder was never read at
   * all, so `all()` being empty means nothing — there may be a hundred meetings
   * behind that error. A caller that renders `size() === 0` as "no meetings yet"
   * without checking this is telling the owner their calls never happened.
   */
  unreadable(): string | null {
    return this.archiveError;
  }

  /**
   * Retrieve the meetings most relevant to a query. A title hit counts for more
   * than a summary hit, which counts for more than a passing mention in the
   * transcript — because that is the order in which they are likely to be what
   * the owner meant. Ties break toward the more recent meeting.
   */
  recall(query: string, limit = 5): Hit[] {
    const q = [...new Set(terms(query))];
    if (q.length === 0) return [];
    const out: Hit[] = [];

    for (const meeting of this.meetings.values()) {
      const title = new Set(terms(meeting.title));
      const people = new Set(meeting.participants.flatMap(terms));
      const summary = new Set(terms(summaryText(meeting)));
      const body = new Set(terms(meeting.utterances.map((u) => u.text).join(' ')));

      const matched: string[] = [];
      let score = 0;
      for (const t of q) {
        if (title.has(t)) {
          score += 5;
          matched.push(t);
        } else if (people.has(t)) {
          score += 4;
          matched.push(t);
        } else if (summary.has(t)) {
          score += 3;
          matched.push(t);
        } else if (body.has(t)) {
          score += 1;
          matched.push(t);
        }
      }
      if (score === 0) continue;

      const hitTerms = new Set(matched);
      const lines = meeting.utterances
        .filter((u) => terms(u.text).some((t) => hitTerms.has(t)))
        .slice(0, MAX_LINES_PER_HIT);

      out.push({ meeting, score, matched: [...hitTerms], lines });
    }

    return out
      .sort((a, b) => b.score - a.score || b.meeting.startedAt.localeCompare(a.meeting.startedAt))
      .slice(0, limit);
  }
}
