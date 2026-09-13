/*
 * bind/forge-progress.js — show what a Forge run is actually doing, and let the
 * owner stop it.
 *
 * The daemon publishes a real, owner-only event stream at /forge/run-progress:
 * five orchestration milestones (checking the provider, preparing the isolated
 * worktree, running the model, inspecting what changed, proposing the changes),
 * a percentage, and — for a local run — the real Ollama token counts. The
 * shipped window subscribed to none of it. A run that takes minutes showed one
 * static "Working" pill and nothing else, so the owner could not tell a model
 * that was thinking from one that had hung, and had no way to stop it.
 *
 * That is the same silence the whole product was fighting: the daemon knew, and
 * the window did not ask. This subscribes, shows the live phase / percent /
 * token count under the session title, and wires a Cancel button to the real
 * POST /forge/run/cancel — whose own error text already told the owner to
 * "Cancel it from the Zeno window", a window that until now had no such control.
 *
 * It is deliberately decoupled from bind/forge.js's session bookkeeping. It
 * shows "the run happening now", keyed by the runId the daemon reports, so it
 * cannot disagree with the session panel about which run is live, and a change
 * to how sessions are tracked cannot silently break the progress line.
 */

import { authHeaders } from '../bind.js';
import { subscribeRunProgress } from '../run-progress-stream.js';

/* The five orchestration milestones, in the owner's words. These name what ZENO
   is doing, never a guess at how far through its own thinking the model is —
   that distinction is the daemon's, and it is kept here. */
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

let host = null; // the element under the session title where progress lives
let current = null; // { runId } of the run currently shown, or null

function ensureHost() {
  const title = document.querySelector('.sesstitle');
  if (!title) return null;
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.className = 'forge-progress';
  host.hidden = true;
  title.insertAdjacentElement('afterend', host);
  return host;
}

function clear() {
  current = null;
  if (host) { host.hidden = true; host.replaceChildren(); }
}

function fmtTokens(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const inN = Number(usage.tokensIn || usage.promptTokens || 0);
  const outN = Number(usage.tokensOut || usage.completionTokens || 0);
  if (!inN && !outN) return '';
  return ` · ${inN.toLocaleString()} in / ${outN.toLocaleString()} out tokens`;
}

function render(ev) {
  const h = ensureHost();
  if (!h) return;

  if (ev.terminal) {
    // A terminal event flashes the outcome briefly, then clears — the session
    // panel owns the durable result (the run card, the approvals). Two places
    // showing the same finished run is how they drift.
    const word = PHASE_LABEL[ev.outcome] || PHASE_LABEL[ev.phase] || 'Done';
    const tone = ev.outcome === 'failed' ? 'rd' : ev.outcome === 'cancelled' ? 'wt' : 'gr';
    h.hidden = false;
    h.replaceChildren(pill(tone, word));
    const settledRun = ev.runId;
    setTimeout(() => { if (current === null || current.runId === settledRun) clear(); }, 2600);
    current = null;
    return;
  }

  current = { runId: ev.runId };
  h.hidden = false;

  const pct = Number.isFinite(ev.orchestrationPercent) ? ev.orchestrationPercent : 0;
  const label = PHASE_LABEL[ev.phase] || ev.phase;
  const tokens = fmtTokens(ev.tokenUsage);

  const bar = document.createElement('div');
  bar.className = 'forge-progress-bar';
  const fill = document.createElement('div');
  fill.className = 'forge-progress-fill';
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  const line = document.createElement('div');
  line.className = 'forge-progress-line';
  const text = document.createElement('span');
  text.className = 'forge-progress-text';
  text.textContent = `${label} · ${pct}%${tokens}`;

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn g sm';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => void doCancel(ev.runId, cancel));

  line.append(text, cancel);
  h.replaceChildren(line, bar);
}

function pill(tone, text) {
  const p = document.createElement('span');
  p.className = `pill ${tone}`;
  const d = document.createElement('span');
  d.className = 'd';
  p.append(d, document.createTextNode(text));
  return p;
}

async function doCancel(runId, btn) {
  btn.disabled = true;
  btn.textContent = 'Cancelling…';
  try {
    const res = await fetch('/forge/run/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      btn.disabled = false;
      btn.textContent = 'Cancel';
      const note = (body && body.error && body.error.message) || `cancel failed (${res.status})`;
      const text = host && host.querySelector('.forge-progress-text');
      if (text) text.textContent = note;
      return;
    }
    // The daemon confirms; the terminal 'cancelled' progress event that follows
    // clears the line. Any files the model wrote before the stop still become
    // held proposals — the session panel shows them.
    btn.textContent = 'Cancelled';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Cancel';
    const text = host && host.querySelector('.forge-progress-text');
    if (text) text.textContent = `could not reach the daemon: ${(err && err.message) || err}`;
  }
}

export async function bind() {
  // One shared stream feeds every run-progress consumer — see run-progress-stream.js.
  subscribeRunProgress(render);
}
