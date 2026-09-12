/*
 * Ask Zeno conversation surface.
 *
 * The composer keeps an in-memory thread for this renderer session. It does not
 * silently persist raw chat to Vault or disk. Typed and voice turns share the
 * same POST /assistant/ask path, grounding result, delegation path, hosted
 * confirmation, and held approval capsules.
 *
 * Voice conversation uses the existing local Whisper adapter when Electron
 * provides it. It never calls /approvals, never clicks a confirmation, and never
 * starts hosted work from speech. System speech synthesis reads verified answers
 * aloud with a voice the owner selects.
 */

import { SpeechRecognition, localSpeech, waitForSpeechIdle } from './whisper.js';
import {
  captureOwnerLabel,
  chooseSystemVoice,
  createDispatchGate,
  spokenReply,
} from './ask-voice-model.js';

const MAX_TURNS = 80;
const MAX_SPOKEN_CHARS = 2400;
const VOICE_PREF_KEY = 'zeno.ask.systemVoice';
const ASK_PROMPT =
  'Zeno Forge Counsel Command approvals receipts Vault Ollama worktree repository ' +
  'TypeScript JavaScript Node.js React Python PostgreSQL';

const OWNER_TOKEN = (() => {
  const meta = document.querySelector('meta[name="zeno-token"]');
  const value = meta ? meta.getAttribute('content') : '';
  return typeof value === 'string' && value.trim() ? value.trim() : '';
})();

function authHeaders(extra) {
  const headers = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) headers['x-zeno-token'] = OWNER_TOKEN;
  return headers;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function agentLabel(agentId) {
  if (agentId === 'local') return 'a local model on this machine';
  if (agentId === 'claude-code') return 'Claude Code (Anthropic, over the network)';
  if (agentId === 'codex') return 'Codex (OpenAI, over the network)';
  return agentId || 'an unnamed agent';
}

/*
 * The Home composer's icon buttons, built the same way as the rest of this
 * app's SVG glyphs: createElementNS from a path spec, never an innerHTML
 * string. Shapes ported verbatim from the design artifact's attach/mic/send
 * icons (b551a806, markup ~792-795).
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_ATTACH = ['M21 11l-8.6 8.6a4 4 0 0 1-5.7-5.7L13.9 6.7a2.5 2.5 0 0 1 3.5 3.5L10 17.6'];
const ICON_MIC = [['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }], 'M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8'];
const ICON_SEND = ['M12 19V5M6 11l6-6 6 6'];

function composerIcon(shapes, strokeWidth) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth || 1.7));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of shapes) {
    const isPath = typeof shape === 'string';
    const node = document.createElementNS(SVG_NS, isPath ? 'path' : shape[0]);
    const attrs = isPath ? { d: shape } : shape[1];
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
    svg.appendChild(node);
  }
  return svg;
}

function mountPanel() {
  const host = document.querySelector('[data-mount="ask"]');
  if (!host) return null;

  const panel = el('section', 'za-panel');
  panel.setAttribute('aria-label', 'Ask Zeno conversation');
  panel.dataset.hasTurns = 'false';
  panel.style.cssText = [
    'display:flex', 'flex-direction:column', 'min-height:0', 'max-height:min(680px,78vh)',
    'border:1px solid var(--rule,#242C31)', 'border-radius:12px', 'overflow:hidden',
    'background:var(--g3,#151A1D)', 'color:var(--ink,#ECEBE6)',
    'font:13px/1.5 system-ui,sans-serif',
  ].join(';');

  const header = el('header', 'za-head');
  header.style.cssText = [
    'display:flex', 'align-items:center', 'gap:9px', 'flex-wrap:wrap',
    'padding:10px 12px', 'border-bottom:1px solid var(--rule,#242C31)',
    'background:var(--g2,#101416)',
  ].join(';');
  const title = el('strong', 'za-title', 'Ask Zeno');
  title.style.cssText = 'margin-right:auto;font-size:13px';
  const typedMode = el('button', 'za-mode za-mode-typed', 'Type');
  const voiceMode = el('button', 'za-mode za-mode-voice', 'Voice conversation');
  const clear = el('button', 'za-clear', 'Clear');
  for (const button of [typedMode, voiceMode, clear]) {
    button.type = 'button';
    button.style.cssText = [
      'padding:5px 9px', 'border-radius:6px', 'border:1px solid var(--rule-2,#2C353B)',
      'background:transparent', 'color:var(--ink-2,#9AA1AC)',
      'font:600 11.5px system-ui,sans-serif', 'cursor:pointer',
    ].join(';');
  }
  typedMode.setAttribute('aria-pressed', 'true');
  voiceMode.setAttribute('aria-pressed', 'false');
  header.append(title, typedMode, voiceMode, clear);

  const thread = el('div', 'za-thread');
  thread.setAttribute('role', 'log');
  thread.setAttribute('aria-label', 'Ask Zeno conversation');
  thread.setAttribute('aria-live', 'polite');
  thread.style.cssText = [
    'flex:1 1 auto', 'min-height:0', 'overflow:auto', 'padding:14px 13px',
    'display:flex', 'flex-direction:column', 'gap:12px', 'background:var(--g2,#101416)',
  ].join(';');

  const empty = el(
    'div',
    'za-empty',
    'Ask about current Zeno state or describe work for Forge. Answers are checked against a fresh local snapshot.',
  );
  empty.style.cssText = [
    'margin:auto', 'max-width:42ch', 'text-align:center',
    'font-size:12.5px', 'color:var(--ink-2,#9AA1AC)',
  ].join(';');
  thread.appendChild(empty);

  const realStatus = el('p', 'za-status');
  realStatus.setAttribute('role', 'status');
  realStatus.setAttribute('aria-live', 'polite');
  realStatus.style.cssText = [
    'margin:0', 'padding:7px 12px', 'min-height:18px',
    'border-top:1px solid var(--rule,#242C31)',
    'font-size:11.5px', 'color:var(--ink-2,#9AA1AC)', 'overflow-wrap:anywhere',
  ].join(';');

  // The compact icon composer, ported from the design artifact's Home
  // composer (CSS ~108-126, markup ~790-798): a glass '.row' of attach/
  // textarea/mic/send '.cbtn's above a mono '.foot' pill row. '.composer' and
  // '.cbtn' sizing for it live in screens/home-composer.css; '.pill' itself
  // is already global (index.html) and is reused unmodified.
  const composer = el('div', 'composer');

  const row = el('div', 'row');

  const attach = el('button', 'cbtn attach');
  attach.type = 'button';
  attach.disabled = true;
  attach.title = 'Attachments are not available yet';
  attach.setAttribute('aria-label', 'Attach a file (not available yet)');
  attach.appendChild(composerIcon(ICON_ATTACH, 1.7));

  const input = document.createElement('textarea');
  input.className = 'za-input';
  input.rows = 1;
  input.maxLength = 4000;
  input.placeholder = 'Message Zeno…';
  input.setAttribute('aria-label', 'Message Ask Zeno');

  const mic = el('button', 'cbtn mic');
  mic.type = 'button';
  mic.setAttribute('aria-pressed', 'false');
  mic.setAttribute('aria-label', 'Voice conversation');
  mic.appendChild(composerIcon(ICON_MIC, 1.7));

  const send = el('button', 'cbtn send');
  send.type = 'button';
  send.title = 'Send';
  send.setAttribute('aria-label', 'Send');
  send.appendChild(composerIcon(ICON_SEND, 1.9));

  row.append(attach, input, mic, send);

  // The mono foot: a real model pill (from /forge/agents, the same
  // localModels list Forge's own picker reads), a real voice-state pill
  // (from this file's own voice state), a static memory pill (this file's
  // grounding is always the local Vault — see the header comment above —
  // never a per-session toggle), and the keyboard hint.
  const foot = el('div', 'foot');

  const modelPill = el('span', 'pill wt');
  const modelDot = el('span', 'd');
  modelDot.setAttribute('aria-hidden', 'true');
  const modelText = document.createTextNode('model: checking…');
  modelPill.append(modelDot, modelText);

  const voicePill = el('span', 'pill wt');
  const voiceDot = el('span', 'd');
  voiceDot.setAttribute('aria-hidden', 'true');
  const voiceText = document.createTextNode('voice: idle');
  voicePill.append(voiceDot, voiceText);

  const memoryPill = el('span', 'pill wt', 'memory: Vault · local only');
  memoryPill.title = 'What this conversation may use';

  const grow = el('span', 'grow');
  const hint = el('span', null, 'Enter to send · Shift+Enter for a new line');

  foot.append(modelPill, voicePill, memoryPill, grow, hint);
  composer.append(row, foot);

  // The voice select still exists and still works exactly as before; it
  // just no longer sits inside the compact composer row. updateMode() keeps
  // hiding it while voice conversation is off.
  const voiceSelect = document.createElement('select');
  voiceSelect.setAttribute('aria-label', 'Assistant speaking voice');
  voiceSelect.title = 'System voice used to read assistant replies';
  voiceSelect.style.cssText = [
    'display:block', 'min-width:0', 'max-width:230px', 'margin:8px 10px 0',
    'padding:5px 7px', 'border-radius:6px',
    'border:1px solid var(--rule-2,#2C353B)', 'background:var(--g2,#101416)',
    'color:var(--ink-2,#9AA1AC)', 'font:11.5px system-ui,sans-serif',
  ].join(';');

  // The privacy prose, moved out of the composer into a small note below it.
  const privacy = el(
    'p',
    'za-privacy',
    localSpeech
      ? 'Voice input uses local Whisper. Zeno does not identify who is speaking; while voice conversation is on, any clear speech near the microphone can become a turn. Replies use the selected system voice. Voice can ask and delegate, but it can never confirm hosted work or approve a capsule.'
      : 'Voice input falls back to the browser speech service, which may send microphone audio to the browser maker. Zeno does not identify who is speaking; while voice conversation is on, any clear speech near the microphone can become a turn. Replies use the selected system/browser voice. Voice never confirms or approves.',
  );
  privacy.style.cssText = [
    'margin:6px 0 0', 'padding:0 2px', 'font-size:10.5px', 'line-height:1.4',
    'color:var(--ink-3,#6C7480)',
  ].join(';');

  panel.append(header, thread, realStatus, composer, voiceSelect, privacy);
  host.appendChild(panel);
  return {
    panel,
    typedMode,
    voiceMode,
    clear,
    thread,
    empty,
    status: realStatus,
    composer,
    input,
    voiceSelect,
    mic,
    send,
    modelPill,
    modelText,
    voicePill,
    voiceText,
  };
}

const ui = mountPanel();

if (!ui) {
  throw new Error('Ask Zeno mount is missing.');
}

const dispatchGate = createDispatchGate();
const handledHostedRuns = new Set();
let typedSerial = 0;
let turnCount = 0;
let recognition = null;
let recognitionSerial = 0;
let voiceModeOn = false;
let voiceStarting = false;
let speaking = false;
let speechEpoch = 0;
let voiceRestartTimer = 0;
let installedVoices = [];

function setStatus(text, tone) {
  ui.status.textContent = text || '';
  ui.status.style.color =
    tone === 'ok'
      ? 'var(--green,#5BB98C)'
      : tone === 'warn'
        ? 'var(--amber,#E0A128)'
        : 'var(--ink-2,#9AA1AC)';
}

function updateMode() {
  ui.typedMode.setAttribute('aria-pressed', voiceModeOn ? 'false' : 'true');
  ui.voiceMode.setAttribute('aria-pressed', voiceModeOn ? 'true' : 'false');
  ui.mic.setAttribute('aria-pressed', voiceModeOn ? 'true' : 'false');
  ui.typedMode.style.color = voiceModeOn ? 'var(--ink-2,#9AA1AC)' : 'var(--ink,#ECEBE6)';
  ui.voiceMode.style.color = voiceModeOn ? 'var(--cyan,#4FD1DB)' : 'var(--ink-2,#9AA1AC)';
  // The mic cbtn is icon-only; state is shown by the .rec pulse + its title,
  // and by the foot's voice-state pill, not by a text label.
  ui.mic.classList.toggle('rec', voiceModeOn);
  if (SpeechRecognition) {
    ui.mic.title = speaking
      ? 'Interrupt'
      : voiceStarting
        ? 'Cancel voice start'
        : voiceModeOn
          ? 'Stop voice conversation'
          : 'Start voice conversation';
  }
  ui.voiceSelect.hidden = !voiceModeOn;
  ui.send.disabled = dispatchGate.busy();
  updateVoicePill();
}

/** The foot's voice-state pill, from this file's own real voice state. */
function updateVoicePill() {
  let text = 'voice: idle';
  let tone = 'wt';
  if (!SpeechRecognition) {
    text = 'voice: unavailable';
  } else if (speaking) {
    text = 'voice: speaking';
    tone = 'cy';
  } else if (voiceStarting) {
    text = 'voice: starting…';
    tone = 'cy';
  } else if (voiceModeOn) {
    text = 'voice: listening';
    tone = 'cy';
  }
  ui.voicePill.className = 'pill ' + tone;
  ui.voiceText.data = text;
}

/** The foot's model pill, read from the same /forge/agents localModels list
 *  Forge's own model picker reads — never an invented model name. */
async function loadModelPill() {
  try {
    const response = await fetch('/forge/agents', { headers: authHeaders(), cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const models = response.ok && Array.isArray(data?.localModels) ? data.localModels : null;
    if (!response.ok) {
      setModelPill('model: unknown', 'wt');
    } else if (models && models.length > 0) {
      setModelPill(String(models[0]) + ' · local', 'cy');
    } else {
      setModelPill('no local model installed', 'am');
    }
  } catch {
    setModelPill('model: unknown', 'wt');
  }
}

function setModelPill(text, tone) {
  ui.modelPill.className = 'pill ' + tone;
  ui.modelText.data = text;
}

/** Grow the composer's single-row textarea to its content, capped like the
 *  artifact's own composer (max-height:160px, screens/home-composer.css). */
function autosizeInput() {
  ui.input.style.height = 'auto';
  ui.input.style.height = Math.min(ui.input.scrollHeight, 160) + 'px';
}

function trimThread() {
  const turns = [...ui.thread.querySelectorAll('.za-turn')];
  while (turns.length > MAX_TURNS) turns.shift()?.remove();
}

function appendTurn(role, text, options) {
  ui.empty.hidden = true;
  ui.panel.dataset.hasTurns = 'true';
  ui.panel.style.minHeight = 'min(430px,70vh)';
  ui.thread.style.minHeight = '210px';
  turnCount += 1;
  const turn = el('article', 'za-turn za-' + role);
  turn.dataset.turn = String(turnCount);
  turn.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:5px',
    role === 'user' ? 'align-items:flex-end' : 'align-items:stretch',
  ].join(';');

  const who = el('span', 'za-who', role === 'user' ? (options?.voice ? 'YOU · VOICE' : 'YOU') : 'ZENO');
  who.style.cssText = [
    'font:700 9.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:.08em', 'color:var(--ink-3,#6C7480)',
  ].join(';');

  const body = el('div', 'za-body', text);
  body.style.cssText = role === 'user'
    ? [
        'max-width:88%', 'padding:8px 10px', 'border-radius:10px 10px 2px 10px',
        'background:var(--g5,#222A2E)', 'white-space:pre-wrap', 'overflow-wrap:anywhere',
      ].join(';')
    : [
        'padding:1px 0 8px', 'border-bottom:1px solid var(--rule,#242C31)',
        'white-space:pre-wrap', 'overflow-wrap:anywhere',
      ].join(';');
  if (options?.tone === 'warn') body.style.color = 'var(--amber,#E0A128)';

  turn.append(who, body);
  ui.thread.appendChild(turn);
  trimThread();
  ui.thread.scrollTop = ui.thread.scrollHeight;
  return { turn, body };
}

/**
 * A collapsible execution trace, not hidden model reasoning. It reports only
 * observable stages the UI can prove while the single daemon request runs.
 */
function appendActivity() {
  const details = el('details', 'za-thinking');
  details.open = true;
  const summary = el('summary');
  const pulse = el('span', 'za-thinking-pulse', '•••');
  pulse.setAttribute('aria-hidden', 'true');
  const label = el('span', null, 'Working…');
  summary.append(pulse, label);
  const log = el(
    'p',
    'za-thinking-log',
    'Reading the current local context and checking the response. Hosted work and approvals still wait for an explicit click.',
  );
  details.append(summary, log);
  ui.thread.appendChild(details);
  ui.thread.scrollTop = ui.thread.scrollHeight;
  const startedAt = Date.now();
  return {
    finish(text, detail) {
      pulse.remove();
      label.textContent = text + ' · ' + Math.max(0, Date.now() - startedAt) + ' ms';
      log.textContent = detail;
      details.open = false;
    },
  };
}

function appendMeta(turn, text, tone) {
  const meta = el('p', 'za-meta', text);
  meta.style.cssText = [
    'margin:0', 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:' + (tone === 'warn' ? 'var(--amber,#E0A128)' : 'var(--ink-3,#6C7480)'),
    'white-space:pre-wrap', 'overflow-wrap:anywhere',
  ].join(';');
  turn.appendChild(meta);
  return meta;
}

function makeAction(label, tone) {
  const button = el('button', 'za-action', label);
  button.type = 'button';
  button.style.cssText = [
    'align-self:flex-start', 'padding:6px 9px', 'border-radius:6px',
    'border:1px solid ' + (tone === 'warn' ? 'var(--amber,#E0A128)' : 'var(--rule-2,#2C353B)'),
    'background:transparent', 'color:var(--ink,#ECEBE6)',
    'font:600 11.5px system-ui,sans-serif', 'cursor:pointer',
  ].join(';');
  return button;
}

function openPending() {
  window.ZenoNav?.show('command');
  window.ZenoCommandPanels?.show('pending', { focus: true });
  const pending = document.getElementById('pending') || document.querySelector('[data-mount="pending"]');
  if (pending && typeof pending.scrollIntoView === 'function') {
    pending.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function runSummary(outcome) {
  const proposed = Array.isArray(outcome?.proposed) ? outcome.proposed.length : 0;
  const note = outcome?.note ? String(outcome.note) : '';
  if (proposed > 0) {
    const status = outcome?.ok === false ? 'The run stopped before finishing.' : 'The run finished.';
    return (
      status + ' ' + proposed + ' ' + (proposed === 1 ? 'change is' : 'changes are') +
      ' waiting for review in Command. Nothing was applied.' +
      (note ? ' ' + note : '')
    );
  }
  return 'No changes were proposed. ' + (note || 'The agent finished without changing a file.');
}

function renderDelegation(parent, delegated) {
  if (!delegated) return;

  const card = el('section', 'za-delegation');
  card.setAttribute('aria-label', 'Forge delegation');
  card.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:6px', 'padding:9px 10px',
    'border:1px solid var(--rule-2,#2C353B)', 'border-radius:8px',
    'background:var(--g1,#0B0F11)',
  ].join(';');

  appendMeta(
    card,
    'FORGE · ' + agentLabel(delegated.agentId) + (delegated.model ? ' · ' + delegated.model : ''),
  );
  const task = el('p', 'za-task', '“' + String(delegated.task || '') + '”');
  task.style.cssText = 'margin:0;font-size:12px;overflow-wrap:anywhere';
  const state = el('p', 'za-delegate-state');
  state.setAttribute('role', 'status');
  state.style.cssText = 'margin:0;font-size:12px;color:var(--ink-2,#9AA1AC);overflow-wrap:anywhere';
  card.append(task, state);

  if (delegated.needsConfirm) {
    state.textContent =
      'Not started. ' + (delegated.because || 'This hosted provider uses network egress and may consume plan or API allowance.') +
      ' Voice cannot confirm this. Use the explicit on-screen button.';
    state.style.color = 'var(--amber,#E0A128)';
    const row = el('div', 'za-delegate-actions');
    row.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap';
    const run = makeAction('Run on ' + agentLabel(delegated.agentId), 'warn');
    const skip = makeAction('Not now');
    run.addEventListener('click', () => void confirmHosted(delegated, state, row));
    skip.addEventListener('click', () => {
      run.disabled = true;
      skip.disabled = true;
      state.textContent = 'Not run. Nothing was sent anywhere.';
      state.style.color = 'var(--green,#5BB98C)';
    });
    row.append(run, skip);
    card.appendChild(row);
  } else if (delegated.started) {
    state.textContent = runSummary(delegated);
    state.style.color = delegated.ok === false ? 'var(--amber,#E0A128)' : 'var(--green,#5BB98C)';
    if (Array.isArray(delegated.proposed) && delegated.proposed.length > 0) {
      const review = makeAction('Review waiting changes');
      review.addEventListener('click', openPending);
      card.appendChild(review);
    }
  } else {
    state.textContent = delegated.note || 'Nothing was started.';
    state.style.color = 'var(--amber,#E0A128)';
  }

  parent.appendChild(card);
}

function renderResponse(data) {
  const payload = data && typeof data === 'object' ? data : {};
  let text;
  let tone;
  if (payload.answer) {
    text = String(payload.answer);
  } else if (payload.flagged) {
    text = String(payload.flagged);
    tone = 'warn';
  } else {
    text = payload.note ? String(payload.note) : 'No answer came back.';
    tone = 'warn';
  }

  const rendered = appendTurn('assistant', text, { tone });
  const ids = Array.isArray(payload.cited) ? payload.cited : [];
  if (ids.length > 0) appendMeta(rendered.turn, 'cited: ' + ids.join(' '));

  if (payload.flagged) {
    const ungrounded = payload.ungrounded || {};
    const details = [];
    if (Array.isArray(ungrounded.unknownIds) && ungrounded.unknownIds.length) {
      details.push('invented ids: ' + ungrounded.unknownIds.join(' '));
    }
    if (Array.isArray(ungrounded.claimsWithoutCitation) && ungrounded.claimsWithoutCitation.length) {
      details.push(ungrounded.claimsWithoutCitation.length + ' claim(s) without a citation');
    }
    appendMeta(
      rendered.turn,
      'This reply failed the grounding check and is not presented as an answer.' +
        (details.length ? ' ' + details.join(' · ') : ''),
      'warn',
    );
  }

  if (payload.proposal?.relPath) {
    appendMeta(
      rendered.turn,
      'PROPOSED · ' + payload.proposal.relPath + ' · waiting for owner review; not applied',
      payload.proposal.refused ? 'warn' : undefined,
    );
    const review = makeAction('Review approval capsule');
    review.addEventListener('click', openPending);
    rendered.turn.appendChild(review);
  }

  renderDelegation(rendered.turn, payload.delegated);
  ui.thread.scrollTop = ui.thread.scrollHeight;
}

function readSavedVoice() {
  try {
    return window.localStorage.getItem(VOICE_PREF_KEY) || '';
  } catch {
    return '';
  }
}

function saveVoice(value) {
  try {
    if (value) window.localStorage.setItem(VOICE_PREF_KEY, value);
    else window.localStorage.removeItem(VOICE_PREF_KEY);
  } catch {
    // A voice preference is optional. Speech still works for this renderer.
  }
}

function refreshVoices() {
  const synthesis = window.speechSynthesis;
  installedVoices = synthesis && typeof synthesis.getVoices === 'function'
    ? synthesis.getVoices()
    : [];
  ui.voiceSelect.replaceChildren();

  if (installedVoices.length === 0) {
    const option = el('option', null, 'No system voice reported');
    option.value = '';
    ui.voiceSelect.appendChild(option);
    ui.voiceSelect.disabled = true;
    return;
  }

  const selected = chooseSystemVoice(installedVoices, readSavedVoice(), navigator.language || 'en-US');
  for (const voice of installedVoices) {
    const option = el(
      'option',
      null,
      voice.name + ' · ' + (voice.lang || 'unknown language') + (voice.localService ? ' · local' : ''),
    );
    option.value = voice.voiceURI;
    option.selected = voice === selected;
    ui.voiceSelect.appendChild(option);
  }
  ui.voiceSelect.disabled = false;
  if (selected) saveVoice(selected.voiceURI);
}

function stopSpeaking(message) {
  speechEpoch += 1;
  speaking = false;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // The platform owns synthesis. A missing or closing engine is already silent.
  }
  updateMode();
  if (message) setStatus(message);
}

function speak(text) {
  if (!voiceModeOn || !text) {
    return Promise.resolve();
  }
  const synthesis = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synthesis || typeof synthesis.speak !== 'function' || typeof Utterance !== 'function') {
    setStatus('The answer is on screen. This Electron runtime did not report a speaking voice.', 'warn');
    return Promise.resolve();
  }

  const epoch = ++speechEpoch;
  const clipped = text.length > MAX_SPOKEN_CHARS
    ? text.slice(0, MAX_SPOKEN_CHARS).replace(/\s+\S*$/, '') + '. The rest is on screen.'
    : text;
  const utterance = new Utterance(clipped);
  const selected = chooseSystemVoice(installedVoices, ui.voiceSelect.value, navigator.language || 'en-US');
  if (selected) utterance.voice = selected;
  utterance.lang = selected?.lang || navigator.language || 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;
  speaking = true;
  updateMode();
  setStatus('Speaking with ' + (selected?.name || 'the default system voice') + '…');

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (epoch === speechEpoch) {
        speaking = false;
        updateMode();
      }
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      synthesis.cancel();
      synthesis.speak(utterance);
    } catch {
      finish();
    }
  });
}

async function releaseRecognition() {
  window.clearTimeout(voiceRestartTimer);
  voiceRestartTimer = 0;
  const current = recognition;
  recognition = null;
  if (current) {
    try {
      current.abort();
    } catch {
      // It may already have emitted end.
    }
  }
  await waitForSpeechIdle();
}

async function stopVoiceConversation(reason) {
  voiceModeOn = false;
  voiceStarting = false;
  recognitionSerial += 1;
  await releaseRecognition();
  stopSpeaking();
  if (document.body.dataset.zenoCapture === 'ask') {
    delete document.body.dataset.zenoCapture;
  }
  updateMode();
  setStatus(reason || 'Voice conversation stopped. The microphone is closed.', 'ok');
}

async function startVoiceConversation() {
  if (voiceModeOn || voiceStarting) return;
  if (!SpeechRecognition) {
    setStatus('No speech-recognition engine is available. Typed Ask Zeno still works.', 'warn');
    return;
  }

  const occupied = document.body.dataset.zenoCapture;
  if (occupied && occupied !== 'ask') {
    setStatus(captureOwnerLabel(occupied) + ' is using the microphone. End it before starting voice conversation.', 'warn');
    return;
  }

  voiceStarting = true;
  // Reserve before yielding to asynchronous teardown. Without this reservation a
  // new Command PTT press could enter after the handoff event but before Whisper
  // reports idle, leaving two recognizers alive.
  document.body.dataset.zenoCapture = 'ask';
  updateMode();
  setStatus('Closing other Command listening before voice conversation starts…');

  const handoff = { waiters: [], requestedBy: 'Ask Zeno voice conversation' };
  window.dispatchEvent(new CustomEvent('zeno:release-command-voice', { detail: handoff }));
  try {
    await Promise.all(handoff.waiters);
    await waitForSpeechIdle();
  } catch {
    voiceStarting = false;
    if (document.body.dataset.zenoCapture === 'ask') delete document.body.dataset.zenoCapture;
    updateMode();
    setStatus('The previous microphone session did not close. Stop it and retry.', 'warn');
    return;
  }

  // A typed-mode click or an external handoff may cancel while teardown awaits.
  if (!voiceStarting) return;
  const ownerAfterHandoff = document.body.dataset.zenoCapture;
  if (ownerAfterHandoff !== 'ask') {
    voiceStarting = false;
    updateMode();
    setStatus(
      ownerAfterHandoff
        ? captureOwnerLabel(ownerAfterHandoff) + ' took the microphone. Voice conversation did not start.'
        : 'The microphone reservation was released. Voice conversation did not start.',
      'warn',
    );
    return;
  }

  voiceStarting = false;
  voiceModeOn = true;
  updateMode();
  setStatus(
    localSpeech
      ? 'Voice conversation on. Local Whisper is listening for your next message.'
      : 'Voice conversation on. The browser speech service may send microphone audio to its provider.',
  );
  startListening();
}

function scheduleListen() {
  window.clearTimeout(voiceRestartTimer);
  voiceRestartTimer = window.setTimeout(() => {
    voiceRestartTimer = 0;
    startListening();
  }, 260);
}

function startListening() {
  if (!voiceModeOn || voiceStarting || speaking || dispatchGate.busy() || recognition) return;
  if (document.body.dataset.zenoCapture !== 'ask') {
    void stopVoiceConversation('Another surface owns the microphone. Voice conversation stopped.');
    return;
  }

  const rec = new SpeechRecognition();
  const session = ++recognitionSerial;
  let handled = false;
  recognition = rec;
  rec.lang = navigator.language || 'en-US';
  rec.continuous = localSpeech;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.initialPrompt = ASK_PROMPT;

  rec.onstart = () => {
    if (recognition === rec && voiceModeOn) {
      setStatus(localSpeech ? 'Listening locally with Whisper…' : 'Listening through the browser speech service…');
    }
  };

  rec.onresult = event => {
    if (!voiceModeOn || recognition !== rec || handled || session !== recognitionSerial) return;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result?.isFinal) continue;
      const text = String(result[0]?.transcript || '').trim();
      if (!text) continue;
      handled = true;
      recognition = null;
      try {
        rec.abort();
      } catch {
        // The final result is already captured.
      }
      void submit(text, { voice: true, key: 'voice:' + session + ':' + index });
      return;
    }
  };

  rec.onerror = event => {
    if (recognition !== rec || session !== recognitionSerial) return;
    const error = String(event?.error || 'unknown');
    if (error === 'no-speech' || error === 'aborted') return;
    recognition = null;
    void stopVoiceConversation(
      error === 'not-allowed'
        ? 'Microphone permission was refused. Voice conversation is off.'
        : 'Speech recognition stopped (' + error + '). Voice conversation is off.',
    );
  };

  rec.onend = () => {
    if (recognition !== rec || session !== recognitionSerial) return;
    recognition = null;
    if (voiceModeOn && !handled && !speaking && !dispatchGate.busy()) scheduleListen();
  };

  try {
    rec.start();
  } catch (error) {
    recognition = null;
    void stopVoiceConversation('The microphone could not start: ' + (error?.message || error));
  }
}

async function confirmHosted(delegated, state, actionRow) {
  const runId = String(delegated?.runId || delegated?.confirm?.body?.runId || '');
  if (!runId || handledHostedRuns.has(runId)) return;
  handledHostedRuns.add(runId);

  await releaseRecognition();
  stopSpeaking();
  for (const button of actionRow.querySelectorAll('button')) button.disabled = true;
  state.textContent = 'Running on ' + agentLabel(delegated.agentId) + '…';
  state.style.color = 'var(--cyan,#4FD1DB)';

  const confirmation = delegated.confirm || {
    method: 'POST',
    path: '/forge/run',
    body: { task: delegated.task, agentId: delegated.agentId },
  };

  let spoken;
  try {
    const response = await fetch(confirmation.path, {
      method: confirmation.method,
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify(confirmation.body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data.error || {};
      state.textContent = 'The run was refused: ' + (error.message || response.status) + '. ' + (error.resolve || '');
      state.style.color = 'var(--amber,#E0A128)';
      spoken = 'The hosted run was refused. Read the reason on screen.';
    } else {
      const outcome = {
        proposed: data.proposed,
        note: data.run?.note,
        ok: data.run?.ok,
      };
      state.textContent = runSummary(outcome);
      state.style.color = outcome.ok === false ? 'var(--amber,#E0A128)' : 'var(--green,#5BB98C)';
      if (Array.isArray(outcome.proposed) && outcome.proposed.length > 0) {
        const review = makeAction('Review waiting changes');
        review.addEventListener('click', openPending);
        actionRow.replaceChildren(review);
      }
      spoken = runSummary(outcome) + ' Voice cannot approve any of those changes.';
    }
  } catch (error) {
    state.textContent = 'Network error during the run: ' + (error?.message || error) + '. Nothing was applied.';
    state.style.color = 'var(--amber,#E0A128)';
    spoken = 'The hosted run failed. Nothing was applied.';
  }

  if (voiceModeOn) {
    await speak(spoken);
    if (voiceModeOn) scheduleListen();
  }
}

async function submit(rawQuestion, options) {
  const question = String(rawQuestion || '').trim();
  if (!question || !OWNER_TOKEN) {
    if (!OWNER_TOKEN) {
      setStatus('This browser cannot ask because no owner token was injected. Open the daemon-served window.', 'warn');
    }
    return;
  }

  const key = options?.key || 'typed:' + (++typedSerial);
  const token = dispatchGate.begin(key);
  if (!token) return;

  await releaseRecognition();
  stopSpeaking();
  appendTurn('user', question, { voice: options?.voice === true });
  const activity = appendActivity();
  ui.input.value = '';
  autosizeInput();
  updateMode();
  setStatus('Thinking… a local delegation may run, while hosted work still waits for a click.');

  let payload;
  try {
    const response = await fetch('/assistant/ask', {
      method: 'POST',
      headers: authHeaders({ 'content-type': 'application/json' }),
      cache: 'no-store',
      body: JSON.stringify({ question }),
    });
    payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = payload.error || {};
      const message =
        'Could not ask: ' + (error.message || response.status) + (error.resolve ? '. ' + error.resolve : '');
      appendTurn('assistant', message, { tone: 'warn' });
      activity.finish('Request stopped', 'The daemon returned an error. No action was approved or applied.');
      setStatus(message, 'warn');
      payload = { note: message };
    } else {
      window.dispatchEvent(new CustomEvent('zeno:runtime-refresh', { detail: { source: 'ask' } }));
      activity.finish(
        payload.answer ? 'Grounded response returned' : payload.flagged ? 'Grounding check flagged the reply' : 'No grounded answer returned',
        'The daemon finished its local context and grounding checks. This trace contains execution facts, not private model reasoning.',
      );
      renderResponse(payload);
      setStatus(payload.note ? String(payload.note) : 'Answer received.', payload.answer ? 'ok' : 'warn');
    }
  } catch (error) {
    const message = 'Network error: ' + (error?.message || error) + '. Your Zeno state is unaffected.';
    appendTurn('assistant', message, { tone: 'warn' });
    activity.finish('Request stopped', 'The daemon request did not complete. Zeno state was not changed.');
    setStatus(message, 'warn');
    payload = { note: message };
  } finally {
    dispatchGate.finish(token);
    updateMode();
  }

  if (voiceModeOn) {
    const words = spokenReply(payload);
    await speak(words);
    if (voiceModeOn) scheduleListen();
  }
}

ui.send.addEventListener('click', () => void submit(ui.input.value));
ui.input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submit(ui.input.value);
  }
});
ui.input.addEventListener('focus', () => {
  if (recognition) {
    void releaseRecognition();
    setStatus('Listening paused while you type. Sending will continue the voice conversation.');
  }
  if (speaking) stopSpeaking('Speech stopped because you started typing.');
});
ui.input.addEventListener('input', () => {
  if (speaking) stopSpeaking('Speech stopped because you interrupted with typed input.');
  autosizeInput();
});

ui.typedMode.addEventListener('click', () => {
  if (voiceModeOn || voiceStarting || speaking) void stopVoiceConversation('Typed mode. The microphone and speech are stopped.');
});
ui.voiceMode.addEventListener('click', () => {
  if (speaking) {
    stopSpeaking('Speech interrupted. Listening for your next message…');
    if (voiceModeOn) scheduleListen();
  } else if (voiceModeOn || voiceStarting) {
    void stopVoiceConversation();
  } else {
    void startVoiceConversation();
  }
});
ui.mic.addEventListener('click', () => {
  if (speaking) {
    stopSpeaking('Speech interrupted. Listening for your next message…');
    if (voiceModeOn) scheduleListen();
  } else if (voiceModeOn || voiceStarting) {
    void stopVoiceConversation();
  } else {
    void startVoiceConversation();
  }
});
ui.clear.addEventListener('click', () => {
  for (const turn of ui.thread.querySelectorAll('.za-turn,.za-thinking')) turn.remove();
  ui.empty.hidden = false;
  ui.panel.dataset.hasTurns = 'false';
  ui.panel.style.minHeight = '0';
  ui.thread.style.minHeight = '0';
  setStatus('Conversation cleared from this renderer. Nothing was deleted from Vault because raw chat was never stored there.', 'ok');
});

// Chats reopens a saved conversation into this thread so it continues here, with
// the same live composer and the same gate. The turns are re-rendered from the
// local snapshot; nothing is re-sent to the daemon until you type again.
window.addEventListener('zeno:restore-chat', (event) => {
  const turns = event.detail && Array.isArray(event.detail.turns) ? event.detail.turns : [];
  for (const turn of ui.thread.querySelectorAll('.za-turn,.za-thinking')) turn.remove();
  ui.empty.hidden = false;
  ui.panel.dataset.hasTurns = 'false';
  for (const t of turns) {
    if (t && t.text) appendTurn(t.role === 'user' ? 'user' : 'assistant', String(t.text));
  }
  if (turns.length) setStatus('Reopened a saved conversation. Continue it here — it keeps saving to Chats.', 'ok');
  ui.input.focus({ preventScroll: true });
});

ui.voiceSelect.addEventListener('change', () => {
  saveVoice(ui.voiceSelect.value);
  const selected = installedVoices.find(voice => voice.voiceURI === ui.voiceSelect.value);
  setStatus('Assistant voice: ' + (selected?.name || 'system default') + '.', 'ok');
});

window.addEventListener('zeno:release-command-voice', event => {
  if (event.detail?.requestedBy === 'Ask Zeno voice conversation') return;
  if (!voiceModeOn && !voiceStarting && !speaking && !recognition) return;
  const requestedBy = event.detail?.requestedBy || 'another voice surface';
  event.detail?.waiters?.push(
    stopVoiceConversation('Voice conversation paused for ' + requestedBy + '.'),
  );
});

window.addEventListener('pagehide', () => {
  voiceModeOn = false;
  void releaseRecognition();
  stopSpeaking();
  if (document.body.dataset.zenoCapture === 'ask') delete document.body.dataset.zenoCapture;
});

if (!SpeechRecognition) {
  ui.voiceMode.disabled = true;
  ui.mic.disabled = true;
  ui.voiceMode.title = 'No speech-recognition engine is available.';
  ui.mic.title = 'No speech-recognition engine is available.';
}

refreshVoices();
if (window.speechSynthesis) {
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}
void loadModelPill();
updateMode();
setStatus('Ready. This thread stays in memory while this Zeno window is open; raw chat is not silently saved.');
ui.input.focus({ preventScroll: true });

export default {
  submit,
  startVoiceConversation,
  stopVoiceConversation,
};
