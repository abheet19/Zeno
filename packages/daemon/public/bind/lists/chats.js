/**
 * bind/lists/chats.js — CHATS screen: the real archive of Home's own
 * conversation (snapshotted into this browser's `localStorage`), and a real
 * composer that calls the same `/assistant/ask` Home uses.
 *
 * Draws `.sbar` (search) above `#chats-list-view` (a `.row-list#chats-list`
 * of rows) and `#chats-open-view` (`#chats-title`, `#chats-turns`, and its
 * own composer: `#chats-ta` / `#chats-send` / `#chats-back`).
 *
 * Stores its archive in `localStorage['zeno-chats']` — the same key
 * bind.js's rail-badge counter already reads (`Array.isArray(arr).length`),
 * so the two agree without either reaching into the other. Turns are
 * snapshotted from Home's own live thread (`#home-turns .turn.you|.z .bt`,
 * ui.js's own markup) rather than invented, and the composer inside an
 * opened chat calls the same real `/assistant/ask` Home uses (see ask.js) —
 * never a canned reply.
 */

import { $$, el, fill, setText, token, screenEl } from '../../bind.js';
import { clip, ageStr, plural, toast, postJSON, lrowEl, emptyEl } from './shared.js';

const CHATS_KEY = 'zeno-chats'; // same key bind.js's rail badge reads

function loadChats() {
  try {
    const v = JSON.parse(localStorage.getItem(CHATS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function persistChats(sessions) {
  try { localStorage.setItem(CHATS_KEY, JSON.stringify(sessions.slice(0, 60))); } catch { /* storage off: in-memory only */ }
}

function turnNode(t) {
  const div = el('div', 'turn ' + (t.role === 'user' ? 'you' : 'z'));
  div.appendChild(el('div', 'who', t.role === 'user' ? 'A' : 'Z'));
  const bt = el('div', 'bt');
  bt.appendChild(el('p', null, t.text || ''));
  div.appendChild(bt);
  return div;
}

export async function bindChats() {
  const screen = screenEl('chats');
  const listEl = document.getElementById('chats-list');
  if (!screen || !listEl) return;

  const listView = document.getElementById('chats-list-view');
  const openView = document.getElementById('chats-open-view');
  const titleEl = document.getElementById('chats-title');
  const turnsEl = document.getElementById('chats-turns');
  const backBtn = document.getElementById('chats-back');
  const sendBtn = document.getElementById('chats-send');
  const taEl = document.getElementById('chats-ta');
  const searchInput = screen.querySelector('.sbar input');
  const homeTurns = document.getElementById('home-turns');

  let sessions = loadChats();
  let current = null;
  let openId = null;
  const hasToken = !!token();

  function readHomeTurns() {
    if (!homeTurns) return null;
    const found = $$('.turn', homeTurns);
    if (!found.length) return [];
    return found.map((t) => {
      const role = t.classList.contains('you') ? 'user' : 'assistant';
      const bt = t.querySelector('.bt');
      const text = bt ? bt.textContent.trim() : '';
      return { role, text };
    }).filter((t) => t.text);
  }

  function snapshot() {
    const turns = readHomeTurns();
    if (turns === null) return;
    if (turns.length === 0) { current = null; return; }
    if (!current) {
      current = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        startedAt: new Date().toISOString(),
        turns: [],
        title: '',
      };
      sessions.unshift(current);
      if (sessions.length > 60) sessions.length = 60;
    }
    current.turns = turns;
    const firstUser = turns.find((t) => t.role === 'user');
    current.title = clip((firstUser && firstUser.text) || 'New chat', 72);
    current.updatedAt = new Date().toISOString();
    persistChats(sessions);
    renderList();
  }

  function renderList() {
    const q = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();
    const rows = sessions.filter((s) => {
      if (!q) return true;
      if (String(s.title || '').toLowerCase().includes(q)) return true;
      return (s.turns || []).some((t) => String(t.text || '').toLowerCase().includes(q));
    });
    if (!rows.length) {
      fill(listEl, sessions.length
        ? emptyEl('No conversation matches that.', '')
        : emptyEl('No conversations yet.', 'Ask Zeno anything on Home and it is saved here — on this machine only.'));
      return;
    }
    const nodes = rows.map((s) => {
      const n = (s.turns || []).length;
      const row = lrowEl(ageStr(s.updatedAt || s.startedAt) || '·', s.title || 'Untitled', n + ' ' + plural(n, 'message', 'messages'), null);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('data-chat-id', s.id);
      return row;
    });
    fill(listEl, ...nodes);
  }

  function openChat(id) {
    const s = sessions.find((x) => x.id === id);
    if (!s || !titleEl || !turnsEl || !listView || !openView) return;
    openId = id;
    setText(titleEl, s.title || 'Untitled');
    fill(turnsEl, ...(s.turns || []).map(turnNode));
    listView.hidden = true;
    openView.hidden = false;
  }

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest ? e.target.closest('[data-chat-id]') : null;
    if (row) openChat(row.getAttribute('data-chat-id'));
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest ? e.target.closest('[data-chat-id]') : null;
    if (!row) return;
    e.preventDefault();
    openChat(row.getAttribute('data-chat-id'));
  });

  if (backBtn) backBtn.addEventListener('click', () => { openId = null; });
  if (searchInput) searchInput.addEventListener('input', renderList);

  async function sendFromChat() {
    if (!taEl || openId === null) return;
    const text = taEl.value.trim();
    if (!text) return;
    if (!hasToken) { toast('This window has no owner token, so it cannot ask.'); return; }
    const s = sessions.find((x) => x.id === openId);
    if (!s) return;

    s.turns = Array.isArray(s.turns) ? s.turns : [];
    const userTurn = { role: 'user', text };
    s.turns.push(userTurn);
    if (turnsEl) turnsEl.appendChild(turnNode(userTurn));
    taEl.value = '';
    taEl.style.height = 'auto';
    s.updatedAt = new Date().toISOString();
    persistChats(sessions);
    renderList();
    if (turnsEl) turnsEl.scrollTop = turnsEl.scrollHeight;

    const model = typeof window.zenoCommandModel === 'function' ? window.zenoCommandModel() : null;
    const res = await postJSON('/assistant/ask', model ? { question: text, model } : { question: text });
    let replyText;
    if (!res.ok) {
      replyText = 'Could not ask: ' + res.error;
    } else {
      const payload = res.data || {};
      replyText = payload.answer ? String(payload.answer)
        : payload.flagged ? String(payload.flagged)
          : payload.note ? String(payload.note) : 'No answer came back.';
    }
    const assistantTurn = { role: 'assistant', text: replyText };
    s.turns.push(assistantTurn);
    if (turnsEl) { turnsEl.appendChild(turnNode(assistantTurn)); turnsEl.scrollTop = turnsEl.scrollHeight; }
    s.updatedAt = new Date().toISOString();
    persistChats(sessions);
    renderList();
  }

  if (sendBtn) sendBtn.addEventListener('click', () => { void sendFromChat(); });
  if (taEl) {
    taEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFromChat(); }
    });
    if (!hasToken) taEl.title = 'This window has no owner token, so it cannot ask.';
  }

  if (homeTurns) {
    try { new MutationObserver(snapshot).observe(homeTurns, { childList: true, subtree: true }); } catch { /* no observer available */ }
  }

  /* ui.js's OWN mock Home composer (sendHome, never bound to a real endpoint by
     bind/home.js) calls its own renderChatsList() on every send, which repaints
     `#chats-list` from its invented `CHATS` array — the exact mock-standing bug
     this file exists to prevent. This binder cannot reach into ui.js's closure
     to stop that call, so instead it re-asserts the REAL archive every time the
     Chats screen is shown again, which is the only moment a stomped list would
     ever be seen. */
  if (screen) {
    try {
      new MutationObserver(() => { if (screen.classList.contains('on')) renderList(); })
        .observe(screen, { attributes: true, attributeFilter: ['class'] });
    } catch { /* no observer: the list stays as of its last real render */ }
  }

  snapshot();
  renderList();
}
