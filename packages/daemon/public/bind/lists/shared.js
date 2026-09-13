/**
 * bind/lists/shared.js — the small, screen-agnostic helpers every lists/*.js
 * module builds on: string/date formatting, the artifact's own DOM shapes
 * (`.lrow`, `.pill`, `.lcard`, `.empty`, a heading/note pair), a POST/DELETE
 * pair with the same never-throw contract as bind.js's `getJSON`, a toast
 * borrowed from the `#toast` element/CSS ui.js already ships, and the
 * "facts" shaping shared by Integrations' `.lcard` rows and Customize's
 * `.lrow` rows for the same `/forge/connectors` and `/forge/extensions`
 * payloads (so the two screens can never drift on what a field means).
 *
 * See bind/lists.js for the full endpoint list and per-screen documentation.
 */

import { authHeaders, el } from '../../bind.js';

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function plural(n, one, many) { return n === 1 ? one : many; }

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = (Date.now() - t) / 60000;
  return m < 0 ? 0 : m;
}
function ageStr(iso) {
  const m = minutesSince(iso);
  if (m == null) return null;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}

/* git's porcelain XY code, said in words. Anything unrecognised keeps its
   raw code rather than guessing at a word for it. */
function gitWord(code) {
  const c = String(code || '').trim();
  const map = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged',
    '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified twice',
  };
  return map[c] || null;
}

async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      cache: 'no-store',
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errObj = data && typeof data === 'object' ? data.error : null;
      const msg = (errObj && errObj.message) || `${path} answered ${res.status}`;
      const resolve = errObj && errObj.resolve;
      return { ok: false, status: res.status, data, error: resolve ? `${msg} ${resolve}` : msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${err && err.message}` };
  }
}

async function deleteJSON(path) {
  try {
    const res = await fetch(path, { method: 'DELETE', headers: authHeaders(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errObj = data && typeof data === 'object' ? data.error : null;
      const msg = (errObj && errObj.message) || `${path} answered ${res.status}`;
      return { ok: false, status: res.status, data, error: msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${err && err.message}` };
  }
}

/** Same tiny toast ui.js defines, kept local so this file never reaches into
 *  ui.js's closure — it only reuses the `#toast` element/CSS ui.js ships. */
function toast(msg) {
  try {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._zenoListsTimer);
    t._zenoListsTimer = setTimeout(() => t.classList.remove('on'), 2400);
  } catch { /* a toast is a nicety, never worth failing over */ }
}

/** The artifact's `.lrow`: a `.tier` badge, a title/meta block, and an
 *  optional right-side pill or action. Callers pass plain text only — never
 *  markup — so every field goes through textContent. */
function lrowEl(tierText, title, meta, right) {
  const row = el('div', 'lrow');
  row.appendChild(el('span', 'tier', tierText || ''));
  const mid = el('div', null);
  mid.appendChild(el('div', 'tt', title || ''));
  if (meta) mid.appendChild(el('div', 'mm', meta));
  row.appendChild(mid);
  if (right) row.appendChild(right);
  return row;
}

/** The artifact's `.pill`, coloured (gr/am/rd/cy) or neutral (wt). */
function pillEl(text, cls) {
  const span = el('span', 'pill' + (cls ? ' ' + cls : ''));
  span.appendChild(el('span', 'd'));
  span.appendChild(document.createTextNode(text));
  return span;
}

/** The artifact's `.empty`: a dashed box, a bold headline, then the rest. */
function emptyEl(strong, rest) {
  const d = el('div', 'empty');
  d.appendChild(el('b', null, strong));
  if (rest) d.appendChild(document.createTextNode(' ' + rest));
  return d;
}
function loadingEl(text) { return el('div', 'empty', text); }
function unreadableEl(what, err) {
  return emptyEl(what + ' could not be read.', (err ? String(err) + ' ' : '') + 'This is a failure to read, not an absence.');
}

/** A small muted section label — inline-styled (matching this codebase's own
 *  convention of inline layout tweaks in the markup) rather than a class the
 *  artifact's stylesheet never defined, so no new CSS rule is introduced. */
function headingEl(text) {
  const d = el('div', null, text);
  d.style.cssText = 'font:600 10px/1.4 var(--font-mono,ui-monospace,Consolas,monospace);'
    + 'letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#6C7480);margin:12px 2px 4px';
  return d;
}
function noteEl(text) {
  const p = el('p', null, text);
  p.style.cssText = 'font-size:11px;line-height:1.5;color:var(--ink-2,#9AA1AC);margin:6px 2px 0';
  return p;
}

/** The artifact's `.lcard`: a `.lk` title, a `.lm` meta line, and an optional
 *  `.lr` right-side node. Shared by Integrations' `.live-cards` list and
 *  bind/lists/mcp.js's `createMcpManager('lcard')` shape. */
function lcardOuter(titleText, metaText, rightNode) {
  const card = el('div', 'lcard');
  card.style.marginBottom = '10px';
  card.appendChild(el('div', 'lk', titleText));
  card.appendChild(el('div', 'lm', metaText || ''));
  if (rightNode) {
    const lr = el('div', 'lr');
    lr.appendChild(rightNode);
    card.appendChild(lr);
  }
  return card;
}

/** Sets a control honestly inert: disabled, visibly dimmed, and — unlike a
 *  live control that merely happens to do nothing — carrying the reason in
 *  its `title` so the state is discoverable, not just implied. Matches the
 *  disabled-button convention bind/forge.js already uses (`b.disabled = true;
 *  b.title = m.reason`); `.btn`/`.laction` already style `:disabled` dim in
 *  screens/artifact.css, this only adds the same treatment inline for
 *  elements that rule does not reach. */
function disableBtn(btn, reason) {
  if (!btn) return;
  btn.disabled = true;
  btn.style.opacity = '.5';
  btn.style.cursor = 'not-allowed';
  if (reason) btn.title = reason;
}

/* ---- "facts" shaping shared by Integrations' `.lcard`s and Customize's
 * `.lrow`s — the same /forge/connectors and /forge/extensions payloads drawn
 * two different shapes, kept in exactly one place so the two screens can
 * never disagree on what a field means. ---- */

/* ---- connectors — GET /forge/connectors, real bundled bridges only ----
 * This is NOT a third-party-account catalog (no Google Drive / Slack / Notion
 * — this daemon has no such thing anywhere in server.ts); it is the small,
 * fixed set of MCP-shaped bridges Forge itself may admit into a governed run
 * (the permission gate, the isolated browser, the owner's own Chrome), each
 * either configured by this daemon's own startup options or not. */
function connectorFacts(c) {
  c = c || {};
  const configured = c.configured === true;
  const attached = c.attached === true;
  const label = attached ? 'attached' : configured ? 'configured' : 'not configured';
  const cls = attached || configured ? 'gr' : 'wt';
  const meta = [
    configured ? 'configured' : 'not configured',
    Array.isArray(c.tools) && c.tools.length ? c.tools.length + ' ' + plural(c.tools.length, 'tool', 'tools') : null,
    typeof c.activeRuns === 'number' ? c.activeRuns + ' active ' + plural(c.activeRuns, 'run', 'runs') : null,
    typeof c.allowedOrigins === 'number' ? c.allowedOrigins + ' allowed ' + plural(c.allowedOrigins, 'origin', 'origins') : null,
    c.provenance || null,
  ].filter(Boolean).join(' · ');
  return { name: c.name || c.id || 'connector', meta, pillText: label, pillCls: cls, permissions: c.permissions ? String(c.permissions) : '' };
}

/* ---- extensions — GET /forge/extensions: built-ins, skill provenance, snippets ---- */
function builtinFacts(b) {
  b = b || {};
  const perms = Array.isArray(b.permissions) ? b.permissions.join('; ') : '';
  const meta = [b.kind, b.provenance, Array.isArray(b.variants) && b.variants.length ? 'variants: ' + b.variants.join(', ') : null]
    .filter(Boolean).join(' · ');
  return { name: b.name || b.id || 'extension', meta, pillText: b.status === 'enabled' ? 'enabled' : (b.status || 'listed'), pillCls: b.status === 'enabled' ? 'gr' : 'wt', permissions: perms };
}
function snippetFacts(sn) {
  sn = sn || {};
  const unreadable = sn.status === 'unreadable';
  const meta = [sn.provenance, unreadable ? null : (sn.entries || 0) + ' ' + plural(sn.entries || 0, 'entry', 'entries'),
    unreadable ? sn.reason || 'unreadable' : (sn.enabledInMonaco ? 'enabled in Monaco' : 'not wired to the editor'),
  ].filter(Boolean).join(' · ');
  return { name: sn.file || 'snippets file', meta, pillText: unreadable ? 'unreadable' : 'catalogued', pillCls: unreadable ? 'rd' : 'wt' };
}
function skillSourceLine(s) {
  s = s || {};
  return '· ' + s.path + ' — ' + (s.provenance || 'unlabelled source') + ' — '
    + (s.installed || 0) + ' ' + plural(s.installed || 0, 'skill', 'skills')
    + (s.unreadable ? ', ' + s.unreadable + ' unreadable' : '')
    + (s.reason ? ' (' + s.reason + ')' : '');
}

export {
  clip, plural, minutesSince, ageStr, gitWord,
  postJSON, deleteJSON, toast,
  lrowEl, pillEl, emptyEl, loadingEl, unreadableEl, headingEl, noteEl, lcardOuter, disableBtn,
  connectorFacts, builtinFacts, snippetFacts, skillSourceLine,
};
