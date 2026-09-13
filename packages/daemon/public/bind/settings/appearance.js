/*
 * bind/settings/appearance.js — the Appearance pane: Theme (real), Density
 * (also real now — see the comment below).
 *
 * Real state this file is grounded in:
 *   - Theme: field.js's own device preference, key `zeno-th`, attribute
 *     `data-theme` on <html>.
 *   - Density: key `zeno-dn`, attribute `data-density`, resolved by
 *     theme-boot.js before CSS. It had no preference behind it and was
 *     disabled; rather than ship a switch that means nothing, it now means
 *     what its label says.
 */
import { $, $$ } from '../../bind.js';
import { root, zget, zset, rowByLabel } from './shared.js';

export function bindAppearance(modal) {
  const pane = $('.set-pane[data-setpane="appearance"]', modal);
  if (!pane) return;

  try {
    const row = rowByLabel(pane, 'Theme');
    const seg = row && $('.segsm', row);
    if (seg) {
      // Reconcile ONLY against a real saved choice. The bare `else` here used to
      // strip data-theme whenever nothing was stored, which silently turned every
      // first run into "follow the OS" — on a light desktop the documented
      // Graphite default never appeared, and it contradicted theme-boot.js, which
      // correctly leaves the default alone when there is nothing saved.
      const stored = zget('th');
      if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
      else if (stored === 'system') root.removeAttribute('data-theme');

      const buttons = $$('button', seg);
      const wanted = (label) => (label === 'Light' ? 'light' : label === 'Dark' ? 'dark' : null);
      const markCurrent = () => {
        const current = root.getAttribute('data-theme'); // 'dark' | 'light' | null
        buttons.forEach((b) => {
          const w = wanted(b.textContent.trim());
          if (w === current) b.setAttribute('aria-current', 'page');
          else b.removeAttribute('aria-current');
        });
      };
      markCurrent();
      buttons.forEach((b) => b.addEventListener('click', () => {
        const w = wanted(b.textContent.trim());
        if (w) { root.setAttribute('data-theme', w); zset('th', w); }
        else { root.removeAttribute('data-theme'); zset('th', 'system'); }
        markCurrent(); // ui.js's own click handler already moves aria-current
      })); // to whichever button was clicked; this just keeps it honest
    } // if that ever disagrees with what we just applied.
  } catch { /* skip quietly */ }

  /* Density is REAL now. It was disabled because no preference existed; a
     switch that looks live and is not is the thing this surface refuses to
     ship, and the honest options were to remove the row or to mean it. It
     stores `zeno-dn` and sets data-density on <html>, the same scheme as the
     theme — and theme-boot.js resolves it before CSS so it never arrives as a
     visible reflow. */
  try {
    const row = rowByLabel(pane, 'Density');
    const seg = row && $('.segsm', row);
    if (seg) {
      const compact = () => root.getAttribute('data-density') === 'compact';
      const buttons = $$('button', seg);
      const wanted = (label) => (label === 'Compact' ? 'compact' : 'comfortable');
      const markCurrent = () => buttons.forEach((b) => {
        const is = wanted(b.textContent.trim()) === (compact() ? 'compact' : 'comfortable');
        if (is) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      markCurrent();
      buttons.forEach((b) => b.addEventListener('click', () => {
        if (wanted(b.textContent.trim()) === 'compact') { root.setAttribute('data-density', 'compact'); zset('dn', 'compact'); }
        else { root.removeAttribute('data-density'); zset('dn', 'comfortable'); }
        markCurrent();
      }));
    }
  } catch { /* skip quietly */ }
}
