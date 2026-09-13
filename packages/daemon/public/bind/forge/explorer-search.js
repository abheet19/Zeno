/**
 * bind/forge/explorer-search.js — QUICK OPEN (Ctrl+P), the SEARCH view and
 * the SCM panel. Split out of forge/explorer.js; same `S` registry.
 *
 * Quick Open's four modes are all real now. ui.js keeps owning the palette's
 * OPEN/CLOSE mechanics (Ctrl+P, Ctrl+Shift+P, the toolbar button, Escape,
 * click-outside) — pure navigation, left exactly as wired — but what it
 * draws inside is fabricated (a hardcoded FILES list, a mock command list,
 * "App.tsx has 11 lines"), so a second 'input' listener on the SAME
 * #quick-in node runs after ui.js's and overwrites #quick-list with real
 * rows, and a MutationObserver repaints the instant the palette opens:
 *
 *   (plain)   the tracked/changed file list git reported
 *   >         the Forge command registry — the same commands the menu bar
 *             runs (menu-bar.js's `S.listCommands`), disabled ones shown
 *             with their reason
 *   :         go to a line of the open file (editor.js's `S.goToLine`)
 *   @         the open file's symbols (explorer-outline.js's scan)
 *   task      the package scripts GET /forge/tests discovered, run through
 *             the Testing view (activitybar.js's `S.runTestScript`)
 *
 * Registers `S.renderQuickIfOpen` and `S.openQuick`.
 */
import { $, $$, el, fill, getJSON } from '../../bind.js';
import { add, disableCtl, fileMeta, statusWord } from './dom.js';

export function setupExplorerSearch(S) {
  const ide = S.ide;

  /* ============================================================ *
   * QUICK OPEN                                                     *
   * ============================================================ */
  const quickEl = $('#quick', ide);
  const quickInEl = $('#quick-in', ide);
  const quickListEl = $('#quick-list', ide);

  function row(main, sub, onClick, badge) {
    const b = el('button', 'mp-row');
    b.type = 'button';
    const mn = el('span', 'mn');
    add(mn, document.createTextNode(main), el('span', null, sub || ''));
    add(b, badge || el('span', 'vsi', '·'), mn);
    if (onClick) b.addEventListener('click', () => { if (quickEl) quickEl.hidden = true; onClick(); });
    return b;
  }
  function empty(text) { return el('div', 'mp-empty', text); }

  function renderCommands(q) {
    const cmds = S.listCommands ? S.listCommands() : [];
    const rows = cmds.filter((c) => !q || `${c.menu} ${c.label}`.toLowerCase().includes(q)).slice(0, 60).map((c) => {
      const kbd = c.kbd ? el('span', 'vsnote', c.kbd) : null;
      const b = row(`${c.menu}: ${c.label}`, c.disabledReason || '', c.disabledReason ? null : () => c.run(), kbd);
      if (c.disabledReason) disableCtl(b, c.disabledReason);
      return b;
    });
    return rows.length ? rows : [empty('No command matches.')];
  }
  function renderGoToLine(v) {
    if (!S.currentFile) return [empty('No file is open to go to a line in.')];
    const n = parseInt(v.slice(1).trim(), 10);
    const lines = S.currentFileLineCount ? S.currentFileLineCount() : null;
    if (!Number.isFinite(n) || n < 1) return [empty(`Type a line number${lines ? ` (1–${lines})` : ''} for ${S.currentFile}.`)];
    return [row(`Go to line ${n}`, `${S.currentFile}${lines ? ` · ${lines} lines` : ''}`, () => { if (S.goToLine) S.goToLine(n); })];
  }
  function renderSymbols(v) {
    if (!S.currentFile) return [empty('No file is open to list symbols for.')];
    const syms = S.outlineSymbols ? S.outlineSymbols() : [];
    const q = v.slice(1).trim().toLowerCase();
    const hits = syms.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, 200);
    if (!hits.length) return [empty(syms.length ? 'No symbol matches.' : `No symbols found in ${S.currentFile} (pattern scan — top-level declarations and Markdown headings only).`)];
    return hits.map((s) => row(s.name, `${s.kind} · line ${s.line}`, () => S.revealLineInPrimaryGroup(S.currentFile, s.line)));
  }
  function renderTasks(v) {
    const scripts = S.listTestScripts ? S.listTestScripts() : null;
    if (scripts === null) {
      if (S.loadTests) void S.loadTests().then(renderQuickIfOpen);
      return [empty('Reading the package scripts this repository declares…')];
    }
    const q = v.slice(5).trim().toLowerCase();
    const hits = scripts.filter((s) => !q || `${s.packageName} ${s.script}`.toLowerCase().includes(q));
    if (!hits.length) return [empty(scripts.length ? 'No script matches.' : 'No package.json here declares a test, check, typecheck or lint script.')];
    return hits.map((s) => row(`${s.packageName} · ${s.script}`, s.displayCommand, () => { if (S.runTestScript) void S.runTestScript(s.id); }));
  }
  function renderFiles(v) {
    if (S.statusErr) return [empty(`The file list could not be read: ${S.statusErr}`)];
    if (!S.statusData) return [empty('Reading the repository…')];
    if (!S.statusData.repo) return [empty(S.statusData.note || 'This folder is not a git repository.')];
    const q = v.trim().toLowerCase();
    const paths = S.treePaths();
    const matches = (q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths).slice(0, 200);
    if (!matches.length) return [empty(q ? 'No matching files.' : 'This repository has no files yet.')];
    return matches.map((p) => {
      const [cls, txt] = fileMeta(p.split('/').pop());
      return row(p.split('/').pop(), p, () => void S.openFile(p), el('span', cls, txt));
    });
  }

  function renderQuickReal() {
    if (!quickInEl || !quickListEl) return;
    const v = quickInEl.value;
    let nodes;
    if (v.startsWith('>')) nodes = renderCommands(v.slice(1).trim().toLowerCase());
    else if (v.startsWith(':')) nodes = renderGoToLine(v);
    else if (v.startsWith('@')) nodes = renderSymbols(v);
    else if (v.startsWith('task ')) nodes = renderTasks(v);
    else nodes = renderFiles(v);
    const first = nodes.find((n) => n.tagName === 'BUTTON' && !n.disabled);
    if (first) first.setAttribute('aria-checked', 'true');
    fill(quickListEl, ...nodes);
  }
  function renderQuickIfOpen() { if (quickEl && !quickEl.hidden) renderQuickReal(); }
  S.renderQuickIfOpen = renderQuickIfOpen;
  // ui.js's own openQuick is a closure; this is the same gesture for the
  // menu bar and the "+" menu: open, prefill the mode prefix, draw real rows.
  S.openQuick = (prefix) => {
    if (!quickEl || !quickInEl) return;
    quickEl.hidden = false;
    quickInEl.value = prefix || '';
    quickInEl.focus();
    renderQuickReal();
  };
  if (quickInEl) quickInEl.addEventListener('input', renderQuickReal);
  if (quickEl) new MutationObserver(renderQuickIfOpen).observe(quickEl, { attributes: true, attributeFilter: ['hidden'] });
  // Enter picks the first live row — ui.js's own Enter handler would click
  // its (now overwritten) first row too; ours is the one in the document.
  // preventDefault matters: the row's action may focus Monaco (go to line,
  // reveal a symbol) while this keydown is still dispatching, and without it
  // the key's default action then typed a NEWLINE into the buffer.
  if (quickInEl) quickInEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !quickListEl) return;
    const first = quickListEl.querySelector('.mp-row:not([disabled])');
    if (first) { e.preventDefault(); e.stopImmediatePropagation(); first.click(); }
  }, true);

  /* ============================================================ *
   * SEARCH view — real git grep via GET /forge/search              *
   * ============================================================ *
   * The artifact ships this view with a fabricated result already
   * showing (query "INGEST_TOKEN", two matches), so it is cleared
   * unconditionally before anything else runs. Match text is set via
   * textContent, never innerHTML, since it is repository content.
   * There is no real "Replace"; the field is disabled and says so. */
  const searchView = $('.vsview[data-vsview="search"]', ide);
  if (searchView) {
    const searchIns = $$('.vsinput', searchView);
    const queryIn = searchIns[0] || null;
    const replaceIn = searchIns[1] || null;
    const resWrap = $('.vsres', searchView);
    const noteEl = $('.vsnote', searchView);
    if (queryIn) { queryIn.value = ''; queryIn.placeholder = 'Search (git grep) — Enter to run'; }
    if (replaceIn) { replaceIn.value = ''; replaceIn.disabled = true; replaceIn.placeholder = 'Replace is not available — Forge only searches, it does not edit in place'; }
    if (resWrap) fill(resWrap);
    if (noteEl) noteEl.textContent = 'Type a query and press Enter to search the repository with git grep.';
    let searchSeq = 0;
    async function runSearch() {
      const q = queryIn ? queryIn.value.trim() : '';
      const seq = ++searchSeq;
      if (!q) {
        if (resWrap) fill(resWrap);
        if (noteEl) noteEl.textContent = 'Type a query and press Enter to search the repository with git grep.';
        return;
      }
      if (noteEl) noteEl.textContent = `Searching for "${q}"…`;
      const r = await getJSON(`/forge/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return; // a newer query superseded this one
      if (!r.ok) { if (resWrap) fill(resWrap); if (noteEl) noteEl.textContent = `Search failed: ${r.error}`; return; }
      const d = r.data || {};
      if (d.repo === false) { if (resWrap) fill(resWrap); if (noteEl) noteEl.textContent = d.note || 'This folder is not a git repository.'; return; }
      const matches = Array.isArray(d.matches) ? d.matches : [];
      if (!matches.length) { if (resWrap) fill(resWrap); if (noteEl) noteEl.textContent = `No results for "${q}".`; return; }
      const order = [];
      const byPath = new Map();
      for (const m of matches) {
        if (!byPath.has(m.path)) { byPath.set(m.path, []); order.push(m.path); }
        byPath.get(m.path).push(m);
      }
      const nodes = [];
      for (const path of order) {
        const rows = byPath.get(path);
        const name = path.split('/').pop();
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const head = el('div', 'vsresf');
        add(head, el('span', 'chev', '▾'), document.createTextNode(name), el('em', null, dir ? ` ${dir}` : ''), el('span', null, String(rows.length)));
        nodes.push(head);
        for (const m of rows) {
          const line = Number.isInteger(m.line) ? m.line : null;
          const r2 = el('div', 'vsresl', typeof m.text === 'string' ? m.text : '');
          r2.title = line ? `${path}:${line}` : path;
          r2.addEventListener('click', () => {
            void S.openFile(path).then(() => { if (line) S.revealLineInPrimaryGroup(path, line); });
          });
          nodes.push(r2);
        }
      }
      if (resWrap) fill(resWrap, ...nodes);
      const files = typeof d.files === 'number' ? d.files : byPath.size;
      const total = typeof d.total === 'number' ? d.total : matches.length;
      if (noteEl) noteEl.textContent = `${total} result${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}${d.truncated ? ' — showing the first matches' : ''}`;
    }
    if (queryIn) queryIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } });
    // The title bar's search icon had no listener anywhere: it now opens
    // this view and focuses the query, the same as Ctrl+Shift+F in the menu.
    const tbSearch = $('.tb .tbico[title^="Search"]', ide);
    if (tbSearch) tbSearch.addEventListener('click', () => { const b = $('.vsact [data-vsview="search"]', ide); if (b) b.click(); if (queryIn) queryIn.focus(); });
  }

  /* ============================================================ *
   * SCM panel (real branch/HEAD/changed files)                     *
   * ============================================================ */
  function renderScm() {
    const scmView = $('.vsside .vsview[data-vsview="scm"] .vspad');
    if (!scmView) return;
    if (!S.statusData) { fill(scmView, el('div', 'fempty', 'Reading the repository…')); return; }
    if (!S.statusData.repo) { fill(scmView, el('div', 'fempty', S.statusData.note || 'This folder is not a git repository.')); return; }
    const changed = S.statusData.changed || [];
    const nodes = [];
    const head = el('div', 'vsfile');
    add(head, el('b', null, S.statusData.branch || '(unknown)'), el('span', null, S.statusData.head ? ` · HEAD ${S.statusData.head}` : ' · no commits yet'));
    nodes.push(head);
    const badgeRow = el('div', 'vssect open', null);
    add(badgeRow, el('span', 'chev', '▾'), document.createTextNode('Changes '), el('span', 'vsbadge s', String(changed.length)));
    nodes.push(badgeRow);
    if (!changed.length) {
      nodes.push(el('div', 'vsnote', 'No uncommitted changes.'));
    } else {
      for (const c of changed) {
        const [cls, txt] = fileMeta(c.path.split('/').pop());
        const isNew = c.status === '??' || /^A/.test(c.status);
        const r = el('div', 'vsfile');
        add(r, el('span', cls, txt), document.createTextNode(c.path), el('span', isNew ? 'vsmod new' : 'vsmod', statusWord(c.status)));
        r.addEventListener('click', () => void S.openFile(c.path));
        nodes.push(r);
      }
    }
    nodes.push(el('div', 'vsnote', 'A commit here previews as vcs.commit and seals a receipt only after you approve it in Command.'));
    fill(scmView, ...nodes);
  }

  return { renderScm, renderQuickIfOpen };
}
