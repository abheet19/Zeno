/**
 * The only file in this package that knows a filesystem exists.
 *
 * Everything else takes a `SkillReader`, which is what keeps parsing, screening and
 * discovery pure and testable without writing a hostile skill to disk. This adapter
 * is the seam, and it is kept deliberately dull: list the folders, read one file.
 *
 * Two things here are not dull, and both are about not lying to the caller.
 *
 * A MISSING DIRECTORY IS NOT AN ERROR. `.agents/skills` simply does not exist until
 * the owner installs their first skill, and "you have no skills" is the truthful
 * answer to that, not a crash. A directory that exists and cannot be read is a
 * different fact and is allowed to throw.
 *
 * AN ID IS A PATH SEGMENT, NEVER A PATH. `read('../../.ssh')` would otherwise walk
 * out of the library and hand arbitrary file contents to a parser whose output is
 * headed for a model prompt. Ids that are not plain segments are refused here, which
 * `loadLibrary` records as that skill failing rather than as a silent read.
 */
import { closeSync, existsSync, fstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SkillReader } from './library.js';

/** The file every skill is required to have; the folder name around it is its id. */
export const SKILL_FILE = 'SKILL.md';
/** A skill is reference prose, so no single source file may allocate without bound. */
export const MAX_SKILL_SOURCE_BYTES = 128_000;
/** Directory scans are bounded before sorting so a hostile folder cannot exhaust memory. */
export const MAX_SKILL_DIRECTORY_ENTRIES = 2_048;
/** The product currently renders a small library; larger installs require curation. */
export const MAX_SKILL_LIBRARY_ENTRIES = 256;

/** One path segment: no separators, no drive letters, no `.` or `..`. */
function isSafeId(id: string): boolean {
  return id !== '' && id !== '.' && id !== '..' && !/[\\/:]/.test(id);
}

function missing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

function boundedUtf8(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('SKILL.md is not a regular file');
    if (stat.size > MAX_SKILL_SOURCE_BYTES) {
      throw new Error(`SKILL.md is ${stat.size} bytes; the limit is ${MAX_SKILL_SOURCE_BYTES}`);
    }
    const buffer = Buffer.alloc(Math.min(MAX_SKILL_SOURCE_BYTES + 1, Math.max(1, stat.size + 1)));
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (count === 0) break;
      used += count;
    }
    if (used > MAX_SKILL_SOURCE_BYTES || used > stat.size) {
      throw new Error(`SKILL.md grew beyond the ${MAX_SKILL_SOURCE_BYTES}-byte limit while it was read`);
    }
    return buffer.subarray(0, used).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * A reader over `<dir>/<id>/SKILL.md`. Directories without a SKILL.md are not listed
 * at all — an unrelated folder that wandered into the library is not a broken skill,
 * and putting it in `failed` would be noise where the owner needs signal.
 */
export function nodeSkillReader(dir: string): SkillReader {
  return {
    list(): string[] {
      const entries: string[] = [];
      let handle: ReturnType<typeof opendirSync> | undefined;
      try {
        handle = opendirSync(dir);
        let scanned = 0;
        for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
          scanned++;
          if (scanned > MAX_SKILL_DIRECTORY_ENTRIES) {
            throw new Error(`skill directory has more than ${MAX_SKILL_DIRECTORY_ENTRIES} entries`);
          }
          if (!entry.isDirectory() || !isSafeId(entry.name) || !existsSync(join(dir, entry.name, SKILL_FILE))) continue;
          entries.push(entry.name);
          if (entries.length > MAX_SKILL_LIBRARY_ENTRIES) {
            throw new Error(`skill library has more than ${MAX_SKILL_LIBRARY_ENTRIES} skills`);
          }
        }
      } catch (err) {
        if (missing(err)) return [];
        throw err;
      } finally {
        try { handle?.closeSync(); } catch { /* the original read error remains authoritative */ }
      }
      return entries.sort();
    },
    read(id: string): string {
      if (!isSafeId(id)) throw new Error(`unsafe skill id ${JSON.stringify(id)}: an id must be one folder name`);
      const root = realpathSync(dir);
      const target = realpathSync(join(dir, id, SKILL_FILE));
      if (!inside(root, target)) throw new Error(`unsafe skill ${JSON.stringify(id)}: SKILL.md resolves outside the library`);
      // Open the canonical path we checked. This prevents a SKILL.md symlink or
      // Windows reparse point from turning prompt loading into an arbitrary read.
      return boundedUtf8(target);
    },
  };
}
