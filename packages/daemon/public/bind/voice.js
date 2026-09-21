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
 *
 * THE SPLIT. At ~1,000 lines this file mixed eight concerns together: the
 * eight capture states + spoken replies, push-to-talk, wake mode + its
 * Settings toggle, Command-screen navigation, and everything below. Those now
 * live in voice/*.js — pill.js, ptt.js, wake.js, nav.js — with the handful of
 * things more than one of them needs (wake mode's on/off flag, the mic/pill
 * elements) on the shared `vstate` object in voice/state.js. What stays here:
 * the network calls a spoken intent can make (never /approvals), the switch
 * that turns an Outcome into one of them, capture ownership itself, and
 * bind(). voice/ptt.js and voice/wake.js reach the capture-ownership
 * functions and the Outcome dispatcher below through `vstate`'s function
 * registry rather than importing this file — this file already imports THEM
 * (for wireMicButton/abortPttNow/restoreWakeMode/disarmWake/etc.), so the
 * reverse import would be a cycle.
 */

import { getJSON, $, screenEl, token } from '../bind.js';
import { SpeechRecognition, waitForSpeechIdle } from '../whisper.js';
import { vstate } from './voice/state.js';
import {
  setState, reply, paintState, engineUnavailableReason, refreshLocalRuntimeStatus,
} from './voice/pill.js';
import { clickProduct, gotoCommandScreen, cap } from './voice/nav.js';
import { wireMicButton, abortPttNow } from './voice/ptt.js';
import { readWakePref, restoreWakeMode, disarmWake, wireWakeSettingsToggle } from './voice/wake.js';

/* ---------------------------------------------------------------- *
 * Small shared helpers                                              *
 * ------------------------------------------------------------------ */

const CAPTURE_OWNER = 'command';

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

/* ---------------------------------------------------------------- *
 * Capture ownership — one microphone, one owner. Registered onto     *
 * `vstate` (in bind(), below) so voice/ptt.js and voice/wake.js can   *
 * call the SAME functions without importing this file. See the file  *
 * comment above and voice/state.js.                                  *
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
 * alone — a hosted one still waits behind a click this file cannot make. The
 * local task is handed to Forge's own session path, so the owner sees the
 * selected model, plan, tools, live progress, proposals and verification. */
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

  reply(`Opening Forge and running this on ${delegated.model || 'the local model'}. File effects still wait behind Zeno's policy and approval boundary.`);
  window.dispatchEvent(new CustomEvent('zeno:command-run', {
    detail: { task: intent.task, agentId: delegated.agentId, model: delegated.model },
  }));
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
    // Register this file's pieces onto the shared state object so
    // voice/ptt.js and voice/wake.js can reach them — before anything (a
    // click, a wake word) could possibly call one. See voice/state.js.
    vstate.externalCaptureOwner = externalCaptureOwner;
    vstate.claimCapture = claimCapture;
    vstate.releaseCapture = releaseCapture;
    vstate.runOutcome = runOutcome;

    vstate.pillEl = $('#voice-state');
    if (vstate.pillEl) { vstate.pillEl.setAttribute('role', 'status'); vstate.pillEl.setAttribute('aria-live', 'polite'); }

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
    vstate.micButtons = found.map((b) => {
      b.dataset.wired = '1';
      const clone = b.cloneNode(true);
      clone.dataset.wired = '1';
      b.replaceWith(clone);
      return clone;
    });
    for (const b of vstate.micButtons) wireMicButton(b);

    vstate.engineNote = engineUnavailableReason();
    if (!SpeechRecognition) failed.push('no speech recognition engine is available (neither local Whisper nor a Web Speech API)');

    paintState(); // draws idle/disabled honestly before any async work below

    // The desktop bridge exists whether or not local Whisper was ever
    // installed (see preload.cjs), so its actual presence on disk needs its
    // own, separate check — repainted immediately when it resolves, and again
    // whenever a Settings → Voice install finishes (see speech-install.cjs /
    // main.cjs, relayed here by preload.cjs as this same window event).
    void refreshLocalRuntimeStatus().then(paintState);
    window.addEventListener('zeno:speech-runtime-changed', () => { void refreshLocalRuntimeStatus().then(paintState); });

    window.addEventListener('zeno:release-command-voice', onExternalRelease);
    // The window going away stops the microphone; it does not revoke consent.
    window.addEventListener('pagehide', () => { void abortPttNow(); void disarmWake(undefined, undefined, { keepPreference: true }); });

    // Restore a previously-accepted wake preference — but only after asserting
    // (via wakeIndicatorVisible, checked on the first tick) that something on
    // screen can actually show it. No consent dialog on restore: the owner
    // already gave it, and re-asking every reload would train them to click
    // through it unread.
    if (SpeechRecognition && readWakePref()) {
      const owner = externalCaptureOwner();
      if (!owner) restoreWakeMode();
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
