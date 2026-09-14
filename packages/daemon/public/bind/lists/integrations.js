/**
 * bind/lists/integrations.js — INTEGRATIONS screen: everything that reaches
 * OUT of this machine, or could. Work sources, the model runtime (local
 * Ollama and hosted agents), Zeno's bundled connectors, and the MCP servers
 * the owner records. What shapes a run from INSIDE the repository — rules,
 * skills, the local extensions catalog — is Customize's job
 * (bind/lists/customize.js), so the two screens no longer draw the same
 * catalog twice.
 *
 * Draws a `.live-cards` of `.lcard`s (`.lk`/`.lm`/`.lr`) — NOT the `.lrow`
 * shape the other screens use. Sections:
 *   work sources   GET /work's `sources` — each with whether it is configured,
 *                  whether it answered, and whether a call leaves the machine.
 *   model runtime  GET /forge/agents — Ollama's local model list and each
 *                  agent backend's availability, with its egress stated.
 *   connectors     GET /forge/connectors — Zeno's own bundled, run-scoped
 *                  bridges. "Yours" shows their live state; "Discover" says
 *                  what each is and the daemon startup switch that turns it
 *                  on. There is NO "+ Add": the set is fixed, this daemon
 *                  holds no third-party accounts, and there is no external
 *                  connector catalog to browse.
 *   MCP servers    GET/POST/DELETE /forge/mcp/servers via bind/lists/mcp.js:
 *                  real add (names-only env keys) and remove, plus a
 *                  "Discover" list of templates that pre-fill the form.
 *
 * Nothing here is the artifact's invented GitHub/Vantage/Chrome-bridge fixture
 * rows — those are replaced outright by whatever the daemon actually reports,
 * including "nothing configured". See bind/lists.js for the endpoint list.
 */

import { getJSON, el, fill, token, screenEl } from '../../bind.js';
import {
  plural, disableBtn, lcardOuter, pillEl, noteEl, headingEl, viewToggleEl, connectorFacts,
  postJSON, textareaEl, formBox, statusEl,
} from './shared.js';
import { createMcpManager } from './mcp.js';
import { connectorDiscoverNode } from './discover.js';

const YOURS_DISCOVER = [{ value: 'yours', label: 'Yours' }, { value: 'discover', label: 'Discover' }];

function lcardNote(text, err) {
  return lcardOuter(text, err ? String(err) : 'Nothing is configured here yet.', pillEl(err ? 'could not read' : 'none', err ? 'rd' : 'wt'));
}
function sourceCard(s) {
  const configured = s.state !== 'not-configured';
  const remote = s.name !== 'local';
  const stateWord = s.state === 'ok' ? 'answered in full'
    : s.state === 'partial' ? 'answered in part'
      : s.state === 'failed' ? 'did not answer' : 'never asked';
  const stateCls = s.state === 'ok' ? 'gr' : s.state === 'partial' ? 'am' : s.state === 'failed' ? 'rd' : 'wt';
  const egress = !remote ? 'stays on this machine' : (configured ? 'leaves this machine' : 'would leave this machine');
  const meta = [configured ? 'configured' : 'not configured', stateWord, egress,
    s.count == null ? null : s.count + ' ' + plural(s.count, 'item', 'items')].filter(Boolean).join(' · ');
  return lcardOuter(s.name || 'a work source', meta, pillEl(stateWord, stateCls));
}
function ollamaCard(models) {
  const has = models.length > 0;
  const meta = has
    ? models.length + ' ' + plural(models.length, 'model', 'models') + ' installed — stays on this machine'
    : 'No models listed — the same answer whether Ollama is stopped or has nothing pulled.';
  return lcardOuter('Ollama · 127.0.0.1:11434', meta, pillEl(has ? 'answered' : 'no models', has ? 'gr' : 'am'));
}
function agentCard(a) {
  const local = a.id === 'local';
  const meta = [a.available ? 'runnable now' : 'unavailable', local ? 'local runtime' : 'hosted provider',
    local ? 'stays on this machine' : 'sends code to its provider'].join(' · ');
  return lcardOuter(a.label || a.id || 'agent', meta, pillEl(a.available ? 'available' : 'unavailable', a.available ? 'gr' : 'wt'));
}
function connectorCard(c) {
  const f = connectorFacts(c);
  const card = lcardOuter(f.name, f.meta, pillEl(f.pillText, f.pillCls));
  if (f.permissions) card.appendChild(noteEl(f.permissions));
  return card;
}

/* ---- autonomous intake — POST /intake/gather --------------------------- *
 *
 * The owner: point Zeno at a task ("fix the flaky login test, owner/repo#482")
 * and let it gather what a human would gather by hand — the GitHub issue or
 * Jira ticket it names, the owner's own connected NeoSapien memory, and which
 * local repository on this machine it is probably about — instead of typing
 * each of those in separately. Read-only: the request changes nothing, and
 * this card only ever shows what the daemon found, or honestly says it could
 * not (Jira and NeoSapien both need a credential this daemon does not
 * fabricate; a repo scan reports the roots it actually managed to read). */
const intake = { task: '', busy: false, result: null, error: null };

function intakeReferenceLine(refs) {
  const parts = [];
  if (refs && refs.github) parts.push(`GitHub ${refs.github.owner}/${refs.github.repo}#${refs.github.number}`);
  if (refs && refs.jira) parts.push(`Jira ${refs.jira.key}`);
  return parts.length ? `Found in the task: ${parts.join(', ')}.` : 'No GitHub issue or Jira ticket reference was found in the task text.';
}
function intakeSourceLine(label, res, describeOk) {
  if (!res) return `${label}: not referenced in the task.`;
  return res.ok ? `${label}: ${describeOk(res)}` : `${label}: ${res.message || res.reason || 'unavailable'}`;
}
function intakeResultNode(result) {
  const lines = [
    intakeReferenceLine(result.references),
    intakeSourceLine('GitHub', result.github, (g) => `"${g.title || '(no title)'}" — ${g.state}${g.url ? ' — ' + g.url : ''}`),
    intakeSourceLine('Jira', result.jira, (j) => `"${j.issue.summary}" — ${j.issue.status} — ${j.issue.url}`),
    intakeSourceLine('NeoSapien', result.neosapien, (n) => `${n.hits.length} relevant ${plural(n.hits.length, 'memory', 'memories')} found`),
  ];
  const repos = (result.repos && result.repos.candidates) || [];
  const top = repos.filter((r) => r.score > 0).slice(0, 5);
  lines.push(top.length
    ? `Likely local repo: ${top.map((r) => `${r.name} (${r.path})`).join(', ')}`
    : ((result.repos && result.repos.note) || 'No local repository matched the task.'));

  const box = lcardOuter('Gathered context', lines[0], null);
  lines.slice(1).forEach((line) => box.appendChild(noteEl(line)));
  return box;
}
function intakeFormNode(hasOwner, rerender) {
  const box = formBox('lcard');
  box.appendChild(el('div', 'lk', 'Gather context for a task'));
  box.appendChild(noteEl('Paste the task the way you would say it. A GitHub issue (owner/repo#123) or Jira ticket '
    + '(ABC-123) reference is read automatically. Read-only — nothing here starts a run.'));
  box.appendChild(textareaEl('e.g. "Fix the flaky login test, owner/repo#482"', intake.task, (v) => { intake.task = v; }, 4));
  const go = el('button', 'btn sm p', intake.busy ? 'Gathering…' : 'Gather context');
  go.type = 'button';
  if (!hasOwner) disableBtn(go, 'This window has no owner token, so it cannot gather context.');
  else if (intake.busy) disableBtn(go, 'Already gathering — this finishes in a few seconds.');
  else {
    go.addEventListener('click', async () => {
      if (!intake.task.trim()) { intake.error = 'Give it a task to gather context for.'; rerender(); return; }
      intake.busy = true; intake.error = null; rerender();
      const r = await postJSON('/intake/gather', { task: intake.task.trim() });
      intake.busy = false;
      if (r.ok) { intake.result = r.data; intake.error = null; } else { intake.error = r.error; }
      rerender();
    });
  }
  box.appendChild(go);
  if (intake.error) box.appendChild(statusEl(intake.error));
  return box;
}

const integrationsMcp = createMcpManager('lcard');
// The Yours/Discover choice, the last successful reads and the renderer all
// live at module level: bind/live.js re-runs this binder on every
// state/receipt event, and /forge/agents probes the runtime on each read.
// While that probe is in flight the screen keeps drawing the LAST read — and
// a click (a template's "+ Add", the header's "+ Add MCP server") still
// redraws at once instead of waiting on a fetch it has nothing to do with.
const view = { connectors: 'yours' };
let last = null;         // { work, agents, connectors } from the latest completed read
let container = null;
let hasOwner = false;
let bindGeneration = 0;

function render() {
  if (!container || !last) return;
  const { work, agents, connectors } = last;
  const nodes = [];

  nodes.push(headingEl('work sources'));
  if (!work.ok) {
    nodes.push(lcardNote('Work sources could not be read.', work.error));
  } else {
    const sources = Array.isArray(work.data && work.data.sources) ? work.data.sources : [];
    if (!sources.length) nodes.push(lcardNote('No work source is configured.', null));
    sources.forEach((s) => nodes.push(sourceCard(s)));
  }

  nodes.push(headingEl('model runtime'));
  if (!agents.ok) {
    nodes.push(lcardNote('The local runtime could not be read.', agents.error));
  } else {
    const models = Array.isArray(agents.data && agents.data.localModels) ? agents.data.localModels : [];
    nodes.push(ollamaCard(models));
    const list = Array.isArray(agents.data && agents.data.agents) ? agents.data.agents : [];
    list.forEach((a) => nodes.push(agentCard(a)));
  }

  nodes.push(headingEl('connectors'));
  nodes.push(viewToggleEl(YOURS_DISCOVER, view.connectors, (v) => { view.connectors = v; render(); }));
  if (view.connectors === 'discover') {
    nodes.push(noteEl('What each bundled connector is and how it is switched on. Zeno holds no third-party accounts '
      + 'and has no external connector catalog to browse — this is the entire set, and each is turned on by a daemon '
      + 'startup switch (an environment variable read in packages/daemon/src/main.ts), not by an "Add" in this UI. '
      + 'Even switched on, every operation is still a governed call.'));
    if (!connectors.ok) {
      nodes.push(lcardNote('Connectors could not be read.', connectors.error));
    } else {
      const data = connectors.data || {};
      const servers = Array.isArray(data.servers) ? data.servers : [];
      const external = Array.isArray(data.external) ? data.external : [];
      if (!servers.length && !external.length) nodes.push(lcardNote('No connector is registered.', null));
      servers.forEach((c) => nodes.push(connectorDiscoverNode('lcard', c)));
      external.forEach((c) => nodes.push(connectorDiscoverNode('lcard', c)));
    }
  } else {
    nodes.push(noteEl('Zeno holds no third-party accounts and never simulates a connection. Each entry below is a '
      + 'bundled bridge Forge may admit into a governed run — not an external account, and nothing here is '
      + 'connected unless it says "configured" or "attached".'));
    if (!connectors.ok) {
      nodes.push(lcardNote('Connectors could not be read.', connectors.error));
    } else {
      const data = connectors.data || {};
      if (data.note) nodes.push(noteEl(String(data.note)));
      const servers = Array.isArray(data.servers) ? data.servers : [];
      if (!servers.length) nodes.push(lcardNote('No connector is registered.', null));
      servers.forEach((c) => nodes.push(connectorCard(c)));
      const external = Array.isArray(data.external) ? data.external : [];
      if (external.length) external.forEach((c) => nodes.push(connectorCard(c)));
      else nodes.push(lcardNote('No external connector is registered.', null));
    }
  }

  nodes.push(headingEl('MCP servers'));
  integrationsMcp.nodes(hasOwner).forEach((n) => nodes.push(n));

  nodes.push(headingEl('autonomous intake'));
  nodes.push(noteEl('Reads a GitHub issue or Jira ticket reference out of a task, checks your connected NeoSapien '
    + 'memory, and looks for the local repository it probably means — before you send it to Forge. Read-only: '
    + 'nothing here starts anything.'));
  nodes.push(intakeFormNode(hasOwner, render));
  if (intake.result) nodes.push(intakeResultNode(intake.result));

  fill(container, ...nodes);
}

integrationsMcp.setRerender(render);

export async function bindIntegrations() {
  const generation = ++bindGeneration;
  const screen = screenEl('integrations');
  if (!screen) return;
  container = screen.querySelector('.live-cards');
  if (!container) return;
  hasOwner = !!token();

  // Only a first bind shows "Reading…"; a re-bind keeps the last read on
  // screen until the new one has actually arrived.
  if (!last) fill(container, lcardOuter('Reading integrations…', '', null));
  else render();

  // The header's one action is the one real add on this screen.
  const addBtn = screen.querySelector('[data-integrations-add-mcp]');
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    if (!hasOwner) disableBtn(addBtn, 'This window has no owner token, so it cannot add an MCP server.');
    else addBtn.addEventListener('click', () => integrationsMcp.openForm());
  }

  const [work, agents, connectors] = await Promise.all([
    getJSON('/work'), getJSON('/forge/agents'), getJSON('/forge/connectors'), integrationsMcp.load(),
  ]);
  if (generation !== bindGeneration) return;
  last = { work, agents, connectors };
  render();
}
