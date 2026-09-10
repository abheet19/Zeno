/**
 * Zeno Command — the window.
 * ==========================
 * The ES module that wires the shell (index.html), the approval capsule
 * (capsule.js) and the receipt timeline (timeline.js) to the local daemon.
 *
 * It does four things and nothing else:
 *
 *   1. Reads the state once from GET /state and renders it: pending capsules,
 *      receipt timeline, chain badge, policy hash, owner-token origin.
 *   2. Holds the stream open and keeps that render current.
 *   3. Lets the owner approve exactly one action per click, and seals nothing
 *      until the receipt for that exact actionHash is in hand.
 *   4. Says out loud when it does not know something.
 *
 * FIVE RULES IT WILL NOT BEND
 *
 *   R1  The verified seal comes from a receipt. Never from a click, never from
 *       a 200, never from an optimistic guess. capsule.js owns the seal; this
 *       file only ever hands it a Receipt that actually arrived.
 *   R2  A gap in the stream is DECLARED — in the timeline itself, at the point
 *       in history where it happened, and permanently. This file will not
 *       silently stitch the stream back together and let the page look whole.
 *   R3  Nothing is synthesised to fill a hole in the wire. If /state does not
 *       carry a field, the UI says the field was not reported — /state reports
 *       no policyHash, so the chip names the receipt it read one off instead.
 *       The payload is never invented either: the daemon does send it beside
 *       each Preview, and when it is missing the capsule blocks approval on
 *       that and says why rather than rendering bytes nobody sent.
 *   R4  Opening, reordering, repainting and reconnecting never approve
 *       anything. There is exactly one write in this file: POST /approvals,
 *       and it is issued by capsule.js from a real click.
 *   R5  Colour follows the four-channel law: amber = approval/warning,
 *       red = blocked/error, gold = owner origin (never a status),
 *       cyan = information/listening, green = a verified receipt exists.
 *       Every state here is also a glyph and a word, so it survives greyscale.
 *
 * WHY THE TRANSPORT IS NOT `new EventSource('/stream')`
 *
 * One reason, and one common non-reason — both checked against the daemon as it
 * is actually written (packages/daemon/src/server.ts and stream.ts):
 *
 *   a) NOT authentication. GET /stream accepts the `x-zeno-token` header OR the
 *      `zeno_token` cookie the shell is served with, precisely so that a browser
 *      transport that cannot set headers still authenticates. An EventSource
 *      would be let in. This is worth stating because the opposite is the
 *      obvious guess, and acting on the guess would be cargo cult.
 *   b) Honest resume needs the FIRST connection to carry a Last-Event-ID.
 *      /state returns `lastEventId` precisely so the page can say "I have seen
 *      everything up to N" when it attaches. An EventSource has no way to send
 *      that on its first connect, which leaves a silent hole between the
 *      snapshot and the attach — the exact failure R2 exists to prevent.
 *
 * So the stream is read with fetch + ReadableStream, and this file implements
 * the parts of the EventSource contract that matter: `id:` tracking, the
 * `retry:` interval, automatic reconnection, and Last-Event-ID on every
 * connect — including the first, seeded from the snapshot.
 *
 * No framework, no bundler, no CDN, no build step. Plain DOM APIs, textContent
 * only. Every colour is a token from /glass/tokens.css; the literals are the
 * approved palette used as var() fallbacks. Nothing in this file animates, so
 * `prefers-reduced-motion` is honoured by having nothing to reduce.
 */

import { pendingCapsuleNeedsRefresh, renderCapsule } from './capsule.js';
import { renderTimeline } from './timeline.js';

/* ================================================================== *
 * 0 · the DOM this module was given, and tiny helpers                 *
 * ================================================================== */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

const OWNER_TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

const mount = {
  chain: document.getElementById('chain-badge'),
  stream: document.getElementById('stream-chip'),
  owner: document.getElementById('owner-chip'),
  policy: document.getElementById('policy-chip'),
  notice: document.getElementById('notice'),
  noticeText: document.querySelector('[data-mount="notice-text"]'),
  pending: document.getElementById('pending-list'),
  timeline: document.getElementById('timeline'),
  summary: document.getElementById('summary'),
};

/**
 * Has /state ever been read into this window?
 *
 * The summary strip turns on this one flag. Before it is true every tile says
 * "not read", because 0 needing you and 0 verified are claims about a daemon
 * this page has not spoken to; after it is true a 0 is a counted fact and is
 * shown as one. There is no third state and no remembered value.
 */
let stateEverRead = false;

/**
 * The "nothing is awaiting your decision" block.
 *
 * It is built HERE and not cloned from the shell, and the difference matters.
 * The shell's own resting block says the queue has NOT BEEN READ, because that
 * is the only true thing before /state answers — and it is still the true thing
 * if /state never answers. "Nothing awaiting approval" is a claim about the
 * daemon, so only a successful read may put it on screen, and the only code
 * that runs after a successful read is this file.
 */
function pendingEmptyBlock() {
  const wrap = el('div', 'empty');
  const glyph = el('span', 'empty-glyph', '○');
  glyph.setAttribute('aria-hidden', 'true');
  const body = el('div');
  body.appendChild(el('p', 'empty-title', 'Nothing awaiting approval.'));
  body.appendChild(
    el(
      'p',
      'empty-sub',
      'No agent is holding an action against your yes. When one proposes something that needs ' +
        'approval it appears here as a single line — its tier, the sentence it was summarised as, ' +
        'and when this window first saw it — and opening that line shows the whole capsule: the ' +
        'reasons policy gave it, the exact target, the hashes and the payload itself. Nothing ' +
        'moves until you approve it.',
    ),
  );
  wrap.append(glyph, body);
  return wrap;
}

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) h['x-zeno-token'] = OWNER_TOKEN;
  return h;
}

function clock(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function short(hash, n = 12) {
  return typeof hash === 'string' && hash.length > n ? hash.slice(0, n) : String(hash ?? '');
}

/* ================================================================== *
 * 1 · the model                                                       *
 *                                                                     *
 * One place holds what this page believes, and every believed thing   *
 * came off the wire. Nothing here is computed from optimism.          *
 * ================================================================== */

/** actionHash -> { preview, node, settled, seq, settledSeq } */
const capsules = new Map();
let capsuleSeq = 0;

/** Receipts in LEDGER ORDER, oldest first — timeline.js renders newest-first. */
let receipts = [];
/** ChainStatus, or null while the daemon has not reported one. */
let chain = null;
/**
 * How many receipts this page held when that ChainStatus was reported.
 *
 * `chain.ok` is a statement about the ledger AS THE DAEMON READ IT, and receipts
 * keep arriving on the stream between one `chain` event and the next. Without
 * this the badge would read "chain verified — N receipts" the instant a new
 * receipt landed, lending the green ✓ to a row nothing has verified yet. The
 * difference is passed to the timeline and named on screen instead.
 */
let chainAtCount = 0;
/** policyHash, and where this page got it from. */
let policy = { hash: null, source: null };

/**
 * Declared holes in the live stream. Each one is permanent for the life of the
 * page and is drawn INTO the timeline at the point in history where it
 * happened — `atCount` is how many receipts this page had actually seen when
 * the daemon told us it could not replay. Rows above that line were recovered
 * from the ledger afterwards; rows below were watched live.
 */
const gaps = [];
let gapSeq = 0;

/* ================================================================== *
 * 2 · this module's own styles                                        *
 *                                                                     *
 * Only the few elements neither capsule.js nor timeline.js owns: the  *
 * gap marker, the settled divider, the notice lines and the screen-   *
 * reader announcer. Tokens only, approved palette as fallback.        *
 * ================================================================== */

const STYLE_ID = 'zeno-app-styles';
const CSS = `
.zn-sr{
  position:absolute; width:1px; height:1px; margin:-1px; padding:0;
  overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0;
}

/* --- notice lines: the amber box in the shell, one line per live warning --- */
.zn-nline{ display:block; }
.zn-nline + .zn-nline{ margin-top:8px; }
.zn-nact{
  margin-left:8px;
  font:inherit; font-size:11px; cursor:pointer;
  padding:2px 8px; border-radius:5px;
  border:1px solid var(--rule-2,#2C363B);
  background:var(--g4,#1B2124); color:var(--ink,#ECEBE6);
}
.zn-nact:hover{ background:var(--g5,#222A2E); }
.zn-nact:focus-visible{ outline:2px solid var(--focus,#86DEEC); outline-offset:2px; }

/* --- the settled divider: awaiting above it, receipted below it ----------- */
.zn-divider{
  display:flex; gap:8px; align-items:flex-start;
  margin:16px 0 12px; padding:8px 12px;
  border:1px solid var(--rule,#242C31); border-radius:8px;
  background:var(--g3,#151A1D);
  font-size:11.5px; line-height:1.5; color:var(--ink-2,#9AA1AC);
}
.zn-divider-glyph{ color:var(--ink-3,#6C7480); line-height:18px; }
.zn-divider b{ color:var(--ink,#ECEBE6); font-weight:600; }
.zn-caps + .zn-caps{ margin-top:16px; }

/* --- the gap marker: amber, because a hole in the record is a warning ------
   Drawn as a row of the history, not as a toast, because it IS history: the
   line where this page stopped being able to prove what happened. */
.zn-gap{
  display:flex; gap:10px; align-items:flex-start;
  padding:10px 16px;
  background:color-mix(in srgb, var(--amber,#E0A128) 14%, var(--g3,#151A1D));
  border-top:2px solid var(--amber,#E0A128);
  border-bottom:2px solid var(--amber,#E0A128);
  color:var(--ink,#ECEBE6);
  font-variant-numeric:tabular-nums;
}
.zn-gap-glyph{ color:var(--amber,#E0A128); font-size:14px; line-height:18px; }
.zn-gap-body{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.zn-gap-label{
  font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:var(--amber,#E0A128);
}
.zn-gap-line{ margin:0; font-size:11.5px; line-height:1.5; color:var(--ink,#ECEBE6); overflow-wrap:anywhere; }
.zn-gap-line.zn-gap-dim{ color:var(--ink-2,#9AA1AC); }
.zn-gap-ids{
  font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;
  font-variant-numeric:tabular-nums;
}
/* Standing alone (an empty ledger has no list to sit inside). */
.zn-gap[data-standalone="1"]{
  margin:0 16px 16px; border:2px solid var(--amber,#E0A128); border-radius:8px;
}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = el('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Polite announcements for a screen reader: new work, and settled work. */
const announcer = el('div', 'zn-sr');
announcer.setAttribute('aria-live', 'polite');
announcer.setAttribute('role', 'status');

function announce(text) {
  announcer.textContent = String(text);
}

/**
 * Tell the rest of the surface that the daemon's state moved.
 *
 * The Standing Field (field.js) and the Today list (command.js) read the same
 * daemon this file already holds a stream to. Without this they fall back to a
 * 15-second poll, which means the field can be showing a queue that is no
 * longer there, and the list can be missing an approval that has already
 * arrived — two readouts of one system, disagreeing, on the screen whose whole
 * claim is that it tells you the truth about what is waiting.
 *
 * It carries NO payload on purpose. This is a signal to re-read, not a copy of
 * the state: a second copy travelling by a different route is a second thing
 * that can be stale, and each listener re-reads the daemon for itself.
 */
function signalState() {
  try { window.dispatchEvent(new CustomEvent('zeno:state')); } catch { /* no CustomEvent */ }
}

/* ================================================================== *
 * 3 · the header chips                                                *
 *                                                                     *
 * The shell styles `.chip[data-state]` with three values and only     *
 * three: listening (cyan), owner (gold), warn (amber). Each chip is   *
 * glyph + label, so removing colour removes nothing.                  *
 * ================================================================== */

function setChip(node, glyph, label, state, title) {
  if (!node) return;
  const g = el('span', 'chip-glyph', glyph);
  g.setAttribute('aria-hidden', 'true');
  node.replaceChildren(g, document.createTextNode(' ' + label));
  if (state) node.dataset.state = state;
  else delete node.dataset.state;
  if (title) node.title = title;
  else node.removeAttribute('title');
  node.setAttribute('aria-label', label);
}

function paintOwnerChip() {
  if (OWNER_TOKEN) {
    // Gold, and gold only here: this is provenance — whose hand this window is
    // — and it is never a status about how anything is going.
    setChip(
      mount.owner,
      '◆',
      'owner token · this window can approve',
      'owner',
      'The daemon injected the owner token into this page. Approvals posted from this window carry it.',
    );
  } else {
    setChip(
      mount.owner,
      '⚠',
      'owner token absent · cannot approve',
      'warn',
      'No owner token was injected into this page, so it cannot authenticate to the daemon. Open the window from the URL the daemon printed on startup.',
    );
  }
}

function paintPolicyChip() {
  if (!mount.policy) return;
  if (!policy.hash) {
    setChip(
      mount.policy,
      '—',
      'policy not reported',
      null,
      'Neither /state nor any receipt on this page carries a policy hash, so which rules were in force cannot be shown.',
    );
    return;
  }
  setChip(
    mount.policy,
    '§',
    'policy ' + short(policy.hash),
    null,
    policy.source === 'state'
      ? `policyHash reported by the daemon: ${policy.hash}`
      : `Not reported by /state. Taken from the newest receipt, which records the policy that was in force when it was written: ${policy.hash}`,
  );
}

function refreshPolicyFromReceipts(stateHash) {
  if (typeof stateHash === 'string' && stateHash) {
    policy = { hash: stateHash, source: 'state' };
  } else if (policy.source !== 'state') {
    const newest = [...receipts].reverse().find((r) => typeof r?.policyHash === 'string' && r.policyHash);
    policy = newest ? { hash: newest.policyHash, source: 'receipt' } : { hash: null, source: null };
  }
  paintPolicyChip();
}

/* ================================================================== *
 * 4 · the notice box — every live warning, none of them hidden        *
 *                                                                     *
 * The shell gives one amber box. Several things can be wrong at once  *
 * (no token AND a dropped stream AND an unreplayable gap), so each    *
 * gets its own line and none is allowed to mask another. Lines are    *
 * updated in place, so a countdown never steals keyboard focus from   *
 * a button sitting next to it.                                        *
 * ================================================================== */

const notices = new Map(); // id -> { line, text, actionBtn }

function setNotice(id, text, action) {
  if (!mount.notice || !mount.noticeText) return;
  // Unhide BEFORE writing. #notice is role="status": a live region that is
  // display:none when its content changes has nothing to announce, and several
  // screen readers will not re-read it just because it later became visible.
  // Revealing the empty region first makes the append a change to a live region.
  mount.notice.hidden = false;
  let entry = notices.get(id);
  if (!entry) {
    const line = el('div', 'zn-nline');
    const textEl = el('span', null, text);
    line.appendChild(textEl);
    entry = { line, text: textEl, actionBtn: null };
    notices.set(id, entry);
    mount.noticeText.appendChild(line);
  } else {
    entry.text.textContent = String(text);
  }
  if (action && !entry.actionBtn) {
    const b = el('button', 'zn-nact', action.label);
    b.type = 'button';
    b.addEventListener('click', action.run);
    entry.actionBtn = b;
    entry.line.appendChild(b);
  } else if (action && entry.actionBtn) {
    entry.actionBtn.textContent = action.label;
  } else if (!action && entry.actionBtn) {
    entry.actionBtn.remove();
    entry.actionBtn = null;
  }
}

function clearNotice(id) {
  const entry = notices.get(id);
  if (!entry) return;
  entry.line.remove();
  notices.delete(id);
  if (notices.size === 0 && mount.notice) mount.notice.hidden = true;
}

/* ================================================================== *
 * 5 · pending capsules                                                *
 * ================================================================== */

let dividerNode = null;
let emptyNode = null;

/** Memoised, so re-laying-out the list does not mint a new node every time and
 *  defeat the "did anything actually move?" check in layoutPending(). */
function pendingEmpty() {
  if (!emptyNode) emptyNode = pendingEmptyBlock();
  return emptyNode;
}

function settledDivider() {
  if (dividerNode) return dividerNode;
  dividerNode = el('div', 'zn-divider');
  const g = el('span', 'zn-divider-glyph', '─');
  g.setAttribute('aria-hidden', 'true');
  const body = el('div');
  const strong = el('b', null, 'Settled.');
  body.appendChild(strong);
  body.appendChild(
    document.createTextNode(
      ' These carry a receipt and are no longer awaiting your decision. They stay on screen so you can read the outcome you were shown; each one’s receipt is also a permanent line in the timeline below.',
    ),
  );
  dividerNode.append(g, body);
  return dividerNode;
}

/* ================================================================== *
 * 5b · the compact row — one line per held action                     *
 *                                                                     *
 * This is the whole difference between a dashboard and the debug view *
 * it replaces. A row carries a tier, the one sentence the owner was   *
 * shown, a status word, when THIS WINDOW first saw it, and a way in.  *
 * It carries no hash, no provenance and no payload: those are the     *
 * capsule's, and the capsule opens directly underneath the row that   *
 * asked for it — one at a time, on demand, never all of them at once. *
 *                                                                     *
 * Rows are built once per action and updated in place, for exactly    *
 * the reason capsules are never rebuilt: this list re-lays-out on     *
 * every stream tick, and a rebuilt row drops the owner's focus.       *
 * ================================================================== */

/** The one action whose capsule is on screen. null = none is open. */
let openHash = null;

function isMasked() {
  return document.documentElement.getAttribute('data-lock') === '1';
}

function hhmm(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * What a row can honestly say about age.
 *
 * The daemon does not stamp a proposal with the moment it was made — `Preview`
 * has no timestamp and the held store keeps none — so there is no such thing on
 * this page as "how long has this been waiting". What there IS, is when this
 * window first saw it, and that is what the row says, in those words. Inventing
 * an age from the moment a browser tab happened to load would be a measurement
 * nobody took.
 */
function seenLine(entry) {
  return 'seen ' + hhmm(entry.seenAt);
}
function seenTitle(entry) {
  return (
    'The daemon does not record when a proposal was made, so this is not its age: it is when this ' +
    'window first saw it — ' + entry.seenAt.toLocaleString() + '.'
  );
}

function statusOf(entry) {
  if (entry.settled) {
    const outcome = entry.receipt && typeof entry.receipt.outcome === 'string' ? entry.receipt.outcome : null;
    if (outcome === null) return ['settled', ''];
    return [outcome, outcome === 'verified' ? 'gr' : 'rd'];
  }
  if (entry.preview.denied) return ['refused', 'rd'];
  if (entry.preview.auto) return ['auto', 'cy'];
  return ['needs you', 'am'];
}

function rowFor(entry) {
  if (entry.row) return entry.row;
  const hash = entry.preview.actionHash;

  const row = el('div', 'nrow');
  row.dataset.hash = hash;
  const tier = el('span', 'ntier');
  const summary = el('p', 'nsum');
  const pill = el('span', 'ist');
  const age = el('span', 'nage');
  const open = el('button', 'nopen');
  open.type = 'button';
  open.setAttribute('aria-expanded', 'false');
  open.addEventListener('click', () => {
    const opening = openHash !== hash;
    openHash = opening ? hash : null;
    layoutPending();
    // Focus stays on this control, which is now the control that closes it.
    // It is deliberately NOT moved into the capsule: the first focusable thing
    // in there is the single-use Approve button, and landing a keyboard on it
    // because someone asked to READ the action would be indefensible.
    open.focus({ preventScroll: true });
    if (opening && entry.detail && entry.detail.scrollIntoView) {
      entry.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  row.append(tier, summary, pill, age, open);
  entry.row = row;
  entry.rowParts = { tier, summary, pill, age, open };
  return row;
}

function updateRow(entry) {
  const parts = entry.rowParts;
  if (!parts) return;
  const p = entry.preview;

  parts.tier.textContent = typeof p.tier === 'string' && p.tier ? p.tier : 'tier —';
  parts.tier.title = typeof p.tier === 'string' && p.tier
    ? 'Risk tier recorded on this proposal'
    : 'This proposal carries no tier. That is what the daemon sent, not a default.';

  // Masked mode redacts the sentence and keeps everything else, because hiding
  // THAT something is waiting is the one dishonesty masking must not commit.
  const masked = isMasked();
  const text = typeof p.summary === 'string' && p.summary ? p.summary : '(no summary on this proposal)';
  parts.summary.textContent = masked ? '█'.repeat(20) : text;
  parts.summary.classList.toggle('mk', masked);
  parts.summary.title = masked ? 'Withheld — masked mode' : '';

  const [word, tone] = statusOf(entry);
  parts.pill.className = 'ist' + (tone ? ' ' + tone : '');
  parts.pill.textContent = word;

  parts.age.textContent = seenLine(entry);
  parts.age.title = seenTitle(entry);

  const isOpen = p.actionHash === openHash;
  parts.open.textContent = isOpen ? 'Close' : entry.settled ? 'Read' : 'Open';
  parts.open.setAttribute(
    'aria-label',
    (isOpen ? 'Close' : 'Open') + ' the full capsule for: ' + (masked ? 'a withheld action' : text),
  );
}

/** The capsule's stable home. Its node changes only when the daemon refreshes its bound review. */
function detailFor(entry) {
  if (!entry.detail) {
    entry.detail = el('div', 'ndetail');
    entry.detail.appendChild(entry.node);
  }
  return entry.detail;
}

/**
 * Awaiting first (newest first), then the divider, then settled (most recently
 * settled first). Nodes are MOVED, not rebuilt during layout: a capsule owns its
 * own state — a spent Approve control, a running countdown, a rendered seal.
 * `addPreview` replaces one only when the daemon sends fresher bound payload or
 * review evidence for that still-pending action. The rows remain stable.
 */
function layoutPending() {
  if (!mount.pending) return;
  mount.pending.classList.add('nlist');
  if (openHash !== null && !capsules.has(openHash)) openHash = null;

  const all = [...capsules.values()];
  const awaiting = all.filter((c) => !c.settled).sort((a, b) => b.seq - a.seq);
  const settled = all.filter((c) => c.settled).sort((a, b) => b.settledSeq - a.settledSeq);

  const kids = [];
  const place = (entry) => {
    const row = rowFor(entry);
    updateRow(entry);
    const isOpen = entry.preview.actionHash === openHash;
    row.dataset.open = isOpen ? '1' : '0';
    entry.rowParts.open.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    kids.push(row);
    // The capsule is in the DOM only while its row is open. It is not destroyed
    // when it leaves — detached is not gone, and the node keeps every state the
    // owner has already been shown.
    if (isOpen) kids.push(detailFor(entry));
  };

  for (const c of awaiting) place(c);
  // "Nothing awaiting approval" is owed whenever nothing is awaiting — including
  // when settled capsules are still on screen. Suppressing it there left the
  // owner reading a receipted capsule under a heading that says "What needs
  // you", with nothing on the page willing to say the queue is empty.
  if (awaiting.length === 0) kids.push(pendingEmpty());
  if (settled.length > 0) {
    kids.push(settledDivider());
    for (const c of settled) place(c);
  }

  // replaceChildren() detaches and re-attaches EVERY child, which drops keyboard
  // focus to <body> and resets each capsule's scroll offset. layoutPending() is
  // called on every preview and every receipt, so without this an owner reading
  // a payload loses their place — and their focus — each time the stream ticks.
  const current = mount.pending.childNodes;
  if (current.length === kids.length && kids.every((n, i) => current[i] === n)) return;

  const active = document.activeElement;
  const refocus = active instanceof HTMLElement && mount.pending.contains(active) ? active : null;
  const scrolled = [];
  for (const node of kids) {
    if (!node.querySelectorAll) continue;
    for (const box of node.querySelectorAll('.zn-body, .zn-payload')) {
      if (box.scrollTop) scrolled.push([box, box.scrollTop]);
    }
  }

  mount.pending.replaceChildren(...kids);

  for (const [box, top] of scrolled) box.scrollTop = top;
  // preventScroll: the element was already on screen; re-focusing it must not
  // yank the viewport away from whatever the owner was looking at.
  if (refocus && refocus.isConnected) refocus.focus({ preventScroll: true });
}

function addPreview(preview) {
  if (!preview || typeof preview.actionHash !== 'string' || !mount.pending) return;

  // `onApprove` is deliberately NOT overridden. capsule.js already owns the
  // POST /approvals call, and it owns it correctly: it latches the single-use
  // control spent BEFORE the await, sends `x-zeno-token`, and on a non-200
  // renders the daemon's `message` AND its `resolve` line inside the capsule,
  // next to the hash they are about. Routing that through this file would move
  // the error away from the decision it belongs to, and — worse — a thrown
  // error from an override is rendered by the capsule as "outcome unknown,
  // retry frozen", which would be a lie about a 403 where nothing was ever
  // attempted. All this file supplies is the token and the endpoint.
  const opts = {
    ownerToken: OWNER_TOKEN,
    endpoint: '/approvals',
  };

  // R3 — the payload. The kernel's `Preview` type carries binding.payloadHash
  // and not the bytes, but the daemon does not put a bare Preview on the wire:
  // server.ts `withPayload` spreads the preview and attaches `payload`, on both
  // GET /state.pending and the "preview" event. So the bytes are normally here,
  // and the capsule can recompute sha256(canonicalJSON(payload)) against
  // binding.payloadHash in front of the owner. When they are NOT here the
  // capsule blocks approval and says so, and nothing below invents them.
  // It is passed through only when the object genuinely carries it
  // (`hasOwnProperty`, not `?.`): handing the
  // capsule `payload: undefined` would make it render the literal word
  // "undefined" as the exact payload and unblock Approve on bytes nobody has
  // seen. Nothing here synthesises a payload, ever.
  if (typeof preview.payloadText === 'string') {
    opts.payloadText = preview.payloadText;
  } else if (Object.prototype.hasOwnProperty.call(preview, 'payload')) {
    opts.payload = preview.payload;
  }
  if (Object.prototype.hasOwnProperty.call(preview, 'review')) opts.review = preview.review;
  if (typeof preview.expiresAt === 'string') opts.expiresAt = preview.expiresAt;

  const existing = capsules.get(preview.actionHash);
  if (existing && !existing.settled && !pendingCapsuleNeedsRefresh(existing.preview, preview)) return;

  const node = renderCapsule(preview, opts);
  if (existing && !existing.settled) {
    // `/state` deliberately refreshes a held write's observed review. Replace
    // the capsule in its existing row so a ready review that became drifted can
    // never leave an old Approve control on screen. The map remains the receipt
    // target; only its current node changes.
    existing.node.destroy?.();
    existing.preview = preview;
    existing.node = node;
    if (existing.detail) existing.detail.replaceChildren(node);
    layoutPending();
    paintSummary();
    announce(`Approval review refreshed for: ${preview.summary ?? '(no summary)'}`);
    return;
  }
  if (existing) {
    // The same identity previewed again after settling. It is awaiting once
    // more, so it is rebuilt from the new preview rather than resurrected.
    existing.node.destroy?.();
    capsules.delete(preview.actionHash);
  }

  capsules.set(preview.actionHash, {
    preview,
    node,
    settled: false,
    seq: ++capsuleSeq,
    settledSeq: 0,
    // When this window first saw it. NOT when it was proposed — nothing on the
    // wire says that — and the row labels it as this and nothing else.
    seenAt: new Date(),
    receipt: null,
    row: null,
    rowParts: null,
    detail: null,
  });
  layoutPending();
  paintSummary();

  if (!preview.auto && !preview.denied) {
    announce(`New action awaiting approval, tier ${preview.tier}: ${preview.summary ?? '(no summary)'}`);
  }
}

/**
 * A receipt exists for this action. The capsule renders its own terminal state
 * from the receipt — that is where the green seal is drawn, and this is the
 * only path to it.
 */
function settleCapsule(receipt) {
  const entry = capsules.get(receipt.actionHash);
  if (!entry || entry.settled) return false;
  // Latched BEFORE the render: applyReceipt dispatches `zeno:receipt`
  // synchronously and the listener below re-enters this function. Marking it
  // settled first is what makes that re-entry a no-op instead of a loop.
  entry.settled = true;
  entry.settledSeq = ++capsuleSeq;
  // Kept so the row can state the outcome. The row RESTATES what the receipt
  // says; it never decides it, and it never draws a seal — that is the
  // capsule's, from this same receipt.
  entry.receipt = receipt;
  entry.node.applyReceipt?.(receipt);
  layoutPending();
  paintSummary();
  announce(
    `Receipt ${receipt.outcome} for: ${receipt.summary || entry.preview?.summary || 'an approved action'}.`,
  );
  return true;
}

/* ================================================================== *
 * 6 · the timeline, and the gap markers drawn into it                 *
 * ================================================================== */

function gapMarker(gap, standalone) {
  const n = el(standalone ? 'div' : 'li', 'zn-gap');
  if (standalone) n.dataset.standalone = '1';
  const g = el('span', 'zn-gap-glyph', '⚠');
  g.setAttribute('aria-hidden', 'true');

  const body = el('div', 'zn-gap-body');
  body.appendChild(el('strong', 'zn-gap-label', 'live stream gap'));

  // When the daemon names the range, that sentence IS the daemon's message
  // with the numbers in it, so its stock wording is not repeated underneath.
  // When it cannot name the range, whatever it did say is the only account of
  // what was lost, and it is printed verbatim.
  const named = Number.isFinite(gap.lastEventId) && Number.isFinite(gap.currentId);
  body.appendChild(
    el(
      'p',
      'zn-gap-line zn-gap-ids',
      named
        ? `Events ${gap.lastEventId + 1}–${gap.currentId} happened while this page was disconnected and can no longer be replayed.`
        : 'Events happened while this page was disconnected and can no longer be replayed, and the range could not be named.',
    ),
  );
  if (!named && gap.message) {
    body.appendChild(el('p', 'zn-gap-line zn-gap-dim', gap.message));
  }

  let statusText;
  if (!gap.resync) {
    statusText = 'Re-reading the ledger…';
  } else if (gap.resync.ok) {
    statusText =
      `The ledger was re-read at ${clock(gap.resync.at)}. Everything above this line was recovered from the ` +
      'ledger afterwards, not watched live — the receipts are the daemon’s, but this page cannot claim it saw them happen.';
  } else {
    statusText =
      `The re-read FAILED at ${clock(gap.resync.at)} (${gap.resync.reason}). This page is known to be incomplete: ` +
      'anything that happened during the gap may be missing entirely. ' +
      (gap.resolve || 'Reload to re-read the full state from the ledger.');
  }
  body.appendChild(el('p', 'zn-gap-line', statusText));

  n.append(g, body);
  return n;
}

/**
 * Insert every declared gap into the rendered history at its own position.
 *
 * timeline.js draws newest-first, so a gap recorded when this page had seen
 * `atCount` receipts belongs immediately above row #atCount-1 — that is, below
 * everything learned after the gap and above everything watched before it.
 */
function insertGapMarkers(section) {
  if (gaps.length === 0) return;
  const list = section.querySelector('.zt-list');
  const ordered = [...gaps].sort((a, b) => b.seq - a.seq); // newest gap highest

  if (!list) {
    // An empty ledger renders no list. The gap is still true, so it is drawn
    // as its own block rather than dropped for want of somewhere to sit.
    for (const gap of ordered) section.appendChild(gapMarker(gap, true));
    return;
  }

  const count = receipts.length;
  for (const gap of ordered) {
    const at = Math.max(0, Math.min(gap.atCount, count));
    if (at >= count) {
      list.insertBefore(gapMarker(gap, false), list.firstChild);
      continue;
    }
    // Walk the rendered rows newest-first, counting real receipt rows only:
    // timeline.js may have interleaved its own chain-break separators.
    let index = count - 1;
    let anchor = null;
    for (const child of [...list.children]) {
      if (!child.classList.contains('zt-row')) continue;
      if (index === at - 1) {
        anchor = child;
        break;
      }
      index -= 1;
    }
    if (anchor) list.insertBefore(gapMarker(gap, false), anchor);
    else list.appendChild(gapMarker(gap, false));
  }
}

/* ---- one receipt, opened out of the compact list --------------------------
   The list gives four things per line — outcome, summary, time, short hash —
   and that is all a dashboard should show. Everything else the ledger recorded
   is here, on demand, and every line of it is a field the receipt actually
   carries: the keys are read off the record itself, so nothing can be shown
   that was not written, and nothing written can be quietly left out. */

/** selfHash of the receipt whose record is open, or null. */
let openReceipt = null;

const RECEIPT_ORDER = [
  'id', 'at', 'outcome', 'reason', 'tier', 'kind', 'targetRef', 'summary',
  'actionHash', 'casBaseObserved', 'externalEffect', 'policyHash',
  'prevReceipt', 'selfHash', 'signature', 'schemaVersion',
];

function receiptValue(value) {
  if (value === null) return ['not recorded on this receipt', true];
  if (value === undefined) return ['absent from this receipt', true];
  if (typeof value === 'object') {
    try { return [JSON.stringify(value), false]; } catch { return ['unreadable value', true]; }
  }
  return [String(value), false];
}

function receiptDetail(receipt) {
  const li = el('li', 'rdetail');
  li.appendChild(el('h3', null, 'The receipt, exactly as the ledger holds it'));
  li.appendChild(
    el(
      'p',
      'rsub',
      'Every field below was read off this receipt. Nothing is computed here, nothing is filled in, ' +
        'and the seal on a row is drawn from the outcome this record carries — never from a click.',
    ),
  );

  const dl = el('dl', 'rkv');
  const keys = [
    ...RECEIPT_ORDER.filter((k) => Object.prototype.hasOwnProperty.call(receipt, k)),
    ...Object.keys(receipt).filter((k) => !RECEIPT_ORDER.includes(k)),
  ];
  for (const key of keys) {
    const [text, absent] = receiptValue(receipt[key]);
    dl.appendChild(el('dt', null, key));
    const dd = el('dd', absent ? 'absent' : null, text);
    dl.appendChild(dd);
  }
  li.appendChild(dl);

  const close = el('button', 'rclose', 'Close this receipt');
  close.type = 'button';
  close.addEventListener('click', () => {
    openReceipt = null;
    paintTimeline();
  });
  li.appendChild(close);
  return li;
}

/**
 * Give every rendered row a way into its own receipt.
 *
 * timeline.js says in its own stylesheet that a row is not a control and must
 * not behave like one. It still is not: the control is this button INSIDE the
 * row. Rows are walked newest-first because that is the order renderTimeline
 * draws them in, and only `.zt-row` elements are counted — the gap markers and
 * the chain-break separators sitting between them are not receipts.
 */
function addReceiptControls(section) {
  const list = section.querySelector('.zt-list');
  if (!list) return;
  let index = receipts.length - 1;
  for (const child of [...list.children]) {
    if (!child.classList.contains('zt-row')) continue;
    const receipt = receipts[index];
    index -= 1;
    if (!receipt) continue;

    const main = child.querySelector('.zt-main');
    if (!main) continue;
    const isOpen = typeof receipt.selfHash === 'string' && receipt.selfHash === openReceipt;
    const btn = el('button', 'zt-open', isOpen ? 'close the receipt' : 'receipt ›');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      (isOpen ? 'Close' : 'Open') + ' the full receipt for: ' +
        (typeof receipt.summary === 'string' && receipt.summary ? receipt.summary : 'this outcome'),
    );
    btn.addEventListener('click', () => {
      openReceipt = isOpen ? null : (typeof receipt.selfHash === 'string' ? receipt.selfHash : null);
      paintTimeline();
    });
    main.appendChild(btn);
    if (isOpen) list.insertBefore(receiptDetail(receipt), child.nextSibling);
  }
}

function paintTimeline() {
  if (!mount.timeline) return;
  const old = mount.timeline.querySelector('.zt-list');
  const scrollTop = old ? old.scrollTop : 0;
  const hadFocus = old !== null && document.activeElement === old;

  const section = renderTimeline(receipts, chain, {
    badgeMount: mount.chain,
    unverified: Math.max(0, receipts.length - chainAtCount),
    heading: 'Recently settled',
    sub: 'Every terminal outcome the ledger holds, newest first. Open one to read the receipt as written.',
  });
  insertGapMarkers(section);
  addReceiptControls(section);
  mount.timeline.replaceChildren(section);

  const fresh = mount.timeline.querySelector('.zt-list');
  if (fresh) {
    fresh.scrollTop = scrollTop;
    if (hadFocus) fresh.focus();
  }
}

function addReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  const known = receipts.some((r) =>
    r.selfHash && receipt.selfHash ? r.selfHash === receipt.selfHash : r.id === receipt.id,
  );
  if (known) return false;
  receipts = receipts.concat([receipt]); // ledger order: newest last
  return true;
}

/* ================================================================== *
 * 6b · the summary strip                                              *
 *                                                                     *
 * Six tiles, and between them the five-second answer: what needs me,  *
 * what happened, what is next.                                        *
 *                                                                     *
 * THE ONE RULE. A tile shows a FIGURE only when this window counted   *
 * one. Two of them are counted from /state, which this file already   *
 * holds; the other four come from four separate reads, each settled   *
 * on its own so a vault that is switched off cannot blank the sandbox.*
 * A source that has not answered, that answered 404, or that failed,  *
 * puts words in the tile — "not read", "not reported" — and never a   *
 * 0, because 0 is a count and silence is not. Where a source answers  *
 * but says its own answer is incomplete (an unreadable meetings        *
 * folder, a work source that failed, a /memory page that is capped),   *
 * the tile says so rather than presenting the part as the whole.      *
 * ================================================================== */

const aux = {
  work: { state: 'unread', data: null, detail: null },
  forge: { state: 'unread', data: null, detail: null },
  meetings: { state: 'unread', data: null, detail: null },
  memory: { state: 'unread', data: null, detail: null },
};

/** One auxiliary read, settled rather than thrown: 'ok' | 'absent' | 'error'. */
async function readAuxOne(path) {
  let res;
  try {
    res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  } catch {
    return { state: 'error', data: null, detail: `The daemon did not answer ${path}.` };
  }
  const body = await res.json().catch(() => null);
  if (res.ok) return { state: 'ok', data: body || {}, detail: null };
  const e = (body && body.error) || {};
  // 404 here is a feature that is switched off, not a failure — the daemon says
  // so in words, and those words are what the tile shows.
  return {
    state: res.status === 404 ? 'absent' : 'error',
    data: null,
    detail: e.message || `${path} answered ${res.status}.`,
  };
}

async function readAux() {
  const [work, forge, meetings, memory] = await Promise.all([
    readAuxOne('/work'),
    readAuxOne('/forge/status'),
    readAuxOne('/counsel/meetings'),
    readAuxOne('/memory'),
  ]);
  aux.work = work;
  aux.forge = forge;
  aux.meetings = meetings;
  aux.memory = memory;
  paintSummary();
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** The page size GET /memory serves. A full page means "at least this many". */
const MEMORY_PAGE = 50;


/** What a tile says when its source never spoke, or refused, or broke. */
function silentTile(label, src, what, extra) {
  if (src.state === 'unread') {
    return { label, na: 'not read', note: `${what} has not been read into this window yet.`, ...extra };
  }
  if (src.state === 'absent') {
    return { label, na: 'not reported', note: src.detail || `${what} is not enabled on this daemon.`, ...extra };
  }
  return {
    label,
    na: 'not reported',
    tone: 'rd',
    note: `${src.detail || `${what} could not be read.`} Treat this as unknown, not as zero.`,
    ...extra,
  };
}

function summarySpecs() {
  const all = [...capsules.values()];
  const awaiting = all.filter((c) => !c.settled);
  const needs = awaiting.filter((c) => !c.preview.denied && !c.preview.auto).length;
  const refused = awaiting.filter((c) => c.preview.denied).length;
  const auto = awaiting.filter((c) => !c.preview.denied && c.preview.auto).length;

  /* 1 · needs you — the only number on this page that is allowed to be loud. */
  const t1 = stateEverRead
    ? {
        label: 'needs you',
        figure: needs,
        tone: needs ? 'am' : '',
        note: needs
          ? 'Nothing moves until you approve it.'
          : refused || auto
            ? 'Nothing is waiting on your yes.'
            : 'Nothing is waiting on you.',
        jump: '#pending',
      }
    : {
        label: 'needs you',
        na: 'not read',
        note: "The daemon's state has not been read into this window yet.",
        jump: '#pending',
      };
  if (stateEverRead && (refused || auto)) {
    const bits = [];
    if (refused) bits.push(`${refused} refused by policy`);
    if (auto) bits.push(`${auto} below the approval line`);
    t1.note = (needs ? 'Nothing moves until you approve it. ' : '') + bits.join(' · ') + '.';
  }

  /* 2 · verified today — receipts, and only receipts. */
  const now = new Date();
  const sameDay = (iso) => {
    const d = new Date(iso);
    return (
      Number.isFinite(d.getTime()) &&
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };
  const verifiedToday = receipts.filter((r) => r && r.outcome === 'verified' && sameDay(r.at)).length;
  const t2 = stateEverRead
    ? {
        label: 'verified today',
        figure: verifiedToday,
        tone: verifiedToday ? 'gr' : '',
        note:
          `${receipts.length} ${plural(receipts.length, 'receipt', 'receipts')} in the ledger` +
          (chain && chain.ok === false ? ' · the chain does not verify' : ''),
        jump: '#timeline',
      }
    : { label: 'verified today', na: 'not read', note: 'The receipt ledger has not been read yet.', jump: '#timeline' };

  /* 3 · the sandbox. "repo: false" is an answer, and it is not zero changes. */
  let t3;
  if (aux.forge.state === 'ok') {
    const f = aux.forge.data || {};
    if (f.repo === true) {
      const changed = Array.isArray(f.changed) ? f.changed.length : null;
      const branch = typeof f.branch === 'string' && f.branch ? f.branch : 'an unnamed branch';
      t3 = changed === null
        ? { label: 'in the sandbox', na: 'not reported', note: 'The sandbox answered without a file list.', jump: '#sec-workstation' }
        : {
            label: 'in the sandbox',
            figure: changed,
            tone: changed ? 'cy' : '',
            note: changed
              ? `uncommitted on ${branch} · a commit is its own approval`
              : `${branch} is clean`,
            jump: '#sec-workstation',
          };
    } else {
      t3 = {
        label: 'in the sandbox',
        na: 'no repository',
        note: typeof f.note === 'string' && f.note ? f.note : 'The sandbox is not a git repository.',
        jump: '#sec-workstation',
      };
    }
  } else {
    t3 = silentTile('in the sandbox', aux.forge, 'The sandbox', { jump: '#sec-workstation' });
  }

  /* 4 · the backlog — and how much of it is missing. */
  let t4;
  if (aux.work.state === 'ok') {
    const w = aux.work.data || {};
    const items = Array.isArray(w.items) ? w.items.length : null;
    const sources = Array.isArray(w.sources) ? w.sources : [];
    const shaky = sources.filter((s) => s.state === 'failed' || s.state === 'partial').length;
    const asked = sources.filter((s) => s.state !== 'not-configured').length;
    t4 = items === null
      ? { label: 'in the backlog', na: 'not reported', note: '/work answered without an item list.', jump: '#desk' }
      : {
          label: 'in the backlog',
          figure: items,
          tone: shaky ? 'am' : '',
          note: shaky
            ? `${shaky} of ${asked} ${plural(asked, 'source', 'sources')} did not answer in full — this list is short by an unknown amount.`
            : sources.length
              // "1 of 2 read in full" read as though one had failed. A source
              // that is not configured was never asked, and that is a different
              // fact from one that was asked and did not answer.
              ? `${asked} ${plural(asked, 'source', 'sources')} read in full` +
                (sources.length - asked ? ` · ${sources.length - asked} not configured` : '')
              : 'no work source is configured',
          jump: '#desk',
        };
  } else {
    t4 = silentTile('in the backlog', aux.work, 'The backlog', { jump: '#desk' });
  }

  /* 5 · meetings. An unreadable folder makes the count meaningless, and the
         daemon says which of the two it is, so this never guesses. */
  let t5;
  if (aux.meetings.state === 'ok') {
    const m = aux.meetings.data || {};
    const archive = m.archive && typeof m.archive === 'object' ? m.archive : null;
    const list = Array.isArray(m.meetings) ? m.meetings.length : null;
    const failed = Array.isArray(m.failed) ? m.failed.length : 0;
    if (archive && archive.readable === false) {
      t5 = {
        label: 'meetings',
        na: 'not reported',
        tone: 'rd',
        note: (archive.reason || 'The meetings folder could not be read.') + ' Any count would be a guess.',
        surface: 'counsel',
      };
    } else if (list === null) {
      t5 = { label: 'meetings', na: 'not reported', note: 'The archive answered without a list.', surface: 'counsel' };
    } else {
      t5 = {
        label: 'meetings',
        figure: list,
        tone: failed ? 'am' : '',
        note: failed
          ? `${failed} ${plural(failed, 'file', 'files')} in the folder could not be read`
          : list
            ? 'in the archive on this machine'
            : 'nothing has been recorded on this machine',
        surface: 'counsel',
      };
    }
  } else {
    t5 = silentTile('meetings', aux.meetings, 'The meeting archive', { surface: 'counsel' });
  }

  /* 6 · memories. /memory serves at most the newest 50, so a full page is
         reported as a floor and never as a total. */
  let t6;
  if (aux.memory.state === 'ok') {
    const notes = Array.isArray((aux.memory.data || {}).notes) ? aux.memory.data.notes : null;
    if (notes === null) {
      t6 = { label: 'memories', na: 'not reported', note: '/memory answered without a note list.', jump: '#sec-vault' };
    } else if (notes.length >= MEMORY_PAGE) {
      t6 = {
        label: 'memories',
        na: `${MEMORY_PAGE} or more`,
        note: `/memory serves the newest ${MEMORY_PAGE}; the vault may hold more than this window can count.`,
        jump: '#sec-vault',
      };
    } else {
      t6 = {
        label: 'memories',
        figure: notes.length,
        note: notes.length ? 'in the vault on this machine' : 'nothing has been remembered yet',
        jump: '#sec-vault',
      };
    }
  } else {
    t6 = silentTile('memories', aux.memory, 'The vault', { jump: '#sec-vault' });
  }

  return [t1, t2, t3, t4, t5, t6];
}

function tileNode(spec) {
  const interactive = !!(spec.jump || spec.surface);
  const node = el(interactive ? 'button' : 'div', 'tile');
  if (interactive) {
    node.type = 'button';
    // A `jump` is a section on this page and is handled here; a `surface` is
    // another product, and nav.js owns those moves — this only names it.
    if (spec.jump) node.dataset.goto = spec.jump;
    else node.dataset.go = spec.surface;
  }
  if (spec.tone) node.dataset.tone = spec.tone;

  const value = spec.figure === undefined || spec.figure === null ? spec.na : String(spec.figure);
  node.appendChild(el('span', 'tk', spec.label));
  node.appendChild(el('span', spec.figure === undefined || spec.figure === null ? 'tv na' : 'tv', value));
  node.appendChild(el('span', 'tn', spec.note));

  if (interactive) {
    const where = spec.jump ? 'Opens the section below.' : 'Opens Zeno Counsel.';
    node.setAttribute('aria-label', `${spec.label}: ${value}. ${spec.note} ${where}`);
  }
  return node;
}

/**
 * Rebuilt only when something it says has actually changed.
 *
 * paintSummary() is called on every snapshot, every preview and every receipt.
 * Replacing six buttons each time would drop the keyboard out of the strip
 * mid-Tab, so the specs are compared first and an identical strip is left
 * exactly where it is. This is a re-render guard and nothing else: it caches
 * what was DRAWN, never a value, and every number is recomputed on every call.
 */
let lastSummaryKey = null;

function paintSummary() {
  if (!mount.summary) return;
  const specs = summarySpecs();
  let key;
  try { key = JSON.stringify(specs); } catch { key = null; }
  if (key !== null && key === lastSummaryKey) return;
  lastSummaryKey = key;
  mount.summary.replaceChildren(...specs.map(tileNode));
}

/**
 * Masked mode changes what may be SHOWN, not what is true.
 *
 * The top bar's ◐ masked toggles `data-lock` on the root. Nothing is re-read
 * and nothing is re-counted when it flips: the rows repaint from the state
 * already in hand, redacting the sentences and keeping the tiers,
 * the statuses and every count — because hiding that something is waiting on
 * you is the one dishonesty masking must never commit.
 */
function installMaskWatch() {
  try {
    new MutationObserver(() => {
      layoutPending();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-lock'] });
  } catch {
    /* No MutationObserver: the list simply does not repaint when masking flips. */
  }
}

/** The tiles' one behaviour: move to the detail this number came from. */
function installSummaryJumps() {
  if (!mount.summary) return;
  mount.summary.addEventListener('click', (ev) => {
    const t = ev.target instanceof Element ? ev.target.closest('[data-goto]') : null;
    if (!t) return;
    const dest = document.querySelector(t.dataset.goto);
    if (!dest) return;
    dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Real keyboard focus, not just the viewport: a jump that leaves the next
    // Tab at the top of the document is not a jump.
    if (dest.hasAttribute('tabindex') && dest.focus) dest.focus({ preventScroll: true });
  });
}

/* ================================================================== *
 * 7 · GET /state — the authority the stream is only a view of         *
 * ================================================================== */

async function readState() {
  const res = await fetch('/state', { headers: authHeaders(), cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body && body.error) || {};
    const err = new Error(e.message || `The daemon answered ${res.status} for /state.`);
    err.resolve = e.resolve || null;
    err.status = res.status;
    throw err;
  }
  return body || {};
}

/**
 * Apply a snapshot. The snapshot is authoritative for receipts, chain and what
 * the daemon is still holding; it is reconciled against what is on screen
 * rather than bulldozing it, so a capsule the owner is mid-way through reading
 * is not silently replaced by an identical one.
 */
function applyState(state) {
  receipts = Array.isArray(state.receipts) ? state.receipts.slice() : [];
  chain = state.chain ?? null;
  // One snapshot: the ChainStatus in it was computed over exactly these receipts.
  chainAtCount = receipts.length;
  refreshPolicyFromReceipts(state.policyHash);

  // A snapshot's lastEventId is the server's sequence at snapshot time. Take
  // the higher of it and what the stream has already delivered — the snapshot
  // already contains the effect of everything up to that id, so resuming from
  // it can never skip something this page has not accounted for.
  if (Number.isFinite(state.lastEventId)) {
    stream.lastEventId =
      stream.lastEventId === null ? state.lastEventId : Math.max(stream.lastEventId, state.lastEventId);
  }

  const held = new Set();
  for (const preview of Array.isArray(state.pending) ? state.pending : []) {
    if (preview && typeof preview.actionHash === 'string') {
      held.add(preview.actionHash);
      addPreview(preview);
    }
  }

  // Anything on screen that the daemon is no longer holding: settle it from a
  // receipt if one exists (it may have been approved from another window or
  // the CLI), and otherwise say plainly that it is gone rather than leaving a
  // dead Approve button that would 404.
  const orphaned = [];
  for (const [hash, entry] of capsules) {
    if (held.has(hash) || entry.settled) continue;
    const receipt = [...receipts].reverse().find((r) => r.actionHash === hash);
    if (receipt) {
      settleCapsule(receipt);
    } else {
      entry.node.destroy?.();
      capsules.delete(hash);
      orphaned.push(hash);
    }
  }
  if (orphaned.length > 0) {
    setNotice(
      'orphaned',
      `${orphaned.length} previewed ${orphaned.length === 1 ? 'action is' : 'actions are'} no longer held by the daemon and ` +
        'left this list without a receipt — a restart drops what was awaiting approval. Nothing was applied; ask the agent to propose again.',
    );
  }

  // Only here. Every tile that shows a figure instead of "not read" is standing
  // on this line: a snapshot from the daemon actually arrived and was applied.
  stateEverRead = true;

  layoutPending();
  paintTimeline();
  paintSummary();
  signalState();
}

/* ================================================================== *
 * 8 · the stream                                                      *
 *                                                                     *
 * An authenticated SSE reader. It keeps the parts of the EventSource  *
 * contract that carry the honesty: `id:` tracking, `retry:`, a        *
 * Last-Event-ID on every connect (including the first), and a         *
 * reconnect that either resumes exactly or declares a gap.            *
 * ================================================================== */

const stream = {
  lastEventId: null,
  retryMs: 2000,
  attempt: 0,
  everOpen: false,
  stopped: false,
  abort: null,
  waitTimer: null,
};

function paintStreamChip(kind, detail) {
  const map = {
    connecting: ['◌', 'stream connecting…', null],
    open: ['◉', 'stream listening', 'listening'],
    waiting: ['⚠', detail || 'stream down · retrying', 'warn'],
    failed: ['⚠', detail || 'stream unavailable', 'warn'],
  };
  const [glyph, label, state] = map[kind] || map.connecting;
  setChip(
    mount.stream,
    glyph,
    label,
    state,
    kind === 'open'
      ? `Connected to /stream. Resuming from event id ${stream.lastEventId ?? '(none yet)'}.`
      : 'Nothing on this page updates by itself while the stream is down. The ledger is still the authority; reload to re-read it.',
  );
}

function sleep(ms, signalHolder) {
  return new Promise((resolve) => {
    stream.waitTimer = setTimeout(() => {
      stream.waitTimer = null;
      resolve();
    }, ms);
    if (signalHolder) signalHolder.cancel = () => {
      if (stream.waitTimer !== null) {
        clearTimeout(stream.waitTimer);
        stream.waitTimer = null;
      }
      resolve();
    };
  });
}

/** One connection. Resolves 'dropped' (retry) or 'fatal' (stop, and say why). */
async function openStreamOnce() {
  paintStreamChip('connecting');
  const controller = new AbortController();
  stream.abort = controller;

  const headers = authHeaders({ accept: 'text/event-stream' });
  // The line EventSource cannot write: resume exactly where this page stopped
  // being sure — on the first connect too, seeded from the /state snapshot.
  if (stream.lastEventId !== null) headers['last-event-id'] = String(stream.lastEventId);
  const resumingBlind = stream.lastEventId === null;
  const seenAtConnect = stream.lastEventId; // captured before any live id overwrites it

  let res;
  try {
    res = await fetch('/stream', { headers, signal: controller.signal, cache: 'no-store' });
  } catch {
    // Abort, refused connection, daemon gone: all of them are "dropped".
    return stream.stopped ? 'fatal' : 'dropped';
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const e = (body && body.error) || {};
    if (res.status === 401 || res.status === 403) {
      setNotice(
        'stream',
        `The live stream refused this window (${res.status} ${e.code || ''}). ${
          e.message || 'It needs the owner token, which this page does not have.'
        } ${e.resolve || 'Open the window from the URL the daemon printed on startup.'} Nothing on this page updates on its own.`,
      );
      paintStreamChip('failed', 'stream refused · not authenticated');
      return 'fatal';
    }
    return 'dropped';
  }

  if (!res.body) {
    setNotice(
      'stream',
      'This browser will not hand this page the stream as it arrives, so live updates are impossible here. ' +
        'What is on screen is the snapshot taken at load and nothing after it. Reload to re-read the ledger.',
    );
    paintStreamChip('failed', 'stream unreadable in this browser');
    return 'fatal';
  }

  // Open. If this page had to attach without a Last-Event-ID and it has been
  // connected before, it cannot know what it missed — and the daemon cannot
  // tell it, because it was never told where the page had got to. That is a
  // gap; it is declared like any other rather than assumed to be empty.
  stream.attempt = 0;
  const reconnected = stream.everOpen;
  stream.everOpen = true;
  paintStreamChip('open');
  clearNotice('stream');
  if (reconnected && resumingBlind) {
    declareGap({
      message:
        'This page reconnected without a last-event id, so the daemon could not replay what it missed and could not name the range.',
      resolve: 'Reload to re-read the full state from the ledger.',
    });
  } else if (reconnected) {
    // A reconnect that the daemon answered without a `gap` event means it
    // replayed the whole hole — but only if it is still the SAME daemon. The
    // commonest reason a loopback stream drops is that the process restarted,
    // and a restart mints a new Stream whose sequence begins again at zero. To
    // that daemon `last-event-id: 7` reads as "already ahead of me", so it
    // replays nothing and reports no gap, and the page would resume looking
    // whole while holding previews the new process has never heard of. This
    // asks /state which sequence it is now on, and calls that what it is.
    void reconcileAfterReconnect(seenAtConnect);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingCR = false;

  const frame = { event: '', data: [] };
  const dispatch = () => {
    if (frame.data.length === 0) {
      frame.event = '';
      return;
    }
    const name = frame.event || 'message';
    const raw = frame.data.join('\n');
    frame.event = '';
    frame.data = [];
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // a malformed frame must never take the window down
    }
    handleEvent(name, data);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      if (pendingCR) {
        text = '\r' + text;
        pendingCR = false;
      }
      if (text.endsWith('\r')) {
        pendingCR = true;
        text = text.slice(0, -1);
      }
      buffer += text.replace(/\r\n?/g, '\n'); // SSE: CRLF, LF and CR all end a line

      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          dispatch();
          continue;
        }
        if (line.startsWith(':')) continue; // comment / keep-alive
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let val = colon === -1 ? '' : line.slice(colon + 1);
        if (val.startsWith(' ')) val = val.slice(1);
        if (field === 'event') frame.event = val;
        else if (field === 'data') frame.data.push(val);
        else if (field === 'id' && /^\d+$/.test(val)) stream.lastEventId = Number(val);
        else if (field === 'retry' && /^\d+$/.test(val)) stream.retryMs = Number(val);
      }
    }
  } catch {
    // A read error is a dropped connection, nothing more interesting.
  }
  return stream.stopped ? 'fatal' : 'dropped';
}

/** The reconnect loop. Linear on purpose: it is easier to prove it terminates. */
async function runStream() {
  for (;;) {
    if (stream.stopped) return;
    const outcome = await openStreamOnce();
    if (outcome === 'fatal' || stream.stopped) return;

    stream.attempt += 1;
    const wait = Math.min(stream.retryMs * stream.attempt, 15000);
    const droppedAt = new Date();
    const holder = {};
    let remaining = Math.round(wait / 1000);

    const say = () => {
      paintStreamChip('waiting', `stream down · retry in ${remaining}s`);
      setNotice(
        'stream',
        `The live stream dropped at ${clock(droppedAt)} (attempt ${stream.attempt}). Retrying in ${remaining}s. ` +
          'Nothing on this page is live until it is back, and the daemon will be asked to replay everything missed since event ' +
          `${stream.lastEventId ?? '(unknown)'} — if it cannot, that gap is marked in the timeline.`,
        { label: 'Retry now', run: () => holder.cancel && holder.cancel() },
      );
    };
    say();
    const tick = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      say();
    }, 1000);
    await sleep(wait, holder);
    clearInterval(tick);
  }
}

/* ---- the four events the daemon publishes -------------------------------- */

function handleEvent(name, data) {
  // A single malformed frame must never take the transport down with it: the
  // read loop's own catch treats a thrown error as a dropped socket, which
  // would turn one bad event into a reconnect storm.
  try {
    if (name === 'preview') {
      addPreview(data);
      signalState();
      return;
    }
    if (name === 'receipt') {
      if (!data || typeof data !== 'object') return;
      const isNew = addReceipt(data);
      settleCapsule(data);
      if (isNew) refreshPolicyFromReceipts(policy.source === 'state' ? policy.hash : undefined);
      paintTimeline();
      signalState();
      return;
    }
    if (name === 'chain') {
      chain = data ?? null;
      // This verdict covers what this page holds right now, and nothing later.
      chainAtCount = receipts.length;
      paintTimeline(); // the chain decides which rows are unproven, so redraw them
      return;
    }
    if (name === 'gap') {
      declareGap(data && typeof data === 'object' ? data : {});
      return;
    }
    // Any other event name is something this build does not know about. It is
    // ignored rather than guessed at, and it is not counted as anything.
  } catch {
    /* the frame is dropped; the connection is not */
  }
}

/* ================================================================== *
 * 9 · R2 — a gap is declared, never stitched over                     *
 * ================================================================== */

function declareGap(info) {
  const gap = {
    seq: ++gapSeq,
    atCount: receipts.length, // where in history this page stopped being sure
    lastEventId: Number.isFinite(info.lastEventId) ? info.lastEventId : null,
    currentId: Number.isFinite(info.currentId) ? info.currentId : null,
    message: typeof info.message === 'string' ? info.message : null,
    resolve: typeof info.resolve === 'string' ? info.resolve : null,
    resync: null,
    at: new Date(),
  };
  gaps.push(gap);

  // The daemon has already moved past this page's position, so resume from the
  // id it reports rather than asking for a replay it has just said it cannot do.
  if (gap.currentId !== null) {
    stream.lastEventId = stream.lastEventId === null ? gap.currentId : Math.max(stream.lastEventId, gap.currentId);
  }

  setNotice(
    'gap',
    `${gap.message || 'Some events could not be replayed.'} A gap marker is drawn in the timeline at the point ` +
      'where this page lost the thread; it stays there for the life of this window. ' +
      (gap.resolve || 'Reload to re-read the full state from the ledger.'),
    { label: 'Re-read state', run: () => void resyncAfterGap(gap) },
  );
  announce('The live stream missed events that cannot be replayed. A gap is marked in the timeline.');
  paintTimeline();
  void resyncAfterGap(gap);
}

/**
 * Re-read the ledger after a gap. This restores the DATA; it does not restore
 * the CLAIM. The marker stays, and it says which side of it was watched live
 * and which side was recovered afterwards — because "the page looks complete"
 * and "the page saw it happen" are different statements and only one of them
 * is true here.
 */
async function resyncAfterGap(gap) {
  gap.resync = null;
  paintTimeline();
  try {
    const state = await readState();
    applyState(state);
    gap.resync = { ok: true, at: new Date(), reason: null };
  } catch (err) {
    gap.resync = { ok: false, at: new Date(), reason: err.message || 'unknown failure' };
  }
  paintTimeline();
}

/**
 * After a reconnect the daemon answered without a `gap`, ask it which event
 * sequence it is on. A number LOWER than the id this page attached with is not
 * a replay and not a resume: it is a different Stream, i.e. a restarted daemon.
 * Everything it was holding for approval died with the old process, and what
 * this window missed is gone — so it is declared, not smoothed over.
 */
async function reconcileAfterReconnect(seenAtConnect) {
  let state;
  try {
    state = await readState();
    clearNotice('state');
  } catch (err) {
    setNotice(
      'state',
      `The stream is back but the daemon would not hand over its state: ${err.message} ${err.resolve || ''}`.trim() +
        ' Until it does, what is on screen is only as current as the last thing the stream delivered.',
      { label: 'Try again', run: () => void retryState() },
    );
    return;
  }

  const now = Number.isFinite(state.lastEventId) ? state.lastEventId : null;
  if (now !== null && seenAtConnect !== null && now < seenAtConnect) {
    stream.lastEventId = now; // adopt the new sequence exactly, not the max
    declareGap({
      message:
        `The daemon’s event sequence restarted: it is now at id ${now}, and this page attached expecting id ${seenAtConnect}. ` +
        'The daemon was restarted, so nothing this window missed can be replayed, and anything that was awaiting approval ' +
        'was dropped with the old process. Nothing was applied by the restart.',
      resolve: 'Ask the agent to propose again. The ledger below is re-read from disk and is unaffected.',
    });
    return; // declareGap re-reads the state itself
  }
  applyState(state);
}

/* ================================================================== *
 * 10 · the owner-token guard                                          *
 *                                                                     *
 * The shell's own instruction: an empty token means this browser must *
 * be treated as unable to approve, and must say so — not post an      *
 * empty token. The capsule's Approve control is single-use and latches *
 * spent on the first click, so letting it fire a request that can only *
 * be answered 401 would burn the control for nothing. The click is    *
 * intercepted in the CAPTURE phase, before the capsule's own handler  *
 * runs, so the control is never spent and never lies.                 *
 * ================================================================== */

function installOwnerGuard() {
  if (!mount.pending || OWNER_TOKEN) return;
  mount.pending.addEventListener(
    'click',
    (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest('.zn-approve') : null;
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation(); // capture phase: capsule.js never sees this click
      target.setAttribute('aria-disabled', 'true');
      target.title = 'This window has no owner token, so it cannot approve.';
      setNotice(
        'no-token',
        'This window was not given the owner token, so it can read but never approve — and the click was stopped ' +
          'before it could spend the single-use control on a request the daemon would reject. Open the window from ' +
          'the URL the daemon printed on startup.',
      );
      announce('This window cannot approve: no owner token.');
    },
    true,
  );
}

/* ================================================================== *
 * 11 · re-preview requests from a capsule                             *
 *                                                                     *
 * capsule.js emits `zeno:re-preview` when a commit was refused on     *
 * drift. This window does not honour it by re-proposing, and the      *
 * reason is a choice, not a missing field: the daemon does send the   *
 * payload with every preview, so `relPath` and `contents` for POST    *
 * /previews are in fact on this page. Re-proposing from them would    *
 * mean this window authoring an action and then approving it — the    *
 * two roles the daemon's own token split exists to keep apart. The    *
 * fresh preview has to come from the proposer. Saying that is the job. *
 * ================================================================== */

function installRePreviewListener() {
  if (!mount.pending) return;
  mount.pending.addEventListener('zeno:re-preview', (ev) => {
    const hash = ev.detail && ev.detail.actionHash ? short(ev.detail.actionHash) : 'that action';
    setNotice(
      're-preview',
      `A re-preview has to come from the agent that proposed ${hash}. This window will not re-propose it: ` +
        'authoring an action and approving it are the two roles the daemon keeps in separate tokens, and doing ' +
        'both here would collapse them. Ask the agent to propose again; the fresh preview arrives here as a new ' +
        'action hash, and this one stays refused.',
    );
    announce('A re-preview must come from the proposing agent.');
  });
}

/* ================================================================== *
 * 11b · a receipt that arrived on the POST, not on the stream         *
 *                                                                     *
 * POST /approvals answers with {approval, receipt}, and capsule.js    *
 * renders that receipt itself — correctly, because it is the receipt  *
 * for the click that produced it. But until now this file never heard *
 * about it: the capsule stayed in the AWAITING group, above a divider *
 * that reads "Settled. These carry a receipt", while displaying a     *
 * verified seal. "Pending approvals" would be claiming a decision was *
 * still owed on an action a receipt had already closed — and if the   *
 * stream were down, it would claim it forever.                        *
 *                                                                     *
 * So the capsule announces the receipt and this file files it: the    *
 * capsule moves below the divider and the receipt takes its place in  *
 * the ledger view. Nothing here draws a seal, and nothing here invents *
 * a receipt — it only records one the daemon already sent.            *
 * ================================================================== */

function installReceiptListener() {
  if (!mount.pending) return;
  mount.pending.addEventListener('zeno:receipt', (ev) => {
    const receipt = ev.detail && ev.detail.receipt;
    if (!receipt || typeof receipt !== 'object' || typeof receipt.actionHash !== 'string') return;

    // Marked settled directly rather than through settleCapsule(): the capsule
    // has already rendered this exact receipt, and calling applyReceipt again
    // from inside its own dispatch would re-enter it mid-render.
    const entry = capsules.get(receipt.actionHash);
    if (entry && !entry.settled) {
      entry.settled = true;
      entry.settledSeq = ++capsuleSeq;
      entry.receipt = receipt;
      layoutPending();
      announce(
        `Receipt ${receipt.outcome} for: ${receipt.summary || entry.preview?.summary || 'an approved action'}.`,
      );
    }

    // addReceipt dedupes on selfHash, so the `receipt` event for the same commit
    // arriving on the stream a moment later is not counted twice.
    if (addReceipt(receipt)) {
      refreshPolicyFromReceipts(policy.source === 'state' ? policy.hash : undefined);
      paintTimeline();
      paintSummary();
    }
  });
}

/* ================================================================== *
 * 12 · boot                                                           *
 * ================================================================== */

async function boot() {
  ensureStyles();
  document.body.appendChild(announcer);
  paintOwnerChip();
  paintPolicyChip();
  installOwnerGuard();
  installRePreviewListener();
  installReceiptListener();
  installSummaryJumps();
  installMaskWatch();
  paintSummary();

  // The four auxiliary reads. They are started here and never awaited: the
  // approval queue must not wait on a meetings folder, and a vault that is
  // switched off must not delay the one read this window cannot do without.
  void readAux();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void readAux();
  }, 30000);

  if (!OWNER_TOKEN) {
    setNotice(
      'no-token',
      'This page was served without an owner token. It cannot approve anything — and the same token authenticates ' +
        'reading, so the daemon will not hand it the ledger either. Open the window from the URL the daemon printed ' +
        'on startup; that copy is served with the token in it.',
    );
  }

  // Read the state first, so the stream attaches with a Last-Event-ID and the
  // window between the snapshot and the stream is closed rather than assumed
  // to be empty.
  try {
    applyState(await readState());
    clearNotice('state');
  } catch (err) {
    setNotice(
      'state',
      `The daemon would not hand over its state: ${err.message} ${err.resolve || ''}`.trim() +
        ' Nothing below is loaded — treat this window as unknown, not as empty.',
      { label: 'Try again', run: () => void retryState() },
    );
    // Deliberately NOT painting the timeline here. Rendering it with zero
    // receipts would print "No receipts yet — nothing has been committed on
    // this machine", which is a claim about the ledger this page just failed to
    // read. The shell's own static block already says the true thing: the
    // ledger has not been read into this page.
  }

  void runStream();
}

async function retryState() {
  try {
    applyState(await readState());
    clearNotice('state');
  } catch (err) {
    setNotice(
      'state',
      `The daemon still would not hand over its state: ${err.message} ${err.resolve || ''}`.trim(),
      { label: 'Try again', run: () => void retryState() },
    );
  }
}

window.addEventListener('beforeunload', () => {
  stream.stopped = true;
  if (stream.abort) stream.abort.abort();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
} else {
  void boot();
}
