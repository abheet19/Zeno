/**
 * bind/lists/customize.js — CUSTOMIZE screen: Skills / MCP servers /
 * Connectors / Extensions.
 *
 * Draws a plain `.card > .row-list[data-mount="customize-list"]`. Every row
 * here is real, sourced the same way as Integrations (see the MCP manager
 * in bind/lists/mcp.js and the connectorRow/builtinRow/snippetRow builders
 * below, which reuse bind/lists/shared.js's connectorFacts/builtinFacts/
 * snippetFacts so the two screens can never disagree on a field's meaning):
 * installed skills (GET /skills), MCP server records (GET/POST/DELETE
 * /forge/mcp/servers, add and remove owner-only), connectors (GET
 * /forge/connectors — Zeno's own bundled bridges, not a third-party-account
 * catalog) and extensions (GET /forge/extensions). The top-level
 * `public/customize.js` this screen used to describe is not loaded by
 * bind.js any more; its invented Google Drive/Slack/Notion connector list
 * and Anthropic-plugin catalog do not appear here because nothing in this
 * daemon reports them.
 */

import { getJSON, fill, token, screenEl } from '../../bind.js';
import {
  headingEl, noteEl, emptyEl, loadingEl, unreadableEl, lrowEl, pillEl,
  connectorFacts, builtinFacts, snippetFacts, skillSourceLine,
} from './shared.js';
import { createMcpManager } from './mcp.js';

function skillRow(sk) {
  const meta = 'id ' + (sk.id || '?') + ' · ' + (sk.bytes || 0) + ' bytes';
  const susp = sk.verdict === 'suspicious';
  return lrowEl('SKL', sk.name || sk.id || 'skill', meta, pillEl(susp ? 'review findings' : 'screened', susp ? 'am' : 'gr'));
}
function connectorRow(c) {
  const f = connectorFacts(c);
  return lrowEl('CON', f.name, f.permissions ? f.meta + ' — ' + f.permissions : f.meta, pillEl(f.pillText, f.pillCls));
}
function builtinRow(b) {
  const f = builtinFacts(b);
  return lrowEl('EXT', f.name, f.meta, pillEl(f.pillText, f.pillCls));
}
function snippetRow(sn) {
  const f = snippetFacts(sn);
  return lrowEl('SNP', f.name, f.meta, pillEl(f.pillText, f.pillCls));
}

const customizeMcp = createMcpManager('lrow');

export async function bindCustomize() {
  const screen = screenEl('customize');
  if (!screen) return;
  const listEl = screen.querySelector('[data-mount="customize-list"]');
  if (!listEl) return;

  const hasOwner = !!token();
  let skillsRes = null;
  let connectorsRes = null;
  let extensionsRes = null;

  function render() {
    const nodes = [];

    nodes.push(headingEl('MCP servers'));
    customizeMcp.nodes(hasOwner).forEach((n) => nodes.push(n));

    nodes.push(headingEl('installed skills'));
    nodes.push(noteEl('Skills are catalogued read-only and never loaded ambiently; a skill acts only after it '
      + 'is installed into a repository and selected in Forge, and it grants no tool permission on its own.'));
    if (!skillsRes) {
      nodes.push(loadingEl('Reading installed skills…'));
    } else if (!skillsRes.ok) {
      nodes.push(unreadableEl('Installed skills', skillsRes.error));
    } else {
      const installed = Array.isArray(skillsRes.data && skillsRes.data.skills) ? skillsRes.data.skills : [];
      const failed = Array.isArray(skillsRes.data && skillsRes.data.failed) ? skillsRes.data.failed : [];
      if (!installed.length) {
        nodes.push(emptyEl('No repository skills are installed.', 'Add .agents/skills/<id>/SKILL.md to the selected repository, then reload Forge.'));
      } else {
        installed.forEach((sk) => nodes.push(skillRow(sk)));
      }
      if (failed.length) nodes.push(noteEl(failed.length + ' skill file(s) could not be loaded.'));
    }

    nodes.push(headingEl('connectors'));
    nodes.push(noteEl('Zeno holds no third-party accounts and never simulates a connection. Each row below is a '
      + 'bundled bridge Forge may admit into a governed run — not an external account, and nothing here is '
      + 'actually connected unless it says "configured" or "attached".'));
    if (!connectorsRes) {
      nodes.push(loadingEl('Reading connectors…'));
    } else if (!connectorsRes.ok) {
      nodes.push(unreadableEl('Connectors', connectorsRes.error));
    } else {
      const data = connectorsRes.data || {};
      const servers = Array.isArray(data.servers) ? data.servers : [];
      if (!servers.length) nodes.push(emptyEl('No connector is registered.', ''));
      else servers.forEach((c) => nodes.push(connectorRow(c)));
      const external = Array.isArray(data.external) ? data.external : [];
      if (external.length) external.forEach((c) => nodes.push(connectorRow(c)));
      else nodes.push(emptyEl('No external connector is registered.', 'This daemon has no catalog of third-party services (Google Drive, Slack, etc.) to add from here.'));
    }

    nodes.push(headingEl('extensions'));
    nodes.push(noteEl('Zeno’s own local capability catalog — not the VS Code Marketplace, and not an installable '
      + 'extension host. These rows are informational; there is no install route.'));
    if (!extensionsRes) {
      nodes.push(loadingEl('Reading extensions…'));
    } else if (!extensionsRes.ok) {
      nodes.push(unreadableEl('Extensions', extensionsRes.error));
    } else {
      const data = extensionsRes.data || {};
      const builtins = Array.isArray(data.builtins) ? data.builtins : [];
      builtins.forEach((b) => nodes.push(builtinRow(b)));
      const snippets = Array.isArray(data.snippets) ? data.snippets : [];
      snippets.forEach((sn) => nodes.push(snippetRow(sn)));
      const sources = Array.isArray(data.skillSources) ? data.skillSources : [];
      if (sources.length) sources.forEach((s) => nodes.push(noteEl(skillSourceLine(s))));
    }

    fill(listEl, ...nodes);
  }

  customizeMcp.setRerender(render);
  render();
  const [skills, connectors, extensions] = await Promise.all([
    getJSON('/skills'), getJSON('/forge/connectors'), getJSON('/forge/extensions'),
  ]);
  skillsRes = skills; connectorsRes = connectors; extensionsRes = extensions;
  await customizeMcp.load();
  render();
}
