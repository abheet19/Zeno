/*
 * bind/voice/pill.js — the eight capture states (one pill, mirrored onto
 * every mic button) and spoken replies. Moved out of bind/voice.js verbatim;
 * only the bits more than one module needs — `pillEl`, `micButtons`,
 * `engineNote`, `wakeOn` — now live on the shared `vstate` object (./state.js)
 * instead of this file's own module scope, because bind/voice.js's bind()
 * and bind/voice/wake.js both read or write them too.
 */
import { el, fill } from '../../bind.js';
import { SpeechRecognition, localSpeech } from '../../whisper.js';
import { chooseSystemVoice } from '../../ask-voice-model.js';
import { vstate } from './state.js';

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
  // Not a state the engine reaches — the state there IS no engine to reach one
  // from. "voice: idle" reads as "ready, just not listening right now", which is
  // the one thing this pill must not say when nothing in this window can hear:
  // the owner would hold the mic, get nothing, and blame the microphone. The
  // reason is already in the tooltip; the visible word has to agree with it.
  unavailable: { cls: 'am', text: () => 'voice: unavailable' },
};

let currentState = 'idle';
let currentDetail = '';
let idleTimer = null;

export function engineUnavailableReason() {
  if (SpeechRecognition) return '';
  return 'No speech engine is available in this window — local Whisper needs the Zeno desktop app’s speech service, and this browser has no Web Speech API either. Typed chat still works.';
}
export function engineDescription() {
  if (localSpeech) return 'Local Whisper — speech is recognized on this PC; no audio is uploaded.';
  if (SpeechRecognition) return 'Local Whisper is unavailable here (no local speech bridge was detected), so voice is using your browser’s Web Speech API instead — that is not local, and it uploads audio to your browser maker to transcribe.';
  return engineUnavailableReason();
}

/** Repaint the pill and every mic button from the one piece of state. Never
 * shows a state the engine did not actually reach. */
export function paintState() {
  // "idle" is a resting engine. With no engine at all there is nothing resting,
  // so the pill says so rather than borrowing the word for "ready".
  const info = (!SpeechRecognition && currentState === 'idle')
    ? STATE_INFO.unavailable
    : (STATE_INFO[currentState] || STATE_INFO.idle);
  if (vstate.pillEl) {
    vstate.pillEl.className = `pill ${info.cls}`;
    fill(vstate.pillEl, el('span', 'd'), document.createTextNode(info.text(currentDetail)));
    vstate.pillEl.title = currentDetail || vstate.engineNote || '';
  }
  const active = currentState === 'listening' || currentState === 'transcribing';
  const engineOk = !!SpeechRecognition;
  for (const b of vstate.micButtons) {
    b.classList.toggle('rec', active);
    if (b.classList.contains('ag-ic')) {
      // .ag-ic has no .rec rule of its own (that CSS is scoped to .mic); mirror
      // the same red-pulse look inline rather than leaving this one button dark.
      b.style.color = active ? 'var(--red,#E5484D)' : '';
      b.style.borderColor = active ? 'color-mix(in srgb, var(--red,#E5484D) 50%, var(--gl-edge,#2C353B))' : '';
    }
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.disabled = !engineOk || vstate.wakeOn;
    b.style.opacity = b.disabled ? '0.5' : '';
    b.style.cursor = b.disabled ? 'not-allowed' : '';
    b.title = !engineOk
      ? engineUnavailableReason()
      : vstate.wakeOn
        ? 'Wake mode is on — just say “Zeno”. Turn it off in Settings → Voice to hold this button instead.'
        : `Hold to talk to Zeno. ${engineDescription()}`;
  }
}
export function setState(state, detail) {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  currentState = STATE_INFO[state] ? state : 'idle';
  currentDetail = detail || '';
  paintState();
}
/** Wake mode, if still on, keeps the microphone open after a command or a
 * spoken reply finishes — the true rest state is "listening for Zeno", not
 * idle, or the indicator would say the room stopped being heard when it did
 * not. */
export function settleToRest() {
  if (vstate.wakeOn) setState('listening', 'listening for “Zeno”');
  else setState('idle');
}
export function settleAfter(ms) {
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

export function stopSpeaking() {
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
export function reply(text) {
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
