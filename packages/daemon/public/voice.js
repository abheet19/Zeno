/*
 * Zeno Voice — the voice front-end for the Zeno window. Two modes: push-to-talk
 * (the default) and an opt-in wake word.
 *
 * WHAT THIS IS, PLAINLY. In the desktop application the renderer captures mono
 * PCM and hands bounded in-memory WAV segments through the context-isolated
 * preload to a local whisper.cpp service. The model remains warm on the owner's
 * GPU for low latency; no microphone audio is uploaded or written as a recording.
 * A browser-only build can still use its Web Speech API, and the UI describes the
 * provider hop instead of presenting that fallback as local.
 *
 * WHY WAKE MODE IS OPT-IN, AND WHAT IT COSTS. Push-to-talk opens the microphone
 * only while you hold a button. Wake mode holds it open until you switch it off,
 * which means it can hear every sound in the room. The panel states that before
 * the toggle can be turned on. Local voice activity detection keeps only a short
 * pre-roll and bounded utterance in memory; Zeno retains at most the last 15
 * seconds of untriggered transcript and drops it on switch-off.
 *
 * WHAT SPEAKING DOES. Speech becomes a transcript, which is run through the SAME
 * pure wake + grammar logic the package tests run against — imported from the
 * compiled module, not re-implemented here. That is why wake matching in this
 * file is `detectWake` inside `WakeListener` and not a regex written for the
 * browser. A recognised `add_task` creates a low-risk backlog record through
 * authenticated POST /work and is announced only after the daemon proves the
 * exact stored id and title. File changes remain proposals: `propose_write`
 * calls POST /previews. This file NEVER calls /approvals, in either mode.
 * Approving a proposal happens with your eyes and your click in this window.
 * Voice cannot approve; that boundary is structural.
 *
 * WHAT SPEAKING A JOB DOES. A `delegate` command ("build me a slugify utility")
 * asks POST /delegate, and a coding agent runs headless in a throwaway copy of
 * the repo. It changes the size of what speaking can start, not its power: every
 * file that agent writes comes back as an ordinary capsule waiting for the same
 * click. What speaking must never do is start something that costs money or
 * sends the owner's code away without being asked — so the panel asks the daemon
 * FIRST (`plan: true`, which starts nothing), says which agent would run and
 * what that costs, and only then lets a local model begin. A hosted agent waits
 * behind a button, every time, in both modes.
 *
 * DEPLOYMENT. This module imports the package's compiled pure core. Serve
 * `dist/src/session.js` (and its siblings `wake.js`, `grammar.js`, `listen.js`)
 * from the same URL directory as this file so the imports below resolve in the
 * browser.
 */

import { interpret } from './session.js';
import { EMPTY_COMMAND } from './grammar.js';
import { WakeListener, WAKE_WINDOW_MS, RETENTION_MS } from './listen.js';

// ---- the owner token, read the same way the rest of the window reads it -----
// The daemon writes it into this meta tag before serving the shell. Empty means
// "this browser cannot authenticate" — we still listen and interpret, but we
// cannot propose, and we say so instead of posting an empty token.
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

import { SpeechRecognition, localSpeech, waitForSpeechIdle } from './whisper.js';

// ---- the wake-mode preference, per device ----------------------------------
// Stored with the version of the disclosure that was accepted. Bumping
// DISCLOSURE_VERSION re-asks everyone: consent to an older, weaker description of
// what the microphone does is not consent to this one.

const WAKE_PREF_KEY = 'zeno.voice.wake';
// v4 discloses that voice can create a Work item directly. Earlier consent,
// including v3 consent to the local Whisper path, is re-requested.
const DISCLOSURE_VERSION = 4;

function readWakePref() {
  try {
    const raw = window.localStorage.getItem(WAKE_PREF_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && parsed.on === true && parsed.disclosure === DISCLOSURE_VERSION && (!localSpeech || parsed.engine === 'whisper');
  } catch {
    // Private mode, storage disabled, or corrupt JSON. Default to OFF — the
    // safe direction for a preference about an open microphone.
    return false;
  }
}

function writeWakePref(on) {
  try {
    if (on) {
      window.localStorage.setItem(WAKE_PREF_KEY, JSON.stringify({ on: true, disclosure: DISCLOSURE_VERSION, engine: localSpeech ? 'whisper' : 'browser' }));
    } else {
      window.localStorage.removeItem(WAKE_PREF_KEY);
    }
  } catch {
    // Not being able to remember the choice is not a reason to refuse it. The
    // mode still works for this session; it just will not survive a reload.
  }
}

// ---- the disclosure text, in one place --------------------------------------
// Written to be read, not skimmed past: what happens to the microphone, where
// the audio goes, how long it lasts, what Zeno keeps, and what speaking still
// cannot do. Each sentence is its own string so it renders as a list.

const DISCLOSURE_TITLE = 'Before you turn on “Listen for Zeno”, read this.';

const DISCLOSURE_POINTS = localSpeech ? [
  'The microphone stays on until you switch wake mode off. Zeno uses a local Whisper model on this PC and does not send microphone audio to a provider.',
  'The recognizer hears the whole room. Only a recognized Zeno wake phrase opens a command window. Recognition can make mistakes: inspect every transcript and result.',
  'Voice activity detection keeps a short in-memory pre-roll and bounded speech segment. Zeno keeps up to 15 seconds of untriggered transcript, drops it on switch-off, and writes no audio recording.',
  'Closing this window stops capture. If you leave wake mode on, this choice is remembered on this device and shown in the listening bar when you reopen Zeno.',
  'Speaking can navigate, read state, and add a Work item directly. File changes remain proposals and voice never approves them. Use the Stop listening control at any time.',
] : [
  'The microphone stays on. From the moment you switch this on, this page holds the microphone open and listens to the whole room — not only when you are speaking to Zeno.',
  'Your browser sends the audio away to be transcribed. Recognition is the browser’s Web Speech API. In Chrome, Edge and Safari it uploads what the microphone hears to the browser maker’s servers to turn it into text, so it is not on-device and it is not processed on this machine. Zeno has no on-device wake model, so it cannot offer this any other way — and it will not pretend the room stays local.',
  'It keeps listening until you switch it off. There is no timer and no auto-off. Closing this window closes the microphone — but the switch is remembered on this device, so opening Zeno again turns it back on. The bar at the top of the window says so whenever it is open, on every surface, and can switch it off from there.',
  'What Zeno itself keeps is bounded — and only that. At most the last 15 seconds of untriggered transcript, held in memory, never written to disk, and dropped the instant you switch off. You can see exactly what is being held while it is on. That is a bound on Zeno’s retention, not on the audio: the audio has already left this machine, and how long your browser maker keeps it is their policy, which Zeno cannot see, limit or delete.',
  'Speaking can navigate, read state, and add a Work item directly. File changes remain proposals. A wake word only starts a command; nothing is ever approved by voice, in either mode. Anything that needs your decision waits for your click in this window.',
];

const RETENTION_LABEL = localSpeech
  ? 'Local Whisper speech. Up to 15 seconds of untriggered transcript are held in memory and dropped on switch-off; no audio file or cloud upload.'
  :
  'Retained by Zeno: at most the last ' +
  Math.round(RETENTION_MS / 1000) +
  ' seconds of untriggered transcript, in memory only, never written to disk, dropped when you switch off. This bounds what Zeno keeps, and only what Zeno keeps. It does not make the audio local — the audio already went to your browser maker to be transcribed, and what they keep of it is their policy, not Zeno’s to bound.';

// ---- tiny DOM helpers -------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

// ---- the panel --------------------------------------------------------------

function mountPanel() {
  const host = document.querySelector('[data-mount="voice"]') || document.body;
  const outerDisclosure = host.closest?.('.cmd-voice-more') || null;
  const panel = el('section', 'zv-panel');
  panel.setAttribute('aria-label', 'Zeno voice');
  // COMPACT BY DEFAULT. On a dashboard this is a control, not an essay: two
  // buttons, one line of state, one line of status, one sentence of consequence
  // and a disclosure holding the rest. Nothing was deleted to get here — the
  // long form is in the disclosure below, and paint() forces that disclosure
  // open and holds it open for as long as a microphone is actually armed.
  panel.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:7px',
    'padding:11px 13px', 'border:1px solid var(--rule,#242C31)', 'border-radius:12px',
    'background:var(--g3,#151A1D)', 'color:var(--ink,#ECEBE6)', 'max-width:560px', 'font:13px/1.5 system-ui,sans-serif',
  ].join(';');

  const row = el('div', 'zv-row');
  row.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';

  const button = el('button', 'zv-ptt', 'Hold to talk');
  button.type = 'button';
  button.style.cssText = [
    'padding:10px 18px', 'border-radius:999px',
    'border:1px solid var(--cyan-dim,#1E6B76)', 'background:var(--g5,#222A2E)',
    'color:var(--ink,#ECEBE6)', 'font:600 13px system-ui,sans-serif', 'cursor:pointer', 'user-select:none', 'touch-action:none',
  ].join(';');

  const wakeToggle = el('button', 'zv-wake-toggle', 'Listen for “Zeno”');
  wakeToggle.type = 'button';
  wakeToggle.setAttribute('aria-pressed', 'false');
  wakeToggle.setAttribute('aria-expanded', 'false');
  wakeToggle.setAttribute('aria-controls', 'zv-disclosure');
  wakeToggle.style.cssText = [
    'padding:10px 16px', 'border-radius:999px',
    'border:1px solid var(--rule-2,#2C353B)', 'background:transparent',
    'color:var(--ink-2,#9AA1AC)', 'font:600 13px system-ui,sans-serif', 'cursor:pointer', 'user-select:none',
  ].join(';');

  row.append(button, wakeToggle);

  // THE INDICATOR. Always in the DOM, never removed, and never colour alone: a
  // glyph AND a word, so it survives a monochrome screen, a colour-blind reader
  // and a screenshot. It is a live region so a screen reader is told too.
  const indicator = el('div', 'zv-state');
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.style.cssText = [
    'display:flex', 'gap:8px', 'align-items:baseline', 'flex-wrap:wrap',
    'padding:8px 10px', 'border-radius:8px', 'border:1px solid var(--rule-2,#2C353B)',
    'background:var(--g2,#101416)',
  ].join(';');
  const stateGlyph = el('span', 'zv-state-glyph', '○');
  stateGlyph.setAttribute('aria-hidden', 'true');
  stateGlyph.style.cssText = 'font-size:14px;line-height:1';
  const stateWord = el('span', 'zv-state-word', 'WAKE MODE OFF');
  stateWord.style.cssText = 'font:700 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em';
  // Must match FACES.off in wireWake(): this is what the indicator says before
  // (and, when there is no engine at all, instead of) the first render.
  const stateDetail = el(
    'span',
    'zv-state-detail',
    'Not listening for a wake word. The microphone opens only while you hold the button.',
  );
  stateDetail.style.cssText = 'font-size:12px;color:var(--ink-2,#9AA1AC);min-width:0';
  indicator.append(stateGlyph, stateWord, stateDetail);

  // Status, what was heard and what came of it were three stacked paragraphs
  // each reserving a blank line. They are the same three facts on one line now;
  // not one word of any of them is dropped, and each still has its own element
  // so a screen reader reads them apart.
  const line = el('div', 'zv-line');
  line.style.cssText = 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:12px;min-width:0';
  const status = el('p', 'zv-status', 'Idle.');
  status.style.cssText = 'margin:0;color:var(--ink-2,#9AA1AC);flex:none';
  const heard = el('p', 'zv-heard');
  heard.style.cssText = 'margin:0;min-width:0;overflow-wrap:anywhere';
  const outcome = el('p', 'zv-outcome');
  outcome.style.cssText = 'margin:0;min-width:0;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  line.append(status, heard, outcome);

  // What Zeno is holding, shown only while wake mode is on — a claim the owner
  // can check against their own ears rather than take on trust.
  const retention = el('div', 'zv-retention');
  retention.hidden = true;
  retention.style.cssText = 'padding:8px 10px;border-radius:8px;border:1px dashed var(--rule-2,#2C353B)';
  const retentionLabel = el('p', 'zv-retention-label', RETENTION_LABEL);
  retentionLabel.style.cssText = 'margin:0;font-size:11.5px;color:var(--ink-3,#6C7480)';
  const retentionText = el('p', 'zv-retention-text', 'Holding now: nothing.');
  retentionText.style.cssText = 'margin:4px 0 0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  retention.append(retentionLabel, retentionText);

  // The disclosure, hidden until the owner asks to turn wake mode on. It is not
  // a tooltip and not a footnote: it is a gate in front of the switch.
  const disclosure = el('div', 'zv-disclosure');
  disclosure.hidden = true;
  disclosure.id = 'zv-disclosure';
  disclosure.setAttribute('role', 'group');
  disclosure.setAttribute('aria-label', 'What turning on wake mode does');
  // Focusable by script only. A disclosure that is rendered but never focused is
  // a disclosure a keyboard or screen-reader owner never receives, and the whole
  // point is that it is READ before the microphone opens.
  disclosure.setAttribute('tabindex', '-1');
  disclosure.style.outline = 'none';
  // OVERLAID, not inserted into the flow. As an inline block this is 544px of
  // text that appears at the bottom of a 6,000px scroller, so opening it had to
  // scroll the view ~700px to show it — measured, and it reads as the window
  // flipping rather than a panel opening. Asking for a smooth scroll does not
  // help: this machine sets prefers-reduced-motion, which Chrome honours by
  // making the scroll instant again.
  //
  // A consent gate is a blocking decision, so it belongs over the page rather
  // than inside it. Nothing moves when it opens, and it cannot land off-screen.
  disclosure.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'z-index:1000', 'width:min(560px,calc(100vw - 48px))', 'max-height:80vh', 'overflow:auto',
    'padding:16px 18px', 'border-radius:12px',
    'border:1px solid var(--amber,#E0A128)', 'background:color-mix(in srgb,var(--amber,#E0A128) 10%,var(--g2,#101416))',
    'box-shadow:0 24px 64px rgba(0,0,0,.55)',
  ].join(';');

  // The backdrop both dims the page and swallows clicks, so the gate cannot be
  // answered by accident through it. It is a sibling of the panel, never its
  // parent, so the panel's own DOM position and id are untouched.
  const backdrop = el('div', 'zv-backdrop');
  backdrop.hidden = true;
  backdrop.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:999', 'background:rgba(0,0,0,.5)',
  ].join(';');
  const dTitle = el('p', 'zv-disclosure-title', DISCLOSURE_TITLE);
  dTitle.style.cssText = 'margin:0 0 8px;font-weight:700;color:var(--ink,#ECEBE6)';
  const dList = el('ul', 'zv-disclosure-list');
  dList.style.cssText = 'margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--ink,#ECEBE6)';
  for (const point of DISCLOSURE_POINTS) dList.appendChild(el('li', null, point));

  const ackLabel = el('label', 'zv-ack');
  ackLabel.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin:10px 0 0;font-size:12.5px;cursor:pointer';
  const ack = document.createElement('input');
  ack.type = 'checkbox';
  ack.className = 'zv-ack-box';
  ack.style.cssText = 'margin-top:3px;flex:none';
  ackLabel.append(ack, el('span', null, (localSpeech ? 'I understand the microphone stays on and speech is recognized locally on this PC.' : 'I understand the microphone stays on and my browser sends the audio to its maker to transcribe.')));

  const dButtons = el('div', 'zv-disclosure-buttons');
  dButtons.style.cssText = 'display:flex;gap:10px;margin-top:10px;flex-wrap:wrap';
  const confirm = el('button', 'zv-confirm', 'Turn the microphone on');
  confirm.type = 'button';
  confirm.disabled = true;
  confirm.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--amber,#E0A128)',
    'background:transparent', 'color:var(--ink,#ECEBE6)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  const cancel = el('button', 'zv-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--rule-2,#2C353B)',
    'background:transparent', 'color:var(--ink-2,#9AA1AC)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  dButtons.append(confirm, cancel);
  disclosure.append(dTitle, dList, ackLabel, dButtons);

  // THE ONE SENTENCE THAT IS NEVER FOLDED AWAY. It names the vendor, and it
  // names what speaking can and cannot do. It sits outside the disclosure, so
  // it is on screen whether the disclosure is open, closed, or has never been
  // touched — armed or idle.
  const plain = el(
    'p',
    'zv-plain',
    localSpeech ? 'Speech recognition runs through a local Whisper model. No audio is uploaded. Voice can add a Work item directly; file changes wait for your review; voice never approves.' :
    'Recognition is your browser’s, not Zeno’s: it uploads your audio to the browser maker to be ' +
      'transcribed. Voice can add a Work item directly; file changes wait for your review; nothing is ever approved by voice.',
  );
  plain.style.cssText = 'margin:0;font-size:11.5px;line-height:1.5;color:var(--ink-2,#9AA1AC)';

  // The long form, shortened from nothing and deleted from nowhere: the same
  // paragraph that used to sit open under the panel, now one click away — and
  // forced open by paint() for as long as a microphone is armed.
  const how = el('details', 'zv-how');
  how.appendChild(el('summary', null, 'how this works'));
  const note = el(
    'p',
    'zv-note',
    // "built-in" and "in most browsers" both softened this into something an
    // owner could read as "probably local, probably mine". Neither survives: the
    // engine is not Zeno's, and every browser that offers this API is one of the
    // three named, so there is no comfortable "most" to hide in.
    localSpeech ? 'The desktop uses a local Whisper model accelerated by the available GPU. Push-to-talk listens while held; wake mode listens until switched off. No audio is recorded or uploaded. A spoken add-task command creates a Work item directly and reports success only after the daemon proves the exact stored item. File changes wait for review; voice cannot approve.' :
    'Recognition is your browser’s Web Speech API, not a Zeno model. In the browsers that have ' +
      'it (Chrome, Edge, Safari) it uploads your audio to the browser maker’s servers to ' +
      'transcribe, so it is not on-device, and Zeno can neither see nor limit what they keep. ' +
      'A spoken add-task command creates a Work item directly and reports success only after the daemon proves the exact stored item. File changes wait for review; nothing is ever approved by voice. Anything that needs ' +
      'your decision waits for your click in this window. Push-to-talk opens the microphone only ' +
      'while you hold the button; wake mode holds it open until you switch it off.',
  );
  note.style.cssText = 'margin:6px 0 0;font-size:11.5px;color:var(--ink-3,#6C7480)';

  how.appendChild(note);

  // THE DELEGATION BLOCK. Shown only when a spoken sentence asked for WORK —
  // "build me a slugify utility" — which is the one thing speaking can start
  // that is not a single file. It is its own block, above the folded-away
  // explanation and below the live state, because it carries the sentence that
  // must be read before anything runs: which agent is about to work, and, for a
  // hosted one, that it costs money and sends the code off this machine.
  const delegate = el('div', 'zv-delegate');
  delegate.hidden = true;
  delegate.setAttribute('role', 'group');
  delegate.setAttribute('aria-label', 'Work Zeno was asked to delegate');
  delegate.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:8px',
    'padding:10px 12px', 'border-radius:10px',
    'border:1px solid var(--rule-2,#2C353B)', 'background:var(--g2,#101416)',
  ].join(';');
  const delegateTask = el('p', 'zv-delegate-task');
  delegateTask.style.cssText = 'margin:0;font-size:12.5px;color:var(--ink,#ECEBE6);overflow-wrap:anywhere';
  const delegateAgent = el('p', 'zv-delegate-agent');
  delegateAgent.style.cssText = 'margin:0;font:700 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;color:var(--ink-2,#9AA1AC)';
  const delegateWhy = el('p', 'zv-delegate-why');
  delegateWhy.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  // A live region: the run's progress and its result are announced, not just drawn.
  const delegateState = el('p', 'zv-delegate-state');
  delegateState.setAttribute('role', 'status');
  delegateState.setAttribute('aria-live', 'polite');
  delegateState.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  const delegateButtons = el('div', 'zv-delegate-buttons');
  delegateButtons.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  delegateButtons.hidden = true;
  const delegateRun = el('button', 'zv-delegate-run', 'Run it');
  delegateRun.type = 'button';
  delegateRun.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--amber,#E0A128)',
    'background:transparent', 'color:var(--ink,#ECEBE6)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  const delegateSkip = el('button', 'zv-delegate-skip', 'Not now');
  delegateSkip.type = 'button';
  delegateSkip.style.cssText = [
    'padding:8px 14px', 'border-radius:8px', 'border:1px solid var(--rule-2,#2C353B)',
    'background:transparent', 'color:var(--ink-2,#9AA1AC)', 'font:600 12.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  delegateButtons.append(delegateRun, delegateSkip);
  const delegateLink = el('button', 'zv-delegate-link', 'review what is waiting ›');
  delegateLink.type = 'button';
  delegateLink.hidden = true;
  delegateLink.style.cssText = [
    'align-self:flex-start', 'padding:0', 'border:0', 'background:none',
    'color:var(--cyan,#2AA5B8)', 'font:600 12px system-ui,sans-serif', 'cursor:pointer', 'text-align:left',
  ].join(';');
  delegate.append(delegateTask, delegateAgent, delegateWhy, delegateState, delegateButtons, delegateLink);

  panel.append(row, indicator, line, delegate, retention, disclosure, plain, how);
  // The backdrop hangs off the panel too, so tearing the panel down takes it.
  panel.appendChild(backdrop);
  host.appendChild(panel);
  return {
    panel, button, wakeToggle, status, heard, outcome,
    stateGlyph, stateWord, stateDetail,
    retention, retentionText,
    disclosure, backdrop, ack, confirm, cancel,
    delegate, delegateTask, delegateAgent, delegateWhy, delegateState,
    delegateButtons, delegateRun, delegateSkip, delegateLink,
    plain, how, outerDisclosure,
  };
}

const ui = mountPanel();

/*
 * The disclosure may be folded away only while nothing is listening.
 *
 * paint() sets `data-armed` from the same MIC state the live bar is drawn from,
 * and this puts the panel back open the instant anything tries to close it over
 * an open microphone. Shortening the explanation is a layout decision; hiding it
 * while the room is being uploaded would be a different thing entirely, and this
 * is the line between the two. The one-sentence version above it is outside the
 * disclosure and is never affected either way.
 */
ui.how.addEventListener('toggle', () => {
  if (ui.how.dataset.armed === '1' && !ui.how.open) ui.how.open = true;
});
ui.outerDisclosure?.addEventListener('toggle', () => {
  if (ui.outerDisclosure.dataset.armed === '1' && !ui.outerDisclosure.open) {
    ui.outerDisclosure.open = true;
  }
});

// ---- the live-microphone bar: one truth, outside every surface --------------
/*
 * The panel's indicator is honest but HIDEABLE. It lives inside the Command
 * surface, and the shell (nav.js) hides a whole surface with [hidden] — which
 * is `display:none`, so the node leaves the render tree AND the accessibility
 * tree — the moment the owner switches to Forge or Counsel. With wake mode on,
 * that is the exact failure this feature must not have: the room keeps
 * streaming to the browser maker, the only thing that said so is gone, and so
 * is the switch that turns it off. Worse on a reload, where the shell restores
 * the surface the owner was last on: the microphone can reopen at first paint
 * with no visible indicator at any point.
 *
 * So the claim is made TWICE. Once in the panel, and once in a fixed bar
 * mounted on <body> — outside every surface, above everything, with its own
 * stop control so switching off never requires navigating back to find the
 * toggle. Nothing that hides a surface can hide this.
 *
 * It is also the only place that told the truth about push-to-talk. The panel
 * indicator describes WAKE mode, and while a finger is on the hold button the
 * microphone is open too — "The microphone is not open." was simply false for
 * as long as the button was held.
 */

/** The single source of truth for "is a microphone open right now". Both
 * recognisers write here; `paint()` is the only thing that reads it. */
const MIC = {
  ptt: false,           // the push-to-talk engine is open
  wakeOn: false,        // the owner's wake switch
  wakeEngineUp: false,  // the wake engine is actually running
  // When the engine last went down. Browsers END a continuous session every few
  // seconds and we restart it immediately, so the honest-but-literal "stopped;
  // reconnecting" was painting many times a minute and the panel visibly
  // flickered between two true states. A restart that completes inside the grace
  // window is not worth reporting — it is how the API normally behaves.
  engineDownAt: 0,
  RECONNECT_GRACE_MS: 1500,
  wakeState: 'off',     // 'off' | 'armed' | 'open', from the pure listener
  windowLeftMs: 0,
  wakeStarting: false,
  // A soft pause. The microphone stays open and stays disclosed; only ACTING on
  // a command is held. This is not privacy — closing the microphone is the Stop
  // control below. Mute is "hold my calls": keep the wake session, ignore what
  // it hears, until the owner unmutes. Reset whenever listening fully stops so a
  // later session never starts silently muted.
  muted: false,
};

// Filled in by the two wiring functions below, so the bar's stop button can
// close whatever is open without knowing which mode opened it.
let abortPtt = () => {};
let abortWake = () => {};
let turnWakeOff = () => {};

/** Command owns its two recognizers internally. Any named capture owner is a
 * different surface and blocks both PTT and wake mode. */
function externalCaptureOwner() {
  const owner = document.body.dataset.zenoCapture || '';
  return owner !== '' && owner !== 'command' ? owner : null;
}

function captureOwnerLabel(owner) {
  if (owner === 'counsel') return 'Counsel';
  if (owner === 'ask') return 'Ask Zeno voice conversation';
  return 'Another voice surface';
}

// Cross-surface handoff is an explicit UI request, not automatic meeting detection.
// Native renderer 'end' can precede OS child shutdown, hence the second idle wait.
window.addEventListener('zeno:release-command-voice', event => {
  const requestedBy = event.detail?.requestedBy || 'another voice surface';
  const waits = [turnWakeOff(`Command listening paused for ${requestedBy}.`), abortPtt()];
  event.detail?.waiters?.push(Promise.all(waits).then(() => waitForSpeechIdle()));
});

function closeRecognizer(recognition, running) {
  if (!running) return waitForSpeechIdle();
  return new Promise(resolve => {
    const previous = recognition.onend;
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (recognition.onend === ended) recognition.onend = previous;
      resolve();
    };
    const ended = event => { finish(); previous?.call(recognition, event); };
    recognition.onend = ended;
    timer = window.setTimeout(finish, 2000);
    try { recognition.abort(); } catch { finish(); }
  }).then(() => waitForSpeechIdle());
}


function mountLiveBar() {
  const bar = el('div', 'zv-live');
  bar.hidden = true;
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'assertive');
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483000',
    // `display` is set by paint(), never here: an inline `display:flex` beats
    // the user-agent's `[hidden]{display:none}`, so the bar would be a
    // permanent empty stripe and `hidden` would mean nothing.
    'display:none', 'gap:10px', 'align-items:center', 'justify-content:center', 'flex-wrap:wrap',
    // The bar overlaps the application header. Its status text must not make the
    // navigation beneath it unclickable; only the explicit stop control owns a
    // pointer target.
    'pointer-events:none',
    'padding:8px 14px', 'background:var(--amber,#E0A128)', 'color:#12171A',
    'box-shadow:0 2px 10px rgba(0,0,0,.35)',
  ].join(';');
  const glyph = el('span', 'zv-live-glyph', '●');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.style.cssText = 'font-size:13px;line-height:1';
  const word = el('span', 'zv-live-word', 'MICROPHONE OPEN');
  word.style.cssText = 'font:700 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em';
  const why = el('span', 'zv-live-why', '');
  why.style.cssText = 'font:400 12px/1.4 system-ui,sans-serif;min-width:0';
  const pillCss = [
    'margin-left:4px', 'padding:4px 12px', 'border-radius:999px',
    'border:1px solid #12171A', 'background:transparent', 'color:#12171A',
    'font:700 11.5px system-ui,sans-serif', 'cursor:pointer', 'pointer-events:auto',
  ].join(';');
  // Mute is the softer sibling of Stop: it keeps the microphone open (and the
  // bar keeps saying so) but pauses acting on commands. `paint()` owns its
  // label — this only flips the flag and redraws.
  const mute = el('button', 'zv-live-mute', 'Mute');
  mute.type = 'button';
  mute.style.cssText = pillCss;
  mute.addEventListener('click', () => {
    MIC.muted = !MIC.muted;
    setOutcome(
      MIC.muted
        ? 'Muted. The microphone stays open, but Zeno will not act on a command until you unmute.'
        : 'Unmuted. Zeno is acting on what it hears again.',
      MIC.muted ? 'warn' : 'ok',
    );
    paint();
  });
  const stop = el('button', 'zv-live-stop', 'Stop listening');
  stop.type = 'button';
  stop.style.cssText = pillCss;
  stop.addEventListener('click', () => {
    MIC.muted = false; // a fresh session later must not start silently muted
    turnWakeOff('Wake mode off. The microphone is closed and the retained transcript was dropped.');
    abortPtt();
  });
  bar.append(glyph, word, why, mute, stop);
  document.body.appendChild(bar);
  return { bar, glyph, word, why, mute, stop };
}

const live = mountLiveBar();

// The four faces the indicator can wear. `ptt` is the one the panel never had:
// push-to-talk holds the microphone open, and saying otherwise was a lie for
// exactly as long as the owner's finger was down.
// Every detail must be true at the instant it renders, and must be the WHOLE
// truth of that state — this is a live region, and it is the one line the panel
// teaches the owner to trust for "can this thing hear me right now". Two details
// failed that and are rewritten here:
//
//  - `off` asserted the microphone was not open. Even with a `ptt` face beside
//    it, "off" is the state the indicator falls back to, and it must not claim
//    the microphone is shut — it says what DOES open it instead.
//  - `armed` led with "Nothing is being captured", the reassuring half of the
//    truth, shown continuously during the exact state whose cost is an open
//    microphone uploading the room. The qualifier "as a command" does not undo
//    what a skimming owner reads, so the cost now travels with the state.
const FACES = {
  off: {
    glyph: '○',
    word: 'WAKE MODE OFF',
    detail: 'Not listening for a wake word. The microphone opens only while you hold the button.',
  },
  ptt: {
    glyph: '●',
    word: 'MICROPHONE OPEN',
    detail: localSpeech ? 'Push-to-talk. The microphone is open while held, and speech is recognized on this PC.' : 'Push-to-talk. The microphone is open while you hold the button, and your browser is sending what it hears away to be transcribed.',
  },
  armed: {
    glyph: '◉',
    word: 'LISTENING FOR “ZENO”',
    detail:
      localSpeech ? 'The microphone is open. Whisper recognizes speech locally; say “Zeno” to open a command window.' :
      'The microphone is open and your browser is sending the room to its maker to be transcribed. Nothing becomes a command until you say “Zeno”.',
  },
  open: { glyph: '●', word: 'HEARD “ZENO”', detail: 'Command window open. Say your command.' },
};

function setNodeText(node, value) {
  const text = String(value);
  if (node.textContent !== text) node.textContent = text;
}

/** Draw the microphone's real state in both places. Called by everything that
 * can change it; it decides nothing itself. */
function paint() {
  // Deliberately NOT softened by a grace window. Browsers do end a continuous
  // session and we reopen it within ~250ms, so naming the gap does flicker —
  // but the auto-restart is always shorter than any grace worth the name, so a
  // grace long enough to hide the churn hides every real outage too, and the
  // bar would then read "MICROPHONE OPEN · your browser is sending what it
  // hears away to be transcribed" over a closed microphone that is sending
  // nothing. This bar exists so that what it says is true at the instant it
  // says it; a moment of honest churn is the cheaper cost.
  const open = MIC.ptt || MIC.wakeEngineUp;

  // -- the disclosure. Armed means "a microphone is open, or the owner has left
  // wake mode on and it is reopening" — the same condition the bar is shown on.
  // While that is true the long form is opened and pinned open.
  const armed = open || MIC.wakeOn;
  ui.how.dataset.armed = armed ? '1' : '0';
  if (armed) ui.how.open = true;
  if (ui.outerDisclosure) {
    ui.outerDisclosure.dataset.armed = armed ? '1' : '0';
    if (armed) ui.outerDisclosure.open = true;
  }

  // -- the bar. Shown whenever a microphone is open, and also while wake mode
  // is on but the engine is down: "on, reopening in a moment" is still a room
  // the owner has left armed, and hiding the bar in that gap would teach them
  // that a missing bar means a closed microphone.
  const showBar = open || MIC.wakeOn;
  live.bar.hidden = !showBar;
  live.bar.style.display = showBar ? 'flex' : 'none';
  if (open) {
    setNodeText(live.word, 'MICROPHONE OPEN');
    setNodeText(live.why, MIC.ptt
      ? 'Push-to-talk is holding it open.'
      : MIC.wakeState === 'open'
        ? 'Wake mode heard “Zeno” — a command window is open.'
        : localSpeech ? 'Wake mode is listening for “Zeno” with local Whisper speech recognition.' : 'Wake mode is listening to the whole room for “Zeno”. Your browser is sending what it hears away to be transcribed.');
    setNodeText(live.glyph, '●');
  } else if (MIC.wakeOn) {
    setNodeText(live.word, MIC.wakeStarting ? 'STARTING LOCAL SPEECH' : 'WAKE MODE ON · RECONNECTING');
    setNodeText(
      live.why,
      MIC.wakeStarting
        ? 'Preparing the local recognizer; the microphone opens when it is ready.'
        : 'The recognizer stopped; the microphone reopens in a moment.',
    );
    setNodeText(live.glyph, '○');
  }
  // Muted overlays the open-microphone truth, it does not replace it: the word
  // still says the microphone is OPEN so the disclosure never weakens, and the
  // detail adds that commands are held. Only meaningful while something is
  // actually capturing — a reconnecting engine has nothing to act on anyway.
  if (MIC.muted && open) {
    setNodeText(live.word, 'MICROPHONE OPEN · MUTED');
    setNodeText(live.why, 'Muted — the microphone is still open and disclosed, but Zeno will not act on a command until you unmute.');
    setNodeText(live.glyph, '⊘');
  }
  setNodeText(live.mute, MIC.muted ? 'Unmute' : 'Mute');
  live.mute.setAttribute('aria-pressed', MIC.muted ? 'true' : 'false');
  live.mute.hidden = !open; // nothing to mute unless the microphone is open
  setNodeText(live.stop, MIC.wakeOn ? 'Stop listening' : 'Close the microphone');

  // -- the panel indicator, from the same state.
  const state = MIC.wakeOn ? MIC.wakeState : MIC.ptt ? 'ptt' : 'off';
  const face = FACES[state] || FACES.off;
  setNodeText(ui.stateGlyph, face.glyph);
  setNodeText(ui.stateWord, face.word);

  let detail = face.detail;
  if (state === 'open') {
    detail = `Command window open — ${(MIC.windowLeftMs / 1000).toFixed(1)}s left. Say your command.`;
  } else if (state === 'armed' && !MIC.wakeEngineUp) {
    // Browsers stop a continuous session on their own; say so rather than
    // showing "armed" while nothing is actually running. This is the one armed
    // moment when the microphone genuinely is not open, so it is also the one
    // moment the detail may say so.
    detail = MIC.wakeStarting
      ? 'Preparing the local recognizer. The microphone opens when it is ready.'
      : localSpeech
        ? 'The local recognizer stopped; reconnecting. The microphone reopens when it does.'
        : 'The browser’s recognizer stopped; reconnecting. The microphone reopens when it does.';
  }
  setNodeText(ui.stateDetail, detail);

  // Colour is an ADDITION to the glyph and the word, never the only signal.
  const tint =
    state === 'open' || state === 'ptt'
      ? 'var(--gold,#E0A128)'
      : state === 'armed'
        ? 'var(--cyan,#4FD1DB)'
        : 'var(--ink-3,#6C7480)';
  ui.stateGlyph.style.color = tint;
  ui.stateWord.style.color = state === 'off' ? 'var(--ink-3,#6C7480)' : 'var(--ink,#ECEBE6)';
}

// A frozen page (bfcache) that kept a recogniser would be listening with no
// window to say so. Nothing here writes the preference: this closes the
// microphone, it does not un-choose wake mode.
window.addEventListener('pagehide', () => {
  abortPtt();
  abortWake();
});

function setStatus(text) {
  ui.status.textContent = text;
}
function setHeard(text) {
  ui.heard.textContent = text ? `Heard: “${text}”` : '';
}
function setOutcome(text, tone) {
  ui.outcome.textContent = text || '';
  ui.outcome.style.color = tone === 'ok' ? 'var(--green,#5BB98C)' : tone === 'warn' ? 'var(--amber,#E0A128)' : 'var(--ink-2,#9AA1AC)';
}

// ---- no engine: disable honestly, do not pretend ----------------------------

if (!SpeechRecognition) {
  ui.button.disabled = true;
  ui.button.style.opacity = '0.5';
  ui.button.style.cursor = 'not-allowed';
  ui.wakeToggle.disabled = true;
  ui.wakeToggle.style.opacity = '0.5';
  ui.wakeToggle.style.cursor = 'not-allowed';
  ui.wakeToggle.textContent = 'Listen for “Zeno” — unavailable';
  ui.wakeToggle.title = 'This browser has no Web Speech API, so there is no recogniser to listen with.';
  setStatus(
    'This browser has no Web Speech API, so there is no recogniser to listen with: neither ' +
      'push-to-talk nor “Listen for Zeno” can run here. Both are switched off, not silently idle.',
  );
  setOutcome('Use the buttons and the keyboard in this window instead.', 'warn');
} else {
  wireRecognition();
  wireWake();
}

// ---- push-to-talk: unchanged, and still the default -------------------------

function wireRecognition() {
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  // A held button is an explicit command capture, so local Whisper may use a
  // short vocabulary hint for the product terms and grammar phrases that are
  // otherwise easy to confuse (for example, "waiting" and "waving"). Wake
  // listening stays neutral: biasing an always-open recognizer toward "Zeno"
  // would increase the chance of a false activation from room audio.
  if (localSpeech) {
    recognition.initialPrompt =
      'Zeno, what is waiting? Show pending items. Show receipts. Verify the ledger. ' +
      'Open Command. Open Forge. Open Counsel. Add a task. Create a component. Build a feature.';
  }

  let listening = false;
  let finalText = '';
  let heardInterim = '';
  // Whether the owner's finger is still down. The engine's lifecycle and the
  // button's state are NOT the same thing, and conflating them is what made the
  // button appear to let go on its own — see `onend`.
  let held = false;
  // A restart that fails immediately would spin. Two is enough to ride out a
  // silence timeout; beyond that something is actually wrong, so give up and say so.
  let restarts = 0;
  let recognitionError = '';

  recognition.onresult = (event) => {
    let interim = '';
    finalText = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const res = event.results[i];
      if (res.isFinal) finalText += (finalText ? ' ' : '') + res[0].transcript;
      else interim += res[0].transcript;
    }
    if (interim) {
      heardInterim = interim.trim();
      setHeard(heardInterim);
    }
  };

  recognition.onstart = () => {
    // The engine is confirmed open. `start()` already claimed it optimistically;
    // this is the confirmation, and the point at which "open" is certain.
    MIC.ptt = true;
    paint();
  };

  recognition.onerror = (event) => {
    recognitionError = event.error === 'network'
      ? 'The browser speech service is unavailable. No transcript was received. Try again when it is reachable, or use typed Ask Zeno.'
      : `Recognition error: ${event.error}. No transcript was received.`;
    setStatus(recognitionError);
    // A refused microphone fails instantly and would fail again just as fast,
    // so stop treating the held finger as a reason to reopen. Without this the
    // restart in `onend` retries a permission the owner has already denied.
    // Service errors are not silence. Retrying immediately causes the capture
    // indicator to flash, and cannot repair an unavailable speech backend.
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      held = false;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
  };

  recognition.onend = () => {
    const text = finalText.trim();

    // `continuous = false`, so the browser ends the session after a short
    // silence — NOT when the button is released. Holding the button and
    // pausing to think therefore ended the session, and this handler reset the
    // label to "Hold to talk" under a finger that never lifted.
    //
    // The finger is the authority, not the engine. If it is still down and
    // nothing has been transcribed yet, reopen the engine and leave the UI
    // exactly as it is.
    if (held && text === '' && restarts < 2) {
      restarts += 1;
      try {
        recognition.start();
        return;
      } catch {
        // Could not reopen — fall through and reset honestly rather than
        // leaving the button reading "Listening…" over a closed microphone.
      }
    }

    listening = false;
    MIC.ptt = false;
    paint();
    ui.button.textContent = 'Hold to talk';
    setStatus(recognitionError || 'Idle.');
    if (recognitionError) return;
    if (text) {
      handleTranscript(text);
    } else if (heardInterim) {
      // Speech was heard but the engine never finalised a transcript. Say so —
      // never leave a spoken command to vanish with the interim text just
      // sitting there, which reads as if Zeno acted or is still thinking.
      setOutcome('Did not catch a final transcript. Hold the button and try again.', 'warn');
    }
  };

  async function start() {
    const owner = externalCaptureOwner();
    if (owner) {
      held = false;
      setOutcome(`${captureOwnerLabel(owner)} is using the microphone. Stop it before using Command voice.`, 'warn');
      return;
    }
    if (listening) return;
    listening = true;
    finalText = '';
    heardInterim = '';
    recognitionError = '';
    setHeard('');
    setOutcome('');
    ui.button.textContent = 'Listening…';
    setStatus('Listening. Release to send.');
    // Claim the microphone BEFORE asking for it, and keep the claim if start()
    // throws: the only throw a browser raises here is "already started", which
    // means it is open. Over-reporting an open microphone is the safe direction
    // to be wrong in; under-reporting one is the failure this file exists to
    // avoid. `onend` is what takes the claim back.
    MIC.ptt = true;
    paint();
    try {
      await waitForSpeechIdle();
      if (!listening || !held) return;
      recognition.start();
    } catch {
      held = false; listening = false; MIC.ptt = false;
      ui.button.textContent = 'Hold to talk';
      setOutcome('The microphone did not become available. Stop other listening and retry.', 'warn');
      paint();
    }
  }

  function stop() {
    if (!listening) return;
    try {
      recognition.stop();
    } catch {
      /* no-op */
    }
  }

  // Closing the microphone NOW, discarding whatever is in flight — what the
  // bar's stop button and a page teardown need. `stop()` asks the engine to
  // finish and hand back a final result, which is right on button release and
  // wrong when the owner is saying "off".
  abortPtt = () => {
    held = false;
    finalText = '';
    heardInterim = '';
    const closing = closeRecognizer(recognition, listening);
    listening = false;
    MIC.ptt = false;
    ui.button.textContent = 'Hold to talk';
    paint();
    return closing;
  };

  // Push-to-talk: hold to talk, release to send.
  //
  // The pointer is CAPTURED on the way down. Without capture the button only
  // hears events while the cursor stays inside its box, so a hand that drifts a
  // few pixels mid-sentence fires `pointerleave` and the hold resets in the
  // middle of a word — the button appeared to let go on its own. Capture routes
  // every later event for this pointer back here, so the hold ends when the
  // owner lets go and not before, and `pointerleave` stops being a way to end
  // it at all.
  ui.button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    held = true;
    restarts = 0;
    try {
      ui.button.setPointerCapture(e.pointerId);
    } catch {
      // Capture can be refused. The window-level release below is what keeps
      // the microphone from being left open when it is.
    }
    start();
  });

  const release = (e) => {
    // Clear this FIRST: `stop()` ends the engine, which fires `onend`, and
    // `onend` reopens the microphone while the finger is still down. Releasing
    // is precisely the moment it no longer is.
    held = false;
    if (listening && recognition.active === false) {
      listening = false; MIC.ptt = false; ui.button.textContent = 'Hold to talk'; paint();
    }
    try {
      if (e && e.pointerId !== undefined && ui.button.hasPointerCapture(e.pointerId)) {
        ui.button.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* no-op */
    }
    stop();
  };

  ui.button.addEventListener('pointerup', release);
  ui.button.addEventListener('pointercancel', release);
  // If capture was refused, a release anywhere on the page still ends the hold.
  // `stop()` is a no-op when nothing is listening, so the second path costs
  // nothing — and an open microphone is never the failure mode.
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  ui.button.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat || held || ui.button.disabled) return;
    held = true;
    restarts = 0;
    start();
  });
  ui.button.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    release();
  });
  ui.button.addEventListener('blur', () => { if (held) abortPtt(); });
}

// ---- wake mode: opt-in, disclosed, and always visible while it runs ---------

function wireWake() {
  // All of the decision logic lives in the pure package — the same `detectWake`
  // the tests cover, the same grammar, the same closed Intent union. This
  // function only starts and stops a recogniser and renders what the machine
  // says. Nothing about wake matching is re-implemented here.
  const listener = new WakeListener();

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true; // the whole difference from push-to-talk
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let wakeOn = false;       // the owner's switch
  let engineUp = false;     // whether the recogniser is actually running
  let restartTimer = null;  // pending auto-restart
  let uiTimer = null;       // the countdown / retention refresher
  let consecutiveFailures = 0;
  let starting = false;

  // -- rendering ---------------------------------------------------------------

  function render() {
    // Wake mode does not own the indicator: push-to-talk opens the same
    // microphone, and the bar outside the surface has to say so too. So this
    // publishes wake mode's truth into the shared MIC state and lets `paint()`
    // draw BOTH places from it. One writer per pixel, one state to reason about.
    MIC.wakeOn = wakeOn;
    const wasUp = MIC.wakeEngineUp;
    MIC.wakeEngineUp = wakeOn && engineUp;
    MIC.wakeStarting = wakeOn && starting;
    if (wasUp && !MIC.wakeEngineUp) MIC.engineDownAt = Date.now();
    if (MIC.wakeEngineUp) MIC.engineDownAt = 0;
    MIC.wakeState = wakeOn ? listener.state : 'off';
    MIC.windowLeftMs = listener.remainingMs(Date.now());
    paint();

    ui.wakeToggle.setAttribute('aria-pressed', wakeOn ? 'true' : 'false');
    setNodeText(ui.wakeToggle, wakeOn ? 'Stop listening for “Zeno”' : 'Listen for “Zeno”');
    ui.wakeToggle.style.color = wakeOn ? 'var(--ink,#ECEBE6)' : 'var(--ink-2,#9AA1AC)';
    ui.wakeToggle.style.borderColor = wakeOn ? 'var(--cyan-dim,#1E6B76)' : 'var(--rule-2,#2C353B)';

    ui.retention.hidden = !wakeOn;
    // The machine already dropped the buffer on disarm; blank the rendered copy
    // too, so a hidden node can never still be holding the words on screen.
    const held = wakeOn ? listener.retained(Date.now()) : '';
    setNodeText(ui.retentionText, held ? `Holding now: “${held}”` : 'Holding now: nothing.');

    // One microphone at a time. While wake mode is on, the hold button would be
    // a second recogniser fighting the first, so it is disabled and says why.
    ui.button.disabled = wakeOn;
    ui.button.style.opacity = wakeOn ? '0.5' : '1';
    ui.button.style.cursor = wakeOn ? 'not-allowed' : 'pointer';
    ui.button.title = wakeOn ? 'Wake mode is on — just say “Zeno”. Switch it off to hold-to-talk again.' : '';
  }

  // -- the engine -------------------------------------------------------------

  function startEngine() {
    if (!wakeOn || engineUp) return;
    starting = true;
    // Claim the microphone BEFORE asking for it, and keep the claim if start()
    // throws. The only throw a browser raises here is "already started", which
    // means the engine is running and the room is going out — so treating the
    // throw as "not open" would be the one wrong direction to be wrong in.
    // `onend` is what takes the claim back.
    engineUp = true;
    try {
      recognition.start();
    } catch {
      // Already starting: the onstart/onend handlers will settle it.
    }
    render();
  }

  function scheduleRestart(delay) {
    if (restartTimer !== null) return;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      startEngine();
    }, delay);
  }

  recognition.onstart = () => {
    starting = false;
    if (!wakeOn) {
      // THE RACE THAT LISTENS SILENTLY. `start()` is asynchronous: the engine is
      // "starting" for as long as it takes to reach the recognition service, and
      // a `stop()` that lands inside that gap is not reliably honoured — Chrome
      // drops it and the session starts anyway. The owner has already switched
      // off, so nothing will ever restart or stop this session again: a
      // continuous recogniser runs on with the panel and the bar both saying the
      // microphone is closed. Toggling off and on again quickly is enough to
      // reach it. End it here, where we know for certain the engine came up.
      try {
        recognition.abort();
      } catch {
        /* no-op */
      }
      engineUp = false;
      render();
      return;
    }
    engineUp = true;
    consecutiveFailures = 0;
    render();
  };

  recognition.onend = () => {
    starting = false;
    engineUp = false;
    render();
    // Browsers end a continuous session periodically (silence timeouts, tab
    // housekeeping). Wake mode is only honest if "on" means on, so restart —
    // but back off if the engine is failing, rather than spinning on the mic.
    if (!wakeOn) return;
    consecutiveFailures += 1;
    if (consecutiveFailures > 8) {
      turnOff('The browser’s recogniser kept stopping, so wake mode switched itself off.');
      return;
    }
    scheduleRestart(consecutiveFailures > 3 ? 1500 : 250);
  };

  recognition.onerror = (event) => {
    const err = event && event.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      // No permission means no listening. Switching off is the honest response;
      // leaving the toggle "on" over a dead microphone is a lie in the UI.
      turnOff('Microphone permission was refused, so wake mode is off. Grant it in the browser and try again.');
      return;
    }
    if (err === 'no-speech' || err === 'aborted') return; // ordinary in a continuous session
    // A successful onstart is not a successful transcription. Electron can
    // emit start -> network error -> end forever; resetting its restart count
    // on start hid that failure and made the whole voice UI flicker. Stop on a
    // service failure and require an intentional retry.
    turnOff(err === 'network'
      ? 'The browser speech service is unavailable. Wake mode is off and the microphone is closed. Use typed Ask Zeno or retry when the speech service is reachable.'
      : `Recognition error: ${err}. Wake mode is off and the microphone is closed.`);
  };

  recognition.onresult = (event) => {
    // A result that arrives after the owner switched off is speech from a
    // microphone they believe is closed. The pure machine already refuses to
    // act on it (`hear` returns `none` when disarmed), but nothing should even
    // reach it: dropping it here means no post-disarm transcript can touch the
    // retention buffer or the panel, whatever the machine is later changed to do.
    if (!wakeOn) return;
    const now = Date.now();
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const text = res[0] ? res[0].transcript : '';
      apply(listener.hear(text, Boolean(res.isFinal), now));
    }
    // WakeListener owns the disclosed short retention window. The native
    // Web-Speech-shaped adapter must not keep a second cumulative room transcript.
    if (localSpeech) recognition.clearResults?.();
    render();
  };

  /** Render one machine event. The machine decides; this only shows. */
  function apply(ev) {
    switch (ev.kind) {
      case 'retained':
        // Untriggered speech. Deliberately NOT shown as "Heard:" — Zeno was not
        // addressed, and echoing the room back would suggest it was.
        break;
      case 'woke':
        setHeard('');
        setOutcome('');
        setStatus(`Heard “Zeno”. Listening for a command for the next ${Math.round(WAKE_WINDOW_MS / 1000)} seconds.`);
        break;
      case 'capturing':
        if (ev.partial) setHeard(ev.partial);
        break;
      case 'command':
        setStatus('Idle.');
        handleOutcome(ev.outcome, ev.command);
        break;
      case 'expired':
        setHeard('');
        setStatus('Idle.');
        setOutcome('No command followed “Zeno”. Back to listening for the wake word.', 'warn');
        break;
      default:
        // 'none' — off, or a blank transcript. Nothing happened, so say nothing.
        break;
    }
  }

  // -- the switch, and the gate in front of it --------------------------------

  async function turnOn() {
    const owner = externalCaptureOwner();
    if (owner) {
      setOutcome(`${captureOwnerLabel(owner)} is using the microphone. Stop it before enabling Listen for Zeno.`, 'warn');
      return;
    }
    wakeOn = true;
    starting = true;
    consecutiveFailures = 0;
    listener.arm();
    writeWakePref(true);
    setStatus(
      localSpeech ? 'Wake mode on. The microphone stays open and Whisper recognizes speech locally until you switch it off.' :
      'Wake mode on. The microphone stays open — and your browser keeps sending the room to its ' +
        'maker to be transcribed — until you switch it off.',
    );
    setOutcome('');
    // One microphone at a time, enforced rather than merely discouraged. The
    // hold button is disabled while wake mode is on, but it is not disabled at
    // the instant wake mode is being turned on — a held button, or a second
    // pointer, leaves a push-to-talk session open underneath the wake session,
    // and the indicator would then describe only one of the two.
    render();
    try { await abortPtt(); await waitForSpeechIdle(); } catch {
      turnOff('The previous microphone session did not close. Retry after stopping other capture.');
      return;
    }
    if (!wakeOn) return;
    if (uiTimer === null) uiTimer = window.setInterval(pulse, 200);
    startEngine();
    render();
  }

  function turnOff(reason) {
    wakeOn = false;
    starting = false;
    listener.disarm(); // drops the retained transcript
    writeWakePref(false);
    if (restartTimer !== null) {
      window.clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (uiTimer !== null) {
      window.clearInterval(uiTimer);
      uiTimer = null;
    }
    // `abort()`, not `stop()`. `stop()` means "finish what you are hearing and
    // hand me a final result": the engine keeps the microphone for a moment
    // longer and the audio already buffered still goes out to be transcribed.
    // When the owner says off, off is immediate and the tail is discarded —
    // there is no half-sentence worth keeping from a microphone someone just
    // closed. It also settles the start/stop race: `abort()` ends a session that
    // is still coming up, which `stop()` does not reliably do.
    const closing = closeRecognizer(recognition, engineUp);
    engineUp = false;
    setHeard('');
    setStatus('Idle.');
    if (reason) setOutcome(reason, 'warn');
    render();
    return closing;
  }

  // The bar outside the surface, and a page teardown, need to reach this mode's
  // switch. Published here rather than exported so there is still exactly one
  // implementation of "off".
  turnWakeOff = (reason) => {
    return wakeOn ? turnOff(reason) : waitForSpeechIdle();
  };
  abortWake = () => {
    try {
      recognition.abort();
    } catch {
      /* no-op */
    }
    engineUp = false;
  };

  /** The clock. Closes an expired window and keeps the countdown and the
   * "holding now" line honest between transcripts. */
  function pulse() {
    apply(listener.tick(Date.now()));
    render();
  }

  /**
   * Handle the wake CTA through one named boundary. Counsel or Ask voice can own
   * the microphone, so reach turnOn's ownership guard before drawing the wake
   * disclosure over the active surface.
   */
  function toggleWake() {
    if (wakeOn) {
      // Turning OFF is one click, always. Only turning ON is gated.
      turnOff(
        localSpeech
          ? 'Wake mode off. The microphone is closed and the retained transcript was dropped. No microphone audio was uploaded.'
          : 'Wake mode off. The microphone is closed and the transcript Zeno held was dropped. Audio ' +
            'your browser already sent to be transcribed is not Zeno’s to take back.',
      );
      return;
    }
    if (externalCaptureOwner()) {
      void turnOn();
      return;
    }
    if (ui.disclosure.hidden) openDisclosure();
    else closeDisclosure();
  }

  function openDisclosure() {
    ui.ack.checked = false;
    ui.confirm.disabled = true;
    ui.confirm.style.opacity = '0.5';
    ui.disclosure.hidden = false;
    ui.wakeToggle.setAttribute('aria-expanded', 'true');
    // Focus the disclosure ITSELF, from the top. This used to focus the confirm
    // button, which is disabled until the box is ticked — and a disabled button
    // cannot take focus, so the call silently did nothing and the disclosure was
    // never announced or reached. Focusing the group puts the owner at the first
    // word of what the microphone is about to do, which is the only order that
    // makes this a gate rather than a decoration.
    //
    // `preventScroll` because the panel is overlaid and already centred in the
    // viewport: there is nothing to scroll to, and letting focus() scroll
    // anyway would move the page underneath the gate for no reason. That
    // movement is the flip — 694px in one frame, measured — and it is gone.
    ui.backdrop.hidden = false;
    ui.disclosure.focus({ preventScroll: true });
  }

  function closeDisclosure() {
    ui.disclosure.hidden = true;
    ui.backdrop.hidden = true;
    ui.ack.checked = false;
    ui.confirm.disabled = true;
    ui.confirm.style.opacity = '0.5';
    ui.wakeToggle.setAttribute('aria-expanded', 'false');
    // Put the owner back on the control they opened this from, rather than
    // dropping focus onto <body> where the next Tab starts from the top.
    if (typeof ui.wakeToggle.focus === 'function') ui.wakeToggle.focus({ preventScroll: true });
  }

  // Escape closes the gate without turning anything on. An overlay that traps
  // the owner with no way out but a mouse is worse than the panel it replaced.
  ui.disclosure.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDisclosure(); }
  });
  // Clicking the dimmed page means "not now" — the same as Cancel. It never
  // means yes; nothing here can turn the microphone on except the confirm
  // button, and that stays disabled until the box is ticked.
  ui.backdrop.addEventListener('click', () => closeDisclosure());

  ui.wakeToggle.addEventListener('click', toggleWake);

  ui.ack.addEventListener('change', () => {
    ui.confirm.disabled = !ui.ack.checked;
    ui.confirm.style.opacity = ui.ack.checked ? '1' : '0.5';
  });

  ui.confirm.addEventListener('click', () => {
    if (!ui.ack.checked) return; // belt and braces: no stray click can enable it
    closeDisclosure();
    turnOn();
  });

  ui.cancel.addEventListener('click', closeDisclosure);

  ui.confirm.style.opacity = '0.5';
  render();

  // A device where the owner already accepted THIS disclosure and left the
  // switch on comes back on. The indicator renders before anything starts, so
  // the mic is never open ahead of the words that say it is.
  if (readWakePref()) turnOn();
}

// ---- transcript -> outcome --------------------------------------------------

function handleTranscript(text) {
  // The SAME pure pipeline the package tests exercise.
  handleOutcome(interpret(text), text);
}

/** Add the spoken item to the backlog, then prove the daemon stored this item. */
async function addTask(intent) {
  const title = String(intent?.title || '').trim();
  if (!title) {
    setOutcome('The task had no title, so nothing was added.', 'warn');
    return;
  }
  if (!OWNER_TOKEN) {
    setOutcome('This browser cannot add work (no token was injected). Open the window the daemon serves.', 'warn');
    return;
  }

  setOutcome(`Adding task: “${title}”…`);
  try {
    const res = await fetch('/work', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify({ title }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      const reason = String(err.message || res.status).trim();
      const resolution = String(err.resolve || '').trim();
      const separator = resolution && /[.!?]$/.test(reason) ? ' ' : '. ';
      setOutcome(`Could not add the task: ${reason}${resolution ? `${separator}${resolution}` : ''}`, 'warn');
      return;
    }

    const item = data && data.item;
    const itemId = String(item?.id || '').trim();
    if (!itemId || String(item?.title || '') !== title) {
      setOutcome('The daemon answered without proving it stored this exact task. Refresh Work before retrying.', 'warn');
      return;
    }

    window.dispatchEvent(new CustomEvent('zeno:state', { detail: { source: 'voice-add-task', itemId } }));
    setOutcome(`Added “${title}” to Work (${itemId}).`, 'ok');
  } catch (error) {
    setOutcome(`Network error while adding the task: ${error?.message || error}`, 'warn');
  }
}

/* A greeting or a bare wake ("Zeno", "Zeno, are you there?") is the owner asking
 * for Zeno with no command yet. Bring the one composer forward — switch to
 * Command and focus its input — instead of reporting a non-command as a failure.
 * Wake mode is already listening; push-to-talk leaves the composer ready. */
function summonCommand(note) {
  const nav = document.querySelector('[data-nav="command"]');
  if (nav && nav.tagName === 'BUTTON' && typeof nav.click === 'function') nav.click();
  const composer = document.querySelector('[data-surface="command"] .za-input');
  if (composer && typeof composer.focus === 'function') {
    try { composer.focus({ preventScroll: true }); } catch { composer.focus(); }
  }
  setOutcome(note, 'ok');
}

/**
 * Act on one Outcome. Both modes land here, so a command means the same thing
 * whether it was pushed-to-talk or woken — including the refusal that says
 * approval is by hand.
 */
function handleOutcome(result, spoken) {
  if (spoken) setHeard(spoken);
  // Muted: both modes land here, so this one gate holds push-to-talk and wake
  // alike. Show what was heard (already done above — honesty), then stop before
  // anything acts. Unmute is the bar's own button; a spoken command cannot lift
  // the mute, by design, because a muted microphone is one the owner has told
  // Zeno to ignore.
  if (MIC.muted) {
    setOutcome('Muted — Zeno heard you but will not act until you unmute.', 'warn');
    return;
  }
  if (result.kind === 'idle') {
    setOutcome(result.reason, 'warn');
    return;
  }
  const intent = result.intent;
  switch (intent.kind) {
    case 'propose_write':
      proposeWrite(intent);
      break;
    case 'add_task':
      void addTask(intent);
      break;
    case 'navigate': {
      const destination = document.querySelector(`[data-nav="${intent.target}"]`);
      if (!destination || destination.tagName !== 'BUTTON' || typeof destination.click !== 'function') {
        setOutcome(`Could not open ${intent.target}; its navigation control is unavailable.`, 'warn');
        break;
      }
      destination.click();
      setOutcome(`Opened ${intent.target[0].toUpperCase()}${intent.target.slice(1)}.`, 'ok');
      break;
    }
    case 'delegate':
      delegateTask(intent);
      break;
    case 'read':
      setOutcome(`You asked to read: ${intent.what}. It is shown in this window.`, 'ok');
      break;
    case 'cancel':
      setOutcome('Cancelled.', 'ok');
      break;
    case 'acknowledge':
      // The owner addressed Zeno by name with no command (a greeting, "are you
      // there?"). Summon Command and keep listening rather than answering with an
      // error — the microphone stays open for the sentence that follows.
      summonCommand('Listening — Command is ready. Say what you need, or type it here.');
      break;
    case 'unrecognized':
      // A bare wake with nothing after it is a summons too, not a mistake, so it
      // also brings Command forward. Every OTHER unrecognized outcome — the spoken
      // "approve it" among them — states its reason and does nothing, because voice
      // cannot approve, in either mode, and this is where it says so.
      if (intent.reason === EMPTY_COMMAND) {
        summonCommand('Listening — Command is ready. Say what you need, or type it here.');
        break;
      }
      setOutcome(intent.reason, 'warn');
      break;
    default:
      setOutcome('Unhandled outcome.', 'warn');
  }
}

// ---- the one network call: propose, never approve ---------------------------

/**
 * A scaffold body for the proposed file. It is deliberately a STUB that records
 * what was asked for — the point of the voice path is to open a proposal the
 * owner can see and approve by hand, not to write finished code by dictation.
 */
function scaffoldContents(intent) {
  const isTsx = intent.relPath.endsWith('.tsx');
  const name = intent.relPath.split('/').pop().replace(/\.(tsx|ts)$/, '');
  const lines = [
    `// Proposed by voice: ${intent.summary}`,
    intent.hint ? `// Intent: ${intent.hint}` : '// Intent: (none spoken)',
    '// This is a scaffold. Review and complete it before it does real work.',
    '',
  ];
  if (isTsx) {
    lines.push(
      `export function ${name}(): JSX.Element {`,
      `  return <div>TODO: ${name}</div>;`,
      '}',
      '',
    );
  } else {
    lines.push(`export const TODO_${name.replace(/[^A-Za-z0-9_]/g, '_')} = true;`, '');
  }
  return lines.join('\n');
}

async function proposeWrite(intent) {
  if (!OWNER_TOKEN) {
    setOutcome('This browser cannot propose (no token was injected). Open the window the daemon serves.', 'warn');
    return;
  }
  setOutcome(`Proposing ${intent.relPath}…`);
  try {
    const res = await fetch('/previews', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify({
        relPath: intent.relPath,
        contents: scaffoldContents(intent),
        summary: intent.summary,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      setOutcome(`Could not propose: ${err.message || res.status}. ${err.resolve || ''}`.trim(), 'warn');
      return;
    }
    // The daemon returns the preview (and, for a routine action it auto-commits
    // by policy, a receipt). Either way voice did not approve anything — a
    // proposal that needs your decision is now waiting for your click above.
    if (data.receipt) {
      setOutcome(`Proposed ${intent.relPath}. Policy classified it routine and recorded it — see the timeline.`, 'ok');
    } else {
      setOutcome(`Proposed ${intent.relPath}. It is waiting for your approval in this window.`, 'ok');
    }
  } catch (e) {
    setOutcome(`Network error while proposing: ${e && e.message ? e.message : e}`, 'warn');
  }
}

// ---- the second network call: delegate, and still never approve -------------
//
// WHAT SPEAKING A JOB DOES, AND WHAT IT STILL CANNOT DO.
//
// "Build me a slugify utility" is the one spoken sentence that starts a PROCESS
// rather than proposing a single file. A coding agent runs headless in a
// throwaway copy of the repo, and every file it touches comes back as an
// ordinary approval capsule — so speaking still buys the owner a queue of things
// to look at, never an effect. There is no path from this file to /approvals,
// exactly as before.
//
// WHY IT ASKS THE DAEMON TWICE. The first call is `plan: true` and starts
// nothing: it answers "which agent would run this, and what would that cost".
// The panel says that out loud, and only then does anything begin. A local model
// runs on this machine and spends the owner's own GPU, so it starts immediately.
// A hosted agent spends their money and sends their code to somebody else's
// computer — so it waits behind a button, with both of those facts on screen.
// Never from a spoken sentence alone.
//
// The decision itself lives in the daemon, not here. If this file worked it out
// from a model list, a spoken delegation and a typed one could drift into
// disagreeing about which agent runs — and the way that drift ends is a hosted
// agent starting because a browser thought it was the local one.

/** The label a rung is shown under. Falls back to the id rather than inventing one. */
function agentLabel(agentId) {
  if (agentId === 'local') return 'a local model on this machine';
  if (agentId === 'claude-code') return 'Claude Code (Anthropic, over the network)';
  return agentId || 'an unnamed agent';
}

function hideDelegate() {
  ui.delegate.hidden = true;
  ui.delegateButtons.hidden = true;
  ui.delegateLink.hidden = true;
  ui.delegateWhy.textContent = '';
  ui.delegateState.textContent = '';
}

/** Show the task and the agent. Called BEFORE anything runs, in every branch. */
function showDelegate(task, agentId, model) {
  ui.delegate.hidden = false;
  ui.delegateButtons.hidden = true;
  ui.delegateLink.hidden = true;
  ui.delegateTask.textContent = `Work heard: “${task}”`;
  ui.delegateAgent.textContent = agentId
    ? `WOULD RUN ON: ${agentLabel(agentId)}${model ? ` · ${model}` : ''}`
    : 'NO AGENT CHOSEN';
  ui.delegateWhy.textContent = '';
  ui.delegateState.textContent = '';
}

/**
 * The one sentence said after any run, in the only terms that are true.
 *
 * `d.ok` matters as much as the count. The daemon no longer throws away what a
 * failed agent wrote — an agent that edits files and then exits non-zero used to
 * have its work deleted and be reported as "no changes" — so a run can now
 * arrive here with files AND a failure. Spoken work is the surface where that
 * matters most: the owner is not looking at the screen, so "3 changes proposed"
 * said in a satisfied green about a run that crashed halfway would be the last
 * thing they hear about it.
 */
function renderRunResult(d) {
  const proposed = Array.isArray(d.proposed) ? d.proposed.length : 0;
  if (proposed > 0) {
    const many = proposed === 1 ? '' : 's';
    const failed = d.ok === false;
    ui.delegateState.textContent = failed
      ? `The run did NOT finish — ${d.note ? String(d.note) : 'the agent stopped early'}. ` +
        `It had already written ${proposed} file${many}; ${proposed === 1 ? 'it is' : 'they are'} ` +
        'kept and waiting for your approval rather than thrown away, and may be half-finished.'
      : `${proposed} change${many} proposed. ` +
        'None of them has been applied — each is waiting for your approval in this window.';
    ui.delegateState.style.color = failed ? 'var(--amber,#E0A128)' : 'var(--green,#5BB98C)';
    ui.delegateLink.hidden = false;
    setOutcome(
      failed
        ? `The run failed after writing ${proposed} file${many} — read them in Command before approving.`
        : `${proposed} change${many} proposed — review them in Command.`,
      failed ? 'warn' : 'ok',
    );
    return;
  }
  // A run that changed nothing is a real outcome and is said as one, with the
  // agent's own reason when it gave one. It is never dressed up as success.
  const why = d.note ? String(d.note) : 'The agent finished without changing any file.';
  ui.delegateState.textContent = `No changes were proposed. ${why}`;
  ui.delegateState.style.color = 'var(--amber,#E0A128)';
  setOutcome('The agent ran and proposed no changes.', 'warn');
}

/** POST a delegation to the daemon. `plan` decides whether anything may start. */
async function askDelegate(body) {
  const res = await fetch('/delegate', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new Error(`${err.message || res.status}${err.resolve ? ` ${err.resolve}` : ''}`.trim());
  }
  return (data && data.delegated) || null;
}

async function delegateTask(intent) {
  if (!OWNER_TOKEN) {
    setOutcome('This browser cannot delegate (no token was injected). Open the window the daemon serves.', 'warn');
    return;
  }
  hideDelegate();
  setOutcome('Asking Zeno which agent can do this…');

  let plan;
  try {
    // PLAN FIRST — this starts nothing. Its whole job is to let the panel name
    // the agent before that agent works.
    plan = await askDelegate({ task: intent.task, plan: true });
  } catch (e) {
    setOutcome(`Could not delegate: ${e && e.message ? e.message : e}. Nothing was started.`, 'warn');
    return;
  }
  if (!plan) {
    setOutcome('Zeno did not say which agent would run this, so nothing was started.', 'warn');
    return;
  }

  showDelegate(plan.task || intent.task, plan.agentId, plan.model);

  // HOSTED — never from a spoken sentence. The cost and the egress are on screen
  // and the run waits for a click on a button the owner can also decline.
  if (plan.needsConfirm) {
    ui.delegateWhy.textContent =
      `This will not run until you say so, because ${plan.because || 'it spends money and sends your code off this machine'}. ` +
      'Speaking cannot start it, and nothing it writes will be applied without your approval either.';
    ui.delegateWhy.style.color = 'var(--amber,#E0A128)';
    ui.delegateButtons.hidden = false;
    ui.delegateRun.textContent = `Run it on ${agentLabel(plan.agentId)}`;
    ui.delegateRun.onclick = () => confirmHosted(plan);
    ui.delegateSkip.onclick = () => {
      hideDelegate();
      setOutcome('Not run. Nothing was sent anywhere.', 'ok');
    };
    setOutcome('Waiting for your click — a hosted agent is never started by voice.', 'warn');
    ui.delegateRun.focus();
    return;
  }

  // NEITHER RUNG, or a token that cannot start one. Say it, do not fake it.
  if (!plan.ready) {
    ui.delegateState.textContent = plan.note || 'There is no agent available to run this. Nothing was started.';
    ui.delegateState.style.color = 'var(--amber,#E0A128)';
    setOutcome('Nothing was started.', 'warn');
    return;
  }

  // LOCAL — the code stays on this machine and the spend is the owner's own GPU,
  // so it begins now. The panel has already named it, above.
  ui.delegateWhy.textContent =
    'This runs on your machine. Your code does not leave it, and every file the agent writes will ' +
    'arrive here as a change waiting for your approval.';
  ui.delegateWhy.style.color = 'var(--ink-2,#9AA1AC)';
  ui.delegateState.textContent = 'Running… this can take a while on a local model.';
  ui.delegateState.style.color = 'var(--cyan,#2AA5B8)';
  setOutcome('Running on the local model…');
  try {
    const done = await askDelegate({ task: intent.task, agentId: 'local' });
    if (!done || !done.started) {
      ui.delegateState.textContent = (done && done.note) || 'The run did not start, and nothing happened.';
      ui.delegateState.style.color = 'var(--amber,#E0A128)';
      setOutcome('Nothing was started.', 'warn');
      return;
    }
    renderRunResult(done);
  } catch (e) {
    ui.delegateState.textContent = `The run failed: ${e && e.message ? e.message : e}. Nothing was applied.`;
    ui.delegateState.style.color = 'var(--amber,#E0A128)';
    setOutcome('The run failed.', 'warn');
  }
}

/** The owner clicked "run it" on a hosted agent. This is the ONLY way one starts. */
async function confirmHosted(plan) {
  const confirm = plan.confirm || { method: 'POST', path: '/forge/run', body: { task: plan.task, agentId: plan.agentId } };
  ui.delegateButtons.hidden = true;
  ui.delegateState.textContent = `Running on ${agentLabel(plan.agentId)}… your code has been sent to run this.`;
  ui.delegateState.style.color = 'var(--cyan,#2AA5B8)';
  setOutcome('Running…');
  try {
    const res = await fetch(confirm.path, {
      method: confirm.method,
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify(confirm.body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      ui.delegateState.textContent = `The run was refused: ${err.message || res.status}. ${err.resolve || ''}`.trim();
      ui.delegateState.style.color = 'var(--amber,#E0A128)';
      setOutcome('The run was refused.', 'warn');
      return;
    }
    // /forge/run answers in the same terms: what it changed, and what is now
    // waiting. Rendered through the same function, so a hosted run and a local
    // one cannot end up described differently.
    renderRunResult({ proposed: data.proposed, note: data.run && data.run.note, ok: data.run ? data.run.ok : undefined });
  } catch (e) {
    ui.delegateState.textContent = `Network error during the run: ${e && e.message ? e.message : e}.`;
    ui.delegateState.style.color = 'var(--amber,#E0A128)';
    setOutcome('The run failed.', 'warn');
  }
}

// The link under a finished run. It only ever MOVES the owner to the approvals
// section — it approves nothing, which is the same rule the rest of this file
// keeps: this browser module has no call to /approvals anywhere in it.
ui.delegateLink.addEventListener('click', () => {
  const pending = document.getElementById('pending') || document.querySelector('[data-mount="pending"]');
  if (pending && typeof pending.scrollIntoView === 'function') pending.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
