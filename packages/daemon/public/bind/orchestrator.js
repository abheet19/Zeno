/*
 * bind/orchestrator.js — Command shows the live status of every running agent.
 *
 * The owner's vision: "Command is the orchestrator. Describe a task in
 * Command -> it opens a NEW agent/chat in Forge -> it works -> Command shows
 * the live status of every running agent." bind/ask.js + bind/forge/session.js
 * build the first half (a Command task really does open and start a new
 * Forge session, governed exactly like a typed Forge task). This module is
 * the second half: it subscribes to the SAME owner-only progress stream
 * bind/forge-progress.js already reads inside Forge (GET /forge/run-progress,
 * one `run-progress` SSE event per {runId, agentId, model, phase,
 * orchestrationPercent, terminal, outcome, tokenUsage}) and renders every run
 * it sees — not just the one Forge's own session panel happens to have open —
 * into Command Home's right-rail "Running" section.
 *
 * It never invents a run of its own: the daemon's event is the only source of
 * truth, exactly the same contract bind/forge-progress.js already relies on.
 * A read-only page (no owner token) gets no stream and renders nothing, same
 * as forge-progress.js.
 *
 * Each row's "Open" used to only switch to the Forge product tab, leaving the
 * owner to find the right session themselves among however many were open —
 * a nudge, not real control. It now also calls `window.zenoOpenForgeRun(runId)`
 * (session.js registers it) to focus the ACTUAL session that run belongs to,
 * when this window knows one; a run this window never started through the
 * composer still falls back to the tab switch, exactly as before.
 *
 * DOM ownership: bind/home.js repaints the "Running" `.hs-sec` every time it
 * (re)binds — on boot and again on every `state`/`preview`/`receipt`/`chain`
 * stream event (see bind/live.js's REBIND table) — via `fill(sec, header,
 * ...body)`, which replaces the section's children wholesale. Fighting that
 * by editing home.js is out of this module's lane, so instead this module
 * renders into its OWN child element (`.orch-runs`) that it re-asserts via a
 * MutationObserver every time home.js's repaint would otherwise wipe it out.
 * While at least one run is live, the sandbox card home.js drew is hidden
 * (not removed — home.js still owns it) and `.orch-runs` is shown in its
 * place; the moment no run is tracked any more, `.orch-runs` empties and
 * hides and home.js's own card is left exactly as it was.
 */
import { authHeaders } from '../bind.js';
import { subscribeRunProgress } from '../run-progress-stream.js';

/* Same wording as bind/forge-progress.js's PHASE_LABEL — duplicated rather
   than imported because forge-progress.js does not export it and this file's
   lane does not include editing that one. Keep these two lists in sync. */
const PHASE_LABEL = {
  'checking-provider': 'Checking the model is available',
  'preparing-worktree': 'Preparing an isolated worktree',
  'running-provider': 'The model is working',
  'inspecting-changes': 'Inspecting what changed',
  'proposing-changes': 'Preparing your approvals',
  complete: 'Done',
  completed: 'Done',
  cancelled: 'Cancelled',
  failed: 'Run failed',
};

/* How long a finished run's outcome stays visible before this module drops
   it — matches bind/forge-progress.js's own flash-then-clear window. */
const TERMINAL_HOLD_MS = 2600;

/** runId -> { agentId, model, phase, percent, tokenUsage, startedAt, terminal, outcome } */
const runs = new Map();

let sectionObserver = null;
let observedSection = null;
let tickTimer = null;
let rendering = false;

/* The original "Running <span class=sum>…</span>" text, stashed the first
   time this module overrides it with the live count, and restored the moment
   no run is tracked any more — so home.js's own sandbox-based number comes
   back exactly as it was rather than being left at whatever we last wrote. */
const sumStash = new WeakMap();

function fmtTokens(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const inN = Number(usage.tokensIn || usage.promptTokens || 0);
  const outN = Number(usage.tokensOut || usage.completionTokens || 0);
  if (!inN && !outN) return '';
  return ` · ${inN.toLocaleString()} in / ${outN.toLocaleString()} out tokens`;
}

function fmtElapsed(startedAt) {
  const s = Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** The `.hside` section whose header literally reads "Running…" — never the
 *  "Needs you" or "Today" sections, which share the same `.hs-sec`/`.hs-h`
 *  markup, and never a rail nav button (there is none for this label). */
function findSection() {
  for (const sec of document.querySelectorAll('.hside .hs-sec')) {
    const h = sec.querySelector(':scope > .hs-h');
    const label = h && h.textContent ? h.textContent.trim().replace(/\s+/g, ' ') : '';
    if (label.startsWith('Running')) return sec;
  }
  return null;
}

function ensureContainer(sec) {
  let c = sec.querySelector(':scope > .orch-runs');
  if (!c) {
    c = document.createElement('div');
    c.className = 'orch-runs';
    c.style.display = 'flex';
    c.style.flexDirection = 'column';
    c.style.gap = '8px';
    c.hidden = true;
    sec.appendChild(c);
  } else if (c.parentElement !== sec) {
    sec.appendChild(c);
  }
  return c;
}

function setLiveSum(sec, n) {
  const header = sec.querySelector(':scope > .hs-h');
  if (!header) return;
  const sum = header.querySelector('.sum');
  if (!sum) return;
  if (!sumStash.has(header)) sumStash.set(header, sum.textContent);
  sum.textContent = n > 0 ? String(n) : '';
}

function restoreSum(sec) {
  const header = sec.querySelector(':scope > .hs-h');
  if (!header) return;
  const sum = header.querySelector('.sum');
  if (!sum || !sumStash.has(header)) return;
  sum.textContent = sumStash.get(header);
  sumStash.delete(header);
}

function openForge(runId) {
  // Switch products by clicking the real segment button — exactly as
  // bind/ask.js's own "Run in Forge now" does.
  const btn = document.querySelector('.seg [data-product="forge"]');
  if (btn) btn.click();
  // Then, when Forge's own session.js has told us which in-window session this
  // runId belongs to (window.zenoOpenForgeRun — see that file's header), focus
  // THAT session rather than leaving the owner to find it among however many
  // are open. A run this window never started through the composer (a bare
  // POST /forge/run, or one from a session this window has since forgotten)
  // has no such session, and the fallback above — Forge is at least on
  // screen — is exactly what this control did before.
  if (runId && typeof window.zenoOpenForgeRun === 'function') window.zenoOpenForgeRun(runId);
}

async function cancelRun(runId, btn) {
  btn.disabled = true;
  btn.textContent = 'Cancelling…';
  try {
    const res = await fetch('/forge/run/cancel', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) {
      btn.disabled = false;
      btn.textContent = 'Cancel';
      return;
    }
    // The daemon confirms; the terminal 'cancelled' progress event that
    // follows is what actually removes this row (via onEvent -> render).
    btn.textContent = 'Cancelled';
  } catch {
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

function rowFor(runId, r) {
  const card = document.createElement('div');
  card.className = 'lcard';

  const lk = document.createElement('div');
  lk.className = 'lk';
  lk.textContent = `Forge · ${r.agentId || 'agent'}${r.model ? ' · ' + r.model : ''}`;

  const lm = document.createElement('div');
  lm.className = 'lm';
  lm.textContent = r.terminal
    ? (PHASE_LABEL[r.outcome] || PHASE_LABEL[r.phase] || 'Done')
    : `${PHASE_LABEL[r.phase] || r.phase || 'Working'} · ${Number.isFinite(r.percent) ? r.percent : 0}%${fmtTokens(r.tokenUsage)}`;

  const lr = document.createElement('div');
  lr.className = 'lr';

  const pill = document.createElement('span');
  const tone = !r.terminal ? 'cy' : r.outcome === 'failed' ? 'rd' : r.outcome === 'cancelled' ? 'wt' : 'gr';
  pill.className = `pill ${tone}`;
  const dot = document.createElement('span');
  dot.className = 'd';
  pill.append(dot, document.createTextNode(r.terminal ? (PHASE_LABEL[r.outcome] || 'done') : fmtElapsed(r.startedAt)));

  const actions = document.createElement('span');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'laction';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', () => openForge(runId));
  actions.appendChild(openBtn);

  if (!r.terminal) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'laction';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => void cancelRun(runId, cancelBtn));
    actions.appendChild(cancelBtn);
  }

  lr.append(pill, actions);
  card.append(lk, lm, lr);
  return card;
}

function render() {
  if (rendering) return;
  const sec = findSection();
  if (!sec) return;
  rendering = true;
  try {
    observeSection(sec);
    const c = ensureContainer(sec);
    const entries = [...runs.entries()];
    const liveCount = entries.filter(([, r]) => !r.terminal).length;

    if (entries.length === 0) {
      c.hidden = true;
      c.replaceChildren();
      for (const child of sec.children) { if (child !== c) child.hidden = false; }
      restoreSum(sec);
      stopTicking();
      return;
    }

    c.hidden = false;
    c.replaceChildren(...entries.map(([id, r]) => rowFor(id, r)));
    for (const child of sec.children) {
      if (child === c || child.classList.contains('hs-h')) continue;
      child.hidden = true;
    }
    setLiveSum(sec, liveCount);
    startTicking();
  } finally {
    rendering = false;
  }
}

function startTicking() {
  if (tickTimer) return;
  // Keeps the elapsed-time pill honest between progress events, and doubles
  // as a fallback re-assert if a mutation is ever missed.
  tickTimer = setInterval(() => { if (runs.size) render(); else stopTicking(); }, 1000);
}
function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

/** Re-render whenever bind/home.js repaints the section out from under us —
 *  the ONLY thing that ever removes `.orch-runs` (see the file header). */
function observeSection(sec) {
  if (observedSection === sec) return;
  if (sectionObserver) sectionObserver.disconnect();
  sectionObserver = new MutationObserver(() => render());
  sectionObserver.observe(sec, { childList: true });
  observedSection = sec;
}

function onEvent(ev) {
  if (!ev || typeof ev !== 'object' || !ev.runId) return;
  const prev = runs.get(ev.runId);
  const next = {
    startedAt: (prev && prev.startedAt) || Date.now(),
    agentId: ev.agentId || (prev && prev.agentId) || '',
    model: ev.model || (prev && prev.model) || '',
    phase: ev.phase || (prev && prev.phase) || '',
    percent: Number.isFinite(ev.orchestrationPercent) ? ev.orchestrationPercent : (prev && prev.percent) || 0,
    tokenUsage: ev.tokenUsage || (prev && prev.tokenUsage) || null,
    terminal: !!ev.terminal,
    outcome: ev.outcome || (prev && prev.outcome) || '',
  };
  runs.set(ev.runId, next);
  render();

  // Honesty: a terminal run is never shown as still active — it flashes its
  // outcome for a bit (rendered above, tone from `terminal`/`outcome`) and is
  // then dropped from the tracked set entirely, exactly as
  // bind/forge-progress.js flashes then clears its own single-run line.
  if (next.terminal) {
    setTimeout(() => {
      const cur = runs.get(ev.runId);
      if (cur && cur.terminal) { runs.delete(ev.runId); render(); }
    }, TERMINAL_HOLD_MS);
  }
}

export async function bind() {
  // One shared stream feeds every run-progress consumer — see run-progress-stream.js.
  subscribeRunProgress(onEvent);
}
