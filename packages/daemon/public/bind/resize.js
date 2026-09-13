/*
 * bind/resize.js — make the Forge Session panel draggable.
 *
 * The owner: "side panel Zeno chat is not resizable, fix it." The session panel
 * (#sess — the "Session" column on the right of Forge, where you talk to Zeno)
 * shipped at a fixed width. This adds a drag handle on its left edge, clamps the
 * width to something sane, and remembers it per device.
 *
 * Self-contained on purpose: it injects its own CSS and owns a new element, so
 * it touches no other module and cannot fight the workbench layout code.
 */

import { $ } from '../bind.js';

const KEY = 'zeno-sessw';
const MIN = 300;
const MAX = 760;

function injectStyle() {
  if (document.getElementById('zeno-resize-style')) return;
  const s = document.createElement('style');
  s.id = 'zeno-resize-style';
  s.textContent = `
    #sess{position:relative}
    .sess-grip{position:absolute; left:-3px; top:0; width:7px; height:100%; z-index:20;
      cursor:col-resize; touch-action:none}
    .sess-grip::after{content:""; position:absolute; left:2px; top:0; width:1px; height:100%;
      background:transparent; transition:background .12s}
    .sess-grip:hover::after, .sess-grip.drag::after{background:var(--cyan,#38C3D6)}
    :root[data-density] #sess{}`;
  document.head.appendChild(s);
}

function clampWidth(px) {
  const max = Math.min(MAX, Math.round(window.innerWidth * 0.6));
  return Math.max(MIN, Math.min(max, px));
}

function apply(sess, px) {
  const w = clampWidth(px);
  sess.style.flex = '0 0 auto';
  sess.style.width = `${w}px`;
  return w;
}

export async function bind() {
  const sess = $('#sess');
  if (!sess || sess.dataset.resizable) return;
  sess.dataset.resizable = '1';
  injectStyle();

  // Restore a saved width; a bad or missing value just leaves the design default.
  try {
    const saved = parseInt(localStorage.getItem(KEY) || '', 10);
    if (Number.isFinite(saved)) apply(sess, saved);
  } catch { /* storage off: keep the default width */ }

  const grip = document.createElement('div');
  grip.className = 'sess-grip';
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Resize the Session panel');
  grip.tabIndex = 0;
  sess.appendChild(grip);

  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    // Dragging the LEFT edge: moving left (smaller clientX) widens the panel.
    const w = apply(sess, startW + (startX - e.clientX));
    grip.setAttribute('aria-valuenow', String(w));
  };
  const onUp = () => {
    grip.classList.remove('drag');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.body.style.userSelect = '';
    try { localStorage.setItem(KEY, String(Math.round(sess.getBoundingClientRect().width))); } catch { /* storage off */ }
  };
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = sess.getBoundingClientRect().width;
    grip.classList.add('drag');
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  // Keyboard resize, for a panel a mouse is not the only way to size.
  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16;
    let w = sess.getBoundingClientRect().width;
    if (e.key === 'ArrowLeft') w += step;
    else if (e.key === 'ArrowRight') w -= step;
    else return;
    e.preventDefault();
    const applied = apply(sess, w);
    try { localStorage.setItem(KEY, String(applied)); } catch { /* storage off */ }
  });

  // A window resize can push the saved width past the new 60% ceiling.
  window.addEventListener('resize', () => {
    if (sess.style.width) apply(sess, parseInt(sess.style.width, 10) || MIN);
  });
}
