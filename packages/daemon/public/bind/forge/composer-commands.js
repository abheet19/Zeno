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

function forgeCommands(S, startNewSession, modelSel, planSel) {
  return [
    { id: 'new', hint: 'Start a new session', run: () => startNewSession() },
    { id: 'model', hint: 'Choose a model', run: () => { const p = $(modelSel); if (p) p.click(); } },
    { id: 'plan', hint: 'Toggle Plan first', run: () => { const p = $(planSel); if (p) p.click(); } },
    {
      id: 'clear', hint: 'Clear terminal output',
      run: () => { S.setForgeView('editor'); if (S.showPanel) S.showPanel('terminal'); if (S.clearTerminal) S.clearTerminal(); },
    },
  ];
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
