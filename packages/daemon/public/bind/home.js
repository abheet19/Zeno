/*
 * bind/home.js — binds the Command HOME screen to real daemon state and
 * mounts the REAL Standing Field (field.js) into the artifact's orb canvas.
 *
 * Endpoints read here: GET /state, GET /work, GET /forge/status, GET /memory,
 * GET /forge/agents?passive=1. Every number drawn on screen comes from one of
 * these reads; a read that failed draws "—" or a plain sentence, never a
 * hopeful zero and never the artifact's mock placeholder left standing.
 */
import { getJSON, $, $$, el, fill, token } from '../bind.js';

const HOME = '.screen[data-screen="home"]';
/* No endpoint this daemon serves (/state, /work, /forge/status, /memory,
   /forge/agents) reports an owner name — checked all four. Abheet is the one
   owner this daemon is built for, same fallback field.js's greeting uses. */
const OWNER_NAME = 'Abheet';

function q(sel) { return $(`${HOME} ${sel}`); }
function qq(sel) { return $$(`${HOME} ${sel}`); }

function txt(s) { return document.createTextNode(s); }
function bTxt(s) { const b = document.createElement('b'); b.textContent = s; return b; }
function spanOf(...kids) { const s = document.createElement('span'); s.append(...kids); return s; }
function sep() { return el('span', 'sep'); }
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
/* Two constant, decorative icon glyphs (not daemon data) — the only innerHTML
   in this file, and it never carries a live string. */
function svgIcon(markup) { const host = document.createElement('span'); host.innerHTML = markup; return host.firstElementChild; }
const SVG_APPROVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-6.2-6.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h5a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.4z"/><circle cx="8" cy="8" r="1.3"/></svg>';
const SVG_FORGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';

/* ---- one honest read of /state, shared by the banner, the kernel line, the
   orb-state line and the Needs-you card, so none of them can disagree. ---- */
function deriveState(stateRes) {
  const ok = stateRes.ok;
  const data = ok ? stateRes.data : null;
  const pendingAll = ok && Array.isArray(data.pending) ? data.pending : [];
  const pending = pendingAll.filter((p) => !(p && p.denied));
  const receipts = ok && Array.isArray(data.receipts) ? data.receipts : [];
  const chainOk = ok && data.chain && typeof data.chain.ok === 'boolean' ? data.chain.ok : null;
  return { ok, pending, receipts, chainOk, needs: ok ? pending.length : null };
}

/* ---- greet: real local time, the one owner's name ------------------------ */
function bindGreet() {
  const h1 = q('.greet h1');
  if (!h1) return;
  let hr = 12;
  try { hr = new Date().getHours(); } catch { /* no clock */ }
  const part = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
  h1.textContent = `Good ${part}, ${OWNER_NAME}.`;
}

/* ---- the amber attn banner, the orb-state line, the kernel chain line ---- */
function bindAttnKernelOrb(st) {
  const orbState = q('.orb-state');
  if (orbState) {
    orbState.textContent = !st.ok
      ? 'state unread · the daemon did not answer'
      : st.needs === 0
        ? 'all clear · nothing is waiting on you'
        : `${st.needs} ${st.needs === 1 ? 'decision needs you' : 'decisions need you'}`;
  }

  const attn = q('.attn');
  if (attn) {
    const show = st.ok && st.needs > 0;
    attn.hidden = !show;
    if (show) {
      const mid = Array.from(attn.children).find((c) => !c.classList.contains('ai') && !c.classList.contains('go'));
      if (mid) {
        fill(mid,
          bTxt(`${st.needs} ${st.needs === 1 ? 'decision' : 'decisions'}`),
          txt(` ${st.needs === 1 ? 'is' : 'are'} waiting for your approval`));
      }
    }
  }

  const kernel = q('.kernel');
  if (kernel) {
    const dot = el('span', 'ok');
    if (st.chainOk === false) { dot.style.background = 'var(--red)'; dot.style.boxShadow = '0 0 6px var(--red)'; }
    else if (st.chainOk !== true) { dot.style.background = 'var(--ink-3)'; dot.style.boxShadow = 'none'; }
    const chainWord = !st.ok ? 'chain unread'
      : st.chainOk === true ? 'chain verified'
        : st.chainOk === false ? 'chain broken' : 'chain not reported';
    const rc = st.receipts.length;
    const receiptsSpan = !st.ok
      ? spanOf(txt('receipts unread'))
      : spanOf(bTxt(String(rc)), txt(` ${rc === 1 ? 'receipt' : 'receipts'}`));
    const ownerSpan = token()
      ? spanOf(bTxt('owner token'), txt(' held'))
      : spanOf(bTxt('read-only'), txt(' · no owner token'));
    fill(kernel,
      spanOf(dot, bTxt(chainWord)), sep(),
      receiptsSpan, sep(),
      spanOf(bTxt('Ed25519'), txt(' signed')), sep(),
      ownerSpan, sep(),
      spanOf(txt('policy '), bTxt('built-in')));
  }
}

/* ---- "Needs you": the real approval queue, top three, honest Review CTA -- */
function setSum(header, n) {
  if (!header) return;
  const sum = header.querySelector('.sum');
  if (!sum) return;
  sum.textContent = n == null ? '—' : (n > 0 ? String(n) : '');
}

function needsCard(p) {
  const summary = clip(p.summary || (p.request && p.request.summary) || p.actionHash || 'a pending action', 46);
  const meta = p.tier ? `tier ${p.tier} · held for your approval` : 'held for your approval';
  const card = el('div', 'lcard needs');
  const lk = el('div', 'lk'); lk.append(svgIcon(SVG_APPROVE), txt(summary));
  const lm = el('div', 'lm', meta);
  const pill = el('span', 'pill am'); pill.append(el('span', 'd'), txt('1 approval'));
  const btn = el('button', 'laction', 'Review'); btn.setAttribute('data-screen-jump', 'approvals');
  const lr = el('div', 'lr'); lr.append(pill, btn);
  card.append(lk, lm, lr);
  return card;
}

function bindNeedsYou(st, sec) {
  if (!sec) return;
  const header = sec.querySelector('.hs-h');
  setSum(header, st.needs);
  let body;
  if (!st.ok) body = [el('div', 'hnote', 'The approval queue could not be read.')];
  else if (st.pending.length === 0) body = [el('div', 'hnote', 'Nothing is waiting on you.')];
  else body = st.pending.slice(0, 3).map(needsCard);
  fill(sec, header, ...body);
}

/* ---- "Running": the real workspace state from /forge/status -------------- */
function runningCard(forge, changed) {
  const branch = clip(forge.branch || '(unknown)', 20);
  const head = forge.head ? ` @ ${String(forge.head).slice(0, 7)}` : '';
  const card = el('div', 'lcard');
  const lk = el('div', 'lk'); lk.append(svgIcon(SVG_FORGE), txt(`Forge workspace · ${branch}`));
  const lm = el('div', 'lm', `${changed} uncommitted change${changed === 1 ? '' : 's'}${head}`);
  const pill = el('span', 'pill cy'); pill.append(el('span', 'd'), txt('in the workspace'));
  const btn = el('button', 'laction', 'Open Forge'); btn.setAttribute('data-product-go', 'forge');
  const lr = el('div', 'lr'); lr.append(pill, btn);
  card.append(lk, lm, lr);
  return card;
}

function bindRunning(forgeRes, sec) {
  if (!sec) return;
  const header = sec.querySelector('.hs-h');
  const ok = forgeRes.ok;
  const data = ok ? forgeRes.data : null;
  const hasRepo = ok && data.repo === true;
  const changed = hasRepo && Array.isArray(data.changed) ? data.changed.length : 0;
  // "Running" counts AGENT RUNS, which bind/orchestrator.js reads live from
  // the daemon's run-progress stream and writes into this header itself. This
  // read only knows the workspace's repo state, and uncommitted changes are not
  // a running process — counting them here put "RUNNING · 1" over a machine
  // where nothing ran. So this header says 0 until the orchestrator sees a
  // real run; the workspace card below is kept, labelled as what it is.
  setSum(header, !ok ? null : 0);
  let body;
  if (!ok) body = [el('div', 'hnote', 'The workspace could not be read.')];
  else if (!hasRepo) body = [el('div', 'hnote', 'No agent is running. No workspace repository yet.')];
  else if (changed > 0) body = [el('div', 'hnote', 'No agent is running.'), runningCard(data, changed)];
  else body = [el('div', 'hnote', 'No agent is running. The workspace is clean.')];
  fill(sec, header, ...body);
}

/* ---- "Today": verified / in the workspace / backlog / memories / left this
   machine — each an honest count, or an em dash when that read failed. ---- */
function bindToday(st, workRes, forgeRes, memRes, sec) {
  if (!sec) return;
  const dl = sec.querySelector('.hs-stats');
  if (!dl) return;
  const dds = $$('dd', dl);

  const verified = st.ok ? st.receipts.filter((r) => (r && (r.outcome || r.state)) === 'verified').length : null;

  const forgeOk = forgeRes.ok;
  const changed = forgeOk && forgeRes.data.repo === true && Array.isArray(forgeRes.data.changed)
    ? forgeRes.data.changed.length : (forgeOk ? 0 : null);

  const workOk = workRes.ok;
  const items = workOk && Array.isArray(workRes.data.items) ? workRes.data.items : [];
  const backlog = workOk ? items.length : null;

  const memories = memRes.ok && Array.isArray(memRes.data.notes) ? memRes.data.notes.length : null;

  /* "left this machine" must count what ACTUALLY left.
     It used to add up configured non-local work sources and installed hosted
     agents, which is a count of what COULD leave — so a fresh workspace with an
     empty ledger read "left this machine: 2" purely because the claude and codex
     CLIs are installed. On the one surface whose entire promise is that nothing
     leaves without a receipt, that number was the worst kind of wrong.
     The ledger is the only honest source: T2 is defined in policy.ts as the
     first tier that demands an authenticator, i.e. the tier at which the bytes
     leave, so a sealed receipt at T2 or above is a thing that actually left. */
  const EGRESS_TIERS = new Set(['T2', 'T3', 'T4']);
  const egress = st.ok ? st.receipts.filter((r) => r && EGRESS_TIERS.has(r.tier)).length : null;

  [verified, changed, backlog, memories, egress].forEach((v, i) => {
    if (dds[i]) dds[i].textContent = v == null ? '—' : String(v);
  });
}

/* ---- the composer's model pill: the real installed local model, if any -- */
function bindModelPill(agentsRes) {
  const pill = q('[data-model-pill]');
  if (!pill) return;
  let label;
  if (!agentsRes.ok) label = 'model unread';
  else {
    const models = Array.isArray(agentsRes.data.localModels) ? agentsRes.data.localModels : [];
    label = models.length ? `${models[0]} · local` : 'no local model installed';
  }
  fill(pill, el('span', 'd'), txt(`${label} ▾`));
}

/* ---- mount the REAL Standing Field into the artifact's orb container ----
   field.js owns the canvas engine and its own /state·/work·/forge·/memory·
   /counsel·/forge-agents reads; it mounts into [data-mount="field"], which
   the artifact does not define, so it is added here at runtime. field.js
   replaces that container's innerHTML with its own <canvas id="field">,
   which is what actually detaches ui.js's mock <canvas id="orb"> — ui.js's
   own rAF loop cannot be reached or stopped from here (ORB is private to its
   closure and never exposed on window), so it keeps ticking against the now
   -detached, invisible node. That is the "cannot coexist cleanly" case the
   task called out: the REAL field is what renders; the mock loop is inert. */
async function mountField() {
  const wrap = q('.orb-wrap');
  if (!wrap) return;
  wrap.setAttribute('data-mount', 'field');

  /* The node card's host. field.js renders a picked node into
     [data-mount="node-card"] and returns early when no such element exists —
     which the artifact's markup does not define. The result was that clicking a
     node in the field selected it internally and then drew nothing: the orb
     looked dead even though it was working. `.orb-wrap` is position:relative,
     which is the containing block this overlay is written for. It is created
     BEFORE field.js initialises so the first render already has somewhere to
     go. */
  let card = wrap.querySelector('[data-mount="node-card"]');
  if (!card) {
    card = document.createElement('div');
    card.setAttribute('data-mount', 'node-card');
    wrap.appendChild(card);
  }

  const mod = await import('../field.js');
  if (mod && typeof mod.init === 'function') mod.init();
  const canvas = wrap.querySelector('canvas');
  if (canvas) { canvas.style.cursor = 'grab'; canvas.style.touchAction = 'none'; canvas.style.display = 'block'; }
  // field.js replaces the mount's children with its own canvas, so the card
  // host is re-attached afterwards rather than assumed to have survived.
  if (!wrap.querySelector('[data-mount="node-card"]')) wrap.appendChild(card);
}

export async function bind() {
  try { bindGreet(); } catch (err) { console.warn('[zeno home] greet', err); }

  const [stateRes, workRes, forgeRes, memRes, agentsRes] = await Promise.all([
    getJSON('/state'),
    getJSON('/work'),
    getJSON('/forge/status'),
    getJSON('/memory'),
    getJSON('/forge/agents?passive=1'),
  ]);
  const st = deriveState(stateRes);
  const secs = qq('.hside .hs-sec');

  try { bindAttnKernelOrb(st); } catch (err) { console.warn('[zeno home] attn/kernel/orb-state', err); }
  try { bindNeedsYou(st, secs[0]); } catch (err) { console.warn('[zeno home] needs-you', err); }
  try { bindRunning(forgeRes, secs[1]); } catch (err) { console.warn('[zeno home] running', err); }
  try { bindToday(st, workRes, forgeRes, memRes, secs[2]); } catch (err) { console.warn('[zeno home] today', err); }
  try { bindModelPill(agentsRes); } catch (err) { console.warn('[zeno home] model pill', err); }
  try { await mountField(); } catch (err) { console.warn('[zeno home] field mount', err); }
}
