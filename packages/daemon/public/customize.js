/**
 * The Customize hub — Skills / Connectors / Plugins, in the shape Claude Code
 * uses, on Zeno's terms and with Zeno's honesty.
 *
 * What is REAL and functional here:
 *   - MCP servers: the owner adds, lists and removes real server configurations
 *     (POST/GET/DELETE /forge/mcp/servers). Only environment VARIABLE NAMES are
 *     stored, never their values.
 *   - Skills: the real installed skills the daemon reports (GET /skills).
 *
 * What is an honest CATALOG (a browsable directory, not a fake connection):
 *   - Connectors and Plugins list what exists to add. Zeno does not ambiently
 *     load MCP or hold third-party OAuth, so each card says exactly what adding it
 *     would require — provider credentials for a connector, a command for an MCP
 *     server — rather than a button that pretends to connect.
 */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
function btn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

const TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

async function api(path, init) {
  const opts = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init || {});
  const headers = Object.assign({ accept: 'application/json' }, opts.headers || {});
  if (TOKEN) headers['x-zeno-token'] = TOKEN;
  opts.headers = headers;
  let res;
  try { res = await fetch(path, opts); } catch (err) {
    return { ok: false, status: 0, data: null, error: { message: (err && err.message) || 'the daemon did not answer.' } };
  }
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : ((data && data.error) || { message: `The daemon answered ${res.status}.` }) };
}

// The curated directory. Honest: these name what exists, and adding each states
// what it needs — Zeno never simulates a connected account.
const CONNECTORS = [
  { name: 'Google Drive', mark: 'D', color: '#4285F4', desc: 'Search, read and reference your files.' },
  { name: 'Gmail', mark: 'M', color: '#EA4335', desc: 'Draft, summarise and search your inbox.' },
  { name: 'Google Calendar', mark: 'C', color: '#1A73E8', desc: 'See and coordinate your schedule.' },
  { name: 'Notion', mark: 'N', color: '#9AA1AC', desc: 'Search and update your workspace.' },
  { name: 'Slack', mark: 'S', color: '#611F69', desc: 'Read channels and send messages.' },
  { name: 'GitHub', mark: 'G', color: '#6C7480', desc: 'Issues, PRs and repository context.' },
  { name: 'Linear', mark: 'L', color: '#5E6AD2', desc: 'Issues and project workflows.' },
  { name: 'Figma', mark: 'F', color: '#F24E1E', desc: 'Read designs and generate from context.' },
];
const PLUGINS = [
  { name: 'Data', mark: 'D', color: '#5FBF8F', desc: 'Query, chart and explain data — SQL, spreadsheets, dashboards.', from: 'Anthropic' },
  { name: 'doc-coauthoring', mark: '¶', color: '#38C3D6', desc: 'A structured workflow for co-authoring documents.', from: 'Anthropic' },
  { name: 'theme-factory', mark: 'T', color: '#E0A128', desc: 'Toolkit for styling artifacts with a theme.', from: 'Anthropic' },
  { name: 'web-artifacts-builder', mark: 'W', color: '#8B7FD6', desc: 'Tools for elaborate multi-component web artifacts.', from: 'Anthropic' },
];

const S = {
  tab: 'connectors',   // skills | connectors | plugins
  view: 'discover',    // discover | yours
  query: '',
  mcp: null,           // GET /forge/mcp/servers
  skills: null,        // GET /skills
  detail: null,        // { kind, item } — an open "Add" explanation
  mcpForm: false,      // is the Add-MCP form open
  status: '',
};

const mount = document.querySelector('[data-mount="customize"]');

async function loadMcp() { const r = await api('/forge/mcp/servers'); S.mcp = r.ok ? r.data : { servers: [], error: (r.error && r.error.message) }; render(); }
async function loadSkills() { const r = await api('/skills'); S.skills = r.ok ? r.data : { error: (r.error && r.error.message) }; render(); }

function markTile(text, color) {
  const m = el('span', 'cz-mark', text);
  m.style.setProperty('--cz', color || '#38C3D6');
  return m;
}

function directoryCard(item, kind) {
  const card = btn('cz-card', null, () => { S.detail = { kind, item }; render(); });
  add(card, markTile(item.mark, item.color));
  const body = el('span', 'cz-card-body');
  const top = el('span', 'cz-card-top');
  add(top, el('span', 'cz-card-name', item.name));
  if (item.from) add(top, el('span', 'cz-card-from', item.from));
  add(body, top, el('span', 'cz-card-desc', item.desc));
  add(card, body);
  add(card, el('span', 'cz-card-add', '+'));
  return card;
}

function detailPanel() {
  const { kind, item } = S.detail;
  const wrap = el('div', 'cz-detail');
  const head = el('div', 'cz-detail-h');
  add(head, markTile(item.mark, item.color), el('div', 'cz-detail-name', item.name), el('span', 'sp'),
    btn('cz-x', '✕', () => { S.detail = null; render(); }));
  add(wrap, head);
  add(wrap, el('p', 'cz-detail-desc', item.desc));
  if (kind === 'connector') {
    add(wrap, el('p', 'cz-detail-note',
      `Adding ${item.name} needs an OAuth application you register with the provider, and the client id + `
      + `secret it issues. Zeno holds no third-party accounts and never simulates a connection — so this is `
      + `catalogued here, and it becomes live only once you supply those credentials (kept as server-side `
      + `encrypted secrets, never in this browser). Until then there is nothing to connect to.`));
  } else {
    add(wrap, el('p', 'cz-detail-note',
      `Plugins bundle skills and tools. Zeno installs a skill into a repository (see the Skills tab), and a `
      + `plugin's tools reach a run only through Zeno's gate. This entry is catalogued; it grants no tool `
      + `permission by being listed here.`));
  }
  return wrap;
}

function mcpSection() {
  const wrap = el('div', 'cz-mcp');
  const head = el('div', 'cz-sec-h');
  add(head, el('span', null, 'MCP servers'), el('span', 'sp'));
  if (TOKEN) add(head, btn('cz-add-btn', S.mcpForm ? 'Close' : '+ Add server', () => { S.mcpForm = !S.mcpForm; render(); }));
  add(wrap, head);
  add(wrap, el('p', 'cz-note',
    'Recorded configurations only. Zeno does not ambiently load MCP — recording a server here does not connect '
    + 'or run it; admitting one into a governed run is a separate, gated layer. Only environment variable NAMES '
    + 'are stored, never their values.'));

  if (S.mcpForm && TOKEN) add(wrap, mcpForm());

  const servers = (S.mcp && Array.isArray(S.mcp.servers)) ? S.mcp.servers : [];
  if (!servers.length) {
    add(wrap, el('p', 'cz-empty', 'No MCP servers configured yet.'));
  } else {
    for (const s of servers) {
      const row = el('div', 'cz-mcp-row');
      const b = el('div', 'cz-mcp-body');
      add(b, el('span', 'cz-mcp-name', s.name), el('span', 'cz-mcp-meta',
        `${s.transport} · ${s.transport === 'stdio' ? (s.command + (s.args && s.args.length ? ' ' + s.args.join(' ') : '')) : s.url}`
        + (s.envKeys && s.envKeys.length ? ` · env: ${s.envKeys.join(', ')}` : '')));
      add(b, el('span', 'cz-mcp-state', 'configured · not connected'));
      add(row, b);
      if (TOKEN) add(row, btn('cz-x', '✕', () => void removeMcp(s.id)));
      add(wrap, row);
    }
  }
  return wrap;
}

function mcpForm() {
  const form = el('div', 'cz-form');
  const name = el('input', 'cz-input'); name.placeholder = 'Name — e.g. filesystem'; name.id = 'cz-mcp-name';
  const transport = el('select', 'cz-input'); transport.id = 'cz-mcp-transport';
  for (const t of ['stdio', 'sse', 'http']) { const o = el('option', null, t); o.value = t; add(transport, o); }
  const command = el('input', 'cz-input'); command.placeholder = 'stdio command — e.g. npx -y @modelcontextprotocol/server-filesystem /path'; command.id = 'cz-mcp-command';
  const url = el('input', 'cz-input'); url.placeholder = 'sse/http URL — e.g. https://host/mcp'; url.id = 'cz-mcp-url';
  const env = el('input', 'cz-input'); env.placeholder = 'env var NAMES, comma-separated (values never stored)'; env.id = 'cz-mcp-env';
  add(form, el('label', 'cz-lbl', 'Name'), name, el('label', 'cz-lbl', 'Transport'), transport,
    el('label', 'cz-lbl', 'Command (stdio)'), command, el('label', 'cz-lbl', 'URL (sse/http)'), url,
    el('label', 'cz-lbl', 'Env var names'), env);
  const acts = el('div', 'cz-form-acts');
  add(acts, btn('cz-add-btn', 'Add', () => {
    const args = command.value.trim().split(/\s+/).filter(Boolean);
    const payload = {
      name: name.value.trim(),
      transport: transport.value,
      command: transport.value === 'stdio' ? args[0] || '' : '',
      args: transport.value === 'stdio' ? args.slice(1) : [],
      url: url.value.trim(),
      env: env.value.split(',').map((s) => s.trim()).filter(Boolean),
    };
    void addMcp(payload);
  }));
  add(form, acts);
  if (S.status) add(form, el('p', 'cz-status', S.status));
  return form;
}

async function addMcp(payload) {
  if (!payload.name) { S.status = 'Give the server a name.'; render(); return; }
  const r = await api('/forge/mcp/servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) { S.status = 'Not added: ' + ((r.error && r.error.message) || 'the daemon refused it'); render(); return; }
  S.status = ''; S.mcpForm = false;
  loadMcp();
}
async function removeMcp(id) {
  await api('/forge/mcp/servers/' + encodeURIComponent(id), { method: 'DELETE' });
  loadMcp();
}

function skillsSection() {
  const wrap = el('div', 'cz-skills');
  const ctx = S.skills || {};
  const skills = Array.isArray(ctx.skills) ? ctx.skills : [];
  add(wrap, el('p', 'cz-note',
    'Skills are catalogued read-only and never loaded ambiently; a skill acts only after it is installed into a '
    + 'repository and selected, and it grants no tool permission on its own. Manage repository selection in Forge → Rules & skills.'));
  if (!skills.length) { add(wrap, el('p', 'cz-empty', S.skills ? 'No skills discovered.' : 'Reading skills…')); return wrap; }
  const grid = el('div', 'cz-grid');
  for (const sk of skills) {
    const card = el('div', 'cz-card cz-card--static');
    add(card, markTile((sk.name || sk.id || '?').slice(0, 1).toUpperCase(), '#5FBF8F'));
    const b = el('span', 'cz-card-body');
    add(b, el('span', 'cz-card-name', sk.name || sk.id));
    add(b, el('span', 'cz-card-desc', sk.description || sk.provenance || 'installed skill'));
    add(card, b);
    add(card, el('span', 'cz-card-tag', sk.selectableInThisRepository === true ? 'repository' : 'read-only'));
    add(grid, card);
  }
  add(wrap, grid);
  return wrap;
}

function tabButton(id, label) {
  const b = btn(S.tab === id ? 'cz-tab on' : 'cz-tab', label, () => { S.tab = id; S.detail = null; render(); });
  b.setAttribute('aria-pressed', S.tab === id ? 'true' : 'false');
  return b;
}
function viewButton(id, label) {
  const b = btn(S.view === id ? 'cz-view on' : 'cz-view', label, () => { S.view = id; render(); });
  b.setAttribute('aria-pressed', S.view === id ? 'true' : 'false');
  return b;
}

function render() {
  if (!mount) return;
  const root = el('div', 'cz');
  const head = el('div', 'cz-head');
  add(head, el('h2', 'cz-title', 'Customize'));
  add(root, head);

  const bar = el('div', 'cz-bar');
  const tabs = el('div', 'cz-tabs');
  add(tabs, tabButton('skills', 'Skills'), tabButton('connectors', 'Connectors'), tabButton('plugins', 'Plugins'));
  const views = el('div', 'cz-views');
  add(views, viewButton('yours', 'Yours'), viewButton('discover', 'Discover'));
  add(bar, tabs, el('span', 'sp'), views);
  add(root, bar);

  if (S.detail) { add(root, detailPanel()); mount.replaceChildren(root); return; }

  if (S.tab === 'connectors') {
    if (S.view === 'yours') {
      add(root, mcpSection());
    } else {
      add(root, el('div', 'cz-sec-h2', 'Connectors'));
      const grid = el('div', 'cz-grid');
      const q = S.query.trim().toLowerCase();
      for (const c of CONNECTORS) if (!q || c.name.toLowerCase().includes(q)) add(grid, directoryCard(c, 'connector'));
      add(root, grid);
      add(root, mcpSection());
    }
  } else if (S.tab === 'plugins') {
    add(root, el('div', 'cz-sec-h2', 'Plugins'));
    const grid = el('div', 'cz-grid');
    for (const p of PLUGINS) add(grid, directoryCard(p, 'plugin'));
    add(root, grid);
  } else {
    add(root, skillsSection());
  }

  mount.replaceChildren(root);
}

// Boot: render immediately, then fill in the live data. Re-render when the panel
// is shown, in case the daemon answered while another surface was open.
render();
void loadMcp();
void loadSkills();
window.addEventListener('zeno:command-panel', (e) => { if (e.detail && e.detail.id === 'customize') render(); });
