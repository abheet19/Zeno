/*
 * field/engine.js — the canvas engine, ported from the Gate-2 prototype:
 * projPt · lay · sphere · the edge pass · draw · loop · pick · the
 * label-placement pass. Rules, constants and easing curves are the
 * prototype's values, not re-derived ones — the field is meant to look like
 * itself, and it is the one thing in this window that is a picture rather
 * than a readout.
 */

import { shouldAnimateField } from '../field-model.js';
import { R, S, F, N, E, ACT, FIELD_FRAME_MS, LIVE_K } from './state.js';
import { cv, rgba, attOf, attPri, attPulse, attCol, urgOf, neighborsOf, g } from './attention.js';

/* ===== the prototype's canvas engine, ported ================================ */
function projPt(px, py, pz) {
  const cr = Math.cos(F.rot), sr = Math.sin(F.rot), ct = Math.cos(F.tilt), st2 = Math.sin(F.tilt);
  const x = px * cr - pz * sr, z = px * sr + pz * cr, y = py * ct - z * st2, zz = py * st2 + z * ct, p = 1 / (1.85 - zz * 0.46);
  return { x: x * p, y: y * p, d: zz, p };
}
function proj(n) { return projPt(n.x, n.y, n.z); }
function lay(t) {
  // The masthead now sits BELOW the field, so the orb is centred on both axes
  // instead of being pushed right to clear a left-hand headline. Projection
  // scale + vertical centre match the design orb (artifact b551a806).
  const pad = Math.min(F.W * 0.32, F.H * 0.62);
  const cx = F.W * 0.50, cy = F.H * 0.46;
  F._pad = pad; F._cx = cx; F._cy = cy;
  const breathe = S.motion ? (t || 0) : 0;
  N.forEach((n) => {
    /* neurons drift gently around their home — alive, never chaotic */
    n.x = n.hx + (breathe ? 0.045 * Math.sin(breathe * 0.29 + n.ph) : 0);
    n.y = n.hy + (breathe ? 0.038 * Math.sin(breathe * 0.22 + n.ph * 1.7) : 0);
    n.z = n.hz + (breathe ? 0.045 * Math.cos(breathe * 0.26 + n.ph * 2.3) : 0);
    const q = proj(n); n._ = q; n.sx = cx + q.x * pad; n.sy = cy + q.y * pad;
  });
}
/* depth 0 = farthest, 1 = nearest */
function dep(n) { return Math.max(0, Math.min(1, (n._.d + 1.05) / 2.1)); }

function sphere(c, n, r, col, lit) {
  const grd = c.createRadialGradient(n.sx - r * 0.42, n.sy - r * 0.5, r * 0.12, n.sx, n.sy, r * 1.06);
  grd.addColorStop(0, lit ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.48)');
  grd.addColorStop(0.30, rgba(col, 1));
  grd.addColorStop(0.80, rgba(col, 0.78));
  grd.addColorStop(1, 'rgba(0,0,0,.62)');
  c.beginPath(); c.arc(n.sx, n.sy, r, 0, 7); c.fillStyle = grd; c.fill();
}

export function draw() {
  if (!F.x || !F.W || !F.H) return;
  const c = F.x; c.clearRect(0, 0, F.W, F.H);
  const t = performance.now() / 1000; lay(t);
  const act = ACT, placed = [];
  const focus = S.sel || (F.hov && F.hov.id) || null, neigh = focus ? neighborsOf(focus) : null;
  let beaconId = null, bestScore = -1;
  N.forEach((n) => { const pr = attPri(attOf(n)); if (pr >= 3) { const sc = pr * 100000 + (n.ageMin || 0); if (sc > bestScore) { bestScore = sc; beaconId = n.id; } } });
  const CY = cv('--cyan'), GO = cv('--gold'), I3 = cv('--ink-3');
  const lightTheme = (R.getAttribute('data-theme') === 'light')
    || (!R.getAttribute('data-theme') && matchMedia('(prefers-color-scheme:light)').matches);
  /* A glow is light ADDED to a dark ground. The prototype's alphas are tuned
     for #0A0C0E, where a 36%-alpha wash of #D8BE7E reads as luminance; on the
     light ramp the same token is DARK (#5D4D27) and the same wash paints a
     solid mud-brown disc over the cream. Scale the two wash passes down on
     light so they read as the tint they are meant to be — still clearly a
     halo around what wants you, just not a bruise. The ground shadow already
     branches this way; this is the same correction, one layer up. */
  const glowK = lightTheme ? 0.62 : 1;

  /* ground shadow — anchors the graph in space instead of floating it on a flat field */
  const gy = F.H * 0.46 + F._pad * 0.92;
  const gg = c.createRadialGradient(F.W * 0.5, gy, 2, F.W * 0.5, gy, F._pad * 0.95);
  gg.addColorStop(0, lightTheme ? 'rgba(23,26,30,.13)' : 'rgba(0,0,0,.5)');
  gg.addColorStop(1, 'rgba(0,0,0,0)');
  c.save(); c.translate(F.W * 0.5, gy); c.scale(1, 0.17); c.translate(-F.W * 0.5, -gy);
  c.beginPath(); c.arc(F.W * 0.5, gy, F._pad * 0.95, 0, 7); c.fillStyle = gg; c.fill(); c.restore();

  /* edges, far-to-near, colour-graded along their length */
  E.slice().filter((e2) => g(e2[0]) && g(e2[1]))
    .sort((p, q) => (g(p[0])._.d + g(p[1])._.d) - (g(q[0])._.d + g(q[1])._.d))
    .forEach((e2) => {
      const a = g(e2[0]), b = g(e2[1]), da = dep(a), db = dep(b), dm = (da + db) / 2;
      const live = act.indexOf(a.id) >= 0 && act.indexOf(b.id) >= 0;
      const lg = c.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
      // `runtime` reads cyan with the surfaces: it is a live local capability,
      // not a stored artefact. Memory, meetings and models stay neutral.
      const ca = (a.k === 'core' ? GO : LIVE_K[a.k] ? CY : I3);
      const cb = (b.k === 'core' ? GO : LIVE_K[b.k] ? CY : I3);
      lg.addColorStop(0, ca); lg.addColorStop(1, cb);
      const conn = !focus || a.id === focus || b.id === focus;
      c.globalAlpha = ((live ? 0.52 : 0.20) + 0.30 * dm) * (conn ? 1 : 0.16);
      c.strokeStyle = lg; c.lineWidth = ((live ? 1.5 : 0.85) + 1.15 * dm) * (conn ? 1 : 0.7);
      const eg = e2[2] === 'eg';
      if (eg) {
        c.strokeStyle = cv('--amber'); c.globalAlpha = (conn ? 0.6 : 0.18) + 0.12 * dm;
        c.lineWidth = (1.1 + 1.0 * dm) * (conn ? 1 : 0.7); c.setLineDash([5, 4]);
      } else c.setLineDash(a.k === 'srcq' || b.k === 'srcq' ? [3, 5] : []);
      c.beginPath(); c.moveTo(a.sx, a.sy); c.lineTo(b.sx, b.sy); c.stroke();
      if (eg) {
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        c.setLineDash([]); c.globalAlpha = conn ? 0.9 : 0.4;
        c.font = '700 8px "IBM Plex Mono",monospace'; c.textAlign = 'center';
        c.beginPath(); c.arc(mx, my, 5.5, 0, 7); c.fillStyle = cv('--g1'); c.fill();
        c.fillStyle = cv('--amber'); c.fillText('⚡', mx, my + 2.7); c.textAlign = 'left';
      }
    });
  c.setLineDash([]); c.globalAlpha = 1;

  N.slice().sort((a, b) => a._.d - b._.d).forEach((n) => {
    const d = dep(n), base = (n.k === 'core' ? 11 : 6.4);
    let r = base * (0.46 + 1.08 * d);
    const on = act.indexOf(n.id) >= 0 && S.motion;
    const _a = attOf(n);
    const szf = (_a === 'needs' || _a === 'error') ? 1.16 : _a === 'blocked' ? 1.08 : 1; // urgent things read bigger
    r *= szf * attPulse(_a, t);
    const col = (n.k === 'core' ? GO : LIVE_K[n.k] ? CY : n.k === 'srcq' ? cv('--red') : I3);
    const sel = (n === F.hov || n.id === S.sel);
    const att = _a;
    let acol = att ? attCol(att) : null;

    /* spreading activation — a neuron next to a firing one warms up faintly */
    if (!att && !acol) {
      for (let ai = 0; ai < N.length; ai++) {
        const m = N[ai];
        if (m !== n && attOf(m) && neighborsOf(m.id)[n.id]) {
          acol = null;
          const sc = attCol(attOf(m)), sp2 = 0.10 + (S.motion ? 0.05 * Math.sin(t * 2.7 + n.ph) : 0);
          const sg = c.createRadialGradient(n.sx, n.sy, 1, n.sx, n.sy, r * 3.4);
          sg.addColorStop(0, rgba(sc, sp2)); sg.addColorStop(1, rgba(sc, 0));
          c.globalAlpha = 1; c.beginPath(); c.arc(n.sx, n.sy, r * 3.4, 0, 7); c.fillStyle = sg; c.fill();
          break;
        }
      }
    }
    const lit = !focus || n.id === focus || (neigh && neigh[n.id]);
    const dimf = lit ? 1 : (att ? 0.5 : 0.24);

    /* ATTENTION GLOW — what needs you pulses in its state colour */
    if (acol) {
      const ap = (att === 'verified' || att === 'waiting' ? 0.24 : 0.24 + 0.20 * (attPulse(att, t) - 1) / 0.26) * (0.72 + 0.55 * urgOf(n)) * dimf * glowK;
      const abr = r * 6.8;
      const ag = c.createRadialGradient(n.sx, n.sy, r * 0.4, n.sx, n.sy, abr);
      ag.addColorStop(0, rgba(acol, ap)); ag.addColorStop(0.5, rgba(acol, ap * 0.32)); ag.addColorStop(1, rgba(acol, 0));
      c.globalAlpha = 1; c.beginPath(); c.arc(n.sx, n.sy, abr, 0, 7); c.fillStyle = ag; c.fill();
    }

    /* bloom: strongest on the core and on whatever is live */
    if (n.k === 'core' || on || sel) {
      const br = r * (n.k === 'core' ? 7.0 : 4.8), peak = (n.k === 'core' ? 0.36 : 0.26) * (0.45 + 0.55 * d) * glowK;
      const bg = c.createRadialGradient(n.sx, n.sy, r * 0.35, n.sx, n.sy, br);
      bg.addColorStop(0, rgba(col, peak));
      bg.addColorStop(0.45, rgba(col, peak * 0.28));
      bg.addColorStop(1, rgba(col, 0));
      c.globalAlpha = 1; c.beginPath(); c.arc(n.sx, n.sy, br, 0, 7); c.fillStyle = bg; c.fill();
    }

    /* far nodes sit back: softer, smaller, lower contrast */
    c.globalAlpha = Math.min(1, 0.46 + 0.54 * d) * dimf;
    c.shadowColor = acol || col; c.shadowBlur = (sel ? 16 : acol ? 11 : on ? 12 : 5) * (0.4 + 0.6 * d);
    sphere(c, n, r, col, sel || n.k === 'core');
    c.shadowBlur = 0;

    /* attention ring in the state colour */
    if (acol) {
      c.globalAlpha = 0.92 * dimf; c.beginPath(); c.arc(n.sx, n.sy, r + 3.4, 0, 7);
      c.strokeStyle = acol; c.lineWidth = 1.7; c.stroke();
    }

    c.beginPath(); c.arc(n.sx, n.sy, r, 0, 7);
    c.strokeStyle = acol || col; c.globalAlpha = Math.min(1, (0.34 + 0.66 * d)) * (sel ? 1 : 0.8) * dimf;
    c.lineWidth = (n.k === 'core' ? 1.7 : 1.1) * (0.6 + 0.7 * d); c.stroke();

    if (sel) {
      c.globalAlpha = 0.95; c.beginPath(); c.arc(n.sx, n.sy, r + 7.5, 0, 7);
      c.strokeStyle = GO; c.lineWidth = 1.4; c.stroke();
    }

    /* ATTENTION BEACON — the one thing that most needs you: expanding ping + turning reticle */
    if (n.id === beaconId) {
      c.save(); c.strokeStyle = acol || cv('--amber');
      if (S.motion) {
        const pg = (t * 0.7) % 1; c.globalAlpha = (1 - pg) * 0.55;
        c.lineWidth = 1.4; c.beginPath(); c.arc(n.sx, n.sy, r + 5 + pg * 20, 0, 7); c.stroke();
      }
      c.globalAlpha = 0.9; c.lineWidth = 1.3; c.setLineDash([4.5, 5.5]); c.lineDashOffset = S.motion ? -t * 13 : 0;
      c.beginPath(); c.arc(n.sx, n.sy, r + 9, 0, 7); c.stroke();
      c.restore();
    }

    /* glassy specular: a bright arc where the light catches the sphere */
    if (sel || n.k === 'core') {
      c.globalAlpha = Math.min(1, 0.5 + 0.5 * d);
      c.beginPath(); c.arc(n.sx - r * 0.30, n.sy - r * 0.34, r * 0.62, Math.PI * 1.02, Math.PI * 1.55);
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.1; c.stroke(); c.globalAlpha = 1;
    }

    const lab = (sel || n.k === 'core' || att || d > 0.50);
    if (lab) {
      const txt = n.l;
      const fs = (8.6 + 3.4 * d).toFixed(1);
      c.font = `500 ${fs}px "IBM Plex Mono",monospace`;
      const tw = c.measureText(txt).width;
      const rightX = n.sx + r + 8;
      const leftX = n.sx - r - 8 - tw;
      const preferRight = rightX + tw <= F.W - 10;
      const xs = preferRight ? [rightX, leftX] : [leftX, rightX];
      const offsets = [0, 15, -15, 30, -30, 45, -45];
      const hit = (x, y) => placed.some((b) => (
        Math.abs(b.y - y) < 13 && x < b.x + b.w + 7 && b.x < x + tw + 7
      ));
      let lx = xs[0];
      let ly = n.sy + 3.5;
      let clash = true;
      for (const x of xs) {
        for (const offset of offsets) {
          const y = n.sy + 3.5 + offset;
          if (x < 8 || x + tw > F.W - 8 || y < 12 || y > F.H - 8 || hit(x, y)) continue;
          lx = x;
          ly = y;
          clash = false;
          break;
        }
        if (!clash) break;
      }
      const must = (sel || n.k === 'core');
      if (!clash || must) {
        // In the exceptionally dense case where even fourteen positions are
        // occupied, the core/selected label stays visible in a bounded spot.
        if (clash) {
          lx = Math.max(8, Math.min(F.W - tw - 8, preferRight ? rightX : leftX));
          ly = Math.max(12, Math.min(F.H - 8, n.sy + 18.5));
        }
        /* a halo, not a box — labels stay legible over bright edges without boxing them in */
        c.globalAlpha = Math.min(1, 0.52 + 0.48 * d);
        c.shadowColor = lightTheme ? 'rgba(233,232,226,.95)' : 'rgba(10,12,14,.95)';
        c.shadowBlur = 7;
        c.fillStyle = sel ? cv('--ink') : cv('--ink-2');
        c.fillText(txt, lx, ly); c.fillText(txt, lx, ly);
        c.shadowBlur = 0;
        placed.push({ x: lx, y: ly, w: tw });
      }
    }
  });
  c.globalAlpha = 1;

  /* An empty field says so in words. It never draws a busier one. */
  if (S.emptyNote) {
    c.globalAlpha = 0.85; c.fillStyle = cv('--ink-3');
    c.font = '500 11px "IBM Plex Mono",monospace'; c.textAlign = 'center';
    wrapText(c, S.emptyNote, F._cx || F.W / 2, F.H - 46, Math.min(F.W - 48, 360), 15);
    c.textAlign = 'left'; c.globalAlpha = 1;
  }
}
function wrapText(c, text, x, y, maxW, lh) {
  const words = String(text).split(' '); let line = ''; const lines = [];
  for (const w of words) { const test = line ? line + ' ' + w : w; if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
  if (line) lines.push(line);
  const startY = y - (lines.length - 1) * lh;
  lines.forEach((l, i) => c.fillText(l, x, startY + i * lh));
}

/* ---- animation + sizing ---------------------------------------------------- */
export function fieldSurfaceVisible() {
  const hero = document.getElementById('cmd-hero');
  // offsetParent is null when an ANCESTOR is display:none — which is now how a
  // Command panel switch hides Home (command-panels toggles the .home wrapper,
  // not #cmd-hero's own hidden attribute). Checking it here stops the canvas
  // from looping on a hidden surface exactly as the old hero.hidden check did.
  return (!hero || (!hero.hidden && hero.offsetParent !== null)) && shouldAnimateField({
    surface: R.getAttribute('data-zeno-surface'),
    visibilityState: document.visibilityState,
    fieldList: false,
    motion: true,
  });
}
export function fieldShouldAnimate() {
  const hero = document.getElementById('cmd-hero');
  // offsetParent is null when an ANCESTOR is display:none — which is now how a
  // Command panel switch hides Home (command-panels toggles the .home wrapper,
  // not #cmd-hero's own hidden attribute). Checking it here stops the canvas
  // from looping on a hidden surface exactly as the old hero.hidden check did.
  return (!hero || (!hero.hidden && hero.offsetParent !== null)) && shouldAnimateField({
    surface: R.getAttribute('data-zeno-surface'),
    visibilityState: document.visibilityState,
    fieldList: S.fieldList,
    motion: S.motion,
  });
}
function loop(now) {
  if (!F.c || !F.c.isConnected || !fieldShouldAnimate()) { F.raf = 0; F.lastFrame = 0; return; }
  const elapsed = F.lastFrame ? now - F.lastFrame : FIELD_FRAME_MS;
  if (elapsed >= FIELD_FRAME_MS) {
    const bounded = Math.min(elapsed, 100);
    F.lastFrame = now;
    if (!F.drag) { F.rot += 0.28 * bounded / 1000; F.tilt = F.tilt0 + Math.sin(now / 6400) * 0.06; }
    draw();
  }
  F.raf = requestAnimationFrame(loop);
}
export function stopF() { if (F.raf) { cancelAnimationFrame(F.raf); F.raf = 0; } F.lastFrame = 0; if (F.init) { clearTimeout(F.init); F.init = 0; } }
export function startF() { if (!F.raf && F.c && F.c.isConnected && fieldShouldAnimate()) F.raf = requestAnimationFrame(loop); }
export function size() {
  if (!fieldSurfaceVisible()) {
    if (F.init) clearTimeout(F.init);
    F.init = 0;
    return;
  }
  if (!F.c || !F.c.isConnected) return;
  const host = F.c.parentElement; if (!host) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) { if (F.init) clearTimeout(F.init); F.init = setTimeout(size, 60); return; }
  if (F.init) { clearTimeout(F.init); F.init = 0; }
  const d = Math.min(devicePixelRatio || 1, 2);
  F.W = w; F.H = h;
  F.c.style.width = w + 'px'; F.c.style.height = h + 'px';
  F.c.width = Math.round(w * d); F.c.height = Math.round(h * d);
  F.x.setTransform(d, 0, 0, d, 0, 0);
  draw();
}
export function fieldOn() {
  const el = F.c;
  if (!el || !el.isConnected || !el.parentElement) return;
  F.x = el.getContext('2d');
  stopF();
  size();                                   // synchronous: layout is already flushed here
  try {
    if (F.ro) F.ro.disconnect();
    if (window.ResizeObserver && el.parentElement) {
      F.ro = new ResizeObserver(() => size());
      F.ro.observe(el.parentElement);
    }
  } catch { /* the observer is an optimisation, never a dependency */ }
  if (fieldShouldAnimate()) startF(); else draw();
}
export function pick(x, y) { let b = null, bd = 20; N.forEach((n) => { const d = Math.hypot(n.sx - x, n.sy - y); if (d < bd) { bd = d; b = n; } }); return b; }
