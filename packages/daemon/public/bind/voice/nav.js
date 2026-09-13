/*
 * bind/voice/nav.js — the artifact's real controls, not an invented one.
 * Used by bind/voice.js's runOutcome (case 'navigate' / 'read') and by
 * bind/voice/wake.js's applyWakeEvent (a wake word always switches to
 * Command first, whichever path woke it).
 */
import { $ } from '../../bind.js';

export function clickProduct(name) {
  const btn = $(`.seg[aria-label="Product"] [data-product="${name}"]`);
  if (btn && typeof btn.click === 'function') { btn.click(); return true; }
  return false;
}
export function gotoCommandScreen(screenName) {
  clickProduct('command');
  const btn = $(`.rail .nav-i[data-screen="${screenName}"]`);
  if (btn && typeof btn.click === 'function') btn.click();
}
export function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
