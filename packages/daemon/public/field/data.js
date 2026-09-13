/*
 * field/data.js — the daemon reads, and refresh(): one fetch, wired to every
 * renderer that depends on it (the topology, the masthead readouts, the
 * canvas, the list view and the node card), so none of them can ever
 * disagree about what the daemon just said.
 */

import { authHeaders, S, F } from './state.js';
import { g } from './attention.js';
import { buildTopology } from './topology.js';
import { renderReadouts } from './readouts.js';
import { draw } from './engine.js';
import { renderList } from './list.js';
import { renderNodeCard } from './card.js';

async function getJSON(path) {
  const res = await fetch(path, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

/* /forge/agents is the one read that makes the DAEMON reach out — it asks
   Ollama for its installed models. Every other read here is a local one, so
   this is the only one that is throttled: once at boot, then at most once a
   minute. A stale model list is a far smaller cost than polling a runtime four
   times a minute forever. */
const AGENTS_MIN_MS = 60000;
let AGENTS = null;
let agentsRead = false;   // a FAILED read counts as read, or a daemon that cannot
let agentsAt = 0;         // answer this route gets asked again every fifteen seconds

/* Forces the next refresh() to ask Ollama again instead of trusting the cache
   — used when field.js knows the local runtime may have changed (a
   zeno:runtime-refresh signal, or Command becoming visible again). */
export function invalidateAgents() {
  agentsRead = false;
  agentsAt = 0;
}

export async function refresh(listEl) {
  const wantAgents = !agentsRead || (Date.now() - agentsAt) > AGENTS_MIN_MS;
  // Every read is settled on its own and every failure falls back to a shape
  // that contributes NO nodes. A daemon with no vault, no meeting archive or no
  // Ollama simply draws a smaller field — it never draws a guessed one.
  //
  // The fallbacks below are marked `unread`. Drawing NO node from a failed read
  // is right — the field must never draw a guessed one — but the same shapes are
  // handed to renderReadouts, which turned them into SENTENCES. An unreachable
  // daemon therefore printed "Nothing is waiting on you." and three green zeros
  // across the masthead: the most reassuring claim in the product, asserted from
  // a read that never happened, while the summary strip one section below still
  // (correctly) said 2 were waiting. `unread` is what lets a count tell the
  // difference between "none" and "not known" — the rule command.js states as H1
  // and keeps, and this file did not.
  const [state, work, forge, mem, meetings, agents] = await Promise.all([
    getJSON('/state').catch(() => ({ pending: [], receipts: [], unread: true })),
    getJSON('/work').catch(() => ({ sources: [], items: [], unread: true })),
    getJSON('/forge/status').catch(() => ({ repo: false, unread: true })),
    getJSON('/memory').catch(() => null),          // null = no vault, or unread: no node
    getJSON('/counsel/meetings').catch(() => null),
    // Command observes a running local runtime but never starts one merely to
    // paint the orb. Opening Forge or explicitly running locally may start it.
    wantAgents ? getJSON('/forge/agents?passive=1').catch(() => null) : Promise.resolve(AGENTS),
  ]);
  if (wantAgents) { AGENTS = agents; agentsRead = true; agentsAt = Date.now(); }
  buildTopology(state, work, forge, mem, meetings, agents);
  renderReadouts(state, work, forge, mem, agents);
  if (S.sel && !g(S.sel)) S.sel = null;   // the thing you had selected is gone
  if (F.c) draw();
  renderList(listEl);
  renderNodeCard();
}
