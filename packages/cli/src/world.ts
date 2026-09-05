/**
 * The real world for a running Zeno.
 *
 * Everything the kernel is forbidden to reach for directly — the clock, fresh
 * identifiers, and the current state of a target — arrives through here. That
 * is the whole reason the kernel stays replayable: swap this for a recorded
 * world and the same inputs produce a byte-identical ledger.
 */
import { randomUUID } from 'node:crypto';
import { fileHash, type SandboxFs, type World } from '@abheet19/zeno-kernel';

/**
 * `readBase` reads through the SAME `SandboxFs` the executor writes with, so the
 * hash compare-and-swap tests is byte-identical to the one the executor's own
 * base-check computes. Two different spellings of "the hash of this file" would
 * surface as a permanent and completely baffling `base-drifted`.
 */
export function nodeWorld(fs: SandboxFs, approvalTtlMs = 5 * 60_000): World {
  return {
    now: () => new Date().toISOString(),
    id: () => randomUUID(),
    readBase: (targetRef: string) => fileHash(fs.readFile(targetRef)),
    approvalTtlMs,
  };
}
