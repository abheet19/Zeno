/*
 * field/topology.js — the honest topology: real daemon state -> nodes + edges.
 *
 * WHAT IS NOT PORTED from the Gate-2 prototype is its data. Every node here is
 * built from live daemon state — GET /state, /work, /forge/status, /memory,
 * /counsel/meetings, /forge/agents, and (for the agent-run nodes) whatever
 * field/runs.js has read off GET /forge/run-progress — and when a category is
 * empty the field simply shows fewer nodes. Nothing is invented to fill a hole: a quiet field
 * is the honest picture of a quiet system, and it says so in words rather than
 * drawing a busy one. There is no Jira node, no merge-request node and no
 * teammate node, because there is no Jira, no merge request and no team.
 *
 * GLOW = state · LINKS = relationship · SIZE and PULSE RATE = how much a thing
 * wants you. A dashed amber edge with a ⚡ is an egress edge: a link that
 * actually leaves this machine. THE LOCAL MODEL RUNTIME IS NOT ONE. Ollama
 * answers on 127.0.0.1:11434, so it is drawn with an ordinary edge; only a
 * genuinely off-machine source — GitHub, a hosted agent — earns the ⚡.
 */

import { pendingRepoEdge } from '../field-model.js';
import { N, E, ACT, S, clip } from './state.js';
import { minutesSince, ageStr } from './attention.js';
import { PHASE_LABEL } from './runs.js';

/* ---- geometry: a deterministic fibonacci sphere, core at the centre --------
   The prototype hand-placed seventeen known nodes. We cannot: the node list is
   whatever the daemon actually holds. A golden-angle sphere is the honest
   substitute — any count reads as an even, organic constellation rather than a
   grid, and the same state always produces the same picture. */
function placeNodes(list) {
  const rest = list.length - 1;
  const GA = Math.PI * (3 - Math.sqrt(5));
  list.forEach((n, i) => {
    if (i === 0) { n.hx = 0; n.hy = 0; n.hz = 0; }
    else {
      const k = i - 1;
      const y = rest <= 1 ? 0 : 1 - (k / (rest - 1)) * 2; // -1..1
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * k;
      n.hx = Math.cos(th) * rad * 0.9;
      n.hy = y * 0.84;
      n.hz = Math.sin(th) * rad * 0.9;
    }
    n.ph = i * 2.399963; // golden-angle phases: organic, non-repeating drift
    n.x = n.hx; n.y = n.hy; n.z = n.hz;
  });
}

function sourceAtt(s) {
  // ok and not-configured are calm — a source you never asked is not a problem.
  return s.state === 'failed' ? 'error' : s.state === 'partial' ? 'needs' : null;
}

export function buildTopology(state, work, forge, mem, meetings, agents, runs = []) {
  const nodes = [];
  const edges = [];
  const act = [];

  // 1 · the core — always true: this is the daemon you are talking to.
  nodes.push({
    id: 'core', l: 'Zeno', k: 'core',
    d: 'The coordinating core — the gate every consequential effect passes through. It proposes nothing and approves nothing on its own.',
  });

  // 2 · the three products — real surfaces this daemon actually serves.
  nodes.push({ id: 'command', k: 'agent', l: 'Command', nav: 'command', d: 'The approval surface. Every consequential effect stops here for your yes, with its payload, tier and hash binding shown in full.' });
  nodes.push({ id: 'forge', k: 'agent', l: 'Forge', nav: 'forge', d: 'The governed coding surface over the sandbox repo. It can propose a change; it cannot approve its own output.' });
  nodes.push({ id: 'counsel', k: 'agent', l: 'Counsel', nav: 'counsel', d: 'The consent-first meeting surface. The desktop uses local Whisper when installed; browser fallback may send microphone audio to the browser speech provider. Saved transcript text stays on this machine and detected secrets are redacted first.' });
  edges.push(['core', 'command'], ['core', 'forge'], ['core', 'counsel']);

  // 3 · this machine — honestly, the one device that exists.
  nodes.push({ id: 'dev', k: 'dev', l: 'This PC', d: 'The Windows host this daemon runs on. Trust is per-device and earned: this is the only device on the mesh.' });
  edges.push(['core', 'dev']);

  // 4 · the sandbox repo, if the daemon reports one.
  const changed = (forge && Array.isArray(forge.changed)) ? forge.changed.length : 0;
  if (forge && forge.repo) {
    const branch = forge.branch || 'sandbox';
    nodes.push({
      id: 'repo', k: 'repo', l: clip(branch, 17),
      att: changed > 0 ? 'active' : null,
      d: `The Forge sandbox repository on ${branch}${forge.head ? ' @ ' + String(forge.head).slice(0, 7) : ''} — ${changed ? `${changed} uncommitted change${changed === 1 ? '' : 's'}` : 'clean'}.`,
    });
    edges.push(['core', 'repo'], ['forge', 'repo']);
    if (changed > 0) { act.push('repo', 'forge'); }
  }

  // 5 · work sources — real intake, with the state the daemon actually reports.
  //     A source that is CONFIGURED but did not fully answer is drawn as srcq:
  //     a source you can cite but cannot rely on. An edge to a source that
  //     genuinely leaves this machine is an EGRESS edge — dashed amber, ⚡.
  const sources = (work && Array.isArray(work.sources)) ? work.sources : [];
  sources.forEach((s, i) => {
    const id = 'src' + i;
    const configured = s.state !== 'not-configured';
    const shaky = s.state === 'failed' || s.state === 'partial';
    const leaves = configured && s.name !== 'local';
    nodes.push({
      id, k: shaky ? 'srcq' : 'src', l: clip(s.name || `source ${i + 1}`, 18),
      att: sourceAtt(s),
      d: s.detail || `Work source · ${s.state}${s.count == null ? '' : ` · ${s.count} item${s.count === 1 ? '' : 's'}`}. A source is read-only: it can be cited, never obeyed.`,
    });
    // the third element marks the edge as egress, exactly as in the prototype
    edges.push(leaves ? ['core', id, 'eg'] : ['core', id]);
  });

  // 6 · pending approvals — the things actually waiting on you.
  const pending = (state && Array.isArray(state.pending)) ? state.pending : [];
  pending.forEach((p, i) => {
    const id = 'pend' + i;
    const summary = p.summary || (p.request && p.request.summary) || p.actionHash || `pending ${i + 1}`;
    nodes.push({
      id, k: 'ticket', l: clip(summary, 26), hash: p.actionHash,
      /* Attention comes from what the capsule ACTUALLY carries. A /state
         pending item exposes { actionHash, auto, binding, denied, payload,
         reasons, summary, tier } and NO `state` field — so reading p.state made
         every waiting approval fall through to "waiting" and draw calm grey.
         The single most urgent thing in the product was the one thing that
         never lit up. Being IN this list IS the fact: it is waiting on you. */
      att: p.denied ? 'error' : 'needs',
      /* No ageMin: nothing in the pending record carries a timestamp, and an
         invented one would be a lie told in the most load-bearing place on the
         screen. urgOf() reads 0 and the glow sits at its base strength. */
      d: p.denied
        ? `${summary} — refused by policy${p.tier ? ` at tier ${p.tier}` : ''}. ${(p.reasons || []).join(' · ') || 'No reason was recorded.'}`
        : `${summary} — tier ${p.tier || '?'}, waiting for your approval. Opening it is not approving it.`,
    });
    edges.push(['core', id], ['command', id]);
    const repoEdge = pendingRepoEdge(id, forge);
    if (repoEdge) edges.push(repoEdge);
  });

  // 7 · the live backlog — real work items, each hung off the source it came from.
  const items = (work && Array.isArray(work.items)) ? work.items : [];
  items.slice(0, 6).forEach((it, i) => {
    const id = 'wi' + i;
    const title = it.title || it.id || 'item';
    const age = minutesSince(it.updatedAt);
    nodes.push({
      id, k: 'ticket', l: clip(title, 22), att: 'waiting', work: true,
      ageMin: age == null ? undefined : age,
      d: `${title} — from ${it.source || 'the backlog'}${age == null ? '' : `, last touched ${ageStr(age)} ago`}. Assigned, not started: Zeno is holding it, not working it.`,
    });
    const si = sources.findIndex((s) => s.name === it.source);
    edges.push([id, si >= 0 ? 'src' + si : 'core']);
  });

  // 8 · the trail — the last few receipts Zeno actually wrote, verified or not.
  const receipts = (state && Array.isArray(state.receipts)) ? state.receipts : [];
  receipts.slice(-4).forEach((r, i) => {
    const id = 'rc' + i;
    const ok = (r.outcome || r.state) === 'verified';
    const lab = r.summary || r.targetRef || r.actionHash || 'receipt';
    const age = minutesSince(r.at);
    nodes.push({
      id, k: 'ticket', l: clip(lab, 22), att: ok ? 'verified' : 'error',
      ageMin: age == null ? undefined : age, receipt: true,
      d: `${lab} — ${r.outcome || r.state || 'outcome not recorded'}${r.tier ? ` · tier ${r.tier}` : ''}${age == null ? '' : ` · ${ageStr(age)} ago`}. Signed and chained; the seal rendered after the receipt, never before it.`,
    });
    edges.push(['core', id]);
  });

  // 9 · governed memory — the Vault, and the notes actually in it.
  //     The hub node exists only when GET /memory ANSWERED: a daemon started
  //     with no vault directory 404s, and drawing an empty Vault there would
  //     claim a store this machine does not have. Notes are facts at rest, so
  //     they carry no attention state — nothing in the Vault is asking for you.
  const notes = (mem && Array.isArray(mem.notes)) ? mem.notes : [];
  if (mem) {
    nodes.push({
      id: 'vault', k: 'vault', l: 'Vault',
      d: `Governed local memory — ${notes.length} note${notes.length === 1 ? '' : 's'} the daemon returned on this read, each a file on this disk, redacted for secrets before it was written.`,
    });
    edges.push(['core', 'vault']);
    notes.slice(0, 6).forEach((n, i) => {
      const id = 'mem' + i;
      const age = minutesSince(n.updatedAt || n.createdAt);
      const tags = Array.isArray(n.tags) ? n.tags : [];
      nodes.push({
        id, k: 'mem', l: clip(n.title || n.id || 'a note', 22),
        d: `${n.title || n.id || 'A note'} — from ${n.source || 'an unrecorded source'}${age == null ? '' : `, last touched ${ageStr(age)} ago`}${tags.length ? ` · ${tags.join(', ')}` : ''}. A remembered fact, not a task: it is not waiting on you.`,
      });
      edges.push([id, 'vault']);
    });
  }

  // 10 · past meetings — hung off Counsel, which is the surface that owns them.
  //      No hub is invented: the Counsel node already exists above.
  const mtgs = (meetings && Array.isArray(meetings.meetings)) ? meetings.meetings : [];
  mtgs.slice(0, 5).forEach((m, i) => {
    const id = 'mt' + i;
    const age = minutesSince(m.endedAt || m.startedAt);
    const c = (m && typeof m.counts === 'object' && m.counts) || {};
    nodes.push({
      id, k: 'meet', l: clip(m.title || m.id || 'a meeting', 22),
      ageMin: age == null ? undefined : age,
      d: `${m.title || m.id || 'A meeting'} — ${c.lines == null ? 'a recording' : `${c.lines} line${c.lines === 1 ? '' : 's'}`}${c.decisions ? `, ${c.decisions} decision${c.decisions === 1 ? '' : 's'}` : ''}${c.actions ? `, ${c.actions} action${c.actions === 1 ? '' : 's'}` : ''}${age == null ? '' : ` · ${ageStr(age)} ago`}. Saved and summarised as local Markdown; credential-like secrets were redacted before persistence.`,
    });
    edges.push([id, 'counsel']);
  });

  // 11 · the LOCAL model runtime, and the models actually installed on it.
  //      OLLAMA IS ON THIS MACHINE, so this edge is an ordinary one — never the
  //      dashed amber egress edge. Only a link that genuinely leaves the machine
  //      gets that, and this one does not leave 127.0.0.1.
  //
  //      The node appears only when at least one model came back. /forge/agents
  //      returns an empty list both when Ollama is stopped and when it is
  //      running with nothing pulled, so an empty answer cannot honestly be
  //      drawn as a runtime that is there — the field is simply quieter.
  const models = (agents && Array.isArray(agents.localModels)) ? agents.localModels : [];
  if (models.length) {
    nodes.push({
      id: 'runtime', k: 'runtime', l: 'Local models',
      d: `Ollama on 127.0.0.1:11434 — it answered with ${models.length} installed model${models.length === 1 ? '' : 's'}. A local run reaches nothing outside this machine, so this link is not an egress.`,
    });
    edges.push(['core', 'runtime'], ['forge', 'runtime']);
    models.slice(0, 6).forEach((m, i) => {
      const id = 'ml' + i;
      nodes.push({
        id, k: 'model', l: clip(m, 20), model: m,
        d: `${m} — installed locally and pickable in Forge. It runs on this machine; nothing it is asked leaves it.`,
      });
      edges.push([id, 'runtime']);
    });
  }

  // 12 · live agent runs — the thing Command actually orchestrates, not the
  //      sandbox's uncommitted-changes proxy in section 4. Each entry comes
  //      straight from the daemon's own /forge/run-progress stream (see
  //      field/runs.js), so a run that never started, or one this window
  //      never subscribed to (no owner token), draws no node here. A run
  //      still flashing its terminal outcome (see runs.js's hold window)
  //      reads verified/error/waiting instead of active, then vanishes when
  //      runs.js drops it from the map — never mid-glow.
  runs.forEach((r) => {
    const id = 'run' + r.runId;
    const att = !r.terminal ? 'active' : r.outcome === 'failed' ? 'error' : r.outcome === 'cancelled' ? 'waiting' : 'verified';
    const phaseKey = r.terminal ? (r.outcome || r.phase) : r.phase;
    const phaseWord = PHASE_LABEL[phaseKey] || phaseKey || 'Working';
    const who = r.model ? `${r.agentId || 'agent'} · ${r.model}` : (r.agentId || 'agent');
    nodes.push({
      id, k: 'run', l: clip(who, 22), att, run: r,
      d: `${phaseWord}${r.terminal ? '' : ` · ${Number.isFinite(r.percent) ? r.percent : 0}%`} — reported live by the daemon's own progress stream.`,
    });
    edges.push(['forge', id]);
    if (!r.terminal) act.push(id, 'forge');
  });

  placeNodes(nodes);
  // N/E/ACT are shared, fixed containers (see state.js) — refilled in place so
  // every module that imported them sees the new topology immediately.
  N.length = 0; N.push(...nodes);
  E.length = 0; E.push(...edges);
  // "live" is what is genuinely in flight, so a live edge means both ends are
  // actually doing something. With nothing running the set is empty and no edge
  // is highlighted — which is the correct picture of a system at rest.
  ACT.length = 0;
  if (act.length) ACT.push(...act, 'core');

  // The empty note is only true when the whole machine is quiet, so it counts
  // everything the field can now draw — not just the things that want you.
  const liveThings = pending.length + sources.filter((s) => s.state !== 'not-configured').length
    + (changed ? 1 : 0) + items.length + notes.length + mtgs.length + models.length + receipts.length + runs.length;
  // An empty field has two causes and they are not the same fact. "Quiet" is a
  // statement about a daemon that ANSWERED; when the reads that feed this field
  // failed, the field is empty because nothing could be read, and calling that
  // quiet would be the masthead's old lie repeated on the map.
  const unread = !!((state && state.unread) || (work && work.unread) || (forge && forge.unread));
  S.emptyNote = liveThings !== 0
    ? null
    : unread
      ? 'The field is empty because the daemon could not be read — not because nothing is there. Whatever Zeno is holding is unknown from this window until the read succeeds.'
      : 'A quiet field — nothing is waiting on you. Approvals, work sources, memory, meetings, local models and repo activity appear here as they arrive.';
}
