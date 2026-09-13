/**
 * bind/counsel/live-view.js — rendering the live-call bar/transcript
 * (`renderLive`), Pause/Resume (`togglePause`), and the handful of static
 * copy corrections the artifact's live view otherwise overclaims. The engine
 * itself (`armEngine`/`startEngine`/`stopEngine`/`commit`/`teardownCall`/
 * `discardCall`/`beginCall`/`endCall`) stays in bind/counsel.js — extracted
 * by name by the desktop test, see that file's header — and calls back into
 * `renderLive`/`togglePause`'s `stopEngine`/`startEngine` deps, which are
 * those very functions.
 */
import { $, el, fill } from '../../bind.js';
import { setPillText, fmtElapsed, elapsedLabel } from './format.js';

/**
 * @param {object} deps
 * @param {Element} deps.root
 * @param {Element|null} deps.timerEl
 * @param {Element|null} deps.micStatePill
 * @param {Element|null} deps.linesBox
 * @param {Element|null} deps.pauseBtn
 * @param {Element|null} deps.discardBtn
 * @param {Element|null} deps.endBtn
 * @param {() => object|null} deps.getCall
 */
export function makeRenderLive({ root, timerEl, micStatePill, linesBox, pauseBtn, discardBtn, endBtn, getCall }) {
  return function renderLive() {
    const CALL = getCall();
    if (!CALL) return;
    const bar = $('.cnlivebar', root);
    const big = bar ? bar.querySelector('.recdot.big') : null;
    const label = bar ? bar.querySelector('b') : null;
    if (label) label.textContent = CALL.paused ? 'PAUSED' : CALL.running ? 'RECORDING' : CALL.want ? 'RECONNECTING…' : 'STOPPED · not recording';
    if (big) { big.style.animationPlayState = CALL.paused ? 'paused' : 'running'; big.style.opacity = CALL.paused ? '.4' : '1'; }
    if (timerEl) timerEl.textContent = fmtElapsed(Date.now() - CALL.startedAt);
    if (micStatePill) {
      const info = CALL.paused ? ['wt', 'mic: paused'] : CALL.running ? ['cy', 'mic: live'] : CALL.want ? ['am', 'mic: reconnecting…'] : ['rd', 'mic: stopped'];
      setPillText(micStatePill, info[0], info[1], info[0] === 'cy' || info[0] === 'am');
    }
    if (pauseBtn) { pauseBtn.textContent = CALL.paused ? 'Resume' : 'Pause'; pauseBtn.disabled = CALL.saving; }
    if (discardBtn) discardBtn.disabled = CALL.saving;
    if (endBtn) { endBtn.disabled = CALL.saving; endBtn.textContent = CALL.saving ? 'Saving…' : 'End meeting'; }
    if (linesBox) {
      const nodes = [];
      const last = CALL.utterances.slice(-8);
      if (last.length === 0) {
        nodes.push(el('div', null, 'Nothing transcribed yet. Lines appear here as the engine finalises them.'));
      } else {
        last.forEach((u, i) => {
          const row = el('div', `cnl${i === last.length - 1 ? ' now' : ''}`);
          row.append(el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel({ startedAt: new Date(CALL.startedAt).toISOString() }, u.at) || ''), el('span', null, u.text));
          nodes.push(row);
        });
      }
      if (CALL.interim) {
        const row = el('div', 'cnl');
        row.style.opacity = '.6';
        row.append(el('span', 'cnw', 'hearing'), el('span', 'cnt2', ''), el('span', null, CALL.interim));
        nodes.push(row);
      }
      if (CALL.note) {
        const n = el('div', null, CALL.note);
        n.style.cssText = `margin-top:8px;padding:8px 10px;border-radius:8px;font-size:12px;color:${CALL.noteTone === 'error' ? 'var(--red)' : 'var(--amber)'};background:var(--g3)`;
        nodes.push(n);
      }
      fill(linesBox, ...nodes);
      linesBox.scrollTop = linesBox.scrollHeight;
    }
  };
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.getCall
 * @param {() => void} deps.renderLive
 * @param {(discard: boolean, session: object) => Promise<boolean>} deps.stopEngine
 * @param {() => void} deps.startEngine
 */
export function makeTogglePause({ getCall, renderLive, stopEngine, startEngine }) {
  async function pauseLive() {
    const CALL = getCall();
    if (!CALL || CALL.paused) return;
    const session = CALL;
    session.paused = true;
    renderLive();
    await stopEngine(false, session);
    if (getCall() === session) renderLive();
  }
  async function resumeLive() {
    const CALL = getCall();
    if (!CALL || !CALL.paused) return;
    CALL.paused = false;
    renderLive();
    startEngine();
  }
  function togglePause() {
    const CALL = getCall();
    if (!CALL) return;
    if (CALL.paused) void resumeLive(); else void pauseLive();
  }
  return { togglePause };
}

/** Honesty corrections to static copy the live view's markup carries — root
 *  counsel.js's boundary statement (Counsel is a recorder, never an in-call
 *  answer feed) restored verbatim, plus the two fields whose static text
 *  overclaims what this build actually does. */
export function applyStaticCopyFixups(root) {
  const transHint = $('.cnview[data-cnview="live"] .cntrans .cnth span', root);
  if (transHint) transHint.textContent = 'nobody is detected; every line is "unknown" here';
  const notesHint = $('.cnview[data-cnview="live"] .cnnotes .cnth span', root);
  if (notesHint) notesHint.textContent = 'this browser tab only — not sent anywhere';
  const liveNotesTA = $('.cnview[data-cnview="live"] .cnta', root);
  if (liveNotesTA) liveNotesTA.placeholder = 'Type what matters. Nothing here is saved when the call ends — copy anything you want to keep first.';
  const qaOffP = $('.cnview[data-cnview="live"] .cnqa-off p', root);
  if (qaOffP) {
    const guard = document.createElement('p');
    guard.className = 'hint';
    guard.textContent = 'Live Q&A is off while this meeting is active. End and save the transcript first; then ask from the cited notes in Counsel chat.';
    qaOffP.insertAdjacentElement('afterend', guard);
  }
}
