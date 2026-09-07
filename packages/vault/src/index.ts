/** Zeno Vault — governed local memory. Public surface. */
export { Vault, type NoteStore, type VaultClock, type Recalled } from './vault.js';
export { serializeNote, parseNote, type Note } from './note.js';
export { buildBrief, renderBrief, ageOf, type Brief, type BriefItem, type BriefSource, type BriefInput } from './brief.js';
export { nodeNoteStore, nodeClock } from './vault-node-fs.js';
export {
  Memory,
  toEntry,
  renderMemoryContext,
  MEMORY_TAG,
  MEMORY_KINDS,
  type MemoryEntry,
  type MemoryInput,
  type MemoryKind,
  type RecalledMemory,
} from './memory.js';
export {
  buildRunContext,
  CONTEXT_FILE,
  MAX_CONTEXT_CHARS,
  type ProjectContext,
  type RunContextInput,
} from './context.js';
export { readProjectContext } from './context-node.js';
export {
  proposeMemoryWrite,
  applyMemoryWrite,
  validateMemoryInput,
  MEMORY_WRITE_KIND,
  MEMORY_TARGET_PREFIX,
  MAX_DESCRIPTION_CHARS,
  MAX_BODY_CHARS,
  type MemoryWritePayload,
  type MemoryWriteRequest,
  type ProposeOptions,
  type ValidationResult,
} from './memory-gate.js';
