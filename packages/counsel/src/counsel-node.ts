/**
 * The real filesystem for the meeting archive: one `.md` file per call in a
 * directory. Isolated here so `library.ts` stays pure, exactly as
 * `packages/vault/src/vault-node-fs.ts` isolates the Vault's.
 *
 * Three deliberate behaviours:
 *   - A MISSING directory is an empty archive, not a throw: the owner who has
 *     never recorded a call gets a daemon that starts. An UNREADABLE one is a
 *     different sentence and throws — the owner whose meetings live on a drive
 *     that is not mounted must not be told their calls never happened.
 *   - Writes are atomic (temp -> rename), so a crash mid-write never leaves half
 *     a meeting on disk. A half-written transcript is worse than none: it would
 *     parse into a summary that quietly lost the second half of the call. And a
 *     write that FAILS takes its temp file with it — see `write`.
 *   - `remove` reports whether a file actually left the disk. It must never say
 *     "deleted" about a recording that is still there; the whole archive's
 *     delete story is built on this boolean being the truth.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { MeetingStore } from './library.js';

/**
 * The stem Zeno is willing to CREATE. Zeno picks its own meeting ids, so the
 * name it writes can be held to the narrowest shape that is safe on every
 * filesystem — no dots, no separators, no room to argue about it.
 */
function safeWriteStem(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

/**
 * The path of a file Zeno may READ or DELETE, or null when the id is not one.
 *
 * This is deliberately wider than `safeWriteStem`, because these two verbs act
 * on files the OWNER may have put here. The archive is Markdown on purpose —
 * "open it in Notepad, delete it with the Recycle Bin" — so a call the owner
 * renamed to `Q3 planning.md`, or dropped in from a backup, has to be readable
 * and, above all, DELETABLE. A charset whitelist made those files permanently
 * unreadable AND permanently undeletable through Zeno, which is a worse privacy
 * outcome than the traversal it was guarding against.
 *
 * So the jail is proved by PATH rather than by charset: no separator, drive
 * letter, wildcard or control character may appear, `.`/`..` are refused
 * outright, and the resolved path must still sit directly inside the archive
 * directory. `../../etc/passwd`, `..\\..\\evil`, `C:\\Windows\\evil` and
 * `%2e%2e%2f`-decoded ids all fail the first gate; anything that somehow got
 * past it fails the second.
 */
function readablePath(dir: string, id: string): string | null {
  if (id === '' || id.length > 200) return null;
  if (id === '.' || id === '..') return null;
  // eslint-disable-next-line no-control-regex
  if (/[/\\:*?"<>|\u0000-\u001f]/.test(id)) return null;
  const root = resolve(dir);
  const path = resolve(join(root, `${id}.md`));
  // The resolved file must be a DIRECT child of the archive: same directory, and
  // nothing but the filename below it.
  return path.startsWith(root + sep) && !path.slice(root.length + 1).includes(sep) ? path : null;
}

/** The half-written temp files left beside one meeting, if a write ever died mid-flight. */
function tempSiblings(dir: string, id: string): string[] {
  const prefix = `${id}.md.`;
  try {
    return readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && n.endsWith('.tmp'))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

export function nodeMeetingStore(dir: string): MeetingStore {
  return {
    list(): string[] {
      try {
        return readdirSync(dir)
          .filter((n) => n.endsWith('.md'))
          .map((n) => n.slice(0, -3));
      } catch (err) {
        // ENOENT is the ONE benign case: no directory yet, so the owner simply
        // has not recorded a call. Every other errno means the archive is there
        // as far as anyone knows and we could not read it — a permission wall, a
        // drive that is not mounted, a FILE sitting where the folder should be.
        // Swallowing those made "you have no meetings" and "I could not read
        // your meetings" the same eight bytes on the wire, which is the archive
        // lying about the owner's own life. It throws now; `Meetings` catches it
        // and reports it as a fact through `unreadable()`.
        if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return [];
        throw err;
      }
    },
    read(id: string): string {
      const path = readablePath(dir, id);
      if (path === null) throw new Error(`Unsafe meeting id: ${JSON.stringify(id)}`);
      return readFileSync(path, 'utf8');
    },
    write(id: string, text: string): void {
      const stem = safeWriteStem(id);
      if (stem === '') throw new Error(`Unsafe meeting id: ${JSON.stringify(id)}`);
      // Created on first write, not at construction: constructing a store must
      // never have a side-effect on the owner's disk.
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${stem}.md`);
      const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
      const fd = openSync(tmp, 'wx');
      try {
        const buf = Buffer.from(text, 'utf8');
        let w = 0;
        while (w < buf.length) w += writeSync(fd, buf, w, buf.length - w);
        fsyncSync(fd);
        closeSync(fd);
        renameSync(tmp, path);
      } catch (err) {
        // The temp file holds the WHOLE transcript. `list()` cannot see it (it is
        // not a `.md`), the dashboard cannot show it and `remove` was never asked
        // about it — so a failed write used to leave a complete, unredactable,
        // undeletable copy of a private call on disk forever. It goes with the
        // failure that created it.
        try {
          closeSync(fd);
        } catch {
          /* already closed on the success path */
        }
        try {
          unlinkSync(tmp);
        } catch {
          /* nothing to clean up */
        }
        throw err;
      }
    },
    remove(id: string): boolean {
      const path = readablePath(dir, id);
      if (path === null) return false;
      let removed = false;
      try {
        unlinkSync(path);
        removed = true;
      } catch (err) {
        // Absent is the caller's answer (`false`), not an error. Anything else —
        // a permission refusal, a directory in the way — is a real failure and
        // must be thrown, never swallowed into a cheerful "deleted".
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      // A crashed write may have left a temp copy of this very meeting beside it.
      // Deleting a recording means deleting every copy of it Zeno made.
      for (const tmp of tempSiblings(dir, id)) {
        try {
          unlinkSync(tmp);
          removed = true;
        } catch {
          /* best effort — the real file is what the answer is about */
        }
      }
      return removed;
    },
  };
}
