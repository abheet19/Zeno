/**
 * bind/forge/explorer.js — EXPLORER tree + STATUS BAR, and `loadStatus`.
 *
 * Everything here is read from GET /forge/status (git branch/HEAD/changed
 * files/tracked list) and GET /forge/project (WHICH repository that is —
 * the owner's chosen folder, or the scratch repository when none is chosen).
 * This module owns `loadStatus` — the one re-read every other Forge module
 * triggers after an action that could change the repository (a save, a
 * terminal command, an agent run, an approval landing in Command) — and
 * registers `S.loadStatus`, `S.renderFileStatusBits`, `S.setExitCode` and
 * `S.project` for the rest of Forge to use.
 *
 * The rest of the sidebar lives beside this file, on the same `S` registry:
 * explorer-project.js (the working-folder header, its menu, and the governed
 * New File / New Folder actions), explorer-search.js (Quick Open, the Search
 * view, the SCM panel) and explorer-outline.js (OUTLINE and TIMELINE).
 * forge.js still calls only `setupExplorer`.
 */
import {
  $, $$, el, fill, getJSON,
} from '../../bind.js';
import {
  add, fileMeta, languageLabel, setTrailingText, statusWord,
} from './dom.js';
import { setupExplorerProject } from './explorer-project.js';
import { setupExplorerSearch } from './explorer-search.js';
import { setupExplorerOutline } from './explorer-outline.js';

export function setupExplorer(S) {
  const ide = S.ide;

  // Activity-rail badges: the SCM one is real (git's own changed-file count,
  // filled in once /forge/status answers, below); the Zeno one is written by
  // bind.js's refreshChrome() from the real pending count, so it is only
  // hidden here until that read lands — never left standing as a fixture.
  const scmBadge = $('.vsact [data-vsview="scm"] .vsbadge');
  if (scmBadge) setTrailingText(scmBadge, '—');
  const zenoBadge = $('.vsact [data-vsview="zeno"] .vsbadge');
  if (zenoBadge) zenoBadge.hidden = true;

  const explorerView = $('.vsside .vsview[data-vsview="explorer"]');

  /* ============================================================ *
   * THE TREE — git's own file list, never an invented one          *
   * ============================================================ */

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

  /** Every path the tree draws: tracked by git plus whatever `status` sees. */
  function treePaths() {
    if (!S.statusData || !S.statusData.repo) return [];
    const changed = (S.statusData.changed || []).map((c) => c.path);
    const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
    return [...new Set([...tracked, ...changed])].sort();
  }
  S.treePaths = treePaths;

  /** Every directory in the tree — "Collapse All" adds each to `collapsedDirs`. */
  function treeDirs() {
    const out = [];
    const walk = (node, prefix) => {
      for (const [name, child] of node.dirs) {
        const path = prefix ? `${prefix}/${name}` : name;
        out.push(path);
        walk(child, path);
      }
    };
    walk(buildFileTree(treePaths()), '');
    return out;
  }
  S.treeDirs = treeDirs;

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
      // .vslabel is what may shrink and ellipsize (see index.html's .vslabel
      // rule) — a bare text node here would instead widen the row past the
      // panel and reopen the horizontal-scrollbar bug this fixes.
      add(row, el('span', 'chev', collapsed ? '▸' : '▾'), el('span', 'vsfo', '▣'), el('span', 'vslabel', name), dotc);
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
      add(row, badge, el('span', 'vslabel', file.name));
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
    if (S.statusErr) { fill(tree, el('div', 'fempty', `The tree could not be read: ${S.statusErr}`)); return; }
    if (!S.statusData) { fill(tree, el('div', 'fempty', 'Reading the repository from the daemon…')); return; }
    if (!S.statusData.repo) {
      fill(tree, el('div', 'fempty', S.statusData.note || 'This folder is not a git repository, so there is no file list here.'));
      return;
    }
    const changed = new Map();
    for (const c of S.statusData.changed || []) changed.set(c.path, c.status);
    const paths = treePaths();
    if (!paths.length) {
      fill(tree, el('div', 'fempty', 'This repository is empty — git lists no tracked or changed files. Use New File to propose one.'));
      return;
    }
    const wrap = el('div');
    renderDirNode(buildFileTree(paths), '', wrap, changed);
    fill(tree, ...wrap.childNodes);
    if (S.statusData.trackedCapped) {
      const tracked = Array.isArray(S.statusData.tracked) ? S.statusData.tracked : [];
      tree.appendChild(el('div', 'vsnote', `Showing the first ${tracked.length} of ${S.statusData.trackedTotal} tracked files.`));
    }
  }
  S.renderExplorer = renderExplorer;

  /* ============================================================ *
   * STATUS BAR                                                     *
   * ============================================================ */
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
    bell: statSpans.find((s) => /Notifications/.test(s.title || '')) || null,
  };
  // Neutralise the artifact's fabricated "chain ok" claim the instant this
  // binder runs — renderGov() below fills in the real state once /state
  // answers, but nothing manufactured may stand even for one frame.
  if (statEls.gov) setTrailingText(statEls.gov, ' governed — reading chain…');
  // The bell has no notification centre behind it in this build. A control
  // that opens nothing is a dead control, so it goes rather than stands.
  if (statEls.bell) statEls.bell.hidden = true;
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
  // The repository chip at the far left is the same control as the Explorer
  // header: click it to change the working folder.
  if (statEls.rem) {
    statEls.rem.style.cursor = 'pointer';
    statEls.rem.addEventListener('click', () => { if (S.openProjectMenu) S.openProjectMenu(statEls.rem); });
  }

  function renderStatusBar() {
    if (!S.statusData) return;
    const p = S.project;
    const name = p && p.name ? p.name : String(S.statusData.root || 'repository').split(/[\\/]/).filter(Boolean).pop();
    if (!S.statusData.repo) {
      if (statEls.rem) setTrailingText(statEls.rem, `${name} — no repo`);
      if (statEls.checkout) setTrailingText(statEls.checkout, '(none)');
      if (statEls.sync) setTrailingText(statEls.sync, '⟳ —');
      if (statEls.lastCommit) setTrailingText(statEls.lastCommit, 'no commits yet');
      if (scmBadge) setTrailingText(scmBadge, '0');
      return;
    }
    if (statEls.rem) {
      statEls.rem.title = `${S.statusData.root}${p && p.scratch ? ` · ${p.note}` : ''} — click to change the working folder`;
      setTrailingText(statEls.rem, p && p.scratch ? `${name} · scratch` : name);
    }
    if (statEls.checkout) setTrailingText(statEls.checkout, S.statusData.branch || '(unknown)');
    const n = Array.isArray(S.statusData.changed) ? S.statusData.changed.length : 0;
    if (statEls.sync) {
      statEls.sync.title = `${n} uncommitted change${n === 1 ? '' : 's'} in the working tree`;
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

  /* ============================================================ *
   * THE ONE RE-READ                                                *
   * ============================================================ */
  const project = setupExplorerProject(S);
  const search = setupExplorerSearch(S);
  const outline = setupExplorerOutline(S);

  async function loadStatus() {
    const [r, p] = await Promise.all([getJSON('/forge/status'), getJSON('/forge/project')]);
    if (!r.ok) { S.statusData = null; S.statusErr = r.error || 'could not be read'; }
    else { S.statusData = r.data; S.statusErr = null; }
    S.project = p.ok && p.data && p.data.project ? p.data.project : null;
    project.renderProjectHeader();
    renderExplorer();
    renderStatusBar();
    search.renderScm();
    if (S.statusData && S.statusData.repo && S.currentFile === null) {
      const first = treePaths()[0];
      if (first) void S.openFile(first);
      else S.renderEditorEmpty('This repository has no files yet — use New File in the Explorer to propose one.');
    } else if (S.statusData && !S.statusData.repo) {
      S.renderEditorEmpty(S.statusData.note || 'This folder is not a git repository.');
    }
    search.renderQuickIfOpen();
    outline.renderTimeline();
  }
  S.loadStatus = loadStatus;

  // LIVE. An approval landing in Command (the New File capsule the owner just
  // decided), a receipt sealing, the working folder changing: each reaches the
  // window as a stream nudge that bind/live.js turns into `zeno:state`. The
  // tree re-reads on it, debounced, so a file the kernel just wrote appears
  // without anyone pressing Refresh — and the open buffer is re-read too, so
  // an approved edit shows up in the editor. (editor-view.js's refreshOpenFile
  // only re-mounts when the bytes on disk actually differ, and editor.js only
  // ever overwrites a CLEAN buffer — unsaved edits survive the nudge.)
  let liveTimer = 0;
  window.addEventListener('zeno:state', () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      void loadStatus();
      if (S.refreshOpenFile) void S.refreshOpenFile();
    }, 250);
  });

  return { renderExplorer, renderScm: search.renderScm, renderGov, loadStatus };
}
