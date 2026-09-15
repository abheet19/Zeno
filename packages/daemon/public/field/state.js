/*
 * field/state.js — the Standing Field's shared mutable state.
 *
 * Every other module under field/ imports these SAME references rather than
 * owning private copies, so a mutation in one module (a rotation drag, a
 * fetch landing, a selection change) is immediately visible to every other
 * module reading that state — exactly as it was when all of this lived in
 * one file's closures.
 *
 * N, E and ACT are never REBOUND from outside this file — ES modules only let
 * the module that declares an exported `let`/`const` reassign it. They are
 * therefore treated as fixed containers: topology.js clears and refills them
 * in place (`N.length = 0; N.push(...)`), which every importer sees
 * immediately because they all hold the same array reference. The same is
 * true of S.emptyNote: it lives as a property on the shared S object rather
 * than as its own binding, so topology.js can set it and engine.js/list.js can
 * read it back.
 */

import { fieldMotionEnabled } from '../field-model.js';

export const R = document.documentElement;

// ---- auth: the same token the page was handed (empty for a read-only shell) --
export function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return (m && m.getAttribute('content')) || '';
}
export function authHeaders() {
  const t = token();
  return t ? { 'x-zeno-token': t } : {};
}

/* ---- per-device preference, stored locally and never synced ---------------- */
export function st(k, v) { try { localStorage.setItem('zeno-' + k, v); } catch { /* storage off */ } }
export function ld(k) { try { return localStorage.getItem('zeno-' + k); } catch { return null; } }

/* ---- html escaping + label clipping: shared by every renderer -------------- */
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
export function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ---- motion honesty -------------------------------------------------------
   THREE states, exactly like a theme toggle, because two is what broke it:

     data-reduce="1"   the owner said no motion
     data-reduce="0"   the owner said yes motion — and this must beat the OS
     unset             no choice made: follow the system

   Consulting prefers-reduced-motion AFTER an explicit "0" let the OS veto the
   owner, so on a machine with reduce-motion set system-wide the field could
   never be turned back on and simply looked broken. The field rotates on first
   launch; the visible Reduce motion control is persistent and immediate. */
export function motionOn() {
  return fieldMotionEnabled({ explicitReduction: R.getAttribute('data-reduce') });
}

// S.emptyNote: a truthful sentence when the field is nearly empty, set by
// topology.js and read by engine.js (the canvas) and list.js (its text
// equivalent).
export const S = { motion: true, sel: null, fieldList: false, emptyNote: null };
export const FIELD_FRAME_MS = 1000 / 30;
export const F = { c: null, x: null, rot: 0.62, tilt: 0.34, tilt0: 0.34, drag: 0, raf: 0, lastFrame: 0, hov: null, W: 0, H: 0, mx: 0, my: 0, ro: null, init: 0, _m: 0 };

/* Settle the attribute once at boot from the stored owner choice. A new device
   starts with the Standing Field moving; the owner can stop it from Settings. */
export function bootMotion() {
  const stored = ld('mo');
  R.setAttribute('data-reduce', stored === '0' ? '1' : '0');
  S.motion = motionOn();
}

// N = nodes, E = edges, ACT = the ids that are genuinely live right now.
export const N = [];
export const E = [];
export const ACT = [];

/* The kinds drawn in the live cyan: a surface, a work source, the local
   model runtime, and a running agent — the one thing on the field actually
   doing work right now. Everything else — a repo, a device, a ticket, a
   memory, a meeting, an installed model — is a thing at rest and reads
   neutral. */
export const LIVE_K = { agent: 1, src: 1, runtime: 1, run: 1 };

/* What the node card calls each kind. Without this, a new kind printed its own
   internal key at the reader ("mem", "meet", "ml") as if that were a word. */
export const KIND_WORD = {
  core: 'coordinating core',
  agent: 'surface',
  dev: 'device',
  repo: 'repository',
  src: 'work source',
  srcq: 'source · unverified',
  ticket: 'item',
  vault: 'governed memory',
  mem: 'memory · a remembered fact',
  meet: 'meeting · recorded here',
  runtime: 'local model runtime',
  model: 'installed local model',
  run: 'live agent run',
};
