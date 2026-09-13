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
import { $, setText } from '../../bind.js';
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

export function bindVoice(modal) {
  const pane = $('.set-pane[data-setpane="voice"]', modal);
  if (!pane) return;

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
