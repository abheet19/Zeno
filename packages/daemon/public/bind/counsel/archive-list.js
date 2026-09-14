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
 *
 * SEARCH. A search box above the list filters saved meetings over title,
 * participants, the full transcript and the summary. The list endpoint only
 * carries title/participants/counts, so the transcript and summary come from
 * each meeting's detail — fetched once into the shared `cache` (the same Map
 * openMeetingById fills) the first time the box is used, so opening a call and
 * searching share exactly one read per meeting. A body that is not cached yet
 * still matches on its title and participants, and the list re-renders the
 * moment the bodies land so the full-text match takes over. Ids are compared
 * by value against `cache`, never through a selector — this engine ships no
 * `CSS.escape`, and a meeting id is not a safe selector anyway.
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
  let query = '';
  let warming = false;      // a body-fetch pass is in flight
  let searchWrap = null;    // built once, lives OUTSIDE cnList so typing never loses focus
  let searchInput = null;
  let countEl = null;

  /** The lower-cased haystack for one meeting: its title and participants
   *  always, plus the full transcript and every summary line once the detail
   *  record has been fetched into `cache`. Defensive about shape — a field the
   *  daemon did not send simply contributes nothing. */
  function corpusFor(m) {
    const parts = [String(m.title || ''), Array.isArray(m.participants) ? m.participants.join(' ') : ''];
    const full = cache.get(m.id);
    if (full && typeof full === 'object') {
      if (Array.isArray(full.participants)) parts.push(full.participants.join(' '));
      if (Array.isArray(full.utterances)) {
        parts.push(full.utterances.map((u) => (u && typeof u.text === 'string' ? u.text : '')).join(' '));
      }
      const s = full.summary;
      if (s && typeof s === 'object') {
        for (const key of ['decisions', 'actions', 'questions', 'keyPoints']) {
          const arr = s[key];
          if (Array.isArray(arr)) parts.push(arr.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join(' '));
        }
      }
    }
    return parts.join(' ').toLowerCase();
  }

  /** Fetch the detail (transcript + summary) for every meeting not already in
   *  `cache`, so the search covers full bodies and not just titles. Idempotent
   *  and cheap once everything is cached; re-runnable after a new call is
   *  saved. Re-renders when it finishes so the full-text match takes over. */
  async function warmBodies() {
    if (warming) return;
    const { meetings } = getState();
    const missing = meetings.filter((m) => m && m.id && !cache.has(m.id));
    if (missing.length === 0) return;
    warming = true;
    renderList(); // reflect the "indexing…" hint immediately
    try {
      await Promise.all(missing.map(async (m) => {
        const r = await getJSON(`/counsel/meetings/${encodeURIComponent(m.id)}`);
        if (r.ok && r.data && r.data.meeting) cache.set(m.id, r.data.meeting);
      }));
    } finally {
      warming = false;
      renderList();
    }
  }

  function ensureSearchBox() {
    if (searchWrap || !cnList) return;
    searchWrap = el('div', 'cn-search');
    searchWrap.style.cssText = 'margin:0 4px 6px';
    searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'cninput';
    searchInput.placeholder = 'Search meetings…';
    searchInput.setAttribute('aria-label', 'Search saved meetings by title, participants, transcript, or summary');
    countEl = el('div', 'rk');
    countEl.style.cssText = 'margin:5px 2px 0';
    countEl.hidden = true;
    searchWrap.append(searchInput, countEl);
    searchWrap.hidden = true;
    cnList.insertAdjacentElement('beforebegin', searchWrap);
    const onType = () => { query = searchInput.value; void warmBodies(); renderList(); };
    searchInput.addEventListener('input', onType);
    // Pre-warm bodies the moment the box is focused, so a query typed a beat
    // later already has the transcripts to match against.
    searchInput.addEventListener('focus', () => { void warmBodies(); });
  }

  function renderList() {
    if (!cnList) return;
    ensureSearchBox();
    const { archiveState, archiveNote, meetings, failedFiles, selectedId } = getState();

    // The search box only makes sense over a readable, non-empty archive.
    const canSearch = archiveState === 'ok' && meetings.length > 0;
    if (searchWrap) searchWrap.hidden = !canSearch;

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

    const q = query.trim().toLowerCase();
    const visible = q ? meetings.filter((m) => corpusFor(m).includes(q)) : meetings;

    // Result count (only while searching) — and an honest note when the bodies
    // are still loading, so a thin match set does not read as "no more exist".
    if (countEl) {
      if (q) {
        countEl.hidden = false;
        countEl.textContent = `${visible.length} of ${meetings.length} meetings`
          + (warming ? ' · indexing transcripts…' : '');
      } else {
        countEl.hidden = true;
      }
    }

    if (visible.length === 0) {
      const n = el('div', 'fnote', warming
        ? 'No match yet — still reading the transcripts to search inside them…'
        : `No saved meeting matches “${query.trim()}”.`);
      nodes.push(n);
      fill(cnList, ...nodes);
      return;
    }

    for (const m of visible) {
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
