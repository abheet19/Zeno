/**
 * bind/lists/integrations.js — INTEGRATIONS screen: real connectors,
 * agents/local runtime, MCP servers and extensions.
 *
 * Draws a `.live-cards` of `.lcard`s (`.lk`/`.lm`/`.lr`) — NOT the `.lrow`
 * shape the other screens use. Sections: work sources, agents/local runtime,
 * connectors (`GET /forge/connectors`), MCP servers (`GET /forge/mcp
 * /servers`, plus a real add-server form via bind/lists/mcp.js), extensions
 * (`GET /forge/extensions`) and repository skills (`GET /skills`). Nothing
 * here is the artifact's invented GitHub/Vantage/Chrome-bridge fixture rows
 * — those are replaced outright by whatever the daemon actually reports,
 * including "nothing configured". See bind/lists.js for the full endpoint
 * list.
 */

import { getJSON, fill, token, screenEl } from '../../bind.js';
import {
  plural, clip, disableBtn, lcardOuter, pillEl, noteEl, headingEl,
  connectorFacts, builtinFacts, snippetFacts, skillSourceLine,
} from './shared.js';
import { createMcpManager } from './mcp.js';

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
function skillCard(sk) {
  const meta = (sk.description ? clip(sk.description, 100) + ' — ' : '') + (sk.bytes || 0) + ' bytes';
  const susp = sk.verdict === 'suspicious';
  return lcardOuter(sk.name || sk.id || 'skill', meta, pillEl(susp ? 'review findings' : 'screened', susp ? 'am' : 'gr'));
}
function connectorCard(c) {
  const f = connectorFacts(c);
  const card = lcardOuter(f.name, f.meta, pillEl(f.pillText, f.pillCls));
  if (f.permissions) card.appendChild(noteEl(f.permissions));
  return card;
}
function builtinCard(b) {
  const f = builtinFacts(b);
  const card = lcardOuter(f.name, f.meta, pillEl(f.pillText, f.pillCls));
  if (f.permissions) card.appendChild(noteEl('Permissions: ' + f.permissions));
  return card;
}
function snippetCard(sn) {
  const f = snippetFacts(sn);
  return lcardOuter(f.name, f.meta, pillEl(f.pillText, f.pillCls));
}

const integrationsMcp = createMcpManager('lcard');

export async function bindIntegrations() {
  const screen = screenEl('integrations');
  if (!screen) return;
  const container = screen.querySelector('.live-cards');
  if (!container) return;

  fill(container, lcardOuter('Reading integrations…', '', null));

  const hasOwner = !!token();
  const addBtn = screen.querySelector('.phead button');
  if (addBtn) {
    disableBtn(addBtn, 'Zeno holds no third-party account connectors and never simulates one — see the real, '
      + 'bundled connectors and the MCP servers you can add below.');
  }

  let render = () => {};
  integrationsMcp.setRerender(() => render());

  const [work, agents, skills, connectors, extensions] = await Promise.all([
    getJSON('/work'), getJSON('/forge/agents'), getJSON('/skills'), getJSON('/forge/connectors'), getJSON('/forge/extensions'),
  ]);
  await integrationsMcp.load();

  render = () => {
    const nodes = [];

    nodes.push(headingEl('work sources'));
    if (!work.ok) {
      nodes.push(lcardNote('Work sources could not be read.', work.error));
    } else {
      const sources = Array.isArray(work.data && work.data.sources) ? work.data.sources : [];
      if (!sources.length) nodes.push(lcardNote('No work source is configured.', null));
      sources.forEach((s) => nodes.push(sourceCard(s)));
    }

    nodes.push(headingEl('agents & local runtime'));
    if (!agents.ok) {
      nodes.push(lcardNote('The local runtime could not be read.', agents.error));
    } else {
      const models = Array.isArray(agents.data && agents.data.localModels) ? agents.data.localModels : [];
      nodes.push(ollamaCard(models));
      const list = Array.isArray(agents.data && agents.data.agents) ? agents.data.agents : [];
      list.forEach((a) => nodes.push(agentCard(a)));
    }

    nodes.push(headingEl('connectors'));
    nodes.push(noteEl('Zeno holds no third-party accounts and never simulates a connection. Each entry below is a '
      + 'bundled bridge Forge may admit into a governed run — not an external account.'));
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

    nodes.push(headingEl('MCP servers'));
    integrationsMcp.nodes(hasOwner).forEach((n) => nodes.push(n));

    nodes.push(headingEl('extensions'));
    if (!extensions.ok) {
      nodes.push(lcardNote('Extensions could not be read.', extensions.error));
    } else {
      const data = extensions.data || {};
      nodes.push(noteEl('This is Zeno’s own local capability catalog — not the VS Code Marketplace and not an '
        + 'installable-extension host. Rows here are informational; there is no install route.'));
      const builtins = Array.isArray(data.builtins) ? data.builtins : [];
      builtins.forEach((b) => nodes.push(builtinCard(b)));
      const snippets = Array.isArray(data.snippets) ? data.snippets : [];
      snippets.forEach((sn) => nodes.push(snippetCard(sn)));
      const sources = Array.isArray(data.skillSources) ? data.skillSources : [];
      if (sources.length) {
        nodes.push(noteEl('Skill sources scanned for provenance (see Skills below for what this repository can '
          + 'actually select):'));
        sources.forEach((s) => nodes.push(noteEl(skillSourceLine(s))));
      }
    }

    nodes.push(headingEl('skills'));
    nodes.push(noteEl('A skill is catalogued read-only and never loaded ambiently; it acts only after it is '
      + 'installed into a repository and selected in Forge, and it grants no tool permission on its own.'));
    if (!skills.ok) {
      nodes.push(lcardNote('Installed skills could not be read.', skills.error));
    } else {
      const installed = Array.isArray(skills.data && skills.data.skills) ? skills.data.skills : [];
      if (!installed.length) nodes.push(lcardNote('No repository skills are installed.', null));
      installed.slice(0, 10).forEach((sk) => nodes.push(skillCard(sk)));
      if (installed.length > 10) nodes.push(noteEl('+ ' + (installed.length - 10) + ' more not shown.'));
      const failed = Array.isArray(skills.data && skills.data.failed) ? skills.data.failed : [];
      if (failed.length) nodes.push(noteEl(failed.length + ' skill file(s) could not be loaded.'));
    }

    fill(container, ...nodes);
  };

  render();
}
