/*
 * bind/settings/shared.js — small helpers every Settings section binder
 * reuses. Pulled out of bind/settings.js verbatim; nothing here is new
 * behavior, just the plumbing each section (general/appearance/models/
 * voice/connectors/security/account) would otherwise duplicate.
 */
import {
  $, $$, el, fill, setText,
} from '../../bind.js';

export const root = document.documentElement;

export function txt(s) { return document.createTextNode(s); }
export function dot() { return el('span', 'd'); }

/** Same tiny toast ui.js defines, kept local so this file never reaches into
 *  ui.js's closure — it only reuses the `#toast` element/CSS ui.js already
 *  ships (screens/artifact.css `#toast` / `#toast.on`). */
export function toast(msg) {
  try {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._zenoTimer);
    t._zenoTimer = setTimeout(() => t.classList.remove('on'), 2400);
  } catch { /* a toast is a nicety, never worth failing over */ }
}

/** field.js's own localStorage scheme (`zeno-<key>`), reused verbatim so a
 *  preference set from here is exactly what field.js would read if it were
 *  mounted again. */
export function zget(key) { try { return localStorage.getItem('zeno-' + key); } catch { return null; } }
export function zset(key, value) { try { localStorage.setItem('zeno-' + key, value); } catch { /* storage off */ } }

export function mono(hex, head = 4, tail = 4) {
  const s = String(hex || '');
  return s.length > head + tail + 1 ? s.slice(0, head) + '…' + s.slice(-tail) : s;
}

/** Find the `.setrow` in `pane` whose visible `.lab` text matches exactly. */
export function rowByLabel(pane, label) {
  if (!pane) return null;
  return $$('.setrow', pane).find((r) => {
    const lab = $('.lab', r);
    return lab && lab.textContent.trim() === label;
  }) || null;
}

/** Drop ui.js's directly-attached listeners on a `.toggle`/button without
 *  touching ui.js's file — the same clone+replaceWith trick bind/counsel.js
 *  and bind/devices.js already use. Returns the fresh, listener-free node. */
export function detach(elm) {
  if (!elm) return null;
  const clone = elm.cloneNode(true);
  elm.replaceWith(clone);
  return clone;
}

export function markDisabled(node, note) {
  if (!node) return;
  node.setAttribute('aria-disabled', 'true');
  node.style.opacity = '.5';
  node.style.pointerEvents = 'none';
  node.style.cursor = 'not-allowed';
  if (note) node.title = note;
}

export function disableButtons(row, note) {
  if (!row) return;
  $$('button', row).forEach((b) => {
    b.disabled = true;
    b.style.opacity = '.5';
    b.style.cursor = 'not-allowed';
    if (note) b.title = note;
  });
}

export const TONE = {
  good: 'gr', bad: 'rd', warn: 'am', cyan: 'cy', flat: 'wt',
};
export function setPill(pillEl, tone, text, withDot) {
  if (!pillEl) return;
  pillEl.className = 'pill ' + (TONE[tone] || tone);
  if (withDot) fill(pillEl, dot(), txt(text));
  else setText(pillEl, text);
}
