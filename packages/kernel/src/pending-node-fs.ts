/**
 * The real filesystem store for open approvals. Isolated here so `pending.ts`
 * stays pure, mirroring the ledger and executor splits.
 *
 * The whole set is replaced atomically — temp file, fsync, rename — because a
 * half-written pending file would strand the owner mid-approval.
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
import { dirname } from 'node:path';
import type { PendingStore } from './pending.js';

function writeAll(fd: number, text: string): void {
  const buf = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buf.length) written += writeSync(fd, buf, written, buf.length - written);
}

export function nodePendingStore(filePath: string): PendingStore {
  return {
    readAll(): string {
      try {
        return readFileSync(filePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw new Error(`Cannot read pending approvals at ${filePath}: ${(err as Error).message}`);
      }
    },
    writeAll(text: string): void {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        const fd = openSync(tmp, 'wx');
        try {
          writeAll(fd, text);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
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
