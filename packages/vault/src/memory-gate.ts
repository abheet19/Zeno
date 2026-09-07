/**
 * Writing memory is an effect. Reading it is not.
 *
 * THE DECISION, AND WHY IT IS NOT T0
 * ----------------------------------
 * It was open whether an agent writing a memory entry is routine (T0, auto-approved,
 * receipted but never paused for) or gated (T1, previewed and approved). Four facts
 * decided it, and the last one decided it on its own:
 *
 *   1. It OUTLIVES THE RUN. Everything else an agent writes lands in a jailed
 *      worktree that is thrown away unless the owner approves it. A memory entry is
 *      not in the jail: it is in the Vault, and it is still there tomorrow.
 *   2. It STEERS FUTURE PROMPTS. Memory is retrieved into later sessions by design —
 *      that is the whole feature. A write is therefore not a note in a drawer; it is
 *      an edit to what the next agent is told is true.
 *   3. IT ACCUMULATES. One entry is trivial; two hundred entries the owner never
 *      read is a private corpus shaping every answer, which is exactly the thing this
 *      product exists to not be.
 *   4. IT IS A PERSISTENCE CHANNEL. An agent that can write memory unsupervised can
 *      write instructions to its own successor, and prompt injection reaching one run
 *      would survive into every run after it. `renderMemoryContext` frames entries as
 *      records rather than orders, which reduces that; a gate removes the ability to
 *      plant one unseen.
 *
 * So an agent's memory write is an ActionRequest like any other: classified, previewed
 * with the exact text visible, approved by the owner, committed once, receipted.
 * `memory.write` is T1 in the default policy — the tier for a durable local artefact
 * the owner reviews, alongside `patch.task` and `vcs.commit`. It is deliberately not
 * T2: nothing leaves the machine, and the entry is plain Markdown the owner can read
 * and delete. Rating it T2 would demand an authenticator for writing a sentence into
 * a notebook, and a gate that fires too often is a gate people learn to click through.
 *
 * WHAT IS NOT GATED, AND WHY THAT IS CONSISTENT
 * ---------------------------------------------
 * READING memory is ungoverned. Retrieval causes no effect, produces no receipt and
 * changes nothing; gating it would be theatre. And the OWNER writing their own memory
 * is not gated either — the owner is the approval authority, and asking them to
 * approve their own note would be asking them to authorise themselves. That is the
 * same line the daemon already draws for a proposal typed in the owner's own window.
 *
 * COMPARE-AND-SWAP, HONESTLY
 * --------------------------
 * A memory write has no meaningful base state to swap against: a new entry replaces
 * nothing, and the Vault is a directory rather than a document. So the `targetRef`
 * carries the write's own identity (`memory:<vault>`) and the world hands it back
 * unchanged — the same shape, and the same admission, the daemon's world already
 * makes for a governed tool call. L3 does no work here. What protects the write is
 * L2 (one attempt), L4 (single-use approval) and the payload hash, which binds the
 * approval to the exact words that were shown.
 *
 * This module stays free of any kernel import so the Vault keeps its own shape: it
 * builds the request FIELDS and the executor's effect, and whoever composes a kernel
 * (the daemon) supplies the kernel. The one string that must agree across that seam
 * is `MEMORY_WRITE_KIND`, exported here and matching the kernel's action-kind list.
 */
import { Memory, MEMORY_KINDS, type MemoryEntry, type MemoryInput, type MemoryKind } from './memory.js';

/** Must equal the kernel's `ActionKind` of the same name. T1 in the default policy. */
export const MEMORY_WRITE_KIND = 'memory.write';

/** Prefix of the target a memory write binds to. See the note on CAS above. */
export const MEMORY_TARGET_PREFIX = 'memory:';

/**
 * The payload — the exact fields that will be written, and nothing else. It is what
 * gets hashed into the binding, so the approval the owner grants is bound to these
 * words and not merely to "some memory write".
 */
export interface MemoryWritePayload {
  readonly kind: MemoryKind;
  readonly description: string;
  readonly body: string;
  readonly source: string;
  readonly tags: readonly string[];
}

/**
 * The fields of an ActionRequest for one memory write. Structurally the kernel's
 * `ActionRequest` minus the parts only a kernel host can supply.
 */
export interface MemoryWriteRequest {
  readonly kind: typeof MEMORY_WRITE_KIND;
  readonly summary: string;
  readonly targetRef: string;
  readonly payload: MemoryWritePayload;
  readonly baseHash: string;
  readonly requestedBy: string;
  readonly dataZones: readonly ['personal'];
}

export interface ProposeOptions {
  /** Which agent asked. Recorded, and the kernel refuses to let it also approve (L6). */
  readonly requestedBy: string;
  /** Where the memory lives — makes the target specific to this vault. */
  readonly vaultRef: string;
  /** The base the host read back for that target. See the CAS note above. */
  readonly baseHash: string;
}

/** Trim, cap and normalise. A description is one line; a body is prose. */
export const MAX_DESCRIPTION_CHARS = 200;
export const MAX_BODY_CHARS = 8_000;

export type ValidationResult =
  | { readonly ok: true; readonly payload: MemoryWritePayload }
  | { readonly ok: false; readonly reason: string };

/**
 * Check one proposed memory before it becomes an action. Every refusal names the
 * field and what would fix it, because an agent that gets "invalid input" back has no
 * way to try again correctly and will simply try again identically.
 */
export function validateMemoryInput(input: MemoryInput): ValidationResult {
  const description = input.description.replace(/\s+/g, ' ').trim();
  if (description === '') {
    return { ok: false, reason: 'a memory needs a description: one line the owner can read in a list.' };
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return {
      ok: false,
      reason: `that description is ${description.length} characters; keep it under ${MAX_DESCRIPTION_CHARS}. Put the detail in the body.`,
    };
  }
  const body = input.body.trim();
  if (body.length > MAX_BODY_CHARS) {
    return { ok: false, reason: `that body is ${body.length} characters; the cap is ${MAX_BODY_CHARS}.` };
  }
  if (!(MEMORY_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, reason: `"${String(input.kind)}" is not a memory kind. Use one of: ${MEMORY_KINDS.join(', ')}.` };
  }
  const source = input.source.trim();
  if (source === '') {
    return { ok: false, reason: 'a memory needs a source: who established this. A memory with no source is a rumour.' };
  }
  return {
    ok: true,
    payload: {
      kind: input.kind,
      description,
      body,
      source,
      tags: [...new Set((input.tags ?? []).map((t) => t.toLowerCase().trim()).filter((t) => t !== ''))],
    },
  };
}

/**
 * Build the request for an agent's memory write. Pure — it decides nothing and
 * performs nothing; the kernel classifies it and the owner approves it.
 *
 * The summary is the sentence the owner will read in the preview, so it carries the
 * kind and the description verbatim. A preview that said "an agent wants to remember
 * something" would be a gate that shows nothing.
 */
export function proposeMemoryWrite(payload: MemoryWritePayload, opts: ProposeOptions): MemoryWriteRequest {
  return {
    kind: MEMORY_WRITE_KIND,
    summary: `Remember (${payload.kind}): ${payload.description}`,
    targetRef: `${MEMORY_TARGET_PREFIX}${opts.vaultRef}`,
    payload,
    baseHash: opts.baseHash,
    requestedBy: opts.requestedBy,
    dataZones: ['personal'],
  };
}

/**
 * Perform an approved write. This is the executor half — the only thing that should
 * ever call `Memory.record` on an agent's behalf, and it runs after the owner has
 * said yes, never before.
 */
export function applyMemoryWrite(memory: Memory, payload: MemoryWritePayload): MemoryEntry {
  return memory.record({
    kind: payload.kind,
    description: payload.description,
    body: payload.body,
    source: payload.source,
    tags: payload.tags,
  });
}
