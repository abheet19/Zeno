/*
 * bind/voice/wake.js — wake mode: opt-in, disclosed, and never a second
 * capture path. Also finishes the Settings → Voice → "Wake word" switch
 * bind/settings.js already wires for OFF but deliberately leaves ON to this
 * file (see that file's own comment: "needs the microphone disclosure … that
 * lives with the mic control").
 *
 * Moved out of bind/voice.js verbatim. Capture ownership, wake mode's on/off
 * flag, and the outcome dispatcher are all things bind/voice.js itself owns;
 * this file reaches them through the shared `vstate` object (./state.js)
 * instead of importing bind/voice.js directly — bind/voice.js already
 * imports this file (for restoreWakeMode, disarmWake, wireWakeSettingsToggle),
 * so the reverse import would be a cycle. See voice/state.js.
 */
import { $, $$ } from '../../bind.js';
import { WakeListener, WAKE_WINDOW_MS, RETENTION_MS } from '../../listen.js';
import { SpeechRecognition, localSpeech, waitForSpeechIdle } from '../../whisper.js';
import { captureOwnerLabel } from '../../ask-voice-model.js';
import { vstate } from './state.js';
import { setState, paintState, settleAfter, settleToRest, engineDescription, engineUnavailableReason } from './pill.js';
import { clickProduct } from './nav.js';
import { abortPttNow } from './ptt.js';

const WAKE_PREF_KEY = 'zeno.voice.wake';
// Bumping this re-asks consent from anyone who accepted an older, weaker
// description of what the microphone does.
const DISCLOSURE_VERSION = 4;

let wakeListenerObj = null;
let wakeRecognition = null;
let wakeEngineUp = false;
let wakeRestartTimer = null;
let wakeTickTimer = null;
let wakeFailures = 0;

export function readWakePref() {
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
      void vstate.runOutcome(ev.outcome);
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
    if (!vstate.wakeOn) { try { rec.abort(); } catch { /* no-op */ } wakeEngineUp = false; return; }
    wakeEngineUp = true;
    wakeFailures = 0;
    vstate.claimCapture();
    paintState();
  };
  rec.onend = () => {
    wakeEngineUp = false;
    if (!vstate.wakeOn) { vstate.releaseCapture(); return; }
    // Browsers end a continuous session periodically; "on" only stays honest
    // if it restarts. whisper.js's local engine does not end on its own, so
    // this branch is effectively unused there — but back off the same way if
    // it ever does, rather than spin the microphone.
    wakeFailures += 1;
    if (wakeFailures > 8) { void disarmWake('The recogniser kept stopping, so wake mode switched itself off.'); return; }
    if (wakeRestartTimer) return;
    wakeRestartTimer = setTimeout(() => {
      wakeRestartTimer = null;
      if (vstate.wakeOn && !wakeEngineUp) startWakeEngine();
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
    if (!vstate.wakeOn) return;
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
  if (!rec || !vstate.wakeOn || wakeEngineUp) return;
  try { rec.start(); } catch { /* already starting; onstart/onend settle it */ }
}

/** True only while at least one place the owner can actually see says a
 * microphone might be open — the Home pill, or a mic button that is visible
 * on whichever screen is showing right now. Wake mode may never run silently
 * behind a screen with neither. */
function wakeIndicatorVisible() {
  if (vstate.pillEl && vstate.pillEl.offsetParent !== null) return true;
  return vstate.micButtons.some((b) => b.offsetParent !== null);
}

export async function turnWakeOn() {
  if (!SpeechRecognition) return;
  const owner = vstate.externalCaptureOwner();
  if (owner) { setState('error', `${captureOwnerLabel(owner)} is using the microphone.`); settleAfter(2500); return; }
  if (!window.confirm(wakeConsentText())) return; // Cancel = nothing changes, ever
  vstate.wakeOn = true;
  wakeFailures = 0;
  wakeListenerObj = wakeListenerObj || new WakeListener();
  wakeListenerObj.arm();
  writeWakePref(true);
  // The switch the owner just flipped is the ONLY persistent place that says
  // the microphone is open — the pill lives on Home and the mic buttons are
  // per-screen. disarmWake has always synced it down; nothing synced it up, so
  // an armed wake word read "off" in Settings for the rest of the session, and
  // flipping it again looked like turning it ON while it actually turned it off.
  syncSettingsToggle(true);
  paintState(); // disables the hold buttons immediately — one mic at a time
  try {
    await abortPttNow();
  } catch { /* best-effort */ }
  if (!vstate.wakeOn) return;
  setState('listening', 'listening for “Zeno”');
  if (!wakeTickTimer) wakeTickTimer = setInterval(wakeTick, 400);
  startWakeEngine();
}

/**
 * Stop listening.
 *
 * `opts.keepPreference` separates the two things this function was doing at
 * once: tearing down a live capture, and revoking the owner's stored consent.
 * Every caller below except one is a real "off" — the owner flipped the switch,
 * permission was refused, no microphone was found, the recogniser kept dying,
 * the owner navigated away from the only screens that show it is listening —
 * and those must clear the preference. The `pagehide` teardown is not an "off":
 * the window is simply going away, and clearing the consent there meant a wake
 * word could never survive a reload at all. bind()'s own restore branch (and
 * its comment, "re-asking every reload would train them to click through it
 * unread") was unreachable, and the Settings switch reported OFF after every
 * reload no matter what the owner had chosen.
 */
export function disarmWake(reason, stateOverride, opts) {
  const wasOn = vstate.wakeOn;
  vstate.wakeOn = false;
  if (wakeListenerObj) wakeListenerObj.disarm(); // drops the retained transcript
  if (!(opts && opts.keepPreference)) writeWakePref(false);
  if (wakeRestartTimer) { clearTimeout(wakeRestartTimer); wakeRestartTimer = null; }
  if (wakeTickTimer) { clearInterval(wakeTickTimer); wakeTickTimer = null; }
  syncSettingsToggle(false);
  const settle = () => {
    if (reason) { setState(stateOverride || 'stopped', reason); settleAfter(2500); } else settleToRest();
  };
  if (!wasOn || !wakeRecognition || !wakeEngineUp) {
    wakeEngineUp = false;
    vstate.releaseCapture();
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
      vstate.releaseCapture();
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
  if (!vstate.wakeOn) return;
  if (!wakeIndicatorVisible()) {
    void disarmWake('Wake mode turned off — you left the only screens that show it is listening.');
    return;
  }
  if (wakeListenerObj) applyWakeEvent(wakeListenerObj.tick(Date.now()));
}

/**
 * Restore a previously-accepted wake preference on load. bind/voice.js's
 * bind() calls this only after checking exactly what turnWakeOn's own gate
 * checks — an engine exists, the preference was accepted (readWakePref),
 * and no other surface already holds the microphone (externalCaptureOwner)
 * — so this does only the "start listening" half turnWakeOn does; no consent
 * dialog here, since the owner already gave it, and re-asking every reload
 * would train them to click through it unread.
 */
export function restoreWakeMode() {
  vstate.wakeOn = true;
  wakeListenerObj = wakeListenerObj || new WakeListener();
  wakeListenerObj.arm();
  setState('listening', 'listening for “Zeno”');
  if (!wakeTickTimer) wakeTickTimer = setInterval(wakeTick, 400);
  startWakeEngine();
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
export function wireWakeSettingsToggle() {
  const original = findWakeToggle();
  if (!original) return; // Settings not present in this build — degrade quietly
  const clone = original.cloneNode(true); // drop bind/settings.js's OFF-only handler
  original.replaceWith(clone);
  wakeToggleEl = clone;
  clone.setAttribute('aria-checked', vstate.wakeOn ? 'true' : 'false');
  const flip = () => {
    if (!SpeechRecognition) return;
    if (vstate.wakeOn) void disarmWake('Wake word turned off.');
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
