/**
 * bind/forge/state.js — the single shared-state object the Forge modules
 * pass around instead of a shared closure.
 *
 * forge.js was one big `bindForge()` function: every piece (explorer, editor,
 * terminal, session panel, model picker, menu...) was a closure over the same
 * local variables (statusData, currentFile, sessions, agentsData, ...), so
 * they could read and call each other for free. Splitting that function into
 * separate modules loses that for-free sharing — but many of those modules
 * still legitimately need each other at RUNTIME (the explorer opens files the
 * editor owns; the editor needs the explorer to reload git status after a
 * save; the model picker's Compare view starts a task the session panel
 * owns; ...), and several of those needs run in both directions, which a
 * plain static `import` cannot express without an import cycle.
 *
 * `createForgeState()` returns one fresh object per `bind()` call (never a
 * module-level singleton — Forge's own bind() can in principle run more than
 * once per page, and each run must start from a clean slate, exactly as the
 * original single-closure version did every time `bindForge()` ran). Two
 * kinds of fields live on it:
 *
 *  - plain data (statusData, currentFile, sessions, agentsData, ...): the
 *    handful of facts more than one module reads or writes. Objects/Sets/Maps
 *    are mutated in place; primitives are read/written as `S.foo` so no
 *    module ever holds a stale copy.
 *
 *  - a small function registry (openFile, loadStatus, paintModelPills, ...):
 *    each is assigned exactly once, by the one module that owns that piece of
 *    behaviour, during that module's setup call. Every OTHER module that
 *    needs to call it does so as `S.openFile(...)` — never by importing the
 *    owning module directly — which is what breaks the cycles above. Setup
 *    for every module runs synchronously before boot fetches anything and
 *    before the user can click anything, so by the time any of these are
 *    actually invoked, the owner has already registered it.
 */
export function createForgeState() {
  return {
    // ---- set once, at the top of forge.js's bind(), read everywhere ----
    ide: null,
    OWNER: '',

    // ---- owned by explorer.js; also written by editor.js (currentFile) ----
    statusData: null,
    statusErr: null,
    currentFile: null,
    collapsedDirs: new Set(),
    fileRowByPath: new Map(),

    // ---- owned by session.js; read by modelpicker.js ----
    sessions: [],
    activeIdx: -1,
    draftSession: null,

    // ---- owned by activitybar.js's Zeno view; read by session.js ----
    selectedSkillIds: new Set(),

    // ---- owned by modelpicker.js; read by session.js (localModelChoice) ----
    agentsData: null,
    agentsErr: null,

    // ---- cross-module function registry (see the file comment above) ----
    openFile: null,                     // editor.js:  (path, force?, groupIndex?) => Promise<void>
    renderEditorEmpty: null,            // editor.js:  (message) => void
    revealLineInPrimaryGroup: null,     // editor.js:  (path, line) => void
    proposeSaveFromFocusedGroup: null,  // editor.js:  () => void

    loadStatus: null,                   // explorer.js: () => Promise<void>
    renderFileStatusBits: null,         // explorer.js: (path, data) => void
    proposeNewFile: null,               // explorer.js: (relPath) => Promise<void>
    renderQuickIfOpen: null,            // explorer.js: () => void
    setExitCode: null,                  // explorer.js: (text) => void

    showPanel: null,                    // terminal.js: (name) => void
    runTerminalCommand: null,           // terminal.js: (cmd) => Promise<void>
    focusTerminal: null,                // terminal.js: () => void

    paintModelPills: null,              // modelpicker.js: () => void
    sendTask: null,                     // session.js: (session, task) => Promise<void>
  };
}
