/*
 * bind/voice/ptt.js — push-to-talk: the three (four) `.cbtn.mic` buttons the
 * artifact already ships. Moved out of bind/voice.js verbatim; capture
 * ownership, wake mode's on/off flag, and the outcome dispatcher are all
 * things bind/voice.js itself owns, so this file reaches them through the
 * shared `vstate` object (./state.js) instead of importing bind/voice.js
 * directly — bind/voice.js already imports this file (for wireMicButton and
 * abortPttNow), so the reverse import would be a cycle. See voice/state.js.
 */
import { SpeechRecognition, localSpeech, waitForSpeechIdle } from '../../whisper.js';
import { interpret } from '../../session.js';
import { captureOwnerLabel } from '../../ask-voice-model.js';
import { vstate } from './state.js';
import { setState, reply, stopSpeaking, settleAfter, engineUnavailableReason } from './pill.js';

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
    vstate.claimCapture();
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
    vstate.releaseCapture();
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
  await vstate.runOutcome(interpret(text));
}

export function startPtt(source) {
  stopSpeaking(); // pressing the mic is always allowed to interrupt Zeno talking
  if (!SpeechRecognition) { setState('error', engineUnavailableReason()); return; }
  if (vstate.wakeOn) return; // one recogniser at a time; the button is disabled too
  const owner = vstate.externalCaptureOwner();
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
  vstate.claimCapture();
  setState('listening', source);
  (async () => {
    try {
      await waitForSpeechIdle();
      if (!pttHeld) return;
      rec.start();
    } catch {
      pttHeld = false;
      vstate.releaseCapture();
      setState('error', 'The microphone did not become available. Stop other listening and retry.');
      settleAfter(2500);
    }
  })();
}
export function stopPtt() {
  pttHeld = false;
  if (!pttListening) return;
  setState('transcribing');
  try { pttRecognition.stop(); } catch { /* no-op */ }
}
/** Close the mic NOW, discarding anything in flight — for a takeover, a page
 * unload, or a wake auto-disarm. `abort()`, not `stop()`: nothing half-said is
 * worth keeping from a microphone someone else just claimed. */
export function abortPttNow() {
  pttHeld = false;
  /* An abort must DISCARD whatever was captured — the whole point of aborting
     (a blur, a takeover by another surface, pagehide, the Type button) is that
     the owner does NOT want this phrase to act. `abort()` below fires the
     recogniser's own onend, which reads pttFinalText and dispatches it, so a
     command captured a moment before the abort would still run. Clearing the
     pending transcript first is what makes the abort actually mean "cancel".
     This is the safety guarantee: voice never acts on what you stopped. */
  pttFinalText = '';
  pttInterim = '';
  if (!pttRecognition || !pttListening) return waitForSpeechIdle();
  return new Promise((resolve) => {
    const prevOnEnd = pttRecognition.onend;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pttRecognition.onend = prevOnEnd;
      pttListening = false;
      vstate.releaseCapture();
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
export function wireMicButton(btn) {
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
