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
  add, cloneReplace, disableCtl, postJSON, runMark,
} from './dom.js';
import { setupPlanFirst } from './plan.js';
import { setupSessionViews } from './session-views.js';
import { setupAgentMode } from './agent-mode.js';
import { setupComposerCommands } from './composer-commands.js';

export function setupSession(S) {
  const ide = S.ide;
  let sessionSeq = 0;
  // The secondary tabs and the plan-first intake card live in their own
  // modules (line budget); both register on S and call back into the render
  // functions this file registers further down.
  setupSessionViews(S);
  setupPlanFirst(S);
  setupAgentMode(S);

  /* ---- Agent / Editor view switch (top-left of the title bar) -----------
     A Codex-style segmented control (index.html's #forge-viewseg, reusing
     the product switcher's own .seg/.pill look at title-bar scale). "Agent"
     gives THIS panel the whole workbench — chat-first, matching the empty
     state's own hero below. "Editor" is exactly the classic layout this
     artifact already ships (explorer + Monaco + terminal primary, this
     panel a fixed strip) — index.html's .ide.mode-agent rule is the only
     CSS either mode needs, so switching is just toggling that one class.

     Two different "defaults" are both true at once, deliberately: the
     screen an owner opens Forge to (before any session exists) is the
     classic workbench — untouched — but the first session ever started on
     this device goes chat-first (see startNewSession() below), UNLESS the
     owner already told this device otherwise, which is remembered
     (localStorage) and always wins over either default. */
  const VIEW_KEY = 'zeno-forge-view';
  const viewSegBtns = $$('#forge-viewseg [data-forge-view]');
  let viewChosen = false; // an explicit choice — this boot's restore, or a click — has been applied
  function applyForgeView(mode) {
    if (ide) ide.classList.toggle('mode-agent', mode === 'agent');
    for (const b of viewSegBtns) {
      if (b.dataset.forgeView === mode) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }
  function setForgeView(mode) {
    mode = mode === 'agent' ? 'agent' : 'editor';
    viewChosen = true;
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* private window or storage disabled — just don't persist */ }
    applyForgeView(mode);
  }
  S.setForgeView = setForgeView; // proposalCard()/turnNode() switch to Editor before opening a file
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'agent' || v === 'editor') { viewChosen = true; applyForgeView(v); }
  } catch { /* no persisted choice — the classic layout stands until a session starts */ }
  for (const b of viewSegBtns) b.addEventListener('click', () => setForgeView(b.dataset.forgeView));

  function makeSession() {
    sessionSeq += 1;
    return {
      id: `s${sessionSeq}`, title: null, chat: [], runs: [], lastProposed: [],
      agentId: 'local', model: '', effort: 'medium', autoRoute: true, memoryEnabled: true,
      running: false, planning: false, pendingHosted: null, compareRunMode: 'parallel',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
  }
  S.draftSession = makeSession(); // model/effort state before any session exists
  // Past sessions from this browser's own history (agent-mode.js) — real
  // transcripts and run records, restored idle. Nothing in flight resumes.
  S.restoreSessions(makeSession);
  S.renderSessionsList(); // the rail was painted empty before the restore

  const sEmpty = $('#s-empty'), sHist = $('#s-history'), sTabs = $('#s-tabs'), sBody = $('#s-body');
  const sTitle = $('#s-title'), sStatus = $('#s-status'), sTurns = $('#s-turns');
  // The artifact's "Zeno's plan" details under the title ships with four
  // mock steps; plan.js's renderPlanSummary() owns it now and hides it until
  // a session really has a plan.
  S.renderPlanSummary(null);
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
    S.renderRuns(session);
    S.renderActions(session);
    S.renderPlan(session);
    S.renderLens(session);
    S.renderPlanSummary(session);
    S.paintModelPills();
    S.renderSessionsList();
  }
  S.openSession = (i) => { if (!S.sessions[i]) return; S.activeIdx = i; showActiveSession(S.sessions[i]); if (sHist) sHist.hidden = true; };

  function renderSessionHeader(session) {
    S.sessionsChanged(null); // every state change comes through here: persist + repaint the rail
    if (sTitle) sTitle.textContent = session.title || 'New session';
    if (sStatus) {
      const tone = session.running || session.planning ? 'cy' : session.pendingHosted ? 'am' : 'wt';
      sStatus.className = `pill ${tone}`;
      const word = session.running ? 'Working' : session.planning ? 'Planning' : session.pendingHosted ? 'Waiting on you' : session.chat.length ? 'Idle' : 'New';
      fill(sStatus, el('span', 'd'), document.createTextNode(word));
    }
  }
  S.renderSessionHeader = renderSessionHeader;

  function turnNode(t, session) {
    const d = el('div', `turn ${t.who === 'you' ? 'you' : 'z'}`);
    const who = el('div', 'who', t.who === 'you' ? 'A' : 'Z');
    if (t.who === 'plan') { add(d, who, S.planTurnNode(t, session)); return d; }
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
      // Clear hierarchy for a run's own turn, so it reads as a transcript
      // rather than a wall of text: a status pill (the same word/colour the
      // Runs tab uses — runMark()), the agent's own note, then every file it
      // actually touched — each a real "open it" control, not a static
      // label — and finally the real proposal capsule(s) this run produced
      // (never a generic "N waiting" count standing in for them).
      const mark = runMark(t);
      const head = el('div', 'frh');
      add(head, el('span', `pill ${mark.tone}`, mark.word));
      const who2 = [t.agentId, t.model, t.effort].filter(Boolean).join(' · ');
      if (who2) add(head, el('span', 'frm', who2));
      add(bt, head);
      add(bt, el('p', null, t.note || (t.files && t.files.length ? `Changed ${t.files.length} file(s).` : 'No files were changed.')));
      for (const path of (t.files || [])) {
        const tool = el('div', 'dvtool');
        // A real control, not decoration: opens the file in the editor
        // (switching out of Agent view to show it). tabIndex/role/keydown
        // make it as keyboard-reachable as a native button, since .dvtool
        // is a styled <div> everywhere else this class is used too.
        tool.tabIndex = 0;
        tool.setAttribute('role', 'button');
        tool.title = `Open ${path} in the editor`;
        add(tool, el('span', 'dvtool-t', path));
        const openThis = () => { S.setForgeView('editor'); void S.openFile(path); };
        tool.addEventListener('click', openThis);
        tool.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThis(); } });
        add(bt, tool);
      }
      for (const p of (t.proposed || [])) add(bt, S.proposalCard(p));
      if (t.planSteps) add(bt, el('div', 'frm', `ran with your approved plan (${t.planSteps} steps)`));
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
  S.renderChat = renderChat;

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
    // First session on this device with no explicit view choice yet: go
    // chat-first (see the view-switch setup above for why this is not
    // simply the page's own boot default).
    if (!viewChosen) applyForgeView('agent');
    showActiveSession(s);
    const ta = $('#s-ta'); if (ta) ta.focus();
    return s;
  }
  S.startNewSession = startNewSession; // agent-mode.js's "New session" controls
  if (newBtn) newBtn.addEventListener('click', () => startNewSession());

  // ---- composer takeover (drop ui.js's mock send/keydown handlers) ----
  const sSend = cloneReplace($('#s-send'));
  const sTa = cloneReplace($('#s-ta'));
  const agSend = cloneReplace($('#ag-send'));
  const agTa = cloneReplace($('#ag-ta'));

  // The "/" command menu for both composers — split out to composer-commands.js
  // for the per-file line budget. Each `handleKeydown` must run before this
  // file's own Enter-to-send, so the menu gets first refusal on every key.
  const { sCmd, agCmd } = setupComposerCommands(S, { sTa, agTa, startNewSession });

  if (sTa) {
    sTa.disabled = !S.OWNER;
    sTa.addEventListener('input', () => { sTa.style.height = 'auto'; sTa.style.height = `${Math.min(sTa.scrollHeight, 160)}px`; });
    sTa.addEventListener('keydown', (e) => {
      if (sCmd && sCmd.handleKeydown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromComposer(); }
    });
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
    agTa.addEventListener('keydown', (e) => {
      if (agCmd && agCmd.handleKeydown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFromHero(); }
    });
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
    if (!task || session.running || session.planning) return;
    if (!S.OWNER) {
      session.chat.push({ who: 'system', text: 'This window has no owner token, so Forge is read-only here — open Zeno from its launcher to run agents.' });
      renderChat(session);
      return;
    }
    if (!session.title) session.title = task.length > 48 ? `${task.slice(0, 45)}…` : task;
    session.updatedAt = Date.now();
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

    /* Plan first: the route is decided, but nothing runs yet. The daemon's
       read-only plan pass comes back as a card, and the ONLY way from there to
       a run is its Approve button, which calls proceedWithRoute() below —
       exactly what this line would have done with the toggle off. */
    if (S.planFirstEnabled()) {
      session.running = false;
      await S.requestPlan(session, task, route);
      return;
    }
    await proceedWithRoute(session, task, route, null);
  }
  S.sendTask = sendTask;

  /** Start (or, for a hosted route, ask to confirm) a routed task. `plan` is
   *  the owner-approved plan card, or null for a straight run. A hosted route
   *  still stops here for its own confirmation — planning never skips it. */
  async function proceedWithRoute(session, task, route, plan) {
    if (route.agentId !== 'local') {
      session.running = false;
      session.pendingHosted = { task, route, plan };
      session.chat.push({ who: 'system', text: `This sends your task to ${route.agentId === 'codex' ? 'OpenAI (Codex)' : 'Anthropic (Claude Code)'} — nothing runs until you confirm.`, confirm: true });
      renderSessionHeader(session); renderChat(session); renderHistoryIfOpen();
      return;
    }
    session.running = true;
    renderSessionHeader(session);
    await runResolved(session, task, route, false, plan);
  }
  S.proceedWithRoute = proceedWithRoute;

  async function confirmHosted(session) {
    const pending = session.pendingHosted;
    if (!pending) return;
    session.pendingHosted = null;
    session.running = true;
    renderSessionHeader(session);
    await runResolved(session, pending.task, pending.route, true, pending.plan || null);
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
    await runResolved(session, pending.task, { agentId: 'local', model, effort: pending.route.effort, rationale: 'You chose to run this on-device.' }, false, pending.plan || null);
  }

  async function runResolved(session, task, route, hostedConfirmed, plan = null) {
    const runId = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const body = { task, memoryEnabled: session.memoryEnabled !== false, skillIds: [...S.selectedSkillIds], agentId: route.agentId, runId };
    if (route.model) body.model = route.model;
    if (route.effort) body.effort = route.effort;
    if (hostedConfirmed) body.hostedConfirmed = true;
    // The approved plan (as the owner left it, edits included) rides along;
    // the daemon appends it UNDER the task as owner-approved context.
    if (plan && plan.plan) { body.plan = plan.plan; if (plan.planId) body.planId = plan.planId; }
    const r = await postJSON('/forge/run', body);
    session.running = false;
    session.updatedAt = Date.now();
    if (!r.ok) {
      if (r.status === 428 && r.data && r.data.confirmation) {
        session.pendingHosted = { task, route, plan };
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
    // "planned" is the DAEMON's word: only a run whose response carries the
    // plan it was actually given is reported as one.
    const planSteps = d.plan && Number.isFinite(d.plan.steps) ? d.plan.steps : 0;
    session.lastProposed = proposed;
    session.chat.push({
      who: 'agent', agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed, waiting, applied, proposed, log: typeof run.log === 'string' ? run.log : '', planSteps,
      ok: run.ok === true, cancelled: run.cancelled === true, // turnNode's runMark() needs the same shape session.runs already carries
      note: run.ok === false ? (run.note || 'The agent did not complete this task.') : (run.note || ''),
    });
    session.runs.push({
      task, ok: run.ok === true, cancelled: run.cancelled === true,
      agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      files: changed.length, waiting, applied, planSteps, note: run.ok === false ? (run.note || '') : '',
    });
    renderSessionHeader(session); renderChat(session); S.renderRuns(session); S.renderActions(session); S.renderPlan(session); renderHistoryIfOpen();
    void S.loadStatus();
    if (S.currentFile) void S.openFile(S.currentFile);
  }

  function renderHistoryIfOpen() { if (sHist && !sHist.hidden) renderHistory(); }

  /* Command -> Forge: "describe a task in Command and it opens a NEW
     agent/chat in Forge and it works". bind/ask.js's "Run in Forge now"
     button (on a `delegated` offer) dispatches this event and switches to the
     Forge product; this is the other half — start a fresh session and send
     the task through the SAME sendTask() the composer itself calls. Nothing
     about governance changes: sendTask() still routes local vs hosted, and a
     hosted route still stops and renders its own confirm turn — this never
     passes hostedConfirmed. Guarded on `window` (not just this closure)
     because setupSession() could in principle run more than once per page
     (see state.js's own comment on that); in practice it runs exactly once,
     but the guard costs nothing and keeps a future re-bind from stacking a
     second listener that would start two sessions per click. */
  if (!window.__zenoCommandRunWired) {
    window.__zenoCommandRunWired = true;
    window.addEventListener('zeno:command-run', (e) => {
      const task = e && e.detail && typeof e.detail.task === 'string' ? e.detail.task.trim() : '';
      if (!task) return;
      /* Switch to Forge here, not only in the ask.js button that usually fires
         this — the event must be self-contained so ANY caller (a future voice
         command, the orb, an e2e driver) that dispatches it lands the owner on
         the new agent, not on whatever surface they were on. Clicking the real
         product switch is a no-op if Forge is already showing. */
      const forgeBtn = document.querySelector('.seg [data-product="forge"]');
      if (forgeBtn) forgeBtn.click();
      const session = startNewSession();
      void sendTask(session, task);
    });
  }

  return { showEmptyState };
}
