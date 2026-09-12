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

  /* Forge chrome carries the same claim in four more places, all hardcoded by
     the artifact: the cyan "1 approval waiting" call-to-action, the activity
     bar's source-control and Zeno badges, and the session panel's Actions tab.
     Telling the owner something is held when nothing is held is the exact lie
     this kernel exists to prevent, so each is written from the real count or
     hidden outright. */
  const pending = state.ok && Array.isArray(state.data?.pending) ? state.data.pending.length : null;

  const cta = document.querySelector('.tbcta');
  if (cta) {
    const n = Number.isFinite(pending) ? pending : 0;
    cta.hidden = n === 0;
    if (n > 0) cta.textContent = `${n} approval${n === 1 ? '' : 's'} waiting →`;
  }

  const zenoBadge = document.querySelector('.vsact [data-vsview="zeno"] .vsbadge');
  if (zenoBadge) {
    const n = Number.isFinite(pending) ? pending : 0;
    zenoBadge.textContent = n > 0 ? String(n) : '';
    zenoBadge.hidden = n === 0;
  }

  const actions = document.querySelector('#s-tabs [data-stab="actions"] .fct');
  if (actions) {
    const n = Number.isFinite(pending) ? pending : 0;
    actions.textContent = n > 0 ? String(n) : '';
    actions.hidden = n === 0;
  }

  /* The top-bar model chip. The artifact hardcodes "qwen3:8b · local"; this
     window may well be routed to something else, and a chip that names the wrong
     model is worse than no chip. Name the model actually in force. */
  const chip = document.querySelector('.topright .chip, [data-model-pill="chip"]');
  if (chip) {
    const label = chip.querySelector('[data-mount="top-model"]') || chip.lastChild;
    const ag = await getJSON('/forge/agents');
    let text = null;
    if (ag.ok) {
      const locals = Array.isArray(ag.data?.localModels) ? ag.data.localModels : [];
      const def = ag.data?.defaultModel || ag.data?.model;
      if (def) text = `${def} · local`;
      else if (locals.length === 1) text = `${locals[0]} · local`;
      else if (locals.length > 1) text = `${locals.length} local models`;
      else text = 'no local model';
    }
    if (label && text) {
      if (label.nodeType === 3) label.textContent = text;
      else label.textContent = text;
      chip.title = 'The model this window uses. Click to choose another.';
    } else if (!ag.ok) {
      if (label) label.textContent = 'model unread';
      chip.title = ag.error || 'The runtime could not be read.';
    }
  }

  /* Force the Standing Field to measure itself. field.js sizes its canvas from
     a ResizeObserver on the mount's parent; when the mount already had its final
     height before init, no resize ever fires and the canvas stays at the browser
     default 300x150 — mounted but blank. A one-frame height nudge makes the
     observer deliver a real box. */
  const fieldMount = document.querySelector('[data-mount="field"]');
  if (fieldMount) {
    const prev = fieldMount.style.minHeight;
    fieldMount.style.minHeight = (Math.round(fieldMount.getBoundingClientRect().height) + 1) + 'px';
    requestAnimationFrame(() => { fieldMount.style.minHeight = prev; });
  }

  // The source-control badge is the sandbox's uncommitted-file count, not approvals.
  const scm = document.querySelector('.vsact [data-vsview="scm"] .vsbadge');
  if (scm) {
    const st = await getJSON('/forge/status');
    const changed = st.ok && Array.isArray(st.data?.changed) ? st.data.changed.length : null;
    const n = Number.isFinite(changed) ? changed : 0;
    scm.textContent = n > 0 ? String(n) : '';
    scm.hidden = n === 0;
  }
}

/**
 * Bridge the artifact's product state onto the attribute the original modules
 * read.
 *
 * The old shell published the active surface as `data-zeno-surface` on <html>,
 * and modules gate real behaviour on it — field.js refuses to size or draw the
 * Standing Field when it thinks the surface is hidden. The artifact UI has no
 * such attribute; it toggles `.product.on`. Without this bridge field.js mounts
 * its canvas and then leaves it at the browser default 300x150 — a blank orb.
 * Mirroring the state keeps every reused module working unchanged.
 */
function bridgeSurfaceAttr() {
  const root = document.documentElement;
  const sync = () => {
    const on = document.querySelector('.product.on[data-product]') || document.querySelector('.product[data-product]');
    const name = on && on.getAttribute('data-product');
    if (name && root.getAttribute('data-zeno-surface') !== name) {
      root.setAttribute('data-zeno-surface', name);
      // Modules that stopped their loops while "hidden" listen for this.
      window.dispatchEvent(new CustomEvent('zeno:surface', { detail: { surface: name } }));
      document.dispatchEvent(new CustomEvent('zeno:command-panel', { detail: { surface: name } }));
    }
  };
  sync();
  for (const p of document.querySelectorAll('.product[data-product]')) {
    new MutationObserver(sync).observe(p, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  // A resize can arrive while a canvas is still at its default size.
  addEventListener('resize', () => window.dispatchEvent(new CustomEvent('zeno:surface', { detail: { surface: root.getAttribute('data-zeno-surface') } })));
}

async function boot() {
  bridgeSurfaceAttr();
  await Promise.all(BINDERS.map(runBinder));
  try { await bindRailBadges(); } catch (err) { failed.push({ path: 'rail-badges', error: String(err && err.message) }); }

  /* Nudge the reused modules once their binders have mounted.
     bridgeSurfaceAttr() runs BEFORE the binders so they can read the surface,
     which means a module that installs its own observer inside a binder (field.js
     does) was not listening when the attribute was first written — and it only
     ever reacts to a CHANGE. Without this the Standing Field sits at the canvas
     default 300x150: mounted, but never sized, i.e. a blank orb. Re-assert the
     attribute and fire a resize so anything measuring a container measures it
     now that layout is settled. */
  const nudge = () => {
    const root = document.documentElement;
    const surface = root.getAttribute('data-zeno-surface');
    if (!surface) return;
    // Re-set the SAME value: setAttribute still delivers a mutation record, so
    // observers re-run. Never remove it first — requestAnimationFrame is paused
    // in a background tab, so a remove-then-restore can leave the surface unset
    // permanently and every module that gates on it silently stops.
    root.setAttribute('data-zeno-surface', surface);
    dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('zeno:state'));
    // A canvas that still has not measured itself gets a real box change.
    const m = document.querySelector('[data-mount="field"]');
    if (m) {
      const c = m.querySelector('canvas');
      if (c && c.width <= 300) {
        const prev = m.style.minHeight;
        m.style.minHeight = (Math.round(m.getBoundingClientRect().height) + 2) + 'px';
        setTimeout(() => { m.style.minHeight = prev; }, 60);
      }
    }
  };
  // A module that installs its observer inside its own binder is not listening
  // when the first nudge fires, and it only ever reacts to a CHANGE — so repeat
  // until layout and every binder have settled.
  requestAnimationFrame(nudge);
  setTimeout(nudge, 350);
  setTimeout(nudge, 1200);
  // Surfaced for the verification pass — which screens are real, which are not.
  window.__zenoBind = { loaded, failed };
  if (failed.length) console.warn('[zeno] binders not applied:', failed);
  document.dispatchEvent(new CustomEvent('zeno:bound', { detail: { loaded, failed } }));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else void boot();
