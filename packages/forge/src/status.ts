/**
 * Turning `git status --porcelain` output into the flat, sorted list of changed
 * paths the gate reviews. Shared by the two places Forge asks git "what did the
 * agent touch": the headless run's own post-flight (`runner.ts`, through the
 * injected `Spawner`) and the worktree inspector (`worktree.ts`, through the
 * kernel's `GitRunner`). ONE parser, so those two can never disagree about the
 * changeset — the thing the owner is about to approve.
 *
 * Pure and I/O-free: it is handed the bytes git already produced and returns
 * paths. Reading git is the caller's job.
 */

/**
 * The exact status invocation, as argv AFTER the `git` program name (the kernel
 * `GitRunner` and the `Spawner` both take it that way).
 *
 *   `--porcelain`  a stable, script-readable v1 format that does not change with
 *                  the user's config or git version.
 *   `-z`           NUL-delimited, never quoted or escaped, so a path containing a
 *                  space, a quote or a newline survives intact instead of being
 *                  mangled into a different path than the one on disk.
 *   `-uall`        list a brand-new directory the agent wrote as its individual
 *                  files, not collapsed to one `dir/` entry the gate cannot read.
 */
export const STATUS_ARGS: readonly string[] = ['status', '--porcelain', '-z', '-uall'];

/**
 * Parse `-z` porcelain-v1 output into a sorted, de-duplicated list of paths.
 *
 * Each record is `XY <path>`: two status columns, a space, then the path. A
 * rename or copy (R or C in either column) carries its ORIGIN as the next
 * NUL-separated field with no status prefix; the field with the status is the
 * DESTINATION — the path the gate cares about — so that one is recorded and the
 * origin field is consumed and dropped. Records shorter than `XY p` are not
 * something we understand and are skipped rather than mis-sliced.
 */
export function parsePorcelainZ(stdout: string): string[] {
  const fields = stdout.split('\0');
  const paths = new Set<string>();
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    // Empty trailing field (every `-z` stream ends in a NUL) and any too-short
    // fragment: nothing to read here.
    if (field === undefined || field.length < 4) {
      i += 1;
      continue;
    }
    const x = field[0];
    const y = field[1];
    const path = field.slice(3);
    if (path !== '') paths.add(path);
    // Rename/copy: skip the following origin-path field so it is never mistaken
    // for a record of its own.
    i += x === 'R' || x === 'C' || y === 'R' || y === 'C' ? 2 : 1;
  }
  return [...paths].sort();
}
