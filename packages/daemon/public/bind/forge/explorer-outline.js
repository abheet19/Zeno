/**
 * bind/forge/explorer-outline.js — the Explorer's OUTLINE and TIMELINE.
 *
 * OUTLINE is a pattern scan of the OPEN file's own text, labelled as exactly
 * that: Markdown headings, and top-level declarations in the languages the
 * rules below cover (functions, classes, exported consts, interfaces/types,
 * Python defs, Go/Rust/Java/C# declarations, a JSON file's top-level keys).
 * It is not a language server and never claims to be — a nested function or
 * an unusual declaration form is simply not listed, and the section says
 * which rules ran. Clicking an entry reveals its line in the real editor.
 *
 * TIMELINE is git's own history for the open file — GET /forge/log (git
 * log --follow) — or the repository's last commits when no file is open.
 *
 * Registers `S.scanSymbols`, `S.outlineSymbols`, `S.renderOutline` and
 * `S.renderTimeline`; editor-view.js calls the two renders after a file is
 * opened, and editor.js re-runs the outline (debounced) as the buffer changes.
 */
import { $, el, fill, getJSON } from '../../bind.js';
import { add } from './dom.js';

/** Which scan applies to a path, by extension. Anything else has no rules. */
const RULES = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', mts: 'js', cts: 'js', tsx: 'js',
  py: 'python', go: 'go', rs: 'rust', java: 'clike', cs: 'clike', kt: 'clike', swift: 'clike',
  json: 'json',
};

const JS_RULES = [
  [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function'],
  [/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'const'],
  [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
  [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
];
const SCANS = {
  markdown: (line) => { const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line); return m ? { name: m[2], kind: `h${m[1].length}`, level: Math.min(4, m[1].length) } : null; },
  js: (line) => { for (const [rx, kind] of JS_RULES) { const m = rx.exec(line); if (m) return { name: m[1], kind, level: 1 }; } return null; },
  python: (line) => { const m = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/.exec(line); return m ? { name: m[2], kind: m[1] === 'def' ? 'function' : 'class', level: 1 } : null; },
  go: (line) => { const m = /^(?:func\s+(?:\([^)]*\)\s*)?|type\s+)([A-Za-z_]\w*)/.exec(line); return m ? { name: m[1], kind: /^func/.test(line) ? 'function' : 'type', level: 1 } : null; },
  rust: (line) => { const m = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|mod|type)\s+([A-Za-z_]\w*)/.exec(line); return m ? { name: m[2], kind: m[1] === 'fn' ? 'function' : m[1], level: 1 } : null; },
  clike: (line) => { const m = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data)\s+)*(class|interface|enum|record|struct|object|fun)\s+([A-Za-z_]\w*)/.exec(line); return m ? { name: m[2], kind: m[1] === 'fun' ? 'function' : m[1], level: 1 } : null; },
  json: (line) => { const m = /^ {2}"([^"]+)"\s*:/.exec(line); return m ? { name: m[1], kind: 'key', level: 1 } : null; },
};

/** [{name, kind, line, level}] for a path's text, or null when no rules cover its extension. */
export function scanSymbols(path, text) {
  const ext = String(path || '').toLowerCase().split('.').pop();
  const rule = RULES[ext];
  if (!rule) return null;
  const scan = SCANS[rule];
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length && out.length < 500; i++) {
    const line = lines[i];
    // A Markdown code fence must not contribute its `# comment` lines as headings.
    if (rule === 'markdown' && /^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const hit = scan(line);
    if (hit) out.push({ ...hit, line: i + 1 });
  }
  return out;
}

function relativeTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 60) return `${d} days ago`;
  return new Date(t).toLocaleDateString();
}

export function setupExplorerOutline(S) {
  const ide = S.ide;
  const outlineHead = $('.vsview[data-vsview="explorer"] [data-explorer-sect="outline"]', ide);
  const timelineHead = $('.vsview[data-vsview="explorer"] [data-explorer-sect="timeline"]', ide);
  let outlineBody = null;
  let timelineBody = null;
  // Each body sits right after its header, where ui.js's section toggle
  // (which hides every sibling up to the next header) will find it.
  if (outlineHead && !outlineHead.dataset.forgeFilled) {
    outlineHead.dataset.forgeFilled = '1';
    outlineBody = el('div', 'vsoutline');
    outlineBody.hidden = !outlineHead.classList.contains('open');
    outlineHead.insertAdjacentElement('afterend', outlineBody);
  }
  if (timelineHead && !timelineHead.dataset.forgeFilled) {
    timelineHead.dataset.forgeFilled = '1';
    timelineBody = el('div', 'vsoutline');
    timelineBody.dataset.timeline = '1';
    timelineBody.hidden = !timelineHead.classList.contains('open');
    timelineHead.insertAdjacentElement('afterend', timelineBody);
  }

  S.scanSymbols = scanSymbols;
  function outlineSymbols() {
    const path = S.currentFile;
    if (!path) return [];
    const text = S.currentFileText ? S.currentFileText() : null;
    if (text === null || text === undefined) return [];
    return scanSymbols(path, text) || [];
  }
  S.outlineSymbols = outlineSymbols;

  function renderOutline() {
    if (!outlineBody) return;
    const path = S.currentFile;
    if (!path) { fill(outlineBody, el('div', 'vsnote', 'No file is open.')); return; }
    const text = S.currentFileText ? S.currentFileText() : null;
    if (text === null || text === undefined) { fill(outlineBody, el('div', 'vsnote', `${path} has no readable text to scan (binary, or still loading).`)); return; }
    const syms = scanSymbols(path, text);
    const ext = path.toLowerCase().split('.').pop();
    if (syms === null) {
      fill(outlineBody, el('div', 'vsnote', `No outline rules for .${ext} files — the scan covers Markdown headings and top-level declarations in JS/TS, Python, Go, Rust, Java/C#/Kotlin and JSON.`));
      return;
    }
    if (!syms.length) { fill(outlineBody, el('div', 'vsnote', `No top-level declarations found in ${path.split('/').pop()} (pattern scan, not a language server).`)); return; }
    const nodes = syms.map((s) => {
      const r = el('div', 'vsfile');
      r.dataset.outline = String(s.line);
      r.dataset.level = String(s.level || 1);
      r.title = `${s.kind} · line ${s.line} — click to reveal in the editor`;
      add(r, el('span', 'vskind', s.kind), el('span', 'vslabel', s.name));
      r.addEventListener('click', () => { if (S.setForgeView) S.setForgeView('editor'); S.revealLineInPrimaryGroup(path, s.line); });
      return r;
    });
    nodes.push(el('div', 'vsnote', `${syms.length} symbol${syms.length === 1 ? '' : 's'} · pattern scan of the open buffer, not a language server.`));
    fill(outlineBody, ...nodes);
  }
  S.renderOutline = renderOutline;

  let timelineSeq = 0;
  async function renderTimeline() {
    if (!timelineBody) return;
    if (!S.statusData || !S.statusData.repo) { fill(timelineBody, el('div', 'vsnote', 'No repository — no history to show.')); return; }
    const path = S.currentFile;
    const seq = ++timelineSeq;
    const r = await getJSON(`/forge/log${path ? `?path=${encodeURIComponent(path)}` : ''}`);
    if (seq !== timelineSeq) return; // a later open superseded this read
    if (!r.ok) { fill(timelineBody, el('div', 'vsnote', `History could not be read: ${r.error}`)); return; }
    const commits = Array.isArray(r.data.commits) ? r.data.commits : [];
    const nodes = [el('div', 'vsnote', path ? `${path.split('/').pop()} · git log --follow` : 'Repository · last commits')];
    if (!commits.length) {
      nodes.push(el('div', 'vsnote', path ? 'No commits touch this file yet — it is new or untracked.' : 'git reports no commits yet.'));
    }
    for (const c of commits) {
      const row = el('div', 'vsfile');
      row.dataset.commit = c.sha || '';
      row.title = `${c.sha} · ${c.author || ''} · ${c.date || ''}`;
      add(row, el('span', 'vskind', c.sha || ''), el('span', 'vslabel', c.summary || '(no message)'), el('span', 'vsmod', relativeTime(c.date)));
      nodes.push(row);
    }
    if (r.data.truncated) nodes.push(el('div', 'vsnote', `Showing the last ${r.data.cap} commits.`));
    fill(timelineBody, ...nodes);
  }
  S.renderTimeline = renderTimeline;

  renderOutline();
  return { renderOutline, renderTimeline };
}
