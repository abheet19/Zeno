/**
 * bind/forge/menu.js — the composer "+" context menu and the menu-bar items
 * that actively LIE.
 *
 * ui.js's own PLUS_ITEMS menu draws twelve real-looking rows and answers
 * every single one with a toast that just repeats the row's own description
 * back — none of them do anything. Both anchors are taken over here
 * (cloneReplace, dropping ui.js's listener) and a real menu is built in its
 * place, reusing ui.js's own `.plus-menu`/`.plus-item` classes so it looks
 * identical. Six items now do something real — open the real Quick Open
 * file list, jump to a real sidebar view that already reads live daemon
 * data (Zeno/SCM), or focus the real terminal; the rest are disabled with
 * the honest reason there is no backing capability for them in this build.
 *
 * Most of ui.js's File/Edit/Selection/View/Go/Run/Terminal/Help menu either
 * does real navigation already, or shows an honest "no-op in this
 * prototype" toast for an item with no handler. A handful of items are
 * different: they DO something, and what they do is fabricated — those are
 * replaced below (MENU_FAKES) by a capturing listener that intercepts the
 * click by the popup item's own rendered text before ui.js's per-item
 * listener can fire.
 *
 * This module only wires UI; every action it triggers is owned by another
 * Forge module and reached through `S` (explorer.js's proposeNewFile,
 * editor.js's proposeSaveFromFocusedGroup, terminal.js's showPanel/
 * runTerminalCommand/focusTerminal).
 */
import { $, $$, el } from '../../bind.js';
import {
  add, cloneReplace, disableCtl, safeAsk,
} from './dom.js';

export function setupMenu(S) {
  const ide = S.ide;

  /* ============================================================ *
   * COMPOSER "+" CONTEXT MENU (ag-plus / s-attach)                 *
   * ============================================================ */
  function goVsview(name) {
    const btn = $(`.vsact [data-vsview="${name}"]`, ide);
    if (btn) btn.click();
  }
  const PLUS_ITEMS_REAL = [
    { label: 'Upload image', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 15l-5-4-5 4-3-2-5 4"/>', disabledReason: 'No image-attachment route in this build.' },
    { label: 'Files', icon: '<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v6h6"/>', desc: 'Open a repository file (Ctrl+P)', run: () => { const q = $('#quick', ide); const qi = $('#quick-in', ide); if (q) q.hidden = false; if (qi) { qi.value = ''; qi.focus(); } S.renderQuickIfOpen(); } },
    { label: 'Directories', icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', disabledReason: 'Choose a working folder from the repository header.' },
    { label: 'Skills', icon: '<path d="M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z"/>', desc: 'Toggle skills for this run', run: () => goVsview('zeno') },
    { label: 'Conversations', icon: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>', disabledReason: 'Sessions live only in this browser window — there is no cross-session conversation store to browse.' },
    { label: 'Code Context Items', icon: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/>', disabledReason: 'There is no context-pinning store in this build — open a real file, or use Search instead.' },
    { label: 'Git', icon: '<circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="8" r="2.3"/><path d="M6 8.3v7.4M18 10.3c0 3-3 4-6 4H8"/>', desc: 'Branch, changes and commit', run: () => goVsview('scm') },
    { label: 'MCP servers', icon: '<path d="M9 7V3M15 7V3M8 7h8v3a4 4 0 0 1-8 0zM12 14v7"/>', desc: 'Recorded MCP servers — names only', run: () => goVsview('zeno') },
    { label: 'Rules', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>', desc: 'AGENTS.md / CLAUDE.md loaded for this run', run: () => goVsview('zeno') },
    { label: 'Terminal', icon: '<path d="M4 17l6-5-6-5M12 19h8"/>', desc: 'One-shot commands; writes come back held for approval', run: () => { S.showPanel('terminal'); S.focusTerminal(); } },
    { label: 'Codemaps', icon: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>', disabledReason: 'Forge has no repository codemap or symbol index in this build.' },
    { label: 'Trigger Workflow', icon: '<circle cx="6" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.3 6H14a4 4 0 0 1 4 4v5.7"/>', disabledReason: 'There is no multi-step workflow engine in this build — describe the whole task to Zeno, or use Scheduled Tasks in the Zeno view for recurring runs.' },
  ];
  let realPlusEl = null;
  function closeRealPlus() { if (realPlusEl) { realPlusEl.remove(); realPlusEl = null; } }
  function openRealPlus(anchor) {
    if (realPlusEl) { closeRealPlus(); return; }
    realPlusEl = el('div', 'plus-menu');
    realPlusEl.setAttribute('role', 'menu');
    for (const item of PLUS_ITEMS_REAL) {
      const b = el('button', 'plus-item');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      const mi = el('span', 'mi');
      // A fixed, hand-authored icon glyph — not daemon-derived content, so
      // innerHTML here carries no untrusted text (see the honesty rule this
      // file otherwise enforces around innerHTML vs textContent).
      mi.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>`;
      add(b, mi, document.createTextNode(item.label));
      if (item.run) {
        b.title = item.desc || '';
        b.addEventListener('click', () => { closeRealPlus(); item.run(); });
      } else {
        disableCtl(b, item.disabledReason || 'Not available in this build.');
      }
      realPlusEl.appendChild(b);
    }
    document.body.appendChild(realPlusEl);
    const r = anchor.getBoundingClientRect();
    const h = realPlusEl.offsetHeight || 420;
    realPlusEl.style.left = `${Math.max(8, r.left)}px`;
    realPlusEl.style.top = `${Math.max(8, r.top - h - 8)}px`;
  }
  document.addEventListener('click', (e) => {
    if (realPlusEl && !e.target.closest('.plus-menu') && !e.target.closest('#s-attach') && !e.target.closest('#ag-plus')) closeRealPlus();
  });
  const agPlusBtn = cloneReplace($('#ag-plus'));
  if (agPlusBtn) agPlusBtn.addEventListener('click', (e) => { e.stopPropagation(); openRealPlus(agPlusBtn); });
  const sAttachBtn = cloneReplace($('#s-attach'));
  if (sAttachBtn) sAttachBtn.addEventListener('click', (e) => { e.stopPropagation(); openRealPlus(sAttachBtn); });

  /* ============================================================ *
   * MENU BAR — neutralise the items that actively LIE              *
   * ============================================================ *
   * ui.js gives these popup buttons no id or data attribute — the only
   * handle is their own rendered text — so a capturing document listener
   * matches on the popup item's exact textContent (label immediately
   * followed by its keybinding, exactly as ui.js concatenates them) and,
   * because a capturing listener on an ancestor runs before a bubble
   * listener on the target, stops the event before ui.js's own per-item
   * listener (attached fresh each time the menu opens) can fire. If
   * ui.js's own menu labels ever change, this simply stops matching
   * (fails open to the old behaviour) rather than throwing.
   */
  const MENU_FAKES = new Map([
    ['New FileCtrl+N', () => {
      const p = safeAsk(() => window.prompt('Path for the new file (relative to the sandbox root):'), null);
      if (p && p.trim()) void S.proposeNewFile(p.trim().replace(/^\/+/, ''));
    }],
    ['SaveCtrl+S', () => S.proposeSaveFromFocusedGroup()],
    ['Add Configuration…', () => safeAsk(() => window.alert('There is no launch.json / debug configuration in this build — Zeno has no debugger.'))],
    ['Run Tests', () => { S.showPanel('terminal'); void S.runTerminalCommand('npm test'); }],
    ['New TerminalCtrl+Shift+`', () => { S.showPanel('terminal'); S.focusTerminal(); }],
    ['Run Build Task…Ctrl+Shift+B', () => { S.showPanel('terminal'); void S.runTerminalCommand('npm run typecheck'); }],
    ['Run Test Task…', () => { S.showPanel('terminal'); void S.runTerminalCommand('npm test'); }],
  ]);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu button');
    if (!btn) return;
    const real = MENU_FAKES.get(btn.textContent);
    if (!real) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    $$('.tbmenu button[aria-expanded]').forEach((b) => b.removeAttribute('aria-expanded'));
    real();
  }, true);
}
