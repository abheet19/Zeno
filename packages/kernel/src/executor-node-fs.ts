/**
 * The real filesystem adapter for the WorktreeExecutor. Isolated here so the core
 * executor logic (executor.ts) stays pure and fs-free. Uses node:fs; the atomic
 * write is temp-in-same-dir → fsync → rename, so a crash never leaves a partial.
 *
 * Not exercised by the unit/property tests (those inject an in-memory fs); it is
 * the production edge used on the pilot.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeSync,
  existsSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import type { SandboxFs } from './executor.js';

export function nodeSandboxFs(): SandboxFs {
  return {
    readFile(absPath: string): string | null {
      try {
        return readFileSync(absPath, 'utf8');
      } catch {
        return null; // absent
      }
    },
    writeAtomic(absPath: string, contents: string): void {
      const dir = dirname(absPath);
      mkdirSync(dir, { recursive: true });
      const tmp = absPath + '.' + randomBytes(6).toString('hex') + '.tmp';
      const fd = openSync(tmp, 'wx');
      try {
        writeSync(fd, contents, null, 'utf8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, absPath); // atomic replace on the same filesystem
    },
    realpath(absPath: string): string {
      // Resolve symlinks; for a non-existent path, resolve the deepest existing ancestor.
      let p = absPath;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (existsSync(p)) return realpathSync(p);
        const parent = dirname(p);
        if (parent === p) return p; // reached the root
        p = parent;
      }
    },
  };
}
