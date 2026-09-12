/**
 * bind/lists.js — Command → Work, Vault, Integrations and Chats screens,
 * wired to real daemon data (and, for Chats, to this browser's own archive
 * of the Home conversation).
 *
 * The artifact (index.html) draws these four screens as:
 *   Work           `.sbar` (search + 4 `.filterpill`s: All/Tickets/Sandbox/
 *                  Sources) above a `.card > .row-list#work-list` of `.lrow`s.
 *   Vault          `.sbar` (search only) above a `#import-card` (the mock
 *                  "import preview") and a second `.card > .row-list` of
 *                  `.lrow`s.
 *   Integrations   a `.live-cards` of `.lcard`s (`.lk`/`.lm`/`.lr`) — NOT the
 *                  `.lrow` shape the other screens use.
 *   Chats          `.sbar` (search) above `#chats-list-view` (a
 *                  `.row-list#chats-list` of rows) and `#chats-open-view`
 *                  (`#chats-title`, `#chats-turns`, and its own composer:
 *                  `#chats-ta` / `#chats-send` / `#chats-back`).
 *
 * ui.js already wires generic chrome that is safe to leave alone: filterpill
 * `aria-current` highlighting, `[data-product-go]` (the real Command<->Forge
 * switch), `[data-screen-jump]` (the real screen switch — Work's "+ New task"
 * already does the right thing by jumping to Home), `[data-import]` /
 * `[data-import-cancel]` (show/hide `#import-card`), and `#chats-back`'s
 * view toggle. None of that is touched here. What ui.js also ships, and this
 * file replaces, is invented content: three demo `CHATS` conversations, a
 * canned `zenoReply()` for every composer, and the mock rows already sitting
 * in `#work-list`, the Vault notes card, `#import-card` and `.live-cards`.
 *
 * Screen lookup always goes through bind.js's `screenEl()`, never a bare
 * `[data-screen="…"]` — the left rail's nav button carries the same
 * attribute and sits earlier in the document, so a bare query would find the
 * button, not the section.
 *
 * Endpoints, confirmed against packages/daemon/src/server.ts and the ports
 * behind them (work.ts's WorkItem/SourceReport, vault/note.ts's Note,
 * memory-routes.ts's pending queue):
 *   GET  /work            -> { items: WorkItem[], sources: SourceReport[] }
 *   GET  /forge/status     -> { repo:false, note } | { repo:true, branch, head,
 *                              changed:[{status,path}], log, trackedTotal, … }
 *   GET  /forge/agents     -> { agents:[{id,label,available,…}], localModels }
 *   GET  /skills           -> { skills:[{id,name,description,bytes,verdict}], failed }
 *   GET  /memory           -> { notes: Note[] } | 404 { error:{code:'no-vault'} }
 *   GET  /memory?q=…       -> { query, hits:[{note,score,matched}] }
 *   GET  /memory/pending   -> { pending:[{preview:{actionHash,tier},payload}] }
 *   POST /memory/approvals -> { actionHash } -> { approval, receipt, entry }
 *   GET  /brief            -> { brief:{status,at,sources:[{name,items}],missing} }
 *   POST /assistant/ask    -> { question } -> { answer } | { flagged } | { note } | { error }
 *
 * A WorkItem carries NO tier/status field (packages/intake/src/work-item.ts),
 * so ticket rows never claim a "T2 · owner: you" the mock invented — only
 * id, title, source, age and labels, all real.
 *
 * Chats stores its archive in `localStorage['zeno-chats']` — the same key
 * bind.js's rail-badge counter already reads (`Array.isArray(arr).length`),
 * so the two agree without either reaching into the other. Turns are
 * snapshotted from Home's own live thread (`#home-turns .turn.you|.z .bt`,
 * ui.js's own markup) rather than invented, and the composer inside an
 * opened chat calls the same real `/assistant/ask` Home uses (see ask.js) —
 * never a canned reply.
 */

import { getJSON, $, $$, el, fill, setText, authHeaders, token, screenEl } from '../bind.js';

/* ---------------------------------------------------------------------- *
 * shared helpers — formatting, small DOM builders, a POST with the same
 * never-throw contract as bind.js's getJSON, and a toast borrowed from the
 * `#toast` element/CSS ui.js already ships (never its closure).
 * ---------------------------------------------------------------------- */

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function plural(n, one, many) { return n === 1 ? one : many; }

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = (Date.now() - t) / 60000;
  return m < 0 ? 0 : m;
}
function ageStr(iso) {
  const m = minutesSince(iso);
  if (m == null) return null;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}

/* git's porcelain XY code, said in words. Anything unrecognised keeps its
   raw code rather than guessing at a word for it. */
function gitWord(code) {
  const c = String(code || '').trim();
  const map = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged',
    '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified twice',
  };
  return map[c] || null;
}

async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      cache: 'no-store',
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errObj = data && typeof data === 'object' ? data.error : null;
      const msg = (errObj && errObj.message) || `${path} answered ${res.status}`;
      const resolve = errObj && errObj.resolve;
      return { ok: false, status: res.status, data, error: resolve ? `${msg} ${resolve}` : msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${err && err.message}` };
  }
}

/** Same tiny toast ui.js defines, kept local so this file never reaches into
 *  ui.js's closure — it only reuses the `#toast` element/CSS ui.js ships. */
function toast(msg) {
  try {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._zenoListsTimer);
    t._zenoListsTimer = setTimeout(() => t.classList.remove('on'), 2400);
  } catch { /* a toast is a nicety, never worth failing over */ }
}

/** The artifact's `.lrow`: a `.tier` badge, a title/meta block, and an
 *  optional right-side pill or action. Callers pass plain text only — never
 *  markup — so every field goes through textContent. */
function lrowEl(tierText, title, meta, right) {
  const row = el('div', 'lrow');
  row.appendChild(el('span', 'tier', tierText || ''));
  const mid = el('div', null);
  mid.appendChild(el('div', 'tt', title || ''));
  if (meta) mid.appendChild(el('div', 'mm', meta));
  row.appendChild(mid);
  if (right) row.appendChild(right);
  return row;
}

/** The artifact's `.pill`, coloured (gr/am/rd/cy) or neutral (wt). */
function pillEl(text, cls) {
  const span = el('span', 'pill' + (cls ? ' ' + cls : ''));
  span.appendChild(el('span', 'd'));
  span.appendChild(document.createTextNode(text));
  return span;
}

/** The artifact's `.empty`: a dashed box, a bold headline, then the rest. */
function emptyEl(strong, rest) {
  const d = el('div', 'empty');
  d.appendChild(el('b', null, strong));
  if (rest) d.appendChild(document.createTextNode(' ' + rest));
  return d;
}
function loadingEl(text) { return el('div', 'empty', text); }
function unreadableEl(what, err) {
  return emptyEl(what + ' could not be read.', (err ? String(err) + ' ' : '') + 'This is a failure to read, not an absence.');
}

/** A small muted section label — inline-styled (matching this codebase's own
 *  convention of inline layout tweaks in the markup) rather than a class the
 *  artifact's stylesheet never defined, so no new CSS rule is introduced. */
function headingEl(text) {
  const d = el('div', null, text);
  d.style.cssText = 'font:600 10px/1.4 var(--font-mono,ui-monospace,Consolas,monospace);'
    + 'letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#6C7480);margin:12px 2px 4px';
  return d;
}
function noteEl(text) {
  const p = el('p', null, text);
  p.style.cssText = 'font-size:11px;line-height:1.5;color:var(--ink-2,#9AA1AC);margin:6px 2px 0';
  return p;
}

/* ======================================================================
 * WORK — the real backlog, the sandbox's uncommitted changes, and sources
 * ====================================================================== */

async function bindWork() {
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

/* ======================================================================
 * VAULT — real memory: recent notes, real recall, proposed memories, brief
 * ====================================================================== */

async function bindVault() {
  const screen = screenEl('vault');
  if (!screen) return;

  const importCard = document.getElementById('import-card');
  neutralizeImportCard(importCard);

  const cards = $$('.card', screen);
  const listCard = cards.find((c) => c !== importCard);
  const rowList = listCard ? listCard.querySelector('.row-list') : null;
  const searchInput = screen.querySelector('.sbar input');
  if (!rowList) return;

  let query = '';
  let notesRes = null;
  let hitsRes = null;
  let pendingRes = null;
  let searchTimer = null;

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

  render();
  const [notes, pending] = await Promise.all([getJSON('/memory'), getJSON('/memory/pending')]);
  notesRes = notes; pendingRes = pending;
  render();

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      const q = query.trim();
      if (!q) { hitsRes = null; render(); return; }
      render();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        hitsRes = await getJSON('/memory?q=' + encodeURIComponent(q));
        render();
      }, 300);
    });
  }

  bindBrief(screen);
}

/** The mock `#import-card` shows a fabricated preview ("4 records…", fake
 *  rows, a fake "Approve import (3)"). There is no real import endpoint this
 *  binder was given, so rather than leave invented numbers standing behind a
 *  button a user can actually click, the card's content is replaced with an
 *  honest statement. `[data-import-cancel]` is left in place — ui.js already
 *  wires it to close the card, and that is a real effect. */
function neutralizeImportCard(card) {
  if (!card) return;
  const wrap = el('div', null);
  wrap.appendChild(noteEl('Importing memory from another assistant is not wired to a real endpoint from this '
    + 'button yet — nothing has been read and nothing has been written. A real import would sanitize each note '
    + 'and route it through the same owner-approval path any other memory write uses.'));
  const close = el('button', 'btn g sm', 'Close');
  close.type = 'button';
  close.setAttribute('data-import-cancel', '');
  wrap.appendChild(close);
  fill(card, wrap);
}

async function bindBrief(screen) {
  const pbody = screen.querySelector('.pbody');
  if (!pbody) return;
  const card = el('div', 'card');
  card.style.marginTop = '16px';
  const body = el('div', null);
  card.appendChild(headingEl('today’s brief'));
  card.appendChild(body);
  pbody.appendChild(card);
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

/* ======================================================================
 * INTEGRATIONS — real connectors/agents/models/skills, plus the MCP edge
 * ====================================================================== */

function lcardOuter(titleText, metaText, rightNode) {
  const card = el('div', 'lcard');
  card.style.marginBottom = '10px';
  card.appendChild(el('div', 'lk', titleText));
  card.appendChild(el('div', 'lm', metaText || ''));
  if (rightNode) {
    const lr = el('div', 'lr');
    lr.appendChild(rightNode);
    card.appendChild(lr);
  }
  return card;
}
function lcardNote(text, err) {
  return lcardOuter(text, err ? String(err) : 'Nothing is configured here yet.', pillEl(err ? 'could not read' : 'none', err ? 'rd' : 'wt'));
}
function sourceCard(s) {
  const configured = s.state !== 'not-configured';
  const remote = s.name !== 'local';
  const stateWord = s.state === 'ok' ? 'answered in full'
    : s.state === 'partial' ? 'answered in part'
      : s.state === 'failed' ? 'did not answer' : 'never asked';
  const stateCls = s.state === 'ok' ? 'gr' : s.state === 'partial' ? 'am' : s.state === 'failed' ? 'rd' : 'wt';
  const egress = !remote ? 'stays on this machine' : (configured ? 'leaves this machine' : 'would leave this machine');
  const meta = [configured ? 'configured' : 'not configured', stateWord, egress,
    s.count == null ? null : s.count + ' ' + plural(s.count, 'item', 'items')].filter(Boolean).join(' · ');
  return lcardOuter(s.name || 'a work source', meta, pillEl(stateWord, stateCls));
}
function ollamaCard(models) {
  const has = models.length > 0;
  const meta = has
    ? models.length + ' ' + plural(models.length, 'model', 'models') + ' installed — stays on this machine'
    : 'No models listed — the same answer whether Ollama is stopped or has nothing pulled.';
  return lcardOuter('Ollama · 127.0.0.1:11434', meta, pillEl(has ? 'answered' : 'no models', has ? 'gr' : 'am'));
}
function agentCard(a) {
  const local = a.id === 'local';
  const meta = [a.available ? 'runnable now' : 'unavailable', local ? 'local runtime' : 'hosted provider',
    local ? 'stays on this machine' : 'sends code to its provider'].join(' · ');
  return lcardOuter(a.label || a.id || 'agent', meta, pillEl(a.available ? 'available' : 'unavailable', a.available ? 'gr' : 'wt'));
}
function skillCard(sk) {
  const meta = (sk.description ? clip(sk.description, 100) + ' — ' : '') + (sk.bytes || 0) + ' bytes';
  const susp = sk.verdict === 'suspicious';
  return lcardOuter(sk.name || sk.id || 'skill', meta, pillEl(susp ? 'review findings' : 'screened', susp ? 'am' : 'gr'));
}
function mcpCard() {
  return lcardOuter('MCP edge', 'A separate stdio process. This window has no HTTP route to it and cannot say '
    + 'whether a client is connected.', pillEl('not visible from here', 'wt'));
}

async function bindIntegrations() {
  const screen = screenEl('integrations');
  if (!screen) return;
  const container = screen.querySelector('.live-cards');
  if (!container) return;

  fill(container, lcardOuter('Reading integrations…', '', null));

  const addBtn = screen.querySelector('.phead button');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      toast('Connectors need a provider app you register — see Settings → Connectors.');
    });
  }

  const [work, agents, skills] = await Promise.all([getJSON('/work'), getJSON('/forge/agents'), getJSON('/skills')]);
  const nodes = [];

  nodes.push(headingEl('work sources'));
  if (!work.ok) {
    nodes.push(lcardNote('Work sources could not be read.', work.error));
  } else {
    const sources = Array.isArray(work.data && work.data.sources) ? work.data.sources : [];
    if (!sources.length) nodes.push(lcardNote('No work source is configured.', null));
    sources.forEach((s) => nodes.push(sourceCard(s)));
  }

  nodes.push(headingEl('local model runtime'));
  if (!agents.ok) {
    nodes.push(lcardNote('The local runtime could not be read.', agents.error));
  } else {
    const models = Array.isArray(agents.data && agents.data.localModels) ? agents.data.localModels : [];
    nodes.push(ollamaCard(models));
    const list = Array.isArray(agents.data && agents.data.agents) ? agents.data.agents : [];
    list.forEach((a) => nodes.push(agentCard(a)));
  }

  nodes.push(headingEl('repository skills'));
  if (!skills.ok) {
    nodes.push(lcardNote('Installed skills could not be read.', skills.error));
  } else {
    const installed = Array.isArray(skills.data && skills.data.skills) ? skills.data.skills : [];
    if (!installed.length) nodes.push(lcardNote('No repository skills are installed.', null));
    installed.slice(0, 10).forEach((sk) => nodes.push(skillCard(sk)));
    if (installed.length > 10) nodes.push(noteEl('+ ' + (installed.length - 10) + ' more not shown.'));
    const failed = Array.isArray(skills.data && skills.data.failed) ? skills.data.failed : [];
    if (failed.length) nodes.push(noteEl(failed.length + ' skill file(s) could not be loaded.'));
  }

  nodes.push(headingEl('separate process'));
  nodes.push(mcpCard());

  fill(container, ...nodes);
}

/* ======================================================================
 * CHATS — the real archive of Home's conversation, and a real composer
 * ====================================================================== */

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

async function bindChats() {
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

    const res = await postJSON('/assistant/ask', { question: text });
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
  snapshot();
  renderList();
}

/* ---------------------------------------------------------------------- *
 * the seam bind.js calls. Each screen binds independently and never lets a
 * failure in one blank the others.
 * ---------------------------------------------------------------------- */
export async function bind() {
  await Promise.allSettled([
    bindWork().catch((err) => console.warn('[zeno] lists: work bind failed', err)),
    bindVault().catch((err) => console.warn('[zeno] lists: vault bind failed', err)),
    bindIntegrations().catch((err) => console.warn('[zeno] lists: integrations bind failed', err)),
    bindChats().catch((err) => console.warn('[zeno] lists: chats bind failed', err)),
  ]);
}
