/**
 * Zeno Command · receipt timeline + chain-integrity badge.
 *
 * The audit trail, legible without a terminal. Everything on this screen is read
 * straight out of the receipt ledger — there is no second data source, and no
 * field is inferred. A row exists because a receipt exists; a row says
 * "verified" because that receipt says `outcome: "verified"`.
 *
 * Four rules this file is built to satisfy, each of them testable:
 *
 *   1. Green means a verified receipt EXISTS. It is never optimism, and it is
 *      never rendered before the receipt arrives — this module only ever draws
 *      from receipts that are already in hand.
 *   2. Status is never colour alone. Every outcome carries a glyph, a word and a
 *      fill delta, so the screen survives greyscale, a projector and colour
 *      blindness.
 *   3. No glass. This is long text in a scrolling table: the plane is opaque
 *      graphite. Glass belongs on nav-adjacent chrome and overlays, never here.
 *   4. Nothing animates, and no row pretends to be a control. There is no state
 *      in a history that a motion would describe, so there is no motion, no
 *      transition and no hover — which is also the only honest way to satisfy
 *      `prefers-reduced-motion`: by having nothing to reduce.
 *
 * No framework, no bundler, no CDN. Plain ES module, loaded with type="module".
 *
 * Exports:
 *   renderTimeline(receipts, chain, options?) -> HTMLElement   (also default)
 *   renderChainBadge(chain, receiptCount)     -> HTMLElement
 *
 * Types (packages/kernel/src/types.ts, packages/kernel/src/ledger.ts):
 *   Receipt     { id, actionHash, outcome, reason, casBaseObserved,
 *                 externalEffect:{effect}, prevReceipt, selfHash, at,
 *                 schemaVersion, kind, tier, targetRef, summary, policyHash }
 *   ChainStatus { ok, firstBreakAt?, reason? }
 */

const STYLE_ID = 'zeno-timeline-styles';

/**
 * The five terminal outcomes the kernel can write, and how each one is told.
 *
 * `tone` maps onto the four-channel colour law and nothing else:
 *   green  — a verified receipt exists. Only `verified` may ever hold it.
 *   red    — blocked. A guard refused it, or policy prohibited it outright.
 *   amber  — warning. `outcome-unknown` is the one honest warning in the set:
 *            an external effect may or may not exist and we will not pretend.
 *   neutral— no colour channel applies. An expired approval is not an error and
 *            not a warning; nothing was applied and nothing is owed.
 *
 * Gold is absent by design: gold is owner origin, never a status.
 */
const OUTCOMES = {
  verified: {
    glyph: '✓', // check
    label: 'verified',
    tone: 'green',
    note: 'A receipt proves this happened.',
  },
  refused: {
    glyph: '⊘', // circle with slash
    label: 'refused',
    tone: 'red',
    note: 'A guard stopped the commit. Nothing was applied.',
  },
  denied: {
    glyph: '✕', // cross
    label: 'denied',
    tone: 'red',
    note: 'Prohibited by policy. It was never attempted.',
  },
  expired: {
    glyph: '◷', // quarter-filled circle, reads as a clock face
    label: 'expired',
    tone: 'neutral',
    note: 'The approval lapsed before commit. Nothing was applied.',
  },
  'outcome-unknown': {
    glyph: '⚠', // warning triangle
    label: 'outcome unknown',
    tone: 'amber',
    note: 'The external effect may or may not exist. Confirm with the provider before acting.',
  },
};

/** An outcome the kernel has not taught this page about yet. Never guessed at. */
function outcomeOf(value) {
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(OUTCOMES, value)) {
    return OUTCOMES[value];
  }
  return {
    glyph: '?',
    label: typeof value === 'string' && value ? value : 'unrecorded',
    tone: 'neutral',
    note: 'This page does not know this outcome. Read the ledger line itself.',
  };
}

/* ------------------------------------------------------------------ helpers */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML: a summary is agent-authored text, and it is
  // rendered as text on purpose.
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** First `n` characters of a hash, with an ellipsis. The full value is the title. */
function shortHash(value, n = 10) {
  if (typeof value !== 'string' || value.length === 0) return '—';
  return value.length <= n ? value : value.slice(0, n) + '…';
}

/* ---- summary grade, not provenance grade ---------------------------------
   A COLLAPSED row is a summary. The whole targetRef and the effect's content
   digest are provenance: they are what the receipt drawer exists to show, and
   the drawer already shows both in full (TARGETREF and EXTERNALEFFECT). Printing
   them on the closed row put a 64-character hash and an absolute path on a line
   meant to be read at a glance, and made "open one to read the receipt" false —
   the row had already said it.

   Neither helper drops a FACT, only a form of it: the tail still identifies the
   file, the scheme still separates a local write from something that left this
   machine, and the exact strings stay one hover (title) or one click (the
   drawer) away. */

/* The tail of a target ref. The leading ellipsis says plainly that this is a
   truncation and not the ref itself — a shortened path presented as whole is
   the kind of small lie this surface does not tell. */
function refTail(ref) {
  const s = String(ref);
  const parts = s.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return s;
  const sep = s.indexOf('\\') >= 0 ? '\\' : '/';
  return '…' + sep + parts.slice(-2).join(sep);
}

/* The effect's KIND, never its digest. "none" against "file" is the fact a
   summary row has to carry: it is the difference between a local write and
   something that reached the outside world. WHICH bytes is the receipt's job. */
function effectKind(effect) {
  if (effect === 'none') return 'no external effect';
  const s = String(effect);
  const i = s.indexOf(':');
  return 'effect ' + (i > 0 ? s.slice(0, i) : s);
}

function parseAt(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function timeOf(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function dateOf(d) {
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/* ------------------------------------------------------------- chain badge */

/**
 * The persistent chain-integrity badge.
 *
 * Three states, and it is important that there are three. `ok` and `broken` are
 * both answers; `unknown` is the absence of an answer, and it must never be
 * dressed as either. A page that has not heard from the daemon says so.
 *
 * Two sizes, one vocabulary. The default is a chip, safe to drop into a header
 * rail: on a break it is still red, still 2px, still says the word "broken" and
 * names the index, but it never grows and never shoves the page around. Pass
 * `{ band: true }` for the full-width form — that is what `renderTimeline` puts
 * above the history, and it is the one that carries the reason and the
 * instruction. The chip is the default deliberately: a caller who has not read
 * this file cannot accidentally break their own layout, and cannot accidentally
 * get a badge that says less than the truth.
 *
 * `options.unverified` is how many of `receiptCount` arrived AFTER the daemon
 * reported this ChainStatus. It exists because "chain verified" and "N receipts"
 * are two different facts with two different ages: a receipt that lands on the
 * stream a moment before the next `chain` event is real, but nothing has yet
 * proven it links to the one before it. Counting it inside a green "chain
 * verified — N receipts" would put the green channel on an unproven row, which
 * is the one thing green may never do. So it is subtracted and named instead.
 *
 * @param {{ok:boolean, firstBreakAt?:number, reason?:string}|null|undefined} chain
 * @param {number} receiptCount
 * @param {{band?:boolean, unverified?:number}} [options]
 * @returns {HTMLElement}
 */
export function renderChainBadge(chain, receiptCount, options) {
  ensureStyles();
  const compact = !(options && options.band);
  const count = Number.isFinite(receiptCount) ? receiptCount : 0;
  const rawUnverified = options && Number.isFinite(options.unverified) ? Math.floor(options.unverified) : 0;
  const unverified = Math.max(0, Math.min(rawUnverified, count));
  const box = el('div', 'zt-chain');
  if (compact) box.dataset.compact = '1';

  const body = el('div', 'zt-chain-body');
  // In compact form the badge is one line: glyph + label. The supporting
  // sentences move to the title, so the header chip never grows and never
  // duplicates the band that is already on screen below it.
  const detail = (text, cls) => {
    if (compact) {
      box.title = box.title ? box.title + ' ' + text : text;
      return;
    }
    body.appendChild(el('span', cls || 'zt-chain-detail', text));
  };

  // Unknown: no ChainStatus has arrived. Neutral, and explicitly incomplete.
  if (!chain || typeof chain.ok !== 'boolean') {
    box.dataset.state = 'unknown';
    box.appendChild(el('span', 'zt-chain-glyph', '—'));
    body.appendChild(el('strong', 'zt-chain-label', 'chain not reported'));
    detail('The daemon has not verified the ledger on this page yet.');
    box.appendChild(body);
    return box;
  }

  // An empty ledger is consistent, but consistency is not verification: there is
  // nothing here that a receipt has proven. Green would be a claim about work
  // that has not happened, so an empty ledger reads neutral and says so.
  if (chain.ok && count === 0) {
    box.dataset.state = 'empty';
    box.appendChild(el('span', 'zt-chain-glyph', '○'));
    body.appendChild(el('strong', 'zt-chain-label', 'no receipts to verify'));
    detail('The ledger is empty. Nothing has been committed yet.');
    box.appendChild(body);
    return box;
  }

  // Verified, but newer receipts have landed since. Neutral, not green: the
  // check the daemon ran did not cover them, and this badge will not lend them
  // its ✓ until a fresh ChainStatus does.
  if (chain.ok && unverified > 0) {
    const covered = count - unverified;
    box.dataset.state = 'partial';
    box.appendChild(el('span', 'zt-chain-glyph', '◑'));
    body.appendChild(
      el(
        'strong',
        'zt-chain-label',
        'chain verified — ' + covered + ' of ' + count + ' ' + plural(count, 'receipt', 'receipts'),
      ),
    );
    detail(
      unverified +
        ' ' +
        plural(unverified, 'receipt', 'receipts') +
        ' arrived after the daemon last verified the ledger, so ' +
        plural(unverified, 'it is', 'they are') +
        ' not covered by that check. ' +
        plural(unverified, 'It is', 'They are') +
        ' real — the daemon sent ' +
        plural(unverified, 'it', 'them') +
        ' — but nothing here proves the link back yet.',
    );
    box.appendChild(body);
    return box;
  }

  if (chain.ok) {
    box.dataset.state = 'ok';
    box.appendChild(el('span', 'zt-chain-glyph', '✓'));
    body.appendChild(
      el('strong', 'zt-chain-label', 'chain verified — ' + count + ' ' + plural(count, 'receipt', 'receipts')),
    );
    detail('Every link hashes to the one before it. Nothing has been removed.');
    box.appendChild(body);
    return box;
  }

  // Broken. This is the one thing on the page that is allowed to shout, and it
  // is not dismissible: an owner who misses this is auditing a fiction.
  const at = Number.isInteger(chain.firstBreakAt) ? chain.firstBreakAt : null;
  box.dataset.state = 'broken';
  // Only the full badge announces, so a screen reader hears the break once even
  // though it is drawn in two places.
  if (!compact) box.setAttribute('role', 'alert');
  box.appendChild(el('span', 'zt-chain-glyph', '✕'));
  body.appendChild(
    el('strong', 'zt-chain-label', at === null ? 'chain broken' : 'chain broken · #' + at),
  );

  detail(
    at === null
      ? 'The daemon reports a break but names no index.'
      : at >= count
        ? 'First break at receipt #' + at + ' — past the end of the file: receipts were removed from the tail.'
        : 'First break at receipt #' + at + '.',
  );

  const reason = typeof chain.reason === 'string' && chain.reason.trim() ? chain.reason.trim() : null;
  detail(reason ? 'Reason: ' + reason : 'The daemon gave no reason.', 'zt-chain-reason');
  detail(
    at === null
      ? 'Treat every row below as unproven until the ledger is checked against a known-good copy.'
      : 'Receipt #' + at + ' and everything after it is unproven. Check the ledger against a known-good copy before acting on it.',
  );
  box.appendChild(body);
  return box;
}

/* ----------------------------------------------------------------- one row */

function renderRow(receipt, index, unproven, today) {
  const meta = outcomeOf(receipt && receipt.outcome);
  const row = el('li', 'zt-row');
  row.dataset.tone = meta.tone;
  row.dataset.outcome = typeof receipt.outcome === 'string' ? receipt.outcome : 'unrecorded';
  if (unproven) row.dataset.unproven = '1';

  /* time — tabular, so a column of them lines up and a gap is visible */
  const when = el('div', 'zt-when mono');
  const d = parseAt(receipt.at);
  if (d) {
    when.appendChild(el('span', 'zt-time', timeOf(d)));
    if (!isSameDay(d, today)) when.appendChild(el('span', 'zt-date', dateOf(d)));
    when.title = String(receipt.at);
  } else {
    when.appendChild(el('span', 'zt-time', '—'));
  }
  row.appendChild(when);

  /* outcome — glyph AND word AND fill. Never one of the three alone. */
  const badge = el('div', 'zt-outcome');
  badge.title = meta.note;
  badge.appendChild(el('span', 'zt-outcome-glyph', meta.glyph));
  badge.appendChild(el('span', 'zt-outcome-label', meta.label));
  row.appendChild(badge);

  /* tier — a fact about the action, deliberately not a status colour */
  const tier = el('div', 'zt-tier mono', typeof receipt.tier === 'string' ? receipt.tier : '—');
  tier.title = 'Risk tier recorded on the receipt';
  row.appendChild(tier);

  /* the sentence the owner was shown at preview, and the ledger line under it */
  const main = el('div', 'zt-main');
  main.appendChild(
    el('p', 'zt-summary', typeof receipt.summary === 'string' && receipt.summary ? receipt.summary : '(no summary on this receipt)'),
  );

  const facts = el('p', 'zt-facts mono');
  const kind = typeof receipt.kind === 'string' ? receipt.kind : 'unrecorded kind';
  facts.appendChild(el('span', 'zt-fact', kind));
  if (typeof receipt.targetRef === 'string' && receipt.targetRef) {
    facts.appendChild(el('span', 'zt-sep', '·'));
    const tr = el('span', 'zt-fact', refTail(receipt.targetRef));
    tr.title = 'targetRef ' + receipt.targetRef;
    facts.appendChild(tr);
  }

  // What actually reached the outside world. 'none' is a real answer and is
  // shown as one — it is the difference between a local write and a push. The
  // digest that says WHICH bytes stays on the receipt, where it can be read
  // against the rest of the binding instead of floating on a summary line.
  const effect = receipt.externalEffect && receipt.externalEffect.effect;
  if (typeof effect === 'string' && effect) {
    facts.appendChild(el('span', 'zt-sep', '·'));
    const e = el('span', 'zt-fact', effectKind(effect));
    e.title = 'externalEffect.effect = ' + effect;
    facts.appendChild(e);
  }
  main.appendChild(facts);

  // Required on every non-verified outcome, so it is always rendered when present.
  if (typeof receipt.reason === 'string' && receipt.reason.trim()) {
    main.appendChild(el('p', 'zt-reason', receipt.reason.trim()));
  }

  if (unproven) {
    const flag = el('p', 'zt-unproven');
    flag.title = 'The chain fails at or before this line, so this receipt is not proven by the ledger.';
    flag.appendChild(el('span', 'zt-unproven-glyph', '✕'));
    flag.appendChild(el('span', null, 'unproven'));
    main.appendChild(flag);
  }
  row.appendChild(main);

  /* identity — the receipt's own hash, and its position in the file */
  const id = el('div', 'zt-id mono');
  const idx = el('span', 'zt-index', '#' + index);
  idx.title = 'Position in the receipt ledger — the index the chain badge names';
  id.appendChild(idx);
  const hash = el('span', 'zt-hash', shortHash(receipt.selfHash));
  hash.title = typeof receipt.selfHash === 'string' ? 'selfHash ' + receipt.selfHash : 'no selfHash on this receipt';
  id.appendChild(hash);
  row.appendChild(id);

  return row;
}

function renderBreakMarker(chain, count) {
  const li = el('li', 'zt-breakline');
  // Deliberately NOT role="separator". A non-focusable separator has
  // presentational children in ARIA, so the role would strip this sentence out
  // of the accessibility tree and leave an unnamed divider — silently hiding
  // the single most important line in the history from a screen reader. It
  // stays an ordinary list item, and the glyph beside it is marked decorative
  // so the words are not read twice.
  const at = Number.isInteger(chain.firstBreakAt) ? chain.firstBreakAt : null;
  const glyph = el('span', 'zt-breakline-glyph', '✕');
  glyph.setAttribute('aria-hidden', 'true');
  li.appendChild(glyph);
  li.appendChild(
    el(
      'span',
      'zt-breakline-text',
      at === null
        ? 'chain integrity fails — nothing here is proven'
        : at >= count
          ? 'chain integrity fails after the last readable receipt — the tail is missing'
          : 'chain integrity fails at #' + at + ' — nothing above this line is proven',
    ),
  );
  return li;
}

/* -------------------------------------------------------------- the export */

/**
 * The receipt timeline: a scrollable history of every terminal outcome, newest
 * first, with the chain-integrity badge pinned above it where it cannot scroll
 * out of sight.
 *
 * @param {ReadonlyArray<object>} receipts  chronological, oldest first (ledger order)
 * @param {{ok:boolean, firstBreakAt?:number, reason?:string}|null} chain
 * @param {{badgeMount?:Element|string, unverified?:number}} [options]
 *        `badgeMount` is an optional second mount for the same badge — e.g. the
 *        header chip in index.html. Opt-in, because a render function should not
 *        reach into the document uninvited. `unverified` is how many of
 *        `receipts` arrived after `chain` was reported; see renderChainBadge.
 *        `heading` and `sub` rename the section only — they change no row, no
 *        count and no claim; omit them for "Receipt timeline".
 * @returns {HTMLElement} a <section>, ready to be dropped into the page
 */
export function renderTimeline(receipts, chain, options) {
  ensureStyles();
  const opts = options || {};
  const list = Array.isArray(receipts) ? receipts.slice() : [];
  const count = list.length;
  const broken = !!(chain && chain.ok === false);
  const breakAt = broken && Number.isInteger(chain.firstBreakAt) ? chain.firstBreakAt : null;
  const unverified = Number.isFinite(opts.unverified) ? opts.unverified : 0;

  const section = el('section', 'zt');
  section.dataset.chain = !chain || typeof chain.ok !== 'boolean' ? 'unknown' : chain.ok ? 'ok' : 'broken';
  section.setAttribute('aria-labelledby', 'zt-heading');

  // The caller may name the section — Command calls it "Recently settled", and
  // the same rows under a different surface's heading are still these rows.
  // Only the two strings move; nothing about what is rendered changes with them.
  const heading = typeof opts.heading === 'string' && opts.heading ? opts.heading : 'Receipt timeline';
  const sub = typeof opts.sub === 'string' && opts.sub
    ? opts.sub
    : 'Every terminal outcome, read straight from the receipt ledger. Nothing here is inferred.';

  const head = el('header', 'zt-head');
  const titles = el('div', 'zt-titles');
  const h = el('h2', 'zt-h', heading);
  h.id = 'zt-heading';
  titles.appendChild(h);
  titles.appendChild(el('p', 'zt-sub', sub));
  head.appendChild(titles);
  head.appendChild(renderChainBadge(chain, count, { band: true, unverified }));
  section.appendChild(head);

  if (count === 0) {
    const empty = el('div', 'zt-empty');
    empty.appendChild(el('span', 'zt-empty-glyph', '○'));
    const body = el('div', null);
    body.appendChild(el('p', 'zt-empty-title', 'No receipts yet.'));
    body.appendChild(
      el(
        'p',
        'zt-empty-sub',
        'Nothing has been committed on this machine. The first approved action will write the first line of the ledger, and it will appear here.',
      ),
    );
    empty.appendChild(body);
    section.appendChild(empty);
    if (opts.badgeMount) mountBadge(opts.badgeMount, chain, count, unverified);
    return section;
  }

  const ol = el('ol', 'zt-list');
  ol.tabIndex = 0; // scrollable by keyboard, with a real focus border
  ol.setAttribute('aria-label', 'Receipt history, newest first');

  const today = new Date();

  // Newest first: the owner reads down into the past. The break marker sits
  // between the last proven receipt and the first unproven one, which in this
  // order means it is drawn just before row (breakAt - 1).
  const breakInRange = breakAt !== null && breakAt < count;
  if (breakAt !== null && !breakInRange) ol.appendChild(renderBreakMarker(chain, count));
  for (let i = count - 1; i >= 0; i--) {
    if (breakInRange && i === breakAt - 1) ol.appendChild(renderBreakMarker(chain, count));
    const unproven = breakAt !== null ? i >= breakAt : broken;
    ol.appendChild(renderRow(list[i] || {}, i, unproven, today));
  }
  if (breakAt === 0) ol.appendChild(renderBreakMarker(chain, count));

  section.appendChild(ol);

  const foot = el('p', 'zt-foot mono');
  foot.appendChild(el('span', null, count + ' ' + plural(count, 'receipt', 'receipts') + ' · newest first'));
  section.appendChild(foot);

  if (opts.badgeMount) mountBadge(opts.badgeMount, chain, count, unverified);
  return section;
}

function mountBadge(target, chain, count, unverified) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node) return;
  // The header rail gets the default chip: same words, chip-sized, so a broken
  // chain never shoves the header into the page.
  node.replaceChildren(renderChainBadge(chain, count, { unverified }));
}

export default renderTimeline;

/* ------------------------------------------------------------------ styles */

/**
 * The component's own stylesheet, injected once. It uses only Zeno Glass tokens
 * — every colour on this page comes from /glass/tokens.css, and the fallbacks in
 * the var() calls are the same approved values, so the timeline is still legible
 * if the stylesheet has not loaded.
 */
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
/* ===== Zeno Command · receipt timeline =====================================
   Opaque graphite. No glass: this is long text and a table, and glass behind
   either is unreadable. 4px spacing scale throughout. ====================== */
.zt{
  background:var(--g2,#0F1214);
  border:1px solid var(--rule,#242C31);
  border-radius:12px;
  overflow:hidden;
}
.zt[data-chain="broken"]{ border:2px solid var(--red,#D8695A); }

.zt-head{
  display:flex; flex-wrap:wrap; gap:12px; align-items:flex-start; justify-content:space-between;
  padding:16px 16px 12px;
  border-bottom:1px solid var(--rule,#242C31);
}
.zt-titles{ min-width:200px; }
.zt-h{
  margin:0; font-size:15px; font-weight:600; letter-spacing:-.01em;
  color:var(--ink,#ECEBE6);
}
.zt-sub{ margin:4px 0 0; font-size:12px; line-height:1.5; color:var(--ink-2,#9AA1AC); max-width:52ch; }

/* ---- chain-integrity badge ---------------------------------------------- */
.zt-chain{
  display:flex; gap:8px; align-items:flex-start;
  padding:8px 12px; border-radius:8px;
  border:1px solid var(--rule-2,#2C363B);
  background:var(--g3,#151A1D);
  max-width:100%;
}
.zt-chain-glyph{ font-size:13px; line-height:18px; }
.zt-chain-body{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.zt-chain-label{
  font-size:12px; font-weight:600; letter-spacing:.01em;
  font-variant-numeric:tabular-nums;
  color:var(--ink,#ECEBE6);
}
/* --ink-2, not --ink-3: tokens.css states --ink-3 peaks at 4.15:1 and is not a
   text colour on any graphite here. These sentences name the broken index and
   the daemon's reason and appear nowhere else, so they are text.
   overflow-wrap because chain.reason is daemon-authored and can be one
   unbroken hash — .zt is overflow:hidden, so without it the reason is clipped
   away rather than wrapped. (No backticks in here: this comment lives inside a
   template literal, and one would end the stylesheet mid-string.) */
.zt-chain-detail{ font-size:11px; line-height:1.45; color:var(--ink-2,#9AA1AC); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.zt-chain-reason{ font-size:11px; line-height:1.45; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }

.zt-chain[data-state="ok"]{
  border-color:color-mix(in srgb, var(--green,#5BB98C) 42%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--green,#5BB98C) 12%, var(--g3,#151A1D));
}
.zt-chain[data-state="ok"] .zt-chain-glyph{ color:var(--green,#5BB98C); }

/* Neutral, all three of them. "partial" in particular must NOT borrow the green
   fill: some of the rows it counts are not covered by the check it names. */
.zt-chain[data-state="unknown"] .zt-chain-glyph,
.zt-chain[data-state="empty"] .zt-chain-glyph,
.zt-chain[data-state="partial"] .zt-chain-glyph{ color:var(--ink-3,#6C7480); }
.zt-chain[data-state="unknown"] .zt-chain-label,
.zt-chain[data-state="empty"] .zt-chain-label,
.zt-chain[data-state="partial"] .zt-chain-label{ color:var(--ink-2,#9AA1AC); font-weight:500; }
/* A fill delta against "ok" and "unknown", so the three separate in greyscale. */
.zt-chain[data-state="partial"]{ background:var(--g4,#1B2124); border-style:dashed; }

/* Broken: full width, 2px red, uppercase, and it cannot be dismissed. The one
   loud thing on the page, because a broken ledger invalidates everything else. */
.zt-chain[data-state="broken"]{
  flex:1 0 100%; order:-1;
  gap:12px; padding:12px 14px;
  border:2px solid var(--red,#D8695A);
  background:color-mix(in srgb, var(--red,#D8695A) 16%, var(--g3,#151A1D));
}
.zt-chain[data-state="broken"] .zt-chain-glyph{ color:var(--red,#D8695A); font-size:18px; line-height:22px; }
.zt-chain[data-state="broken"] .zt-chain-label{
  font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--red,#D8695A);
}
.zt-chain[data-state="broken"] .zt-chain-detail,
.zt-chain[data-state="broken"] .zt-chain-reason{ color:var(--ink,#ECEBE6); font-size:12px; }

/* Compact: the same badge, chip-sized, for a header rail. One line, no growth. */
.zt-chain[data-compact="1"]{ padding:5px 10px; border-radius:7px; gap:6px; align-items:center; }
.zt-chain[data-compact="1"] .zt-chain-label{ font-size:11px; white-space:nowrap; }
.zt-chain[data-compact="1"][data-state="broken"]{
  flex:0 0 auto; order:0; padding:4px 9px;
}
.zt-chain[data-compact="1"][data-state="broken"] .zt-chain-glyph{ font-size:13px; line-height:16px; }
.zt-chain[data-compact="1"][data-state="broken"] .zt-chain-label{
  font-size:11px; letter-spacing:.06em;
}

/* ---- the scrolling history ---------------------------------------------- */
.zt-list{
  list-style:none; margin:0; padding:0;
  max-height:52vh; overflow-y:auto; overscroll-behavior:contain;
}
/* A real 2px border, never a glow. The offset is inset rather than the standard
   +2px for one reason: ".zt" is overflow:hidden, so an outward ring on this
   scroller would be clipped away and the focus would become invisible. */
.zt-list:focus-visible{ outline:2px solid var(--focus,#86DEEC); outline-offset:-2px; }

.zt-row{
  display:grid;
  /* The tier track is minmax(32px,max-content), not a flat 32px: 'T0'–'T4' all
     measure under 32px so the floor keeps the badges a uniform width, while a
     tier string the kernel's union does not contain gets a track that fits it
     instead of being shredded down one glyph per line. */
  grid-template-columns:72px 148px minmax(32px,max-content) minmax(0,1fr) auto;
  gap:12px; align-items:start;
  padding:12px 16px 12px 13px;
  border-left:3px solid transparent;
  border-bottom:1px solid var(--rule,#242C31);
}
.zt-row:last-child{ border-bottom:0; }
.zt-row[data-tone="green"]{ border-left-color:var(--green,#5BB98C); background:color-mix(in srgb, var(--green,#5BB98C) 5%, transparent); }
.zt-row[data-tone="red"]{ border-left-color:var(--red,#D8695A); background:color-mix(in srgb, var(--red,#D8695A) 6%, transparent); }
.zt-row[data-tone="amber"]{ border-left-color:var(--amber,#E0A128); background:color-mix(in srgb, var(--amber,#E0A128) 6%, transparent); }
.zt-row[data-tone="neutral"]{ border-left-color:var(--g7,#384349); }
.zt-row[data-unproven="1"]{ border-left-style:dashed; }

.zt-when{ display:flex; flex-direction:column; gap:2px; }
.zt-time{ font-size:12px; color:var(--ink-2,#9AA1AC); font-variant-numeric:tabular-nums; }
/* The date is only drawn when the row is NOT from today, so it is the sole
   carrier of when this happened — text, and --ink-3 is not a text colour. */
.zt-date{ font-size:10px; color:var(--ink-2,#9AA1AC); letter-spacing:.04em; text-transform:uppercase; }

/* glyph + label + fill. Remove the colour and every one of these still reads. */
.zt-outcome{
  display:inline-flex; align-items:flex-start; gap:6px;
  padding:3px 8px; border-radius:6px;
  border:1px solid var(--rule-2,#2C363B);
  background:var(--g4,#1B2124);
  font-size:11.5px; font-weight:600; letter-spacing:.01em;
  /* This cell sits in a FIXED 148px grid track, and outcomeOf() deliberately
     passes an unrecognised "receipt.outcome" through as its own label — an
     arbitrary string off the wire. With white-space:nowrap that string could
     not shrink to its track and overflowed sideways across the tier and
     summary columns. It wraps inside its own badge instead; the five known
     labels still fit on one line. */
  min-width:0; max-width:100%;
  overflow-wrap:anywhere;
}
.zt-outcome-glyph{ font-size:12px; line-height:1.35; flex:none; }
.zt-row[data-tone="green"] .zt-outcome{
  color:var(--green,#5BB98C);
  border-color:color-mix(in srgb, var(--green,#5BB98C) 45%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--green,#5BB98C) 18%, var(--g4,#1B2124));
}
.zt-row[data-tone="red"] .zt-outcome{
  color:var(--red,#D8695A);
  border-color:color-mix(in srgb, var(--red,#D8695A) 50%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--red,#D8695A) 24%, var(--g4,#1B2124));
}
.zt-row[data-tone="amber"] .zt-outcome{
  color:var(--amber,#E0A128);
  border-color:color-mix(in srgb, var(--amber,#E0A128) 48%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--amber,#E0A128) 14%, var(--g4,#1B2124));
}
.zt-row[data-tone="neutral"] .zt-outcome{ color:var(--ink-2,#9AA1AC); background:var(--g5,#222A2E); }

.zt-tier{
  font-size:11px; font-weight:600; letter-spacing:.04em;
  color:var(--ink-2,#9AA1AC);
  background:var(--g4,#1B2124);
  border:1px solid var(--rule-2,#2C363B);
  border-radius:5px; padding:3px 2px; text-align:center;
  font-variant-numeric:tabular-nums;
  /* Same reason as .zt-outcome: a 32px fixed track holding whatever string the
     receipt's "tier" field carries. 'T0'–'T4' fit; anything else must wrap
     rather than run across the summary. */
  min-width:0; overflow-wrap:anywhere;
}

.zt-main{ min-width:0; }
.zt-summary{
  margin:0; font-size:13px; line-height:1.45; color:var(--ink,#ECEBE6);
  overflow-wrap:anywhere;
}
/* kind · the tail of targetRef · the effect's kind — the summary facts of the
   row. The whole ref and the effect's digest are provenance and live on the
   receipt itself, which is one click away. Text, so --ink-2, not --ink-3. */
.zt-facts{ margin:4px 0 0; font-size:11px; line-height:1.5; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }
.zt-sep{ padding:0 6px; color:var(--g7,#384349); }
.zt-reason{ margin:4px 0 0; font-size:12px; line-height:1.45; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }
.zt-unproven{
  margin:6px 0 0; display:inline-flex; gap:6px; align-items:center;
  font-size:11px; font-weight:600; letter-spacing:.02em;
  color:var(--red,#D8695A);
  border:1px solid color-mix(in srgb, var(--red,#D8695A) 45%, var(--rule-2,#2C363B));
  background:color-mix(in srgb, var(--red,#D8695A) 14%, var(--g4,#1B2124));
  border-radius:5px; padding:2px 8px;
}
.zt-unproven-glyph{ line-height:1; }

.zt-id{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; text-align:right; }
/* This is the index the chain badge names when it reports a break. It has to be
   readable for the badge's sentence to be actionable. */
.zt-index{ font-size:11px; color:var(--ink-2,#9AA1AC); font-variant-numeric:tabular-nums; }
.zt-hash{ font-size:11px; color:var(--ink-2,#9AA1AC); font-variant-numeric:tabular-nums; letter-spacing:.01em; }

/* the line where the chain stops holding */
.zt-breakline{
  display:flex; gap:8px; align-items:center;
  padding:8px 16px;
  background:color-mix(in srgb, var(--red,#D8695A) 20%, var(--g3,#151A1D));
  border-top:2px solid var(--red,#D8695A);
  border-bottom:2px solid var(--red,#D8695A);
  color:var(--ink,#ECEBE6);
  font-size:11.5px; font-weight:600; letter-spacing:.03em; text-transform:uppercase;
  font-variant-numeric:tabular-nums;
}
.zt-breakline-glyph{ color:var(--red,#D8695A); }

/* ---- empty state -------------------------------------------------------- */
.zt-empty{ display:flex; gap:12px; align-items:flex-start; padding:20px 16px 24px; }
.zt-empty-glyph{ color:var(--ink-3,#6C7480); font-size:14px; line-height:20px; }
.zt-empty-title{ margin:0; font-size:13px; font-weight:600; color:var(--ink-2,#9AA1AC); }
.zt-empty-sub{ margin:4px 0 0; font-size:12px; line-height:1.55; color:var(--ink-2,#9AA1AC); max-width:60ch; }

.zt-foot{
  margin:0; padding:8px 16px;
  border-top:1px solid var(--rule,#242C31);
  font-size:11px; color:var(--ink-2,#9AA1AC); font-variant-numeric:tabular-nums;
}

/* ---- narrow ------------------------------------------------------------- */
@media (max-width:720px){
  .zt-row{ grid-template-columns:auto 1fr; gap:8px 12px; }
  .zt-when{ flex-direction:row; align-items:baseline; gap:8px; grid-column:1; }
  .zt-outcome{ grid-column:2; justify-self:start; }
  .zt-tier{ grid-column:1; padding:2px 6px; }
  .zt-main{ grid-column:2; }
  .zt-id{ grid-column:2; align-items:flex-start; text-align:left; flex-direction:row; gap:8px; }
}

/* No hover state and no transition anywhere in this file. A row is not a
   control, so it must not behave like one; and there is no state here that a
   motion would describe. prefers-reduced-motion is respected by having nothing
   to reduce. */
`;
