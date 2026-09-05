/**
 * The real filesystem store for the receipt ledger. Isolated here so `ledger.ts`
 * stays pure and fs-free, mirroring the executor / executor-node-fs split.
 *
 * Every append is flushed with fsync before returning. An audit log that reports
 * a write it has not actually committed is worse than no audit log at all.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { LedgerStore } from './ledger.js';

/** Write every byte. `writeSync` may write fewer than asked; a short write here
 *  would truncate a receipt line and still report success. */
function writeAll(fd: number, text: string): void {
  const buf = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buf.length) {
    written += writeSync(fd, buf, written, buf.length - written);
  }
}

/**
 * Read a file, distinguishing "does not exist yet" from "exists but I cannot
 * read it". For an AUDIT LOG that distinction is the whole point: a deleted or
 * locked ledger must never be mistaken for a fresh install and quietly
 * reported as a clean, empty chain.
 */
function readOrEmpty(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new Error(`Cannot read the ${what} at ${path}: ${(err as Error).message}`);
  }
}

/** True when the file's last byte is not a newline — i.e. a write was cut off. */
function endsMidLine(path: string): boolean {
  let fd: number | null = null;
  try {
    const { size } = statSync(path);
    if (size === 0) return false;
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false; // no file yet, or unreadable — append() will surface that
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Every file `nodeLedgerStore` owns for a given ledger path. Callers that reset
 * or archive a ledger must move the whole set: deleting the receipts but
 * leaving the head behind reads — correctly — as "receipts were removed".
 */
export function nodeLedgerFiles(filePath: string): readonly string[] {
  return [filePath, `${filePath}.head.json`];
}

export function nodeLedgerStore(filePath: string): LedgerStore {
  const headPath = `${filePath}.head.json`;
  return {
    append(line: string): void {
      mkdirSync(dirname(filePath), { recursive: true });
      // If a previous append was cut off mid-line, start a fresh line rather
      // than welding this receipt onto the fragment — that would destroy both.
      const prefix = endsMidLine(filePath) ? '\n' : '';
      // 'a' — every write goes to the end and the file is created if absent.
      const fd = openSync(filePath, 'a');
      try {
        writeAll(fd, prefix + line + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    readAll(): string {
      return readOrEmpty(filePath, 'ledger');
    },
    readHead(): string | null {
      const text = readOrEmpty(headPath, 'ledger head');
      return text === '' ? null : text;
    },
    writeHead(head: string): void {
      mkdirSync(dirname(headPath), { recursive: true });
      const fd = openSync(headPath, 'w');
      try {
        writeAll(fd, head);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
  };
}
