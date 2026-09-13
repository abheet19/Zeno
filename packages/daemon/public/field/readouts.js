/*
 * field/readouts.js — the masthead, chips, tally, rail counts and breadcrumb.
 * All written from ONE fetch, so no two readouts on this surface can disagree.
 * Every number here counts something the daemon actually reported.
 */

import { token, esc, clip } from './state.js';

function setText(mount, v) { const e = document.querySelector(`[data-mount="${mount}"]`); if (e) e.textContent = v == null ? '' : String(v); }

export function renderReadouts(state, work, forge, mem, agents) {
  const pending = (state && Array.isArray(state.pending)) ? state.pending : [];
  const receipts = (state && Array.isArray(state.receipts)) ? state.receipts : [];
  const items = (work && Array.isArray(work.items)) ? work.items : [];
  const sources = (work && Array.isArray(work.sources)) ? work.sources : [];
  const changed = (forge && Array.isArray(forge.changed)) ? forge.changed.length : 0;
  const needs = pending.filter((p) => !p.denied).length;
  const denied = pending.length - needs;
  const verified = receipts.filter((r) => (r.outcome || r.state) === 'verified').length;
  const liveSources = sources.filter((s) => s.state !== 'not-configured').length;
  /* WHAT CAN LEAVE THIS MACHINE — counted by the same rule the Integrations
     panel uses to paint its amber ⚡ rows, so the masthead and that panel can
     never disagree. Two kinds qualify:

       · a work source that is somewhere else AND is switched on (an unasked
         GitHub is marked "would leave — nothing has been sent" there, not
         amber, so it does not count here either); and
       · every coding agent the daemon offers whose id is not "local" — those
         run their own CLI against their own provider.

     Counting only the first kind was the bug: this chip read a green "0 egress
     sources" on a page that was, three sections lower, marking Claude Code
     "⚡ reaches its own provider". A masthead that under-reports the ways out
     of this machine is the one number here that must never be optimistic. */
  const egressSources = sources.filter((s) => s.state !== 'not-configured' && s.name !== 'local').length;
  const egressAgents = (agents && Array.isArray(agents.agents))
    ? agents.agents.filter((a) => a && a.id !== 'local').length
    : 0;
  const egress = egressSources + egressAgents;

  /* WHICH READS ACTUALLY ANSWERED. A count may only be printed by the read that
     produced it: `unread` marks the fallback shape refresh() substitutes when a
     fetch failed, and a zero from that shape is not a zero — it is an absence of
     an answer. Nothing below prints a number whose read did not return. */
  const stateUnread = !!(state && state.unread);
  const workUnread = !!(work && work.unread);
  const forgeUnread = !!(forge && forge.unread);

  /* the tally under the hero */
  const tally = document.querySelector('[data-mount="tally"]');
  if (tally) {
    const parts = [];
    if (needs) parts.push(`<span class="am">${needs}</span> needs you`);
    if (denied) parts.push(`<span class="rd">${denied}</span> refused`);
    if (changed) parts.push(`<span class="cy">${changed}</span> in the sandbox`);
    if (items.length) parts.push(`<span>${items.length}</span> in the backlog`);
    if (verified) parts.push(`<span class="gr">${verified}</span> verified`);
    tally.innerHTML = parts.length ? parts.join('<span class="sep"></span>') : '<span>nothing outstanding</span>';
  }
  // "Zeno is holding nothing" is a claim about three reads. It may only be made
  // when all three answered; otherwise the honest line is that it is not known.
  setText('today-sub', (stateUnread || workUnread || forgeUnread)
    ? 'This window could not finish reading the daemon, so what Zeno is holding is unknown from here — not empty.'
    : (needs || items.length || changed)
      ? 'Everything Zeno is holding, and what it is waiting for.'
      : 'Zeno is holding nothing. Work, approvals and receipts appear here as they arrive.');

  /* the rail counts — blank, not zero: a "0" badge claims a queue that is not there */
  const railN = (mount, v, att) => {
    const e = document.querySelector(`[data-mount="${mount}"]`);
    if (!e) return;
    e.textContent = v ? String(v) : '';
    if (att && v) e.setAttribute('data-att', att); else e.removeAttribute('data-att');
  };
  railN('rail-today', needs + items.length, needs ? 'needs' : null);
  railN('rail-approvals', pending.length, needs ? 'needs' : null);
  // rail-devices is deliberately NOT written here. This module never reads
  // /mesh/devices, and it used to print a hard-coded 1 — a number asserted
  // rather than counted, which would have stayed 1 the day a second device
  // paired. mesh.js owns that badge because mesh.js is what reads the route.
  // The four rail items that used to be dead now carry the same kind of count:
  // an array length, or nothing. A source that could not be read contributes no
  // number at all rather than a zero that would claim it answered.
  // Uncommitted changes are IN the sandbox, not waiting on a yes, so this count
  // is never amber: amber on the rail means something wants a decision from you.
  railN('rail-workstation', changed);
  railN('rail-vault', (mem && Array.isArray(mem.notes)) ? mem.notes.length : 0);
  railN('rail-integrations', liveSources + ((agents && Array.isArray(agents.localModels)) ? agents.localModels.length : 0));

  /* ---- the two-column Home: greeting, banner, kernel line and the rail -------
     Every value below is one of the counts computed above from the SAME fetch,
     so the banner, the rail and the kernel line can never disagree with the orb
     or the tally. A read that did not answer is drawn as an honest empty state
     or an em dash — never a fabricated number. */
  const agentsUnread = !(agents && Array.isArray(agents.agents));

  // Time-based greeting. The daemon has exactly one local owner.
  const greetEl = document.querySelector('[data-mount="greet"]');
  if (greetEl) {
    let hr = 12; try { hr = new Date().getHours(); } catch { /* no clock */ }
    const part = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
    greetEl.textContent = `Good ${part}, Abheet.`;
  }

  // The orb's one-line state summary — the count that used to be the headline.
  setText('orb-state', stateUnread
    ? 'state unread · the daemon did not answer'
    : needs === 0
      ? 'all clear · nothing is waiting on you'
      : `${needs} ${needs === 1 ? 'decision needs you' : 'decisions need you'}`);

  // The amber banner: shown ONLY when the queue genuinely holds something.
  const attn = document.querySelector('[data-mount="attn"]');
  if (attn) {
    const on = !stateUnread && needs > 0;
    attn.hidden = !on;
    if (on) {
      const c = attn.querySelector('[data-mount="attn-count"]');
      const l = attn.querySelector('[data-mount="attn-label"]');
      if (c) c.textContent = String(needs);
      if (l) l.textContent = needs === 1 ? 'decision' : 'decisions';
    }
  }

  // The persistent kernel line under the composer. The receipt count and the
  // chain state come from THIS /state snapshot; the owner-token state is whether
  // the daemon handed this window a token. Ed25519 signing and the built-in
  // policy describe how the kernel is built, so they are stated, not counted.
  const kernel = document.querySelector('[data-mount="kernel"]');
  if (kernel) {
    const rc = receipts.length;
    const chainOk = (state && state.chain && typeof state.chain.ok === 'boolean') ? state.chain.ok : null;
    const dot = chainOk === true ? '<span class="ok"></span>'
      : chainOk === false ? '<span class="ok rd"></span>'
        : '<span class="ok un"></span>';
    const chainWord = stateUnread ? 'chain unread'
      : chainOk === true ? 'chain verified'
        : chainOk === false ? 'chain broken'
          : 'chain not reported';
    const rcPart = stateUnread ? 'receipts unread' : `<b>${rc}</b> ${rc === 1 ? 'receipt' : 'receipts'}`;
    const owner = token() ? '<b>owner token</b> held' : '<b>read-only</b> · no owner token';
    kernel.innerHTML =
      `<span>${dot}<b>${chainWord}</b></span><span class="sep"></span>`
      + `<span>${rcPart}</span><span class="sep"></span>`
      + '<span><b>Ed25519</b> signed</span><span class="sep"></span>'
      + `<span>${owner}</span><span class="sep"></span>`
      + '<span>policy <b>built-in</b></span>';
  }

  const SVG_APPROVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>';
  const SVG_FORGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>';

  // "Needs you" — the approvals actually waiting, straight from /state pending.
  setText('needs-sum', stateUnread ? '' : (needs ? String(needs) : ''));
  const needsBody = document.querySelector('[data-mount="needs-body"]');
  if (needsBody) {
    if (stateUnread) {
      needsBody.innerHTML = '<div class="hs-empty">The approval queue could not be read. Treat this as unknown, not clear.</div>';
    } else if (needs === 0) {
      needsBody.innerHTML = '<div class="hs-empty">Nothing is waiting on you.</div>';
    } else {
      const waiting = pending.filter((p) => !p.denied).slice(0, 3);
      needsBody.innerHTML = waiting.map((p) => {
        const summary = esc(clip(p.summary || (p.request && p.request.summary) || p.actionHash || 'a pending action', 44));
        const meta = esc(p.tier ? `tier ${p.tier} · held for your approval` : 'held for your approval');
        return '<div class="lcard needs">'
          + `<div class="lk">${SVG_APPROVE}<span>${summary}</span></div>`
          + `<div class="lm">${meta}</div>`
          + '<div class="lr"><span class="pill am"><span class="d"></span>1 approval</span>'
          + '<button type="button" class="laction" data-goto="#pending">Review</button></div>'
          + '</div>';
      }).join('');
      if (needs > waiting.length) {
        needsBody.insertAdjacentHTML('beforeend', `<div class="hs-empty">+ ${needs - waiting.length} more in the queue.</div>`);
      }
    }
  }

  // "Running" — the sandbox worktree from /forge/status. There is no daemon
  // route this window can read for live agent sessions, so this reports the one
  // genuine in-flight signal it has: the sandbox's uncommitted changes.
  setText('running-sum', forgeUnread ? '' : (changed ? '1' : ''));
  const runningBody = document.querySelector('[data-mount="running-body"]');
  if (runningBody) {
    if (forgeUnread) {
      runningBody.innerHTML = '<div class="hs-empty">The sandbox could not be read.</div>';
    } else if (changed > 0) {
      const branch = esc(clip((forge && forge.branch) || 'sandbox', 20));
      const head = (forge && forge.head) ? ' @ ' + esc(String(forge.head).slice(0, 7)) : '';
      runningBody.innerHTML = '<div class="lcard">'
        + `<div class="lk">${SVG_FORGE}<span>Forge sandbox · ${branch}</span></div>`
        + `<div class="lm">${changed} uncommitted change${changed === 1 ? '' : 's'}${head}</div>`
        + '<div class="lr"><span class="pill cy"><span class="d"></span>in the sandbox</span>'
        + '<button type="button" class="laction" data-go="forge">Open Forge</button></div>'
        + '</div>';
    } else {
      runningBody.innerHTML = '<div class="hs-empty">No active runs. The sandbox is clean; a Forge run shows here while it works.</div>';
    }
  }

  // "Today" — the same tally counts, one per row; an unread read shows an em dash.
  const stat = (mount, val, unread) => { const e = document.querySelector(`[data-mount="${mount}"]`); if (e) e.textContent = unread ? '—' : String(val); };
  stat('today-verified', verified, stateUnread);
  stat('today-sandbox', changed, forgeUnread);
  stat('today-backlog', items.length, workUnread);
  stat('today-memories', (mem && Array.isArray(mem.notes)) ? mem.notes.length : 0, !(mem && Array.isArray(mem.notes)));
  stat('today-egress', egress, (workUnread || agentsUnread));
}
