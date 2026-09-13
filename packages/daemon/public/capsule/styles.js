/*
 * capsule/styles.js — injected once. Colours come from glass/tokens.css.
 *     The literals below are var() FALLBACKS and are the exact
 *     approved palette, not new colours.
 */

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

/* A line-exact, server-built review. EOL markers keep CRLF/LF and final-newline
   changes visible; cyan remains informational and green remains receipt-only. */
.zn-caps .zn-diff{
  background:var(--zn-g2); border:1px solid var(--zn-rule); border-radius:6px;
  margin:0; padding:12px 14px; max-height:340px; overflow:auto;
  font-family:var(--zn-mono); font-size:11.5px; line-height:1.55;
  color:var(--zn-ink); white-space:pre; user-select:text; -webkit-user-select:text;
  tab-size:2;
}
.zn-caps .zn-diff:focus-visible{ outline:2px solid var(--zn-focus); outline-offset:2px; }

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

export function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}
