/**
 * bind/forge/plan.js — plan-first intake: the "Plan first" toggle on both
 * composers, the request to the daemon's read-only POST /forge/plan, and the
 * plan card the owner approves, edits, or discards before anything runs.
 *
 * The card is a real gate, not decoration. Approve is the ONLY path from a
 * plan to a run, and it goes through session.js's own `S.proceedWithRoute` —
 * the same code the composer uses with the toggle off — so a hosted route
 * still stops at its own confirmation, and every file the run then touches
 * still goes through the kernel (routine T0 edits seal automatically; risky
 * edits wait in Command). Discard runs nothing. The card
 * also says, in the daemon's own words, that the plan was produced without a
 * worktree or a write, because that claim is the daemon's to make, not this
 * file's.
 *
 * Registers `S.planFirstEnabled`, `S.requestPlan`, `S.planTurnNode`,
 * `S.renderPlanSummary`; reads `S.renderChat`, `S.renderSessionHeader`,
 * `S.proceedWithRoute` (session.js) and `S.selectedSkillIds`.
 */
import { $, $$, el, fill } from '../../bind.js';
import { add, postJSON } from './dom.js';
import { withContextSelection } from './state.js';

const KEY = 'zeno-plan-first';

/* A greeting/thanks/ack/help message is not a coding task. Sending "hi" here
 * used to be handed straight to POST /forge/plan, which dutifully produced a
 * plan for it — a real, absurd multi-step "Respond to the greeting 'hi'"
 * card. Mirrors the detection packages/assistant/src/conversational.ts uses
 * for Command's own chat (same four categories, same whole-message match, so
 * "hi, can you check the dsa folder" still plans — only the bare word does not). */
const GREETING = /^(?:hey|hi|hello|hiya|yo|sup|howdy|good\s+(?:morning|afternoon|evening|night))(?:\s+zeno)?[\s!.,?]*$/i;
const THANKS = /^(?:thanks|thank\s+you|thx|ty|cheers|appreciated)(?:\s+zeno)?[\s!.,?]*$/i;
const ACK = /^(?:ok|okay|got\s+it|nice|great|cool|perfect|sure)[\s!.,?]*$/i;
const HELP = /^(?:help|what\s+can\s+you\s+do|what\s+do\s+you\s+do|who\s+are\s+you|what\s+are\s+you|how\s+do\s+you\s+work|what\s+can\s+i\s+ask(?:\s+you)?)[\s!.,?]*$/i;

/** A conversational reply for a trivial message, or null when it is a real task to plan. */
function conversationalReply(task) {
  const q = String(task || '').trim();
  if (GREETING.test(q)) return 'Hi. Describe a change you want in this repository and, with Plan first on, I’ll read it before proposing anything.';
  if (THANKS.test(q)) return 'You’re welcome — describe a task whenever you’re ready.';
  if (ACK.test(q)) return 'Okay — describe the change and I’ll read the repository before proposing anything.';
  if (HELP.test(q)) {
    return 'Describe a coding task — e.g. "add a test for the parser" — and, with Plan first on, I’ll read the repository '
      + '(without touching it), show you a plan, and wait for your approval before anything runs.';
  }
  return null;
}

export function setupPlanFirst(S) {
  let enabled = true; // default ON: research before work is the point of intake
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* no storage — the default stands for this page */ }

  const toggles = $$('[data-plan-first]', S.ide);
  function paint() {
    for (const b of toggles) {
      b.className = `pill ${enabled ? 'cy' : 'wt'}`;
      b.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      b.textContent = `Plan first: ${enabled ? 'on' : 'off'}`;
      b.title = enabled
        ? 'On: Zeno first reads the repository (without touching it) and shows a plan you approve, edit, or discard before the run starts.'
        : 'Off: the task goes straight to a run, as before.';
    }
  }
  for (const b of toggles) {
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* private window — the choice lasts this page */ }
      paint();
    });
  }
  paint();
  S.planFirstEnabled = () => enabled;

  // Mirror forge-plan.ts's exported planText() exactly. The daemon remains the
  // context assembler; this only gives POST /forge/context the same task bytes
  // POST /forge/run will receive after an owner approves a plan.
  S.contextTaskForSession = (session, task) => {
    const turn = S.latestPlanTurn ? S.latestPlanTurn(session) : null;
    if (!turn || turn.state !== 'approved' || turn.task !== task || !turn.plan) return task;
    const plan = turn.plan;
    const lines = [
      'OWNER-APPROVED PLAN (produced by a read-only planning pass; follow it, and say so if a step proves wrong):',
      plan.goal ? `Goal: ${plan.goal}` : '',
      'Steps:',
      ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
      plan.files.length ? `Files expected to change: ${plan.files.join(', ')}` : '',
      plan.risks.length ? `Risks and open questions: ${plan.risks.join('; ')}` : '',
    ];
    return `${task}\n\n${lines.filter((line) => line !== '').join('\n')}`;
  };

  /** Ask the daemon for a plan; the turn is pushed first so the owner sees "Planning…" at once. */
  async function requestPlan(session, task, route) {
    const reply = conversationalReply(task);
    if (reply !== null) {
      // Not a coding task — answer right here in the transcript instead of
      // asking the daemon to "plan" a greeting. No worktree, no write, no
      // plan card; the session stays exactly as idle as it was.
      session.chat.push({ who: 'system', text: reply });
      S.renderSessionHeader(session); S.renderChat(session); S.sessionsChanged(session);
      return;
    }
    const turn = { who: 'plan', state: 'planning', task, route, plan: null, planId: null, model: null, note: '', error: null };
    session.chat.push(turn);
    session.planning = true;
    S.renderSessionHeader(session); S.renderChat(session);
    const body = withContextSelection(S, { task, agentId: route.agentId, memoryEnabled: session.memoryEnabled !== false });
    if (route.agentId === 'local' && route.model) body.model = route.model;
    const r = await postJSON('/forge/plan', body);
    session.planning = false;
    if (!r.ok || !r.data || !r.data.plan) {
      turn.state = 'failed';
      turn.error = r.error || (r.data && r.data.error && r.data.error.message) || 'the daemon did not answer';
      turn.resolve = (r.data && r.data.error && r.data.error.resolve) || '';
    } else {
      turn.state = 'pending';
      turn.plan = r.data.plan;
      turn.planId = r.data.planId;
      turn.model = r.data.model;
      turn.note = r.data.note || '';
    }
    S.renderSessionHeader(session); S.renderChat(session); renderPlanSummary(session); S.renderPlan(session);
  }
  S.requestPlan = requestPlan;

  function settle(turn, session, state) {
    turn.state = state;
    S.renderChat(session); renderPlanSummary(session); S.renderPlan(session); S.sessionsChanged(session);
  }

  function stepsList(steps, editing) {
    const ol = el('ol', 'dvsteps plan-steps');
    steps.forEach((s, i) => {
      const li = el('li');
      add(li, el('b', null, String(i + 1)));
      if (editing) {
        const input = el('input', 'plan-step-in');
        input.value = s;
        input.setAttribute('aria-label', `Step ${i + 1}`);
        add(li, input);
      } else {
        add(li, el('span', null, s));
      }
      add(ol, li);
    });
    return ol;
  }

  function listBlock(label, items, cls) {
    if (!items || !items.length) return null;
    const wrap = el('div', `plan-list ${cls || ''}`);
    add(wrap, el('div', 'frm', label));
    const ul = el('ul');
    for (const it of items) add(ul, el('li', null, it));
    add(wrap, ul);
    return wrap;
  }

  /** The chat-turn body for a `who: 'plan'` turn. Every state names what did and did not happen. */
  function planTurnNode(t, session) {
    const bt = el('div', 'bt');
    if (t.state === 'planning') {
      const head = el('div', 'frh');
      add(head, el('span', 'pill cy', 'Planning…'));
      add(bt, head, el('p', null, 'Reading the repository without touching it — no worktree, no writes, no commands. The plan appears here for you to approve.'));
      return bt;
    }
    if (t.state === 'failed') {
      const head = el('div', 'frh');
      add(head, el('span', 'pill rd', 'Plan failed'));
      add(bt, head, el('p', null, `The plan could not be produced: ${t.error}${t.resolve ? ` ${t.resolve}` : ''} Nothing ran.`));
      const row = el('div', 'dva-a');
      const skip = el('button', 'btn p sm', 'Run without a plan');
      skip.type = 'button';
      skip.dataset.planAct = 'skip';
      skip.addEventListener('click', () => { settle(t, session, 'skipped'); void S.proceedWithRoute(session, t.task, t.route, null); });
      const again = el('button', 'btn g sm', 'Try planning again');
      again.type = 'button';
      again.addEventListener('click', () => { session.chat.splice(session.chat.indexOf(t), 1); void requestPlan(session, t.task, t.route); });
      const drop = el('button', 'btn g sm', 'Discard');
      drop.type = 'button';
      drop.dataset.planAct = 'discard';
      drop.addEventListener('click', () => settle(t, session, 'discarded'));
      add(row, skip, again, drop);
      add(bt, row);
      return bt;
    }
    if (t.state === 'discarded') { add(bt, el('p', null, 'Plan discarded — nothing ran, nothing was written.')); return bt; }
    if (t.state === 'skipped') { add(bt, el('p', null, 'Ran without a plan, at your request.')); return bt; }

    const card = el('div', `dvplan plan-card ${t.state}`);
    const head = el('div', 'plan-head');
    add(head, el('span', `pill ${t.state === 'approved' ? 'gr' : 'am'}`, t.state === 'approved' ? 'Plan approved' : t.state === 'editing' ? 'Editing plan' : 'Plan — waiting on you'));
    add(head, el('span', 'frm', `${t.model || 'local'} · read-only pass`));
    add(card, head);
    if (t.plan.goal) add(card, el('p', 'plan-goal', t.plan.goal));
    const editing = t.state === 'editing';
    const steps = stepsList(t.plan.steps, editing);
    add(card, steps);
    if (editing) {
      const more = el('button', 'laction', '+ step');
      more.type = 'button';
      more.addEventListener('click', () => {
        const li = el('li');
        add(li, el('b', null, String(steps.children.length + 1)));
        const input = el('input', 'plan-step-in');
        input.setAttribute('aria-label', `Step ${steps.children.length + 1}`);
        add(li, input); add(steps, li); input.focus();
      });
      add(card, more);
    }
    add(card, listBlock('Files it expects to touch', t.plan.files, 'files'), listBlock('Risks and questions', t.plan.risks, 'risks'));
    // The honesty line is the daemon's own sentence about what planning did
    // not do — shown verbatim so this file cannot overstate it.
    if (t.note) add(card, el('div', 'vsnote', t.note));
    if (t.state !== 'approved') {
      const row = el('div', 'dva-a');
      const go = el('button', 'btn p sm', 'Approve plan & run');
      go.type = 'button';
      go.dataset.planAct = 'approve';
      go.addEventListener('click', () => {
        const chosen = editing
          ? [...steps.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean)
          : t.plan.steps;
        if (!chosen.length) { go.textContent = 'A plan needs at least one step'; return; }
        t.plan = { ...t.plan, steps: chosen };
        settle(t, session, 'approved');
        void S.proceedWithRoute(session, t.task, t.route, { planId: t.planId, plan: t.plan });
      });
      const edit = el('button', 'btn g sm', editing ? 'Done editing' : 'Edit plan');
      edit.type = 'button';
      edit.dataset.planAct = 'edit';
      edit.addEventListener('click', () => {
        if (editing) t.plan = { ...t.plan, steps: [...steps.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean) };
        settle(t, session, editing ? 'pending' : 'editing');
      });
      const drop = el('button', 'btn g sm', 'Discard');
      drop.type = 'button';
      drop.dataset.planAct = 'discard';
      drop.addEventListener('click', () => settle(t, session, 'discarded'));
      add(row, go, edit, drop);
      add(card, row);
    } else {
      add(card, el('div', 'frm', 'The run was started with these steps as owner-approved context.'));
    }
    add(bt, card);
    return bt;
  }
  S.planTurnNode = planTurnNode;

  /** The `#s-plan` details under the session title: the session's live plan, if it has one. */
  function renderPlanSummary(session) {
    const details = $('#s-plan');
    if (!details) return;
    const t = session && session.chat.slice().reverse().find((x) => x.who === 'plan' && x.plan && (x.state === 'pending' || x.state === 'editing' || x.state === 'approved'));
    if (!t) { details.hidden = true; return; }
    details.hidden = false;
    const meta = details.querySelector('.dvplan-m');
    if (meta) meta.textContent = `${t.plan.steps.length} step${t.plan.steps.length === 1 ? '' : 's'} · ${t.state === 'approved' ? 'approved' : 'awaiting you'}`;
    const old = details.querySelector('.dvsteps');
    const fresh = stepsList(t.plan.steps, false);
    if (old) old.replaceWith(fresh); else add(details, fresh);
  }
  S.renderPlanSummary = renderPlanSummary;
  S.latestPlanTurn = (session) => session.chat.slice().reverse().find((x) => x.who === 'plan' && x.plan) || null;
}
