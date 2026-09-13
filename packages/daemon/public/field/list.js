/*
 * field/list.js — the list equivalent: the same field, read rather than
 * rotated.
 */

import { S, F, N, esc } from './state.js';
import { attOf, attCol } from './attention.js';
import { draw } from './engine.js';
import { renderNodeCard } from './card.js';

export function renderList(listEl) {
  if (!listEl) return;
  if (!N.length) { listEl.innerHTML = '<p class="field-empty">The field has not been read yet.</p>'; return; }
  const rows = N.map((n) => {
    const a = attOf(n);
    const badge = a ? `<span class="field-att field-att--${a}">${esc(a)}</span>` : '';
    return `<li><button type="button" class="flrow" data-id="${esc(n.id)}" aria-selected="${S.sel === n.id ? 'true' : 'false'}">`
      + `<span class="field-dot field-dot--${esc(n.k)}"${a ? ` style="border-color:${attCol(a)}"` : ''}></span>`
      + `<span class="field-l">${esc(n.l)}</span><span class="field-k">${esc(n.k)}</span>${badge}</button>`
      + `<p class="field-d">${esc(n.d || '')}</p></li>`;
  }).join('');
  // The in-flow host for the node card while the list is open. Left empty here
  // and filled by renderNodeCard(), which always runs after this function.
  listEl.innerHTML = '<div data-slot="node-card-list"></div>'
    + `<ul class="field-list">${rows}</ul>`
    + (S.emptyNote ? `<p class="field-empty">${esc(S.emptyNote)}</p>` : '');
  listEl.querySelectorAll('.flrow').forEach((b) => b.addEventListener('click', () => {
    S.sel = b.getAttribute('data-id'); syncList(); renderNodeCard(); if (!F.raf) draw();
  }));
}
export function syncList() {
  document.querySelectorAll('.flrow').forEach((b) => b.setAttribute('aria-selected', b.getAttribute('data-id') === S.sel ? 'true' : 'false'));
}
