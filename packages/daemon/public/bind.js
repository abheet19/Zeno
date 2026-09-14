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
  // voice BEFORE controls: controls.js retires or redirects any mic it finds,
  // and a retired node is gone for good. Ordering is not enough on its own
  // (these are dynamic imports resolved in parallel), so controls.js also skips
  // every control voice.js has claimed — see the data-voice-wired check there.
  './bind/voice.js',
  './bind/controls.js',
  './bind/ask.js',
  './bind/compare.js',
  './bind/forge-progress.js',
  './bind/resize.js',
  './bind/orchestrator.js',
  './bind/call-banner.js',
  // Last: it re-runs the others, so it must not run before they have run once.
  './bind/live.js',
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
/**
 * Re-read the chrome every surface shares: the rail counts, the Forge badges,
 * the model chip, the kernel line.
 *
 * Exported because bind/live.js has to be able to call it. These counts are not
 * owned by any one screen binder, so re-running the screens after a stream
 * event left the rail showing whatever it read at boot — a queue that had grown
 * still displayed nothing, which is the exact number the owner acts on.
 */
export async function refreshChrome() {
  await bindRailBadges();
}

async function bindRailBadges() {
  const badge = (screen, value) => {
    /* Three places, because the artifact hardcodes the same invented number in
       three: the rail, the mobile tab bar, and the mobile "More" sheet. The
       sheet was missed, so on a narrow window Vault still read 12 and Work 5 —
       fixtures presented as the owner's own state, in the one surface whose
       entire value is being true. It is written from the same read as the rail. */
    for (const sel of [
      `.rail .nav-i[data-screen="${screen}"] .ct`,
      `.mtabs [data-screen="${screen}"] .mbadge`,
      `#msheet .nav-i[data-mscreen="${screen}"] .ct`,
    ]) {
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
  /* Integrations carries NO badge, deliberately.
     The artifact hardcoded "4" for visual balance, and reading it from the
     agent list only moved the problem: the rail then said 3 while the screen
     listed work sources, the local runtime, three agents and the skills
     section — a number the owner acts on that agrees with nothing they can
     open. Every other badge here answers a real question ("how many are waiting
     on me", "how many do I have"), and both are meaningless for a catalogue
     whose size is fixed by what is installed and never needs attention. A
     number that needs a paragraph to explain is decoration, and this rail does
     not decorate. */
  badge('integrations', null);
  // Chats live in this browser, not the daemon — count what is actually stored.
  try {
    const raw = localStorage.getItem('zeno-chats');
    const arr = raw ? JSON.parse(raw) : [];
    badge('chats', Array.isArray(arr) ? arr.length : null);
  } catch { /* storage blocked: the badge simply stays blank */ }

  /* Forge chrome carries the same claim in two more places, both hardcoded by
     the artifact: the cyan "1 approval waiting" call-to-action and the
     activity bar's Zeno badge. Telling the owner something is held when
     nothing is held is the exact lie this kernel exists to prevent, so each
     is written from the real count or hidden outright.

     The session panel's Actions tab badge is NOT one of these — it names one
     session's own proposed changes, not the global held queue (a session with
     zero proposals must show no badge even while other sessions, or older
     runs, have things held), so bind/forge/session-views.js's renderActions
     paints it from that session's own state instead. */
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
/** The three surfaces, named the way the owner refers to them. */
const SURFACE_TITLE = { command: 'Command', forge: 'Forge', counsel: 'Counsel' };

/**
 * The wordmark and the window title name the surface you are actually on.
 *
 * The artifact ships a single static "Zeno" wordmark, so every surface looked
 * identical in the title bar and in the taskbar — with three products in one
 * window that is a real navigation cost, not a cosmetic one. Both are written
 * from the same source as `data-zeno-surface`, so they cannot disagree.
 */
function nameSurface(name) {
  const word = SURFACE_TITLE[name];
  if (!word) return;
  const wm = document.querySelector('.brand .brand-word');
  if (wm) wm.textContent = `Zeno ${word}`;
  document.title = `Zeno ${word}`;
}

function bridgeSurfaceAttr() {
  const root = document.documentElement;
  const sync = () => {
    const on = document.querySelector('.product.on[data-product]') || document.querySelector('.product[data-product]');
    const name = on && on.getAttribute('data-product');
    if (name && root.getAttribute('data-zeno-surface') !== name) {
      root.setAttribute('data-zeno-surface', name);
      nameSurface(name);
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

/**
 * Last line of defence: no invented content may survive to the screen.
 *
 * Every binder is supposed to replace the artifact's placeholders, but a binder
 * that is missing, throws, or simply does not reach one corner leaves fabricated
 * rows sitting there looking exactly like real state — the worst thing this
 * product can do. So after binding, anything still carrying a known mock string
 * is removed and replaced with an honest empty state. This only ever DELETES
 * invented content; it never writes a number of its own.
 */
const MOCK_MARKERS = [
  'INGEST-12', 'Rotate the ingest token', 'patch.task', 'forge.run — codex',
  'vault.remember', 'Design review — Command home', 'createIngestClient',
  'Scaffold the App shell', 'Add ingest tests', 'Bump vitest',
];
const looksMock = (node) => !!node && MOCK_MARKERS.some((m) => node.textContent.includes(m));

function sweepMockRemnants() {
  const replace = (node, message) => {
    if (!looksMock(node)) return false;
    const n = el('div', 'fnote', message);
    node.replaceChildren(n);
    return true;
  };

  // Forge session history + the open conversation.
  replace(document.querySelector('#s-history'), 'No past sessions on this machine yet.');
  replace(document.querySelector('#s-turns'), 'No run yet. Describe a task below and Zeno will plan it in an isolated worktree.');
  const title = document.querySelector('#s-title');
  if (looksMock(title)) title.textContent = 'New session';
  const status = document.querySelector('#s-status');
  if (status && looksMock(document.querySelector('#s-turns'))) status.textContent = '';

  // Forge's Runs and Lens tabs ship fabricated run history and a fabricated
  // prompt hash — both read as evidence, which is worse than being empty.
  replace(document.querySelector('.sessview[data-stab="runs"]'), 'No runs yet on this machine.');
  replace(document.querySelector('.sessview[data-stab="lens"]'), 'No run context yet. Lens shows the exact bounded prompt once a run starts.');
  replace(document.querySelector('.sessview[data-stab="plan"]'), 'No plan yet. Describe a task and Zeno will propose one.');
  replace(document.querySelector('.sessview[data-stab="actions"]'), 'No held actions for this session.');

  // The split editor pane and terminal buffer carry sample source/output.
  const pane2 = document.querySelector('#vs-pane2');
  if (looksMock(pane2)) pane2.hidden = true;
  for (const term of document.querySelectorAll('.vsp .fterm')) {
    if (looksMock(term)) term.replaceChildren(el('span', null, 'No commands run in this session yet.'));
  }

  // Counsel's meeting list and its post-meeting view.
  replace(document.querySelector('.cnlist'), 'No meetings recorded yet.');
  const post = document.querySelector('.cnview[data-cnview="post"]');
  if (looksMock(post)) {
    const t = post.querySelector('#cn-post-title');
    if (t) t.textContent = 'No meeting selected';
    const meta = post.querySelector('#cn-post-meta');
    if (meta) meta.textContent = 'Record or open a meeting to see its cited summary.';
    for (const pane of post.querySelectorAll('.cnp')) {
      if (looksMock(pane)) pane.replaceChildren(el('div', 'fnote', 'Nothing to show until a meeting has been recorded.'));
    }
  }

  // Any remaining row that is purely an artifact fixture.
  for (const row of document.querySelectorAll('.dvsess, .cnrow')) {
    if (looksMock(row)) row.remove();
  }
}

async function boot() {
  bridgeSurfaceAttr();
  // The live binder re-runs other binders as stream events arrive. Starting it
  // in the same Promise.all as their first read allowed that refresh to overlap
  // the initial render; under load an older /skills or MCP response could then
  // paint over newer state. Mount the snapshot binders first, then subscribe.
  const live = './bind/live.js';
  await Promise.all(BINDERS.filter((path) => path !== live).map(runBinder));
  await runBinder(live);
  try { await bindRailBadges(); } catch (err) { failed.push({ path: 'rail-badges', error: String(err && err.message) }); }

  /* Nudge the reused modules once their binders have mounted.
     bridgeSurfaceAttr() runs BEFORE the binders so they can read the surface,
     which means a module that installs its own observer inside a binder (field.js
     does) was not listening when the attribute was first written — and it only
     ever reacts to a CHANGE. Without this the Standing Field sits at the canvas
     default 300x150: mounted, but never sized, i.e. a blank orb. Re-assert the
     attribute and fire a resize so anything measuring a container measures it
     now that layout is settled. */
  try { sweepMockRemnants(); } catch (err) { failed.push({ path: 'mock-sweep', error: String(err && err.message) }); }

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
