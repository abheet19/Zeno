/**
 * bind/forge/editor-view.js — the Monaco editor's tab strip, panes and
 * open/close-file flow.
 *
 * Split out of forge/editor.js: this file owns what each pane SHOWS (the
 * real editor host vs. an honest message; the tab strip; the breadcrumb) and
 * the bookkeeping around opening/closing a file. forge/editor.js keeps what
 * happens TO the model underneath (mounting Monaco itself, dirty tracking,
 * "propose save", the split toggle) — those two halves call each other
 * constantly (opening a file has to mount Monaco; mounting Monaco has to
 * paint the save bar; the save bar's "propose save" has to re-open the file
 * once the save lands), so editor.js hands this module the few functions it
 * needs as `deps` rather than this module importing editor.js back (which
 * would make the two files an import cycle).
 *
 * `E` is the two files' shared local state (see forge/editor.js for the
 * shape): groups, models, dirtyPaths, fileCache, monacoNS/monacoErr,
 * focusedGroup, splitOpen. `S` is the cross-module Forge state from
 * forge/state.js (OWNER, currentFile, renderFileStatusBits).
 */
import { $, $$, el, fill, getJSON, setText } from '../../bind.js';
import { add, bytesLabel, fileMeta } from './dom.js';
import { plainFallbackNodes } from './editor-highlight.js';

export function createEditorView(E, S, deps) {
  const tabBar = $('.vsed .vstabs');
  const tabSpacer = tabBar ? tabBar.querySelector('.fgrow') : null;
  // Drop the artifact's four mock tabs (App.tsx/ingest.ts/…) — never left
  // standing as if they were the workspace's real open files.
  if (tabBar) $$('.vstab', tabBar).forEach((t) => t.remove());

  // A real navigation history for the primary group: every file opened
  // there, in order. "Go Back"/"Go Forward" (toolbar, title bar, Go menu)
  // walk it. `moving` keeps a Back from re-recording the file it returns to.
  const nav = { list: [], idx: -1, moving: false };
  function recordNav(path) {
    if (nav.moving || nav.list[nav.idx] === path) return;
    nav.list.splice(nav.idx + 1);
    nav.list.push(path);
    nav.idx = nav.list.length - 1;
  }
  async function navTo(delta) {
    const next = nav.idx + delta;
    if (next < 0 || next >= nav.list.length) return;
    nav.idx = next;
    nav.moving = true;
    try { await openFile(nav.list[next], false, 0); } finally { nav.moving = false; }
    if (S.paintNav) S.paintNav();
  }
  S.navBack = () => navTo(-1);
  S.navForward = () => navTo(1);
  S.navState = () => ({ back: nav.idx > 0, forward: nav.idx < nav.list.length - 1 });

  function groupIndexOf(g) { return g === E.groups[0] ? 0 : 1; }

  /** Build one Monaco group: a real editor host plus a message pane shown
   *  instead of it (loading / failed / empty / binary / read-only), and the
   *  group's own tabs, active file and per-file view state. `withHeader`
   *  builds group 2's own small header (its tab strip + an unsplit button);
   *  group 1 has no header — its tabs render into the artifact's existing
   *  .vstabs bar instead. */
  function makeGroup(paneEl, withHeader) {
    if (!paneEl) return null;
    fill(paneEl); // drop the mock content this pane shipped with (sample source, or a stale diff)
    const g = {
      paneEl, index: null, tabsHost: null, tabSpacer: null, mon: null, aux: null, trunc: null,
      editor: null, tabs: [], file: null, viewStates: new Map(), mountedPath: null,
    };
    if (withHeader) {
      const header = el('div', 'vspaneh');
      g.tabsHost = el('div', 'vstabs');
      g.tabsHost.setAttribute('role', 'tablist');
      g.tabsHost.style.cssText = 'height:auto;border-bottom:0;background:none;flex:1;min-width:0;overflow:auto hidden;';
      const unsplitBtn = el('button', 'fico', '✕ Unsplit');
      unsplitBtn.type = 'button';
      unsplitBtn.title = 'Close this split';
      unsplitBtn.addEventListener('click', () => deps.setSplit(false));
      add(header, g.tabsHost, unsplitBtn);
      add(paneEl, header);
    }
    g.mon = el('div', 'edmon');
    g.mon.style.cssText = 'flex:1;min-height:0;';
    g.mon.hidden = true;
    g.aux = el('div', 'edaux');
    g.aux.style.cssText = 'flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;'
      + 'padding:10px 14px;font-family:var(--font-mono);font-size:12.5px;line-height:1.6;'
      + 'color:var(--ink-2);white-space:pre-wrap;';
    g.trunc = el('div', 'vsnote');
    g.trunc.hidden = true;
    add(paneEl, g.mon, g.aux, g.trunc);
    paneEl.addEventListener('pointerdown', () => { E.focusedGroup = g.index; deps.paintSaveBar(); });
    return g;
  }

  const codeMock = $('#vs-code');
  const vsPaneEl = codeMock ? codeMock.closest('.vspane') : null;
  const pane2El = $('#vs-pane2');
  E.pane2El = pane2El;
  E.groups = [makeGroup(vsPaneEl, false), makeGroup(pane2El, true)];
  if (E.groups[0]) { E.groups[0].index = 0; E.groups[0].tabsHost = tabBar; E.groups[0].tabSpacer = tabSpacer; }
  if (E.groups[1]) E.groups[1].index = 1;
  if (pane2El) pane2El.hidden = true; // shown only once the split control turns it on

  /* ---- tabs, per group -------------------------------------------------- */

  function renderGroupTabs(g) {
    if (!g || !g.tabsHost) return;
    $$('[data-real-tab]', g.tabsHost).forEach((n) => n.remove());
    const isPrimary = g === E.groups[0];
    for (const path of g.tabs) {
      const name = path.split('/').pop();
      const [cls, txt] = fileMeta(name);
      const tab = el('button', 'vstab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset.realTab = path;
      tab.setAttribute('aria-selected', path === g.file ? 'true' : 'false');
      const dirty = el('span', 'vsdirty', '●');
      dirty.hidden = !E.dirtyPaths.has(path);
      add(tab, el('span', cls, txt), document.createTextNode(name), dirty);
      let sideBtn = null;
      if (isPrimary && E.splitOpen && E.groups[1]) {
        sideBtn = el('span', 'x', '⇄');
        sideBtn.title = 'Open in the split group too';
        add(tab, sideBtn);
      }
      const closeBtn = el('span', 'x', '×');
      add(tab, closeBtn);
      tab.addEventListener('click', (e) => {
        if (e.target === closeBtn) { e.stopPropagation(); closeGroupTab(g, path); return; }
        if (sideBtn && e.target === sideBtn) { e.stopPropagation(); E.focusedGroup = 1; void openFile(path, false, 1); return; }
        E.focusedGroup = isPrimary ? 0 : 1;
        void openFile(path, false, E.focusedGroup);
      });
      if (g.tabSpacer) g.tabsHost.insertBefore(tab, g.tabSpacer); else g.tabsHost.appendChild(tab);
    }
  }

  function closeGroupTab(g, path) {
    const idx = g.tabs.indexOf(path);
    if (idx === -1) return;
    const elsewhereOpen = E.groups.some((other) => other && other !== g && other.tabs.includes(path));
    if (E.dirtyPaths.has(path) && !elsewhereOpen) {
      const discard = window.confirm(`"${path}" has unsaved edits.\n\nDiscard them and close the tab?`);
      if (!discard) return;
    }
    g.tabs.splice(idx, 1);
    g.viewStates.delete(path);
    const groupIndex = groupIndexOf(g);
    if (g.file === path) {
      const next = g.tabs[idx] || g.tabs[idx - 1] || null;
      if (next) {
        void openFile(next, false, groupIndex);
      } else {
        g.file = null;
        if (groupIndex === 0) S.currentFile = null;
        renderGroupTabs(g);
        renderEditorEmptyIn(g, 'No file open. Pick one from the Explorer.');
      }
    } else {
      renderGroupTabs(g);
    }
    if (!elsewhereOpen) {
      E.dirtyPaths.delete(path);
      const model = E.models.get(path);
      if (model && !model.isDisposed()) {
        for (const other of E.groups) if (other && other.editor && other.editor.getModel() === model) other.editor.setModel(null);
        model.dispose();
      }
      E.models.delete(path);
    }
  }

  /* ---- what each pane shows: the real editor, or an honest message ------ */

  function showAux(g, nodes) {
    if (!g) return;
    if (g.mon) g.mon.hidden = true;
    g.aux.hidden = false;
    fill(g.aux, ...nodes);
  }
  function showEditorHost(g) {
    if (!g) return;
    g.aux.hidden = true;
    if (g.mon) { g.mon.hidden = false; if (g.editor) g.editor.layout(); }
  }

  /** The repository's own name for the breadcrumb and the command-centre label — never a fixed "sandbox". */
  const repoName = () => (S.project && S.project.name) || (S.statusData && S.statusData.root ? String(S.statusData.root).split(/[\\/]/).filter(Boolean).pop() : 'repository');

  function renderBreadcrumb(path) {
    const bc = $('.vscrumbs');
    if (!bc) return;
    const parts = path.split('/');
    const nodes = [el('span', null, repoName())];
    for (let i = 0; i < parts.length - 1; i++) { nodes.push(el('i', null, '›')); nodes.push(el('span', null, parts[i])); }
    nodes.push(el('i', null, '›'));
    const [cls, txt] = fileMeta(parts[parts.length - 1]);
    nodes.push(el('span', cls, txt));
    const nameB = el('b', null, parts[parts.length - 1]);
    nameB.id = 'vs-crumb';
    nodes.push(nameB);
    fill(bc, ...nodes);
    setText('#tb-cmd', `${repoName()} — ${path}`);
  }

  function renderEditorEmptyIn(g, message) {
    if (!g) return;
    if (g.editor) g.editor.setModel(null);
    // `message` is usually a string, but the Forge welcome (explorer-project.js)
    // passes a whole DOM node so it can render its Open-project actions here.
    showAux(g, [message instanceof Node ? message : el('span', null, message)]);
    if (g.trunc) g.trunc.hidden = true;
    if (g === E.groups[0]) {
      const bc = $('.vscrumbs');
      if (bc) fill(bc, el('span', null, repoName()));
      setText('#tb-cmd', repoName());
      S.renderFileStatusBits('', null);
      if (S.renderOutline) S.renderOutline();
      if (S.paintNav) S.paintNav();
    }
    deps.paintSaveBar();
  }

  /** Close every tab in every group — the working folder changed, so none of them exists any more. */
  function closeAllTabs() {
    for (const g of E.groups) {
      if (!g) continue;
      g.tabs = [];
      g.file = null;
      g.viewStates.clear();
      g.mountedPath = null;
      if (g.editor) g.editor.setModel(null);
      renderGroupTabs(g);
      renderEditorEmptyIn(g, 'No file open. Pick one from the Explorer.');
    }
    for (const m of E.models.values()) if (m && !m.isDisposed()) m.dispose();
    E.models.clear();
    E.dirtyPaths.clear();
    E.fileCache.clear();
    nav.list = []; nav.idx = -1;
    S.currentFile = null;
    if (S.paintNav) S.paintNav();
  }
  S.closeAllTabs = closeAllTabs;

  /** Re-read the primary file from the daemon WITHOUT the "Reading…" flash,
   *  and re-mount only when the bytes on disk actually differ — this is what
   *  the live `zeno:state` nudge calls after an approval lands. */
  async function refreshOpenFile() {
    const g = E.groups[0];
    const path = g && g.file;
    if (!path) return;
    const r = await getJSON(`/forge/file?path=${encodeURIComponent(path)}`);
    if (!r.ok || g.file !== path) return;
    const prev = E.fileCache.get(path);
    if (prev && prev.data && prev.data.contents === r.data.contents && prev.data.truncated === r.data.truncated) return; // nothing moved
    E.fileCache.set(path, { data: r.data, error: null });
    await renderEditorContent(g, path);
    if (S.renderOutline) S.renderOutline();
  }
  S.refreshOpenFile = refreshOpenFile;

  function renderEditorEmpty(message) {
    S.currentFile = null;
    if (!E.groups[0]) return;
    E.groups[0].file = null;
    renderGroupTabs(E.groups[0]);
    renderEditorEmptyIn(E.groups[0], message);
  }

  async function renderEditorContent(g, path) {
    const rec = E.fileCache.get(path);
    if (!rec) return;
    if (g === E.groups[0]) S.renderFileStatusBits(path, rec.data);
    if (rec.error) { showAux(g, [el('span', null, rec.error)]); if (g.trunc) g.trunc.hidden = true; deps.paintSaveBar(); return; }
    const data = rec.data;
    if (!data) { showAux(g, [el('span', null, `${path} could not be read.`)]); if (g.trunc) g.trunc.hidden = true; deps.paintSaveBar(); return; }
    if (data.binary) {
      if (g.editor) g.editor.setModel(null);
      showAux(g, [el('span', null, `${path} is a binary file (${bytesLabel(data.bytes)}) — not shown.`)]);
      if (g.trunc) g.trunc.hidden = true;
      deps.paintSaveBar();
      return;
    }
    if (g.trunc) {
      if (data.truncated) {
        g.trunc.hidden = false;
        g.trunc.textContent = `Showing the first ${String(data.contents ?? '').split('\n').length} of ${data.lines} lines — the file continues.`;
      } else {
        g.trunc.hidden = true;
      }
    }

    if (!E.monacoNS && !E.monacoErr) {
      showAux(g, plainFallbackNodes(path, data, 'Loading the real editor…'));
      try { await deps.ensureMonaco(); } catch { /* monacoErr is now set; handled just below */ }
      if (g.file !== path) return; // a later open superseded this one while monaco was loading
    }
    if (E.monacoErr) {
      showAux(g, plainFallbackNodes(path, data, `The real editor could not load — ${E.monacoErr.message}`));
      deps.paintSaveBar();
      return;
    }

    deps.mountRealEditor(g, path, data);
    showEditorHost(g);
    deps.paintSaveBar();
  }

  /* ---- editor context-menu actions (save / discard / split) ------------- */

  function registerEditorActions(g) {
    const editor = g.editor;
    const monacoNS = E.monacoNS;
    if (!monacoNS || !editor) return;
    editor.addAction({
      id: 'zeno.proposeSave',
      label: 'Propose this save to the kernel',
      keybindings: [monacoNS.KeyMod.CtrlCmd | monacoNS.KeyCode.KeyS],
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 1,
      run: () => { void deps.proposeSave(g); },
    });
    editor.addAction({
      id: 'zeno.discard',
      label: 'Discard these edits and re-read the file from the workspace',
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 2,
      run: () => {
        const path = g.file;
        if (!path) return;
        E.dirtyPaths.delete(path);
        void openFile(path, true, groupIndexOf(g));
      },
    });
    editor.addAction({
      id: 'zeno.splitEditor',
      label: 'Split or unsplit editor',
      keybindings: [monacoNS.KeyMod.CtrlCmd | monacoNS.KeyCode.Backslash],
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 3,
      run: () => deps.setSplit(!E.splitOpen),
    });
  }

  /* ---- open/close a file, in a given group (group 0 unless said otherwise) */

  async function openFile(path, force, groupIndex = 0) {
    if (!path) return;
    const g = E.groups[groupIndex];
    if (!g) return;
    if (groupIndex === 0) { S.currentFile = path; recordNav(path); }
    if (force) E.fileCache.delete(path);
    if (!g.tabs.includes(path)) g.tabs.push(path);
    g.file = path;
    renderGroupTabs(g);
    if (groupIndex === 0) {
      renderBreadcrumb(path);
      S.fileRowByPath.forEach((row, p) => row.classList.toggle('on', p === path));
      if (S.paintNav) S.paintNav();
    }
    if (!E.fileCache.has(path)) {
      showAux(g, [el('span', null, `Reading ${path}…`)]);
      const r = await getJSON(`/forge/file?path=${encodeURIComponent(path)}`);
      E.fileCache.set(path, r.ok ? { data: r.data, error: null } : { data: null, error: `${path} could not be read: ${r.error}` });
      if (g.file !== path) return; // a later open superseded this one
    }
    await renderEditorContent(g, path);
    if (groupIndex === 0 && g.file === path) {
      // The sidebar follows the primary file: its symbols and its git history.
      if (S.renderOutline) S.renderOutline();
      if (S.renderTimeline) void S.renderTimeline();
    }
  }

  return {
    groupIndexOf,
    renderGroupTabs,
    closeGroupTab,
    closeAllTabs,
    showAux,
    showEditorHost,
    renderBreadcrumb,
    renderEditorEmptyIn,
    renderEditorEmpty,
    renderEditorContent,
    registerEditorActions,
    openFile,
  };
}
