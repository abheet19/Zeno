/** Pure Forge context request state, shared by the browser UI and its contract tests. */

export const DEFAULT_FORGE_MEMORY_ENABLED = true;

/** Every newly opened Forge session starts with durable Vault recall enabled. */
export function newForgeContextState() {
  return {
    memoryEnabled: DEFAULT_FORGE_MEMORY_ENABLED,
    contextPreview: null,
    contextPreviewKey: '',
    contextPreviewTask: '',
    contextPreviewBusy: false,
    contextPreviewErr: null,
  };
}

/** The fields that determine the exact model-facing context for one run. */
export function forgeContextKey(task, memoryEnabled, skillIds) {
  return JSON.stringify([
    String(task ?? '').trim(),
    memoryEnabled !== false,
    [...(skillIds || [])].map(String),
  ]);
}

/**
 * One wire shape for Lens preflight and the later run request. Explicit false is
 * preserved; omission can never accidentally turn a disabled session back on.
 */
export function forgeContextBody(task, memoryEnabled, skillIds) {
  return {
    task: String(task ?? '').trim(),
    memoryEnabled: memoryEnabled !== false,
    skillIds: [...(skillIds || [])].map(String),
  };
}
