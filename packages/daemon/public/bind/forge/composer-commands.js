/**
 * bind/forge/composer-commands.js — the "/" command menu for Forge's two
 * composers (the pre-session hero `#ag-ta` and the active-session `#s-ta`).
 * Split out of session.js purely for the per-file line budget — there is no
 * behavioural seam here.
 *
 * Each command calls the exact same real control a click already reaches —
 * this composer's own model pill, its own Plan-first pill, S.startNewSession,
 * S.clearTerminal — so there is one code path for "do the thing", whichever
 * way it is reached. `modelSel`/`planSel` point at THIS composer's own pills
 * (the hero and the session composer each have their own), so the popup a
 * command opens is the one beside where the owner is actually typing.
 */
import { $ } from '../../bind.js';
import { setupCommandMenu } from '../command-menu.js';

/** Open the terminal in the Editor view and run one real command through it —
 * the exact path the terminal input itself uses, so build/test go to the real
 * /forge/terminal endpoint (owner-gated) and their output lands where the owner
 * can read it. */
function runInTerminal(S, command) {
  if (S.setForgeView) S.setForgeView('editor');
  if (S.showPanel) S.showPanel('terminal');
  if (S.runTerminalCommand) void S.runTerminalCommand(command);
  else if (S.focusTerminal) S.focusTerminal();
}

/** Jump to one of Command's screens (Approvals, …) by clicking the exact rail
 * controls a mouse would — switch to the Command product first, then its
 * screen button. Cross-product navigation has no S handle, so it goes straight
 * through the shared nav the same way bind/ask.js's own nav does. */
function gotoCommandScreen(name) {
  const p = $('.seg [data-product="command"]');
  if (p) p.click();
  const b = $(`.nav-i[data-screen="${name}"]`);
  if (b) b.click();
}

function forgeCommands(S, startNewSession, modelSel, planSel) {
  const out = [
    { id: 'new', hint: 'Start a new session', run: () => startNewSession() },
    { id: 'model', hint: 'Choose a model', run: () => { const p = $(modelSel); if (p) p.click(); } },
    { id: 'plan', hint: 'Toggle Plan first', run: () => { const p = $(planSel); if (p) p.click(); } },
    { id: 'agent', hint: 'Go to the Agent view', run: () => { if (S.setForgeView) S.setForgeView('agent'); } },
    { id: 'editor', hint: 'Go to the Editor view', run: () => { if (S.setForgeView) S.setForgeView('editor'); } },
    { id: 'files', hint: 'Go to a file (quick open)', run: () => { if (S.openQuick) S.openQuick(''); } },
    {
      id: 'search', hint: 'Search the repository',
      run: () => { if (S.setForgeView) S.setForgeView('editor'); const b = $('.vsact [data-vsview="search"]'); if (b) b.click(); },
    },
    { id: 'build', hint: 'Run the build in the terminal', run: () => runInTerminal(S, 'npm run build') },
    { id: 'test', hint: 'Run the tests in the terminal', run: () => runInTerminal(S, 'npm test') },
    {
      id: 'terminal', hint: 'Open the Forge terminal',
      run: () => { if (S.setForgeView) S.setForgeView('editor'); if (S.showPanel) S.showPanel('terminal'); if (S.focusTerminal) S.focusTerminal(); },
    },
    {
      id: 'clear', hint: 'Clear terminal output',
      run: () => { if (S.setForgeView) S.setForgeView('editor'); if (S.showPanel) S.showPanel('terminal'); if (S.clearTerminal) S.clearTerminal(); },
    },
    { id: 'approvals', hint: 'Review approvals in Command', run: () => gotoCommandScreen('approvals') },
  ];
  // New File is a real, owner-gated kernel proposal (S.askNewFile prompts for a
  // path and proposes it) — only listed when that handler is actually present.
  if (typeof S.askNewFile === 'function') {
    out.splice(6, 0, { id: 'file', hint: 'Propose a new file', run: () => S.askNewFile() });
  }
  return out;
}

/**
 * Wire both composers' "/" menus. Returns `{ sCmd, agCmd }` — each a
 * `{ handleKeydown }` (or null when its textarea is missing) so session.js's
 * own keydown listeners can ask it first, before their own Enter-to-send.
 */
export function setupComposerCommands(S, { sTa, agTa, startNewSession }) {
  const sCmd = sTa ? setupCommandMenu(sTa, () => forgeCommands(S, startNewSession, '#s-model', '#s-planfirst')) : null;
  const agCmd = agTa ? setupCommandMenu(agTa, () => forgeCommands(S, startNewSession, '.ag-composer [data-model-pill]', '#ag-planfirst')) : null;
  return { sCmd, agCmd };
}
