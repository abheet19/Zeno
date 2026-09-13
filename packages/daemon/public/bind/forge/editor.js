/**
 * bind/forge/editor.js — the REAL Monaco editor (regression repair).
 *
 * The artifact shipped a static mock here: a hardcoded sample buffer inside
 * #vs-code, four decorative .vstab elements, and a fabricated "held" diff in
 * #vs-pane2. Zeno's real editor is VS Code's own editor core, served from
 * this machine by monaco.js — loadMonaco()/ZENO_THEME/languageForPath/
 * DIAGNOSED/onThemeChange are imported from it UNCHANGED rather than
 * reimplemented. Nothing here invents a language, a theme colour, or a
 * "which languages are really checked" answer — monaco.js still owns every
 * one of those facts.
 *
 * A SAVE IS STILL A PROPOSAL, NEVER A WRITE. "Propose save" (or Ctrl+S inside
 * the editor) POSTs the buffer to /previews with requestedBy:'forge-editor'
 * — the SAME gate the real forge.js's editor and an agent's own write both
 * cross. A routine (T0) edit comes back already committed with a receipt;
 * anything larger, or anything touching a sensitive path, comes back as a
 * capsule the daemon is HOLDING, and this pane says exactly that — it never
 * claims a hold is a save. There is no path from here to disk that skips
 * that gate.
 *
 * This module owns the model/mount/save/split layer; forge/editor-view.js
 * owns the tab strip, the panes' honest empty/loading/binary messages, and
 * open/close-file bookkeeping; forge/editor-toolbar.js owns the toolbar
 * buttons around them. `E` is their shared local state: groups, models,
 * dirtyPaths, fileCache, monacoNS/monacoErr, focusedGroup, splitOpen, pane2El.
 *
 * Registers, for the menu bar / Quick Open / context pins: `S.runEditorCommand`
 * (any Monaco action by id — undo, find, select all, …), `S.pasteFromClipboard`,
 * `S.goToLine`, `S.currentFileText`/`S.currentFileLineCount` (the outline's
 * input), `S.selectionContext` (what "pin the selection" pins),
 * `S.proposeSaveAll`, and the two editor preferences (`S.toggleWordWrap`,
 * `S.toggleMinimap`, `S.editorPrefs`).
 */
import { $, el, fill } from '../../bind.js';
import { add, postJSON, safeAsk } from './dom.js';
import { createEditorView } from './editor-view.js';
import { setupEditorToolbar } from './editor-toolbar.js';
import {
  DIAGNOSED, ZENO_THEME, languageForPath, loadMonaco, monacoIfLoaded, onThemeChange,
} from '../../monaco.js';

export function setupEditor(S) {
  const E = {
    groups: [],
    models: new Map(),      // path -> monaco ITextModel, shared by both groups — a real
                             // split shows the SAME document, exactly like VS Code's own.
    dirtyPaths: new Set(),  // paths whose buffer differs from the bytes /forge/file gave us
    fileCache: new Map(),   // path -> {data,error}
    monacoNS: monacoIfLoaded(),
    monacoErr: null,
    focusedGroup: 0,
    splitOpen: false,
    pane2El: null,
  };
  let monacoLoadPromise = null;
  let saving = false;
  let saveErr = null;
  // Two real editor preferences the View menu toggles. Applied to every
  // group that exists and to every editor created later.
  S.editorPrefs = { wordWrap: false, minimap: true };

  function ensureMonaco() {
    if (E.monacoNS) return Promise.resolve(E.monacoNS);
    if (!monacoLoadPromise) {
      monacoLoadPromise = loadMonaco().then(
        (m) => { E.monacoNS = m; return m; },
        (err) => {
          E.monacoErr = err instanceof Error ? err : new Error(String((err && err.message) || err));
          throw E.monacoErr;
        },
      );
    }
    return monacoLoadPromise;
  }

  // `mountRealEditor`/`paintSaveBar`/`proposeSave`/`setSplit` are function
  // declarations below — hoisted within this scope, so passing the bare
  // identifiers here (before their textual definition) is safe: none of
  // them runs until a file actually opens, well after this call returns.
  const view = createEditorView(E, S, { ensureMonaco, mountRealEditor, paintSaveBar, proposeSave, setSplit });
  setupEditorToolbar(E, S, view);

  /* ---- monaco itself: one model per path, one editor per group ---------- */

  function modelFor(path, text, eol) {
    const monacoNS = E.monacoNS;
    const uri = monacoNS.Uri.parse(`zeno-sandbox:/${String(path).replace(/^\/+/, '')}`);
    let model = E.models.get(path);
    if (!model || model.isDisposed()) {
      model = monacoNS.editor.getModel(uri) || monacoNS.editor.createModel(text ?? '', languageForPath(path) || undefined, uri);
      E.models.set(path, model);
    } else if (!E.dirtyPaths.has(path) && model.getValue(monacoNS.editor.EndOfLinePreference.LF) !== (text ?? '')) {
      // Only ever overwrite a CLEAN buffer — a repaint must never discard
      // edits nobody asked to discard.
      model.setValue(text ?? '');
    }
    model.setEOL(eol === 'CRLF' ? monacoNS.editor.EndOfLineSequence.CRLF : monacoNS.editor.EndOfLineSequence.LF);
    return model;
  }

  function updateDirty(path) {
    const model = E.models.get(path);
    const rec = E.fileCache.get(path);
    if (!model || !rec || !rec.data) return;
    const disk = rec.data.contents ?? '';
    if (model.getValue(E.monacoNS.editor.EndOfLinePreference.LF) === disk) E.dirtyPaths.delete(path);
    else E.dirtyPaths.add(path);
  }

  let outlineTimer = 0;
  function mountRealEditor(g, path, data) {
    const monacoNS = E.monacoNS;
    if (!g.editor) {
      g.editor = monacoNS.editor.create(g.mon, {
        theme: ZENO_THEME,
        automaticLayout: true,
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: S.editorPrefs.minimap, renderCharacters: false },
        wordWrap: S.editorPrefs.wordWrap ? 'on' : 'off',
        folding: true,
        contextmenu: true,
        renderWhitespace: 'selection',
        scrollBeyondLastLine: false,
        fixedOverflowWidgets: true,
        tabSize: 2,
      });
      view.registerEditorActions(g);
      g.editor.onDidFocusEditorWidget(() => { E.focusedGroup = view.groupIndexOf(g); paintSaveBar(); });
      g.editor.onDidChangeModelContent(() => {
        const p = g.file;
        if (!p) return;
        updateDirty(p);
        view.renderGroupTabs(g);
        paintSaveBar();
        // The outline follows the buffer, not the disk — debounced per keystroke.
        clearTimeout(outlineTimer);
        outlineTimer = setTimeout(() => { if (S.renderOutline && g === E.groups[0]) S.renderOutline(); }, 400);
      });
    }
    const priorModel = g.editor.getModel();
    if (g.mountedPath && g.mountedPath !== path && priorModel) g.viewStates.set(g.mountedPath, g.editor.saveViewState());
    const model = modelFor(path, data.contents ?? '', data.eol);
    if (priorModel !== model) {
      g.editor.setModel(model);
      const vs = g.viewStates.get(path);
      if (vs) g.editor.restoreViewState(vs);
    }
    g.mountedPath = path;
    // A re-mount after the disk moved (an approved write landing) must settle
    // the dirty mark from the NEW bytes, not the ones the tab was opened with.
    updateDirty(path);
    view.renderGroupTabs(g);
    const ro = !S.OWNER
      ? 'This window has no owner token, so it can read the repository but cannot propose a change to it.'
      : (data.truncated ? 'Only part of this file was read (it is truncated), so saving would propose it with the rest cut off.' : null);
    g.editor.updateOptions({ readOnly: ro !== null, readOnlyMessage: ro ? { value: ro } : undefined });
  }

  /* ---- the save, still a proposal, never a write ------------------------ */

  const vsBlame = $('.vsblame');
  const splitBtn = $('#vs-split');

  function paintSaveBar() {
    if (!vsBlame) return;
    const g = E.groups[E.focusedGroup];
    fill(vsBlame);
    if (!g || !g.file) { vsBlame.hidden = true; return; }
    vsBlame.hidden = false;
    if (E.monacoErr) { add(vsBlame, el('span', null, `plain view — ${E.monacoErr.message}`)); return; }
    if (!E.monacoNS) { add(vsBlame, el('span', null, 'loading the real editor…')); return; }
    const model = E.models.get(g.file);
    const lang = model ? model.getLanguageId() : null;
    if (lang) add(vsBlame, el('span', null, lang === 'plaintext' ? 'plain text' : lang));
    if (lang && model && DIAGNOSED.has(lang)) {
      const marks = E.monacoNS.editor.getModelMarkers({ resource: model.uri });
      const errs = marks.filter((m) => m.severity === E.monacoNS.MarkerSeverity.Error).length;
      add(vsBlame, document.createTextNode(errs ? ` · ${errs} ${errs === 1 ? 'error' : 'errors'}` : ' · no syntax errors'));
    }
    const rec = E.fileCache.get(g.file);
    const data = rec && rec.data;
    const ro = !S.OWNER
      ? 'read-only — no owner token'
      : (data && data.truncated ? 'read-only — file truncated on read' : null);
    if (ro) {
      add(vsBlame, document.createTextNode(` · ${ro}`));
    } else {
      const dirty = E.dirtyPaths.has(g.file);
      if (dirty) add(vsBlame, document.createTextNode(' · unsaved edits'));
      const saveBtn = el('button', 'laction cy', saving ? 'Proposing…' : 'Propose save');
      saveBtn.type = 'button';
      saveBtn.disabled = saving || !dirty;
      saveBtn.title = 'Ctrl+S. Sends the buffer to /previews — the same governed gate an agent write crosses. This never writes to the repository directly.';
      saveBtn.addEventListener('click', () => void proposeSave(g));
      add(vsBlame, document.createTextNode(' '), saveBtn);
    }
    if (saveErr) add(vsBlame, document.createTextNode(` · ${saveErr}`));
  }

  /** Propose one path's buffer; `g` is the group to re-open it in once a receipt lands. */
  async function proposeSavePath(path, g) {
    if (!path || saving || !S.OWNER || !E.monacoNS) return;
    const model = E.models.get(path);
    if (!model) return;
    const rec = E.fileCache.get(path);
    const data = rec && rec.data;
    if (data && data.truncated) return; // read-only: this buffer is not the whole file
    const disk = (data && data.contents) ?? '';
    if (model.getValue(E.monacoNS.editor.EndOfLinePreference.LF) === disk) return; // nothing to propose
    const contents = model.getValue(); // the file's own line endings, not forced to LF

    saving = true;
    saveErr = null;
    paintSaveBar();

    const r = await postJSON('/previews', {
      relPath: path,
      contents,
      summary: `Forge editor: edit ${path}`,
      requestedBy: 'forge-editor',
    });
    saving = false;

    if (!r.ok) {
      saveErr = `not proposed: ${r.error || 'unknown error'}`;
      paintSaveBar();
      return;
    }
    const preview = r.data && r.data.preview;
    if (!preview || typeof preview.actionHash !== 'string') {
      saveErr = 'the daemon answered without a preview, so nothing can be shown for this save.';
      paintSaveBar();
      return;
    }
    const receipt = r.data.receipt || null;
    const secretNote = r.data.secretWarning ? ` ${r.data.secretWarning}` : '';
    if (receipt) {
      // A routine (T0) edit: the kernel committed and receipted it on the
      // spot. The buffer now matches the repository — re-read it and clear dirty.
      E.dirtyPaths.delete(path);
      saveErr = r.data.secretWarning ? String(r.data.secretWarning) : null;
      void S.loadStatus();
      void view.openFile(path, true, g ? view.groupIndexOf(g) : 0);
    } else {
      // Anything larger, or touching a sensitive path, is a capsule the
      // daemon is now HOLDING — an approval, never a write. The buffer stays
      // dirty until the owner approves it in Command.
      saveErr = `held for approval (tier ${preview.tier || '?'}) — open Command → Approvals to decide.${secretNote}`;
    }
    paintSaveBar();
  }
  async function proposeSave(g) { if (g && g.file) await proposeSavePath(g.file, g); }

  /* ---- split control: a second, independent Monaco group ---------------- */

  function setSplit(open) {
    if (!E.groups[1]) return;
    E.splitOpen = Boolean(open);
    E.pane2El.hidden = !E.splitOpen;
    if (splitBtn) splitBtn.setAttribute('aria-pressed', E.splitOpen ? 'true' : 'false');
    view.renderGroupTabs(E.groups[0]); // the primary strip gains/loses the "open to the side" control
    if (E.splitOpen) {
      E.focusedGroup = 1;
      const seed = E.groups[1].file || E.groups[0].file;
      if (seed) {
        void view.openFile(seed, false, 1);
      } else {
        view.renderGroupTabs(E.groups[1]);
        view.renderEditorEmptyIn(E.groups[1], 'No file open in this group yet. Use ⇄ on a primary tab to open it here too.');
      }
    } else {
      E.focusedGroup = 0;
    }
    paintSaveBar();
    requestAnimationFrame(() => {
      if (E.groups[0].editor) E.groups[0].editor.layout();
      if (E.groups[1] && E.groups[1].editor) E.groups[1].editor.layout();
    });
  }
  if (splitBtn) splitBtn.addEventListener('click', () => setSplit(!E.splitOpen));

  /* ---- register what other Forge modules call through S ----------------- */

  S.openFile = view.openFile;
  S.renderEditorEmpty = view.renderEditorEmpty;
  S.revealLineInPrimaryGroup = (path, line) => {
    const g = E.groups[0];
    if (g && g.editor && g.file === path) {
      g.editor.revealLineInCenter(line);
      g.editor.setPosition({ lineNumber: line, column: 1 });
      g.editor.focus();
    }
  };
  S.goToLine = (line) => { if (S.currentFile) S.revealLineInPrimaryGroup(S.currentFile, Math.max(1, line | 0)); };
  S.proposeSaveFromFocusedGroup = () => {
    const g = E.groups[E.focusedGroup];
    if (g && g.file) void proposeSave(g); else safeAsk(() => window.alert('No file is open to save.'));
  };
  S.proposeSaveAll = async () => {
    const dirty = [...E.dirtyPaths];
    if (!dirty.length) { safeAsk(() => window.alert('No buffer has unsaved edits.')); return; }
    for (const path of dirty) {
      const g = E.groups.find((x) => x && x.tabs.includes(path)) || E.groups[0];
      await proposeSavePath(path, g); // one at a time: each is its own capsule
    }
  };
  S.hasDirtyBuffers = () => E.dirtyPaths.size > 0;

  /** The editor a menu command should act on: the focused group's, if it shows a file. */
  function focusedEditor() {
    const g = E.groups[E.focusedGroup] && E.groups[E.focusedGroup].file ? E.groups[E.focusedGroup] : E.groups[0];
    return g && g.editor && g.file && g.editor.getModel() ? g.editor : null;
  }
  S.hasEditorOpen = () => focusedEditor() !== null;
  S.runEditorCommand = (id, payload) => {
    const ed = focusedEditor();
    if (!ed) return false;
    ed.focus();
    const action = ed.getAction(id);
    if (action) void action.run(); else ed.trigger('menu', id, payload === undefined ? null : payload);
    return true;
  };
  // Monaco's own paste action reads the clipboard through execCommand, which a
  // browser refuses outside a real keystroke; the async clipboard API is the
  // path a menu click has, and its refusal is said out loud rather than eaten.
  S.pasteFromClipboard = async () => {
    const ed = focusedEditor();
    if (!ed) return false;
    try {
      const text = await navigator.clipboard.readText();
      ed.focus();
      ed.trigger('menu', 'paste', { text });
      return true;
    } catch (err) {
      safeAsk(() => window.alert(`The browser refused to hand over the clipboard (${(err && err.message) || err}). Use Ctrl+V inside the editor instead.`));
      return false;
    }
  };
  S.currentFileText = () => {
    const path = S.currentFile;
    if (!path) return null;
    const model = E.models.get(path);
    if (model && !model.isDisposed() && E.monacoNS) return model.getValue(E.monacoNS.editor.EndOfLinePreference.LF);
    const rec = E.fileCache.get(path);
    return rec && rec.data && !rec.data.binary ? (rec.data.contents ?? '') : null;
  };
  S.currentFileLineCount = () => {
    const text = S.currentFileText();
    return text === null ? null : text.split('\n').length;
  };
  /** {path, text, startLine, endLine} for the focused editor's selection (or its current line), else null. */
  S.selectionContext = () => {
    const ed = focusedEditor();
    if (!ed) return null;
    const g = E.groups.find((x) => x && x.editor === ed);
    const sel = ed.getSelection();
    const model = ed.getModel();
    if (!sel || !model || !g) return null;
    const empty = sel.isEmpty();
    const text = empty ? model.getLineContent(sel.startLineNumber) : model.getValueInRange(sel);
    return { path: g.file, text, startLine: sel.startLineNumber, endLine: empty ? sel.startLineNumber : sel.endLineNumber };
  };
  function applyPrefs() {
    for (const g of E.groups) {
      if (g && g.editor) g.editor.updateOptions({ wordWrap: S.editorPrefs.wordWrap ? 'on' : 'off', minimap: { enabled: S.editorPrefs.minimap, renderCharacters: false } });
    }
  }
  S.toggleWordWrap = () => { S.editorPrefs.wordWrap = !S.editorPrefs.wordWrap; applyPrefs(); return S.editorPrefs.wordWrap; };
  S.toggleMinimap = () => { S.editorPrefs.minimap = !S.editorPrefs.minimap; applyPrefs(); return S.editorPrefs.minimap; };

  // One kick at init, matching real forge.js: load monaco once, up front,
  // rather than waiting for the first file open to discover whether it works.
  void ensureMonaco().then(
    () => { onThemeChange(() => paintSaveBar()); },
    () => { paintSaveBar(); },
  );
}
