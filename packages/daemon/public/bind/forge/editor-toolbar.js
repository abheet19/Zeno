/**
 * bind/forge/editor-toolbar.js — the buttons AROUND the editor: the tab
 * strip's ‹ › ▷ ⋯ and the title bar's ← →.
 *
 * Every one of these shipped without a listener. Back/Forward now walk the
 * real navigation history editor-view.js keeps (and say so when there is
 * nowhere to go); "Run Code" runs the OPEN file through the real terminal
 * with the runner its extension has, and is disabled — with the reason —
 * when there is none; "More Actions" is a real menu of things the editor
 * can actually do to the open file. Nothing here writes to disk: a discard
 * re-reads from the daemon, a run goes through POST /forge/terminal.
 *
 * Registers `S.paintNav` (editor-view.js calls it after every open/close)
 * and `S.runCurrentFile` (the Run menu's "Run Code").
 */
import { $, el } from '../../bind.js';
import { add, disableCtl, safeAsk } from './dom.js';

/** Which command runs a file, by extension. Anything else has no runner here. */
const RUNNERS = {
  js: (p) => `node "${p}"`, mjs: (p) => `node "${p}"`, cjs: (p) => `node "${p}"`,
  py: (p) => `python "${p}"`,
  ps1: (p) => `powershell -NoProfile -ExecutionPolicy Bypass -File "${p}"`,
  sh: (p) => `sh "${p}"`,
};

export function setupEditorToolbar(E, S, view) {
  const ide = S.ide;
  const tabBar = $('.vsed .vstabs', ide);
  const backBtns = [tabBar && tabBar.querySelector('button[title="Go Back"]'), $('.tb .tbico[title="Go Back"]', ide)].filter(Boolean);
  const fwdBtns = [tabBar && tabBar.querySelector('button[title="Go Forward"]'), $('.tb .tbico[title="Go Forward"]', ide)].filter(Boolean);
  const runBtn = tabBar ? tabBar.querySelector('button[title="Run Code"]') : null;
  const moreBtn = tabBar ? tabBar.querySelector('button[title="More Actions"]') : null;

  function enable(btn, title) {
    if (!btn) return;
    btn.disabled = false;
    btn.title = title;
    btn.style.opacity = '';
    btn.style.cursor = '';
  }

  function runnerFor(path) {
    const ext = String(path || '').toLowerCase().split('.').pop();
    return RUNNERS[ext] || null;
  }

  function paintNav() {
    const st = S.navState ? S.navState() : { back: false, forward: false };
    for (const b of backBtns) {
      if (st.back) enable(b, 'Go Back — the previously opened file'); else disableCtl(b, 'No earlier file in this session’s history.');
    }
    for (const b of fwdBtns) {
      if (st.forward) enable(b, 'Go Forward'); else disableCtl(b, 'No later file in this session’s history.');
    }
    if (runBtn) {
      const path = S.currentFile;
      const runner = path ? runnerFor(path) : null;
      if (!path) disableCtl(runBtn, 'No file is open to run.');
      else if (!S.OWNER) disableCtl(runBtn, 'This window has no owner token, so it cannot run a command.');
      else if (!runner) disableCtl(runBtn, `No runner for .${path.split('.').pop()} files in this build — Run Code runs .js/.mjs/.cjs with node, .py with python, .ps1 with powershell, .sh with sh.`);
      else enable(runBtn, `Run ${path} in the terminal: ${runner(path)}`);
    }
  }
  S.paintNav = paintNav;

  function runCurrentFile() {
    const path = S.currentFile;
    const runner = path ? runnerFor(path) : null;
    if (!runner) { safeAsk(() => window.alert(runBtn ? runBtn.title : 'No file is open to run.')); return false; }
    if (S.hasDirtyBuffers && S.hasDirtyBuffers() && E.dirtyPaths.has(path)) {
      safeAsk(() => window.alert(`${path} has unsaved edits — the terminal runs the bytes on disk, not this buffer. Propose the save first if you meant to run the edit.`));
    }
    S.showPanel('terminal');
    void S.runTerminalCommand(runner(path));
    return true;
  }
  S.runCurrentFile = runCurrentFile;

  for (const b of backBtns) b.addEventListener('click', () => void S.navBack());
  for (const b of fwdBtns) b.addEventListener('click', () => void S.navForward());
  if (runBtn) {
    // terminal.js wires every [data-run-cmd] to a fixed command; this button
    // runs the OPEN file instead, so the attribute goes before that runs.
    runBtn.removeAttribute('data-run-cmd');
    runBtn.addEventListener('click', () => runCurrentFile());
  }

  /* ---- More Actions: a real menu ---------------------------------------- */
  let menuEl = null;
  function closeMore() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMore() {
    if (menuEl) { closeMore(); return; }
    menuEl = el('div', 'menu');
    menuEl.setAttribute('role', 'menu');
    menuEl.dataset.editorMenu = '1';
    const path = S.currentFile;
    const row = (label, run, disabledReason) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (disabledReason) disableCtl(b, disabledReason);
      else b.addEventListener('click', () => { closeMore(); run(); });
      add(menuEl, b);
    };
    const none = path ? null : 'No file is open.';
    row('Reveal in Explorer', () => {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) S.collapsedDirs.delete(parts.slice(0, i).join('/'));
      S.renderExplorer();
      const r = S.fileRowByPath.get(path);
      if (r) r.scrollIntoView({ block: 'center' });
    }, none);
    row('Copy relative path', () => {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(path).catch(() => safeAsk(() => window.prompt('Copy the path:', path)));
      else safeAsk(() => window.prompt('Copy the path:', path));
    }, none);
    row('Discard edits and re-read from disk', () => { E.dirtyPaths.delete(path); void view.openFile(path, true, 0); },
      none || (E.dirtyPaths.has(path) ? null : 'This buffer has no unsaved edits.'));
    row('Close all tabs', () => {
      if (E.dirtyPaths.size && !safeAsk(() => window.confirm(`${E.dirtyPaths.size} buffer(s) have unsaved edits. Discard them and close every tab?`), false)) return;
      view.closeAllTabs();
    }, E.groups.some((g) => g && g.tabs.length) ? null : 'No tabs are open.');
    document.body.appendChild(menuEl);
    const r = moreBtn.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, r.right - menuEl.offsetWidth)}px`;
    menuEl.style.top = `${r.bottom + 4}px`;
  }
  if (moreBtn) {
    enable(moreBtn, 'More Actions — reveal, copy path, discard edits, close all');
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openMore(); });
  }
  document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('[data-editor-menu]')) closeMore(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });

  paintNav();
}
