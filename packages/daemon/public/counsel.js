/*
 * Zeno Counsel — the meeting surface.
 * ==================================================================
 * PORTED from docs/23-gate2-prototype.html — rCounsel() and the CSS block it
 * draws from (`.cn`, `.faces`, `.face`, `.pre`, `.prow`, `.ov`, `.hd`, `.bd`,
 * `.feed`, `.trline`, `.who`, `.tx`, `.ans`, `.say`, `.cite`, `.conf`,
 * `.thread`, `.q`, `.a`, `.ask`, `.hint`, `.dot`). The markup below is that
 * markup: the same elements, the same class names, the same nesting. Only three
 * things changed, and each is named where it happens:
 *
 *   1. THE TOKENS. The prototype's raw white alphas become the window's glass
 *      tokens (--gl-edge / --gl-spec / --wash / --wash-hi), so the same surface
 *      renders in light as well as dark. Every colour is a token; no hex here.
 *   2. THE DATA. The prototype ships synthetic data — its own footer says so.
 *      None of it is here. Every value on this surface came off the wire from
 *      the local daemon, and where there is no real source for a panel the panel
 *      says that in words rather than drawing something plausible.
 *   3. THE INFORMATION ARCHITECTURE, on the owner's instruction. In the
 *      prototype the whole Counsel tab IS the overlay. Here THE TAB IS A
 *      DASHBOARD — past calls, their cited summaries, and a chat over them —
 *      and the overlay appears ONLY while a call is actually being recorded.
 *
 * WHAT WAS CUT AND STAYS CUT. There is no Assist. The prototype's gold "Assist"
 * button and its whispered answer-for-you are gone, the engine's assist module
 * is deleted, and nothing here re-adds it in any form. Counsel writes down what
 * was said and answers questions about calls that already happened. It never
 * feeds you a line mid-sentence.
 *
 * THE ROUTES IT TALKS TO, and no others:
 *   GET    /counsel/meetings      -> { meetings[], failed[] }
 *   GET    /counsel/meetings/:id  -> { meeting, text }
 *   POST   /counsel/meetings      -> { meeting, redacted }
 *   DELETE /counsel/meetings/:id  -> { deleted }        (owner-only)
 *   POST   /counsel/ask           -> { ok, answer, unverified, cites, ungrounded,
 *                                      fabricated, grounded, hits, model, note }
 *          `answer` is populated ONLY when grounded:true. When the check fails
 *          the daemon sets answer:null and puts the model's text in
 *          `unverified` — a field name no UI prints by accident. This surface
 *          renders it as an explicit quote, never as an answer.
 *   GET    /forge/agents          -> { localModels[] }  (the preflight model row)
 *
 * NO RUNTIME EGRESS. Same-origin fetches to the loopback daemon only. No CDN and
 * no webfont request: the two faces this surface uses — IBM Plex Mono and
 * Newsreader — are already self-hosted by /glass/tokens.css out of /glass/fonts,
 * and are reached only through var(--font-mono) / var(--font-display).
 *
 * NOTHING IS TRUE BEFORE THE DAEMON SAYS SO. A call is not "saved" until POST
 * /counsel/meetings answers; a call is not "deleted" until DELETE answers; an
 * answer is not an answer until the response says it was grounded. Every one of
 * those is drawn from the response, never from the click.
 *
 * Exports: initCounsel(section), also as `init` and default, for nav.js.
 */

/* ================================================================== *
 * 0 · the wire — the token the page was handed, and the four verbs    *
 * ================================================================== */

const OWNER_TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) h['x-zeno-token'] = OWNER_TOKEN;
  return h;
}

/**
 * One fetch helper for all four verbs. It never throws for an HTTP status: the
 * daemon's errors are legible objects ({error:{code,message,resolve}}) and this
 * surface renders them as sentences, so a 404 must arrive as data rather than as
 * an exception that would collapse into a generic "something went wrong".
 */
async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? authHeaders() : authHeaders({ 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'unreachable',
      message: `The daemon did not answer ${method} ${path}.`,
      resolve: 'Check that it is still running on this machine.',
      data: null,
    };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return { ok: true, status: res.status, data };
  const e = (data && data.error) || {};
  return {
    ok: false,
    status: res.status,
    code: typeof e.code === 'string' ? e.code : `http-${res.status}`,
    message: typeof e.message === 'string' ? e.message : `${method} ${path} answered ${res.status}.`,
    resolve: typeof e.resolve === 'string' ? e.resolve : '',
    data,
  };
}

import { SpeechRecognition, localSpeech, waitForSpeechIdle } from './whisper.js';

/* ================================================================== *
 * 1 · DOM helpers. textContent only — a transcript line is speech and  *
 *     is rendered as text, never as markup.                            *
 * ================================================================== */

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
function btn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* Dates: the owner's own locale, never a re-invented format. */
function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '—');
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

/**
 * A short Whisper vocabulary hint for Counsel only. This is deliberately a
 * comma-separated word list rather than an instruction: it improves names and
 * product terms without teaching silence to hallucinate a Command wake phrase.
 */
function counselSpeechPrompt(title, participants) {
  const terms = [
    'Zeno', 'Counsel', 'Forge', 'Ollama', 'Claude Code', 'Codex',
    'TypeScript', 'FastAPI', 'PostgreSQL', 'Kubernetes',
    title,
    ...(Array.isArray(participants) ? participants : []),
  ];
  const seen = new Set();
  const clean = [];
  for (const value of terms) {
    const term = String(value || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    clean.push(term);
  }
  return clean.join(', ').slice(0, 512);
}

/** Treat even the trusted preload response as bounded data at the renderer edge. */
function normalizeMeetingPresence(value) {
  const status = value && ['detected', 'none', 'unavailable'].includes(value.status)
    ? value.status
    : 'unavailable';
  const candidates = [];
  const seen = new Set();
  const raw = value && Array.isArray(value.candidates) ? value.candidates : [];
  for (const item of raw.slice(0, 8)) {
    const key = String((item && item.key) || '');
    const provider = String((item && item.provider) || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    const title = String((item && item.title) || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (!/^[a-f0-9]{24}$/.test(key) || !provider || !title || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ key, provider, title });
  }
  return {
    status: status === 'detected' && candidates.length === 0 ? 'unavailable' : status,
    candidates,
    checkedAt: value && typeof value.checkedAt === 'string' ? value.checkedAt : null,
  };
}

/* ================================================================== *
 * 2 · the stylesheet, ported. Injected once.                          *
 * ================================================================== */

const STYLE_ID = 'zeno-counsel-styles';

const CSS = `
/* The Counsel tab is full-bleed like Command's, because the stage IS the page.
   The explicit height is what lets .cn below ask for 100% and get a real number:
   .surface is a block child of .stage with height:auto, so a percentage on the
   child would otherwise resolve to auto and the stage would collapse to its
   content. Scoped to Counsel — no other surface is touched. */
.surface[data-surface="counsel"]{ max-width:none; padding:0; gap:0; height:100%; }

/* ---------- the stage: the prototype's .cn, verbatim but tokenised ----------
   The slot is .stage, NOT the viewport: the window also carries a 55px bar and
   a 64px footer, so a viewport-minus-a-constant min-height overshot the slot by
   72px, scrolled the surface that is supposed to be a fixed stage, and raised a
   scrollbar that cost the stage 15px of width. 100% of the sized .surface is the
   same number the layout already knows, and it stays right when the bar wraps.

   overflow is CLIP, not HIDDEN, and the difference is load-bearing. The ::before
   bloom below is inset:-12%, so it hangs 12% of the stage width past the right
   edge. HIDDEN clips the paint but still makes .cn a scroll container holding
   that 12% as scrollable width — invisible, with no scrollbar to bring it back.
   One focus() or scrollIntoView() inside the stage was then enough for the
   browser to scroll .cn sideways by ~170px at 1440, shoving the whole dashboard
   left and clipping the Past calls column away permanently. CLIP clips the same
   pixels and creates no scroll container at all, so scrollLeft cannot move off
   zero. Observed: .cn scrollWidth 1598 vs clientWidth 1426 under HIDDEN; equal
   under CLIP. NOTE this block is inside a JS template literal — no backticks. */
.cn{
  position:relative; min-height:100%; overflow:clip;
  background:linear-gradient(155deg,color-mix(in srgb,var(--g2) 80%,transparent),color-mix(in srgb,var(--g1) 86%,transparent));
  display:flex; flex-direction:column;
}
.cn::before{
  /* The gradients already have soft edges. Keeping this layer static avoids a
     full-window filtered repaint while somebody reads a long transcript. */
  content:""; position:absolute; inset:0; pointer-events:none; opacity:.72;
  background:
    radial-gradient(34% 30% at 50% 12%,color-mix(in srgb,var(--cyan) 22%,transparent),transparent 72%),
    radial-gradient(30% 26% at 26% 58%,color-mix(in srgb,var(--gold) 15%,transparent),transparent 74%),
    radial-gradient(30% 26% at 76% 46%,color-mix(in srgb,var(--green) 11%,transparent),transparent 74%);
}
.cn>*{ position:relative; z-index:1 }

/* ---------- the prototype's utilities ----------------------------------------
   Scoped to the three roots this surface owns, so Command keeps its own .chip
   and its own .k. The .pre and .ov roots sit on <body> rather than inside .cn
   — a recording light has to stay visible when the owner switches to another
   tab — so they are named here too, or every rule below would miss them. */
:is(.cn,.pre,.ov) .k{ font-family:var(--font-mono); font-size:9.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3); font-weight:600; margin:0 0 9px }
:is(.cn,.pre,.ov) .sp{ flex:1 }
:is(.cn,.pre,.ov) .dot{ width:8px; height:8px; border-radius:50%; background:var(--green); flex-shrink:0 }
:is(.cn,.pre,.ov) .acts{ display:flex; gap:7px; flex-wrap:wrap; margin-top:12px }
:is(.cn,.pre,.ov) .hint{ font-size:11px; color:var(--ink-3); line-height:1.5; margin-top:10px }
:is(.cn,.pre,.ov) .hint.one{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
:is(.cn,.pre,.ov) .sub2{ font-size:11px; color:var(--ink-3); line-height:1.5 }
/* the prototype's compact mono chip. Command's .chip is a different, larger
   object, so this one is scoped rather than left to fight it. */
:is(.cn,.pre,.ov) .chip{
  display:inline-block; font-family:var(--font-mono); font-size:9.5px; padding:2.5px 7px;
  border-radius:4px; background:var(--g4); color:var(--ink-2); border:1px solid var(--rule); white-space:nowrap;
}
:is(.cn,.pre,.ov) .chip.cy{ color:var(--cyan); border-color:color-mix(in srgb,var(--cyan) 34%,var(--rule)) }
:is(.cn,.pre,.ov) .chip.am{ color:var(--amber); border-color:color-mix(in srgb,var(--amber) 38%,var(--rule)) }
:is(.cn,.pre,.ov) .chip.rd{ color:var(--red); border-color:color-mix(in srgb,var(--red) 38%,var(--rule)) }
:is(.cn,.pre,.ov) .chip.gr{ color:var(--green); border-color:color-mix(in srgb,var(--green) 34%,var(--rule)) }
:is(.cn,.pre,.ov) .chip.go{ color:var(--gold); border-color:color-mix(in srgb,var(--gold) 38%,var(--rule)) }

/* ---------- the dashboard head ---------- */
.cnhead{ padding:22px 22px 14px; display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap }
.cnhead .surface-sub{ max-width:62ch }
.cnhead .acts{ margin:0 0 2px auto }
.cnhead .hint{ flex-basis:100%; margin-top:2px }
@media (max-width:820px){ .cnhead{ padding:16px 12px 12px } .cnhead .acts{ margin-left:0 } }

/* ---------- the dashboard: three panels on the stage ---------- */
.cngrid{
  display:grid; grid-template-columns:290px minmax(0,1fr) 340px; gap:14px;
  padding:0 22px 26px; align-items:start; flex:1; min-height:0;
}
@media (max-width:1180px){ .cngrid{ grid-template-columns:264px minmax(0,1fr) } .cnpanel--ask{ grid-column:1 / -1 } }
/* Stacked, the three panels are taller than the stage, and the stage is
   overflow:hidden so it can clip the ::before bloom — which left the last panel
   and its Send button cut off with nothing to scroll. The grid takes the scroll
   rather than .cn, so the bloom stays clipped (scrolling .cn would drag the
   decoration's -12% inset into the scrollable area and raise a horizontal bar)
   and .cnhead stays put while the panels move under it. */
@media (max-width:900px){ .cngrid{ grid-template-columns:minmax(0,1fr); padding:0 12px 18px; overflow:auto } .cnpanel--ask{ grid-column:auto } }

.cnpanel{ padding:14px 15px; display:flex; flex-direction:column; min-width:0; max-height:calc(100vh - 196px) }
@media (max-width:900px){ .cnpanel{ max-height:none } }
.cnpanel-bd{ overflow:auto; min-height:0; margin:0 -5px; padding:0 5px }

/* ---------- past calls ---------- */
.callrow{
  display:block; width:100%; text-align:left; border:1px solid var(--rule); background:var(--g3);
  border-radius:9px; padding:9px 11px; margin-bottom:7px; cursor:pointer; color:var(--ink);
  font:inherit; font-size:12px;
  transition:background var(--dur-2,180ms) var(--ease,ease), border-color var(--dur-2,180ms) var(--ease,ease);
}
.callrow:hover{ background:var(--g4) }
.callrow[aria-current="true"]{ border-color:color-mix(in srgb,var(--cyan) 45%,var(--rule)); background:var(--g4) }
.callrow .ct{ font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.callrow .cd{ font-family:var(--font-mono); font-size:9.5px; color:var(--ink-3); margin-top:3px }
.callrow .cp{ font-size:11px; color:var(--ink-2); margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.callrow .cc{ display:flex; gap:5px; flex-wrap:wrap; margin-top:7px }

/* ---------- one call's summary ---------- */
.faces{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:0 0 14px }
.face{
  background:var(--g3); border:1px solid var(--rule); border-radius:9px;
  display:flex; align-items:flex-end; padding:8px; font-size:11px; color:var(--ink-3); min-height:52px;
}
@media (max-width:560px){ .faces{ grid-template-columns:1fr 1fr } }

.sec{ border-top:1px solid var(--rule); padding:13px 0 2px }
.sec:first-of-type{ border-top:0; padding-top:2px }
.sec-h{ display:flex; align-items:center; gap:8px; margin:0 0 9px; font-family:var(--font-mono); font-size:9.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--ink-3); font-weight:600 }
.sec-h b{ color:var(--ink); font-weight:600 }
.sitem{ padding:10px 12px; margin-bottom:8px; border-radius:9px; background:var(--g3); border:1px solid var(--rule) }
.sitem:last-child{ margin-bottom:0 }
.sitem-top{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:6px }
.sitem-tx{ font-size:12.5px; line-height:1.5; color:var(--ink); overflow-wrap:anywhere }
.sfacts{ display:flex; flex-wrap:wrap; gap:5px 14px; font-size:11px; color:var(--ink-3); margin-top:6px }
.sfacts b{ color:var(--ink-2); font-weight:600 }
/* A decision's social lifecycle is not one of the kernel's five state meanings,
   so it is graphite — told apart by shape and word, never by borrowing a
   channel colour. */
.life{ display:inline-flex; align-items:center; gap:6px; padding:2.5px 8px; border-radius:999px; border:1px solid var(--rule-2); background:var(--g4); color:var(--ink-2); font-family:var(--font-mono); font-size:9px; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap }
.life[data-life="agreed"]{ color:var(--ink); background:var(--g5) }
.life[data-life="disputed"]{ color:var(--ink); border-style:dashed }

/* ---------- the transcript line: the prototype's .feed / .trline ---------- */
.feed[hidden]{ display:none }
.feed{ display:flex; flex-direction:column; gap:4px; background:color-mix(in srgb,var(--g1) 20%,transparent); border:1px solid var(--gl-edge); border-radius:10px; padding:7px }
.trline{
  display:flex; gap:8px; align-items:baseline; font-size:12px; line-height:1.45; color:var(--ink-2);
  padding:6px 9px; border-radius:8px; background:transparent;
  transition:background var(--dur-2,180ms) var(--ease,ease), color var(--dur-2,180ms) var(--ease,ease);
}
.trline .who{ font-family:var(--font-mono); font-size:8.5px; letter-spacing:.07em; text-transform:uppercase; flex:none; color:var(--ink-3); width:64px }
.trline .tx{ flex:1; text-shadow:0 1px 9px var(--g1); overflow-wrap:anywhere }
.trline .tm{ font-family:var(--font-mono); font-size:8.5px; color:var(--ink-3); flex:none }
.trline.now{ background:var(--wash-2); border:1px solid var(--gl-edge); color:var(--ink); animation:trin .3s ease-out both }
.trline.now .who{ color:var(--cyan) }
.trline.owner .who{ color:var(--gold) }
@keyframes trin{ from{ opacity:0; transform:translateY(4px) } to{ opacity:1; transform:none } }
:root[data-reduce="1"] .trline.now{ animation:none }
.trline.cited{ background:color-mix(in srgb,var(--cyan) 10%,transparent); border:1px solid color-mix(in srgb,var(--cyan) 30%,var(--rule)) }
/* In the narrow chat column a 64px speaker gutter would leave four words a
   line, so there the tag sits ABOVE the words instead of beside them. */
.cnpanel--ask .trline{ flex-wrap:wrap; gap:4px 8px }
.cnpanel--ask .trline .who{ width:auto }
.cnpanel--ask .trline .tx{ flex:1 1 100% }

/* ---------- citations: the information channel ---------- */
.cites{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:7px }
.cites-lab{ font-family:var(--font-mono); font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3) }
.cite{
  font-family:var(--font-mono); font-size:10px; color:var(--cyan); cursor:pointer; display:inline-block;
  padding:2px 7px; border-radius:5px; background:color-mix(in srgb,var(--cyan) 9%,var(--g4));
  border:1px solid color-mix(in srgb,var(--cyan) 36%,var(--rule));
}
.cite:hover{ text-decoration:underline }
.cite[disabled]{ color:var(--ink-3); background:var(--g4); border-color:var(--rule); border-style:dashed; cursor:not-allowed; text-decoration:none }

/* ---------- the answer: the prototype's .ans / .say / .conf ---------- */
.ans{
  margin-top:2px; padding:12px; border-radius:11px;
  background:color-mix(in srgb,var(--g1) 26%,transparent);
  border:1px solid color-mix(in srgb,var(--cyan) 34%,var(--gl-edge));
  box-shadow:inset 0 1px 0 var(--wash-hi);
}
.ansq{ font-family:var(--font-mono); font-size:9px; color:var(--ink-3); letter-spacing:.05em; text-transform:uppercase; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.say{ font-family:var(--font-display); font-optical-sizing:auto; font-size:14.5px; line-height:1.45; margin:5px 0 0; color:var(--ink); white-space:pre-wrap; overflow-wrap:anywhere }
.conf{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-family:var(--font-mono); font-size:9.5px; color:var(--ink-3); margin-top:8px }
/* an ungrounded answer is never dressed as an answer */
.ans.ungrounded{ border-color:color-mix(in srgb,var(--amber) 46%,var(--gl-edge)) }
.ans.ungrounded .say{ font-family:var(--font-ui); font-size:12.5px; color:var(--ink-2) }
.ungr-list{ margin:8px 0 0; padding-left:16px }
.ungr-list li{ font-size:11.5px; color:var(--ink-2); margin-bottom:3px; overflow-wrap:anywhere }

/* ---------- the thread: the prototype's .thread / .q / .a ---------- */
.thread{ margin-top:2px; display:flex; flex-direction:column; gap:7px }
.thread .q{ font-size:11.5px; background:var(--wash-2); border-radius:8px 8px 3px 8px; padding:7px 9px; align-self:flex-end; max-width:86%; overflow-wrap:anywhere; color:var(--ink) }
.thread .a{ font-size:11.5px; color:var(--ink-2); background:color-mix(in srgb,var(--g1) 24%,transparent); border:1px solid var(--gl-edge); border-radius:8px 8px 8px 3px; padding:7px 9px; align-self:stretch; overflow-wrap:anywhere }
.thread .a.bad{ border-color:color-mix(in srgb,var(--amber) 45%,var(--gl-edge)) }
.thread .a.hard{ border-color:color-mix(in srgb,var(--red) 45%,var(--gl-edge)) }

/* ---------- the ask row: the prototype's .ask ---------- */
.ask{ display:flex; gap:6px; margin-top:11px; flex-shrink:0 }
.ask input{
  flex:1; min-width:0; background:color-mix(in srgb,var(--g1) 28%,transparent);
  border:1px solid var(--gl-edge); border-radius:8px; padding:8px 10px; color:var(--ink); font:inherit; font-size:12px;
}
.ask input::placeholder{ color:var(--ink-3) }

/* ---------- empty and failed states are content, not absence ---------- */
.cnempty{ display:flex; gap:10px; align-items:flex-start; padding:4px 2px }
.cnempty-glyph{ color:var(--ink-3); font-size:14px; line-height:20px; flex:none }
.cnempty-t{ margin:0; font-size:12.5px; font-weight:600; color:var(--ink-2) }
.cnempty-s{ margin:4px 0 0; font-size:11.5px; line-height:1.55; color:var(--ink-2); max-width:56ch; overflow-wrap:anywhere }
.cnbad{ border:1px solid color-mix(in srgb,var(--amber) 45%,var(--rule-2)); background:color-mix(in srgb,var(--amber) 9%,var(--g2)); border-radius:9px; padding:10px 12px; margin-bottom:10px }
.cnbad.hard{ border-color:color-mix(in srgb,var(--red) 45%,var(--rule-2)); background:color-mix(in srgb,var(--red) 10%,var(--g2)) }
.cnbad p{ margin:0; font-size:11.5px; line-height:1.55; color:var(--ink) }
.cnbad p + p{ margin-top:5px; color:var(--ink-2) }

/* ================================================================== *
 *  PREFLIGHT — the prototype's .pre / .prow, as the gate before capture *
 * ================================================================== */
.cn-scrim{ position:fixed; inset:0; z-index:55; background:color-mix(in srgb,var(--g1) 66%,transparent) }
.pre{
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:56;
  width:min(440px,calc(100vw - 26px)); max-height:calc(100vh - 56px); overflow:auto;
  padding:15px 17px; border-radius:15px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--g1) 38%,transparent),color-mix(in srgb,var(--g1) 24%,transparent));
  backdrop-filter:blur(30px) saturate(180%); -webkit-backdrop-filter:blur(30px) saturate(180%);
  border:1px solid var(--gl-edge); box-shadow:var(--gl-inner),var(--gl-cast);
}
.prow{ display:flex; justify-content:space-between; gap:12px; font-size:11.5px; padding:5px 0; border-bottom:1px solid var(--rule) }
.prow .pl{ color:var(--ink-3); flex:none }
.prow .pv{ text-align:right; min-width:0; overflow-wrap:anywhere; color:var(--ink-2) }
.prow[data-check="ok"] .pv{ color:var(--green) }
.prow[data-check="no"] .pv{ color:var(--red) }
.prow[data-check="unverified"] .pv{ color:var(--amber) }
.prow[data-check="checking"] .pv{ color:var(--ink-3) }
.prenote{ font-size:10.5px; line-height:1.5; color:var(--ink-3); margin:2px 0 7px }
.prefield{ display:flex; flex-direction:column; gap:4px; margin-bottom:9px }
.prefield label{ font-family:var(--font-mono); font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3) }
.prefield input{ background:color-mix(in srgb,var(--g1) 30%,transparent); border:1px solid var(--gl-edge); border-radius:8px; padding:7px 9px; color:var(--ink); font:inherit; font-size:12px }
.preconsent{ display:flex; gap:9px; align-items:flex-start; margin-top:11px; font-size:11.5px; line-height:1.5; color:var(--ink) }
.preconsent input{ margin:2px 0 0; flex:none; width:15px; height:15px; accent-color:var(--cyan) }
.pre-source-list{ display:grid; gap:6px; margin:7px 0 10px }
.pre-source{
  display:flex; align-items:flex-start; gap:8px; padding:7px 8px; border:1px solid var(--rule);
  border-radius:8px; background:color-mix(in srgb,var(--g1) 26%,transparent); color:var(--ink-2);
  font-size:11px; line-height:1.4;
}
.pre-source:has(input:checked){ border-color:color-mix(in srgb,var(--cyan) 45%,var(--rule)); color:var(--ink) }
.pre-source input{ margin:2px 0 0; flex:none; accent-color:var(--cyan) }
.pre-source b{ display:block; color:inherit; font-weight:600 }
.pre-source small{ display:block; color:var(--ink-3); margin-top:2px }

/* ================================================================== *
 *  THE OVERLAY — the prototype's .ov, and it exists ONLY during a call *
 * ================================================================== */
.ov{
  position:fixed; left:50%; transform:translateX(-50%); top:56px; z-index:60;
  width:min(480px,calc(100vw - 24px)); max-height:calc(100vh - 84px);
  display:flex; flex-direction:column; overflow:hidden; border-radius:17px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--g1) 40%,transparent),color-mix(in srgb,var(--g1) 24%,transparent) 52%,color-mix(in srgb,var(--g1) 36%,transparent));
  backdrop-filter:blur(36px) saturate(195%); -webkit-backdrop-filter:blur(36px) saturate(195%);
  border:1px solid var(--gl-edge);
  box-shadow:var(--gl-inner),var(--gl-cast);
  animation:ovdrop .34s cubic-bezier(.22,1,.36,1) both;
}
@keyframes ovdrop{ from{ opacity:0; transform:translate(-50%,-10px) scale(.985) } to{ opacity:1; transform:translate(-50%,0) scale(1) } }
:root[data-reduce="1"] .ov{ animation:none }
.ov .hd{
  border-radius:17px 17px 0 0; padding:11px 14px; border-bottom:1px solid var(--gl-edge);
  background:transparent; display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap;
}
.ov .hd .lab{ font-family:var(--font-mono); font-size:10px; color:var(--ink-2); letter-spacing:.05em }
.ov .hd .tm{ font-family:var(--font-mono); font-size:10px; color:var(--ink-3) }
.ov .bd{ padding:12px 13px; overflow:auto; flex:1; min-height:0 }
/* Recording is never colour alone: a filled dot that pulses, the WORD in the
   header, and a line count that only moves when the engine actually returns. */
.ov .dot{ background:var(--red); animation:lp 2.2s ease-in-out infinite }
@keyframes lp{ 0%,100%{ opacity:1 } 50%{ opacity:.35 } }
:root[data-reduce="1"] .ov .dot{ animation:none }
.ov.paused .dot{ background:var(--amber); animation:none }
.interim{ margin-top:7px; padding:7px 9px; border:1px dashed color-mix(in srgb,var(--cyan) 40%,var(--rule-2)); border-radius:8px; background:color-mix(in srgb,var(--cyan) 5%,transparent); font-size:12px; line-height:1.45; color:var(--ink-3); overflow-wrap:anywhere }
.interim .lab{ font-family:var(--font-mono); font-size:8.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--cyan); margin-right:8px }
.spk{ display:inline-flex; gap:2px; padding:2px; border-radius:8px; background:var(--wash-2); border:1px solid var(--gl-edge) }
.spk button{ border:0; background:transparent; color:var(--ink-3); font-family:var(--font-mono); font-size:9px; letter-spacing:.06em; text-transform:uppercase; padding:3px 7px; border-radius:6px; cursor:pointer }
.spk button[aria-pressed="true"]{ background:var(--wash-hi); color:var(--ink) }
.spk button[data-spk="owner"][aria-pressed="true"]{ color:var(--gold) }
.ovnote{ margin-top:9px; font-size:11px; line-height:1.5; color:var(--ink-2); border-left:2px solid var(--rule-2); padding-left:8px }
.ovnote[data-tone="warn"]{ border-left-color:var(--amber) }
.ovnote[data-tone="error"]{ border-left-color:var(--red); color:var(--ink) }

/* At 320 CSS pixels and at 200% desktop zoom the preflight facts need their
   own lines; squeezing the value beside a fixed label made both unreadable. */
@media (max-width:420px){
  .pre{ padding:13px; max-height:calc(100vh - 24px) }
  .prow{ flex-direction:column; gap:2px }
  .prow .pl{ flex:auto }
  .prow .pv{ text-align:left }
  .ov{ top:48px; max-height:calc(100vh - 60px) }
  .spk{ flex-wrap:wrap }
}

.cn-sr{ position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0 }
`;

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ================================================================== *
 * 3 · vocabulary. No diarization anywhere: the owner tags a line or it  *
 *     stays "unknown". These three are the only speaker values the      *
 *     daemon accepts, and the only ones this file ever writes.          *
 * ================================================================== */

const SPEAKERS = ['owner', 'other', 'unknown'];
const LIFECYCLE = { proposed: '○', agreed: '◈', disputed: '⊘' };

/* ================================================================== *
 * 4 · initCounsel                                                     *
 * ================================================================== */

export function initCounsel(section) {
  if (!section || section.dataset.zcInit === '1') return;
  section.dataset.zcInit = '1';
  ensureStyles();

  /* ---------------- state. Every field is filled from a response. -------- */
  const S = {
    archive: 'loading', // loading | ok | off | error
    archiveNote: '',
    meetings: [],
    failed: [],
    selected: null,
    detail: null,
    detailState: 'idle', // idle | loading | ok | error
    detailNote: '',
    deleting: null, // the id armed for a second click
    thread: [], // { question, node }
    asking: false,
    askDraft: '',
    redactedNote: null,
  };

  /** meeting id -> the full meeting, so a citation can be read, not just shown. */
  const cache = new Map();

  let CALL = null; // the live call. null at rest — the overlay does not exist then.
  let PRE = null; // the preflight dialog, only while it is open.

  /* ---------------- the stage ---------------- */
  const root = el('div', 'cn');

  const head = el('div', 'cnhead');
  const headText = el('div');
  add(
    headText,
    el('p', 'surface-eyebrow', 'Zeno Counsel'),
    el('h1', 'surface-h', 'Counsel'),
    el(
      'p',
      'surface-sub',
      'Consent-first meeting notes with cited decisions and actions. Ask from the saved transcript after ' +
        'the call; live answers stay off.',
    ),
  );
  const headActs = el('div', 'acts');
  const startBtn = btn('btn p', 'Record a meeting', openPreflight);
  add(headActs, startBtn);
  add(head, headText, headActs);

  const grid = el('div', 'cngrid');
  const panelCalls = el('div', 'l2 cnpanel cnpanel--calls');
  const panelCall = el('div', 'l2 cnpanel cnpanel--call');
  const panelAsk = el('div', 'l2 cnpanel cnpanel--ask');
  add(grid, panelCalls, panelCall, panelAsk);

  const live = el('p', 'cn-sr');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  add(root, head, grid, live);
  section.replaceChildren(root);

  function announce(msg) {
    live.textContent = msg;
  }

  /* =================================================================== *
   * A · PAST CALLS — GET /counsel/meetings                              *
   * =================================================================== */

  async function loadArchive() {
    S.archive = 'loading';
    renderCalls();
    const r = await call('GET', '/counsel/meetings');
    if (r.ok) {
      const d = r.data;
      if (!d || !Array.isArray(d.meetings) || !Array.isArray(d.failed)) {
        // A 2xx transport status does not prove the archive was read. If the
        // response loses either list, rendering an empty shelf would turn a
        // malformed response into a claim that the owner has no calls.
        S.meetings = [];
        S.failed = [];
        S.archive = 'error';
        S.archiveNote =
          'The daemon answered, but its archive response did not contain both the meeting list and the unreadable-file list. ' +
          'Treat the archive as unknown and try again.';
      } else {
        S.failed = d.failed;
      if (d.archive && d.archive.readable === false) {
        // An HTTP 200 means the daemon answered; it does not mean the folder
        // answered. Never turn an unreadable archive into an empty-history UI
        // or permit a recording whose save destination is unavailable.
        S.meetings = [];
        S.archive = 'error';
        S.archiveNote = `${d.archive.reason || 'The meeting archive could not be read.'} ${d.archive.resolve || ''}`.trim();
      } else {
        // The daemon's order is newest-first and it is NOT re-sorted here: a
        // re-sort would be this file inventing an order the archive did not give.
        S.meetings = d.meetings;
        S.archive = 'ok';
        S.archiveNote = '';
      }
      }
    } else if (r.code === 'no-meetings') {
      S.archive = 'off';
      S.archiveNote = `${r.message} ${r.resolve}`.trim();
    } else {
      S.archive = 'error';
      S.archiveNote = `${r.message} ${r.resolve}`.trim();
    }
    renderCalls();
    renderCall();
    renderAsk();
  }

  function renderCalls() {
    clear(panelCalls);
    const hd = el('div');
    hd.style.display = 'flex';
    hd.style.alignItems = 'baseline';
    add(hd, el('p', 'k', 'Past calls'), el('span', 'sp'));
    if (S.archive === 'ok') add(hd, el('span', 'chip', String(S.meetings.length)));
    add(panelCalls, hd);

    const bd = el('div', 'cnpanel-bd');
    add(panelCalls, bd);

    if (S.archive === 'loading') {
      add(bd, emptyBlock('◎', 'Reading the archive…', 'Asking the daemon for GET /counsel/meetings.'));
      return;
    }
    if (S.archive === 'off') {
      add(bd, badBlock('The meeting archive is not enabled on this daemon.', S.archiveNote, false));
      add(
        bd,
        el(
          'p',
          'hint',
          'Nothing is hidden here — this daemon was started without a meetings directory, so there is no ' +
            'archive to read and a recorded call would have nowhere to be written.',
        ),
      );
      return;
    }
    if (S.archive === 'error') {
      add(bd, badBlock('The archive could not be read.', S.archiveNote, true));
      add(bd, add(el('div', 'acts'), btn('btn sm g', 'Try again', loadArchive)));
      return;
    }

    /* A file the archive could not parse is a fact the owner needs. Leaving it
       out would be the dashboard lying by omission: "you have no calls" and
       "one of your calls is unreadable" are very different sentences. */
    for (const f of S.failed) add(bd, badBlock(`Unreadable meeting file: ${f.id}`, f.reason, false));

    if (S.meetings.length === 0) {
      add(
        bd,
        emptyBlock(
          '◎',
          'No calls recorded yet.',
          'A finished call is saved here as one Markdown file you can open in any editor. Nothing exists until then.',
        ),
      );
      return;
    }

    for (const m of S.meetings) {
      const row = el('button', 'callrow');
      row.type = 'button';
      row.setAttribute('aria-current', String(S.selected === m.id));
      add(row, el('div', 'ct', m.title || '(untitled call)'));
      add(row, el('div', 'cd', fmtDate(m.startedAt)));
      add(
        row,
        el(
          'div',
          'cp',
          m.participants && m.participants.length ? m.participants.join(' · ') : 'no participants named',
        ),
      );
      const counts = el('div', 'cc');
      const c = m.counts || {};
      add(counts, el('span', 'chip', `${c.lines || 0} lines`));
      if (c.decisions) add(counts, el('span', 'chip', `${c.decisions} decisions`));
      if (c.actions) add(counts, el('span', 'chip', `${c.actions} actions`));
      if (c.questions) add(counts, el('span', 'chip', `${c.questions} questions`));
      if (c.keyPoints) add(counts, el('span', 'chip', `${c.keyPoints} key points`));
      add(row, counts);
      row.addEventListener('click', () => { select(m.id); });
      add(bd, row);
    }

    add(panelCalls, el('p', 'hint', 'One call is one Markdown file on this machine. Deleting one really deletes that file.'));
  }

  /* =================================================================== *
   * B · ONE CALL — GET /counsel/meetings/:id, and DELETE                *
   * =================================================================== */

  async function select(id) {
    S.selected = id;
    S.deleting = null;
    S.redactedNote = null;
    renderCalls();
    if (cache.has(id)) {
      S.detail = { meeting: cache.get(id) };
      S.detailState = 'ok';
      renderCall();
      return;
    }
    S.detail = null;
    S.detailState = 'loading';
    renderCall();
    const r = await call('GET', `/counsel/meetings/${encodeURIComponent(id)}`);
    if (S.selected !== id) return; // the owner moved on; do not overwrite
    if (r.ok && r.data && r.data.meeting) {
      cache.set(id, r.data.meeting);
      S.detail = { meeting: r.data.meeting };
      S.detailState = 'ok';
    } else {
      S.detail = null;
      S.detailState = 'error';
      S.detailNote = `${r.message} ${r.resolve}`.trim();
    }
    renderCall();
  }

  /* Hand the owner a file of their own call. Built here, client-side, from the
     same record already on screen — it goes to the owner's disk on this machine
     and nowhere else. The page starts the download; if the environment blocks a
     page-initiated save, we say so rather than pretend it saved. */
  function downloadFile(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch {
      return false;
    }
  }

  function slugify(s) {
    return String(s || 'call').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'call';
  }

  /* The call as Markdown: the same four cited sections the panel shows, then the
     full transcript, then a provenance line. Nothing is invented — an item that
     had no owner/date/citation says so here exactly as it does on screen. */
  function callMarkdown(m) {
    const out = [];
    const utter = new Map((m.utterances || []).map((u) => [u.id, u]));
    const cited = (cites) => (cites || []).map((id) => {
      const u = utter.get(id);
      return u ? `\n  > [${id}] ${u.text}` : `\n  > [missing line ${id}]`;
    }).join('');
    out.push(`# ${m.title || 'Untitled call'}`, '');
    out.push(`- **When:** ${fmtDate(m.startedAt)} → ${fmtDate(m.endedAt)}`);
    out.push(`- **Participants:** ${(m.participants || []).join(', ') || 'none named'}`);
    out.push(`- **Lines:** ${(m.utterances || []).length}`);
    out.push(`- **Record id:** ${m.id}`, '');
    const sum = m.summary || {};
    const section = (label, items, fmt) => {
      out.push(`## ${label}`);
      if (!items || items.length === 0) out.push(`_Nothing in this call was extracted as ${label.toLowerCase()}._`);
      else for (const it of items) out.push(fmt(it));
      out.push('');
    };
    section('Decisions', sum.decisions, (d) => `- (${d.lifecycle}) ${d.text}${cited(d.cites)}`);
    section('Action items', sum.actions, (a) => `- ${a.text} — owner: ${a.owner || 'nobody named'}; due: ${a.due || 'no date said'}${cited(a.cites)}`);
    section('Open questions', sum.questions, (q) => `- ${q.text}${cited(q.cites)}`);
    section('Key points', sum.keyPoints, (k) => `- ${k.text}${cited(k.cites)}`);
    out.push('## Transcript');
    for (const u of (m.utterances || [])) out.push(`- **${u.speaker || 'unknown'}** [${u.id}]: ${u.text}`);
    out.push('', `> Exported from Zeno Counsel — generated locally on this machine; nothing left it.`);
    return out.join('\n');
  }

  function exportCall(m, format) {
    const base = `${slugify(m.title)}-${String(m.id || '').slice(0, 8)}`;
    const ok = format === 'json'
      ? downloadFile(`${base}.json`, JSON.stringify(m, null, 2), 'application/json')
      : downloadFile(`${base}.md`, callMarkdown(m), 'text/markdown');
    announce(ok
      ? `Exported this call as ${format === 'json' ? 'JSON' : 'Markdown'} to your downloads.`
      : 'The browser blocked the download. Nothing was saved — try again, or copy the notes by hand.');
  }

  function renderCall() {
    clear(panelCall);
    add(panelCall, el('p', 'k', 'The call'));
    const bd = el('div', 'cnpanel-bd');
    add(panelCall, bd);

    if (S.archive !== 'ok') {
      add(bd, emptyBlock('◎', 'Nothing to show.', 'A call opens here once the archive is readable.'));
      return;
    }
    if (S.detailState === 'loading') {
      add(bd, emptyBlock('◎', 'Opening the call…', 'Reading its transcript and summary from the archive.'));
      return;
    }
    if (S.detailState === 'error') {
      add(bd, badBlock('That call could not be opened.', S.detailNote, true));
      return;
    }
    if (!S.detail || !S.detail.meeting) {
      add(
        bd,
        emptyBlock(
          '◎',
          'Pick a call on the left.',
          'Its decisions, action items, open questions and key points appear here — each one showing the ' +
            'transcript line it was drawn from.',
        ),
      );
      return;
    }

    const m = S.detail.meeting;
    const lines = new Map((m.utterances || []).map((u) => [u.id, u]));

    if (S.redactedNote) add(bd, S.redactedNote);

    /* --- head: what it was, when, and the one destructive control -------- */
    const top = el('div');
    top.style.marginBottom = '12px';
    const h = el('div');
    h.style.display = 'flex';
    h.style.alignItems = 'baseline';
    h.style.gap = '10px';
    h.style.flexWrap = 'wrap';
    const title = el('div', null, m.title || '(untitled call)');
    title.style.fontFamily = 'var(--font-display)';
    title.style.fontSize = '18px';
    title.style.color = 'var(--ink)';
    add(h, title, el('span', 'sp'));
    // Export the owner's own record — Markdown to read, JSON to keep. Client-side,
    // to this machine's disk only (see downloadFile). Owner-gated like delete: a
    // read-only page cannot save what it was never trusted to hold.
    if (OWNER_TOKEN) {
      const mdBtn = btn('btn sm g', '↓ Markdown', () => { exportCall(m, 'md'); });
      mdBtn.title = 'Save this call as a Markdown file on this machine';
      const jsonBtn = btn('btn sm g', '↓ JSON', () => { exportCall(m, 'json'); });
      jsonBtn.title = 'Save this call as a JSON record on this machine';
      add(h, mdBtn, jsonBtn);
    }
    const delBtn = btn(
      'btn sm g',
      S.deleting === m.id ? 'Click again to delete for good' : 'Delete this call',
      () => { remove(m.id); },
    );
    if (S.deleting === m.id) delBtn.style.color = 'var(--red)';
    add(h, delBtn);
    add(top, h);
    add(
      top,
      el(
        'div',
        'sub2',
        `${fmtDate(m.startedAt)} → ${fmtDate(m.endedAt)} · ${(m.utterances || []).length} lines · ${m.id}`,
      ),
    );
    if (S.deleting === m.id) {
      add(top, el('p', 'hint', 'This removes the Markdown file from disk. There is no undo and no copy is kept.'));
    }
    add(bd, top);

    /* --- participants: the prototype's .faces, and they are testimony ---- */
    if (m.participants && m.participants.length) {
      const faces = el('div', 'faces');
      for (const p of m.participants) add(faces, el('div', 'face', p));
      add(bd, faces);
    } else {
      add(
        bd,
        el(
          'p',
          'hint',
          'Nobody was named on this call. Zeno does not detect who spoke — a participant list is something ' +
            'you typed, never something it heard.',
        ),
      );
    }

    /* --- the four sections, each item citing its line -------------------- */
    const sum = m.summary || {};
    sectionOf(bd, 'Decisions', sum.decisions, (d) => {
      const it = el('div', 'sitem');
      const t = el('div', 'sitem-top');
      const lc = el('span', 'life');
      lc.dataset.life = d.lifecycle;
      add(lc, el('span', null, LIFECYCLE[d.lifecycle] || '○'), el('span', null, d.lifecycle));
      add(t, lc);
      add(it, t, el('div', 'sitem-tx', d.text), citesRow(d.cites, lines));
      return it;
    });
    sectionOf(bd, 'Action items', sum.actions, (a) => {
      const it = el('div', 'sitem');
      add(it, el('div', 'sitem-tx', a.text));
      const f = el('div', 'sfacts');
      const own = el('span');
      add(own, el('span', null, 'owner: '), el('b', null, a.owner || 'nobody was named'));
      const due = el('span');
      add(due, el('span', null, 'due: '), el('b', null, a.due || 'no date was said'));
      add(f, own, due);
      add(it, f, citesRow(a.cites, lines));
      return it;
    });
    sectionOf(bd, 'Open questions', sum.questions, (q) => {
      const it = el('div', 'sitem');
      add(it, el('div', 'sitem-tx', q.text), citesRow(q.cites, lines));
      return it;
    });
    sectionOf(bd, 'Key points', sum.keyPoints, (k) => {
      const it = el('div', 'sitem');
      add(it, el('div', 'sitem-tx', k.text), citesRow(k.cites, lines));
      return it;
    });

    add(
      panelCall,
      el(
        'p',
        'hint',
        'Every item above was extracted by an open set of cue phrases running on this machine. There is no ' +
          'model in this step and nothing here is stochastic — and an item with no citation cannot be produced.',
      ),
    );
  }

  function sectionOf(parent, label, items, build) {
    const sec = el('div', 'sec');
    const h = el('p', 'sec-h');
    add(h, el('span', null, label), el('b', null, String((items && items.length) || 0)));
    add(sec, h);
    if (!items || items.length === 0) {
      add(sec, el('p', 'sub2', `Nothing in this call was extracted as ${label.toLowerCase()}.`));
    } else {
      for (const i of items) add(sec, build(i));
    }
    add(parent, sec);
  }

  /**
   * The citation row, and under it the transcript line it points at — the
   * owner's instruction: every item shows the line it cites. An id that is not
   * in this call's transcript is drawn as a dead chip that says so; it is never
   * quietly dropped, and never rendered as though it resolved.
   */
  function citesRow(cites, lines) {
    const wrap = el('div');
    const row = el('div', 'cites');
    add(row, el('span', 'cites-lab', 'cites'));
    const feed = el('div', 'feed');
    // Open by DEFAULT: an item has to SHOW the line it cites, not merely offer
    // to. The chip collapses it again for an owner who wants the summary alone.
    feed.style.marginTop = '7px';
    let open = true;

    for (const id of cites || []) {
      const u = lines.get(id);
      const chip = el('button', 'cite', id);
      chip.type = 'button';
      if (!u) {
        chip.disabled = true;
        chip.title = 'This id is not a line in this call’s transcript.';
      } else {
        chip.setAttribute('aria-expanded', 'true');
        chip.addEventListener('click', () => {
          open = !open;
          feed.hidden = !open;
          for (const c of row.querySelectorAll('.cite[aria-expanded]')) c.setAttribute('aria-expanded', String(open));
        });
        add(feed, trline(u, 'cited'));
      }
      add(row, chip);
    }
    if (!cites || cites.length === 0) {
      add(row, el('span', 'sub2', 'none — and an uncited item is never shown as fact'));
    }
    // No line resolved: draw no box at all rather than an empty one, which would
    // read as "the citation is there, it is just collapsed".
    if (feed.childElementCount === 0) {
      feed.hidden = true;
      open = false;
    }
    add(wrap, row, feed);
    return wrap;
  }

  function trline(u, extra) {
    const l = el('div', `trline${extra ? ' ' + extra : ''}${u.speaker === 'owner' ? ' owner' : ''}`);
    add(l, el('span', 'who', u.speaker || 'unknown'), el('span', 'tx', u.text));
    const d = new Date(u.at);
    if (!Number.isNaN(d.getTime())) add(l, el('span', 'tm', fmtClock(d)));
    return l;
  }

  async function remove(id) {
    if (S.deleting !== id) {
      // Two steps, because this really deletes a file and there is no undo.
      S.deleting = id;
      renderCall();
      return;
    }
    S.deleting = null;
    const r = await call('DELETE', `/counsel/meetings/${encodeURIComponent(id)}`);
    if (!r.ok || !r.data || r.data.deleted !== id) {
      // Nothing leaves the list on a failure — the file is still on disk.
      S.detailState = 'error';
      S.detailNote = r.ok
        ? 'The daemon answered, but did not prove that this exact call was deleted. The archive has not been changed in this window; reopen it before trying again.'
        : `${r.message} ${r.resolve}`.trim();
      renderCall();
      return;
    }
    cache.delete(id);
    S.meetings = S.meetings.filter((m) => m.id !== id);
    S.failed = S.failed.filter((f) => f.id !== id);
    if (S.selected === id) {
      S.selected = null;
      S.detail = null;
      S.detailState = 'idle';
    }
    announce('Call deleted.');
    renderCalls();
    renderCall();
  }

  /* =================================================================== *
   * C · SAVED-MEETING Q&A — POST /counsel/ask                            *
   * =================================================================== */

  function renderAsk() {
    clear(panelAsk);
    add(panelAsk, el('p', 'k', 'Ask after the meeting'));

    const bd = el('div', 'cnpanel-bd');
    add(panelAsk, bd);

    if (S.thread.length === 0) {
      add(
        bd,
        emptyBlock(
          '◈',
          'Nothing asked yet.',
          'Questions are answered from your saved calls by the local model, and every claim has to cite a ' +
            'line of a real transcript. When it cannot, you are told that instead of being given an answer.',
        ),
      );
    } else {
      const thread = el('div', 'thread');
      for (const t of S.thread) add(thread, el('div', 'q', t.question), t.node);
      add(bd, thread);
      bd.scrollTop = bd.scrollHeight;
    }

    const ask = el('div', 'ask');
    const input = el('input');
    input.type = 'text';
    input.placeholder = CALL ? 'End and save the meeting before asking…' : 'Ask about your calls…';
    input.setAttribute('aria-label', 'Ask about your calls');
    input.value = S.askDraft;
    input.disabled = S.asking || S.archive !== 'ok' || CALL !== null;
    input.addEventListener('input', () => { S.askDraft = input.value; });
    const send = btn('btn sm p', S.asking ? 'Asking…' : 'Send', () => { ask1(input.value); });
    send.disabled = S.asking || S.archive !== 'ok' || CALL !== null;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        ask1(input.value);
      }
    });
    add(ask, input, send);
    add(panelAsk, ask);

    if (CALL) {
      add(
        panelAsk,
        el(
          'p',
          'hint',
          'Questions are disabled while a meeting is active. Counsel records the meeting; it does not supply live answers. End and save first, then ask from the cited notes.',
        ),
      );
    }

    add(
      panelAsk,
      el(
        'p',
        'hint',
        'Answered on this machine by the local model, from your saved calls and nothing else. It has no web ' +
          'access and no other context.',
      ),
    );

    if (!S.asking && document.activeElement && document.activeElement.tagName === 'INPUT' && S.askDraft !== '') {
      // keep the caret where the owner had it across a re-render
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async function ask1(qRaw) {
    const question = String(qRaw || '').trim();
    if (!question || S.asking || S.archive !== 'ok' || CALL !== null) return;
    S.asking = true;
    S.askDraft = '';
    const entry = { question, node: el('div', 'a', 'Asking the local model…') };
    S.thread.push(entry);
    renderAsk();

    const r = await call('POST', '/counsel/ask', { question });
    S.asking = false;
    if (!r.ok) {
      entry.node = answerBlock({ transportError: `${r.message} ${r.resolve}`.trim() }, question);
    } else {
      // Resolve the cited ids to real lines, so a citation can be READ and not
      // merely displayed. Only the meetings the daemon says it retrieved are read.
      await warmCache(((r.data && r.data.hits) || []).map((h) => h.id));
      entry.node = answerBlock(r.data || {}, question);
    }
    renderAsk();
  }

  async function warmCache(ids) {
    for (const id of ids) {
      if (!id || cache.has(id)) continue;
      const r = await call('GET', `/counsel/meetings/${encodeURIComponent(id)}`);
      if (r.ok && r.data && r.data.meeting) cache.set(id, r.data.meeting);
    }
  }

  function lookupCite(id) {
    for (const m of cache.values()) {
      if (m.id === id) return { meeting: m, line: null };
      for (const u of m.utterances || []) if (u.id === id) return { meeting: m, line: u };
    }
    return null;
  }

  /**
   * The answer — and the four ways it can fail to be one. Each is rendered as
   * what it is, and none of them is dressed up as an answer.
   *
   *   · TRANSPORT   the route did not answer at all.
   *   · NO MODEL    ok:false — Ollama is not running, or the model is not pulled.
   *                 The daemon's own note explains it and NOTHING is answered.
   *   · NO HITS     nothing in the archive matched, so no model was even asked.
   *   · UNGROUNDED  grounded:false — the model wrote prose but cited ids that
   *                 exist nowhere, or made claims with no citation. The text is
   *                 shown as a quote of what it said, marked unusable, with the
   *                 fabricated ids and the uncited claims listed underneath.
   */
  function answerBlock(d, question) {
    if (d.transportError) {
      const a = el('div', 'a hard');
      add(a, el('div', null, 'No answer — the request did not get through.'), el('div', 'sub2', d.transportError));
      return a;
    }

    if (d.ok === false) {
      const a = el('div', 'a bad');
      add(
        a,
        el('div', null, 'No answer: the local model is not available.'),
        el('div', 'sub2', d.note || 'The daemon could not reach a local model.'),
        el('div', 'sub2', 'Your calls are still on disk and still readable here. Nothing was sent anywhere.'),
      );
      if (d.model) {
        const c = el('div');
        c.style.marginTop = '6px';
        add(c, el('span', 'chip am', `model: ${d.model}`));
        add(a, c);
      }
      return a;
    }

    const hits = Array.isArray(d.hits) ? d.hits : [];
    if (hits.length === 0) {
      const a = el('div', 'a');
      add(
        a,
        el('div', null, d.answer || 'I could not find that in your meetings.'),
        el('div', 'sub2', d.note || 'No meeting in your archive matched that question, so nothing was sent to a model.'),
      );
      return a;
    }

    const grounded = d.grounded !== false;
    const ansEl = el('div', `ans${grounded ? '' : ' ungrounded'}`);
    add(ansEl, el('div', 'ansq', `answers “${question}”`));

    /* WHICH FIELD CARRIES THE TEXT DEPENDS ON WHETHER IT IS AN ANSWER.
       The daemon deliberately never puts ungrounded prose in `answer` — it sets
       `answer:null` and moves the text to `unverified`, precisely so a careless
       client cannot print an invented meeting as fact. Reading `answer` in BOTH
       branches therefore rendered an empty paragraph under a panel that says,
       in the chip below, "shown as what the model said" — the panel claimed to
       be quoting a machine it was not quoting. Read the field that actually
       holds the text for this branch. The `.ans.ungrounded .say` rule restyles
       it out of answer-voice into a muted quote, which is what it is. */
    const said = grounded ? d.answer : d.unverified;
    add(ansEl, el('p', 'say', said ? String(said) : ''));
    if (!grounded && !said) {
      add(ansEl, el('div', 'sub2', 'The model returned nothing to quote here.'));
    }

    if (!grounded) {
      add(
        ansEl,
        el(
          'div',
          'sub2',
          d.note || 'Part of this carries no citation, so it is not supported by your meetings.',
        ),
      );
      if (Array.isArray(d.fabricated) && d.fabricated.length) {
        const ul = el('ul', 'ungr-list');
        for (const id of d.fabricated) add(ul, el('li', null, `cited “${id}” — no call of yours contains that id`));
        add(ansEl, ul);
      }
      if (Array.isArray(d.ungrounded) && d.ungrounded.length) {
        const ul = el('ul', 'ungr-list');
        for (const c of d.ungrounded.slice(0, 6)) add(ul, el('li', null, `uncited: ${c}`));
        if (d.ungrounded.length > 6) add(ul, el('li', null, `+${d.ungrounded.length - 6} more uncited claims`));
        add(ansEl, ul);
      }
      const conf = el('div', 'conf');
      add(conf, el('span', 'chip am', 'NOT GROUNDED'), el('span', null, 'shown as what the model said — not as an answer'));
      if (d.model) add(conf, el('span', 'chip', `${d.model} · local`));
      add(ansEl, conf);
      const wrap = el('div', 'a bad');
      add(wrap, ansEl);
      return wrap;
    }

    const cites = Array.isArray(d.cites) ? d.cites : [];
    const row = el('div', 'cites');
    add(row, el('span', 'cites-lab', 'cites'));
    const feed = el('div', 'feed');
    // Open by DEFAULT: an item has to SHOW the line it cites, not merely offer
    // to. The chip collapses it again for an owner who wants the summary alone.
    feed.style.marginTop = '7px';
    let open = true;
    for (const id of cites) {
      const found = lookupCite(id);
      const chip = el('button', 'cite', id);
      chip.type = 'button';
      if (!found) {
        chip.disabled = true;
        chip.title = 'This id could not be resolved to a line in the archive from here.';
      } else {
        chip.addEventListener('click', () => {
          open = !open;
          feed.hidden = !open;
        });
        if (found.line) {
          add(feed, trline(found.line, 'cited'));
        } else {
          const l = el('div', 'trline cited');
          add(l, el('span', 'who', 'call'), el('span', 'tx', found.meeting.title || found.meeting.id));
          add(feed, l);
        }
      }
      add(row, chip);
    }
    if (cites.length === 0) add(row, el('span', 'sub2', 'none'));
    if (feed.childElementCount === 0) {
      feed.hidden = true;
      open = false;
    }
    add(ansEl, row, feed);

    const conf = el('div', 'conf');
    add(conf, el('span', 'chip gr', 'GROUNDED'), el('span', null, 'every claim cites a line of a real call'));
    if (d.model) add(conf, el('span', 'chip cy', `${d.model} · local`));
    add(ansEl, conf);

    const wrap = el('div', 'a');
    add(wrap, ansEl);
    return wrap;
  }

  /* =================================================================== *
   * D · PREFLIGHT — the prototype's `.pre`, as the gate before capture.  *
   *     Every row reports a check that was actually made. A row we       *
   *     cannot verify says "not verified"; none of them shows a tick it  *
   *     has not earned, and consent is never implied on anyone's behalf. *
   * =================================================================== */

  function openPreflight() {
    if (CALL || PRE) return;
    PRE = {
      scrim: el('div', 'cn-scrim'),
      card: el('div', 'pre'),
      title: '',
      participants: '',
      consent: false,
      focused: false,
      meetingCandidates: [],
      selectedMeetingKey: '',
      meetingCheckPending: false,
      beginPending: false,
      checks: {
        mic: { state: 'checking', text: 'checking…' },
        sys: { state: 'no', text: 'not captured' },
        meeting: { state: 'checking', text: 'checking local meeting windows…' },
        model: { state: 'checking', text: 'checking…' },
        retention: { state: 'ok', text: 'transcript text only ✓' },
        consent: { state: 'no', text: 'not confirmed' },
        overlay: { state: 'unverified', text: 'this window only — not verifiable' },
      },
    };
    document.body.appendChild(PRE.scrim);
    document.body.appendChild(PRE.card);
    PRE.scrim.addEventListener('click', closePreflight);
    renderPreflight();
    runChecks(PRE);
  }

  function closePreflight() {
    if (!PRE) return;
    PRE.scrim.remove();
    PRE.card.remove();
    PRE = null;
    startBtn.focus();
  }

  /** The real checks. Nothing here reports a state it did not observe. */
  function runChecks(p) {
    function set(key, state, text) {
      if (!PRE || PRE !== p) return; // the dialog closed under us
      PRE.checks[key] = { state, text };
      renderPreflight();
    }

    /* MICROPHONE — two real questions, neither assumed: is there an engine at
       all, and was permission ACTUALLY granted? */
    (async () => {
      if (!SpeechRecognition) return set('mic', 'no', 'no speech engine in this browser');
      if (localSpeech) return set('mic', 'unverified', 'Local Whisper — microphone checked when capture starts');
      let hasInput = null;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        hasInput = devs.some((dev) => dev.kind === 'audioinput');
      } catch {
        hasInput = null; // could not enumerate: that is "unknown", not "none"
      }
      if (hasInput === false) return set('mic', 'no', 'no microphone on this machine');
      let perm = null;
      try {
        perm = await navigator.permissions.query({ name: 'microphone' });
      } catch {
        perm = null;
      }
      if (!perm) return set('mic', 'unverified', 'not verified — this browser will not report mic permission');
      const apply = () => {
        if (perm.state === 'granted') set('mic', 'ok', 'permission granted ✓');
        else if (perm.state === 'denied') set('mic', 'no', 'permission denied');
        else set('mic', 'unverified', 'not verified — the browser will ask when capture starts');
      };
      apply();
      perm.onchange = apply;
      return undefined;
    })();

    void refreshMeetingPresence(p);

    /* MODEL — is a local model actually there? The daemon probes Ollama on the
       loopback and reports what it found. An empty list does not stop a
       recording, only the chat, and the row says exactly that. */
    (async () => {
      const r = await call('GET', '/forge/agents');
      if (!r.ok) return set('model', 'unverified', 'not verified — the daemon did not answer');
      const models = (r.data && Array.isArray(r.data.localModels) ? r.data.localModels : []).filter(Boolean);
      if (models.length === 0) return set('model', 'unverified', 'no local model found — the chat cannot answer');
      const shown = models.slice(0, 2).join(', ') + (models.length > 2 ? ` +${models.length - 2}` : '');
      return set('model', 'ok', `local ✓ · ${shown}`);
    })();
  }

  async function readMeetingPresence() {
    const detector = window.zenoMeeting;
    if (!detector || typeof detector.detect !== 'function') {
      return { status: 'unavailable', candidates: [], checkedAt: null };
    }
    try {
      return normalizeMeetingPresence(await detector.detect());
    } catch {
      return { status: 'unavailable', candidates: [], checkedAt: null };
    }
  }

  async function refreshMeetingPresence(p) {
    if (!PRE || PRE !== p || p.meetingCheckPending) return null;
    p.meetingCheckPending = true;
    const presence = await readMeetingPresence();
    if (!PRE || PRE !== p) return presence;
    p.meetingCheckPending = false;
    p.meetingCandidates = presence.candidates;
    if (p.selectedMeetingKey && !presence.candidates.some((candidate) => candidate.key === p.selectedMeetingKey)) {
      p.selectedMeetingKey = '';
    }
    if (presence.status === 'detected') {
      p.checks.meeting = {
        state: 'ok',
        text: `${presence.candidates.length} supported meeting window${presence.candidates.length === 1 ? '' : 's'} found`,
      };
    } else if (presence.status === 'none') {
      p.checks.meeting = { state: 'unverified', text: 'no supported meeting window found · manual mode available' };
    } else {
      p.checks.meeting = { state: 'unverified', text: 'window detection unavailable · manual mode available' };
    }
    renderPreflight();
    return presence;
  }

  function renderPreflight() {
    if (!PRE) return;
    const active = document.activeElement;
    const activeId = active && PRE.card.contains(active) ? active.id : '';
    const caretStart = activeId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const caretEnd = activeId && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    const card = clear(PRE.card);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Preflight before capture');

    add(card, el('p', 'k', 'Preflight · before capture'));

    const f1 = el('div', 'prefield');
    const l1 = el('label', null, 'what is this call');
    l1.htmlFor = 'zc-pre-title';
    const i1 = el('input');
    i1.type = 'text';
    i1.id = 'zc-pre-title';
    i1.value = PRE.title;
    i1.placeholder = 'Toolbar sync';
    i1.addEventListener('input', () => {
      PRE.title = i1.value;
      beginBtn.disabled = !canBegin();
        syncBeginReason();
    });
    add(f1, l1, i1);

    const f2 = el('div', 'prefield');
    const l2 = el('label', null, 'who is in the room — you type them, nothing is detected');
    l2.htmlFor = 'zc-pre-people';
    const i2 = el('input');
    i2.type = 'text';
    i2.id = 'zc-pre-people';
    i2.value = PRE.participants;
    i2.placeholder = 'Priya, Dev lead';
    i2.addEventListener('input', () => { PRE.participants = i2.value; });
    add(f2, l2, i2);

    add(card, f1, f2);

    prow(card, 'microphone', PRE.checks.mic);
    prow(
      card,
      'system audio',
      PRE.checks.sys,
      'the browser speech engine hears this microphone only — Zeno does not capture what your speakers play, and does not claim to',
    );
    prow(
      card,
      'meeting window',
      PRE.checks.meeting,
      'the desktop checks only the names of capturable windows, without screenshots or icons. A match proves that a supported meeting window exists, not that you joined it or that its audio is captured',
    );

    const sources = el('div', 'pre-source-list');
    const manual = el('label', 'pre-source');
    const manualRadio = el('input');
    manualRadio.type = 'radio';
    manualRadio.name = 'zc-call-source';
    manualRadio.id = 'zc-source-manual';
    manualRadio.checked = PRE.selectedMeetingKey === '';
    manualRadio.addEventListener('change', () => {
      if (!manualRadio.checked) return;
      PRE.selectedMeetingKey = '';
      renderPreflight();
    });
    const manualText = el('span');
    add(
      manualText,
      el('b', null, 'Manual microphone capture'),
      el('small', null, 'No external application is attached. You can still record a named, consented call.'),
    );
    add(manual, manualRadio, manualText);
    add(sources, manual);
    for (const candidate of PRE.meetingCandidates) {
      const option = el('label', 'pre-source');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'zc-call-source';
      radio.id = `zc-source-${candidate.key}`;
      radio.checked = PRE.selectedMeetingKey === candidate.key;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        PRE.selectedMeetingKey = candidate.key;
        renderPreflight();
      });
      const copy = el('span');
      add(
        copy,
        el('b', null, `Attach to ${candidate.provider}`),
        el('small', null, candidate.title),
      );
      add(option, radio, copy);
      add(sources, option);
    }
    add(card, sources);
    prow(card, 'model', PRE.checks.model);
    prow(
      card,
      'retention',
      PRE.checks.retention,
      localSpeech ? 'Speech is recognized on this PC with local Whisper. Zeno saves transcript text as local Markdown, never an audio file or cloud upload.' : 'This page saves transcript text, not audio files. The browser speech service may send microphone audio to the browser maker for transcription.',
    );
    prow(card, 'consent', PRE.checks.consent);
    prow(
      card,
      'others can see overlay',
      PRE.checks.overlay,
      'the listening panel is drawn in this window and nowhere else — but a page cannot tell whether your screen is being shared, so this cannot be verified from here',
    );

    const consent = el('label', 'preconsent');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = 'zc-pre-consent';
    cb.checked = PRE.consent;
    cb.addEventListener('change', () => {
      PRE.consent = cb.checked;
      PRE.checks.consent = cb.checked
        ? { state: 'ok', text: 'you confirmed you told them ✓' }
        : { state: 'no', text: 'not confirmed' };
      renderPreflight();
    });
    add(
      consent,
      cb,
      el(
        'span',
        null,
        'I have told everyone on this call that it is being recorded. Zeno cannot verify this and will not ' +
          'pretend to — it is your word, and capture does not start without it.',
      ),
    );
    add(card, consent);

    const acts = el('div', 'acts');
    const beginBtn = btn(
      'btn p',
      PRE.selectedMeetingKey ? 'Attach & begin capture' : 'Begin manual capture',
      beginCall,
    );
    const beginWhy = el('p', 'hint one');
    const syncBeginReason = () => {
      const why = whyNotBegin();
      beginWhy.textContent = why === null ? '' : why;
      beginWhy.hidden = why === null;
    };
    beginBtn.disabled = !canBegin() || PRE.beginPending;
    add(acts, beginBtn, btn('btn g', 'Cancel', closePreflight));
    add(acts, beginWhy);
    syncBeginReason();
    add(card, acts);

    if (S.archive !== 'ok') {
      add(
        card,
        el(
          'p',
          'hint',
          'Capture is blocked because the archive is not readable: a recorded call would have nowhere to be saved.',
        ),
      );
    }
    add(
      card,
      el(
        'p',
        'hint',
        'A check that fails blocks capture rather than hiding it. A check this browser will not let us make ' +
          'says “not verified” — no row ever shows a tick it has not earned.',
      ),
    );

    const restored = activeId ? document.getElementById(activeId) : null;
    if (restored && card.contains(restored)) {
      restored.focus();
      if (caretStart !== null && typeof restored.setSelectionRange === 'function') {
        const end = caretEnd === null ? caretStart : caretEnd;
        try { restored.setSelectionRange(caretStart, end); } catch { /* checkbox or unsupported input */ }
      }
    } else if (!PRE.focused) {
      PRE.focused = true;
      i1.focus();
    }
  }

  function prow(parent, label, check, note) {
    const r = el('div', 'prow');
    r.dataset.check = check.state;
    add(r, el('span', 'pl', label), el('span', 'pv', check.text));
    add(parent, r);
    if (note) add(parent, el('div', 'prenote', note));
  }

  function canBegin() {
    return whyNotBegin() === null;
  }

  /**
   * The ONE reason capture cannot start yet, in the owner's words — or null.
   *
   * A disabled button that gives no reason is indistinguishable from a broken
   * one, and this button has four preconditions. It was reported as "begin
   * capture is not working": it was working exactly as designed and simply never
   * said which box was still unticked.
   */
  function whyNotBegin() {
    if (!PRE) return 'The preflight is not open.';
    if (PRE.beginPending) return 'Checking that the selected meeting window is still present…';
    if (String(PRE.title || '').trim().length === 0) return 'Name the call first, in the box above.';
    if (!PRE.consent) return 'Tick the consent box — everyone in the room needs to know they are being recorded.';
    if (PRE.checks.mic.state === 'no') return 'This page has no microphone permission, so there would be nothing to record. Grant it in the browser, then reopen this.';
    if (S.archive !== 'ok') return 'The meeting archive could not be read, so there would be nowhere to save this call.';
    return null;
  }

  /* =================================================================== *
   * E · THE LIVE CALL — the prototype's `.ov`, and only while recording. *
   *     There is no Assist here, and there will not be one.              *
   * =================================================================== */

  async function beginCall() {
    if (!PRE || !canBegin() || CALL) return;
    const preflight = PRE;
    let attachedMeeting = null;
    if (preflight.selectedMeetingKey) {
      preflight.beginPending = true;
      preflight.checks.meeting = { state: 'checking', text: 'confirming selected meeting window…' };
      renderPreflight();
      const presence = await readMeetingPresence();
      if (!PRE || PRE !== preflight || CALL) return;
      preflight.beginPending = false;
      attachedMeeting = presence.candidates.find((candidate) => candidate.key === preflight.selectedMeetingKey) || null;
      if (!attachedMeeting) {
        preflight.selectedMeetingKey = '';
        preflight.meetingCandidates = presence.candidates;
        preflight.checks.meeting = {
          state: 'unverified',
          text: 'the selected meeting window is no longer present · capture did not start',
        };
        renderPreflight();
        return;
      }
    }
    if (!canBegin()) return;
    const title = preflight.title.trim();
    const participants = preflight.participants
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    closePreflight();

    CALL = {
      title,
      participants,
      utterances: [],
      seq: 0,
      speaker: 'unknown', // nothing is detected; unknown until the owner says
      interim: '',
      startedAt: Date.now(),
      recognition: null,
      want: false,
      running: false,
      saving: false,
      note: null,
      noteTone: 'warn',
      attachedMeeting: attachedMeeting
        ? { ...attachedMeeting, state: 'present', checkedAt: new Date().toISOString() }
        : null,
      ov: el('div', 'ov'),
      tick: 0,
      meetingTick: 0,
    };
    document.body.dataset.zenoCapture = 'counsel';
    document.body.appendChild(CALL.ov);
    renderAsk();
    renderOverlay();
    startEngine();
    CALL.tick = window.setInterval(() => {
      if (!CALL) return;
      const t = CALL.ov.querySelector('[data-el="elapsed"]');
      if (t) t.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    }, 1000);
    if (attachedMeeting) {
      const session = CALL;
      CALL.meetingTick = window.setInterval(() => { void refreshAttachedMeeting(session); }, 15_000);
    }
    announce('Preparing microphone.');
  }

  async function refreshAttachedMeeting(session) {
    if (!session || CALL !== session || !session.attachedMeeting) return;
    const presence = await readMeetingPresence();
    if (CALL !== session || !session.attachedMeeting) return;
    const found = presence.candidates.some((candidate) => candidate.key === session.attachedMeeting.key);
    const next = presence.status === 'unavailable' ? 'unknown' : found ? 'present' : 'missing';
    const changed = session.attachedMeeting.state !== next;
    session.attachedMeeting.state = next;
    session.attachedMeeting.checkedAt = new Date().toISOString();
    if (changed && next === 'missing') {
      session.note = 'The attached meeting window is no longer detected. Microphone capture continues until you end or discard it.';
      session.noteTone = 'warn';
    } else if (changed && next === 'unknown') {
      session.note = 'Zeno could not re-check the attached meeting window. Microphone capture continues; attachment state is unknown.';
      session.noteTone = 'warn';
    }
    if (changed) renderOverlay();
  }

  async function startEngine() {
    if (!CALL || !SpeechRecognition) return;
    const session = CALL;
    session.want = true;
    session.note = 'Preparing microphone. Command listening is paused while this call records.';
    const handoff = { waiters: [], requestedBy: 'Counsel' };
    window.dispatchEvent(new CustomEvent('zeno:release-command-voice', { detail: handoff }));
    try {
      await Promise.all(handoff.waiters);
      await waitForSpeechIdle();
    } catch {
      if (CALL === session) {
        session.want = false;
        session.note = 'The previous microphone session did not close. Stop Command listening, then discard and retry this call.';
        session.noteTone = 'error';
        renderOverlay();
      }
      return;
    }
    if (CALL !== session || !session.want) return;
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.initialPrompt = counselSpeechPrompt(session.title, session.participants);
    rec.onsegmentstart = () => session.speaker;

    rec.onstart = () => {
      if (CALL !== session || session.recognition !== rec || !session.want) {
        try { rec.abort(); } catch { /* already stopped */ }
        return;
      }
      session.running = true;
      session.note = null;
      announce('Recording started.');
      renderOverlay();
    };

    rec.onresult = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (!res || !res[0]) continue;
        if (res.isFinal) commit(res[0].transcript, event.segmentMeta);
        else interim += res[0].transcript;
      }
      CALL.interim = interim;
      renderOverlay();
    };

    rec.onerror = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      const err = (event && event.error) || 'unknown';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        // A hard denial. Stop rather than thrash the permission prompt, and say
        // plainly that nothing was heard while access was blocked.
        CALL.want = false;
        CALL.running = false;
        CALL.note =
          'Microphone access was refused, so capture stopped. Nothing was heard while it was blocked. ' +
          'Grant this page microphone permission, then start the call again.';
        CALL.noteTone = 'error';
        try { rec.stop(); } catch { /* already stopped */ }
        renderOverlay();
        return;
      }
      if (err === 'no-speech' || err === 'aborted') return; // ordinary silence
      CALL.want = false;
      CALL.running = false;
      CALL.note = err === 'network'
        ? 'The browser speech service is unavailable. Capture stopped; no automatic retries. End this call and retry when the service is reachable.'
        : `Speech recognition failed (${err}). Capture stopped. Check the microphone and installed speech language before retrying.`;
      CALL.noteTone = 'error';
      try { rec.abort(); } catch { /* already stopped */ }
      renderOverlay();
    };

    rec.onend = () => {
      if (CALL !== session || session.recognition !== rec) return;
      session.enginePending = false;
      session.endResolve?.(true);
      session.endResolve = null;
      // The engine stops itself periodically. While the owner still wants to
      // record, restart it; otherwise settle honestly into "not recording".
      if (CALL.want) {
        session.enginePending = true;
        try { rec.start(); } catch { session.enginePending = false; session.want = false; session.running = false; renderOverlay(); }
        return;
      }
      CALL.running = false;
      renderOverlay();
    };

    CALL.recognition = rec;
    CALL.want = true;
    CALL.running = false;
    CALL.enginePending = true;
    try {
      rec.start();
    } catch {
      session.enginePending = false; session.want = false;
      session.note = 'Microphone could not start. Stop other listening and retry.';
      session.noteTone = 'error'; renderOverlay();
    }
  }

  function commit(text, capturedSpeaker) {
    const t = String(text || '').trim();
    if (!CALL || !t) return;
    const speaker = capturedSpeaker === 'owner' || capturedSpeaker === 'other' || capturedSpeaker === 'unknown'
      ? capturedSpeaker
      : CALL.speaker;
    CALL.utterances.push({
      id: `u${CALL.seq++}`,
      at: new Date().toISOString(),
      speaker,
      text: t,
    });
  }

  function renderOverlay() {
    if (!CALL) return;
    const ov = clear(CALL.ov);
    ov.classList.toggle('paused', !CALL.running);
    ov.setAttribute('role', 'region');
    ov.setAttribute('aria-label', 'Live call');

    /* --- the head: the recording light, and it never lies ---------------- */
    const hd = el('div', 'hd');
    add(hd, el('span', 'dot'));
    add(
      hd,
      el('span', 'lab', CALL.running ? 'RECORDING · local' : CALL.want ? 'RECONNECTING…' : 'STOPPED · not recording'),
    );
    add(hd, el('span', 'sp'));
    const elapsed = el('span', 'tm', fmtElapsed(Date.now() - CALL.startedAt));
    elapsed.dataset.el = 'elapsed';
    add(hd, elapsed);
    if (CALL.attachedMeeting) {
      const state = CALL.attachedMeeting.state;
      const tone = state === 'present' ? 'gr' : state === 'missing' ? 'am' : '';
      const suffix = state === 'present' ? 'window present' : state === 'missing' ? 'window missing' : 'state unknown';
      add(hd, el('span', `chip ${tone}`.trim(), `${CALL.attachedMeeting.provider} · ${suffix}`));
    } else {
      add(hd, el('span', 'chip', 'manual · microphone only'));
    }
    add(hd, el('span', 'chip', `${CALL.utterances.length} lines`));
    add(ov, hd);

    const bd = el('div', 'bd');

    /* --- who gets tagged next. No diarization; this is the only source. --- */
    const spkRow = el('div');
    spkRow.style.display = 'flex';
    spkRow.style.alignItems = 'center';
    spkRow.style.gap = '8px';
    spkRow.style.marginBottom = '9px';
    spkRow.style.flexWrap = 'wrap';
    add(spkRow, el('span', 'cites-lab', 'tag new lines as'));
    const spk = el('div', 'spk');
    for (const s of SPEAKERS) {
      const b = btn(null, s, () => {
        CALL.speaker = s;
        renderOverlay();
      });
      b.dataset.spk = s;
      b.setAttribute('aria-pressed', String(CALL.speaker === s));
      add(spk, b);
    }
    add(spkRow, spk);
    add(bd, spkRow);

    /* --- the live transcript: the prototype's .feed / .trline ------------ */
    const feed = el('div', 'feed');
    const last = CALL.utterances.slice(-6);
    if (last.length === 0) {
      add(feed, el('div', 'sub2', 'Nothing transcribed yet. Lines appear here as the engine finalises them.'));
    } else {
      last.forEach((u, i) => add(feed, trline(u, i === last.length - 1 ? 'now' : null)));
    }
    add(bd, feed);

    if (CALL.interim) {
      const it = el('div', 'interim');
      add(it, el('span', 'lab', 'hearing'), el('span', null, CALL.interim));
      add(bd, it);
    }

    if (CALL.note) {
      const n = el('div', 'ovnote');
      n.dataset.tone = CALL.noteTone;
      n.textContent = CALL.note;
      add(bd, n);
    }

    /* Counsel is an ethical meeting record, never a live answer assistant. */
    add(
      bd,
      el(
        'p',
        'hint',
        'Live Q&A is off while this meeting is active. End and save the transcript first; then ask from the cited notes in Counsel chat.',
      ),
    );

    /* --- ending the call: the only write this surface makes -------------- */
    const acts = el('div', 'acts');
    const end = btn('btn p', CALL.saving ? 'Saving…' : 'End call & save', endCall);
    end.disabled = CALL.saving;
    const discard = btn('btn g', 'Discard', discardCall);
    discard.disabled = CALL.saving;
    add(acts, end, discard);
    add(bd, acts);
    if (CALL.attachedMeeting) {
      add(
        bd,
        el(
          'p',
          'hint',
          `Attached to ${CALL.attachedMeeting.provider} from the local window title “${CALL.attachedMeeting.title}”. ` +
            'Attachment does not route system audio: Counsel is still transcribing this microphone only.',
        ),
      );
    }

    add(
      bd,
      el(
        'p',
        'hint',
        'Ending the call sends the transcript to the daemon, which redacts anything that looks like a secret ' +
          'before it writes the file. Discard keeps nothing at all.',
      ),
    );

    add(ov, bd);

  }

  function stopEngine(discard = false, session = CALL) {
    if (!session) return Promise.resolve(true);
    session.want = false;
    const rec = session.recognition;
    if (discard) {
      session.endResolve?.(false);
      session.endResolve = null;
      session.running = false;
      session.enginePending = false;
      try { rec?.abort(); } catch { /* already stopped */ }
      return Promise.resolve(false);
    }
    if (!rec || (!session.running && !session.enginePending)) return Promise.resolve(true);
    if (session.endPromise) return session.endPromise;
    session.endPromise = new Promise(resolve => {
      let settled = false;
      let timer;
      const done = complete => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        session.running = false;
        session.enginePending = false;
        session.endResolve = null;
        if (!complete) {
          session.captureIncomplete = true;
          try { rec.abort(); } catch { /* already stopped */ }
        }
        resolve(complete);
      };
      session.endResolve = done;
      timer = window.setTimeout(() => done(false), 2500);
      try { rec.stop(); } catch { done(false); }
    });
    return session.endPromise;
  }

  function teardownCall() {
    if (!CALL) return;
    void stopEngine(true);
    if (CALL.tick) window.clearInterval(CALL.tick);
    if (CALL.meetingTick) window.clearInterval(CALL.meetingTick);
    CALL.ov.remove();
    CALL = null;
    delete document.body.dataset.zenoCapture;
    renderAsk();
  }

  function discardCall() {
    if (!CALL || CALL.saving) return;
    // Discarding throws away the whole recording, transcript and notes — there is
    // no undo and nothing is written to Vault. Confirm before tearing it down so a
    // mis-click during a live meeting cannot silently lose it.
    const heard = Array.isArray(CALL.lines) ? CALL.lines.length : 0;
    const warn = 'Discard this recording?\n\nThe transcript' + (heard ? ' (' + heard + ' line' + (heard === 1 ? '' : 's') + ' so far)' : '')
      + ' and any notes are dropped and nothing is saved to Vault. This cannot be undone.';
    if (typeof window.confirm === 'function' && !window.confirm(warn)) return;
    teardownCall();
    announce('Recording discarded. Nothing was saved.');
  }

  /**
   * End the call. The overlay stays up, still saying "Saving…", until the daemon
   * answers: a call is not saved because a button was pressed, it is saved
   * because POST /counsel/meetings returned the meeting it actually wrote.
   */
  async function endCall() {
    if (!CALL || CALL.saving) return;
    const session = CALL;
    session.saving = true;
    renderOverlay();
    await stopEngine(false, session);
    if (CALL !== session) return;
    if (CALL.utterances.length === 0) {
      CALL.saving = false;
      CALL.note = 'Nothing was transcribed, so there is nothing to save. Discard the call, or start it again.';
      CALL.noteTone = 'warn';
      renderOverlay();
      return;
    }
    CALL.saving = true;
    renderOverlay();

    const r = await call('POST', '/counsel/meetings', {
      title: CALL.title,
      participants: CALL.participants,
      utterances: CALL.utterances.map((u) => ({ id: u.id, at: u.at, speaker: u.speaker, text: u.text })),
    });

    if (CALL !== session) return;
    if (!r.ok) {
      // The transcript is still in hand and still recoverable, and nothing is
      // claimed to be on disk that is not.
      CALL.saving = false;
      CALL.note = `Not saved: ${r.message} ${r.resolve}`.trim();
      CALL.noteTone = 'error';
      renderOverlay();
      return;
    }

    const saved = r.data && r.data.meeting;
    if (
      !saved ||
      typeof saved.id !== 'string' ||
      saved.id.trim() === '' ||
      !Array.isArray(saved.utterances) ||
      saved.utterances.length !== session.utterances.length
    ) {
      // HTTP success is only transport success. Without the stored meeting —
      // including every line the owner just captured — this window cannot say
      // the write completed. Keep the transcript in hand and freeze no state.
      CALL.saving = false;
      CALL.note =
        'Save outcome unknown: the daemon answered without a complete saved-meeting record. Your transcript is still in this window. Check the archive before trying again.';
      CALL.noteTone = 'error';
      renderOverlay();
      return;
    }
    const redacted = (r.data && r.data.redacted) || 0;
    teardownCall();
    announce(session.captureIncomplete ? 'Call saved. The final microphone result did not settle before timeout; the final phrase may be incomplete.' : 'Call saved.');
    await loadArchive();
    if (saved && saved.id) {
      cache.set(saved.id, saved);
      await select(saved.id);
      // After select(), which clears it — a redaction count belongs to THIS save
      // and must not survive onto the next call the owner opens.
      if (redacted > 0 && S.selected === saved.id) {
        S.redactedNote = badBlock(
          `${redacted} secret-like string${redacted === 1 ? ' was' : 's were'} redacted before this call was written to disk.`,
          'The sanitizer runs over every spoken line before it becomes a file, and the summary was computed from the redacted text.',
          false,
        );
        renderCall();
      }
    }
  }

  /* =================================================================== *
   * F · the two shared blocks                                           *
   * =================================================================== */

  function emptyBlock(glyph, title, sub) {
    const w = el('div', 'cnempty');
    add(w, el('span', 'cnempty-glyph', glyph));
    const d = el('div');
    add(d, el('p', 'cnempty-t', title), el('p', 'cnempty-s', sub));
    add(w, d);
    return w;
  }

  function badBlock(title, detail, hard) {
    const w = el('div', `cnbad${hard ? ' hard' : ''}`);
    add(w, el('p', null, title));
    if (detail) add(w, el('p', null, detail));
    return w;
  }

  /* =================================================================== *
   * G · boot                                                            *
   * =================================================================== */

  if (!OWNER_TOKEN) {
    // A window opened without the launch nonce is handed no token, and every
    // Counsel route is authenticated. Say that once, plainly, rather than
    // showing three panels that each fail with their own 401.
    S.archive = 'error';
    S.archiveNote =
      'This window was not handed an owner token, so the daemon refuses every Counsel route. Open the window ' +
      'from the Zeno launch link rather than by typing the address.';
  }

  if (!SpeechRecognition) {
    // Never pretend to a microphone we do not have. The dashboard still works;
    // only capture is impossible, and the control says why rather than failing.
    startBtn.disabled = true;
    startBtn.title = 'This browser has no Web Speech API, so Counsel cannot record here.';
    add(
      head,
      el(
        'p',
        'hint',
        'This browser has no Web Speech API, so a call cannot be recorded here — Zeno will not fake a ' +
          'microphone it does not have. Reading, summarising and asking about saved calls all still work.',
      ),
    );
  }

  renderCalls();
  renderCall();
  renderAsk();
  if (OWNER_TOKEN) loadArchive();

  // Recording outlives the tab: if the owner switches to Command mid-call the
  // light must stay on, which is why the overlay lives on <body>. A page unload
  // while a call is in hand would really lose it, so the browser is asked to ask.
  window.addEventListener('beforeunload', (e) => {
    if (CALL && CALL.utterances.length > 0 && !CALL.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* nav.js calls mod.init || mod.default; the brief names the export initCounsel. */
export { initCounsel as init };
export default initCounsel;
