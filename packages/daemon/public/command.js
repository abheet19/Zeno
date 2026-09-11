/*
 * command.js — TODAY, the list under the Standing Field.
 *
 * This is the Gate-2 prototype's Today list (docs/23-gate2-prototype.html,
 * `todayItems()` and the `it()` row builder), ported. The markup is the
 * prototype's — `.pl.item` > `.b` badge, `.itop` > `.t` title + `.ist` status
 * pill, `.m` meta line, `.w` waiting line — and the classes and status colours
 * are its classes and its colours, not a parallel set.
 *
 * WHAT IS NOT PORTED IS ITS DATA. The prototype's five rows are fixtures with a
 * Jira ticket in them; its own footer says "Synthetic data". Every row here is
 * something the daemon actually reported on this poll:
 *
 *   · GET /forge/status    — the sandbox's uncommitted changes, if any.
 *   · GET /work            — the backlog every intake source actually returned,
 *                            AND a row for every source that could not be read
 *                            in full, so a short list is never mistaken for a
 *                            quiet one.
 *   · GET /state           — NOTHING. Neither the approval queue nor the
 *                            receipts are restated here. Pending belongs to
 *                            app.js's "What needs you" section and receipts to
 *                            the timeline; this list used to redraw the queue
 *                            as well, which put the same held action on the
 *                            page twice and two writers on one count.
 *
 * THE HONESTY RULES THIS FILE KEEPS
 *
 *   H1  Empty is claimed only after a read SUCCEEDED. Before the first answer
 *       the list says it has not read the daemon; if the read fails it says the
 *       read failed. "Nothing is waiting on you" is a statement about a control
 *       plane this file has actually spoken to, never a default.
 *   H2  No count is computed from anything but a real array length. There is no
 *       fallback number anywhere in this file, and no row is invented to give
 *       the section something to show.
 *   H3  A row states status, never outcome. Nothing here draws a seal, and
 *       nothing here turns green: green belongs to a receipt, and a receipt is
 *       the timeline's to render.
 *   H4  It writes into `[data-mount="today"]` and nowhere else. The masthead,
 *       the hero chips, the summary strip and the rail counts belong to other
 *       files — two writers on one number is how a surface starts disagreeing
 *       with itself.
 *   H5  It reads. It never writes: there is no fetch in this file that is not a
 *       GET, and no row on this list carries a control.
 *
 */

/* ---- auth: the same token the page was handed ----------------------------- */
function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  return (m && m.getAttribute('content')) || '';
}
function authHeaders() {
  const t = token();
  return t ? { 'x-zeno-token': t } : {};
}
async function getJSON(path) {
  const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(path + ' → ' + res.status);
  return await res.json();
}

/* ---- text ------------------------------------------------------------------
   Every string that reaches innerHTML below goes through esc() first. Row text
   is agent-authored (a summary, a work-item title, a policy reason) and is data,
   never markup. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function plural(n, one, many) { return n === 1 ? one : many; }

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = (Date.now() - t) / 60000;
  return m < 0 ? 0 : m;
}
/* Under a minute is reported as "moments", not rounded up to "1m": a rounded
   number is read as a measurement, and inventing one at the top of the scale is
   the same small lie as inventing one anywhere else. */
function ageStr(m) {
  if (m == null) return null;
  if (m < 1) return 'moments';
  return m < 60 ? Math.round(m) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
}
function shortHash(h) { const s = String(h == null ? '' : h); return s.length > 12 ? s.slice(0, 8) + '…' : s; }

/* ---- the prototype's row ---------------------------------------------------
   it(badge, title, meta, waiting, [pillClass, pillText], extra?)
   `extra` used to carry a jump to a pending action's capsule. Nothing on this
   list is a pending action any more, so no caller passes it and no row here
   carries a control: the desk is a readout. */
function it(b, t, m, w, stat, extra) {
  let badge = esc(b), title = esc(t), meta = esc(m), wait = w ? esc(w) : '', pill = stat;
  const pillHtml = pill ? '<span class="ist ' + esc(pill[0]) + '">' + esc(pill[1]) + '</span>' : '';
  const chev = extra
    ? '<button type="button" class="ichev" data-jump-hash="' + esc(extra) + '">open the capsule ›</button>'
    : '';
  return '<div class="pl item">'
    + '<span class="b">' + badge + '</span>'
    + '<div class="ibd">'
    + '<div class="itop"><div class="t">' + title + '</div>' + pillHtml + '</div>'
    + '<div class="m">' + meta + '</div>'
    + (wait ? '<div class="w">' + wait + '</div>' : '')
    + chev
    + '</div></div>';
}

/* A group heading with its own real count — "AWAITING YOU · 2". The count is an
   array length and nothing else; a group with nothing in it is not rendered. */
function group(label, n) {
  return '<p class="k tgrp">' + esc(label) + ' <span class="tgn">' + n + '</span></p>';
}

/* ---- the rows, built from what the daemon reported ------------------------ */

function sandboxRow(forge) {
  const changed = (forge && Array.isArray(forge.changed)) ? forge.changed.length : 0;
  if (!forge || !forge.repo || changed === 0) return null;
  const branch = forge.branch ? String(forge.branch) : 'the sandbox branch';
  const head = forge.head ? String(forge.head).slice(0, 7) : null;
  return it(
    'FORGE',
    changed + ' uncommitted ' + plural(changed, 'change', 'changes') + ' in the sandbox',
    [branch, head ? 'base ' + head : null].filter(Boolean).join(' · '),
    'Staged in an isolated worktree. A commit and a push are separate approvals; neither has been asked for.',
    ['cy', 'in the sandbox'],
    null,
  );
}

function workRows(items) {
  return items.map((w) => {
    const age = ageStr(minutesSince(w.updatedAt));
    const labels = Array.isArray(w.labels) ? w.labels : [];
    const meta = [
      w.source ? String(w.source) : 'source not reported',
      age ? 'last touched ' + age + ' ago' : 'no timestamp reported',
      labels.length ? labels.length + ' ' + plural(labels.length, 'label', 'labels') + ': ' + labels.join(', ') : null,
      w.id ? String(w.id) : null,
    ].filter(Boolean).join(' · ');
    const badge = String(w.source || 'item').split(':')[0].toUpperCase().slice(0, 7);
    return it(
      badge,
      clip(w.title || w.id || 'an item with no title', 96),
      meta,
      'On the desk, not started. Zeno is holding it, not working it — nothing begins without your say.',
      ['', 'waiting'],
      null,
    );
  });
}

/* A source that failed, or that answered in part, is a HOLE in the list above.
   Rendering the backlog without saying so would make a short list look like a
   quiet one — the exact failure /work's `sources` report exists to prevent. */
function sourceRows(sources) {
  return sources
    .filter((s) => s.state === 'failed' || s.state === 'partial')
    .map((s) => it(
      'SOURCE',
      (s.name ? String(s.name) : 'a work source') + (s.state === 'failed' ? ' could not be read' : ' answered in part'),
      [s.state, s.reason ? String(s.reason) : null, s.count == null ? 'contributed nothing' : s.count + ' ' + plural(s.count, 'item', 'items') + ' contributed'].filter(Boolean).join(' · '),
      (s.detail ? String(s.detail) + ' ' : '')
        + 'The list above is short by an unknown amount. Treat it as incomplete, not as empty.',
      ['rd', s.state === 'failed' ? 'not read' : 'read in part'],
      null,
    ));
}

/* ---- render ---------------------------------------------------------------- */

function mountEl() { return document.querySelector('[data-mount="today"]'); }

function paint(html) {
  const el = mountEl();
  if (el) el.innerHTML = html;
}

/* The three things this list can honestly be: unread, unreadable, or read. */
function paintUnread() {
  paint(
    '<div class="pl item"><span class="b">—</span><div class="ibd">'
    + '<div class="itop"><div class="t">The desk is not loaded.</div><span class="ist">unread</span></div>'
    + '<div class="m">This page has not read the daemon\'s backlog or sandbox yet.</div>'
    + '<div class="w">Treat this list as unknown, not as empty. Everything Zeno is holding appears here once the read succeeds.</div>'
    + '</div></div>',
  );
}
function paintUnreadable(detail) {
  paint(
    '<div class="pl item"><span class="b">—</span><div class="ibd">'
    + '<div class="itop"><div class="t">The desk could not be read.</div><span class="ist rd">read failed</span></div>'
    + '<div class="m">' + esc(detail || 'the daemon did not answer') + '</div>'
    + '<div class="w">This is a failure to read, not an empty desk. Work may well be sitting there; this window cannot see it. The same backlog is readable from the CLI.</div>'
    + '</div></div>',
  );
}

/* The sandbox read failing is its OWN row. Without it a failed /forge/status
   simply drew no sandbox group, which under a line that says "nothing is on the
   desk" reads as "the sandbox is clean" — a claim about a repository this
   window could not open. */
function sandboxUnreadRow(detail) {
  return '<div class="pl item"><span class="b">FORGE</span><div class="ibd">'
    + '<div class="itop"><div class="t">The sandbox could not be read.</div><span class="ist rd">read failed</span></div>'
    + '<div class="m">' + esc(detail || 'the daemon did not answer') + '</div>'
    + '<div class="w">Whether anything is uncommitted in the sandbox is unknown from here. That is not the same as nothing.</div>'
    + '</div></div>';
}

/* A read that FAILED after an earlier one succeeded. The rows below are the
   last true picture, and the moment they are older than the daemon they stop
   being an answer to "what is waiting on me right now" — so they are labelled
   rather than either blanked or left standing as if they were current. */
function staleRow(detail, at) {
  const age = ageStr(minutesSince(at));
  return '<div class="pl item"><span class="b">—</span><div class="ibd">'
    + '<div class="itop"><div class="t">This list is no longer current.</div><span class="ist rd">stale</span></div>'
    + '<div class="m">' + esc(detail || 'the daemon did not answer') + (age ? ' · last read ' + esc(age) + ' ago' : '') + '</div>'
    + '<div class="w">Everything below is what the daemon last said, not what it says now. Something may have arrived, been approved or been refused since; this window cannot see it.</div>'
    + '</div></div>';
}

/* `state` is gone from this signature on purpose. The approval queue is
   app.js's, rendered once in "What needs you"; restating it here put the same
   held action on the page twice and two writers on one count — and it made
   /state a dependency of a list that no longer reads a single field from it. */
function render(work, forge, stale) {
  const items = (work && Array.isArray(work.items)) ? work.items : [];
  const sources = (work && Array.isArray(work.sources)) ? work.sources : [];

  const shaky = sources.filter((s) => s.state === 'failed' || s.state === 'partial');
  const forgeOk = !!(forge && forge.ok === true);
  const forgeData = forgeOk ? forge.data : null;
  const sandbox = sandboxRow(forgeData);

  let html = stale ? staleRow(stale.detail, stale.at) : '';
  if (!forgeOk) html += sandboxUnreadRow(forge && forge.detail);
  else if (sandbox) html += group('the sandbox', (forgeData.changed || []).length) + sandbox;
  if (items.length) html += group('on the desk', items.length) + workRows(items).join('');
  if (shaky.length) html += group('sources that did not answer in full', shaky.length) + sourceRows(sources).join('');

  if (!html) {
    // Read, and there is genuinely nothing. Say so plainly — and say what the
    // sources actually reported, so "nothing" is a fact and not a shrug.
    const asked = sources.filter((s) => s.state !== 'not-configured');
    const unasked = sources.length - asked.length;
    // Said from what /forge/status actually answered — "clean" and "there is no
    // repository here" are two different facts and are not merged into one.
    const sandboxLine = forgeData && forgeData.repo === true
      ? 'the sandbox reported no uncommitted change'
      : 'the sandbox is not a git repository yet';
    const srcLine = sources.length
      ? asked.length + ' ' + plural(asked.length, 'source', 'sources') + ' read in full'
        + (unasked ? ' · ' + unasked + ' not configured' : '')
      : 'no work source is configured';
    html = '<div class="pl item"><span class="b">○</span><div class="ibd">'
      + '<div class="itop"><div class="t">Nothing is on the desk.</div><span class="ist gr">clear</span></div>'
      + '<div class="m">' + esc(srcLine) + ' · ' + esc(sandboxLine) + '</div>'
      + '<div class="w">This says nothing about the approval queue, which is its own section above. It says the backlog is empty and the sandbox has no uncommitted change. Work and sandbox changes appear here the moment they arrive.</div>'
      + '</div></div>';
  }

  // The standing note under the list. It is a statement about this build's
  // guarantees, not about the rows, so it is true whether the list is full or empty.
  html += '<div class="tnote"><span>Every row is something the daemon reported on this read. '
    + 'Nothing here is a prediction, a placeholder or a remembered value, and no row on this list '
    + 'has had any effect: an effect starts only at an approval, and approvals are above.</span></div>';

  paint(html);
}

/* ---- refresh --------------------------------------------------------------- */

let lastGood = null;   // the last successfully read pair, for the stale-read fallback
let reading = false;

async function refresh() {
  if (reading) return;
  reading = true;
  try {
    // Each read is settled on its own. A GitHub outage must not blank the
    // approvals, and a forge with no repo must not blank the backlog — the same
    // rule /work keeps between its own sources.
    const [work, forge] = await Promise.all([
      getJSON('/work'),
      getJSON('/forge/status')
        .then((data) => ({ ok: true, data }))
        .catch((e) => ({ ok: false, detail: e && e.message ? e.message : String(e) })),
    ]);
    lastGood = { work, forge, at: new Date().toISOString() };
    render(work, forge, null);
  } catch (err) {
    // /work is the one read this list cannot do without: the desk IS the
    // backlog, and a backlog that could not be read is unknown, never empty.
    // /forge/status is settled above instead, so a sandbox failure costs one
    // row and not the whole section.
    const detail = err && err.message ? err.message : String(err);
    if (lastGood) {
      // Keep the last TRUE picture — blanking it would throw away real
      // information — but say plainly that it has stopped being current. A
      // stale list that does not know it is stale is the worse of the two.
      render(lastGood.work, lastGood.forge, { detail, at: lastGood.at });
      return;
    }
    paintUnreadable(detail);
  } finally {
    reading = false;
  }
}

/* ---- boot ------------------------------------------------------------------ */

let started = false;
function deskVisible() {
  const command = document.querySelector('[data-surface="command"]');
  const disclosure = document.getElementById('cmd-desk');
  return document.visibilityState === 'visible'
    && !command?.hidden
    && command?.dataset.commandPanel === 'cmd-hero'
    && Boolean(disclosure?.open);
}

export function init() {
  if (started) return; started = true;
  if (!mountEl()) return;
  paintUnread();
  if (deskVisible()) refresh();

  // The same signal field.js listens for, with the same slow poll as a floor.
  window.addEventListener('zeno:state', () => { if (deskVisible()) refresh(); });
  window.addEventListener('zeno:command-panel', () => { if (deskVisible()) refresh(); });
  document.getElementById('cmd-desk')?.addEventListener('toggle', () => { if (deskVisible()) refresh(); });
  setInterval(() => { if (deskVisible()) refresh(); }, 15000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init());
} else {
  init();
}

export default { init };
