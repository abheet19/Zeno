/**
 * Durability for proposals that are waiting for the owner.
 *
 * A proposal lives in memory between "an agent asked" and "the owner decided".
 * Without this, restarting the daemon throws all of those away — every capsule
 * the owner had not yet acted on simply vanishes, which is a quiet way to lose
 * work. The set is small and short-lived, so it is rewritten whole (temp ->
 * fsync -> rename) rather than appended to: a torn write costs at most the open
 * proposals, never the receipt chain, which has its own separate durability.
 *
 * Injected the same way the kernel injects its ledger store, so the server
 * stays testable with an in-memory double.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { ActionRequest, Preview, WritePayload } from '@abheet19/zeno-kernel';

/** One proposal, in the shape that survives a restart. */
export interface HeldRecord {
  readonly preview: Preview;
  readonly payload: WritePayload;
  readonly req: ActionRequest;
}

export interface HeldStore {
  /** Every held record, as JSONL. Empty string when none are waiting. */
  readAll(): string;
  /** Replace the whole set atomically, flushed before returning. */
  writeAll(text: string): void;
}

export function serializeHeld(records: Iterable<HeldRecord>): string {
  return [...records].map((r) => JSON.stringify(r)).join('\n');
}

/**
 * Parse held records. A line that cannot be read is DROPPED, not fatal: a
 * corrupt file of open proposals costs the owner a re-propose, whereas refusing
 * to start would strand them. (The ledger has the opposite rule — there a
 * missing line is missing evidence.)
 */
export function parseHeld(text: string): HeldRecord[] {
  const out: HeldRecord[] = [];
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const r = parsed as Partial<HeldRecord>;
    if (r.preview === undefined || r.payload === undefined || r.req === undefined) continue;
    if (typeof r.preview.actionHash !== 'string') continue;
    out.push(r as HeldRecord);
  }
  return out;
}

function writeBytes(fd: number, text: string): void {
  const buf = Buffer.from(text, 'utf8');
  let written = 0;
  while (written < buf.length) written += writeSync(fd, buf, written, buf.length - written);
}

export function nodeHeldStore(filePath: string): HeldStore {
  return {
    readAll(): string {
      try {
        return readFileSync(filePath, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
        throw new Error(`Cannot read pending proposals at ${filePath}: ${(err as Error).message}`);
      }
    },
    writeAll(text: string): void {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        const fd = openSync(tmp, 'wx');
        try {
          writeBytes(fd, text);
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
