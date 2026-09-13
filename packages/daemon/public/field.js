/*
 * field.js — the Standing Field's entry point.
 *
 * The engine itself now lives under field/ in cohesive modules, each holding
 * the shared state (`F`, `S`, the node/edge arrays) it needs by importing the
 * same references rather than a private copy:
 *
 *   field/state.js      — shared mutable state, tiny storage/auth/string utils
 *   field/attention.js   — colour resolution + the attention/urgency helpers
 *   field/topology.js    — daemon state -> nodes + edges (ported prototype rules)
 *   field/engine.js      — canvas sizing, draw(), the rAF loop, pick()
 *   field/interaction.js — pointer drag/hover/click wiring for the canvas
 *   field/card.js        — the node card and its click navigation
 *   field/list.js        — the field's text-equivalent list view
 *   field/data.js        — the /state·/work·/forge·/memory reads + refresh()
 *   field/readouts.js    — the masthead, chips, tally, rail counts, breadcrumb
 *
 * This file just wires them together and stays the one thing bind/home.js
 * imports: `import('../field.js')`, then `mod.init()`.
 *
 * Exports init(section): mounts the canvas into [data-mount="field"], fetches
 * state, renders, and refreshes on the daemon's stream signal (with a slow poll
 * as a floor). It also writes the masthead, the hero chips, the tally, the rail
 * counts and the journey breadcrumb — every one of them from the same fetch, so
 * the whole surface can never disagree with itself.
 */

import { R, S, F, st, ld, bootMotion } from './field/state.js';
import { wire } from './field/interaction.js';
import { fieldOn, fieldSurfaceVisible, fieldShouldAnimate, startF, stopF, size, draw } from './field/engine.js';
import { refresh, invalidateAgents } from './field/data.js';
import { renderNodeCard } from './field/card.js';
import { syncList } from './field/list.js';

/* ---- public entry ---------------------------------------------------------- */
let started = false;
export function init(section) {
  if (started) return; started = true;
  const root = section || document.querySelector('[data-surface="command"]') || document;
  const mount = root.querySelector('[data-mount="field"]');
  if (!mount) return;
  mount.innerHTML =
    '<canvas id="field" role="img" aria-label="The Standing Field: an interactive map of Zeno\'s core, its three surfaces, this machine, the workspace repository, work sources, pending approvals, recent receipts, the notes in your Vault, your recorded meetings, and the models installed on this machine\'s local runtime. Drag to rotate, click a node to inspect. A full list equivalent is behind the List button."></canvas>';
  F.c = mount.querySelector('#field');
  const listEl = root.querySelector('[data-mount="field-list"]');
  wire(F.c);
  fieldOn();
  refresh(listEl).catch(() => { /* the honest empty state stands if the fetch fails */ });

  /* the list toggle: the same nodes, read rather than rotated */
  const tog = document.getElementById('fl-t');
  if (tog && listEl) {
    tog.addEventListener('click', () => {
      S.fieldList = !S.fieldList;
      tog.setAttribute('aria-pressed', S.fieldList ? 'true' : 'false');
      tog.textContent = S.fieldList ? '▣ field' : '☰ list';
      listEl.hidden = !S.fieldList;
      listEl.classList.toggle('on', S.fieldList);
      renderNodeCard();
      // Stop burning frames on a canvas nobody can see; resume when it returns.
      if (S.fieldList) stopF(); else { size(); startF(); if (!F.raf) draw(); }
    });
  }

  /* node-card actions */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-clr]')) { S.sel = null; renderNodeCard(); syncList(); if (!F.raf) draw(); return; }

    /* The node card's own controls. These looked up `[data-nav]` and
       `sec-*` ids, which is the PREVIOUS renderer's vocabulary — the shipped
       markup uses `[data-product]` for a surface and `.nav-i[data-screen]` for
       a screen. So every button on the card pointed at nothing: clicking a node
       in the Standing Field appeared to do nothing at all, which is exactly how
       it was reported. Both vocabularies are accepted so this keeps working if
       either markup is the one on screen. */
    const go = t.closest('[data-go]');
    if (go) {
      const name = go.getAttribute('data-go');
      // Switch to the product via its nav button (data-product also matches the
      // product CONTAINER, which comes first in the DOM — click only a button).
      const nb = document.querySelector(`.seg [data-product="${name}"]`)
        || [...document.querySelectorAll(`[data-product="${name}"]`)].find((e2) => e2.tagName === 'BUTTON')
        || document.querySelector(`[data-nav="${name}"]`);
      if (nb) nb.click();
      // A model node also picks that model in Forge — call the picker's own
      // apply directly (robust to load order), with the event as a fallback for
      // a build where the direct hook is not present.
      const model = go.getAttribute('data-model');
      if (model) {
        const detail = { agentId: 'local', model };
        window.__zenoPendingForgeModel = detail;
        if (typeof window.zenoApplyForgeModel === 'function') window.zenoApplyForgeModel('local', model);
        else window.dispatchEvent(new CustomEvent('zeno:forge-select-model', { detail }));
      }
      return;
    }
    const jump = t.closest('[data-jump]');
    if (jump) {
      const raw = jump.getAttribute('data-jump');
      // The card speaks the PREVIOUS renderer's section names — field-model.js's
      // ticketAction still says `timeline` / `desk` / `pending`, and older cards
      // say `sec-vault` / `cmd-hero` — while the rail speaks screens. Without
      // this translation "Find it in the receipts" and "Go to approvals" looked
      // for screens that do not exist and did nothing, which is exactly how the
      // owner reported them.
      const OLD_TO_SCREEN = { timeline: 'receipts', desk: 'work', pending: 'approvals', 'cmd-hero': 'home' };
      const screen = OLD_TO_SCREEN[raw] || raw.replace(/^sec-/, '');
      const rail = document.querySelector(`.nav-i[data-screen="${screen}"]`) || document.getElementById(raw);
      if (rail) rail.click();
    }
  });

  /* refresh on the daemon's own stream signal, with a slow poll as a floor */
  window.addEventListener('zeno:state', () => {
    if (fieldSurfaceVisible()) refresh(listEl).catch(() => {});
  });
  window.addEventListener('zeno:runtime-refresh', () => {
    invalidateAgents();
    if (fieldSurfaceVisible()) refresh(listEl).catch(() => {});
  });
  /* Command panel switches (Home ⇄ Approvals ⇄ …) no longer toggle #cmd-hero's
     own hidden attribute — command-panels toggles the .home wrapper — so the
     MutationObserver on #cmd-hero.hidden below never fires for them. Re-check
     size + animation on the panel event so the orb stops when Home is left and
     resumes (correctly sized to the left column) when it returns. */
  window.addEventListener('zeno:command-panel', () => {
    if (fieldSurfaceVisible()) { size(); if (fieldShouldAnimate()) startF(); else { stopF(); draw(); } }
    else stopF();
  });
  setInterval(() => { if (fieldSurfaceVisible()) refresh(listEl).catch(() => {}); }, 15000);

  /* A tab that comes back from the background has a cancelled rAF chain and a
     canvas painted from old state. Restart it rather than leaving a frozen picture. */
  document.addEventListener('visibilitychange', () => {
    if (fieldSurfaceVisible()) { size(); if (fieldShouldAnimate()) startF(); else { stopF(); draw(); } }
    else stopF();
  });

  /* The shell and Command panels can both hide the field. Stop its canvas in
     either case and resume only when the field is actually visible again. A
     return from Forge also re-checks the running local runtime passively. */
  let lastSurface = R.getAttribute('data-zeno-surface');
  const visibilityObserver = new MutationObserver(() => {
    const surface = R.getAttribute('data-zeno-surface');
    if (surface === 'command' && lastSurface !== 'command') {
      invalidateAgents();
      if (fieldSurfaceVisible()) refresh(listEl).catch(() => {});
    }
    lastSurface = surface;
    if (fieldSurfaceVisible()) { size(); if (fieldShouldAnimate()) startF(); else { stopF(); draw(); } }
    else stopF();
  });
  visibilityObserver.observe(R, { attributes: true, attributeFilter: ['data-zeno-surface'] });
  const hero = document.getElementById('cmd-hero');
  if (hero) visibilityObserver.observe(hero, { attributes: true, attributeFilter: ['hidden'] });

  /* keep motion honest if the OS setting changes mid-session — but only while
     the owner has made no explicit choice of their own. */
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      if (ld('mo') === '0' || ld('mo') === '1') return; // the owner has spoken
      R.removeAttribute('data-reduce');
      bootMotion();
      if (!S.motion) { stopF(); draw(); } else startF();
      syncControls();
    });
  } catch { /* no matchMedia */ }
}

export default { init };

/* ---- self-bootstrap: Command is the always-present surface ----------------- */
function boot() {
  const th = ld('th');
  if (th === 'dark' || th === 'light') R.setAttribute('data-theme', th);
  if (ld('fl') === '1') R.setAttribute('data-flat', '1'); // reduce-transparency preference; the orb is unaffected
  bootMotion();
  const cmd = document.querySelector('[data-surface="command"]');
  if (cmd) init(cmd);
  wireControls();
  syncControls();
}

/* Every top-bar control reports its real state at boot, not a hopeful default. */
function syncControls() {
  const m = document.getElementById('ctl-motion');
  if (m) m.setAttribute('aria-pressed', S.motion ? 'false' : 'true'); // pressed = "reduce motion" is ON
  const f = document.getElementById('ctl-flat');
  if (f) f.setAttribute('aria-pressed', R.getAttribute('data-flat') === '1' ? 'true' : 'false');
}

function wireControls() {
  const theme = document.getElementById('ctl-theme');
  if (theme) theme.addEventListener('click', () => {
    const cur = R.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
    if (next) { R.setAttribute('data-theme', next); st('th', next); }
    else { R.removeAttribute('data-theme'); st('th', 'system'); }
    if (F.c) draw();
  });

  const motion = document.getElementById('ctl-motion');
  if (motion) motion.addEventListener('click', () => {
    // Three states, and the explicit choice persists so it survives a reload and
    // keeps beating the OS. "0" means motion ON even under system reduce-motion.
    S.motion = !S.motion;
    R.setAttribute('data-reduce', S.motion ? '0' : '1');
    st('mo', S.motion ? '1' : '0');
    syncControls();
    if (!S.motion) { stopF(); draw(); } else { startF(); }
  });

  // Reduce transparency: toggles data-flat, which glass/tokens.css consumes to
  // drop backdrop-filter blur across the UI. It no longer touches the orb — the
  // 2D orb view is retired; this is purely the glass accessibility escape hatch.
  const flat = document.getElementById('ctl-flat');
  if (flat) flat.addEventListener('click', () => {
    const on = R.getAttribute('data-flat') === '1';
    R.setAttribute('data-flat', on ? '0' : '1'); st('fl', on ? '0' : '1');
    syncControls();
  });

  const home = document.getElementById('home');
  if (home) home.addEventListener('click', () => {
    const nb = document.querySelector('[data-nav="command"]');
    if (nb) nb.click();
    // Go through the rail's own Today button rather than scrolling past it:
    // that way the selected pill follows the window home instead of still
    // pointing at whatever section you were reading when you left.
    const today = document.querySelector('.rail-n[data-jump="cmd-hero"]');
    if (today) { today.click(); return; }
    const hero = document.querySelector('.hero');
    if (hero && hero.scrollIntoView) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}


if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
