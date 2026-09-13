/**
 * bind/counsel/archive-list.js — the left-hand archive list (#cn-list) and
 * opening one saved call into the post view. Both read the archive state
 * bind/counsel.js's `loadArchive()` (kept there — extracted by name by the
 * desktop test, see that file's header) maintains, through `deps.getState`,
 * which is a live read of those same `let` bindings, never a copy.
 *
 * `openMeetingById` used to stash the fetched record in a shared `openMeeting`
 * variable that `renderPost(null)` then read back out. Since the write and
 * the read here always happen back-to-back with no intervening await, that
 * round trip was equivalent to just handing `renderPost` the record directly
 * — which is what this version does, so there is no `openMeeting` state left
 * to share at all (only `selectedId` is a genuine race-guard: the check after
 * the fetch below tests whether some OTHER call moved on while this one
 * awaited, so it stays a live `let` in bind/counsel.js, read through
 * `getState()` each time).
 */
import { el, fill, getJSON } from '../../bind.js';
import { fmtDate, fmtMinutes } from './format.js';

/**
 * @param {object} deps
 * @param {Element|null} deps.cnList
 * @param {Map<string, object>} deps.cache
 * @param {() => Promise<void>} deps.retryLoad
 * @param {(name: string) => void} deps.showCnView
 * @param {(state: 'loading'|string|object) => void} deps.renderPost
 * @param {() => {archiveState:string, archiveNote:string, meetings:object[], failedFiles:object[], selectedId:string|null}} deps.getState
 * @param {(id: string|null) => void} deps.setSelectedId
 */
export function makeArchiveList({ cnList, cache, retryLoad, showCnView, renderPost, getState, setSelectedId }) {
  function renderList() {
    if (!cnList) return;
    const { archiveState, archiveNote, meetings, failedFiles, selectedId } = getState();
    if (archiveState === 'loading') {
      fill(cnList, el('p', null, 'Reading the archive…'));
      return;
    }
    if (archiveState === 'error') {
      const note = el('p', null, archiveNote || 'The archive could not be read.');
      note.style.cssText = 'font-size:12px;color:var(--red);padding:6px';
      const retry = el('button', 'laction', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { void retryLoad(); });
      fill(cnList, note, retry);
      return;
    }
    const nodes = [];
    for (const f of failedFiles) {
      const n = el('p', null, `Unreadable meeting file: ${f.id} — ${f.reason}`);
      n.style.cssText = 'font-size:11px;color:var(--red);padding:4px 6px';
      nodes.push(n);
    }
    if (meetings.length === 0) {
      const n = el('p', null, 'No calls recorded yet. A finished call is saved here as one Markdown file.');
      n.style.cssText = 'font-size:12px;color:var(--ink-3);padding:6px';
      nodes.push(n);
      fill(cnList, ...nodes);
      return;
    }
    for (const m of meetings) {
      const row = el('button', 'cnrow');
      row.type = 'button';
      row.setAttribute('aria-current', String(selectedId === m.id));
      const c = m.counts || {};
      const bits = [`${c.lines || 0} lines`];
      if (c.decisions) bits.push(`${c.decisions} decisions`);
      if (c.actions) bits.push(`${c.actions} actions`);
      const durMs = Number.isFinite(Date.parse(m.endedAt)) && Number.isFinite(Date.parse(m.startedAt))
        ? new Date(m.endedAt) - new Date(m.startedAt) : null;
      const meta = `${fmtDate(m.startedAt)}${durMs != null ? ' · ' + fmtMinutes(durMs) : ''} · ${bits.join(' · ')}`;
      row.append(el('b', null, m.title || '(untitled call)'), el('span', null, meta));
      row.addEventListener('click', () => { void openMeetingById(m.id); });
      nodes.push(row);
    }
    fill(cnList, ...nodes);
  }

  async function openMeetingById(id) {
    setSelectedId(id);
    renderList();
    showCnView('post');
    if (cache.has(id)) {
      renderPost(cache.get(id));
      return;
    }
    renderPost('loading');
    const r = await getJSON(`/counsel/meetings/${encodeURIComponent(id)}`);
    if (getState().selectedId !== id) return; // moved on already
    if (r.ok && r.data && r.data.meeting) {
      cache.set(id, r.data.meeting);
      renderPost(r.data.meeting);
    } else {
      renderPost(r.error || 'That call could not be opened.');
    }
  }

  return { renderList, openMeetingById };
}
