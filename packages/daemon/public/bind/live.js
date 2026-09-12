/*
 * bind/live.js — make the window live.
 *
 * The daemon has published an event stream at /stream from the beginning:
 * receipts as they are sealed, previews as they are raised, chain verification,
 * and the size of the decision queue. Nothing in the renderer subscribed to it.
 * Every binder ran once at boot and never again, so the whole window was a
 * photograph of the moment it loaded:
 *
 *   - an agent proposing something never appeared in Approvals
 *   - the rail's count never moved
 *   - a sealed receipt never showed up in the ledger
 *   - Home's "Needs you" stayed at whatever it said when you opened the app
 *
 * That is the single largest reason the product felt like a prototype: it was
 * correct, and it was silent. This module reconnects the two.
 *
 * DESIGN. The stream carries a nudge, never the truth. An event says "something
 * moved"; the binders then RE-READ the daemon. Rendering straight from an event
 * payload would create a second source of truth that drifts from /state the
 * moment one event is missed, and this surface's whole rule is that a number on
 * screen was actually read.
 */

import { token, refreshChrome } from '../bind.js';

/** Which binders care about which events. Re-running one is idempotent. */
const REBIND = {
  './bind/home.js': ['state', 'preview', 'receipt', 'chain'],
  './bind/approvals.js': ['state', 'preview', 'receipt'],
  './bind/receipts.js': ['receipt', 'chain'],
  './bind/lists.js': ['state', 'receipt'],
};

/** Coalesce a burst — a run can seal several receipts in a few milliseconds. */
function debounce(fn, ms) {
  let t = 0;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

let source = null;
let backoff = 1000;

async function rerun(kinds) {
  const jobs = Object.entries(REBIND)
    .filter(([, wants]) => wants.some((w) => kinds.has(w)))
    .map(async ([path]) => {
      try {
        const mod = await import(path.replace('./bind/', './'));
        if (typeof mod.bind === 'function') await mod.bind();
      } catch (err) {
        // A binder that fails to refresh must not take the stream down with it;
        // the screen keeps the last values it successfully read.
        console.warn('[zeno live] could not refresh', path, err);
      }
    });
  await Promise.all(jobs);
  // Shared chrome — the rail counts, the Forge cyan CTA, the activity-bar
  // badges, the model chip — belongs to bind.js, not to any screen binder, so
  // re-running the screens alone left the rail displaying its boot-time count.
  try { await refreshChrome(); } catch (err) { console.warn('[zeno live] chrome', err); }
  // field.js redraws the Standing Field on this event.
  window.dispatchEvent(new CustomEvent('zeno:state'));
  document.dispatchEvent(new CustomEvent('zeno:refreshed'));
}

function connect() {
  if (!token()) return; // a read-only page has no stream to read
  if (source) { try { source.close(); } catch { /* already gone */ } }

  /* No credential in the URL. The daemon serves this window with a `zeno_token`
     cookie precisely because EventSource cannot set a header (see the comment
     above the role lookup in server.ts), and a same-origin EventSource sends it
     automatically. Putting the owner token in a query string instead would copy
     a live credential into every place a URL gets written down. */
  let pendingKinds = new Set();
  const flush = debounce(() => {
    const kinds = pendingKinds;
    pendingKinds = new Set();
    if (kinds.size) void rerun(kinds);
  }, 180);

  const note = (kind) => () => { pendingKinds.add(kind); flush(); };

  try {
    source = new EventSource('/stream');
  } catch {
    return; // no EventSource in this runtime: the window stays a snapshot, honestly
  }

  for (const kind of ['state', 'preview', 'receipt', 'chain']) {
    source.addEventListener(kind, note(kind));
  }
  // A daemon that names an event we do not know about still means "something moved".
  source.addEventListener('message', note('state'));

  source.addEventListener('open', () => { backoff = 1000; });
  source.addEventListener('error', () => {
    /* EventSource retries on its own AND replays from Last-Event-ID, which is
       strictly better than anything done by hand — so a transient drop is left
       alone. Only a CLOSED source has given up for good (the daemon stopped, or
       answered with the wrong status), and only that is reconnected here, with a
       ceiling so a stopped daemon is not hammered. */
    if (!source || source.readyState !== 2 /* CLOSED */) return;
    source = null;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  });
}

export async function bind() {
  connect();
  // A window that slept can miss events entirely; re-reading on return costs one
  // round trip and removes a whole class of "it was stale and I believed it".
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (!source) connect();
      void rerun(new Set(['state', 'receipt', 'chain', 'preview']));
    }
  });
}
