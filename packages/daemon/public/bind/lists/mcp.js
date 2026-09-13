/**
 * bind/lists/mcp.js — MCP servers, GET/POST/DELETE /forge/mcp/servers, real
 * add + remove.
 *
 * One small stateful component, rendered by Integrations (see
 * bind/lists/integrations.js) so the network calls and the honest "names
 * only, never values" behaviour exist in exactly one place. `shape` only
 * changes the row element: `'lcard'` for a `.live-cards` list, `'lrow'` for
 * a `.row-list`.
 *
 * The add-server form keeps a DRAFT in module state: every render rebuilds
 * the DOM from state (a status line, a template pre-fill, a live re-bind on a
 * daemon event), and a form that forgot what was typed on each of those was
 * a form nobody could finish. The Discover templates (bind/lists/discover.js)
 * PRE-FILL this same draft rather than POSTing on their own, so a template's
 * `<placeholder>` argument is seen and replaced before anything is recorded.
 */

import { getJSON, el } from '../../bind.js';
import {
  postJSON, deleteJSON, toast,
  lrowEl, noteEl, loadingEl, unreadableEl, emptyEl, lcardOuter, disableBtn, viewToggleEl,
  inputEl, selectEl, formBox, statusEl,
} from './shared.js';
import { MCP_TEMPLATES, mcpTemplateNode } from './discover.js';

const EMPTY_DRAFT = { name: '', transport: 'stdio', command: '', url: '', env: '' };

export function createMcpManager(shape) {
  let mcpRes = null;
  let formOpen = false;
  let formStatus = '';
  let draft = { ...EMPTY_DRAFT };
  let scrollToForm = false;
  let view = 'yours'; // 'yours' | 'discover' — see viewToggleEl in shared.js
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

  async function submit() {
    const args = draft.command.trim().split(/\s+/).filter(Boolean);
    const payload = {
      name: draft.name.trim(),
      transport: draft.transport,
      command: draft.transport === 'stdio' ? (args[0] || '') : '',
      args: draft.transport === 'stdio' ? args.slice(1) : [],
      url: draft.url.trim(),
      env: draft.env.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (!payload.name) { formStatus = 'Give the server a name.'; rerender(); return; }
    // A template's `<path-to-allow>` is a slot for the owner, not a command.
    // Recording it as-is would list a server that can never start.
    const slot = (draft.transport === 'stdio' ? draft.command : draft.url).match(/<[^<>]+>/);
    if (slot) { formStatus = 'Replace the ' + slot[0] + ' placeholder with a real value first.'; rerender(); return; }
    const r = await postJSON('/forge/mcp/servers', payload);
    if (!r.ok) { formStatus = 'Not added: ' + r.error; rerender(); return; }
    formStatus = ''; formOpen = false; draft = { ...EMPTY_DRAFT };
    toast('Recorded "' + payload.name + '" — env var NAME(s) only, no value stored.');
    mcpRes = await getJSON('/forge/mcp/servers');
    rerender();
  }

  function formNode() {
    const box = formBox(shape);
    box.setAttribute('data-mcp-form', '');
    box.appendChild(inputEl('Name — e.g. filesystem', draft.name, (v) => { draft.name = v; }));
    box.appendChild(selectEl(['stdio', 'sse', 'http'].map((t) => ({ value: t, label: t })), draft.transport,
      (v) => { draft.transport = v; }, 'Transport'));
    box.appendChild(inputEl('stdio command — e.g. npx -y @modelcontextprotocol/server-filesystem /path', draft.command, (v) => { draft.command = v; }));
    box.appendChild(inputEl('sse/http URL — e.g. https://host/mcp', draft.url, (v) => { draft.url = v; }));
    box.appendChild(inputEl('env var NAMES, comma-separated (values never stored)', draft.env, (v) => { draft.env = v; }));
    const addBtn = el('button', 'btn sm p', 'Add server');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => { addBtn.disabled = true; submit().finally(() => { addBtn.disabled = false; }); });
    box.appendChild(addBtn);
    box.appendChild(statusEl(formStatus));
    if (scrollToForm) {
      scrollToForm = false;
      requestAnimationFrame(() => { try { box.scrollIntoView({ block: 'center' }); } catch { /* not attached yet */ } });
    }
    return box;
  }

  /** Recorded server names, lower-cased, so a template already added shows
   *  "Added" instead of a second, colliding "+ Add". */
  function configuredNames() {
    const servers = Array.isArray(mcpRes && mcpRes.ok && mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
    return new Set(servers.map((s) => String((s && s.name) || '').trim().toLowerCase()));
  }

  /** A template fills the draft and opens the form under "Yours"; the owner
   *  reads it — and replaces any `<placeholder>` — before "Add server". */
  function useTemplate(tmpl) {
    draft = {
      name: tmpl.name,
      transport: tmpl.transport,
      command: tmpl.transport === 'stdio' ? [tmpl.command].concat(tmpl.args || []).join(' ') : '',
      url: tmpl.transport === 'stdio' ? '' : (tmpl.url || ''),
      env: (tmpl.envKeys || []).join(', '),
    };
    formStatus = 'Pre-filled from the "' + tmpl.name + '" template — check the command, then Add server.';
    formOpen = true; view = 'yours'; scrollToForm = true;
    rerender();
  }

  function discoverNodes(hasOwner) {
    const nodes = [];
    nodes.push(noteEl('A small curated catalog of well-known MCP server TEMPLATES — not a live connection. "+ Add" '
      + 'pre-fills the add-server form with a name, transport, and the env-var NAME(s) its upstream server documents '
      + '(never a value); "Add server" then records it via /forge/mcp/servers. Nothing is installed, run, or connected.'));
    const already = configuredNames();
    MCP_TEMPLATES.forEach((tmpl) => {
      nodes.push(mcpTemplateNode(shape, tmpl, {
        already: already.has(tmpl.name.toLowerCase()),
        hasOwner,
        onAdd: useTemplate,
      }));
    });
    return nodes;
  }

  return {
    setRerender(fn) { rerender = fn; },
    async load() { mcpRes = await getJSON('/forge/mcp/servers'); },
    /** The screen-level "+ Add MCP server" button lands here. */
    openForm() { formOpen = true; formStatus = ''; view = 'yours'; scrollToForm = true; rerender(); },
    nodes(hasOwner) {
      const nodes = [];
      nodes.push(viewToggleEl([{ value: 'yours', label: 'Yours' }, { value: 'discover', label: 'Discover' }], view,
        (v) => { view = v; rerender(); }));
      if (view === 'discover') return nodes.concat(discoverNodes(hasOwner));
      nodes.push(noteEl('Recorded configurations only — recording a server here does not connect or run it, '
        + 'and only environment variable NAMES are ever stored, never their values.'));
      nodes.push(toggleNode(hasOwner));
      if (formOpen && hasOwner) nodes.push(formNode());
      if (!mcpRes) nodes.push(loadingEl('Reading configured MCP servers…'));
      else if (!mcpRes.ok) nodes.push(unreadableEl('MCP servers', mcpRes.error));
      else {
        const servers = Array.isArray(mcpRes.data && mcpRes.data.servers) ? mcpRes.data.servers : [];
        if (!servers.length) nodes.push(emptyEl('No MCP servers configured yet.', hasOwner ? 'Add one above, or start from a template under "Discover".' : 'Only the owner window can add one.'));
        else servers.forEach((s) => nodes.push(serverNode(s, hasOwner)));
      }
      return nodes;
    },
  };
}
