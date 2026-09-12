/*
 * Zeno Counsel — the meeting surface.
 * ==================================================================
 * LAYOUT ported from the design artifact's Counsel screen: `.cn` = a 280px
 * `aside.cnside` (Record button, real meeting list, "How Counsel works" note)
 * beside a `main.cnmain` holding four swappable `.cnview` states — archive
 * hero on entry, a `.cncard` preflight gate, a `.cnlive` recording split,
 * and a `.cnposth` + `.cntabs` + `.cnsec` post-call view. Only one `.cnview`
 * carries `.on` at a time; nothing here is a modal or a `<body>` overlay
 * any more. Markup/classes are the artifact's; every value they show is
 * real, off the wire — where the artifact assumed a feature this daemon
 * does not have, the honest thing was said instead of the demo's guess
 * (see the note at the bottom of this header).
 *
 * THE TOKENS. Every colour is a glass token (--g1..--g7 / --ink* / --cyan /
 * --gold / --amber / --red / --green / --rule / --gl-edge / --wash*), so the
 * surface renders in light as well as dark. New CSS lives in
 * screens/counsel.css — this file no longer injects its own <style>.
 *
 * THE DATA. Every value on this surface came off the wire from the local
 * daemon. Nothing is invented, and where there is no real source for
 * something the artifact drew, this file says that in words rather than
 * drawing it anyway.
 *
 * WHAT WAS CUT AND STAYS CUT. There is no Assist. Counsel writes down what
 * was said and answers questions about calls that already happened. It
 * never feeds you a line mid-sentence.
 *
 * WHAT THIS RELAYOUT CUT, THEN HAD TO GIVE BACK. An earlier pass of this
 * relayout also dropped the meeting-window attach/detect flow and the
 * mid-recording Discard, on the theory that the artifact's Counsel screen
 * showed no control for either. Both guard real invariants (a stale
 * "attached meeting" cannot silently start capture; an owner must be able to
 * throw away a live recording with a confirmation, not just live with a
 * mis-click) and both are restored here: the preflight re-verifies a picked
 * meeting window immediately before capture opens, and the live bar has a
 * Discard button beside Pause/End. Per-line speaker tagging is still "every
 * live line is unknown, with no way to relabel a line in this view" — the
 * commit/segment-start plumbing that would attribute a line correctly if a
 * speaker were ever selected is real, but there is still no control to select
 * one. The archive search box and per-call Delete remain cut; the daemon's
 * DELETE route still exists and files can still be removed by hand, this
 * surface just has no button for it. The live notes textarea is NOT sent
 * anywhere — POST /counsel/meetings never carried a notes field, so the copy
 * here says so instead of claiming (as the artifact's demo copy did) that
 * notes are "saved with the transcript".
 *
 * THE ROUTES IT TALKS TO, and no others:
 *   GET    /counsel/meetings      -> { meetings[], failed[] }
 *   GET    /counsel/meetings/:id  -> { meeting, text }
 *   POST   /counsel/meetings      -> { meeting, redacted }
 *   DELETE /counsel/meetings/:id  -> { deleted }        (owner-only; unused
 *                                      by this surface now — see above)
 *   POST   /counsel/ask           -> { ok, answer, unverified, cites, ungrounded,
 *                                      fabricated, grounded, hits, model, note }
 *          `answer` is populated ONLY when grounded:true. When the check fails
 *          the daemon sets answer:null and puts the model's text in
 *          `unverified` — a field name no UI prints by accident. This surface
 *          renders it as an explicit quote, never as an answer.
 *   GET    /forge/agents          -> { localModels[] }  (the preflight model row)
 *
 * NO RUNTIME EGRESS. Same-origin fetches to the loopback daemon only.
 *
 * NOTHING IS TRUE BEFORE THE DAEMON SAYS SO. A call is not "saved" until POST
 * /counsel/meetings answers; an answer is not an answer until the response
 * says it was grounded. Every one of those is drawn from the response, never
 * from the click.
 *
 * MICROPHONE ARBITRATION is unchanged: `document.body.dataset.zenoCapture`
 * and the `zeno:release-command-voice` handoff are read by voice.js/ask.js
 * too, so Counsel still asks Command's wake-listening to step aside before
 * it starts the engine, and still clears the flag the moment it stops.
 *
 * Exports: initCounsel(section), also as `init` and default, for nav.js.
 */

/* ================================================================== *
 * 0 · the wire — the token the page was handed, and the four verbs    *
 * ================================================================== */

const OWNER_TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) h['x-zeno-token'] = OWNER_TOKEN;
  return h;
}

/**
 * One fetch helper for all four verbs. It never throws for an HTTP status: the
 * daemon's errors are legible objects ({error:{code,message,resolve}}) and this
 * surface renders them as sentences, so a 404 must arrive as data rather than
 * as an exception that would collapse into a generic "something went wrong".
 */
async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? authHeaders() : authHeaders({ 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'unreachable',
      message: `The daemon did not answer ${method} ${path}.`,
      resolve: 'Check that it is still running on this machine.',
      data: null,
    };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return { ok: true, status: res.status, data };
  const e = (data && data.error) || {};
  return {
    ok: false,
    status: res.status,
    code: typeof e.code === 'string' ? e.code : `http-${res.status}`,
    message: typeof e.message === 'string' ? e.message : `${method} ${path} answered ${res.status}.`,
    resolve: typeof e.resolve === 'string' ? e.resolve : '',
    data,
  };
}

import { SpeechRecognition, localSpeech, waitForSpeechIdle } from './whisper.js';

/* ================================================================== *
 * 1 · DOM helpers. textContent only — a transcript line is speech and  *
 *     is rendered as text, never as markup.                            *
 * ================================================================== */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
function btn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}
function pill(cls, text) {
  const p = el('span', `pill${cls ? ' ' + cls : ''}`);
  if (cls === 'cy' || cls === 'am' || cls === 'gr' || cls === 'rd') add(p, el('span', 'd'));
  add(p, document.createTextNode(text));
  return p;
}

/* Dates: the owner's own locale, never a re-invented format. */
function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '—');
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtClock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
/** Minutes-only duration for the sidebar's meeting rows. */
function fmtMinutes(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  return `${mins}m`;
}

/**
 * A short Whisper vocabulary hint for Counsel only. This is deliberately a
 * comma-separated word list rather than an instruction: it improves names and
 * product terms without teaching silence to hallucinate a Command wake phrase.
 */
function counselSpeechPrompt(title, participants) {
  const terms = [
    'Zeno', 'Counsel', 'Forge', 'Ollama', 'Claude Code', 'Codex',
    'TypeScript', 'FastAPI', 'PostgreSQL', 'Kubernetes',
    title,
    ...(Array.isArray(participants) ? participants : []),
  ];
  const seen = new Set();
  const clean = [];
  for (const value of terms) {
    const term = String(value || '')
      .replace(/[-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    clean.push(term);
  }
  return clean.join(', ').slice(0, 512);
}

/** Treat even the trusted preload response as bounded data at the renderer edge. */
function normalizeMeetingPresence(value) {
  const status = value && ['detected', 'none', 'unavailable'].includes(value.status)
    ? value.status
    : 'unavailable';
  const candidates = [];
  const seen = new Set();
  const raw = value && Array.isArray(value.candidates) ? value.candidates : [];
  for (const item of raw.slice(0, 8)) {
    const key = String((item && item.key) || '');
    const provider = String((item && item.provider) || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    const title = String((item && item.title) || '')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    if (!/^[a-f0-9]{24}$/.test(key) || !provider || !title || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ key, provider, title });
  }
  return {
    status: status === 'detected' && candidates.length === 0 ? 'unavailable' : status,
    candidates,
    checkedAt: value && typeof value.checkedAt === 'string' ? value.checkedAt : null,
  };
}

/* ================================================================== *
 * 2 · vocabulary.                                                     *
 * ================================================================== */

const LIFECYCLE = { proposed: '○', agreed: '◈', disputed: '⊘' };
const LIFECYCLE_PILL = { proposed: 'wt', agreed: 'gr', disputed: 'am' };

/* ================================================================== *
 * 3 · initCounsel                                                     *
 * ================================================================== */

export function initCounsel(section) {
  if (!section || section.dataset.zcInit === '1') return;
  section.dataset.zcInit = '1';

  /* ---------------- state. Every field is filled from a response. -------- */
  const S = {
    archive: 'loading', // loading | ok | off | error
    archiveNote: '',
    meetings: [],
    failed: [],
    selected: null,
    detail: null,
    detailState: 'idle', // idle | loading | ok | error
    detailNote: '',
    activeTab: 'summary',
    thread: [], // { question, node } — ask-your-archive, real across every saved call
    asking: false,
    askDraft: '',
    redactedNote: null,
  };

  /** meeting id -> the full meeting, so a citation can be read, not just shown. */
  const cache = new Map();

  let CALL = null; // the live call. null at rest.
  let PRE = null; // the preflight's own working state, only while that view is open.

  /* ---------------- the stage ---------------- */
  const root = el('div', 'cn');

  /* ---- sidebar: record, real meetings, the honesty footnote ---- */
  const side = el('aside', 'cnside');
  const sideRecordBtn = btn('btn p', '', () => goPreflight());
  sideRecordBtn.style.cssText = 'width:100%;justify-content:center;display:flex;gap:8px;align-items:center';
  add(sideRecordBtn, el('span', 'recdot'), document.createTextNode('Record a meeting'));
  const listLabel = el('div', 'rk', 'Meetings');
  const cnList = el('div', 'cnlist');
  const sideSpacer = el('div', 'spacer');
  const cnFoot = el(
    'div',
    'cnfoot',
  );
  add(cnFoot, el('b', null, 'How Counsel works'), document.createTextNode(
    "Records with everyone's consent, transcribes locally, saves text only — audio is never stored. It takes the notes. It does not feed you answers during a call.",
  ));
  add(side, sideRecordBtn, listLabel, cnList, sideSpacer, cnFoot);

  /* ---- main: four swappable views ---- */
  const main = el('main', 'cnmain');

  // 1) ARCHIVE
  const viewArchive = el('section', 'cnview on');
  viewArchive.dataset.cnview = 'archive';
  const hero = el('div', 'cnhero');
  add(hero, el('div', 'cnorb'));
  add(hero, el('h1', null, 'Counsel takes the notes.'));
  const heroP = el('p');
  add(
    heroP,
    document.createTextNode(
      "A consent-first meeting notebook. Everyone in the room knows it's recording; afterwards you get a cited summary — decisions, actions, open questions — and can ask questions of the transcript ",
    ),
    el('b', null, 'once the meeting is over'),
    document.createTextNode('.'),
  );
  add(hero, heroP);
  const steps = el('div', 'cnsteps');
  const step = (n, label, sub) => {
    const s = el('div', 'cnstep');
    add(s, el('b', null, String(n)), document.createTextNode(label), el('span', null, sub));
    return s;
  };
  add(steps, step(1, 'Consent', "you confirm everyone's been told"), step(2, 'Record', 'local transcript · you take notes'), step(3, 'Summary', 'cited · exportable · ask afterwards'));
  add(hero, steps);
  const heroRecordBtn = btn('btn p', 'Record a meeting', () => goPreflight());
  heroRecordBtn.style.marginTop = '6px';
  add(hero, heroRecordBtn);
  const guard = el('div', 'cnguard');
  add(guard, pill('rd', 'never'), document.createTextNode('a live answer-feed, a hidden overlay, or anything that works without the room knowing.'));
  add(hero, guard);
  add(viewArchive, hero);

  // 2) PREFLIGHT
  const viewPreflight = el('section', 'cnview');
  viewPreflight.dataset.cnview = 'preflight';

  // 3) LIVE
  const viewLive = el('section', 'cnview');
  viewLive.dataset.cnview = 'live';
  const livebar = el('div', 'cnlivebar');
  const liveDot = el('span', 'recdot big');
  const liveLabel = el('b', null, 'RECORDING');
  const liveTimer = el('span', 'cnt', '00:00');
  const liveMicPill = pill('wt', 'local · mic only');
  const liveStatePill = pill('cy', 'mic: live');
  const liveFgrow = el('span', 'fgrow');
  const livePauseBtn = btn('btn g sm', 'Pause', () => togglePause());
  const liveDiscardBtn = btn('btn g sm', 'Discard', () => discardCall());
  liveDiscardBtn.title = 'Throw away this recording — no undo, nothing saved to Vault.';
  const liveEndBtn = btn('btn dz sm', 'End meeting', () => endCall());
  add(livebar, liveDot, liveLabel, liveTimer, liveMicPill, liveStatePill, liveFgrow, livePauseBtn, liveDiscardBtn, liveEndBtn);
  const liveSplit = el('div', 'cnlive');
  const liveTrans = el('div', 'cntrans');
  const liveTransHead = el('div', 'cnth');
  add(liveTransHead, document.createTextNode('Live transcript '), el('span', null, '— nobody is detected; every line is "unknown" here'));
  const liveLines = el('div', 'cnlines');
  add(liveTrans, liveTransHead, liveLines);
  const liveNotes = el('div', 'cnnotes');
  const liveNotesHead = el('div', 'cnth');
  add(liveNotesHead, document.createTextNode('Your notes '), el('span', null, 'this browser tab only — not sent anywhere'));
  const liveTextarea = el('textarea', 'cnta');
  liveTextarea.placeholder = 'Type what matters. Nothing here is saved when the call ends — copy anything you want to keep first.';
  liveTextarea.addEventListener('input', () => { if (CALL) CALL.notes = liveTextarea.value; });
  const qaOff = el('div', 'cnqa-off');
  const qaOffH = el('div', 'cnqa-off-h');
  add(qaOffH, pill('rd', 'questions are off'));
  const qaOffP = el('p');
  add(qaOffP, document.createTextNode("Counsel is recording, not answering. It won't feed you lines mid-conversation — that's the point. "), el('b', null, 'End and save first'), document.createTextNode(', then ask anything of the cited notes.'));
  // The boundary this product refuses to cross, stated in the surface itself and
  // asserted by ask-voice-model.test.ts: Counsel is a recorder, never an
  // in-call answer feed. Q&A opens only once capture has ended and saved.
  const qaOffGuard = el(
    'p',
    'hint',
    'Live Q&A is off while this meeting is active. End and save the transcript first; then ask from the cited notes in Counsel chat.',
  );
  add(qaOff, qaOffH, qaOffP, qaOffGuard);
  add(liveNotes, liveNotesHead, liveTextarea, qaOff);
  add(liveSplit, liveTrans, liveNotes);
  add(viewLive, livebar, liveSplit);

  // 4) POST
  const viewPost = el('section', 'cnview');
  viewPost.dataset.cnview = 'post';
  const posth = el('div', 'cnposth');
  const backBtn = btn('laction', '← All meetings', () => goArchive());
  const posthCopy = el('div');
  const postTitle = el('h2', null, '');
  const postMeta = el('p');
  add(posthCopy, postTitle, postMeta);
  const posthFgrow = el('span', 'fgrow');
  const postExportBtn = btn('btn g sm', 'Export', () => setTab('export'));
  const postEmailBtn = btn('btn p sm', 'Email summary', () => setTab('email'));
  add(posth, backBtn, posthCopy, posthFgrow, postExportBtn, postEmailBtn);

  const tabs = el('div', 'cntabs');
  tabs.setAttribute('role', 'tablist');
  const TAB_DEFS = [
    ['summary', 'Summary'],
    ['transcript', 'Transcript'],
    ['ask', 'Ask this meeting'],
    ['export', 'Export'],
    ['email', 'Email'],
  ];
  const tabButtons = new Map();
  for (const [key, label] of TAB_DEFS) {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('aria-selected', key === 'summary' ? 'true' : 'false');
    b.addEventListener('click', () => setTab(key));
    tabButtons.set(key, b);
    add(tabs, b);
  }

  const cnpb = el('div', 'cnpb');
  const paneSummary = el('div', 'cnp on');
  paneSummary.dataset.cntab = 'summary';
  const paneTranscript = el('div', 'cnp');
  paneTranscript.dataset.cntab = 'transcript';
  const paneAsk = el('div', 'cnp');
  paneAsk.dataset.cntab = 'ask';
  const paneExport = el('div', 'cnp');
  paneExport.dataset.cntab = 'export';
  const paneEmail = el('div', 'cnp');
  paneEmail.dataset.cntab = 'email';
  add(cnpb, paneSummary, paneTranscript, paneAsk, paneExport, paneEmail);
  add(viewPost, posth, tabs, cnpb);

  add(main, viewArchive, viewPreflight, viewLive, viewPost);

  const live = el('p', 'cn-sr');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  add(root, side, main, live);
  section.replaceChildren(root);

  const VIEWS = [viewArchive, viewPreflight, viewLive, viewPost];
  function showView(name) {
    for (const v of VIEWS) v.classList.toggle('on', v.dataset.cnview === name);
    main.scrollTop = 0;
  }
  function goArchive() {
    if (CALL) return; // a live call has no "back" — end or it keeps recording
    S.selected = null;
    renderSidebar();
    showView('archive');
  }

  function announce(msg) {
    live.textContent = msg;
  }

  /* =================================================================== *
   * A · PAST CALLS — GET /counsel/meetings, rendered into .cnlist        *
   * =================================================================== */

  async function loadArchive() {
    S.archive = 'loading';
    renderSidebar();
    const r = await call('GET', '/counsel/meetings');
    if (r.ok) {
      const d = r.data;
      if (!d || !Array.isArray(d.meetings) || !Array.isArray(d.failed)) {
        // A 2xx transport status does not prove the archive was read. If the
        // response loses either list, rendering an empty shelf would turn a
        // malformed response into a claim that the owner has no calls.
        S.meetings = [];
        S.failed = [];
        S.archive = 'error';
        S.archiveNote =
          'The daemon answered, but its archive response did not contain both the meeting list and the unreadable-file list. ' +
          'Treat the archive as unknown and try again.';
      } else {
        S.failed = d.failed;
        if (d.archive && d.archive.readable === false) {
          // An HTTP 200 means the daemon answered; it does not mean the folder
          // answered. Never turn an unreadable archive into an empty-history UI
          // or permit a recording whose save destination is unavailable.
          S.meetings = [];
          S.archive = 'error';
          S.archiveNote = `${d.archive.reason || 'The meeting archive could not be read.'} ${d.archive.resolve || ''}`.trim();
        } else {
          // The daemon's order is newest-first and it is NOT re-sorted here: a
          // re-sort would be this file inventing an order the archive did not give.
          S.meetings = d.meetings;
          S.archive = 'ok';
          S.archiveNote = '';
        }
      }
    } else if (r.code === 'no-meetings') {
      S.archive = 'off';
      S.archiveNote = `${r.message} ${r.resolve}`.trim();
    } else {
      S.archive = 'error';
      S.archiveNote = `${r.message} ${r.resolve}`.trim();
    }
    renderSidebar();
    if (S.selected && !cache.has(S.selected) && S.detailState !== 'loading') {
      // the owner had a call open when this (re)load started; nothing to redo,
      // select() already owns that path.
    }
  }

  function renderSidebar() {
    clear(cnList);
    if (S.archive === 'loading') {
      add(cnList, el('p', 'cnnote', 'Reading the archive…'));
      return;
    }
    if (S.archive === 'off') {
      add(cnList, el('p', 'cnnote warn', S.archiveNote || 'The meeting archive is not enabled on this daemon.'));
      return;
    }
    if (S.archive === 'error') {
      const note = el('p', 'cnnote err', S.archiveNote || 'The archive could not be read.');
      add(cnList, note);
      add(cnList, btn('laction', 'Try again', loadArchive));
      return;
    }
    for (const f of S.failed) {
      add(cnList, el('p', 'cnnote err', `Unreadable meeting file: ${f.id} — ${f.reason}`));
    }
    if (S.meetings.length === 0) {
      add(cnList, el('p', 'cnnote', 'No calls recorded yet. A finished call is saved here as one Markdown file.'));
      return;
    }
    for (const m of S.meetings) {
      const row = el('button', 'cnrow');
      row.type = 'button';
      row.setAttribute('aria-current', String(S.selected === m.id));
      const c = m.counts || {};
      const bits = [`${c.lines || 0} lines`];
      if (c.decisions) bits.push(`${c.decisions} decisions`);
      if (c.actions) bits.push(`${c.actions} actions`);
      const duration = Number.isFinite(Date.parse(m.endedAt)) && Number.isFinite(Date.parse(m.startedAt))
        ? fmtMinutes(new Date(m.endedAt) - new Date(m.startedAt))
        : null;
      const meta = `${fmtDate(m.startedAt)}${duration ? ' · ' + duration : ''} · ${bits.join(' · ')}`;
      add(row, el('b', null, m.title || '(untitled call)'), el('span', null, meta));
      row.addEventListener('click', () => { void select(m.id); });
      add(cnList, row);
    }
  }

  /* =================================================================== *
   * B · ONE CALL — GET /counsel/meetings/:id, opened into the post view  *
   * =================================================================== */

  async function select(id) {
    S.selected = id;
    S.redactedNote = null;
    S.activeTab = 'summary';
    renderSidebar();
    showView('post');
    if (cache.has(id)) {
      S.detail = { meeting: cache.get(id) };
      S.detailState = 'ok';
      renderPost();
      return;
    }
    S.detail = null;
    S.detailState = 'loading';
    renderPost();
    const r = await call('GET', `/counsel/meetings/${encodeURIComponent(id)}`);
    if (S.selected !== id) return; // the owner moved on; do not overwrite
    if (r.ok && r.data && r.data.meeting) {
      cache.set(id, r.data.meeting);
      S.detail = { meeting: r.data.meeting };
      S.detailState = 'ok';
    } else {
      S.detail = null;
      S.detailState = 'error';
      S.detailNote = `${r.message} ${r.resolve}`.trim();
    }
    renderPost();
  }

  /* Hand the owner a file of their own call. Built here, client-side, from the
     same record already on screen — it goes to the owner's disk on this machine
     and nowhere else. */
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

  function slugify(s) {
    return String(s || 'call').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'call';
  }

  /* The call as Markdown: the same four cited sections the panel shows, then the
     full transcript, then a provenance line. Nothing is invented — an item that
     had no owner/date/citation says so here exactly as it does on screen. */
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
    const section = (label, items, fmt) => {
      out.push(`## ${label}`);
      if (!items || items.length === 0) out.push(`_Nothing in this call was extracted as ${label.toLowerCase()}._`);
      else for (const it of items) out.push(fmt(it));
      out.push('');
    };
    section('Decisions', sum.decisions, (d) => `- (${d.lifecycle}) ${d.text}${cited(d.cites)}`);
    section('Action items', sum.actions, (a) => `- ${a.text} — owner: ${a.owner || 'nobody named'}; due: ${a.due || 'no date said'}${cited(a.cites)}`);
    section('Open questions', sum.questions, (q) => `- ${q.text}${cited(q.cites)}`);
    section('Key points', sum.keyPoints, (k) => `- ${k.text}${cited(k.cites)}`);
    out.push('## Transcript');
    for (const u of (m.utterances || [])) out.push(`- **${u.speaker || 'unknown'}** [${u.id}]: ${u.text}`);
    out.push('', `> Exported from Zeno Counsel — generated locally on this machine; nothing left it.`);
    return out.join('\n');
  }

  function exportCall(m, format) {
    const base = `${slugify(m.title)}-${String(m.id || '').slice(0, 8)}`;
    const ok = format === 'json'
      ? downloadFile(`${base}.json`, JSON.stringify(m, null, 2), 'application/json')
      : downloadFile(`${base}.md`, callMarkdown(m), 'text/markdown');
    announce(ok
      ? `Exported this call as ${format === 'json' ? 'JSON' : 'Markdown'} to your downloads.`
      : 'The browser blocked the download. Nothing was saved — try again.');
  }

  /* A real, short draft assembled from this call's own decisions/actions/
     questions — never invented copy, and never claimed as sent: there is no
     mail provider wired to this daemon, so "Authorize and send" only ever
     reaches the honest "not configured" state below. */
  function emailDraftText(m) {
    const sum = m.summary || {};
    const line = (label, items, pick) => {
      const n = (items || []).length;
      const preview = (items || []).slice(0, 3).map(pick).join(' · ');
      return `${label} (${n}): ${n ? preview : 'none found'}`;
    };
    const lines = [
      `Subject: ${m.title || 'Untitled call'} · summary`,
      '',
      line('Decisions', sum.decisions, (d) => d.text),
      line('Action items', sum.actions, (a) => `${a.text}${a.owner ? ` (${a.owner})` : ''}`),
      line('Open questions', sum.questions, (q) => q.text),
    ];
    return lines.join('\n');
  }

  function setTab(key) {
    S.activeTab = key;
    for (const [k, b] of tabButtons) b.setAttribute('aria-selected', String(k === key));
    for (const p of [paneSummary, paneTranscript, paneAsk, paneExport, paneEmail]) {
      p.classList.toggle('on', p.dataset.cntab === key);
    }
  }

  function renderPost() {
    if (S.archive !== 'ok') {
      postTitle.textContent = '';
      clear(postMeta);
      add(postMeta, el('span', null, 'Nothing to show.'));
      return;
    }
    if (S.detailState === 'loading') {
      postTitle.textContent = 'Opening the call…';
      clear(postMeta);
      return;
    }
    if (S.detailState === 'error') {
      postTitle.textContent = 'That call could not be opened.';
      clear(postMeta);
      add(postMeta, el('span', null, S.detailNote || ''));
      return;
    }
    if (!S.detail || !S.detail.meeting) return;

    const m = S.detail.meeting;
    postTitle.textContent = m.title || '(untitled call)';
    clear(postMeta);
    const redacted = S.redactedNote;
    const durationMs = Number.isFinite(Date.parse(m.endedAt)) && Number.isFinite(Date.parse(m.startedAt))
      ? new Date(m.endedAt) - new Date(m.startedAt)
      : null;
    add(postMeta, el('span', null, `${fmtDate(m.startedAt)}${durationMs != null ? ' · ' + fmtMinutes(durationMs) : ''}`));
    add(postMeta, document.createTextNode(' · saved locally'));
    if (redacted) add(postMeta, pill('gr', redacted));

    setTab(S.activeTab);
    renderSummaryTab(m);
    renderTranscriptTab(m);
    renderAskTab();
    renderExportTab(m);
    renderEmailTab(m);
  }

  /** MM:SS elapsed from the meeting's own start — real, computed, never invented. */
  function elapsedLabel(m, iso) {
    const start = Date.parse(m.startedAt);
    const at = Date.parse(iso);
    if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return null;
    return fmtElapsed(at - start);
  }

  /** A citation row for one summary item: real [MM:SS] chips that expand to
   * the actual quoted line — grounding has to be visible, not just claimed. */
  function citeChips(m, cites, lines) {
    const wrap = el('span');
    if (!cites || cites.length === 0) {
      add(wrap, el('span', null, 'no citation'));
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
          quote = el('div', 'cnquote');
          add(quote, el('b', null, u.speaker || 'unknown'), document.createTextNode(u.text));
          chip.insertAdjacentElement('afterend', quote);
        });
      }
      add(wrap, chip);
    }
    return wrap;
  }

  function summarySection(parent, m, label, items, build) {
    const sec = el('div', 'cnsec');
    const h = el('div', 'cnsech');
    add(h, el('span', null, label), el('span', null, String((items && items.length) || 0)));
    add(sec, h);
    if (!items || items.length === 0) {
      add(sec, el('div', 'cnitem', `Nothing in this call was extracted as ${label.toLowerCase()}.`));
    } else {
      const lines = new Map((m.utterances || []).map((u) => [u.id, u]));
      for (const it of items) add(sec, build(it, lines));
    }
    add(parent, sec);
  }

  function renderSummaryTab(m) {
    clear(paneSummary);
    const lines = new Map((m.utterances || []).map((u) => [u.id, u]));
    if (m.participants && m.participants.length) {
      const p = el('p');
      p.style.cssText = 'margin:0;font-size:12px;color:var(--ink-3)';
      p.textContent = `With ${m.participants.join(', ')}.`;
      add(paneSummary, p);
    }
    const sum = el('div', 'cnsum');
    summarySection(sum, m, 'Key points', (m.summary || {}).keyPoints, (k, ls) => {
      const it = el('div', 'cnitem');
      add(it, el('b', null, k.text), citeChips(m, k.cites, ls));
      return it;
    });
    summarySection(sum, m, 'Decisions', (m.summary || {}).decisions, (d, ls) => {
      const it = el('div', 'cnitem');
      add(it, el('b', null, d.text), citeChips(m, d.cites, ls), pill(LIFECYCLE_PILL[d.lifecycle] || 'wt', `${LIFECYCLE[d.lifecycle] || '○'} ${d.lifecycle}`));
      return it;
    });
    summarySection(sum, m, 'Action items', (m.summary || {}).actions, (a, ls) => {
      const it = el('div', 'cnitem');
      add(it, el('b', null, a.text));
      add(it, el('span', 'who', a.owner || 'unknown'));
      add(it, pill('wt', `due: ${a.due || 'not said'}`));
      add(it, citeChips(m, a.cites, ls));
      return it;
    });
    summarySection(sum, m, 'Open questions', (m.summary || {}).questions, (q, ls) => {
      const it = el('div', 'cnitem');
      add(it, document.createTextNode(q.text), citeChips(m, q.cites, ls));
      return it;
    });
    add(paneSummary, sum);
    add(
      paneSummary,
      el(
        'div',
        'fnote',
        'Every item above cites the transcript line it came from. Counsel extracts these deterministically, with no model in this step — an owner or a date that was not said stays "unknown", and an item with no citation cannot be produced.',
      ),
    );
  }

  function renderTranscriptTab(m) {
    clear(paneTranscript);
    const utterances = m.utterances || [];
    if (utterances.length === 0) {
      add(paneTranscript, el('div', 'cnitem', 'Nothing was transcribed in this call.'));
      return;
    }
    const wrap = el('div', 'cnlines static');
    for (const u of utterances) {
      const row = el('div', 'cnl');
      add(row, el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel(m, u.at) || ''), el('span', null, u.text));
      add(wrap, row);
    }
    add(paneTranscript, wrap);
  }

  function renderExportTab(m) {
    clear(paneExport);
    const cards = el('div', 'live-cards');
    const card = (title, sub, action) => {
      const c = el('div', 'lcard');
      add(c, el('div', 'lk', title), el('div', 'lm', sub));
      const row = el('div', 'lr');
      add(row, action);
      add(c, row);
      return c;
    };
    add(cards, card('Markdown', 'summary + transcript · human-readable', btn('laction cy', 'Save .md', () => exportCall(m, 'md'))));
    add(cards, card('JSON', 'structured · citations preserved', btn('laction cy', 'Save .json', () => exportCall(m, 'json'))));
    const pdfBtn = btn('laction', 'Save .pdf', () => {});
    pdfBtn.disabled = true;
    pdfBtn.title = 'Not available — this daemon has no PDF renderer.';
    add(cards, card('PDF', 'not available on this daemon', pdfBtn));
    add(paneExport, cards);
  }

  function renderEmailTab(m) {
    clear(paneEmail);
    const card = el('div', 'cncard');
    card.style.cssText = 'max-width:640px;margin:0';
    const h = el('div', 'cnh');
    add(h, el('h2', null, 'Email the summary'), el('p', null, 'A draft for your review. Nothing is sent until you authorize it — and delivery needs a mail provider, which this daemon does not have.'));
    add(card, h);
    const row = el('div', 'cnrow2');
    const toCol = el('div');
    add(toCol, el('div', 'lab', 'To'));
    const toInput = el('input', 'cninput');
    toInput.type = 'email';
    toInput.placeholder = 'you@example.com';
    add(toCol, toInput);
    const incCol = el('div');
    add(incCol, el('div', 'lab', 'Includes'), pill('wt', 'summary · decisions · actions · no transcript'));
    add(row, toCol, incCol);
    add(card, row);
    add(card, el('pre', 'cnmail', emailDraftText(m)));
    const acts = el('div', 'caps-acts');
    const sendBtn = btn('btn p', 'Authorize and send', () => {
      statePill.className = 'pill am';
      clear(statePill);
      add(statePill, el('span', 'd'), document.createTextNode('not configured — this daemon has no mail provider; nothing left this machine'));
      sendBtn.disabled = true;
    });
    const editBtn = btn('btn g', 'Edit draft', () => { toInput.focus(); });
    const statePill = pill('wt', 'not configured — no mail provider');
    add(acts, sendBtn, editBtn, el('span', 'fgrow'), statePill);
    add(card, acts);
    add(
      card,
      el(
        'div',
        'fnote-i',
        'Status is one of: not configured · ready to send · sending · provider-accepted · delivered · retry scheduled · failed. A preview is never called sent.',
      ),
    );
    add(paneEmail, card);
  }

  /* =================================================================== *
   * C · SAVED-MEETING Q&A — POST /counsel/ask (across the whole archive, *
   *     not scoped to one call — the hint text under it says so)        *
   * =================================================================== */

  function renderAskTab() {
    clear(paneAsk);
    const turns = el('div');
    turns.style.cssText = 'display:flex;flex-direction:column;gap:16px';
    if (S.thread.length === 0) {
      add(turns, el('div', 'cnitem', 'Nothing asked yet. Answers are read from your saved calls and every claim has to cite a real line — when it cannot, you are told that instead.'));
    } else {
      for (const t of S.thread) {
        const you = el('div', 'turn you');
        add(you, el('div', 'who', 'Y'), add(el('div', 'bt'), el('p', null, t.question)));
        add(turns, you);
        const z = el('div', 'turn z');
        add(z, el('div', 'who', 'Z'));
        const bt = el('div', 'bt');
        add(bt, t.node);
        add(z, bt);
        add(turns, z);
      }
    }
    add(paneAsk, turns);

    const composer = el('div', 'composer');
    composer.style.cssText = 'width:100%';
    const row = el('div', 'row');
    const textarea = el('textarea');
    textarea.rows = 1;
    textarea.placeholder = 'Ask about your saved calls — answers cite the transcript';
    textarea.value = S.askDraft;
    textarea.disabled = S.asking || S.archive !== 'ok' || CALL !== null;
    textarea.addEventListener('input', () => { S.askDraft = textarea.value; });
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask1(textarea.value); } });
    const sendBtn = btn('cbtn send', '↑', () => ask1(textarea.value));
    sendBtn.disabled = textarea.disabled;
    add(row, textarea, sendBtn);
    const foot = el('div', 'foot');
    add(foot, pill('gr', 'grounded in your saved calls only'), el('span', 'grow'), el('span', null, CALL ? 'off while a meeting is recording' : "when it isn't there, it says so"));
    add(composer, row, foot);
    add(paneAsk, composer);

    if (!S.asking && document.activeElement === textarea && S.askDraft !== '') {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  async function ask1(qRaw) {
    const question = String(qRaw || '').trim();
    if (!question || S.asking || S.archive !== 'ok' || CALL !== null) return;
    S.asking = true;
    S.askDraft = '';
    const entry = { question, node: el('p', null, 'Asking the local model…') };
    S.thread.push(entry);
    renderAskTab();

    const r = await call('POST', '/counsel/ask', { question });
    S.asking = false;
    if (!r.ok) {
      entry.node = answerNode({ transportError: `${r.message} ${r.resolve}`.trim() }, question);
    } else {
      await warmCache(((r.data && r.data.hits) || []).map((h) => h.id));
      entry.node = answerNode(r.data || {}, question);
    }
    if (S.activeTab === 'ask') renderAskTab();
  }

  async function warmCache(ids) {
    for (const id of ids) {
      if (!id || cache.has(id)) continue;
      const r = await call('GET', `/counsel/meetings/${encodeURIComponent(id)}`);
      if (r.ok && r.data && r.data.meeting) cache.set(id, r.data.meeting);
    }
  }

  function lookupCite(id) {
    for (const m of cache.values()) {
      if (m.id === id) return { meeting: m, line: null };
      for (const u of m.utterances || []) if (u.id === id) return { meeting: m, line: u };
    }
    return null;
  }

  /**
   * The answer — and the four ways it can fail to be one. Each is rendered as
   * what it is, and none of them is dressed up as an answer.
   */
  function answerNode(d, question) {
    if (d.transportError) {
      const p = el('p', null, `No answer — the request did not get through. ${d.transportError}`);
      return p;
    }
    if (d.ok === false) {
      const wrap = el('div');
      add(wrap, el('p', null, `No answer: the local model is not available. ${d.note || 'The daemon could not reach a local model.'}`));
      add(wrap, el('p', null, 'Your calls are still on disk and still readable here. Nothing was sent anywhere.'));
      if (d.model) add(wrap, pill('am', `model: ${d.model}`));
      return wrap;
    }
    const hits = Array.isArray(d.hits) ? d.hits : [];
    if (hits.length === 0) {
      const wrap = el('div');
      add(wrap, el('p', null, d.answer || 'I could not find that in your meetings.'));
      add(wrap, el('p', null, d.note || 'No meeting in your archive matched that question, so nothing was sent to a model.'));
      return wrap;
    }

    const grounded = d.grounded !== false;
    const said = grounded ? d.answer : d.unverified;
    const wrap = el('div');
    add(wrap, el('p', null, said ? String(said) : 'The model returned nothing to quote here.'));

    if (!grounded) {
      add(wrap, el('p', null, d.note || 'Part of this carries no citation, so it is not supported by your meetings.'));
      if (Array.isArray(d.fabricated) && d.fabricated.length) {
        const ul = el('ul');
        for (const id of d.fabricated) add(ul, el('li', null, `cited "${id}" — no call of yours contains that id`));
        add(wrap, ul);
      }
      if (Array.isArray(d.ungrounded) && d.ungrounded.length) {
        const ul = el('ul');
        for (const c of d.ungrounded.slice(0, 6)) add(ul, el('li', null, `uncited: ${c}`));
        if (d.ungrounded.length > 6) add(ul, el('li', null, `+${d.ungrounded.length - 6} more uncited claims`));
        add(wrap, ul);
      }
      add(wrap, pill('am', 'NOT GROUNDED — shown as what the model said, not as an answer'));
      return wrap;
    }

    const cites = Array.isArray(d.cites) ? d.cites : [];
    const row = el('p');
    if (cites.length === 0) {
      add(row, document.createTextNode('cites: none'));
    } else {
      add(row, document.createTextNode('cites: '));
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
            quote = el('div', 'cnquote');
            if (found.line) add(quote, el('b', null, found.line.speaker || 'unknown'), document.createTextNode(found.line.text));
            else add(quote, el('b', null, 'call'), document.createTextNode(found.meeting.title || found.meeting.id));
            chip.insertAdjacentElement('afterend', quote);
          });
        }
        add(row, chip, document.createTextNode(' '));
      }
    }
    add(wrap, row);
    add(wrap, pill('gr', d.model ? `GROUNDED · ${d.model} · local` : 'GROUNDED — every claim cites a line of a real call'));
    return wrap;
  }

  /* =================================================================== *
   * D · PREFLIGHT — the gate before capture. Every check here was really *
   *     made; a check this browser will not let us make says so.        *
   * =================================================================== */

  function goPreflight() {
    if (CALL) { showView('live'); return; }
    if (PRE) { showView('preflight'); return; }
    PRE = {
      title: '',
      consentTold: false,
      consentMicOnly: false,
      meetingCandidates: [],
      selectedMeetingKey: '',
      beginPending: false,
      checks: {
        mic: { state: 'checking', text: 'checking…' },
        model: { state: 'checking', text: 'checking…' },
        meeting: { state: 'checking', text: 'checking local meeting windows…' },
      },
    };
    showView('preflight');
    renderPreflight();
    runChecks(PRE);
  }

  function runChecks(p) {
    function setMic(state, text) { if (PRE === p) { p.checks.mic = { state, text }; renderPreflight(); } }
    function setModel(state, text) { if (PRE === p) { p.checks.model = { state, text }; renderPreflight(); } }

    if (!SpeechRecognition) { setMic('no', 'no speech engine in this browser'); }
    else if (localSpeech) { setMic('unverified', 'local Whisper — checked when capture starts'); }
    else {
      (async () => {
        let hasInput = null;
        try {
          const devs = await navigator.mediaDevices.enumerateDevices();
          hasInput = devs.some((dev) => dev.kind === 'audioinput');
        } catch { hasInput = null; }
        if (hasInput === false) return setMic('no', 'no microphone on this machine');
        let perm = null;
        try { perm = await navigator.permissions.query({ name: 'microphone' }); } catch { perm = null; }
        if (!perm) return setMic('unverified', 'not verified — the browser will ask when capture starts');
        const apply = () => {
          if (perm.state === 'granted') setMic('ok', 'permission granted ✓');
          else if (perm.state === 'denied') setMic('no', 'permission denied');
          else setMic('unverified', 'not verified — the browser will ask when capture starts');
        };
        apply();
        perm.onchange = apply;
      })();
    }

    (async () => {
      const r = await call('GET', '/forge/agents');
      if (!r.ok) return setModel('unverified', 'not verified — the daemon did not answer');
      const models = (r.data && Array.isArray(r.data.localModels) ? r.data.localModels : []).filter(Boolean);
      if (models.length === 0) return setModel('unverified', 'no local model found — the chat cannot answer');
      const shown = models.slice(0, 2).join(', ') + (models.length > 2 ? ` +${models.length - 2}` : '');
      return setModel('ok', `local ✓ · ${shown}`);
    })();

    (async () => {
      const presence = await readMeetingPresence();
      if (PRE !== p) return; // the dialog closed, or a newer preflight opened, under us
      p.meetingCandidates = presence.candidates;
      if (p.selectedMeetingKey && !presence.candidates.some((c) => c.key === p.selectedMeetingKey)) {
        p.selectedMeetingKey = '';
      }
      if (presence.status === 'detected') {
        p.checks.meeting = {
          state: 'ok',
          text: `${presence.candidates.length} supported meeting window${presence.candidates.length === 1 ? '' : 's'} found`,
        };
      } else if (presence.status === 'none') {
        p.checks.meeting = { state: 'unverified', text: 'no supported meeting window found · manual capture only' };
      } else {
        p.checks.meeting = { state: 'unverified', text: 'window detection unavailable · manual capture only' };
      }
      renderPreflight();
    })();
  }

  function closePreflight() {
    PRE = null;
  }

  /** Every row this dialog shows reports a check that was actually made; a row that cannot be verified says so. */
  function prow(parent, label, check, note) {
    const r = el('div', 'prow');
    r.dataset.check = check.state;
    add(r, el('span', 'pl', label), el('span', 'pv', check.text));
    add(parent, r);
    if (note) add(parent, el('div', 'prenote', note));
  }

  function canBegin() {
    return whyNotBegin() === null;
  }

  /**
   * The ONE reason capture cannot start yet, in the owner's words — or null.
   * A disabled button that gives no reason is indistinguishable from a broken
   * one, so every precondition here has to say which box is still unticked.
   */
  function whyNotBegin() {
    if (!PRE) return 'The preflight is not open.';
    if (PRE.beginPending) return 'Checking that the selected meeting window is still present…';
    if (String(PRE.title || '').trim().length === 0) return 'Name the call first, in the box above.';
    if (!PRE.consentTold) return 'Tick the first box — everyone in the room needs to know they are being recorded.';
    if (!PRE.consentMicOnly) return 'Tick the second box — this only captures your microphone.';
    if (PRE.checks.mic.state === 'no') return 'This page has no usable microphone, so there would be nothing to record.';
    if (S.archive !== 'ok') return 'The meeting archive could not be read, so there would be nowhere to save this call.';
    return null;
  }

  function renderPreflight() {
    if (!PRE) return;
    // A row of async checks (mic, model, meeting window) rerenders this dialog
    // while the owner may already be typing in it. Rebuilding fresh nodes on
    // every render must not cost the field its focus or the caret position
    // mid-keystroke, so both are captured here and restored below.
    const active = document.activeElement;
    const activeId = active && viewPreflight.contains(active) ? active.id : '';
    const caretStart = activeId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const caretEnd = activeId && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    clear(viewPreflight);
    const card = el('div', 'cncard');

    const h = el('div', 'cnh');
    add(h, el('h2', null, 'Before you record'), el('p', null, "Counsel won't start until both of these are true."));
    add(card, h);

    const chk1 = el('label', 'cnchk');
    const in1 = el('input');
    in1.type = 'checkbox';
    in1.checked = PRE.consentTold;
    in1.addEventListener('change', () => { PRE.consentTold = in1.checked; renderPreflight(); });
    add(chk1, in1, el('b', null, "Everyone in this meeting has been told it's being recorded."), el('span', null, 'Say it out loud. Counsel records only with consent.'));
    add(card, chk1);

    const chk2 = el('label', 'cnchk');
    const in2 = el('input');
    in2.type = 'checkbox';
    in2.checked = PRE.consentMicOnly;
    in2.addEventListener('change', () => { PRE.consentMicOnly = in2.checked; renderPreflight(); });
    add(chk2, in2, el('b', null, 'I understand this captures my microphone only.'), el('span', null, 'Not system audio, not the other side of a call. Remote speakers are labelled "unknown" unless you name them.'));
    add(card, chk2);

    const row1 = el('div', 'cnrow2');
    const titleCol = el('div');
    add(titleCol, el('div', 'lab', 'Title'));
    const titleInput = el('input', 'cninput');
    titleInput.id = 'zc-pre-title';
    titleInput.value = PRE.title;
    titleInput.placeholder = 'Design review';
    titleInput.addEventListener('input', () => { PRE.title = titleInput.value; syncHint(); });
    add(titleCol, titleInput);
    const transCol = el('div');
    add(transCol, el('div', 'lab', 'Transcription'));
    add(transCol, localSpeech
      ? pill('gr', 'local · whisper · nothing leaves this machine')
      : (SpeechRecognition ? pill('am', 'browser speech · may leave this machine to transcribe') : pill('rd', 'no speech engine in this browser')));
    add(row1, titleCol, transCol);
    add(card, row1);

    prow(card, 'microphone', PRE.checks.mic);
    prow(
      card,
      'meeting window',
      PRE.checks.meeting,
      'the desktop checks only the names of capturable windows, without screenshots or icons. A match proves that a supported meeting window exists, not that you joined it or that its audio is captured',
    );

    const sources = el('div', 'pre-source-list');
    const manual = el('label', 'pre-source');
    const manualBox = el('input');
    manualBox.type = 'checkbox';
    manualBox.id = 'zc-source-manual';
    manualBox.checked = PRE.selectedMeetingKey === '';
    manualBox.addEventListener('change', () => {
      if (!manualBox.checked) return;
      PRE.selectedMeetingKey = '';
      renderPreflight();
    });
    add(manual, manualBox, el('span', null, 'Manual microphone capture — no external application is attached.'));
    add(sources, manual);
    for (const candidate of PRE.meetingCandidates || []) {
      const option = el('label', 'pre-source');
      const box = el('input');
      box.type = 'checkbox';
      box.id = `zc-source-${candidate.key}`;
      box.checked = PRE.selectedMeetingKey === candidate.key;
      box.addEventListener('change', () => {
        if (!box.checked) return;
        PRE.selectedMeetingKey = candidate.key;
        renderPreflight();
      });
      add(option, box, el('span', null, `Attach to ${candidate.provider} — ${candidate.title}`));
      add(sources, option);
    }
    add(card, sources);

    const row2 = el('div', 'cnrow2');
    const savedCol = el('div');
    add(savedCol, el('div', 'lab', 'What gets saved'), pill('wt', 'text only — the transcript. Notes are not sent anywhere.'));
    const modelCol = el('div');
    add(modelCol, el('div', 'lab', 'Summary model'));
    const modelPillClass = PRE.checks.model.state === 'ok' ? 'cy' : PRE.checks.model.state === 'no' ? 'rd' : 'am';
    add(modelCol, pill(PRE.checks.model.state === 'checking' ? 'wt' : modelPillClass, PRE.checks.model.text));
    add(row2, savedCol, modelCol);
    add(card, row2);

    const acts = el('div', 'caps-acts');
    const startBtn = btn('btn p', PRE.selectedMeetingKey ? 'Attach & start recording' : 'Start recording', () => beginCall());
    startBtn.disabled = !!whyNotBegin();
    const cancelBtn = btn('btn g', 'Cancel', () => { closePreflight(); goArchive(); });
    add(acts, startBtn, cancelBtn);
    add(card, acts);

    const hint = el('p', 'cnnote');
    function syncHint() {
      const why = whyNotBegin();
      hint.textContent = why || '';
      startBtn.disabled = !!why;
    }
    syncHint();
    add(card, hint);
    if (S.archive !== 'ok') {
      add(card, el('p', 'cnnote warn', 'Capture is blocked because the archive is not readable: a recorded call would have nowhere to be saved.'));
    }

    add(viewPreflight, card);

    const restored = activeId ? document.getElementById(activeId) : null;
    if (restored && viewPreflight.contains(restored)) {
      restored.focus();
      if (caretStart !== null && typeof restored.setSelectionRange === 'function') {
        const end = caretEnd === null ? caretStart : caretEnd;
        try { restored.setSelectionRange(caretStart, end); } catch { /* checkbox or unsupported input */ }
      }
    } else if (document.activeElement !== titleInput && document.activeElement !== in1 && document.activeElement !== in2) {
      titleInput.focus();
    }
  }

  /** Treat the preload's native meeting-window lookup as bounded, untrusted data. */
  async function readMeetingPresence() {
    const detector = window.zenoMeeting;
    if (!detector || typeof detector.detect !== 'function') {
      return { status: 'unavailable', candidates: [], checkedAt: null };
    }
    try {
      return normalizeMeetingPresence(await detector.detect());
    } catch {
      return { status: 'unavailable', candidates: [], checkedAt: null };
    }
  }

  /* =================================================================== *
   * E · THE LIVE CALL. No Assist here, and there will not be one.       *
   * =================================================================== */

  async function beginCall() {
    if (!PRE || !canBegin() || CALL) return;
    const preflight = PRE;
    // A window picked in the preflight can close, or the meeting can end,
    // in the time between selecting it and pressing Start. Re-confirm it is
    // still there right before capture opens rather than trusting a stale pick.
    let attachedMeeting = null;
    if (preflight.selectedMeetingKey) {
      preflight.beginPending = true;
      preflight.checks.meeting = { state: 'checking', text: 'confirming the selected meeting window…' };
      renderPreflight();
      const presence = await readMeetingPresence();
      if (!PRE || PRE !== preflight || CALL) return;
      preflight.beginPending = false;
      attachedMeeting = presence.candidates.find((candidate) => candidate.key === preflight.selectedMeetingKey) || null;
      if (!attachedMeeting) {
        preflight.selectedMeetingKey = '';
        preflight.meetingCandidates = presence.candidates;
        preflight.checks.meeting = {
          state: 'unverified',
          text: 'the selected meeting window is no longer present · capture did not start',
        };
        renderPreflight();
        return;
      }
    }
    if (!canBegin()) return;
    const title = preflight.title.trim();
    closePreflight();

    CALL = {
      title,
      participants: [],
      utterances: [],
      notes: '',
      seq: 0,
      speaker: 'unknown', // nothing is detected; unknown until the owner says
      interim: '',
      startedAt: Date.now(),
      recognition: null,
      want: false,
      running: false,
      paused: false,
      saving: false,
      note: null,
      noteTone: 'warn',
      tick: 0,
    };
    document.body.dataset.zenoCapture = 'counsel';
    liveTextarea.value = '';
    showView('live');
    renderLive();
    startEngine();
    CALL.tick = window.setInterval(() => {
      if (!CALL) return;
      liveTimer.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    }, 1000);
    announce('Preparing microphone.');
  }

  async function startEngine() {
    if (!CALL || !SpeechRecognition) return;
    const session = CALL;
    session.want = true;
    session.note = 'Preparing microphone. Command listening is paused while this call records.';
    const handoff = { waiters: [], requestedBy: 'Counsel' };
    window.dispatchEvent(new CustomEvent('zeno:release-command-voice', { detail: handoff }));
    try {
      await Promise.all(handoff.waiters);
      await waitForSpeechIdle();
    } catch {
      if (CALL === session) {
        session.want = false;
        session.note = 'The previous microphone session did not close. Stop Command listening, then discard and retry this call.';
        session.noteTone = 'error';
        renderLive();
      }
      return;
    }
    if (CALL !== session || !session.want) return;
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.initialPrompt = counselSpeechPrompt(session.title, session.participants);
    // Snapshot the speaker tag the instant a segment of audio starts, so a
    // later change to who is talking cannot retroactively relabel audio that
    // was already captured while transcription for it is still in flight.
    rec.onsegmentstart = () => session.speaker;

    rec.onstart = () => {
      if (CALL !== session || session.recognition !== rec || !session.want) {
        try { rec.abort(); } catch { /* already stopped */ }
        return;
      }
      session.running = true;
      session.note = null;
      announce('Recording started.');
      renderLive();
    };

    rec.onresult = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (!res || !res[0]) continue;
        if (res.isFinal) commit(res[0].transcript, event.segmentMeta);
        else interim += res[0].transcript;
      }
      CALL.interim = interim;
      renderLive();
    };

    rec.onerror = (event) => {
      if (CALL !== session || session.recognition !== rec) return;
      const err = (event && event.error) || 'unknown';
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        CALL.want = false;
        CALL.running = false;
        CALL.note = 'Microphone access was refused, so capture stopped. Nothing was heard while it was blocked.';
        CALL.noteTone = 'error';
        try { rec.stop(); } catch { /* already stopped */ }
        renderLive();
        return;
      }
      if (err === 'no-speech' || err === 'aborted') return; // ordinary silence
      CALL.want = false;
      CALL.running = false;
      CALL.note = err === 'network'
        ? 'The browser speech service is unavailable. Capture stopped; no automatic retries.'
        : `Speech recognition failed (${err}). Capture stopped.`;
      CALL.noteTone = 'error';
      try { rec.abort(); } catch { /* already stopped */ }
      renderLive();
    };

    rec.onend = () => {
      if (CALL !== session || session.recognition !== rec) return;
      session.enginePending = false;
      session.endResolve?.(true);
      session.endResolve = null;
      if (CALL.want) {
        session.enginePending = true;
        try { rec.start(); } catch { session.enginePending = false; session.want = false; session.running = false; renderLive(); }
        return;
      }
      CALL.running = false;
      renderLive();
    };

    CALL.recognition = rec;
    CALL.want = true;
    CALL.running = false;
    CALL.enginePending = true;
    try {
      rec.start();
    } catch {
      session.enginePending = false; session.want = false;
      session.note = 'Microphone could not start. Stop other listening and retry.';
      session.noteTone = 'error'; renderLive();
    }
  }

  function commit(text, capturedSpeaker) {
    const t = String(text || '').trim();
    if (!CALL || !t) return;
    // A speaker tag changed after audio started must not rewrite queued audio:
    // use the tag captured at segment start, and only if it is one of the
    // three real values this surface ever assigns.
    const speaker = capturedSpeaker === 'owner' || capturedSpeaker === 'other' || capturedSpeaker === 'unknown'
      ? capturedSpeaker
      : CALL.speaker;
    CALL.utterances.push({ id: `u${CALL.seq++}`, at: new Date().toISOString(), speaker, text: t });
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
    await startEngine();
  }

  function renderLive() {
    if (!CALL) return;
    livebar.classList.toggle('paused', CALL.paused || (!CALL.running && !CALL.want));
    liveLabel.textContent = CALL.paused ? 'PAUSED' : CALL.running ? 'RECORDING' : CALL.want ? 'RECONNECTING…' : 'STOPPED · not recording';
    liveDot.style.animationPlayState = CALL.paused ? 'paused' : 'running';
    liveDot.style.opacity = CALL.paused ? '.4' : '1';
    liveTimer.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    clear(liveStatePill);
    const stateInfo = CALL.paused
      ? ['wt', 'mic: paused']
      : CALL.running
        ? ['cy', 'mic: live']
        : CALL.want
          ? ['am', 'mic: reconnecting…']
          : ['rd', 'mic: stopped'];
    liveStatePill.className = `pill ${stateInfo[0]}`;
    if (stateInfo[0] === 'cy' || stateInfo[0] === 'am') add(liveStatePill, el('span', 'd'));
    add(liveStatePill, document.createTextNode(stateInfo[1]));
    livePauseBtn.textContent = CALL.paused ? 'Resume' : 'Pause';
    livePauseBtn.disabled = CALL.saving;
    liveDiscardBtn.disabled = CALL.saving;
    liveEndBtn.disabled = CALL.saving;
    liveEndBtn.textContent = CALL.saving ? 'Saving…' : 'End meeting';

    clear(liveLines);
    const last = CALL.utterances.slice(-8);
    if (last.length === 0) {
      add(liveLines, el('div', null, 'Nothing transcribed yet. Lines appear here as the engine finalises them.'));
    } else {
      last.forEach((u, i) => {
        const row = el('div', `cnl${i === last.length - 1 ? ' now' : ''}`);
        add(row, el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel({ startedAt: new Date(CALL.startedAt).toISOString() }, u.at) || ''), el('span', null, u.text));
        add(liveLines, row);
      });
    }
    if (CALL.interim) {
      const row = el('div', 'cnl');
      row.style.opacity = '.6';
      add(row, el('span', 'cnw', 'hearing'), el('span', 'cnt2', ''), el('span', null, CALL.interim));
      add(liveLines, row);
    }
    if (CALL.note) {
      const n = el('div', `cnnote ${CALL.noteTone === 'error' ? 'err' : 'warn'}`, CALL.note);
      add(liveLines, n);
    }
    liveLines.scrollTop = liveLines.scrollHeight;
  }

  function stopEngine(discard = false, session = CALL) {
    if (!session) return Promise.resolve(true);
    session.want = false;
    const rec = session.recognition;
    if (discard) {
      session.endResolve?.(false);
      session.endResolve = null;
      session.running = false;
      session.enginePending = false;
      try { rec?.abort(); } catch { /* already stopped */ }
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

  function teardownCall() {
    if (!CALL) return;
    void stopEngine(true);
    if (CALL.tick) window.clearInterval(CALL.tick);
    CALL = null;
    delete document.body.dataset.zenoCapture;
  }

  /**
   * Discarding throws away the whole recording, transcript and notes — there
   * is no undo and nothing is written to Vault. Confirm before tearing it
   * down so a mis-click during a live meeting cannot silently lose it.
   */
  function discardCall() {
    if (!CALL || CALL.saving) return;
    const heard = Array.isArray(CALL.utterances) ? CALL.utterances.length : 0;
    const warn = 'Discard this recording?\n\nThe transcript' + (heard ? ' (' + heard + ' line' + (heard === 1 ? '' : 's') + ' so far)' : '')
      + ' and any notes are dropped and nothing is saved to Vault. This cannot be undone.';
    if (typeof window.confirm === 'function' && !window.confirm(warn)) return;
    teardownCall();
    announce('Recording discarded. Nothing was saved.');
  }

  /**
   * End the call. The live view stays up, still saying "Saving…", until the
   * daemon answers: a call is not saved because a button was pressed, it is
   * saved because POST /counsel/meetings returned the meeting it actually wrote.
   */
  async function endCall() {
    if (!CALL || CALL.saving) return;
    const session = CALL;
    session.saving = true;
    renderLive();
    await stopEngine(false, session);
    if (CALL !== session) return;
    if (CALL.utterances.length === 0) {
      CALL.saving = false;
      CALL.note = 'Nothing was transcribed, so there is nothing to save. Start again, or leave the call to end it without saving.';
      CALL.noteTone = 'warn';
      renderLive();
      return;
    }
    CALL.saving = true;
    renderLive();

    const r = await call('POST', '/counsel/meetings', {
      title: CALL.title,
      participants: CALL.participants,
      utterances: CALL.utterances.map((u) => ({ id: u.id, at: u.at, speaker: u.speaker, text: u.text })),
    });

    if (CALL !== session) return;
    if (!r.ok) {
      CALL.saving = false;
      CALL.note = `Not saved: ${r.message} ${r.resolve}`.trim();
      CALL.noteTone = 'error';
      renderLive();
      return;
    }

    const saved = r.data && r.data.meeting;
    if (
      !saved ||
      typeof saved.id !== 'string' ||
      saved.id.trim() === '' ||
      !Array.isArray(saved.utterances) ||
      saved.utterances.length !== session.utterances.length
    ) {
      CALL.saving = false;
      CALL.note = 'Save outcome unknown: the daemon answered without a complete saved-meeting record. Check the archive before trying again.';
      CALL.noteTone = 'error';
      renderLive();
      return;
    }
    const redacted = (r.data && r.data.redacted) || 0;
    teardownCall();
    announce(session.captureIncomplete ? 'Call saved. The final microphone result did not settle before timeout; the final phrase may be incomplete.' : 'Call saved.');
    await loadArchive();
    if (saved && saved.id) {
      cache.set(saved.id, saved);
      if (redacted > 0) {
        S.redactedNote = `${redacted} secret-like string${redacted === 1 ? ' was' : 's were'} redacted before this call was written to disk.`;
      }
      await select(saved.id);
    }
  }

  /* =================================================================== *
   * F · boot                                                            *
   * =================================================================== */

  if (!OWNER_TOKEN) {
    // A window opened without the launch nonce is handed no token, and every
    // Counsel route is authenticated. Say that once, plainly.
    S.archive = 'error';
    S.archiveNote =
      'This window was not handed an owner token, so the daemon refuses every Counsel route. Open the window ' +
      'from the Zeno launch link rather than by typing the address.';
  }

  if (!SpeechRecognition) {
    sideRecordBtn.disabled = true;
    sideRecordBtn.title = 'This browser has no Web Speech API, so Counsel cannot record here.';
    heroRecordBtn.disabled = true;
    heroRecordBtn.title = sideRecordBtn.title;
    const note = el('p', 'cnnote warn', 'This browser has no Web Speech API, so a call cannot be recorded here. Reading, summarising and asking about saved calls all still work.');
    hero.insertBefore(note, guard);
  }

  renderSidebar();
  if (OWNER_TOKEN) loadArchive();

  window.addEventListener('beforeunload', (e) => {
    if (CALL && CALL.utterances.length > 0 && !CALL.saving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* nav.js calls mod.init || mod.default; the brief names the export initCounsel. */
export { initCounsel as init };
export default initCounsel;
