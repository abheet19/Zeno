/**
 * Zeno · P1-02 · Executor & Worktree Adapter — the first real "hand".
 *
 * The kernel (P1-01) decides; this carries out an approved file write, but only:
 *   JAILED  — never writes outside the sandbox root,
 *   ATOMIC  — all-or-nothing (the injected fs does temp→rename),
 *   PROVEN  — re-reads and confirms the result, or fails honestly.
 *
 * Pure logic here: the filesystem arrives through an injected `SandboxFs`, so it
 * is fully testable and free of ambient side effects. The real fs adapter lives
 * in `executor-node-fs.ts`.
 */
import { resolve as pResolve, sep } from 'node:path';
import { hashOf } from './hash.js';
import { PolicyError, type Binding, type EffectProof, type Executor } from './types.js';

/** The exact write an approved `local.write` / `patch.task` action carries. */
export interface WritePayload {
  /** Path RELATIVE to the sandbox root. Absolute or climbing paths are rejected. */
  readonly relPath: string;
  readonly contents: string;
  /** Expected hash of the file BEFORE the write (matches Binding.baseHash). */
  readonly expectBaseHash: string;
  /** Expected hash of the file AFTER the write — what reconcile() checks against. */
  readonly expectPostHash: string;
}

/** Injected filesystem. The real one uses node:fs; tests use an in-memory double. */
export interface SandboxFs {
  /** File contents, or null if the file does not exist. */
  readFile(absPath: string): string | null;
  /** Replace the file all-or-nothing (temp → fsync → rename in the real adapter). */
  writeAtomic(absPath: string, contents: string): void;
  /** Resolve symlinks. For a non-existent path, resolve its deepest existing ancestor. */
  realpath(absPath: string): string;
}

export interface WorktreeSpec {
  /** Absolute path to the sandbox root. Nothing may be written outside it. */
  readonly root: string;
  readonly fs: SandboxFs;
}

const ABSENT = 'base_absent';
function hashFile(contents: string | null): string {
  return contents === null ? ABSENT : hashOf(contents);
}

/** The path-jail: resolve the target and prove it stays inside the sandbox root. */
export function jail(fs: SandboxFs, root: string, relPath: string): string {
  const rootAbs = pResolve(root);
  const abs = pResolve(rootAbs, relPath);
  // 1. lexical: catches "../..", absolute paths, drive letters.
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new PolicyError('policy-schema-invalid', 'Path escapes the sandbox.', 'Use a path inside the sandbox root.');
  }
  // 2. symlink: the resolved real path must also stay inside the real root.
  const realRoot = fs.realpath(rootAbs);
  const realAbs = fs.realpath(abs);
  if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) {
    throw new PolicyError('policy-schema-invalid', 'Path escapes the sandbox via a symlink.', 'Remove the escaping symlink or use a real path inside the root.');
  }
  return abs;
}

/**
 * Build the kernel's `Executor` for one exact approved write. The kernel calls
 * this at most once (law L2); this function makes that one call safe.
 */
export function worktreeExecutor(spec: WorktreeSpec, payload: WritePayload): Executor {
  return async (bound: Binding): Promise<EffectProof> => {
    // Integrity: the payload we hold must be the one that was approved.
    if (hashOf(payload) !== bound.payloadHash) {
      throw new PolicyError(
        'tuple-mismatch',
        'Executor payload does not match the approved action.',
        'Re-preview and re-approve; an executor may only apply the exact approved payload.',
      );
    }

    const abs = jail(spec.fs, spec.root, payload.relPath);
    const before = hashFile(spec.fs.readFile(abs));

    // Idempotent: if the effect is already present, this is a safe no-op success.
    if (before === payload.expectPostHash) {
      return { effect: 'file:' + before };
    }

    // Base-check (belt-and-braces alongside the kernel's compare-and-swap).
    if (before !== payload.expectBaseHash) {
      throw new PolicyError(
        'base-drifted',
        `Base changed before the write (${payload.expectBaseHash.slice(0, 7)} != ${before.slice(0, 7)}).`,
        'Re-preview against the current file; the approval was bound to a base that has moved.',
      );
    }

    // The single atomic attempt.
    spec.fs.writeAtomic(abs, payload.contents);

    // Reconcile: prove it. If the file on disk is not what was approved, refuse to
    // claim success — the kernel then records OUTCOME_UNKNOWN, never a false verified.
    const after = hashFile(spec.fs.readFile(abs));
    if (after !== payload.expectPostHash) {
      throw new Error(`reconcile failed: post-state ${after.slice(0, 7)} != expected ${payload.expectPostHash.slice(0, 7)}`);
    }
    return { effect: 'file:' + after };
  };
}

/** Convenience: build a WritePayload with hashes computed from the given base/new contents. */
export function makeWritePayload(relPath: string, base: string | null, next: string): WritePayload {
  return {
    relPath,
    contents: next,
    expectBaseHash: hashFile(base),
    expectPostHash: hashFile(next),
  };
}
