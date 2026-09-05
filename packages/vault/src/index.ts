/** Zeno Vault — governed local memory. Public surface. */
export { Vault, type NoteStore, type VaultClock, type Recalled } from './vault.js';
export { serializeNote, parseNote, type Note } from './note.js';
export { buildBrief, renderBrief, ageOf, type Brief, type BriefItem, type BriefSource, type BriefInput } from './brief.js';
export { nodeNoteStore, nodeClock } from './vault-node-fs.js';
