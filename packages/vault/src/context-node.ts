/**
 * Reading ZENO.md off a real disk. The only file here that knows what a filesystem
 * is, kept dull for the same reason `vault-node-fs.ts` is.
 *
 * A MISSING FILE IS NOT AN ERROR. Most projects will never have a ZENO.md, and "this
 * project has no standing context" is the truthful answer to that rather than a
 * crash. A file that exists and cannot be read is a different fact, and is allowed to
 * throw — the owner should hear about a permissions problem on their own file.
 *
 * The read is capped rather than streamed whole: a caller asking for prompt context
 * cannot use eight megabytes of it, and `truncated` says plainly that there is more.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTEXT_FILE, MAX_CONTEXT_CHARS, type ProjectContext } from './context.js';

function absent(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * The project context file at `root`, or null when there is none.
 *
 * Only `<root>/ZENO.md` is read. There is no search up the directory tree: a walk
 * upward would silently pick up a ZENO.md from a parent folder — the user's home
 * directory, on a bad day — and a context nobody can point at is a context nobody
 * can review.
 */
export function readProjectContext(root: string): ProjectContext | null {
  const path = join(root, CONTEXT_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (absent(err)) return null;
    throw err;
  }
  let bytes = Buffer.byteLength(raw, 'utf8');
  try {
    bytes = statSync(path).size;
  } catch {
    /* the byte count from the text we already hold is close enough to be honest */
  }
  const truncated = raw.length > MAX_CONTEXT_CHARS;
  return { path, text: truncated ? raw.slice(0, MAX_CONTEXT_CHARS) : raw, bytes, truncated };
}
