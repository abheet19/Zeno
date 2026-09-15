'use strict';

/*
 * Resolve the per-device theme before CSS is parsed. The HTML root already
 * carries the first-run Graphite default; this script only changes it when the
 * owner has saved an explicit choice. Keeping this tiny and synchronous avoids
 * a light frame before the rest of the application boots.
 */
(() => {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('zeno-th');
    if (saved === 'system') {
      root.removeAttribute('data-theme');
    } else if (saved === 'dark' || saved === 'light') {
      root.setAttribute('data-theme', saved);
    }
    // Density resolves here too, for the same reason: applied later it would
    // arrive as a visible reflow of every list and card on screen.
    if (localStorage.getItem('zeno-dn') === 'compact') {
      root.setAttribute('data-density', 'compact');
    }
    /* Reduce motion and reduce transparency belong here for a stronger reason
       than the theme does. They were applied only by bind/settings.js, which
       runs after the module graph has loaded — so an owner who had asked for
       reduced motion watched the field rotate and the cards animate for the
       whole of boot before the preference took hold, and got nothing at all if
       that binder failed. An accessibility preference that arrives late has
       already done the thing it was set to prevent. Same keys and same
       attributes bind/settings.js uses (field.js's `zeno-mo` / `zeno-fl`,
       :root[data-reduce] / [data-flat]); this only resolves them earlier. */
    var mo = localStorage.getItem('zeno-mo');
    // The field is an interactive primary control, so it moves on first run.
    // The explicit setting still stops field and interface motion immediately.
    var reduce = mo === '0';
    root.setAttribute('data-reduce', reduce ? '1' : '0');
    root.setAttribute('data-flat', localStorage.getItem('zeno-fl') === '1' ? '1' : '0');
  } catch {
    // Storage can be disabled. The safe visual fallback is the HTML default.
  }
})();
