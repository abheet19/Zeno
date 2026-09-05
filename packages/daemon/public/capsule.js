/**
 * Zeno · daemon UI · THE APPROVAL CAPSULE
 * =======================================
 * One capsule = one previewed action. Binding spec: docs/24-prototype-command.md PART IV.
 * Wire types: packages/kernel/src/types.ts (Preview, Binding, Receipt).
 *
 * The laws this file is written to obey, each one testable:
 *
 *   L-OPEN      Opening a capsule NEVER approves. Nothing in this module performs a
 *               network write except the one click handler on the Approve control.
 *   L-ONCE      The Approve control is permanently spent after ONE click. It is
 *               disabled synchronously, before `await`, behind a re-entrancy guard.
 *   L-SEAL      The verified seal renders ONLY from a receipt whose outcome is
 *               'verified'. Never on click. Never optimistically.
 *   L-T4        A T4 capsule renders Approve DISABLED with the reason on the control.
 *   L-COMPLETE  §4.5: a field that does not apply renders `n/a` WITH A REASON; a field
 *               that cannot be resolved renders `unresolved` AND DISABLES Approve with
 *               that reason on the control. There is no expert-mode override.
 *   L-COLOUR    amber = approval/warning · red = blocked/error · gold = owner origin
 *               · cyan = information · green = A VERIFIED RECEIPT EXISTS, nothing else.
 *   L-GLASS     No glass anywhere in this component. A capsule is text and consequence:
 *               shell is opaque --g3, the payload plane is fully opaque --g2.
 *   L-GREYSCALE Status is never colour alone — always glyph + label + fill delta.
 *
 * No framework. No build step. Plain DOM APIs. Every colour is a token from
 * glass/tokens.css; the only literals are the approved palette used as var() fallbacks
 * so the component still renders if the stylesheet has not loaded.
 *
 * Exports:
 *   renderCapsule(preview, opts) -> HTMLElement   (+ .applyReceipt(receipt), .destroy())
 *   renderRefused(receipt, preview) -> HTMLElement
 */

/* ------------------------------------------------------------------ *
 * 0 · tiny DOM helpers — textContent only, never innerHTML with data. *
 * ------------------------------------------------------------------ */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}

/* ------------------------------------------------------------------------- *
 * 1 · Canonical hashing — an exact mirror of packages/kernel/src/hash.ts.    *
 *                                                                            *
 * The kernel computes  actionHash = sha256(canonicalJSON(binding))  and      *
 * payloadHash = sha256(canonicalJSON(payload)). Both are reproducible here,  *
 * which is the whole point of §4.5 field 15: "Never — a hash the owner       *
 * cannot compare." So we compare them, in front of the owner, and a mismatch *
 * blocks approval.                                                           *
 * ------------------------------------------------------------------------- */

function sortValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const out = Object.create(null);
  for (const key of Object.keys(v).sort()) out[key] = sortValue(v[key]);
  return out;
}

/** Stable stringify: object keys sorted recursively; arrays preserve order. */
export function canonicalJSON(value) {
  return JSON.stringify(sortValue(value));
}

const SUBTLE =
  typeof globalThis.crypto === 'object' && globalThis.crypto
    ? globalThis.crypto.subtle
    : undefined;

async function sha256Hex(input) {
  if (!SUBTLE) throw new Error('no-subtlecrypto');
  const bytes = new TextEncoder().encode(input);
  const digest = await SUBTLE.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------- *
 * 2 · formatting — tabular mono for every hash/clock *
 * ------------------------------------------------- */

const HEAD = 10;
const TAIL = 6;

function truncHash(s) {
  if (typeof s !== 'string') return '';
  if (s.length <= HEAD + TAIL + 1) return s;
  return s.slice(0, HEAD) + '…' + s.slice(-TAIL);
}

function fmtClock(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso ?? '');
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtAbsolute(ms) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Countdown as h:mm:ss / mm:ss, tabular. Never negative. */
function fmtCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/* ------------------------------------------------------------------ *
 * 3 · styles — injected once. Colours come from glass/tokens.css.     *
 *     The literals below are var() FALLBACKS and are the exact        *
 *     approved palette, not new colours.                              *
 * ------------------------------------------------------------------ */

const STYLE_ID = 'zeno-capsule-styles';

const CSS = `
.zn-caps{
  /* one place where tokens are aliased; approved palette as fallback only */
  --zn-g1:var(--g1,#0A0C0E); --zn-g2:var(--g2,#0F1214); --zn-g3:var(--g3,#151A1D);
  --zn-g4:var(--g4,#1B2124); --zn-g5:var(--g5,#222A2E); --zn-g6:var(--g6,#2C363B);
  --zn-g7:var(--g7,#384349);
  --zn-ink:var(--ink,#ECEBE6); --zn-ink2:var(--ink-2,#9AA1AC); --zn-ink3:var(--ink-3,#6C7480);
  --zn-rule:var(--rule,#242C31); --zn-rule2:var(--rule-2,#2C363B);
  --zn-cyan:var(--cyan,#38C3D6); --zn-gold:var(--gold,#D8BE7E); --zn-amber:var(--amber,#E0A128);
  --zn-red:var(--red,#D8695A); --zn-green:var(--green,#5BB98C);
  --zn-focus:var(--focus,#86DEEC);
  --zn-mono:ui-monospace,"IBM Plex Mono","Cascadia Mono",Consolas,"SF Mono",monospace;
  --zn-sys:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;

  /* L-GLASS: opaque. A capsule is long text and consequence — never glass. */
  background:var(--zn-g3);
  backdrop-filter:none; -webkit-backdrop-filter:none;
  color:var(--zn-ink);
  font-family:var(--zn-sys);
  font-size:13px; line-height:1.5;
  border:1px solid var(--zn-rule);
  border-radius:10px;
  max-width:760px;
  display:flex; flex-direction:column;
  max-height:min(88vh,900px);
  overflow:hidden;
  box-shadow:var(--lift,0 1px 2px rgba(0,0,0,.4),0 12px 34px rgba(0,0,0,.36));
  font-variant-numeric:tabular-nums;
}
/* §4.10 awaiting-review: a STEADY amber outline. It rests. It never pulses. */
.zn-caps[data-state="awaiting"]{ border-color:color-mix(in srgb,var(--zn-amber) 42%,var(--zn-rule)); }
.zn-caps[data-state="committing"]{ border-color:color-mix(in srgb,var(--zn-cyan) 34%,var(--zn-rule)); }
.zn-caps[data-state="verified"]{ border-color:color-mix(in srgb,var(--zn-green) 34%,var(--zn-rule)); }
.zn-caps[data-state="refused"],
.zn-caps[data-state="denied"],
.zn-caps[data-state="blocked"]{ border-color:color-mix(in srgb,var(--zn-red) 40%,var(--zn-rule)); }
.zn-caps[data-state="expired"],
.zn-caps[data-state="unknown"]{ border-color:color-mix(in srgb,var(--zn-amber) 40%,var(--zn-rule)); }

.zn-caps *{ box-sizing:border-box; }
.zn-caps .zn-mono{ font-family:var(--zn-mono); font-variant-numeric:tabular-nums; }

/* focus: a REAL 2px ring at 2px offset. Never a glow. */
.zn-caps :is(button,a,[tabindex]):focus-visible{
  outline:2px solid var(--zn-focus); outline-offset:2px; border-radius:4px;
}
/* §4.8 — Approve is the one control that carries gold: gold = the owner's own
   hand on the decision (owner origin), never a system status. */
.zn-caps .zn-approve:focus-visible{ outline:2px solid var(--zn-gold); outline-offset:2px; }

/* ---- header (always visible while scrolling) ---- */
.zn-caps .zn-head{
  position:sticky; top:0; z-index:2;
  background:var(--zn-g3);
  border-bottom:1px solid var(--zn-rule);
  padding:12px 16px; display:flex; flex-direction:column; gap:8px;
}
/* The title is preview.summary — agent-authored text that can contain a URL or
   a long ref. .zn-caps is overflow:hidden and .zn-head does not scroll, so
   without a break rule an unbroken token is CLIPPED and the owner cannot read
   the sentence they are being asked to approve. */
.zn-caps .zn-title{ font-size:15px; font-weight:600; margin:0; color:var(--zn-ink); overflow-wrap:anywhere; }
.zn-caps .zn-headrow{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; }

/* ---- chips / badges: glyph + label + fill delta (greyscale-safe) ---- */
.zn-caps .zn-chip{
  display:inline-flex; align-items:center; gap:6px;
  font-family:var(--zn-mono); font-size:10.5px; letter-spacing:.02em;
  padding:3px 8px; border-radius:5px;
  border:1px solid var(--zn-rule2); background:var(--zn-g4); color:var(--zn-ink2);
  white-space:nowrap;
}
.zn-caps .zn-chip .zn-gly{ font-size:11px; line-height:1; }
.zn-caps .zn-chip[data-ch="amber"]{ color:var(--zn-amber);
  border-color:color-mix(in srgb,var(--zn-amber) 45%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-amber) 10%,var(--zn-g4)); }
.zn-caps .zn-chip[data-ch="red"]{ color:var(--zn-red);
  border-color:color-mix(in srgb,var(--zn-red) 48%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-red) 12%,var(--zn-g4)); }
.zn-caps .zn-chip[data-ch="cyan"]{ color:var(--zn-cyan);
  border-color:color-mix(in srgb,var(--zn-cyan) 40%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-cyan) 9%,var(--zn-g4)); }
.zn-caps .zn-chip[data-ch="green"]{ color:var(--zn-green);
  border-color:color-mix(in srgb,var(--zn-green) 40%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-green) 10%,var(--zn-g4)); }
.zn-caps .zn-chip[data-ch="gold"]{ color:var(--zn-gold);
  border-color:color-mix(in srgb,var(--zn-gold) 40%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-gold) 9%,var(--zn-g4)); }

/* ---- body ---- */
.zn-caps .zn-body{ overflow:auto; padding:4px 16px 16px; flex:1 1 auto; }
.zn-caps .zn-field{ border-top:1px solid var(--zn-rule); padding:12px 0 4px; }
.zn-caps .zn-field:first-child{ border-top:0; }
.zn-caps .zn-lab{
  display:flex; align-items:baseline; gap:8px;
  font-size:10.5px; letter-spacing:.08em; text-transform:uppercase;
  /* --ink-2, not --ink-3. tokens.css §2 states --ink-3 peaks at 4.15:1 on --g1
     and is "never for information that exists nowhere else". These are the
     capsule's field headings and the §4.5 "n/a — reason" and note lines: they
     are the only place their content appears, so they are text and must clear
     4.5:1. --ink-2 on --g3 measures 6.74:1. */
  color:var(--zn-ink2); margin-bottom:6px;
}
.zn-caps .zn-num{ font-family:var(--zn-mono); color:var(--zn-ink2); }
/* Every one of these carries wire text — summaries, targets, daemon reasons —
   inside .zn-body, which is overflow:auto. Without a break rule one long token
   sets the body's min-content width and the whole capsule scrolls sideways,
   taking the payload and the hash columns with it. */
.zn-caps .zn-val{ color:var(--zn-ink); font-size:13px; overflow-wrap:anywhere; }
.zn-caps .zn-note{ color:var(--zn-ink2); font-size:11.5px; margin-top:6px; overflow-wrap:anywhere; }
.zn-caps .zn-na{ color:var(--zn-ink2); font-family:var(--zn-mono); font-size:11.5px; overflow-wrap:anywhere; }
.zn-caps .zn-na b{ color:var(--zn-ink); font-weight:600; }
.zn-caps .zn-unres{ color:var(--zn-red); font-family:var(--zn-mono); font-size:11.5px; overflow-wrap:anywhere; }

.zn-caps ul.zn-reasons{ margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; }
.zn-caps ul.zn-reasons li{
  display:flex; gap:8px; align-items:flex-start;
  /* The reason text is an anonymous flex item here, so it defaults to
     min-width:auto — one long policy clause with an unbroken ref in it would
     otherwise push .zn-body into a horizontal scroll. */
  min-width:0; overflow-wrap:anywhere;
  font-size:12.5px; color:var(--zn-ink);
  background:var(--zn-g4); border:1px solid var(--zn-rule);
  border-left:2px solid color-mix(in srgb,var(--zn-amber) 60%,var(--zn-rule));
  border-radius:4px; padding:6px 8px;
}
.zn-caps ul.zn-reasons li::before{ content:"\\2192"; color:var(--zn-amber); font-family:var(--zn-mono); }
.zn-caps[data-tier="T4"] ul.zn-reasons li{ border-left-color:color-mix(in srgb,var(--zn-red) 65%,var(--zn-rule)); }
.zn-caps[data-tier="T4"] ul.zn-reasons li::before{ color:var(--zn-red); }

/* ---- hash lines ---- */
.zn-caps .zn-hash{
  font-family:var(--zn-mono); font-size:11.5px; color:var(--zn-ink2);
  word-break:break-all; user-select:text; -webkit-user-select:text;
}
.zn-caps .zn-hashrow{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.zn-caps .zn-tuple{
  display:grid; grid-template-columns:max-content minmax(0,1fr); gap:4px 12px;
  background:var(--zn-g4); border:1px solid var(--zn-rule); border-radius:6px;
  padding:10px 12px; margin-top:4px;
}
.zn-caps .zn-tuple dt{
  font-family:var(--zn-mono); font-size:10.5px; color:var(--zn-ink2); white-space:nowrap;
}
.zn-caps .zn-tuple dd{
  margin:0; font-family:var(--zn-mono); font-size:11.5px; color:var(--zn-ink);
  word-break:break-all; user-select:text; -webkit-user-select:text;
}

/* ---- the payload plane: fully opaque --g2, no glass, ever ---- */
.zn-caps .zn-payload{
  background:var(--zn-g2);
  backdrop-filter:none; -webkit-backdrop-filter:none;
  border:1px solid var(--zn-rule);
  border-radius:6px;
  margin:0; padding:12px 14px;
  max-height:340px; overflow:auto;
  font-family:var(--zn-mono); font-size:12px; line-height:1.6;
  color:var(--zn-ink); white-space:pre-wrap; word-break:break-word;
  user-select:text; -webkit-user-select:text;
  tab-size:2;
}
.zn-caps .zn-payload:focus-visible{ outline:2px solid var(--zn-focus); outline-offset:2px; }

/* ---- small controls ---- */
.zn-caps button{ font:inherit; cursor:pointer; }
.zn-caps .zn-mini{
  font-family:var(--zn-mono); font-size:10.5px; letter-spacing:.02em;
  padding:3px 8px; border-radius:5px;
  border:1px solid var(--zn-rule2); background:var(--zn-g4); color:var(--zn-ink2);
}
.zn-caps .zn-mini:hover{ background:var(--zn-g5); color:var(--zn-ink); }
.zn-caps .zn-mini[data-done="1"]{ color:var(--zn-cyan);
  border-color:color-mix(in srgb,var(--zn-cyan) 45%,var(--zn-rule)); }

/* ---- footer (never scrolls out of reach; controls never move) ---- */
.zn-caps .zn-foot{
  position:sticky; bottom:0; z-index:2;
  background:var(--zn-g3);
  border-top:1px solid var(--zn-rule);
  padding:12px 16px; display:flex; flex-direction:column; gap:10px;
}
.zn-caps .zn-approve{
  display:flex; flex-direction:column; align-items:flex-start; gap:3px;
  width:100%; text-align:left;
  padding:10px 14px; border-radius:7px;
  background:var(--zn-g4);
  border:1px solid color-mix(in srgb,var(--zn-amber) 55%,var(--zn-rule));
  color:var(--zn-amber);
}
.zn-caps .zn-approve .zn-aplab{ font-size:13.5px; font-weight:600; letter-spacing:.01em; }
/* This line is the ONLY place the reason an approval is blocked is written —
   "the payload body is unresolved", "T4 · prohibited", "the action hash does not
   recompute from this binding". At --ink-3 it measured 3.45:1 on the enabled
   button's --g4 and 3.71:1 on the disabled --g3, i.e. below AA for the single
   most consequential sentence in the product. --ink-2 gives 6.26:1 / 6.74:1. */
.zn-caps .zn-approve .zn-apwhy{
  font-family:var(--zn-mono); font-size:10.5px; line-height:1.5; color:var(--zn-ink2);
  overflow-wrap:anywhere;
}
.zn-caps .zn-approve:hover:not(:disabled){ background:var(--zn-g5); }
.zn-caps .zn-approve:disabled{
  cursor:not-allowed;
  color:var(--zn-ink2);
  background:var(--zn-g3);
  border-style:dashed;
  border-color:var(--zn-rule2);
}
.zn-caps .zn-approve[data-blockkind="prohibited"]:disabled{
  color:var(--zn-red);
  border-color:color-mix(in srgb,var(--zn-red) 50%,var(--zn-rule));
  border-style:solid;
}
.zn-caps .zn-absent{
  font-family:var(--zn-mono); font-size:10.5px; line-height:1.6; color:var(--zn-ink2);
  overflow-wrap:anywhere;
}

/* ---- committing: a determinate two-step strip, bound to the real attempt.
       No spinner. No perpetual loop. No fabricated progress. ---- */
.zn-caps .zn-steps{ display:flex; gap:4px; margin-top:2px; }
.zn-caps .zn-step{
  flex:1 1 0; height:4px; border-radius:2px;
  background:var(--zn-g5); border:1px solid var(--zn-rule);
}
.zn-caps .zn-step[data-on="1"]{ background:var(--zn-cyan); border-color:var(--zn-cyan); }
.zn-caps .zn-step[data-on="1"][data-ch="green"]{ background:var(--zn-green); border-color:var(--zn-green); }
.zn-caps .zn-step[data-on="1"][data-ch="red"]{ background:var(--zn-red); border-color:var(--zn-red); }
.zn-caps .zn-step[data-on="1"][data-ch="amber"]{ background:var(--zn-amber); border-color:var(--zn-amber); }
.zn-caps .zn-steplab{ font-family:var(--zn-mono); font-size:10.5px; color:var(--zn-ink2); margin-top:6px; }

/* ---- outcome blocks ---- */
.zn-caps .zn-outcome{
  border:1px solid var(--zn-rule); border-radius:7px;
  padding:12px 14px; background:var(--zn-g4);
}
.zn-caps .zn-outcome[data-ch="cyan"]{
  border-color:color-mix(in srgb,var(--zn-cyan) 34%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-cyan) 6%,var(--zn-g4)); }
.zn-caps .zn-outcome[data-ch="green"]{
  border-color:color-mix(in srgb,var(--zn-green) 38%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-green) 7%,var(--zn-g4)); }
.zn-caps .zn-outcome[data-ch="red"]{
  border-color:color-mix(in srgb,var(--zn-red) 44%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-red) 8%,var(--zn-g4)); }
.zn-caps .zn-outcome[data-ch="amber"]{
  border-color:color-mix(in srgb,var(--zn-amber) 44%,var(--zn-rule));
  background:color-mix(in srgb,var(--zn-amber) 8%,var(--zn-g4)); }
.zn-caps .zn-seal{
  display:flex; align-items:center; gap:8px;
  font-family:var(--zn-mono); font-size:12.5px; font-weight:600;
  color:var(--zn-green); margin-bottom:8px;
}
.zn-caps .zn-seal[data-ch="red"]{ color:var(--zn-red); }
.zn-caps .zn-seal[data-ch="amber"]{ color:var(--zn-amber); }
/* the seal is the LAST thing that renders, and only from a receipt */
.zn-caps .zn-seal.zn-draw{ animation:zn-seal .34s ease-out both; }
@keyframes zn-seal{ from{opacity:0;transform:translateY(2px)} to{opacity:1;transform:none} }

.zn-caps .zn-kv{
  display:grid; grid-template-columns:max-content minmax(0,1fr); gap:3px 12px;
  font-family:var(--zn-mono); font-size:11px; line-height:1.65;
}
/* dt --ink-2 / dd --ink, matching .zn-tuple and .zn-drift: the key is the label
   and the value is the fact. Both were below AA before (dt at --ink-3), and the
   pair keeps its hierarchy without either dropping under 4.5:1. */
.zn-caps .zn-kv dt{ color:var(--zn-ink2); white-space:nowrap; }
.zn-caps .zn-kv dd{ margin:0; color:var(--zn-ink); word-break:break-all;
  user-select:text; -webkit-user-select:text; }

.zn-caps .zn-drift{
  display:grid; grid-template-columns:max-content minmax(0,1fr); gap:6px 12px;
  background:var(--zn-g2); border:1px solid var(--zn-rule); border-radius:6px;
  padding:10px 12px; margin:8px 0;
}
.zn-caps .zn-drift dt{ font-family:var(--zn-mono); font-size:10.5px; color:var(--zn-ink2); white-space:nowrap; }
.zn-caps .zn-drift dd{ margin:0; font-family:var(--zn-mono); font-size:11.5px; color:var(--zn-ink);
  word-break:break-all; user-select:text; -webkit-user-select:text; }
.zn-caps .zn-nothing{
  font-size:13px; font-weight:600; color:var(--zn-ink);
  display:flex; align-items:center; gap:8px; margin:8px 0 4px;
}
.zn-caps .zn-repreview{
  margin-top:10px; padding:8px 12px; border-radius:6px;
  background:var(--zn-g5); border:1px solid var(--zn-rule2); color:var(--zn-ink);
  font-size:12.5px;
}
.zn-caps .zn-repreview:hover{ background:var(--zn-g6); }

/* one animation, one real state; honour the OS and the prototype's own flag */
@media (prefers-reduced-motion:reduce){ .zn-caps *{ animation:none!important; transition:none!important } }
:root[data-reduce="1"] .zn-caps *{ animation:none!important; transition:none!important }

@media (max-width:560px){
  .zn-caps .zn-tuple,.zn-caps .zn-kv,.zn-caps .zn-drift{ grid-template-columns:minmax(0,1fr); }
}
`;

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------- *
 * 4 · reusable pieces                    *
 * ------------------------------------- */

let uid = 0;
const nextId = () => `zn-${Date.now().toString(36)}-${++uid}`;

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
function copyBtn(label, getText, aria) {
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

function chip(glyph, label, channel, title) {
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
function field(num, label, ...content) {
  const f = el('section', 'zn-field');
  f.dataset.specField = String(num);
  const lab = el('div', 'zn-lab');
  add(lab, el('span', null, label));
  add(f, lab, ...content);
  return f;
}

/** §4.5 — a field that does not apply renders `n/a` WITH A REASON, never blank. */
function na(reason) {
  const d = el('div', 'zn-na');
  add(d, el('b', null, 'n/a'), document.createTextNode(' — ' + reason));
  return d;
}

/** §4.5 — a field that cannot be resolved renders `unresolved` and blocks Approve. */
function unresolved(reason) {
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

function tierBadge(preview) {
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

/* ------------------------------------------------------------------ *
 * 5 · renderCapsule                                                   *
 * ------------------------------------------------------------------ */

/**
 * @param {object} preview  a Preview from GET /state or the "preview" SSE event
 * @param {object} [opts]
 *   payload       {unknown}  the exact payload value. Presence checked with `in`.
 *   payloadText   {string}   pre-serialised exact bytes (preferred when the daemon
 *                            has the literal bytes rather than the parsed value).
 *   expiresAt     {string}   ISO-8601 — drives the live countdown when present.
 *   approvalTtlMs {number}   World.approvalTtlMs, for an honest expiry statement
 *                            when no clock is running yet.
 *   ownerToken    {string}   sent as `x-zeno-token`. Falls back to the daemon's
 *                            <meta name="zeno-token"> injection.
 *   endpoint      {string}   default '/approvals'
 *   onApprove     {function} async (preview) => {approval, receipt} — overrides the fetch.
 *   onRePreview   {function} (info) => void — also emitted as a 'zeno:re-preview' event.
 * @returns {HTMLElement} with .applyReceipt(receipt) and .destroy()
 */
export function renderCapsule(preview, opts = {}) {
  ensureStyles();

  const root = el('section', 'zn-caps');
  const titleId = nextId();
  root.setAttribute('role', 'group');
  root.setAttribute('aria-labelledby', titleId);
  root.dataset.actionHash = String(preview?.actionHash ?? '');
  root.dataset.tier = String(preview?.tier ?? '');
  root.dataset.state = preview?.denied ? 'blocked' : preview?.auto ? 'auto' : 'awaiting';

  const binding = preview?.binding || {};
  const endpoint = opts.endpoint || '/approvals';

  /* ---- blocker ledger: the completeness rule, enforced ---- */
  const blockers = new Map(); // id -> {text, kind}
  let spent = false; // L-ONCE: latched forever on the first click
  let timer = null;
  // The body is built before the footer, so blockers raised during construction
  // must only be RECORDED; the control they disable does not exist yet. It is
  // synced once at the end, and live from then on.
  let approveReady = false;

  function addBlocker(id, text, kind) {
    blockers.set(id, { text, kind: kind || 'incomplete' });
    if (approveReady) syncApprove();
  }
  function clearBlocker(id) {
    if (blockers.delete(id) && approveReady) syncApprove();
  }

  /* ================= HEADER ================= */
  const head = el('header', 'zn-head');
  const title = el('h2', 'zn-title', preview?.summary || '(this preview carries no summary)');
  title.id = titleId;

  const headRow = el('div', 'zn-headrow');
  const kindChip = chip('■', String(binding.kind ?? 'unknown-kind'), null, 'Action kind, from the binding');
  const hashChip = el('span', 'zn-chip');
  hashChip.dataset.ch = 'gold'; // gold = owner origin: this is the identity you are being asked to sign
  add(
    hashChip,
    el('span', 'zn-gly', '#'),
    el('span', 'zn-mono', truncHash(preview?.actionHash)),
  );
  hashChip.title = String(preview?.actionHash ?? '');
  hashChip.setAttribute('aria-label', `action hash ${preview?.actionHash ?? 'missing'}`);

  const countdownChip = el('span', 'zn-chip');
  add(countdownChip, el('span', 'zn-gly', '◷'), el('span', 'zn-mono', '—'));
  const countdownVal = countdownChip.lastChild;

  add(
    headRow,
    tierBadge(preview || {}),
    kindChip,
    hashChip,
    copyBtn('copy hash', () => preview?.actionHash ?? '', 'copy the full action hash'),
    countdownChip,
  );
  add(head, title, headRow);

  /* ================= BODY ================= */
  const body = el('div', 'zn-body');

  /* --- 1 · What will happen --- */
  const whatVal = el('div', 'zn-val', preview?.summary || '');
  const what = field(1, 'What will happen', whatVal);
  if (!preview?.summary) {
    what.replaceChild(
      unresolved('this preview carried no summary sentence. You cannot approve a sentence nobody wrote.'),
      whatVal,
    );
    addBlocker('summary', 'no summary sentence in this preview');
  } else {
    add(
      what,
      el(
        'div',
        'zn-note',
        'This exact sentence is hashed into provenanceHash, so a receipt can never record wording you did not see. It states what the kernel will attempt — not what the provider will guarantee.',
      ),
    );
  }
  add(body, what);

  /* --- 2 · Action identity --- */
  const idRow = el('div', 'zn-hashrow');
  const idFull = el('code', 'zn-hash', String(preview?.actionHash ?? ''));
  const idShort = el('code', 'zn-hash zn-mono', truncHash(preview?.actionHash));
  idFull.hidden = true;
  const idToggle = el('button', 'zn-mini', 'show full');
  idToggle.type = 'button';
  idToggle.setAttribute('aria-expanded', 'false');
  idToggle.addEventListener('click', () => {
    const showing = !idFull.hidden;
    idFull.hidden = showing;
    idShort.hidden = !showing;
    idToggle.textContent = showing ? 'show full' : 'truncate';
    idToggle.setAttribute('aria-expanded', String(!showing));
  });
  add(idRow, idShort, idFull, idToggle, copyBtn('copy', () => preview?.actionHash ?? ''));

  const identityCheck = el('div', 'zn-hashrow');
  const identityChip = chip('◌', 'identity · checking…', null, 'recomputing sha256(canonicalJSON(binding))');
  add(identityCheck, identityChip);

  add(
    body,
    field(
      2,
      'Action identity',
      idRow,
      identityCheck,
      na(
        'version, originating product and originating run are not carried. This kernel has no version counter: identity IS the hash, so any change to payload, base, target, kind or tier is a different action hash, not a new version of this one. The originating agent rides inside provenanceHash and is not transmitted.',
      ),
    ),
  );

  /* --- 3 · Risk tier + WHY (a tier without its reason is forbidden) --- */
  const reasons = Array.isArray(preview?.reasons) ? preview.reasons : [];
  let whyNode;
  if (reasons.length === 0) {
    whyNode = unresolved(
      'this preview carried a tier with no reason. §4.5 field 3 forbids a tier without the clause that determined it.',
    );
    addBlocker('reasons', 'tier carries no reason');
  } else {
    whyNode = el('ul', 'zn-reasons');
    for (const r of reasons) add(whyNode, el('li', null, String(r)));
  }
  const tierRow = el('div', 'zn-hashrow');
  add(tierRow, tierBadge(preview || {}));
  add(body, field(3, 'Risk tier — and why', tierRow, whyNode));

  /* --- 4 · Target --- */
  const targetRow = el('div', 'zn-hashrow');
  add(
    targetRow,
    el('code', 'zn-hash', String(binding.targetRef ?? '')),
    copyBtn('copy', () => binding.targetRef ?? ''),
  );
  const targetField = field(4, 'Target', targetRow);
  if (!binding.targetRef) {
    targetField.replaceChild(
      unresolved('the binding carries no targetRef, so what would be written cannot be named.'),
      targetRow,
    );
    addBlocker('target', 'binding carries no targetRef');
  } else {
    add(
      targetField,
      na(
        'provider, account/workspace, acting identity and region are not carried. The kernel binds to one opaque targetRef (repo@HEAD, ticket@version, resource@etag); no executor slice in this build supplies an account or a region. Nothing here means "your account" — read the ref.',
      ),
    );
  }
  add(body, targetField);

  /* --- 6 · Payload body: the complete exact payload, opaque --g2 plane --- */
  const payloadField = field(6, 'The exact change it will write');
  const hasText = typeof opts.payloadText === 'string';
  const hasValue = Object.prototype.hasOwnProperty.call(opts, 'payload');
  let payloadText = null;
  let payloadOrigin = null;

  if (hasText) {
    payloadText = opts.payloadText;
    payloadOrigin = 'The exact bytes, as supplied by the daemon.';
  } else if (hasValue) {
    const p = opts.payload;
    if (typeof p === 'string') {
      payloadText = p;
      payloadOrigin = 'The exact string value carried by the preview.';
    } else if (p === undefined) {
      payloadText = 'undefined';
      payloadOrigin =
        'The preview carries the literal value `undefined` as its payload. That is what the kernel hashed.';
    } else {
      payloadText = JSON.stringify(p, null, 2);
      payloadOrigin =
        'Rendered from the preview’s payload value as indented JSON. Indentation and key order are for reading only — the bound bytes are the canonical form, and the check above recomputes that form and compares it to payloadHash.';
    }
  }

  if (payloadText === null) {
    add(
      payloadField,
      unresolved(
        'this preview did not carry the payload. The daemon does serve one — GET /state and the "preview" event both send the payload alongside each Preview — so its absence here means this preview reached the page without it.',
      ),
      el(
        'div',
        'zn-note',
        'Resolve: check that the daemon serving this window is a build whose /state and "preview" event carry the payload beside each Preview, and that it was passed to renderCapsule as opts.payload (or opts.payloadText). Until the bytes are here this capsule refuses rather than guesses — there is no configuration that approves an unseen payload.',
      ),
    );
    addBlocker('payload', 'the payload body is unresolved — nothing here shows what would be sent');
  } else {
    const pre = el('pre', 'zn-payload', payloadText);
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'the complete exact payload');
    const prow = el('div', 'zn-hashrow');
    const payloadChip = chip('◌', 'payload hash · checking…', null, 'recomputing sha256(canonicalJSON(payload))');
    add(prow, payloadChip, copyBtn('copy payload', () => payloadText));
    add(payloadField, pre, prow, el('div', 'zn-note', payloadOrigin));

    // Verify the bytes on screen actually hash to the bound payloadHash.
    verifyHash(
      hasText ? null : opts.payload,
      hasText ? payloadText : null,
      binding.payloadHash,
      payloadChip,
      'payload hash',
      'payload',
      'the bytes rendered above do not hash to the payloadHash in the binding — what you are reading is not what would be sent',
    );
  }
  add(body, payloadField);

  /* --- 15 · Approval binding: the full bound tuple, mono and copyable --- */
  const tuple = el('dl', 'zn-tuple');
  const TUPLE_KEYS = ['payloadHash', 'baseHash', 'targetRef', 'kind', 'tier', 'provenanceHash'];
  let tupleComplete = true;
  for (const k of TUPLE_KEYS) {
    const v = binding[k];
    add(tuple, el('dt', null, k));
    if (v === undefined || v === null || v === '') {
      tupleComplete = false;
      const dd = el('dd', null);
      add(dd, unresolved('missing from the binding'));
      add(tuple, dd);
    } else {
      add(tuple, el('dd', null, String(v)));
    }
  }
  if (!tupleComplete) addBlocker('tuple', 'the approval binding tuple is incomplete');

  const tupleRow = el('div', 'zn-hashrow');
  add(
    tupleRow,
    copyBtn('copy tuple', () => canonicalJSON(pickTuple(binding)), 'copy the bound tuple as canonical JSON'),
    copyBtn('copy hash', () => preview?.actionHash ?? ''),
  );
  add(
    body,
    field(
      15,
      'Exactly what you are approving',
      tuple,
      tupleRow,
      el(
        'div',
        'zn-note',
        'The action hash is sha256 over the canonical JSON of exactly this tuple — the check in field 2 recomputes it here, in your browser, so the hash is one you can compare rather than one you must trust. provenanceHash covers the proposing agent, the summary sentence, the provenance record and the policy hash; those inputs are hashed, not transmitted, so they cannot be read back out of it.',
      ),
    ),
  );

  /* --- 16 · Expiry --- */
  const expiresAt = typeof opts.expiresAt === 'string' ? Date.parse(opts.expiresAt) : NaN;
  const expiryField = field(16, 'Expiry');
  if (!Number.isNaN(expiresAt)) {
    const abs = el('div', 'zn-val zn-mono', fmtAbsolute(expiresAt));
    const live = el('div', 'zn-hashrow');
    const liveChip = el('span', 'zn-chip');
    liveChip.dataset.ch = 'amber';
    add(liveChip, el('span', 'zn-gly', '◷'), el('span', 'zn-mono', '—'));
    const liveVal = liveChip.lastChild;
    add(live, liveChip, el('span', 'zn-na', 'single-use · short-lived'));
    add(expiryField, abs, live);

    const tick = () => {
      const left = expiresAt - Date.now();
      const text = left > 0 ? fmtCountdown(left) + ' left' : 'expired';
      liveVal.textContent = text;
      countdownVal.textContent = text;
      liveChip.setAttribute('aria-label', `expiry ${text}`);
      countdownChip.setAttribute('aria-label', `expiry ${text}`);
      if (left <= 0) {
        stopTimer();
        liveChip.dataset.ch = 'amber';
        if (root.dataset.state === 'awaiting') root.dataset.state = 'expired';
        addBlocker(
          'expired',
          `Expired at ${fmtClock(new Date(expiresAt).toISOString())}; re-preview to decide again.`,
          'expired',
        );
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  } else {
    countdownVal.textContent = 'no clock';
    countdownChip.setAttribute('aria-label', 'expiry: no clock is running on this preview');
    const ttl = typeof opts.approvalTtlMs === 'number' ? opts.approvalTtlMs : null;
    add(
      expiryField,
      na(
        ttl === null
          ? 'no expiry clock runs on a preview in this kernel, and /state does not expose the approval TTL. The approval this capsule requests is single-use and is created at the moment you approve; it expires on the kernel’s own TTL, which is checked at commit.'
          : `no expiry clock runs on a preview in this kernel. The approval is created at the moment you approve and is single-use, living ${Math.round(
              ttl / 1000,
            )}s from then (World.approvalTtlMs); the kernel re-checks it at commit and writes an "expired" receipt if it has lapsed.`,
      ),
    );
  }
  add(body, expiryField);

  /* ================= FOOTER ================= */
  const foot = el('footer', 'zn-foot');
  const outcomeSlot = el('div', 'zn-outcomeslot');
  outcomeSlot.setAttribute('aria-live', 'polite');

  const approve = el('button', 'zn-approve');
  approve.type = 'button';
  const apLab = el('span', 'zn-aplab', '✓  Approve this exact hash');
  const apWhy = el('span', 'zn-apwhy', '');
  const whyId = nextId();
  apWhy.id = whyId;
  add(approve, apLab, apWhy);
  approve.setAttribute('aria-describedby', whyId);

  const absent = el(
    'div',
    'zn-absent',
    'Edit · Regenerate · Explain · Open source · Deny · Snooze · Dismiss · Do-not-draft-similar are not present in this slice: the only write the daemon offers this window is POST /approvals, and none of these map onto it. They are absent rather than shown inert — a control that cannot act is a lie about what is available.',
  );

  add(foot, outcomeSlot, approve, absent);

  /* ---- Approve state, recomputed from the blocker ledger ---- */
  function syncApprove() {
    if (spent) return; // once spent, nothing re-enables it
    // Fixed precedence: prohibited > auto > incomplete > expired.
    const denied = !!preview?.denied || preview?.tier === 'T4';
    if (denied) {
      approve.disabled = true;
      approve.dataset.blockkind = 'prohibited';
      apLab.textContent = '✕  Approve — unavailable';
      apWhy.textContent =
        'T4 · prohibited. There is no path to approve this action, and no setting that creates one. ' +
        (reasons.length ? reasons.join(' · ') : '');
      return;
    }
    if (preview?.auto || preview?.tier === 'T0') {
      approve.disabled = true;
      approve.dataset.blockkind = 'auto';
      apLab.textContent = '○  Approve — not owed';
      apWhy.textContent =
        'T0 · auto. Policy owes you no decision on this action, and clicking would grant nothing. It is still ' +
        'listed because the daemon is still holding it: this build commits only through POST /approvals, so an ' +
        'auto action waits here rather than committing on its own.';
      return;
    }
    if (blockers.size > 0) {
      const list = [...blockers.values()];
      const expired = list.find((b) => b.kind === 'expired');
      approve.disabled = true;
      approve.dataset.blockkind = expired ? 'expired' : 'incomplete';
      apLab.textContent = expired ? '◷  Approve — expired' : '▲  Approve — blocked';
      apWhy.textContent = expired
        ? `${expired.text} An approval must never outlive the preview it was taken on.`
        : `The preview is incomplete: ${list.map((b) => b.text).join(' · ')}. ` +
          'There is no expert mode and no toggle that approves over this.';
      return;
    }
    approve.disabled = false;
    approve.dataset.blockkind = 'ready';
    apLab.textContent = '✓  Approve this exact hash';
    apWhy.textContent = `single use · one attempt · bound to ${truncHash(preview?.actionHash)}`;
  }

  /* ---- committing: two truthful steps, no fabricated progress ---- */
  function renderCommitting() {
    outcomeSlot.textContent = '';
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'cyan';
    const strip = el('div', 'zn-steps');
    const s1 = el('div', 'zn-step');
    const s2 = el('div', 'zn-step');
    s1.dataset.on = '1';
    add(strip, s1, s2);
    const lab = el('div', 'zn-steplab', 'attempt 1 of 1 · request sent · awaiting receipt');
    add(box, strip, lab);
    add(outcomeSlot, box);
    root.dataset.state = 'committing';
    return {
      settle(channel, text) {
        s2.dataset.on = '1';
        s2.dataset.ch = channel;
        s1.dataset.ch = channel;
        lab.textContent = text;
      },
    };
  }

  /* ---- the seal: rendered only from a receipt, and only at the end ---- */
  function applyReceipt(receipt) {
    if (!receipt) return;
    // L-SEAL. A receipt seals THIS capsule only if it is provably about this
    // action. A receipt that carries no actionHash at all proves nothing about
    // any particular action, so it may not draw a seal here either — the old
    // guard let it through, and a missing hash is exactly the case where an
    // optimistic green would be indistinguishable from a proven one.
    if (preview?.actionHash && receipt.actionHash !== preview.actionHash) return;
    stopTimer();
    spent = true;
    approve.disabled = true;

    // Tell the window a receipt landed on this capsule, so the page can move it
    // out of "awaiting your decision" — a capsule showing a receipt is settled,
    // and leaving it in the pending group would be a lie about what is owed.
    // The window listens for this; nothing here depends on anyone doing so.
    try {
      root.dispatchEvent(
        new CustomEvent('zeno:receipt', { detail: { receipt }, bubbles: true }),
      );
    } catch {
      /* a listener that throws must never stop the receipt from rendering */
    }

    outcomeSlot.textContent = '';
    const outcome = receipt.outcome;

    if (outcome === 'verified') {
      root.dataset.state = 'verified';
      approve.dataset.blockkind = 'used';
      apLab.textContent = '✓  Approved — already used';
      apWhy.textContent = 'single-use: this approval is spent. A second commit on it is not permitted.';
      const box = el('div', 'zn-outcome');
      box.dataset.ch = 'green';
      const seal = el('div', 'zn-seal zn-draw');
      add(
        seal,
        el('span', null, '✓'),
        el('span', null, `verified · ${fmtClock(receipt.at)}`),
      );
      const kv = kvList();
      kvAdd(kv, 'receipt id', receipt.id);
      kvAdd(kv, 'external effect', receipt.externalEffect?.effect ?? '(none recorded)');
      kvAdd(kv, 'base observed', receipt.casBaseObserved);
      kvAdd(kv, 'self hash', receipt.selfHash);
      kvAdd(kv, 'prev receipt', receipt.prevReceipt ?? 'null · genesis entry');
      kvAdd(kv, 'policy hash', receipt.policyHash);
      add(box, seal, kv);
      add(outcomeSlot, box);
      return;
    }

    if (outcome === 'refused') {
      root.dataset.state = 'refused';
      approve.dataset.blockkind = 'refused';
      apLab.textContent = '✕  Refused — nothing was applied';
      apWhy.textContent = 'the base drifted between your preview and the commit. Re-preview to decide against what is actually there.';
      add(outcomeSlot, refusedBlock(receipt, preview, opts, root));
      return;
    }

    const map = {
      denied: {
        ch: 'red',
        glyph: '✕',
        label: 'denied',
        note: 'A recorded decision, not a dismissal. It is in the ledger with its reason.',
        state: 'denied',
      },
      expired: {
        ch: 'amber',
        glyph: '◷',
        label: 'expired',
        note: 'The approval lapsed before commit. Nothing was applied. Re-preview to decide again.',
        state: 'expired',
      },
      'outcome-unknown': {
        ch: 'amber',
        glyph: '▲',
        label: 'outcome unknown',
        note: 'The attempt happened and its result cannot be proven. Retry is FROZEN: a blind retry here is how a double-send is made. Inspect the provider directly, reconcile, or prepare a new action.',
        state: 'unknown',
      },
    };
    const m = map[outcome] || {
      ch: 'amber',
      glyph: '▲',
      label: String(outcome ?? 'unrecognised outcome'),
      note: 'This outcome is not one this UI knows how to render. Treat it as unresolved and inspect the ledger.',
      state: 'unknown',
    };
    root.dataset.state = m.state;
    apLab.textContent = `${m.glyph}  ${m.label}`;
    apWhy.textContent = receipt.reason || m.note;

    const box = el('div', 'zn-outcome');
    box.dataset.ch = m.ch;
    const seal = el('div', 'zn-seal zn-draw');
    seal.dataset.ch = m.ch;
    add(seal, el('span', null, m.glyph), el('span', null, `${m.label} · ${fmtClock(receipt.at)}`));
    const kv = kvList();
    kvAdd(kv, 'reason', receipt.reason ?? '(none recorded)');
    kvAdd(kv, 'external effect', receipt.externalEffect?.effect ?? '(none recorded)');
    kvAdd(kv, 'receipt id', receipt.id);
    kvAdd(kv, 'base observed', receipt.casBaseObserved);
    kvAdd(kv, 'self hash', receipt.selfHash);
    add(box, seal, el('div', 'zn-note', m.note), kv);
    add(outcomeSlot, box);
  }

  /* ---- the one write in this module ---- */
  approve.addEventListener('click', async () => {
    // L-ONCE, in this exact order: latch, then disable, then anything async.
    if (spent) return;
    if (approve.disabled) return;
    spent = true;
    approve.disabled = true;
    approve.dataset.blockkind = 'used';
    apLab.textContent = '◷  Approving — spent';
    apWhy.textContent = 'this control is single-use and is now permanently spent.';
    stopTimer();

    const step = renderCommitting();

    try {
      let result;
      if (typeof opts.onApprove === 'function') {
        result = await opts.onApprove(preview);
      } else {
        const token = opts.ownerToken ?? readMetaToken();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-zeno-token': token } : {}),
          },
          body: JSON.stringify({ actionHash: preview.actionHash }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const e = data && data.error ? data.error : {};
          // 4xx and 409 are decided BEFORE the executor runs: postApproval
          // returns 400/401/403/404 before it calls the kernel at all, and the
          // only PolicyError paths that reach 409 are approve() and commit()'s
          // pre-exec checks. For those, "nothing was applied" is provably true.
          //
          // 5xx is NOT. The kernel writes the verified receipt deliberately
          // OUTSIDE the executor's catch, so a failure to RECORD a real effect
          // throws — and that throw arrives here as 500 `internal`. That is the
          // one response shape that means the effect may have happened and the
          // ledger did not capture it. Calling it "refused · nothing applied"
          // would be R1 run backwards: a terminal claim with no receipt behind
          // it. It is outcome-unknown, which is amber, and retry stays frozen.
          if (res.status >= 500) {
            step.settle('amber', `attempt 1 of 1 · no receipt · ${res.status}`);
            renderUnknown(
              `The daemon answered ${res.status} ${e.code || 'internal'} and returned no receipt${
                e.message ? `: ${e.message}` : '.'
              } An effect may or may not have been applied — the receipt that would say is exactly what is missing.${
                e.resolve ? ` ${e.resolve}` : ''
              }`,
            );
            return;
          }
          step.settle('red', `attempt 1 of 1 · refused by the daemon · ${res.status}`);
          renderPolicyError(e, res.status);
          return;
        }
        result = data;
      }
      const receipt = result && typeof result === 'object' ? result.receipt : null;
      if (!receipt || typeof receipt !== 'object') {
        step.settle('amber', 'attempt 1 of 1 · no receipt in the response');
        renderUnknown(
          'The daemon answered without a receipt. Nothing here can say whether an effect occurred.',
        );
      } else if (preview?.actionHash && receipt.actionHash !== preview.actionHash) {
        // The strip must not go green on a receipt that is not about this
        // action: applyReceipt would (correctly) refuse to draw the seal, and a
        // green bar over a capsule with no outcome is the exact optimism this
        // component exists to refuse.
        step.settle('amber', 'attempt 1 of 1 · receipt does not match this action');
        renderUnknown(
          `The daemon answered with a receipt carrying ${
            receipt.actionHash ? 'a different action hash' : 'no action hash at all'
          }, so it proves nothing about this one. Whether this action had an effect is unknown.`,
        );
      } else {
        step.settle(
          receipt.outcome === 'verified' ? 'green' : receipt.outcome === 'refused' ? 'red' : 'amber',
          `attempt 1 of 1 · receipt received`,
        );
        applyReceipt(receipt);
      }
    } catch (err) {
      // The request left this machine and no receipt came back. That is
      // outcome-unknown, not failure, and retry is frozen.
      step.settle('amber', 'attempt 1 of 1 · no receipt');
      renderUnknown(
        `The request left this machine and no receipt returned (${
          err && err.message ? err.message : 'network error'
        }). Whether an effect occurred is unknown.`,
      );
    }
  });

  function renderPolicyError(e, status) {
    root.dataset.state = 'blocked';
    approve.dataset.blockkind = 'prohibited';
    apLab.textContent = '✕  Refused by policy';
    apWhy.textContent = `${e.code || status} · ${e.message || 'no message supplied'}`;
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'red';
    const seal = el('div', 'zn-seal');
    seal.dataset.ch = 'red';
    add(seal, el('span', null, '✕'), el('span', null, `blocked · ${e.code || `http ${status}`}`));
    const kv = kvList();
    kvAdd(kv, 'message', e.message ?? '(none)');
    kvAdd(kv, 'resolve', e.resolve ?? '(the daemon supplied no resolution)');
    add(
      box,
      seal,
      el('div', 'zn-note', 'No approval was issued and nothing was applied. This control stays spent — decide again on a fresh preview.'),
      kv,
      rePreviewBtn(preview, opts, root),
    );
    add(outcomeSlot, box);
  }

  function renderUnknown(text) {
    root.dataset.state = 'unknown';
    approve.dataset.blockkind = 'used';
    apLab.textContent = '▲  Outcome unknown — retry frozen';
    apWhy.textContent = text;
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'amber';
    const seal = el('div', 'zn-seal');
    seal.dataset.ch = 'amber';
    add(seal, el('span', null, '▲'), el('span', null, 'outcome unknown'));
    add(
      box,
      seal,
      el('div', 'zn-note', text),
      el(
        'div',
        'zn-note',
        'Retry is frozen deliberately: a second attempt is how one action becomes two effects. Inspect the provider directly, reconcile, or prepare a new action.',
      ),
    );
    add(outcomeSlot, box);
  }

  /* ---- browser-side hash verification (field 2 and field 6) ---- */
  function verifyHash(value, text, expected, chipEl, label, blockerId, mismatchText) {
    if (!expected) {
      chipEl.dataset.ch = '';
      chipEl.lastChild.textContent = `${label} · n/a — the binding carries no hash to compare`;
      chipEl.firstChild.textContent = '○';
      return;
    }
    if (!SUBTLE) {
      chipEl.dataset.ch = '';
      chipEl.firstChild.textContent = '○';
      chipEl.lastChild.textContent = `${label} · unchecked — no SubtleCrypto in this context`;
      chipEl.title =
        'The browser exposes crypto.subtle only in a secure context. Served over http from a non-localhost origin, this comparison cannot run. That is an environment limit, not a mismatch — it does not block approval, and it does not confirm anything either.';
      return;
    }
    if (text !== null && text !== undefined) {
      // Raw bytes: the kernel hashes the canonical form of a VALUE, so a
      // pre-serialised string cannot be compared without guessing. Say so.
      chipEl.dataset.ch = '';
      chipEl.firstChild.textContent = '○';
      chipEl.lastChild.textContent = `${label} · n/a — supplied as text, not as the value the kernel hashed`;
      chipEl.title =
        'payloadHash is sha256 over the canonical JSON of the payload VALUE. Given pre-serialised text, this UI cannot reconstruct that canonical form without guessing, and it will not guess. Pass opts.payload to enable the comparison.';
      return;
    }
    // The check is genuinely in flight; Approve stays blocked until it lands.
    addBlocker(blockerId + '-pending', `the ${label} check is still running`);
    sha256Hex(canonicalJSON(value))
      .then((computed) => {
        clearBlocker(blockerId + '-pending');
        if (computed === expected) {
          chipEl.dataset.ch = 'cyan';
          chipEl.firstChild.textContent = '≡';
          chipEl.lastChild.textContent = `${label} · matches the binding`;
          chipEl.title = `recomputed sha256(canonicalJSON(…)) = ${computed}`;
          clearBlocker(blockerId + '-hash');
        } else {
          chipEl.dataset.ch = 'red';
          chipEl.firstChild.textContent = '≠';
          chipEl.lastChild.textContent = `${label} · MISMATCH`;
          chipEl.title = `expected ${expected}\nrecomputed ${computed}`;
          addBlocker(blockerId + '-hash', mismatchText);
        }
      })
      .catch(() => {
        clearBlocker(blockerId + '-pending');
        chipEl.dataset.ch = '';
        chipEl.firstChild.textContent = '○';
        chipEl.lastChild.textContent = `${label} · unchecked — the digest could not be computed`;
      });
  }

  // Field 2's own check: does the action hash actually hash from this binding?
  // A preview with no actionHash has no identity to approve at all: the chip
  // must not sit at "checking…" forever (a check that will never land reads as
  // one still in flight), and Approve must be blocked — POSTing
  // {"actionHash": undefined} is a request the owner never authorised.
  if (!preview?.actionHash) {
    identityChip.dataset.ch = 'red';
    identityChip.firstChild.textContent = '▲';
    identityChip.lastChild.textContent = 'identity · unresolved — this preview carries no action hash';
    identityChip.title =
      'POST /approvals is bound to one actionHash. This preview does not carry one, so there is no identity to approve and nothing to compare.';
    addBlocker('actionhash', 'this preview carries no action hash, so there is no identity to approve');
  } else if (tupleComplete) {
    addBlocker('identity-pending', 'the action-hash check is still running');
    sha256Hex(canonicalJSON(pickTuple(binding)))
      .then((computed) => {
        clearBlocker('identity-pending');
        if (computed === preview.actionHash) {
          identityChip.dataset.ch = 'cyan';
          identityChip.firstChild.textContent = '≡';
          identityChip.lastChild.textContent = 'identity · hash recomputed from the tuple, and it matches';
          identityChip.title = `sha256(canonicalJSON(binding)) = ${computed}`;
        } else {
          identityChip.dataset.ch = 'red';
          identityChip.firstChild.textContent = '≠';
          identityChip.lastChild.textContent = 'identity · MISMATCH';
          identityChip.title = `action hash ${preview.actionHash}\nrecomputed  ${computed}`;
          addBlocker(
            'identity',
            'the action hash does not recompute from this binding — the preview is not internally consistent',
          );
        }
      })
      .catch(() => {
        clearBlocker('identity-pending');
        identityChip.dataset.ch = '';
        identityChip.firstChild.textContent = '○';
        identityChip.lastChild.textContent = SUBTLE
          ? 'identity · unchecked — the digest could not be computed'
          : 'identity · unchecked — no SubtleCrypto in this context';
      });
  } else {
    // The tuple is incomplete, so the hash cannot be recomputed. The glyph moves
    // off '◌' as well as the words: a spinner-shaped glyph left behind on a
    // check that will never run reads as one still in flight.
    identityChip.firstChild.textContent = '○';
    identityChip.lastChild.textContent = 'identity · uncheckable — the binding tuple is incomplete';
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  approveReady = true;
  syncApprove();
  add(root, head, body, foot);

  root.applyReceipt = applyReceipt;
  root.destroy = stopTimer;
  return root;
}

/* ------------------------------------------------------------------ *
 * 6 · renderRefused — the drift-refused state                         *
 * ------------------------------------------------------------------ */

/**
 * Compare-and-swap refused the commit: the base moved between the preview the
 * owner read and the moment of commit. Shows BOTH hashes, states plainly that
 * nothing was applied, and offers a re-preview.
 *
 * @param {object} receipt  a Receipt with outcome 'refused'
 * @param {object} [preview] the Preview that was approved — supplies the base
 *                           the owner actually approved (the receipt does not carry it)
 */
export function renderRefused(receipt, preview) {
  ensureStyles();
  const root = el('section', 'zn-caps');
  root.dataset.state = 'refused';
  root.dataset.actionHash = String(receipt?.actionHash ?? preview?.actionHash ?? '');
  root.setAttribute('role', 'group');
  const body = el('div', 'zn-body');
  add(body, refusedBlock(receipt, preview, {}, root));
  add(root, body);
  root.destroy = () => {};
  return root;
}

function refusedBlock(receipt, preview, opts, root) {
  const box = el('div', 'zn-outcome');
  box.dataset.ch = 'red';

  const seal = el('div', 'zn-seal zn-draw');
  seal.dataset.ch = 'red';
  add(
    seal,
    el('span', null, '✕'),
    el('span', null, `refused · base drifted · ${fmtClock(receipt?.at)}`),
  );

  const nothing = el('div', 'zn-nothing');
  add(nothing, el('span', null, '■'), el('span', null, 'Nothing was applied.'));

  const approvedBase = preview?.binding?.baseHash;
  const observedBase = receipt?.casBaseObserved;

  const drift = el('dl', 'zn-drift');
  add(drift, el('dt', null, 'base you approved'));
  if (approvedBase) {
    add(drift, el('dd', null, String(approvedBase)));
  } else {
    const dd = el('dd', null);
    add(
      dd,
      na(
        'the receipt does not carry the base that was approved — only the one observed. Pass the Preview to renderRefused to show both.',
      ),
    );
    add(drift, dd);
  }
  add(drift, el('dt', null, 'base actually observed'));
  add(drift, el('dd', null, String(observedBase ?? '')));
  if (!observedBase) {
    drift.lastChild.textContent = '';
    add(drift.lastChild, unresolved('the receipt carries no casBaseObserved'));
  }
  add(drift, el('dt', null, 'target'));
  add(drift, el('dd', null, String(receipt?.targetRef ?? preview?.binding?.targetRef ?? '(not carried)')));

  const effect = receipt?.externalEffect?.effect;
  const evidence = el('div', 'zn-hashrow');
  if (effect === 'none') {
    add(
      evidence,
      chip(
        '□',
        'external effect · none',
        null,
        'The receipt records effect: none. That is the evidence for "nothing was applied" — not an assumption.',
      ),
    );
  } else if (effect === undefined || effect === null) {
    add(evidence, chip('▲', 'external effect · not recorded', 'amber', 'The receipt carries no effect proof.'));
  } else {
    // A refusal that claims an effect contradicts itself. Say so loudly.
    add(
      evidence,
      chip(
        '✕',
        `external effect · ${String(effect)} — CONTRADICTS THIS REFUSAL`,
        'red',
        'A refused commit must record effect: none. This receipt does not. Do not trust the "nothing applied" line above it — inspect the ledger and the provider directly.',
      ),
    );
  }

  const kv = kvList();
  kvAdd(kv, 'reason', receipt?.reason ?? '(none recorded)');
  kvAdd(kv, 'action hash', receipt?.actionHash ?? preview?.actionHash ?? '(not carried)');
  kvAdd(kv, 'receipt id', receipt?.id ?? '(not carried)');
  kvAdd(kv, 'self hash', receipt?.selfHash ?? '(not carried)');
  kvAdd(kv, 'prev receipt', receipt?.prevReceipt ?? 'null · genesis entry');
  kvAdd(kv, 'at', receipt?.at ?? '(not carried)');

  add(
    box,
    seal,
    nothing,
    el(
      'div',
      'zn-note',
      'Compare-and-swap re-read the target immediately before commit and found a different base than the one you approved. The commit was refused rather than applied, and your approval was not spent — but it is bound to the old base, so it can never commit against the new one. Approving a snapshot of a world that has moved is the failure this check exists to prevent.',
    ),
    drift,
    evidence,
    kv,
    rePreviewBtn(preview, opts, root),
  );
  return box;
}

function rePreviewBtn(preview, opts, root) {
  const b = el('button', 'zn-repreview', '↻  Re-preview against the current base');
  b.type = 'button';
  b.addEventListener('click', () => {
    const detail = {
      actionHash: preview?.actionHash ?? null,
      targetRef: preview?.binding?.targetRef ?? null,
    };
    if (typeof opts?.onRePreview === 'function') opts.onRePreview(detail);
    (root || b).dispatchEvent(new CustomEvent('zeno:re-preview', { detail, bubbles: true }));
  });
  const wrap = el('div');
  add(
    wrap,
    b,
    el(
      'div',
      'zn-note',
      'Asks the proposing agent for a fresh preview against the base that is actually there. That produces a new payload, a new hash and a new decision — it never carries this approval forward.',
    ),
  );
  return wrap;
}

/* ------------------------------------- *
 * 7 · small shared utilities             *
 * ------------------------------------- */

/**
 * The evidence list under a seal — receipt id, self hash, prev receipt, policy
 * hash. It is built INSIDE `outcomeSlot`, which is aria-live="polite", so
 * without this a settled capsule made a screen reader spell out four 64-character
 * hexadecimal digests, unprompted, character by character. `aria-live="off"`
 * exempts the subtree from the announcement while leaving every value in the
 * accessibility tree, exactly where a reader browsing the capsule will find it.
 * The event itself is still announced: the seal line above it is inside the
 * live region, and app.js separately announces the outcome in one sentence.
 */
function kvList() {
  const dl = el('dl', 'zn-kv');
  dl.setAttribute('aria-live', 'off');
  return dl;
}

function kvAdd(dl, k, v) {
  add(dl, el('dt', null, k), el('dd', null, v === null || v === undefined ? '(none)' : String(v)));
}

/** Exactly the six bound fields, in the order the kernel's Binding declares them. */
function pickTuple(binding) {
  return {
    payloadHash: binding?.payloadHash,
    baseHash: binding?.baseHash,
    targetRef: binding?.targetRef,
    kind: binding?.kind,
    tier: binding?.tier,
    provenanceHash: binding?.provenanceHash,
  };
}

function readMetaToken() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return m ? m.getAttribute('content') : null;
}
