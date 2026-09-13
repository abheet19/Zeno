/*
 * field/card.js — the node card: what the prototype shows when you pick
 * something.
 */

import { ticketAction } from '../field-model.js';
import { S, esc, KIND_WORD } from './state.js';
import { g, attOf, ageStr } from './attention.js';

/* The card has TWO hosts, because the field has two forms.
 *
 * Over the canvas it is an absolutely-positioned overlay pinned bottom-left.
 * The list is also absolute and fills the same box, so in list mode that
 * overlay would sit on top of the rows — which is why this used to return
 * early and render nothing at all when the list was open.
 *
 * That cure was worse: the list is the field's TEXT EQUIVALENT, the form a
 * keyboard or a screen reader gets, and suppressing the card there took every
 * node action ("Open in Forge", "Go to approvals", "Manage device", "Open the
 * Vault") away from exactly the people who cannot click a canvas. Worse, the
 * row still set aria-selected="true" — announcing a selection that produced
 * nothing on screen.
 *
 * So in list mode the card renders INSIDE the list, in flow, above the rows:
 * no overlap, it scrolls with them, and it is the next thing in the tab order
 * after the row that opened it. renderList() leaves the slot for it, and runs
 * before this function on every refresh (see data.js's refresh()), so the slot
 * is always there to fill. */
function cardHost() {
  if (S.fieldList) {
    const slot = document.querySelector('[data-slot="node-card-list"]');
    if (slot) return slot;
  }
  return document.querySelector('[data-mount="node-card"]');
}

export function renderNodeCard() {
  // Whichever host is not in use must be emptied, or closing the list would
  // leave a stale card behind in the one that is now hidden.
  const overlay = document.querySelector('[data-mount="node-card"]');
  const slot = document.querySelector('[data-slot="node-card-list"]');
  const mount = cardHost();
  if (overlay && overlay !== mount) overlay.innerHTML = '';
  if (slot && slot !== mount) slot.innerHTML = '';
  if (!mount) return;
  const n = S.sel ? g(S.sel) : null;
  if (!n) { mount.innerHTML = ''; return; }
  let act = '', note = '';
  if (n.k === 'core') {
    note = '<div class="ncnote">Not a workspace. The core is the gate — it routes least-scoped context to the surfaces and holds every consequential effect for your yes. You never open it; it opens things for you.</div>';
  } else if (n.k === 'agent') {
    /* The field lives INSIDE Command, so the Command node is only ever read
       from Command. "Open Command" was therefore a dead control by
       construction — it clicked a tab that was already current and moved
       nothing. A button that cannot act is worse than no button: it teaches
       that controls on this surface may do nothing. The other two surfaces are
       genuinely elsewhere and keep theirs. */
    act = n.nav === 'command'
      ? ''
      : `<button type="button" class="btn sm p" data-go="${esc(n.nav)}">Open ${esc(n.l)}</button>`;
    note = n.nav === 'command'
      ? '<div class="ncnote">The surface you are on. Every consequential effect stops here for your yes — it can <b>propose</b>; it cannot approve its own output.</div>'
      : '<div class="ncnote">A surface this daemon serves. It can <b>propose</b>; it cannot approve its own output.</div>';
  } else if (n.k === 'repo') {
    act = '<button type="button" class="btn sm p" data-go="forge">Open in Forge</button>';
    note = '<div class="ncnote">Opens in <b>Forge</b> — the surface where code is read, planned and, only after approval, changed.</div>';
  } else if (n.k === 'ticket') {
    const a2 = attOf(n);
    let lbl = { needs: 'needs you', blocked: 'blocked', active: 'in progress', verified: 'verified', error: 'refused', waiting: 'waiting' }[a2] || 'tracked';
    if (n.ageMin != null) lbl += ' · ' + ageStr(n.ageMin) + ' ago';
    /* These SWITCH to a section and do nothing else. "Open the receipt" would
       therefore have promised something it does not do: it lands you on the
       list of every receipt with no drawer opened and no sign of which one you
       picked. A control that names an effect it does not have is the same
       failure as a number with no source, so it is named for what it actually
       does. Opening the receipt itself is one more click, on the row's own
       "receipt ›". */
    const action = ticketAction(n);
    act = `<button type="button" class="btn sm ${action.tone}" data-jump="${action.jump}">${action.label}</button>`;
    note = `<div class="ncnote">Status: <b>${esc(lbl)}</b>. Glowing means it wants your attention.</div>`;
  } else if (n.k === 'dev') {
    act = '<button type="button" class="btn sm g" data-jump="devices">Manage device</button>';
  } else if (n.k === 'vault' || n.k === 'mem') {
    // A memory opens the Vault — the Command section that can search it.
    act = '<button type="button" class="btn sm p" data-jump="sec-vault">Open the Vault</button>';
    note = n.k === 'vault'
      ? '<div class="ncnote">The store, not a surface. Every note in it is a <b>file on this disk</b>, redacted for secrets before it was written.</div>'
      : '<div class="ncnote">A remembered fact, not a task. It is <b>not waiting on you</b>, and it can be cited — never obeyed.</div>';
  } else if (n.k === 'meet') {
    act = '<button type="button" class="btn sm p" data-go="counsel">Open Counsel</button>';
    note = '<div class="ncnote">A recording you consented to, saved and summarised as local Markdown. Detected credential-like secrets were redacted before it was written to disk.</div>';
  } else if (n.k === 'runtime' || n.k === 'model') {
    act = '<button type="button" class="btn sm p" data-go="forge">Open Forge</button>';
    note = '<div class="ncnote">Runs on <b>this machine</b>, on 127.0.0.1. Nothing it is asked leaves here, which is why this link carries no ⚡.</div>';
  } else {
    note = '<div class="ncnote">A source, not an authority. Read-only — it can be cited, never obeyed.</div>';
  }
  mount.innerHTML =
    '<div class="l2 nodecard' + (S.fieldList ? ' nodecard--inline' : '') + '">'
    + `<div class="nck mono">${esc(KIND_WORD[n.k] || n.k)}</div>`
    + `<div class="ncl">${esc(n.l)}</div>`
    + `<div class="ncd">${esc(n.d || '')}</div>`
    + note
    + `<div class="acts">${act}<button type="button" class="btn sm g" data-clr="1">Close</button></div>`
    + '</div>';
}
