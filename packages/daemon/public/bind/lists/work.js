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
import { clip, plural, ageStr, gitWord, lrowEl, pillEl, emptyEl, loadingEl, unreadableEl, headingEl } from './shared.js';

export async function bindWork() {
  const screen = screenEl('work');
  const listEl = document.getElementById('work-list');
  if (!screen || !listEl) return;

  const searchInput = screen.querySelector('.sbar input');
  const pillButtons = $$('.sbar .filterpill', screen);
  const FILTER_IDS = ['all', 'tickets', 'sandbox', 'sources'];

  let query = '';
  let filter = 'all';
  let workRes = null;
  let forgeRes = null;

  function render() {
    if (!workRes) { fill(listEl, loadingEl('Reading your backlog and the sandbox…')); return; }
    if (!workRes.ok) { fill(listEl, unreadableEl('Work', workRes.error)); return; }

    const data = workRes.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const forgeData = forgeRes && forgeRes.ok ? (forgeRes.data || {}) : null;
    const changed = forgeData && Array.isArray(forgeData.changed) ? forgeData.changed : [];

    const q = query.trim().toLowerCase();
    const showTickets = filter === 'all' || filter === 'tickets';
    const showSandbox = filter === 'all' || filter === 'sandbox';
    const showSources = filter === 'all' || filter === 'sources';
    const nodes = [];

    if (showTickets) {
      const matched = q ? items.filter((it) => {
        const hay = [it.title, it.source, Array.isArray(it.labels) ? it.labels.join(' ') : ''].join(' ').toLowerCase();
        return hay.includes(q);
      }) : items;
      if (filter === 'all' && items.length) nodes.push(headingEl('tickets · ' + matched.length));
      if (items.length === 0) {
        nodes.push(emptyEl('No tickets in the backlog.', 'The daemon read your backlog and it is empty.'));
      } else if (matched.length === 0) {
        nodes.push(emptyEl('No ticket matches that.', 'The search ran over your backlog and none matched.'));
      } else {
        matched.forEach((it) => {
          const age = ageStr(it.updatedAt);
          const meta = ['from ' + (it.source || 'the backlog'), age,
            Array.isArray(it.labels) && it.labels.length ? it.labels.join(', ') : null]
            .filter(Boolean).join(' · ');
          const openBtn = el('button', 'laction cy', 'Open in Forge');
          openBtn.type = 'button';
          openBtn.setAttribute('data-product-go', 'forge');
          nodes.push(lrowEl(clip(it.id || 'item', 18), clip(it.title || '(untitled)', 90), meta, openBtn));
        });
      }
    }

    if (showSandbox) {
      if (filter === 'all') nodes.push(headingEl('sandbox'));
      if (!forgeRes) {
        nodes.push(loadingEl('Reading the sandbox…'));
      } else if (!forgeRes.ok) {
        nodes.push(unreadableEl('The sandbox', forgeRes.error));
      } else if (forgeData && forgeData.repo === false) {
        nodes.push(emptyEl('The sandbox is not a git repository.', String(forgeData.note || '')));
      } else {
        const matched = q ? changed.filter((c) => {
          const word = gitWord(c.status) || '';
          return [c.path, c.status, word].join(' ').toLowerCase().includes(q);
        }) : changed;
        if (changed.length === 0) {
          nodes.push(emptyEl('Nothing uncommitted.', 'The sandbox working tree is clean.'));
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

  render();
  const [w, f] = await Promise.all([getJSON('/work'), getJSON('/forge/status')]);
  workRes = w; forgeRes = f;
  render();

  if (searchInput) searchInput.addEventListener('input', () => { query = searchInput.value; render(); });
  pillButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => { filter = FILTER_IDS[i] || 'all'; render(); });
  });
}
