/*
 * capsule/widgets.js — small reusable pieces shared across the capsule's
 * field builders, the footer and the refused-state renderer: id generation,
 * the clipboard copy button, the chip/badge, the field wrapper, and the two
 * §4.5 completeness primitives (`na`, `unresolved`).
 */

import { el, add } from './dom.js';

let uid = 0;
export const nextId = () => `zn-${Date.now().toString(36)}-${++uid}`;

async function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A copy control. The confirmation is a LABEL swap, never colour alone. */
export function copyBtn(label, getText, aria) {
  const b = el('button', 'zn-mini', label);
  b.type = 'button';
  b.setAttribute('aria-label', aria || label);
  b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ok = await writeClipboard(String(getText() ?? ''));
    b.textContent = ok ? 'copied ✓' : 'copy failed';
    b.dataset.done = ok ? '1' : '';
    setTimeout(() => {
      b.textContent = label;
      b.dataset.done = '';
    }, 1400);
  });
  return b;
}

export function chip(glyph, label, channel, title) {
  const c = el('span', 'zn-chip');
  if (channel) c.dataset.ch = channel;
  add(c, el('span', 'zn-gly', glyph), el('span', null, label));
  c.setAttribute('aria-label', title || `${label}`);
  if (title) c.title = title;
  return c;
}

/**
 * `num` is the field's number in the design spec's field table, kept in the
 * source so this file can be read against that document. It is deliberately NOT
 * rendered: the numbers are gapped (1, 2, 3, 4, 6, 15) because this slice does
 * not carry every field, and showing "04 … 06 … 15" on screen reads as missing
 * content rather than as a faithful subset. The spec numbers the document; the
 * owner reads the screen.
 */
export function field(num, label, ...content) {
  const f = el('section', 'zn-field');
  f.dataset.specField = String(num);
  const lab = el('div', 'zn-lab');
  add(lab, el('span', null, label));
  add(f, lab, ...content);
  return f;
}

/** §4.5 — a field that does not apply renders `n/a` WITH A REASON, never blank. */
export function na(reason) {
  const d = el('div', 'zn-na');
  add(d, el('b', null, 'n/a'), document.createTextNode(' — ' + reason));
  return d;
}

/** §4.5 — a field that cannot be resolved renders `unresolved` and blocks Approve. */
export function unresolved(reason) {
  const d = el('div', 'zn-unres');
  add(
    d,
    el('span', null, '▲ unresolved'),
    document.createTextNode(' — ' + reason),
  );
  return d;
}

/* Tier badge: glyph + label + fill delta, so it survives greyscale. */
const TIER_GLYPH = { T0: '○', T1: '◔', T2: '◑', T3: '◕', T4: '✕' };

export function tierBadge(preview) {
  const tier = preview.tier;
  const glyph = TIER_GLYPH[tier] || '○';
  if (preview.denied || tier === 'T4') {
    return chip(glyph, `${tier} · prohibited`, 'red', `Tier ${tier}: prohibited outright`);
  }
  if (preview.auto || tier === 'T0') {
    return chip(glyph, `${tier} · auto`, 'cyan', `Tier ${tier}: auto-approved, no owner decision owed`);
  }
  return chip(glyph, `${tier} · approval owed`, 'amber', `Tier ${tier}: your approval is required`);
}
