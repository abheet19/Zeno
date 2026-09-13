/**
 * bind/counsel/preflight-support.js — the parts of the preflight card that
 * don't need to touch the meeting-window attach/detect state (that lives in
 * bind/counsel.js's `ensureMeetingSourcesBox`/`renderMeetingSources`/
 * `refreshMeetingCandidates`/`readMeetingPresence` — extracted by name by the
 * desktop test, see that file's header, so it stays there): the three static
 * capability pills, the real mic check that gates Start, and disabling
 * Record entirely when this build has no speech engine at all.
 */
import { $, $$, getJSON } from '../../bind.js';
import { SpeechRecognition, localSpeech } from '../../whisper.js';
import { setPillText } from './format.js';

/** Draw the transcription/saved-data pills once (they never change after
 *  boot) and return `refreshModelInfo`, which does re-run (a retry button
 *  has no route here, but the daemon's local-model list can still change
 *  between page loads). */
export function initPreflightPills(preflightCard) {
  const rows = preflightCard ? $$('.cnrow2', preflightCard) : [];
  const transcriptionPill = rows[0] && rows[0].children[1] ? rows[0].children[1].querySelector('.pill') : null;
  const savedPill = rows[1] && rows[1].children[0] ? rows[1].children[0].querySelector('.pill') : null;
  const modelPill = rows[1] && rows[1].children[1] ? rows[1].children[1].querySelector('.pill') : null;

  if (transcriptionPill) {
    if (localSpeech) setPillText(transcriptionPill, 'gr', 'local · whisper · nothing leaves this machine', true);
    else if (SpeechRecognition) setPillText(transcriptionPill, 'am', 'browser speech · may leave this machine to transcribe', true);
    else setPillText(transcriptionPill, 'rd', 'no speech engine available in this app', false);
  }
  if (savedPill) setPillText(savedPill, 'wt', 'text only — the transcript. Notes are not sent anywhere.', false);

  async function refreshModelInfo() {
    if (!modelPill) return;
    const r = await getJSON('/forge/agents');
    if (!r.ok) { setPillText(modelPill, 'am', 'not verified — the daemon did not answer', true); return; }
    const models = (r.data && Array.isArray(r.data.localModels) ? r.data.localModels : []).filter(Boolean);
    if (models.length === 0) { setPillText(modelPill, 'am', 'no local model found — the summary cannot run', true); return; }
    const shown = models.slice(0, 2).join(', ') + (models.length > 2 ? ` +${models.length - 2}` : '');
    setPillText(modelPill, 'cy', `local ✓ · ${shown}`, true);
  }

  return { refreshModelInfo };
}

/**
 * @param {object} deps
 * @param {(state: 'checking'|'ok'|'no'|'unverified') => void} deps.setMicState
 * @param {() => void} deps.syncStartGate
 */
export function makeComputeAndSetMic({ setMicState, syncStartGate }) {
  return function computeAndSetMic() {
    if (!SpeechRecognition) { setMicState('no'); syncStartGate(); return; }
    if (localSpeech) { setMicState('unverified'); syncStartGate(); return; }
    (async () => {
      let hasInput = null;
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        hasInput = devs.some((d) => d.kind === 'audioinput');
      } catch { hasInput = null; }
      if (hasInput === false) { setMicState('no'); syncStartGate(); return; }
      let perm = null;
      try { perm = await navigator.permissions.query({ name: 'microphone' }); } catch { perm = null; }
      if (!perm) { setMicState('unverified'); syncStartGate(); return; }
      const apply = () => {
        if (perm.state === 'granted') setMicState('ok');
        else if (perm.state === 'denied') setMicState('no');
        else setMicState('unverified');
        syncStartGate();
      };
      apply();
      perm.onchange = apply;
    })();
  };
}

/** This app has no speech engine at all — disable Record instead of letting
 *  the owner discover that only after ticking both consent boxes. */
export function disableIfNoSpeechEngine({ root, recordBtn, heroRecordBtn }) {
  if (SpeechRecognition) return;
  const why = 'This app has no speech engine available, so Counsel cannot record here.';
  if (recordBtn) { recordBtn.disabled = true; recordBtn.title = why; }
  if (heroRecordBtn) { heroRecordBtn.disabled = true; heroRecordBtn.title = why; }
  const hero = $('.cnhero', root);
  const guardEl = $('.cnguard', root);
  if (hero) {
    const note = document.createElement('p');
    note.style.cssText = 'font-size:12.5px;color:var(--ink-3);margin:4px 0 0';
    note.textContent = 'This app has no speech engine available, so a call cannot be recorded here. Reading, summarising, and asking about saved calls still work.';
    if (guardEl) hero.insertBefore(note, guardEl); else hero.appendChild(note);
  }
}
