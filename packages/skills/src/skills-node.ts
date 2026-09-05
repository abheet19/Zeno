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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillReader } from './library.js';

/** The file every skill is required to have; the folder name around it is its id. */
export const SKILL_FILE = 'SKILL.md';

/** One path segment: no separators, no drive letters, no `.` or `..`. */
function isSafeId(id: string): boolean {
  return id !== '' && id !== '.' && id !== '..' && !/[\\/:]/.test(id);
}

function missing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * A reader over `<dir>/<id>/SKILL.md`. Directories without a SKILL.md are not listed
 * at all — an unrelated folder that wandered into the library is not a broken skill,
 * and putting it in `failed` would be noise where the owner needs signal.
 */
export function nodeSkillReader(dir: string): SkillReader {
  return {
    list(): string[] {
      let entries: readonly string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch (err) {
        if (missing(err)) return [];
        throw err;
      }
      return entries
        .filter((id) => isSafeId(id) && existsSync(join(dir, id, SKILL_FILE)))
        .sort();
    },
    read(id: string): string {
      if (!isSafeId(id)) throw new Error(`unsafe skill id ${JSON.stringify(id)}: an id must be one folder name`);
      return readFileSync(join(dir, id, SKILL_FILE), 'utf8');
    },
  };
}
