/*
 * bind/ask.js — make Command's composer actually ask Zeno.
 *
 * The design artifact ships a mock conversation: ui.js's own sendHome() invents
 * a reply, prints a fake activity trace ("read /state · read /memory — 2
 * recalled") and ends with the giveaway "(In the live app this is the model's
 * answer…)". Measured: sending a message made ZERO network calls.
 *
 * That is the worst thing this product can do. It is not merely unfinished — it
 * fabricates an answer AND claims to have read the owner's state to produce it.
 * This module replaces that path with the real one: POST /assistant/ask, the
 * grounded answer the daemon actually returned, and its real citation/ungrounded
 * flags. If the daemon cannot be reached, it says so; it never invents prose.
 *
 * Delegation and approval stay where they belong. Ask can PROPOSE work (the
 * daemon may return `delegated` or `proposal`), but this module never calls
 * /approvals and never starts hosted work on its own — the owner clicks.
 */

import { $, $$, el, fill, authHeaders } from '../bind.js';

/* ---- turn rendering, in the artifact's own components --------------------- */

function turn(who, build) {
  const t = el('div', `turn ${who === 'you' ? 'you' : 'z'}`);
  const avatar = el('div', 'who', who === 'you' ? 'A' : 'Z');
  const body = el('div', 'bt');
  build(body);
  t.append(avatar, body);
  return t;
}

function paragraph(text) {
  return el('p', null, text);
}

/** A cited claim keeps its marker visible; the daemon's [g1] markers are real. */
function answerBody(payload) {
  const nodes = [];
  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
  nodes.push(paragraph(answer || 'The daemon returned no answer text.'));

  if (payload.ungrounded) {
    const w = el('div', 'fnote', 'Not grounded in your local state — treat this as unverified.');
    w.style.color = 'var(--amber)';
    nodes.push(w);
  }

  const cited = Array.isArray(payload.cited) ? payload.cited : [];
  if (cited.length) {
    const list = el('div', 'fnote');
    list.append(el('b', null, 'Sources: '));
    list.append(document.createTextNode(cited.map((c) => (typeof c === 'string' ? c : c.id || c.source || '')).filter(Boolean).join(' · ')));
    nodes.push(list);
  }

  if (payload.note) nodes.push(el('div', 'fnote', String(payload.note)));

  // A proposal or delegation is an OFFER. The owner acts on it; we never do.
  if (payload.proposal) {
    const p = payload.proposal;
    const box = el('div', 'dvapproval');
    const h = el('div', 'dva-h');
    h.append(el('span', 'tier', 'held'), el('b', null, 'A change is waiting for your approval'));
    const m = el('div', 'dva-m', [p.relPath, p.summary].filter(Boolean).join(' · ') || 'Review it in Command → Approvals.');
    const a = el('div', 'dva-a');
    const go = el('button', 'btn p sm', 'Review in Approvals');
    go.setAttribute('data-screen-jump', 'approvals');
    a.append(go);
    box.append(h, m, a);
    nodes.push(box);
  }
  if (payload.delegated) {
    const d = payload.delegated;
    const box = el('div', 'fnote');
    box.textContent = d.needsConfirm
      ? `This would run on ${d.agentId || 'a hosted agent'} and has NOT started. Start it from Forge — voice and chat cannot start hosted work.`
      : `Delegated to ${d.agentId || 'an agent'}.`;
    nodes.push(box);
  }
  return nodes;
}

/* ---- the real request ----------------------------------------------------- */

async function ask(question) {
  const res = await fetch('/assistant/ask', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    cache: 'no-store',
    body: JSON.stringify({ question }),
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, payload };
}

/**
 * Wire one composer: a textarea, a send button, and the turn list they write to.
 * Returns false when the markup is not present, so a missing surface is skipped
 * rather than throwing.
 */
function wire({ ta, send, turns, thread, onFirstTurn }) {
  if (!ta || !turns) return false;
  if (ta.dataset.askWired) return true;
  ta.dataset.askWired = '1';

  let busy = false;

  async function submit() {
    const question = ta.value.trim();
    if (!question || busy) return;
    busy = true;
    if (send) send.disabled = true;

    if (onFirstTurn) onFirstTurn();
    if (thread && thread.hidden) thread.hidden = false;

    turns.append(turn('you', (b) => b.append(paragraph(question))));
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Honest progress: "asking" is a state we are actually in, not a fake trace.
    const pending = turn('z', (b) => b.append(el('div', 'fnote', 'Asking Zeno — reading your local state…')));
    turns.append(pending);
    turns.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });

    try {
      const { ok, status, payload } = await ask(question);
      pending.remove();
      if (!ok) {
        const e = payload.error || {};
        turns.append(turn('z', (b) => {
          const msg = el('p', null, `Could not ask: ${e.message || status}${e.resolve ? ' — ' + e.resolve : ''}`);
          msg.style.color = 'var(--amber)';
          b.append(msg);
        }));
      } else {
        turns.append(turn('z', (b) => b.append(...answerBody(payload))));
      }
    } catch (err) {
      pending.remove();
      turns.append(turn('z', (b) => {
        const msg = el('p', null, `The daemon could not be reached: ${(err && err.message) || err}. Nothing was asked and nothing ran.`);
        msg.style.color = 'var(--amber)';
        b.append(msg);
      }));
    } finally {
      busy = false;
      if (send) send.disabled = false;
      turns.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }

  // Replace the artifact's handlers rather than racing them: cloning the button
  // drops ui.js's mock listener, and we own Enter on the textarea.
  if (send) {
    const fresh = send.cloneNode(true);
    send.replaceWith(fresh);
    fresh.addEventListener('click', (e) => { e.preventDefault(); void submit(); });
    send = fresh;
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); void submit(); }
  }, true);

  return true;
}

export async function bind() {
  // HOME — the artifact hides the hero once a conversation starts.
  const heroBlock = $('#hero-block');
  const starters = $('#starters-block');
  wire({
    ta: $('#home-ta'),
    send: $('#home-send'),
    turns: $('#home-turns'),
    thread: $('#home-thread'),
    onFirstTurn: () => {
      if (heroBlock) heroBlock.hidden = true;
      if (starters) starters.hidden = true;
    },
  });

  // The starter chips prefill the composer; that part of ui.js is honest, and
  // now what they prefill actually gets asked.

  // CHATS — same composer contract inside an opened thread.
  wire({ ta: $('#chats-ta'), send: $('#chats-send'), turns: $('#chats-turns'), thread: null });
}
