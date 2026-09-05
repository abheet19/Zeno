/**
 * Zeno · P1-03 · Git Executor — the second real "hand".
 *
 * The kernel decides; this turns one approved `vcs.commit` into one real commit,
 * and only:
 *   JAILED  — it can never stage or commit anything outside the repository it was
 *             given, it proves that repository is the one git will act on, it
 *             resolves every path through the real filesystem so that a symlink
 *             or a Windows junction cannot carry an outside file in, and it
 *             proves the paths git actually staged are the paths that were approved,
 *   ATOMIC  — exactly one `git commit`, never a retry loop, never a partial. The
 *             index is a durable, shared mutation: if the commit does not land,
 *             the index is put back exactly as it was found,
 *   PROVEN  — it re-reads HEAD afterwards and compares the landed tree against
 *             what it staged, or it THROWS. It never claims a commit it cannot
 *             demonstrate; the kernel then records `outcome-unknown`.
 *
 * Pure logic here: git arrives through an injected `GitRunner`, so this file is
 * fully testable with no repository and no subprocess. The real adapter lives in
 * `executor-git-node.ts`.
 *
 * This executor lands history LOCALLY and there is no code path from it to a
 * remote: no upload verb, no `--force`, no history rewrite, and no remote name
 * is ever passed to git. Publishing a branch is a separate, higher-tier action
 * in the default policy and it is deliberately not implemented here — the
 * accompanying test asserts, statically, that no such verb appears anywhere in
 * this file as something that could reach git.
 */
import { relative as pRelative, resolve as pResolve, sep } from 'node:path';
import { hashOf } from './hash.js';
import { jail, samePath, type SandboxFs } from './executor.js';
import { PolicyError, type Binding, type EffectProof, type Executor } from './types.js';

/**
 * The one canonical spelling for "this repository has no commits yet" — the git
 * analogue of `base_absent`. A second spelling of this would surface as a
 * permanent and very confusing `base-drifted`.
 */
export const NO_COMMITS = 'no_commits';

/** One invocation of the git binary. */
export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected git. The real one shells out; tests use an in-memory double. */
export interface GitRunner {
  /** Run git with these args in this repo. Never throws for a non-zero exit — it REPORTS it. */
  run(args: readonly string[], cwd: string): GitResult;
}

export interface GitSpec {
  /** Absolute path to the repository root. Nothing outside it may be touched. */
  readonly repoRoot: string;
  readonly git: GitRunner;
  /**
   * The filesystem the jail resolves real paths through. REQUIRED, and not for
   * convenience: lexical containment alone is not containment on a filesystem
   * that has links in it. `git add -- junc/secret.txt` where `junc` is an NTFS
   * junction to `C:\Users\me\.ssh` resolves inside the root by every lexical
   * test, and git — which follows a junction like any other directory, because
   * to Windows it IS one — reads the file and stages its contents. The approval
   * said one path inside the repository; the commit carries a file from outside
   * it. Only `realpath` can see that, so `jail()` always gets one.
   *
   * It is also what lets the repository-root check compare real paths, which
   * matters wherever a temp directory is itself a link (`/tmp` on macOS, an 8.3
   * short name on Windows).
   */
  readonly fs: SandboxFs;
}

/** The exact commit an approved `vcs.commit` action carries. */
export interface CommitPayload {
  readonly message: string;
  /** Paths RELATIVE to repoRoot. Absolute or climbing paths are rejected. */
  readonly paths: readonly string[];
  /** The sha the approval was bound to. */
  readonly expectHead: string;
}

/**
 * git reads a pathspec as a GLOB unless told otherwise. `src/*` resolves inside
 * the root and would sail through containment, then stage every file under it —
 * an approval for two files becoming a commit of two hundred. Every invocation
 * below passes `--literal-pathspecs`; this rejection is the second lock on the
 * same door, so a dropped flag cannot quietly widen an approval.
 */
const PATHSPEC_MAGIC = /[*?[\]]/;

/** A 40-hex sha1, or a 64-hex sha256 for a repo on the newer object format. */
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Short sha for a human-readable message; the sentinel is already short. */
function short(sha: string): string {
  return sha === NO_COMMITS ? sha : sha.slice(0, 7);
}

/** git's own words, trimmed to something legible inside one error message. */
function detail(r: GitResult): string {
  const text = (r.stderr.trim() || r.stdout.trim()).replace(/\s+/g, ' ').trim();
  return text === '' ? '' : ` — ${text.slice(0, 300)}`;
}

/** Every git call happens in the resolved repository root, never anywhere else. */
function runIn(spec: GitSpec, args: readonly string[]): GitResult {
  return spec.git.run(args, pResolve(spec.repoRoot));
}

/** Demand that an invocation succeeded; a failure (including a missing binary) is legible. */
function mustOk(r: GitResult, what: string): GitResult {
  if (r.status !== 0) {
    throw new Error(`git ${what} failed (exit ${r.status})${detail(r)}`);
  }
  return r;
}

/** Run git and demand success. */
function mustRun(spec: GitSpec, args: readonly string[], what: string): GitResult {
  return mustOk(runIn(spec, args), what);
}

/** Split a `-z` (NUL-separated, never quoted) path list. */
function zPaths(r: GitResult): string[] {
  return r.stdout.split('\0').filter((p) => p !== '');
}

/**
 * The current HEAD sha, or `NO_COMMITS` when the repository has none yet.
 * Suitable as a `World.readBase` for a repo target: it is the git layer's base.
 */
export function gitHead(spec: GitSpec): string {
  // `--verify --quiet` is the only spelling that distinguishes "HEAD does not
  // resolve yet" (exit 1, silent) from "this is not a repository / git is
  // broken" (exit 128). Guessing from an error string would be guessing.
  const r = runIn(spec, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (r.status === 0) {
    const sha = r.stdout.trim();
    if (!SHA.test(sha)) {
      throw new Error(`git rev-parse returned something that is not a sha: "${sha.slice(0, 80)}"`);
    }
    return sha;
  }
  if (r.status === 1 && r.stdout.trim() === '') return NO_COMMITS;
  throw new Error(`git rev-parse failed (exit ${r.status})${detail(r)}`);
}

/**
 * The repository we were pointed at must be the repository git will act on.
 * Without this, a `repoRoot` that is merely a folder *inside* someone else's
 * checkout would pass every containment test and then commit to the enclosing
 * repository — containment against the wrong root is not containment.
 */
function assertRepoRoot(spec: GitSpec): string {
  const root = pResolve(spec.repoRoot);
  const top = pResolve(mustRun(spec, ['rev-parse', '--show-toplevel'], 'rev-parse --show-toplevel').stdout.trim());
  const same =
    samePath(top, root) ||
    samePath(spec.fs.realpath(top), spec.fs.realpath(root));
  if (!same) {
    throw new PolicyError(
      'policy-schema-invalid',
      `"${root}" is not the root of the repository git would act on (${top}).`,
      'Point the executor at the repository root itself; a nested directory would commit to the enclosing repository.',
    );
  }
  return root;
}

/**
 * The path-jail. Same containment rules as the worktree executor — Windows traps,
 * lexical containment, and (with an injected fs) symlink escape — plus the two
 * that are specific to a pathspec: no glob magic, and never the root itself.
 */
function jailPaths(spec: GitSpec, root: string, paths: readonly string[]): string[] {
  if (paths.length === 0) {
    throw new PolicyError(
      'policy-schema-invalid',
      'A commit must name at least one path.',
      'List the exact files to stage; a commit with no paths is an unbounded "add everything".',
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (PATHSPEC_MAGIC.test(p)) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Path "${p}" contains pathspec glob magic.`,
        'Name each file literally; a glob would let one approval stage files nobody previewed.',
      );
    }
    // `jail`, never `jailPath`: the link-resolving half is not optional here.
    // A pathspec is handed to git, and git reads through a symlink or a junction
    // without asking, so lexical containment on its own would let one approved
    // path carry a file from outside the repository into the commit.
    const abs = jail(spec.fs, root, p);
    // git speaks forward slashes on every platform, so the PLATFORM separator is
    // translated — `sep`, never a hard-coded backslash. On POSIX a backslash is a
    // legal character in a filename, and rewriting it would send git a pathspec
    // naming a different file than the one the jail just cleared: the approval
    // would land on `a/b.ts` when it was granted for `a\b.ts`.
    const rel = pRelative(root, abs).split(sep).join('/');
    if (rel === '') {
      throw new PolicyError(
        'policy-schema-invalid',
        `Path "${p}" is the repository root itself.`,
        'Name the files to commit; staging the whole repository is not an approvable action.',
      );
    }
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/**
 * What git currently has STAGED against HEAD, limited to these pathspecs.
 *
 * `--no-renames` is not cosmetic. `git diff --cached` is porcelain and detects
 * renames by default, so a staged rename (`old.ts` deleted, `new.ts` added)
 * reports only `new.ts`, while `git diff-tree` is plumbing and reports both.
 * Reconcile compares those two lists path for path, so without this flag every
 * committed rename lands perfectly and is then declared "not what was staged":
 * a real, correct commit recorded as `outcome-unknown`. Both views of the same
 * change must be computed the same way.
 */
function stagedPaths(spec: GitSpec, pathspecs: readonly string[]): GitResult {
  return runIn(spec, [
    '--literal-pathspecs',
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '-z',
    '--',
    ...pathspecs,
  ]);
}

/**
 * ATOMIC — the half that a single `git commit` does not give you.
 *
 * `git add` is a durable mutation of a SHARED index, and nothing undoes it when
 * the commit that was meant to consume it never happens. A rejecting pre-commit
 * hook leaves the approved files sitting staged, and the next commit any human
 * makes sweeps them in: an agent's edit reaching history with no approval, no
 * preview and no receipt. A leftover index is therefore a partial effect, which
 * is a bug and not a degraded success — so every path out of the attempt that
 * leaves no commit behind puts the index back exactly as it was found.
 *
 * Returns a note to append to the error already being thrown. It never throws
 * and it never hides a rollback that itself failed — an index this could not
 * restore is exactly the kind of thing the operator must be told about. Once a
 * commit HAS landed, git has already reconciled the index for these paths, the
 * first read comes back empty, and this is a no-op by construction.
 *
 * The residual, stated rather than glossed: this covers every way the ATTEMPT can
 * fail, not a hard kill of the process between the `add` and the `commit`, which
 * leaves the staging behind with nobody left to undo it. Closing that last window
 * means never touching the shared index at all — staging into a private
 * `GIT_INDEX_FILE` — which needs an environment channel through `GitRunner` that
 * the node adapter deliberately does not have (it strips every `GIT_*`).
 */
function restoreIndex(spec: GitSpec, before: string, pathspecs: readonly string[]): string {
  const listed = stagedPaths(spec, pathspecs);
  if (listed.status !== 0) return ` — and the index could not be inspected${detail(listed)}`;
  const ours = zPaths(listed);
  if (ours.length === 0) return '';
  // The pre-flight check below proved these paths held nothing staged before we
  // touched them, so "as we found it" is exactly HEAD — or, in a repository with
  // no HEAD to restore from, no index entry at all.
  const undo =
    before === NO_COMMITS
      ? ['--literal-pathspecs', 'update-index', '--force-remove', '--', ...ours]
      : ['--literal-pathspecs', 'restore', '--staged', '--', ...ours];
  const r = runIn(spec, undo);
  return r.status === 0 ? '' : ` — and the index could not be restored${detail(r)}`;
}

/** Append a rollback note to the error in flight, keeping its class and its code. */
function withNote(err: unknown, note: string): unknown {
  if (note !== '' && err instanceof Error) err.message += note;
  return err;
}

/**
 * Build the kernel's `Executor` for one exact approved commit. The kernel calls
 * this at most once (law L2); this function makes that one call safe.
 */
export function gitExecutor(spec: GitSpec, payload: CommitPayload): Executor {
  return async (bound: Binding): Promise<EffectProof> => {
    // 1. INTEGRITY: the payload we hold must be the one that was approved.
    if (hashOf(payload) !== bound.payloadHash) {
      throw new PolicyError(
        'tuple-mismatch',
        'Executor payload does not match the approved action.',
        'Re-preview and re-approve; an executor may only apply the exact approved payload.',
      );
    }
    const message = payload.message.trim();
    if (message === '') {
      throw new PolicyError(
        'policy-schema-invalid',
        'A commit message is required.',
        'Re-preview with a message; git refuses an empty one and an unlabelled commit is unauditable.',
      );
    }

    // 2. JAIL: the right repository, and only paths inside it.
    const root = assertRepoRoot(spec);
    const pathspecs = jailPaths(spec, root, payload.paths);

    // 3. BASE CHECK: compare-and-swap at the git layer.
    const before = gitHead(spec);
    if (before !== payload.expectHead) {
      throw new PolicyError(
        'base-drifted',
        `HEAD moved before the commit (${short(payload.expectHead)} != ${short(before)}).`,
        'Re-preview against the current HEAD; the approval was bound to a sha that has moved.',
      );
    }

    // 4. THE INDEX MUST BE OURS TO TOUCH. `git add` below overwrites whatever a
    //    human had staged for these paths, and `commit --only` then commits the
    //    worktree over the top: their staged version would be gone, with no
    //    receipt and nothing in the reflog to recover it from. It is also what
    //    makes the rollback exact — every entry this attempt can disturb starts
    //    out equal to HEAD, so putting it back is well defined.
    const alreadyStaged = zPaths(mustOk(stagedPaths(spec, pathspecs), 'diff --cached'));
    if (alreadyStaged.length > 0) {
      throw new PolicyError(
        'policy-schema-invalid',
        `The index already holds staged changes for ${alreadyStaged.join(', ')}.`,
        'Commit or unstage that work first; a governed commit will not consume or overwrite something a human staged by hand.',
      );
    }

    // 5. ONE ATTEMPT: stage exactly the named paths. Never `-A`, never `-f`.
    mustRun(spec, ['--literal-pathspecs', 'add', '--', ...pathspecs], 'add');
    // From here the index carries our staging, so ATOMIC applies to every exit:
    // anything that leaves without a commit must put the index back (restoreIndex).
    try {
      return await commitStaged(spec, before, pathspecs, message);
    } catch (err) {
      throw withNote(err, restoreIndex(spec, before, pathspecs));
    }
  };
}

/**
 * The single attempt, from a freshly staged index to a proven commit. Split out
 * so that ONE try/catch above covers every way out of it — a rollback spelled at
 * each throw site is a rollback that the next edit forgets at one of them.
 */
async function commitStaged(
  spec: GitSpec,
  before: string,
  pathspecs: readonly string[],
  message: string,
): Promise<EffectProof> {
  const staged = zPaths(mustOk(stagedPaths(spec, pathspecs), 'diff --cached'));

  // 6. THE JAIL, SECOND HALF: git decides what a pathspec means, so ask git.
  //    `git add -- src` is RECURSIVE — naming a DIRECTORY stages every changed
  //    file beneath it, exactly as `src/*` would — and the glob check above
  //    cannot see that, because "src" carries no magic character. Reconcile
  //    cannot see it either: the extra files are staged AND landed, so its two
  //    lists agree with each other and disagree only with the approval. An
  //    approval names files; if git staged anything nobody named, the approval
  //    has been widened and nothing may be committed under it.
  const widened = staged.filter((p) => !pathspecs.some((named) => samePath(named, p)));
  if (widened.length > 0) {
    throw new PolicyError(
      'policy-schema-invalid',
      `Staging the approved paths would also commit ${widened.join(', ')}.`,
      'Name every file to commit literally; a directory expands to every changed file beneath it, which is not what was previewed.',
    );
  }

  // 7. Nothing to stage. That is USUALLY the idempotent case: the tree already
  //    says what the approval asked for, and an already-applied effect is a
  //    SUCCESS, the same rule the worktree executor applies to an already-written
  //    file. But an empty `diff --cached` has a second cause that the diff alone
  //    cannot distinguish — a pathspec that matched NOTHING. On a case-insensitive
  //    filesystem (Windows, macOS) `git add -- SRC/A.TS` against a tracked
  //    `src/a.ts` does not fail: it exits 0 and stages nothing at all. Inferring
  //    "already committed" from that would return a false `verified` for a file
  //    still sitting dirty in the tree, which is the one thing this executor may
  //    never do. So PROVE the no-op instead of inferring it: `--error-unmatch` is
  //    git's own answer to "do you know these paths, by these names?".
  if (staged.length === 0) {
    const known = runIn(spec, [
      '--literal-pathspecs',
      'ls-files',
      '--cached',
      '--error-unmatch',
      '-z',
      '--',
      ...pathspecs,
    ]);
    if (known.status !== 0) {
      throw new PolicyError(
        'policy-schema-invalid',
        `Nothing was staged, and git does not know these paths by these names${detail(known)}`,
        'Spell each path exactly as git does. A mis-cased path matches the file on Windows and macOS but stages nothing, which is not the same thing as "already committed".',
      );
    }
    return { effect: 'git:' + before };
  }

  // `--only` builds the commit from exactly these paths, so anything a human
  // happened to have staged beside them is left alone rather than swept into
  // a commit they never previewed.
  const attempt = runIn(spec, [
    '--literal-pathspecs',
    'commit',
    '--only',
    '-m',
    message,
    '--',
    ...pathspecs,
  ]);

  // 8. PROVEN: re-read the world. Never trust the exit code alone.
  const after = gitHead(spec);
  if (after === before) {
    throw new Error(
      `reconcile failed: HEAD did not move from ${short(before)} (git commit exited ${attempt.status})${detail(attempt)}`,
    );
  }
  if (attempt.status !== 0) {
    throw new Error(
      `reconcile failed: HEAD moved to ${short(after)} but git commit exited ${attempt.status}${detail(attempt)}`,
    );
  }
  // `--no-renames` here for the same reason as in stagedPaths: the landed view and
  // the staged view must describe one change in one vocabulary, or a rename is
  // reported as a file nobody staged.
  const landed = new Set(
    zPaths(
      mustRun(
        spec,
        ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '--root', '-z', after],
        'diff-tree',
      ),
    ),
  );
  const stagedSet = new Set(staged);
  const missing = staged.filter((p) => !landed.has(p));
  const unexpected = [...landed].filter((p) => !stagedSet.has(p));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `reconcile failed: commit ${short(after)} is not what was staged ` +
        `(missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`,
    );
  }
  return { effect: 'git:' + after };
}

/** Convenience: build a CommitPayload bound to the repository's current HEAD. */
export function makeCommitPayload(
  spec: GitSpec,
  message: string,
  paths: readonly string[],
): CommitPayload {
  return { message, paths: [...paths], expectHead: gitHead(spec) };
}
