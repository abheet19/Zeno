/**
 * The safe, reviewable slice of durable Vault memory that enters one agent run.
 *
 * Vault notes are local Markdown and can also be edited while Zeno is stopped, so
 * sanitation happens again at retrieval. This is intentional defence in depth:
 * new writes are scrubbed before storage, while an old or hand-edited note still
 * cannot put a raw credential into a model prompt or the Forge Lens.
 */
import { sanitize } from '@abheet19/zeno-sanitizer';
import {
  buildRunContext,
  readProjectContext,
  type Memory,
  type MemoryEntry,
  type ProjectContext,
  type RecalledMemory,
} from '@abheet19/zeno-vault';

export const DEFAULT_FORGE_MEMORY_ENABLED = true;

export interface SafeRecalledMemory {
  readonly entry: MemoryEntry;
  readonly score: number;
  readonly matched: readonly string[];
  /** Stable, owner-readable citation used in the prompt and Forge Lens. */
  readonly citation: string;
}

export interface AssembledMemoryContext {
  /** Sanitized owner task. The final prompt composer keeps this last. */
  readonly ownerTask: string;
  readonly prompt: string;
  readonly project: ProjectContext | null;
  readonly recalled: readonly SafeRecalledMemory[];
  readonly memoryEnabled: boolean;
  readonly memoryAvailable: boolean;
  /** Number of sanitizer findings removed from this context slice. */
  readonly redacted: number;
}

/**
 * Build the memory/project part of a Forge prompt from the same Vault used by the
 * owner-facing memory routes. Recall is performed only for this task and is capped
 * by Memory.recall's governed five-result default.
 */
export function assembleMemoryContext(input: {
  readonly memory: Memory | undefined;
  readonly projectRoot: string;
  readonly task: string;
  readonly memoryEnabled?: boolean;
}): AssembledMemoryContext {
  const memoryEnabled = input.memoryEnabled ?? DEFAULT_FORGE_MEMORY_ENABLED;
  let redacted = 0;
  const scrub = (value: string): string => {
    const result = sanitize(value);
    redacted += result.findings.length;
    return result.clean;
  };

  const ownerTask = scrub(input.task);
  const rawProject = readProjectContext(input.projectRoot);
  const project = rawProject === null
    ? null
    : { ...rawProject, path: scrub(rawProject.path), text: scrub(rawProject.text) };

  const rawHits: readonly RecalledMemory[] = memoryEnabled && input.memory
    ? input.memory.recall(input.task)
    : [];
  const recalled = rawHits.map((hit): SafeRecalledMemory => {
    const entry: MemoryEntry = {
      ...hit.entry,
      id: scrub(hit.entry.id),
      description: scrub(hit.entry.description),
      body: scrub(hit.entry.body),
      source: scrub(hit.entry.source),
      tags: hit.entry.tags.map(scrub),
    };
    return {
      entry,
      score: hit.score,
      matched: hit.matched.map(scrub),
      citation: `vault-memory:${entry.id}`,
    };
  });

  return {
    ownerTask,
    project,
    recalled,
    memoryEnabled,
    memoryAvailable: input.memory !== undefined,
    redacted,
    prompt: buildRunContext({
      project,
      memories: recalled.map((hit) => hit.entry),
      task: ownerTask,
      memoryEnabled,
      memoryAvailable: input.memory !== undefined,
    }),
  };
}
