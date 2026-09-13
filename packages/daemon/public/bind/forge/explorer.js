/**
 * bind/forge/explorer.js — EXPLORER + STATUS BAR + TIMELINE + QUICK OPEN +
 * SEARCH + SCM panel.
 *
 * Everything here is read from GET /forge/status (git branch/HEAD/changed
 * files/log) plus GET /forge/search (git grep). This module owns `loadStatus`
 * — the one re-read every other Forge module triggers after an action that
 * could change the sandbox (a save, a terminal command, an agent run) — so
 * it registers `S.loadStatus`, `S.renderFileStatusBits`, `S.proposeNewFile`,
 * `S.renderQuickIfOpen` and `S.setExitCode` for the rest of Forge to call.
 */
import {
  $, $$, el, fill, getJSON,
} from '../../bind.js';
import {
  add, disableCtl, fileMeta, languageLabel, postJSON, safeAsk, setTrailingText, statusWord,
} from './dom.js';

export function setupExplorer(S) {
  const ide = S.ide;

  /* ============================================================ *
   * EXPLORER + STATUS BAR + TIMELINE                              *
   * ============================================================ */

  // Activity-rail badges: the SCM one is real (git's own changed-file count,
  // filled in once /forge/status answers, below); the Zeno one claims a
  // pending-approval count this binder has no way to verify, so it is
  // hidden rather than left standing as an unread number.
  const scmBadge = $('.vsact [data-vsview="scm"] .vsbadge');
  if (scmBadge) setTrailingText(scmBadge, '—');
  const zenoBadge = $('.vsact [data-vsview="zeno"] .vsbadge');
  if (zenoBadge) zenoBadge.hidden = true;

  const explorerView = $('.vsside .vsview[data-vsview="explorer"]');
  const explorerSections = explorerView ? $$('.vssect', explorerView) : [];
  const sandboxHeader = explorerSections.find((s) => /SANDBOX/.test(s.textContent || ''));
  const outlineHeader = explorerSections.find((s) => /OUTLINE/.test(s.textContent || ''));
  const timelineHeader = explorerSections.find((s) => /TIMELINE/.test(s.textContent || ''));

  // Real refresh: the artifact's Refresh icon has no listener of its own
  // (ui.js's generic section-header toggle explicitly ignores clicks on
  // `.fico`), so wiring it here adds behaviour rather than replacing any.
  if (sandboxHeader) {
    const refreshBtn = sandboxHeader.querySelector('button[title="Refresh"]');
    if (refreshBtn) refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void loadStatus();
      if (S.currentFile) void S.openFile(S.currentFile, true);
    });
  }

  // Explorer header: New File / New Folder / Collapse — none of these had a
  // listener anywhere (ui.js's own section-header toggle ignores `.fico`
  // clicks on purpose, same as Refresh above). "New File" proposes a
  // genuinely new, empty file through the SAME governed gate the editor's
  // own save uses (POST /previews) — there is no path from this button to
  // disk that skips it. "New Folder" has nothing honest to do: git does not
  // track empty directories and there is no daemon route that creates one,
  // so it is disabled rather than left to silently do nothing. "Collapse" is
  // real, local UI state — it adds every directory currently in the tree to
  // `collapsedDirs` and repaints, exactly like each directory's own toggle.
  async function proposeNewFile(relPath) {
    const r = await postJSON('/previews', {
      relPath, contents: '', summary: `Forge: create ${relPath}`, requestedBy: 'forge-editor',
    });
    if (!r.ok) { safeAsk(() => window.alert(`"${relPath}" could not be proposed: ${r.error || 'unknown error'}`)); return; }
    const preview = r.data && r.data.preview;
    if (!preview) { safeAsk(() => window.alert(`"${relPath}" was not proposed — the daemon answered without a preview.`)); return; }
    void loadStatus();
    if (r.data.receipt) void S.openFile(relPath, true);
    else safeAsk(() => window.alert(`"${relPath}" is held for approval (tier ${preview.tier || '?'}) — open Command → Approvals to decide.`));
  }
  if (sandboxHeader) {
    const newFileBtn = sandboxHeader.querySelector('button[title="New File"]');
    if (newFileBtn) {
      newFileBtn.disabled = !S.OWNER;
      newFileBtn.title = S.OWNER
        ? 'Propose a new, empty file — governed, same as any other write.'
        : 'This window has no owner token, so it cannot propose a new file.';
      newFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!S.OWNER) return;
        const relPath = safeAsk(() => window.prompt('Path for the new file (relative to the sandbox root):'), null);
        if (relPath && relPath.trim()) void proposeNewFile(relPath.trim().replace(/^\/+/, ''));
      });
    }
    const newFolderBtn = sandboxHeader.querySelector('button[title="New Folder"]');
    disableCtl(newFolderBtn, 'Git does not track empty folders, and there is no folder-creation route — create a file inside one instead (New File).');
    const collapseBtn = sandboxHeader.querySelector('button[title="Collapse"]');
    if (collapseBtn) collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!S.statusData || !S.statusData.repo) return;
      const changed = new Map();
      for (const c of S.statusData.changed || []) changed.set(c.path, c.status);
      const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
      const paths = [...new Set([...tracked, ...changed.keys()])];
      const collectDirs = (node, prefix) => {
        for (const [name, child] of node.dirs) {
          const path = prefix ? `${prefix}/${name}` : name;
          S.collapsedDirs.add(path);
          collectDirs(child, path);
        }
      };
      collectDirs(buildFileTree(paths), '');
      renderExplorer();
    });
  }

  // Outline: real forge.js says plainly there is no symbol index. Same here.
  if (outlineHeader && !outlineHeader.dataset.forgeFilled) {
    outlineHeader.dataset.forgeFilled = '1';
    const note = el('div', 'vsnote', 'Forge does not index symbols, so there is no outline for the open file.');
    outlineHeader.insertAdjacentElement('afterend', note);
  }

  let timelineBody = null;
  if (timelineHeader && !timelineHeader.dataset.forgeFilled) {
    timelineHeader.dataset.forgeFilled = '1';
    timelineBody = el('div');
    timelineHeader.insertAdjacentElement('afterend', timelineBody);
  }

  function renderTimeline() {
    if (!timelineBody) return;
    if (!S.statusData || !S.statusData.repo) { fill(timelineBody, el('div', 'vsnote', 'No repository — no commit history to show.')); return; }
    const log = Array.isArray(S.statusData.log) ? S.statusData.log : [];
    if (!log.length) { fill(timelineBody, el('div', 'vsnote', 'git reports no commits in the sandbox yet.')); return; }
    fill(timelineBody, ...log.map((c) => {
      const row = el('div', 'vsfile');
      add(row, el('span', null, c.summary || '(no message)'), el('span', 'vsmod', c.sha || ''));
      return row;
    }));
  }

  function buildFileTree(paths) {
    const root = { dirs: new Map(), files: [] };
    for (const path of paths) {
      const parts = path.split('/').filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
        node = node.dirs.get(parts[i]);
      }
      node.files.push({ name: parts[parts.length - 1] || path, path });
    }
    return root;
  }

  function subtreeHasChange(node, changedSet) {
    for (const f of node.files) if (changedSet.has(f.path)) return true;
    for (const child of node.dirs.values()) if (subtreeHasChange(child, changedSet)) return true;
    return false;
  }

  function renderDirNode(node, prefix, target, changed) {
    const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, child] of dirs) {
      const path = prefix ? `${prefix}/${name}` : name;
      const collapsed = S.collapsedDirs.has(path);
      const row = el('div', collapsed ? 'vsdir' : 'vsdir open');
      row.dataset.dir = '1';
      const dotc = el('span', subtreeHasChange(child, changed) ? 'vsdotc new' : 'vsdotc');
      add(row, el('span', 'chev', collapsed ? '▸' : '▾'), el('span', 'vsfo', '▣'), document.createTextNode(name), dotc);
      row.title = path;
      const kids = el('div', 'vskids');
      kids.hidden = collapsed;
      row.addEventListener('click', () => {
        if (S.collapsedDirs.has(path)) S.collapsedDirs.delete(path); else S.collapsedDirs.add(path);
        renderExplorer();
      });
      add(target, row, kids);
      renderDirNode(child, path, kids, changed);
    }
    for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
      const code = changed.get(file.path);
      const [cls, txt] = fileMeta(file.name);
      const row = el('div', 'vsfile');
      row.dataset.file = file.path;
      const badge = el('span', cls, txt);
      add(row, badge, document.createTextNode(file.name));
      if (code) {
        const isNew = code === '??' || /^A/.test(code);
        const label = code === '??' ? 'U' : (code.replace(/[^A-Za-z]/g, '')[0] || 'M');
        add(row, el('span', isNew ? 'vsmod new' : 'vsmod', label));
        row.title = `${file.path} — ${statusWord(code)}`;
      } else {
        row.title = file.path;
      }
      row.classList.toggle('on', file.path === S.currentFile);
      row.addEventListener('click', () => void S.openFile(file.path));
      S.fileRowByPath.set(file.path, row);
      add(target, row);
    }
  }

  function renderExplorer() {
    const tree = explorerView ? $('.vstree', explorerView) : null;
    if (!tree) return;
    S.fileRowByPath.clear();
    if (S.statusErr) { fill(tree, el('div', 'fempty', `The tree could not be read: ${S.statusErr}`)); renderTimeline(); return; }
    if (!S.statusData) { fill(tree, el('div', 'fempty', 'Reading the sandbox from the daemon…')); renderTimeline(); return; }
    if (!S.statusData.repo) {
      fill(tree, el('div', 'fempty', S.statusData.note || 'The sandbox is not a git repository, so there is no file list here.'));
      renderTimeline();
      return;
    }
    const changed = new Map();
    for (const c of S.statusData.changed || []) changed.set(c.path, c.status);
    const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
    const paths = [...new Set([...tracked, ...changed.keys()])].sort();
    if (!paths.length) {
      fill(tree, el('div', 'fempty', 'The sandbox is empty — git lists no tracked or changed files.'));
      renderTimeline();
      return;
    }
    const root = buildFileTree(paths);
    const wrap = el('div');
    renderDirNode(root, '', wrap, changed);
    const nodes = [...wrap.childNodes];
    fill(tree, ...nodes);
    if (S.statusData.trackedCapped) {
      tree.appendChild(el('div', 'vsnote', `Showing the first ${tracked.length} of ${S.statusData.trackedTotal} tracked files.`));
    }
    renderTimeline();
  }

  // ---- status bar ----
  const statBar = $('.vsstat');
  const statSpans = statBar ? $$('.vsst', statBar) : [];
  const statEls = {
    rem: statSpans[0] || null,
    checkout: statSpans[1] || null,
    sync: statSpans[2] || null,
    ports: $('.vsst[data-vsp-open="ports"]', statBar || document) || null,
    exitcode: $('#vs-lastexit') || null,
    lastCommit: statSpans[6] || null,
    lnCol: statSpans[7] || null,
    spaces: statSpans[8] || null,
    utf8: statSpans[9] || null,
    lf: statSpans[10] || null,
    lang: $('.vsst[data-lang]', statBar || document) || null,
    gov: $('.vsst.gov', statBar || document) || null,
  };
  // Neutralise the artifact's fabricated "chain ok" claim the instant this
  // binder runs — renderGov() below fills in the real state once /state
  // answers, but nothing manufactured may stand even for one frame.
  if (statEls.gov) setTrailingText(statEls.gov, ' governed — reading chain…');
  // Real chain state for the "governed" status item — GET /state (the same
  // ledger bind/receipts.js reads): { receipts[], chain:{ok,firstBreakAt} }.
  // Never say "chain ok" without that datum in hand (hard rule); an unread or
  // absent chain says only "governed".
  async function renderGov() {
    if (!statEls.gov) return;
    statEls.gov.title = 'Open Command → Receipts.';
    const r = await getJSON('/state');
    if (!r.ok) { setTrailingText(statEls.gov, ' governed'); return; }
    const chain = r.data && typeof r.data.chain === 'object' ? r.data.chain : null;
    const n = Array.isArray(r.data && r.data.receipts) ? r.data.receipts.length : null;
    if (!chain || typeof chain.ok !== 'boolean') { setTrailingText(statEls.gov, ' governed'); return; }
    if (chain.ok) {
      setTrailingText(statEls.gov, ` governed · chain ok${n != null ? ` · ${n} receipt${n === 1 ? '' : 's'}` : ''}`);
    } else {
      const at = Number.isInteger(chain.firstBreakAt) ? ` · #${chain.firstBreakAt}` : '';
      setTrailingText(statEls.gov, ` governed · chain broken${at}`);
      statEls.gov.title = `The receipt chain failed verification${at}. Open Command → Receipts.`;
    }
  }
  if (statEls.ports) {
    const p = location.port || (location.protocol === 'https:' ? '443' : '80');
    statEls.ports.title = 'This daemon’s own port. Other listening ports are not read by this build.';
    setTrailingText(statEls.ports, ` port ${p}`);
  }
  if (statEls.spaces) statEls.spaces.hidden = true; // no real indent detection
  if (statEls.exitcode) setTrailingText(statEls.exitcode, 'exit —');
  S.setExitCode = (text) => { if (statEls.exitcode) setTrailingText(statEls.exitcode, text); };

  function renderStatusBar() {
    if (!S.statusData) return;
    if (!S.statusData.repo) {
      if (statEls.rem) setTrailingText(statEls.rem, 'sandbox — no repo');
      if (statEls.checkout) setTrailingText(statEls.checkout, '(none)');
      if (statEls.sync) setTrailingText(statEls.sync, '⟳ —');
      if (statEls.lastCommit) setTrailingText(statEls.lastCommit, 'no commits yet');
      if (scmBadge) setTrailingText(scmBadge, '0');
      return;
    }
    if (statEls.rem) {
      statEls.rem.title = `${S.statusData.root || 'sandbox'} · isolated sandbox worktree`;
      setTrailingText(statEls.rem, 'sandbox');
    }
    if (statEls.checkout) setTrailingText(statEls.checkout, S.statusData.branch || '(unknown)');
    const n = Array.isArray(S.statusData.changed) ? S.statusData.changed.length : 0;
    if (statEls.sync) {
      statEls.sync.title = `${n} uncommitted change${n === 1 ? '' : 's'} in the sandbox working tree`;
      setTrailingText(statEls.sync, `⟳ ${n}`);
    }
    if (scmBadge) setTrailingText(scmBadge, String(n));
    if (statEls.lastCommit) {
      const log = Array.isArray(S.statusData.log) ? S.statusData.log : [];
      setTrailingText(statEls.lastCommit, log.length ? `${log[0].summary} · ${log[0].sha}` : 'no commits yet');
    }
  }

  function renderFileStatusBits(path, data) {
    if (statEls.lnCol) setTrailingText(statEls.lnCol, data && typeof data.lines === 'number' ? `${data.lines} lines` : '— lines');
    if (statEls.utf8) setTrailingText(statEls.utf8, data && data.encoding ? data.encoding : '—');
    if (statEls.lf) setTrailingText(statEls.lf, data && data.eol ? data.eol : '—');
    if (statEls.lang) setTrailingText(statEls.lang, languageLabel(path));
  }
  S.renderFileStatusBits = renderFileStatusBits;

  async function loadStatus() {
    const r = await getJSON('/forge/status');
    if (!r.ok) { S.statusData = null; S.statusErr = r.error || 'could not be read'; }
    else { S.statusData = r.data; S.statusErr = null; }
    renderExplorer();
    renderStatusBar();
    renderScm();
    if (S.statusData && S.statusData.repo && S.currentFile === null) {
      const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
      const first = [...tracked].sort()[0];
      if (first) void S.openFile(first);
      else S.renderEditorEmpty('The sandbox has no tracked files.');
    } else if (S.statusData && !S.statusData.repo) {
      S.renderEditorEmpty(S.statusData.note || 'The sandbox is not a git repository.');
    }
    renderQuickIfOpen();
  }
  S.loadStatus = loadStatus;
  S.proposeNewFile = proposeNewFile;

  /* ============================================================ *
   * QUICK OPEN (Ctrl+P) — real file list                          *
   * ============================================================ *
   * ui.js keeps owning the palette's OPEN/CLOSE mechanics (Ctrl+P,
   * Ctrl+Shift+P, the toolbar button, Escape, click-outside) — those
   * are pure navigation, left exactly as wired. What ui.js's own
   * renderQuick() draws inside it is fabricated (a hardcoded FILES
   * list plus a mock command palette), so a second 'input' listener
   * on the SAME #quick-in node runs after ui.js's (registered later,
   * so it fires second) and overwrites #quick-list with the real
   * tracked/changed file list. A MutationObserver on #quick's
   * `hidden` attribute repaints it the instant the palette opens too
   * (from any trigger), before the user has typed anything — so the
   * mock FILES list is never the thing on screen, even briefly.
   * The '>' commands / ':' line / '@' symbol modes have no real
   * backend here (no command catalog, no symbol index) and say so
   * rather than keep ui.js's fake rows, which called mock openFile/
   * runTerm. */
  const quickEl = $('#quick', ide);
  const quickInEl = $('#quick-in', ide);
  const quickListEl = $('#quick-list', ide);
  function renderQuickReal() {
    if (!quickInEl || !quickListEl) return;
    const v = quickInEl.value;
    if (v.startsWith('>') || v.startsWith(':') || v.startsWith('@') || v.startsWith('task ')) {
      fill(quickListEl, el('div', 'mp-empty', 'This palette only searches real files in this build — commands, go-to-line and symbols are not wired to real data.'));
      return;
    }
    if (S.statusErr) { fill(quickListEl, el('div', 'mp-empty', `The file list could not be read: ${S.statusErr}`)); return; }
    if (!S.statusData) { fill(quickListEl, el('div', 'mp-empty', 'Reading the sandbox…')); return; }
    if (!S.statusData.repo) { fill(quickListEl, el('div', 'mp-empty', S.statusData.note || 'The sandbox is not a git repository.')); return; }
    const changed = new Map();
    for (const c of S.statusData.changed || []) changed.set(c.path, c.status);
    const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
    const paths = [...new Set([...tracked, ...changed.keys()])].sort();
    const q = v.trim().toLowerCase();
    const matches = (q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths).slice(0, 200);
    if (!matches.length) { fill(quickListEl, el('div', 'mp-empty', q ? 'No matching files.' : 'The sandbox has no tracked files.')); return; }
    const nodes = matches.map((p, i) => {
      const [cls, txt] = fileMeta(p.split('/').pop());
      const b = el('button', 'mp-row');
      b.type = 'button';
      if (i === 0) b.setAttribute('aria-checked', 'true');
      const mn = el('span', 'mn');
      add(mn, document.createTextNode(p.split('/').pop()), el('span', null, p));
      add(b, el('span', cls, txt), mn);
      b.addEventListener('click', () => { if (quickEl) quickEl.hidden = true; void S.openFile(p); });
      return b;
    });
    fill(quickListEl, ...nodes);
  }
  function renderQuickIfOpen() { if (quickEl && !quickEl.hidden) renderQuickReal(); }
  S.renderQuickIfOpen = renderQuickIfOpen;
  if (quickInEl) quickInEl.addEventListener('input', renderQuickReal);
  if (quickEl) new MutationObserver(renderQuickIfOpen).observe(quickEl, { attributes: true, attributeFilter: ['hidden'] });

  /* ============================================================ *
   * SEARCH view — real git grep via GET /forge/search              *
   * ============================================================ *
   * The artifact ships this view with a fabricated result already
   * showing (query "INGEST_TOKEN", two matches in ingest.ts/
   * ingest.spec.ts via <mark>) — exactly the standing-mock case the
   * honesty rule forbids, so it is cleared unconditionally before
   * anything else runs, real search or not. Match text is set via
   * textContent, never innerHTML, since it is daemon-derived (repo
   * content) — the query is not highlighted inline as the mock did.
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
    if (noteEl) noteEl.textContent = 'Type a query and press Enter to search the sandbox with git grep.';
    let searchSeq = 0;
    async function runSearch() {
      const q = queryIn ? queryIn.value.trim() : '';
      const seq = ++searchSeq;
      if (!q) {
        if (resWrap) fill(resWrap);
        if (noteEl) noteEl.textContent = 'Type a query and press Enter to search the sandbox with git grep.';
        return;
      }
      if (noteEl) noteEl.textContent = `Searching for "${q}"…`;
      const r = await getJSON(`/forge/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return; // a newer query superseded this one
      if (!r.ok) { if (resWrap) fill(resWrap); if (noteEl) noteEl.textContent = `Search failed: ${r.error}`; return; }
      const d = r.data || {};
      if (d.repo === false) { if (resWrap) fill(resWrap); if (noteEl) noteEl.textContent = d.note || 'The sandbox is not a git repository.'; return; }
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
          const row = el('div', 'vsresl', typeof m.text === 'string' ? m.text : '');
          const line = Number.isInteger(m.line) ? m.line : null;
          row.title = line ? `${path}:${line}` : path;
          row.addEventListener('click', () => {
            void S.openFile(path).then(() => {
              if (!line) return;
              S.revealLineInPrimaryGroup(path, line);
            });
          });
          nodes.push(row);
        }
      }
      if (resWrap) fill(resWrap, ...nodes);
      const files = typeof d.files === 'number' ? d.files : byPath.size;
      const total = typeof d.total === 'number' ? d.total : matches.length;
      if (noteEl) noteEl.textContent = `${total} result${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}${d.truncated ? ' — showing the first matches' : ''}`;
    }
    if (queryIn) queryIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } });
  }

  /* ============================================================ *
   * SCM panel (real branch/HEAD/changed files; best-effort)        *
   * ============================================================ */
  function renderScm() {
    const scmView = $('.vsside .vsview[data-vsview="scm"] .vspad');
    if (!scmView) return;
    if (!S.statusData) { fill(scmView, el('div', 'fempty', 'Reading the repository…')); return; }
    if (!S.statusData.repo) { fill(scmView, el('div', 'fempty', S.statusData.note || 'The sandbox is not a git repository.')); return; }
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
        const row = el('div', 'vsfile');
        add(row, el('span', cls, txt), document.createTextNode(c.path), el('span', isNew ? 'vsmod new' : 'vsmod', statusWord(c.status)));
        nodes.push(row);
      }
    }
    nodes.push(el('div', 'vsnote', 'A commit here previews as vcs.commit and seals a receipt only after you approve it in Command.'));
    fill(scmView, ...nodes);
  }

  return { renderExplorer, renderScm, renderGov, loadStatus };
}
