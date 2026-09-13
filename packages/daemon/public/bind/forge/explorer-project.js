/**
 * bind/forge/explorer-project.js — the WORKING FOLDER: which repository
 * Forge is in, how the owner changes it, and the Explorer header's own
 * actions (New File, New Folder, Refresh, Collapse All).
 *
 * WHY THIS EXISTS. Forge used to label the tree "SANDBOX" and show the
 * scratch repository the E2E suite seeds, with no way to point it at the
 * owner's own code short of restarting the daemon with an environment
 * variable. GET /forge/project now says which repository is open (its name,
 * path, whether it is the scratch one, whether it can be changed right now
 * and if not why), and POST /forge/project changes it in place — validated
 * and persisted by the daemon, never by this file. In the desktop app the
 * native folder picker (preload's `zenoProject.choose`) supplies the path;
 * in a plain browser a prompt does.
 *
 * NEW FILE / NEW FOLDER ARE GOVERNED. Both go through POST /previews — the
 * same gate the editor's own save and an agent's write cross. The kernel
 * decides the tier: a routine creation is applied and receipted on the spot;
 * anything it classes as configuration or sensitive (package.json, .env, a
 * CLAUDE.md, ...) is HELD until the owner approves it in Command, and the
 * file does not exist on disk until then. A folder is a write of
 * `<folder>/.gitkeep`, because git does not track empty directories. There
 * is no path from either button to disk that skips the gate.
 *
 * Registers `S.proposeNewFile`, `S.proposeNewFolder`, `S.chooseProject` and
 * `S.openProjectMenu` for the menu bar and the composer "+" menu.
 */
import { $, $$, el, fill } from '../../bind.js';
import { add, disableCtl, postJSON, safeAsk } from './dom.js';

export function setupExplorerProject(S) {
  const ide = S.ide;
  const explorerView = $('.vsside .vsview[data-vsview="explorer"]', ide);
  const projBtn = explorerView ? $('[data-explorer-project]', explorerView) : null;
  const nameEl = explorerView ? $('[data-project-name]', explorerView) : null;
  const headEl = explorerView ? $('[data-project-head]', explorerView) : null;
  const noteEl = explorerView ? $('[data-project-note]', explorerView) : null;

  /** A one-line status under the header (a proposal's outcome, a problem). Never blocks. */
  function say(text) {
    if (!noteEl) return;
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
  }

  function renderProjectHeader() {
    const p = S.project;
    const name = p && p.name ? p.name : (S.statusData && S.statusData.root ? String(S.statusData.root).split(/[\\/]/).filter(Boolean).pop() : null);
    if (nameEl) nameEl.textContent = name || (S.statusErr ? 'repository unreadable' : 'reading…');
    if (headEl) headEl.textContent = name ? name.toUpperCase() : 'PROJECT';
    if (projBtn) {
      projBtn.classList.toggle('scratch', !!(p && p.scratch));
      projBtn.title = p ? `${p.root}\n${p.note}\nClick to change the working folder.` : 'Working folder';
    }
    if (p && p.scratch) say(p.note);
    else if (p && p.savedProblem) say(`Your saved project ${p.savedProblem.path} could not be opened: ${p.savedProblem.problem}`);
    else if (noteEl && /scratch repository|could not be opened/.test(noteEl.textContent)) say('');
    // The session panel's two "▣ sandbox" pills are static markup; they name
    // the repository the run will touch, so they follow the real project.
    for (const pill of $$('.ag-foot .pill, .sessfoot .pill', ide)) {
      if (/^▣/.test(pill.textContent.trim())) pill.textContent = `▣ ${name || 'repository'}`;
    }
  }

  /* ---- changing the working folder ------------------------------------- */

  async function applyProject(path) {
    const r = await postJSON('/forge/project', { path });
    if (!r.ok) {
      const e = r.data && r.data.error;
      safeAsk(() => window.alert(`The working folder was not changed.\n\n${(e && e.message) || r.error}${e && e.resolve ? `\n${e.resolve}` : ''}`));
      return false;
    }
    if (r.data && r.data.resolvedFrom) say(`Opened the repository root ${r.data.project.root} (you chose ${r.data.resolvedFrom}, a folder inside it).`);
    else say('');
    // Everything open belonged to the previous repository.
    S.collapsedDirs.clear();
    if (S.closeAllTabs) S.closeAllTabs();
    S.currentFile = null;
    await S.loadStatus();
    return true;
  }

  async function chooseProject() {
    if (!S.OWNER) { safeAsk(() => window.alert('This window has no owner token, so it cannot change the working folder.')); return; }
    if (S.project && S.project.canChange === false) { safeAsk(() => window.alert(S.project.changeBlockedBy)); return; }
    let path = null;
    const bridge = window.zenoProject && typeof window.zenoProject.choose === 'function' ? window.zenoProject : null;
    if (bridge) {
      // The desktop app: a native folder dialog, validated by Electron before it
      // is handed back (must be inside a Git repository).
      const answer = await bridge.choose();
      if (!answer || answer.canceled) return;
      if (!answer.ok) { safeAsk(() => window.alert(answer.error || 'That folder cannot be opened.')); return; }
      path = answer.path;
    } else {
      path = safeAsk(() => window.prompt('Full path of the Git repository Forge should work in:', S.project && !S.project.scratch ? S.project.root : ''), null);
      if (path === null) return;
    }
    if (!path || !String(path).trim()) return;
    await applyProject(String(path).trim());
  }
  S.chooseProject = chooseProject;

  let menuEl = null;
  function closeProjectMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openProjectMenu(anchor) {
    if (menuEl) { closeProjectMenu(); return; }
    const p = S.project;
    menuEl = el('div', 'menu');
    menuEl.setAttribute('role', 'menu');
    menuEl.dataset.projectMenu = '1';
    const path = el('div', 'vsnote', p ? p.root : 'The working folder could not be read.');
    path.style.cssText = 'padding:4px 10px 6px;max-width:360px;word-break:break-all';
    add(menuEl, path);
    const row = (label, run, disabledReason) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (disabledReason) disableCtl(b, disabledReason);
      else b.addEventListener('click', () => { closeProjectMenu(); run(); });
      add(menuEl, b);
      return b;
    };
    const blocked = !S.OWNER
      ? 'This window has no owner token, so it cannot change the working folder.'
      : (p && p.canChange === false ? p.changeBlockedBy : null);
    row('Change working folder…', chooseProject, blocked);
    row('Use the Zeno scratch repository', () => void applyProject(null),
      blocked || (p && p.scratch ? 'The scratch repository is already open.' : null) || (p && !p.persisted ? 'This daemon has no workspace, so it has no scratch repository.' : null));
    row('Copy path', () => {
      const text = p ? p.root : '';
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say('Path copied.'), () => safeAsk(() => window.prompt('Copy the path:', text)));
      else safeAsk(() => window.prompt('Copy the path:', text));
    }, p ? null : 'Nothing to copy until the working folder is read.');
    row('Refresh', () => { void S.loadStatus(); if (S.refreshOpenFile) void S.refreshOpenFile(); });
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 380))}px`;
    menuEl.style.top = `${r.bottom + 4 + menuEl.offsetHeight > window.innerHeight ? Math.max(8, r.top - menuEl.offsetHeight - 4) : r.bottom + 4}px`;
  }
  S.openProjectMenu = openProjectMenu;
  document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('[data-project-menu]') && !e.target.closest('[data-explorer-project]')) closeProjectMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProjectMenu(); });
  if (projBtn) projBtn.addEventListener('click', (e) => { e.stopPropagation(); openProjectMenu(projBtn); });

  /* ---- New File / New Folder: proposals, never writes ------------------- */

  async function proposeCreate(relPath, summary, openAfter) {
    const r = await postJSON('/previews', { relPath, contents: '', summary, requestedBy: 'forge-editor' });
    if (!r.ok) { say(`"${relPath}" could not be proposed: ${r.error || 'unknown error'}`); return null; }
    const preview = r.data && r.data.preview;
    if (!preview) { say(`"${relPath}" was not proposed — the daemon answered without a preview.`); return null; }
    if (r.data.receipt) {
      // Routine: the kernel applied and receipted it on the spot. It exists now.
      say(`Created ${relPath} — routine, receipted by the kernel.`);
      void S.loadStatus();
      if (openAfter) void S.openFile(relPath, true);
    } else {
      // Held: NOTHING is on disk. The tree will pick it up on the approval's
      // own stream nudge (explorer.js listens for `zeno:state`).
      say(`${relPath} is held for approval (tier ${preview.tier || '?'}) — decide it in Command → Approvals; it appears here once approved.`);
    }
    return r.data;
  }
  function cleanRel(input) {
    return String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }
  async function proposeNewFile(relPath) {
    const rel = cleanRel(relPath);
    if (!rel) return null;
    return proposeCreate(rel, `Forge: create ${rel}`, true);
  }
  async function proposeNewFolder(folder) {
    const rel = cleanRel(folder);
    if (!rel) return null;
    return proposeCreate(`${rel}/.gitkeep`, `Forge: create folder ${rel}/ (as ${rel}/.gitkeep — git does not track empty folders)`, false);
  }
  S.proposeNewFile = proposeNewFile;
  S.proposeNewFolder = proposeNewFolder;

  function askNewFile() {
    const p = safeAsk(() => window.prompt(`Path for the new file (relative to ${S.project ? S.project.name : 'the repository'}):`), null);
    if (p && p.trim()) void proposeNewFile(p);
  }
  function askNewFolder() {
    const p = safeAsk(() => window.prompt(`Path for the new folder (relative to ${S.project ? S.project.name : 'the repository'}):`), null);
    if (p && p.trim()) void proposeNewFolder(p);
  }
  S.askNewFile = askNewFile;
  S.askNewFolder = askNewFolder;

  /* ---- the header's own actions ---------------------------------------- */

  const actions = explorerView ? $$('[data-explorer-act]', explorerView) : [];
  for (const btn of actions) {
    const act = btn.dataset.explorerAct;
    if ((act === 'new-file' || act === 'new-folder') && !S.OWNER) {
      disableCtl(btn, 'This window has no owner token, so it cannot propose a write.');
      continue;
    }
    // The short titles ("New File", "Refresh", …) are the buttons' stable
    // identity — other flows find them by title — so the explanation goes in
    // the accessible name rather than replacing the tooltip.
    if (act === 'new-file') btn.setAttribute('aria-label', 'New File — proposes an empty file through the kernel; held or receipted, never written directly.');
    if (act === 'new-folder') btn.setAttribute('aria-label', 'New Folder — proposes <folder>/.gitkeep through the kernel (git does not track empty folders).');
    if (act === 'refresh') btn.setAttribute('aria-label', 'Refresh — re-read the tree and the open file from the daemon.');
    if (act === 'collapse') btn.setAttribute('aria-label', 'Collapse All folders in the tree.');
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // ui.js's section toggle ignores .fico, but be explicit
      if (act === 'new-file') askNewFile();
      else if (act === 'new-folder') askNewFolder();
      else if (act === 'refresh') { void S.loadStatus(); if (S.refreshOpenFile) void S.refreshOpenFile(); }
      else if (act === 'collapse') { for (const d of S.treeDirs()) S.collapsedDirs.add(d); S.renderExplorer(); }
    });
  }

  // The Explorer's "Views and More Actions" ⋯: the same menu as the folder
  // chip, so it is a real control rather than a decorative one.
  const moreBtn = explorerView ? explorerView.querySelector('.vsvh button[title="Views and More Actions"]') : null;
  if (moreBtn) moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openProjectMenu(moreBtn); });

  fill(noteEl);
  if (noteEl) noteEl.hidden = true;
  return { renderProjectHeader };
}
