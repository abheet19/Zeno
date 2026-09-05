/*
 * ask.js — Ask Zeno, the typed half of the Command surface.
 *
 * WHAT IT IS. One question box over POST /assistant/ask. The daemon shows a
 * local model a clipped snapshot of the owner's own Zeno — pending approvals,
 * receipts, backlog, repo, memories — and CHECKS the answer against it before
 * anybody sees it. So this file renders one of three things, and never blurs
 * them together:
 *
 *   an ANSWER, with the fact ids it cited;
 *   a FLAGGED reply, when the grounding check found an invented id or an uncited
 *     claim — shown as prose that failed the check, never as an answer;
 *   a NOTE, when no model could answer at all.
 *
 * A confident lie about your own machine is worse than a refusal, so the refusal
 * is what this panel draws by default.
 *
 * WHAT AN ANSWER MAY CARRY. Two suggestions, and neither is an act:
 *
 *   a PROPOSAL — one file the owner might want written. It is already a capsule
 *     waiting in Approvals by the time this renders; this panel says so and
 *     points at it.
 *
 *   a DELEGATION — a job handed to a coding agent. A local model runs on this
 *     machine and has already run by the time the answer arrives, so what is
 *     drawn is what it PROPOSED. A hosted agent has NOT run and will not until
 *     the owner clicks, because it spends their money and sends their code off
 *     the machine — this panel says both of those in words, beside the button.
 *
 * THE RULE THIS FILE KEEPS. Nothing here is ever drawn as applied. A change an
 * agent wrote is a capsule awaiting the owner's approval, and the only verbs
 * this panel uses for one are "proposed" and "waiting". There is no fetch to
 * /approvals anywhere in it.
 */

const R = document.documentElement;

/* ---- auth: the same token the rest of the window reads --------------------- */

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

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function masked() {
  return R.getAttribute('data-lock') === '1';
}

/** The label a rung is shown under. The id, rather than an invented name, if unknown. */
function agentLabel(agentId) {
  if (agentId === 'local') return 'a local model on this machine';
  if (agentId === 'claude-code') return 'Claude Code (Anthropic, over the network)';
  return agentId || 'an unnamed agent';
}

/* ---- the panel ------------------------------------------------------------- */

function mountPanel() {
  const host = document.querySelector('[data-mount="ask"]');
  if (!host) return null;

  const panel = el('section', 'za-panel');
  panel.setAttribute('aria-label', 'Ask Zeno');
  panel.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:8px',
    'padding:11px 13px', 'border:1px solid var(--rule,#242C31)', 'border-radius:12px',
    'background:var(--g3,#151A1D)', 'color:var(--ink,#ECEBE6)', 'max-width:560px',
    'font:13px/1.5 system-ui,sans-serif',
  ].join(';');

  const row = el('div', 'za-row');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'za-input';
  input.placeholder = 'Ask about your Zeno, or ask for something to be built…';
  input.setAttribute('aria-label', 'Ask Zeno a question');
  input.style.cssText = [
    'flex:1 1 260px', 'min-width:0', 'padding:9px 12px', 'border-radius:8px',
    'border:1px solid var(--rule-2,#2C353B)', 'background:var(--g2,#101416)',
    'color:var(--ink,#ECEBE6)', 'font:13px system-ui,sans-serif',
  ].join(';');

  const send = el('button', 'za-send', 'Ask');
  send.type = 'button';
  send.style.cssText = [
    'padding:9px 18px', 'border-radius:999px', 'border:1px solid var(--cyan-dim,#1E6B76)',
    'background:var(--g5,#222A2E)', 'color:var(--ink,#ECEBE6)',
    'font:600 13px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  row.append(input, send);

  const status = el('p', 'za-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';

  const answer = el('div', 'za-answer');
  answer.hidden = true;
  answer.style.cssText = [
    'padding:9px 11px', 'border-radius:8px', 'border:1px solid var(--rule-2,#2C353B)',
    'background:var(--g2,#101416)', 'white-space:pre-wrap', 'overflow-wrap:anywhere', 'font-size:12.5px',
  ].join(';');

  const cited = el('p', 'za-cited');
  cited.hidden = true;
  cited.style.cssText = 'margin:0;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-3,#6C7480)';

  // The delegation block: what would run, what it costs, and what came back.
  const delegate = el('div', 'za-delegate');
  delegate.hidden = true;
  delegate.setAttribute('role', 'group');
  delegate.setAttribute('aria-label', 'Work Zeno was asked to delegate');
  delegate.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:7px',
    'padding:10px 12px', 'border-radius:10px',
    'border:1px solid var(--rule-2,#2C353B)', 'background:var(--g2,#101416)',
  ].join(';');
  const dTask = el('p', 'za-delegate-task');
  dTask.style.cssText = 'margin:0;font-size:12.5px;overflow-wrap:anywhere';
  const dAgent = el('p', 'za-delegate-agent');
  dAgent.style.cssText = 'margin:0;font:700 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:var(--ink-2,#9AA1AC)';
  const dWhy = el('p', 'za-delegate-why');
  dWhy.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  const dState = el('p', 'za-delegate-state');
  dState.setAttribute('role', 'status');
  dState.setAttribute('aria-live', 'polite');
  dState.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  const dButtons = el('div', 'za-delegate-buttons');
  dButtons.hidden = true;
  dButtons.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const dRun = el('button', 'za-delegate-run', 'Run it');
  dRun.type = 'button';
  dRun.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--amber,#E0A128)',
    'background:transparent', 'color:var(--ink,#ECEBE6)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  const dSkip = el('button', 'za-delegate-skip', 'Not now');
  dSkip.type = 'button';
  dSkip.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--rule-2,#2C353B)',
    'background:transparent', 'color:var(--ink-2,#9AA1AC)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  dButtons.append(dRun, dSkip);
  const dLink = el('button', 'za-delegate-link', 'review what is waiting ›');
  dLink.type = 'button';
  dLink.hidden = true;
  dLink.style.cssText = [
    'align-self:flex-start', 'padding:0', 'border:0', 'background:none',
    'color:var(--cyan,#2AA5B8)', 'font:600 12px system-ui,sans-serif', 'cursor:pointer', 'text-align:left',
  ].join(';');
  delegate.append(dTask, dAgent, dWhy, dState, dButtons, dLink);

  // Never folded away: what this panel can and cannot do, in one sentence.
  const plain = el(
    'p',
    'za-plain',
    'Answers come from a local model reading a snapshot of your own Zeno, and every claim is checked ' +
      'against it before you see it. Asking can propose work and can start a local agent; it can never ' +
      'approve anything, and nothing an agent writes is applied until you approve it yourself.',
  );
  plain.style.cssText = 'margin:0;font-size:11.5px;line-height:1.5;color:var(--ink-2,#9AA1AC)';

  panel.append(row, status, answer, cited, delegate, plain);
  host.appendChild(panel);
  return {
    panel, input, send, status, answer, cited,
    delegate, dTask, dAgent, dWhy, dState, dButtons, dRun, dSkip, dLink,
  };
}

const ui = mountPanel();

/* ---- rendering ------------------------------------------------------------- */

function setStatus(text, tone) {
  ui.status.textContent = text || '';
  ui.status.style.color = tone === 'ok' ? 'var(--green,#5BB98C)' : tone === 'warn' ? 'var(--amber,#E0A128)' : 'var(--ink-2,#9AA1AC)';
}

function clearAnswer() {
  ui.answer.hidden = true;
  ui.answer.textContent = '';
  ui.answer.style.borderColor = 'var(--rule-2,#2C353B)';
  ui.cited.hidden = true;
  ui.cited.textContent = '';
  ui.delegate.hidden = true;
  ui.dButtons.hidden = true;
  ui.dLink.hidden = true;
  ui.dWhy.textContent = '';
  ui.dState.textContent = '';
}

/**
 * The one sentence said after any run, in the only terms that are true.
 *
 * `ok` is read as well as the count, because the two are independent. The
 * daemon no longer discards what a FAILED agent wrote — an agent that edits
 * files and then exits non-zero used to have its work deleted and be reported
 * as "no changes", which is how real edits went missing. Now those files arrive
 * here, and a run that did not finish must not be announced in the same words
 * as one that did: the count is stated, and so is the failure, in that order.
 */
function renderRunResult(proposedList, note, ok) {
  const proposed = Array.isArray(proposedList) ? proposedList.length : 0;
  if (proposed > 0) {
    const many = proposed === 1 ? '' : 's';
    const failed = ok === false;
    ui.dState.textContent = failed
      ? `The run did NOT finish — ${note ? String(note) : 'the agent stopped early'}. ` +
        `It had already written ${proposed} file${many}, which ${proposed === 1 ? 'is' : 'are'} kept ` +
        'and waiting for you in Command rather than thrown away. Read them before you approve: ' +
        'a run that stopped early may have left them half-finished.'
      : `${proposed} change${many} proposed — review them in Command. ` +
        'None has been applied; each is waiting for your approval.';
    ui.dState.style.color = failed ? 'var(--amber,#E0A128)' : 'var(--green,#5BB98C)';
    ui.dLink.hidden = false;
    setStatus(
      failed ? `The run failed after writing ${proposed} file${many}.` : `${proposed} change${many} proposed.`,
      failed ? 'warn' : 'ok',
    );
    return;
  }
  // A run that changed nothing is a real outcome, said as one, with the agent's
  // own reason when it gave one — never dressed up as a success.
  ui.dState.textContent = `No changes were proposed. ${note ? String(note) : 'The agent finished without changing any file.'}`;
  ui.dState.style.color = 'var(--amber,#E0A128)';
  setStatus('The agent proposed no changes.', 'warn');
}

/**
 * Draw a delegation the daemon reported.
 *
 * Three shapes, and they must never be blurred: it RAN (local — on this machine,
 * already finished, here is what is waiting), it WANTS A CLICK (hosted — has not
 * run, and here is what it would cost), or NOTHING COULD RUN IT.
 */
function renderDelegation(d) {
  if (!d) return;
  ui.delegate.hidden = false;
  ui.dTask.textContent = masked() ? 'Work withheld · masked' : `Work: “${d.task || ''}”`;
  ui.dAgent.textContent = d.agentId ? `AGENT: ${agentLabel(d.agentId)}${d.model ? ` · ${d.model}` : ''}` : 'NO AGENT CHOSEN';

  if (d.needsConfirm) {
    // NOT STARTED, and it says so before it says anything else.
    ui.dState.textContent = 'Not started. Nothing has been sent anywhere yet.';
    ui.dState.style.color = 'var(--amber,#E0A128)';
    ui.dWhy.textContent =
      `Zeno did not start this, because ${d.because || 'it spends money and sends your code off this machine'}. ` +
      'Starting it is your click, and even then every file it writes still waits for your approval.';
    ui.dWhy.style.color = 'var(--amber,#E0A128)';
    ui.dButtons.hidden = false;
    ui.dRun.textContent = `Run it on ${agentLabel(d.agentId)}`;
    ui.dRun.onclick = () => confirmHosted(d);
    ui.dSkip.onclick = () => {
      ui.delegate.hidden = true;
      setStatus('Not run. Nothing was sent anywhere.', 'ok');
    };
    return;
  }

  if (d.started) {
    ui.dWhy.textContent =
      'This ran on your machine. Your code did not leave it, and nothing it wrote has been applied.';
    ui.dWhy.style.color = 'var(--ink-2,#9AA1AC)';
    renderRunResult(d.proposed, d.note, d.ok);
    return;
  }

  // Nothing ran and nothing is offered. Say why, and never imply otherwise.
  ui.dWhy.textContent = '';
  ui.dState.textContent = d.note || 'Nothing was started, and nothing ran.';
  ui.dState.style.color = 'var(--amber,#E0A128)';
  setStatus('Nothing was started.', 'warn');
}

/** The owner clicked "run it" on a hosted agent. This is the ONLY way one starts. */
async function confirmHosted(d) {
  const confirm = d.confirm || { method: 'POST', path: '/forge/run', body: { task: d.task, agentId: d.agentId } };
  ui.dButtons.hidden = true;
  ui.dState.textContent = `Running on ${agentLabel(d.agentId)}… your code has been sent to run this.`;
  ui.dState.style.color = 'var(--cyan,#2AA5B8)';
  setStatus('Running…');
  try {
    const res = await fetch(confirm.path, {
      method: confirm.method,
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify(confirm.body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      ui.dState.textContent = `The run was refused: ${err.message || res.status}. ${err.resolve || ''}`.trim();
      ui.dState.style.color = 'var(--amber,#E0A128)';
      setStatus('The run was refused.', 'warn');
      return;
    }
    renderRunResult(data.proposed, data.run && data.run.note, data.run ? data.run.ok : undefined);
  } catch (e) {
    ui.dState.textContent = `Network error during the run: ${e && e.message ? e.message : e}.`;
    ui.dState.style.color = 'var(--amber,#E0A128)';
    setStatus('The run failed.', 'warn');
  }
}

/* ---- the one question --------------------------------------------------- */

let asking = false;

async function ask() {
  const question = ui.input.value.trim();
  if (question === '' || asking) return;
  if (!OWNER_TOKEN) {
    setStatus('This browser cannot ask (no token was injected). Open the window the daemon serves.', 'warn');
    return;
  }
  asking = true;
  ui.send.disabled = true;
  clearAnswer();
  // Said in the present tense and hedged on purpose: an answer that asks for
  // work may have started a LOCAL agent inside this same request, and the owner
  // should not learn that only once it has finished.
  setStatus('Thinking… if this asks for work, a local agent may be running it now.');
  try {
    const res = await fetch('/assistant/ask', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify({ question }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      setStatus(`Could not ask: ${err.message || res.status}. ${err.resolve || ''}`.trim(), 'warn');
      return;
    }

    if (data.answer) {
      ui.answer.hidden = false;
      ui.answer.textContent = masked() ? 'Answer withheld · masked' : data.answer;
      const ids = Array.isArray(data.cited) ? data.cited : [];
      if (ids.length) {
        ui.cited.hidden = false;
        ui.cited.textContent = `cited: ${ids.join(' ')}`;
      }
      setStatus(data.note ? String(data.note) : '');
    } else if (data.flagged) {
      // NOT an answer. The grounding check found an invented id or an uncited
      // claim, so the prose is shown as what it is — text that failed the check.
      ui.answer.hidden = false;
      ui.answer.style.borderColor = 'var(--amber,#E0A128)';
      ui.answer.textContent = masked() ? 'Reply withheld · masked' : data.flagged;
      const u = data.ungrounded || {};
      const bad = [
        (u.unknownIds || []).length ? `invented ids: ${(u.unknownIds || []).join(' ')}` : null,
        (u.claimsWithoutCitation || []).length ? `${(u.claimsWithoutCitation || []).length} claim(s) with no citation` : null,
      ].filter(Boolean).join(' · ');
      setStatus(`This did not pass the grounding check, so it is not being shown as an answer. ${bad}`.trim(), 'warn');
    } else {
      setStatus(data.note ? String(data.note) : 'No answer came back.', 'warn');
    }

    if (data.proposal && data.proposal.relPath) {
      ui.cited.hidden = false;
      ui.cited.textContent =
        (ui.cited.textContent ? ui.cited.textContent + '\n' : '') +
        `proposed ${data.proposal.relPath} — waiting for your approval, not applied`;
    }
    renderDelegation(data.delegated);
  } catch (e) {
    setStatus(`Network error: ${e && e.message ? e.message : e}. Your Zeno state is unaffected.`, 'warn');
  } finally {
    asking = false;
    ui.send.disabled = false;
  }
}

/* ---- boot ------------------------------------------------------------------ */

if (ui) {
  ui.send.addEventListener('click', () => ask());
  ui.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ask();
  });
  // The link under a finished run only ever MOVES the owner to the approvals
  // section. It approves nothing: there is no call to /approvals in this file.
  ui.dLink.addEventListener('click', () => {
    const pending = document.getElementById('pending') || document.querySelector('[data-mount="pending"]');
    if (pending && typeof pending.scrollIntoView === 'function') pending.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  setStatus('Not asked yet. Nothing here is a stored answer — every line comes from one live read.');
}

export default { ask };
