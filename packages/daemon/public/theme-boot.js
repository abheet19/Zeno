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
  } catch {
    // Storage can be disabled. The safe visual fallback is the HTML default.
  }
})();
