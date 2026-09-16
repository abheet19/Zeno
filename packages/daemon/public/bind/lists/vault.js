/**
 * bind/lists/vault.js — VAULT screen: real memory (recent notes, real
 * recall, proposed memories awaiting owner approval) and today's brief.
 *
 * Draws `.sbar` (search only) above a `#import-card` (a local-file import
 * preview) and a second
 * `.card > .row-list` of `.lrow`s. See bind/lists.js for the full endpoint
 * list this binder reads (`GET /memory`, `GET /memory?q=`, `GET
 * /memory/pending`, `POST /memory/approvals`, `GET /brief`).
 */

import { getJSON, $$, el, fill, token, screenEl } from '../../bind.js';
import { clip, ageStr, toast, postJSON, lrowEl, headingEl, noteEl, emptyEl, loadingEl, unreadableEl } from './shared.js';

export async function bindVault() {
  const screen = screenEl('vault');
  if (!screen) return;

  const importCard = document.getElementById('import-card');

  const cards = $$('.card', screen);
  const listCard = cards.find((c) => c !== importCard && !c.hasAttribute('data-brief-card'));
  const rowList = listCard ? listCard.querySelector('.row-list') : null;
  const searchInput = screen.querySelector('.sbar input');
  if (!rowList) return;
  // The import preview also uses `.row-list`; give the authoritative note list
  // a stable semantic hook so tests and assistive integrations cannot confuse
  // a hidden preview with the owner’s actual stored memory.
  rowList.setAttribute('data-vault-notes', '');

  /* live.js re-runs this binder on every stream event, so it has to be
     idempotent — and it was not. Each run started with an empty `query` while
     the search box still held the owner's words, so a note written anywhere
     silently threw their search away and redrew the full list underneath an
     input that said otherwise. Read the box instead of assuming it is empty. */
  let query = searchInput ? searchInput.value : '';
  let notesRes = null;
  let hitsRes = null;
  let pendingRes = null;
  let searchTimer = null;
  // Every bind/search owns a monotonically increasing generation. A slower
  // recall for an older query may finish after a newer one; only the current
  // generation is allowed to paint the list.
  let generation = Number(rowList.dataset.zenoVaultGeneration || 0) + 1;
  rowList.dataset.zenoVaultGeneration = String(generation);

  function noteRow(n, score, matched) {
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const meta = [
      n.source ? 'source ' + n.source : null,
      ageStr(n.updatedAt || n.createdAt),
      tags.length ? tags.join(', ') : null,
      score != null ? 'score ' + score : null,
      Array.isArray(matched) && matched.length ? 'matched: ' + matched.join(', ') : null,
    ].filter(Boolean).join(' · ');
    return lrowEl('memory', clip(n.title || n.id || '(untitled note)', 90), meta, null);
  }

  async function approvePending(actionHash, btn) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Approving…';
    const res = await postJSON('/memory/approvals', { actionHash });
    if (res.ok) {
      toast('Memory approved and sealed.');
      pendingRes = await getJSON('/memory/pending');
      notesRes = await getJSON('/memory');
      render();
    } else {
      btn.disabled = false;
      btn.textContent = original;
      toast('Could not approve: ' + res.error);
    }
  }

  function render() {
    const nodes = [];

    if (pendingRes && pendingRes.ok) {
      const pending = Array.isArray(pendingRes.data && pendingRes.data.pending) ? pendingRes.data.pending : [];
      if (pending.length) {
        nodes.push(headingEl('proposed memories · ' + pending.length));
        nodes.push(noteEl('An agent asked to remember these. Nothing is written until the owner approves it — '
          + 'an agent can propose but never approve its own memory.'));
        pending.forEach((p) => {
          const pv = (p && p.preview) || {};
          const pl = (p && p.payload) || {};
          const meta = ['from ' + (pl.source || 'an agent'), 'tier ' + (pv.tier || '?'),
            Array.isArray(pl.tags) && pl.tags.length ? 'tags: ' + pl.tags.join(', ') : null]
            .filter(Boolean).join(' · ');
          let action = null;
          if (pv.actionHash && token()) {
            action = el('button', 'laction cy', 'Approve');
            action.type = 'button';
            action.addEventListener('click', () => approvePending(pv.actionHash, action));
          }
          nodes.push(lrowEl('proposed', clip(pl.description || pl.body || '(proposed memory)', 90), meta, action));
        });
      }
    }

    if (query.trim()) {
      if (!hitsRes) {
        nodes.push(loadingEl('Recalling…'));
      } else if (!hitsRes.ok) {
        nodes.push(unreadableEl('Recall', hitsRes.error));
      } else {
        const hits = Array.isArray(hitsRes.data && hitsRes.data.hits) ? hitsRes.data.hits : [];
        nodes.push(headingEl('results · ' + hits.length));
        if (hits.length) hits.forEach((h) => nodes.push(noteRow(h.note || {}, h.score, h.matched)));
        else nodes.push(emptyEl('No note matched that.', 'The search ran and came back with nothing.'));
      }
    } else if (!notesRes) {
      nodes.push(loadingEl('Reading your memory…'));
    } else if (!notesRes.ok) {
      nodes.push(unreadableEl('Memory', notesRes.error));
    } else {
      const notes = Array.isArray(notesRes.data && notesRes.data.notes) ? notesRes.data.notes : [];
      if (notes.length) {
        nodes.push(headingEl('recent notes · ' + notes.length));
        notes.forEach((n) => nodes.push(noteRow(n)));
      } else {
        nodes.push(emptyEl('Your memory is empty.', 'The vault was read and holds no notes yet.'));
      }
    }

    if (!nodes.length) nodes.push(emptyEl('Nothing to show.', ''));
    fill(rowList, ...nodes);
  }

  /* The daemon owns sanitization and persistence. This browser-only control
     merely parses a user-selected local file, previews its shape, and makes
     one explicit owner request. It never uploads a file or reads a path. */
  bindImportCard(importCard, async () => {
    notesRes = await getJSON('/memory');
    pendingRes = await getJSON('/memory/pending');
    render();
  });

  // A live/navigation refresh must not replace already-rendered memory with a
  // transient loading row. Keep the last successful snapshot visible until
  // the new read lands; this also avoids a noticeable flash on slower disks.
  if (rowList.dataset.zenoBound !== '1') render();
  const reads = [getJSON('/memory'), getJSON('/memory/pending')];
  // A re-run while a search is open must re-run the SEARCH, not quietly fall
  // back to the full list.
  if (query.trim()) reads.push(getJSON('/memory?q=' + encodeURIComponent(query.trim())));
  const initialGeneration = generation;
  const [notes, pending, hits] = await Promise.all(reads);
  if (Number(rowList.dataset.zenoVaultGeneration) !== initialGeneration) return;
  notesRes = notes; pendingRes = pending; hitsRes = hits ?? null;
  render();
  rowList.dataset.zenoBound = '1';

  if (searchInput) {
    /* One listener, not one per stream event. Every re-run used to add another,
       each closed over ITS OWN stale `notesRes`, so after a few events a single
       keystroke fired several fetches and the last render to land could be the
       one holding the oldest data. Drop the previous handler before adding
       this one — and the previous debounce with it, or a timer from the old
       closure lands after the rebind and repaints stale rows. */
    if (searchInput._zenoVaultInput) searchInput.removeEventListener('input', searchInput._zenoVaultInput);
    clearTimeout(searchInput._zenoVaultTimer);
    const onInput = () => {
      generation += 1;
      rowList.dataset.zenoVaultGeneration = String(generation);
      const requestGeneration = generation;
      query = searchInput.value;
      const q = query.trim();
      if (!q) { hitsRes = null; render(); return; }
      render();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const next = await getJSON('/memory?q=' + encodeURIComponent(q));
        if (Number(rowList.dataset.zenoVaultGeneration) !== requestGeneration || searchInput.value.trim() !== q) return;
        hitsRes = next;
        render();
      }, 300);
      searchInput._zenoVaultTimer = searchTimer;
    };
    searchInput._zenoVaultInput = onInput;
    searchInput.addEventListener('input', onInput);
  }

  bindBrief(screen);
}

/**
 * Render the real local-memory importer. JSON accepts either an array or an
 * object containing `notes`; text/Markdown becomes one note. This deliberately
 * does not pretend to parse proprietary Claude or Codex export schemas: users
 * can inspect the local preview and the server reports imported/skipped/redacted
 * counts after applying the same sanitizer used for every memory write.
 */
function bindImportCard(card, onImported) {
  if (!card) return;
  const wrap = el('div', null);
  wrap.appendChild(headingEl('import local memory'));
  wrap.appendChild(noteEl('Choose a local JSON, Markdown, or text file. Nothing leaves this device. JSON may be '
    + 'an array of notes or an object with a `notes` array; each note may contain title or description, body, tags, and kind.'));

  const input = el('input', null);
  input.type = 'file';
  input.accept = '.json,.md,.txt,application/json,text/plain,text/markdown';
  input.setAttribute('aria-label', 'Choose a local memory export');
  input.style.marginTop = '10px';
  const status = el('div', 'mm', 'No file selected.');
  status.style.marginTop = '8px';
  const preview = el('div', 'row-list');
  preview.style.marginTop = '8px';
  const actions = el('div', null);
  actions.style.cssText = 'display:flex;gap:9px;margin-top:12px;flex-wrap:wrap';
  const commit = el('button', 'btn p sm', 'Import locally');
  commit.type = 'button';
  commit.disabled = true;
  const close = el('button', 'btn g sm', 'Close');
  close.type = 'button';
  actions.append(commit, close);
  wrap.append(input, status, preview, actions);
  fill(card, wrap);

  let notes = null;
  const clear = (message) => {
    notes = null;
    commit.disabled = true;
    status.textContent = message;
    fill(preview);
  };
  close.addEventListener('click', () => { card.hidden = true; });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return clear('No file selected.');
    if (file.size > 2 * 1024 * 1024) return clear('Choose a file smaller than 2 MB.');
    try {
      const text = await file.text();
      let candidate;
      if (/\.json$/i.test(file.name) || /^\s*[\[{]/.test(text)) {
        const parsed = JSON.parse(text);
        candidate = Array.isArray(parsed) ? parsed : parsed && parsed.notes;
        if (!Array.isArray(candidate)) throw new Error('JSON needs a notes array.');
      } else {
        candidate = [{ title: file.name.replace(/\.[^.]+$/, '') || 'Imported note', body: text, kind: 'fact' }];
      }
      const valid = candidate.filter((note) => note && typeof note === 'object').slice(0, 500);
      if (!valid.length) throw new Error('No note objects were found.');
      notes = valid;
      status.textContent = `${notes.length} local note${notes.length === 1 ? '' : 's'} ready. The server will sanitize and report every result.`;
      fill(preview, ...notes.slice(0, 5).map((note) => lrowEl('import', clip(note.title || note.description || '(untitled note)', 90), 'local preview · not imported yet', null)));
      if (notes.length > 5) preview.appendChild(noteEl(`${notes.length - 5} additional note${notes.length === 6 ? '' : 's'} not shown in this preview.`));
      commit.disabled = false;
    } catch (err) {
      clear(`Could not read that file: ${err && err.message ? err.message : 'invalid content'}`);
    }
  });
  commit.addEventListener('click', async () => {
    if (!notes) return;
    commit.disabled = true;
    status.textContent = 'Importing locally…';
    const result = await postJSON('/memory/import', { notes });
    if (!result.ok) {
      commit.disabled = false;
      status.textContent = `Import did not run: ${result.error}`;
      return;
    }
    const data = result.data || {};
    status.textContent = `Imported ${data.imported || 0}; skipped ${data.skipped || 0}; redacted ${data.redacted || 0}.`;
    fill(preview);
    notes = null;
    await onImported();
    toast(status.textContent);
  });
}

async function bindBrief(screen) {
  const pbody = screen.querySelector('.pbody');
  if (!pbody) return;
  /* Reuse the card if this binder has already built one. It appended a new one
     on every call, and live.js re-runs it on every stream event — so a window
     left open through a few approvals grew a stack of identical briefs, each
     one a separate read of /brief. The marker is on the element rather than a
     module flag because the screen can be rebuilt underneath us. */
  let card = pbody.querySelector('[data-brief-card]');
  let body;
  if (card) {
    body = card.querySelector('[data-brief-body]');
  } else {
    card = el('div', 'card');
    card.setAttribute('data-brief-card', '');
    card.style.marginTop = '16px';
    body = el('div', null);
    body.setAttribute('data-brief-body', '');
    card.appendChild(headingEl('today’s brief'));
    card.appendChild(body);
    pbody.appendChild(card);
  }
  if (!body) return;
  fill(body, loadingEl('Reading the brief…'));

  const res = await getJSON('/brief');
  if (!res.ok) { fill(body, unreadableEl('The brief', res.error)); return; }

  const b = (res.data && res.data.brief) || {};
  const sources = Array.isArray(b.sources) ? b.sources : [];
  const missing = Array.isArray(b.missing) ? b.missing : [];
  const items = [];
  sources.forEach((s) => {
    (Array.isArray(s.items) ? s.items : []).forEach((i) => items.push({ text: i.text, source: i.source || s.name, age: i.age }));
  });

  const nodes = [];
  nodes.push(noteEl((b.status === 'complete' ? 'Complete — every source answered.' : 'Partial — at least one source could not be reached.')
    + (b.at ? ' Built ' + (ageStr(b.at) || String(b.at)) + '.' : '')));
  if (items.length) items.forEach((i) => nodes.push(lrowEl('brief', clip(i.text || '', 110), [i.source, i.age].filter(Boolean).join(' · '), null)));
  else nodes.push(emptyEl('The brief has nothing in it.', 'Every source answered and none had anything to report.'));
  if (missing.length) nodes.push(emptyEl(missing.length + ' source(s) could not be reached:', missing.join(', ')));
  fill(body, ...nodes);
}
