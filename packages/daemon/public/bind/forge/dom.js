/**
 * bind/forge/dom.js — small, stateless helpers shared by every Forge module.
 *
 * Nothing here reads or writes the shared `S` state object; each function is
 * a pure(ish) transform of its arguments (or, for postJSON, a fetch wrapper
 * with no dependency beyond bind.js's own auth header helper). That is what
 * makes it safe for every other forge/*.js module to import directly instead
 * of going through the state registry.
 */
import { authHeaders } from '../../bind.js';

/** Append every truthy child to `parent`. Returns `parent` for chaining. */
export function add(parent, ...kids) {
  if (!parent) return parent;
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}

export function bytesLabel(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Human word for a git porcelain status code. */
export function statusWord(code) {
  const map = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged',
    '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified',
  };
  return map[String(code || '').trim()] || `git: ${String(code || '?').trim()}`;
}

/** One run's status word + pill tone — shared by the Runs tab's run cards
 *  (bind/forge/session.js's renderRuns) and the Session tab's agent-turn
 *  header (turnNode), so the two views can never disagree about how a run
 *  ended.
 *
 *  A Forge run NEVER applies anything. Every file it changes becomes an
 *  approval capsule, and the kernel writes only after the owner clicks in
 *  Command — so "applied" is the one outcome this card structurally cannot
 *  report on its own. An earlier build reported it anyway for every
 *  successful run, in green, directly above its own line reading "1 waiting
 *  · 0 applied". That is the exact claim this function exists to make
 *  impossible: "applied" only ever means the kernel auto-committed a T0
 *  write by itself. */
export function runMark(r) {
  return r.cancelled ? { tone: 'wt', word: 'cancelled' }
    : !r.ok ? { tone: 'rd', word: 'failed' }
      : r.waiting > 0 ? { tone: 'am', word: `${r.waiting} waiting on you` }
        : r.applied > 0 ? { tone: 'gr', word: 'applied' }
          : { tone: 'wt', word: 'no changes' };
}

/** [className, badge glyph] for a file name, using only classes this
 * stylesheet actually defines colour for (.vsi.ts/.tsx/.md/.json/.git/.txt). */
export function fileMeta(name) {
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

export function languageLabel(path) {
  const ext = String(path || '').toLowerCase().split('.').pop();
  const map = {
    tsx: 'TypeScript JSX', ts: 'TypeScript', jsx: 'JavaScript JSX', js: 'JavaScript',
    md: 'Markdown', json: 'JSON', css: 'CSS', scss: 'SCSS', html: 'HTML', htm: 'HTML',
    yml: 'YAML', yaml: 'YAML', gitignore: 'Ignore',
  };
  return map[ext] || 'Plain Text';
}

/** One fetch shape for POST bodies (bind.js's getJSON only does GET). */
export async function postJSON(path, body) {
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
export function setTrailingText(node, text) {
  if (!node) return;
  [...node.childNodes].forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
  node.appendChild(document.createTextNode(text));
}

/** Disable a control and give it an honest, visible reason. `.btn` already
 *  dims on `:disabled` (see index.html's own `.btn:disabled` rule); the
 *  toolbar's icon-only `.fico` controls and this file's own `.plus-item`
 *  menu rows have no such rule, so a disabled one is otherwise
 *  indistinguishable from a live one — inline style closes that gap
 *  without touching any stylesheet. */
export function disableCtl(elm, reason) {
  if (!elm) return;
  elm.disabled = true;
  elm.title = reason;
  elm.style.opacity = '0.45';
  elm.style.cursor = 'not-allowed';
}

/** window.prompt/alert, but safe: some embeddings (a strict iframe, an
 *  Electron webview with dialogs turned off) throw instead of returning
 *  null, which would otherwise crash the click handler that called it
 *  silently. Degrade to console + the given fallback instead. */
export function safeAsk(fn, fallback) {
  try { return fn(); } catch (err) {
    console.warn('[zeno] a native dialog is unavailable in this window:', err);
    return fallback;
  }
}

/** Clone a node onto itself, dropping every listener the clone's source had
 *  (used to take a CTA over from ui.js's mock wiring without also carrying
 *  its listener — cloneNode(true) copies markup, not event listeners). */
export function cloneReplace(elm) {
  if (!elm) return null;
  const c = elm.cloneNode(true);
  elm.replaceWith(c);
  return c;
}
