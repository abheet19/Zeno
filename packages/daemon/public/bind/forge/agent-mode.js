/**
 * bind/forge/agent-mode.js — Forge's chat-first AGENT layout: the sessions
 * rail on the left, the quick actions on the right, and the persistence that
 * gives the rail a past to list.
 *
 * Agent mode used to hide the explorer and editor and leave the session panel
 * in its own fixed-width grid track: a chat squeezed into a narrow column with
 * an empty workbench beside it, and no way back to yesterday's session. This
 * gives the mode a real shape (Devin/Windsurf-style): left = new session +
 * every session this device has, searchable, with its live state; centre =
 * the selected transcript, full width, composer pinned below (session.js
 * still owns all of that); right = four quick actions that each do a real
 * thing. index.html's `.ide.mode-agent .sess` rules place the columns.
 *
 * Sessions persist in this browser's localStorage (`zeno-forge-sessions`) —
 * there is still no server-side session store, and the rail says so in its
 * footer rather than implying sync. A restored session is idle: a run or a
 * plan that was in flight when the window closed is reported as interrupted,
 * never resumed silently.
 *
 * Registers `S.renderSessionsList`, `S.sessionsChanged`, `S.restoreSessions`;
 * reads `S.sessions`, `S.activeIdx`, `S.openSession`, `S.startNewSession`,
 * `S.setForgeView`, `S.renderQuickIfOpen` (explorer.js).
 */
import { $, el, fill, getJSON } from '../../bind.js';
import { add, disableCtl } from './dom.js';

const STORE_KEY = 'zeno-forge-sessions';
const MAX_STORED = 30;
const MAX_LOG_CHARS = 4_000;

function relTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** A session's one-word state, from what this window knows plus the daemon's held queue. */
function sessionState(s, heldHashes) {
  if (s.running) return { cls: 'working', tone: 'cy', word: 'Working' };
  if (s.planning) return { cls: 'working', tone: 'cy', word: 'Planning' };
  if (s.pendingHosted) return { cls: 'awaiting', tone: 'am', word: 'Waiting on you' };
  if (s.chat.some((t) => t.who === 'plan' && (t.state === 'pending' || t.state === 'editing'))) return { cls: 'awaiting', tone: 'am', word: 'Plan waiting' };
  const held = (s.lastProposed || []).filter((p) => p && heldHashes.has(p.actionHash)).length;
  if (held > 0) return { cls: 'awaiting', tone: 'am', word: `${held} held` };
  const last = s.runs[s.runs.length - 1];
  if (last && last.ok === false) return { cls: 'failed', tone: 'rd', word: last.cancelled ? 'Cancelled' : 'Failed' };
  if (last && (s.lastProposed || []).length > 0) return { cls: 'done', tone: 'gr', word: 'Settled' };
  if (last) return { cls: 'done', tone: 'wt', word: 'No changes' };
  return { cls: '', tone: 'wt', word: s.chat.length ? 'Idle' : 'New' };
}

export function setupAgentMode(S) {
  const rail = $('#ag-rail', S.ide);
  const list = $('#ag-list', S.ide);
  const search = $('#ag-search', S.ide);
  const quick = $('#ag-quick', S.ide);

  // ---- persistence -------------------------------------------------------
  function serialize(s) {
    return {
      id: s.id, title: s.title, workItemId: s.workItemId, createdAt: s.createdAt, updatedAt: s.updatedAt,
      agentId: s.agentId, model: s.model, effort: s.effort, autoRoute: s.autoRoute, memoryEnabled: s.memoryEnabled,
      runs: s.runs, lastProposed: s.lastProposed,
      chat: s.chat.map((t) => (typeof t.log === 'string' && t.log.length > MAX_LOG_CHARS ? { ...t, log: `${t.log.slice(0, MAX_LOG_CHARS)}\n…[log clipped for local history]` } : t)),
      // In-flight states do not survive a closed window; say so on restore.
      interrupted: s.running || s.planning,
    };
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S.sessions.slice(-MAX_STORED).map(serialize))); } catch { /* private window or quota — history is a convenience */ }
  }
  S.restoreSessions = function restoreSessions(makeSession) {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { raw = null; }
    if (!Array.isArray(raw)) return 0;
    for (const r of raw) {
      if (!r || typeof r !== 'object' || !Array.isArray(r.chat)) continue;
      const s = makeSession();
      Object.assign(s, {
        title: typeof r.title === 'string' ? r.title : null,
        workItemId: typeof r.workItemId === 'string' ? r.workItemId : null,
        createdAt: Number(r.createdAt) || Date.now(), updatedAt: Number(r.updatedAt) || Date.now(),
        agentId: r.agentId || 'local', model: r.model || '', effort: r.effort || 'medium',
        autoRoute: r.autoRoute !== false, memoryEnabled: r.memoryEnabled !== false,
        runs: Array.isArray(r.runs) ? r.runs : [], lastProposed: Array.isArray(r.lastProposed) ? r.lastProposed : [],
        chat: r.chat.filter((t) => t && typeof t === 'object'),
      });
      for (const t of s.chat) if (t.who === 'plan' && t.state === 'planning') { t.state = 'failed'; t.error = 'the window was closed while planning.'; }
      if (r.interrupted) s.chat.push({ who: 'system', text: 'This window was closed while the session was working; whatever the run had proposed is in Command → Approvals, and nothing was resumed.' });
      S.sessions.push(s);
    }
    return S.sessions.length;
  };

  // ---- the rail ----------------------------------------------------------
  let heldHashes = new Set();
  let lastHeldFetch = 0;
  async function refreshHeld() {
    if (Date.now() - lastHeldFetch < 2_000) return;
    lastHeldFetch = Date.now();
    const st = await getJSON('/state');
    if (st.ok && Array.isArray(st.data?.pending)) {
      heldHashes = new Set(st.data.pending.map((p) => p.actionHash));
      paintList();
    }
  }
  function paintList() {
    if (!list) return;
    const q = (search && search.value || '').trim().toLowerCase();
    const rows = [];
    S.sessions.forEach((s, i) => {
      const title = s.title || 'New session';
      if (q && !title.toLowerCase().includes(q) && !String(s.workItemId || '').toLowerCase().includes(q) && !s.chat.some((t) => typeof t.text === 'string' && t.text.toLowerCase().includes(q))) return;
      const st = sessionState(s, heldHashes);
      const b = el('button', 'dvsess');
      b.type = 'button';
      b.dataset.agOpen = String(i);
      b.classList.toggle('on', i === S.activeIdx);
      const dvst = el('span', 'dvst');
      add(dvst, el('b', null, title), el('span', null, `${s.workItemId ? `${s.workItemId} · ` : ''}${relTime(s.updatedAt || s.createdAt)} · ${s.runs.length} run${s.runs.length === 1 ? '' : 's'}`));
      const pill = el('span', `pill ${st.tone} ag-state`, st.word);
      add(b, el('span', `dvdot ${st.cls}`), dvst, pill);
      b.addEventListener('click', () => S.openSession(i));
      rows.push(b);
    });
    rows.reverse(); // newest first
    if (!rows.length) rows.push(el('div', 'fnote', q ? 'No session matches that search.' : 'No sessions on this device yet. Start one above.'));
    fill(list, ...rows);
  }
  function renderSessionsList() {
    paintList();
    void refreshHeld();
    if (quick) paintQuick();
  }
  S.renderSessionsList = renderSessionsList;
  /** session.js calls this on every session state change: persist + repaint. */
  S.sessionsChanged = function sessionsChanged(session) {
    if (session) session.updatedAt = Date.now();
    persist();
    renderSessionsList();
  };
  if (search) search.addEventListener('input', paintList);
  const newBtn = $('#ag-new', S.ide);
  if (newBtn) newBtn.addEventListener('click', () => S.startNewSession());

  // Rail links: real navigation only. Scheduled tasks live in Forge's own
  // ZENO sidebar view (Editor mode); Approvals and Customize are Command screens
  // and use the app's own data-product-go handler (ui.js).
  const autoLink = $('[data-ag-link="automations"]', S.ide);
  if (autoLink) autoLink.addEventListener('click', () => {
    S.setForgeView('editor');
    const zeno = document.querySelector('.vsact [data-vsview="zeno"]');
    if (zeno) zeno.click();
  });

  // ---- quick actions -----------------------------------------------------
  function paintQuick() {
    const diffs = $('#aq-diffs', S.ide);
    if (!diffs) return;
    const n = heldHashes.size;
    diffs.textContent = `View diffs (${n} held change${n === 1 ? '' : 's'})`;
    if (n === 0) disableCtl(diffs, 'No held changes to review — a run’s proposals appear here once it has made some.');
    else { diffs.disabled = false; diffs.style.opacity = ''; diffs.style.cursor = ''; diffs.title = 'Open Command → Approvals, where the real diffs live.'; }
  }
  const aqNew = $('#aq-new', S.ide);
  if (aqNew) aqNew.addEventListener('click', () => S.startNewSession());
  const aqOpen = $('#aq-open', S.ide);
  if (aqOpen) aqOpen.addEventListener('click', () => {
    // The file opens in the editor, so show the editor first — otherwise the
    // pick lands in a pane that is display:none.
    S.setForgeView('editor');
    const q = $('#quick', S.ide); const qi = $('#quick-in', S.ide);
    if (q) q.hidden = false;
    if (qi) { qi.value = ''; qi.focus(); }
    if (S.renderQuickIfOpen) S.renderQuickIfOpen();
  });
  document.addEventListener('keydown', (e) => {
    // Ctrl+P in Agent mode: same as the quick action (the editor's own binding
    // only exists while the editor is on screen).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p' && S.ide && S.ide.classList.contains('mode-agent') && S.ide.offsetParent !== null) {
      e.preventDefault();
      if (aqOpen) aqOpen.click();
    }
  });
  // "View diffs" and "Open customizations" carry data-product-go/data-then in
  // the markup, so ui.js's own product-switch handler navigates them — the
  // same path every other cross-product link in the app takes.
  if (rail) renderSessionsList();
}
