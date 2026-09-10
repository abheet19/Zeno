/**
 * Isolate the work — the safety line drawn as code.
 *
 * A headless agent must never edit the owner's real working tree. Instead Forge
 * gives it a throwaway, detached git WORKTREE under a temp area: a second
 * checkout of the same repository, on no branch, that the agent may scribble in
 * freely. `diffFiles` then reads back what it changed, and `cleanup` deletes the
 * worktree. Nothing here commits, pushes, or touches the primary checkout.
 *
 * The refusal that matters: if a worktree cannot be created — git missing, too
 * old, or the target is not a repository — this throws `WorktreeUnavailableError`
 * and STOPS. There is deliberately no un-isolated fallback that runs the agent
 * on the real tree; "we could not isolate it" must never quietly become "so we
 * ran it on your working copy".
 *
 * Pure over the kernel's injected `GitRunner`: git arrives as one function, so
 * the whole module is testable with an in-memory double and no repository. Every
 * path — the worktree's own location and each changed path it reports — is
 * jailed with the kernel's filesystem-aware `jail`, the same containment the executors use,
 * rather than a second private copy of the rules.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jail, nodeSandboxFs, type GitRunner, type GitResult } from '@abheet19/zeno-kernel';
import { STATUS_ARGS, parsePorcelainZ } from './status.js';

/** The temp sub-namespace all Forge worktrees live under, so they are easy to find and sweep. */
export const WORKTREE_NAMESPACE = 'zeno-forge-worktrees';

/** A live isolated worktree: where it is, and how to remove it. */
export interface Worktree {
  /** Absolute path to the throwaway worktree the agent runs inside. */
  readonly path: string;
  /** Remove the worktree (`git worktree remove --force`). Throws if git cannot. */
  cleanup(): void;
}

/** Optional knobs. `tmpBase` overrides the OS temp dir — tests pin it for exact paths. */
export interface CreateWorktreeOptions {
  readonly tmpBase?: string;
}

/**
 * Raised when the work cannot be isolated. Carries the plain reason; its message
 * states the refusal so no caller can read it as permission to run un-isolated.
 */
export class WorktreeUnavailableError extends Error {
  /** The underlying reason, already one line. */
  readonly detail: string;

  constructor(detail: string) {
    super(
      `Cannot isolate the work: ${detail}. Forge will not run a headless agent on the real working tree — there is no un-isolated fallback.`,
    );
    this.name = 'WorktreeUnavailableError';
    this.detail = detail;
  }
}

/** Raised when a worktree could not be removed — a leftover checkout the owner must know about. */
export class WorktreeCleanupError extends Error {
  readonly path: string;
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(`Could not remove the worktree at ${path}: ${detail}.`);
    this.name = 'WorktreeCleanupError';
    this.path = path;
    this.detail = detail;
  }
}

/** git's own words, one line, bounded. */
function detailOf(r: GitResult): string {
  const text = (r.stderr.trim() || r.stdout.trim()).replace(/\s+/g, ' ').trim();
  return text === '' ? `git exited ${r.status}` : text.slice(0, 300);
}

/**
 * Create a detached throwaway worktree of `repoRoot` and return its path plus a
 * `cleanup`. `name` identifies the worktree and MUST be unique per run (the run
 * id is the natural choice); it is jailed under the temp namespace, so a `name`
 * that tries to climb out (`../../etc`) is rejected before git is ever called.
 *
 * A failure to add the worktree — including git not being on PATH — becomes a
 * `WorktreeUnavailableError`, never a silent fallback.
 */
export function createWorktree(
  repoRoot: string,
  name: string,
  git: GitRunner,
  opts: CreateWorktreeOptions = {},
): Worktree {
  const base = opts.tmpBase ?? tmpdir();
  // Jail the worktree's OWN path before git creates anything. Canonicalising
  // from `base` (rather than treating the namespace as a trusted root) also
  // refuses a pre-existing `zeno-forge-worktrees` junction that redirects the
  // checkout somewhere else on the host.
  const fs = nodeSandboxFs();
  const namespace = jail(fs, base, WORKTREE_NAMESPACE);
  const path = jail(fs, namespace, name);

  // `--detach`: on no branch, so the throwaway can never be confused for, or
  // accidentally advance, one of the owner's branches.
  const add = git.run(['worktree', 'add', '--detach', path], repoRoot);
  if (add.status !== 0) {
    throw new WorktreeUnavailableError(detailOf(add));
  }

  return {
    path,
    cleanup(): void {
      const rm = git.run(['worktree', 'remove', '--force', path], repoRoot);
      if (rm.status !== 0) {
        throw new WorktreeCleanupError(path, detailOf(rm));
      }
    },
  };
}

/**
 * List the paths changed inside a worktree — the changeset the gate reviews.
 *
 * Every reported path is re-jailed against the worktree. git would not emit an
 * escaping path here, but this list is what reaches the owner's approval, so a
 * path that climbs out is rejected rather than shown.
 */
export function diffFiles(worktree: string, git: GitRunner): string[] {
  const r = git.run([...STATUS_ARGS], worktree);
  if (r.status !== 0) {
    throw new WorktreeUnavailableError(`git status failed in the worktree — ${detailOf(r)}`);
  }
  const paths = parsePorcelainZ(r.stdout);
  // Lexical containment alone is insufficient. Changed paths are consumed as
  // real files after the agent exits, so also resolve filesystem links here:
  // a tracked symlink or NTFS junction must never make that read leave the
  // disposable worktree.
  const fs = nodeSandboxFs();
  for (const p of paths) jail(fs, worktree, p);
  return paths;
}
