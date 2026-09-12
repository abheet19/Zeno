/*
 * bind/counsel.js — wires the artifact's Counsel screen to the real meeting
 * recorder daemon. This file OWNS `.product[data-product="counsel"]` only.
 *
 * ui.js (loaded before this module) already gives the Counsel screen its
 * navigation chrome (view switching via [data-cngo], tab switching via
 * [data-cntab]) and — separately — a full MOCK meeting recorder: a fake
 * MEETINGS array rendered into #cn-list, a fake timer/fake canned transcript
 * lines on #cn-start, and fake consent gating. That mock behaviour is
 * attached directly to #cn-start / #cn-pause / #cn-end / #cn-record / #cn-c1
 * / #cn-c2 via addEventListener, and to #cn-list via innerHTML.
 *
 * Because we cannot edit ui.js, every element whose MOCK BEHAVIOUR (not just
 * mock data) must be replaced is cloned via cloneNode + replaceWith first —
 * that drops ui.js's directly-attached listeners without touching ui.js's
 * file — and this module attaches the real listeners to the clone. Pure
 * navigation chrome (view/tab switching, delegated on `document` by ui.js)
 * is left alone: it is real behaviour already (it just shows/hides whatever
 * content is currently in the DOM), and it keeps working on our content once
 * we fill it in.
 *
 * Real routes used, and no others:
 *   GET  /counsel/meetings
 *   GET  /counsel/meetings/:id
 *   POST /counsel/meetings
 *   POST /counsel/ask
 *   GET  /forge/agents            (preflight's "summary model" line only)
 *
 * Product rules preserved exactly, per the brief: consent-first (both
 * checkboxes gate Start for real), microphone only (never system/call
 * audio), audio is never stored (only finalized text lines are kept and
 * sent), and questions are structurally unavailable while a call is live
 * (the Ask tab lives only in the post-call view, which a live call never
 * shows). Where the artifact's static copy overclaims (e.g. that notes are
 * "saved with the transcript", when POST /counsel/meetings never accepts a
 * notes field), this binder corrects the copy rather than leaving a false
 * claim standing next to real behaviour.
 */

import { getJSON, $, $$, el, fill, setText, authHeaders, token } from '../bind.js';
import { SpeechRecognition, localSpeech, waitForSpeechIdle } from '../whisper.js';

const LIFECYCLE = { proposed: '○', agreed: '◈', disputed: '⊘' };
const LIFECYCLE_PILL = { proposed: 'wt', agreed: 'gr', disputed: 'am' };

export async function bind() {
  try {
    await bindCounsel();
  } catch (err) {
    console.warn('[zeno] counsel binder failed:', err);
  }
}

/* ===================================================================== *
 * small formatting/DOM helpers                                          *
 * ===================================================================== */

function pill(cls, text) {
  const p = el('span', `pill${cls ? ' ' + cls : ''}`);
  if (cls === 'cy' || cls === 'am' || cls === 'gr' || cls === 'rd') p.append(el('span', 'd'));
  p.append(document.createTextNode(text));
  return p;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '—');
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
function fmtMinutes(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${mins}m`;
}
function elapsedLabel(m, iso) {
  const start = Date.parse(m.startedAt);
  const at = Date.parse(iso);
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return null;
  return fmtElapsed(at - start);
}
function slugify(s) {
  return String(s || 'call').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'call';
}

function downloadFile(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

function callMarkdown(m) {
  const out = [];
  const utter = new Map((m.utterances || []).map((u) => [u.id, u]));
  const cited = (cites) => (cites || []).map((id) => {
    const u = utter.get(id);
    return u ? `\n  > [${id}] ${u.text}` : `\n  > [missing line ${id}]`;
  }).join('');
  out.push(`# ${m.title || 'Untitled call'}`, '');
  out.push(`- **When:** ${fmtDate(m.startedAt)} → ${fmtDate(m.endedAt)}`);
  out.push(`- **Participants:** ${(m.participants || []).join(', ') || 'none named'}`);
  out.push(`- **Lines:** ${(m.utterances || []).length}`);
  out.push(`- **Record id:** ${m.id}`, '');
  const sum = m.summary || {};
  const section = (label, items, fmtItem) => {
    out.push(`## ${label}`);
    if (!items || items.length === 0) out.push(`_Nothing in this call was extracted as ${label.toLowerCase()}._`);
    else for (const it of items) out.push(fmtItem(it));
    out.push('');
  };
  section('Decisions', sum.decisions, (d) => `- (${d.lifecycle}) ${d.text}${cited(d.cites)}`);
  section('Action items', sum.actions, (a) => `- ${a.text} — owner: ${a.owner || 'nobody named'}; due: ${a.due || 'no date said'}${cited(a.cites)}`);
  section('Open questions', sum.questions, (q) => `- ${q.text}${cited(q.cites)}`);
  section('Key points', sum.keyPoints, (k) => `- ${k.text}${cited(k.cites)}`);
  out.push('## Transcript');
  for (const u of (m.utterances || [])) out.push(`- **${u.speaker || 'unknown'}** [${u.id}]: ${u.text}`);
  out.push('', '> Exported from Zeno Counsel — generated locally on this machine; nothing left it.');
  return out.join('\n');
}

function emailDraftText(m) {
  const sum = m.summary || {};
  const line = (label, items, pick) => {
    const n = (items || []).length;
    const preview = (items || []).slice(0, 3).map(pick).join(' · ');
    return `${label} (${n}): ${n ? preview : 'none found'}`;
  };
  return [
    `Subject: ${m.title || 'Untitled call'} · summary`,
    '',
    line('Decisions', sum.decisions, (d) => d.text),
    line('Action items', sum.actions, (a) => `${a.text}${a.owner ? ' (' + a.owner + ')' : ''}`),
    line('Open questions', sum.questions, (q) => q.text),
  ].join('\n');
}

/** POST helper — bind.js only ships a GET convenience (getJSON), so writes
 *  get their own small wrapper here. Same never-throws contract as getJSON:
 *  {ok:true,data} or {ok:false,error}. */
async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, authHeaders()),
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const e = (data && data.error) || {};
      const msg = typeof e.message === 'string' ? e.message : `${path} answered ${res.status}`;
      const resolve = typeof e.resolve === 'string' ? e.resolve : '';
      return { ok: false, error: `${msg}${resolve ? ' ' + resolve : ''}`.trim() };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `${path} could not be reached: ${err && err.message}` };
  }
}

/** A short Whisper vocabulary hint for Counsel only — comma-separated terms,
 *  never an instruction, so it cannot teach silence to hallucinate. */
function counselSpeechPrompt(title) {
  const terms = ['Zeno', 'Counsel', 'Forge', 'Ollama', 'Claude Code', 'Codex', 'TypeScript', 'FastAPI', 'PostgreSQL', 'Kubernetes', title];
  const seen = new Set();
  const clean = [];
  for (const value of terms) {
    const term = String(value || '').replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    clean.push(term);
  }
  return clean.join(', ').slice(0, 512);
}

/* ===================================================================== *
 * bindCounsel — one closure, everything real lives inside it            *
 * ===================================================================== */

async function bindCounsel() {
  const root = document.querySelector('.product[data-product="counsel"]');
  if (!root) return; // another agent's screen, or the artifact changed shape

  /* ---- elements this binder only READS from (pure nav chrome, untouched) */
  const cnList = $('#cn-list', root);
  const titleInput = $('#cn-title', root);
  const timerEl = $('#cn-timer', root);
  const micStatePill = $('#cn-micstate', root);
  const linesBox = $('#cn-lines', root);
  const postTitleEl = $('#cn-post-title', root);
  const postMetaP = postTitleEl && postTitleEl.parentElement ? postTitleEl.parentElement.querySelector('p') : null;

  /* ---- elements whose MOCK BEHAVIOUR we must remove: clone, then rewire */
  function takeOver(node) {
    if (!node) return null;
    const clone = node.cloneNode(true);
    node.replaceWith(clone);
    return clone;
  }
  const c1 = takeOver($('#cn-c1', root));
  const c2 = takeOver($('#cn-c2', root));
  const startBtn = takeOver($('#cn-start', root));
  const pauseBtn = takeOver($('#cn-pause', root));
  const endBtn = takeOver($('#cn-end', root));
  const recordBtn = takeOver($('#cn-record', root));
  const heroRecordBtn = takeOver($('.cnhero button[data-cngo="preflight"]', root));

  /* ================================================================= *
   * state — every field below is filled from a real response, or from *
   * what the browser itself can verify (mic devices, speech engine).  *
   * ================================================================= */
  let archiveState = 'loading'; // loading | ok | error
  let archiveNote = '';
  let meetings = [];
  let failedFiles = [];
  const cache = new Map(); // meeting id -> full meeting record
  let selectedId = null;
  let openMeeting = null;
  let lastRedactedId = null;
  let lastRedactedCount = 0;
  let micState = 'checking'; // checking | ok | no | unverified
  let askThread = []; // {question, node} — real across the whole archive
  let asking = false;
  let CALL = null; // the live call; null at rest

  function showCnView(name) {
    $$('.cnview', root).forEach((v) => v.classList.toggle('on', v.dataset.cnview === name));
    const main = $('.cnmain', root);
    if (main) main.scrollTop = 0;
  }

  /* ================================================================= *
   * A · the archive — GET /counsel/meetings into #cn-list              *
   * ================================================================= */

  async function loadArchive() {
    archiveState = 'loading';
    renderList();
    if (!token()) {
      // Every Counsel route is owner-authenticated. A window opened without
      // the launch nonce gets no token, so say that plainly instead of
      // letting it surface as a generic fetch failure below.
      archiveState = 'error';
      archiveNote = 'This window was not handed an owner token, so the daemon refuses every Counsel route. Open Zeno from its launch link rather than by typing the address.';
      meetings = [];
      failedFiles = [];
      renderList();
      syncStartGate();
      return;
    }
    const r = await getJSON('/counsel/meetings');
    if (!r.ok) {
      archiveState = 'error';
      archiveNote = r.error || 'The meeting archive could not be read.';
      meetings = [];
      failedFiles = [];
    } else {
      const d = r.data;
      if (!d || !Array.isArray(d.meetings) || !Array.isArray(d.failed)) {
        archiveState = 'error';
        archiveNote = 'The daemon answered, but its response did not contain a readable meeting list. Treat the archive as unknown.';
        meetings = [];
        failedFiles = [];
      } else if (d.archive && d.archive.readable === false) {
        archiveState = 'error';
        archiveNote = `${d.archive.reason || 'The meeting archive could not be read.'} ${d.archive.resolve || ''}`.trim();
        meetings = [];
        failedFiles = d.failed;
      } else {
        meetings = d.meetings;
        failedFiles = d.failed;
        archiveState = 'ok';
        archiveNote = '';
      }
    }
    renderList();
    syncStartGate();
  }

  function renderList() {
    if (!cnList) return;
    if (archiveState === 'loading') {
      fill(cnList, el('p', null, 'Reading the archive…'));
      return;
    }
    if (archiveState === 'error') {
      const note = el('p', null, archiveNote || 'The archive could not be read.');
      note.style.cssText = 'font-size:12px;color:var(--red);padding:6px';
      const retry = el('button', 'laction', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { void loadArchive(); });
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

  /* ================================================================= *
   * B · one call — GET /counsel/meetings/:id, into the post view       *
   * ================================================================= */

  async function openMeetingById(id) {
    selectedId = id;
    renderList();
    showCnView('post');
    if (cache.has(id)) {
      openMeeting = cache.get(id);
      renderPost(null);
      return;
    }
    openMeeting = null;
    renderPost('loading');
    const r = await getJSON(`/counsel/meetings/${encodeURIComponent(id)}`);
    if (selectedId !== id) return; // moved on already
    if (r.ok && r.data && r.data.meeting) {
      cache.set(id, r.data.meeting);
      openMeeting = r.data.meeting;
      renderPost(null);
    } else {
      openMeeting = null;
      renderPost(r.error || 'That call could not be opened.');
    }
  }

  function clearTabs() {
    for (const k of ['summary', 'transcript', 'ask', 'export', 'email']) {
      const p = $(`.cnp[data-cntab="${k}"]`, root);
      if (p) fill(p);
    }
  }

  function renderPost(state) {
    if (state === 'loading') {
      setText(postTitleEl, 'Opening the call…');
      if (postMetaP) fill(postMetaP);
      return;
    }
    if (typeof state === 'string') {
      setText(postTitleEl, 'That call could not be opened.');
      if (postMetaP) fill(postMetaP, el('span', null, state));
      clearTabs();
      return;
    }
    const m = openMeeting;
    if (!m) return;
    setText(postTitleEl, m.title || '(untitled call)');
    if (postMetaP) {
      const durMs = Number.isFinite(Date.parse(m.endedAt)) && Number.isFinite(Date.parse(m.startedAt))
        ? new Date(m.endedAt) - new Date(m.startedAt) : null;
      const parts = [
        el('span', null, `${fmtDate(m.startedAt)}${durMs != null ? ' · ' + fmtMinutes(durMs) : ''}`),
        document.createTextNode(' · saved locally'),
      ];
      if (lastRedactedId === m.id && lastRedactedCount > 0) {
        parts.push(pill('gr', `${lastRedactedCount} identifier${lastRedactedCount === 1 ? '' : 's'} redacted on save`));
      }
      fill(postMetaP, ...parts);
    }
    renderSummaryTab(m);
    renderTranscriptTab(m);
    renderAskTab();
    renderExportTab(m);
    renderEmailTab(m);
  }

  function citeChips(m, cites, lines) {
    const wrap = el('span');
    if (!cites || cites.length === 0) {
      wrap.append(el('span', null, 'no citation'));
      wrap.style.cssText = 'color:var(--ink-3);font-size:11px;font-style:italic';
      return wrap;
    }
    for (const id of cites) {
      const u = lines.get(id);
      const label = u ? (elapsedLabel(m, u.at) || u.id) : id;
      const chip = el('button', 'cite', `[${label}]`);
      chip.type = 'button';
      let quote = null;
      if (!u) {
        chip.disabled = true;
        chip.title = 'This id is not a line in this call’s transcript.';
      } else {
        chip.addEventListener('click', () => {
          if (quote) { quote.remove(); quote = null; return; }
          quote = el('div');
          quote.style.cssText = 'margin:6px 0;padding:8px 10px;border-left:2px solid var(--rule-2);font-size:12.5px;color:var(--ink-2)';
          quote.append(el('b', null, `${u.speaker || 'unknown'}: `), document.createTextNode(u.text));
          chip.insertAdjacentElement('afterend', quote);
        });
      }
      wrap.append(chip);
    }
    return wrap;
  }

  function summarySection(parent, label, items, lines, build) {
    const sec = el('div', 'cnsec');
    const h = el('div', 'cnsech');
    h.append(document.createTextNode(`${label} `), el('span', null, String((items && items.length) || 0)));
    sec.append(h);
    if (!items || items.length === 0) {
      sec.append(el('div', 'cnitem', `Nothing in this call was extracted as ${label.toLowerCase()}.`));
    } else {
      for (const it of items) sec.append(build(it));
    }
    parent.append(sec);
  }

  function renderSummaryTab(m) {
    const pane = $('.cnp[data-cntab="summary"]', root);
    if (!pane) return;
    const nodes = [];
    if (m.participants && m.participants.length) {
      const p = el('p', null, `With ${m.participants.join(', ')}.`);
      p.style.cssText = 'margin:0;font-size:12px;color:var(--ink-3)';
      nodes.push(p);
    }
    const lines = new Map((m.utterances || []).map((u) => [u.id, u]));
    const sum = el('div', 'cnsum');
    summarySection(sum, 'Key points', (m.summary || {}).keyPoints, lines, (k) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, k.text), citeChips(m, k.cites, lines));
      return it;
    });
    summarySection(sum, 'Decisions', (m.summary || {}).decisions, lines, (d) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, d.text), citeChips(m, d.cites, lines), pill(LIFECYCLE_PILL[d.lifecycle] || 'wt', `${LIFECYCLE[d.lifecycle] || '○'} ${d.lifecycle}`));
      return it;
    });
    summarySection(sum, 'Action items', (m.summary || {}).actions, lines, (a) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, a.text), el('span', 'who', a.owner || 'unknown'), pill('wt', `due: ${a.due || 'not said'}`), citeChips(m, a.cites, lines));
      return it;
    });
    summarySection(sum, 'Open questions', (m.summary || {}).questions, lines, (q) => {
      const it = el('div', 'cnitem');
      it.append(document.createTextNode(q.text), citeChips(m, q.cites, lines));
      return it;
    });
    nodes.push(sum);
    const fn = el('div', 'fnote', 'Every item above cites the transcript line it came from. Counsel extracts these deterministically, with no model in this step — an owner or a date that was not said stays "unknown", and an item with no citation cannot be produced.');
    nodes.push(fn);
    fill(pane, ...nodes);
  }

  function renderTranscriptTab(m) {
    const pane = $('.cnp[data-cntab="transcript"]', root);
    if (!pane) return;
    const utterances = m.utterances || [];
    if (utterances.length === 0) {
      fill(pane, el('div', 'cnitem', 'Nothing was transcribed in this call.'));
      return;
    }
    const wrap = el('div', 'cnlines static');
    for (const u of utterances) {
      const row = el('div', 'cnl');
      row.append(el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel(m, u.at) || ''), el('span', null, u.text));
      wrap.append(row);
    }
    fill(pane, wrap);
  }

  function renderExportTab(m) {
    const pane = $('.cnp[data-cntab="export"]', root);
    if (!pane) return;
    const status = el('p', null, '');
    status.style.cssText = 'font-size:12px;color:var(--ink-3);margin:6px 2px 0';
    const mkBtn = (label, run) => {
      const b = el('button', 'laction cy', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        const ok = run();
        status.textContent = ok ? `Saved to your downloads as ${label.replace('Save ', '')}.` : 'The browser blocked the download — nothing was saved.';
      });
      return b;
    };
    const base = `${slugify(m.title)}-${String(m.id || '').slice(0, 8)}`;
    const mdBtn = mkBtn('Save .md', () => downloadFile(`${base}.md`, callMarkdown(m), 'text/markdown'));
    const jsonBtn = mkBtn('Save .json', () => downloadFile(`${base}.json`, JSON.stringify(m, null, 2), 'application/json'));
    const pdfBtn = el('button', 'laction', 'Save .pdf');
    pdfBtn.type = 'button';
    pdfBtn.disabled = true;
    pdfBtn.title = 'Not available — this daemon has no PDF renderer.';
    const mkCard = (title, sub, action) => {
      const c = el('div', 'lcard');
      c.append(el('div', 'lk', title), el('div', 'lm', sub));
      const r = el('div', 'lr');
      r.append(action);
      c.append(r);
      return c;
    };
    const cards = el('div', 'live-cards');
    cards.append(
      mkCard('Markdown', 'summary + transcript · human-readable', mdBtn),
      mkCard('JSON', 'structured · citations preserved', jsonBtn),
      mkCard('PDF', 'not available on this daemon', pdfBtn),
    );
    fill(pane, cards, status);
  }

  function renderEmailTab(m) {
    const pane = $('.cnp[data-cntab="email"]', root);
    if (!pane) return;
    const mailPre = pane.querySelector('.cnmail');
    if (mailPre) mailPre.textContent = emailDraftText(m);
    const toInput = pane.querySelector('input.cninput');
    if (toInput) toInput.value = '';
    // #cn-send / #cn-mailstate are left exactly as ui.js already renders them:
    // "not configured — no mail provider", disabling itself on click. That is
    // already the honest, real state — this daemon has no mail provider.
  }

  /* ================================================================= *
   * C · ask-your-archive — POST /counsel/ask (whole archive, not just  *
   *     the open call; the composer's own footnote says so)           *
   * ================================================================= */

  function lookupCite(id) {
    for (const m of cache.values()) {
      if (m.id === id) return { meeting: m, line: null };
      for (const u of m.utterances || []) if (u.id === id) return { meeting: m, line: u };
    }
    return null;
  }

  async function warmCache(ids) {
    for (const id of ids) {
      if (!id || cache.has(id)) continue;
      const r = await getJSON(`/counsel/meetings/${encodeURIComponent(id)}`);
      if (r.ok && r.data && r.data.meeting) cache.set(id, r.data.meeting);
    }
  }

  function answerNode(d) {
    if (d.ok === false) {
      const wrap = el('div');
      wrap.append(el('p', null, `No answer: the local model is not available. ${d.note || 'The daemon could not reach a local model.'}`));
      wrap.append(el('p', null, 'Your calls are still on disk and still readable here. Nothing was sent anywhere.'));
      if (d.model) wrap.append(pill('am', `model: ${d.model}`));
      return wrap;
    }
    const hits = Array.isArray(d.hits) ? d.hits : [];
    if (hits.length === 0) {
      const wrap = el('div');
      wrap.append(el('p', null, d.answer || 'I could not find that in your meetings.'));
      wrap.append(el('p', null, d.note || 'No meeting in your archive matched that question, so nothing was sent to a model.'));
      return wrap;
    }
    const grounded = d.grounded !== false;
    const said = grounded ? d.answer : d.unverified;
    const wrap = el('div');
    wrap.append(el('p', null, said ? String(said) : 'The model returned nothing to quote here.'));
    if (!grounded) {
      wrap.append(el('p', null, d.note || 'Part of this carries no citation, so it is not supported by your meetings.'));
      if (Array.isArray(d.fabricated) && d.fabricated.length) {
        const ul = el('ul');
        for (const id of d.fabricated) ul.append(el('li', null, `cited "${id}" — no call of yours contains that id`));
        wrap.append(ul);
      }
      if (Array.isArray(d.ungrounded) && d.ungrounded.length) {
        const ul = el('ul');
        for (const c of d.ungrounded.slice(0, 6)) ul.append(el('li', null, `uncited: ${c}`));
        if (d.ungrounded.length > 6) ul.append(el('li', null, `+${d.ungrounded.length - 6} more uncited claims`));
        wrap.append(ul);
      }
      wrap.append(pill('am', 'NOT GROUNDED — shown as what the model said, not as an answer'));
      return wrap;
    }
    const cites = Array.isArray(d.cites) ? d.cites : [];
    const row = el('p');
    if (cites.length === 0) {
      row.append(document.createTextNode('cites: none'));
    } else {
      row.append(document.createTextNode('cites: '));
      for (const id of cites) {
        const found = lookupCite(id);
        const chip = el('button', 'cite', id);
        chip.type = 'button';
        let quote = null;
        if (!found) {
          chip.disabled = true;
          chip.title = 'This id could not be resolved to a line in the archive from here.';
        } else {
          chip.addEventListener('click', () => {
            if (quote) { quote.remove(); quote = null; return; }
            quote = el('div');
            quote.style.cssText = 'margin:6px 0;padding:8px 10px;border-left:2px solid var(--rule-2);font-size:12.5px;color:var(--ink-2)';
            if (found.line) quote.append(el('b', null, `${found.line.speaker || 'unknown'}: `), document.createTextNode(found.line.text));
            else quote.append(el('b', null, 'call: '), document.createTextNode(found.meeting.title || found.meeting.id));
            chip.insertAdjacentElement('afterend', quote);
          });
        }
        row.append(chip, document.createTextNode(' '));
      }
    }
    wrap.append(row);
    wrap.append(pill('gr', d.model ? `GROUNDED · ${d.model} · local` : 'GROUNDED — every claim cites a line of a real call'));
    return wrap;
  }

  function renderAskTab() {
    const pane = $('.cnp[data-cntab="ask"]', root);
    if (!pane) return;
    const nodes = [];
    if (askThread.length === 0) {
      const p = el('p', null, "Nothing asked yet. Answers are read from your saved calls and every claim has to cite a real line — when it can't, you're told that instead.");
      p.style.cssText = 'font-size:13px;color:var(--ink-3)';
      nodes.push(p);
    } else {
      for (const t of askThread) {
        const you = el('div', 'turn you');
        const bt1 = el('div', 'bt');
        bt1.append(el('p', null, t.question));
        you.append(el('div', 'who', 'A'), bt1);
        nodes.push(you);
        const z = el('div', 'turn z');
        const bt2 = el('div', 'bt');
        bt2.append(t.node);
        z.append(el('div', 'who', 'Z'), bt2);
        nodes.push(z);
      }
    }
    const composer = el('div', 'composer');
    composer.style.width = '100%';
    const row = el('div', 'row');
    const textarea = el('textarea');
    textarea.rows = 1;
    textarea.placeholder = 'Ask about your saved calls — answers cite the transcript';
    const disabled = asking || archiveState !== 'ok' || !!CALL;
    textarea.disabled = disabled;
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask1(textarea.value); } });
    const sendBtn = el('button', 'cbtn send', '↑');
    sendBtn.type = 'button';
    sendBtn.disabled = disabled;
    sendBtn.addEventListener('click', () => void ask1(textarea.value));
    row.append(textarea, sendBtn);
    const foot = el('div', 'foot');
    foot.append(pill('gr', 'grounded in your saved calls only'), el('span', 'grow'), el('span', null, CALL ? 'off while a meeting is recording' : "when it isn't there, it says so"));
    composer.append(row, foot);
    nodes.push(composer);
    fill(pane, ...nodes);
  }

  async function ask1(qRaw) {
    const question = String(qRaw || '').trim();
    if (!question || asking || archiveState !== 'ok' || CALL) return;
    asking = true;
    const entry = { question, node: el('p', null, 'Asking the local model…') };
    askThread.push(entry);
    renderAskTab();
    const r = await postJSON('/counsel/ask', { question });
    asking = false;
    if (!r.ok) {
      entry.node = el('p', null, `No answer — the request did not get through. ${r.error}`);
    } else {
      await warmCache(((r.data && r.data.hits) || []).map((h) => h.id));
      entry.node = answerNode(r.data || {});
    }
    renderAskTab();
  }

  /* ================================================================= *
   * D · preflight — consent + a real mic/model check gate Start        *
   * ================================================================= */

  function setPillText(pillEl, cls, text, dot) {
    if (!pillEl) return;
    pillEl.className = `pill ${cls}`;
    const nodes = dot ? [el('span', 'd')] : [];
    nodes.push(document.createTextNode(text));
    fill(pillEl, ...nodes);
  }

  const preflightCard = $('.cnview[data-cnview="preflight"] .cncard', root);
  const preflightRows = preflightCard ? $$('.cnrow2', preflightCard) : [];
  const transcriptionPill = preflightRows[0] && preflightRows[0].children[1] ? preflightRows[0].children[1].querySelector('.pill') : null;
  const savedPill = preflightRows[1] && preflightRows[1].children[0] ? preflightRows[1].children[0].querySelector('.pill') : null;
  const modelPill = preflightRows[1] && preflightRows[1].children[1] ? preflightRows[1].children[1].querySelector('.pill') : null;

  if (transcriptionPill) {
    if (localSpeech) setPillText(transcriptionPill, 'gr', 'local · whisper · nothing leaves this machine', true);
    else if (SpeechRecognition) setPillText(transcriptionPill, 'am', 'browser speech · may leave this machine to transcribe', true);
    else setPillText(transcriptionPill, 'rd', 'no speech engine available in this app', false);
  }
  if (savedPill) setPillText(savedPill, 'wt', 'text only — the transcript. Notes are not sent anywhere.', false);

  async function refreshModelInfo() {
    if (!modelPill) return;
    const r = await getJSON('/forge/agents');
    if (!r.ok) { setPillText(modelPill, 'am', 'not verified — the daemon did not answer', true); return; }
    const models = (r.data && Array.isArray(r.data.localModels) ? r.data.localModels : []).filter(Boolean);
    if (models.length === 0) { setPillText(modelPill, 'am', 'no local model found — the summary cannot run', true); return; }
    const shown = models.slice(0, 2).join(', ') + (models.length > 2 ? ` +${models.length - 2}` : '');
    setPillText(modelPill, 'cy', `local ✓ · ${shown}`, true);
  }

  function computeAndSetMic() {
    if (!SpeechRecognition) { micState = 'no'; syncStartGate(); return; }
    if (localSpeech) { micState = 'unverified'; syncStartGate(); return; }
    (async () => {
      let hasInput = null;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        hasInput = devs.some((d) => d.kind === 'audioinput');
      } catch { hasInput = null; }
      if (hasInput === false) { micState = 'no'; syncStartGate(); return; }
      let perm = null;
      try { perm = await navigator.permissions.query({ name: 'microphone' }); } catch { perm = null; }
      if (!perm) { micState = 'unverified'; syncStartGate(); return; }
      const apply = () => {
        if (perm.state === 'granted') micState = 'ok';
        else if (perm.state === 'denied') micState = 'no';
        else micState = 'unverified';
        syncStartGate();
      };
      apply();
      perm.onchange = apply;
    })();
  }

  let hintEl = null;
  if (preflightCard) {
    hintEl = document.createElement('p');
    hintEl.style.cssText = 'font-size:12px;color:var(--amber);margin:0';
    preflightCard.appendChild(hintEl);
  }

  function computeWhyDisabled() {
    if (!c1 || !c1.checked) return "Tick the first box — everyone in the room needs to know they're being recorded.";
    if (!c2 || !c2.checked) return 'Tick the second box — this only captures your microphone.';
    if (!SpeechRecognition) return 'This app has no speech engine available, so there is nothing to record with.';
    if (micState === 'no') return 'No usable microphone was found, so there would be nothing to record.';
    if (archiveState !== 'ok') return 'The meeting archive could not be read, so a recorded call would have nowhere to be saved.';
    return null;
  }
  function syncStartGate() {
    const why = computeWhyDisabled();
    if (startBtn) startBtn.disabled = !!why;
    if (hintEl) hintEl.textContent = why || '';
  }
  if (c1) c1.addEventListener('change', syncStartGate);
  if (c2) c2.addEventListener('change', syncStartGate);

  function openPreflight() {
    if (CALL) { showCnView('live'); return; }
    if (titleInput) titleInput.value = '';
    if (c1) c1.checked = false;
    if (c2) c2.checked = false;
    syncStartGate();
    showCnView('preflight');
  }
  if (recordBtn) recordBtn.addEventListener('click', (e) => { e.stopPropagation(); openPreflight(); });
  if (heroRecordBtn) heroRecordBtn.addEventListener('click', (e) => { e.stopPropagation(); openPreflight(); });

  if (!SpeechRecognition) {
    const why = 'This app has no speech engine available, so Counsel cannot record here.';
    if (recordBtn) { recordBtn.disabled = true; recordBtn.title = why; }
    if (heroRecordBtn) { heroRecordBtn.disabled = true; heroRecordBtn.title = why; }
    const hero = $('.cnhero', root);
    const guardEl = $('.cnguard', root);
    if (hero) {
      const note = document.createElement('p');
      note.style.cssText = 'font-size:12.5px;color:var(--ink-3);margin:4px 0 0';
      note.textContent = 'This app has no speech engine available, so a call cannot be recorded here. Reading, summarising, and asking about saved calls still work.';
      if (guardEl) hero.insertBefore(note, guardEl); else hero.appendChild(note);
    }
  }

  /* ================================================================= *
   * E · the live call — real capture, real timer, real transcript      *
   * ================================================================= */

  function renderLive() {
    if (!CALL) return;
    const bar = $('.cnlivebar', root);
    const big = bar ? bar.querySelector('.recdot.big') : null;
    const label = bar ? bar.querySelector('b') : null;
    if (label) label.textContent = CALL.paused ? 'PAUSED' : CALL.running ? 'RECORDING' : CALL.want ? 'RECONNECTING…' : 'STOPPED · not recording';
    if (big) { big.style.animationPlayState = CALL.paused ? 'paused' : 'running'; big.style.opacity = CALL.paused ? '.4' : '1'; }
    if (timerEl) timerEl.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    if (micStatePill) {
      const info = CALL.paused ? ['wt', 'mic: paused'] : CALL.running ? ['cy', 'mic: live'] : CALL.want ? ['am', 'mic: reconnecting…'] : ['rd', 'mic: stopped'];
      setPillText(micStatePill, info[0], info[1], info[0] === 'cy' || info[0] === 'am');
    }
    if (pauseBtn) { pauseBtn.textContent = CALL.paused ? 'Resume' : 'Pause'; pauseBtn.disabled = CALL.saving; }
    if (endBtn) { endBtn.disabled = CALL.saving; endBtn.textContent = CALL.saving ? 'Saving…' : 'End meeting'; }
    if (linesBox) {
      const nodes = [];
      const last = CALL.utterances.slice(-8);
      if (last.length === 0) {
        nodes.push(el('div', null, 'Nothing transcribed yet. Lines appear here as the engine finalises them.'));
      } else {
        last.forEach((u, i) => {
          const row = el('div', `cnl${i === last.length - 1 ? ' now' : ''}`);
          row.append(el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel({ startedAt: new Date(CALL.startedAt).toISOString() }, u.at) || ''), el('span', null, u.text));
          nodes.push(row);
        });
      }
      if (CALL.interim) {
        const row = el('div', 'cnl');
        row.style.opacity = '.6';
        row.append(el('span', 'cnw', 'hearing'), el('span', 'cnt2', ''), el('span', null, CALL.interim));
        nodes.push(row);
      }
      if (CALL.note) {
        const n = el('div', null, CALL.note);
        n.style.cssText = `margin-top:8px;padding:8px 10px;border-radius:8px;font-size:12px;color:${CALL.noteTone === 'error' ? 'var(--red)' : 'var(--amber)'};background:var(--g3)`;
        nodes.push(n);
      }
      fill(linesBox, ...nodes);
      linesBox.scrollTop = linesBox.scrollHeight;
    }
  }

  function commit(text) {
    const t = String(text || '').trim();
    if (!CALL || !t) return;
    CALL.utterances.push({ id: `u${CALL.seq++}`, at: new Date().toISOString(), speaker: 'unknown', text: t });
  }

  function armEngine(session) {
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.initialPrompt = counselSpeechPrompt(session.title);

    rec.onstart = () => {
      if (CALL !== session || session.recognition !== rec || !session.want) {
        try { rec.abort(); } catch { /* already stopped */ }
        return;
      }
      session.running = true;
      session.note = null;
      renderLive();
    };
    rec.onresult = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (!res || !res[0]) continue;
        if (res.isFinal) commit(res[0].transcript);
        else interim += res[0].transcript;
      }
      session.interim = interim;
      renderLive();
    };
    rec.onerror = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      const err = (event && event.error) || 'unknown';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        session.want = false;
        session.running = false;
        session.note = 'Microphone access was refused, so capture stopped. Nothing was heard while it was blocked.';
        session.noteTone = 'error';
        try { rec.stop(); } catch { /* already stopped */ }
        renderLive();
        return;
      }
      if (err === 'no-speech' || err === 'aborted') return;
      session.want = false;
      session.running = false;
      session.note = err === 'network' ? 'The speech service is unavailable. Capture stopped; no automatic retries.' : `Speech recognition failed (${err}). Capture stopped.`;
      session.noteTone = 'error';
      try { rec.abort(); } catch { /* already stopped */ }
      renderLive();
    };
    rec.onend = () => {
      if (CALL !== session || session.recognition !== rec) return;
      session.enginePending = false;
      if (session.endResolve) { session.endResolve(true); session.endResolve = null; }
      if (session.want) {
        session.enginePending = true;
        try { rec.start(); } catch { session.enginePending = false; session.want = false; session.running = false; renderLive(); }
        return;
      }
      session.running = false;
      renderLive();
    };
    session.recognition = rec;
    session.want = true;
    session.running = false;
    session.enginePending = true;
    try {
      rec.start();
    } catch {
      session.enginePending = false;
      session.want = false;
      session.note = 'Microphone could not start. Stop other listening and retry.';
      session.noteTone = 'error';
      renderLive();
    }
  }

  function startEngine() {
    if (!CALL || !SpeechRecognition) return;
    const session = CALL;
    session.want = true;
    session.note = 'Preparing microphone. Command listening is paused while this call records.';
    session.noteTone = 'warn';
    const handoff = { waiters: [], requestedBy: 'Counsel' };
    window.dispatchEvent(new CustomEvent('zeno:release-command-voice', { detail: handoff }));
    Promise.all(handoff.waiters)
      .then(() => waitForSpeechIdle())
      .then(() => {
        if (CALL !== session || !session.want) return;
        armEngine(session);
      })
      .catch(() => {
        if (CALL === session) {
          session.want = false;
          session.note = 'The previous microphone session did not close. Stop Command listening, then end this call and try again.';
          session.noteTone = 'error';
          renderLive();
        }
      });
  }

  function stopEngine(discard, session) {
    session = session || CALL;
    if (!session) return Promise.resolve(true);
    session.want = false;
    const rec = session.recognition;
    if (discard) {
      if (session.endResolve) { session.endResolve(false); session.endResolve = null; }
      session.running = false;
      session.enginePending = false;
      try { rec && rec.abort(); } catch { /* already stopped */ }
      return Promise.resolve(false);
    }
    if (!rec || (!session.running && !session.enginePending)) return Promise.resolve(true);
    if (session.endPromise) return session.endPromise;
    session.endPromise = new Promise((resolve) => {
      let settled = false;
      let timer;
      const done = (complete) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        session.running = false;
        session.enginePending = false;
        session.endResolve = null;
        if (!complete) {
          session.captureIncomplete = true;
          try { rec.abort(); } catch { /* already stopped */ }
        }
        resolve(complete);
      };
      session.endResolve = done;
      timer = window.setTimeout(() => done(false), 2500);
      try { rec.stop(); } catch { done(false); }
    });
    return session.endPromise;
  }

  function togglePause() {
    if (!CALL) return;
    if (CALL.paused) void resumeLive(); else void pauseLive();
  }
  async function pauseLive() {
    if (!CALL || CALL.paused) return;
    const session = CALL;
    session.paused = true;
    renderLive();
    await stopEngine(false, session);
    if (CALL === session) renderLive();
  }
  async function resumeLive() {
    if (!CALL || !CALL.paused) return;
    CALL.paused = false;
    renderLive();
    startEngine();
  }
  function teardownCall() {
    if (!CALL) return;
    stopEngine(true, CALL);
    if (CALL.tick) window.clearInterval(CALL.tick);
    CALL = null;
    delete document.body.dataset.zenoCapture;
  }

  async function beginCall() {
    if (CALL || computeWhyDisabled()) return;
    const title = (titleInput && titleInput.value.trim()) || 'Untitled meeting';
    CALL = {
      title,
      utterances: [],
      seq: 0,
      interim: '',
      startedAt: Date.now(),
      recognition: null,
      want: false,
      running: false,
      paused: false,
      saving: false,
      note: null,
      noteTone: 'warn',
      tick: null,
      captureIncomplete: false,
    };
    document.body.dataset.zenoCapture = 'counsel';
    const liveNotes = $('.cnview[data-cnview="live"] .cnta', root);
    if (liveNotes) liveNotes.value = '';
    showCnView('live');
    renderLive();
    startEngine();
    CALL.tick = window.setInterval(() => {
      if (!CALL || !timerEl) return;
      timerEl.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    }, 1000);
  }

  async function endCall() {
    if (!CALL || CALL.saving) return;
    const session = CALL;
    session.saving = true;
    renderLive();
    await stopEngine(false, session);
    if (CALL !== session) return;
    if (CALL.utterances.length === 0) {
      CALL.saving = false;
      CALL.note = 'Nothing was transcribed, so there is nothing to save. Keep recording, or end again to leave without saving.';
      CALL.noteTone = 'warn';
      renderLive();
      return;
    }
    CALL.saving = true;
    renderLive();
    const r = await postJSON('/counsel/meetings', {
      title: CALL.title,
      participants: [],
      utterances: CALL.utterances.map((u) => ({ id: u.id, at: u.at, speaker: u.speaker, text: u.text })),
    });
    if (CALL !== session) return;
    if (!r.ok) {
      CALL.saving = false;
      CALL.note = `Not saved: ${r.error}`;
      CALL.noteTone = 'error';
      renderLive();
      return;
    }
    const saved = r.data && r.data.meeting;
    if (!saved || typeof saved.id !== 'string' || !saved.id.trim() || !Array.isArray(saved.utterances) || saved.utterances.length !== session.utterances.length) {
      CALL.saving = false;
      CALL.note = 'Save outcome unknown: the daemon answered without a complete saved-meeting record. Check the archive before trying again.';
      CALL.noteTone = 'error';
      renderLive();
      return;
    }
    const redacted = (r.data && r.data.redacted) || 0;
    teardownCall();
    cache.set(saved.id, saved);
    if (redacted > 0) { lastRedactedId = saved.id; lastRedactedCount = redacted; }
    await loadArchive();
    await openMeetingById(saved.id);
  }

  if (startBtn) startBtn.addEventListener('click', () => { void beginCall(); });
  if (pauseBtn) pauseBtn.addEventListener('click', () => togglePause());
  if (endBtn) endBtn.addEventListener('click', () => { void endCall(); });

  window.addEventListener('beforeunload', (e) => {
    if (CALL && CALL.utterances.length > 0 && !CALL.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ================================================================= *
   * F · honesty corrections to static copy the live view carries       *
   * ================================================================= */

  const transHint = $('.cnview[data-cnview="live"] .cntrans .cnth span', root);
  if (transHint) transHint.textContent = 'nobody is detected; every line is "unknown" here';
  const notesHint = $('.cnview[data-cnview="live"] .cnnotes .cnth span', root);
  if (notesHint) notesHint.textContent = 'this browser tab only — not sent anywhere';
  const liveNotesTA = $('.cnview[data-cnview="live"] .cnta', root);
  if (liveNotesTA) liveNotesTA.placeholder = 'Type what matters. Nothing here is saved when the call ends — copy anything you want to keep first.';

  /* ================================================================= *
   * G · boot                                                            *
   * ================================================================= */

  computeAndSetMic();
  void refreshModelInfo();
  await loadArchive();
}
