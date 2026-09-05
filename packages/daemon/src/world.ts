/**
 * The real world for a running Zeno.
 *
 * Everything the kernel is forbidden to reach for directly — the clock, fresh
 * identifiers, and the current state of a target — arrives through here. That
 * is the whole reason the kernel stays replayable: swap this for a recorded
 * world and the same inputs produce a byte-identical ledger.
 *
 * It lives in the daemon package because the kernel's own lint forbids ambient
 * non-determinism (`new Date()`, `Math.random()`) anywhere under its `src/`.
 */
import { randomUUID } from 'node:crypto';
import { fileHash, gitHead, nodeGitRunner, type SandboxFs, type World } from '@abheet19/zeno-kernel';

/**
 * `readBase` re-reads the CURRENT state of a target for compare-and-swap. Two
 * kinds of target exist, distinguished by prefix:
 *
 *   `git:<repoRoot>` — the base is the repository HEAD. Reading it back as a file
 *     would always mismatch (it is not a file), so a git commit would refuse
 *     forever. Here it returns the live HEAD, so CAS does its real job: if HEAD
 *     moved between approve and commit, the commit refuses rather than racing.
 *   anything else    — a file path. Read through the SAME `SandboxFs` the
 *     executor writes with, so the hash CAS tests is byte-identical to the one
 *     the executor's own base-check computes.
 */
export function nodeWorld(fs: SandboxFs, approvalTtlMs = 5 * 60_000): World {
  const git = nodeGitRunner();
  return {
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    readBase: (targetRef: string) => {
      if (targetRef.startsWith('git:')) {
        try {
          return gitHead({ repoRoot: targetRef.slice(4), git, fs });
        } catch {
          return 'git_unreadable';
        }
      }
      return fileHash(fs.readFile(targetRef));
    },
    approvalTtlMs,
  };
}
