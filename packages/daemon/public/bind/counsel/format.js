/**
 * bind/counsel/format.js — small, stateless display-formatting helpers
 * shared by Counsel's view modules. Nothing here reads or writes any of
 * bind/counsel.js's live call/archive state; each function is a pure
 * transform of its arguments (or, for `pill`/`setPillText`, a small DOM
 * builder with no dependency beyond bind.js's own element helpers). That is
 * what makes it safe for every counsel/*.js view module — and bind/counsel.js
 * itself, for the one case a test-extracted handler needs one (beginCall
 * uses fmtElapsed) — to import directly.
 */
import { el, fill } from '../../bind.js';

export function pill(cls, text) {
  const p = el('span', `pill${cls ? ' ' + cls : ''}`);
  if (cls === 'cy' || cls === 'am' || cls === 'gr' || cls === 'rd') p.append(el('span', 'd'));
  p.append(document.createTextNode(text));
  return p;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '—');
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
export function fmtMinutes(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${mins}m`;
}
export function elapsedLabel(m, iso) {
  const start = Date.parse(m.startedAt);
  const at = Date.parse(iso);
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return null;
  return fmtElapsed(at - start);
}
export function slugify(s) {
  return String(s || 'call').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'call';
}

/** Rewrite a `.pill` node's class + content in place — used across the
 *  preflight card and the live bar, wherever a pill's state changes rather
 *  than being drawn once and left alone. */
export function setPillText(pillEl, cls, text, dot) {
  if (!pillEl) return;
  pillEl.className = `pill ${cls}`;
  const nodes = dot ? [el('span', 'd')] : [];
  nodes.push(document.createTextNode(text));
  fill(pillEl, ...nodes);
}
