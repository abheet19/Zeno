/*
 * Chats — the history of your Home conversations, kept on THIS machine only.
 *
 * Home is the one live composer (ask.js). Every conversation you have there is
 * snapshotted here as it happens, so Chats is a pure archive: the list carries
 * no composer of its own. Opening a past chat shows its transcript and lets you
 * pick it up again on Home (ask.js re-seeds the thread). "New chat" clears Home.
 *
 * Storage is localStorage, so it never leaves the device and never reaches the
 * daemon; a private window or cleared site data simply starts the history over.
 */

const KEY = 'zeno-chats-v1';
const MAX = 60;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX))); } catch { /* storage off: history is in-memory only this session */ } }
function ageStr(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = (Date.now() - t) / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}

let sessions = load();
let current = null;   // the session currently being written from Home
let openId = null;    // the session open in the transcript view

const panel = document.getElementById('chats');
const listEl = document.getElementById('chats-list');
const listView = document.getElementById('chats-list-view');
const openView = document.getElementById('chats-open');
const openTitle = document.getElementById('chats-open-title');
const transcript = document.getElementById('chats-transcript');
const searchEl = document.getElementById('chats-q');
const railCount = document.querySelector('[data-mount="rail-chats"]');

/* ---- capture: mirror the live Home thread into the current session -------- */
function readThreadTurns() {
  const thread = document.querySelector('.za-thread');
  if (!thread) return null;
  const turnEls = [...thread.querySelectorAll('.za-turn')];
  return turnEls.map((t) => {
    const role = t.classList.contains('za-user') ? 'user' : 'assistant';
    const who = t.querySelector('.za-who');
    let text = t.textContent || '';
    if (who && who.textContent) text = text.replace(who.textContent, '');
    return { role, text: clip(text.trim(), 4000) };
  }).filter((t) => t.text);
}

function snapshot() {
  const turns = readThreadTurns();
  if (turns === null) return;
  if (turns.length === 0) { current = null; return; }   // Home was cleared → next turn is a new chat
  if (!current) {
    current = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      startedAt: new Date().toISOString(),
      turns: [],
      title: '',
    };
    sessions.unshift(current);
    if (sessions.length > MAX) sessions.length = MAX;
  }
  current.turns = turns;
  const firstUser = turns.find((t) => t.role === 'user');
  current.title = clip((firstUser && firstUser.text) || 'New chat', 72);
  current.updatedAt = new Date().toISOString();
  persist();
  renderList();
}

/* ---- render: the archive list -------------------------------------------- */
function renderList() {
  if (railCount) railCount.textContent = sessions.length ? String(sessions.length) : '';
  if (!listEl) return;
  const q = (searchEl && searchEl.value ? searchEl.value : '').trim().toLowerCase();
  const rows = sessions.filter((s) => {
    if (!q) return true;
    if (s.title.toLowerCase().includes(q)) return true;
    return s.turns.some((t) => t.text.toLowerCase().includes(q));
  });
  if (!rows.length) {
    listEl.innerHTML = '<div class="chats-empty">' +
      (sessions.length
        ? 'No conversation matches “' + esc(q) + '”.'
        : 'No conversations yet. Ask Zeno anything on <b>Home</b> and it is saved here — on this machine only.') +
      '</div>';
    return;
  }
  listEl.innerHTML = rows.map((s) => {
    const n = s.turns.length;
    return '<button type="button" class="chats-row" data-chat="' + esc(s.id) + '">'
      + '<span class="chats-row-t">' + esc(s.title) + '</span>'
      + '<span class="chats-row-m">' + n + ' ' + (n === 1 ? 'message' : 'messages') + ' · ' + esc(ageStr(s.updatedAt || s.startedAt)) + '</span>'
      + '</button>';
  }).join('');
}

/* ---- render: one transcript ---------------------------------------------- */
function openChat(id) {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  openId = id;
  openTitle.textContent = s.title;
  transcript.innerHTML = s.turns.map((t) =>
    '<div class="ct-turn ct-' + t.role + '"><span class="ct-who">' + (t.role === 'user' ? 'You' : 'Zeno') + '</span>'
    + '<div class="ct-body">' + esc(t.text) + '</div></div>').join('');
  listView.hidden = true;
  openView.hidden = false;
}
function backToList() { openView.hidden = true; listView.hidden = false; openId = null; }

function goHome() { if (window.ZenoCommandPanels) window.ZenoCommandPanels.show('cmd-hero', { focus: true }); }
function newChat() {
  const clear = document.querySelector('.za-clear');
  if (clear) clear.click();            // ask.js empties the thread → snapshot ends the session
  current = null;
  goHome();
  const inp = document.querySelector('.za-input');
  if (inp) inp.focus();
}
function continueOnHome() {
  const s = sessions.find((x) => x.id === openId);
  if (!s) return;
  window.dispatchEvent(new CustomEvent('zeno:restore-chat', { detail: { turns: s.turns } }));
  current = s;                         // keep writing into this session as it continues
  backToList();
  goHome();
}

/* ---- wiring -------------------------------------------------------------- */
if (panel) {
  const thread = document.querySelector('.za-thread');
  if (thread) {
    try { new MutationObserver(snapshot).observe(thread, { childList: true, subtree: true }); } catch { /* no observer: no live capture */ }
    snapshot();
  }
  listEl?.addEventListener('click', (e) => {
    const row = e.target.closest ? e.target.closest('[data-chat]') : null;
    if (row) openChat(row.getAttribute('data-chat'));
  });
  searchEl?.addEventListener('input', renderList);
  panel.querySelector('[data-chats-back]')?.addEventListener('click', backToList);
  panel.querySelector('[data-chats-new]')?.addEventListener('click', newChat);
  panel.querySelector('[data-chats-continue]')?.addEventListener('click', continueOnHome);
  // Leaving Chats always returns to the list, so re-entering never lands mid-transcript.
  window.addEventListener('zeno:command-panel', (e) => { if (e.detail && e.detail.id !== 'chats' && openId) backToList(); });
  renderList();
}
