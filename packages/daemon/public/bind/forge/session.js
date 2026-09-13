/**
 * bind/forge/session.js — the session panel: chat turns, runs, proposed
 * actions, the plan/log view, Forge Lens, and history across sessions in
 * this browser window (there is no server-side session store).
 *
 * Registers `S.sendTask` (modelpicker.js's Compare "Run" button starts a
 * task the same way the composer does) and reads `S.paintModelPills`,
 * `S.agentsData` (for `localModelChoice`), `S.selectedSkillIds`,
 * `S.loadStatus`/`S.currentFile`/`S.openFile` (to refresh the editor/
 * explorer after a run may have changed files on disk).
 */
import { $, $$, el, fill } from '../../bind.js';
import {
  add, cloneReplace, disableCtl, postJSON,
} from './dom.js';

export function setupSession(S) {
  const ide = S.ide;
  let sessionSeq = 0;

  function makeSession() {
    sessionSeq += 1;
    return {
      id: `s${sessionSeq}`, title: null, chat: [], runs: [], lastProposed: [],
      agentId: 'local', model: '', effort: 'medium', autoRoute: true, memoryEnabled: true,
      running: false, pendingHosted: null, compareRunMode: 'parallel',
    };
  }
  S.draftSession = makeSession(); // model/effort state before any session exists

  const sEmpty = $('#s-empty'), sHist = $('#s-history'), sTabs = $('#s-tabs'), sBody = $('#s-body');
  const sTitle = $('#s-title'), sStatus = $('#s-status'), sTurns = $('#s-turns'), sPlanDetails = $('#s-plan');
  if (sPlanDetails) sPlanDetails.hidden = true; // no structured plan from the daemon
  // The artifact ships four fabricated history rows (each wired by ui.js to
  // its own mock openSession()) — dropped immediately so none can ever be
  // clicked, rather than waiting for the first real History open.
  if (sHist) $$('.dvsess', sHist).forEach((n) => n.remove());

  function showEmptyState() {
    S.activeIdx = -1;
    if (sEmpty) sEmpty.hidden = false;
    if (sHist) sHist.hidden = true;
    if (sTabs) sTabs.hidden = true;
    $$('.sessview').forEach((v) => { v.hidden = true; });
    if (sBody) delete sBody.dataset.open;
    S.paintModelPills();
  }

  function showActiveSession(session) {
    if (sEmpty) sEmpty.hidden = true;
    if (sHist) sHist.hidden = true;
    if (sTabs) sTabs.hidden = false;
    if (sBody) sBody.dataset.open = '1';
    $$('.sessview').forEach((v) => { v.hidden = v.dataset.stab !== 'chat'; });
    $$('#s-tabs [data-stab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.stab === 'chat' ? 'true' : 'false'));
    const tip = $('#s-tip'); if (tip) tip.hidden = true;
    renderSessionHeader(session);
    renderChat(session);
    renderRuns(session);
    renderActions(session);
    renderPlan(session);
    renderLens(session);
    S.paintModelPills();
  }

  function renderSessionHeader(session) {
    if (sTitle) sTitle.textContent = session.title || 'New session';
    if (sStatus) {
      const tone = session.running ? 'cy' : session.pendingHosted ? 'am' : 'wt';
      sStatus.className = `pill ${tone}`;
      fill(sStatus, el('span', 'd'), document.createTextNode(session.running ? 'Working' : session.pendingHosted ? 'Waiting on you' : session.chat.length ? 'Idle' : 'New'));
    }
  }

  function turnNode(t, session) {
    const d = el('div', `turn ${t.who === 'you' ? 'you' : 'z'}`);
    const who = el('div', 'who', t.who === 'you' ? 'A' : 'Z');
    const bt = el('div', 'bt');
    if (t.who === 'you') {
      add(bt, el('p', null, t.text));
    } else if (t.who === 'system') {
      add(bt, el('p', null, t.text));
      if (t.confirm) {
        const row = el('div', 'dva-a');
        const b = el('button', 'btn p sm', 'Confirm & run');
        b.type = 'button';
        b.addEventListener('click', () => void confirmHosted(session));
        add(row, b);
        /* A local-first product should never make "send my code to a paid cloud
           provider" the only button. The first-run hero has no model selector
           (the design keeps it minimal), so a first task always auto-routes and
           the balanced-default router escalates to a hosted agent — the owner's
           only offered action was to confirm that egress. This second button
           runs the same task on this machine instead, with no bytes leaving and
           no bill. It appears only when a local model is actually installed. */
        if (localModelChoice() && session.pendingHosted) {
          const local = el('button', 'btn g sm', 'Run locally instead');
          local.type = 'button';
          local.title = `Run this on ${localModelChoice()} on this machine — nothing leaves your computer.`;
          local.addEventListener('click', () => void runLocallyInstead(session));
          add(row, local);
        }
        add(bt, row);
      }
    } else {
      add(bt, el('p', null, t.note || (t.files && t.files.length ? `Changed ${t.files.length} file(s).` : 'No files were changed.')));
      for (const path of (t.files || [])) {
        const tool = el('div', 'dvtool');
        add(tool, el('span', 'dvtool-t', path));
        add(bt, tool);
      }
      if (t.waiting) {
        const ap = el('div', 'dvapproval');
        const h = el('div', 'dva-h');
        add(h, el('span', 'tier', 'write'), el('b', null, `${t.waiting} change${t.waiting === 1 ? '' : 's'} need your approval`));
        const a = el('div', 'dva-a');
        const go = el('button', 'btn p sm', 'Review in Command');
        go.type = 'button';
        go.dataset.productGo = 'command';
        go.dataset.then = 'approvals';
        add(a, go);
        add(ap, h, a);
        add(bt, ap);
      }
      if (t.tokenUsage) add(bt, el('div', 'vsnote', t.tokenUsage));
    }
    add(d, who, bt);
    return d;
  }

  function renderChat(session) {
    if (!sTurns) return;
    if (!session.chat.length) { fill(sTurns, el('div', 'fnote', 'Describe the change. Zeno works in an isolated worktree, and every effect waits for your approval in Command.')); return; }
    fill(sTurns, ...session.chat.map((t) => turnNode(t, session)));
    sTurns.scrollTop = sTurns.scrollHeight;
  }

  function renderRuns(session) {
    const view = $('.sessview[data-stab="runs"]');
    if (!view) return;
    if (!session.runs.length) { fill(view, el('div', 'fnote', 'No runs yet in this session.')); return; }
    fill(view, ...session.runs.slice().reverse().map((r) => {
      const card = el('div', 'frun');
      const h = el('div', 'frh');
      // A Forge run NEVER applies anything. Every file it changes becomes an
      // approval capsule, and the kernel writes only after the owner clicks in
      // Command — so "applied" is the one outcome this card structurally
      // cannot report. It reported it anyway for every successful run, in
      // green, directly above its own line reading "1 waiting · 0 applied".
      // That is the exact claim the gate exists to make impossible.
      const mark = r.cancelled ? { tone: 'wt', word: 'cancelled' }
        : !r.ok ? { tone: 'rd', word: 'failed' }
          : r.waiting > 0 ? { tone: 'am', word: `${r.waiting} waiting on you` }
            : r.applied > 0 ? { tone: 'gr', word: 'applied' }
              : { tone: 'wt', word: 'no changes' };
      add(h, el('span', `pill ${mark.tone}`, mark.word), el('b', null, r.task.length > 60 ? `${r.task.slice(0, 57)}…` : r.task));
      const m = el('div', 'frm', `${r.agentId}${r.model ? ' · ' + r.model : ''} · ${r.effort || ''} · ${r.files} file(s) · ${r.waiting} waiting · ${r.applied} applied${r.note ? ' · ' + r.note : ''}`);
      add(card, h, m);
      return card;
    }));
  }

  function renderActions(session) {
    const view = $('.sessview[data-stab="actions"]');
    if (!view) return;
    const proposed = session.lastProposed || [];
    if (!proposed.length) { fill(view, el('div', 'fnote', 'No proposed changes from this session yet.')); return; }
    const nodes = proposed.map((p) => {
      const card = el('div', 'fact-c');
      const h = el('div', 'frh');
      add(h, el('span', 'tier', `${p.tier || '?'} · write`), el('b', null, p.path || '(unknown path)'));
      add(card, h, el('div', 'frm', p.auto ? 'already sealed — the kernel auto-committed this write' : 'waiting for your approval'));
      if (!p.auto) {
        const go = el('button', 'laction cy', 'Open in Command');
        go.dataset.productGo = 'command'; go.dataset.then = 'approvals';
        add(card, go);
      }
      return card;
    });
    nodes.push(el('div', 'fnote', 'Each changed file becomes one approval capsule. Forge never applies a write itself; Command approves it.'));
    fill(view, ...nodes);
  }

  function renderPlan(session) {
    const view = $('.sessview[data-stab="plan"]');
    if (!view) return;
    const last = session.chat.slice().reverse().find((t) => t.who === 'agent');
    const nodes = [el('div', 'fnote', 'This daemon does not return a structured step plan — here is the agent’s own run log, unedited.')];
    if (last && last.log) nodes.push(el('pre', 'fterm', last.log));
    else nodes.push(el('div', 'vsnote', 'No run log yet.'));
    fill(view, ...nodes);
  }

  function renderLens(session) {
    const view = $('.sessview[data-stab="lens"]');
    if (!view) return;
    fill(view, el('div', 'fnote', 'Forge Lens’s exact assembled prompt preview is not read by this build. What actually goes to the agent is the task text you typed, plus Vault memory when it is on, plus any skills you select.'));
  }

  // Session panel header's "···" (More) — confirmed live: it opens nothing
  // and nothing anywhere has a listener on it. There is no additional
  // session action in this build to put behind it.
  const sMoreBtn = $('.sessh button[title="More"]', ide);
  disableCtl(sMoreBtn, 'No additional session actions in this build.');

  // ---- History (real, in-window sessions only — no server-side session store) ----
  const histBtn = cloneReplace($('#s-hist'));
  function renderHistory() {
    if (!sHist) return;
    const header = sHist.querySelector('.vsvh');
    $$('.dvsess', sHist).forEach((n) => n.remove());
    const oldNote = sHist.querySelector('[data-forge-hist-empty]');
    if (oldNote) oldNote.remove();
    if (!S.sessions.length) {
      const note = el('div', 'fnote', 'No sessions yet in this window.');
      note.dataset.forgeHistEmpty = '1';
      if (header) header.insertAdjacentElement('afterend', note); else sHist.appendChild(note);
      return;
    }
    S.sessions.forEach((s, i) => {
      const b = el('button', 'dvsess');
      b.dataset.sopen = String(i);
      b.classList.toggle('on', i === S.activeIdx);
      const dotClass = s.running ? 'working' : s.pendingHosted ? 'awaiting' : (s.runs.length && s.runs[s.runs.length - 1].ok === false) ? 'failed' : s.runs.length ? 'done' : 'working';
      const dvst = el('span', 'dvst');
      add(dvst, el('b', null, s.title || 'New session'), el('span', null, s.running ? 'Working' : s.pendingHosted ? 'Awaiting your approval' : s.runs.length ? `${s.runs.length} run(s)` : 'No runs yet'));
      add(b, el('span', `dvdot ${dotClass}`), dvst);
      b.addEventListener('click', () => { S.activeIdx = i; showActiveSession(S.sessions[i]); if (sHist) sHist.hidden = true; });
      sHist.appendChild(b);
    });
  }
  if (histBtn) histBtn.addEventListener('click', () => {
    if (!sHist) return;
    const willOpen = sHist.hidden;
    if (willOpen) { renderHistory(); sHist.hidden = false; if (sTabs) sTabs.hidden = true; $$('.sessview').forEach((v) => { v.hidden = true; }); if (sEmpty) sEmpty.hidden = true; }
    else { sHist.hidden = true; if (S.activeIdx >= 0) showActiveSession(S.sessions[S.activeIdx]); else showEmptyState(); }
  });

  const newBtn = cloneReplace($('#s-new'));
  function startNewSession() {
    const s = makeSession();
    s.agentId = S.draftSession.agentId; s.model = S.draftSession.model; s.effort = S.draftSession.effort; s.autoRoute = S.draftSession.autoRoute;
    S.sessions.push(s);
    S.activeIdx = S.sessions.length - 1;
    showActiveSession(s);
    const ta = $('#s-ta'); if (ta) ta.focus();
    return s;
  }
  if (newBtn) newBtn.addEventListener('click', () => startNewSession());

  // ---- composer takeover (drop ui.js's mock send/keydown handlers) ----
  const sSend = cloneReplace($('#s-send'));
  const sTa = cloneReplace($('#s-ta'));
  const agSend = cloneReplace($('#ag-send'));
  const agTa = cloneReplace($('#ag-ta'));

  if (sTa) {
    sTa.disabled = !S.OWNER;
    sTa.addEventListener('input', () => { sTa.style.height = 'auto'; sTa.style.height = `${Math.min(sTa.scrollHeight, 160)}px`; });
    sTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromComposer(); } });
  }
  function submitFromComposer() {
    if (!sTa) return;
    const text = sTa.value.trim();
    if (!text) return;
    sTa.value = ''; sTa.style.height = 'auto';
    const session = S.activeIdx >= 0 ? S.sessions[S.activeIdx] : startNewSession();
    void sendTask(session, text);
  }
  if (sSend) sSend.addEventListener('click', () => submitFromComposer());

  if (agTa) {
    agTa.disabled = !S.OWNER;
    agTa.addEventListener('input', () => { agTa.style.height = 'auto'; agTa.style.height = `${Math.min(agTa.scrollHeight, 200)}px`; });
    agTa.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromHero(); } });
  }
  function submitFromHero() {
    if (!agTa) return;
    const text = agTa.value.trim();
    agTa.value = ''; agTa.style.height = 'auto';
    const session = startNewSession();
    if (text) void sendTask(session, text);
  }
  if (agSend) agSend.addEventListener('click', () => submitFromHero());

  async function sendTask(session, task) {
    task = String(task || '').trim();
    if (!task || session.running) return;
    if (!S.OWNER) {
      session.chat.push({ who: 'system', text: 'This window has no owner token, so Forge is read-only here — open Zeno from its launcher to run agents.' });
      renderChat(session);
      return;
    }
    if (!session.title) session.title = task.length > 48 ? `${task.slice(0, 45)}…` : task;
    session.running = true;
    session.chat.push({ who: 'you', text: task });
    renderSessionHeader(session);
    renderChat(session);
    renderHistoryIfOpen();

    let route;
    if (session.autoRoute) {
      const r = await postJSON('/forge/route', { task });
      if (!r.ok || !r.data || !r.data.route) {
        session.running = false;
        session.chat.push({ who: 'system', text: `Routing failed: ${r.error || 'the daemon did not answer.'}` });
        renderSessionHeader(session); renderChat(session);
        return;
      }
      route = r.data.route;
      if (route.runnable === false) {
        session.running = false;
        session.chat.push({ who: 'system', text: route.rationale || 'No provider is available on this machine for this task.' });
        renderSessionHeader(session); renderChat(session);
        return;
      }
    } else {
      route = { agentId: session.agentId, model: session.model, effort: session.effort, rationale: 'Manual routing — you selected the model.' };
    }

    if (route.agentId !== 'local') {
      session.running = false;
      session.pendingHosted = { task, route };
      session.chat.push({ who: 'system', text: `This sends your task to ${route.agentId === 'codex' ? 'OpenAI (Codex)' : 'Anthropic (Claude Code)'} — nothing runs until you confirm.`, confirm: true });
      renderSessionHeader(session); renderChat(session); renderHistoryIfOpen();
      return;
    }
    await runResolved(session, task, route, false);
  }
  S.sendTask = sendTask;

  async function confirmHosted(session) {
    const pending = session.pendingHosted;
    if (!pending) return;
    session.pendingHosted = null;
    session.running = true;
    renderSessionHeader(session);
    await runResolved(session, pending.task, pending.route, true);
  }

  /** The local model the "Run locally instead" button would use, or '' if none. */
  function localModelChoice() {
    const locals = (S.agentsData && Array.isArray(S.agentsData.localModels)) ? S.agentsData.localModels : [];
    if (!locals.length) return '';
    // Prefer an 8b/14b: qwen3:4b tends to exhaust its budget before proposing.
    return locals.find((m) => /8b|14b/.test(m)) || locals[0];
  }

  /** Redirect a held hosted proposal to a real local run — no egress, no bill. */
  async function runLocallyInstead(session) {
    const pending = session.pendingHosted;
    if (!pending) return;
    const model = localModelChoice();
    if (!model) return;
    session.pendingHosted = null;
    session.running = true;
    session.chat.push({ who: 'system', text: `Running on ${model} on this machine instead — nothing leaves your computer.` });
    renderSessionHeader(session); renderChat(session);
    await runResolved(session, pending.task, { agentId: 'local', model, effort: pending.route.effort, rationale: 'You chose to run this on-device.' }, false);
  }

  async function runResolved(session, task, route, hostedConfirmed) {
    const runId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const body = { task, memoryEnabled: session.memoryEnabled !== false, skillIds: [...S.selectedSkillIds], agentId: route.agentId, runId };
    if (route.model) body.model = route.model;
    if (route.effort) body.effort = route.effort;
    if (hostedConfirmed) body.hostedConfirmed = true;
    const r = await postJSON('/forge/run', body);
    session.running = false;
    if (!r.ok) {
      if (r.status === 428 && r.data && r.data.confirmation) {
        session.pendingHosted = { task, route };
        session.chat.push({ who: 'system', text: (r.data.error && r.data.error.message) || 'Confirm this run before it starts.', confirm: true });
      } else {
        session.chat.push({ who: 'system', text: `The run did not start: ${r.error || (r.data && r.data.error && r.data.error.message) || 'unknown error'}` });
      }
      renderSessionHeader(session); renderChat(session); renderHistoryIfOpen();
      return;
    }
    const d = r.data || {};
    const run = d.run || {};
    const proposed = Array.isArray(d.proposed) ? d.proposed : [];
    const changed = Array.isArray(d.changed) ? d.changed : [];
    const applied = proposed.filter((p) => p && p.auto).length;
    const waiting = proposed.length - applied;
    session.lastProposed = proposed;
    session.chat.push({
      who: 'agent', agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed, waiting, applied, log: typeof run.log === 'string' ? run.log : '',
      note: run.ok === false ? (run.note || 'The agent did not complete this task.') : (run.note || ''),
    });
    session.runs.push({
      task, ok: run.ok === true, cancelled: run.cancelled === true,
      agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed.length, waiting, applied, note: run.ok === false ? (run.note || '') : '',
    });
    renderSessionHeader(session); renderChat(session); renderRuns(session); renderActions(session); renderPlan(session); renderHistoryIfOpen();
    void S.loadStatus();
    if (S.currentFile) void S.openFile(S.currentFile);
  }

  function renderHistoryIfOpen() { if (sHist && !sHist.hidden) renderHistory(); }

  return { showEmptyState };
}
