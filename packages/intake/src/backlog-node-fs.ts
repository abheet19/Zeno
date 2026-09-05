/**
 * The real filesystem store for the local backlog. Isolated here so `backlog.ts`
 * stays pure, mirroring the kernel's ledger / pending / executor splits.
 *
 * The whole file is replaced atomically — temp file, fsync, rename — because a
 * half-written backlog would lose items the owner has already been told are
 * saved. This is byte-for-byte the discipline of
 * `packages/kernel/src/pending-node-fs.ts`; the two must not drift.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { BacklogStore, Clock } from './backlog.js';

/** Write every byte. `writeSync` may write fewer than asked; a short write here
 *  would truncate the last record and still report success. */
function writeAll(fd: number, text: string): void {
  const buf = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buf.length) written += writeSync(fd, buf, written, buf.length - written);
}

/** The file name, decided once. Both helpers below agree because they share it. */
const BACKLOG_FILE = 'backlog.jsonl';

/**
 * Where the backlog lives inside a ZENO DIRECTORY — the thing `--dir` and
 * `ZENO_DIR` name, holding `ledger.jsonl` and `sandbox/`. The daemon and the CLI
 * have already resolved that directory by the time they need the backlog, and
 * adding a second `.zeno` segment would file the backlog somewhere the ledger it
 * belongs beside is not.
 */
export function backlogPathIn(zenoDir: string): string {
  return join(zenoDir, BACKLOG_FILE);
}

/** Where a backlog lives inside a Zeno root, alongside the receipt ledger. */
export function backlogPath(root: string): string {
  return backlogPathIn(join(root, '.zeno'));
}

/**
 * The wall clock, isolated in the impure file for the same reason the fs is:
 * `backlog.ts` must stay deterministic and replayable in tests.
 */
export const systemClock: Clock = () => new Date().toISOString();

export function nodeBacklogStore(filePath: string): BacklogStore {
  return {
    readAll(): string {
      try {
        return readFileSync(filePath, 'utf8');
      } catch (err) {
        // "No backlog yet" is a normal first run. Anything else — locked, denied,
        // a directory where a file should be — must be reported, never mistaken
        // for an empty backlog, or the next write would replace real items with
        // one line.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw new Error(`Cannot read the backlog at ${filePath}: ${(err as Error).message}`);
      }
    },
    writeAll(text: string): void {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        // 'wx' — fail rather than clobber, so two writers cannot share a temp.
        const fd = openSync(tmp, 'wx');
        try {
          writeAll(fd, text);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        // The rename is the commit point. Before it the old file is intact and
        // complete; after it the new one is. There is no moment in between where
        // a reader sees a partial backlog.
        renameSync(tmp, filePath);
      } catch (err) {
        try {
          unlinkSync(tmp);
        } catch {
          /* already gone */
        }
        throw err;
      }
    },
  };
}
