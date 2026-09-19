/**
 * bind/lists/work.js — WORK screen: the real backlog, the sandbox's
 * uncommitted changes, and work sources.
 *
 * Draws `.sbar` (search + 4 `.filterpill`s: All/Tickets/Sandbox/Sources)
 * above a `.card > .row-list#work-list` of `.lrow`s. See bind/lists.js for
 * the full endpoint list this binder reads (`GET /work`, `GET /forge/status`)
 * and why a WorkItem never claims a tier/status the mock invented.
 */

import { getJSON, $$, el, fill, screenEl } from '../../bind.js';
import { clip, plural, ageStr, gitWord, postJSON, toast, lrowEl, pillEl, emptyEl, loadingEl, unreadableEl, headingEl } from './shared.js';
import { forgeWorkDetail, workTransitionAction } from './work-model.js';

export async function bindWork() {
  const screen = screenEl('work');
  const listEl = document.getElementById('work-list');
  if (!screen || !listEl) return;

  const searchInput = screen.querySelector('.sbar input');
  const pillButtons = $$('.sbar .filterpill', screen);
  const FILTER_IDS = ['all', 'tickets', 'sandbox', 'sources'];

  let query = searchInput ? searchInput.value : '';
  const currentFilter = pillButtons.findIndex((btn) => btn.hasAttribute('aria-current'));
  let filter = FILTER_IDS[currentFilter] || 'all';
  let workRes = null;
  let forgeRes = null;
  const feedback = new Map();
  const pending = new Set();

  function openInForge(item) {
    const forgeBtn = document.querySelector('.seg [data-product="forge"]');
    if (forgeBtn) forgeBtn.click();
    window.dispatchEvent(new CustomEvent('zeno:work-open', { detail: forgeWorkDetail(item) }));
  }

  async function transition(item, state) {
    const action = workTransitionAction(item, state);
    if (!action || pending.has(item.id)) return;
    pending.add(item.id);
    feedback.delete(item.id);
    render();
    const result = await postJSON(action.path, { id: item.id });
    pending.delete(item.id);
    if (!result.ok) {
      feedback.set(item.id, { ok: false, text: result.error || `${action.label} failed.` });
      toast(feedback.get(item.id).text);
      render();
      return;
    }
    const changed = result.data && result.data.changed === true;
    feedback.set(item.id, {
      ok: true,
      text: action.nextState === 'closed'
        ? (changed ? 'Marked complete.' : 'Already complete.')
        : (changed ? 'Reopened.' : 'Already open.'),
    });
    toast(feedback.get(item.id).text);
    // Move the row immediately from the transition response. This makes the
    // owner's click visibly settle even if the reconciliation read is delayed.
    const current = workRes && workRes.data || {};
    const open = (Array.isArray(current.items) ? current.items : []).filter((entry) => entry.id !== item.id);
    const closed = (Array.isArray(current.closedItems) ? current.closedItems : []).filter((entry) => entry.id !== item.id);
    const moved = result.data && result.data.item || item;
    if (action.nextState === 'closed') closed.push(moved); else open.push(moved);
    const sources = (Array.isArray(current.sources) ? current.sources : []).map((source) =>
      source && source.name === 'local' ? { ...source, count: open.filter((entry) => entry.source === 'local').length } : source);
    workRes = { ...workRes, data: { ...current, items: open, closedItems: closed, sources } };
    render();
    workRes = await getJSON('/work');
    render();
    window.dispatchEvent(new CustomEvent('zeno:state', { detail: { source: 'work-transition', itemId: item.id } }));
  }

  function ticketRow(item, state) {
    const age = ageStr(item.updatedAt);
    const result = feedback.get(item.id);
    const meta = ['from ' + (item.source || 'the backlog'), age,
      Array.isArray(item.labels) && item.labels.length ? item.labels.join(', ') : null,
      result ? result.text : null]
      .filter(Boolean).join(' · ');
    const actions = el('div', null);
    actions.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap';
    const openBtn = el('button', 'laction cy', 'Open in Forge');
    openBtn.type = 'button';
    openBtn.addEventListener('click', () => openInForge(item));
    actions.appendChild(openBtn);
    const action = workTransitionAction(item, state);
    if (action) {
      const stateBtn = el('button', 'laction', pending.has(item.id) ? action.pendingLabel : action.label);
      stateBtn.type = 'button';
      stateBtn.disabled = pending.has(item.id);
      stateBtn.addEventListener('click', () => void transition(item, state));
      actions.appendChild(stateBtn);
    }
    if (result && !result.ok) actions.title = result.text;
    return lrowEl(clip(item.id || 'item', 18), clip(item.title || '(untitled)', 90), meta, actions);
  }

  function render() {
    if (!workRes) { fill(listEl, loadingEl('Reading your backlog and the workspace…')); return; }
    if (!workRes.ok) { fill(listEl, unreadableEl('Work', workRes.error)); return; }

    const data = workRes.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const closedItems = Array.isArray(data.closedItems) ? data.closedItems : [];
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const forgeData = forgeRes && forgeRes.ok ? (forgeRes.data || {}) : null;
    const changed = forgeData && Array.isArray(forgeData.changed) ? forgeData.changed : [];

    const q = query.trim().toLowerCase();
    const showTickets = filter === 'all' || filter === 'tickets';
    const showSandbox = filter === 'all' || filter === 'sandbox';
    const showSources = filter === 'all' || filter === 'sources';
    const nodes = [];

    if (showTickets) {
      const matches = (it) => {
        const hay = [it.title, it.source, Array.isArray(it.labels) ? it.labels.join(' ') : ''].join(' ').toLowerCase();
        return hay.includes(q);
      };
      const matched = q ? items.filter(matches) : items;
      const matchedClosed = q ? closedItems.filter(matches) : closedItems;
      if (items.length || closedItems.length) nodes.push(headingEl('open · ' + matched.length));
      if (items.length === 0 && closedItems.length === 0) {
        nodes.push(emptyEl('No tickets in the backlog.', 'The daemon read your backlog and it is empty.'));
      } else if (matched.length === 0 && matchedClosed.length === 0) {
        nodes.push(emptyEl('No ticket matches that.', 'The search ran over your backlog and none matched.'));
      } else {
        matched.forEach((it) => nodes.push(ticketRow(it, 'open')));
        if (closedItems.length) nodes.push(headingEl('completed · ' + matchedClosed.length));
        matchedClosed.forEach((it) => nodes.push(ticketRow(it, 'closed')));
      }
    }

    if (showSandbox) {
      if (filter === 'all') nodes.push(headingEl('workspace'));
      if (!forgeRes) {
        nodes.push(loadingEl('Reading the workspace…'));
      } else if (!forgeRes.ok) {
        nodes.push(unreadableEl('The workspace', forgeRes.error));
      } else if (forgeData && forgeData.repo === false) {
        nodes.push(emptyEl('The workspace is not a git repository.', String(forgeData.note || '')));
      } else {
        const matched = q ? changed.filter((c) => {
          const word = gitWord(c.status) || '';
          return [c.path, c.status, word].join(' ').toLowerCase().includes(q);
        }) : changed;
        if (changed.length === 0) {
          nodes.push(emptyEl('Nothing uncommitted.', 'The workspace working tree is clean.'));
        } else if (matched.length === 0) {
          nodes.push(emptyEl('No changed file matches that.', ''));
        } else {
          matched.forEach((c) => {
            const word = gitWord(c.status);
            nodes.push(lrowEl(c.status || '·', clip(c.path || '(no path reported)', 90),
              word || 'git status code ' + (c.status || '?'), null));
          });
        }
      }
    }

    if (showSources) {
      if (filter === 'all') nodes.push(headingEl('sources'));
      const matchedSources = q ? sources.filter((s) => String(s.name || '').toLowerCase().includes(q)) : sources;
      if (sources.length === 0) {
        nodes.push(emptyEl('No work source is configured.', 'Not even the local backlog answered.'));
      } else if (matchedSources.length === 0) {
        nodes.push(emptyEl('No source matches that.', ''));
      } else {
        matchedSources.forEach((s) => {
          const configured = s.state !== 'not-configured';
          const remote = s.name !== 'local';
          const stateWord = s.state === 'ok' ? 'answered in full'
            : s.state === 'partial' ? 'answered in part'
              : s.state === 'failed' ? 'did not answer' : 'never asked';
          const stateCls = s.state === 'ok' ? 'gr' : s.state === 'partial' ? 'am' : s.state === 'failed' ? 'rd' : 'wt';
          const egress = !remote ? 'stays on this machine' : (configured ? 'leaves this machine' : 'would leave this machine');
          const meta = [configured ? 'configured' : 'not configured', stateWord, egress,
            s.count == null ? null : s.count + ' ' + plural(s.count, 'item', 'items')]
            .filter(Boolean).join(' · ');
          nodes.push(lrowEl('source', s.name || 'a work source', meta, pillEl(stateWord, stateCls)));
        });
      }
    }

    if (!nodes.length) nodes.push(emptyEl('Nothing to show.', 'Try a different filter.'));
    fill(listEl, ...nodes);
  }

  // Preserve the last successful snapshot while a live/navigation refresh is
  // in flight. Repainting a loading row here made Work appear stuck even
  // though its prior data was still valid.
  if (listEl.dataset.zenoBound !== '1') render();
  const [w, f] = await Promise.all([getJSON('/work'), getJSON('/forge/status')]);
  workRes = w; forgeRes = f;
  render();
  listEl.dataset.zenoBound = '1';

  if (searchInput) {
    if (searchInput._zenoWorkInput) searchInput.removeEventListener('input', searchInput._zenoWorkInput);
    const onInput = () => { query = searchInput.value; render(); };
    searchInput._zenoWorkInput = onInput;
    searchInput.addEventListener('input', onInput);
  }
  pillButtons.forEach((btn, i) => {
    if (btn._zenoWorkClick) btn.removeEventListener('click', btn._zenoWorkClick);
    const onClick = () => { filter = FILTER_IDS[i] || 'all'; render(); };
    btn._zenoWorkClick = onClick;
    btn.addEventListener('click', onClick);
  });
}
