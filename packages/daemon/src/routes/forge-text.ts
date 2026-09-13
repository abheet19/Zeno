/**
 * Bounded, strict-UTF-8 reads of sandbox/worktree files, and the classifier
 * that turns one changed worktree path into a proposal candidate (or an
 * honest reason it cannot become one).
 *
 * Pure — no daemon state; `decodeForgeText` and `readForgeProposalCandidate`
 * are exported because `server.ts` and the daemon's tests still import them
 * by that name.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';

/** No changed file is copied into the approval store through an unbounded read. */
export const MAX_FORGE_PROPOSED_FILE_BYTES = 1_000_000;

export interface BoundedTextRead {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

class ForgeNonTextFile extends Error {
  constructor() {
    super('the file is not strict UTF-8 text');
    this.name = 'ForgeNonTextFile';
  }
}

/**
 * Decode only bytes that can round-trip as ordinary UTF-8 source text.
 * `Buffer.toString()` replaces invalid sequences with U+FFFD; using it on an
 * agent-produced binary file would propose different bytes than the agent
 * wrote. NUL and non-whitespace C0 controls are also binary signals even though
 * they are technically valid UTF-8.
 */
export function decodeForgeText(bytes: Uint8Array): string | null {
  const source = Buffer.from(bytes);
  if (!isUtf8(source)) return null;
  for (const byte of source) {
    if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) || byte === 0x7f) {
      return null;
    }
  }
  return source.toString('utf8');
}

/** Read at most `maxBytes`, while retaining the real size for an honest UI. */
export function readUtf8Bounded(path: string, maxBytes: number, strict = false): BoundedTextRead {
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('not a regular file');
    const capacity = Math.max(1, Math.min(maxBytes + 1, stat.size + 1));
    const buffer = Buffer.alloc(capacity);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (count === 0) break;
      used += count;
    }
    // The extra byte detects a file that grew after fstat. Treating that prefix
    // as complete would make the approval/UI claim it saw the whole file.
    const truncated = stat.size > maxBytes || used > maxBytes || used > stat.size;
    const prefix = buffer.subarray(0, Math.min(used, maxBytes));
    // A truncated candidate is refused as too large before its prefix could
    // ever become a payload. Decode only complete proposal candidates strictly,
    // avoiding a false binary result when the byte cap splits one UTF-8 rune.
    const decoded = strict && !truncated ? decodeForgeText(prefix) : prefix.toString('utf8');
    if (decoded === null) throw new ForgeNonTextFile();
    return {
      text: decoded,
      bytes: Math.max(stat.size, used),
      truncated,
    };
  } finally {
    closeSync(fd);
  }
}

export type ForgeProposalSkipReason =
  | 'deletion-unsupported'
  | 'binary-unsupported'
  | 'too-large'
  | 'unreadable';

export type ForgeProposalCandidate =
  | { readonly ok: true; readonly contents: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: ForgeProposalSkipReason; readonly note: string; readonly bytes: number | null };

/**
 * Classify one changed worktree path without ever manufacturing text bytes.
 * Deletion needs a governed delete action, which this kernel surface does not
 * yet expose, so it is reported and refused rather than disguised as a write.
 */
export function readForgeProposalCandidate(path: string, maxBytes = MAX_FORGE_PROPOSED_FILE_BYTES): ForgeProposalCandidate {
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: 'deletion-unsupported',
      note: 'deletion is not supported by the file.write approval gate; no proposal was created',
      bytes: null,
    };
  }
  try {
    const source = readUtf8Bounded(path, maxBytes, true);
    if (source.truncated) {
      return {
        ok: false,
        reason: 'too-large',
        note: `the complete file is ${source.bytes.toLocaleString('en-US')} bytes, above the ${maxBytes.toLocaleString('en-US')}-byte approval payload limit; no proposal was created`,
        bytes: source.bytes,
      };
    }
    return { ok: true, contents: source.text, bytes: source.bytes };
  } catch (err) {
    if (err instanceof ForgeNonTextFile) {
      return {
        ok: false,
        reason: 'binary-unsupported',
        note: 'the file is not strict UTF-8 text; no proposal was created and no replacement characters were substituted',
        bytes: null,
      };
    }
    // A deletion can race the initial existence check. Preserve the useful,
    // explicit outcome rather than reducing it to a generic read failure.
    if (!existsSync(path)) {
      return {
        ok: false,
        reason: 'deletion-unsupported',
        note: 'deletion is not supported by the file.write approval gate; no proposal was created',
        bytes: null,
      };
    }
    return {
      ok: false,
      reason: 'unreadable',
      note: 'the changed path could not be read as a regular sandbox file; no proposal was created',
      bytes: null,
    };
  }
}
