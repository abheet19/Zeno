/**
 * bind/receipts.js — Command → Receipts screen, wired to the real hash-chained
 * ledger.
 *
 * The artifact (index.html) draws this screen as a `.card` holding a
 * `.row-list` of `.lrow[data-toggle-detail]` rows, each followed by its
 * `dl.rdetail`, above an `.sbar` search box and `.filterpill` tabs. ui.js
 * already wires the expand/collapse click (`[data-toggle-detail]` toggles the
 * next `.rdetail`'s `hidden`) and the pill `aria-current` styling — this file
 * only replaces the mock rows with real ones and adds the filtering the pills
 * did not yet have.
 *
 * Source of truth: GET /state -> { receipts: Receipt[], chain: ChainStatus }
 * (see packages/daemon/src/server.ts `serveState`, and the Receipt/ChainStatus
 * shapes in packages/kernel/src/types.ts + ledger.ts — the same ledger
 * timeline.js's `renderTimeline`/`renderChainBadge` read). This binder does not
 * reuse those two exports directly because they render a different DOM shape
 * (their own `.zt-*` component) — using them here would abandon the artifact's
 * `.lrow`/`.rdetail` structure that ui.js's toggle already depends on. Instead
 * it re-derives the same honesty rules against the artifact's own markup:
 *   - a row is drawn only for a receipt that actually arrived;
 *   - a field with no value on the receipt is left off the drawer, never
 *     guessed at (no invented signature, no invented previous-hash);
 *   - "chain verified" is only ever said when `chain.ok === true` was actually
 *     read — an unread or absent chain says so instead of defaulting to ok.
 *
 * Filtering (search box + All/Writes/Runs/Memory pills) runs entirely over the
 * receipts already fetched once at load — no refetch per keystroke or click,
 * and never a fabricated match.
 */

import { getJSON, $, $$, el, fill, screenEl } from '../bind.js';

const SCREEN_SEL = '[data-screen="receipts"]';

/* ---- outcome -> pill tone + label ---------------------------------------
 * Mirrors the five terminal outcomes the kernel can write (timeline.js's
 * OUTCOMES table), translated onto the artifact's own `.pill` tone classes
 * (gr/rd/am/wt) instead of timeline.js's `.zt-*` styling. "sealed" is used
 * only for `verified`, matching the artifact's own convention; every other
 * outcome is named literally so nothing reads as more settled than it was. */
const OUTCOME_META = {
  verified: { pill: 'gr', label: 'sealed' },
  refused: { pill: 'rd', label: 'refused' },
  denied: { pill: 'rd', label: 'denied' },
  expired: { pill: 'wt', label: 'expired' },
  'outcome-unknown': { pill: 'am', label: 'outcome unknown' },
};

function outcomeMeta(outcome) {
  if (typeof outcome === 'string' && Object.prototype.hasOwnProperty.call(OUTCOME_META, outcome)) {
    return OUTCOME_META[outcome];
  }
  return { pill: 'wt', label: typeof outcome === 'string' && outcome ? outcome : 'unrecorded' };
}

/* ---- kind -> short label + filter bucket ---------------------------------
 * ACTION_KINDS from packages/kernel/src/types.ts. The bucket is a client-side
 * presentation grouping for the four pills only — it never changes what a
 * receipt says, only which pill currently shows it. */
const KIND_LABEL = {
  read: 'read',
  'local.write': 'write',
  'patch.task': 'patch',
  'shell.exec': 'run',
  'net.fetch': 'fetch',
  'memory.write': 'memory',
  'vcs.commit': 'commit',
  'vcs.push': 'push',
  'vcs.mr': 'mr',
  'jira.write': 'jira',
  'message.send': 'message',
  'settings.change': 'settings',
  payment: 'payment',
  destructive: 'destructive',
};

function kindLabel(kind) {
  if (typeof kind !== 'string' || !kind) return 'unrecorded';
  return KIND_LABEL[kind] || kind;
}

function kindBucket(kind) {
  if (typeof kind === 'string' && kind.indexOf('memory.') === 0) return 'memory';
  if (kind === 'shell.exec') return 'runs';
  return 'writes';
}

const PILL_LABEL_TO_BUCKET = { all: 'all', writes: 'writes', runs: 'runs', memory: 'memory' };

/* ---- small formatters ----------------------------------------------------- */

function hashDisplay(value, head, tail) {
  if (typeof value !== 'string' || !value) return null;
  const h = typeof head === 'number' ? head : 10;
  const t = typeof tail === 'number' ? tail : 6;
  if (value.length <= h + t + 1) return value;
  return value.slice(0, h) + '…' + value.slice(-t);
}

function relTime(iso) {
  if (typeof iso !== 'string') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffS = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffS < 5) return 'just now';
  if (diffS < 60) return diffS + 's ago';
  const diffM = Math.round(diffS / 60);
  if (diffM < 60) return diffM + 'm ago';
  const diffH = Math.round(diffM / 60);
  if (diffH < 24) return diffH + 'h ago';
  const diffD = Math.round(diffH / 24);
  return diffD + 'd ago';
}

function effectText(effect) {
  if (typeof effect !== 'string' || !effect) return null;
  if (effect === 'none') return 'no external effect';
  const i = effect.indexOf(':');
  return 'effect ' + (i > 0 ? effect.slice(0, i) : effect);
}

function searchTextOf(r) {
  return [r.kind, r.summary, r.targetRef, r.actionHash, r.selfHash, r.tier, r.outcome]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase();
}

function dtdd(dtText, ddText, ddTitle) {
  const dt = el('dt', null, dtText);
  const dd = el('dd', null, ddText);
  if (ddTitle) dd.title = ddTitle;
  return [dt, dd];
}

/* ---- one receipt -> one .lrow + one dl.rdetail ---------------------------- */

function buildRow(receipt) {
  const r = receipt && typeof receipt === 'object' ? receipt : {};
  const meta = outcomeMeta(r.outcome);

  const row = el('div', 'lrow');
  row.setAttribute('data-toggle-detail', '');

  row.appendChild(el('span', 'tier', (typeof r.tier === 'string' && r.tier ? r.tier : '—') + ' · ' + kindLabel(r.kind)));

  const mid = el('div');
  mid.appendChild(
    el('div', 'tt', typeof r.summary === 'string' && r.summary ? r.summary : '(no summary on this receipt)'),
  );
  const seal = hashDisplay(r.selfHash, 4, 4);
  const when = relTime(r.at);
  const mm = el('div', 'mm', 'seal ' + (seal || '—') + ' · ' + (when || 'time unrecorded'));
  if (typeof r.selfHash === 'string' && r.selfHash) mm.title = 'selfHash ' + r.selfHash;
  mid.appendChild(mm);
  row.appendChild(mid);

  const pill = el('span', 'pill ' + meta.pill);
  pill.appendChild(el('span', 'd'));
  pill.appendChild(document.createTextNode(meta.label));
  row.appendChild(pill);

  const dl = el('dl', 'rdetail');
  dl.hidden = true;

  // action hash — always on a Receipt, never invented if somehow missing.
  if (typeof r.actionHash === 'string' && r.actionHash) {
    const [dt, dd] = dtdd('action hash', hashDisplay(r.actionHash) || r.actionHash, r.actionHash);
    dl.append(dt, dd);
  }

  // previous — null is a real, honest value (genesis entry), not a missing
  // field, so it is shown; if the key is absent altogether the row is skipped
  // rather than guessed at.
  if (r.prevReceipt === null) {
    const [dt, dd] = dtdd('previous', 'genesis — no previous receipt');
    dl.append(dt, dd);
  } else if (typeof r.prevReceipt === 'string' && r.prevReceipt) {
    const [dt, dd] = dtdd('previous', hashDisplay(r.prevReceipt) || r.prevReceipt, r.prevReceipt);
    dl.append(dt, dd);
  }

  // signature — shown only when the ledger line actually carries one. No page
  // this binder reads verifies the Ed25519 signature, so this only ever
  // states that a signature is present, never that it checks out as "valid".
  if (typeof r.signature === 'string' && r.signature) {
    const [dt, dd] = dtdd('signature', 'Ed25519 · present (' + (hashDisplay(r.signature, 6, 4) || r.signature) + ')', r.signature);
    dl.append(dt, dd);
  }

  // effect — externalEffect.effect is required on the type; 'none' is a real
  // answer and is shown as one, not omitted.
  const effTxt = effectText(r.externalEffect && r.externalEffect.effect);
  if (effTxt) {
    const targetRef = typeof r.targetRef === 'string' && r.targetRef ? r.targetRef : null;
    const [dt, dd] = dtdd('effect', targetRef ? targetRef + ' · ' + effTxt : effTxt, targetRef || undefined);
    dl.append(dt, dd);
  }

  // reason — required on every non-verified outcome; shown whenever present.
  if (typeof r.reason === 'string' && r.reason.trim()) {
    const [dt, dd] = dtdd('reason', r.reason.trim());
    dl.append(dt, dd);
  }

  // "approved by" is deliberately never rendered: the Receipt type this ledger
  // writes carries no such field, and the artifact's mock row for it would be
  // an invented value.

  return { row, dl, bucket: kindBucket(r.kind), searchText: searchTextOf(r) };
}

/* ---- honest empty / error states ------------------------------------------ */

function note(text) {
  const p = el('div', null, text);
  p.style.padding = '18px 6px';
  p.style.fontSize = '12.5px';
  p.style.color = 'var(--ink-2)';
  return p;
}

/* ---- header pill: "chain verified · N receipts" or the honest alternative */

function paintHeaderPill(pill, chain, count) {
  if (!pill) return;
  let cls = 'wt';
  let text;
  if (!chain || typeof chain.ok !== 'boolean') {
    text = 'chain status not reported';
  } else if (chain.ok && count === 0) {
    text = 'no receipts yet';
  } else if (chain.ok) {
    cls = 'gr';
    text = 'chain verified · ' + count + ' ' + (count === 1 ? 'receipt' : 'receipts');
  } else {
    cls = 'rd';
    text = 'chain broken' + (Number.isInteger(chain.firstBreakAt) ? ' · #' + chain.firstBreakAt : '');
    if (typeof chain.reason === 'string' && chain.reason.trim()) pill.title = chain.reason.trim();
  }
  pill.className = 'pill ' + cls;
  fill(pill, el('span', 'd'), document.createTextNode(text));
}

export async function bind() {
  try {
    const screen = screenEl('receipts');
    if (!screen) return; // screen not on this page (or being edited elsewhere) — skip quietly

    const list = $('#receipts-list', screen);
    const headerPill = $('.phead .pill', screen);
    const sbar = $('.sbar', screen);

    const res = await getJSON('/state');

    if (!res.ok) {
      paintHeaderPill(headerPill, null, 0);
      if (headerPill) headerPill.title = res.error || '';
      if (list) fill(list, note('The receipt ledger could not be read (' + (res.error || 'unknown error') + ').'));
      return;
    }

    const data = res.data && typeof res.data === 'object' ? res.data : {};
    const receipts = Array.isArray(data.receipts) ? data.receipts : [];
    const chain = data.chain && typeof data.chain === 'object' ? data.chain : null;

    paintHeaderPill(headerPill, chain, receipts.length);

    if (!list) return; // artifact markup for the list may be mid-edit — skip quietly

    if (receipts.length === 0) {
      fill(list, note('No receipts yet. Nothing has been committed on this machine — the first approved action will write the first line of the ledger.'));
      return;
    }

    // Newest first, matching the artifact's own mock ordering and timeline.js's
    // renderTimeline convention. The ledger itself is oldest-first (append-only).
    const built = receipts.map(buildRow).slice().reverse();

    const state = { q: '', bucket: 'all' };

    function paint() {
      const q = state.q.trim().toLowerCase();
      const nodes = [];
      for (const b of built) {
        if (state.bucket !== 'all' && b.bucket !== state.bucket) continue;
        if (q && !b.searchText.includes(q)) continue;
        nodes.push(b.row, b.dl);
      }
      if (nodes.length === 0) {
        fill(list, note('No receipts match this filter.'));
      } else {
        fill(list, ...nodes);
      }
    }

    paint();

    if (sbar) {
      const input = $('.search input', sbar);
      if (input) {
        input.addEventListener('input', () => {
          state.q = input.value || '';
          paint();
        });
      }
      const pills = $$('.filterpill', sbar);
      pills.forEach((p) => {
        const key = (p.textContent || '').trim().toLowerCase();
        const bucket = PILL_LABEL_TO_BUCKET[key] || 'all';
        p.addEventListener('click', () => {
          state.bucket = bucket;
          paint();
        });
      });
    }
  } catch (err) {
    // Never throw out of bind(): the screen keeps whatever it last had rather
    // than taking the rest of the window down with it.
    console.warn('[zeno] bind/receipts.js failed:', err);
  }
}
