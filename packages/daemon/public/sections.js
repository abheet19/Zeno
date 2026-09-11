/*
 * sections.js — the four Command sections that used to be dead rail items.
 *
 * The left rail promised nine destinations and delivered five. Today &
 * Attention, Workstation, Vault, Integrations and Settings all carried
 * data-jump="cmd-hero", so five of the nine scrolled you back to the field you
 * were already looking at. Half the navigation was decoration.
 *
 * This module builds the four that had no section at all. Today & Attention
 * keeps the hero — the dashboard top IS its destination — and the other four
 * now render live daemon state:
 *
 *   Workstation   GET /forge/status   branch, HEAD, uncommitted files, the last
 *                                     commits, and the tracked-file count with
 *                                     its cap stated. Acts: open it in Forge.
 *   Vault         GET /memory         recent notes, and a search box that asks
 *                 GET /memory?q=      the daemon's own recall — matched terms
 *                 GET /brief          and score shown, never a black box — plus
 *                                     today's brief with its missing sources.
 *   Integrations  GET /work           every work source with its TRUE state.
 *                 GET /forge/agents   the local model runtime and the agents the
 *                                     daemon offers. Each row states three
 *                                     things and never fewer: is it configured,
 *                                     is it reachable, and does it leave this
 *                                     machine.
 *   Settings      GET /state          the policy hash that actually governed the
 *                                     newest receipt, the chain's own verdict,
 *                                     the two capability tokens (presence only —
 *                                     no secret is ever put in the DOM), the
 *                                     per-device display preferences, and the
 *                                     daemon's real origin.
 *
 * THE RULES THIS FILE KEEPS, the same ones command.js and mesh.js keep:
 *
 *   S1  A section claims "empty" only after its read SUCCEEDED. Before the first
 *       answer it says it has not read the daemon; a failed read says the read
 *       failed. Neither is ever rendered as "there is nothing".
 *   S2  NOTHING IS INVENTED, and a missing data source is stated rather than
 *       stubbed. Installed skills are read from GET /skills. The MCP edge is a
 *       separate stdio process this window cannot see, so it says exactly that
 *       instead of drawing a plausible connection. The ledger PATH is likewise
 *       not served by any route, and this file never invents one.
 *   S3  It reads. Every fetch in this file is a GET; nothing here can approve,
 *       commit, delete or configure anything. The Vault search box is a GET to
 *       127.0.0.1 and the only control that sends anything at all.
 *   S4  No secret reaches the DOM. The owner token's PRESENCE is reported; its
 *       value is never rendered, never logged and never put in a title.
 *   S5  It writes into its own four mounts and nowhere else. The rail counts,
 *       the masthead and the tally belong to field.js — one writer per number.
 *
 * One writer per number, and no surface redacts what another surface shows.
 *
 * No framework, no bundler, no CDN, no build step, and no request that leaves
 * this machine.
 */

const R = document.documentElement;

/* ---- auth: the same token the page was handed (empty on a read-only shell) - */
function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' ? v.trim() : '';
}

/** One shape for every daemon call, the same one mesh.js and forge.js use. */
async function api(path) {
  const t = token();
  const headers = { accept: 'application/json' };
  if (t) headers['x-zeno-token'] = t;
  let res;
  try {
    res = await fetch(path, { headers, cache: 'no-store', credentials: 'same-origin' });
  } catch (err) {
    const msg = (err && err.message) || 'the daemon could not be reached';
    recordDiag(path, 'GET', 0, msg);
    return { ok: false, status: 0, data: null, error: { message: msg } };
  }
  const data = await res.json().catch(() => null);
  const result = {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : ((data && data.error) || { message: `The daemon answered ${res.status}.` }),
  };
  if (!result.ok) recordDiag(path, 'GET', result.status, result.error && result.error.message);
  return result;
}

/* The only NON-GET call this file makes: the owner writing their own memory note.
   Same token, same origin. POST /memory is owner-authorised and not gated — the
   owner IS the approval authority, so it is not a proposal (memory-routes.ts). An
   agent's memory still arrives as a capsule; this is only the owner's own note. */
async function apiWrite(path, payload) {
  const t = token();
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (t) headers['x-zeno-token'] = t;
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers, cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(payload) });
  } catch (err) {
    const msg = (err && err.message) || 'the daemon could not be reached';
    recordDiag(path, 'POST', 0, msg);
    return { ok: false, status: 0, data: null, error: { message: msg } };
  }
  const data = await res.json().catch(() => null);
  const result = {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : ((data && data.error) || { message: `The daemon answered ${res.status}.` }),
  };
  if (!result.ok) recordDiag(path, 'POST', result.status, result.error && result.error.message);
  return result;
}

/* The owner forgetting their own note. DELETE /memory/<id> is owner-only and, by
   design, leaves NO receipt — deleting your own memory is not an effect on the
   world (memory-routes.ts). So this is permanent and unrecoverable, which the UI
   says plainly before it arms. `forgotten:false` means the id was already gone. */
async function apiDelete(path) {
  const t = token();
  const headers = { accept: 'application/json' };
  if (t) headers['x-zeno-token'] = t;
  let res;
  try {
    res = await fetch(path, { method: 'DELETE', headers, cache: 'no-store', credentials: 'same-origin' });
  } catch (err) {
    const msg = (err && err.message) || 'the daemon could not be reached';
    recordDiag(path, 'DELETE', 0, msg);
    return { ok: false, status: 0, data: null, error: { message: msg } };
  }
  const data = await res.json().catch(() => null);
  const result = {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : ((data && data.error) || { message: `The daemon answered ${res.status}.` }),
  };
  if (!result.ok) recordDiag(path, 'DELETE', result.status, result.error && result.error.message);
  return result;
}

/* ---- diagnostics: opt-in, local, redacted ---------------------------------
   A structured record of daemon calls that FAILED, so a bug can be reported with
   a route, a status, a safe trace id, a severity and whether a retry is worth it
   — never a payload and never a token. OFF by default: nothing is recorded until
   the owner turns it on, it lives only in this page's memory, and it leaves the
   page only when the owner deliberately Copies or Exports it. */
const DIAG_KEY = 'zeno-diag-opt-in';
const diag = { events: [] };
let diagSeq = 0;

function diagOn() {
  try { return localStorage.getItem(DIAG_KEY) === '1'; } catch { return false; }
}
function setDiagOn(on) {
  try { localStorage.setItem(DIAG_KEY, on ? '1' : '0'); } catch { /* private mode: stays off */ }
}
function recordDiag(route, method, status, message) {
  if (!diagOn()) return;
  const s = Number(status) || 0;
  diag.events.unshift({
    id: 't' + (++diagSeq).toString(36) + Date.now().toString(36).slice(-4),
    at: new Date().toISOString(),
    method: String(method || 'GET'),
    route: String(route || ''),
    status: s,
    component: 'command-window',
    severity: s >= 500 || s === 0 ? 'error' : 'warning',
    // A retry is worth it for a transport failure or a server-side fault, not for
    // a 4xx the same request will keep earning (owner-only, bad-request, …).
    retryable: s === 0 || s >= 500 || s === 408 || s === 429,
    message: String(message || '').slice(0, 240),
  });
  if (diag.events.length > 60) diag.events.length = 60;
}

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(String(text)); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text);
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function downloadJson(name, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch { return false; }
}

/** The diagnostics control for Settings → Runtime: an opt-in toggle, and, when
 * on, the recorded failures with Copy / Export / Clear. Every field is safe to
 * share — route, status, trace id, severity, retryable, the daemon's own message. */
function diagnosticsHtml() {
  const on = diagOn();
  const rows = diag.events.slice(0, 12).map((e) =>
    '<div class="zs-diag-row">'
    + '<span class="zs-diag-id">' + esc(e.id) + '</span>'
    + '<span class="zs-diag-route">' + esc(e.method + ' ' + e.route) + '</span>'
    + '<span class="zs-diag-st ' + (e.severity === 'error' ? 'rd' : 'am') + '">'
    + esc(e.status + ' · ' + (e.retryable ? 'retryable' : 'not retryable')) + '</span>'
    + '<span class="zs-diag-msg">' + esc(e.message) + '</span>'
    + '</div>').join('');
  return '<div class="zs-diag">'
    + '<div class="zs-diag-head">'
    + '<button type="button" class="btn sm ' + (on ? 'p' : 'g') + '" data-diag-toggle="1" aria-pressed="' + (on ? 'true' : 'false') + '">'
    + (on ? 'Recording — turn off' : 'Off — turn on') + '</button>'
    + (on && diag.events.length
      ? '<button type="button" class="btn sm g" data-diag-copy="1">Copy</button>'
        + '<button type="button" class="btn sm g" data-diag-export="1">Export</button>'
        + '<button type="button" class="btn sm g" data-diag-clear="1">Clear</button>'
      : '')
    + '</div>'
    + '<p class="zs-diag-note">' + (on
      ? 'Recording failed daemon calls in THIS window — method, route, status, a trace id, severity and whether a retry is worth it. No request body and no token is ever recorded; it stays in this page until you Copy or Export it.'
      : 'Off. Turn it on to record failed daemon calls (route, status, trace id, retryable) for a bug report. Nothing is recorded until you do, and it never leaves this page unless you Copy or Export it.') + '</p>'
    + (on
      ? (diag.events.length
        ? '<div class="zs-diag-list">' + rows + '</div>'
          + (diag.events.length > 12 ? '<p class="zs-more">' + (diag.events.length - 12) + ' older not shown; Export has them all.</p>' : '')
        : '<p class="zs-diag-empty">No failed calls recorded yet.</p>')
      : '')
    + '</div>';
}

/* ---- text ------------------------------------------------------------------
   Every string that reaches innerHTML goes through esc() first. Branch names,
   file paths, note bodies, commit summaries and source details are all data
   written by something other than this file, and none of it is markup. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function plural(n, one, many) { return n === 1 ? one : many; }
function mk(s, n) { return esc(clip(s, n || 120)); }

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = (Date.now() - t) / 60000;
  return m < 0 ? 0 : m;
}
function ageStr(m) {
  if (m == null) return null;
  return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
}
function ageOf(iso) { const a = ageStr(minutesSince(iso)); return a ? a + ' ago' : null; }

/* ================================================================== *
 * this module's styles — tokens only, the approved palette as fallback *
 * ================================================================== */

const STYLE_ID = 'zeno-sections-styles';
const CSS = `
.zs{ display:flex; flex-direction:column; gap:14px; }
.zs p{ margin:0; }
.zs-k{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3,#6C7480); font-weight:600; margin:0;
}
/* the fact grid: a label and the thing it names, never a label alone */
.zs-kv{ display:grid; grid-template-columns:minmax(88px,auto) minmax(0,1fr); gap:5px 14px; margin:0; }
.zs-kv dt{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3,#6C7480);
}
.zs-kv dd{ margin:0; font-size:12px; line-height:1.5; color:var(--ink,#ECEBE6); overflow-wrap:anywhere; }
.zs-kv dd .sub{ color:var(--ink-2,#9AA1AC); }
.zs-kv dd.mono, .zs-mono{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:11px; }

/* a row: one file, one note, one integration, one commit */
.zs-row{
  display:flex; gap:11px; align-items:flex-start;
  padding:9px 11px; border:1px solid var(--rule,#242C31); border-radius:var(--r-1,6px);
  background:var(--g3,#151A1D);
}
.zs-rows{ display:flex; flex-direction:column; gap:5px; }
.zs-mark{
  flex:none; min-width:26px; text-align:center; padding:2px 5px; border-radius:4px;
  border:1px solid var(--rule-2,#2C363B); background:var(--g4,#1B2124);
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.06em; color:var(--ink-2,#9AA1AC);
}
.zs-bd{ min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
.zs-top{ display:flex; align-items:baseline; gap:9px; justify-content:space-between; }
.zs-t{ font-size:12.5px; font-weight:600; color:var(--ink,#ECEBE6); min-width:0; overflow-wrap:anywhere; }
.zs-m{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10.5px; line-height:1.55; color:var(--ink-3,#6C7480); overflow-wrap:anywhere;
}
.zs-w{ font-size:11.5px; line-height:1.55; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }

/* the three facts every integration row must state, as one line of chips */
.zs-facts{ display:flex; flex-wrap:wrap; gap:5px; margin-top:4px; }
.zs-f{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.05em; padding:2px 7px; border-radius:4px;
  border:1px solid var(--rule-2,#2C363B); color:var(--ink-3,#6C7480);
}
.zs-f.gr{ color:var(--green,#5FBF8F); border-color:color-mix(in srgb,var(--green,#5FBF8F) 36%,var(--rule,#242C31)); }
.zs-f.am{ color:var(--amber,#E0A128); border-color:color-mix(in srgb,var(--amber,#E0A128) 40%,var(--rule,#242C31)); }
.zs-f.rd{ color:var(--red,#D9634F);   border-color:color-mix(in srgb,var(--red,#D9634F) 40%,var(--rule,#242C31)); }
.zs-f.cy{ color:var(--cyan,#38C3D6);  border-color:color-mix(in srgb,var(--cyan,#38C3D6) 38%,var(--rule,#242C31)); }

/* the amber-ruled standing note, the shape .tnote already uses */
.zs-note{ font-size:11.5px; color:var(--ink-2,#9AA1AC); display:flex; gap:8px; padding-left:2px; line-height:1.55; }
.zs-note::before{ content:""; width:3px; background:var(--amber,#E0A128); border-radius:2px; flex:none; }
.zs-note.cy::before{ background:var(--cyan,#38C3D6); }
.zs-note.gr::before{ background:var(--green,#5FBF8F); }
.zs-note.rd::before{ background:var(--red,#D9634F); }

.zs-acts{ display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
.zs-find{ display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
.zs-find input{
  flex:1; min-width:180px; font:inherit; font-size:12px;
  padding:7px 10px; border-radius:var(--r-1,6px);
  border:1px solid var(--rule-2,#2C363B); background:var(--g2,#0F1214); color:var(--ink,#ECEBE6);
}
.zs-find input::placeholder{ color:var(--ink-3,#6C7480); }
.zs-add{ display:flex; gap:7px; flex-wrap:wrap; align-items:center; margin-top:8px; }
.zs-add input{
  flex:1; min-width:180px; font:inherit; font-size:12px;
  padding:7px 10px; border-radius:var(--r-1,6px);
  border:1px solid var(--rule-2,#2C363B); background:var(--g2,#0F1214); color:var(--ink,#ECEBE6);
}
.zs-add input::placeholder{ color:var(--ink-3,#6C7480); }
.zs-add-status{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:10.5px; color:var(--ink-3,#6C7480); }
/* Forget sits at the end of a note row's header. Quiet until armed; armed it
   turns red and names the permanence, so nothing about it reads as routine. */
.zs-forget{ flex:none; font-size:10.5px; padding:2px 8px; }
.zs-forget[data-armed="1"]{
  color:var(--red,#D9634F);
  border-color:color-mix(in srgb,var(--red,#D9634F) 55%,var(--rule-2,#2C363B));
  background:color-mix(in srgb,var(--red,#D9634F) 12%,transparent);
}
.zs-forget:disabled{ opacity:.55; cursor:default; }
/* diagnostics (Settings -> Runtime) */
.zs-diag{ display:flex; flex-direction:column; gap:8px; }
.zs-diag-head{ display:flex; gap:6px; flex-wrap:wrap; }
.zs-diag-note{ margin:0; font-size:11px; line-height:1.5; color:var(--ink-2,#9AA1AC); }
.zs-diag-list{ display:flex; flex-direction:column; gap:5px; }
.zs-diag-row{ display:grid; grid-template-columns:auto minmax(80px,1fr) auto; gap:4px 10px; align-items:baseline;
  padding:6px 8px; border-radius:7px; border:1px solid var(--rule,#242C31); background:var(--g2,#0F1214); }
.zs-diag-id{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:9.5px; color:var(--ink-3,#6C7480); }
.zs-diag-route{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:10.5px; color:var(--ink,#ECEBE6); overflow-wrap:anywhere; }
.zs-diag-st{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:9.5px; text-align:right; white-space:nowrap; }
.zs-diag-st.rd{ color:var(--red,#D9634F); }
.zs-diag-st.am{ color:var(--amber,#E0A128); }
.zs-diag-msg{ grid-column:1 / -1; font-size:11px; line-height:1.45; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }
.zs-diag-empty{ margin:0; font-size:11px; color:var(--ink-3,#6C7480); }
/* Approve sits where Forget does, at the end of a proposed-memory row. */
.zs-approve{ flex:none; font-size:10.5px; padding:2px 10px; }
.zs-approve:disabled{ opacity:.6; cursor:default; }
.zs-more{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:10px; color:var(--ink-3,#6C7480); padding-left:2px; }
.zs-hr{ height:1px; background:var(--rule,#242C31); border:0; margin:2px 0; }

/* Settings is a native modal: the left pane is navigation chrome and may use
   Zeno glass; the right pane stays opaque because it contains policy facts and
   capability state. No control is decorative — every button either changes an
   existing per-device preference, selects a real category, or closes the modal. */
.zs-settings-launch{
  display:flex; align-items:center; justify-content:space-between; gap:18px;
  padding:4px 2px;
}
.zs-settings-launch-copy{ min-width:0; }
.zs-settings-launch-copy h3{ margin:0; color:var(--ink,#ECEBE6); font-size:13px; font-weight:600; }
.zs-settings-launch-copy p{ margin:4px 0 0; color:var(--ink-2,#9AA1AC); font-size:11.5px; line-height:1.55; }
.zs-settings-launch .zs-facts{ margin-top:8px; }
.zs-settings-open{ flex:none; }

.zs-settings-dialog{
  width:min(920px,calc(100vw - 32px)); height:min(720px,calc(100vh - 32px));
  max-width:none; max-height:none; padding:0; overflow:hidden;
  color:var(--ink,#ECEBE6); background:var(--g2,#0F1214);
  border:1px solid var(--gl-edge,var(--rule-2,#2C363B)); border-radius:16px;
  box-shadow:var(--gl-cast,0 18px 46px -12px rgba(0,0,0,.62));
  animation:zs-settings-in var(--dur-2,180ms) var(--ease,cubic-bezier(.2,.6,.2,1));
}
.zs-settings-dialog::backdrop{
  background:color-mix(in srgb,var(--g1,#0A0C0E) 78%,transparent);
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
}
@keyframes zs-settings-in{
  from{ opacity:0; transform:translateY(8px) scale(.992); }
  to{ opacity:1; transform:none; }
}
:root[data-reduce="1"] .zs-settings-dialog{ animation:none; }
@media (prefers-reduced-motion:reduce){ .zs-settings-dialog{ animation:none; } }

.zs-settings-frame{ display:grid; grid-template-columns:232px minmax(0,1fr); height:100%; min-height:0; }
.zs-settings-side{
  min-width:0; padding:14px 12px 12px; overflow:hidden;
  display:flex; flex-direction:column; gap:12px;
  background:var(--gl-tint); border-right:1px solid var(--gl-edge,var(--rule,#242C31));
  box-shadow:inset 0 1px 0 var(--wash-hi);
  backdrop-filter:var(--gl-blur); -webkit-backdrop-filter:var(--gl-blur);
}
.zs-settings-side-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 2px; }
.zs-settings-word{ display:flex; align-items:center; gap:8px; min-width:0; font-size:12px; font-weight:650; }
.zs-settings-word img{ width:20px; height:20px; display:block; filter:drop-shadow(0 3px 9px color-mix(in srgb,var(--cyan,#38C3D6) 34%,transparent)); }
.zs-settings-close{
  width:32px; height:32px; flex:none; display:grid; place-items:center;
  border:1px solid transparent; border-radius:8px; background:transparent;
  color:var(--ink-2,#9AA1AC); font:20px/1 var(--font-ui,system-ui); cursor:pointer;
}
.zs-settings-close:hover{ color:var(--ink,#ECEBE6); background:var(--wash-2); border-color:var(--gl-edge,var(--rule,#242C31)); }
.zs-settings-search{
  display:flex; align-items:center; gap:8px; min-height:38px; padding:0 10px;
  border:1px solid var(--rule-2,#2C363B); border-radius:10px;
  background:color-mix(in srgb,var(--g2,#0F1214) 88%,transparent); color:var(--ink-3,#6C7480);
}
.zs-settings-search:focus-within{ border-color:var(--focus,#86DEEC); }
.zs-settings-search input{
  width:100%; min-width:0; padding:8px 0; border:0; outline:0;
  background:transparent; color:var(--ink,#ECEBE6); font:12px/1.3 var(--font-ui,system-ui);
}
.zs-settings-search input::placeholder{ color:var(--ink-3,#6C7480); }
.zs-settings-tabs{ display:flex; flex-direction:column; gap:3px; overflow:auto; padding:1px; }
.zs-settings-tab{
  display:grid; grid-template-columns:22px minmax(0,1fr); gap:8px; align-items:center;
  width:100%; padding:8px 10px; border:1px solid transparent; border-radius:8px;
  background:transparent; color:var(--ink-2,#9AA1AC); text-align:left;
  font:12px/1.35 var(--font-ui,system-ui); cursor:pointer;
}
.zs-settings-tab:hover{ color:var(--ink,#ECEBE6); background:var(--wash); }
.zs-settings-tab[aria-selected="true"]{
  color:var(--ink,#ECEBE6); background:var(--wash-2); border-color:var(--gl-edge,var(--rule,#242C31));
  box-shadow:inset 2px 0 0 var(--cyan,#38C3D6),inset 0 1px 0 var(--wash-hi);
}
.zs-settings-tab-glyph{ text-align:center; color:var(--ink-3,#6C7480); font-family:var(--font-glyph,"Segoe UI Symbol",system-ui); }
.zs-settings-tab[aria-selected="true"] .zs-settings-tab-glyph{ color:var(--cyan,#38C3D6); }
.zs-settings-local{
  margin:auto 4px 0; padding-top:10px; border-top:1px solid var(--rule,#242C31);
  color:var(--ink-3,#6C7480); font:9.5px/1.55 var(--font-mono,ui-monospace,Consolas,monospace);
}

.zs-settings-main{ min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--g2,#0F1214); }
.zs-settings-main-head{ flex:none; padding:22px 24px 17px; border-bottom:1px solid var(--rule,#242C31); }
.zs-settings-main-head .zs-k{ margin-bottom:5px; }
.zs-settings-main-head h2{ margin:0; color:var(--ink,#ECEBE6); font-size:20px; font-weight:650; letter-spacing:-.018em; }
.zs-settings-main-head p{ max-width:62ch; margin:5px 0 0; color:var(--ink-2,#9AA1AC); font-size:11.5px; line-height:1.5; }
.zs-settings-panel{ min-width:0; min-height:0; padding:6px 24px 28px; overflow:auto; }
.zs-settings-group{ padding-top:18px; }
.zs-settings-group + .zs-settings-group{ margin-top:18px; border-top:1px solid var(--rule,#242C31); }
.zs-settings-group-head{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:8px; }
.zs-settings-group-head h3{ margin:0; color:var(--ink,#ECEBE6); font-size:12.5px; font-weight:650; }
.zs-settings-group-head span{ color:var(--ink-3,#6C7480); font:9.5px/1.3 var(--font-mono,ui-monospace,Consolas,monospace); }
.zs-settings-items{ border-top:1px solid var(--rule,#242C31); }
.zs-setting{
  display:grid; grid-template-columns:minmax(0,1fr) minmax(116px,auto); gap:18px; align-items:center;
  min-height:72px; padding:13px 0; border-bottom:1px solid var(--rule,#242C31);
}
.zs-setting-copy{ min-width:0; }
.zs-setting-copy h4{ margin:0; color:var(--ink,#ECEBE6); font-size:12.5px; font-weight:600; }
.zs-setting-copy p{ max-width:64ch; margin:4px 0 0; color:var(--ink-2,#9AA1AC); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
.zs-setting-value{ min-width:0; color:var(--ink-2,#9AA1AC); font:10.5px/1.45 var(--font-mono,ui-monospace,Consolas,monospace); text-align:right; overflow-wrap:anywhere; }
.zs-setting-value.good{ color:var(--green,#5BB98C); }
.zs-setting-value.warn{ color:var(--amber,#E0A128); }
.zs-setting-value.bad{ color:var(--red,#D8695A); }
.zs-setting-action{
  min-width:112px; min-height:34px; padding:6px 9px;
  display:inline-flex; align-items:center; justify-content:flex-end; gap:8px;
  border:1px solid var(--rule-2,#2C363B); border-radius:8px; background:var(--g3,#151A1D);
  color:var(--ink,#ECEBE6); font:10.5px/1.2 var(--font-mono,ui-monospace,Consolas,monospace); cursor:pointer;
}
.zs-setting-action:hover{ background:var(--g4,#1B2124); border-color:color-mix(in srgb,var(--cyan,#38C3D6) 42%,var(--rule-2,#2C363B)); }
.zs-switch{
  width:30px; height:17px; padding:2px; flex:none; display:flex; align-items:center;
  border-radius:999px; background:var(--g6,#2C363B); box-shadow:inset 0 0 0 1px var(--rule-2,#2C363B);
}
.zs-switch::after{ content:""; width:13px; height:13px; border-radius:50%; background:var(--ink-2,#9AA1AC); transition:transform var(--dur-2,180ms) var(--ease),background var(--dur-2,180ms) var(--ease); }
.zs-setting-action[aria-pressed="true"] .zs-switch{ background:color-mix(in srgb,var(--cyan,#38C3D6) 72%,var(--g5,#222A2E)); }
.zs-setting-action[aria-pressed="true"] .zs-switch::after{ transform:translateX(13px); background:var(--g1,#0A0C0E); }
:root[data-reduce="1"] .zs-switch::after{ transition:none; }
.zs-settings-empty{ padding:30px 0; }

@media (max-width:720px){
  .zs-settings-dialog{ width:calc(100vw - 20px); height:calc(100vh - 20px); border-radius:13px; }
  .zs-settings-frame{ grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr); }
  .zs-settings-side{ padding:10px; border-right:0; border-bottom:1px solid var(--gl-edge,var(--rule,#242C31)); gap:8px; }
  .zs-settings-side-head{ grid-column:1/-1; }
  .zs-settings-tabs{ display:grid; grid-template-columns:repeat(4,minmax(128px,1fr)); overflow:auto hidden; padding-bottom:2px; }
  .zs-settings-tab{ white-space:nowrap; }
  .zs-settings-local{ display:none; }
  .zs-settings-main-head{ padding:16px 18px 13px; }
  .zs-settings-panel{ padding:2px 18px 22px; }
}
@media (max-width:520px){
  .zs-settings-launch{ align-items:flex-start; flex-direction:column; }
  .zs-settings-open{ width:100%; }
  .zs-settings-side-head{ padding:0; }
  .zs-settings-main-head h2{ font-size:18px; }
  .zs-setting{ grid-template-columns:minmax(0,1fr); gap:8px; align-items:start; }
  .zs-setting-value{ text-align:left; }
  .zs-setting-action{ width:100%; justify-content:space-between; }
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ---- shared fragments ------------------------------------------------------ */

function plane(id, title, sub, body) {
  return '<section class="plane" aria-labelledby="' + esc(id) + '-h">'
    + '<div class="plane-head">'
    + '<h2 class="plane-h" id="' + esc(id) + '-h">' + esc(title) + '</h2>'
    + '<p class="plane-sub">' + esc(sub) + '</p>'
    + '</div><div class="plane-body"><div class="zs">' + body + '</div></div></section>';
}

function empty(glyph, title, sub) {
  return '<div class="empty"><span class="empty-glyph" aria-hidden="true">' + esc(glyph) + '</span>'
    + '<div><p class="empty-title">' + esc(title) + '</p>'
    + '<p class="empty-sub">' + esc(sub) + '</p></div></div>';
}

function note(text, channel) {
  return '<p class="zs-note' + (channel ? ' ' + esc(channel) : '') + '"><span>' + esc(text) + '</span></p>';
}

function kvs(pairs) {
  const rows = pairs.filter(Boolean).map(([k, v, mono]) =>
    '<dt>' + esc(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + v + '</dd>').join('');
  return '<dl class="zs-kv">' + rows + '</dl>';
}

function heading(t) { return '<p class="zs-k">' + esc(t) + '</p>'; }

function row(mark, title, meta, why, facts, action) {
  // `action` is an optional right-aligned control in the row header. .zs-top is
  // already flex/space-between, so a second child sits at the end without any
  // per-row layout change. Callers pass raw, already-escaped HTML (a button).
  return '<div class="zs-row"><span class="zs-mark">' + esc(mark) + '</span><div class="zs-bd">'
    + '<div class="zs-top"><div class="zs-t">' + title + '</div>' + (action || '') + '</div>'
    + (meta ? '<p class="zs-m">' + meta + '</p>' : '')
    + (why ? '<p class="zs-w">' + esc(why) + '</p>' : '')
    + (facts ? '<div class="zs-facts">' + facts + '</div>' : '')
    + '</div></div>';
}

function fact(text, channel) { return '<span class="zs-f' + (channel ? ' ' + esc(channel) : '') + '">' + esc(text) + '</span>'; }

/** The read has not happened / could not happen. Never "there is nothing". */
function unread(what) {
  return empty('—', what + ' not loaded.',
    'This page has not read the daemon for this section yet. Treat it as unknown, not as empty — '
    + 'it fills in as soon as the read succeeds.');
}
function unreadable(what, err) {
  return empty('⚠', what + ' could not be read.',
    (err && err.message ? err.message + ' ' : '')
    + 'This is a failure to read, not an absence. Nothing below is a complete picture until it succeeds.');
}

/* ================================================================== *
 * WORKSTATION — the sandbox repository, exactly as git reports it     *
 * ================================================================== */

/* git's porcelain XY code, said in words. Anything unrecognised keeps its raw
   code and is called what it is — an unmapped code — rather than guessed at. */
function gitWord(code) {
  const c = String(code || '').trim();
  const map = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged', '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified, staged and again', RM: 'renamed, then modified' };
  return map[c] || null;
}

function renderWorkstation(st) {
  if (!st) return plane('sec-workstation', 'Work', WORDS.workstationSub, unread('The sandbox'));
  if (!st.ok) return plane('sec-workstation', 'Work', WORDS.workstationSub, unreadable('The sandbox', st.error));

  const d = st.data || {};
  const openBtn = '<div class="zs-acts"><button type="button" class="btn sm p" data-go="forge">Open in Forge</button>'
    + '<span class="zs-more">Forge proposes. A commit is still a separate approval.</span></div>';

  if (!d.repo) {
    return plane('sec-workstation', 'Work', WORDS.workstationSub,
      empty('○', 'The sandbox is not a git repository.',
        String(d.note || 'The daemon reported no repository at the sandbox path.'))
      + openBtn);
  }

  const changed = Array.isArray(d.changed) ? d.changed : [];
  const log = Array.isArray(d.log) ? d.log : [];
  const trackedTotal = Number.isFinite(d.trackedTotal) ? d.trackedTotal : null;
  const shown = Array.isArray(d.tracked) ? d.tracked.length : null;

  let body = kvs([
    ['branch', mk(d.branch || '(not reported)', 40), true],
    ['head', d.head ? mk(String(d.head), 40) : '<span class="sub">no commits yet — the sandbox has never been committed to</span>', true],
    ['uncommitted', changed.length
      ? '<span>' + changed.length + ' ' + plural(changed.length, 'file', 'files') + '</span>'
      : '<span class="sub">none — the working tree is clean</span>'],
    ['tracked', trackedTotal == null
      ? '<span class="sub">not reported</span>'
      : trackedTotal + ' ' + plural(trackedTotal, 'file', 'files') + (d.trackedCapped
        ? ' <span class="sub">· the daemon returned the first ' + shown + ', so any file list here is a part, not the whole</span>'
        : '')],
  ]);

  if (changed.length) {
    const cap = 14;
    body += heading('uncommitted changes')
      + '<div class="zs-rows">'
      + changed.slice(0, cap).map((c) => {
        const word = gitWord(c.status);
        return row(
          String(c.status || '·'),
          mk(c.path || '(no path reported)', 90),
          word ? esc(word) : 'git status code ' + esc(String(c.status || '?')) + ' — not one this window has words for',
          null, null,
        );
      }).join('')
      + '</div>'
      + (changed.length > cap ? '<p class="zs-more">+ ' + (changed.length - cap) + ' more, not listed here</p>' : '');
  }

  if (log.length) {
    body += heading('recent commits')
      + '<div class="zs-rows">'
      + log.map((c) => row(
        String(c.sha || '·'),
        mk(c.summary || '(no message)', 96),
        null, null, null,
      )).join('')
      + '</div>';
  } else {
    body += note('No commit has been made in the sandbox yet, so there is no history to show. '
      + 'This is the repository as git reports it, not a cache.', 'cy');
  }

  body += openBtn;
  body += note(changed.length
    ? 'These files are on disk in the sandbox and nowhere else. Committing them is a T1 action that '
      + 'goes through the same gate as everything else, and it lands its own receipt.'
    : 'Nothing is staged and nothing is uncommitted. Every write into this repository arrives as an '
      + 'approval capsule first — the sandbox is never edited behind your back.');

  return plane('sec-workstation', 'Work', WORDS.workstationSub, body);
}

/* ================================================================== *
 * VAULT — governed local memory, and today's brief                    *
 * ================================================================== */

function noteRow(n, score, matched, owner) {
  const tags = Array.isArray(n.tags) ? n.tags : [];
  const meta = [
    n.source ? 'source ' + esc(String(n.source)) : null,
    ageOf(n.updatedAt || n.createdAt),
    tags.length ? tags.length + ' ' + plural(tags.length, 'tag', 'tags') + ': ' + esc(tags.join(', ')) : null,
    score != null ? 'score ' + esc(String(score)) : null,
    Array.isArray(matched) && matched.length
      ? 'matched: ' + esc(matched.join(', '))
      : null,
  ].filter(Boolean).join(' · ');
  // Forget is owner-only and only where the note has a stable id to address.
  // It arms on the first click (see the delegated handler) because the delete
  // is permanent and leaves no receipt.
  const del = owner && n.id
    ? '<button type="button" class="btn sm g zs-forget" data-vault-forget="' + esc(String(n.id)) + '" '
      + 'title="Forget this note permanently. A deleted memory leaves no receipt and cannot be recovered.">Forget</button>'
    : null;
  return row('▪', mk(n.title || n.id || '(untitled note)', 90), meta, clip(String(n.body || ''), 190), null, del);
}

function renderVault(mem, brief, query, pending) {
  const sub = WORDS.vaultSub;
  if (!mem) return plane('sec-vault', 'Vault', sub, unread('Memory'));

  // A daemon started without a vault directory answers 404 no-vault. That is a
  // configuration fact, not a read failure, and it is said as one.
  if (!mem.ok && mem.status === 404 && mem.error && mem.error.code === 'no-vault') {
    return plane('sec-vault', 'Vault', sub,
      empty('○', 'Governed memory is not enabled on this daemon.',
        String(mem.error.message || '') + ' ' + String(mem.error.resolve || ''))
      + note('Nothing is remembered and nothing can be recalled. This is the daemon saying it has no '
        + 'vault, not this window failing to read one.', 'cy'));
  }
  if (!mem.ok) return plane('sec-vault', 'Vault', sub, unreadable('Memory', mem.error));

  const d = mem.data || {};
  const owner = !!token(); // only the owner may forget a note (DELETE is owner-only)
  const searching = typeof d.query === 'string' && d.query !== '';
  const hits = Array.isArray(d.hits) ? d.hits : null;
  const notes = Array.isArray(d.notes) ? d.notes : null;

  let body = '<div class="zs-find">'
    + '<input type="search" id="zs-vq" placeholder="Search your memory — the daemon\'s own recall" '
    + 'aria-label="Search governed memory" value="' + esc(query || '') + '">'
    + '<button type="button" class="btn sm p" data-vault-find="1">Search</button>'
    + (searching ? '<button type="button" class="btn sm g" data-vault-clear="1">Clear</button>' : '')
    + '</div>'
    + (token()
      ? '<div class="zs-add"><input type="text" id="zs-add-note" maxlength="400" '
        + 'placeholder="Remember something — a decision, a preference, a fact" aria-label="Add a memory note">'
        + '<button type="button" class="btn sm p" data-vault-remember="1">Remember</button>'
        + '<span class="zs-add-status" id="zs-add-status" role="status"></span></div>'
        // Move memory in and out. Import sanitizes every field before it writes and
        // says what it redacted; export hands the owner a JSON file of what is loaded.
        + '<div class="zs-add"><input type="file" id="zs-import-file" accept="application/json,.json" style="display:none">'
        + '<button type="button" class="btn sm g" data-vault-import="1">⬆ Import notes</button>'
        + '<button type="button" class="btn sm g" data-vault-export-all="1">⬇ Export all</button>'
        + '<span class="zs-add-status" id="zs-import-status" role="status"></span></div>'
      : '')
    + note('The query goes to this daemon on 127.0.0.1 and nowhere else. Recall is a plain term match, '
      + 'so every result shows the terms it matched on and its score — a memory you cannot trace is a '
      + 'rumour, and the Vault does not deal in rumours.', 'cy');

  /* ---- proposed memories: an agent asked to remember; the owner decides ----
     This queue is deliberately separate from the window's approvals list
     (memory-routes.ts), so the Vault is the ONLY place it can be seen or
     approved. An agent proposes; it can never approve its own memory. There is
     no Deny, by the same design as the main capsule: a proposal the owner does
     not approve simply never becomes a memory, and is dropped on restart. */
  const props = owner && pending && pending.ok && pending.data && Array.isArray(pending.data.pending)
    ? pending.data.pending
    : [];
  if (props.length) {
    body += heading('proposed memories · ' + props.length)
      + note('An agent asked to remember these. Nothing is written until you approve it — and an agent can '
        + 'propose but never approve its own memory. There is no Deny: a proposal you do not approve simply '
        + 'never becomes a memory, and is dropped if the daemon restarts.', 'am')
      + '<div class="zs-rows">'
      + props.map((p) => {
        const pv = (p && p.preview) || {};
        const pl = (p && p.payload) || {};
        const src = pl.source ? 'from ' + esc(String(pl.source)) : 'from an agent';
        const tags = Array.isArray(pl.tags) && pl.tags.length ? 'tags: ' + esc(pl.tags.join(', ')) : null;
        const meta = [src, 'tier ' + esc(String(pv.tier || '?')), tags].filter(Boolean).join(' · ');
        const approve = pv.actionHash
          ? '<button type="button" class="btn sm p zs-approve" data-vault-approve="' + esc(String(pv.actionHash)) + '">Approve</button>'
          : '<span class="zs-add-status">no action hash — cannot approve</span>';
        return row('◆', mk(pl.description || pl.body || '(proposed memory)', 90), meta, clip(String(pl.body || ''), 190), null, approve);
      }).join('')
      + '</div>';
  }

  if (searching) {
    body += heading('results for “' + clip(d.query, 40) + '” · ' + (hits ? hits.length : 0));
    body += hits && hits.length
      ? '<div class="zs-rows">' + hits.map((h) => noteRow(h.note || {}, h.score, h.matched, owner)).join('') + '</div>'
      : empty('○', 'No note matched that.',
        'The search ran and came back with nothing. That is an answer about your memory, not a failure to read it.');
  } else if (notes) {
    body += heading('recent notes · ' + notes.length);
    body += notes.length
      ? '<div class="zs-rows">' + notes.map((n) => noteRow(n, null, null, owner)).join('') + '</div>'
        + '<p class="zs-more">The daemon returns the 50 most recent; search reaches the rest.</p>'
      : empty('○', 'Your memory is empty.',
        'The vault was read and holds no notes. Anything Zeno is told to remember is written here as a '
        + 'file on this disk, redacted for secrets before it is stored.');
  }

  /* ---- the brief. It is a second read, and it fails on its own. ---- */
  body += '<hr class="zs-hr">' + heading('today’s brief');
  if (!brief) {
    body += unread('The brief');
  } else if (!brief.ok) {
    body += unreadable('The brief', brief.error);
  } else {
    const b = (brief.data && brief.data.brief) || {};
    const sources = Array.isArray(b.sources) ? b.sources : [];
    const missing = Array.isArray(b.missing) ? b.missing : [];
    const any = sources.some((s) => Array.isArray(s.items) && s.items.length);
    body += kvs([
      ['status', b.status === 'complete'
        ? '<span>complete — every source answered</span>'
        : '<span class="sub">partial — at least one source could not be reached</span>'],
      ['built', b.at ? esc(ageOf(b.at) || String(b.at)) : '<span class="sub">not reported</span>'],
    ]);
    if (any) {
      body += '<div class="zs-rows">' + sources.map((s) => {
        const items = Array.isArray(s.items) ? s.items : [];
        if (!items.length) return '';
        return items.map((i) => row('·', mk(i.text || '', 110),
          [esc(String(i.source || s.name || '')), esc(String(i.age || ''))].filter(Boolean).join(' · '), null, null)).join('');
      }).join('') + '</div>';
    } else {
      body += empty('○', 'The brief has nothing in it.',
        'Every source it asked answered, and none of them had anything to report. That is a quiet '
        + 'morning, not a missing brief.');
    }
    if (missing.length) {
      body += note(missing.length + ' ' + plural(missing.length, 'source', 'sources') + ' could not be reached: '
        + missing.join(', ') + '. The brief above is short by an unknown amount.', 'rd');
    }
  }

  return plane('sec-vault', 'Vault', sub, body);
}

/* ================================================================== *
 * INTEGRATIONS — what this Zeno is actually connected to              *
 * ================================================================== *
 * Every row states three things and never fewer:
 *   configured   was it set up at all
 *   reachable    did it answer, and does this window actually know
 *   egress       does using it leave this machine
 * A row that cannot honestly answer one of the three says "not reported" for
 * that one. That is the whole point of the section.
 */

function sourceRow(s) {
  const configured = s.state !== 'not-configured';
  /* EGRESS IS A PROPERTY OF THE SOURCE, NOT OF ITS CONFIGURATION. Reading it
     off `configured` said "stays on this machine" about GitHub — true only in
     the sense that an unasked question never left the room, and exactly the
     reassurance a reader must not be given by accident. The local backlog is
     the one source on this disk; every other one is somewhere else, whether or
     not it has been switched on yet. */
  const remote = s.name !== 'local';
  const facts =
    fact(configured ? 'configured' : 'not configured', configured ? 'gr' : null)
    + fact(
      s.state === 'ok' ? 'answered in full'
        : s.state === 'partial' ? 'answered in part'
          : s.state === 'failed' ? 'did not answer'
            : 'never asked',
      s.state === 'ok' ? 'gr' : s.state === 'partial' ? 'am' : s.state === 'failed' ? 'rd' : null,
    )
    + fact(
      !remote ? 'stays on this machine'
        : configured ? '⚡ leaves this machine'
          : '⚡ would leave this machine — nothing has been sent',
      !remote ? 'gr' : configured ? 'am' : null,
    );
  const meta = [
    s.count == null ? 'contributed nothing' : s.count + ' ' + plural(s.count, 'item', 'items') + ' contributed',
    s.reason ? esc(String(s.reason)) : null,
  ].filter(Boolean).join(' · ');
  return row('SRC', mk(s.name || 'a work source', 44), meta, s.detail ? String(s.detail) : null, facts);
}

function renderIntegrations(work, agents, skills) {
  const sub = WORDS.integrationsSub;
  let body = '';

  /* ---- 1 · work sources ---- */
  body += heading('work sources');
  if (!work) body += unread('Work sources');
  else if (!work.ok) body += unreadable('Work sources', work.error);
  else {
    const sources = (work.data && Array.isArray(work.data.sources)) ? work.data.sources : [];
    body += sources.length
      ? '<div class="zs-rows">' + sources.map(sourceRow).join('') + '</div>'
      : empty('○', 'No work source is configured.',
        'The daemon reported no sources at all — not even the local backlog. Nothing is being polled.');
  }

  /* ---- 2 · the local model runtime ---- */
  body += '<hr class="zs-hr">' + heading('local model runtime');
  if (!agents) body += unread('The local runtime');
  else if (!agents.ok) body += unreadable('The local runtime', agents.error);
  else {
    const models = (agents.data && Array.isArray(agents.data.localModels)) ? agents.data.localModels : [];
    /* THE HONEST LIMIT: /forge/agents returns an empty localModels both when
       Ollama is not running and when it is running with nothing pulled. The
       route does not distinguish them, so neither does this row. */
    const facts =
      fact('configured', 'gr')
      + fact(models.length ? 'answered · ' + models.length + ' ' + plural(models.length, 'model', 'models') + ' installed' : 'answered with no models — or did not answer', models.length ? 'gr' : 'am')
      + fact('stays on this machine', 'gr');
    body += '<div class="zs-rows">' + row(
      'OLL', 'Ollama',
      '127.0.0.1:11434 · the daemon asks over HTTP, never the ollama binary',
      models.length
        ? 'The daemon listed installed models, so Ollama answered on this machine. A local run reaches nothing outside it.'
        : 'The daemon listed no models. That is the same answer whether Ollama is stopped or running with '
          + 'nothing pulled — this route cannot tell the two apart, so neither can this row. Pull a model '
          + '(ollama pull qwen3:8b) and re-check.',
      facts,
    ) + '</div>';
    if (models.length) {
      body += '<div class="zs-rows">' + models.map((m) => row('▸', mk(m, 44), 'installed locally', null, null)).join('') + '</div>';
    }
    body += '<div class="zs-acts"><button type="button" class="btn sm g" data-recheck="1">Re-check the runtime</button>'
      + '<span class="zs-more">Asks the daemon again. Nothing leaves 127.0.0.1.</span></div>';

    /* ---- 3 · the coding agents the daemon offers ---- */
    const list = (agents.data && Array.isArray(agents.data.agents)) ? agents.data.agents : [];
    if (list.length) {
      body += '<hr class="zs-hr">' + heading('coding agents Forge can run');
      body += '<div class="zs-rows">' + list.map((a) => {
        const local = a.id === 'local';
        return row(
          local ? 'LOC' : 'EXT',
          esc(String(a.label || a.id || 'an agent')),
          'id ' + esc(String(a.id || '?')) + (Array.isArray(a.models) && a.models.length ? ' · models: ' + esc(a.models.join(', ')) : ''),
          local
            ? 'Runs against Ollama on this machine. Availability means the daemon found at least one installed local model.'
            : (a.available
              ? 'The daemon executed this CLI’s version probe from the same desktop session Forge will use.'
              : String(a.unavailableReason || 'The CLI did not answer the daemon’s availability probe.')),
          fact(a.available ? 'runnable now' : 'unavailable', a.available ? 'gr' : 'am')
          + fact(local ? 'local runtime' : 'hosted provider', local ? 'gr' : 'am')
          + fact(local ? 'stays on this machine' : '⚡ sends code to its provider', local ? 'gr' : 'am'),
        );
      }).join('') + '</div>';
    }
  }

  /* ---- 4 · repository skills, read from the route Forge uses ---- */
  body += '<hr class="zs-hr">' + heading('repository skills');
  if (!skills) body += unread('Installed skills');
  else if (!skills.ok) body += unreadable('Installed skills', skills.error);
  else {
    const installed = (skills.data && Array.isArray(skills.data.skills)) ? skills.data.skills : [];
    const failed = (skills.data && Array.isArray(skills.data.failed)) ? skills.data.failed : [];
    body += installed.length
      ? '<div class="zs-rows">' + installed.map((skill) => row(
          'SKL', mk(skill.name || skill.id || 'skill', 44),
          'id ' + esc(String(skill.id || '?')) + ' · ' + esc(String(skill.bytes || 0)) + ' bytes',
          String(skill.description || 'No description was supplied.'),
          fact(skill.verdict === 'suspicious' ? 'screen findings — review before use' : 'screened', skill.verdict === 'suspicious' ? 'am' : 'gr')
          + fact('selected per run') + fact('cannot approve', 'cy'),
        )).join('') + '</div>'
      : empty('SKL', 'No repository skills are installed.', 'Add .agents/skills/<id>/SKILL.md to this selected repository, then reload Forge.');
    if (failed.length) body += note(failed.length + ' skill file(s) could not be loaded. Forge will refuse a run that selects one of them.', 'am');
  }

  /* ---- 5 · the separate edge this HTTP window cannot observe ---- */
  body += '<hr class="zs-hr">' + heading('separate process');
  body += '<div class="zs-rows">'
    + row('MCP', 'The MCP edge',
      'a separate stdio process · zeno-mcp',
      'The MCP server is its own binary that an MCP client starts over stdio. It is not this daemon and '
      + 'has no HTTP route here, so this window cannot say whether a client is connected. What is fixed '
      + 'either way: it exposes tools that propose and read, and there is deliberately no approve tool.',
      fact('separate process') + fact('not visible from here', 'am') + fact('stdio — no socket'))
    + '</div>';

  body += note('A source is read-only: it can be cited, never obeyed. Nothing on this list can approve '
    + 'anything, and the ⚡ rows are the only ones whose use leaves this machine at all.');

  return plane('sec-integrations', 'Integrations', sub, body);
}

/* ================================================================== *
 * SETTINGS — a searchable native dialog over the same truthful state *
 * ================================================================== */

const SETTINGS_CATEGORIES = Object.freeze([
  { id: 'general', glyph: '◐', label: 'General', description: 'Appearance and privacy choices for this device.' },
  { id: 'policy', glyph: '✓', label: 'Policy & receipts', description: 'The policy evidence and receipt chain reported by this daemon.' },
  { id: 'capabilities', glyph: '◇', label: 'Capabilities', description: 'Which capability tokens this window and its agents can hold.' },
  { id: 'runtime', glyph: '⌁', label: 'Runtime', description: 'The loopback daemon this window is actually connected to.' },
]);

function settingsCategory(id) {
  return SETTINGS_CATEGORIES.find((category) => category.id === id) || SETTINGS_CATEGORIES[0];
}

function settingItem(category, title, description, search, html) {
  return { category, title, description, search: `${title} ${description} ${search || ''}`.toLowerCase(), html };
}

/* Each preference delegates to the original top-bar control. There is still one
   owner for every value, so the modal can never drift from Command's controls. */
function preferenceSetting(id, title, value, description, pressed, cycle) {
  const pressedAttr = cycle ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`;
  const affordance = cycle
    ? '<span aria-hidden="true">↻</span>'
    : '<span class="zs-switch" aria-hidden="true"></span>';
  const label = cycle ? `Change ${title}. Current value: ${value}.` : `${title}: ${pressed ? 'on' : 'off'}.`;
  return '<article class="zs-setting">'
    + '<div class="zs-setting-copy"><h4>' + esc(title) + '</h4><p>' + esc(description) + '</p></div>'
    + '<button type="button" class="zs-setting-action" data-ctl="' + esc(id) + '" '
    + 'data-settings-focus="control:' + esc(id) + '" aria-label="' + esc(label) + '"' + pressedAttr + '>'
    + '<span>' + esc(value) + '</span>' + affordance + '</button></article>';
}

function readOnlySetting(title, value, description, tone) {
  return '<article class="zs-setting">'
    + '<div class="zs-setting-copy"><h4>' + esc(title) + '</h4><p>' + esc(description) + '</p></div>'
    + '<div class="zs-setting-value' + (tone ? ' ' + esc(tone) : '') + '">' + value + '</div></article>';
}

function buildSettingsGroups(state) {
  const themeAttr = R.getAttribute('data-theme');
  const theme = themeAttr === 'dark' ? 'Dark' : themeAttr === 'light' ? 'Light' : 'System';
  const reduce = R.getAttribute('data-reduce') === '1';
  const flat = R.getAttribute('data-flat') === '1';
  const hasOwner = token() !== '';

  const general = [
    settingItem('general', 'Theme', 'Cycle between system, dark, and light without syncing the choice.', 'appearance colour color system dark light',
      preferenceSetting('ctl-theme', 'Theme', theme, 'Cycles System → Dark → Light. Stored in this browser profile and never synced.', false, true)),
    settingItem('general', 'Reduce motion', 'Stop the field from breathing and drifting on this device.', 'animation accessibility movement',
      preferenceSetting('ctl-motion', 'Reduce motion', reduce ? 'Reduced' : 'Full motion', 'An explicit choice here overrides the operating system setting in both directions.', reduce, false)),
    settingItem('general', 'Reduce transparency', 'Drop the frosted-glass blur behind panels on this device.', 'accessibility glass blur transparency contrast',
      preferenceSetting('ctl-flat', 'Reduce transparency', flat ? 'Reduced' : 'Glass', 'For when the blur is hard to read against. It changes the surface only; nothing else, including the field, is affected.', flat, false)),
  ];

  const policy = [];
  if (!state) {
    policy.push(settingItem('policy', 'Policy state', 'The daemon has not answered yet.', 'unknown loading',
      readOnlySetting('Policy state', 'Not loaded', 'This page has not read the daemon yet. Treat the policy as unknown, never empty.', 'warn')));
  } else if (!state.ok) {
    const message = state.error && state.error.message ? String(state.error.message) : 'The daemon read failed.';
    policy.push(settingItem('policy', 'Policy state', message, 'failure error unavailable',
      readOnlySetting('Policy state', 'Could not read', `${message} This is a read failure, not an empty policy.`, 'bad')));
  } else {
    const receipts = (state.data && Array.isArray(state.data.receipts)) ? state.data.receipts : [];
    const chain = (state.data && state.data.chain) || null;
    const newest = receipts.length ? receipts[receipts.length - 1] : null;
    const ph = newest && newest.policyHash ? String(newest.policyHash) : null;
    policy.push(
      settingItem('policy', 'Policy hash', 'Read from the newest receipt; /state does not report policy directly.', 'rules governance checksum',
        readOnlySetting('Policy hash', ph ? mk(ph, 80) : 'Not recorded', ph
          ? 'This is the exact hash recorded by the newest receipt.'
          : 'No receipt exists yet, so no policy hash has been recorded.', ph ? 'good' : 'warn')),
      settingItem('policy', 'Evidence source', 'The receipt that recorded the governing policy.', 'newest receipt id source',
        readOnlySetting('Evidence source', ph ? 'Newest receipt · ' + mk(String(newest.id || 'no id'), 40) : 'No receipt',
          ph ? 'The value above came from this receipt.' : 'There is no receipt from which to read a policy hash.', ph ? '' : 'warn')),
      settingItem('policy', 'Receipts', 'The number returned by the current /state response.', 'ledger audit count',
        readOnlySetting('Receipts', esc(String(receipts.length)), 'A live count from this daemon.', '')),
      settingItem('policy', 'Receipt chain', 'Every receipt should hash to the entry before it.', 'verify verification integrity broken',
        readOnlySetting('Receipt chain', chain ? (chain.ok ? 'Verified' : 'Broken at ' + esc(String(chain.firstBreakAt))) : 'Not reported',
          chain ? (chain.ok ? 'Every reported link hashes to the one before it.' : 'The daemon reported an integrity break in the ledger.')
            : 'The daemon did not report a chain verdict.', chain ? (chain.ok ? 'good' : 'bad') : 'warn')),
    );
  }

  const capabilities = [
    settingItem('capabilities', 'Owner token', 'Presence only; the token value never enters visible page text.', 'approval commit delete recording pairing nonce',
      readOnlySetting('Owner token', hasOwner ? 'Present' : 'Absent', hasOwner
        ? 'This window may approve, commit, delete a recording, and start pairing. Its token is never rendered or logged.'
        : 'This page was not launched with the owner nonce, so it can read but cannot approve.', hasOwner ? 'good' : 'warn')),
    settingItem('capabilities', 'Proposer token', 'Agents may propose and read, but POST /approvals rejects this token.', 'agent topology law l6 cannot approve',
      readOnlySetting('Proposer token', 'Not in this page', 'The protected workspace file is held by agents. This browser has no copy and cannot reveal it.', 'good')),
  ];

  let origin = '';
  try { origin = String(location.origin || ''); } catch { origin = ''; }
  let port = '';
  try { port = String(location.port || (location.protocol === 'https:' ? '443' : '80')); } catch { port = ''; }
  const build = (state && state.data && state.data.build) || {};
  const buildSha = build.sha ? String(build.sha) : '';
  const buildVer = build.version ? String(build.version) : '';
  const buildValue = buildSha
    ? buildSha.slice(0, 12) + (buildVer ? ' · v' + buildVer : '')
    : (buildVer ? 'v' + buildVer : 'Unstamped dev build');
  const buildNote = buildSha
    ? 'Stamped from the environment at release. This is the exact code this window is talking to — quote it in a bug report.'
    : 'This build carries no release SHA (a dev or local build), so it reports none rather than invent one. Released builds stamp it.';
  const runtime = [
    settingItem('runtime', 'Origin', 'Read from this page’s own address, not from configured copy.', 'url address local daemon',
      readOnlySetting('Origin', origin ? esc(origin) : 'Not readable', 'The endpoint this window is actually talking to.', origin ? '' : 'warn')),
    settingItem('runtime', 'Port', 'Read from the live page address.', 'socket endpoint local',
      readOnlySetting('Port', port ? esc(port) : 'Not readable', 'The port this browser is using right now.', port ? '' : 'warn')),
    settingItem('runtime', 'Network binding', 'The daemon socket is not reachable from the network.', 'loopback 127 localhost security',
      readOnlySetting('Network binding', 'Loopback only', 'Only this machine can reach the HTTP daemon.', 'good')),
    settingItem('runtime', 'Ledger path', 'No HTTP route exposes the ledger location.', 'file audit storage cli startup',
      readOnlySetting('Ledger path', 'Not served', 'The daemon prints the path on startup, and the CLI reads the same file. This page cannot invent it.', '')),
    settingItem('runtime', 'Build', 'Release SHA and version, stamped from the environment at release.', 'version sha release build artifact diagnostics',
      readOnlySetting('Build', esc(buildValue), buildNote, buildSha ? 'good' : '')),
    settingItem('runtime', 'Diagnostics', 'An opt-in, local, redacted log of failed daemon calls for a bug report.', 'error trace retry diagnostics export copy support id release',
      diagnosticsHtml()),
  ];

  return SETTINGS_CATEGORIES.map((category) => ({
    ...category,
    items: { general, policy, capabilities, runtime }[category.id],
  }));
}

function renderSettingsGroups(groups, query, selectedId) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const selected = settingsCategory(selectedId);
  const visible = terms.length
    ? groups.map((group) => ({ ...group, items: group.items.filter((item) => terms.every((term) => item.search.includes(term))) }))
      .filter((group) => group.items.length)
    : groups.filter((group) => group.id === selected.id);
  const count = visible.reduce((total, group) => total + group.items.length, 0);
  if (!count) {
    return '<div class="zs-settings-empty">' + empty('⌕', 'No settings match.',
      'Try a setting name such as theme, receipts, capabilities, or runtime.') + '</div>';
  }
  return visible.map((group) => '<section class="zs-settings-group" aria-labelledby="zs-settings-group-' + esc(group.id) + '">'
    + (terms.length ? '<div class="zs-settings-group-head"><h3 id="zs-settings-group-' + esc(group.id) + '">' + esc(group.label)
      + '</h3><span>' + esc(String(group.items.length)) + ' ' + plural(group.items.length, 'setting', 'settings') + '</span></div>' : '')
    + '<div class="zs-settings-items">' + group.items.map((item) => item.html).join('') + '</div></section>').join('');
}

function renderSettingsDialog(state) {
  const groups = buildSettingsGroups(state);
  const query = String(S.settingsQuery || '');
  const selectedMeta = settingsCategory(S.settingsCategory);
  const selected = groups.find((group) => group.id === selectedMeta.id) || groups[0];
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const resultCount = terms.length
    ? groups.reduce((total, group) => total + group.items.filter((item) => terms.every((term) => item.search.includes(term))).length, 0)
    : selected.items.length;
  const title = terms.length ? 'Search results' : selected.label;
  const description = terms.length
    ? `${resultCount} ${plural(resultCount, 'setting', 'settings')} match “${query.trim()}” across Zeno.`
    : selected.description;
  const tabs = (terms.length
    ? [{ id: 'search', glyph: '⌕', label: 'Search results' }, ...SETTINGS_CATEGORIES]
    : SETTINGS_CATEGORIES).map((category) => {
      const on = terms.length ? category.id === 'search' : category.id === selected.id;
      return '<button type="button" role="tab" class="zs-settings-tab" data-settings-category="' + esc(category.id) + '" '
        + 'id="zs-settings-tab-' + esc(category.id) + '" '
        + 'data-settings-focus="tab:' + esc(category.id) + '" aria-selected="' + (on ? 'true' : 'false') + '" '
        + 'aria-controls="zs-settings-panel" tabindex="' + (on ? '0' : '-1') + '">'
        + '<span class="zs-settings-tab-glyph" aria-hidden="true">' + esc(category.glyph) + '</span>'
        + '<span>' + esc(category.label) + '</span></button>';
    }).join('');
  const labelledBy = terms.length ? 'zs-settings-title' : 'zs-settings-tab-' + selected.id;

  return '<div class="zs-settings-frame">'
    + '<aside class="zs-settings-side" aria-label="Settings categories">'
    + '<div class="zs-settings-side-head"><div class="zs-settings-word"><img src="/brand/mark.svg" alt="" aria-hidden="true"><span>Zeno settings</span></div>'
    + '<button type="button" class="zs-settings-close" data-close-settings data-settings-focus="close" aria-label="Close settings">×</button></div>'
    + '<label class="zs-settings-search"><span aria-hidden="true">⌕</span>'
    + '<input id="zs-settings-search" data-settings-focus="search" type="search" value="' + esc(query) + '" '
    + 'placeholder="Search settings" aria-label="Search settings" autocomplete="off" spellcheck="false" aria-controls="zs-settings-panel"></label>'
    + '<div class="zs-settings-tabs" role="tablist" aria-orientation="vertical">' + tabs + '</div>'
    + '<p class="zs-settings-local">Preferences stay on this device. Policy and runtime facts come from the local daemon.</p>'
    + '</aside><section class="zs-settings-main">'
    + '<header class="zs-settings-main-head"><p class="zs-k">Command preferences</p><h2 id="zs-settings-title">' + esc(title) + '</h2>'
    + '<p>' + esc(description) + '</p></header>'
    + '<div class="zs-settings-panel" id="zs-settings-panel" role="tabpanel" aria-labelledby="' + esc(labelledBy) + '">'
    + renderSettingsGroups(groups, query, selected.id) + '</div></section></div>';
}

function renderSettings(state) {
  const loaded = state && state.ok;
  const hasOwner = token() !== '';
  const body = '<div class="zs-settings-launch"><div class="zs-settings-launch-copy">'
    + '<h3>Preferences, policy, capabilities, and runtime</h3>'
    + '<p>Open a searchable settings workspace. Existing controls still use the same Command state and stay on this device.</p>'
    + '<div class="zs-facts">' + fact('4 device preferences')
    + fact(loaded ? 'policy read' : 'policy not yet read', loaded ? 'gr' : 'am')
    + fact(hasOwner ? 'owner capability present' : 'read-only window', hasOwner ? 'cy' : 'am') + '</div></div>'
    + '<button type="button" class="btn p zs-settings-open" data-open-settings>Open settings</button></div>';
  return plane('sec-settings', 'Settings', WORDS.settingsSub, body);
}

/* ---- the standing sentences, in one place so they cannot drift ------------- */
const WORDS = {
  workstationSub: 'The sandbox repository as git reports it right now — the branch, the commit under it, '
    + 'and every file that has changed and not yet been committed.',
  vaultSub: 'Governed local memory. Notes are files on this disk, redacted for secrets before they are '
    + 'written, and recall shows the terms it matched on.',
  integrationsSub: 'Everything this Zeno is connected to, and for each one: whether it is configured, '
    + 'whether it answered, and whether using it leaves this machine.',
  settingsSub: 'The rules that were in force, the two capabilities that make approval structural, and '
    + 'what this particular window has been told.',
};

/* ================================================================== *
 * state, painting and the one control that sends anything             *
 * ================================================================== */

const S = {
  forge: null,      // GET /forge/status
  mem: null,        // GET /memory  (or /memory?q=)
  pending: null,    // GET /memory/pending — agent-proposed memories waiting for the owner
  brief: null,      // GET /brief
  work: null,       // GET /work
  agents: null,     // GET /forge/agents
  skills: null,     // GET /skills
  state: null,      // GET /state
  query: '',        // the Vault search box's current query
  settingsCategory: 'general', // the modal's selected real settings group
  settingsQuery: '',           // local filtering only; it is never sent anywhere
  agentsAt: 0,      // when the runtime was last asked — it pokes Ollama, so it is not polled hard
};

function mount(name) { return document.querySelector('[data-mount="' + name + '"]'); }
function paint(name, html) { const el = mount(name); if (el) el.innerHTML = html; }

const SETTINGS_DIALOG_ID = 'zs-settings-dialog';
let settingsOpener = null;

function ensureSettingsDialog() {
  let dialog = document.getElementById(SETTINGS_DIALOG_ID);
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = SETTINGS_DIALOG_ID;
  dialog.className = 'zs-settings-dialog';
  dialog.setAttribute('aria-labelledby', 'zs-settings-title');
  dialog.innerHTML = '<div data-settings-dialog-body></div>';
  dialog.addEventListener('close', () => {
    if (settingsOpener && settingsOpener.isConnected && settingsOpener.focus) {
      settingsOpener.focus({ preventScroll: true });
    }
    settingsOpener = null;
  });
  document.body.appendChild(dialog);
  return dialog;
}

function settingsFocusSnapshot() {
  const dialog = document.getElementById(SETTINGS_DIALOG_ID);
  const active = document.activeElement;
  if (!dialog || !dialog.open || !active || !dialog.contains(active)) return null;
  const key = active.getAttribute && active.getAttribute('data-settings-focus');
  if (!key) return null;
  const snapshot = { key };
  if (active.id === 'zs-settings-search') {
    snapshot.start = active.selectionStart;
    snapshot.end = active.selectionEnd;
  }
  return snapshot;
}

function restoreSettingsFocus(snapshot) {
  if (!snapshot) return;
  const dialog = document.getElementById(SETTINGS_DIALOG_ID);
  if (!dialog || !dialog.open) return;
  const target = Array.from(dialog.querySelectorAll('[data-settings-focus]'))
    .find((element) => element.getAttribute('data-settings-focus') === snapshot.key);
  if (!target || !target.focus) return;
  target.focus({ preventScroll: true });
  if (target.id === 'zs-settings-search' && snapshot.start != null) {
    try { target.setSelectionRange(snapshot.start, snapshot.end == null ? snapshot.start : snapshot.end); } catch { /* not a text input */ }
  }
}

function settingsSearchFocused() {
  const active = document.activeElement;
  return !!(active && active.id === 'zs-settings-search');
}

function paintSettingsDialog(opts) {
  const dialog = ensureSettingsDialog();
  const body = dialog.querySelector('[data-settings-dialog-body]');
  if (!body) return;
  // A background state poll must not replace the field while the owner types.
  // Explicit search input uses force=true and restores the exact selection.
  if (settingsSearchFocused() && !(opts && opts.force)) return;
  const snapshot = (opts && opts.snapshot) || settingsFocusSnapshot();
  body.innerHTML = renderSettingsDialog(S.state);
  restoreSettingsFocus(snapshot);
}

function openSettings() {
  const dialog = ensureSettingsDialog();
  if (!dialog.open) settingsOpener = document.activeElement;
  paintSettingsDialog({ force: true });
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  // The dialog shows facts from GET /state (receipts/chain totals, build). On the
  // Home view the section poll has not run, so S.state can be null — read it now
  // and force the dialog to repaint once it lands, rather than show "unstamped"
  // over a build the daemon does in fact know.
  if (!S.state) refresh().then(() => paintSettingsDialog({ force: true }));
  const search = dialog.querySelector('#zs-settings-search');
  if (search && search.focus) search.focus({ preventScroll: true });
}

function closeSettings() {
  const dialog = document.getElementById(SETTINGS_DIALOG_ID);
  if (!dialog || !dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/* A repaint replaces the search box, which would eat what is being typed into
   it on the next poll. So the Vault is left alone while its box has focus: the
   data behind it is still refreshed and lands on the next paint. */
function typing() {
  const a = document.activeElement;
  return !!(a && a.id === 'zs-vq');
}

function repaint() {
  const settingsFocus = settingsFocusSnapshot();
  paint('sec-workstation', renderWorkstation(S.forge));
  if (!typing()) paint('sec-vault', renderVault(S.mem, S.brief, S.query, S.pending));
  paint('sec-integrations', renderIntegrations(S.work, S.agents, S.skills));
  paint('sec-settings', renderSettings(S.state));
  paintSettingsDialog({ snapshot: settingsFocus });
}

/* After a search, the box is redrawn — put the cursor back in it, or the second
   query has to be started by finding the box again with the mouse. */
function repaintAndFocusSearch() {
  const settingsFocus = settingsFocusSnapshot();
  paint('sec-workstation', renderWorkstation(S.forge));
  paint('sec-vault', renderVault(S.mem, S.brief, S.query, S.pending));
  paint('sec-integrations', renderIntegrations(S.work, S.agents, S.skills));
  paint('sec-settings', renderSettings(S.state));
  paintSettingsDialog({ snapshot: settingsFocus });
  const input = document.getElementById('zs-vq');
  if (input && input.focus) {
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* not a text input */ }
  }
}

/* Related Command panels inspect installed agents through the passive route
   only while visible. Rendering or re-checking Integrations must never start
   Ollama; an explicit local-model execution owns that choice. */
const AGENTS_MIN_MS = 60000;
const SECTION_PANELS = new Set(['sec-workstation', 'sec-vault', 'sec-integrations', 'sec-settings']);

function sectionsVisible() {
  const command = document.querySelector('[data-surface="command"]');
  return document.visibilityState === 'visible'
    && !command?.hidden
    && SECTION_PANELS.has(command?.dataset.commandPanel || '');
}

let reading = false;
let queued = null;   // a click that arrived mid-poll — dropped, it would look like the click did nothing

async function refresh(opts) {
  if (reading) {
    // A search typed while the 15s poll was in flight must not be swallowed:
    // remember it and run it the moment the poll lands.
    if (opts) queued = Object.assign({}, queued || {}, opts);
    return;
  }
  reading = true;
  try {
    const wantAgents = (opts && opts.agents) || S.agents === null || (Date.now() - S.agentsAt) > AGENTS_MIN_MS;
    const memPath = S.query ? '/memory?q=' + encodeURIComponent(S.query) : '/memory';
    const [forge, mem, brief, work, state, agents, skills, pending] = await Promise.all([
      api('/forge/status'),
      api(memPath),
      api('/brief'),
      api('/work'),
      api('/state'),
      wantAgents ? api('/forge/agents?passive=1') : Promise.resolve(S.agents),
      api('/skills'),
      // Only the owner can approve, so only the owner asks for the queue. A missing
      // token means the served page is read-only and there is nothing to approve.
      token() ? api('/memory/pending') : Promise.resolve(null),
    ]);
    // Each read is settled on its own: a vault that is not enabled must not
    // blank the workstation, and a failed brief must not blank the notes.
    S.forge = forge; S.mem = mem; S.brief = brief; S.work = work; S.state = state; S.skills = skills; S.pending = pending;
    if (wantAgents) { S.agents = agents; S.agentsAt = Date.now(); }
    if (opts && opts.focusSearch) repaintAndFocusSearch(); else repaint();
  } finally {
    reading = false;
    if (queued) { const q = queued; queued = null; refresh(q); }
  }
}

/* ---- the controls. One GET, and four clicks that forward to the top bar. --- */
function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;

    const dialog = document.getElementById(SETTINGS_DIALOG_ID);
    if (t.closest('[data-close-settings]') || (dialog && t === dialog)) {
      closeSettings();
      return;
    }
    if (t.closest('[data-open-settings]') || t.closest('.rail-n[data-jump="sec-settings"]')) {
      openSettings();
      return;
    }
    const categoryButton = t.closest('[data-settings-category]');
    if (categoryButton) {
      const id = categoryButton.getAttribute('data-settings-category');
      if (id === 'search') {
        const input = document.getElementById('zs-settings-search');
        if (input && input.focus) input.focus({ preventScroll: true });
        return;
      }
      if (SETTINGS_CATEGORIES.some((category) => category.id === id)) {
        S.settingsCategory = id;
        S.settingsQuery = '';
        paintSettingsDialog({ force: true, snapshot: { key: `tab:${id}` } });
      }
      return;
    }

    if (t.closest('[data-vault-remember]')) {
      const input = document.getElementById('zs-add-note');
      const status = document.getElementById('zs-add-status');
      const text = input ? String(input.value || '').trim() : '';
      if (!text) { if (status) status.textContent = 'Type the note first.'; return; }
      if (status) status.textContent = 'Saving…';
      // The owner's own note: title is a short handle, body is the full text.
      // The daemon sanitizes every field for secrets before it reaches Vault.
      apiWrite('/memory', { kind: 'fact', title: text.slice(0, 120), body: text, tags: [] })
        .then((r) => {
          if (r.ok) { if (input) input.value = ''; if (status) status.textContent = 'Remembered.'; refresh(); }
          else if (status) status.textContent = 'Not saved: ' + ((r.error && r.error.message) || 'the daemon refused it');
        });
      return;
    }
    if (t.closest('[data-vault-approve]')) {
      const btn = t.closest('[data-vault-approve]');
      const actionHash = btn.getAttribute('data-vault-approve');
      if (!actionHash || btn.disabled) return;
      btn.disabled = true;
      btn.textContent = 'Approving…';
      // The one write this queue makes: the owner saying yes to one waiting
      // memory. On success the record is committed with a receipt and appears in
      // the notes below, so a plain refresh tells the truth either way.
      apiWrite('/memory/approvals', { actionHash }).then((r) => {
        if (r.ok) { refresh(); return; }
        btn.disabled = false;
        btn.textContent = 'Approve';
        btn.title = 'Not approved: ' + ((r.error && r.error.message) || 'the daemon refused it')
          + ((r.error && r.error.resolve) ? ' — ' + r.error.resolve : '');
      });
      return;
    }
    if (t.closest('[data-vault-forget]')) {
      const btn = t.closest('[data-vault-forget]');
      const id = btn.getAttribute('data-vault-forget');
      if (!id) return;
      // Two-step, because DELETE is permanent and unreceipted. The first click
      // arms and says exactly what the second one does; it disarms itself after
      // a few seconds so a click now cannot delete a note minutes later.
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.textContent = 'Delete for good';
        window.setTimeout(() => {
          if (!btn.isConnected || btn.getAttribute('data-armed') !== '1') return;
          btn.setAttribute('data-armed', '0');
          btn.textContent = 'Forget';
        }, 4000);
        return;
      }
      btn.setAttribute('data-armed', '0');
      btn.textContent = 'Forgetting…';
      btn.disabled = true;
      // forgotten:false just means the id was already gone — either way it is not
      // here now, so a plain refresh is the honest outcome in both cases.
      apiDelete('/memory/' + encodeURIComponent(id)).then(() => refresh());
      return;
    }
    if (t.closest('[data-vault-import]')) {
      const file = document.getElementById('zs-import-file');
      if (file) file.click(); // the hidden file input; its change handler does the work
      return;
    }
    if (t.closest('[data-vault-export-all]')) {
      const notes = (S.mem && S.mem.ok && S.mem.data && Array.isArray(S.mem.data.notes)) ? S.mem.data.notes : [];
      const status = document.getElementById('zs-import-status');
      if (!notes.length) { if (status) status.textContent = 'Nothing to export yet.'; return; }
      const ok = downloadJson('zeno-memory-export.json', notes);
      if (status) status.textContent = ok ? `Exported ${notes.length} note${notes.length === 1 ? '' : 's'}.` : 'The browser blocked the download.';
      return;
    }
    if (t.closest('[data-vault-find]')) {
      const input = document.getElementById('zs-vq');
      S.query = input ? String(input.value || '').trim() : '';
      refresh({ focusSearch: true });
      return;
    }
    if (t.closest('[data-vault-clear]')) {
      S.query = '';
      refresh({ focusSearch: true });
      return;
    }
    if (t.closest('[data-recheck]')) {
      S.agents = null;
      refresh({ agents: true });
      return;
    }
    // Diagnostics (Settings → Runtime): opt-in recording, and Copy/Export/Clear
    // of the redacted failure log. Re-render the dialog on the Runtime tab so the
    // toggle and list reflect the new state immediately.
    if (t.closest('[data-diag-toggle]')) {
      setDiagOn(!diagOn());
      paintSettingsDialog({ force: true, snapshot: { key: 'tab:runtime' } });
      return;
    }
    if (t.closest('[data-diag-copy]')) { copyText(JSON.stringify(diag.events, null, 2)); return; }
    if (t.closest('[data-diag-export]')) { downloadJson('zeno-diagnostics.json', diag.events); return; }
    if (t.closest('[data-diag-clear]')) {
      diag.events.length = 0;
      paintSettingsDialog({ force: true, snapshot: { key: 'tab:runtime' } });
      return;
    }
    // A preference is owned by the top bar's control. Clicking it there is the
    // single source of truth; this button forwards rather than keeping a second
    // copy of the state that could drift from it.
    const ctl = t.closest('[data-ctl]');
    if (ctl) {
      const focusKey = ctl.getAttribute('data-settings-focus');
      const b = document.getElementById(ctl.getAttribute('data-ctl'));
      if (b) b.click();
      paint('sec-settings', renderSettings(S.state));
      paintSettingsDialog({ force: true, snapshot: focusKey ? { key: focusKey } : null });
    }
  });

  // The Vault import file input. Reading the file is local; only the parsed notes
  // are POSTed, and the daemon sanitizes every field before it writes. The result
  // is stated plainly — imported, redacted, skipped — never a silent success.
  document.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || input.id !== 'zs-import-file') return;
    const status = document.getElementById('zs-import-status');
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => { if (status) status.textContent = 'That file could not be read.'; };
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result || '')); } catch {
        if (status) status.textContent = 'That is not valid JSON. Export a Vault file, or an array of notes.';
        input.value = '';
        return;
      }
      const notes = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.notes) ? parsed.notes : null);
      if (!notes) { if (status) status.textContent = 'No notes array found in that file.'; input.value = ''; return; }
      if (status) status.textContent = `Importing ${notes.length}…`;
      apiWrite('/memory/import', { notes }).then((r) => {
        input.value = '';
        if (!r.ok) { if (status) status.textContent = 'Import failed: ' + ((r.error && r.error.message) || 'the daemon refused it'); return; }
        const d = r.data || {};
        if (status) status.textContent = `Imported ${d.imported || 0}` + (d.redacted ? ` · ${d.redacted} secret-like value${d.redacted === 1 ? '' : 's'} redacted` : '') + (d.skipped ? ` · ${d.skipped} skipped` : '') + '.';
        refresh();
      });
    };
    reader.readAsText(file);
  });

  // Search is entirely local: values never leave the page and every keystroke
  // updates the real groups while preserving the caret in the replaced input.
  document.addEventListener('input', (e) => {
    const input = e.target;
    if (!input || input.id !== 'zs-settings-search') return;
    S.settingsQuery = String(input.value || '');
    const snapshot = { key: 'search', start: input.selectionStart, end: input.selectionEnd };
    paintSettingsDialog({ force: true, snapshot });
  });

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el) return;

    // The category list follows the ARIA tabs keyboard pattern. Both axes are
    // accepted because the same tabs become horizontal on narrow windows.
    const tab = el.closest && el.closest('[role="tab"][data-settings-category]');
    if (tab && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      const tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
      const at = tabs.indexOf(tab);
      let next = at;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (at + 1) % tabs.length;
      else next = (at - 1 + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[next].click();
      return;
    }

    // Enter in the Vault search performs its existing loopback GET. Settings
    // search needs no Enter key because its local result set is already live.
    if (e.key === 'Enter' && el.id === 'zs-vq') {
      e.preventDefault();
      S.query = String(el.value || '').trim();
      refresh({ focusSearch: true });
    }
  });
}

/* ---- boot ------------------------------------------------------------------ */
let started = false;
export function init() {
  if (started) return; started = true;
  if (!mount('sec-workstation')) return;   // the shell does not have these sections
  ensureStyles();
  ensureSettingsDialog();
  repaint();                            // the honest "not loaded" state, first
  wire();
  if (sectionsVisible()) refresh();

  window.addEventListener('zeno:state', () => { if (sectionsVisible()) refresh(); });
  window.addEventListener('zeno:command-panel', event => {
    if (SECTION_PANELS.has(event.detail?.id || '')) refresh();
  });
  setInterval(() => { if (sectionsVisible()) refresh(); }, 15000);

  // A theme, reduce-motion or transparency toggle changes how things are shown,
  // not what is true: repaint from state already in hand, never re-reading.
  try {
    new MutationObserver(() => repaint())
      .observe(R, { attributes: true, attributeFilter: ['data-theme', 'data-reduce', 'data-flat'] });
  } catch { /* no MutationObserver: the sections simply do not repaint on a toggle */ }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
else init();

export default { init };
