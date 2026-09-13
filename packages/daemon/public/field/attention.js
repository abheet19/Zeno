/*
 * field/attention.js — turning a node's raw state into what the eye sees.
 *
 * cv()/rgba() resolve a design token into a colour the canvas can tint; attCol
 * /attPri/attPulse turn an attention state ("needs", "blocked", …) into a
 * colour, an urgency ranking and a breathing rhythm; g()/neighborsOf()/attOf()
 * are the small lookups draw(), the node card and the list view all share
 * against the live node/edge arrays in state.js.
 */

import { R, S, N, E } from './state.js';

/* ---- reading a token as a colour the canvas can actually tint -------------
   The prototype could treat every token as a hex literal, because its own
   :root was hex all the way down. Ours is not: tokens.css states the LIGHT
   ramp as color-mix(), so --gold reads back as

       color-mix(in srgb, #8A6D2C 61%, #171A1E)

   and the old rgba() — which returned any non-"#" string unchanged — silently
   DROPPED the alpha. Every "glow" stop, including the one that is supposed to
   fade to nothing, painted at full opacity, so on the light theme the field
   drew a stack of solid discs instead of light. Resolve the token through the
   engine once per theme and cache it, so rgba() always has numbers to work
   with. The probe stays display:none; computed `color` resolves either way. */
const _probe = document.createElement('span');
_probe.setAttribute('aria-hidden', 'true');
_probe.style.cssText = 'display:none';
let _cvCache = new Map();
let _cvKey = '';
function themeKey() {
  let dark = false;
  try { dark = matchMedia('(prefers-color-scheme:dark)').matches; } catch { /* none */ }
  return (R.getAttribute('data-theme') || 'system') + (dark ? '|d' : '|l');
}
export function cv(v) {
  const k = themeKey();
  if (k !== _cvKey) { _cvCache.clear(); _cvKey = k; }
  const hit = _cvCache.get(v);
  if (hit !== undefined) return hit;
  const raw = getComputedStyle(R).getPropertyValue(v).trim();
  let out = raw;
  if (raw && raw.charAt(0) !== '#') {
    try {
      if (!_probe.isConnected) document.body.appendChild(_probe);
      _probe.style.color = '';
      _probe.style.color = raw;
      out = getComputedStyle(_probe).color || raw;
    } catch { out = raw; }
  }
  _cvCache.set(v, out);
  return out;
}
/* Tint any resolved colour — "#rgb", "#rrggbb", "rgb(...)" or "rgba(...)". */
export function rgba(h, a) {
  h = (h || '#888').trim();
  if (h.charAt(0) === '#') {
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    const n = parseInt(h.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = h.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return `rgba(${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])},${a})`;
  // Unparseable: fall back to a neutral rather than to an opaque mystery colour,
  // because an unexpected opaque fill is exactly the failure this replaced.
  return `rgba(136,136,136,${a})`;
}
/* what glows tells you what wants you */
export function attCol(a) {
  return a === 'needs' ? cv('--amber')
    : (a === 'blocked' || a === 'error') ? cv('--red')
      : a === 'active' ? cv('--cyan')
        : a === 'verified' ? cv('--green')
          : a === 'waiting' ? cv('--ink-3') : null;
}
/* priority: what should grab you FIRST (higher = more urgent for YOU) */
export function attPri(a) { return a === 'error' ? 5 : a === 'needs' ? 4 : a === 'blocked' ? 3 : a === 'active' ? 2 : a === 'verified' ? 1 : 0; }
/* each state breathes differently — the rhythm itself tells you the mood */
export function attPulse(a, t) {
  if (!S.motion) return 1;
  if (a === 'needs') return 1 + 0.26 * Math.sin(t * 3.4);             // urgent, quick
  if (a === 'error') return 1 + 0.34 * Math.max(0, Math.sin(t * 6.2)); // sharp flash
  if (a === 'blocked') return 1 + 0.15 * Math.sin(t * 1.3);           // slow, labored — "stuck"
  if (a === 'active') return 1 + 0.11 * Math.sin(t * 2.2);            // gentle working
  return 1;                                                            // verified / waiting = calm
}
export function urgOf(n) { return Math.min(1, (n.ageMin || 0) / 720); } // maxes out at ~12h waiting
export function ageStr(m) { return m == null ? '' : m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; }
export function neighborsOf(id) { const s = {}; for (const e of E) { if (e[0] === id) s[e[1]] = 1; if (e[1] === id) s[e[0]] = 1; } return s; }
export function g(id) { return N.find((n) => n.id === id); }
export function attOf(n) { return n.att || null; }
export function minutesSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}
