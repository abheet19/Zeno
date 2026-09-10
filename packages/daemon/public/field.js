/*
 * field.js — the Standing Field.
 *
 * The canvas engine below is the Gate-2 prototype's, ported: projPt · lay ·
 * sphere · attCol · attPri · attPulse · the edge pass · draw · loop · pick ·
 * the label-placement pass. Rules, constants and easing curves are the
 * prototype's values, not re-derived ones — the field is meant to look like
 * itself, and it is the one thing in this window that is a picture rather than
 * a readout.
 *
 * WHAT IS NOT PORTED is the prototype's data. Every node here is built from
 * live daemon state — GET /state, /work, /forge/status, /memory,
 * /counsel/meetings and /forge/agents — and when a category is empty the field
 * simply shows fewer nodes. Nothing is invented to fill a hole: a quiet field
 * is the honest picture of a quiet system, and it says so in words rather than
 * drawing a busy one. There is no Jira node, no merge-request node and no
 * teammate node, because there is no Jira, no merge request and no team.
 *
 * GLOW = state · LINKS = relationship · SIZE and PULSE RATE = how much a thing
 * wants you. A dashed amber edge with a ⚡ is an egress edge: a link that
 * actually leaves this machine. THE LOCAL MODEL RUNTIME IS NOT ONE. Ollama
 * answers on 127.0.0.1:11434, so it is drawn with an ordinary edge; only a
 * genuinely off-machine source — GitHub, a hosted agent — earns the ⚡.
 *
 * Exports init(section): mounts the canvas into [data-mount="field"], fetches
 * state, renders, and refreshes on the daemon's stream signal (with a slow poll
 * as a floor). It also writes the masthead, the hero chips, the tally, the rail
 * counts and the journey breadcrumb — every one of them from the same fetch, so
 * the whole surface can never disagree with itself.
 */

import { pendingRepoEdge, ticketAction } from './field-model.js';

const R = document.documentElement;

// ---- auth: the same token the page was handed (empty for a read-only shell) --
function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return (m && m.getAttribute('content')) || '';
}
function authHeaders() {
  const t = token();
  return t ? { 'x-zeno-token': t } : {};
}
async function getJSON(path) {
  const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

/* ---- per-device preference, stored locally and never synced ---------------- */
function st(k, v) { try { localStorage.setItem('zeno-' + k, v); } catch { /* storage off */ } }
function ld(k) { try { return localStorage.getItem('zeno-' + k); } catch { return null; } }

/* ---- motion honesty -------------------------------------------------------
   THREE states, exactly like a theme toggle, because two is what broke it:

     data-reduce="1"   the owner said no motion
     data-reduce="0"   the owner said yes motion — and this must beat the OS
     unset             no choice made: follow the system

   Consulting prefers-reduced-motion AFTER an explicit "0" let the OS veto the
   owner, so on a machine with reduce-motion set system-wide the field could
   never be turned back on and simply looked broken. The system preference is
   the DEFAULT, not the verdict. */
function motionOn() {
  const explicit = R.getAttribute('data-reduce');
  if (explicit === '1') return false;
  if (explicit === '0') return true;
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch { /* no matchMedia */ }
  return true;
}

const S = { motion: true, sel: null, lock: false, fieldList: false };
const F = { c: null, x: null, rot: 0.62, tilt: 0.34, tilt0: 0.34, drag: 0, raf: 0, hov: null, W: 0, H: 0, mx: 0, my: 0, ro: null, init: 0, _m: 0 };

/* Settle the attribute ONCE at boot from the stored choice, falling back to the
   OS. Without this the control started life claiming aria-pressed="false" —
   "motion is on" — on a machine where motion was in fact off, so the first
   click was a no-op that only made the button agree with reality. */
function bootMotion() {
  const stored = ld('mo');
  if (stored === '0' || stored === '1') R.setAttribute('data-reduce', stored === '1' ? '0' : '1');
  else {
    let osReduce = false;
    try { osReduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* none */ }
    if (osReduce) R.setAttribute('data-reduce', '1');
  }
  S.motion = motionOn();
}

// N = nodes, E = edges, ACT = the ids that are genuinely live right now.
let N = [];
let E = [];
let ACT = [];
let EMPTY_NOTE = null; // a truthful sentence when the field is nearly empty

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
function cv(v) {
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
function rgba(h, a) {
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
function attCol(a) {
  return a === 'needs' ? cv('--amber')
    : (a === 'blocked' || a === 'error') ? cv('--red')
      : a === 'active' ? cv('--cyan')
        : a === 'verified' ? cv('--green')
          : a === 'waiting' ? cv('--ink-3') : null;
}
/* priority: what should grab you FIRST (higher = more urgent for YOU) */
function attPri(a) { return a === 'error' ? 5 : a === 'needs' ? 4 : a === 'blocked' ? 3 : a === 'active' ? 2 : a === 'verified' ? 1 : 0; }
/* each state breathes differently — the rhythm itself tells you the mood */
function attPulse(a, t) {
  if (!S.motion) return 1;
  if (a === 'needs') return 1 + 0.26 * Math.sin(t * 3.4);             // urgent, quick
  if (a === 'error') return 1 + 0.34 * Math.max(0, Math.sin(t * 6.2)); // sharp flash
  if (a === 'blocked') return 1 + 0.15 * Math.sin(t * 1.3);           // slow, labored — "stuck"
  if (a === 'active') return 1 + 0.11 * Math.sin(t * 2.2);            // gentle working
  return 1;                                                            // verified / waiting = calm
}
function urgOf(n) { return Math.min(1, (n.ageMin || 0) / 720); } // maxes out at ~12h waiting
function ageStr(m) { return m == null ? '' : m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd'; }
function neighborsOf(id) { const s = {}; for (const e of E) { if (e[0] === id) s[e[1]] = 1; if (e[1] === id) s[e[0]] = 1; } return s; }
function g(id) { return N.find((n) => n.id === id); }
function attOf(n) { return n.att || null; }
function minutesSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}

/* ---- geometry: a deterministic fibonacci sphere, core at the centre --------
   The prototype hand-placed seventeen known nodes. We cannot: the node list is
   whatever the daemon actually holds. A golden-angle sphere is the honest
   substitute — any count reads as an even, organic constellation rather than a
   grid, and the same state always produces the same picture. */
function placeNodes(list) {
  const rest = list.length - 1;
  const GA = Math.PI * (3 - Math.sqrt(5));
  list.forEach((n, i) => {
    if (i === 0) { n.hx = 0; n.hy = 0; n.hz = 0; }
    else {
      const k = i - 1;
      const y = rest <= 1 ? 0 : 1 - (k / (rest - 1)) * 2; // -1..1
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * k;
      n.hx = Math.cos(th) * rad * 0.9;
      n.hy = y * 0.84;
      n.hz = Math.sin(th) * rad * 0.9;
    }
    n.ph = i * 2.399963; // golden-angle phases: organic, non-repeating drift
    n.x = n.hx; n.y = n.hy; n.z = n.hz;
  });
}

/* ---- the honest topology: real daemon state -> nodes + edges --------------- */

/* The kinds drawn in the live cyan: a surface, a work source, and the local
   model runtime. Everything else — a repo, a device, a ticket, a memory, a
   meeting, an installed model — is a thing at rest and reads neutral. */
const LIVE_K = { agent: 1, src: 1, runtime: 1 };

/* What the node card calls each kind. Without this, a new kind printed its own
   internal key at the reader ("mem", "meet", "ml") as if that were a word. */
const KIND_WORD = {
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
};

function sourceAtt(s) {
  // ok and not-configured are calm — a source you never asked is not a problem.
  return s.state === 'failed' ? 'error' : s.state === 'partial' ? 'needs' : null;
}
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function buildTopology(state, work, forge, mem, meetings, agents) {
  const nodes = [];
  const edges = [];
  const act = [];

  // 1 · the core — always true: this is the daemon you are talking to.
  nodes.push({
    id: 'core', l: 'Zeno', k: 'core',
    d: 'The coordinating core — the gate every consequential effect passes through. It proposes nothing and approves nothing on its own.',
  });

  // 2 · the three products — real surfaces this daemon actually serves.
  nodes.push({ id: 'command', k: 'agent', l: 'Command', nav: 'command', d: 'The approval surface. Every consequential effect stops here for your yes, with its payload, tier and hash binding shown in full.' });
  nodes.push({ id: 'forge', k: 'agent', l: 'Forge', nav: 'forge', d: 'The governed coding surface over the sandbox repo. It can propose a change; it cannot approve its own output.' });
  nodes.push({ id: 'counsel', k: 'agent', l: 'Counsel', nav: 'counsel', d: 'The consent-first meeting surface. The desktop uses local Whisper when installed; browser fallback may send microphone audio to the browser speech provider. Saved transcript text stays on this machine and detected secrets are redacted first.' });
  edges.push(['core', 'command'], ['core', 'forge'], ['core', 'counsel']);

  // 3 · this machine — honestly, the one device that exists.
  nodes.push({ id: 'dev', k: 'dev', l: 'This PC', d: 'The Windows host this daemon runs on. Trust is per-device and earned: this is the only device on the mesh.' });
  edges.push(['core', 'dev']);

  // 4 · the sandbox repo, if the daemon reports one.
  const changed = (forge && Array.isArray(forge.changed)) ? forge.changed.length : 0;
  if (forge && forge.repo) {
    const branch = forge.branch || 'sandbox';
    nodes.push({
      id: 'repo', k: 'repo', l: clip(branch, 17),
      att: changed > 0 ? 'active' : null,
      d: `The Forge sandbox repository on ${branch}${forge.head ? ' @ ' + String(forge.head).slice(0, 7) : ''} — ${changed ? `${changed} uncommitted change${changed === 1 ? '' : 's'}` : 'clean'}.`,
    });
    edges.push(['core', 'repo'], ['forge', 'repo']);
    if (changed > 0) { act.push('repo', 'forge'); }
  }

  // 5 · work sources — real intake, with the state the daemon actually reports.
  //     A source that is CONFIGURED but did not fully answer is drawn as srcq:
  //     a source you can cite but cannot rely on. An edge to a source that
  //     genuinely leaves this machine is an EGRESS edge — dashed amber, ⚡.
  const sources = (work && Array.isArray(work.sources)) ? work.sources : [];
  sources.forEach((s, i) => {
    const id = 'src' + i;
    const configured = s.state !== 'not-configured';
    const shaky = s.state === 'failed' || s.state === 'partial';
    const leaves = configured && s.name !== 'local';
    nodes.push({
      id, k: shaky ? 'srcq' : 'src', l: clip(s.name || `source ${i + 1}`, 18),
      att: sourceAtt(s),
      d: s.detail || `Work source · ${s.state}${s.count == null ? '' : ` · ${s.count} item${s.count === 1 ? '' : 's'}`}. A source is read-only: it can be cited, never obeyed.`,
    });
    // the third element marks the edge as egress, exactly as in the prototype
    edges.push(leaves ? ['core', id, 'eg'] : ['core', id]);
  });

  // 6 · pending approvals — the things actually waiting on you.
  const pending = (state && Array.isArray(state.pending)) ? state.pending : [];
  pending.forEach((p, i) => {
    const id = 'pend' + i;
    const summary = p.summary || (p.request && p.request.summary) || p.actionHash || `pending ${i + 1}`;
    nodes.push({
      id, k: 'ticket', l: clip(summary, 26), hash: p.actionHash,
      /* Attention comes from what the capsule ACTUALLY carries. A /state
         pending item exposes { actionHash, auto, binding, denied, payload,
         reasons, summary, tier } and NO `state` field — so reading p.state made
         every waiting approval fall through to "waiting" and draw calm grey.
         The single most urgent thing in the product was the one thing that
         never lit up. Being IN this list IS the fact: it is waiting on you. */
      att: p.denied ? 'error' : 'needs',
      /* No ageMin: nothing in the pending record carries a timestamp, and an
         invented one would be a lie told in the most load-bearing place on the
         screen. urgOf() reads 0 and the glow sits at its base strength. */
      d: p.denied
        ? `${summary} — refused by policy${p.tier ? ` at tier ${p.tier}` : ''}. ${(p.reasons || []).join(' · ') || 'No reason was recorded.'}`
        : `${summary} — tier ${p.tier || '?'}, waiting for your approval. Opening it is not approving it.`,
    });
    edges.push(['core', id], ['command', id]);
    const repoEdge = pendingRepoEdge(id, forge);
    if (repoEdge) edges.push(repoEdge);
  });

  // 7 · the live backlog — real work items, each hung off the source it came from.
  const items = (work && Array.isArray(work.items)) ? work.items : [];
  items.slice(0, 6).forEach((it, i) => {
    const id = 'wi' + i;
    const title = it.title || it.id || 'item';
    const age = minutesSince(it.updatedAt);
    nodes.push({
      id, k: 'ticket', l: clip(title, 22), att: 'waiting', work: true,
      ageMin: age == null ? undefined : age,
      d: `${title} — from ${it.source || 'the backlog'}${age == null ? '' : `, last touched ${ageStr(age)} ago`}. Assigned, not started: Zeno is holding it, not working it.`,
    });
    const si = sources.findIndex((s) => s.name === it.source);
    edges.push([id, si >= 0 ? 'src' + si : 'core']);
  });

  // 8 · the trail — the last few receipts Zeno actually wrote, verified or not.
  const receipts = (state && Array.isArray(state.receipts)) ? state.receipts : [];
  receipts.slice(-4).forEach((r, i) => {
    const id = 'rc' + i;
    const ok = (r.outcome || r.state) === 'verified';
    const lab = r.summary || r.targetRef || r.actionHash || 'receipt';
    const age = minutesSince(r.at);
    nodes.push({
      id, k: 'ticket', l: clip(lab, 22), att: ok ? 'verified' : 'error',
      ageMin: age == null ? undefined : age, receipt: true,
      d: `${lab} — ${r.outcome || r.state || 'outcome not recorded'}${r.tier ? ` · tier ${r.tier}` : ''}${age == null ? '' : ` · ${ageStr(age)} ago`}. Signed and chained; the seal rendered after the receipt, never before it.`,
    });
    edges.push(['core', id]);
  });

  // 9 · governed memory — the Vault, and the notes actually in it.
  //     The hub node exists only when GET /memory ANSWERED: a daemon started
  //     with no vault directory 404s, and drawing an empty Vault there would
  //     claim a store this machine does not have. Notes are facts at rest, so
  //     they carry no attention state — nothing in the Vault is asking for you.
  const notes = (mem && Array.isArray(mem.notes)) ? mem.notes : [];
  if (mem) {
    nodes.push({
      id: 'vault', k: 'vault', l: 'Vault',
      d: `Governed local memory — ${notes.length} note${notes.length === 1 ? '' : 's'} the daemon returned on this read, each a file on this disk, redacted for secrets before it was written.`,
    });
    edges.push(['core', 'vault']);
    notes.slice(0, 6).forEach((n, i) => {
      const id = 'mem' + i;
      const age = minutesSince(n.updatedAt || n.createdAt);
      const tags = Array.isArray(n.tags) ? n.tags : [];
      nodes.push({
        id, k: 'mem', l: clip(n.title || n.id || 'a note', 22),
        d: `${n.title || n.id || 'A note'} — from ${n.source || 'an unrecorded source'}${age == null ? '' : `, last touched ${ageStr(age)} ago`}${tags.length ? ` · ${tags.join(', ')}` : ''}. A remembered fact, not a task: it is not waiting on you.`,
      });
      edges.push([id, 'vault']);
    });
  }

  // 10 · past meetings — hung off Counsel, which is the surface that owns them.
  //      No hub is invented: the Counsel node already exists above.
  const mtgs = (meetings && Array.isArray(meetings.meetings)) ? meetings.meetings : [];
  mtgs.slice(0, 5).forEach((m, i) => {
    const id = 'mt' + i;
    const age = minutesSince(m.endedAt || m.startedAt);
    const c = (m && typeof m.counts === 'object' && m.counts) || {};
    nodes.push({
      id, k: 'meet', l: clip(m.title || m.id || 'a meeting', 22),
      ageMin: age == null ? undefined : age,
      d: `${m.title || m.id || 'A meeting'} — ${c.lines == null ? 'a recording' : `${c.lines} line${c.lines === 1 ? '' : 's'}`}${c.decisions ? `, ${c.decisions} decision${c.decisions === 1 ? '' : 's'}` : ''}${c.actions ? `, ${c.actions} action${c.actions === 1 ? '' : 's'}` : ''}${age == null ? '' : ` · ${ageStr(age)} ago`}. Saved and summarised as local Markdown; credential-like secrets were redacted before persistence.`,
    });
    edges.push([id, 'counsel']);
  });

  // 11 · the LOCAL model runtime, and the models actually installed on it.
  //      OLLAMA IS ON THIS MACHINE, so this edge is an ordinary one — never the
  //      dashed amber egress edge. Only a link that genuinely leaves the machine
  //      gets that, and this one does not leave 127.0.0.1.
  //
  //      The node appears only when at least one model came back. /forge/agents
  //      returns an empty list both when Ollama is stopped and when it is
  //      running with nothing pulled, so an empty answer cannot honestly be
  //      drawn as a runtime that is there — the field is simply quieter.
  const models = (agents && Array.isArray(agents.localModels)) ? agents.localModels : [];
  if (models.length) {
    nodes.push({
      id: 'runtime', k: 'runtime', l: 'Local models',
      d: `Ollama on 127.0.0.1:11434 — it answered with ${models.length} installed model${models.length === 1 ? '' : 's'}. A local run reaches nothing outside this machine, so this link is not an egress.`,
    });
    edges.push(['core', 'runtime'], ['forge', 'runtime']);
    models.slice(0, 6).forEach((m, i) => {
      const id = 'ml' + i;
      nodes.push({
        id, k: 'model', l: clip(m, 20),
        d: `${m} — installed locally and pickable in Forge. It runs on this machine; nothing it is asked leaves it.`,
      });
      edges.push([id, 'runtime']);
    });
  }

  placeNodes(nodes);
  N = nodes; E = edges;
  // "live" is what is genuinely in flight, so a live edge means both ends are
  // actually doing something. With nothing running the set is empty and no edge
  // is highlighted — which is the correct picture of a system at rest.
  ACT = act.length ? act.concat(['core']) : [];

  // The empty note is only true when the whole machine is quiet, so it counts
  // everything the field can now draw — not just the things that want you.
  const liveThings = pending.length + sources.filter((s) => s.state !== 'not-configured').length
    + (changed ? 1 : 0) + items.length + notes.length + mtgs.length + models.length + receipts.length;
  // An empty field has two causes and they are not the same fact. "Quiet" is a
  // statement about a daemon that ANSWERED; when the reads that feed this field
  // failed, the field is empty because nothing could be read, and calling that
  // quiet would be the masthead's old lie repeated on the map.
  const unread = !!((state && state.unread) || (work && work.unread) || (forge && forge.unread));
  EMPTY_NOTE = liveThings !== 0
    ? null
    : unread
      ? 'The field is empty because the daemon could not be read — not because nothing is there. Whatever Zeno is holding is unknown from this window until the read succeeds.'
      : 'A quiet field — nothing is waiting on you. Approvals, work sources, memory, meetings, local models and repo activity appear here as they arrive.';
}

/* ===== the prototype's canvas engine, ported ================================ */
function projPt(px, py, pz) {
  const cr = Math.cos(F.rot), sr = Math.sin(F.rot), ct = Math.cos(F.tilt), st2 = Math.sin(F.tilt);
  const x = px * cr - pz * sr, z = px * sr + pz * cr, y = py * ct - z * st2, zz = py * st2 + z * ct, p = 1 / (1.85 - zz * 0.46);
  return { x: x * p, y: y * p, d: zz, p };
}
function proj(n) { return projPt(n.x, n.y, n.z); }
function lay(t) {
  const wide = F.W > 820;
  const pad = Math.min(F.W * (wide ? 0.27 : 0.34), F.H * (wide ? 0.88 : 0.72));
  const cx = F.W * (wide ? 0.655 : 0.50), cy = F.H * (wide ? 0.51 : 0.48);
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

function draw() {
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
  const gy = F.H * 0.47 + Math.min(F.W * 0.30, F.H * 0.62) * 0.92;
  const gg = c.createRadialGradient(F.W * 0.5, gy, 2, F.W * 0.5, gy, Math.min(F.W * 0.34, 190));
  gg.addColorStop(0, lightTheme ? 'rgba(23,26,30,.13)' : 'rgba(0,0,0,.55)');
  gg.addColorStop(1, 'rgba(0,0,0,0)');
  c.save(); c.translate(F.W * 0.5, gy); c.scale(1, 0.17); c.translate(-F.W * 0.5, -gy);
  c.beginPath(); c.arc(F.W * 0.5, gy, Math.min(F.W * 0.34, 190), 0, 7); c.fillStyle = gg; c.fill(); c.restore();

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
    const d = dep(n), base = (n.k === 'core' ? 9.8 : 6.0);
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
      const txt = S.lock ? (n.k === 'core' ? 'core' : n.k) : n.l;
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
  if (EMPTY_NOTE) {
    c.globalAlpha = 0.85; c.fillStyle = cv('--ink-3');
    c.font = '500 11px "IBM Plex Mono",monospace'; c.textAlign = 'center';
    wrapText(c, EMPTY_NOTE, F._cx || F.W / 2, F.H - 46, Math.min(F.W - 48, 360), 15);
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

/* ---- animation + sizing (the prototype's, verbatim) ----------------------- */
function loop() {
  if (!F.c || !F.c.isConnected) { F.raf = 0; return; }
  if (!F.drag && S.motion) { F.rot += 0.0016; F.tilt = F.tilt0 + Math.sin(performance.now() / 6400) * 0.055; }
  draw(); F.raf = requestAnimationFrame(loop);
}
function stopF() { if (F.raf) { cancelAnimationFrame(F.raf); F.raf = 0; } if (F.init) { clearTimeout(F.init); F.init = 0; } }
function startF() { if (!F.raf && F.c && F.c.isConnected && S.motion) F.raf = requestAnimationFrame(loop); }
function size() {
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
function fieldOn() {
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
  if (S.motion) F.raf = requestAnimationFrame(loop); else draw();
}
function pick(x, y) { let b = null, bd = 20; N.forEach((n) => { const d = Math.hypot(n.sx - x, n.sy - y); if (d < bd) { bd = d; b = n; } }); return b; }

/* ---- interaction: drag to turn, hover to trace, click to inspect ---------- */
function wire(el) {
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

/* ---- the node card: what the prototype shows when you pick something ------ */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

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
 * before this function on every refresh (see line ~945), so the slot is always
 * there to fill. */
function cardHost() {
  if (S.fieldList) {
    const slot = document.querySelector('[data-slot="node-card-list"]');
    if (slot) return slot;
  }
  return document.querySelector('[data-mount="node-card"]');
}

function renderNodeCard() {
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
    /* Both of these SCROLL — `jump()` moves the page to a section and does
       nothing else. "Open the receipt" therefore promised something it did not
       do: it landed you on a list of every receipt with no drawer opened and no
       sign of which one you had picked. A control that names an effect it does
       not have is the same failure as a number with no source, so it is named
       for what it actually does. Opening the receipt itself is one more click,
       on the row's own "receipt ›". */
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

/* ---- the list equivalent: the same field, read rather than rotated -------- */
function renderList(listEl) {
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
    + (EMPTY_NOTE ? `<p class="field-empty">${esc(EMPTY_NOTE)}</p>` : '');
  listEl.querySelectorAll('.flrow').forEach((b) => b.addEventListener('click', () => {
    S.sel = b.getAttribute('data-id'); syncList(); renderNodeCard(); if (!F.raf) draw();
  }));
}
function syncList() {
  document.querySelectorAll('.flrow').forEach((b) => b.setAttribute('aria-selected', b.getAttribute('data-id') === S.sel ? 'true' : 'false'));
}

/* ---- the masthead, chips, tally, rail counts and breadcrumb ---------------
   All written from ONE fetch, so no two readouts on this surface can disagree.
   Every number here counts something the daemon actually reported. */
function setText(mount, v) { const e = document.querySelector(`[data-mount="${mount}"]`); if (e) e.textContent = v == null ? '' : String(v); }

function renderReadouts(state, work, forge, mem, agents) {
  const pending = (state && Array.isArray(state.pending)) ? state.pending : [];
  const receipts = (state && Array.isArray(state.receipts)) ? state.receipts : [];
  const items = (work && Array.isArray(work.items)) ? work.items : [];
  const sources = (work && Array.isArray(work.sources)) ? work.sources : [];
  const changed = (forge && Array.isArray(forge.changed)) ? forge.changed.length : 0;
  const needs = pending.filter((p) => !p.denied).length;
  const denied = pending.length - needs;
  const verified = receipts.filter((r) => (r.outcome || r.state) === 'verified').length;
  const liveSources = sources.filter((s) => s.state !== 'not-configured').length;
  /* WHAT CAN LEAVE THIS MACHINE — counted by the same rule the Integrations
     panel uses to paint its amber ⚡ rows, so the masthead and that panel can
     never disagree. Two kinds qualify:

       · a work source that is somewhere else AND is switched on (an unasked
         GitHub is marked "would leave — nothing has been sent" there, not
         amber, so it does not count here either); and
       · every coding agent the daemon offers whose id is not "local" — those
         run their own CLI against their own provider.

     Counting only the first kind was the bug: this chip read a green "0 egress
     sources" on a page that was, three sections lower, marking Claude Code
     "⚡ reaches its own provider". A masthead that under-reports the ways out
     of this machine is the one number here that must never be optimistic. */
  const egressSources = sources.filter((s) => s.state !== 'not-configured' && s.name !== 'local').length;
  const egressAgents = (agents && Array.isArray(agents.agents))
    ? agents.agents.filter((a) => a && a.id !== 'local').length
    : 0;
  const egress = egressSources + egressAgents;

  /* WHICH READS ACTUALLY ANSWERED. A count may only be printed by the read that
     produced it: `unread` marks the fallback shape refresh() substitutes when a
     fetch failed, and a zero from that shape is not a zero — it is an absence of
     an answer. Nothing below prints a number whose read did not return. */
  const stateUnread = !!(state && state.unread);
  const workUnread = !!(work && work.unread);
  const forgeUnread = !!(forge && forge.unread);

  /* the masthead — the headline IS the count, so it may only be said when the
     count is known. "Nothing is waiting on you." is the most reassuring sentence
     in the product; saying it because /state could not be reached is the single
     worst thing this page can do, and it is the one it used to do. */
  const h = document.querySelector('[data-mount="hero-headline"]');
  if (h) {
    h.textContent = stateUnread
      ? 'The daemon did not answer.'
      : needs === 0
        ? 'Nothing is waiting on you.'
        : `${needs} ${needs === 1 ? 'decision is' : 'decisions are'} waiting on you.`;
  }
  const sub = document.querySelector('[data-mount="hero-sub"]');
  if (sub) {
    sub.textContent = stateUnread
      ? 'This window could not read the approval queue, so it does not know whether anything is waiting. Treat this as unknown, not as clear — work may well be held. The same queue is readable from the CLI.'
      : needs === 0
        ? 'Every consequential effect stops here first. Nothing has moved without your yes, and nothing is holding.'
        : 'Sealed, cited and hash-bound. Opening one is not approving it, and approving it starts nothing else.';
  }
  const eb = document.querySelector('[data-mount="hero-eyebrow"]');
  if (eb) {
    try { eb.textContent = 'Zeno Command · ' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
    catch { eb.textContent = 'Zeno Command · reason before action'; }
  }

  /* the three hero chips: what wants you, what is moving, what leaves the machine */
  const chips = document.querySelector('[data-mount="hero-chips"]');
  if (chips) {
    /* An unread count is drawn as "—", never as 0, and never green: a green zero
       is a claim, and this read has nothing to claim with. The chip keeps its
       place so the shape of the masthead does not move — what changes is only
       whether it is asserting a number or admitting it has none.
       The egress chip needs BOTH /work and /forge/agents; agents is a separate
       read, so it is unknown when either could not be counted. */
    const agentsUnread = !(agents && Array.isArray(agents.agents));
    const chip = (unread, n, cls, label) =>
      `<span class="hchip${unread ? ' un' : cls}"><i></i><b>${unread ? '—' : n}</b> ${label}</span>`;
    chips.innerHTML =
      chip(stateUnread, needs, needs ? ' am' : '', stateUnread ? 'unread' : (needs === 1 ? 'needs you' : 'need you'))
      + chip(forgeUnread, changed, changed ? ' cy' : '', forgeUnread ? 'sandbox unread' : `uncommitted ${changed === 1 ? 'change' : 'changes'}`)
      + chip(workUnread || agentsUnread, egress, egress ? ' am' : ' gr',
        (workUnread || agentsUnread) ? 'egress unknown' : `egress ${egress === 1 ? 'path' : 'paths'}`);
  }

  /* the tally under the hero */
  const tally = document.querySelector('[data-mount="tally"]');
  if (tally) {
    const parts = [];
    if (needs) parts.push(`<span class="am">${needs}</span> needs you`);
    if (denied) parts.push(`<span class="rd">${denied}</span> refused`);
    if (changed) parts.push(`<span class="cy">${changed}</span> in the sandbox`);
    if (items.length) parts.push(`<span>${items.length}</span> in the backlog`);
    if (verified) parts.push(`<span class="gr">${verified}</span> verified`);
    tally.innerHTML = parts.length ? parts.join('<span class="sep"></span>') : '<span>nothing outstanding</span>';
  }
  // "Zeno is holding nothing" is a claim about three reads. It may only be made
  // when all three answered; otherwise the honest line is that it is not known.
  setText('today-sub', (stateUnread || workUnread || forgeUnread)
    ? 'This window could not finish reading the daemon, so what Zeno is holding is unknown from here — not empty.'
    : (needs || items.length || changed)
      ? 'Everything Zeno is holding, and what it is waiting for.'
      : 'Zeno is holding nothing. Work, approvals and receipts appear here as they arrive.');

  /* the rail counts — blank, not zero: a "0" badge claims a queue that is not there */
  const railN = (mount, v, att) => {
    const e = document.querySelector(`[data-mount="${mount}"]`);
    if (!e) return;
    e.textContent = v ? String(v) : '';
    if (att && v) e.setAttribute('data-att', att); else e.removeAttribute('data-att');
  };
  railN('rail-today', needs + items.length, needs ? 'needs' : null);
  railN('rail-approvals', pending.length, needs ? 'needs' : null);
  // rail-devices is deliberately NOT written here. This module never reads
  // /mesh/devices, and it used to print a hard-coded 1 — a number asserted
  // rather than counted, which would have stayed 1 the day a second device
  // paired. mesh.js owns that badge because mesh.js is what reads the route.
  // The four rail items that used to be dead now carry the same kind of count:
  // an array length, or nothing. A source that could not be read contributes no
  // number at all rather than a zero that would claim it answered.
  // Uncommitted changes are IN the sandbox, not waiting on a yes, so this count
  // is never amber: amber on the rail means something wants a decision from you.
  railN('rail-workstation', changed);
  railN('rail-vault', (mem && Array.isArray(mem.notes)) ? mem.notes.length : 0);
  railN('rail-integrations', liveSources + ((agents && Array.isArray(agents.localModels)) ? agents.localModels.length : 0));

  /* the journey breadcrumb — where the work actually is, right now.
     A step is `done` only when the daemon reports the thing it names. */
  const j = document.getElementById('journey');
  if (j) {
    const done = {
      intake: liveSources > 0,
      context: items.length > 0 || changed > 0,
      approve: pending.length > 0,
      build: changed > 0,
      receipt: receipts.length > 0,
    };
    // "current" is the stage the system is actually sitting at; with nothing in
    // flight it rests on intake, which is the truth: waiting for work to arrive.
    const current = pending.length ? 'approve' : changed ? 'build' : items.length ? 'context' : 'intake';
    j.querySelectorAll('.stp').forEach((el) => {
      const k = el.getAttribute('data-step');
      el.classList.toggle('done', !!done[k]);
      if (k === current) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
  }
}

/* ---- public entry ---------------------------------------------------------- */

/* /forge/agents is the one read that makes the DAEMON reach out — it asks
   Ollama for its installed models. Every other read here is a local one, so
   this is the only one that is throttled: once at boot, then at most once a
   minute. A stale model list is a far smaller cost than polling a runtime four
   times a minute forever. */
const AGENTS_MIN_MS = 60000;
let AGENTS = null;
let agentsRead = false;   // a FAILED read counts as read, or a daemon that cannot
let agentsAt = 0;         // answer this route gets asked again every fifteen seconds

async function refresh(listEl) {
  const wantAgents = !agentsRead || (Date.now() - agentsAt) > AGENTS_MIN_MS;
  // Every read is settled on its own and every failure falls back to a shape
  // that contributes NO nodes. A daemon with no vault, no meeting archive or no
  // Ollama simply draws a smaller field — it never draws a guessed one.
  //
  // The fallbacks below are marked `unread`. Drawing NO node from a failed read
  // is right — the field must never draw a guessed one — but the same shapes are
  // handed to renderReadouts, which turned them into SENTENCES. An unreachable
  // daemon therefore printed "Nothing is waiting on you." and three green zeros
  // across the masthead: the most reassuring claim in the product, asserted from
  // a read that never happened, while the summary strip one section below still
  // (correctly) said 2 were waiting. `unread` is what lets a count tell the
  // difference between "none" and "not known" — the rule command.js states as H1
  // and keeps, and this file did not.
  const [state, work, forge, mem, meetings, agents] = await Promise.all([
    getJSON('/state').catch(() => ({ pending: [], receipts: [], unread: true })),
    getJSON('/work').catch(() => ({ sources: [], items: [], unread: true })),
    getJSON('/forge/status').catch(() => ({ repo: false, unread: true })),
    getJSON('/memory').catch(() => null),          // null = no vault, or unread: no node
    getJSON('/counsel/meetings').catch(() => null),
    wantAgents ? getJSON('/forge/agents').catch(() => null) : Promise.resolve(AGENTS),
  ]);
  if (wantAgents) { AGENTS = agents; agentsRead = true; agentsAt = Date.now(); }
  buildTopology(state, work, forge, mem, meetings, agents);
  renderReadouts(state, work, forge, mem, agents);
  if (S.sel && !g(S.sel)) S.sel = null;   // the thing you had selected is gone
  if (F.c) draw();
  renderList(listEl);
  renderNodeCard();
}

let started = false;
export function init(section) {
  if (started) return; started = true;
  const root = section || document.querySelector('[data-surface="command"]') || document;
  const mount = root.querySelector('[data-mount="field"]');
  if (!mount) return;
  mount.innerHTML =
    '<canvas id="field" role="img" aria-label="The Standing Field: an interactive map of Zeno\'s core, its three surfaces, this machine, the sandbox repository, work sources, pending approvals, recent receipts, the notes in your Vault, your recorded meetings, and the models installed on this machine\'s local runtime. Drag to rotate, click a node to inspect. A full list equivalent is behind the List button."></canvas>';
  F.c = mount.querySelector('#field');
  const listEl = root.querySelector('[data-mount="field-list"]');
  wire(F.c);
  fieldOn();
  refresh(listEl).catch(() => { /* the honest empty state stands if the fetch fails */ });

  /* the list toggle: the same nodes, read rather than rotated */
  const tog = document.getElementById('fl-t');
  if (tog && listEl) {
    tog.addEventListener('click', () => {
      S.fieldList = !S.fieldList;
      tog.setAttribute('aria-pressed', S.fieldList ? 'true' : 'false');
      tog.textContent = S.fieldList ? '▣ field' : '☰ list';
      listEl.hidden = !S.fieldList;
      listEl.classList.toggle('on', S.fieldList);
      renderNodeCard();
      // Stop burning frames on a canvas nobody can see; resume when it returns.
      if (S.fieldList) stopF(); else { size(); startF(); if (!F.raf) draw(); }
    });
  }

  /* node-card actions */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-clr]')) { S.sel = null; renderNodeCard(); syncList(); if (!F.raf) draw(); return; }
    const go = t.closest('[data-go]');
    if (go) {
      const nb = document.querySelector(`[data-nav="${go.getAttribute('data-go')}"]`);
      if (nb) nb.click();
    }
  });

  /* refresh on the daemon's own stream signal, with a slow poll as a floor */
  window.addEventListener('zeno:state', () => refresh(listEl).catch(() => {}));
  setInterval(() => { if (document.visibilityState === 'visible') refresh(listEl).catch(() => {}); }, 15000);

  /* A tab that comes back from the background has a cancelled rAF chain and a
     canvas painted from old state. Restart it rather than leaving a frozen picture. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !S.fieldList) { size(); startF(); if (!F.raf) draw(); }
  });

  /* keep motion honest if the OS setting changes mid-session — but only while
     the owner has made no explicit choice of their own. */
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      if (ld('mo') === '0' || ld('mo') === '1') return; // the owner has spoken
      R.removeAttribute('data-reduce');
      bootMotion();
      if (!S.motion) { stopF(); draw(); } else startF();
      syncControls();
    });
  } catch { /* no matchMedia */ }
}

export default { init };

/* ---- self-bootstrap: Command is the always-present surface ----------------- */
function boot() {
  const th = ld('th');
  if (th === 'dark' || th === 'light') R.setAttribute('data-theme', th);
  if (ld('fl') === '1') { R.setAttribute('data-flat', '1'); F.tilt0 = 0; F.tilt = 0; F.rot = 0; }
  bootMotion();
  const cmd = document.querySelector('[data-surface="command"]');
  if (cmd) { init(cmd); wireRail(cmd); }
  wireControls();
  syncControls();
}

/* Every top-bar control reports its real state at boot, not a hopeful default. */
function syncControls() {
  const m = document.getElementById('ctl-motion');
  if (m) m.setAttribute('aria-pressed', S.motion ? 'false' : 'true'); // pressed = "reduce motion" is ON
  const f = document.getElementById('ctl-flat');
  if (f) f.setAttribute('aria-pressed', R.getAttribute('data-flat') === '1' ? 'true' : 'false');
  const k = document.getElementById('ctl-mask');
  if (k) k.setAttribute('aria-pressed', S.lock ? 'true' : 'false');
}

function wireControls() {
  const theme = document.getElementById('ctl-theme');
  if (theme) theme.addEventListener('click', () => {
    const cur = R.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
    if (next) { R.setAttribute('data-theme', next); st('th', next); }
    else { R.removeAttribute('data-theme'); st('th', 'system'); }
    if (F.c) draw();
  });

  const motion = document.getElementById('ctl-motion');
  if (motion) motion.addEventListener('click', () => {
    // Three states, and the explicit choice persists so it survives a reload and
    // keeps beating the OS. "0" means motion ON even under system reduce-motion.
    S.motion = !S.motion;
    R.setAttribute('data-reduce', S.motion ? '0' : '1');
    st('mo', S.motion ? '1' : '0');
    syncControls();
    if (!S.motion) { stopF(); draw(); } else { startF(); }
  });

  const flat = document.getElementById('ctl-flat');
  if (flat) flat.addEventListener('click', () => {
    const on = R.getAttribute('data-flat') === '1';
    R.setAttribute('data-flat', on ? '0' : '1'); st('fl', on ? '0' : '1');
    F.tilt0 = on ? 0.34 : 0; F.tilt = F.tilt0; F.rot = on ? 0.62 : 0;
    syncControls(); if (!F.raf) draw();
  });

  const mask = document.getElementById('ctl-mask');
  if (mask) mask.addEventListener('click', () => {
    S.lock = !S.lock;
    R.setAttribute('data-lock', S.lock ? '1' : '0');
    syncControls(); if (F.c) draw();
  });

  const home = document.getElementById('home');
  if (home) home.addEventListener('click', () => {
    const nb = document.querySelector('[data-nav="command"]');
    if (nb) nb.click();
    // Go through the rail's own Today button rather than scrolling past it:
    // that way the selected pill follows the window home instead of still
    // pointing at whatever section you were reading when you left.
    const today = document.querySelector('.rail-n[data-jump="cmd-hero"]');
    if (today) { today.click(); return; }
    const hero = document.querySelector('.hero');
    if (hero && hero.scrollIntoView) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function wireRail(cmd) {
  const btns = cmd.querySelectorAll('.rail-n');
  /* One writer for the selected pill. Called by the rail's own buttons AND by
     the summary tiles below, which jump to the same sections — without this the
     rail went on claiming "Today & Attention" while you were reading Settings,
     and the selected state is the only thing on the rail that says where you
     are. Nothing else in this file touches aria-current on a .rail-n. */
  const select = (id) => {
    let hit = null;
    btns.forEach((x) => {
      const on = x.getAttribute('data-jump') === id;
      if (on) hit = x;
      if (on) x.setAttribute('aria-current', 'true');
      else x.removeAttribute('aria-current');
    });
    /* Under 820px the rail is a horizontally scrolling strip and the item you
       just activated is routinely off its right edge — a selected state you
       cannot see is not a selected state. Scroll the STRIP only: scrollIntoView
       on the button would drag the work column with it and undo the jump. */
    if (hit && hit.parentElement) {
      const nav = hit.parentElement;
      if (nav.scrollWidth > nav.clientWidth + 1) {
        const nr = nav.getBoundingClientRect();
        const br = hit.getBoundingClientRect();
        const pad = 12;
        if (br.left < nr.left + pad) nav.scrollLeft += br.left - nr.left - pad;
        else if (br.right > nr.right - pad) nav.scrollLeft += br.right - nr.right + pad;
      }
    }
  };
  btns.forEach((b) => b.addEventListener('click', () => {
    select(b.getAttribute('data-jump'));
    jump(b.getAttribute('data-jump'), cmd);
  }));
  // the node card's own jumps use the same resolver
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const j = t.closest('.nodecard [data-jump]');
    if (j) { select(j.getAttribute('data-jump')); jump(j.getAttribute('data-jump'), cmd); }
    // The summary tiles are app.js's and do their own scrolling; this listener
    // only keeps the rail honest about where that scroll landed. `#sec-vault`
    // and `sec-vault` are the same destination under two spellings.
    const g = t.closest('[data-goto]');
    if (g) {
      const sel = g.getAttribute('data-goto') || '';
      if (sel.charAt(0) === '#') select(sel.slice(1));
    }
  });
}
function jump(id, cmd) {
  if (!id) return;
  const t = id === 'cmd-hero' ? cmd.querySelector('.hero')
    : (cmd.querySelector('#' + id) || cmd.querySelector(`[data-mount="${id}"]`));
  if (!t) return;
  if (t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  /* Real keyboard focus, not just the viewport — the same rule the summary
     tiles keep. Without it the rail moved the page and left the next Tab back
     on the rail, so a keyboard owner could never actually reach the section the
     rail had just taken them to. Every destination carries tabindex="-1". */
  if (t.hasAttribute('tabindex') && t.focus) {
    try { t.focus({ preventScroll: true }); } catch { /* focus is a courtesy, never a failure */ }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
