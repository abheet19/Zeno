/*
 * bind/voice.js — restoring Zeno's voice mode onto the design artifact's markup.
 *
 * THE REGRESSION. The renderer rewrite replaced index.html with the artifact's
 * markup and pointed it at ui.js + bind.js + bind/*.js only. The real voice
 * stack — session.js (interpret), wake.js/listen.js (WakeListener), grammar.js
 * (the command grammar), whisper.js (local whisper.cpp capture) — is still on
 * disk and still correct. Nothing here re-derives any of it: this file is only
 * the seam between that pure/engine code and the artifact's own DOM.
 *
 * WHAT THIS FILE OWNS. The three `.cbtn.mic` buttons the artifact already ships
 * (Home, Chats, Forge's active-session composer — plus Forge's first-run
 * composer's own voice button, a fourth control bind/controls.js already knew
 * about and would otherwise retire or redirect), the "voice: idle" pill in
 * Home's composer foot, and the Settings → Voice → "Wake word" switch
 * bind/settings.js already wired for OFF but left ON to this file on purpose
 * (see its own comment: "needs the microphone disclosure … that lives with the
 * mic control").
 *
 * WHAT THIS FILE DOES NOT OWN. It never re-implements recognition, wake
 * matching or the grammar — those are imported. It never calls /approvals —
 * the Intent union this package produces has no member that could. It never
 * types a transcript into a chat composer: a spoken command is not dictation,
 * it is routed through the SAME grammar/intent path a typed command would need
 * (navigate a rail button, POST /work, POST /previews, POST /delegate) so
 * "what happens" cannot drift between the two.
 *
 * CAPTURE OWNERSHIP. One microphone, one owner, at a time — the same protocol
 * the old voice.js/ask.js/counsel.js all shared: `document.body.dataset.
 * zenoCapture` names who holds it, and `zeno:release-command-voice` is how a
 * more assertive surface (Counsel recording a meeting) asks this one to let go.
 * This file only ever YIELDS to that event; it never dispatches it, because
 * Command is the polite party — it checks before it starts and it never fights
 * for the microphone.
 */

import { getJSON, $, $$, el, fill, screenEl, token } from '../bind.js';
import { interpret } from '../session.js';
import { WakeListener, WAKE_WINDOW_MS, RETENTION_MS } from '../listen.js';
import { SpeechRecognition, localSpeech, waitForSpeechIdle } from '../whisper.js';
import { captureOwnerLabel, chooseSystemVoice } from '../ask-voice-model.js';

/* ---------------------------------------------------------------- *
 * Small shared helpers                                              *
 * ------------------------------------------------------------------ */

const CAPTURE_OWNER = 'command';
const WAKE_PREF_KEY = 'zeno.voice.wake';
// Bumping this re-asks consent from anyone who accepted an older, weaker
// description of what the microphone does.
const DISCLOSURE_VERSION = 4;

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  const t = token();
  if (t) h['x-zeno-token'] = t;
  return h;
}

/** The same shape getJSON uses, so this binder's own POSTs read the same way
 * every other binder's GETs do — never thrown, always { ok, data, error }. */
async function postJSON(path, body) {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data && data.error) || {};
      const msg = String(err.message || `${path} answered ${res.status}`).trim();
      const resolve = String(err.resolve || '').trim();
      return { ok: false, status: res.status, data, error: resolve ? `${msg} ${resolve}` : msg };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `${path} could not be reached: ${err && err.message}` };
  }
}

function readWakePref() {
  try {
    const raw = window.localStorage.getItem(WAKE_PREF_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.on === true && parsed.disclosure === DISCLOSURE_VERSION && (!localSpeech || parsed.engine === 'whisper'));
  } catch {
    return false; // private mode / corrupt JSON: default OFF, the safe direction
  }
}
function writeWakePref(on) {
  try {
    if (on) {
      window.localStorage.setItem(WAKE_PREF_KEY, JSON.stringify({ on: true, disclosure: DISCLOSURE_VERSION, engine: localSpeech ? 'whisper' : 'browser' }));
    } else {
      window.localStorage.removeItem(WAKE_PREF_KEY);
    }
  } catch { /* preference just won't survive a reload */ }
}

/* ---------------------------------------------------------------- *
 * Capture ownership — one microphone, one owner                     *
 * ------------------------------------------------------------------ */

function externalCaptureOwner() {
  const owner = document.body.dataset.zenoCapture || '';
  return owner && owner !== CAPTURE_OWNER ? owner : null;
}
function claimCapture() { document.body.dataset.zenoCapture = CAPTURE_OWNER; }
function releaseCapture() {
  if (document.body.dataset.zenoCapture === CAPTURE_OWNER) delete document.body.dataset.zenoCapture;
}

/* ---------------------------------------------------------------- *
 * The eight states — one pill, mirrored onto every mic button        *
 * ------------------------------------------------------------------ */

// Rendered pill text is deliberately SHORT and fixed per state — a spoken
// outcome can be a full sentence, and stuffing that into this small pill would
// break its layout. The full detail always still goes into the pill's `title`
// (a native tooltip), and — while a synthesis engine is available — is SAID
// aloud, which is the primary channel a spoken reply is meant to use.
const STATE_INFO = {
  idle: { cls: 'wt', text: () => 'voice: idle' },
  permission_needed: { cls: 'am', text: () => 'voice: permission needed' },
  listening: { cls: 'cy', text: (d) => (d && d.length <= 40 ? `voice: listening · ${d}` : 'voice: listening') },
  transcribing: { cls: 'cy', text: () => 'voice: transcribing…' },
  thinking: { cls: 'cy', text: () => 'voice: thinking…' },
  speaking: { cls: 'cy', text: () => 'voice: speaking…' },
  stopped: { cls: 'wt', text: () => 'voice: stopped' },
  error: { cls: 'rd', text: () => 'voice: error' },
};

let pillEl = null;
let micButtons = []; // live, listener-free clones of the four mic controls
let currentState = 'idle';
let currentDetail = '';
let idleTimer = null;
let engineNote = ''; // the honest "what engine is this / what is missing" line

function engineUnavailableReason() {
  if (SpeechRecognition) return '';
  return 'No speech engine is available in this window — local Whisper needs the Zeno desktop app’s speech service, and this browser has no Web Speech API either. Typed chat still works.';
}
function engineDescription() {
  if (localSpeech) return 'Local Whisper — speech is recognized on this PC; no audio is uploaded.';
  if (SpeechRecognition) return 'Local Whisper is unavailable here (no local speech bridge was detected), so voice is using your browser’s Web Speech API instead — that is not local, and it uploads audio to your browser maker to transcribe.';
  return engineUnavailableReason();
}

/** Repaint the pill and every mic button from the one piece of state. Never
 * shows a state the engine did not actually reach. */
function paintState() {
  const info = STATE_INFO[currentState] || STATE_INFO.idle;
  if (pillEl) {
    pillEl.className = `pill ${info.cls}`;
    fill(pillEl, el('span', 'd'), document.createTextNode(info.text(currentDetail)));
    pillEl.title = currentDetail || engineNote || '';
  }
  const active = currentState === 'listening' || currentState === 'transcribing';
  const engineOk = !!SpeechRecognition;
  for (const b of micButtons) {
    b.classList.toggle('rec', active);
    if (b.classList.contains('ag-ic')) {
      // .ag-ic has no .rec rule of its own (that CSS is scoped to .mic); mirror
      // the same red-pulse look inline rather than leaving this one button dark.
      b.style.color = active ? 'var(--red,#E5484D)' : '';
      b.style.borderColor = active ? 'color-mix(in srgb, var(--red,#E5484D) 50%, var(--gl-edge,#2C353B))' : '';
    }
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.disabled = !engineOk || wakeOn;
    b.style.opacity = b.disabled ? '0.5' : '';
    b.style.cursor = b.disabled ? 'not-allowed' : '';
    b.title = !engineOk
      ? engineUnavailableReason()
      : wakeOn
        ? 'Wake mode is on — just say “Zeno”. Turn it off in Settings → Voice to hold this button instead.'
        : `Hold to talk to Zeno. ${engineDescription()}`;
  }
}
function setState(state, detail) {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  currentState = STATE_INFO[state] ? state : 'idle';
  currentDetail = detail || '';
  paintState();
}
/** Wake mode, if still on, keeps the microphone open after a command or a
 * spoken reply finishes — the true rest state is "listening for Zeno", not
 * idle, or the indicator would say the room stopped being heard when it did
 * not. */
function settleToRest() {
  if (wakeOn) setState('listening', 'listening for “Zeno”');
  else setState('idle');
}
function settleAfter(ms) {
  idleTimer = setTimeout(() => { idleTimer = null; settleToRest(); }, ms);
}

/* ---------------------------------------------------------------- *
 * Spoken replies — speech.js has no synthesis (it is an alternate    *
 * recognizer adapter, imported nowhere else); the standard Web        *
 * Speech Synthesis API is the only reusable surface for "say it back",*
 * the same one ask.js used inline. chooseSystemVoice is reused from   *
 * ask-voice-model.js rather than re-derived.                          *
 * ------------------------------------------------------------------ */

let speechEpoch = 0;
const MAX_SPOKEN_CHARS = 600;

function stopSpeaking() {
  speechEpoch += 1;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* engine already gone */ }
}

/** Speak `text` aloud, then settle to idle (or back to "listening for Zeno" if
 * wake is still on). Caller has already confirmed a synthesis engine exists. */
function speak(text) {
  const synth = window.speechSynthesis;
  const Utter = window.SpeechSynthesisUtterance;
  const epoch = ++speechEpoch;
  const clipped = text.length > MAX_SPOKEN_CHARS ? `${text.slice(0, MAX_SPOKEN_CHARS).replace(/\s+\S*$/, '')}…` : text;
  const utter = new Utter(clipped);
  let voice = null;
  try { voice = chooseSystemVoice(synth.getVoices ? synth.getVoices() : [], '', navigator.language || 'en-US'); } catch { voice = null; }
  if (voice) utter.voice = voice;
  utter.lang = (voice && voice.lang) || navigator.language || 'en-US';
  setState('speaking', text);
  const finish = () => { if (epoch !== speechEpoch) return; settleToRest(); };
  utter.onend = finish;
  utter.onerror = finish;
  try { synth.cancel(); synth.speak(utter); } catch { finish(); }
}

/**
 * Report the outcome of a command. Spoken aloud when a synthesis engine is
 * available (the primary channel a "spoken reply" is meant to use); when it is
 * not, the exact same words are still shown — held in the pill's `stopped`
 * state and its tooltip — rather than silently dropped just because nothing
 * can say them aloud.
 */
function reply(text) {
  const clean = String(text || '').trim();
  if (!clean) { settleToRest(); return; }
  const synth = window.speechSynthesis;
  const Utter = window.SpeechSynthesisUtterance;
  if (synth && typeof synth.speak === 'function' && typeof Utter === 'function') {
    speak(clean);
    return;
  }
  setState('stopped', clean);
  settleAfter(3200);
}

/* ---------------------------------------------------------------- *
 * Navigation — the artifact's real controls, not an invented one     *
 * ------------------------------------------------------------------ */

function clickProduct(name) {
  const btn = $(`.seg[aria-label="Product"] [data-product="${name}"]`);
  if (btn && typeof btn.click === 'function') { btn.click(); return true; }
  return false;
}
function gotoCommandScreen(screenName) {
  clickProduct('command');
  const btn = $(`.rail .nav-i[data-screen="${screenName}"]`);
  if (btn && typeof btn.click === 'function') btn.click();
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ---------------------------------------------------------------- *
 * Intent execution — the SAME network calls the old voice.js made,    *
 * so a spoken command has the exact effect a typed one would.         *
 * This file never calls /approvals: nothing below can.                *
 * ------------------------------------------------------------------ */

async function addTask(intent) {
  const title = String((intent && intent.title) || '').trim();
  if (!title) { reply('The task had no title, so nothing was added.'); return; }
  if (!token()) { reply('This window cannot add work — it has no owner token.'); return; }
  setState('thinking');
  const r = await postJSON('/work', { title });
  if (!r.ok) { reply(`Could not add the task: ${r.error || 'unknown error'}`); return; }
  const item = r.data && r.data.item;
  const itemId = String((item && item.id) || '').trim();
  if (!itemId || String((item && item.title) || '') !== title) {
    reply('The daemon answered without proving it stored this exact task. Refresh Work before retrying.');
    return;
  }
  window.dispatchEvent(new CustomEvent('zeno:state', { detail: { source: 'voice-add-task', itemId } }));
  reply(`Added “${title}” to Work.`);
}

/** A scaffold stub, same as before: the point of speaking a file into
 * existence is a proposal the owner can see and approve by hand, not
 * finished code written by dictation. */
function scaffoldContents(intent) {
  const isTsx = intent.relPath.endsWith('.tsx');
  const name = intent.relPath.split('/').pop().replace(/\.(tsx|ts)$/, '');
  const lines = [
    `// Proposed by voice: ${intent.summary}`,
    intent.hint ? `// Intent: ${intent.hint}` : '// Intent: (none spoken)',
    '// This is a scaffold. Review and complete it before it does real work.',
    '',
  ];
  if (isTsx) lines.push(`export function ${name}(): JSX.Element {`, `  return <div>TODO: ${name}</div>;`, '}', '');
  else lines.push(`export const TODO_${name.replace(/[^A-Za-z0-9_]/g, '_')} = true;`, '');
  return lines.join('\n');
}

async function proposeWrite(intent) {
  if (!token()) { reply('This window cannot propose — it has no owner token.'); return; }
  setState('thinking');
  const r = await postJSON('/previews', { relPath: intent.relPath, contents: scaffoldContents(intent), summary: intent.summary });
  if (!r.ok) { reply(`Could not propose: ${r.error || 'unknown error'}`); return; }
  window.dispatchEvent(new CustomEvent('zeno:state', { detail: { source: 'voice-propose' } }));
  reply(r.data && r.data.receipt
    ? `Proposed ${intent.relPath}. Policy classified it routine and recorded it — see Receipts.`
    : `Proposed ${intent.relPath}. It is waiting for your approval in Approvals.`);
}

function agentLabel(agentId) {
  if (agentId === 'local') return 'a local model on this machine';
  if (agentId === 'claude-code') return 'Claude Code, over the network';
  return agentId || 'an unnamed agent';
}

/** "Build me a slugify utility" starts a PROCESS, never an effect: plan first
 * (starts nothing), then only a LOCAL agent may begin from a spoken sentence
 * alone — a hosted one still waits behind a click this file cannot make. */
async function delegateTask(intent) {
  if (!token()) { reply('This window cannot delegate — it has no owner token.'); return; }
  setState('thinking');
  const plan = await postJSON('/delegate', { task: intent.task, plan: true });
  if (!plan.ok) { reply(`Could not delegate: ${plan.error || 'unknown error'}. Nothing was started.`); return; }
  const delegated = plan.data && plan.data.delegated;
  if (!delegated) { reply('Zeno did not say which agent would run this, so nothing was started.'); return; }

  if (delegated.needsConfirm) {
    reply(`This needs your click — running it on ${agentLabel(delegated.agentId)} would ${delegated.because || 'spend money and send your code off this machine'}. Voice cannot start or approve a hosted run. Open Forge to confirm it.`);
    return;
  }
  if (!delegated.ready) { reply(delegated.note || 'There is no agent available to run this. Nothing was started.'); return; }

  setState('thinking');
  const run = await postJSON('/delegate', { task: intent.task, agentId: 'local' });
  if (!run.ok) { reply(`The run failed: ${run.error || 'unknown error'}. Nothing was applied.`); return; }
  const done = run.data && run.data.delegated;
  if (!done || !done.started) { reply((done && done.note) || 'The run did not start, and nothing happened.'); return; }
  window.dispatchEvent(new CustomEvent('zeno:state', { detail: { source: 'voice-delegate' } }));
  const proposed = Array.isArray(done.proposed) ? done.proposed.length : 0;
  if (proposed > 0) {
    const many = proposed === 1 ? '' : 's';
    reply(done.ok === false
      ? `The run did not finish, but it already wrote ${proposed} file${many} — they are waiting for your approval rather than thrown away.`
      : `${proposed} change${many} proposed. None applied — each is waiting for your approval in Command.`);
  } else {
    reply(`No changes were proposed. ${done.note ? String(done.note) : 'The agent finished without changing any file.'}`);
  }
}

/** A spoken "what's pending / what have you done / verify the chain" gets a
 * REAL, read number — never a hopeful guess, and never silence when the read
 * failed. Mirrors bind.js's own rule: a count is only ever spoken if it was
 * actually read. */
async function describeRead(what) {
  const r = await getJSON('/state');
  if (!r.ok) return `Showing ${what === 'pending' ? 'what is waiting' : what} in this window — the daemon did not answer, so I could not read a count.`;
  const data = r.data || {};
  if (what === 'pending') {
    const n = Array.isArray(data.pending) ? data.pending.length : null;
    if (n === null) return 'Showing what is waiting in this window.';
    return n === 0 ? 'Nothing is waiting for your approval.' : `${n} item${n === 1 ? '' : 's'} waiting for your approval — shown in this window.`;
  }
  if (what === 'receipts') {
    const n = Array.isArray(data.receipts) ? data.receipts.length : null;
    return n === null ? 'Showing receipts in this window.' : `${n} receipt${n === 1 ? '' : 's'} — shown in this window.`;
  }
  if (what === 'chain') {
    const chain = data.chain;
    if (!chain || typeof chain.ok !== 'boolean') return 'The chain status was not reported.';
    return chain.ok ? 'The chain is verified.' : 'The chain is broken — see Receipts for where.';
  }
  return `Showing ${what} in this window.`;
}

/**
 * Act on one Outcome from `interpret`/`interpretCommand`. Push-to-talk and
 * wake mode both land here, so a command means the same thing however it was
 * spoken — including the refusal that says approval is by hand.
 */
async function runOutcome(result) {
  if (result.kind === 'idle') { reply(result.reason); return; }
  const intent = result.intent;
  switch (intent.kind) {
    case 'navigate': {
      const ok = clickProduct(intent.target);
      reply(ok ? `Opened ${cap(intent.target)}.` : `Could not open ${intent.target}; its navigation control is unavailable.`);
      break;
    }
    case 'add_task':
      await addTask(intent);
      break;
    case 'propose_write':
      await proposeWrite(intent);
      break;
    case 'delegate':
      await delegateTask(intent);
      break;
    case 'read': {
      const screenByWhat = { pending: 'approvals', receipts: 'receipts', chain: 'receipts' };
      const target = screenByWhat[intent.what];
      if (target) gotoCommandScreen(target);
      setState('thinking');
      reply(await describeRead(intent.what));
      break;
    }
    case 'cancel':
      reply('Cancelled.');
      break;
    case 'acknowledge':
      // The grammar's own catch-up for "hey Zeno" / "are you there" — heard,
      // not a mistake, so it gets a plain acknowledgement rather than falling
      // through to "not a command I recognize".
      reply('Hearing you. Say a command.');
      break;
    case 'unrecognized':
      // Also where a spoken "approve it" lands, with the reason that approval
      // is by hand — this file has no path to /approvals for voice to reach.
      reply(intent.reason);
      break;
    default:
      reply('Unhandled outcome.');
  }
}

/* ---------------------------------------------------------------- *
 * Push-to-talk — the three (four) buttons the artifact already ships *
 * ------------------------------------------------------------------ */

let pttRecognition = null;
let pttHeld = false;
let pttListening = false;
let pttFinalText = '';
let pttInterim = '';
let pttRestarts = 0;
let pttErrorMsg = '';
let pttErrorIsPermission = false;
let pttSource = '';

function ensurePttRecognition() {
  if (pttRecognition || !SpeechRecognition) return pttRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  if (localSpeech) {
    // Reused verbatim from the app's own vocabulary hint — a held button is an
    // explicit command capture, so a short bias toward Zeno's own phrases is
    // safe here in a way it is not for an always-open wake recognizer.
    rec.initialPrompt = 'Zeno, what is waiting? Show pending items. Show receipts. Verify the ledger. '
      + 'Open Command. Open Forge. Open Counsel. Add a task. Create a component. Build a feature.';
  }
  rec.onresult = (event) => {
    let final = '';
    let interim = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const res = event.results[i];
      if (!res || !res[0]) continue;
      if (res.isFinal) final += (final ? ' ' : '') + res[0].transcript;
      else interim += res[0].transcript;
    }
    pttFinalText = final;
    if (interim) pttInterim = interim.trim();
  };
  rec.onstart = () => {
    pttListening = true;
    claimCapture();
    setState('listening', pttSource);
  };
  rec.onerror = (event) => {
    const err = event && event.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      pttErrorMsg = 'Microphone permission was refused.';
      pttErrorIsPermission = true;
      pttHeld = false;
      try { rec.abort(); } catch { /* already stopped */ }
    } else if (err === 'audio-capture') {
      pttErrorMsg = 'No working microphone was found.';
      pttErrorIsPermission = false;
    } else if (err !== 'no-speech' && err !== 'aborted') {
      pttErrorMsg = err === 'network' ? 'The speech service is unavailable.' : `Recognition error: ${err}.`;
      pttErrorIsPermission = false;
    }
  };
  rec.onend = () => {
    const text = pttFinalText.trim();
    // The button, not the engine, is the authority: continuous=false ends the
    // session the instant it settles a result, which can be before the finger
    // lifts. If it is still down and nothing came back yet, reopen quietly.
    if (pttHeld && text === '' && pttRestarts < 2 && !pttErrorMsg) {
      pttRestarts += 1;
      try { rec.start(); return; } catch { /* fall through to a clean reset */ }
    }
    pttListening = false;
    releaseCapture();
    if (pttErrorMsg) {
      const msg = pttErrorMsg;
      const isPermission = pttErrorIsPermission;
      pttErrorMsg = '';
      pttErrorIsPermission = false;
      setState(isPermission ? 'permission_needed' : 'error', msg);
      settleAfter(2500);
      return;
    }
    if (text) {
      void dispatchTranscript(text);
    } else if (pttInterim) {
      setState('stopped', 'Did not catch a final transcript — try again.');
      settleAfter(1500);
    } else {
      setState('stopped', 'Released with nothing heard.');
      settleAfter(1200);
    }
  };
  pttRecognition = rec;
  return rec;
}

async function dispatchTranscript(text) {
  setState('thinking');
  // The SAME pure pipeline the package's own tests run against.
  await runOutcome(interpret(text));
}

function startPtt(source) {
  stopSpeaking(); // pressing the mic is always allowed to interrupt Zeno talking
  if (!SpeechRecognition) { setState('error', engineUnavailableReason()); return; }
  if (wakeOn) return; // one recogniser at a time; the button is disabled too
  const owner = externalCaptureOwner();
  if (owner) { setState('error', `${captureOwnerLabel(owner)} is using the microphone.`); settleAfter(2500); return; }
  const rec = ensurePttRecognition();
  if (!rec) { setState('error', engineUnavailableReason()); return; }
  pttHeld = true;
  pttRestarts = 0;
  pttErrorMsg = '';
  pttErrorIsPermission = false;
  pttFinalText = '';
  pttInterim = '';
  pttSource = source;
  claimCapture();
  setState('listening', source);
  (async () => {
    try {
      await waitForSpeechIdle();
      if (!pttHeld) return;
      rec.start();
    } catch {
      pttHeld = false;
      releaseCapture();
      setState('error', 'The microphone did not become available. Stop other listening and retry.');
      settleAfter(2500);
    }
  })();
}
function stopPtt() {
  pttHeld = false;
  if (!pttListening) return;
  setState('transcribing');
  try { pttRecognition.stop(); } catch { /* no-op */ }
}
/** Close the mic NOW, discarding anything in flight — for a takeover, a page
 * unload, or a wake auto-disarm. `abort()`, not `stop()`: nothing half-said is
 * worth keeping from a microphone someone else just claimed. */
function abortPttNow() {
  pttHeld = false;
  if (!pttRecognition || !pttListening) return waitForSpeechIdle();
  return new Promise((resolve) => {
    const prevOnEnd = pttRecognition.onend;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pttRecognition.onend = prevOnEnd;
      pttListening = false;
      releaseCapture();
      resolve();
    };
    pttRecognition.onend = (e) => { finish(); try { if (prevOnEnd) prevOnEnd.call(pttRecognition, e); } catch { /* ignore */ } };
    setTimeout(finish, 2000);
    try { pttRecognition.abort(); } catch { finish(); }
  }).then(() => waitForSpeechIdle());
}

/** Wire one mic button for real hold-to-talk. The pointer is captured on the
 * way down so a hand drifting off the button mid-word cannot end the hold —
 * the same reason the original .zv-ptt control did this. */
function wireMicButton(btn) {
  if (!btn) return;
  const label = btn.id === 'home-mic' ? 'mic: Home' : btn.id === 's-mic' ? 'mic: Forge' : btn.closest('[data-screen="chats"]') ? 'mic: Chats' : 'mic: Forge';
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    try { btn.setPointerCapture(e.pointerId); } catch { /* capture can be refused */ }
    startPtt(label);
  });
  const release = (e) => {
    try {
      if (e && e.pointerId !== undefined && btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) {
        btn.releasePointerCapture(e.pointerId);
      }
    } catch { /* no-op */ }
    stopPtt();
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || pttHeld || btn.disabled) return;
    startPtt(label);
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    stopPtt();
  });
  btn.addEventListener('blur', () => { if (pttHeld) void abortPttNow(); });
}

/* ---------------------------------------------------------------- *
 * Wake mode — opt-in, disclosed, and never a second capture path     *
 * ------------------------------------------------------------------ */

let wakeListenerObj = null;
let wakeRecognition = null;
let wakeOn = false;
let wakeEngineUp = false;
let wakeRestartTimer = null;
let wakeTickTimer = null;
let wakeFailures = 0;

function wakeConsentText() {
  const seconds = Math.round(RETENTION_MS / 1000);
  return 'Turn on “Listen for Zeno”?\n\n'
    + 'The microphone stays open until you switch this off — it hears the whole room, not only when '
    + `you are speaking to Zeno. ${engineDescription()}\n\n`
    + `Only a recognized “Zeno” wake phrase opens a command window. Until then, Zeno holds at most the `
    + `last ${seconds} seconds of untriggered speech in memory, and drops it the moment you switch off or say “Zeno”.\n\n`
    + 'Speaking can navigate, read state, and add a Work item directly. File changes still wait for your '
    + 'approval on screen, and voice can never approve anything.\n\nContinue?';
}

function applyWakeEvent(ev) {
  switch (ev.kind) {
    case 'retained':
      break; // untriggered room chatter — never shown as "heard"
    case 'woke':
      clickProduct('command');
      setState('listening', `heard “Zeno” — say your command (${Math.round(WAKE_WINDOW_MS / 1000)}s)`);
      break;
    case 'capturing':
      setState('listening', ev.partial ? `hearing “${ev.partial}”` : 'heard “Zeno” — say your command');
      break;
    case 'command':
      // Reached even when "Zeno, <command>" arrives as one settled utterance
      // (no separate 'woke' event in that case) — the switch to Command must
      // happen on EVERY wake-triggered command, not only a two-step one.
      clickProduct('command');
      setState('thinking');
      void runOutcome(ev.outcome);
      break;
    case 'expired':
      setState('listening', 'no command followed — listening for “Zeno”');
      break;
    default:
      break; // 'none' — off, or a blank transcript
  }
}

function ensureWakeRecognition() {
  if (wakeRecognition || !SpeechRecognition) return wakeRecognition;
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.continuous = true; // the whole difference from push-to-talk
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onstart = () => {
    if (!wakeOn) { try { rec.abort(); } catch { /* no-op */ } wakeEngineUp = false; return; }
    wakeEngineUp = true;
    wakeFailures = 0;
    claimCapture();
    paintState();
  };
  rec.onend = () => {
    wakeEngineUp = false;
    if (!wakeOn) { releaseCapture(); return; }
    // Browsers end a continuous session periodically; "on" only stays honest
    // if it restarts. whisper.js's local engine does not end on its own, so
    // this branch is effectively unused there — but back off the same way if
    // it ever does, rather than spin the microphone.
    wakeFailures += 1;
    if (wakeFailures > 8) { void disarmWake('The recogniser kept stopping, so wake mode switched itself off.'); return; }
    if (wakeRestartTimer) return;
    wakeRestartTimer = setTimeout(() => {
      wakeRestartTimer = null;
      if (wakeOn && !wakeEngineUp) startWakeEngine();
    }, wakeFailures > 3 ? 1500 : 250);
  };
  rec.onerror = (event) => {
    const err = event && event.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      void disarmWake('Microphone permission was refused, so wake mode is off.', 'permission_needed');
      return;
    }
    if (err === 'no-speech' || err === 'aborted') return; // ordinary in a continuous session
    if (err === 'audio-capture') {
      void disarmWake('No working microphone was found. Wake mode is off.');
      return;
    }
    void disarmWake(err === 'network'
      ? 'The speech service is unavailable. Wake mode is off and the microphone is closed.'
      : `Recognition error: ${err}. Wake mode is off and the microphone is closed.`);
  };
  rec.onresult = (event) => {
    if (!wakeOn) return;
    const now = Date.now();
    for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
      const res = event.results[i];
      if (!res || !res[0]) continue;
      applyWakeEvent(wakeListenerObj.hear(res[0].transcript, Boolean(res.isFinal), now));
    }
    if (localSpeech && typeof rec.clearResults === 'function') rec.clearResults();
  };
  wakeRecognition = rec;
  return rec;
}

function startWakeEngine() {
  const rec = ensureWakeRecognition();
  if (!rec || !wakeOn || wakeEngineUp) return;
  try { rec.start(); } catch { /* already starting; onstart/onend settle it */ }
}

/** True only while at least one place the owner can actually see says a
 * microphone might be open — the Home pill, or a mic button that is visible
 * on whichever screen is showing right now. Wake mode may never run silently
 * behind a screen with neither. */
function wakeIndicatorVisible() {
  if (pillEl && pillEl.offsetParent !== null) return true;
  return micButtons.some((b) => b.offsetParent !== null);
}

async function turnWakeOn() {
  if (!SpeechRecognition) return;
  const owner = externalCaptureOwner();
  if (owner) { setState('error', `${captureOwnerLabel(owner)} is using the microphone.`); settleAfter(2500); return; }
  if (!window.confirm(wakeConsentText())) return; // Cancel = nothing changes, ever
  wakeOn = true;
  wakeFailures = 0;
  wakeListenerObj = wakeListenerObj || new WakeListener();
  wakeListenerObj.arm();
  writeWakePref(true);
  paintState(); // disables the hold buttons immediately — one mic at a time
  try {
    await abortPttNow();
  } catch { /* best-effort */ }
  if (!wakeOn) return;
  setState('listening', 'listening for “Zeno”');
  if (!wakeTickTimer) wakeTickTimer = setInterval(wakeTick, 400);
  startWakeEngine();
}

function disarmWake(reason, stateOverride) {
  const wasOn = wakeOn;
  wakeOn = false;
  if (wakeListenerObj) wakeListenerObj.disarm(); // drops the retained transcript
  writeWakePref(false);
  if (wakeRestartTimer) { clearTimeout(wakeRestartTimer); wakeRestartTimer = null; }
  if (wakeTickTimer) { clearInterval(wakeTickTimer); wakeTickTimer = null; }
  syncSettingsToggle(false);
  const settle = () => {
    if (reason) { setState(stateOverride || 'stopped', reason); settleAfter(2500); } else settleToRest();
  };
  if (!wasOn || !wakeRecognition || !wakeEngineUp) {
    wakeEngineUp = false;
    releaseCapture();
    settle();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const prevOnEnd = wakeRecognition.onend;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      wakeRecognition.onend = prevOnEnd;
      wakeEngineUp = false;
      releaseCapture();
      settle();
      resolve();
    };
    wakeRecognition.onend = (e) => { finish(); try { if (prevOnEnd) prevOnEnd.call(wakeRecognition, e); } catch { /* ignore */ } };
    setTimeout(finish, 2000);
    try { wakeRecognition.abort(); } catch { finish(); }
  }).then(() => waitForSpeechIdle());
}

/** The clock: closes an expired command window and — the safety net no
 * persistent bar can stand in for in this design — turns wake mode off the
 * instant nothing on screen could show the owner it is still listening. */
function wakeTick() {
  if (!wakeOn) return;
  if (!wakeIndicatorVisible()) {
    void disarmWake('Wake mode turned off — you left the only screens that show it is listening.');
    return;
  }
  if (wakeListenerObj) applyWakeEvent(wakeListenerObj.tick(Date.now()));
}

/* ---------------------------------------------------------------- *
 * Settings → Voice → "Wake word" — the opt-in surface the design has *
 * bind/settings.js already reads/writes `zeno.voice.wake` and turns   *
 * the switch off for real; it deliberately leaves turning it ON to    *
 * "the mic control" (its own comment). This finishes that switch      *
 * without editing that file — by re-detaching the SAME node it left   *
 * behind, once bind.js says every binder (including settings.js) has  *
 * already run. If that row is missing, this only quietly does nothing:*
 * the mic buttons' own disabled/enabled state is never gated on it.   *
 * ------------------------------------------------------------------ */

let wakeToggleEl = null;

function findWakeToggle() {
  const modal = $('#settings-modal');
  const pane = modal && $('.set-pane[data-setpane="voice"]', modal);
  if (!pane) return null;
  const row = $$('.setrow', pane).find((r) => {
    const lab = $('.lab', r);
    return lab && lab.textContent.trim() === 'Wake word';
  });
  return row ? $('.toggle[role="switch"]', row) : null;
}
function syncSettingsToggle(on) {
  if (wakeToggleEl) wakeToggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
}
function wireWakeSettingsToggle() {
  const original = findWakeToggle();
  if (!original) return; // Settings not present in this build — degrade quietly
  const clone = original.cloneNode(true); // drop bind/settings.js's OFF-only handler
  original.replaceWith(clone);
  wakeToggleEl = clone;
  clone.setAttribute('aria-checked', wakeOn ? 'true' : 'false');
  const flip = () => {
    if (!SpeechRecognition) return;
    if (wakeOn) void disarmWake('Wake word turned off.');
    else void turnWakeOn();
  };
  clone.addEventListener('click', flip);
  clone.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
  });
  if (!SpeechRecognition) {
    clone.setAttribute('aria-disabled', 'true');
    clone.style.opacity = '0.5';
    clone.style.cursor = 'not-allowed';
    clone.title = engineUnavailableReason();
  }
}

/* ---------------------------------------------------------------- *
 * Cross-surface handoff — Command only ever YIELDS                   *
 * ------------------------------------------------------------------ */

function onExternalRelease(event) {
  const requestedBy = (event.detail && event.detail.requestedBy) || 'another voice surface';
  const waiters = [
    disarmWake(`Command listening paused for ${requestedBy}.`),
    abortPttNow(),
  ];
  if (event.detail && Array.isArray(event.detail.waiters)) {
    event.detail.waiters.push(Promise.all(waiters).then(() => waitForSpeechIdle()));
  }
}

/* ---------------------------------------------------------------- *
 * bind() — defensive top to bottom: a missing element or a module     *
 * that fails to do what is expected degrades quietly, is reported,    *
 * and never throws out of this function.                              *
 * ------------------------------------------------------------------ */

export async function bind() {
  const failed = [];
  try {
    pillEl = $('#voice-state');
    if (pillEl) { pillEl.setAttribute('role', 'status'); pillEl.setAttribute('aria-live', 'polite'); }

    const homeMic = $('#home-mic');
    const sMic = $('#s-mic');
    const chatsScreen = screenEl('chats');
    const chatsMic = chatsScreen ? $('.cbtn.mic', chatsScreen) : null;
    const forgeEmptyMic = $('.ag-composer [title="Voice"]');

    // A marker bind/controls.js already looks for: with it present, any voice
    // button that binder still reaches routes to Command and focuses this
    // control instead of being removed as inert. Added to the button we own
    // most directly, before anything else below, so a slower-loading module
    // graph never leaves it looking retirable.
    if (homeMic) homeMic.classList.add('zv-ptt');

    const found = [homeMic, chatsMic, sMic, forgeEmptyMic].filter(Boolean);
    if (found.length < 3) failed.push(`only found ${found.length} of the expected mic controls`);

    // Claim each one and strip whatever ui.js's mock (or anything else) already
    // attached, via the same clone+replaceWith trick every other binder in this
    // codebase uses to detach a listener without touching the file that added it.
    micButtons = found.map((b) => {
      b.dataset.wired = '1';
      const clone = b.cloneNode(true);
      clone.dataset.wired = '1';
      b.replaceWith(clone);
      return clone;
    });
    for (const b of micButtons) wireMicButton(b);

    engineNote = engineUnavailableReason();
    if (!SpeechRecognition) failed.push('no speech recognition engine is available (neither local Whisper nor a Web Speech API)');

    paintState(); // draws idle/disabled honestly before any async work below

    window.addEventListener('zeno:release-command-voice', onExternalRelease);
    window.addEventListener('pagehide', () => { void abortPttNow(); void disarmWake(); });

    // Restore a previously-accepted wake preference — but only after asserting
    // (via wakeIndicatorVisible, checked on the first tick) that something on
    // screen can actually show it. No consent dialog on restore: the owner
    // already gave it, and re-asking every reload would train them to click
    // through it unread.
    if (SpeechRecognition && readWakePref() && !externalCaptureOwner()) {
      wakeOn = true;
      wakeListenerObj = wakeListenerObj || new WakeListener();
      wakeListenerObj.arm();
      setState('listening', 'listening for “Zeno”');
      if (!wakeTickTimer) wakeTickTimer = setInterval(wakeTick, 400);
      startWakeEngine();
    }

    // The Settings "Wake word" switch is wired defensively, and only after
    // every binder (including bind/settings.js, which detaches this same node
    // first) has finished — so this is never in a race with it.
    document.addEventListener('zeno:bound', () => {
      try { wireWakeSettingsToggle(); } catch (err) { console.warn('[zeno] voice: could not wire the Settings wake toggle', err); }
    }, { once: true });
  } catch (err) {
    failed.push(String((err && err.message) || err));
  }
  if (failed.length) console.warn('[zeno] voice binder: partial mount —', failed.join('; '));
}
