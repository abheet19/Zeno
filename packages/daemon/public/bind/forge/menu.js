/**
 * bind/forge/menu.js — the composer "+" context menu.
 *
 * ui.js's own PLUS_ITEMS menu draws twelve real-looking rows and answers
 * every single one with a toast that just repeats the row's own description
 * back — none of them do anything. Both anchors are taken over here
 * (cloneReplace, dropping ui.js's listener) and a real menu is built in its
 * place, reusing ui.js's own `.plus-menu`/`.plus-item` classes so it looks
 * identical. Every row now does something real, and the ones that write go
 * through the kernel:
 *
 *   Upload image      a native file picker; the image is PROPOSED as a write
 *                     into .zeno/attachments/ (menu-context.js) and pinned as
 *                     context for the next task
 *   Files             the real Quick Open file list
 *   Directories       the working-folder chooser (explorer-project.js)
 *   Skills / Rules / MCP servers   the Zeno view, which reads them live
 *   Conversations     this window's session History panel
 *   Code Context Items   pin the editor selection, a file, or the last
 *                     terminal output; sent with the next task (menu-context.js)
 *   Git               the SCM view
 *   Terminal          the real terminal
 *   Codemaps          the repository map — every file with its size, and the
 *                     same symbol scan the Outline runs (codemap.js)
 *   Scheduled tasks   the Zeno view's SCHEDULED TASKS section — there is no
 *                     workflow engine, so the row says what it really opens
 *
 * The menu BAR (File/Edit/…/Help) is menu-bar.js; the pins and the upload
 * are menu-context.js. Each hangs off the same `S` registry.
 */
import { $, el } from '../../bind.js';
import { add, cloneReplace } from './dom.js';
import { setupMenuBar } from './menu-bar.js';
import { setupMenuContext } from './menu-context.js';
import { setupCodemap } from './codemap.js';

export function setupMenu(S) {
  const ide = S.ide;
  setupMenuContext(S);
  setupCodemap(S);
  setupMenuBar(S);

  function goVsview(name) {
    const btn = $(`.vsact [data-vsview="${name}"]`, ide);
    if (btn) btn.click();
  }
  /** Show the session panel (it may be collapsed) and its History list. */
  function openHistory() {
    const layout = $('[data-layout="sess"]', ide);
    if (layout && layout.getAttribute('aria-pressed') !== 'true') layout.click();
    const hist = $('#s-history', ide);
    const btn = $('#s-hist', ide);
    if (hist && hist.hidden && btn) btn.click(); // session.js's toggle; only when closed
  }

  const PLUS_ITEMS_REAL = [
    { label: 'Upload image', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M21 15l-5-4-5 4-3-2-5 4"/>', desc: 'Propose an image into .zeno/attachments (governed) and pin it as context', run: () => S.uploadImage() },
    { label: 'Files', icon: '<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v6h6"/>', desc: 'Open a repository file (Ctrl+P)', run: () => S.openQuick('') },
    { label: 'Directories', icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', desc: 'Choose or change the working folder', run: () => S.chooseProject() },
    { label: 'Skills', icon: '<path d="M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z"/>', desc: 'Toggle skills for this run', run: () => goVsview('zeno') },
    { label: 'Conversations', icon: '<path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>', desc: 'This window’s session history', run: openHistory },
    { label: 'Code Context Items', icon: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/>', desc: 'Pin the selection, a file or terminal output — sent with the next task', run: () => S.pinContextPrompt() },
    { label: 'Git', icon: '<circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="8" r="2.3"/><path d="M6 8.3v7.4M18 10.3c0 3-3 4-6 4H8"/>', desc: 'Branch, changes and commit', run: () => goVsview('scm') },
    { label: 'MCP servers', icon: '<path d="M9 7V3M15 7V3M8 7h8v3a4 4 0 0 1-8 0zM12 14v7"/>', desc: 'Recorded MCP servers — names only', run: () => goVsview('zeno') },
    { label: 'Rules', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>', desc: 'AGENTS.md / CLAUDE.md loaded for this run', run: () => goVsview('zeno') },
    { label: 'Terminal', icon: '<path d="M4 17l6-5-6-5M12 19h8"/>', desc: 'One-shot commands in the repository root', run: () => { S.showPanel('terminal'); S.focusTerminal(); } },
    { label: 'Codemaps', icon: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>', desc: 'Repository map — every file, its size, and scanned symbols', run: () => S.openCodemap() },
    { label: 'Scheduled tasks', icon: '<circle cx="6" cy="6" r="2.3"/><circle cx="18" cy="18" r="2.3"/><path d="M8.3 6H14a4 4 0 0 1 4 4v5.7"/>', desc: 'Recurring work — the Zeno view’s Scheduled Tasks (there is no workflow engine)', run: () => S.openZenoSection('schedule') },
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
      b.dataset.plusItem = item.label;
      const mi = el('span', 'mi');
      // A fixed, hand-authored icon glyph — not daemon-derived content, so
      // innerHTML here carries no untrusted text (see the honesty rule this
      // file otherwise enforces around innerHTML vs textContent).
      mi.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>`;
      add(b, mi, document.createTextNode(item.label));
      b.title = item.desc || '';
      b.addEventListener('click', () => { closeRealPlus(); void item.run(); });
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRealPlus(); });
  const agPlusBtn = cloneReplace($('#ag-plus'));
  if (agPlusBtn) agPlusBtn.addEventListener('click', (e) => { e.stopPropagation(); openRealPlus(agPlusBtn); });
  const sAttachBtn = cloneReplace($('#s-attach'));
  if (sAttachBtn) sAttachBtn.addEventListener('click', (e) => { e.stopPropagation(); openRealPlus(sAttachBtn); });
}
