/**
 * bind/forge/session-views.js — the session panel's secondary tabs (Runs,
 * Actions, Plan, Lens) and the proposal capsule they and the transcript share.
 *
 * Split out of session.js purely for the per-file line budget when plan-first
 * intake arrived; session.js still owns the session objects and calls these
 * with one. Registers `S.proposalCard`, `S.renderRuns`, `S.renderActions`,
 * `S.renderPlan`, `S.renderLens`; reads `S.setForgeView`, `S.openFile`,
 * `S.latestPlanTurn` (plan.js).
 */
import { $, $$, el, fill } from '../../bind.js';
import { add, postJSON, runMark } from './dom.js';
import { withContextSelection } from './state.js';

export function setupSessionViews(S) {
  /** One proposal capsule — used both inline in the Session transcript
   *  (this run's own results) and in the Actions tab (every proposal from
   *  the last run). Forge holds no diff client-side, so this never invents
   *  one: an auto (already-sealed) proposal links to the real file the
   *  kernel wrote, in the real editor; a held one only ever links to
   *  Command, where the real diff lives. */
  function proposalCard(p) {
    const card = el('div', 'fact-c');
    const h = el('div', 'frh');
    add(h, el('span', 'tier', `${p.tier || '?'} · write`), el('b', null, p.path || '(unknown path)'));
    add(card, h, el('div', 'frm', p.auto ? 'already sealed — the kernel auto-committed this write' : 'waiting for your approval'));
    const actions = el('div', 'dva-a');
    if (!p.auto) {
      const go = el('button', 'laction cy', 'Open in Command');
      go.dataset.productGo = 'command';
      go.dataset.then = 'approvals';
      add(actions, go);
    }
    if (p.path) {
      const openEd = el('button', 'laction', 'Open in editor');
      openEd.type = 'button';
      openEd.title = p.auto
        ? 'Opens the file the kernel just wrote, in the real editor.'
        : 'Opens the file’s current, unapproved content — the proposed diff itself is only in Command → Approvals until you approve it.';
      openEd.addEventListener('click', () => { S.setForgeView('editor'); void S.openFile(p.path); });
      add(actions, openEd);
    }
    if (actions.childNodes.length) add(card, actions);
    return card;
  }
  S.proposalCard = proposalCard;

  S.renderRuns = function renderRuns(session) {
    const view = $('.sessview[data-stab="runs"]');
    if (!view) return;
    if (!session.runs.length) { fill(view, el('div', 'fnote', 'No runs yet in this session.')); return; }
    fill(view, ...session.runs.slice().reverse().map((r) => {
      const card = el('div', 'frun');
      const h = el('div', 'frh');
      // Same status word/colour as the matching agent turn in the Session
      // tab (see dom.js's runMark() for why "applied" is gated the way it is).
      const mark = runMark(r);
      add(h, el('span', `pill ${mark.tone}`, mark.word), el('b', null, r.task.length > 60 ? `${r.task.slice(0, 57)}…` : r.task));
      // "planned" only when the daemon's run response said the run carried a plan.
      const planned = r.planSteps ? ` · planned (${r.planSteps} steps)` : '';
      const m = el('div', 'frm', `${r.agentId}${r.model ? ' · ' + r.model : ''} · ${r.effort || ''} · ${r.files} file(s) · ${r.waiting} waiting · ${r.applied} applied${planned}${r.note ? ' · ' + r.note : ''}`);
      add(card, h, m);
      // Token usage is measured only for local (Ollama) runs; /forge/run reports
      // null for hosted CLIs. Show exactly what the run returned — never a guess,
      // and nothing at all when neither count came back.
      const inN = Number.isFinite(r.tokensIn) ? r.tokensIn : null;
      const outN = Number.isFinite(r.tokensOut) ? r.tokensOut : null;
      if (inN !== null || outN !== null) {
        const parts = [];
        if (inN !== null) parts.push(`${inN.toLocaleString()} in`);
        if (outN !== null) parts.push(`${outN.toLocaleString()} out`);
        add(card, el('div', 'frm', `${parts.join(' / ')} tokens · measured by the local model`));
      }
      return card;
    }));
  };

  /** The Actions tab's own badge: THIS session's proposed changes, never the
   *  global held queue — bind.js used to paint it from /state's whole pending
   *  count, so a session with nothing proposed yet still wore a stale "1"
   *  left over from a completely different run. 0 proposals means no badge. */
  function paintActionsBadge(session) {
    const badge = $('#s-tabs [data-stab="actions"] .fct');
    if (!badge) return;
    const n = (session && Array.isArray(session.lastProposed)) ? session.lastProposed.length : 0;
    badge.textContent = n > 0 ? String(n) : '';
    badge.hidden = n === 0;
  }

  S.renderActions = function renderActions(session) {
    paintActionsBadge(session);
    const view = $('.sessview[data-stab="actions"]');
    if (!view) return;
    const proposed = session.lastProposed || [];
    if (!proposed.length) { fill(view, el('div', 'fnote', 'No proposed changes from this session yet.')); return; }
    const nodes = proposed.map((p) => proposalCard(p));
    nodes.push(el('div', 'fnote', 'Each changed file becomes one governed capsule. Routine T0 edits are already sealed; risky edits wait for you in Command.'));
    fill(view, ...nodes);
  };

  S.renderPlan = function renderPlan(session) {
    const view = $('.sessview[data-stab="plan"]');
    if (!view) return;
    const nodes = [];
    // A structured plan exists only when plan-first intake produced one; it
    // is the daemon's own steps, in the state the owner left them.
    const pt = S.latestPlanTurn ? S.latestPlanTurn(session) : null;
    if (pt) {
      const ol = el('ol', 'dvsteps');
      pt.plan.steps.forEach((s, i) => { const li = el('li'); add(li, el('b', null, String(i + 1)), el('span', null, s)); add(ol, li); });
      nodes.push(el('div', 'fnote', `Plan from the read-only intake pass on ${pt.model || 'the local model'} — ${pt.state}.`), ol);
    } else {
      nodes.push(el('div', 'fnote', 'No structured plan for this session (Plan first was off, or nothing has been sent yet). Below is the agent’s own run log, unedited.'));
    }
    const last = session.chat.slice().reverse().find((t) => t.who === 'agent');
    if (last && last.log) nodes.push(el('pre', 'fterm', last.log));
    else nodes.push(el('div', 'vsnote', 'No run log yet.'));
    fill(view, ...nodes);
  };

  let lensRequest = 0;
  S.renderLens = async function renderLens(session) {
    const view = $('.sessview[data-stab="lens"]');
    if (!view) return;
    const lastTask = [...session.chat].reverse().find((turn) => turn.who === 'you' && typeof turn.text === 'string');
    const draft = S.sessions[S.activeIdx] === session ? ($('#s-ta')?.value || '') : '';
    const ownerTask = (draft || lastTask?.text || session.runs[session.runs.length - 1]?.task || '').trim();
    const task = S.contextTaskForSession ? S.contextTaskForSession(session, ownerTask) : ownerTask;
    if (!task) {
      fill(view, el('div', 'fnote', 'Send a task in this session to preview the exact context Forge will give the selected agent.'));
      return;
    }
    const request = ++lensRequest;
    fill(view, el('div', 'fnote', 'Assembling the exact prompt from this task, repository rules, selected skills and Vault memory…'));
    const body = withContextSelection(S, { task, memoryEnabled: session.memoryEnabled !== false });
    const response = await postJSON('/forge/context', body);
    if (request !== lensRequest) return;
    if (!response.ok || !response.data || !response.data.context) {
      const reason = response.error || 'the daemon did not return a context preview';
      const retry = el('button', 'btn sm', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => { void S.renderLens(session); });
      fill(view, el('div', 'fnote', `Forge Lens could not assemble this prompt: ${reason}`), retry);
      return;
    }
    const context = response.data.context;
    const facts = el('div', 'frm', `${context.characters} characters · ${context.rules.length} rule${context.rules.length === 1 ? '' : 's'} · ${context.skillIds.length} skill${context.skillIds.length === 1 ? '' : 's'} · ${context.memory.note}`);
    const hash = el('div', 'vsnote', `SHA-256 ${context.hash}${context.truncated ? ` · ${context.omittedCharacters} characters omitted at the context limit` : ''}`);
    const prompt = el('pre', 'fterm');
    prompt.dataset.lensPrompt = '1';
    prompt.textContent = context.prompt;
    fill(view, el('div', 'fnote', 'Exact prompt assembled by the same daemon path used for this Forge run.'), facts, hash, prompt);
  };
  // ui.js owns generic tab visibility. Lens adds only the data refresh: when
  // the owner opens it, preview the active session (including an unsent draft)
  // through the real daemon route instead of leaving an old prompt on screen.
  for (const tab of $$('#s-tabs [data-stab="lens"]')) {
    tab.addEventListener('click', () => {
      const session = S.sessions[S.activeIdx];
      if (session) void S.renderLens(session);
    });
  }
}
