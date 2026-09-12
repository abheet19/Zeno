/*
 * bind.js — the seam between the artifact UI and the real daemon.
 *
 * ui.js (ported verbatim from the design artifact) owns the markup's behaviour:
 * navigation, menus, pickers, tabs, toasts. It ships with the artifact's MOCK
 * data. This module replaces that mock data with what the daemon actually
 * reports, and re-points each CTA at its real effect.
 *
 * Each screen binds in its own module so one failure cannot blank the window:
 * a binder that throws is reported and skipped, and the screen it owns keeps
 * the markup it already has rather than taking the whole UI down with it.
 *
 * The honesty rule that governs every binder: a number is only drawn when it
 * was actually read. An unread value is "—" or a stated "could not read", never
 * a hopeful zero, and never the artifact's placeholder left standing.
 */

/** The owner token the daemon stamped into the shell. Empty = read-only page. */
export function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return (m && m.getAttribute('content')) || '';
}

export function authHeaders() {
  const t = token();
  return t ? { 'x-zeno-token': t } : {};
}

/**
 * One GET, reported honestly. Never throws at the caller: binders decide what
 * an unread endpoint should say on screen, and they can only do that if they
 * are told which one failed rather than handed an exception.
 */
export async function getJSON(path) {
  try {
    const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return { ok: false, status: res.status, error: `${path} answered ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, status: 0, error: `${path} could not be reached: ${err && err.message}` };
  }
}

/**
 * The screen SECTION for a Command screen — never the rail button.
 *
 * Both the left rail's nav button and the screen itself carry
 * data-screen="<name>", and the rail comes first in the document, so a bare
 * querySelector('[data-screen="receipts"]') returns a <button>. A binder that
 * scopes its lookups to that button finds none of its markup, returns quietly,
 * and leaves the artifact's MOCK rows on screen looking like real data — the
 * one failure this product must never ship. Always resolve a screen with this.
 */
export function screenEl(name) {
  return document.querySelector(`section.screen[data-screen="${name}"], .screen[data-screen="${name}"]`);
}

/** Small DOM helpers the binders share. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function setText(sel, text, root = document) {
  const el = typeof sel === 'string' ? $(sel, root) : sel;
  if (el) el.textContent = text;
  return el;
}
/** Replace a node's children with built nodes (never innerHTML with live data). */
export function fill(el, ...nodes) {
  if (!el) return el;
  el.replaceChildren(...nodes.filter(Boolean));
  return el;
}
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/* ---- the binder registry -------------------------------------------------
   Dynamic imports so a binder that is not written yet, or that fails to parse,
   degrades to "this screen still shows the design's placeholder" instead of
   breaking every other screen in the window. */
const BINDERS = [
  './bind/home.js',
  './bind/approvals.js',
  './bind/receipts.js',
  './bind/lists.js',
  './bind/forge.js',
  './bind/counsel.js',
  './bind/devices.js',
  './bind/settings.js',
];

const loaded = [];
const failed = [];

async function runBinder(path) {
  try {
    const mod = await import(path);
    if (typeof mod.bind === 'function') {
      await mod.bind();
      loaded.push(path);
    }
  } catch (err) {
    failed.push({ path, error: String((err && err.message) || err) });
  }
}

/**
 * The rail/mobile count badges.
 *
 * These are shared chrome rather than any one screen's, and the artifact ships
 * them with invented numbers (Approvals 1, Chats 3, Work 5, Vault 12, Devices 1,
 * Integrations 4). A stale mock count in the rail is a lie the owner acts on, so
 * every badge is cleared first and then written ONLY from a read that answered.
 * A count that could not be read stays blank — never a hopeful 0.
 */
async function bindRailBadges() {
  const badge = (screen, value) => {
    for (const sel of [`.rail .nav-i[data-screen="${screen}"] .ct`, `.mtabs [data-screen="${screen}"] .mbadge`]) {
      const node = document.querySelector(sel);
      if (!node) continue;
      const show = Number.isFinite(value) && value > 0;
      node.textContent = show ? String(value) : '';
      node.hidden = !show;
    }
  };
  // Clear every mock count up front: nothing survives that we did not just read.
  for (const s of ['approvals', 'chats', 'work', 'vault', 'devices', 'integrations']) badge(s, null);

  const [state, work, memory, agents] = await Promise.all([
    getJSON('/state'), getJSON('/work'), getJSON('/memory'), getJSON('/forge/agents'),
  ]);
  if (state.ok) badge('approvals', Array.isArray(state.data?.pending) ? state.data.pending.length : null);
  if (work.ok) {
    const items = state.ok && Array.isArray(work.data?.items) ? work.data.items : work.data?.items;
    badge('work', Array.isArray(items) ? items.length : null);
  }
  if (memory.ok) {
    const notes = memory.data?.notes ?? memory.data?.memories ?? memory.data?.items;
    badge('vault', Array.isArray(notes) ? notes.length : null);
  }
  if (agents.ok) {
    const list = agents.data?.agents;
    badge('integrations', Array.isArray(list) ? list.length : null);
  }
  // Chats live in this browser, not the daemon — count what is actually stored.
  try {
    const raw = localStorage.getItem('zeno-chats');
    const arr = raw ? JSON.parse(raw) : [];
    badge('chats', Array.isArray(arr) ? arr.length : null);
  } catch { /* storage blocked: the badge simply stays blank */ }
}

async function boot() {
  await Promise.all(BINDERS.map(runBinder));
  try { await bindRailBadges(); } catch (err) { failed.push({ path: 'rail-badges', error: String(err && err.message) }); }
  // Surfaced for the verification pass — which screens are real, which are not.
  window.__zenoBind = { loaded, failed };
  if (failed.length) console.warn('[zeno] binders not applied:', failed);
  document.dispatchEvent(new CustomEvent('zeno:bound', { detail: { loaded, failed } }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else void boot();
