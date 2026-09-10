/**
 * Zeno nav — the shell that turns one window into three products.
 * ================================================================
 *
 * The window has exactly one job change from before: it now holds three
 * surfaces — Command, Forge, Counsel — and shows one at a time. This module is
 * the whole of that switch, and nothing else. It does NOT touch the Command
 * surface's own wiring (app.js owns that), it does NOT approve, propose, read
 * the daemon or animate. It reads the DOM it was handed, toggles which
 * <section data-surface> is visible, and remembers the last one.
 *
 * THE MARKUP CONTRACT (index.html supplies both halves):
 *
 *   Destinations — one button per surface, each glyph + label, keyboard-reachable:
 *     <button class="nav-item" data-nav="command"> … </button>
 *
 *   Surfaces — one section per destination, addressed by name:
 *     <section class="surface" data-surface="command"> … </section>
 *
 *   `command` is the default and is the only one built at rest; the other two
 *   are shells for other agents to fill.
 *
 * HOW A SURFACE IS SHOWN. Visibility is the [hidden] attribute and only that —
 * no class toggles a display, no inline style is written, so a surface is either
 * in the accessibility tree or removed from it, with nothing in between. The CSS
 * rule `[data-surface][hidden]{display:none}` is what makes `.hidden = true`
 * win over the surface's own `display:flex`.
 *
 * SELECTED IS NEVER COLOUR ALONE. The active item carries `aria-current="page"`,
 * a bold weight, a filled pill and a filled glyph — four redundant signals, so
 * the choice survives greyscale and a screen reader. This file only sets the
 * class and the attribute; the four channels are painted in index.html's CSS.
 *
 * LAZY INIT. Command is alive from the first paint (app.js). Forge and Counsel
 * are initialised the FIRST time each is shown and never again:
 *   1. the section is sent a `zeno:surface-shown` event (bubbles), once; and
 *   2. if the section declares `data-init="/forge.js"`, that module is imported
 *      once and its `init(section)` (or default export) is called with it.
 * A surface with no module and no listener simply shows its resting shell. This
 * is the seam the Forge and Counsel authors plug into; neither exists yet, and
 * the absence is silent by design.
 *
 * No framework, no bundler, no CDN, no build step. Plain DOM APIs.
 */

const STORAGE_KEY = 'zeno.surface';
const DEFAULT_SURFACE = 'command';
const PRODUCT_NAMES = Object.freeze({
  command: 'Zeno Command',
  forge: 'Zeno Forge',
  counsel: 'Zeno Counsel',
});

const items = Array.from(document.querySelectorAll('[data-nav]'));
const surfaces = new Map();
for (const section of document.querySelectorAll('[data-surface]')) {
  surfaces.set(section.dataset.surface, section);
}

/** Names that have BOTH a button and a section — the only switchable ones. */
const names = items.map((i) => i.dataset.nav).filter((n) => surfaces.has(n));

let current = null;
const inited = new Set();

/** Keep the native window title and the visible compound mark in sync. */
function showProductName(name) {
  const productName = PRODUCT_NAMES[name] || PRODUCT_NAMES[DEFAULT_SURFACE];
  document.title = productName;
  const wordmark = document.querySelector('.brand-word');
  if (wordmark) wordmark.textContent = productName;
}

/* ---- localStorage, every call wrapped: a private window, a browser with site
   data blocked, or storage that throws on access must not take the nav down. -- */
function remember(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* storage unavailable — the nav still works, it just forgets. */
  }
}
function recall() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/* ---- run a surface's one-time setup the first time it becomes visible ------ */
function firstShow(name) {
  if (inited.has(name)) return;
  inited.add(name);
  const section = surfaces.get(name);
  if (!section) return;

  // A hook that needs no module: an author can listen for this on the section.
  section.dispatchEvent(new CustomEvent('zeno:surface-shown', { bubbles: true, detail: { name } }));

  // The module seam. Absent until an author opts in with data-init, so the
  // empty Forge/Counsel shells import nothing and log nothing.
  const src = section.dataset.init;
  if (!src) return;
  import(src)
    .then((mod) => {
      const init = mod && (mod.init || mod.default);
      if (typeof init === 'function') init(section);
    })
    .catch((err) => {
      // Honest, not fatal: the surface still shows its shell.
      console.warn(`[zeno-nav] could not initialise "${name}" from ${src}:`, err);
    });
}

/**
 * Show one surface and hide the rest.
 * @param {string} name
 * @param {{persist?:boolean}} [opts]
 */
function show(name, opts) {
  if (!surfaces.has(name)) name = DEFAULT_SURFACE;
  if (!surfaces.has(name)) return; // nothing to show — leave the DOM untouched
  const persist = !opts || opts.persist !== false;

  for (const [key, section] of surfaces) section.hidden = key !== name;
  for (const item of items) {
    const on = item.dataset.nav === name;
    item.classList.toggle('is-current', on);
    if (on) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }

  // Expose the active product to the shell so Forge can use a compact IDE
  // frame while Command and Counsel retain their editorial layout.
  document.documentElement.setAttribute('data-zeno-surface', name);
  showProductName(name);

  current = name;
  if (persist) remember(name);
  firstShow(name);
}

/* ---- activation: a real click, and Enter/Space (native to <button>) -------- */
for (const item of items) {
  item.addEventListener('click', () => show(item.dataset.nav));
}

/* ---- keyboard: arrows move focus along the nav; activation stays on
   Enter/Space/click, so moving through the row never switches surface by
   accident. Every item is also an ordinary Tab stop. ------------------------- */
const navRoot = items.length ? items[0].closest('[data-nav-root]') || items[0].parentElement : null;
if (navRoot) {
  navRoot.addEventListener('keydown', (ev) => {
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    let next = -1;
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = items.length - 1;
    if (next >= 0) {
      ev.preventDefault();
      items[next].focus();
    }
  });
}

/* ---- a cross-surface link any surface can use: <button data-go="forge"> ---- */
document.addEventListener('click', (ev) => {
  const t = ev.target instanceof Element ? ev.target.closest('[data-go]') : null;
  if (!t) return;
  const dest = t.getAttribute('data-go');
  if (surfaces.has(dest)) {
    ev.preventDefault();
    show(dest);
  }
});

/* ---- a small, deliberate public surface for other modules ------------------ */
window.ZenoNav = {
  show,
  get current() {
    return current;
  },
};

/* ---- boot: restore the last surface, or fall back to Command --------------- */
const saved = recall();
show(names.includes(saved) ? saved : DEFAULT_SURFACE, { persist: false });
