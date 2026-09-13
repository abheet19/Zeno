/*
 * bind/settings/voice.js — the Voice pane: Spoken replies (not real), Wake
 * word (real).
 *
 * Real state this file is grounded in:
 *   - Spoken replies: no persisted, app-wide setting exists — ask.js's
 *     `voiceModeOn` is a plain in-memory flag on the Ask screen only, never
 *     saved. Disabled, not wired.
 *   - Wake word: real and persisted (voice.js's own `zeno.voice.wake` key).
 *     Turning it OFF needs no consent and is honoured here. Turning it ON
 *     needs the microphone disclosure voice.js shows before opening the mic
 *     — this build has no disclosure surface in Settings, so Settings can
 *     only ever turn it off.
 */
import {
  $, el, fill, setText,
} from '../../bind.js';
import {
  rowByLabel, detach, markDisabled, toast,
} from './shared.js';

/* Must stay in step with bind/voice.js's DISCLOSURE_VERSION. Bumping it there
   is how voice.js re-asks consent from anyone who accepted an older, weaker
   description of what the microphone does — so a pref carrying an older version
   is NOT an accepted consent, and voice.js boots with the wake word off. */
const WAKE_DISCLOSURE_VERSION = 4;

/* Read it the way bind/voice.js reads it. This used to accept any `{on:true}`,
   which is a strictly weaker test than voice.js's: the moment the disclosure
   version was bumped, voice.js correctly treated the stored consent as expired
   and stayed OFF while this row painted the switch ON. The owner would have
   been told the machine was listening for "Zeno" when it was not. */
function readWakeWordPref() {
  try {
    const raw = localStorage.getItem('zeno.voice.wake');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!(parsed && parsed.on === true && parsed.disclosure === WAKE_DISCLOSURE_VERSION);
  } catch { return false; }
}

const INSTALL_LABEL = 'Install local Whisper (~1.1 GB)';

function mb(bytes) {
  return Number.isFinite(bytes) ? Math.max(0, bytes / (1024 * 1024)).toFixed(0) : '?';
}

/**
 * "Local speech (Whisper)" — the one real control for the installer
 * speech-install.cjs implements. Real state this row is grounded in:
 * window.zenoLocalSpeech only exists in the desktop app, and even there its
 * installStatus() is a live disk check, not "the bridge exists so it must be
 * installed" — see bind/voice/pill.js's own comment on the same distinction.
 * A plain browser has no bridge at all, so it gets one honestly disabled
 * button and nothing else.
 */
function bindLocalWhisperRow(pane) {
  const row = rowByLabel(pane, 'Local speech (Whisper)');
  const ctl = row && $('[data-lw-ctl]', row);
  const sub = row && $('.sub', row);
  if (!row || !ctl) return;
  const bridge = window.zenoLocalSpeech;

  if (!bridge || typeof bridge.installStatus !== 'function') {
    const button = el('button', 'set-btn', INSTALL_LABEL);
    button.disabled = true;
    button.title = 'Available in the Zeno desktop app.';
    fill(ctl, button);
    setText(sub, 'Available in the Zeno desktop app — this browser has no local speech bridge.');
    return;
  }

  async function paintCurrentStatus() {
    let status = null;
    try { status = await bridge.installStatus(); } catch { /* shown as not-installed below */ }
    if (status && status.installed) {
      fill(ctl, el('span', 'pill gr', 'installed'));
      setText(sub, `whisper.cpp ${status.version || ''} — installed at ${status.executable}`.trim());
      return;
    }
    const button = el('button', 'set-btn p', INSTALL_LABEL);
    button.addEventListener('click', () => { void runInstall(button); });
    fill(ctl, button);
    setText(sub, 'Not installed yet — a one-time download of about 1.1 GB (less without a GPU), then speech runs entirely on this PC.');
  }

  async function runInstall(button) {
    button.disabled = true;
    const progressLine = el('div', 'sub', 'Starting…');
    const cancelBtn = el('button', 'set-btn', 'Cancel');
    fill(ctl, progressLine, cancelBtn);
    cancelBtn.addEventListener('click', () => { void bridge.cancelInstall(); });

    const unsubscribe = typeof bridge.onInstallProgress === 'function'
      ? bridge.onInstallProgress(progress => {
        const phase = progress && progress.phase === 'model' ? 'the speech model' : 'the whisper.cpp runtime';
        const received = progress && progress.received;
        const total = progress && progress.total;
        const pct = Number.isFinite(total) && total > 0 ? ` (${Math.round((received / total) * 100)}%)` : '';
        progressLine.textContent = `Downloading ${phase}… ${mb(received)} / ${mb(total)} MB${pct}`;
      })
      : null;

    let result;
    try { result = await bridge.install(); }
    catch (err) { result = { ok: false, message: String((err && err.message) || err) }; }
    if (typeof unsubscribe === 'function') unsubscribe();

    if (result && result.ok) toast('Local Whisper installed — the microphone is ready.');
    else if (result && result.error === 'aborted') toast('Install cancelled.');
    else toast(`Could not install local Whisper: ${(result && (result.message || result.error)) || 'unknown error'}`);
    await paintCurrentStatus();
  }

  void paintCurrentStatus();
}

export function bindVoice(modal) {
  const pane = $('.set-pane[data-setpane="voice"]', modal);
  if (!pane) return;

  try { bindLocalWhisperRow(pane); } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Spoken replies');
    if (row) {
      const original = $('.toggle', row);
      const clone = detach(original);
      if (clone) {
        clone.setAttribute('aria-checked', 'false');
        markDisabled(clone, 'No global switch exists yet — voice mode is turned on and off per conversation, on the Ask screen.');
      }
      setText($('.sub', row), 'There is no app-wide switch for this yet — voice mode is turned on and off per conversation, on the Ask screen itself.');
    }
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Wake word');
    if (row) {
      const original = $('.toggle', row);
      const clone = detach(original);
      if (clone) {
        const on = readWakeWordPref();
        clone.setAttribute('aria-checked', on ? 'true' : 'false');
        const flip = () => {
          const isOn = clone.getAttribute('aria-checked') === 'true';
          if (isOn) {
            // Turning OFF needs no consent and is always safe to honour here.
            try { localStorage.removeItem('zeno.voice.wake'); } catch { /* storage off */ }
            clone.setAttribute('aria-checked', 'false');
            toast('Wake word turned off.');
          } else {
            // Turning ON needs the microphone disclosure voice.js shows
            // before it opens the mic. That disclosure has no surface in
            // this Settings build, so this cannot honestly turn it on.
            toast('Turning wake word on needs the microphone disclosure — that lives with the mic control, not in Settings yet.');
          }
        };
        clone.addEventListener('click', flip);
        clone.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        });
      }
    }
  } catch { /* skip quietly */ }
}
