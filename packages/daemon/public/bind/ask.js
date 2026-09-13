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
import { setupCommandMenu } from './command-menu.js';

/* ---- navigation: "open receipts", "go to Forge" — pure, client-side ------- *
 *
 * The owner should be able to say where they want to go, not just what they
 * want answered. This is deliberately NOT run through /assistant/ask: pure
 * navigation is not an effect — it clicks a real, already-wired nav control —
 * so it needs no model, no grounding, and no approval. What makes it safe is
 * the same thing that makes it narrow: it recognises one clean shape ("open
 * <target>", "go to <target>", "show <target>", …) and, when the target does
 * not name one of Command's own screens or one of Zeno's three products
 * exactly, it recognises NOTHING — the message is sent to the assistant like
 * any other question instead of being guessed at.
 */

/** The screens Command's own rail exposes, each `.nav-i[data-screen="…"]`. */
const SCREEN_ALIASES = {
  home: 'home',
  chats: 'chats', chat: 'chats',
  approvals: 'approvals', approval: 'approvals',
  receipts: 'receipts', receipt: 'receipts',
  work: 'work', tasks: 'work', task: 'work',
  vault: 'vault', memory: 'vault', memories: 'vault',
  devices: 'devices', device: 'devices',
  integrations: 'integrations', integration: 'integrations',
  projects: 'projects', project: 'projects',
  customize: 'customize', customise: 'customize',
  customization: 'customize', customisation: 'customize', settings: 'customize',
};

/** The three products, each switched by `.seg [data-product="…"]`. */
const PRODUCT_ALIASES = { command: 'command', forge: 'forge', counsel: 'counsel' };

const NAV_LABEL = {
  home: 'Home', chats: 'Chats', approvals: 'Approvals', receipts: 'Receipts', work: 'Work',
  vault: 'Vault', devices: 'Devices', integrations: 'Integrations', projects: 'Projects', customize: 'Customize',
  command: 'Command', forge: 'Forge', counsel: 'Counsel',
};

/** One clean shape: an opening verb, an optional "the", then the target. */
const NAV_RE = new RegExp(
  '^(?:please\\s+)?(?:go(?:\\s+ahead)?\\s+to|navigate\\s+to|take\\s+me\\s+to|' +
    'switch\\s+to|jump\\s+to|open|show)\\s+(?:the\\s+)?(.+?)\\s*[.!?]*$',
  'i',
);
/** A trailing generic word costs nothing — "the approvals screen" still means approvals. */
const NAV_GENERIC_TAIL = new Set(['screen', 'tab', 'page', 'view', 'product', 'section']);

/**
 * Read a navigation target out of the owner's own words, or `null`.
 *
 * Deliberately narrow, the same way `fallbackDelegation` is narrow: only ONE
 * shape is recognised, and only when what follows the verb is — after a
 * trailing generic word or two is dropped — exactly the name of a screen or
 * a product. "Show me what changed in the sandbox" starts with a nav verb
 * too, but "me what changed in the sandbox" names nothing this function
 * knows, so it returns `null` and the question goes to the assistant like
 * any other — guessing wrong here would silently swallow a real question.
 */
function parseNavCommand(question) {
  const m = NAV_RE.exec(question.trim());
  if (m === null) return null;
  const words = (m[1] ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && NAV_GENERIC_TAIL.has(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  const phrase = words.join(' ');
  if (Object.prototype.hasOwnProperty.call(PRODUCT_ALIASES, phrase)) {
    const name = PRODUCT_ALIASES[phrase];
    return { kind: 'product', name, label: NAV_LABEL[name] };
  }
  if (Object.prototype.hasOwnProperty.call(SCREEN_ALIASES, phrase)) {
    const name = SCREEN_ALIASES[phrase];
    return { kind: 'screen', name, label: NAV_LABEL[name] };
  }
  return null;
}

/**
 * Actually navigate: click the SAME controls the owner's own mouse would —
 * never a synthetic route of this module's own. A screen lives inside the
 * Command product, so getting to one first clicks Command (a harmless no-op
 * when already there) and then the screen's own rail button; ui.js's existing
 * listeners do the rest, exactly as they do for a real click.
 */
function performNav(nav) {
  if (nav.kind === 'product') {
    const btn = document.querySelector(`.seg [data-product="${nav.name}"]`);
    if (btn) { btn.click(); return true; }
    return false;
  }
  const cmd = document.querySelector('.seg [data-product="command"]');
  if (cmd) cmd.click();
  const screenBtn = document.querySelector(`.nav-i[data-screen="${nav.name}"]`);
  if (screenBtn) { screenBtn.click(); return true; }
  return false;
}

/**
 * Seed Forge's OWN composer with a delegated task and switch to it. This
 * never runs anything: it fills a textarea and focuses it, the same as
 * clicking one of the starter chips ui.js already ships, and the owner is
 * the one who presses Forge's own Send. Forge shows two composers depending
 * on whether a session is already open — the empty-state hero (`#ag-ta`) or
 * the session composer (`#s-ta`) — so both are checked live, at click time,
 * rather than assumed from whatever was true when this module loaded.
 */
function seedForgeComposer(task) {
  const forgeBtn = document.querySelector('.seg [data-product="forge"]');
  if (forgeBtn) forgeBtn.click();

  const empty = document.querySelector('#s-empty');
  const heroIsShowing = !empty || !empty.hidden;
  const preferred = heroIsShowing ? document.querySelector('#ag-ta') : document.querySelector('#s-ta');
  const target = preferred || document.querySelector('#s-ta') || document.querySelector('#ag-ta');
  if (!target) return false;
  target.value = task;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.focus();
  return true;
}

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
  // An instruction the grounded answerer could not answer but CAN hand to
  // Forge is not "no answer text" — say what it is, then show the offer.
  const offersTask = !!(payload.delegated && typeof payload.delegated.task === 'string' && payload.delegated.task.trim());
  nodes.push(paragraph(answer || (offersTask
    ? 'That reads as a task rather than a question about your Zeno, so nothing here can answer it — but Forge can do it.'
    : 'The daemon returned no answer text.')));

  if (payload.ungrounded && !offersTask) {
    const w = el('div', 'fnote', 'Not grounded in your local state — treat this as unverified.');
    w.style.color = 'var(--amber)';
    nodes.push(w);
  }

  // `general: true` is a DIFFERENT answer from a grounded one — the daemon
  // tried the grounded, cited path first and only fell through to this one
  // once it genuinely found nothing to cite. It carries no citations by
  // construction, so it gets its own honest label rather than reading like a
  // grounded answer that simply cited nothing.
  if (payload.general) {
    const w = el('div', 'fnote', 'General knowledge — not grounded in your Zeno state.');
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

    // Still just an OFFER: this only navigates to Forge and pre-fills its
    // composer with the task. It never calls Forge's own Send — the owner
    // does that by hand, in Forge, the same as any other governed run.
    if (typeof d.task === 'string' && d.task.trim()) {
      const a = el('div', 'dva-a');
      const go = el('button', 'btn p sm', d.needsConfirm ? 'Start in Forge' : 'Open in Forge');
      go.addEventListener('click', () => seedForgeComposer(d.task));
      a.append(go);

      // "Run in Forge now" — Command IS the orchestrator: this opens a NEW
      // Forge session and starts the task immediately, the same as the owner
      // typing it into Forge's own composer and pressing Send. Governance is
      // untouched: bind/forge/session.js's sendTask() still decides local vs
      // hosted, and a hosted route still stops and shows its own confirm
      // turn — this button never sets hostedConfirmed itself, it only saves
      // the owner from retyping the task after switching products.
      const run = el('button', 'btn p sm', 'Run in Forge now');
      run.addEventListener('click', () => {
        const forgeBtn = document.querySelector('.seg [data-product="forge"]');
        if (forgeBtn) forgeBtn.click();
        window.dispatchEvent(new CustomEvent('zeno:command-run', { detail: { task: d.task } }));
      });
      a.append(run);

      nodes.push(a);
    }
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
 * The "/" commands this composer offers right now — never a fixed list: `/new`
 * is left out when there is no open thread to reset, and each entry runs the
 * exact control a click would.
 */
function homeCommands() {
  const out = [];
  const newChat = $('#home-newchat');
  if (newChat && newChat.offsetParent !== null) {
    out.push({ id: 'new', hint: 'Start a new chat', run: () => newChat.click() });
  }
  out.push({ id: 'model', hint: 'Choose a model', run: () => { const p = $('[data-model-pill]', $('.screen[data-screen="home"]')); if (p) p.click(); } });
  // Reuses the exact hand-off `d.task`'s "Open in Forge" button below uses:
  // switch product and focus Forge's own composer. The command menu only
  // ever fires on a bare "/forge" (see command-menu.js's input regex), so
  // there is never draft text left in this composer to carry over — the
  // owner types the task in Forge's own box, same as clicking the product tab.
  out.push({ id: 'forge', hint: 'Switch to Forge', run: () => seedForgeComposer('') });
  out.push({ id: 'help', hint: 'What can Zeno do?', run: () => { const ta = $('#home-ta'); if (ta) { ta.value = 'help'; ta.dispatchEvent(new Event('input', { bubbles: true })); const s = $('#home-send'); if (s) s.click(); } } });
  return out;
}

/**
 * Wire one composer: a textarea, a send button, and the turn list they write to.
 * Returns false when the markup is not present, so a missing surface is skipped
 * rather than throwing.
 */
function wire({ ta, send, turns, thread, onFirstTurn, commands }) {
  if (!ta || !turns) return false;
  if (ta.dataset.askWired) return true;
  ta.dataset.askWired = '1';

  const cmdMenu = commands ? setupCommandMenu(ta, commands) : null;
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

    // Pure navigation never reaches the network: clicking a nav control is not
    // an effect, so it needs no model and no approval. Anything not a CLEAN
    // "open <target>" shape falls through to the real question below —
    // ambiguous is not this function's job to resolve.
    const nav = parseNavCommand(question);
    if (nav) {
      const opened = performNav(nav);
      turns.append(turn('z', (b) => b.append(el(
        'div', 'fnote',
        opened ? `Opened ${nav.label}.` : `Could not find ${nav.label} in this window.`,
      ))));
      turns.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      busy = false;
      if (send) send.disabled = false;
      return;
    }

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
    // The "/" menu owns arrows/Enter/Escape while it is open; only once it
    // says it did not handle the key does Enter fall through to Send.
    if (cmdMenu && cmdMenu.handleKeydown(e)) return;
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
    commands: homeCommands,
  });

  // The starter chips prefill the composer; that part of ui.js is honest, and
  // now what they prefill actually gets asked.

  // CHATS — same composer contract inside an opened thread.
  wire({ ta: $('#chats-ta'), send: $('#chats-send'), turns: $('#chats-turns'), thread: null });
}
