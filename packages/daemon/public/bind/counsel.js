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
 * sent), and questions are refused while a call is live. That last one is
 * enforced in TWO places on purpose: the composer is disabled (and says
 * why), and `ask1` refuses outright. Hiding the post-call view is not a
 * boundary — the pane is still in the DOM, and a disabled attribute is one
 * devtools click from gone — so the composer is re-rendered on every change
 * to the three things that gate it (a live call, the archive state, an ask
 * in flight). Where the artifact's static copy overclaims (e.g. that notes are
 * "saved with the transcript", when POST /counsel/meetings never accepts a
 * notes field), this binder corrects the copy rather than leaving a false
 * claim standing next to real behaviour.
 *
 * ---------------------------------------------------------------------------
 * MODULE SPLIT — read before moving anything.
 *
 * Most of the product now lives under bind/counsel/*.js, imported below as
 * small `make*(deps)` factories — `deps` is always a live read/write into
 * THIS file's own state (a getter/setter callback, or a stable element
 * reference), never a copy.
 *
 * What stays here, unmoved, is fixed by packages/desktop/test/
 * capture-lifecycle.test.cjs: it reads THIS file as text and slices out
 * `armEngine`, `startEngine`, `commit`, `stopEngine`, `teardownCall`,
 * `discardCall`, `endCall`, `loadArchive`, `ask1`, `ensureMeetingSourcesBox`,
 * `renderMeetingSources`, `refreshMeetingCandidates`, `readMeetingPresence`,
 * `beginCall` (each a nested `function`, declared directly in `bindCounsel()`
 * at 2-space indent) and `counselSpeechPrompt`, `postJSON`,
 * `normalizeMeetingPresence` (each a top-level `function`, 0 indent) BY NAME,
 * to run the real handler logic against a fake DOM/network in isolation.
 *
 * The test finds each one by name, then treats the NEXT declared `function`
 * at that same indent — anywhere later in the file, whatever its name — as
 * that handler's end. So every wiring `const` below is grouped in ONE block,
 * before any of these 14 functions: a wiring statement left sitting BETWEEN
 * two of them would get glued onto the end of whichever one comes first, and
 * that handler's test would then fail on something the fake DOM/network was
 * never given (this shipped broken once already — see git blame). The 14
 * functions may otherwise only be separated by comments, blank lines, or each
 * other; nothing that declares a further `function` at their indent.
 * ---------------------------------------------------------------------------
 */

import { getJSON, $, $$, el, fill, authHeaders, token } from '../bind.js';
import { SpeechRecognition, waitForSpeechIdle } from '../whisper.js';
import { fmtElapsed } from './counsel/format.js';
import { makeArchiveList } from './counsel/archive-list.js';
import { makeRenderPost } from './counsel/post-view.js';
import { makeAskView } from './counsel/ask-view.js';
import { makeRenderLive, makeTogglePause, applyStaticCopyFixups } from './counsel/live-view.js';
import { initPreflightPills, makeComputeAndSetMic, disableIfNoSpeechEngine } from './counsel/preflight-support.js';

export async function bind() {
  try {
    await bindCounsel();
  } catch (err) {
    console.warn('[zeno] counsel binder failed:', err);
  }
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
 *  never an instruction, so it cannot teach silence to hallucinate. Takes the
 *  call's participants too (named speakers help the recognizer far more than
 *  the fixed product-term list alone), even though this surface has no input
 *  that populates them yet — the same forward-compatible plumbing root's
 *  Counsel kept for a future "name the participants" field. */
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
    const term = String(value || '').replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    const key = term.toLocaleLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    clean.push(term);
  }
  return clean.join(', ').slice(0, 512);
}

/** Treat even the trusted preload response as bounded data at the renderer
 *  edge — ported verbatim from root counsel.js, which restored this after an
 *  earlier relayout dropped it: a stale "attached meeting" cannot silently
 *  start capture unless every field here is validated first. */
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
      .replace(/[ -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48);
    const title = String((item && item.title) || '')
      .replace(/[ -]/g, ' ')
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
  const preflightCard = $('.cnview[data-cnview="preflight"] .cncard', root);

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

  /* A Discard control the artifact's markup never drew: it has no button for
     it at all, so there is nothing to clone-and-rewire here — it is created
     fresh, right beside Pause, the same way `hintEl` below is created fresh
     for the preflight card. Throwing away a live recording needs one click
     with a confirmation, not a mis-click away from losing it, and not a
     forced End-twice with no dedicated affordance either. */
  const discardBtn = (() => {
    if (!pauseBtn || !pauseBtn.parentElement) return null;
    const b = el('button', 'btn g sm', 'Discard');
    b.type = 'button';
    b.title = 'Throw away this recording — no undo, nothing saved to Vault.';
    pauseBtn.insertAdjacentElement('afterend', b);
    return b;
  })();

  /* A screen-reader announcer the artifact's markup does not carry either.
     `.cn-sr` is already declared in screens/counsel.css (root counsel.js uses
     the same class) — visually hidden, read by assistive tech only. */
  const liveRegion = (() => {
    const cn = $('.cn', root) || root;
    const p = document.createElement('p');
    p.className = 'cn-sr';
    p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite');
    cn.appendChild(p);
    return p;
  })();
  function announce(msg) {
    liveRegion.textContent = msg;
  }

  /* A hint line the preflight card's markup does not carry either — built
     fresh, same technique as `discardBtn`/`liveRegion` above. */
  let hintEl = null;
  if (preflightCard) {
    hintEl = document.createElement('p');
    hintEl.style.cssText = 'font-size:12px;color:var(--amber);margin:0';
    preflightCard.appendChild(hintEl);
  }

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
  let lastRedactedId = null;
  let lastRedactedCount = 0;
  let micState = 'checking'; // checking | ok | no | unverified
  let askThread = []; // {question, node} — real across the whole archive
  let asking = false;
  let CALL = null; // the live call; null at rest

  /* The meeting-window attach/detect state the preflight gate needs. The
     artifact's preflight card has no markup for this at all, so the section
     is built and inserted at runtime — same technique as `hintEl` above. */
  let selectedMeetingKey = '';
  let meetingCandidates = [];
  let meetingCheck = { state: 'checking', text: 'checking local meeting windows…' };
  let meetingCheckPending = false; // true only while beginCall is re-confirming a pick

  function showCnView(name) {
    $$('.cnview', root).forEach((v) => v.classList.toggle('on', v.dataset.cnview === name));
    const main = $('.cnmain', root);
    if (main) main.scrollTop = 0;
  }

  /* ---- wire the extracted view modules ---------------------------------
   * ALL of them, together, right here — see the MODULE SPLIT note at the
   * top of this file for why nothing below may be interleaved with the
   * test-extracted functions that follow.
   */
  const { refreshModelInfo } = initPreflightPills(preflightCard);
  const computeAndSetMic = makeComputeAndSetMic({
    setMicState: (v) => { micState = v; },
    syncStartGate: () => syncStartGate(),
  });
  const { renderAskTab, warmCache, answerNode } = makeAskView({
    root,
    cache,
    getState: () => ({ askThread, asking, archiveState, CALL }),
    ask1: (q) => ask1(q),
  });
  const { renderPost } = makeRenderPost({
    root,
    postTitleEl,
    postMetaP,
    getRedacted: () => ({ lastRedactedId, lastRedactedCount }),
    renderAskTab,
  });
  const { renderList, openMeetingById } = makeArchiveList({
    cnList,
    cache,
    retryLoad: () => loadArchive(),
    showCnView,
    renderPost,
    getState: () => ({ archiveState, archiveNote, meetings, failedFiles, selectedId }),
    setSelectedId: (v) => { selectedId = v; },
  });
  const renderLive = makeRenderLive({ root, timerEl, micStatePill, linesBox, pauseBtn, discardBtn, endBtn, getCall: () => CALL });
  const { togglePause } = makeTogglePause({ getCall: () => CALL, renderLive, stopEngine, startEngine });

  /* ================================================================= *
   * C · ask-your-archive — POST /counsel/ask (whole archive, not just  *
   *     the open call; the composer's own footnote says so)           *
   * ================================================================= */

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
    // The Ask composer is enabled only when the archive is readable, so it has
    // to be re-rendered whenever the archive state changes — otherwise it keeps
    // whatever state it was last drawn in (at boot: the artifact's fixture).
    renderAskTab();
  }

  /* ================================================================= *
   * D · preflight — consent + a real mic/model check gate Start        *
   * ================================================================= */

  /* A window picked here can close, or the meeting can end, between the pick
     and pressing Start — beginCall() re-confirms presence right before
     capture opens rather than trusting this stale list. Restored from root
     counsel.js: an earlier relayout of this screen dropped the whole
     attach/detect flow on the theory the artifact's markup showed no control
     for it; the artifact's markup still shows none, so this section is built
     and inserted at runtime rather than lifted from static HTML. */
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

  let meetingSourcesBox = null;
  function ensureMeetingSourcesBox() {
    if (meetingSourcesBox || !preflightCard) return meetingSourcesBox;
    meetingSourcesBox = document.createElement('div');
    meetingSourcesBox.className = 'pre-source-list';
    const capsActs = preflightCard.querySelector('.caps-acts');
    if (capsActs) preflightCard.insertBefore(meetingSourcesBox, capsActs);
    else preflightCard.appendChild(meetingSourcesBox);
    return meetingSourcesBox;
  }

  /** Every row here reflects a check that was actually made; manual capture
   *  is always offered because a detected window only proves a supported
   *  title exists, never that its audio is captured. */
  function renderMeetingSources() {
    const box = ensureMeetingSourcesBox();
    if (!box) return;
    const nodes = [];
    nodes.push(el('div', 'cnnote', `meeting window: ${meetingCheck.text}`));
    const manual = el('label', 'cnchk');
    const manualBox = document.createElement('input');
    manualBox.type = 'checkbox';
    manualBox.checked = selectedMeetingKey === '';
    manualBox.addEventListener('change', () => {
      if (!manualBox.checked) return;
      selectedMeetingKey = '';
      renderMeetingSources();
    });
    manual.append(manualBox, el('b', null, 'Manual microphone capture'), el('span', null, '— no external application is attached.'));
    nodes.push(manual);
    for (const candidate of meetingCandidates) {
      const row = el('label', 'cnchk');
      const box2 = document.createElement('input');
      box2.type = 'checkbox';
      box2.id = `zc-source-${candidate.key}`;
      box2.checked = selectedMeetingKey === candidate.key;
      box2.addEventListener('change', () => {
        if (!box2.checked) return;
        selectedMeetingKey = candidate.key;
        renderMeetingSources();
      });
      row.append(box2, el('b', null, `Attach to ${candidate.provider}`), el('span', null, `— ${candidate.title}`));
      nodes.push(row);
    }
    fill(box, ...nodes);
  }

  async function refreshMeetingCandidates() {
    const presence = await readMeetingPresence();
    meetingCandidates = presence.candidates;
    if (selectedMeetingKey && !presence.candidates.some((c) => c.key === selectedMeetingKey)) {
      selectedMeetingKey = '';
    }
    if (presence.status === 'detected') {
      meetingCheck = {
        state: 'ok',
        text: `${presence.candidates.length} supported meeting window${presence.candidates.length === 1 ? '' : 's'} found`,
      };
    } else if (presence.status === 'none') {
      meetingCheck = { state: 'unverified', text: 'no supported meeting window found · manual capture only' };
    } else {
      meetingCheck = { state: 'unverified', text: 'window detection unavailable · manual capture only' };
    }
    renderMeetingSources();
  }

  function computeWhyDisabled() {
    if (meetingCheckPending) return 'Checking that the selected meeting window is still present…';
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
    selectedMeetingKey = '';
    meetingCandidates = [];
    meetingCheck = { state: 'checking', text: 'checking local meeting windows…' };
    meetingCheckPending = false;
    renderMeetingSources();
    syncStartGate();
    showCnView('preflight');
    void refreshMeetingCandidates();
  }
  if (recordBtn) recordBtn.addEventListener('click', (e) => { e.stopPropagation(); openPreflight(); });
  if (heroRecordBtn) heroRecordBtn.addEventListener('click', (e) => { e.stopPropagation(); openPreflight(); });

  disableIfNoSpeechEngine({ root, recordBtn, heroRecordBtn });

  /* ================================================================= *
   * E · the live call — real capture, real timer, real transcript      *
   * ================================================================= */

  /* A speaker tag changed after audio started must not rewrite queued audio:
   * `capturedSpeaker` is the tag `onsegmentstart` snapshotted the instant that
   * segment began, and is trusted only when it is one of the three real
   * values this surface ever assigns — anything else (segment metadata this
   * engine never sent) falls back to the session's CURRENT tag, same as
   * before this guard existed. There is still no control in this view that
   * changes `session.speaker` — the plumbing is real and forward-compatible
   * (root counsel.js kept it for the same reason) for whenever one ships. */
  function commit(text, capturedSpeaker) {
    const t = String(text || '').trim();
    if (!CALL || !t) return;
    const speaker = capturedSpeaker === 'owner' || capturedSpeaker === 'other' || capturedSpeaker === 'unknown'
      ? capturedSpeaker
      : CALL.speaker;
    CALL.utterances.push({ id: `u${CALL.seq++}`, at: new Date().toISOString(), speaker, text: t });
  }

  function armEngine(session) {
    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.initialPrompt = counselSpeechPrompt(session.title, session.participants);
    // Snapshot the speaker tag at the instant a segment of audio starts, so a
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
        try { rec.start(); } catch {
          // Capture has died and is not coming back. Every other terminal path
          // here says why; this one used to go quiet, leaving the live bar
          // reading "STOPPED · not recording" with no reason beside it.
          session.enginePending = false;
          session.want = false;
          session.running = false;
          session.note = 'The microphone could not be reopened, so capture stopped. Nothing was heard after this point.';
          session.noteTone = 'error';
          renderLive();
        }
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
    /* Draw the state we just moved into. Without this the live bar keeps the
       render from beginCall() — "STOPPED · not recording", "mic: stopped" —
       from the moment the owner presses Start until the engine's own onstart
       fires, and the note above is never shown at all. On a machine where the
       engine never starts (no speech service), that stale line is the only
       thing the owner ever sees, and it says the opposite of what is true. */
    renderLive();
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

  function teardownCall() {
    if (!CALL) return;
    stopEngine(true, CALL);
    if (CALL.tick) window.clearInterval(CALL.tick);
    CALL = null;
    delete document.body.dataset.zenoCapture;
    renderAskTab(); // questions are available again now that nothing is recording
  }

  /**
   * Discarding throws away the whole recording, transcript and notes — there
   * is no undo and nothing is written to Vault. Confirm before tearing it
   * down so a mis-click during a live meeting cannot silently lose it.
   * Restored from root counsel.js: an earlier relayout of this screen dropped
   * this on the theory the artifact's markup showed no control for it — the
   * artifact's markup still shows none, so the button lives beside Pause/End
   * (created above, next to `pauseBtn`) rather than in the static HTML.
   */
  function discardCall() {
    if (!CALL || CALL.saving) return;
    const heard = Array.isArray(CALL.utterances) ? CALL.utterances.length : 0;
    const warn = 'Discard this recording?\n\nThe transcript' + (heard ? ' (' + heard + ' line' + (heard === 1 ? '' : 's') + ' so far)' : '')
      + ' and any notes are dropped and nothing is saved to Vault. This cannot be undone.';
    if (typeof window.confirm === 'function' && !window.confirm(warn)) return;
    teardownCall();
    showCnView('archive');
    announce('Recording discarded. Nothing was saved.');
  }

  async function beginCall() {
    if (CALL || computeWhyDisabled()) return;
    // A window picked in the preflight can close, or the meeting can end, in
    // the time between selecting it and pressing Start. Re-confirm it is
    // still there right before capture opens rather than trusting a stale
    // pick — restored from root counsel.js along with the rest of the
    // meeting-window attach/detect flow.
    if (selectedMeetingKey) {
      meetingCheckPending = true;
      meetingCheck = { state: 'checking', text: 'confirming the selected meeting window…' };
      renderMeetingSources();
      syncStartGate();
      const presence = await readMeetingPresence();
      meetingCheckPending = false;
      if (CALL) return; // a call started from elsewhere while this awaited
      const attached = presence.candidates.find((c) => c.key === selectedMeetingKey) || null;
      if (!attached) {
        selectedMeetingKey = '';
        meetingCandidates = presence.candidates;
        meetingCheck = {
          state: 'unverified',
          text: 'the selected meeting window is no longer present · capture did not start',
        };
        renderMeetingSources();
        syncStartGate();
        return;
      }
    }
    if (CALL || computeWhyDisabled()) return;
    const title = (titleInput && titleInput.value.trim()) || 'Untitled meeting';
    CALL = {
      title,
      participants: [],
      utterances: [],
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
      tick: null,
      captureIncomplete: false,
      emptyPrompted: false,
    };
    document.body.dataset.zenoCapture = 'counsel';
    /* Questions are off for the duration of the call — that is the product's
       promise, not a decoration. The composer has to be re-rendered here or it
       keeps the enabled state it was drawn in before the call started, and a
       "questions are off" screen ships a live question box behind it. */
    renderAskTab();
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
      if (session.emptyPrompted) {
        /* The first press promised that ending again leaves without saving. It
           has to actually leave: otherwise End is a no-op loop, the owner is
           stuck on the live view, and `body.dataset.zenoCapture` is never
           released — which silently keeps Command's voice off for the rest of
           the session. Nothing is written here; there was nothing to write. */
        teardownCall();
        showCnView('archive');
        return;
      }
      session.emptyPrompted = true;
      /* stopEngine() above has already stopped capture, so the call is paused
         in fact. Say that, and make Resume the control that means it, rather
         than telling the owner to "keep recording" at a stopped microphone. */
      CALL.paused = true;
      CALL.note = 'Nothing was transcribed, so there is nothing to save. Capture has stopped — press Resume to keep recording, or End meeting again to leave without saving.';
      CALL.noteTone = 'warn';
      renderLive();
      return;
    }
    CALL.saving = true;
    renderLive();
    const r = await postJSON('/counsel/meetings', {
      title: CALL.title,
      participants: CALL.participants,
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
    announce(session.captureIncomplete
      ? 'Call saved. The final microphone result did not settle before timeout; the final phrase may be incomplete.'
      : 'Call saved.');
    cache.set(saved.id, saved);
    if (redacted > 0) { lastRedactedId = saved.id; lastRedactedCount = redacted; }
    await loadArchive();
    await openMeetingById(saved.id);
  }

  if (startBtn) startBtn.addEventListener('click', () => { void beginCall(); });
  if (pauseBtn) pauseBtn.addEventListener('click', () => togglePause());
  if (discardBtn) discardBtn.addEventListener('click', () => discardCall());
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
  applyStaticCopyFixups(root);

  /* ================================================================= *
   * G · boot                                                            *
   * ================================================================= */

  computeAndSetMic();
  void refreshModelInfo();
  await loadArchive();
}
