/**
 * bind/forge/codemap.js — the repository map behind the composer's
 * "Codemaps" item.
 *
 * A searchable list of every file the repository has (GET /forge/tree —
 * git's own index plus what `status` sees, each with its size on disk) and,
 * per file, the symbols the Outline's pattern scan finds (explorer-outline.js's
 * `S.scanSymbols`, run on the file's real bytes from GET /forge/file).
 * Symbols are scanned on demand — a click on a file, or "Scan shown" for the
 * files the filter currently lists — because reading every file up front
 * would be a second copy of the repository in this tab. Nothing here is an
 * index Zeno keeps; it is what git and a regex say right now, and the header
 * says so.
 *
 * Registers `S.openCodemap`.
 */
import { $, el, fill, getJSON } from '../../bind.js';
import { add, bytesLabel, fileMeta } from './dom.js';

const SCAN_BATCH = 100;

export function setupCodemap(S) {
  let sheet = null;
  let tree = null;          // GET /forge/tree's answer
  const symbols = new Map(); // path -> [{name, kind, line}] | null (no rules) — this tab's scan cache
  let filter = '';
  let scanning = false;

  function close() { if (sheet) { sheet.remove(); sheet = null; } }

  async function scan(path) {
    if (symbols.has(path)) return symbols.get(path);
    const r = await getJSON(`/forge/file?path=${encodeURIComponent(path)}`);
    const syms = r.ok && !r.data.binary ? (S.scanSymbols(path, r.data.contents || '') || null) : null;
    symbols.set(path, syms);
    return syms;
  }

  function shownFiles() {
    const files = tree && Array.isArray(tree.files) ? tree.files : [];
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q) || (symbols.get(f.path) || []).some((s) => s.name.toLowerCase().includes(q)));
  }

  function render() {
    if (!sheet) return;
    const head = $('[data-codemap-head]', sheet);
    const list = $('[data-codemap-list]', sheet);
    if (!tree) { fill(list, el('div', 'mp-empty', 'Reading the repository…')); return; }
    if (!tree.repo) { fill(list, el('div', 'mp-empty', 'This folder is not a git repository, so there is no map.')); return; }
    const files = shownFiles();
    const total = (tree.files || []).reduce((n, f) => n + (f.bytes || 0), 0);
    const scanned = [...symbols.values()].filter((v) => v !== null).length;
    head.textContent = `${tree.files.length} file${tree.files.length === 1 ? '' : 's'}${tree.capped ? ` of ${tree.total}` : ''} · ${bytesLabel(total)} · symbols scanned for ${scanned} · git ls-files + a pattern scan, not an index`;
    if (!files.length) { fill(list, el('div', 'mp-empty', filter ? 'No file or scanned symbol matches.' : 'The repository has no files.')); return; }
    const nodes = [];
    for (const f of files.slice(0, 400)) {
      const [cls, txt] = fileMeta(f.path.split('/').pop());
      const row = el('button', 'mp-row');
      row.type = 'button';
      row.dataset.codemapFile = f.path;
      const mn = el('span', 'mn');
      const syms = symbols.get(f.path);
      const state = syms === undefined ? 'click to scan symbols' : syms === null ? 'no outline rules for this type' : `${syms.length} symbol${syms.length === 1 ? '' : 's'}`;
      add(mn, document.createTextNode(f.path), el('span', null, `${f.bytes === null ? 'size unknown' : bytesLabel(f.bytes)} · ${state}`));
      add(row, el('span', cls, txt), mn);
      row.addEventListener('click', async () => { await scan(f.path); render(); });
      nodes.push(row);
      const q = filter.trim().toLowerCase();
      for (const s of (syms || []).filter((x) => !q || x.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)).slice(0, 80)) {
        const sr = el('button', 'mp-row');
        sr.type = 'button';
        sr.style.paddingLeft = '34px';
        sr.dataset.codemapSymbol = `${f.path}:${s.line}`;
        const smn = el('span', 'mn');
        add(smn, document.createTextNode(s.name), el('span', null, `${s.kind} · line ${s.line}`));
        add(sr, el('span', 'vskind', s.kind.slice(0, 4)), smn);
        sr.addEventListener('click', () => {
          close();
          if (S.setForgeView) S.setForgeView('editor');
          void S.openFile(f.path).then(() => S.revealLineInPrimaryGroup(f.path, s.line));
        });
        nodes.push(sr);
      }
    }
    if (files.length > 400) nodes.push(el('div', 'mp-empty', `Showing the first 400 of ${files.length} — narrow the filter.`));
    fill(list, ...nodes);
  }

  async function scanShown() {
    if (scanning) return;
    scanning = true;
    const btn = $('[data-codemap-scan]', sheet);
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
    for (const f of shownFiles().slice(0, SCAN_BATCH)) { if (!sheet) break; await scan(f.path); }
    scanning = false;
    if (btn) { btn.disabled = false; btn.textContent = `Scan shown (first ${SCAN_BATCH})`; }
    render();
  }

  async function openCodemap() {
    close();
    sheet = el('div', 'quick');
    sheet.dataset.codemap = '1';
    const card = el('div', 'quick-card');
    const search = el('div', 'mp-search');
    const input = el('input');
    input.placeholder = 'Filter files and scanned symbols';
    input.dataset.codemapFilter = '1';
    input.autocomplete = 'off';
    input.addEventListener('input', () => { filter = input.value; render(); });
    const scanBtn = el('button', 'laction', `Scan shown (first ${SCAN_BATCH})`);
    scanBtn.type = 'button';
    scanBtn.dataset.codemapScan = '1';
    scanBtn.title = 'Read each listed file once and scan it for top-level declarations / Markdown headings.';
    scanBtn.addEventListener('click', () => void scanShown());
    add(search, input, scanBtn);
    const head = el('div', 'vsnote', 'Reading the repository…');
    head.dataset.codemapHead = '1';
    head.style.padding = '2px 12px 6px';
    const list = el('div', 'mp-list');
    list.dataset.codemapList = '1';
    add(card, search, head, list);
    sheet.appendChild(card);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
    document.body.appendChild(sheet);
    input.focus();
    render();
    const r = await getJSON('/forge/tree');
    tree = r.ok ? r.data : { repo: false };
    if (!r.ok) tree = { repo: true, files: [], total: 0, capped: false, error: r.error };
    // The open file's symbols are already known from the Outline — no re-read.
    if (S.currentFile && S.outlineSymbols && !symbols.has(S.currentFile)) symbols.set(S.currentFile, S.outlineSymbols());
    render();
  }
  S.openCodemap = openCodemap;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // A project switch invalidates every scan; the tree is re-read on open anyway.
  window.addEventListener('zeno:state', () => { symbols.clear(); });
}
