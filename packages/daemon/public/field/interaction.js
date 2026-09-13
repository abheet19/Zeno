/*
 * field/interaction.js — drag to turn, hover to trace, click to inspect.
 */

import { S, F } from './state.js';
import { draw, pick } from './engine.js';
import { renderNodeCard } from './card.js';
import { syncList } from './list.js';

export function wire(el) {
  el.addEventListener('pointerdown', (e) => {
    F.drag = 1; F.mx = e.clientX; F.my = e.clientY; F._m = 0;
    try { el.setPointerCapture(e.pointerId); } catch { /* not captureable */ }
  });
  el.addEventListener('pointermove', (e) => {
    const b = el.getBoundingClientRect();
    if (F.drag) {
      const dx = e.clientX - F.mx, dy = e.clientY - F.my;
      F.rot += dx * 0.006;
      F.tilt = Math.max(-0.7, Math.min(0.7, F.tilt + dy * 0.004)); F.tilt0 = F.tilt;
      F.mx = e.clientX; F.my = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) F._m = 1;
      if (!F.raf) draw();   // with motion off, dragging still redraws
    } else {
      const h = pick(e.clientX - b.left, e.clientY - b.top);
      if (h !== F.hov) { F.hov = h; el.style.cursor = h ? 'pointer' : 'grab'; if (!F.raf) draw(); }
    }
  });
  el.addEventListener('pointerup', (e) => {
    if (F.drag && !F._m) {
      const b = el.getBoundingClientRect();
      const n = pick(e.clientX - b.left, e.clientY - b.top);
      S.sel = n ? n.id : null; renderNodeCard(); syncList();
    }
    F.drag = 0;
    if (!F.raf) draw();
  });
  el.addEventListener('pointercancel', () => { F.drag = 0; });
  el.addEventListener('pointerleave', () => { F.hov = null; F.drag = 0; if (!F.raf) draw(); });
}
