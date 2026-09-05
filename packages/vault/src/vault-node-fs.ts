/**
 * The real filesystem for the Vault: one `.md` file per note in a directory.
 * Isolated here so `vault.ts` stays pure. Atomic writes (temp -> rename) so a
 * crash never leaves a half-written memory.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { NoteStore, VaultClock } from './vault.js';

/** A note id is also a filename, so it must be a safe, plain stem. */
function safeId(id: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

export function nodeNoteStore(dir: string): NoteStore {
  mkdirSync(dir, { recursive: true });
  return {
    readAll(): ReadonlyMap<string, string> {
      const out = new Map<string, string>();
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return out;
      }
      for (const name of names) {
        if (!name.endsWith('.md')) continue;
        const id = name.slice(0, -3);
        try {
          out.set(id, readFileSync(join(dir, name), 'utf8'));
        } catch {
          /* skip an unreadable note rather than fail the whole recall */
        }
      }
      return out;
    },
    write(id: string, text: string): void {
      const stem = safeId(id);
      if (stem === '') throw new Error(`Unsafe note id: ${JSON.stringify(id)}`);
      const path = join(dir, `${stem}.md`);
      const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
      const fd = openSync(tmp, 'wx');
      try {
        const buf = Buffer.from(text, 'utf8');
        let w = 0;
        while (w < buf.length) w += writeSync(fd, buf, w, buf.length - w);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path);
    },
    remove(id: string): void {
      const stem = safeId(id);
      if (stem === '') return;
      rmSync(join(dir, `${stem}.md`), { force: true });
    },
  };
}

/** The real clock and id source for a running Vault. */
export function nodeClock(): VaultClock {
  return { now: () => new Date().toISOString(), id: () => randomUUID() };
}
