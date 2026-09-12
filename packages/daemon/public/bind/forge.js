/**
 * bind/forge.js — wires the Forge screen's markup (index.html) + interaction
 * layer (ui.js) to the real daemon. Reuses the endpoint knowledge documented
 * in the app's real forge.js (not loaded by index.html any more, but read
 * for its endpoint shapes and honesty conventions) without importing from it
 * (its internals are not exported, and its DOM does not match this markup).
 *
 * Ownership: this file edits ONLY the Forge product (`.product[data-product
 * ="forge"]`). ui.js still owns navigation/menus/layout toggles/tab-switching
 * chrome — those are left alone. Anywhere ui.js wired a CTA straight to a
 * mock data function (file open, terminal run, session send, model picker),
 * this file takes the element over: either by cloning it (dropping ui.js's
 * listener) or by stripping the data-* attribute ui.js's delegated listener
 * keyed off, then attaching a real listener of its own. Pure navigation
 * (activity-bar view switch, bottom-panel tab switch, layout toggles) is
 * left exactly as ui.js wired it.
 *
 * HONESTY: every number on this screen is either read from the daemon or
 * marked as not read. Nothing here draws from ui.js's MODELS/SESS/CODE/TERM
 * mock tables.
 */
import { getJSON, $, $$, el, fill, setText, authHeaders, token } from '../bind.js';

export async function bind() {
  try {
    await bindForge();
  } catch (err) {
    console.warn('[zeno] forge binder failed:', err);
  }
}

async function bindForge() {
  const ide = $('#ide');
  if (!ide) return; // Forge screen not present in this build — nothing to bind.

  /* ============================================================ *
   * 0 · small local helpers (forge.js keeps these private, so     *
   *     they are reproduced here rather than imported)            *
   * ============================================================ */

  function add(parent, ...kids) {
    if (!parent) return parent;
    for (const k of kids) if (k) parent.appendChild(k);
    return parent;
  }

  function bytesLabel(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function gib(bytes) {
    return typeof bytes === 'number' && isFinite(bytes) ? `${(bytes / (1024 ** 3)).toFixed(1)} GB` : '—';
  }

  /** Human word for a git porcelain status code. */
  function statusWord(code) {
    const map = {
      M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged',
      '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified',
    };
    return map[String(code || '').trim()] || `git: ${String(code || '?').trim()}`;
  }

  /** [className, badge glyph] for a file name, using only classes this
   * stylesheet actually defines colour for (.vsi.ts/.tsx/.md/.json/.git/.txt). */
  function fileMeta(name) {
    const lower = String(name || '').toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    if (ext === 'tsx') return ['vsi tsx', 'TS'];
    if (ext === 'ts' || ext === 'mts' || ext === 'cts') return ['vsi ts', 'TS'];
    if (ext === 'jsx') return ['vsi tsx', 'JS'];
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return ['vsi ts', 'JS'];
    if (ext === 'md' || ext === 'markdown') return ['vsi md', 'M↓'];
    if (ext === 'json') return ['vsi json', '{}'];
    if (lower === '.gitignore' || lower.startsWith('.git') || ext === 'gitignore') return ['vsi git', '◆'];
    if (['css', 'scss', 'html', 'htm', 'yml', 'yaml', 'txt', 'log', 'lock', 'token'].includes(ext)) return ['vsi txt', '≡'];
    return ['vsi', '·'];
  }

  function languageLabel(path) {
    const ext = String(path || '').toLowerCase().split('.').pop();
    const map = {
      tsx: 'TypeScript JSX', ts: 'TypeScript', jsx: 'JavaScript JSX', js: 'JavaScript',
      md: 'Markdown', json: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML', htm: 'HTML',
      yml: 'YAML', yaml: 'YAML', gitignore: 'Ignore',
    };
    return map[ext] || 'Plain Text';
  }

  /* ---- minimal syntax colouring for the handful of extensions the
     stylesheet already has .kw/.st/.cm rules for (matches the real
     forge.js's own tokenizer; duplicated here since it is not exported). */
  const HL_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json']);
  const KEYWORDS = new Set([
    'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
    'class', 'extends', 'implements', 'interface', 'type', 'enum', 'namespace', 'declare',
    'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'async', 'await',
    'yield', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
    'delete', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'as',
  ]);
  function highlightable(path) {
    const dot = String(path || '').lastIndexOf('.');
    return dot === -1 ? false : HL_EXT.has(path.slice(dot + 1).toLowerCase());
  }
  function tokenizeLine(line, st) {
    const out = [];
    let plain = '';
    let i = 0;
    const flush = () => {
      if (!plain) return;
      const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
      let last = 0, m;
      while ((m = re.exec(plain)) !== null) {
        if (m.index > last) out.push(['', plain.slice(last, m.index)]);
        out.push([KEYWORDS.has(m[0]) ? 'kw' : '', m[0]]);
        last = m.index + m[0].length;
      }
      if (last < plain.length) out.push(['', plain.slice(last)]);
      plain = '';
    };
    while (i < line.length) {
      if (st.block) {
        const end = line.indexOf('*/', i);
        if (end === -1) { out.push(['cm', line.slice(i)]); i = line.length; }
        else { out.push(['cm', line.slice(i, end + 2)]); i = end + 2; st.block = false; }
        continue;
      }
      const two = line.slice(i, i + 2);
      if (two === '//') { flush(); out.push(['cm', line.slice(i)]); i = line.length; continue; }
      if (two === '/*') { flush(); out.push(['cm', '/*']); st.block = true; i += 2; continue; }
      const ch = line[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        flush();
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === ch) { j++; break; }
          j++;
        }
        out.push(['st', line.slice(i, j)]);
        i = j;
        continue;
      }
      plain += ch;
      i++;
    }
    flush();
    return out;
  }
  function lineNode(text, colour, st) {
    const span = el('span', null);
    if (!colour) { span.textContent = text; return span; }
    for (const [cls, s] of tokenizeLine(text, st)) add(span, cls ? el('span', cls, s) : document.createTextNode(s));
    return span;
  }

  /* ---- one fetch shape for POST bodies (bind.js's getJSON only does GET) */
  async function postJSON(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body || {}),
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && data.error && data.error.message) || `${path} answered ${res.status}`;
        return { ok: false, status: res.status, data, error: msg };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${(err && err.message) || err}` };
    }
  }

  /** Replace only the trailing text of a status-bar span, keeping any icon child. */
  function setTrailingText(node, text) {
    if (!node) return;
    [...node.childNodes].forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
    node.appendChild(document.createTextNode(text));
  }

  const OWNER = token();

  /* ============================================================ *
   * 1 · state                                                     *
   * ============================================================ */
  let statusData = null, statusErr = null;
  let agentsData = null, agentsErr = null;
  let hostData = null, hostBusy = false;
  const collapsedDirs = new Set();
  const fileRowByPath = new Map();
  const fileCache = new Map(); // path -> {data,error}
  let currentFile = null;
  const openTabs = [];
  let truncNote = null;

  const termHistory = [];
  let terminalBusy = false;

  let sessions = [];
  let activeIdx = -1;
  let sessionSeq = 0;

  // Known, deliberate gaps — surfaced once at boot (below) rather than
  // silently absent. Each is a case where the honest answer is "not in this
  // build" rather than a fabricated control or number.
  const notWiredNotes = [
    'Extensions view: a real search input with nothing to search — /forge/extensions is not read this pass.',
    'Terminal: commands run exactly as typed. This daemon has no server-side or client-side gate that holds a write/push/rm/curl/deploy command for approval before it runs (only file writes from an agent run go through the approval gate) — the task description assumed one exists; it does not.',
    'Compare mode "Run": starts a single run on the first selected model only. There is no daemon endpoint for a true side-by-side multi-model run.',
    'Session runs: /forge/run reports tokensIn/tokensOut for local (Ollama) runs; this build does not display them anywhere in the session panel.',
    'Forge Lens: shows what is actually sent (task + memory + skills), not the exact assembled/hashed prompt POST /forge/context returns — that preview is not read this pass.',
  ];

  /* ============================================================ *
   * 2 · EXPLORER + STATUS BAR + TIMELINE (Priority 1)              *
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
      if (currentFile) void openFile(currentFile, true);
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
    if (!statusData || !statusData.repo) { fill(timelineBody, el('div', 'vsnote', 'No repository — no commit history to show.')); return; }
    const log = Array.isArray(statusData.log) ? statusData.log : [];
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
      const collapsed = collapsedDirs.has(path);
      const row = el('div', collapsed ? 'vsdir' : 'vsdir open');
      row.dataset.dir = '1';
      const dotc = el('span', subtreeHasChange(child, changed) ? 'vsdotc new' : 'vsdotc');
      add(row, el('span', 'chev', collapsed ? '▸' : '▾'), el('span', 'vsfo', '▣'), document.createTextNode(name), dotc);
      row.title = path;
      const kids = el('div', 'vskids');
      kids.hidden = collapsed;
      row.addEventListener('click', () => {
        if (collapsedDirs.has(path)) collapsedDirs.delete(path); else collapsedDirs.add(path);
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
      row.classList.toggle('on', file.path === currentFile);
      row.addEventListener('click', () => void openFile(file.path));
      fileRowByPath.set(file.path, row);
      add(target, row);
    }
  }

  function renderExplorer() {
    const tree = explorerView ? $('.vstree', explorerView) : null;
    if (!tree) return;
    fileRowByPath.clear();
    if (statusErr) { fill(tree, el('div', 'fempty', `The tree could not be read: ${statusErr}`)); renderTimeline(); return; }
    if (!statusData) { fill(tree, el('div', 'fempty', 'Reading the sandbox from the daemon…')); renderTimeline(); return; }
    if (!statusData.repo) {
      fill(tree, el('div', 'fempty', statusData.note || 'The sandbox is not a git repository, so there is no file list here.'));
      renderTimeline();
      return;
    }
    const changed = new Map();
    for (const c of statusData.changed || []) changed.set(c.path, c.status);
    const tracked = Array.isArray(statusData.tracked) ? statusData.tracked : [];
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
    if (statusData.trackedCapped) {
      tree.appendChild(el('div', 'vsnote', `Showing the first ${tracked.length} of ${statusData.trackedTotal} tracked files.`));
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

  function renderStatusBar() {
    if (!statusData) return;
    if (!statusData.repo) {
      if (statEls.rem) setTrailingText(statEls.rem, 'sandbox — no repo');
      if (statEls.checkout) setTrailingText(statEls.checkout, '(none)');
      if (statEls.sync) setTrailingText(statEls.sync, '⟳ —');
      if (statEls.lastCommit) setTrailingText(statEls.lastCommit, 'no commits yet');
      if (scmBadge) setTrailingText(scmBadge, '0');
      return;
    }
    if (statEls.rem) {
      statEls.rem.title = `${statusData.root || 'sandbox'} · isolated sandbox worktree`;
      setTrailingText(statEls.rem, 'sandbox');
    }
    if (statEls.checkout) setTrailingText(statEls.checkout, statusData.branch || '(unknown)');
    const n = Array.isArray(statusData.changed) ? statusData.changed.length : 0;
    if (statEls.sync) {
      statEls.sync.title = `${n} uncommitted change${n === 1 ? '' : 's'} in the sandbox working tree`;
      setTrailingText(statEls.sync, `⟳ ${n}`);
    }
    if (scmBadge) setTrailingText(scmBadge, String(n));
    if (statEls.lastCommit) {
      const log = Array.isArray(statusData.log) ? statusData.log : [];
      setTrailingText(statEls.lastCommit, log.length ? `${log[0].summary} · ${log[0].sha}` : 'no commits yet');
    }
  }

  function renderFileStatusBits(path, data) {
    if (statEls.lnCol) setTrailingText(statEls.lnCol, data && typeof data.lines === 'number' ? `${data.lines} lines` : '— lines');
    if (statEls.utf8) setTrailingText(statEls.utf8, data && data.encoding ? data.encoding : '—');
    if (statEls.lf) setTrailingText(statEls.lf, data && data.eol ? data.eol : '—');
    if (statEls.lang) setTrailingText(statEls.lang, languageLabel(path));
  }

  async function loadStatus() {
    const r = await getJSON('/forge/status');
    if (!r.ok) { statusData = null; statusErr = r.error || 'could not be read'; }
    else { statusData = r.data; statusErr = null; }
    renderExplorer();
    renderStatusBar();
    renderScm();
    if (statusData && statusData.repo && currentFile === null) {
      const tracked = Array.isArray(statusData.tracked) ? statusData.tracked : [];
      const first = [...tracked].sort()[0];
      if (first) void openFile(first);
      else renderEditorEmpty('The sandbox has no tracked files.');
    } else if (statusData && !statusData.repo) {
      renderEditorEmpty(statusData.note || 'The sandbox is not a git repository.');
    }
    renderQuickIfOpen();
  }

  /* ============================================================ *
   * 2b · QUICK OPEN (Ctrl+P) — real file list (Priority 3)         *
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
    if (statusErr) { fill(quickListEl, el('div', 'mp-empty', `The file list could not be read: ${statusErr}`)); return; }
    if (!statusData) { fill(quickListEl, el('div', 'mp-empty', 'Reading the sandbox…')); return; }
    if (!statusData.repo) { fill(quickListEl, el('div', 'mp-empty', statusData.note || 'The sandbox is not a git repository.')); return; }
    const changed = new Map();
    for (const c of statusData.changed || []) changed.set(c.path, c.status);
    const tracked = Array.isArray(statusData.tracked) ? statusData.tracked : [];
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
      b.addEventListener('click', () => { if (quickEl) quickEl.hidden = true; void openFile(p); });
      return b;
    });
    fill(quickListEl, ...nodes);
  }
  function renderQuickIfOpen() { if (quickEl && !quickEl.hidden) renderQuickReal(); }
  if (quickInEl) quickInEl.addEventListener('input', renderQuickReal);
  if (quickEl) new MutationObserver(renderQuickIfOpen).observe(quickEl, { attributes: true, attributeFilter: ['hidden'] });

  /* ============================================================ *
   * 2c · SEARCH view — real git grep via GET /forge/search         *
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
            void openFile(path).then(() => {
              if (!codeEl || !line) return;
              const target = codeEl.querySelectorAll('.ln')[line - 1];
              if (target) target.scrollIntoView({ block: 'center' });
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

  // The sidebar's OTHER "Ports" view (data-vsview="remote" — distinct from
  // the bottom drawer's ports tab already handled above) ships the same
  // three fabricated rows plus a "Forward a Port" button with no real
  // forwarding capability behind it anywhere in this daemon.
  const remoteView = $('.vsside .vsview[data-vsview="remote"] .vspad', ide);
  if (remoteView) {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80');
    const row = el('div', 'fchg');
    add(row, el('span', 'fdot ok'), document.createTextNode(` ${port} `), el('span', 'fm', `Zeno daemon · ${location.hostname}`));
    const note = el('div', 'vsnote', 'Forge cannot observe or forward other ports from the browser.');
    const fwd = el('button', 'btn g sm', 'Forward a Port');
    fwd.type = 'button';
    fwd.disabled = true;
    fwd.title = 'Not available in this build.';
    fill(remoteView, row, note, fwd);
  }

  /* ============================================================ *
   * 2d · ZENO sidebar view — real rules/skills/schedule/connectors *
   * ============================================================ *
   * GET /skills -> {rules[], skills[], failed[]}; GET /schedule ->
   * {tasks[]}; GET /forge/connectors -> {servers[]}. The artifact's
   * version is entirely invented: fixed rule/skill byte counts, a
   * "pdf … Install" skill-marketplace row nothing here backs, made-up
   * schedule entries with times ("next in 6h"), an invented CLI
   * version string, and a "GitHub Connect" button with nothing behind
   * it. Every row below is read, or the section says it wasn't.
   * Ticking a skill here is the REAL selection — selectedSkillIds is
   * what sendTask()/runResolved() below actually send as `skillIds`,
   * and the composer's "N skills" pill reads its size, not a fixed 2. */
  const zenoView = $('.vsside .vsview[data-vsview="zeno"] .vspad', ide);
  const skillsPill = $('#s-skills', ide);
  const selectedSkillIds = new Set();
  function renderSkillsPill() {
    if (!skillsPill) return;
    setTrailingText(skillsPill, ` ${selectedSkillIds.size} skill${selectedSkillIds.size === 1 ? '' : 's'} ▾`);
  }
  function sectHead(text) {
    const h = el('div', 'vssect open');
    add(h, el('span', 'chev', '▾'), document.createTextNode(text));
    return h;
  }
  if (zenoView) fill(zenoView, el('div', 'fnote', 'Reading rules, skills, schedule and connectors from the daemon…'));
  renderSkillsPill();
  async function loadZenoView() {
    if (!zenoView) return;
    const [skillsRes, schedRes, connRes] = await Promise.all([
      getJSON('/skills'), getJSON('/schedule'), getJSON('/forge/connectors'),
    ]);
    const nodes = [];

    nodes.push(sectHead('RULES · loaded for this run'));
    if (!skillsRes.ok) {
      nodes.push(el('div', 'vsnote', `Rules could not be read: ${skillsRes.error}`));
    } else {
      const rules = Array.isArray(skillsRes.data.rules) ? skillsRes.data.rules : [];
      if (!rules.length) nodes.push(el('div', 'vsnote', 'No AGENTS.md, CLAUDE.md, or .agents/.cursor/.claude rule files were found.'));
      for (const r of rules) {
        const [cls, txt] = fileMeta(r.path.split('/').pop());
        const row = el('div', 'vsfile');
        add(row, el('span', cls, txt), document.createTextNode(r.path), el('span', 'vsmod ok', bytesLabel(r.bytes)));
        if (r.truncated) row.title = `${r.path} is truncated for this preview.`;
        nodes.push(row);
      }
    }

    nodes.push(sectHead('SKILLS · this run'));
    if (!skillsRes.ok) {
      nodes.push(el('div', 'vsnote', `Skills could not be read: ${skillsRes.error}`));
    } else {
      const skills = Array.isArray(skillsRes.data.skills) ? skillsRes.data.skills : [];
      if (!skills.length) nodes.push(el('div', 'vsnote', 'No skills installed under .agents/skills.'));
      for (const s of skills) {
        const label = el('label', 'vsck');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const suspicious = s.verdict === 'suspicious';
        cb.checked = !suspicious; // clean skills load by default; a flagged one waits for an explicit tick
        if (cb.checked) selectedSkillIds.add(s.id);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSkillIds.add(s.id); else selectedSkillIds.delete(s.id);
          renderSkillsPill();
        });
        const trust = el('span', 'trust', suspicious ? 'flagged · review' : 'screened');
        const whys = Array.isArray(s.findings) ? s.findings.map((f) => f.why).filter(Boolean) : [];
        trust.title = suspicious && whys.length ? whys.join('; ') : 'Read as text by the model. It never grants a permission — every effect still goes through the kernel.';
        add(label, cb, document.createTextNode(` ${s.name || s.id} `), trust, el('em', null, bytesLabel(s.bytes)));
        nodes.push(label);
      }
      const failed = Array.isArray(skillsRes.data.failed) ? skillsRes.data.failed : [];
      if (failed.length) nodes.push(el('div', 'vsnote', `${failed.length} skill file${failed.length === 1 ? '' : 's'} could not be parsed.`));
    }
    nodes.push(el('div', 'vsnote', 'A skill is text the model reads. It never grants a permission — every effect still goes through the kernel.'));
    renderSkillsPill();

    nodes.push(sectHead('SCHEDULED TASKS'));
    if (!schedRes.ok) {
      nodes.push(el('div', 'vsnote', `Scheduled tasks could not be read: ${schedRes.error}`));
    } else {
      const tasks = Array.isArray(schedRes.data.tasks) ? schedRes.data.tasks : [];
      if (!tasks.length) nodes.push(el('div', 'vsnote', 'No scheduled tasks on this machine.'));
      for (const t of tasks) {
        const row = el('div', 'vsfile');
        row.dataset.sched = '1';
        let when;
        try { when = t.paused ? 'paused' : t.overdue ? 'overdue' : `next ${new Date(t.nextRunAt).toLocaleString()}`; } catch { when = t.paused ? 'paused' : '—'; }
        add(row, el('span', t.paused ? 'vsi' : 'vsi ok', t.paused ? '○' : '●'), document.createTextNode(String(t.title || '(untitled)')), el('span', t.paused ? 'vsmod' : 'vsmod ok', when));
        nodes.push(row);
      }
    }
    nodes.push(el('div', 'vsnote', 'Ceiling T1 · missed runs are skipped, not stacked · a schedule can never inherit a broader approval than you gave it.'));

    nodes.push(sectHead('MCP & CONNECTORS · per-run'));
    if (!connRes.ok) {
      nodes.push(el('div', 'vsnote', `Connectors could not be read: ${connRes.error}`));
    } else {
      const servers = Array.isArray(connRes.data.servers) ? connRes.data.servers : [];
      if (!servers.length) nodes.push(el('div', 'vsnote', 'No MCP connectors are configured.'));
      for (const s of servers) {
        const row = el('div', 'vsfile');
        const nTools = Array.isArray(s.tools) ? s.tools.length : 0;
        add(row, el('span', s.configured ? 'vsi ok' : 'vsi', s.configured ? '●' : '○'), document.createTextNode(String(s.name || s.id)),
          el('span', s.configured ? 'vsmod ok' : 'vsmod', s.configured ? `${nTools} tool${nTools === 1 ? '' : 's'}` : 'not configured'));
        if (s.permissions) row.title = s.permissions;
        nodes.push(row);
      }
      if (connRes.data.note) nodes.push(el('div', 'vsnote', connRes.data.note));
    }

    // POLICY describes the kernel's fixed tiering (a build constant, not
    // per-run instance data), so it is kept as the artifact stated it.
    nodes.push(sectHead('POLICY'));
    nodes.push(el('div', 'vsnote', 'built-in default · T2 needs one owner approval · single-use · receipts Ed25519-signed'));

    fill(zenoView, ...nodes);
  }

  /* ============================================================ *
   * 3 · EDITOR (Priority 1)                                        *
   * ============================================================ */

  const tabBar = $('.vsed .vstabs');
  const tabSpacer = tabBar ? tabBar.querySelector('.fgrow') : null;
  // Drop the artifact's four mock tabs (App.tsx/ingest.ts/…) — never left
  // standing as if they were the sandbox's real open files.
  if (tabBar) $$('.vstab', tabBar).forEach((t) => t.remove());

  const codeEl = $('#vs-code');
  const vsPane = codeEl ? codeEl.closest('.vspane') : null;
  const vsMini = vsPane ? vsPane.querySelector('.vsmini') : null;
  if (vsMini) vsMini.remove(); // decorative fake minimap — no real line/edit map to draw
  const vsBlame = $('.vsblame');
  if (vsBlame) vsBlame.hidden = true; // no git-blame endpoint to draw this from honestly
  const pane2 = $('#vs-pane2');
  if (pane2) {
    const body = pane2.querySelector('.fcode') || pane2;
    fill(body, el('div', 'fempty', 'Split view is not wired to real file contents in this build.'));
  }
  if (truncNote === null && vsPane && codeEl) {
    truncNote = el('div', 'vsnote');
    truncNote.hidden = true;
    codeEl.insertAdjacentElement('afterend', truncNote);
  }

  function renderTabs() {
    if (!tabBar) return;
    $$('[data-real-tab]', tabBar).forEach((n) => n.remove());
    for (const path of openTabs) {
      const name = path.split('/').pop();
      const [cls, txt] = fileMeta(name);
      const tab = el('button', 'vstab');
      tab.type = 'button';
      tab.dataset.realTab = path;
      tab.setAttribute('aria-selected', path === currentFile ? 'true' : 'false');
      const closeBtn = el('span', 'x', '×');
      add(tab, el('span', cls, txt), document.createTextNode(name), closeBtn);
      tab.addEventListener('click', (e) => {
        if (e.target === closeBtn) { e.stopPropagation(); closeTab(path); return; }
        void openFile(path);
      });
      if (tabSpacer) tabBar.insertBefore(tab, tabSpacer); else tabBar.appendChild(tab);
    }
  }

  function closeTab(path) {
    const i = openTabs.indexOf(path);
    if (i === -1) return;
    openTabs.splice(i, 1);
    if (currentFile === path) {
      const next = openTabs[i] || openTabs[i - 1] || null;
      if (next) { void openFile(next); return; }
      currentFile = null;
      renderEditorEmpty('No file open. Pick one from the Explorer.');
    }
    renderTabs();
  }

  function renderBreadcrumb(path) {
    const bc = $('.vscrumbs');
    if (!bc) return;
    const parts = path.split('/');
    const nodes = [el('span', null, 'sandbox')];
    for (let i = 0; i < parts.length - 1; i++) { nodes.push(el('i', null, '›')); nodes.push(el('span', null, parts[i])); }
    nodes.push(el('i', null, '›'));
    const [cls, txt] = fileMeta(parts[parts.length - 1]);
    nodes.push(el('span', cls, txt));
    const nameB = el('b', null, parts[parts.length - 1]);
    nameB.id = 'vs-crumb';
    nodes.push(nameB);
    fill(bc, ...nodes);
    setText('#tb-cmd', `sandbox — ${path}`);
  }

  function renderEditorEmpty(message) {
    currentFile = null;
    renderTabs();
    const bc = $('.vscrumbs');
    if (bc) fill(bc, el('span', null, 'sandbox'));
    setText('#tb-cmd', 'sandbox');
    if (codeEl) fill(codeEl, el('span', null, message));
    if (truncNote) truncNote.hidden = true;
    renderFileStatusBits('', null);
  }

  function renderEditorContent(path) {
    if (!codeEl) return;
    const rec = fileCache.get(path);
    if (!rec) return;
    if (rec.error) { fill(codeEl, el('span', null, rec.error)); if (truncNote) truncNote.hidden = true; return; }
    const data = rec.data;
    if (!data) { fill(codeEl, el('span', null, `${path} could not be read.`)); if (truncNote) truncNote.hidden = true; return; }
    if (data.binary) {
      fill(codeEl, el('span', null, `${path} is a binary file (${bytesLabel(data.bytes)}) — not shown.`));
      if (truncNote) truncNote.hidden = true;
      renderFileStatusBits(path, data);
      return;
    }
    const nodes = [];
    const lines = String(data.contents ?? '').split('\n');
    const colour = highlightable(path);
    const st = { block: false };
    lines.forEach((text, i) => {
      nodes.push(el('span', 'ln', String(i + 1)));
      nodes.push(lineNode(text === '' ? ' ' : text, colour, st));
      if (i < lines.length - 1) nodes.push(document.createTextNode('\n'));
    });
    fill(codeEl, ...nodes);
    if (truncNote) {
      if (data.truncated) {
        truncNote.hidden = false;
        truncNote.textContent = `Showing the first ${lines.length} of ${data.lines} lines — the file continues.`;
      } else {
        truncNote.hidden = true;
      }
    }
    renderFileStatusBits(path, data);
  }

  async function openFile(path, force) {
    if (!path) return;
    currentFile = path;
    if (force) fileCache.delete(path);
    if (!openTabs.includes(path)) openTabs.push(path);
    renderTabs();
    renderBreadcrumb(path);
    fileRowByPath.forEach((row, p) => row.classList.toggle('on', p === path));
    if (!fileCache.has(path)) {
      fill(codeEl, el('span', null, `Reading ${path}…`));
      const r = await getJSON(`/forge/file?path=${encodeURIComponent(path)}`);
      fileCache.set(path, r.ok ? { data: r.data, error: null } : { data: null, error: `${path} could not be read: ${r.error}` });
      if (currentFile !== path) return; // a later open superseded this one
    }
    renderEditorContent(path);
  }

  /* ============================================================ *
   * 4 · TERMINAL (Priority 1)                                      *
   * ============================================================ */

  const term = $('#vs-term');
  const oldTermIn = $('#vs-termin');
  let termIn = oldTermIn;
  if (oldTermIn) {
    termIn = oldTermIn.cloneNode(true);
    oldTermIn.replaceWith(termIn);
  }
  const promptBase = () => (statusData && statusData.repo && statusData.root ? statusData.root : 'sandbox');

  function renderTerminal() {
    if (!term) return;
    const nodes = [];
    for (const h of termHistory) {
      nodes.push(document.createTextNode(`${promptBase()}> ${h.command}\n`));
      if (h.error) {
        nodes.push(document.createTextNode(`${h.error}\n`));
      } else {
        if (h.stdout) nodes.push(document.createTextNode(h.stdout.endsWith('\n') ? h.stdout : `${h.stdout}\n`));
        if (h.stderr) nodes.push(document.createTextNode(h.stderr.endsWith('\n') ? h.stderr : `${h.stderr}\n`));
        const summary = h.failedToSpawn ? 'could not start' : `exited ${h.code} · ${h.durationMs}ms`;
        nodes.push(document.createTextNode(`[${summary}]\n`));
      }
    }
    nodes.push(document.createTextNode(`${promptBase()}> `));
    const echo = el('span', null);
    echo.id = 'vs-termecho';
    const cursor = el('span', 'cursor', '▍');
    nodes.push(echo, cursor);
    fill(term, ...nodes);
  }
  renderTerminal();

  async function runTerminalCommand(raw) {
    const cmd = String(raw || '').trim();
    if (!cmd || terminalBusy) return;
    if (cmd === 'clear') { termHistory.length = 0; renderTerminal(); return; }
    if (!OWNER) {
      termHistory.push({ command: cmd, error: 'This window has no owner token, so it is read-only — open Zeno from its launcher to run commands.' });
      renderTerminal();
      return;
    }
    terminalBusy = true;
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const r = await postJSON('/forge/terminal', { command: cmd });
    terminalBusy = false;
    const durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (!r.ok) {
      termHistory.push({ command: cmd, error: `Command request failed: ${r.error || 'unknown error'}` });
    } else {
      const d = r.data || {};
      termHistory.push({ command: cmd, code: d.code, stdout: d.stdout, stderr: d.stderr, failedToSpawn: d.failedToSpawn, durationMs });
      if (statEls.exitcode) setTrailingText(statEls.exitcode, d.failedToSpawn ? 'exit —' : `exit ${d.code}`);
    }
    if (termHistory.length > 40) termHistory.splice(0, termHistory.length - 40);
    renderTerminal();
    void loadStatus();
    if (currentFile) void openFile(currentFile);
  }

  if (termIn) {
    termIn.value = '';
    termIn.disabled = !OWNER;
    termIn.addEventListener('input', () => {
      const echo = document.getElementById('vs-termecho');
      if (echo) echo.textContent = termIn.value;
    });
    termIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = termIn.value;
      termIn.value = '';
      void runTerminalCommand(v);
    });
  }
  if (term) term.addEventListener('click', () => { if (termIn) termIn.focus(); });

  // "Run Code ▷" and "Run typecheck" buttons: take over from ui.js's mock
  // runTerm() by renaming the attribute it keys off, so both listeners
  // never fire for the same click.
  $$('[data-run-cmd]').forEach((btn) => {
    const cmd = btn.dataset.runCmd;
    btn.removeAttribute('data-run-cmd');
    btn.addEventListener('click', () => {
      showPanel('terminal');
      void runTerminalCommand(cmd);
    });
  });
  function showPanel(name) {
    const tab = $(`.vsptabs [data-vsp="${name}"]`);
    if (tab) tab.click(); // pure UI toggle already wired by ui.js
  }

  // The bottom "Ports" panel ships three fabricated rows (this daemon,
  // Ollama, a vite dev server, all invented port numbers). This page can
  // only ever observe the ONE process it is talking to — its own — so
  // that is the only row drawn; the other two are removed rather than
  // left standing as read state nobody read.
  const portsPanel = $('.vsp[data-vsp="ports"]', ide);
  if (portsPanel) {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80');
    const row = el('div', 'fchg');
    add(row, el('span', 'fdot ok'), document.createTextNode(` ${port} `), el('span', 'fm', `Zeno daemon · ${location.hostname}`));
    const note = el('div', 'vsnote', 'Forge cannot observe other listening ports (Ollama, a dev server, etc.) from the browser, so none are listed here.');
    fill(portsPanel, row, note);
  }

  /* ============================================================ *
   * 5 · SCM panel (real branch/HEAD/changed files; best-effort)    *
   * ============================================================ */
  function renderScm() {
    const scmView = $('.vsside .vsview[data-vsview="scm"] .vspad');
    if (!scmView) return;
    if (!statusData) { fill(scmView, el('div', 'fempty', 'Reading the repository…')); return; }
    if (!statusData.repo) { fill(scmView, el('div', 'fempty', statusData.note || 'The sandbox is not a git repository.')); return; }
    const changed = statusData.changed || [];
    const nodes = [];
    const head = el('div', 'vsfile');
    add(head, el('b', null, statusData.branch || '(unknown)'), el('span', null, statusData.head ? ` · HEAD ${statusData.head}` : ' · no commits yet'));
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

  /* ============================================================ *
   * 6 · AGENTS / MODEL PICKER / VRAM METER (Priority 2)            *
   * ============================================================ */
  const GB = 1024 * 1024 * 1024;

  async function loadAgents() {
    const r = await getJSON('/forge/agents');
    if (!r.ok) { agentsData = null; agentsErr = r.error; } else { agentsData = r.data; agentsErr = null; }
    paintModelPills();
  }
  async function loadHost() {
    if (hostBusy) return;
    hostBusy = true;
    const r = await getJSON('/forge/models/host');
    hostBusy = false;
    hostData = r.ok ? r.data : null;
  }

  function pickerModels() {
    const rows = [];
    const locals = (agentsData && Array.isArray(agentsData.localModels)) ? agentsData.localModels : [];
    for (const name of locals) {
      rows.push({ key: `local::${name}`, agentId: 'local', model: name, name, sub: 'Ollama · on this machine', where: 'local', group: 'On this machine', available: true });
    }
    const list = (agentsData && Array.isArray(agentsData.agents)) ? agentsData.agents : [];
    for (const a of list) {
      if (a.id === 'local') continue;
      const where = a.hosted === false ? 'local' : 'cloud';
      const group = a.label || a.id;
      const avail = a.available !== false;
      const models = Array.isArray(a.models) ? a.models : [];
      if (!models.length) rows.push({ key: `${a.id}::`, agentId: a.id, model: '', name: `${group} · default`, sub: group, where, group, available: avail, reason: a.unavailableReason });
      else for (const m of models) rows.push({ key: `${a.id}::${m}`, agentId: a.id, model: m, name: m, sub: group, where, group, available: avail, reason: a.unavailableReason });
    }
    return rows;
  }

  function approxModelVram(name) {
    const models = (hostData && Array.isArray(hostData.models)) ? hostData.models : null;
    if (!models) return null;
    const hit = models.find((m) => m && m.name === name);
    return hit && Number.isFinite(hit.estVramBytes) && hit.estVramBytes > 0 ? hit.estVramBytes : null;
  }

  // ---- take over the model / effort pills ui.js wired to its mock picker ----
  // Scoped to #ide: [data-model-pill]/[data-effort-pill] also label the
  // top bar chip and the Home/Chats/Settings composer pills (one shared
  // "default model" concept outside Forge). An unscoped query here would
  // steal those buttons — strip ui.js's mock listener off them too and
  // repaint them from Forge's own per-session state, which is wrong for
  // every screen but this one. Only #s-model and the hero pill are Forge's.
  const modelPillEls = $$('[data-model-pill]', ide);
  modelPillEls.forEach((p) => p.removeAttribute('data-model-pill'));
  const effortPillEls = $$('[data-effort-pill]', ide);
  effortPillEls.forEach((p) => p.removeAttribute('data-effort-pill'));

  function modelPillInfo(session) {
    if (!session) return { text: 'Route by policy', cloud: false };
    if (session.autoRoute) return { text: 'Route by policy', cloud: false };
    const local = session.agentId === 'local';
    const label = session.model || (local ? 'default' : session.agentId);
    return { text: `${label} · ${local ? 'local' : 'cloud'}`, cloud: !local };
  }
  function paintModelPills() {
    const session = sessions[activeIdx] || draftSession;
    const info = modelPillInfo(session);
    for (const p of modelPillEls) {
      p.classList.remove('am', 'cy');
      p.classList.add(info.cloud ? 'am' : 'cy');
      fill(p, el('span', 'd'), document.createTextNode(`${info.text} ▾`));
    }
    for (const p of effortPillEls) setTrailingText(p, `effort: ${session.effort || 'medium'} ▾`);
  }
  effortPillEls.forEach((p) => {
    p.addEventListener('click', () => {
      const session = sessions[activeIdx] || draftSession;
      const order = ['low', 'medium', 'high'];
      const i = order.indexOf(session.effort || 'medium');
      session.effort = order[(i + 1) % order.length];
      paintModelPills();
    });
  });

  let mpEl = null, mpAnchor = null;
  const CMP = new Set();
  let mpMode = 'single';
  function closeMp() { if (mpEl) { mpEl.remove(); mpEl = null; } mpAnchor = null; }
  document.addEventListener('click', (e) => { if (mpEl && !mpEl.contains(e.target)) closeMp(); });

  function buildVramFoot(foot, session) {
    fill(foot);
    const rows = pickerModels();
    const selected = [...CMP].map((k) => rows.find((r) => r.key === k)).filter(Boolean);
    const localsSel = selected.filter((r) => r.where === 'local');
    const cloudN = selected.length - localsSel.length;
    const gpu = hostData && hostData.gpu && hostData.gpu.detected ? hostData.gpu : null;
    const hasGpu = Boolean(gpu && typeof gpu.totalVram === 'number' && gpu.totalVram > 0);
    const approx = localsSel.map((r) => approxModelVram(r.model));
    const anyUnknown = approx.some((v) => v == null);
    const sumApprox = approx.reduce((s, v) => s + (v || 0), 0);
    const RESERVE = 1.5 * GB;
    const usable = hasGpu ? Math.max(gpu.totalVram - RESERVE, gpu.totalVram * 0.75) : 0;
    let fit = 'ok';
    if (hasGpu && localsSel.length && !anyUnknown) fit = sumApprox <= usable * 0.85 ? 'ok' : sumApprox <= usable ? 'tight' : 'over';

    const vram = el('div', `mp-vram fit-${fit === 'over' ? 'over' : fit === 'tight' ? 'tight' : 'ok'}`);
    const head = el('div', 'mp-vram-head');
    const gpuLabel = el('span', 'mp-vram-gpu', hasGpu ? `${gpu.name || 'GPU'} · ${(gpu.totalVram / GB).toFixed(0)} GB VRAM` : (hostBusy || !hostData) ? 'Reading GPU capability…' : 'No GPU detected · Ollama uses system RAM');
    add(head, gpuLabel);
    if (hasGpu) {
      const numTxt = (localsSel.length && !anyUnknown) ? `${(sumApprox / GB).toFixed(1)} / ${(gpu.totalVram / GB).toFixed(0)} GB` : `${(gpu.totalVram / GB).toFixed(0)} GB total`;
      add(head, el('span', 'mp-vram-num', numTxt));
    }
    add(vram, head);
    if (hasGpu) {
      const bar = el('div', 'mp-vram-bar');
      const fillPart = el('div', 'mp-vram-fill');
      fillPart.style.width = `${Math.min(100, (localsSel.length && !anyUnknown && sumApprox > 0) ? (sumApprox / gpu.totalVram) * 100 : 0)}%`;
      if (localsSel.length && !anyUnknown && sumApprox > 0) {
        for (const r of localsSel) {
          const v = approxModelVram(r.model);
          if (v) { const s = el('i', 'seg'); s.style.width = `${(v / sumApprox) * 100}%`; s.title = `${r.model} · ≈${(v / GB).toFixed(1)} GB`; add(fillPart, s); }
        }
      }
      if (!fillPart.childElementCount) add(fillPart, el('i', 'seg'));
      add(bar, fillPart);
      const cap = el('span', 'mp-vram-cap');
      cap.style.left = `${Math.min(100, (usable / gpu.totalVram) * 100)}%`;
      cap.title = `Usable budget ≈ ${(usable / GB).toFixed(1)} GB — the rest is reserved for the display`;
      add(bar, cap);
      add(vram, bar);
    }
    const note = el('div', 'mp-vram-note');
    add(note, el('span', 'mp-vram-dot'));
    let noteText;
    if (!hasGpu) noteText = selected.length ? `${localsSel.length} local · ${cloudN} cloud selected — cloud runs off-GPU` : 'Select 2 or 3 models to compare';
    else if (!localsSel.length) noteText = cloudN ? 'Cloud models only — no local VRAM used' : 'Select 2 or 3 models to compare';
    else if (anyUnknown) noteText = 'Approx VRAM unknown for a selected model — projection unavailable';
    else { noteText = fit === 'ok' ? 'fits comfortably on this GPU' : fit === 'tight' ? 'fits — little headroom' : 'won’t fit at once — locals run one at a time'; if (cloudN) noteText += ` · +${cloudN} cloud off-GPU`; }
    add(note, document.createTextNode(noteText));
    add(vram, note);
    add(foot, vram);

    const overflow = hasGpu && localsSel.length > 1 && !anyUnknown && fit === 'over';
    let runMode = session.compareRunMode || 'parallel';
    if (overflow) runMode = 'sequential';
    const rm = el('div', 'mp-runmode');
    const par = el('button', null, 'Parallel'); par.type = 'button'; par.setAttribute('aria-pressed', runMode === 'parallel' ? 'true' : 'false');
    if (overflow) { par.disabled = true; par.title = 'These models exceed this GPU’s VRAM budget — they can’t be held at once'; }
    const seq = el('button', null, 'Sequential'); seq.type = 'button'; seq.setAttribute('aria-pressed', runMode === 'sequential' ? 'true' : 'false');
    par.addEventListener('click', () => { if (par.disabled) return; session.compareRunMode = 'parallel'; renderMpList(); });
    seq.addEventListener('click', () => { session.compareRunMode = 'sequential'; renderMpList(); });
    add(rm, par, seq);
    add(foot, rm);

    const frow = el('div', 'mp-foot-row');
    add(frow, el('span', null, selected.length ? `One task · ${selected.length} model(s) · isolated worktrees` : 'Select 2 or 3 models to run side by side'));
    const runBtn = el('button', 'btn p sm', selected.length ? `Compare ${selected.length} →` : 'Compare →');
    runBtn.type = 'button';
    runBtn.disabled = selected.length < 2;
    runBtn.addEventListener('click', () => {
      // The daemon has no multi-model comparison endpoint. Stay honest: start
      // a real single run on the first pick rather than faking a comparison.
      const first = rows.find((r) => r.key === [...CMP][0]);
      if (!first) return;
      session.agentId = first.agentId; session.model = first.model; session.autoRoute = false;
      closeMp(); paintModelPills();
      const composer = $('#s-ta');
      const text = (composer && composer.value.trim()) || '';
      if (text) void sendTask(session, text);
    });
    add(frow, runBtn);
    add(foot, frow);
  }

  function renderMpList() {
    if (!mpEl) return;
    const session = sessions[activeIdx] || draftSession;
    const list = mpEl.querySelector('.mp-list');
    const foot = mpEl.querySelector('.mp-foot');
    if (!list) return;
    if (mpMode === 'route') {
      const locals = (agentsData && Array.isArray(agentsData.localModels)) ? agentsData.localModels : [];
      const localName = locals[0] || 'a local model';
      const clouds = ((agentsData && agentsData.agents) || []).filter((a) => a.id !== 'local' && a.hosted !== false);
      const wrap = el('div', 'rt');
      const lead = el('div', 'rt-lead');
      add(lead, el('b', null, 'Local-first.'), document.createTextNode(' Zeno runs your task on-device and only reaches a cloud model after you approve the egress.'));
      const ladder = el('div', 'rt-ladder');
      const s1 = el('div', 'rt-step local'); add(s1, el('span', 'n', '1'));
      const s1b = el('div'); add(s1b, el('div', 'rt-t', localName), el('div', 'rt-s', 'Tries here first. Private, no bill, no egress tier.')); add(s1, s1b);
      const s2 = el('div', 'rt-step cloud'); add(s2, el('span', 'n', '2'));
      const s2b = el('div'); add(s2b, el('div', 'rt-t', 'Escalate only if the local model can’t'),
        el('div', 'rt-s', clouds.length ? `Available on this machine: ${clouds.map((c) => c.label || c.id).join(', ')}.` : 'No cloud agent is configured on this machine, so Route stays fully local.'));
      add(s2, s2b);
      add(ladder, s1, s2);
      add(wrap, lead, ladder);
      fill(list, wrap);
      fill(foot);
      return;
    }
    if (agentsErr) { fill(list, el('div', 'mp-empty', `Agents unavailable — ${agentsErr}`)); return; }
    if (!agentsData) { fill(list, el('div', 'mp-empty', 'Reading the available agents…')); return; }
    const searchIn = mpEl.querySelector('.mp-search input');
    const query = searchIn ? searchIn.value.trim().toLowerCase() : '';
    const rows = pickerModels().filter((m) => !query || `${m.name} ${m.sub || ''}`.toLowerCase().includes(query));
    const curKey = session.autoRoute ? null : `${session.agentId}::${session.model || ''}`;
    let lastG = null;
    const nodes = [];
    for (const m of rows) {
      if (m.group && m.group !== lastG) { nodes.push(el('div', 'mp-g', m.group)); lastG = m.group; }
      const b = el('button', 'mp-row');
      b.type = 'button';
      const checked = mpMode === 'compare' ? CMP.has(m.key) : m.key === curKey;
      b.setAttribute('aria-checked', checked ? 'true' : 'false');
      const mn = el('span', 'mn'); add(mn, document.createTextNode(m.name), el('span', null, m.sub || ''));
      const tierText = !m.available ? (m.reason || 'unavailable') : m.where === 'local' ? 'free · on-device' : 'T3 egress';
      add(b, mn, el('span', `mt ${m.available ? (m.where === 'local' ? 'loc' : 'eg') : ''}`.trim(), tierText));
      if (!m.available) { b.disabled = true; b.title = m.reason || 'unavailable'; }
      b.addEventListener('click', () => {
        if (!m.available) return;
        if (mpMode === 'compare') {
          if (CMP.has(m.key)) CMP.delete(m.key); else { if (CMP.size >= 3) return; CMP.add(m.key); }
          if (!hostData && !hostBusy) void loadHost().then(renderMpList);
          renderMpList();
          return;
        }
        session.agentId = m.agentId; session.model = m.model; session.autoRoute = false;
        closeMp();
        paintModelPills();
      });
      nodes.push(b);
    }
    if (!nodes.length) nodes.push(el('div', 'mp-empty', query ? 'No model matches that search.' : 'No models available yet.'));
    fill(list, ...nodes);
    if (mpMode === 'compare') buildVramFoot(foot, session); else fill(foot);
  }

  function openMp(anchor) {
    const session = sessions[activeIdx] || draftSession;
    if (mpEl && mpAnchor === anchor) { closeMp(); return; }
    closeMp();
    mpAnchor = anchor;
    mpMode = session.autoRoute ? 'route' : 'single';
    CMP.clear();
    mpEl = el('div', 'mp');
    mpEl.setAttribute('role', 'dialog');
    mpEl.addEventListener('click', (e) => e.stopPropagation());
    const search = el('div', 'mp-search');
    const q = document.createElement('input');
    q.placeholder = 'Search all models'; q.autocomplete = 'off';
    add(search, q);
    const modeRow = el('div', 'mp-mode');
    const modes = [['single', 'Single'], ['compare', 'Compare'], ['route', 'Route']];
    const btns = modes.map(([id, label]) => {
      const b = el('button', null, label); b.type = 'button';
      b.setAttribute('aria-pressed', id === mpMode ? 'true' : 'false');
      b.addEventListener('click', () => {
        mpMode = id;
        btns.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        if (id === 'route') { session.autoRoute = true; paintModelPills(); }
        if (id === 'compare' && !hostData && !hostBusy) void loadHost().then(renderMpList);
        renderMpList();
      });
      add(modeRow, b);
      return b;
    });
    const list = el('div', 'mp-list');
    const foot = el('div', 'mp-foot');
    add(mpEl, search, modeRow, list, foot);
    document.body.appendChild(mpEl);
    renderMpList();
    const r = anchor.getBoundingClientRect();
    const w = 360, h = Math.min(520, mpEl.offsetHeight || 400);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const top = r.top > h + 12 ? r.top - h - 8 : r.bottom + 8;
    mpEl.style.left = `${left}px`;
    mpEl.style.top = `${Math.max(8, top)}px`;
    q.addEventListener('input', renderMpList);
  }
  modelPillEls.forEach((p) => p.addEventListener('click', (e) => { e.stopPropagation(); openMp(p); }));

  /* ============================================================ *
   * 7 · SESSION PANEL (Priority 2/3)                               *
   * ============================================================ */
  function makeSession() {
    sessionSeq += 1;
    return { id: `s${sessionSeq}`, title: null, chat: [], runs: [], lastProposed: [], agentId: 'local', model: '', effort: 'medium', autoRoute: true, memoryEnabled: true, running: false, pendingHosted: null, compareRunMode: 'parallel' };
  }
  const draftSession = makeSession(); // model/effort state before any session exists

  const sEmpty = $('#s-empty'), sHist = $('#s-history'), sTabs = $('#s-tabs'), sBody = $('#s-body');
  const sTitle = $('#s-title'), sStatus = $('#s-status'), sTurns = $('#s-turns'), sPlanDetails = $('#s-plan');
  if (sPlanDetails) sPlanDetails.hidden = true; // no structured plan from the daemon
  // The artifact ships four fabricated history rows (each wired by ui.js to
  // its own mock openSession()) — dropped immediately so none can ever be
  // clicked, rather than waiting for the first real History open.
  if (sHist) $$('.dvsess', sHist).forEach((n) => n.remove());

  function showEmptyState() {
    activeIdx = -1;
    if (sEmpty) sEmpty.hidden = false;
    if (sHist) sHist.hidden = true;
    if (sTabs) sTabs.hidden = true;
    $$('.sessview').forEach((v) => { v.hidden = true; });
    if (sBody) delete sBody.dataset.open;
    paintModelPills();
  }

  function showActiveSession(session) {
    if (sEmpty) sEmpty.hidden = true;
    if (sHist) sHist.hidden = true;
    if (sTabs) sTabs.hidden = false;
    if (sBody) sBody.dataset.open = '1';
    $$('.sessview').forEach((v) => { v.hidden = v.dataset.stab !== 'chat'; });
    $$('#s-tabs [data-stab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.stab === 'chat' ? 'true' : 'false'));
    const tip = $('#s-tip'); if (tip) tip.hidden = true;
    renderSessionHeader(session);
    renderChat(session);
    renderRuns(session);
    renderActions(session);
    renderPlan(session);
    renderLens(session);
    paintModelPills();
  }

  function renderSessionHeader(session) {
    if (sTitle) sTitle.textContent = session.title || 'New session';
    if (sStatus) {
      const tone = session.running ? 'cy' : session.pendingHosted ? 'am' : 'wt';
      sStatus.className = `pill ${tone}`;
      fill(sStatus, el('span', 'd'), document.createTextNode(session.running ? 'Working' : session.pendingHosted ? 'Waiting on you' : session.chat.length ? 'Idle' : 'New'));
    }
  }

  function turnNode(t, session) {
    const d = el('div', `turn ${t.who === 'you' ? 'you' : 'z'}`);
    const who = el('div', 'who', t.who === 'you' ? 'A' : 'Z');
    const bt = el('div', 'bt');
    if (t.who === 'you') {
      add(bt, el('p', null, t.text));
    } else if (t.who === 'system') {
      add(bt, el('p', null, t.text));
      if (t.confirm) {
        const row = el('div', 'dva-a');
        const b = el('button', 'btn p sm', 'Confirm & run');
        b.type = 'button';
        b.addEventListener('click', () => void confirmHosted(session));
        add(row, b);
        add(bt, row);
      }
    } else {
      add(bt, el('p', null, t.note || (t.files && t.files.length ? `Changed ${t.files.length} file(s).` : 'No files were changed.')));
      for (const path of (t.files || [])) {
        const tool = el('div', 'dvtool');
        add(tool, el('span', 'dvtool-t', path));
        add(bt, tool);
      }
      if (t.waiting) {
        const ap = el('div', 'dvapproval');
        const h = el('div', 'dva-h');
        add(h, el('span', 'tier', 'write'), el('b', null, `${t.waiting} change${t.waiting === 1 ? '' : 's'} need your approval`));
        const a = el('div', 'dva-a');
        const go = el('button', 'btn p sm', 'Review in Command');
        go.type = 'button';
        go.dataset.productGo = 'command';
        go.dataset.then = 'approvals';
        add(a, go);
        add(ap, h, a);
        add(bt, ap);
      }
      if (t.tokenUsage) add(bt, el('div', 'vsnote', t.tokenUsage));
    }
    add(d, who, bt);
    return d;
  }

  function renderChat(session) {
    if (!sTurns) return;
    if (!session.chat.length) { fill(sTurns, el('div', 'fnote', 'Describe the change. Zeno works in an isolated worktree, and every effect waits for your approval in Command.')); return; }
    fill(sTurns, ...session.chat.map((t) => turnNode(t, session)));
    sTurns.scrollTop = sTurns.scrollHeight;
  }

  function renderRuns(session) {
    const view = $('.sessview[data-stab="runs"]');
    if (!view) return;
    if (!session.runs.length) { fill(view, el('div', 'fnote', 'No runs yet in this session.')); return; }
    fill(view, ...session.runs.slice().reverse().map((r) => {
      const card = el('div', 'frun');
      const h = el('div', 'frh');
      add(h, el('span', `pill ${r.ok ? 'gr' : 'rd'}`, r.ok ? 'applied' : 'failed'), el('b', null, r.task.length > 60 ? `${r.task.slice(0, 57)}…` : r.task));
      const m = el('div', 'frm', `${r.agentId}${r.model ? ' · ' + r.model : ''} · ${r.effort || ''} · ${r.files} file(s) · ${r.waiting} waiting · ${r.applied} applied${r.note ? ' · ' + r.note : ''}`);
      add(card, h, m);
      return card;
    }));
  }

  function renderActions(session) {
    const view = $('.sessview[data-stab="actions"]');
    if (!view) return;
    const proposed = session.lastProposed || [];
    if (!proposed.length) { fill(view, el('div', 'fnote', 'No proposed changes from this session yet.')); return; }
    const nodes = proposed.map((p) => {
      const card = el('div', 'fact-c');
      const h = el('div', 'frh');
      add(h, el('span', 'tier', `${p.tier || '?'} · write`), el('b', null, p.path || '(unknown path)'));
      add(card, h, el('div', 'frm', p.auto ? 'already sealed — the kernel auto-committed this write' : 'waiting for your approval'));
      if (!p.auto) {
        const go = el('button', 'laction cy', 'Open in Command');
        go.dataset.productGo = 'command'; go.dataset.then = 'approvals';
        add(card, go);
      }
      return card;
    });
    nodes.push(el('div', 'fnote', 'Each changed file becomes one approval capsule. Forge never applies a write itself; Command approves it.'));
    fill(view, ...nodes);
  }

  function renderPlan(session) {
    const view = $('.sessview[data-stab="plan"]');
    if (!view) return;
    const last = session.chat.slice().reverse().find((t) => t.who === 'agent');
    const nodes = [el('div', 'fnote', 'This daemon does not return a structured step plan — here is the agent’s own run log, unedited.')];
    if (last && last.log) nodes.push(el('pre', 'fterm', last.log));
    else nodes.push(el('div', 'vsnote', 'No run log yet.'));
    fill(view, ...nodes);
  }

  function renderLens(session) {
    const view = $('.sessview[data-stab="lens"]');
    if (!view) return;
    fill(view, el('div', 'fnote', 'Forge Lens’s exact assembled prompt preview is not read by this build. What actually goes to the agent is the task text you typed, plus Vault memory when it is on, plus any skills you select.'));
  }

  // ---- History (real, in-window sessions only — no server-side session store) ----
  const oldHistBtn = $('#s-hist');
  let histBtn = oldHistBtn;
  if (oldHistBtn) { histBtn = oldHistBtn.cloneNode(true); oldHistBtn.replaceWith(histBtn); }
  function renderHistory() {
    if (!sHist) return;
    const header = sHist.querySelector('.vsvh');
    $$('.dvsess', sHist).forEach((n) => n.remove());
    const oldNote = sHist.querySelector('[data-forge-hist-empty]');
    if (oldNote) oldNote.remove();
    if (!sessions.length) {
      const note = el('div', 'fnote', 'No sessions yet in this window.');
      note.dataset.forgeHistEmpty = '1';
      if (header) header.insertAdjacentElement('afterend', note); else sHist.appendChild(note);
      return;
    }
    sessions.forEach((s, i) => {
      const b = el('button', 'dvsess');
      b.dataset.sopen = String(i);
      b.classList.toggle('on', i === activeIdx);
      const dotClass = s.running ? 'working' : s.pendingHosted ? 'awaiting' : (s.runs.length && s.runs[s.runs.length - 1].ok === false) ? 'failed' : s.runs.length ? 'done' : 'working';
      const dvst = el('span', 'dvst');
      add(dvst, el('b', null, s.title || 'New session'), el('span', null, s.running ? 'Working' : s.pendingHosted ? 'Awaiting your approval' : s.runs.length ? `${s.runs.length} run(s)` : 'No runs yet'));
      add(b, el('span', `dvdot ${dotClass}`), dvst);
      b.addEventListener('click', () => { activeIdx = i; showActiveSession(sessions[i]); if (sHist) sHist.hidden = true; });
      sHist.appendChild(b);
    });
  }
  if (histBtn) histBtn.addEventListener('click', () => {
    if (!sHist) return;
    const willOpen = sHist.hidden;
    if (willOpen) { renderHistory(); sHist.hidden = false; if (sTabs) sTabs.hidden = true; $$('.sessview').forEach((v) => { v.hidden = true; }); if (sEmpty) sEmpty.hidden = true; }
    else { sHist.hidden = true; if (activeIdx >= 0) showActiveSession(sessions[activeIdx]); else showEmptyState(); }
  });

  const oldNewBtn = $('#s-new');
  let newBtn = oldNewBtn;
  if (oldNewBtn) { newBtn = oldNewBtn.cloneNode(true); oldNewBtn.replaceWith(newBtn); }
  function startNewSession() {
    const s = makeSession();
    s.agentId = draftSession.agentId; s.model = draftSession.model; s.effort = draftSession.effort; s.autoRoute = draftSession.autoRoute;
    sessions.push(s);
    activeIdx = sessions.length - 1;
    showActiveSession(s);
    const ta = $('#s-ta'); if (ta) ta.focus();
    return s;
  }
  if (newBtn) newBtn.addEventListener('click', () => startNewSession());

  // ---- composer takeover (drop ui.js's mock send/keydown handlers) ----
  function cloneReplace(elm) { if (!elm) return null; const c = elm.cloneNode(true); elm.replaceWith(c); return c; }
  const sSend = cloneReplace($('#s-send'));
  const sTa = cloneReplace($('#s-ta'));
  const agSend = cloneReplace($('#ag-send'));
  const agTa = cloneReplace($('#ag-ta'));

  if (sTa) {
    sTa.disabled = !OWNER;
    sTa.addEventListener('input', () => { sTa.style.height = 'auto'; sTa.style.height = `${Math.min(sTa.scrollHeight, 160)}px`; });
    sTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromComposer(); } });
  }
  function submitFromComposer() {
    if (!sTa) return;
    const text = sTa.value.trim();
    if (!text) return;
    sTa.value = ''; sTa.style.height = 'auto';
    const session = activeIdx >= 0 ? sessions[activeIdx] : startNewSession();
    void sendTask(session, text);
  }
  if (sSend) sSend.addEventListener('click', () => submitFromComposer());

  if (agTa) {
    agTa.disabled = !OWNER;
    agTa.addEventListener('input', () => { agTa.style.height = 'auto'; agTa.style.height = `${Math.min(agTa.scrollHeight, 200)}px`; });
    agTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromHero(); } });
  }
  function submitFromHero() {
    if (!agTa) return;
    const text = agTa.value.trim();
    agTa.value = ''; agTa.style.height = 'auto';
    const session = startNewSession();
    if (text) void sendTask(session, text);
  }
  if (agSend) agSend.addEventListener('click', () => submitFromHero());

  async function sendTask(session, task) {
    task = String(task || '').trim();
    if (!task || session.running) return;
    if (!OWNER) {
      session.chat.push({ who: 'system', text: 'This window has no owner token, so Forge is read-only here — open Zeno from its launcher to run agents.' });
      renderChat(session);
      return;
    }
    if (!session.title) session.title = task.length > 48 ? `${task.slice(0, 45)}…` : task;
    session.running = true;
    session.chat.push({ who: 'you', text: task });
    renderSessionHeader(session);
    renderChat(session);
    renderHistoryIfOpen();

    let route;
    if (session.autoRoute) {
      const r = await postJSON('/forge/route', { task });
      if (!r.ok || !r.data || !r.data.route) {
        session.running = false;
        session.chat.push({ who: 'system', text: `Routing failed: ${r.error || 'the daemon did not answer.'}` });
        renderSessionHeader(session); renderChat(session);
        return;
      }
      route = r.data.route;
      if (route.runnable === false) {
        session.running = false;
        session.chat.push({ who: 'system', text: route.rationale || 'No provider is available on this machine for this task.' });
        renderSessionHeader(session); renderChat(session);
        return;
      }
    } else {
      route = { agentId: session.agentId, model: session.model, effort: session.effort, rationale: 'Manual routing — you selected the model.' };
    }

    if (route.agentId !== 'local') {
      session.running = false;
      session.pendingHosted = { task, route };
      session.chat.push({ who: 'system', text: `This sends your task to ${route.agentId === 'codex' ? 'OpenAI (Codex)' : 'Anthropic (Claude Code)'} — nothing runs until you confirm.`, confirm: true });
      renderSessionHeader(session); renderChat(session); renderHistoryIfOpen();
      return;
    }
    await runResolved(session, task, route, false);
  }

  async function confirmHosted(session) {
    const pending = session.pendingHosted;
    if (!pending) return;
    session.pendingHosted = null;
    session.running = true;
    renderSessionHeader(session);
    await runResolved(session, pending.task, pending.route, true);
  }

  async function runResolved(session, task, route, hostedConfirmed) {
    const runId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const body = { task, memoryEnabled: session.memoryEnabled !== false, skillIds: [...selectedSkillIds], agentId: route.agentId, runId };
    if (route.model) body.model = route.model;
    if (route.effort) body.effort = route.effort;
    if (hostedConfirmed) body.hostedConfirmed = true;
    const r = await postJSON('/forge/run', body);
    session.running = false;
    if (!r.ok) {
      if (r.status === 428 && r.data && r.data.confirmation) {
        session.pendingHosted = { task, route };
        session.chat.push({ who: 'system', text: (r.data.error && r.data.error.message) || 'Confirm this run before it starts.', confirm: true });
      } else {
        session.chat.push({ who: 'system', text: `The run did not start: ${r.error || (r.data && r.data.error && r.data.error.message) || 'unknown error'}` });
      }
      renderSessionHeader(session); renderChat(session); renderHistoryIfOpen();
      return;
    }
    const d = r.data || {};
    const run = d.run || {};
    const proposed = Array.isArray(d.proposed) ? d.proposed : [];
    const changed = Array.isArray(d.changed) ? d.changed : [];
    const applied = proposed.filter((p) => p && p.auto).length;
    const waiting = proposed.length - applied;
    session.lastProposed = proposed;
    session.chat.push({
      who: 'agent', agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed, waiting, applied, log: typeof run.log === 'string' ? run.log : '',
      note: run.ok === false ? (run.note || 'The agent did not complete this task.') : (run.note || ''),
    });
    session.runs.push({
      task, ok: run.ok === true, agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed.length, waiting, applied, note: run.ok === false ? (run.note || '') : '',
    });
    renderSessionHeader(session); renderChat(session); renderRuns(session); renderActions(session); renderPlan(session); renderHistoryIfOpen();
    void loadStatus();
    if (currentFile) void openFile(currentFile);
  }

  function renderHistoryIfOpen() { if (sHist && !sHist.hidden) renderHistory(); }

  /* ============================================================ *
   * 8 · boot                                                       *
   * ============================================================ */
  // Replace the artifact's mock tree/editor/SCM content with an honest
  // "reading" state SYNCHRONOUSLY, so nothing fabricated is ever on screen
  // even for the brief window before the first daemon round-trip resolves.
  renderEditorEmpty('Reading the sandbox from the daemon…');
  renderExplorer();
  renderScm();
  showEmptyState();
  renderTerminal();
  await Promise.all([loadStatus(), loadAgents(), renderGov(), loadZenoView()]);
  paintModelPills();

  if (notWiredNotes.length) console.info('[zeno] forge binder — not wired this pass:', notWiredNotes);
}
