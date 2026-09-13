/*
 * bind/call-banner.js — "a call looks live — take notes with Counsel?"
 *
 * The owner asked for Counsel to prompt on its own when a call starts, instead
 * of waiting behind a Record button nobody remembers mid-call. This binder owns
 * the one global banner in index.html (#call-banner) and nothing else.
 *
 * WHERE THE SIGNAL COMES FROM. Only the desktop app can see window titles
 * (packages/desktop/meeting-presence.cjs, exposed to this page as
 * window.zenoMeeting). This binder polls that bridge at a slow interval and
 * reports what it saw to the daemon (POST /calls/detected), which keeps one
 * shared record and nudges every window over /stream. A plain browser has no
 * bridge, reports nothing, and so never shows a banner — there is no fallback
 * heuristic here, because a banner claiming a call nobody can verify is a lie.
 *
 * WHAT THE BANNER MAY DO. Route, and only route. "Take notes" switches to
 * Counsel and opens its consent card — the same card the Record button opens —
 * and Counsel's own Start button, behind two explicit consents, is still the
 * only thing that opens the microphone. Detection reads names, never audio or
 * pixels (see the desktop matcher for how it asks Electron for names only).
 */

import { $, authHeaders, getJSON } from '../bind.js';

/* Slow on purpose: enumerating windows is cheap but not free, and a call that
   is fifteen seconds old is still a call. */
const POLL_MS = 15_000;
const DISMISS_KEY = 'zeno.callBanner.dismissed';

let started = false;
let current = null;          // the daemon's latest sighting, or null
let dismissedKey = '';       // the sighting key the owner waved away
let lastReported = '';       // what this window last POSTed, to avoid re-posting the same list

function readDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}
function writeDismissed(key) {
  dismissedKey = key;
  try { sessionStorage.setItem(DISMISS_KEY, key); } catch { /* a page that cannot persist still hides it for this load */ }
}

/** Counsel's own Record button — the entry point this banner routes to. */
function counselRecordButton() {
  return $('.product[data-product="counsel"] #cn-record');
}

function render(banner) {
  const what = $('#call-banner-what', banner);
  const notes = $('#call-banner-notes', banner);
  // Counsel already has the microphone: prompting the owner to take notes of
  // the call they are recording would be noise, and the live bar is the
  // honest indicator now.
  const recording = document.body.dataset.zenoCapture === 'counsel';
  const show = !!current && current.key !== dismissedKey && !recording;
  banner.hidden = !show;
  if (!show) return;
  if (what) what.textContent = `${current.app}: ${current.title}`;
  banner.classList.toggle('compact', document.documentElement.getAttribute('data-zeno-surface') === 'counsel');
  // Take notes can only act if Counsel's Record button can. When Counsel has
  // disabled it (no speech engine here), say so on this control too rather
  // than routing the owner to a button that will not open.
  const record = counselRecordButton();
  if (notes) {
    const blocked = !record || record.disabled;
    notes.disabled = blocked;
    notes.title = !record
      ? 'Counsel is not on this page, so there is nowhere to take notes.'
      : record.disabled ? (record.title || 'Counsel cannot record in this app.') : 'Open Counsel’s consent step — recording starts only after you confirm there.';
  }
}

async function refresh(banner) {
  const r = await getJSON('/calls/current');
  // An unread endpoint keeps the last sighting rather than inventing "no call";
  // the poll below will re-report and correct it on its next tick.
  if (r.ok) current = r.data && r.data.call ? r.data.call : null;
  render(banner);
}

/**
 * Ask the desktop bridge what it sees and tell the daemon. Nothing is posted
 * when the bridge is absent (plain browser) or answers "unavailable" — an
 * absent signal is not a report of "no call".
 */
async function detectAndReport(banner) {
  const bridge = window.zenoMeeting;
  if (!bridge || typeof bridge.detect !== 'function') return;
  let presence;
  try { presence = await bridge.detect(); } catch { return; }
  if (!presence || presence.supported !== true) return;
  const candidates = Array.isArray(presence.candidates)
    ? presence.candidates.map((c) => ({ app: c.provider, title: c.title }))
    : [];
  const fingerprint = JSON.stringify(candidates);
  if (fingerprint === lastReported) return;
  try {
    const res = await fetch('/calls/detected', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ candidates }),
    });
    if (!res.ok) return;
    lastReported = fingerprint;
    const data = await res.json();
    current = data && data.call ? data.call : null;
    render(banner);
  } catch {
    // Nothing to say on screen: a report that did not land leaves the banner as it was.
  }
}

function takeNotes(banner) {
  const record = counselRecordButton();
  if (!record || record.disabled) { render(banner); return; }
  const seg = $('.seg [data-product="counsel"]');
  if (seg) seg.click();
  // Counsel's own handler opens the consent card (openPreflight in
  // bind/counsel.js); if a call is already live it shows the live view instead.
  record.click();
  render(banner);
}

export async function bind() {
  const banner = $('#call-banner');
  if (!banner || started) return;
  started = true;
  dismissedKey = readDismissed();

  $('#call-banner-notes', banner)?.addEventListener('click', () => takeNotes(banner));
  $('#call-banner-dismiss', banner)?.addEventListener('click', () => {
    if (current) writeDismissed(current.key);
    render(banner);
  });

  // The daemon nudges over /stream (forwarded by bind/live.js); re-read rather
  // than trusting an event payload, the same rule every other binder follows.
  document.addEventListener('zeno:call', () => { void refresh(banner); });
  // Counsel taking or releasing the microphone, and the product switch, both
  // change what the banner should look like without any daemon event.
  new MutationObserver(() => render(banner)).observe(document.body, { attributes: true, attributeFilter: ['data-zeno-capture'] });
  new MutationObserver(() => render(banner)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-zeno-surface'] });

  await refresh(banner);
  void detectAndReport(banner);
  const timer = setInterval(() => { void detectAndReport(banner); }, POLL_MS);
  // A hidden window should not keep enumerating the owner's windows; resume
  // with a fresh look when it comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lastReported = ''; void detectAndReport(banner); void refresh(banner); }
  });
  window.addEventListener('pagehide', () => clearInterval(timer));
}
