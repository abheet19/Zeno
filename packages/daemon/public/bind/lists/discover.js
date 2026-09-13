/**
 * bind/lists/discover.js — the "Discover" side of the Claude-Code-style
 * Yours/Discover chooser on Integrations (connectors, MCP servers) and
 * Customize (rules, skills). Those two screens render the toggle from
 * bind/lists/shared.js's `viewToggleEl` and mount the nodes built here.
 *
 * Four small, honest catalogs live here:
 *
 *  - MCP_TEMPLATES: a curated list of well-known MCP server TEMPLATES. Each
 *    one is a NAME + TRANSPORT + the env-var NAMES its upstream server
 *    documents — never a value field, and never a stored secret. "+ Add"
 *    PRE-FILLS the same add-server form bind/lists/mcp.js already draws (so a
 *    `<placeholder>` in a template's command is seen and replaced before it
 *    is recorded); saving is that form's own POST /forge/mcp/servers. It
 *    RECORDS a configuration, it does not install, run, or connect anything.
 *    No official NeoSapien MCP exists (see docs/03-corrections-log.md) so it
 *    is not, and never will be, in this list. Figma's template is likewise
 *    marked community-maintained — Zeno never claims an official integration
 *    it does not have.
 *
 *  - CONNECTOR_SWITCHES: for each bundled connector GET /forge/connectors
 *    reports, the daemon startup switch(es) that turn it on — read from
 *    packages/daemon/src/main.ts, where they are defined. There is no "+ Add"
 *    for a connector because there is no add: the set is fixed and switched
 *    on at daemon start, and the Discover view says exactly that.
 *
 *  - ruleDiscoverNode: the rule-file conventions GET /capabilities/conventions
 *    reports (the one list routes/forge-context.ts scans), each with a LIVE
 *    "+ Add" that opens the rule form in bind/lists/authoring.js — a
 *    governed proposal, never a direct write.
 *
 *  - skillDiscoverNode: GET /forge/extensions' global skill catalog with an
 *    honestly-disabled "+ Add": the catalog carries a skill's name and
 *    description, not its body, so there is nothing this UI could propose.
 *
 * Nothing here calls any endpoint on its own — every network effect is
 * wired by the caller so this module stays pure data + DOM.
 */

import { el } from '../../bind.js';
import { lcardOuter, lrowEl, pillEl, noteEl, disableBtn, clip, connectorFacts } from './shared.js';

/* ---- MCP server templates -------------------------------------------------
 * Deliberately small: "a few obvious ones" per the brief, not an attempt at
 * an exhaustive registry. `envKeys` are the variable NAMES the upstream
 * server's own docs use — Zeno never fills in, requests, or stores a value. */
export const MCP_TEMPLATES = [
  {
    id: 'figma',
    name: 'figma',
    summary: 'Reads Figma file/node/component data over the Figma REST API for one design file at a time.',
    vendor: 'community-maintained — not an official Figma or Anthropic product',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'],
    envKeys: ['FIGMA_ACCESS_TOKEN'],
  },
  {
    id: 'filesystem',
    name: 'filesystem',
    summary: 'Read/write access to one allow-listed local directory you choose after adding it.',
    vendor: 'modelcontextprotocol/servers — reference server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<path-to-allow>'],
    envKeys: [],
  },
  {
    id: 'github',
    name: 'github',
    summary: 'Issues, pull requests, and repository content over the GitHub REST API.',
    vendor: 'modelcontextprotocol/servers — reference server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'git',
    name: 'git',
    summary: 'Reads and operates on a local git repository already on disk — no remote credential needed.',
    vendor: 'modelcontextprotocol/servers — reference server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-server-git', '--repository', '<path-to-repo>'],
    envKeys: [],
  },
  {
    id: 'memory',
    name: 'memory',
    summary: 'A small in-process knowledge-graph memory, scoped to the MCP session that starts it.',
    vendor: 'modelcontextprotocol/servers — reference server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envKeys: [],
  },
  {
    id: 'slack',
    name: 'slack',
    summary: 'Reads and posts Slack channel messages through a bot token you create in your own workspace.',
    vendor: 'community-maintained — not an official Slack or Anthropic product',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
];

/* ---- bundled connectors: how each is switched on ------------------------
 * Ids are the server names @abheet19/zeno-forge exports (GATE_SERVER,
 * BROWSE_SERVER, CHROME_SERVER); the switches are the environment variables
 * packages/daemon/src/main.ts reads at startup, with their defaults. */
export const CONNECTOR_SWITCHES = {
  zeno_gate: 'ZENO_FORGE_SHELL (on unless set to 0)',
  zeno_browse: 'ZENO_FORGE_SHELL (on unless 0) + ZENO_FORGE_NETWORK=1 (off by default) + ZENO_FORGE_BROWSER (on unless 0)',
  zeno_chrome: 'ZENO_FORGE_SHELL (on unless 0) + ZENO_FORGE_CHROME=1 (off by default), then the browser extension must attach and an origin must be on your allowlist',
};

/** How many active rule files already match this convention, per the SAME
 *  `rules` array GET /skills reports (so Rules' Discover tab can never
 *  disagree with its own Yours tab). A file convention matches by path; a
 *  directory convention matches every file under it. */
export function ruleConventionMatches(conv, rules) {
  const list = Array.isArray(rules) ? rules : [];
  if (conv.kind === 'dir') return list.filter((r) => r && typeof r.path === 'string' && r.path.startsWith(conv.path + '/')).length;
  return list.filter((r) => r && r.path === conv.path).length;
}

function outer(shape, tier, title, meta, right) {
  return shape === 'lcard' ? lcardOuter(title, meta, right) : lrowEl(tier, title, meta, right);
}

/** One MCP template card/row. `opts.already` (already recorded under
 *  "Yours"), `opts.hasOwner` (this window can write at all), and
 *  `opts.onAdd(tmpl)` (pre-fills the add-server form — see
 *  bind/lists/mcp.js) drive whether "+ Add" is live or honestly disabled. */
export function mcpTemplateNode(shape, tmpl, opts) {
  opts = opts || {};
  const meta = [
    tmpl.transport,
    tmpl.command ? tmpl.command + ' ' + (tmpl.args || []).join(' ') : (tmpl.url || ''),
    tmpl.envKeys && tmpl.envKeys.length ? 'env var NAME(s): ' + tmpl.envKeys.join(', ') : 'no env var needed',
    tmpl.vendor,
  ].filter(Boolean).join(' · ');
  const btn = el('button', 'btn sm p', opts.already ? 'Added' : '+ Add');
  btn.type = 'button';
  if (opts.already) {
    disableBtn(btn, 'Already recorded — see it under "Yours".');
  } else if (!opts.hasOwner) {
    disableBtn(btn, 'This window has no owner token, so it cannot add an MCP server.');
  } else {
    btn.addEventListener('click', () => { if (opts.onAdd) opts.onAdd(tmpl); });
  }
  const note = tmpl.summary + ' "+ Add" pre-fills the add-server form with the name, transport, and env-var NAME(s) '
    + 'above — no value field exists here or anywhere in Zeno for this. You still install/run the server and set the '
    + 'real secret yourself, in your own environment.';
  if (shape === 'lcard') {
    const card = lcardOuter(tmpl.name, meta, btn);
    card.appendChild(noteEl(note));
    return card;
  }
  return lrowEl('mcp', tmpl.name, meta + ' — ' + note, btn);
}

/** A real bundled connector (GET /forge/connectors) in the Discover view:
 *  what it is, and the daemon startup switch that turns it on. No "+ Add" —
 *  there is no add route, and a disabled button that says so is still a
 *  button pretending to be an affordance. */
export function connectorDiscoverNode(shape, c) {
  const f = connectorFacts(c);
  const how = CONNECTOR_SWITCHES[c && c.id] || 'switched on by a daemon startup flag (see packages/daemon/src/main.ts)';
  const meta = f.meta + ' · switched on by: ' + how;
  const node = outer(shape, 'CON', f.name, meta, pillEl(f.pillText, f.pillCls));
  if (shape === 'lcard' && f.permissions) node.appendChild(noteEl(f.permissions));
  return node;
}

/** One entry from GET /forge/extensions' global skill catalog (repository +
 *  every known global source, each carrying `selectableInThisRepository`).
 *  "+ Add" is disabled either way: the catalog carries the skill's name and
 *  description, not its SKILL.md body, so there is nothing to propose. */
export function skillDiscoverNode(shape, entry) {
  entry = entry || {};
  const already = entry.selectableInThisRepository === true;
  const meta = [entry.provenance, entry.description ? clip(entry.description, 90) : null,
    already ? 'installed in this repository' : 'not installed in this repository']
    .filter(Boolean).join(' · ');
  const btn = el('button', 'btn sm g', already ? 'Added' : '+ Add');
  btn.type = 'button';
  disableBtn(btn, already
    ? 'Already installed in the selected repository — see it under "Yours".'
    : `The catalog lists this skill's name and description, not its SKILL.md, so it cannot be proposed from here. Copy its folder into .agents/skills/${entry.id || '<id>'} in the selected repository, or write it with "+ Add skill".`);
  return outer(shape, 'SKL', entry.name || entry.id || 'skill', meta, btn);
}

/** One rule-file convention, shown against the SAME `rules` the Yours tab
 *  reads. "+ Add" is LIVE: it opens the governed rule form pre-set to this
 *  convention (`opts.onAdd(conv)`); a single-file convention that already
 *  exists offers "Edit" instead, which opens the same form on the file. */
export function ruleDiscoverNode(shape, conv, matches, opts) {
  opts = opts || {};
  const present = matches > 0;
  const state = !present ? 'not present in this repository'
    : conv.kind === 'dir' ? matches + ' active file' + (matches === 1 ? '' : 's') + ' in this folder'
      : 'already active in this repository';
  const meta = conv.note + ' · ' + state;
  const label = present && conv.kind !== 'dir' ? 'Edit' : '+ Add';
  const btn = el('button', 'btn sm ' + (label === 'Edit' ? 'g' : 'p'), label);
  btn.type = 'button';
  if (!opts.hasOwner) disableBtn(btn, 'This window has no owner token, so it cannot propose a file write.');
  else if (label === 'Edit' && !opts.onEdit) disableBtn(btn, 'Edit it under "Yours".');
  else btn.addEventListener('click', () => { if (label === 'Edit') opts.onEdit(conv); else if (opts.onAdd) opts.onAdd(conv); });
  return outer(shape, 'RUL', conv.path + (conv.kind === 'dir' ? '/*' + conv.extension : ''), meta, btn);
}

/** One real, already-active rule file (GET /skills's `rules`: path/bytes/
 *  body/truncated) — the "Yours" side of the Rules section. "Edit" opens
 *  the governed rule form on this file's current text (`opts.onEdit(r)`);
 *  a file the daemon had to truncate cannot be edited here without losing
 *  its tail, so that button says so instead. */
export function ruleNode(shape, r, opts) {
  r = r || {};
  opts = opts || {};
  const meta = (r.bytes || 0) + ' bytes' + (r.truncated ? ' (truncated when sent to a model)' : '');
  const btn = el('button', 'btn sm g', 'Edit');
  btn.type = 'button';
  if (!opts.hasOwner) disableBtn(btn, 'This window has no owner token, so it cannot propose a file write.');
  else if (r.truncated) disableBtn(btn, 'This file is larger than the daemon reads (64,000 bytes); editing it here would drop the part it did not read.');
  else if (typeof r.body !== 'string') disableBtn(btn, 'The daemon did not return this file’s text, so there is nothing to edit from.');
  else btn.addEventListener('click', () => { if (opts.onEdit) opts.onEdit(r); });
  const node = outer(shape, 'RUL', r.path || 'rule', meta, btn);
  return node;
}
