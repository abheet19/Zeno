/**
 * The real git adapter for the GitExecutor. Isolated here so the core executor
 * logic (executor-git.ts) stays pure and subprocess-free. Shells out to the git
 * binary with `node:child_process` — zero npm dependencies, as the kernel
 * requires.
 *
 * Three deliberate properties, each of which is a jail concern rather than a
 * convenience:
 *
 *   NEVER A SHELL — `shell: false`, so no argument is ever re-parsed by cmd.exe
 *     or sh. A branch name or commit message containing `&`, `|` or `"` is data.
 *
 *   NO INHERITED GIT_* — every `GIT_*` variable is stripped from the child's
 *     environment. An ambient `GIT_DIR`, `GIT_WORK_TREE` or `GIT_INDEX_FILE`
 *     would silently redirect a committed effect at a repository the executor
 *     never jailed, which is the whole game. `GIT_TERMINAL_PROMPT=0` is then set
 *     back explicitly so git can never block waiting for a credential.
 *
 *   NEVER THROWS — a missing binary, a crash, a non-zero exit, and an argument
 *     `spawnSync` itself refuses all come back as a reported `GitResult`. The
 *     executor decides what a failure means; an adapter that threw would turn
 *     "git said no" into an unhandled error. That last case is not theoretical:
 *     a NUL byte anywhere in a path or a commit message makes `spawnSync` throw
 *     a `TypeError` from its own argument validation, before any process is
 *     spawned — so the call is wrapped, not merely inspected for `r.error`.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { GitRunner, GitResult } from './executor-git.js';

/** 16 MiB: far past any `diff --name-only` and still bounded. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** Exit code reported when the binary itself could not be run at all. */
export const GIT_UNAVAILABLE = 127;

export interface NodeGitOptions {
  /** The git binary. Defaults to `git`, resolved through PATH (and PATHEXT on Windows). */
  readonly binary?: string;
  /** Hard ceiling on a single invocation, in milliseconds. */
  readonly timeoutMs?: number;
}

/** The child's environment: the parent's, minus every GIT_* variable. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env['GIT_TERMINAL_PROMPT'] = '0';
  return env;
}

export function nodeGitRunner(opts: NodeGitOptions = {}): GitRunner {
  const binary = opts.binary ?? 'git';
  const timeout = opts.timeoutMs ?? 120_000;
  return {
    run(args: readonly string[], cwd: string): GitResult {
      let r: SpawnSyncReturns<string>;
      try {
        r = spawnSync(binary, [...args], {
          cwd,
          encoding: 'utf8',
          // stdin is closed: git can never sit waiting for input nobody will type.
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT,
          timeout,
          env: childEnv(),
        });
      } catch (err) {
        // `spawnSync` validates its own arguments and THROWS — it does not report
        // — for a NUL byte in an argument or in `cwd`. Reported, like everything else.
        const why = err instanceof Error ? err.message : String(err);
        return { status: GIT_UNAVAILABLE, stdout: '', stderr: `git could not be run: ${why}` };
      }
      if (r.error) {
        // ENOENT (no git on PATH), EACCES, a timeout kill — all reported, never thrown.
        return { status: GIT_UNAVAILABLE, stdout: '', stderr: `git could not be run: ${r.error.message}` };
      }
      // A null status means a signal killed it; 128 is git's own "fatal" code and
      // reads correctly to every caller here.
      return { status: r.status ?? 128, stdout: r.stdout, stderr: r.stderr };
    },
  };
}
