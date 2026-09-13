/**
 * bind/lists/mcp.js — MCP servers, GET/POST/DELETE /forge/mcp/servers, real
 * add + remove.
 *
 * One small stateful component shared by Integrations and Customize (see
 * bind/lists/integrations.js and bind/lists/customize.js) so the network
 * calls and the honest "names only, never values" behaviour exist in
 * exactly one place. `shape` only changes the row element: `'lcard'` for
 * Integrations' `.live-cards`, `'lrow'` for Customize's `.row-list`.
 */

import { getJSON, el } from '../../bind.js';
import {
  postJSON, deleteJSON, toast,
  lrowEl, noteEl, loadingEl, unreadableEl, emptyEl, lcardOuter, disableBtn,
} from './shared.js';

export function createMcpManager(shape) {
  let mcpRes = null;
  let formOpen = false;
  let formStatus = '';
  let rerender = () => {};

  function outer(title, meta, right) {
    return shape === 'lcard' ? lcardOuter(title, meta, right) : lrowEl('mcp', title, meta, right);
  }

  function serverNode(s, hasOwner) {
    const detail = s.transport === 'stdio'
      ? (s.command || '') + (Array.isArray(s.args) && s.args.length ? ' ' + s.args.join(' ') : '')
      : (s.url || '');
    const meta = [s.transport, detail, Array.isArray(s.envKeys) && s.envKeys.length ? 'env: ' + s.envKeys.join(', ') : null,
      'configured · not connected'].filter(Boolean).join(' · ');
    let action = null;
    if (hasOwner && s.id) {
      action = el('button', 'laction', 'Remove');
      action.type = 'button';
      action.addEventListener('click', async () => {
        action.disabled = true;
        const r = await deleteJSON('/forge/mcp/servers/' + encodeURIComponent(s.id));
        if (r.ok) { toast('MCP server removed.'); mcpRes = await getJSON('/forge/mcp/servers'); rerender(); }
        else { action.disabled = false; toast('Could not remove: ' + r.error); }
      });
    }
    return outer(s.name || s.id || 'server', meta, action);
  }

  function toggleNode(hasOwner) {
    const toggle = el('button', 'btn sm g', formOpen ? 'Close' : '+ Add server');
    toggle.type = 'button';
    toggle.addEventListener('click', () => { formOpen = !formOpen; formStatus = ''; rerender(); });
    if (!hasOwner) { disableBtn(toggle, 'This window has no owner token, so it cannot add an MCP server.'); }
    return outer('Add server', 'Name + env var NAMES only — never a secret value.', toggle);
  }

  function formNode() {
    const row = el('div', shape === 'lcard' ? 'lcard' : 'lrow');
    row.style.cssText = 'display:flex; flex-direction:column; align-items:stretch; gap:8px; padding:12px 16px';
    const inputStyle = 'font:inherit; font-size:12px; padding:7px 10px; border-radius:6px; '
      + 'border:1px solid var(--rule-2,#2C363B); background:var(--g2,#0F1214); color:var(--ink,#ECEBE6)';
    const name = document.createElement('input');
    name.placeholder = 'Name — e.g. filesystem'; name.style.cssText = inputStyle;
    const transport = document.createElement('select');
    transport.style.cssText = inputStyle;
    ['stdio', 'sse', 'http'].forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t; transport.appendChild(o); });
    const command = document.createElement('input');
    command.placeholder = 'stdio command — e.g. npx -y @modelcontextprotocol/server-filesystem /path'; command.style.cssText = inputStyle;
    const url = document.createElement('input');
    url.placeholder = 'sse/http URL — e.g. https://host/mcp'; url.style.cssText = inputStyle;
    const env = document.createElement('input');
    env.placeholder = 'env var NAMES, comma-separated (values never stored)'; env.style.cssText = inputStyle;
    const addBtn = el('button', 'btn sm p', 'Add server');
    addBtn.type = 'button';
    const status = el('span', null, formStatus);
    status.style.cssText = 'font-size:10.5px; color:var(--ink-3,#6C7480)';
    addBtn.addEventListener('click', async () => {
      const args = command.value.trim().split(/\s+/).filter(Boolean);
      const payload = {
        name: name.value.trim(),
        transport: transport.value,
        command: transport.value === 'stdio' ? (args[0] || '') : '',
        args: transport.value === 'stdio' ? args.slice(1) : [],
        url: url.value.trim(),
        env: env.value.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (!payload.name) { formStatus = 'Give the server a name.'; rerender(); return; }
      const r = await postJSON('/forge/mcp/servers', payload);
      if (!r.ok) { formStatus = 'Not added: ' + r.error; rerender(); return; }
      formStatus = ''; formOpen = false;
      mcpRes = await getJSON('/forge/mcp/servers');
      rerender();
    });
    [name, transport, command, url, env, addBtn, status].forEach((n) => row.appendChild(n));
    return row;
  }

  return {
    setRerender(fn) { rerender = fn; },
    async load() { mcpRes = await getJSON('/forge/mcp/servers'); },
    nodes(hasOwner) {
      const nodes = [];
      nodes.push(noteEl('Recorded configurations only — recording a server here does not connect or run it, '
        + 'and only environment variable NAMES are ever stored, never their values.'));
      nodes.push(toggleNode(hasOwner));
      if (formOpen) nodes.push(formNode());
      if (!mcpRes) nodes.push(loadingEl('Reading configured MCP servers…'));
      else if (!mcpRes.ok) nodes.push(unreadableEl('MCP servers', mcpRes.error));
      else {
        const servers = Array.isArray(mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
        if (!servers.length) nodes.push(emptyEl('No MCP servers configured yet.', hasOwner ? 'Add one above.' : 'Only the owner window can add one.'));
        else servers.forEach((s) => nodes.push(serverNode(s, hasOwner)));
      }
      return nodes;
    },
  };
}

