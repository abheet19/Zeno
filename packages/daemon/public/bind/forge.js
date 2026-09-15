/**
 * bind/forge.js — wires the Forge screen's markup (index.html) + interaction
 * layer (ui.js) to the real daemon. Reuses the endpoint knowledge documented
 * in the app's real forge.js (not loaded by index.html any more, but read
 * for its endpoint shapes and honesty conventions) without importing from it
 * (its internals are not exported, and its DOM does not match this markup).
 *
 * Ownership: this file edits ONLY the Forge product (`.product[data-product
 * ="forge"]`). ui.js still owns navigation/menus/layout toggles/tab-switching
 * chrome — those are left alone. Anywhere ui.js wired a CTA straight to a
 * mock data function (file open, terminal run, session send, model picker),
 * this file takes the element over: either by cloning it (dropping ui.js's
 * listener) or by stripping the data-* attribute ui.js's delegated listener
 * keyed off, then attaching a real listener of its own. Pure navigation
 * (activity-bar view switch, bottom-panel tab switch, layout toggles) is
 * left exactly as ui.js wired it.
 *
 * HONESTY: every number on this screen is either read from the daemon or
 * marked as not read. Nothing here draws from ui.js's MODELS/SESS/CODE/TERM
 * mock tables.
 *
 * This file is now just the thin entry point: it builds the shared `S` state
 * (see bind/forge/state.js), runs each area's setup in its own module, and
 * runs the boot sequence that reads the workspace for the first time. Each
 * setup*(S) call is synchronous and only registers DOM listeners and, for
 * the handful of behaviours other modules need at runtime, a function on
 * `S` (see state.js's own comment for why that indirection exists instead
 * of the modules importing each other directly). None of that boot-sequence
 * ordering below is arbitrary: every setup call happens before anything
 * async — a fetch, a click — can actually invoke one of those registered
 * functions.
 */
import { $, token } from '../bind.js';
import { createForgeState } from './forge/state.js';
import { setupExplorer } from './forge/explorer.js';
import { setupEditor } from './forge/editor.js';
import { setupTerminal } from './forge/terminal.js';
import { setupActivityBar } from './forge/activitybar.js';
import { setupModelPicker } from './forge/modelpicker.js';
import { setupMenu } from './forge/menu.js';
import { setupSession } from './forge/session.js';

// Known, deliberate gaps — surfaced once at boot (below) rather than
// silently absent. Each is a case where the honest answer is "not in this
// build" rather than a fabricated control or number.
const NOT_WIRED_NOTES = [
  'Terminal: commands run exactly as typed. This daemon has no server-side or client-side gate that holds a write/push/rm/curl/deploy command for approval before it runs (only file writes from an agent run go through the approval gate) — the task description assumed one exists; it does not.',
  'Output panel: this daemon publishes no output channel for the Output view, so it says so. A run\'s real transcript is rendered by the Session panel from /forge/run.',
  'Testing view: lists the package scripts GET /forge/tests discovered and runs one at a time via POST /forge/tests/run. There is no "run all" route and no per-test breakdown — a script\'s exit code and output are all the daemon reports.',
];

export async function bind() {
  try {
    await bindForge();
  } catch (err) {
    console.warn('[zeno] forge binder failed:', err);
  }
}

async function bindForge() {
  const ide = $('#ide');
  if (!ide) return; // Forge screen not present in this build — nothing to bind.

  const S = createForgeState();
  S.ide = ide;
  S.OWNER = token();

  const explorerApi = setupExplorer(S);
  setupEditor(S);
  const terminalApi = setupTerminal(S);
  const activityBarApi = setupActivityBar(S);
  const modelPickerApi = setupModelPicker(S);
  setupMenu(S);
  const sessionApi = setupSession(S);

  /* ---- boot ------------------------------------------------------------ *
   * Replace the artifact's mock tree/editor/SCM content with an honest
   * "reading" state SYNCHRONOUSLY, so nothing fabricated is ever on screen
   * even for the brief window before the first daemon round-trip resolves.
   */
  S.renderEditorEmpty('Reading the workspace from the daemon…');
  explorerApi.renderExplorer();
  explorerApi.renderScm();
  sessionApi.showEmptyState();
  terminalApi.renderTerminal();
  await Promise.all([
    explorerApi.loadStatus(), modelPickerApi.loadAgents(), explorerApi.renderGov(), activityBarApi.loadZenoView(),
  ]);
  S.paintModelPills();

  // A governed skill/rule write seals a receipt and emits zeno:state. Refresh
  // the Forge catalog so the new capability appears without restarting Zeno.
  let capabilityRefresh = 0;
  window.addEventListener('zeno:state', () => {
    clearTimeout(capabilityRefresh);
    capabilityRefresh = setTimeout(() => { void activityBarApi.loadZenoView(); }, 180);
  });

  if (NOT_WIRED_NOTES.length) console.info('[zeno] forge binder — not wired this pass:', NOT_WIRED_NOTES);
}
