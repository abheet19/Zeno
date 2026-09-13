/**
 * bind/forge/menu-bar.js — the File / Edit / Selection / View / Go / Run /
 * Terminal / Help menu bar, item by item.
 *
 * ui.js draws these popups (openMenu → a `div.menu` of buttons appended to
 * <body>) and gives most items either a fabricated handler (New File opened
 * a mock buffer; Save toasted "Saved to the worktree"; About printed an
 * invented build) or none at all (a "no-op in this prototype" toast). The
 * buttons carry no id or data attribute — the only handle is the popup
 * itself, so a MutationObserver catches each popup the moment ui.js appends
 * it and REPLACES every button with one wired to the registry below
 * (cloning drops ui.js's listener). An item that cannot act right now is
 * disabled with the reason written into the row, the way ui.js already
 * renders "Start Debugging — no launch.json".
 *
 * The registry is the single source for the menu bar AND for Quick Open's
 * `>` command mode (`S.listCommands`), so the palette and the menus can
 * never disagree about what a command does. Every `run` goes through `S` to
 * the module that owns the behaviour: Monaco commands via editor.js's
 * `runEditorCommand`, the terminal via terminal.js, navigation via the real
 * activity-bar/panel controls ui.js already wires.
 */
import { $, $$, el, getJSON } from '../../bind.js';
import { add, disableCtl, safeAsk } from './dom.js';

export function setupMenuBar(S) {
  const ide = S.ide;
  const click = (sel) => { const b = $(sel, ide) || $(sel); if (b) b.click(); return !!b; };
  const view = (name) => () => click(`.vsact [data-vsview="${name}"]`);
  const noEditor = () => (S.hasEditorOpen && S.hasEditorOpen() ? null : 'No file is open in the editor.');
  const noOwner = () => (S.OWNER ? null : 'This window has no owner token, so it cannot propose a write.');
  const cmd = (id) => () => S.runEditorCommand(id);
  const isDesktop = () => !!(window.zenoProject || window.zenoLocalSpeech);
  const readme = () => (S.treePaths ? S.treePaths() : []).find((p) => /^(readme|zeno)(\.md|\.txt)?$/i.test(p)) || null;

  /* ---- the registry: menu → items (label as ui.js renders it) ------------ */
  const REGISTRY = {
    File: [
      { label: 'New File', kbd: 'Ctrl+N', run: () => S.askNewFile(), disabled: noOwner },
      { label: 'New Window', kbd: 'Ctrl+Shift+N', disabled: () => 'Zeno runs in one window — a second window would carry no owner token and could approve nothing.' },
      { label: 'Open Folder…', kbd: 'Ctrl+K Ctrl+O', run: () => S.chooseProject(), disabled: () => noOwner() || (S.project && S.project.canChange === false ? S.project.changeBlockedBy : null) },
      { label: 'Save', kbd: 'Ctrl+S', run: () => S.proposeSaveFromFocusedGroup(), disabled: () => noOwner() || noEditor() },
      { label: 'Save All', kbd: 'Ctrl+K S', run: () => S.proposeSaveAll(), disabled: () => noOwner() || (S.hasDirtyBuffers && S.hasDirtyBuffers() ? null : 'No buffer has unsaved edits.') },
      { label: 'Auto Save ✓', rename: 'Auto Save', disabled: () => 'There is no auto save — every save is a proposal you make deliberately (Ctrl+S), so nothing reaches disk unnoticed.' },
      { label: 'Preferences → Settings', kbd: 'Ctrl+,', run: () => click('[data-open-settings]') },
      { label: 'Exit', kbd: 'Alt+F4', run: () => window.close(), disabled: () => (isDesktop() ? null : 'Close the browser tab to leave — a page cannot close a window it did not open.') },
    ],
    Edit: [
      { label: 'Undo', kbd: 'Ctrl+Z', run: cmd('undo'), disabled: noEditor },
      { label: 'Redo', kbd: 'Ctrl+Y', run: cmd('redo'), disabled: noEditor },
      { label: 'Cut', kbd: 'Ctrl+X', run: cmd('editor.action.clipboardCutAction'), disabled: noEditor },
      { label: 'Copy', kbd: 'Ctrl+C', run: cmd('editor.action.clipboardCopyAction'), disabled: noEditor },
      { label: 'Paste', kbd: 'Ctrl+V', run: () => S.pasteFromClipboard(), disabled: noEditor },
      { label: 'Find', kbd: 'Ctrl+F', run: cmd('actions.find'), disabled: noEditor },
      { label: 'Replace', kbd: 'Ctrl+H', run: cmd('editor.action.startFindReplaceAction'), disabled: noEditor },
      { label: 'Find in Files', kbd: 'Ctrl+Shift+F', run: view('search') },
    ],
    Selection: [
      { label: 'Select All', kbd: 'Ctrl+A', run: cmd('editor.action.selectAll'), disabled: noEditor },
      { label: 'Expand Selection', kbd: 'Shift+Alt+→', run: cmd('editor.action.smartSelect.expand'), disabled: noEditor },
      { label: 'Add Cursor Below', kbd: 'Ctrl+Alt+↓', run: cmd('editor.action.insertCursorBelow'), disabled: noEditor },
      { label: 'Select All Occurrences', kbd: 'Ctrl+Shift+L', run: cmd('editor.action.selectHighlights'), disabled: noEditor },
    ],
    View: [
      { label: 'Command Palette…', kbd: 'Ctrl+Shift+P', run: () => S.openQuick('>') },
      { label: 'Open View…', run: () => S.openQuick('>view') },
      { label: 'Explorer', kbd: 'Ctrl+Shift+E', run: view('explorer') },
      { label: 'Search', kbd: 'Ctrl+Shift+F', run: view('search') },
      { label: 'Source Control', kbd: 'Ctrl+Shift+G', run: view('scm') },
      { label: 'Extensions', kbd: 'Ctrl+Shift+X', run: view('extensions') },
      { label: 'Zeno', run: view('zeno') },
      { label: 'Terminal', kbd: 'Ctrl+`', run: () => { S.showPanel('terminal'); S.focusTerminal(); } },
      { label: 'Problems', kbd: 'Ctrl+Shift+M', run: () => S.showPanel('problems') },
      { label: 'Toggle Panel', kbd: 'Ctrl+J', run: () => click('[data-layout="panel"]') },
      { label: 'Toggle Primary Side Bar', kbd: 'Ctrl+B', run: () => click('[data-layout="side"]') },
      { label: 'Toggle Session Panel', kbd: 'Ctrl+Alt+B', run: () => click('[data-layout="sess"]') },
      { label: 'Word Wrap', kbd: 'Alt+Z', rename: () => `Word Wrap${S.editorPrefs && S.editorPrefs.wordWrap ? ' ✓' : ''}`, run: () => S.toggleWordWrap(), disabled: noEditor },
      { label: 'Minimap ✓', rename: () => `Minimap${S.editorPrefs && S.editorPrefs.minimap ? ' ✓' : ''}`, run: () => S.toggleMinimap(), disabled: noEditor },
    ],
    Go: [
      { label: 'Go to File…', kbd: 'Ctrl+P', run: () => S.openQuick('') },
      { label: 'Go to Symbol…', kbd: 'Ctrl+Shift+O', run: () => S.openQuick('@'), disabled: () => (S.currentFile ? null : 'No file is open.') },
      { label: 'Go to Line…', kbd: 'Ctrl+G', run: () => S.openQuick(':'), disabled: () => (S.currentFile ? null : 'No file is open.') },
      { label: 'Back', kbd: 'Alt+←', run: () => S.navBack(), disabled: () => (S.navState && S.navState().back ? null : 'No earlier file in this session’s history.') },
      { label: 'Forward', kbd: 'Alt+→', run: () => S.navForward(), disabled: () => (S.navState && S.navState().forward ? null : 'No later file in this session’s history.') },
      { label: 'Next Problem', kbd: 'F8', run: cmd('editor.action.marker.next'), disabled: noEditor },
      { label: 'Previous Problem', kbd: 'Shift+F8', run: cmd('editor.action.marker.prev'), disabled: noEditor },
    ],
    Run: [
      { label: 'Start Debugging', kbd: 'F5', disabled: () => 'Zeno has no debugger — there is no launch.json and no debug route.' },
      { label: 'Run Without Debugging', kbd: 'Ctrl+F5', run: () => S.runCurrentFile(), disabled: () => (S.currentFile ? null : 'No file is open to run.') },
      { label: 'Add Configuration…', disabled: () => 'Zeno has no debugger, so there is no launch.json to add a configuration to.' },
      { label: 'Run Tests', run: () => S.openTesting() },
    ],
    Terminal: [
      { label: 'New Terminal', kbd: 'Ctrl+Shift+`', run: () => { S.showPanel('terminal'); S.focusTerminal(); } },
      { label: 'Split Terminal', kbd: 'Ctrl+Shift+5', disabled: () => 'Forge has one one-shot terminal; there is no split terminal in this build.' },
      { label: 'Run Task…', run: () => S.openQuick('task ') },
      { label: 'Run Build Task…', kbd: 'Ctrl+Shift+B', run: () => S.openTesting() },
      { label: 'Run Test Task…', run: () => S.openTesting() },
    ],
    Help: [
      { label: 'Welcome', run: () => S.setForgeView('agent') },
      { label: 'Show All Commands', kbd: 'Ctrl+Shift+P', run: () => S.openQuick('>') },
      { label: 'Documentation', run: () => { const p = readme(); if (p) void S.openFile(p); }, disabled: () => (readme() ? null : 'This repository has no README to open.') },
      { label: 'Keyboard Shortcuts Reference', kbd: 'Ctrl+K Ctrl+R', run: () => openShortcuts() },
      { label: 'View Receipts', run: () => { click('.seg [data-product="command"]'); click('.product[data-product="command"] .nav-i[data-screen="receipts"]'); } },
      { label: 'About Zeno', run: () => void about() },
    ],
  };

  /* ---- the two Help items with content of their own ---------------------- */
  // Only bindings that really exist: ui.js's keydown handler, the editor's
  // own actions (editor-view.js), and the desktop app's zoom (zoom.cjs).
  const SHORTCUTS = [
    ['Ctrl+P', 'Quick Open — files; > commands · : line · @ symbols · task scripts'],
    ['Ctrl+Shift+P', 'Command palette'], ['Ctrl+B', 'Toggle the primary side bar'], ['Ctrl+J', 'Toggle the bottom panel'],
    ['Ctrl+Alt+B', 'Toggle the session panel'], ['Ctrl+`', 'Terminal'], ['Ctrl+.', 'New session'], ['Ctrl+L', 'Focus the composer'],
    ['Esc', 'Close a palette or menu'], ['Ctrl+S', 'Propose save (in the editor)'], ['Ctrl+\\', 'Split / unsplit (in the editor)'],
    ['Ctrl+= / Ctrl+- / Ctrl+0', 'Zoom (desktop app only)'],
  ];
  let sheet = null;
  function closeShortcuts() { if (sheet) { sheet.remove(); sheet = null; } }
  function openShortcuts() {
    closeShortcuts();
    sheet = el('div', 'quick');
    sheet.dataset.shortcuts = '1';
    const card = el('div', 'quick-card');
    const head = el('div', 'vsvh', 'Keyboard shortcuts — the bindings this build actually has');
    const list = el('div', 'mp-list');
    for (const [keys, what] of SHORTCUTS) {
      const r = el('div', 'mp-row');
      add(r, el('span', 'vsi', '⌨'), el('span', 'mn', what), el('kbd', null, keys));
      list.appendChild(r);
    }
    add(card, head, list);
    sheet.appendChild(card);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeShortcuts(); });
    document.body.appendChild(sheet);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShortcuts(); });
  async function about() {
    // Real build identity from /state (stamped at release, "unstamped" in a
    // dev build) — never the invented "Zeno 0.9 · release 662f5e7".
    const r = await getJSON('/state');
    const b = r.ok && r.data && r.data.build ? r.data.build : null;
    const lines = [
      `Zeno Forge — ${b && b.version ? `version ${b.version}` : 'unstamped dev build'}${b && b.sha ? ` · ${String(b.sha).slice(0, 12)}` : ''}`,
      `daemon ${location.origin}`,
      `working folder ${S.project ? S.project.root : '(not read)'}${S.project && S.project.scratch ? ' (Zeno scratch repository)' : ''}`,
      r.ok && r.data && r.data.chain ? `receipt chain ${r.data.chain.ok ? 'verified' : 'BROKEN'} · ${Array.isArray(r.data.receipts) ? r.data.receipts.length : '?'} receipts` : 'receipt chain not read',
      'Local-first. Reason before action.',
    ];
    safeAsk(() => window.alert(lines.join('\n')));
  }

  /* ---- Quick Open's command mode reads the same registry ----------------- */
  S.listCommands = () => {
    const out = [];
    for (const [menu, items] of Object.entries(REGISTRY)) {
      for (const it of items) {
        const label = typeof it.rename === 'function' ? it.rename() : (it.rename || it.label);
        const disabledReason = it.disabled ? it.disabled() : (it.run ? null : 'Not available in this build.');
        out.push({ menu, label, kbd: it.kbd || '', run: it.run || (() => {}), disabledReason });
      }
    }
    return out;
  };

  /* ---- patch each popup the moment ui.js appends it ---------------------- */
  function patchMenu(menuEl) {
    const opened = $('.tbmenu button[aria-expanded="true"]', ide);
    const items = opened ? REGISTRY[opened.textContent.trim()] : null;
    if (!items) return;
    for (const btn of $$('button', menuEl)) {
      const label = (btn.childNodes[0] && btn.childNodes[0].nodeType === Node.TEXT_NODE ? btn.childNodes[0].textContent : btn.textContent).trim();
      const it = items.find((x) => x.label === label);
      if (!it) continue; // ui.js changed a label: leave its own handler in place rather than throw
      const fresh = el('button');
      fresh.type = 'button';
      fresh.dataset.cmd = `${opened.textContent.trim()}:${it.label}`;
      const shown = typeof it.rename === 'function' ? it.rename() : (it.rename || it.label);
      const reason = it.disabled ? it.disabled() : (it.run ? null : 'Not available in this build.');
      add(fresh, document.createTextNode(shown));
      if (reason) {
        const why = el('span', null, ` — ${reason}`);
        why.style.cssText = 'color:var(--ink-3);font-size:11px';
        add(fresh, why);
        disableCtl(fresh, reason);
      } else {
        fresh.addEventListener('click', () => {
          // Close the popup through ui.js's OWN document listener (a click
          // outside `.menu`), so its private `menuEl` is cleared too — removing
          // the node ourselves would leave ui.js believing a menu is still
          // open, and hovering the bar would then pop menus without a click.
          document.body.click();
          void it.run();
        });
      }
      if (it.kbd) add(fresh, el('kbd', null, it.kbd));
      btn.replaceWith(fresh);
    }
  }
  new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains('menu') && !n.dataset.projectMenu && !n.dataset.editorMenu && !n.dataset.contextMenu) patchMenu(n);
      }
    }
  }).observe(document.body, { childList: true });
}
