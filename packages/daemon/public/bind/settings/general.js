/*
 * bind/settings/general.js — the General pane: Reduce motion, Reduce
 * transparency, Launch to.
 *
 * Real state this file is grounded in, confirmed against
 * packages/daemon/src/server.ts and the app's original modules:
 *   - Reduce motion / Reduce transparency: field.js's own device preferences
 *     (localStorage `zeno-mo` / `zeno-fl`, `data-reduce` / `data-flat` on
 *     <html>, which glass/tokens.css and glass/vendor/glass-base.css already
 *     style for). field.js observes the same root attributes, so changing this
 *     switch updates the visible Standing Field immediately as well as storing
 *     the choice for the next launch.
 *   - Launch-to-surface: no persisted preference exists ANYWHERE in this
 *     codebase (field.js's boot() comment: "Command is the always-present
 *     surface"). Disabled, not wired.
 */
import { $, setText } from '../../bind.js';
import {
  root, zget, zset, rowByLabel, disableButtons,
} from './shared.js';

function readReduceMotionPref() {
  const v = zget('mo');
  if (v === '0') return true; // stored: motion OFF -> reduced
  if (v === '1') return false; // stored: motion ON -> not reduced
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function bindGeneral(modal) {
  const pane = $('.set-pane[data-setpane="general"]', modal);
  if (!pane) return;

  try {
    const row = rowByLabel(pane, 'Reduce motion');
    const rm = row && $('.toggle', row);
    if (rm) {
      // Persist every future change under field.js's own key, and apply the
      // real, sitewide CSS effect tokens.css already defines for
      // :root[data-reduce="1"] — independent of whether field.js is mounted.
      const observer = new MutationObserver(() => {
        const on = rm.getAttribute('aria-checked') === 'true';
        zset('mo', on ? '0' : '1');
        root.setAttribute('data-reduce', on ? '1' : '0');
      });
      observer.observe(rm, { attributes: true, attributeFilter: ['aria-checked'] });

      const wantReduced = readReduceMotionPref();
      const isChecked = rm.getAttribute('aria-checked') === 'true';
      if (wantReduced !== isChecked) {
        // A real click keeps the switch's own event and keyboard semantics;
        // our observer above persists the result, and field.js observes the
        // corresponding root attribute to update the visible canvas.
        rm.click();
      } else {
        root.setAttribute('data-reduce', wantReduced ? '1' : '0');
      }
    }
  } catch { /* one row's failure should not blank the pane */ }

  try {
    const row = rowByLabel(pane, 'Reduce transparency');
    const flat = row && $('.toggle', row);
    if (flat) {
      const on = zget('fl') === '1';
      flat.setAttribute('aria-checked', on ? 'true' : 'false');
      root.setAttribute('data-flat', on ? '1' : '0');
      const observer = new MutationObserver(() => {
        const checked = flat.getAttribute('aria-checked') === 'true';
        zset('fl', checked ? '1' : '0');
        root.setAttribute('data-flat', checked ? '1' : '0');
      });
      observer.observe(flat, { attributes: true, attributeFilter: ['aria-checked'] });
    }
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Launch to');
    if (row) {
      disableButtons(row, 'Zeno always opens to Command — there is no stored launch preference in this build.');
      setText($('.sub', row), 'Zeno always opens to Command. Nothing in this app remembers a different launch surface yet.');
    }
  } catch { /* skip quietly */ }
}
