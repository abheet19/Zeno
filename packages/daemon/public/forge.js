/**
 * Zeno Forge — the build surface, ported from docs/23-gate2-prototype.html.
 * ========================================================================
 *
 * WHAT THIS IS. The prototype's Forge is not a form; it is a full IDE in five
 * regions, and this file builds that IDE. The markup, the class names, the grid
 * and the measurements are the prototype's rForge() output — rgA the explorer
 * rail, rgB the code pane, rgC the agent chat, rgD the bottom drawer, rgE the
 * status bar — with the CSS living in index.html beside the Command port, which
 * is the pattern this window already follows (index.html + field.js).
 *
 * TWO THINGS HERE ARE NOT THE PROTOTYPE'S, and both are documented where they
 * are built rather than only here:
 *
 *   rgB IS MONACO, VS Code's own editor core, served from this machine out of
 *   /vendor/monaco (see monaco.js). Real tokenisation, rainbow bracket pairs,
 *   folding, multi-cursor, find and replace, a minimap, a right-click menu, and
 *   the TypeScript / JSON / CSS language services. A SAVE IS A PROPOSAL: Ctrl+S
 *   POSTs the buffer to /previews, the same gate an agent's write crosses, and
 *   what comes back is a capsule with a tier and a receipt. Nothing in this file
 *   writes to the sandbox.
 *
 *   THE AGENT-ONLY VIEW collapses rgA, rgB and rgD and gives rgC the window.
 *   Ctrl+Shift+A, or the control in rgE; the choice is remembered. It is where
 *   the approval capsules live IN LINE, which is the point of it — a run that
 *   has to ask is asking on the same surface it is running on. See section 3b.
 *
 * A SECOND NETWORK RULE, adopted with the editor: EVERY BYTE MONACO NEEDS IS
 * SERVED BY THIS DAEMON. The loader, the editor bundle, every lazily-required
 * language chunk and every web worker resolve to same-origin paths under
 * /vendor/monaco/, which `tools/vendor-monaco.mjs` fills at build time from a
 * ROOT devDependency. monaco-editor is never a runtime dependency of any
 * package — the zero-dependency check in ci.yml stays true, and stays honest.
 *
 * WHAT IS NOT PORTED IS THE PROTOTYPE'S DATA. The prototype ships synthetic
 * content and says so in its own footer. None of it is here. Every value on this
 * surface comes from the live daemon:
 *
 *   GET  /forge/status  -> { repo, branch, head, changed[], log[], tracked[],
 *                            trackedTotal, trackedCapped }   the tree and rgE
 *   GET  /forge/file    -> { contents, lines, bytes, eol, encoding, truncated }
 *                                                            the code pane
 *   GET  /forge/search  -> { matches[], files, total, truncated }  the Search panel
 *   GET  /forge/agents  -> { agents[], efforts[], localModels[] }  the pickers
 *   GET  /forge/tests   -> { scripts[], packageManager, caps }      real test scripts
 *   POST /forge/tests/run -> { ok, code, durationMs, stdout, stderr }
 *   GET  /forge/extensions -> local built-ins, skills and snippet manifests
 *   GET  /forge/connectors -> strict run-scoped MCP capability facts
 *   GET  /forge/run-progress -> owner-only SSE orchestration/token facts
 *   POST /forge/run     -> { run:{ok,agentId,model,effort,log,note}, changed[],
 *                            proposed[] }                    the chat
 *   POST /forge/commit  -> { receipt }                        the seal
 *
 * Rules and skill selection use /skills; owner commands use /forge/terminal.
 * Tests, the Zeno capability catalog, and run-scoped MCP connectors now come
 * from daemon routes. WHERE THERE IS NO REAL SOURCE, THE PANEL SAYS SO: CI and
 * Debug still name the missing wire and render nothing else. A panel that
 * invented a passing run would be worse than an absent panel.
 * Search LEFT that list: it is `git grep -n` through /forge/search now, and its
 * hint names exactly what git grep does and does not look at.
 *
 * NO SUCCESS BEFORE THE DAEMON CONFIRMS IT. `run.ok === true` means an agent
 * finished, not that anything landed — a run only ever PROPOSES. The one green
 * seal in this file is drawn from a commit receipt whose outcome is 'verified',
 * and it is drawn after that receipt is in hand, never on the click.
 *
 * NO RUNTIME NETWORK EGRESS. No CDN, no web font, no @import, no analytics. The
 * two faces are the self-hosted woff2 files under /glass/fonts, reached through
 * var(--font-mono) / var(--font-display) in tokens.css. Every fetch in this file
 * is same-origin to the daemon on loopback.
 *
 * EVERY VALUE IS WRITTEN WITH textContent. Git output, file contents and model
 * output are all attacker-adjacent strings; none of them is ever handed to
 * innerHTML. There is no innerHTML in this file. The one place markup is
 * produced from data is `monaco.editor.colorizeElement`, which is handed a node
 * whose text was set with textContent and which escapes every byte it tokenises
 * — the rule is unchanged: this file never builds markup out of a string.
 *
 * Exports init / initForge / default — nav.js lazy-imports this once, via
 * data-init="/forge.js", and calls `mod.init || mod.default` with the section.
 */

/* The approval capsule Command already uses, unchanged and not re-implemented:
   it re-hashes the binding in front of the owner, refuses Approve on an
   unresolved field, spends the control after one click, and seals only from a
   receipt. Forge renders that component, not a friendlier copy of it. */
import { pendingCapsuleNeedsRefresh, renderCapsule } from './capsule.js';
/* The editor, the theme built from glass/tokens.css, and the honest statement
   of which languages actually have a checker behind them. */
import { DIAGNOSED, ZENO_THEME, languageForPath, loadMonaco, monacoIfLoaded, onThemeChange } from './monaco.js';
import { forgeContextBody, forgeContextKey, newForgeContextState } from './forge-context-model.js';
import {
  applyRunProgress,
  finalTokenUsage,
  initialRunProgress,
  markRunProgressGap,
  phaseLabel,
  runTransportState,
  shouldRepaintRunProgress,
  tokenUsageLabel,
} from './run-progress-model.js';

/* ================================================================== *
 * 0 · DOM helpers, the owner token, and the one fetch shape           *
 * ================================================================== */

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

/** A button that is a real button: type set, keyboard-reachable, no div-as-control. */
function btn(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** Wall-clock HH:MM:SS. Local time on purpose: this stamps when the owner sitting
    at this machine last read the repository, not an instant on a shared timeline. */
function clockOf(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** A decorative glyph — hidden from the accessibility tree, never the only signal. */
function glyph(text, cls) {
  const g = el('span', cls, text);
  g.setAttribute('aria-hidden', 'true');
  return g;
}

/** The owner token the daemon injected into the shell, or '' on a read-only page. */
const OWNER_TOKEN = (() => {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' && v.trim() ? v.trim() : '';
})();

function authHeaders(extra) {
  const h = Object.assign({ accept: 'application/json' }, extra || {});
  if (OWNER_TOKEN) h['x-zeno-token'] = OWNER_TOKEN;
  return h;
}

/**
 * One shape for every daemon call. Same-origin, so the HttpOnly owner cookie an
 * authorised launch set rides along even when the meta token is absent; the
 * header is sent too, matching how app.js authenticates.
 * Returns { ok, status, data, error } and never throws.
 */
async function api(path, init) {
  const opts = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init || {});
  opts.headers = authHeaders(opts.headers);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    return { ok: false, status: 0, data: null, error: { message: (err && err.message) || 'the daemon did not answer.' } };
  }
  const data = await res.json().catch(() => null);
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: !res.ok ? (data && data.error) || { message: `The daemon answered ${res.status}.` } : null,
  };
}

function errText(r) {
  const e = r.error || {};
  return `${e.message || 'the daemon did not answer.'}${e.resolve ? ' ' + e.resolve : ''}`.trim();
}

function short(s, n) {
  const v = String(s ?? '');
  return v.length > n ? v.slice(0, n) + '…' : v;
}

function bytesLabel(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function clock(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return '--:--';
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** Human words for a git porcelain code. Unknown codes are shown raw, not guessed. */
function statusWord(code) {
  const map = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged',
    '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified',
    AD: 'added, then deleted', RM: 'renamed, then modified',
  };
  return map[String(code || '').trim()] || `git: ${String(code || '?').trim()}`;
}

/* ================================================================== *
 * 1a · the code pane's colours                                        *
 * ================================================================== *
 * The prototype paints keywords, strings and comments (.kw / .st / .cm)
 * and this is that, with one rule added: it runs ONLY for the handful of
 * extensions whose lexical shape it genuinely knows. A tokenizer guessing
 * at a language it does not know would mis-colour real source, which is
 * its own small dishonesty — so every other file is rendered plain, and
 * is still perfectly readable. Nothing here changes a single byte; it
 * only decides which span a byte is drawn in.                          */

const HL_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'json', 'css']);

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'namespace', 'declare',
  'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'async', 'await',
  'yield', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
  'delete', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'as', 'satisfies',
]);

function highlights(path) {
  const dot = String(path || '').lastIndexOf('.');
  return dot === -1 ? false : HL_EXT.has(path.slice(dot + 1).toLowerCase());
}

/** Split one line into [class, text] pairs. `st.block` carries /* … *​/ across lines. */
function tokenize(line, st) {
  const out = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (!plain) return;
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let last = 0;
    let m;
    while ((m = re.exec(plain)) !== null) {
      if (m.index > last) out.push(['', plain.slice(last, m.index)]);
      out.push([KEYWORDS.has(m[0]) ? 'kw' : '', m[0]]);
      last = m.index + m[0].length;
    }
    if (last < plain.length) out.push(['', plain.slice(last)]);
    plain = '';
  };
  while (i < line.length) {
    if (st.block) {
      const end = line.indexOf('*/', i);
      if (end === -1) { out.push(['cm', line.slice(i)]); i = line.length; }
      else { out.push(['cm', line.slice(i, end + 2)]); i = end + 2; st.block = false; }
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '//') { flush(); out.push(['cm', line.slice(i)]); i = line.length; continue; }
    if (two === '/*') { flush(); out.push(['cm', '/*']); st.block = true; i += 2; continue; }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      flush();
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) { j++; break; }
        j++;
      }
      out.push(['st', line.slice(i, j)]);
      i = j;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** The line's text node(s) — coloured where we know the language, plain where we don't. */
function lineSpan(text, colour, st) {
  const span = el('span', 'tx');
  if (!colour) {
    span.textContent = text === '' ? ' ' : text;
    return span;
  }
  const parts = tokenize(text, st);
  if (parts.length === 0) {
    span.textContent = ' ';
    return span;
  }
  for (const [cls, s] of parts) add(span, cls ? el('span', cls, s) : document.createTextNode(s));
  return span;
}

/* ================================================================== *
 * 1 · the honest-empty block                                          *
 * ================================================================== *
 * Every surface with no live source renders THIS and nothing else. It
 * names the thing that is missing, and it names why, so the absence is
 * information rather than a hole someone will later fill with a mock. */

function renderUnwired(title, body) {
  const box = el('div', 'unwired');
  add(box, el('b', null, title), el('span', null, body));
  return box;
}

/**
 * What the Search panel actually does, said once and shown in every state of it.
 * It is spelled out because each clause is a real limit of `git grep`, and a
 * search box that quietly ignores a regular expression, a build directory or a
 * .gitignore'd file is a box that answers a question nobody asked.
 */
const SEARCH_HINT =
  'git grep -n over the sandbox working tree: plain text, not a regular expression, ' +
  'and case is ignored. Tracked and untracked files are searched; files git ignores ' +
  'and files git sees as binary are not. There is no index — every result is read ' +
  'from the files as they are on disk right now.';

function renderNote(text, channel) {
  const n = el('div', channel ? `note ${channel}` : 'note');
  add(n, el('span', null, text));
  return n;
}

/* ================================================================== *
 * 2 · the surface                                                     *
 * ================================================================== */

export function initForge(section) {
  if (!section || section.dataset.forgeInit === '1') return;
  section.dataset.forgeInit = '1';

  const R = document.documentElement;

  /* ---- state. Every field is either null (not read yet) or live data. ----- */
  const S = {
    status: null,        // GET /forge/status, verbatim
    statusErr: null,
    reloading: false,    // an owner-asked reload is in flight
    readAt: null,        // Date of the last completed read, so reload can prove it ran
    agents: null,        // GET /forge/agents, verbatim
    agentsErr: null,
    context: null,       // GET /skills, including selected-repository rules
    contextErr: null,
    contextBusy: false,
    skillIds: new Set(),
    skillQuery: '',
    choosing: false,
    folderNote: '',
    terminalBusy: false,
    terminalErr: null,
    terminalResult: null,
    terminalCommand: '',
    terminalTabs: [{ id: 'shell-1', name: 'Shell 1', draft: '', history: [] }],
    terminalId: 'shell-1',
    terminalSeq: 1,
    tests: null,
    testsErr: null,
    testsBusy: false,
    testRunId: '',
    testResults: new Map(),
    extensions: null,
    extensionsErr: null,
    extensionsBusy: false,
    connectors: null,
    connectorsErr: null,
    connectorsBusy: false,
    collapsedDirs: new Set(),
    rainbowBrackets: true,
    explorerOpen: true,
    sessionOpen: true,
    thinkingExpanded: false,
    memory: null,
    memoryErr: null,
    memoryBusy: false,

    pan: 'explorer',     // rgA panel
    insp: 'chat',        // rgC inspector tab
    draw: 'terminal',    // rgD drawer tab

    // Each editor group owns its own tab order and active file. File contents
    // and dirty state remain path-scoped below, so opening the same path in two
    // groups never creates two competing buffers.
    editorGroups: [
      { tabs: [], file: null, caret: 0 },
      { tabs: [], file: null, caret: 0 },
    ],
    focusedGroup: 0,
    splitEditor: false,

    sessions: [],        // independent chat/run histories; each may run concurrently
    selectedSessionId: '',

    // The editor, and the one write it can make: a proposal.
    saving: false,
    saveErr: null,

    // The gate, made visible. Every entry is a capsule the daemon really holds
    // (or really held): {hash, at, tier, kind, summary, settled, outcome}.
    gates: [],
    gatesErr: null,
    streamDown: false,
    runProgressStreamDown: false,

    view: 'ide',         // 'ide' (five regions) or 'agent' (rgC takes the window)

    commitMsg: '',
    committing: false,
    receipt: null,
    commitErr: null,

    searchQ: '',         // what is typed in the search box
    searchScope: '',     // optional path the search is limited to
    searchBusy: false,
    searchErr: null,
    searchRes: null,     // GET /forge/search, verbatim
    searchFor: '',       // the query the result now on screen actually answers
  };

  // One canonical read record per path. The compatibility accessors keep the
  // rest of Forge talking about the focused group without duplicating state.
  const fileRecords = new Map();
  const group = (index = S.focusedGroup) => S.editorGroups[index === 1 ? 1 : 0];
  const recordFor = (path) => {
    if (!path) return null;
    let record = fileRecords.get(path);
    if (!record) {
      record = { data: null, error: null, busy: false, request: 0 };
      fileRecords.set(path, record);
    }
    return record;
  };
  Object.defineProperties(S, {
    open: { get: () => [...new Set(S.editorGroups.flatMap((entry) => entry.tabs))] },
    file: {
      get: () => group().file,
      set: (value) => { group().file = value || null; },
    },
    fileData: {
      get: () => recordFor(group().file)?.data || null,
      set: (value) => { const record = recordFor(group().file); if (record) record.data = value; },
    },
    fileErr: {
      get: () => recordFor(group().file)?.error || null,
      set: (value) => { const record = recordFor(group().file); if (record) record.error = value; },
    },
    fileBusy: {
      get: () => recordFor(group().file)?.busy || false,
      set: (value) => { const record = recordFor(group().file); if (record) record.busy = Boolean(value); },
    },
    caret: {
      get: () => group().caret,
      set: (value) => { group().caret = Number(value) || 0; },
    },
  });

  let nextSessionNumber = 1;
  function createSession() {
    const number = nextSessionNumber++;
    return {
      id: `agent-${number}`,
      name: `Agent ${number}`,
      draft: '',
      // Start on the no-bill rung while live availability is still loading.
      // Auto routing may choose another provider, but a hosted run always stops
      // for the explicit per-run confirmation below.
      agentId: 'local',
      model: '',
      effort: 'low',
      autoRoute: true,
      route: null,
      hostedConfirmation: null,
      chat: [],
      runs: [],
      proposals: [],
      routing: false,
      running: false,
      canceling: false,
      cancelNote: null,
      hostedRun: false,
      runId: null,
      runAt: null,
      runProgress: null,
      runProgressStale: false,
      // The switch is scoped to this session and defaults on. The records
      // themselves live in Vault Markdown, so creating/reloading a renderer does
      // not create a second chat-local memory store.
      ...newForgeContextState(),
    };
  }

  function activeSession() {
    return S.sessions.find((session) => session.id === S.selectedSessionId) || S.sessions[0];
  }

  function anySessionRunning() {
    return S.sessions.some((session) => session.routing || session.running);
  }

  function anotherHostedRunIsActive(session) {
    return S.sessions.some((item) => item !== session && item.running && item.hostedRun);
  }

  function provider(id) {
    const list = (S.agents && Array.isArray(S.agents.agents)) ? S.agents.agents : [];
    return list.find((agent) => agent && agent.id === id) || null;
  }

  function providerAvailable(id) {
    const item = provider(id);
    return item !== null && item.available !== false;
  }

  function firstAvailableProvider() {
    const list = (S.agents && Array.isArray(S.agents.agents)) ? S.agents.agents : [];
    const priority = ['local', 'codex', 'claude-code'];
    return priority.map((id) => list.find((item) => item && item.id === id && item.available !== false)).find(Boolean)
      || list.find((item) => item && item.available !== false)
      || null;
  }

  function addSession() {
    if (S.sessions.length >= 8) return;
    const session = createSession();
    S.sessions.push(session);
    S.selectedSessionId = session.id;
    paintC();
    paintE();
    const input = rgC.querySelector('#zf-task');
    if (input) input.focus();
  }

  function closeActiveSession() {
    const session = activeSession();
    if (!session || session.running || session.routing || S.sessions.length <= 1) return;
    const index = S.sessions.indexOf(session);
    if (index < 0) return;
    const hasUnsavedState = session.draft.trim() || session.hostedConfirmation
      || session.chat.length || session.runs.length || session.proposals.length;
    if (hasUnsavedState
      && !window.confirm(`Close ${session.name}?\n\nIts unsent task, in-window chat, and run history will be removed. Files, approvals, and receipts remain.`)) return;
    S.sessions.splice(index, 1);
    S.selectedSessionId = S.sessions[Math.min(index, S.sessions.length - 1)].id;
    paintC();
    paintE();
  }

  const firstSession = createSession();
  S.sessions.push(firstSession);
  S.selectedSessionId = firstSession.id;
  try { S.rainbowBrackets = localStorage.getItem('zeno-forge-rainbow') !== '0'; } catch { /* storage is optional */ }
  try { S.explorerOpen = localStorage.getItem('zeno-forge-explorer') !== '0'; } catch { /* storage is optional */ }
  try { S.sessionOpen = localStorage.getItem('zeno-forge-session') !== '0'; } catch { /* storage is optional */ }
  try { S.thinkingExpanded = localStorage.getItem('zeno-forge-thinking-expanded') === '1'; } catch { /* storage is optional */ }

  // Existing Forge renderers read these names throughout. Binding them to the
  // selected session keeps those renderers small while every asynchronous run
  // captures and updates its own session explicitly (see doRun).
  for (const field of ['agentId', 'model', 'effort', 'chat', 'runs', 'proposals', 'running', 'runAt']) {
    Object.defineProperty(S, field, {
      configurable: false,
      enumerable: false,
      get: () => activeSession()[field],
      set: (value) => { activeSession()[field] = value; },
    });
  }

  /* ---- the workbench regions, built once and refilled in place ----------- */
  const root = el('div', 'forge');
  const rgTop = el('div', 'rgTop');
  const rgA = el('aside', 'rgA');
  const rgB = el('div', 'rgB');
  const rgC = el('div', 'rgC');
  const rgD = el('div', 'rgD');
  const rgE = el('div', 'rgE');
  rgTop.setAttribute('aria-label', 'Forge workbench controls');
  rgA.setAttribute('aria-label', 'Explorer');
  rgB.setAttribute('aria-label', 'Code');
  rgC.setAttribute('aria-label', 'Agent session');
  rgD.setAttribute('aria-label', 'Problems, output, debug console, terminal and ports');
  rgE.setAttribute('aria-label', 'Workspace and editor status');
  add(root, rgTop, rgA, rgB, rgD, rgC, rgE);

  // Side panes are first-class workbench regions. Keep their visibility and
  // width under owner control just like the existing bottom drawer.
  const explorerDrag = btn('fg-vdrag fg-vdrag-left');
  explorerDrag.setAttribute('aria-label', 'Resize Explorer');
  explorerDrag.setAttribute('aria-orientation', 'vertical');
  const sessionDrag = btn('fg-vdrag fg-vdrag-right');
  sessionDrag.setAttribute('aria-label', 'Resize agent session');
  sessionDrag.setAttribute('aria-orientation', 'vertical');
  add(root, explorerDrag, sessionDrag);

  const paneSize = (property, fallback) => {
    const inline = parseFloat(root.style.getPropertyValue(property));
    if (Number.isFinite(inline)) return inline;
    // Use the actual responsive track before falling back. Otherwise the first
    // keyboard resize at laptop width jumps to the desktop default.
    const pane = property === '--fexplorer' ? rgA : rgC;
    const rendered = pane.getBoundingClientRect().width;
    return rendered > 0 ? rendered : fallback;
  };
  const savePaneSize = (key, value) => {
    try { localStorage.setItem(key, String(Math.round(value))); } catch { /* storage is optional */ }
  };
  const restorePaneSize = (key, property, min, max) => {
    try {
      const value = Number(localStorage.getItem(key));
      if (Number.isFinite(value) && value >= min && value <= max) root.style.setProperty(property, `${Math.round(value)}px`);
    } catch { /* storage is optional */ }
  };
  restorePaneSize('zeno-forge-explorer-width', '--fexplorer', 176, 440);
  restorePaneSize('zeno-forge-session-width', '--fsession', 260, 620);

  function syncPaneVisibility() {
    if (S.explorerOpen) R.removeAttribute('data-forge-explorer');
    else R.setAttribute('data-forge-explorer', 'closed');
    if (S.sessionOpen || S.view === 'agent') R.removeAttribute('data-forge-session');
    else R.setAttribute('data-forge-session', 'closed');
    explorerDrag.hidden = !S.explorerOpen || S.view === 'agent';
    sessionDrag.hidden = !S.sessionOpen || S.view === 'agent';
  }

  function setPaneOpen(which, open) {
    if (which === 'explorer') S.explorerOpen = open;
    if (which === 'session') S.sessionOpen = open;
    try { localStorage.setItem(`zeno-forge-${which}`, open ? '1' : '0'); } catch { /* storage is optional */ }
    syncPaneVisibility();
    paintTop();
    requestAnimationFrame(layoutEditors);
  }

  function wireSideDrag(handle, side) {
    const property = side === 'left' ? '--fexplorer' : '--fsession';
    const key = side === 'left' ? 'zeno-forge-explorer-width' : 'zeno-forge-session-width';
    const fallback = side === 'left' ? 318 : 440;
    const min = side === 'left' ? 176 : 260;
    const max = side === 'left' ? 440 : 620;
    const clamp = (value) => Math.max(min, Math.min(max, value));
    let bounds = null;
    const move = (ev) => {
      const raw = side === 'left' ? ev.clientX - bounds.left : bounds.right - ev.clientX;
      root.style.setProperty(property, `${Math.round(clamp(raw))}px`);
      layoutEditors();
    };
    const up = () => {
      handle.classList.remove('grab');
      const value = paneSize(property, fallback);
      savePaneSize(key, value);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointerdown', (ev) => {
      bounds = root.getBoundingClientRect();
      handle.classList.add('grab');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      ev.preventDefault();
    });
    handle.addEventListener('dblclick', () => {
      root.style.removeProperty(property);
      try { localStorage.removeItem(key); } catch { /* storage is optional */ }
      layoutEditors();
    });
    handle.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      const direction = ev.key === 'ArrowRight' ? 1 : -1;
      const delta = side === 'left' ? direction * 16 : direction * -16;
      const value = clamp(paneSize(property, fallback) + delta);
      root.style.setProperty(property, `${Math.round(value)}px`);
      savePaneSize(key, value);
      layoutEditors();
      ev.preventDefault();
    });
  }
  wireSideDrag(explorerDrag, 'left');
  wireSideDrag(sessionDrag, 'right');
  section.replaceChildren(root);

  /* ---- the editor's host and its state, declared before anything can reach
     for them ---------------------------------------------------------------
     The host is built ONCE and never rebuilt. paintB refreshes the chrome above
     it and leaves the host alone, because tearing a Monaco instance down on
     every repaint would throw away the cursor, the undo stack, the folding
     state and the selection — everything that makes an editor an editor rather
     than a viewer. `edMon` is monaco's container; `edAux` is every other thing
     the pane can show, and exactly one of the two is ever visible.

     These sit here, above the masked-mode block, and not down in the rgB
     section where they are used: `syncLock` runs on the very next lines and
     reaches for `ed`, and a `let` read before its declaration is a
     ReferenceError, not an undefined. */
  const edHost = el('div', 'edhost');
  const paneViews = [0, 1].map((index) => {
    const shell = el('section', 'edpane');
    shell.dataset.editorGroup = String(index);
    shell.setAttribute('aria-label', `Editor group ${index + 1}`);
    const chrome = el('div', 'edchrome');
    const body = el('div', 'edbody');
    const mon = el('div', 'edmon');
    const aux = el('div', 'edaux');
    mon.hidden = true;
    add(body, mon, aux);
    add(shell, chrome, body);
    shell.addEventListener('pointerdown', () => focusEditorGroup(index, false));
    add(edHost, shell);
    return { shell, chrome, body, mon, aux, editor: null, modelSubs: [], placeViewport: null, lastCaret: -1 };
  });
  const editorSplitDrag = el('div', 'edsplit-drag');
  editorSplitDrag.tabIndex = 0;
  editorSplitDrag.setAttribute('role', 'separator');
  editorSplitDrag.setAttribute('aria-label', 'Resize editor groups');
  editorSplitDrag.setAttribute('aria-orientation', 'vertical');
  edHost.insertBefore(editorSplitDrag, paneViews[1].shell);
  paneViews[1].shell.hidden = true;
  editorSplitDrag.hidden = true;

  // These aliases always point at the focused group. Existing menu, status and
  // governance code therefore keeps one active-editor contract while the two
  // pane records hold their independent view state.
  let edMon = paneViews[0].mon;
  let edAux = paneViews[0].aux;

  let M = null;              // the monaco namespace, once it is loaded
  let ed = null;             // focused editor instance, once it is created
  let edErr = null;          // why the editor is absent, in the owner's words
  const models = new Map();  // path -> monaco ITextModel
  let modelSubs = paneViews[0].modelSubs;
  /** Paths whose buffer has been touched since it was read. Guards modelFor:
      a repaint must never overwrite unsaved edits with the bytes on disk. */
  const dirtyPaths = new Set();
  let lastCaretPainted = -1;

  function bindEditorGroup(index) {
    S.focusedGroup = index === 1 ? 1 : 0;
    const view = paneViews[S.focusedGroup];
    edMon = view.mon;
    edAux = view.aux;
    ed = view.editor;
    modelSubs = view.modelSubs;
    lastCaretPainted = view.lastCaret;
    placeViewport = view.placeViewport;
  }

  function persistEditorGroup() {
    const view = paneViews[S.focusedGroup];
    view.editor = ed;
    view.modelSubs = modelSubs;
    view.lastCaret = lastCaretPainted;
    view.placeViewport = placeViewport;
  }

  function focusEditorGroup(index, repaint = true) {
    if (index === 1 && !S.splitEditor) return;
    persistEditorGroup();
    bindEditorGroup(index);
    for (const [at, view] of paneViews.entries()) view.shell.dataset.focused = at === S.focusedGroup ? 'true' : 'false';
    if (repaint) {
      paintB();
      paintE();
    }
  }

  function forEditorGroup(index, action) {
    const previous = S.focusedGroup;
    persistEditorGroup();
    bindEditorGroup(index);
    try { return action(); }
    finally {
      persistEditorGroup();
      bindEditorGroup(previous);
    }
  }

  function layoutEditors() {
    for (const view of paneViews) if (view.editor) view.editor.layout();
  }
  function setEditorSplitFraction(value) {
    const fraction = Math.max(0.25, Math.min(0.75, value));
    edHost.style.setProperty('--editor-split', `${(fraction * 100).toFixed(2)}%`);
    try { localStorage.setItem('zeno-forge-editor-split', String(fraction)); } catch { /* optional */ }
    layoutEditors();
  }
  editorSplitDrag.addEventListener('pointerdown', (event) => {
    editorSplitDrag.setPointerCapture(event.pointerId);
    const move = (next) => {
      const bounds = edHost.getBoundingClientRect();
      if (bounds.width) setEditorSplitFraction((next.clientX - bounds.left) / bounds.width);
    };
    const up = () => {
      editorSplitDrag.removeEventListener('pointermove', move);
      editorSplitDrag.removeEventListener('pointerup', up);
    };
    editorSplitDrag.addEventListener('pointermove', move);
    editorSplitDrag.addEventListener('pointerup', up);
    event.preventDefault();
  });
  editorSplitDrag.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const raw = parseFloat(edHost.style.getPropertyValue('--editor-split')) / 100;
    setEditorSplitFraction((Number.isFinite(raw) ? raw : 0.5) + (event.key === 'ArrowRight' ? 0.03 : -0.03));
    event.preventDefault();
  });
  try {
    const savedSplit = Number(localStorage.getItem('zeno-forge-editor-split'));
    if (Number.isFinite(savedSplit) && savedSplit > 0) setEditorSplitFraction(savedSplit);
  } catch { /* optional */ }
  paneViews[0].shell.dataset.focused = 'true';
  syncPaneVisibility();

  /* ---- masked mode ------------------------------------------------------- *
   * The shell's `masked` control sets data-lock on :root, and the CSS veils
   * Forge's work surfaces the way the prototype does. This is the prototype's
   * pill that goes with it, and it is here for one reason: a blur with no
   * caption is indistinguishable from a broken render. The wording is the
   * prototype's and it is precise — the surfaces are WITHHELD from this screen,
   * not stopped. A run in flight keeps running; masking hides, it does not halt.
   *
   * An attribute observer rather than a click handler, so the pill is correct no
   * matter who set the attribute — the control, a restored preference, another
   * surface — and correct when Forge is opened with masking already on. */
  const lockPill = el('div', 'fglock');
  add(lockPill, glyph('', 'dot'), el('span', null, 'work surfaces withheld · masked'));
  lockPill.hidden = true;
  add(root, lockPill);
  const syncLock = () => {
    const masked = R.getAttribute('data-lock') === '1';
    lockPill.hidden = !masked;
    /* The editor's find widget, suggestions and parameter hints float above the
       pane, and its right-click menu is mounted on the BODY by monaco's own
       context-view service — outside anything the masked-mode CSS can veil. A
       menu or a suggestion list left open would sit unblurred over a blurred
       pane and show the very text the owner just withheld. So masking closes
       the three that CAN be closed by command, and drops focus out of the
       buffer, which dismisses the rest. The body-mounted menu is handled in
       CSS, beside the rest of the veil, because it is not this editor's to
       close. */
    if (masked) {
      for (const view of paneViews) {
        if (!view.editor) continue;
        view.editor.trigger('zeno.mask', 'closeFindWidget', null);
        view.editor.trigger('zeno.mask', 'hideSuggestWidget', null);
        view.editor.trigger('zeno.mask', 'closeParameterHints', null);
      }
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && rgB.contains(focused)) focused.blur();
    }
  };
  syncLock();
  new MutationObserver(syncLock).observe(R, { attributes: true, attributeFilter: ['data-lock'] });

  /* ================================================================ *
   * workbench bar — mode, real view shortcuts, and concurrent agents *
   * ================================================================ */

  function paintTop() {
    const mode = el('div', 'fgmode');
    mode.setAttribute('role', 'tablist');
    mode.setAttribute('aria-label', 'Forge mode');
    for (const [id, label] of [['agent', 'Agent'], ['ide', 'Editor']]) {
      const b = btn(null, label, () => setView(id));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', S.view === id ? 'true' : 'false');
      add(mode, b);
    }

    const menu = el('div', 'fgmenu');
    const item = (label, title, action) => {
      const b = btn(null, label, action);
      b.title = title;
      add(menu, b);
    };
    item('File', 'Open the Explorer', () => { setView('ide'); setPaneOpen('explorer', true); S.pan = 'explorer'; paintA(); });
    // setView repaints the top bar through paintC. Focus after that repaint so
    // the browser cannot return focus to the menu button that was just removed.
    const withActiveEditor = (action) => {
      setView('ide');
      requestAnimationFrame(() => {
        const activeEditor = paneViews[S.focusedGroup]?.editor;
        if (activeEditor) action(activeEditor);
      });
    };
    const focusActiveEditor = (editor) => {
      editor.focus();
      const root = editor.getDomNode?.();
      if (root && !root.contains(document.activeElement)) {
        // Chromium's native EditContext can ignore Monaco's first focus call.
        root.querySelector('[role="textbox"], textarea')?.focus();
      }
    };
    item('Edit', 'Focus the active editor', () => withActiveEditor(focusActiveEditor));
    item('Selection', 'Expand the current editor selection', () => withActiveEditor((editor) => {
      focusActiveEditor(editor);
      editor.trigger('zeno.menu', 'editor.action.smartSelect.expand', null);
    }));
    item('View', 'Switch between the full IDE and focused agent', () => setView(S.view === 'ide' ? 'agent' : 'ide'));
    const openRepositorySearch = () => {
      if (S.view !== 'ide') setView('ide');
      if (!S.explorerOpen) setPaneOpen('explorer', true);
      S.pan = 'search';
      paintA();
      requestAnimationFrame(() => rgA.querySelector('.sform input')?.focus());
    };
    item('Go', 'Search the selected repository', openRepositorySearch);
    item('Run', 'Focus the agent task composer', () => {
      if (!S.sessionOpen) setPaneOpen('session', true);
      S.insp = 'chat'; paintC();
      const input = rgC.querySelector('#zf-task');
      if (input) input.focus();
    });
    item('Terminal', 'Open the owner terminal', () => { setView('ide'); S.draw = 'terminal'; setDrawerMin(false); paintD(); });
    item('Help', 'Open repository rules and installed skills', openSkillsCatalog);

    const centre = btn('fgworkspace', null, openRepositorySearch);
    centre.setAttribute('aria-label', 'Search files in the Forge workspace');
    centre.title = 'Search files and symbols in the selected repository';
    const st = S.status;
    add(centre, glyph('⌕', 'fgworkspace-mark'), el('span', null, st && st.repo ? `${repoName(st)} — search` : 'Search Forge workspace'));

    const right = el('div', 'fgtop-right');
    const running = S.sessions.filter((session) => session.running).length;
    if (running) {
      const chip = el('span', 'chip');
      chip.dataset.state = 'listening';
      add(chip, glyph('●', 'chip-glyph'), document.createTextNode(`${running} running`));
      add(right, chip);
    }
    const paneToggle = (label, mark, pressed, action) => {
      const toggle = btn('fgpane-toggle', mark, action);
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      toggle.title = label;
      add(right, toggle);
    };
    if (S.view === 'ide') {
      paneToggle(S.explorerOpen ? 'Hide Explorer' : 'Show Explorer', '◧', S.explorerOpen, () => setPaneOpen('explorer', !S.explorerOpen));
      paneToggle(drawerMin() ? 'Show bottom panel' : 'Hide bottom panel', '▤', !drawerMin(), () => setDrawerMin(!drawerMin()));
      paneToggle(S.sessionOpen ? 'Hide agent session' : 'Show agent session', '◨', S.sessionOpen, () => setPaneOpen('session', !S.sessionOpen));
    }
    const fresh = btn('btn sm fgnew', '+ New agent', addSession);
    fresh.disabled = S.sessions.length >= 8;
    fresh.title = fresh.disabled ? 'Forge keeps at most eight sessions in one window.' : 'Start another independent agent session';
    add(right, fresh);
    rgTop.replaceChildren(mode, menu, centre, right);
  }

  /* ================================================================ *
   * rgA — the explorer rail: repo head, panel body, panel switcher    *
   * ================================================================ */

  const PANELS = [
    ['explorer', 'Explorer'],
    ['search', 'Search'],
    ['scm', 'Source control'],
    ['extensions', 'Extensions & themes'],
    ['rules', 'Rules & skills'],
    ['mcp', 'MCP servers'],
    ['tests', 'Tests'],
    ['debug', 'Debug'],
    ['tasks', 'Task board'],
  ];

  /** Open the capability catalog in the session inspector; Lens stays exact context. */
  function openSkillsCatalog() {
    if (S.view === 'ide' && !S.sessionOpen) setPaneOpen('session', true);
    S.insp = 'skills';
    paintC();
    if (!S.context && !S.contextBusy) void loadContext();
    if (!S.extensions && !S.extensionsBusy) void loadExtensions();
  }

  function paintA() {
    const st = S.status;

    // Opening a repository and refreshing it are separate owner actions.
    const head = el('div', 'mdl');
    const name = el('b', null, st && st.repo ? repoName(st) : 'sandbox');
    name.title = st && st.root ? String(st.root) : 'the daemon sandbox';
    const open = btn('fgicon', S.choosing ? '…' : '+', () => void chooseFolder());
    open.disabled = S.choosing || anySessionRunning() || S.terminalBusy || !!S.testRunId || S.saving;
    open.setAttribute('aria-label', S.choosing ? 'Opening folder' : 'Open folder');
    open.title = 'Choose the repository Zeno should work in';
    const reload = btn('fgicon', S.reloading ? '…' : '↻', () => void reloadRepo());
    reload.disabled = S.reloading || S.choosing;
    reload.setAttribute('aria-label', S.reloading ? 'Reading repository' : 'Reload repository');
    reload.title = S.readAt ? `Last read at ${clockOf(S.readAt)}` : 'Refresh files, providers, repository rules and skills';
    head.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    add(head, name, el('span', 'sp'), open, reload);
    if (S.folderNote) add(head, el('span', 'hint', S.folderNote));

    const body = el('div', 'panbody');
    add(body, PANEL[S.pan] ? PANEL[S.pan]() : PANEL.explorer());

    const activity = el('nav', 'fgactivity');
    activity.setAttribute('aria-label', 'Forge views');
    const icons = {
      explorer: '▱', search: '⌕', scm: '⑂', extensions: '⬡', rules: '✦',
      mcp: '⇄', tests: '✓', debug: '▷', tasks: '☷',
    };
    for (const [id, label] of PANELS) {
      const b = btn(null, label, () => {
        S.pan = id;
        paintA();
        if (id === 'rules') {
          if (!S.context && !S.contextBusy) void loadContext();
          if (!S.extensions && !S.extensionsBusy) void loadExtensions();
        }
        if (id === 'tests' && !S.tests && !S.testsBusy) void loadTests();
        if (id === 'extensions' && !S.extensions && !S.extensionsBusy) void loadExtensions();
        if (id === 'mcp' && !S.connectors && !S.connectorsBusy) void loadConnectors();
      });
      b.setAttribute('aria-current', id === S.pan ? 'true' : 'false');
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = icons[id] || '·';
      add(activity, b);
    }

    const side = el('div', 'fgside');
    const current = PANELS.find(([id]) => id === S.pan);
    add(side, el('div', 'fgside-title', current ? current[1] : 'Explorer'), head, body);
    rgA.replaceChildren(activity, side);
  }

  function workspaceName(st) {
    return st && st.root
      ? String(st.root).replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'sandbox'
      : 'sandbox';
  }

  function repoName(st) {
    const b = String(st.branch || '');
    const folder = workspaceName(st);
    return b ? `${folder} · ${b}` : folder;
  }

  /* ---- the panels. Two are real; the rest say plainly that they are not. -- */
  const PANEL = {
    /* EXPLORER — the real file tree of the sandbox repository, grouped by
       directory the way the prototype groups SRC/TOOLBAR/, SRC/LLT/, TESTS/.
       Every path here came from `git ls-files` plus `git status`; none is
       invented, and when git gives us nothing the panel says exactly that. */
    explorer() {
      const wrap = el('div');
      if (S.statusErr) {
        add(wrap, renderUnwired('The tree could not be read', S.statusErr));
        return wrap;
      }
      if (!S.status) {
        add(wrap, renderUnwired('Reading the repository…', 'Asking the daemon for the sandbox file list.'));
        return wrap;
      }
      if (!S.status.repo) {
        add(wrap, renderUnwired(
          'The sandbox is not a git repository',
          `${S.status.note || 'There is no repository here yet.'} With no repository there is no file list to show, so this tree is empty rather than filled in.`,
        ));
        return wrap;
      }

      const changed = new Map();
      for (const c of S.status.changed || []) changed.set(c.path, c.status);
      const tracked = Array.isArray(S.status.tracked) ? S.status.tracked : [];
      // Untracked-but-present files are real files too: git named them in
      // `status`, so they belong in the tree beside the tracked ones.
      // Sort by DIRECTORY first, then by file name — not by the whole path.
      // Sorting the raw strings interleaves "src/scratch.ts" between
      // "src/llt/…" and "src/toolbar/…", which splits SRC/ into two headings
      // for the same directory. Grouping is the point of this tree.
      const dirOf = (p) => (p.lastIndexOf('/') === -1 ? '' : p.slice(0, p.lastIndexOf('/')));
      const baseOf = (p) => (p.lastIndexOf('/') === -1 ? p : p.slice(p.lastIndexOf('/') + 1));
      const paths = [...new Set([...tracked, ...changed.keys()])].sort((a, b) => {
        const da = dirOf(a);
        const db = dirOf(b);
        return da === db ? baseOf(a).localeCompare(baseOf(b)) : da.localeCompare(db);
      });

      if (paths.length === 0) {
        add(wrap, renderUnwired(
          'The repository is empty',
          'git lists no files in the sandbox — nothing is tracked and nothing has changed. The tree fills in as soon as a file exists.',
        ));
        return wrap;
      }

      const tree = el('div', 'tree fgtree');
      const rootNode = { dirs: new Map(), files: [] };
      for (const path of paths) {
        const parts = path.split('/').filter(Boolean);
        let node = rootNode;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
          node = node.dirs.get(parts[i]);
        }
        node.files.push({ name: parts[parts.length - 1] || path, path });
      }

      const renderNode = (node, prefix, depth, target) => {
        const directories = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [name, child] of directories) {
          const path = prefix ? `${prefix}/${name}` : name;
          const collapsed = S.collapsedDirs.has(path);
          const folder = btn('fgtree-folder', null, () => {
            if (collapsed) S.collapsedDirs.delete(path); else S.collapsedDirs.add(path);
            paintA();
          });
          folder.style.setProperty('--depth', String(depth));
          folder.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          folder.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${path}`);
          folder.title = path;
          add(folder, glyph(collapsed ? '›' : '⌄', 'fgchev'), glyph('◇', 'fgfolder'), el('span', 'nm', name));
          add(target, folder);
          if (!collapsed) renderNode(child, path, depth + 1, target);
        }
        for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) {
          const b = btn('fgtree-file', null, () => openFile(file.path));
          b.style.setProperty('--depth', String(depth));
          const dirty = changed.has(file.path);
          const mark = glyph(dirty ? '●' : '○', 'fgfile-mark');
          mark.style.color = dirty ? 'var(--green)' : 'var(--ink-3)';
          add(b, glyph('', 'fgchev'), mark, el('span', 'nm', file.name));
          b.title = dirty ? `${file.path} — ${statusWord(changed.get(file.path))}` : file.path;
          b.setAttribute('aria-current', file.path === S.file ? 'true' : 'false');
          add(target, b);
        }
      };
      renderNode(rootNode, '', 0, tree);
      add(wrap, tree);

      if (S.status.trackedCapped) {
        add(wrap, el('div', 'hint',
          `Showing the first ${tracked.length} of ${S.status.trackedTotal} tracked files. The rest are in the repository; they are simply not drawn here.`));
      }
      add(wrap, el('div', 'hint',
        '● changed in the working tree · ○ unchanged. Both come from git, read fresh each time you reload.'));
      return wrap;
    },

    /* SOURCE CONTROL — real: the branch, HEAD, the working tree, the last five
       commits, and the one write Forge itself may land. */
    scm() {
      const wrap = el('div', 'pw');
      if (!S.status && !S.statusErr) {
        add(wrap, renderUnwired('Reading the repository…', 'Asking the daemon for the branch, the working tree and the recent commits.'));
        return wrap;
      }
      if (!S.status || !S.status.repo) {
        add(wrap, renderUnwired(
          S.statusErr ? 'The repository could not be read' : 'No repository',
          S.statusErr || (S.status && S.status.note) || 'The sandbox is not a git repository, so there is no working tree to show.',
        ));
        return wrap;
      }
      add(wrap, el('div', 'd', 'working tree'));
      const changed = S.status.changed || [];
      if (changed.length === 0) {
        add(wrap, el('div', 'frow', 'clean — nothing changed'));
      } else {
        for (const c of changed) {
          const row = el('div', 'frow');
          const nm = el('span', 'nm', c.path);
          nm.title = c.path;
          add(row, nm, el('span', 'tag', statusWord(c.status)));
          add(wrap, row);
        }
      }

      add(wrap, el('div', 'd', 'branch'));
      const br = el('div', 'frow');
      add(br, el('span', 'nm', S.status.branch || '(unknown)'), el('span', 'tag', S.status.head ? `HEAD ${S.status.head}` : 'no commits yet'));
      add(wrap, br);

      const log = S.status.log || [];
      if (log.length) {
        add(wrap, el('div', 'd', 'recent commits'));
        for (const c of log) {
          const row = el('div', 'frow');
          const nm = el('span', 'nm', c.summary || '');
          nm.title = c.summary || '';
          add(row, nm, el('span', 'tag', c.sha || ''));
          add(wrap, row);
        }
      }

      /* The one write Forge lands itself — and it still goes through the gate:
         POST /forge/commit previews a vcs.commit, the owner's click is the
         approval, and the seal below is drawn from the receipt that comes back. */
      add(wrap, el('div', 'd', 'commit'));
      const msg = el('input');
      msg.type = 'text';
      msg.placeholder = 'commit message';
      msg.value = S.commitMsg;
      msg.setAttribute('aria-label', 'Commit message');
      msg.style.cssText = 'width:100%;background:var(--g1);border:1px solid var(--rule-2);border-radius:7px;padding:6px 8px;color:var(--ink);font:inherit;font-size:11.5px';
      msg.addEventListener('input', () => { S.commitMsg = msg.value; commitBtn.disabled = !canCommit(); });
      add(wrap, msg);

      const acts = el('div', 'acts');
      const commitBtn = btn('btn sm', 'Commit through the gate', () => void doCommit());
      commitBtn.disabled = !canCommit();
      add(acts, commitBtn);
      add(wrap, acts);

      if (!OWNER_TOKEN) {
        add(wrap, renderNote('This page holds no owner token, so it cannot commit. Open Zeno from its own launcher to get one.', 'rd'));
      } else if (changed.length === 0) {
        add(wrap, el('div', 'hint', 'Nothing to commit — the working tree is clean.'));
      }

      if (S.commitErr) add(wrap, renderNote(S.commitErr, 'rd'));
      if (S.receipt) add(wrap, renderReceipt(S.receipt));

      add(wrap, el('div', 'hint',
        'Forge stages and previews. The commit is the only write it lands, and even that is previewed, approved and receipted like any other action.'));
      return wrap;
    },

    /* SEARCH — real: `git grep -n` over the sandbox, through GET /forge/search.
       There is no index behind this and none is claimed. Every row is one line
       git found in one file that is really in this working tree, and clicking a
       row opens that file at that line in the code pane. */
    search() {
      const wrap = el('div', 'pw');
      add(wrap, searchUI());

      if (S.searchBusy) {
        add(wrap, renderUnwired('Searching…', `Running git grep for “${short(S.searchFor, 60)}” across the sandbox.`));
        return wrap;
      }
      if (S.searchErr) {
        add(wrap, renderUnwired('The search could not run', S.searchErr));
        return wrap;
      }

      const r = S.searchRes;
      if (!r) {
        add(wrap, el('div', 'hint', SEARCH_HINT));
        return wrap;
      }
      if (r.repo === false) {
        add(wrap, renderUnwired(
          'The sandbox is not a git repository',
          `${r.note || 'There is no repository here yet.'} git grep needs one, so there is nothing to search rather than nothing found.`,
        ));
        return wrap;
      }

      const matches = Array.isArray(r.matches) ? r.matches : [];
      if (matches.length === 0) {
        add(wrap, renderUnwired(
          `No match for “${short(r.query, 60)}”`,
          `git grep read every text file in the sandbox${r.scope ? ` under ${r.scope}` : ''} and found this string in none of them. That is the answer, not a failure.`,
        ));
        add(wrap, el('div', 'hint', SEARCH_HINT));
        return wrap;
      }

      // One heading per file, its hits beneath it, in the order git returned
      // them — which is path order, then line order.
      const tree = el('div', 'tree');
      let group = null;
      for (const m of matches) {
        if (m.path !== group) {
          group = m.path;
          const d = el('div', 'd', m.path);
          d.title = m.path;
          add(tree, d);
        }
        const b = btn(null, null, () => openFile(m.path, m.line));
        add(b, el('span', 'sln', m.line));
        const tx = el('span', 'nm stx', m.text + (m.clipped ? ' …' : ''));
        add(b, tx);
        b.title = `${m.path}:${m.line}  ${m.text}${m.clipped ? ' … (line clipped)' : ''}`;
        b.setAttribute('aria-current', m.path === S.file && m.line === S.caret ? 'true' : 'false');
        add(tree, b);
      }
      add(wrap, tree);

      const files = typeof r.files === 'number' ? r.files : new Set(matches.map((m) => m.path)).size;
      const total = typeof r.total === 'number' ? r.total : matches.length;
      add(wrap, el('div', 'hint', r.truncated
        ? `Showing the first ${matches.length} of ${total} matching lines, in ${files} file${files === 1 ? '' : 's'}. The rest are in the repository; they are simply not drawn here.`
        : `${total} matching line${total === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`));
      add(wrap, el('div', 'hint', SEARCH_HINT));
      return wrap;
    },

    /* EXTENSIONS & THEMES — a live Zeno catalog, with provenance and limits. */
    extensions() {
      const wrap = el('div', 'pw');
      const heading = el('div', 'acts');
      add(heading, el('div', 'd', 'Zeno capabilities'));
      const refresh = btn('btn sm ghost', S.extensionsBusy ? 'Reading…' : 'Refresh catalog', () => void loadExtensions());
      refresh.disabled = S.extensionsBusy;
      add(heading, el('span', 'sp'), refresh);
      add(wrap, heading);

      const monaco = el('div', 'box');
      add(monaco, el('b', null, 'Monaco editor core'), el('div', null, 'Enabled · syntax services, tabs, minimap, find, folding, and multi-cursor editing are served locally.'));
      add(wrap, monaco);

      const rainbow = el('div', 'box');
      const label = el('label', 'fgcheck');
      const check = el('input');
      check.type = 'checkbox';
      check.checked = S.rainbowBrackets;
      check.addEventListener('change', () => {
        S.rainbowBrackets = check.checked;
        try { localStorage.setItem('zeno-forge-rainbow', check.checked ? '1' : '0'); } catch { /* storage is optional */ }
        for (const view of paneViews) if (view.editor) view.editor.updateOptions({
          bracketPairColorization: { enabled: check.checked, independentColorPoolPerBracketType: true },
          guides: { bracketPairs: check.checked ? 'active' : false, bracketPairsHorizontal: check.checked ? 'active' : false, indentation: true, highlightActiveIndentation: true },
        });
      });
      add(label, check, document.createTextNode(' Rainbow brackets'));
      add(rainbow, label, el('div', null, 'A real Monaco editor setting. The choice applies immediately and is stored only on this device.'));
      add(wrap, rainbow);

      add(wrap, el('div', 'd', 'glass theme'));
      const themes = el('div', 'acts fgthemes');
      for (const [value, labelText] of [['system', 'System'], ['dark', 'Graphite'], ['light', 'Glass Dawn']]) {
        const b = btn('btn sm', labelText, () => {
          if (value === 'system') R.removeAttribute('data-theme'); else R.setAttribute('data-theme', value);
          try { localStorage.setItem('zeno-th', value); } catch { /* storage is optional */ }
          paintA();
        });
        const current = R.getAttribute('data-theme') || 'system';
        b.setAttribute('aria-pressed', current === value ? 'true' : 'false');
        add(themes, b);
      }
      add(wrap, themes, el('div', 'hint', 'Themes use the same Glass design tokens as Command and Counsel; Monaco rebuilds from those tokens when the theme changes.'));
      if (S.extensionsErr) add(wrap, renderNote(`Capability catalog unavailable: ${S.extensionsErr}`, 'rd'));
      if (!S.extensions && !S.extensionsErr) add(wrap, renderNote('Reading installed local capabilities…'));
      const catalog = S.extensions;
      if (catalog) {
        add(wrap, el('div', 'd', 'installed skills'));
        const skills = Array.isArray(catalog.skills) ? catalog.skills : [];
        if (!skills.length) add(wrap, renderNote('No repository or global Agent Skills were found in the bounded local libraries.'));
        for (const skill of skills) {
          const box = el('div', 'box');
          add(box, el('b', null, skill.name || skill.id));
          add(box, el('div', null, skill.status === 'unreadable' ? `Unreadable · ${skill.reason || 'unknown reason'}` : (skill.description || 'No description.')));
          add(box, el('div', 'hint', `${skill.provenance || 'unknown source'} · ${skill.selectableInThisRepository ? 'selectable for this repository' : 'catalogued here; install into this repository to select'} · ${skill.verdict || skill.status || 'read'}`));
          add(box, el('div', 'hint', Array.isArray(skill.permissions) && skill.permissions.length ? `Permission: ${skill.permissions.join(', ')}. ${skill.authority || ''}` : 'This entry grants no tool permission.'));
          add(wrap, box);
        }
        add(wrap, el('div', 'd', 'snippet manifests'));
        const snippets = Array.isArray(catalog.snippets) ? catalog.snippets : [];
        if (!snippets.length) add(wrap, renderNote('No .code-snippets manifests were found in the repository or VS Code user snippets folder.'));
        for (const snippet of snippets) {
          const box = el('div', 'box');
          add(box, el('b', null, snippet.file), el('div', null, `${snippet.entries || 0} snippet${snippet.entries === 1 ? '' : 's'} · ${snippet.provenance}`));
          add(box, el('div', 'hint', snippet.status === 'unreadable'
            ? `Could not read: ${snippet.reason}`
            : 'Catalogued only. Forge does not inject VS Code user snippets into Monaco yet.'));
          add(wrap, box);
        }
        const actions = el('div', 'acts');
        const choose = btn('btn sm', 'Open Rules & skills', openSkillsCatalog);
        add(actions, choose);
        add(wrap, actions, el('div', 'hint', catalog.note || 'Zeno capability catalog.'));
        add(wrap, renderNote('VS Code Marketplace and VSIX extensions are not compatible with this build. The list above contains only capabilities Zeno found locally and can describe truthfully.'));
      }
      return wrap;
    },

    /* ---- source-backed views; absent sources still say so plainly. -------- */
    rules() { return rulesSkillsPanel(); },
    mcp() {
      const wrap = el('div', 'pw');
      const hd = el('div', 'acts');
      add(hd, el('div', 'd', 'run-scoped MCP & connectors'));
      const refresh = btn('btn sm ghost', S.connectorsBusy ? 'Reading…' : 'Refresh', () => void loadConnectors());
      refresh.disabled = S.connectorsBusy;
      add(hd, el('span', 'sp'), refresh);
      add(wrap, hd);
      if (S.connectorsErr) add(wrap, renderNote(`Connector catalog unavailable: ${S.connectorsErr}`, 'rd'));
      if (!S.connectors && !S.connectorsErr) add(wrap, renderNote('Reading the daemon’s strict MCP configuration…'));
      const catalog = S.connectors;
      if (catalog) {
        for (const server of catalog.servers || []) {
          const box = el('div', 'box');
          add(box, el('b', null, server.name || server.id));
          const status = server.configured ? 'configured' : 'off';
          add(box, el('div', null, `${status} · ${server.activeRuns || 0} active run${server.activeRuns === 1 ? '' : 's'}`));
          add(box, el('div', 'hint', `Tools: ${(server.tools || []).join(', ') || 'none'}`));
          add(box, el('div', 'hint', server.permissions || 'No permissions reported.'));
          add(box, el('div', 'hint', `Source: ${server.provenance || 'unknown'}`));
          if ('attached' in server) add(box, el('div', 'hint', `Extension: ${server.attached ? 'proved attached' : 'not attached'} · allowed origins: ${server.allowedOrigins || 0}`));
          add(wrap, box);
        }
        if (Array.isArray(catalog.external) && catalog.external.length === 0) {
          add(wrap, renderNote('No ambient external MCP server is loaded. Forge uses a strict per-run configuration.'));
        }
        add(wrap, el('div', 'hint', catalog.note || catalog.mode || 'Strict run-scoped MCP configuration.'));
      }
      return wrap;
    },
    tests() {
      return testPanel(false);
    },
    debug() {
      return renderUnwired(
        'No debugger is wired',
        'Forge cannot attach to a process. There is no debug session, and there is no route that could start one.',
      );
    },
    tasks() {
      const wrap = el('div', 'pw fgworkflows');
      const head = el('div', 'acts');
      add(head, el('b', null, 'Workflow launcher'));
      const fresh = btn('btn sm', '+ New workflow', () => {
        S.insp = 'chat';
        addSession();
        if (!S.sessionOpen) setPaneOpen('session', true);
      });
      fresh.disabled = S.sessions.length >= 8;
      fresh.title = fresh.disabled ? 'Forge keeps at most eight concurrent sessions.' : 'Create an independent session and focus its task composer.';
      add(head, el('span', 'sp'), fresh);
      add(wrap, head, el('div', 'hint',
        'Each workflow below is a real independent Forge session. Runs may overlap, and every run keeps its provider, progress, cancellation, result, files, and approvals.'));
      for (const session of S.sessions) {
        const state = session.routing ? 'routing' : session.running ? phaseLabel(session.runProgress) : sessionTabState(session);
        const row = el('div', 'fgworkflow-row');
        const main = btn('fgworkflow-main', null, () => {
          S.selectedSessionId = session.id;
          S.insp = session.runs.length ? 'runs' : 'chat';
          if (!S.sessionOpen) setPaneOpen('session', true);
          paintC(); paintE();
        });
        const last = session.runs[session.runs.length - 1];
        add(main, glyph('●', `fgsession-dot ${sessionTabState(session)}`), el('span', 'nm', session.name),
          el('span', 'tag', `${session.agentId}${session.model ? ` · ${session.model}` : ''}`));
        add(main, el('span', 'hint', session.running
          ? `${state} · ${session.runProgress ? session.runProgress.orchestrationPercent : 0}% orchestration`
          : last ? `${last.ok ? 'completed' : 'failed'} · ${last.files} file${last.files === 1 ? '' : 's'}` : 'ready for a task'));
        add(row, main);
        if (session.running) {
          const cancel = btn('fgicon', '■', () => void cancelRun(session));
          cancel.setAttribute('aria-label', `Cancel ${session.name}`);
          cancel.disabled = session.canceling || !session.runId;
          cancel.title = cancel.disabled ? 'Cancellation is already in progress or the run has not started.' : `Cancel ${session.name} and its process descendants`;
          add(row, cancel);
        }
        add(wrap, row);
      }
      const topology = el('details', 'fgcapability-gap');
      add(topology, el('summary', null, 'Parent and child agent topology'),
        el('div', 'hint', 'Unavailable: the current Forge backend starts independent sessions and does not emit parent/child agent relationships, delegated subagent status, or a workflow graph. No decorative child agents are shown.'));
      const command = btn('btn sm ghost', 'Open Command work desk');
      command.setAttribute('data-go', 'command');
      add(topology, command);
      add(wrap, topology);
      return wrap;
    },
  };

  /* ---- the search box ---------------------------------------------------- *
   * Built ONCE and moved between repaints, never rebuilt. paintA() replaces the
   * whole rail on every repaint, and a search box that is thrown away and made
   * again on each one would lose the caret mid-word and drop focus the instant a
   * result arrived. The same node going back in keeps what the owner typed. */
  let searchForm = null;
  let searchInput = null;
  let searchBtn = null;

  function searchUI() {
    if (searchForm) { syncSearchBtn(); return searchForm; }

    const form = el('form', 'sform');
    form.setAttribute('role', 'search');

    /* Enter searches. This is an explicit keydown and NOT the form's implicit
       submission, which is the same choice ask.js and counsel.js make for their
       input rows — and here it is load-bearing rather than stylistic: implicit
       submission is what a synthetic key event does not reliably trigger, so a
       search box that relied on it is a box nothing can prove works. The form's
       own submit handler stays for the button. */
    const enter = (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      ev.preventDefault();
      void doSearch();
    };

    const q = el('input');
    q.type = 'search';
    q.placeholder = 'find in the sandbox';
    q.value = S.searchQ;
    q.setAttribute('aria-label', 'Search the sandbox');
    q.addEventListener('input', () => { S.searchQ = q.value; syncSearchBtn(); });
    q.addEventListener('keydown', enter);

    const sc = el('input');
    sc.type = 'text';
    sc.placeholder = 'in path — optional, e.g. src';
    sc.value = S.searchScope;
    sc.setAttribute('aria-label', 'Limit the search to this path inside the sandbox');
    sc.addEventListener('input', () => { S.searchScope = sc.value; });
    sc.addEventListener('keydown', enter);

    const b = btn('btn sm', 'Search');
    b.type = 'submit';

    form.addEventListener('submit', (ev) => { ev.preventDefault(); void doSearch(); });
    add(form, q, sc, b);

    searchForm = form;
    searchInput = q;
    searchBtn = b;
    syncSearchBtn();
    return form;
  }

  /* A disabled control must say WHY it is disabled, or it is just a dead
     button. Both reasons are real and both are named. */
  function syncSearchBtn() {
    if (!searchBtn) return;
    const empty = S.searchQ.trim() === '';
    searchBtn.disabled = S.searchBusy || empty;
    searchBtn.title = S.searchBusy
      ? 'A search is already running.'
      : empty ? 'Type something to search for first.' : 'Run git grep over the sandbox.';
  }

  /** GET /forge/search — one git grep, and only what it returned. */
  async function doSearch() {
    const q = S.searchQ.trim();
    if (q === '' || S.searchBusy) return;
    const scope = S.searchScope.trim();
    S.searchBusy = true;
    S.searchErr = null;
    S.searchRes = null;
    S.searchFor = q;
    paintA();

    const r = await api(`/forge/search?q=${encodeURIComponent(q)}${scope ? `&path=${encodeURIComponent(scope)}` : ''}`);
    S.searchBusy = false;
    if (!r.ok) {
      S.searchRes = null;
      S.searchErr = errText(r);
    } else {
      S.searchRes = r.data;
      S.searchErr = null;
    }
    paintA();
    // The rail was rebuilt around the box, which takes the caret with it. Give
    // it back, so the next query is typed where the last one was.
    if (searchInput) searchInput.focus();
  }

  function canCommit() {
    return Boolean(
      OWNER_TOKEN && !S.committing && S.status && S.status.repo &&
      (S.status.changed || []).length > 0 && S.commitMsg.trim() !== '',
    );
  }

  /* ================================================================ *
   * rgB — crumbs, file tabs, the editor, and the gate a save goes through
   * ================================================================ *
   * THE PANE IS MONACO — VS Code's own editor core — served from this
   * machine out of /vendor/monaco. monaco.js holds the loader, the
   * no-egress reasoning and the theme, which is built by resolving
   * glass/tokens.css rather than by inventing a palette. What monaco
   * brings is real and none of it is drawn here: tokenisation for every
   * language it knows, rainbow bracket pairs, folding, multi-cursor,
   * find and replace, a minimap, a right-click menu, sticky scroll, and
   * the TypeScript, JSON and CSS language services.
   *
   * WHAT IT DELIBERATELY DOES NOT BRING is set out in monaco.js beside
   * the setting that withholds it, and the strip under the tabs repeats
   * it per file, in words, on screen:
   *   · TypeScript SEMANTIC checking is off. This pane holds ONE file
   *     with no tsconfig, no node_modules and no sibling module, so a
   *     semantic pass would report every import as unresolved and every
   *     Node global as undefined — errors about things that exist. Syntax
   *     checking IS on, because a parse error is decided by these bytes
   *     alone and is therefore true whatever the rest of the tree holds.
   *   · a language with no service behind it (markdown, and everything
   *     monaco only tokenises) gets NO problems chip at all. An empty one
   *     would report a check that never ran.
   *   · the Format action is shown only where monaco itself reports a
   *     formatter for the current model — asked at the moment of drawing,
   *     via the action's own isSupported(). There is no button that
   *     would do nothing.
   *
   * A SAVE IS A PROPOSAL, NEVER A WRITE. Ctrl+S does not touch the
   * sandbox. It POSTs the buffer to /previews — the identical gate an
   * agent's write goes through — and what comes back is an approval
   * capsule carrying a tier and an action hash. A routine edit is
   * committed by the kernel on the spot and returns a receipt; anything
   * larger, or anything touching a sensitive path, waits for the owner.
   * Either way the capsule lands in the session beside the agent's own,
   * and either way there is a receipt at the end. There is no path from
   * this pane to the disk that does not cross L6.
   *
   * TWO STATES ARE READ-ONLY ON PURPOSE, and each says so on screen:
   * a file /forge/file truncated at its 4000-line cap (saving that buffer
   * would propose the file with the remainder cut off — silent data
   * loss), and any file at all in a window that holds no owner token.
   *
   * LINE ENDINGS SURVIVE. /forge/file normalises CRLF to LF on the wire,
   * so the model's EOL is set back from the reported `eol` before any
   * save: a CRLF file is proposed as CRLF, not silently reformatted.
   */

  /* One kick at init. Either branch repaints, and the pane then says which of
     the two it is showing — the editor, or the plain pane with the reason. */
  loadMonaco().then(
    (m) => {
      M = m;
      registerEditorActions();
      onThemeChange(() => { paintC(); });
      paintB();
    },
    (err) => {
      edErr = (err && err.message) ? err.message : String(err);
      paintB();
    },
  );

  /** The bytes /forge/file last handed us for the file on screen. */
  function diskText(path = S.file) {
    const data = recordFor(path)?.data;
    return data && typeof data.contents === 'string' ? data.contents : null;
  }

  /**
   * The buffer as /forge/file would have sent it: LF endings, always.
   *
   * This matters. /forge/file normalises CRLF to LF on the wire, and the model
   * is set back to CRLF for a CRLF file so a save proposes the file's real
   * endings — which means `model.getValue()` on a CRLF file NEVER equals the
   * bytes we were handed, and a plain comparison would call every CRLF file
   * dirty the moment it opened, with a Propose-save button armed over an edit
   * nobody made. Compare on the wire form; propose in the file's own form.
   */
  function bufferLF(model) {
    return model.getValue(M.editor.EndOfLinePreference.LF);
  }

  /** Whether the buffer differs from what is on disk, as last read. */
  function isDirty(path = S.file) {
    if (!path || !M) return false;
    const model = models.get(path);
    const disk = diskText(path);
    if (!model || disk === null) return false;
    return bufferLF(model) !== disk;
  }

  /**
   * Whether this file may be edited, and — when it may not — the sentence that
   * says why. Never a bare disabled control.
   */
  function readOnlyReason(path = S.file) {
    if (!OWNER_TOKEN) {
      return 'This window was opened without an owner token, so it can read the sandbox but cannot propose a change to it.';
    }
    const data = recordFor(path)?.data;
    if (data && data.truncated) {
      return `Only the first ${diskText(path) === null ? 0 : diskText(path).split('\n').length} lines of this ${data.lines}-line file were read, so the buffer is not the whole file. Saving it would propose the file with the rest cut off.`;
    }
    return null;
  }

  const EDITOR_LAYOUT_KEY = 'zeno-forge-editor-layout-v1';
  let editorLayoutRestored = false;

  function persistEditorLayout() {
    try {
      localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify({
        root: S.status && S.status.root ? S.status.root : null,
        split: S.splitEditor,
        focused: S.focusedGroup,
        groups: S.editorGroups.map((entry) => ({ tabs: entry.tabs, file: entry.file })),
      }));
    } catch { /* local persistence is optional */ }
  }

  function restoreEditorLayout() {
    if (editorLayoutRestored || !S.status) return;
    editorLayoutRestored = true;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(EDITOR_LAYOUT_KEY) || 'null'); }
    catch { saved = null; }
    if (!saved || !Array.isArray(saved.groups) || saved.root !== S.status.root) return;
    for (const index of [0, 1]) {
      const source = saved.groups[index] || {};
      const tabs = Array.isArray(source.tabs)
        ? [...new Set(source.tabs.filter((path) => typeof path === 'string' && path.length > 0))].slice(0, 40)
        : [];
      S.editorGroups[index].tabs = tabs;
      S.editorGroups[index].file = tabs.includes(source.file) ? source.file : (tabs[0] || null);
    }
    S.splitEditor = Boolean(saved.split);
    S.focusedGroup = saved.focused === 1 && S.splitEditor ? 1 : 0;
    paneViews[1].shell.hidden = !S.splitEditor;
    editorSplitDrag.hidden = !S.splitEditor;
    bindEditorGroup(S.focusedGroup);
    for (const [index, view] of paneViews.entries()) view.shell.dataset.focused = index === S.focusedGroup ? 'true' : 'false';
    const paths = [...new Set(S.editorGroups.map((entry) => entry.file).filter(Boolean))];
    for (const path of paths) void rereadPath(path, false);
  }

  function setSplitEditor(open) {
    S.splitEditor = Boolean(open);
    paneViews[1].shell.hidden = !S.splitEditor;
    editorSplitDrag.hidden = !S.splitEditor;
    edHost.dataset.split = S.splitEditor ? 'true' : 'false';
    if (!S.splitEditor && S.focusedGroup === 1) focusEditorGroup(0, false);
    persistEditorLayout();
    paintB();
    requestAnimationFrame(layoutEditors);
  }

  function discardPath(path) {
    dirtyPaths.delete(path);
    const model = models.get(path);
    if (model && !model.isDisposed()) {
      for (const view of paneViews) if (view.editor && view.editor.getModel() === model) view.editor.setModel(null);
      model.dispose();
    }
    models.delete(path);
    fileRecords.delete(path);
  }

  function closeTab(index, path, options = {}) {
    const target = group(index);
    if (!target.tabs.includes(path)) return true;
    const visibleElsewhere = S.editorGroups.some((entry, at) => at !== index && entry.tabs.includes(path));
    if (dirtyPaths.has(path) && !visibleElsewhere && options.discard !== true) {
      const discard = window.confirm(`“${path}” has unsaved edits.\n\nDiscard them and close the tab?`);
      if (!discard) return false;
    }
    const closedAt = target.tabs.indexOf(path);
    target.tabs = target.tabs.filter((entry) => entry !== path);
    if (target.file === path) target.file = target.tabs[Math.min(closedAt, target.tabs.length - 1)] || null;
    if (!S.editorGroups.some((entry) => entry.tabs.includes(path))) discardPath(path);
    persistEditorLayout();
    paintB();
    paintA();
    paintE();
    return true;
  }

  function closeTabs(index, mode, anchor) {
    const tabs = [...group(index).tabs];
    const at = tabs.indexOf(anchor);
    const targets = mode === 'others' ? tabs.filter((path) => path !== anchor)
      : mode === 'right' ? tabs.slice(at + 1)
        : tabs;
    for (const path of targets) if (!closeTab(index, path)) break;
  }

  function transferTab(path, from, to, copy) {
    if (!path || from === to) return;
    const destination = group(to);
    if (!destination.tabs.includes(path)) destination.tabs.push(path);
    destination.file = path;
    if (!copy) {
      const source = group(from);
      source.tabs = source.tabs.filter((entry) => entry !== path);
      if (source.file === path) source.file = source.tabs.at(-1) || null;
    }
    if (!S.splitEditor) S.splitEditor = true;
    paneViews[1].shell.hidden = false;
    editorSplitDrag.hidden = false;
    edHost.dataset.split = 'true';
    focusEditorGroup(to, false);
    persistEditorLayout();
    paintB();
    requestAnimationFrame(layoutEditors);
  }

  function paneTabs(index) {
    const entry = group(index);
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', `Open files in editor group ${index + 1}`);
    if (entry.tabs.length === 0) add(tabs, el('span', 'tb empty', 'no file open'));
    const changed = new Set(((S.status && S.status.changed) || []).map((item) => item.path));
    for (const path of entry.tabs) {
      const tab = el('div', 'tb');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', path === entry.file ? 'true' : 'false');
      tab.title = path;
      const activate = btn('tb-main', null, () => {
        focusEditorGroup(index, false);
        void openFile(path, undefined, index);
      });
      const dot = el('span', dirtyPaths.has(path) ? 'fdot' : changed.has(path) ? 'fdot changed' : 'fdot clean');
      dot.setAttribute('aria-label', dirtyPaths.has(path) ? 'unsaved edits' : changed.has(path) ? 'changed in worktree' : 'unchanged');
      add(activate, dot, el('span', 'tb-name', path.split('/').pop()));
      const close = btn('tb-close', '×', (event) => { event.stopPropagation(); closeTab(index, path); });
      close.setAttribute('aria-label', `Close ${path}`);
      add(tab, activate, close);
      add(tabs, tab);
    }
    add(tabs, el('span', 'sp'));
    const active = entry.file;
    const menu = el('details', 'edtab-menu');
    const summary = el('summary', null, '⋯');
    summary.setAttribute('aria-label', `Editor group ${index + 1} tab actions`);
    const actions = el('div', 'edtab-actions');
    const menuAction = (label, action, disabled = false) => {
      const control = btn(null, label, () => { menu.open = false; action(); });
      control.disabled = disabled;
      add(actions, control);
    };
    menuAction('Open to side', () => transferTab(active, index, index === 0 ? 1 : 0, true), !active);
    menuAction('Move to other group', () => transferTab(active, index, index === 0 ? 1 : 0, false), !active);
    menuAction('Close others', () => closeTabs(index, 'others', active), entry.tabs.length < 2);
    menuAction('Close to the right', () => closeTabs(index, 'right', active), !active || entry.tabs.indexOf(active) === entry.tabs.length - 1);
    menuAction('Close all', () => closeTabs(index, 'all', active), entry.tabs.length === 0);
    add(menu, summary, actions);
    add(tabs, menu);
    return tabs;
  }

  function paintB() {
    /* crumbs: repository › directory › file, then the branch. */
    const crumbs = el('div', 'crumbs');
    add(crumbs, el('span', null, workspaceName(S.status)));
    if (S.file) {
      const parts = S.file.split('/');
      const base = parts.pop();
      for (const p of parts) add(crumbs, glyph('›', 'sep'), el('span', null, p));
      add(crumbs, glyph('›', 'sep'), el('b', null, base));
    } else {
      add(crumbs, glyph('›', 'sep'), el('span', null, 'no file open'));
    }
    add(crumbs, el('span', 'sp'));
    if (S.status && S.status.repo) {
      // The prototype ends the crumb bar with the branch as a chip. Its chip
      // reads "· worktree" because the prototype's Forge works in one; this
      // daemon edits the sandbox itself and only a RUN gets a worktree, so the
      // chip says HEAD instead of claiming an isolation that is not there.
      const br = el('span', 'chip');
      add(br, el('b', null, S.status.branch));
      // A span, not a bare text node: the chip is an inline-flex row and its gap
      // only separates real children, so a loose text node would sit flush.
      if (S.status.head) add(br, el('span', null, `· ${S.status.head}`));
      add(crumbs, br);
    }

    const tools = el('div', 'edtools');
    const split = btn('ed-split', S.splitEditor ? 'Unsplit editor' : 'Split editor', () => setSplitEditor(!S.splitEditor));
    split.setAttribute('aria-pressed', S.splitEditor ? 'true' : 'false');
    split.title = 'Split or unsplit the editor. Ctrl+\\';
    add(tools, split);

    paneViews[1].shell.hidden = !S.splitEditor;
    editorSplitDrag.hidden = !S.splitEditor;
    edHost.dataset.split = S.splitEditor ? 'true' : 'false';
    for (const index of S.splitEditor ? [0, 1] : [0]) {
      forEditorGroup(index, () => {
        paneViews[index].chrome.replaceChildren(paneTabs(index), editorBar());
        syncEditor();
      });
    }
    rgB.replaceChildren(crumbs, tools, edHost);
    bindEditorGroup(S.focusedGroup);
  }

  /** Repaint the strip alone. Markers and the dirty flag move often; the tabs do not. */
  function paintBar() {
    const index = S.focusedGroup;
    const bar = paneViews[index].chrome.querySelector('.edbar');
    if (bar) bar.replaceWith(editorBar());
  }

  /* ---- the strip under the tabs: what is checked, and the two actions ---- */

  function editorBar() {
    const paneIndex = S.focusedGroup;
    const path = S.file;
    const bar = el('div', 'edbar');
    const model = S.file ? models.get(S.file) : null;
    const lang = model ? model.getLanguageId() : null;

    if (edErr) {
      fmtDrawn = false;
      add(bar, el('span', 'edwhy', `plain pane — ${edErr}`));
      add(bar, el('span', 'sp'));
      return bar;
    }
    if (!S.file || !S.fileData || S.fileData.binary) {
      fmtDrawn = false;
      add(bar, el('span', 'edwhy', M === null ? 'loading the editor…' : 'no file open'));
      add(bar, el('span', 'sp'));
      return bar;
    }

    /* 1 · what monaco thinks this file is. `plaintext` is monaco's own answer
       for an extension it has no language for, and it is reported as that
       rather than dressed up as a language. */
    const langChip = el('span', 'chip');
    add(langChip, glyph('◆', 'chip-glyph'));
    add(langChip, document.createTextNode(lang && lang !== 'plaintext' ? lang : 'plain text'));
    langChip.title = lang && lang !== 'plaintext'
      ? `Monaco is tokenising this file as ${lang}.`
      : 'Monaco has no language for this file extension, so it is shown as plain text. Nothing is guessed.';
    add(bar, langChip);

    /* 2 · diagnostics, and ONLY where something really checks. */
    if (lang && DIAGNOSED.has(lang) && model && M) {
      const marks = M.editor.getModelMarkers({ resource: model.uri });
      const errs = marks.filter((k) => k.severity === M.MarkerSeverity.Error).length;
      const warns = marks.filter((k) => k.severity === M.MarkerSeverity.Warning).length;
      const chip = btn('chip fgproblems', null, () => jumpToFirstMarker(marks));
      chip.dataset.state = errs > 0 ? 'warn' : 'listening';
      add(chip, glyph(errs > 0 ? '✕' : '○', 'chip-glyph'));
      add(chip, document.createTextNode(
        errs === 0 && warns === 0
          ? (lang === 'typescript' || lang === 'javascript' ? 'no syntax errors' : 'no problems')
          : `${errs} ${errs === 1 ? 'error' : 'errors'}${warns ? ` · ${warns} warning${warns === 1 ? '' : 's'}` : ''}`,
      ));
      chip.disabled = marks.length === 0;
      chip.title = (lang === 'typescript' || lang === 'javascript')
        ? 'The real TypeScript parser, over this file alone: syntax only. Types are NOT checked here — one file with no tsconfig and no node_modules cannot be type-checked without reporting imports that exist as missing. `npm run check` is what type-checks this repository.'
        : `Monaco's ${lang} language service, over this document alone.`;
      add(bar, chip);
    } else if (lang && model) {
      const none = el('span', 'edwhy', 'not checked');
      none.title = `Nothing in this bundle checks ${lang === 'plaintext' ? 'plain text' : lang}, so no problem count is shown. An empty one would report a check that never ran.`;
      add(bar, none);
    }

    add(bar, el('span', 'sp'));

    /* 3 · Format — present only where monaco reports a formatter for THIS
       model. Asked of the action itself, so the answer cannot drift from what
       is actually registered, and so a language with no formatter gets no
       button rather than a button that does nothing. */
    fmtDrawn = formatSupported();
    if (fmtDrawn) {
      const f = btn('btn sm', 'Format', () => {
        focusEditorGroup(paneIndex, false);
        const act = ed && ed.getAction('editor.action.formatDocument');
        if (act) void act.run();
      });
      f.title = `Monaco's registered formatter for ${lang}. Shift+Alt+F.`;
      add(bar, f);
    }

    /* 4 · the save, and the truth about what a save is. */
    const ro = readOnlyReason();
    if (ro) {
      const why = el('span', 'edwhy ro', 'read-only');
      why.title = ro;
      add(bar, why);
    } else {
      const dirty = isDirty(path);
      if (dirty) {
        const d = el('span', 'edwhy dirty', 'unsaved edits');
        d.title = 'This buffer differs from the bytes read from the sandbox.';
        add(bar, d);
      }
      const save = btn('btn sm', S.saving ? 'Proposing…' : 'Propose save', () => void proposeSave(paneIndex));
      save.disabled = S.saving || !dirty;
      save.title = dirty
        ? 'Ctrl+S. Sends the buffer to /previews — the same gate an agent write crosses. A routine edit is committed and receipted by the kernel; anything larger waits for your approval. This never writes to the sandbox directly.'
        : 'Nothing has changed in this buffer, so there is nothing to propose.';
      add(bar, save);
    }

    if (S.saveErr) add(bar, el('span', 'edwhy err', S.saveErr));

    return bar;
  }

  /* ---- is there a formatter for what is on screen? ----------------------- *
   * Asked of monaco, never asserted by a table here — `isSupported()` reads the
   * action's own precondition, which includes "a document formatting provider
   * is registered for this model".
   *
   * It has to be asked more than once. A language's mode is a chunk monaco
   * fetches on demand, and its providers appear a beat AFTER the model does —
   * so the first strip drawn for a file is drawn while the honest answer is
   * still "no". There is no public event for "a formatter was registered", so
   * the strip re-asks on a short, bounded, self-cancelling watch and redraws
   * the moment the answer stops matching what is on screen. Nothing polls
   * forever, and nothing claims a formatter before monaco says there is one. */
  let fmtDrawn = false;
  let fmtWatch = null;

  function formatSupported() {
    if (!ed || !ed.getModel()) return false;
    const act = ed.getAction('editor.action.formatDocument');
    return Boolean(act && act.isSupported());
  }

  function watchFormatter() {
    if (fmtWatch !== null) clearInterval(fmtWatch);
    const until = Date.now() + 6000;
    fmtWatch = setInterval(() => {
      if (formatSupported() !== fmtDrawn) paintBar();
      if (Date.now() > until) {
        clearInterval(fmtWatch);
        fmtWatch = null;
      }
    }, 250);
  }

  function jumpToFirstMarker(marks) {
    if (!ed || marks.length === 0) return;
    const first = [...marks].sort((a, b) => a.startLineNumber - b.startLineNumber)[0];
    ed.revealLineInCenter(first.startLineNumber);
    ed.setPosition({ lineNumber: first.startLineNumber, column: first.startColumn });
    ed.focus();
  }

  /* ---- what the host shows, decided in one place ------------------------- */

  function showAux(node) {
    edMon.hidden = true;
    edAux.hidden = false;
    edAux.replaceChildren(node);
  }

  function showEditor() {
    edAux.hidden = true;
    edAux.replaceChildren();
    edMon.hidden = false;
    if (ed) ed.layout();
  }

  function syncEditor() {
    placeViewport = null;
    if (S.fileBusy) { if (ed) ed.setModel(null); return showAux(paneMessage('Reading the file from the sandbox…')); }
    if (S.fileErr) { if (ed) ed.setModel(null); return showAux(paneMessage(S.fileErr)); }
    if (!S.file || !S.fileData) {
      if (ed) ed.setModel(null);
      return showAux(paneMessage(
        'No file is open. Pick one from the Explorer and its real contents are read from the sandbox and shown here.\n\n' +
        'This pane never shows source that is not in the repository — with nothing selected it shows nothing, not a sample.',
      ));
    }
    if (S.fileData.binary) {
      if (ed) ed.setModel(null);
      return showAux(paneMessage(
        `${S.file} is not a text file (${bytesLabel(S.fileData.bytes)}). There is nothing to render as source, so nothing is rendered.`,
      ));
    }
    if (M === null) {
      // The editor is not here — still loading, or genuinely absent. The file
      // is still shown, in the pane this window shipped before monaco existed.
      // A working fallback, not a placeholder: it reads the same bytes.
      return showAux(plainPane());
    }
    mountEditor();
    showEditor();
    // The strip is built by paintB BEFORE the model exists, so on the first
    // paint of a newly opened file it would report "plain text" and hide the
    // Format action for a file monaco is perfectly happy to format. Everything
    // on that strip is a fact about the MODEL, so it is drawn once the model is.
    paintBar();
  }

  /* ---- monaco: created once, then given a model per file ----------------- */

  function mountEditor() {
    if (!M) return;
    const paneIndex = S.focusedGroup;
    if (ed === null) {
      ed = M.editor.create(edMon, {
        theme: ZENO_THEME,
        automaticLayout: true,
        // The window's own mono face, so code in the editor and code in a
        // capsule are visibly the same text in the same voice.
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
        fontSize: 14,
        lineHeight: 22,
        fontLigatures: false,
        // The features this pane exists to have.
        bracketPairColorization: { enabled: S.rainbowBrackets, independentColorPoolPerBracketType: true },
        guides: { bracketPairs: S.rainbowBrackets ? 'active' : false, bracketPairsHorizontal: S.rainbowBrackets ? 'active' : false, indentation: true, highlightActiveIndentation: true },
        minimap: { enabled: true, renderCharacters: false, maxColumn: 90 },
        folding: true,
        foldingHighlight: true,
        showFoldingControls: 'mouseover',
        contextmenu: true,
        multiCursorModifier: 'ctrlCmd',
        multiCursorPaste: 'spread',
        find: { seedSearchStringFromSelection: 'selection', addExtraSpaceOnTop: false },
        stickyScroll: { enabled: true, maxLineCount: 4 },
        occurrencesHighlight: 'singleFile',
        linkedEditing: true,
        renderWhitespace: 'selection',
        renderLineHighlight: 'all',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 30 },
        tabSize: 2,
        // rgB is `overflow:hidden` (the grid depends on it), which would clip
        // the context menu, the find widget and every hover. Fixed overflow
        // widgets are appended to the body instead, so they are whole.
        fixedOverflowWidgets: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      });
      // Record the instance before its first focus event so top-bar commands
      // can target a newly mounted editor without requiring a prior click.
      paneViews[paneIndex].editor = ed;
      ed.onDidChangeCursorPosition((e) => {
        group(paneIndex).caret = e.position.lineNumber;
        if (S.focusedGroup === paneIndex && group(paneIndex).caret !== lastCaretPainted) {
          lastCaretPainted = group(paneIndex).caret;
          paneViews[paneIndex].lastCaret = lastCaretPainted;
          paintE();
        }
      });
      ed.onDidFocusEditorWidget(() => focusEditorGroup(paneIndex));
      M.editor.onDidChangeMarkers((uris) => {
        const path = group(paneIndex).file;
        const model = path ? models.get(path) : null;
        if (!model) return;
        if (S.focusedGroup === paneIndex && uris.some((u) => u.toString() === model.uri.toString())) paintBar();
      });
      registerEditorActions(ed, paneIndex);
    }

    const path = S.file;
    const model = modelFor(path, diskText(path));
    if (ed.getModel() !== model) {
      for (const d of modelSubs.splice(0)) d.dispose();
      ed.setModel(model);
      modelSubs.push(model.onDidChangeContent(() => {
        if (path) {
          if (bufferLF(model) === diskText(path)) dirtyPaths.delete(path);
          else dirtyPaths.add(path);
        }
        if (S.focusedGroup === paneIndex) paintB();
        else paneViews[paneIndex].chrome.replaceChildren(paneTabs(paneIndex), forEditorGroup(paneIndex, editorBar));
      }));
      lastCaretPainted = -1;
      watchFormatter();
      // Land on the caret ONLY when the model has just been put on screen.
      // Doing it on every repaint dragged the cursor to column 1 and re-centred
      // the viewport under the owner's hands every time the status bar
      // refreshed — a run finishing would have moved their cursor.
      if (S.caret) {
        ed.setPosition({ lineNumber: S.caret, column: 1 });
        ed.revealLineInCenter(S.caret);
      }
    }
    const ro = readOnlyReason(path);
    ed.updateOptions({ readOnly: ro !== null, readOnlyMessage: { value: ro || '' } });
  }

  /**
   * The model for a path. Monaco resolves the language from the URI's
   * extension, using its OWN registry — so a `.ts` file is TypeScript because
   * monaco says so, not because a table in this file says so.
   *
   * A model that already exists is REUSED and not overwritten: it may hold
   * unsaved edits, and a repaint must never silently discard them. Its bytes
   * are replaced only when the file was genuinely re-read from disk and the
   * buffer was clean.
   */
  function modelFor(path, text) {
    const uri = M.Uri.parse(`zeno-sandbox:/${String(path).replace(/^\/+/, '')}`);
    let model = models.get(path);
    if (!model || model.isDisposed()) {
      model = M.editor.getModel(uri) || M.editor.createModel(text ?? '', undefined, uri);
      models.set(path, model);
    } else if (text !== null && bufferLF(model) !== text && !dirtyPaths.has(path)) {
      model.setValue(text);
    }
    const data = recordFor(path)?.data;
    if (data && data.eol === 'CRLF') model.setEOL(M.editor.EndOfLineSequence.CRLF);
    else model.setEOL(M.editor.EndOfLineSequence.LF);
    return model;
  }

  /* ---- the right-click menu, and the keys ------------------------------- */

  function registerEditorActions(target = ed, paneIndex = S.focusedGroup) {
    if (!M || !target || target.__zenoActions) return;
    target.__zenoActions = true;
    target.addAction({
      id: 'zeno.proposeSave',
      label: 'Propose this save to the kernel',
      keybindings: [M.KeyMod.CtrlCmd | M.KeyCode.KeyS],
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 1,
      run: () => { void proposeSave(paneIndex); },
    });
    target.addAction({
      id: 'zeno.revert',
      label: 'Discard these edits and re-read the file from the sandbox',
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 2,
      run: () => {
        const path = group(paneIndex).file;
        if (path) { dirtyPaths.delete(path); void rereadPath(path, true); }
      },
    });
    target.addAction({
      id: 'zeno.agentView',
      label: 'Agent-only view',
      keybindings: [M.KeyMod.CtrlCmd | M.KeyMod.Shift | M.KeyCode.KeyA],
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 3,
      run: () => setView(S.view === 'agent' ? 'ide' : 'agent'),
    });
    target.addAction({
      id: 'zeno.copyPath',
      label: 'Copy the sandbox path of this file',
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 4,
      run: () => {
        const path = group(paneIndex).file;
        if (path && navigator.clipboard) void navigator.clipboard.writeText(path).catch(() => {});
      },
    });
    target.addAction({
      id: 'zeno.splitEditor',
      label: 'Split or unsplit editor',
      keybindings: [M.KeyMod.CtrlCmd | M.KeyCode.Backslash],
      contextMenuGroupId: 'zeno',
      contextMenuOrder: 5,
      run: () => setSplitEditor(!S.splitEditor),
    });
  }

  /* ---- the save, which is a proposal ------------------------------------ */

  /**
   * POST /previews with the buffer. This is the SAME route the assistant and
   * the voice surface propose through, and the same one /forge/run funnels an
   * agent's writes into — one gate, not a second one built for the editor.
   *
   * `requestedBy` is 'forge-editor', naming the SURFACE. It must not be
   * 'owner': L6 refuses an approval whose approver is the proposer, and
   * labelling the owner's own editor "owner" would hold every save forever with
   * no way to ever say yes.
   */
  async function proposeSave(paneIndex = S.focusedGroup) {
    const path = group(paneIndex).file;
    const targetEditor = paneViews[paneIndex].editor;
    if (S.saving || !OWNER_TOKEN || !path || !targetEditor) return;
    if (readOnlyReason(path) !== null) return;
    const model = models.get(path);
    if (!model) return;
    // Compare on the wire form, propose in the file's own form: the model
    // carries the file's real line endings, so a CRLF file is proposed as CRLF
    // rather than silently reformatted by the act of opening it.
    if (bufferLF(model) === diskText(path)) return;
    const contents = model.getValue();

    S.saving = true;
    S.saveErr = null;
    paintBar();

    const r = await api('/previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        relPath: path,
        contents,
        summary: `Forge editor: edit ${path}`,
        requestedBy: 'forge-editor',
      }),
    });
    S.saving = false;

    if (!r.ok) {
      S.saveErr = `not proposed: ${errText(r)}`;
      paintBar();
      return;
    }
    const preview = r.data && r.data.preview;
    if (!preview || typeof preview.actionHash !== 'string') {
      S.saveErr = 'the daemon answered without a preview, so nothing can be shown for this save.';
      paintBar();
      return;
    }
    // TWO OUTCOMES, AND THEY ARE DIFFERENT FACTS.
    //
    // A routine (T0) edit comes back ALREADY COMMITTED, with a receipt: the
    // kernel applied it and receipted it on the spot, and nothing is waiting.
    // Saying "waiting for your approval" there would be the one sentence this
    // surface must never say. It is recorded as a settled turn carrying the
    // real receipt, and the file is re-read so the buffer and the disk agree.
    //
    // Anything larger, or anything touching a sensitive path, is now a capsule
    // the daemon is HOLDING. It is not drawn from this response: /state is
    // asked for it, because only /state carries the payload, and a capsule
    // whose payload the owner cannot re-hash is a capsule they cannot approve.
    const receipt = r.data.receipt || null;
    S.chat.push({
      who: 'save',
      at: new Date(),
      path,
      tier: preview.tier,
      auto: preview.auto === true,
      actionHash: preview.actionHash,
      receipt,
      secretWarning: r.data.secretWarning || null,
    });
    S.insp = 'chat';
    if (receipt) {
      dirtyPaths.delete(path);
      void loadStatus();
      void rereadPath(path, true);
    }
    paintC();
    paintBar();
    void syncGates();
  }

  /* ---- the pane monaco is not: the plain reader, kept as the fallback ---- */

  /**
   * The pane this window shipped before monaco existed, kept verbatim as the
   * fallback for a build with no /vendor/monaco. It reads the same bytes from
   * the same response, so a window without the editor is degraded, not wrong.
   */
  function plainPane() {
    const paneIndex = S.focusedGroup;
    const path = S.file;
    const data = recordFor(path)?.data;
    const wrap = el('div', 'edwrap');
    const code = el('div', 'code');
    code.tabIndex = 0;
    const mini = el('div', 'mini');
    mini.setAttribute('aria-hidden', 'true');

    const lines = String(data.contents).split('\n');
    const colour = highlights(path);
    const lexState = { block: false };
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i++) {
      const n = i + 1;
      const row = el('div', n === S.caret ? 'row hl' : 'row');
      row.dataset.line = String(n);
      add(row, el('span', 'ln', n), lineSpan(lines[i], colour, lexState));
      frag.appendChild(row);
    }
    code.appendChild(frag);
    code.addEventListener('click', (ev) => {
      const r = ev.target instanceof Element ? ev.target.closest('.row') : null;
      if (!r) return;
      group(paneIndex).caret = Number(r.dataset.line) || 0;
      focusEditorGroup(paneIndex, false);
      paintB();
      paintE();
    });
    if (data.truncated) {
      const cut = el('div', 'row');
      add(cut, el('span', 'ln', '…'), el('span', 'tx',
        `file continues — ${data.lines} lines in total, the first ${lines.length} are shown`));
      code.appendChild(cut);
    }
    drawMini(mini, lines);
    placeViewport = trackViewport(code, mini);
    paneViews[paneIndex].placeViewport = placeViewport;
    add(wrap, code, mini);
    // The rectangle is a measurement, so it is placed after the pane is in the
    // document — one frame later, since this node is returned detached.
    requestAnimationFrame(() => { if (placeViewport) placeViewport(); });
    return wrap;
  }

  /** Set by plainPane for the pane it built; null whenever monaco is on screen. */
  let placeViewport = null;

  function paneMessage(text) {
    const p = el('div', 'empty-pane');
    p.textContent = text;
    return p;
  }

  function drawMini(mini, lines) {
    const step = Math.max(1, Math.ceil(lines.length / 140));
    const longest = Math.max(1, ...lines.map((l) => l.length));
    for (let i = 0; i < lines.length; i += step) {
      const len = lines[i].trim().length;
      if (len === 0) continue;
      const bar = el('i');
      bar.style.top = `${(i / lines.length) * 100}%`;
      bar.style.width = `${Math.max(6, Math.min(90, (lines[i].length / longest) * 90))}%`;
      mini.appendChild(bar);
    }
  }

  /**
   * The prototype's viewport rectangle on the minimap. In the prototype it is
   * parked at a fixed 40% because there is no real pane behind it; here it is
   * the code pane's actual scroll offset and its actual visible fraction, so it
   * says where in the file the eye is rather than decorating the rail.
   *
   * Both observers hang off the `code` element, which plainPane rebuilds on
   * every repaint — so they are dropped with it and nothing accumulates.
   */
  function trackViewport(code, mini) {
    const vp = el('i', 'vp');
    mini.appendChild(vp);
    const place = () => {
      const h = code.scrollHeight;
      // Zero height means the pane is not laid out yet — it is hidden, or this
      // is the frame it was mounted in. Leave the rectangle where it is rather
      // than placing it from a measurement that is not a measurement.
      if (!h) return;
      const frac = Math.max(0.04, Math.min(1, code.clientHeight / h));
      vp.style.height = `${frac * 100}%`;
      vp.style.top = `${Math.min(1 - frac, code.scrollTop / h) * 100}%`;
    };
    code.addEventListener('scroll', place, { passive: true });
    // Forge is initialised while its surface is still hidden, and the window is
    // resizable, so a single placement is not enough: the observer catches the
    // pane getting a height on first show and every resize after.
    if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(code);
    return place;
  }

  /* ================================================================ *
   * rgC — the agent session: tabs, the conversation, the composer     *
   * ================================================================ */

  const INSP = [['chat', 'Session'], ['plan', 'Plan'], ['runs', 'Runs'], ['actions', 'Actions'], ['lens', 'Lens'], ['skills', 'Skills']];

  function sessionTabState(item) {
    if (item.running && item.runProgress && item.runProgress.terminal === true) {
      if (item.runProgress.outcome === 'completed') return 'done';
      if (item.runProgress.outcome === 'cancelled') return 'cancelled';
      return 'failed';
    }
    if (item.running) return 'running';
    if (!item.runs.length) return 'idle';
    return item.runs[item.runs.length - 1].ok ? 'done' : 'failed';
  }

  function paintSessionTab(button, item) {
    button.replaceChildren();
    const state = sessionTabState(item);
    add(button, glyph('●', `fgsession-dot ${state}`), el('span', 'fgsession-name', item.name));
    if (item.running && item.runProgress) {
      const progress = el('span', `fgsession-progress${item.runProgressStale ? ' stale' : ''}`,
        `${item.runProgress.orchestrationPercent}%${item.runProgressStale ? '?' : ''}`);
      progress.setAttribute('aria-label', item.runProgressStale
        ? `${item.runProgress.orchestrationPercent}% orchestration progress; live event history is incomplete`
        : `${item.runProgress.orchestrationPercent}% orchestration progress`);
      add(button, progress);
    }
    if (item.running && item.runProgress && item.runProgress.terminal === true) {
      button.title = `${item.name} provider ${item.runProgress.outcome}; waiting for the final run response`;
    } else if (item.running && item.runProgressStale) {
      button.title = `${item.name} is running; some live progress events could not be replayed`;
    } else if (item.running) {
      button.title = `${item.name} is running${S.runProgressStreamDown ? '; live updates are reconnecting' : ''}`;
    } else {
      button.title = `${item.name} · ${item.runs.length} completed run${item.runs.length === 1 ? '' : 's'}`;
    }
  }

  /** Update a background session's compact tab without replacing the active composer. */
  function updateSessionTabProgress(item) {
    for (const button of rgC.querySelectorAll('[data-session-id]')) {
      if (button.dataset.sessionId !== item.id) continue;
      paintSessionTab(button, item);
      return;
    }
  }

  function selectInspector(id) {
    S.insp = INSP.some(([candidate]) => candidate === id) ? id : 'chat';
    paintC();
    if (S.insp === 'lens') {
      if (!S.context && !S.contextBusy) void loadContext();
      if (!S.memory && !S.memoryBusy) void loadMemory();
      scheduleRunContext(activeSession());
    }
    if (S.insp === 'skills') {
      if (!S.context && !S.contextBusy) void loadContext();
      if (!S.extensions && !S.extensionsBusy) void loadExtensions();
    }
  }

  function composerLocation(session) {
    const routedId = session.route && session.route.agentId ? session.route.agentId : session.agentId;
    if (session.autoRoute && !(session.route && session.route.agentId)) return 'Auto route';
    const selected = provider(routedId);
    if (!selected) return `Provider: ${routedId || 'unavailable'}`;
    return selected.hosted === false || selected.id === 'local' ? 'Local' : 'Cloud';
  }

  function paintC() {
    const session = activeSession();
    const ses = el('div', 'sesrow');
    const last = session.runs[session.runs.length - 1];
    const breadcrumb = el('div', 'fgsession-breadcrumb');
    add(breadcrumb, el('b', null, workspaceName(S.status)), glyph('›', 'sep'), el('span', null, session.name));
    const label = el('span', 'sesname', last ? short(last.task, 42) : 'Ready for a task');
    if (last) label.title = last.task;
    add(ses, breadcrumb, el('span', 'sp'), label);

    // What is owed, where it is owed, said in the header of the surface that
    // owes it. Drawn from the capsules actually held, never from a click.
    const owed = gatesWaiting();
    if (owed > 0) {
      const chip = el('span', 'chip');
      chip.dataset.state = 'warn';
      add(chip, glyph('◈', 'chip-glyph'), document.createTextNode(`${owed} waiting`));
      chip.title = 'Approval capsules currently held by the daemon.';
      add(ses, chip);
    }
    const lens = btn('fgicon', '@', () => selectInspector('lens'));
    lens.setAttribute('aria-label', 'Open exact run context');
    lens.title = 'Open exact sanitized run context';
    add(ses, lens);
    if (S.view === 'ide') {
      const hide = btn('fgicon', '×', () => setPaneOpen('session', false));
      hide.setAttribute('aria-label', 'Hide Session panel');
      hide.title = 'Hide Session panel';
      add(ses, hide);
    }
    if (S.streamDown) {
      const chip = el('span', 'chip');
      chip.dataset.state = 'warn';
      add(chip, glyph('!', 'chip-glyph'), document.createTextNode('reconnecting'));
      chip.title = 'The approval stream dropped and is retrying.';
      add(ses, chip);
    }

    const sessionRail = el('aside', 'fgsession-rail');
    sessionRail.setAttribute('aria-label', 'Project conversations');
    const railTitle = el('div', 'fgsessions-title');
    add(railTitle, el('span', null, 'Project'), el('b', null, workspaceName(S.status)), el('span', null, 'Conversations'));
    const sessions = el('div', 'fgsessions');
    sessions.setAttribute('role', 'tablist');
    sessions.setAttribute('aria-label', 'Agent sessions');
    for (const item of S.sessions) {
      const b = btn('fgsession-tab', null, () => {
        S.selectedSessionId = item.id;
        paintC();
        paintE();
      });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', item.id === session.id ? 'true' : 'false');
      b.dataset.sessionId = item.id;
      paintSessionTab(b, item);
      add(sessions, b);
    }
    const sessionActions = el('div', 'fgsessions-actions');
    const addAgent = btn('fgicon', '+', addSession);
    addAgent.setAttribute('aria-label', 'New agent session');
    addAgent.title = 'New independent agent session';
    addAgent.disabled = S.sessions.length >= 8;
    const closeAgent = btn('fgicon', '×', closeActiveSession);
    closeAgent.setAttribute('aria-label', 'Close selected agent session');
    closeAgent.disabled = S.sessions.length <= 1 || session.running || session.routing;
    closeAgent.title = S.sessions.length <= 1
      ? 'Forge keeps one agent session open.'
      : session.running || session.routing
        ? 'Stop or wait for this session before closing it.'
        : `Close ${session.name}`;
    add(sessionActions, addAgent, closeAgent);
    add(sessionRail, railTitle, sessions, sessionActions);

    const tabs = el('div', 'insp-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Session views');
    for (const [id, name] of INSP) {
      const b = btn(null, name, () => selectInspector(id));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', id === S.insp ? 'true' : 'false');
      add(tabs, b);
    }

    const bd = el('div', 'insp-bd');
    const transcript = el('div', 'fgtranscript');
    add(transcript, INSPECTOR[S.insp] ? INSPECTOR[S.insp]() : INSPECTOR.chat());
    add(bd, transcript);

    /* The sticky composer keeps the primary task and next action visible. */
    const compose = el('div', 'compose');
    const input = el('textarea');
    input.rows = 2;
    input.maxLength = 16_000;
    input.id = 'zf-task';
    input.placeholder = session.routing ? 'Choosing the route…' : session.running ? 'This agent is running…' : 'Ask Zeno to inspect, explain, or change this repository';
    input.setAttribute('aria-label', 'Task for the agent');
    input.value = session.draft;
    input.disabled = session.routing || session.running || !OWNER_TOKEN;
    input.addEventListener('input', () => {
      session.draft = input.value;
      session.hostedConfirmation = null;
      invalidateRunContext(session);
      if (S.insp === 'lens') scheduleRunContext(session);
      sendBtn.disabled = !canRun(session);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && canRun(session)) { ev.preventDefault(); void doRun(session); }
    });
    add(compose, input);

    const controls = el('div', 'composer-actions');
    const addContext = btn('fgicon', '+', openSkillsCatalog);
    addContext.setAttribute('aria-label', 'Add context from rules and skills');
    addContext.title = 'Add context from the repository Skills catalog';
    const exactContext = btn('fgicon', '@', () => selectInspector('lens'));
    exactContext.setAttribute('aria-label', 'Inspect exact context');
    exactContext.title = 'Inspect the exact bounded prompt, repository rules, and Vault recall';
    const codeMode = btn('fgicon fgcode-mode', '</>', () => {
      setView('ide');
      requestAnimationFrame(() => paneViews[S.focusedGroup]?.editor?.focus());
    });
    codeMode.setAttribute('aria-label', 'Code mode');
    codeMode.setAttribute('aria-pressed', S.view === 'ide' ? 'true' : 'false');
    codeMode.title = 'Code mode opens the editor workspace; it does not change provider permissions.';
    add(controls, addContext, exactContext, codeMode, el('span', 'sp'));

    const locationChip = el('span', 'fgroute-state', composerLocation(session));
    locationChip.title = session.autoRoute && !(session.route && session.route.agentId)
      ? 'Zeno will choose from providers proved available for this task.'
      : 'Where the currently selected provider runs.';
    add(controls, locationChip);
    const voice = btn('fgicon', '◉', () => {
      document.querySelector('[data-nav="command"]')?.click();
      requestAnimationFrame(() => document.querySelector('.zv-ptt')?.focus());
    });
    voice.setAttribute('aria-label', 'Open voice input');
    voice.title = 'Open Command and focus its local hold-to-talk control';
    const sendBtn = btn('fgsend', '↑', () => void doRun(session));
    sendBtn.setAttribute('aria-label', session.routing ? 'Routing task' : session.running ? 'Task running' : 'Submit task');
    sendBtn.title = 'Submit task · Enter';
    sendBtn.disabled = !canRun(session);
    add(controls, voice, sendBtn);

    const routingControls = el('div', 'composer-routing');
    add(routingControls, buildPickers(session));

    const route = el('details', 'fgroute');
    add(route, el('summary', null, `${composerLocation(session)} · route details`));
    add(route, el('div', null,
      session.route && session.route.rationale
        ? session.route.rationale
        : session.autoRoute
          ? 'Automatic routing uses task type, privacy, and providers proved available on this machine. A hosted choice still asks before code is sent.'
          : 'Manual routing uses the selected provider, model, and effort.'));
    const composerShell = el('div', 'composer-shell');
    const hostedGate = session.hostedConfirmation ? renderHostedConfirmation(session) : null;
    add(composerShell, hostedGate, compose, controls, routingControls, route);
    rgC.replaceChildren(ses, sessionRail, tabs, bd, composerShell);
    paintTop();
  }

  function canRun(session = activeSession()) {
    // A missing availability response is UNKNOWN, not permission to guess.
    // Keep Run inert until the daemon has proved at least one route runnable.
    const providerReady = Boolean(S.agents && (session.autoRoute || providerAvailable(session.agentId)));
    return Boolean(OWNER_TOKEN && !session.routing && !session.running && !session.hostedConfirmation
      && !S.choosing && !S.contextBusy && providerReady && session.draft.trim() !== '');
  }

  function renderHostedConfirmation(session) {
    const pending = session.hostedConfirmation;
    const item = provider(pending.route.agentId);
    const label = (item && item.label) || pending.route.agentId;
    const gate = el('div', 'fghosted');
    gate.setAttribute('role', 'alert');
    gate.setAttribute('aria-label', 'Confirm hosted agent run');
    add(gate, el('b', null, `Run once with ${label}?`));
    const memory = session.contextPreview && session.contextPreview.memory;
    const memoryNotice = memory && memory.enabled
      ? `${Array.isArray(memory.entries) ? memory.entries.length : 0} task-relevant Vault record${Array.isArray(memory.entries) && memory.entries.length === 1 ? '' : 's'} will be included as cited, non-authoritative context. `
      : 'Vault memory is disabled for this session. ';
    add(gate, el('p', null,
      `${label} will receive this task and the bounded project context needed for the run. ` +
      memoryNotice +
      'This can consume your provider plan or API allowance. Forge will not retry automatically, allows one hosted run at a time, and every file still waits for your approval.'));
    const actions = el('div', 'acts');
    const confirm = btn('btn sm', `Run with ${label}`, () => void runHosted(session));
    confirm.dataset.intent = 'confirm-hosted';
    confirm.disabled = anotherHostedRunIsActive(session);
    if (confirm.disabled) confirm.title = 'Another hosted agent is running. This confirmation stays here until that run finishes.';
    const keep = btn('btn sm ghost', 'Keep editing', () => {
      session.hostedConfirmation = null;
      paintC();
      const input = rgC.querySelector('#zf-task');
      if (input) input.focus();
    });
    add(actions, confirm, keep);
    add(gate, actions);
    return gate;
  }

  function buildPickers(session = activeSession()) {
    const box = el('span', 'fgpickers');
    if (S.agentsErr) {
      add(box, el('span', null, `agents unavailable — ${S.agentsErr}`));
      return box;
    }
    if (!S.agents) {
      add(box, el('span', null, 'reading the available agents…'));
      return box;
    }
    const autoLabel = el('label', 'fgauto');
    const auto = el('input');
    auto.type = 'checkbox';
    auto.checked = session.autoRoute;
    auto.disabled = session.running || session.routing;
    auto.addEventListener('change', () => {
      session.autoRoute = auto.checked;
      session.hostedConfirmation = null;
      session.route = auto.checked ? null : { rationale: 'Manual routing is active; the controls below are the route.' };
      paintC();
    });
    add(autoLabel, auto, document.createTextNode(' Auto'));
    autoLabel.title = 'Automatically choose provider, model, and effort from the task; clear this to override them manually.';
    add(box, autoLabel);
    const agents = S.agents.agents || [];
    const agentSel = el('select');
    agentSel.setAttribute('aria-label', 'Agent');
    for (const a of agents) {
      const unavailable = a.available === false;
      const o = el('option', null, `${a.label || a.id}${unavailable ? ' — unavailable' : ''}`);
      o.value = a.id;
      o.disabled = unavailable;
      if (unavailable && a.unavailableReason) o.title = a.unavailableReason;
      if (a.id === session.agentId) o.selected = true;
      add(agentSel, o);
    }
    agentSel.disabled = session.running || session.routing || !agents.some((a) => a && a.available !== false);
    const selectedProvider = agents.find((a) => a && a.id === session.agentId);
    if (selectedProvider && selectedProvider.available === false) {
      agentSel.title = selectedProvider.unavailableReason || 'This provider is not runnable on this machine.';
    }
    agentSel.addEventListener('change', () => {
      session.agentId = agentSel.value; session.model = ''; session.autoRoute = false;
      session.hostedConfirmation = null;
      session.route = { rationale: 'Manual routing is active; you selected the provider.' };
      paintC(); paintE();
    });

    const modelSel = el('select');
    modelSel.setAttribute('aria-label', 'Model');
    const chosen = agents.find((a) => a.id === session.agentId);
    const models = session.agentId === 'local' ? (S.agents.localModels || []) : ((chosen && chosen.models) || []);
    if (models.length === 0) {
      const o = el('option', null, session.agentId === 'local' ? 'no local model installed' : 'the agent’s default');
      o.value = '';
      add(modelSel, o);
      modelSel.disabled = true;
      modelSel.title = session.agentId === 'local'
        ? 'Ollama listed no installed models, so there is nothing to pick.'
        : 'This agent chooses its own model; the daemon offers no list.';
    } else {
      const dflt = el('option', null, 'the agent’s default');
      dflt.value = '';
      add(modelSel, dflt);
      for (const m of models) {
        const o = el('option', null, m);
        o.value = m;
        if (m === session.model) o.selected = true;
        add(modelSel, o);
      }
    }
    if ((chosen && chosen.available === false) || session.running || session.routing) modelSel.disabled = true;
    modelSel.addEventListener('change', () => {
      session.model = modelSel.value; session.autoRoute = false;
      session.hostedConfirmation = null;
      session.route = { rationale: 'Manual routing is active; you selected the model.' };
      paintC(); paintE();
    });

    const effortSel = el('select');
    effortSel.setAttribute('aria-label', 'Effort');
    for (const e of S.agents.efforts || []) {
      const o = el('option', null, `effort: ${e}`);
      o.value = e;
      if (e === session.effort) o.selected = true;
      add(effortSel, o);
    }
    const supports = !chosen || chosen.supportsEffort !== false;
    const runnable = !chosen || chosen.available !== false;
    effortSel.disabled = session.running || session.routing || !supports || !runnable;
    if (!supports) effortSel.title = 'This agent does not take an effort level.';
    else if (!runnable) effortSel.title = chosen.unavailableReason || 'This provider is unavailable.';
    effortSel.addEventListener('change', () => {
      session.effort = effortSel.value; session.autoRoute = false;
      session.hostedConfirmation = null;
      session.route = { rationale: 'Manual routing is active; you selected the effort.' };
      paintC(); paintE();
    });

    add(box, agentSel, modelSel, effortSel);
    if (chosen && chosen.available === false) {
      add(box, el('span', 'fgprovider-note', chosen.unavailableReason || 'This provider is unavailable.'));
    }
    return box;
  }

  const INSPECTOR = {
    /* CHAT — the real conversation. The owner's turn is the task they typed;
       the agent's turn is what POST /forge/run actually returned. The tool rows
       are the file operations the run genuinely produced — Forge sees the
       agent's writes, not its private tool calls, and the footnote says so. */
    chat() {
      const wrap = el('div');
      if (!OWNER_TOKEN) {
        add(wrap, renderUnwired(
          'This page cannot start a run',
          'The window was opened without an owner token, so it holds a read-only view. Launch Zeno from its own launcher to run an agent.',
        ));
        return wrap;
      }
      if (S.chat.length === 0 && S.gates.length === 0) {
        const empty = el('div', 'fgempty');
        add(empty, glyph('✦', 'fgempty-mark'), el('h2', null, 'What should Zeno work on?'),
          el('p', null, 'Describe a task below. Forge will show the current state and next action here.'));
        const starters = el('div', 'fgempty-starters');
        const seed = (label, task) => {
          const button = btn(null, label, () => {
            const current = activeSession();
            current.draft = task;
            current.hostedConfirmation = null;
            invalidateRunContext(current);
            paintC();
            requestAnimationFrame(() => rgC.querySelector('#zf-task')?.focus());
          });
          button.title = `Put “${task}” in the composer`;
          add(starters, button);
        };
        seed('Explain this repository', 'Explain this repository and its main architecture.');
        seed('Find failing checks', 'Run the repository checks and explain any failures.');
        seed('Plan a change', 'Help me plan a bounded change in this repository.');
        add(empty, starters);
        const safety = el('details', 'fgempty-details');
        add(safety, el('summary', null, 'How changes and approvals work'),
          el('p', null, 'Runs use an isolated worktree. File changes become governed proposals, and non-routine effects wait in approval capsules.'));
        add(empty, safety);
        add(wrap, empty);
        return wrap;
      }
      // ONE TIMELINE. A capsule raised in the middle of a run belongs where it
      // happened, not in a tray beside the conversation — the whole reason to
      // put the gate in the thread is that the ask and the work are one story.
      const items = [];
      for (let i = 0; i < S.chat.length; i++) {
        const t = S.chat[i];
        const make = t.who === 'you' ? () => youTurn(t) : t.who === 'save' ? () => saveTurn(t) : () => agentTurn(t);
        items.push({ at: t.at instanceof Date ? t.at : new Date(0), seq: i, make });
      }
      for (const g of S.gates) {
        items.push({ at: g.at, seq: Number.MAX_SAFE_INTEGER, make: () => gateBlock(g) });
      }
      items.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
      for (const it of items) add(wrap, it.make());
      if (S.gatesErr) {
        add(wrap, renderNote(
          `The list of capsules the daemon is holding could not be read: ${S.gatesErr} Nothing is claimed about what is or is not waiting.`,
          'rd',
        ));
      }
      if (S.running) add(wrap, runningBlock());
      return wrap;
    },

    /* RUNS — real: what this session actually ran. */
    runs() {
      const wrap = el('div');
      if (S.runs.length === 0) {
        add(wrap, renderUnwired(
          'No runs in this session',
          'This list holds the runs started from this window. It is empty because none has been started, and it is not backfilled from anywhere else.',
        ));
        return wrap;
      }
      for (const r of [...S.runs].reverse()) {
        const box = el('div', 'box');
        add(box, el('b', null, short(r.task, 70)));
        const kv = el('dl', 'kv');
        kvAdd(kv, 'at', clock(r.at));
        kvAdd(kv, 'agent', r.agentId);
        kvAdd(kv, 'model', r.model || 'the agent’s default');
        kvAdd(kv, 'effort', r.effort || '—');
        kvAdd(kv, 'routing', r.automatic ? 'automatic' : 'manual');
        if (r.cancelled) kvAdd(kv, 'outcome', 'cancelled by you');
        kvAdd(kv, 'agent finished', r.ok ? 'yes' : 'no');
        if (r.tokenUsage) kvAdd(kv, 'token usage', tokenUsageLabel(r.tokenUsage));
        kvAdd(kv, 'files changed', String(r.files));
        // Split, for the same reason the chat footer is split: "proposed" was a
        // total that silently included the routine writes the kernel had already
        // committed, so a run whose every change auto-applied still reported
        // capsules as if they were waiting for the owner.
        kvAdd(kv, 'awaiting your approval', String(r.waiting));
        kvAdd(kv, 'auto-applied (routine)', String(r.applied));
        add(box, kv);
        if (r.routeRationale) add(box, renderNote(r.routeRationale, 'cy'));
        if (r.note) add(box, renderNote(r.note, 'rd'));
        add(wrap, box);
      }
      add(wrap, el('div', 'hint',
        '“agent finished” is not “applied”. A run only ever proposes — except for routine (T0) writes, which the kernel commits and receipts on the spot; those are counted separately above.'));
      return wrap;
    },

    /* ACTIONS — real: the capsules the newest run put in front of the owner. */
    actions() {
      const wrap = el('div');
      if (S.proposals.length === 0) {
        add(wrap, renderUnwired(
          'No proposals from this window',
          'A run turns each file the agent changed into an ordinary approval capsule on Command. None has been produced here yet.',
        ));
        return wrap;
      }
      for (const p of S.proposals) {
        const row = el('div', 'frow');
        const nm = el('span', 'nm', p.path);
        nm.title = p.path;
        add(row, nm, el('span', 'tag', p.auto ? `${p.tier} · applied` : `${p.tier} · waiting`));
        add(wrap, row);
      }
      const waiting = S.proposals.filter((p) => !p.auto).length;
      const auto = S.proposals.length - waiting;
      if (waiting) {
        add(wrap, renderNote(
          `${waiting} ${waiting === 1 ? 'change is' : 'changes are'} waiting for your approval in Command. Nothing reaches the sandbox until you say yes there.`,
        ));
      }
      if (auto) {
        add(wrap, renderNote(
          `${auto} routine ${auto === 1 ? 'change was' : 'changes were'} applied and receipted — ${auto === 1 ? 'it is' : 'they are'} in Command’s timeline rather than awaiting a decision.`,
          'cy',
        ));
      }
      const acts = el('div', 'acts');
      const go = btn('btn sm', 'Open Command');
      go.setAttribute('data-go', 'command');
      add(acts, go);
      add(wrap, acts);
      return wrap;
    },

    /* The two with no source. */
    plan() {
      return renderUnwired(
        'There is no plan step',
        'Forge hands the task straight to the agent; nothing in this daemon produces a plan for you to approve first, so there is no plan to show. When a planning step exists, it will appear here.',
      );
    },
    lens() { return lensPanel(); },
    skills() { return rulesSkillsPanel(); },
  };

  function youTurn(t) {
    const m = el('div', 'msg');
    const who = el('div', 'who');
    add(who, el('span', null, 'you'));
    if (t.route) add(who, el('span', 'mchip', t.route.automatic ? 'auto-routed' : 'manual route'));
    add(m, who);
    add(m, el('div', 'bub', t.text));
    if (t.route && t.route.rationale) add(m, renderNote(t.route.rationale, 'cy'));
    return m;
  }

  /**
   * A save from the code pane, as a turn in the session.
   *
   * It draws ONE of two things and never both, because they are not the same
   * event: a receipt, when the kernel judged the edit routine and therefore
   * committed and receipted it without asking; or a line saying the capsule is
   * held and pointing at it — the capsule itself renders further down the
   * thread from /state, with the payload the owner can re-hash.
   *
   * The green seal comes from `renderReceipt`, which draws it only from an
   * outcome of 'verified' and only with a receipt id in hand. There is no path
   * from this click to a green anything.
   */
  function saveTurn(t) {
    const m = el('div', 'msg me');
    const who = el('div', 'who');
    add(who, el('span', null, 'you · code pane'));
    add(who, el('span', 'mchip', `${t.tier} · ${t.path}`));
    add(m, who);

    const bub = el('div', 'bub');
    if (t.receipt) {
      add(bub, el('div', null,
        `The kernel judged this edit routine (${t.tier}) and committed it — so it did not stop to ask, and it is not waiting on you. Here is the receipt it wrote.`));
      add(bub, renderReceipt(t.receipt));
    } else {
      add(bub, el('div', null,
        `This edit is held at ${t.tier}. It has NOT been written to the sandbox: the capsule below carries the exact bytes, and nothing lands until you approve it there or in Command.`));
    }
    if (t.secretWarning && t.secretWarning.count > 0) {
      add(bub, renderNote(
        `The sanitizer found ${t.secretWarning.count} ${t.secretWarning.count === 1 ? 'thing that looks like a secret' : 'things that look like secrets'} in these bytes (${(t.secretWarning.kinds || []).join(', ')}). That is why this needs a decision.`,
        'rd',
      ));
    }
    add(m, bub);
    return m;
  }

  /* ---- code in the conversation, coloured by monaco --------------------- *
   * The agent's output arrives as one string, and most of it is log, not code.
   * Exactly two shapes inside it are code AND carry their own language:
   *
   *   ===FILE: path ===  …  ===END===   the harness's emit blocks. The language
   *                                     is whatever monaco says that PATH is.
   *   ``` lang  …  ```                  a fenced block whose tag monaco knows.
   *
   * Those two are colourised. Everything else stays a plain <pre>, because
   * guessing a language for arbitrary log output would mis-colour real text —
   * the same rule the old hand-rolled lexer followed, applied to a better
   * tokeniser. A fence whose tag monaco does not recognise is left plain and
   * keeps its tag visible, so the absence of colour is explained rather than
   * mysterious. */

  /** The monaco language id for a fence tag, by id or alias. null if unknown. */
  function monacoLang(tag) {
    const m = monacoIfLoaded();
    const want = String(tag || '').trim().toLowerCase();
    if (!m || want === '') return null;
    for (const lang of m.languages.getLanguages()) {
      if (String(lang.id).toLowerCase() === want) return lang.id;
      if (Array.isArray(lang.aliases) && lang.aliases.some((a) => String(a).toLowerCase() === want)) return lang.id;
    }
    return null;
  }

  function preBlock(text) {
    const body = text.replace(/^\s*\n/, '').replace(/\s+$/, '');
    if (body === '') return null;
    const pre = el('pre');
    pre.textContent = body;
    return pre;
  }

  function codeBlock(text, lang, label) {
    const box = el('div', 'fgcode');
    if (label) {
      const h = el('div', 'fgcode-h');
      add(h, el('span', 'fgcode-p', label));
      if (lang) add(h, el('span', 'fgcode-l', lang));
      add(box, h);
    }
    const pre = el('pre');
    pre.textContent = String(text).replace(/\s+$/, '');
    add(box, pre);
    const m = monacoIfLoaded();
    // colorizeElement reads the node's own textContent, tokenises it and writes
    // back ESCAPED markup. The bytes were put there with textContent and never
    // leave this file as a string that becomes markup.
    if (lang && m) {
      void m.editor
        .colorizeElement(pre, { theme: ZENO_THEME, mimeType: lang, tabSize: 2 })
        .catch(() => { /* uncoloured is a fine outcome; wrong colours are not */ });
    }
    return box;
  }

  function logBlocks(log) {
    const frag = document.createDocumentFragment();
    const re = /===FILE:\s*(\S+)\s*===\r?\n([\s\S]*?)\r?\n===END===|```([A-Za-z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(log)) !== null) {
      if (m.index > last) add(frag, preBlock(log.slice(last, m.index)));
      if (m[1] !== undefined) add(frag, codeBlock(m[2], languageForPath(m[1]), m[1]));
      else add(frag, codeBlock(m[4], monacoLang(m[3]), m[3] || ''));
      last = m.index + m[0].length;
    }
    if (last < log.length) add(frag, preBlock(log.slice(last)));
    return frag;
  }

  function agentTurn(t) {
    const m = el('div', 'msg me');
    const who = el('div', 'who');
    add(who, el('span', null, 'Zeno Forge'));
    add(who, el('span', 'mchip', `${t.agentId}${t.model ? ' · ' + t.model : ''}${t.effort ? ' · ' + t.effort : ''}`));
    add(m, who);

    const bub = el('div', 'bub');
    if (t.note) add(bub, el('div', null, t.note));
    if (t.log) add(bub, logBlocks(t.log));
    if (!t.note && !t.log) add(bub, el('div', null, 'The agent returned without any output to show.'));
    add(m, bub);

    const activity = el('details', 'fgactivity-detail');
    add(activity, el('summary', null,
      `Run activity · ${t.files.length} file${t.files.length === 1 ? '' : 's'} · ${clock(t.at)}`));
    add(activity, el('div', 'think',
      `${t.cancelled ? 'Stopped by you' : 'Provider finished'} · isolated worktree inspected · governed proposals prepared`));
    if (t.tokenUsage) add(activity, el('div', 'think', tokenUsageLabel(t.tokenUsage)));
    const tools = el('div', 'fgactivity-tools');
    for (const f of t.files) {
      const row = f.skipped ? el('div', 'tool') : btn('tool', null, () => openFile(f.path));
      add(row, el('span', 'th', f.skipped ? 'skip' : 'write'));
      const p = el('span', 'pth', f.lines ? `${f.path}:1–${f.lines}` : f.path);
      p.title = f.skipped ? `${f.path} — ${f.skipped.note}` : f.path;
      add(row, p, el('span', 'ok', f.skipped ? 'not proposed' : (f.tier || '·')));
      add(tools, row);
    }
    if (t.files.length === 0) add(tools, el('div', 'tool', 'No file operations'));
    add(activity, tools, el('div', 'hint',
      `Approvals: ${t.waiting || 0} waiting · ${t.applied || 0} routine applied. Provider plan steps and private reasoning are not exposed by the current backend.`));
    add(m, activity);

    if (t.waiting > 0) {
      const c = btn('cite', `↗ ${t.waiting} ${t.waiting === 1 ? 'capsule' : 'capsules'} awaiting your decision`);
      c.setAttribute('data-go', 'command');
      add(m, c);
    }
    if (t.applied > 0) {
      const c = btn('cite', `✓ ${t.applied} routine ${t.applied === 1 ? 'change was' : 'changes were'} applied and receipted`);
      c.setAttribute('data-go', 'command');
      add(m, c);
    }
    return m;
  }

  function kvAdd(dl, k, v) {
    add(dl, el('dt', null, k), el('dd', null, v === undefined || v === null || v === '' ? '—' : String(v)));
  }

  /* ================================================================ *
   * rgD — the drawer: Terminal · Tests · CI · Processes & ports       *
   * ================================================================ *
   * Three of the four have nothing behind them and say so. The fourth,
   * Processes & ports, reports the one process this page can actually
   * observe: the daemon it is talking to.                              */

  const DRAWER = [['problems', 'Problems'], ['output', 'Output'], ['debugconsole', 'Debug Console'], ['terminal', 'Terminal'], ['ports', 'Ports']];

  /* Open or shut is one attribute on :root, because the CSS owns the collapsed
     layout. Every control that moves the drawer goes through here, for two
     reasons: the label, the ARIA state and the attribute can then never
     disagree, and nothing has to repaint the drawer to open it — which matters
     because a repaint mid-drag would tear the handle out from under the pointer. */
  const drawerMin = () => R.getAttribute('data-drawer') === 'min';
  let colBtn = null;
  function setDrawerMin(min) {
    if (min) R.setAttribute('data-drawer', 'min');
    else R.removeAttribute('data-drawer');
    if (colBtn) {
      colBtn.textContent = min ? '⌃' : '⌄';
      colBtn.setAttribute('aria-expanded', min ? 'false' : 'true');
      colBtn.setAttribute('aria-label', min ? 'Expand bottom panel' : 'Collapse bottom panel');
      colBtn.title = min ? 'Expand bottom panel' : 'Collapse bottom panel';
    }
    // The workbench bar mirrors the drawer state. Repaint that small strip so
    // its icon and accessible label always describe what the next click does.
    paintTop();
  }

  function paintD() {
    const drag = btn('fdrag');
    // The shut case is named because it is the one the handle does not obey
    // literally: the first press opens the drawer, which moves the handle out
    // from under a second click, so a double-click on a shut drawer opens it
    // rather than resetting it.
    drag.title = 'Drag to resize · double-click to reset · opens the drawer if it is shut';
    drag.setAttribute('aria-label', 'Resize the drawer');
    wireDrag(drag);

    const hd = el('div', 'drawhd');
    hd.setAttribute('role', 'tablist');
    for (const [id, name] of DRAWER) {
      /* Picking a tab while the drawer is shut used to select it underneath a
         `display:none` body: the chip lit up and nothing appeared, which is
         indistinguishable from a broken tab. Asking for a tab is asking to see
         it, so choosing one opens the drawer. */
      const c = btn('chip', name, () => {
        S.draw = id;
        if (drawerMin()) setDrawerMin(false);
        paintD();
        if (id === 'output' && !S.tests && !S.testsBusy) void loadTests();
      });
      c.setAttribute('role', 'tab');
      c.setAttribute('aria-selected', id === S.draw ? 'true' : 'false');
      if (id === S.draw) c.dataset.state = 'listening';
      add(hd, c);
    }
    add(hd, el('span', 'sp'));
    colBtn = btn('drawcol', drawerMin() ? '⌃' : '⌄', () => setDrawerMin(!drawerMin()));
    colBtn.setAttribute('aria-expanded', drawerMin() ? 'false' : 'true');
    colBtn.setAttribute('aria-label', drawerMin() ? 'Expand bottom panel' : 'Collapse bottom panel');
    colBtn.title = drawerMin() ? 'Expand bottom panel' : 'Collapse bottom panel';
    add(hd, colBtn);

    const bd = el('div', 'drawbody');
    add(bd, DRAWER_BODY[S.draw] ? DRAWER_BODY[S.draw]() : DRAWER_BODY.terminal());

    rgD.replaceChildren(drag, hd, bd);
  }

  function activeTerminal() {
    let terminal = S.terminalTabs.find((entry) => entry.id === S.terminalId);
    if (!terminal) {
      terminal = S.terminalTabs[0];
      S.terminalId = terminal.id;
    }
    return terminal;
  }

  function testPanel(compact) {
    const wrap = el('div', compact ? 'fgtests compact' : 'pw fgtests');
    const hd = el('div', 'acts');
    add(hd, el('b', null, 'Repository verification'));
    const refresh = btn('btn sm ghost', S.testsBusy ? 'Reading…' : 'Refresh', () => void loadTests());
    refresh.disabled = S.testsBusy || !!S.testRunId;
    add(hd, el('span', 'sp'), refresh);
    add(wrap, hd);
    if (S.testsErr) add(wrap, renderNote(`Tests unavailable: ${S.testsErr}`));
    if (!S.tests) {
      if (!S.testsErr) add(wrap, renderNote('Discovering package test scripts…'));
      return wrap;
    }
    add(wrap, el('div', 'hint', S.tests.note || 'Only test scripts declared by this repository are shown.'));
    const scripts = Array.isArray(S.tests.scripts) ? S.tests.scripts : [];
    if (!scripts.length) {
      add(wrap, renderUnwired(
        'No runnable verification scripts were found',
        'Forge scanned bounded package manifests and found no test, test:*, check, typecheck, or lint script. Add one to package.json, then refresh.',
      ));
      return wrap;
    }
    for (const script of scripts) {
      const row = el('div', 'box fgtest');
      const top = el('div', 'acts');
      add(top, el('b', null, `${script.packageName} · ${script.script}`));
      const run = btn('btn sm', S.testRunId === script.id ? 'Running…' : 'Run', () => void runTest(script));
      run.setAttribute('aria-label', `Run ${script.script} in ${script.packageName}`);
      run.disabled = !OWNER_TOKEN || !!S.testRunId;
      add(top, el('span', 'sp'), run);
      add(row, top, el('div', 'hint', `${script.packagePath} · ${script.displayCommand}`));
      add(row, el('div', 'hint', script.scriptBody + (script.scriptBodyClipped ? ' (display clipped)' : '')));
      const result = S.testResults.get(script.id);
      if (result) {
        const outcome = result.failedToSpawn
          ? (result.timedOut ? 'timed out and was stopped' : 'could not start')
          : result.ok ? 'passed' : `failed · exit ${result.code}`;
        const status = el('div', `note ${result.ok ? 'gn' : 'rd'}`, `${outcome} · ${result.durationMs}ms · ${result.startedAt}`);
        status.setAttribute('role', 'status');
        add(row, status);
        if (result.stdout) add(row, el('pre', 'code', result.stdout));
        if (result.stderr) add(row, el('pre', 'code', result.stderr));
        if (!result.stdout && !result.stderr) add(row, el('div', 'hint', 'The test process returned no output.'));
        if (result.outputClipped) add(row, el('div', 'hint', 'Output was clipped at the daemon boundary; the result above still comes from the real exit code.'));
      }
      add(wrap, row);
    }
    const count = scripts.length;
    add(wrap, el('div', 'hint', `${count} runnable script${count === 1 ? '' : 's'} from ${S.tests.scannedPackages} package manifest${S.tests.scannedPackages === 1 ? '' : 's'}${S.tests.truncated ? ' · discovery stopped at its safety cap' : ''}.`));
    if (!OWNER_TOKEN) add(wrap, renderNote('Open Zeno from its launcher to run repository tests. This page is read-only.'));
    return wrap;
  }

  function markerInventory() {
    const items = [];
    if (!M) return { items, errors: 0, warnings: 0, ready: false };
    for (const [path, model] of models) {
      if (!model || model.isDisposed() || !DIAGNOSED.has(model.getLanguageId())) continue;
      for (const marker of M.editor.getModelMarkers({ resource: model.uri })) items.push({ path, marker });
    }
    return {
      items,
      errors: items.filter(({ marker }) => marker.severity === M.MarkerSeverity.Error).length,
      warnings: items.filter(({ marker }) => marker.severity === M.MarkerSeverity.Warning).length,
      ready: true,
    };
  }

  const DRAWER_BODY = {
    problems() {
      const wrap = el('div', 'fgproblems-list');
      const inventory = markerInventory();
      if (!inventory.ready) return renderUnwired('Problems are loading', 'The bundled Monaco language services have not finished loading.');
      add(wrap, el('div', 'hint', `${inventory.errors} error${inventory.errors === 1 ? '' : 's'} · ${inventory.warnings} warning${inventory.warnings === 1 ? '' : 's'} across open, supported files.`));
      if (!inventory.items.length) add(wrap, renderNote('No problems reported for open files with an active Monaco language service.', 'gr'));
      for (const { path, marker } of inventory.items) {
        const row = btn('fgproblem-row', null, () => void openFile(path, marker.startLineNumber));
        add(row, el('span', marker.severity === M.MarkerSeverity.Error ? 'rd' : 'cy', marker.severity === M.MarkerSeverity.Error ? '✕' : '△'),
          el('span', 'nm', marker.message), el('span', 'tag', `${path}:${marker.startLineNumber}:${marker.startColumn}`));
        row.title = `Open ${path} at line ${marker.startLineNumber}`;
        add(wrap, row);
      }
      add(wrap, el('div', 'hint', 'Counts cover open files and only language services Monaco actually provides. Repository checks remain in the Tests view.'));
      return wrap;
    },
    output() {
      const wrap = el('div', 'fgoutput');
      const results = [...S.testResults.values()];
      const lastRun = S.runs[S.runs.length - 1];
      if (!results.length && !lastRun) add(wrap, renderNote('No run or test output has been captured in this window.'));
      if (lastRun) add(wrap, el('div', 'hint', `Latest agent run: ${lastRun.ok ? 'completed' : 'failed'} · ${lastRun.files} file${lastRun.files === 1 ? '' : 's'} · ${clock(lastRun.at)}`));
      for (const result of results.slice(-5).reverse()) {
        const detail = el('details', 'fgoutput-run');
        add(detail, el('summary', null, `${result.ok ? '✓ passed' : '✕ failed'} · ${result.durationMs}ms · ${result.startedAt}`));
        if (result.stdout) add(detail, el('pre', 'code', result.stdout));
        if (result.stderr) add(detail, el('pre', 'code', result.stderr));
        if (!result.stdout && !result.stderr) add(detail, el('div', 'hint', 'The test process returned no output.'));
        add(wrap, detail);
      }
      const diagnostics = el('details', 'fgcapability-gap');
      add(diagnostics, el('summary', null, 'CI and output sources'),
        el('div', 'hint', 'No CI provider is wired to this daemon. Output here comes only from agent responses and repository tests run in this window.'));
      add(wrap, diagnostics);
      return wrap;
    },
    debugconsole() {
      return renderUnwired('No debug session', 'The daemon exposes no debugger attach or debug-console route. Use repository tests or the owner terminal; this tab starts nothing.');
    },
    terminal() {
      const wrap = el('div');
      const tabbar = el('div', 'acts fgterm-tabs');
      tabbar.setAttribute('role', 'tablist');
      for (const terminal of S.terminalTabs) {
        const tab = btn('chip', terminal.name, () => { S.terminalId = terminal.id; paintD(); });
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', terminal.id === S.terminalId ? 'true' : 'false');
        if (terminal.id === S.terminalId) tab.dataset.state = 'listening';
        tab.title = `${terminal.name} · ${terminal.history.length} command${terminal.history.length === 1 ? '' : 's'} in this window session`;
        add(tabbar, tab);
      }
      const create = btn('btn sm ghost', '+ Shell', () => {
        if (S.terminalTabs.length >= 6) return;
        const id = `shell-${++S.terminalSeq}`;
        S.terminalTabs.push({ id, name: `Shell ${S.terminalSeq}`, draft: '', history: [] });
        S.terminalId = id;
        paintD();
      });
      create.setAttribute('aria-label', 'New terminal tab');
      create.disabled = S.terminalTabs.length >= 6 || S.terminalBusy;
      add(tabbar, create);
      if (S.terminalTabs.length > 1) {
        const close = btn('btn sm ghost', '×', () => {
          const index = S.terminalTabs.findIndex((terminal) => terminal.id === S.terminalId);
          if (index < 0 || S.terminalBusy) return;
          S.terminalTabs.splice(index, 1);
          S.terminalId = S.terminalTabs[Math.max(0, index - 1)].id;
          paintD();
        });
        close.setAttribute('aria-label', 'Close current terminal tab');
        close.disabled = S.terminalBusy;
        add(tabbar, close);
      }
      add(wrap, tabbar);

      const active = activeTerminal();
      const transcript = el('div', 'fgterm-history');
      transcript.setAttribute('aria-live', 'polite');
      if (!active.history.length) add(transcript, el('div', 'hint', `${active.name} has no commands yet.`));
      for (const entry of active.history) {
        const item = el('div', 'box fgterm-entry');
        add(item, el('div', 'hint', `❯ ${entry.command} · ${entry.durationMs}ms · ${entry.failedToSpawn ? 'could not start' : `exit ${entry.code}`}`));
        if (entry.stdout) add(item, el('pre', 'code', entry.stdout));
        if (entry.stderr) add(item, el('pre', 'code', entry.stderr));
        if (!entry.stdout && !entry.stderr) add(item, el('div', 'hint', 'The process returned no output.'));
        add(transcript, item);
      }
      add(wrap, transcript);

      const form = el('form', 'acts');
      const command = el('input');
      command.type = 'text';
      command.setAttribute('aria-label', 'Terminal command');
      command.placeholder = 'Type a command, for example git status --short';
      command.maxLength = 4000;
      command.value = active.draft;
      command.style.cssText = 'min-width:180px;flex:1;background:var(--g1);color:var(--ink);border:1px solid var(--rule-2);border-radius:3px;padding:5px 7px;font:inherit';
      command.disabled = !OWNER_TOKEN || S.terminalBusy || S.choosing;
      const run = btn('btn sm', S.terminalBusy ? 'Running…' : 'Run command');
      run.type = 'submit';
      run.disabled = !OWNER_TOKEN || S.terminalBusy || S.choosing || !active.draft.trim();
      command.addEventListener('input', () => { active.draft = command.value; run.disabled = !active.draft.trim(); });
      form.addEventListener('submit', (ev) => { ev.preventDefault(); void runTerminal(); });
      add(form, command, run);
      add(wrap, form, el('div', 'hint', 'Owner command in the selected folder · one-shot, non-interactive process · 30-second limit · bounded output. Tabs keep history for this window session; they are not PTYs and do not preserve shell state between commands. Opening this panel runs nothing.'));
      if (!OWNER_TOKEN) add(wrap, renderNote('Open Zeno from its launcher to run commands. This page is read-only.'));
      if (S.terminalBusy) add(wrap, renderNote(`Running: ${S.terminalCommand}`));
      if (S.terminalErr) add(wrap, renderNote(S.terminalErr));
      return wrap;
    },
    ports() {
      const wrap = el('div');
      const kv = el('dl', 'kv');
      kvAdd(kv, 'daemon', location.origin);
      kvAdd(kv, 'port', location.port || '(default)');
      kvAdd(kv, 'transport', location.protocol.replace(':', '') + ' · loopback only');
      kvAdd(kv, 'session', OWNER_TOKEN ? 'owner token held' : 'read-only — no owner token');
      add(wrap, kv);
      add(wrap, el('div', 'hint',
        'This is the one process this page can observe: the daemon it is talking to. Forge cannot enumerate other processes or ports, so it lists none.'));
      return wrap;
    },
  };

  /* The drawer resize. Pointer events so a pen and a touch drag work too — the
     handle carries touch-action:none, without which the browser claims a touch
     drag as a page scroll and cancels the gesture; the height is a CSS variable
     on the grid, and a double-click puts it back.
     Every entry point opens a shut drawer FIRST. Dragging a shut drawer used to
     be worse than inert: the collapsed rule pins the track at 34px !important,
     so the drawer did not move, while the drag still wrote a height — measured
     from 34px — over whatever size the owner had set. You pulled a handle, saw
     nothing move, and lost your drawer height on the way. */
  function wireDrag(handle) {
    let startY = 0;
    let startH = 0;
    const clamp = (h) => Math.max(34, Math.min(window.innerHeight * 0.7, h));
    const defaultDrawerHeight = () => Math.min(540, Math.max(260, window.innerHeight * 0.4));
    /* The height the drawer HAS when open — taken from the variable, never
       measured. Measuring is what made the shut drawer eat the owner's size:
       while it is shut the measurement is 34px, the collapsed track, so a drag
       started from 34px and wrote that back over a drawer the owner had sized to
       343px. Opening it first does not help, because the layout the measurement
       needs has not been recomputed by the time the drag reads it. The fallback
       mirrors the stylesheet's bounded 40vh default for a never-resized drawer. */
    const openHeight = () => {
      const inline = parseFloat(root.style.getPropertyValue('--fdrawer'));
      if (Number.isFinite(inline)) return inline;
      return drawerMin() ? defaultDrawerHeight() : rgD.offsetHeight;
    };
    const onMove = (ev) => {
      root.style.setProperty('--fdrawer', `${Math.round(clamp(startH + (startY - ev.clientY)))}px`);
    };
    const onUp = () => {
      handle.classList.remove('grab');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointerdown', (ev) => {
      startY = ev.clientY;
      startH = openHeight();          // the height it has, or will have, open
      if (drawerMin()) setDrawerMin(false);
      handle.classList.add('grab');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      ev.preventDefault();
    });
    handle.addEventListener('dblclick', () => {
      // A reset that leaves the drawer shut is a reset with nothing to show.
      if (drawerMin()) setDrawerMin(false);
      root.style.removeProperty('--fdrawer');
    });
    // Keyboard: the handle is a real button, so it must move without a pointer.
    handle.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      const next = clamp(openHeight() + (ev.key === 'ArrowUp' ? 24 : -24));
      if (drawerMin()) setDrawerMin(false);
      root.style.setProperty('--fdrawer', `${Math.round(next)}px`);
      ev.preventDefault();
    });
  }

  /* ================================================================ *
   * rgE — the status bar                                              *
   * ================================================================ */

  function paintE() {
    const bits = [];
    const st = S.status;
    const session = activeSession();
    const statusButton = (className, text, title, action) => {
      const control = btn(className, text, action);
      control.title = title;
      return control;
    };

    bits.push(statusButton('fgstatus-item fgst-repo', `⌂ ${workspaceName(st)}`,
      st && st.root ? String(st.root) : 'Selected workspace path is unavailable.',
      () => { setView('ide'); setPaneOpen('explorer', true); S.pan = 'explorer'; paintA(); }));
    if (st && st.repo) {
      bits.push(statusButton('fgstatus-item fgst-branch', `⑂ ${st.branch || '(no branch)'}`,
        `${st.head ? `HEAD ${st.head}` : 'No commits yet'} · Remote sync is unavailable in this build.`,
        () => { setView('ide'); setPaneOpen('explorer', true); S.pan = 'scm'; paintA(); }));
      const n = (st.changed || []).length;
      bits.push(el('span', 'fgstatus-item fgst-tree', n === 0 ? '✓ clean' : `${n} changed`));
      const sync = el('span', 'fgstatus-item fgst-sync', '↻ —');
      sync.setAttribute('aria-label', 'Remote sync unavailable');
      sync.title = 'The daemon reports local Git status and has no fetch, pull, push, or sync route.';
      bits.push(sync);
    } else {
      bits.push(el('span', 'fgstatus-item fgst-tree',
        S.statusErr ? 'status unavailable' : S.status ? 'not a Git repository' : 'reading Git…'));
    }

    const running = S.sessions.filter((item) => item.running).length;
    bits.push(el('span', 'fgstatus-item fgst-run', running ? `◉ ${running} running` : '▷ ready'));
    bits.push(el('span', 'sp'));

    const problems = markerInventory();
    const problemButton = statusButton('fgstatus-item fgst-problems',
      `✕ ${problems.errors}  △ ${problems.warnings}`,
      problems.ready ? 'Problems reported by Monaco for open supported files.' : 'Monaco language services are still loading.',
      () => { S.draw = 'problems'; setDrawerMin(false); paintD(); });
    problemButton.disabled = !problems.ready;
    bits.push(problemButton);

    const model = S.file ? models.get(S.file) : null;
    const position = ed && model && ed.getModel() === model ? ed.getPosition() : null;
    if (S.file && S.fileData && !S.fileData.binary) {
      const options = model ? model.getOptions() : null;
      bits.push(el('span', 'fgstatus-item fgst-caret', position ? `Ln ${position.lineNumber}, Col ${position.column}` : S.caret ? `Ln ${S.caret}` : 'Ln —'));
      bits.push(el('span', 'fgstatus-item fgst-spaces', options ? `${options.insertSpaces ? 'Spaces' : 'Tabs'}: ${options.tabSize}` : 'indent —'));
      bits.push(el('span', 'fgstatus-item fgst-encoding', `${S.fileData.encoding} · ${S.fileData.eol}`));
      bits.push(el('span', 'fgstatus-item fgst-language', model ? model.getLanguageId() : 'plain text'));
    } else {
      bits.push(el('span', 'fgstatus-item fgst-file', S.file ? 'binary file' : 'no file'));
    }

    const theme = R.getAttribute('data-theme') || 'system';
    const themeButton = statusButton('fgstatus-item fgst-theme', `◐ ${theme}`,
      `Glass theme: ${theme}. Open Extensions & themes to change it.`,
      () => { setView('ide'); setPaneOpen('explorer', true); S.pan = 'extensions'; paintA(); if (!S.extensions && !S.extensionsBusy) void loadExtensions(); });
    bits.push(themeButton);
    const rainbow = statusButton('fgstatus-item fgst-rainbow', S.rainbowBrackets ? '{} rainbow' : '{} plain',
      `Rainbow brackets are ${S.rainbowBrackets ? 'enabled' : 'disabled'}.`,
      () => { setView('ide'); setPaneOpen('explorer', true); S.pan = 'extensions'; paintA(); });
    bits.push(rainbow);
    bits.push(el('span', 'fgstatus-item fgst-notify', `♢ ${gatesWaiting()}`));
    const location = composerLocation(session);
    const agent = statusButton('fgstatus-item fgst-agent', `${location} · ${session.agentId}${session.model ? `/${session.model}` : ''}`,
      'Active session provider and execution location.', () => { if (!S.sessionOpen) setPaneOpen('session', true); S.insp = 'chat'; paintC(); });
    bits.push(agent);

    rgE.replaceChildren(...bits);
  }

  /* ================================================================ *
   * 3 · the reads and the two writes                                  *
   * ================================================================ */


  let contextPreviewTimer = null;

  function invalidateRunContext(session) {
    session.contextPreview = null;
    session.contextPreviewKey = '';
    session.contextPreviewErr = null;
  }

  function nextContextTask(session) {
    return String((session.hostedConfirmation && session.hostedConfirmation.task)
      || session.draft
      || session.contextPreviewTask
      || '').trim();
  }

  async function loadRunContext(session, taskValue, force = false) {
    const task = String(taskValue ?? nextContextTask(session)).trim();
    if (!task) return null;
    const selectedSkills = [...S.skillIds];
    const key = forgeContextKey(task, session.memoryEnabled, selectedSkills);
    if (!force && session.contextPreview && session.contextPreviewKey === key) return session.contextPreview;
    if (session.contextPreviewBusy) return null;

    session.contextPreviewBusy = true;
    session.contextPreviewErr = null;
    if (activeSession() === session) paintC();
    const result = await api('/forge/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forgeContextBody(task, session.memoryEnabled, selectedSkills)),
    });
    session.contextPreviewBusy = false;

    // A task, skill or memory switch changed while the read was in flight. The
    // response truthfully describes the old selection, so never relabel it as the
    // new one; the next scheduled read will fetch the current bytes.
    const currentTask = String((session.hostedConfirmation && session.hostedConfirmation.task) || session.draft || task).trim();
    const stillCurrent = key === forgeContextKey(currentTask, session.memoryEnabled, [...S.skillIds]);
    if (!stillCurrent) {
      if (activeSession() === session) paintC();
      return null;
    }
    if (!result.ok) {
      session.contextPreviewErr = errText(result);
      session.contextPreview = null;
      session.contextPreviewKey = '';
    } else {
      session.contextPreview = result.data && result.data.context ? result.data.context : null;
      session.contextPreviewKey = session.contextPreview ? key : '';
      session.contextPreviewTask = task;
      if (!session.contextPreview) session.contextPreviewErr = 'The daemon answered without a context preview.';
    }
    if (activeSession() === session) paintC();
    return session.contextPreview;
  }

  function scheduleRunContext(session) {
    if (contextPreviewTimer !== null) clearTimeout(contextPreviewTimer);
    contextPreviewTimer = setTimeout(() => {
      contextPreviewTimer = null;
      if (S.insp === 'lens' && activeSession() === session) void loadRunContext(session);
    }, 250);
  }

  function setSkillSelected(id, selected) {
    if (selected) S.skillIds.add(id); else S.skillIds.delete(id);
    // Skills become part of the outbound prompt, so changing them invalidates
    // any hosted consent that was bound to the previous prompt.
    for (const session of S.sessions) {
      session.hostedConfirmation = null;
      invalidateRunContext(session);
    }
    paintA(); paintC();
    scheduleRunContext(activeSession());
  }

  function catalogMatches(query, ...values) {
    if (!query) return true;
    return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
  }

  /**
   * The discoverable capability catalog. It combines the selected repository's
   * actionable rules/skills with the daemon's read-only global inventory. Lens
   * remains the exact prompt preview and never doubles as a library browser.
   */
  function rulesSkillsPanel() {
    const wrap = el('div', 'pw');
    wrap.style.overflowWrap = 'anywhere';

    const heading = el('div', 'acts');
    add(heading, el('b', null, 'Rules & skills'));
    const busy = S.contextBusy || S.extensionsBusy;
    const refresh = btn('btn sm ghost', busy ? 'Reading…' : 'Refresh catalog', () => {
      void loadContext();
      void loadExtensions();
    });
    refresh.disabled = busy;
    add(heading, el('span', 'sp'), refresh);
    add(wrap, heading);

    const search = el('div', 'sform');
    const input = el('input');
    input.id = 'zf-skill-search';
    input.type = 'search';
    input.placeholder = 'Search rules, skills and sources';
    input.setAttribute('aria-label', 'Search repository rules and local skills');
    input.value = S.skillQuery;
    input.addEventListener('input', () => {
      S.skillQuery = input.value;
      const caret = input.selectionStart ?? input.value.length;
      paintA();
      requestAnimationFrame(() => {
        const next = rgA.querySelector('#zf-skill-search');
        if (!next) return;
        next.focus();
        next.setSelectionRange(caret, caret);
      });
    });
    add(search, input);
    add(wrap, search, el('div', 'hint',
      'Repository skills can be selected for a run. Global skills are catalogued read-only until they are installed in the selected repository. Rules and skills grant no tool permission.'));

    if (S.contextErr) add(wrap, renderNote(`Repository rules and skills unavailable: ${S.contextErr}`, 'rd'));
    if (S.extensionsErr) add(wrap, renderNote(`Global capability catalog unavailable: ${S.extensionsErr}`, 'rd'));
    if (busy) add(wrap, renderNote('Reading repository and local capability sources…'));

    const query = S.skillQuery.trim().toLocaleLowerCase();
    const context = S.context || {};
    const catalog = S.extensions || {};
    const allRules = Array.isArray(context.rules) ? context.rules : [];
    const rules = allRules.filter((rule) =>
      catalogMatches(query, rule.path, rule.body));
    const repositorySkills = new Map(
      (Array.isArray(context.skills) ? context.skills : []).map((skill) => [skill.id, skill]),
    );
    const catalogSkills = Array.isArray(catalog.skills) ? catalog.skills : [];
    const skillEntries = [...catalogSkills];
    for (const skill of repositorySkills.values()) {
      if (skillEntries.some((entry) => entry.id === skill.id && entry.selectableInThisRepository === true)) continue;
      skillEntries.push({
        ...skill,
        provenance: 'selected repository',
        sourcePath: context.dir,
        selectableInThisRepository: true,
      });
    }
    const skills = skillEntries
      .filter((skill) => catalogMatches(
        query,
        skill.id,
        skill.name,
        skill.description,
        skill.provenance,
        skill.sourcePath,
        skill.status,
        skill.verdict,
      ))
      .sort((a, b) => Number(b.selectableInThisRepository) - Number(a.selectableInThisRepository)
        || String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const allBuiltins = Array.isArray(catalog.builtins) ? catalog.builtins : [];
    const repositorySkillCount = skillEntries.filter((skill) => skill.selectableInThisRepository === true).length;
    const otherSkillCount = Math.max(0, skillEntries.length - repositorySkillCount);
    add(wrap, el('div', 'hint',
      `${allRules.length} repository rule${allRules.length === 1 ? '' : 's'} · ` +
      `${repositorySkillCount} selectable skill${repositorySkillCount === 1 ? '' : 's'} · ` +
      `${otherSkillCount} other local skill${otherSkillCount === 1 ? '' : 's'} · ` +
      `${allBuiltins.length} bundled capabilit${allBuiltins.length === 1 ? 'y' : 'ies'}`));

    add(wrap, el('div', 'd', `repository rules · ${rules.length}`));
    if (!S.context && !S.contextErr) add(wrap, renderNote('Reading rules from the selected repository…'));
    else if (!rules.length) add(wrap, renderNote(query
      ? 'No repository rule matches this search.'
      : 'No supported repository rule file was found.'));
    for (const rule of rules) {
      const detail = el('details', 'fgcatalog-row');
      const name = String(rule.path || 'rule').replace(/\\/g, '/').split('/').pop();
      add(detail, el('summary', null, `${name} · active${rule.truncated ? ' · truncated' : ''}`));
      add(detail, el('div', 'hint', `Path: ${rule.path} · ${rule.bytes} bytes`));
      add(detail, el('div', 'hint', 'selected repository · active for agent runs · no additional authority'));
      const body = el('pre', null, rule.body || '');
      body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto';
      add(detail, body);
      add(wrap, detail);
    }

    const sources = (Array.isArray(catalog.skillSources) ? catalog.skillSources : [])
      .filter((source) => catalogMatches(query, source.path, source.provenance, source.reason));
    add(wrap, el('div', 'd', 'local skill sources'));
    if (!S.extensions && !S.extensionsErr) add(wrap, renderNote('Reading repository and global skill libraries…'));
    else if (!sources.length) add(wrap, renderNote(query
      ? 'No skill source matches this search.'
      : 'No local skill source was available.'));
    if (sources.length) {
      const sourceDetails = el('details', 'fgcatalog-group');
      const installed = sources.reduce((sum, source) => sum + (Number(source.installed) || 0), 0);
      const unreadable = sources.reduce((sum, source) => sum + (Number(source.unreadable) || 0), 0);
      add(sourceDetails, el('summary', null,
        `${sources.length} source${sources.length === 1 ? '' : 's'} · ${installed} installed · ${unreadable} unreadable`));
      for (const source of sources) {
        const sourceRow = el('div', 'fgcatalog-subrow');
        add(sourceRow, el('b', null, source.provenance || 'local skill source'));
        add(sourceRow, el('div', 'hint', source.path || 'path unavailable'));
        add(sourceRow, el('div', 'hint', source.reason
          ? `unreadable · ${source.reason}`
          : `${source.installed || 0} installed · ${source.unreadable || 0} unreadable`));
        add(sourceDetails, sourceRow);
      }
      add(wrap, sourceDetails);
    }

    add(wrap, el('div', 'd', `installed skills · ${skills.length}`));
    if ((S.context || S.extensions) && !skills.length) add(wrap, renderNote(query
      ? 'No installed skill matches this search.'
      : 'No repository or global Agent Skill was found.'));
    const otherSkills = skills.filter((skill) => skill.selectableInThisRepository !== true);
    const otherSkillsGroup = el('details', 'fgcatalog-group');
    otherSkillsGroup.open = Boolean(query);
    add(otherSkillsGroup, el('summary', null, `Other local skills · ${otherSkills.length}`));
    for (const skill of skills) {
      const box = el('div', 'fgcatalog-row');
      const repositorySkill = repositorySkills.get(skill.id);
      const selectable = skill.selectableInThisRepository === true && !!repositorySkill;
      const head = el('div', 'acts');
      if (selectable) {
        const label = el('label');
        const check = el('input');
        check.type = 'checkbox';
        check.checked = S.skillIds.has(skill.id);
        check.disabled = S.running || S.contextBusy || !OWNER_TOKEN;
        check.addEventListener('change', () => setSkillSelected(skill.id, check.checked));
        add(label, check, document.createTextNode(` ${skill.name || skill.id}`));
        add(head, label);
      } else {
        add(head, el('b', null, skill.name || skill.id));
      }
      const status = skill.status === 'unreadable' ? 'unreadable' : (skill.verdict || skill.status || 'available');
      add(head, el('span', 'sp'), el('span', 'tag', `${status} · ${selectable ? 'repository' : 'read-only'}`));
      add(box, head);
      const metadata = el('details');
      add(metadata, el('summary', null, 'Description, source and screening'));
      if (skill.description) add(metadata, el('div', null, skill.description));
      add(metadata, el('div', 'hint', `${skill.provenance || 'unknown provenance'} · ${skill.status === 'unreadable' ? (skill.reason || 'reason unavailable') : status}`));
      add(metadata, el('div', 'hint', `Source: ${skill.sourcePath || context.dir || 'path unavailable'}`));
      const detail = repositorySkill || skill;
      for (const finding of Array.isArray(detail.findings) ? detail.findings : []) {
        add(metadata, el('div', 'hint', `${finding.severity}: ${finding.why || finding.rule}`));
      }
      if (Array.isArray(skill.permissions) && skill.permissions.length) {
        add(metadata, el('div', 'hint', `Permission: ${skill.permissions.join(', ')}. ${skill.authority || ''}`));
      }
      add(box, metadata);
      add(selectable ? wrap : otherSkillsGroup, box);
    }
    if (otherSkills.length) add(wrap, otherSkillsGroup);

    const builtins = allBuiltins
      .filter((entry) => catalogMatches(query, entry.id, entry.name, entry.kind, entry.status, entry.provenance));
    add(wrap, el('div', 'd', `bundled capabilities · ${builtins.length}`));
    for (const entry of builtins) {
      const detail = el('details', 'fgcatalog-row');
      add(detail, el('summary', null, `${entry.name || entry.id} · ${entry.status || 'status unavailable'}`));
      add(detail, el('div', 'hint', `${entry.provenance || 'source unavailable'} · ${entry.kind || 'capability'}`));
      add(wrap, detail);
    }
    for (const failure of Array.isArray(context.failed) ? context.failed : []) {
      add(wrap, renderNote(`Unreadable repository skill: ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`, 'rd'));
    }
    const limits = el('details', 'fgcatalog-row');
    add(limits, el('summary', null, 'Compatibility and capability boundaries'));
    if (catalog.note) add(limits, el('div', 'hint', catalog.note));
    add(limits, el('div', 'hint', 'VS Code Marketplace, VSIX packages and an external extension host are not supported by this build.'));
    add(wrap, limits);
    return wrap;
  }

  function lensPanel() {
    const session = activeSession();
    const wrap = el('div', 'pw');
    wrap.style.overflowWrap = 'anywhere';
    const heading = el('div', 'acts');
    add(heading, el('b', null, 'Exact run context'));
    const refresh = btn('btn sm ghost', S.contextBusy ? 'Reading…' : 'Refresh sources', () => void loadContext());
    refresh.disabled = S.contextBusy || session.running;
    add(heading, el('span', 'sp'), refresh);
    add(wrap, heading, el('div', 'hint',
      'Lens previews the exact sanitized, bounded prompt for this task. Browse and select installed capabilities in Rules & skills.'));
    if (S.contextBusy) add(wrap, renderNote('Refreshing repository context sources…'));
    if (S.contextErr) add(wrap, renderNote(`Context sources unavailable: ${S.contextErr}`, 'rd'));
    const memoryBox = el('div', 'box');
    const memoryLabel = el('label');
    const memorySwitch = el('input');
    memorySwitch.type = 'checkbox';
    memorySwitch.checked = session.memoryEnabled !== false;
    memorySwitch.disabled = session.running || session.routing || session.contextPreviewBusy || !OWNER_TOKEN;
    memorySwitch.addEventListener('change', () => {
      session.memoryEnabled = memorySwitch.checked;
      session.hostedConfirmation = null;
      invalidateRunContext(session);
      paintC();
      scheduleRunContext(session);
    });
    add(memoryLabel, memorySwitch, document.createTextNode(' Use durable Vault memory for this session'));
    add(memoryBox, memoryLabel, el('div', 'hint', session.memoryEnabled
      ? 'Enabled by default. Only records recalled as relevant to this task are sent; each stays a cited record with no authority.'
      : 'Disabled for this session. The Vault remains enabled, stored, searchable, and unchanged.'));
    add(wrap, memoryBox);

    const vault = el('details', 'box fgvault');
    const memories = S.memory
      ? (Array.isArray(S.memory.entries) ? S.memory.entries : Array.isArray(S.memory.notes) ? S.memory.notes : [])
      : [];
    add(vault, el('summary', null,
      S.memoryBusy ? 'Reading Vault memory…' : S.memoryErr ? 'Vault memory unavailable' : `${memories.length} Vault record${memories.length === 1 ? '' : 's'} across sessions`));
    if (S.memoryErr) add(vault, renderNote(S.memoryErr, 'rd'));
    if (!S.memory && !S.memoryBusy && !S.memoryErr) add(vault, el('div', 'hint', 'Open this section or refresh to read persistent cross-session memory.'));
    const vaultActions = el('div', 'acts');
    const vaultRefresh = btn('btn sm ghost', S.memoryBusy ? 'Reading…' : 'Refresh Vault', () => void loadMemory());
    vaultRefresh.disabled = S.memoryBusy;
    add(vaultActions, vaultRefresh);
    add(vault, vaultActions);
    for (const memory of memories.slice(0, 12)) {
      const item = el('details', 'fgmemory-row');
      add(item, el('summary', null, memory.description || memory.title || memory.id || 'Vault record'));
      add(item, el('div', 'hint', `${memory.kind || 'record'} · ${memory.source || 'source unavailable'} · ${memory.updatedAt || memory.createdAt || 'time unavailable'}`));
      add(item, el('div', null, memory.body || 'No body was returned.'));
      add(vault, item);
    }
    if (memories.length > 12) add(vault, el('div', 'hint', `Showing 12 of ${memories.length} records.`));
    add(vault, el('div', 'hint', 'Bulk import is unavailable because this daemon exposes no memory-import route. Individual owner-authored records use the existing governed Vault surface.'));
    vault.addEventListener('toggle', () => { if (vault.open && !S.memory && !S.memoryBusy) void loadMemory(); });
    add(wrap, vault);

    const context = S.context || {};
    const rules = Array.isArray(context.rules) ? context.rules : [];
    const selected = (Array.isArray(context.skills) ? context.skills : [])
      .filter((skill) => S.skillIds.has(skill.id));
    const sourceSummary = el('div', 'box');
    add(sourceSummary, el('b', null, 'Included repository context'));
    add(sourceSummary, el('div', null,
      `${rules.length} rule file${rules.length === 1 ? '' : 's'} · ${selected.length} selected skill${selected.length === 1 ? '' : 's'}`));
    add(sourceSummary, el('div', 'hint', selected.length
      ? `Skills: ${selected.map((skill) => skill.name || skill.id).join(', ')}`
      : 'No repository skill is selected for this run.'));
    const manage = btn('btn sm ghost', 'Manage rules & skills', openSkillsCatalog);
    add(sourceSummary, manage);
    add(wrap, sourceSummary);

    const previewTask = nextContextTask(session);
    if (!previewTask) {
      add(wrap, renderNote('Type a task below. Forge Lens will then assemble and show the exact sanitized, bounded prompt before the run starts.'));
      return wrap;
    }
    const expectedKey = forgeContextKey(previewTask, session.memoryEnabled, [...S.skillIds]);
    const exact = session.contextPreview && session.contextPreviewKey === expectedKey
      ? session.contextPreview
      : null;
    const exactRefresh = btn('btn sm', session.contextPreviewBusy ? 'Preparing…' : 'Refresh exact context', () => void loadRunContext(session, previewTask, true));
    exactRefresh.disabled = session.contextPreviewBusy || session.running || session.routing;
    add(wrap, exactRefresh);
    if (session.contextPreviewBusy) add(wrap, renderNote('Retrieving task-relevant Vault records and bounding the complete prompt…'));
    if (session.contextPreviewErr) add(wrap, renderNote(`Exact context unavailable: ${session.contextPreviewErr}`, 'rd'));
    if (!exact && !session.contextPreviewBusy && !session.contextPreviewErr) {
      add(wrap, renderNote('Preparing the exact context for this task…'));
      queueMicrotask(() => void loadRunContext(session, previewTask));
      return wrap;
    }
    if (!exact) return wrap;

    const recalled = exact.memory && Array.isArray(exact.memory.entries) ? exact.memory.entries : [];
    add(wrap, el('div', 'hint', exact.memory && exact.memory.note ? exact.memory.note : 'Memory state unavailable.'));
    if (exact.contextFile) {
      add(wrap, el('div', 'hint', `Standing context: ${exact.contextFile.path} · ${bytesLabel(exact.contextFile.bytes)}${exact.contextFile.truncated ? ' · truncated' : ''}`));
    } else {
      add(wrap, el('div', 'hint', 'Standing context: no ZENO.md in this repository.'));
    }
    if (session.memoryEnabled && recalled.length === 0) add(wrap, renderNote('No Vault record matched this task, so none will be sent.'));
    for (const record of recalled) {
      const detail = el('details', 'box');
      add(detail, el('summary', null, `${record.description || '(untitled)'} · ${record.citation || 'citation unavailable'}`));
      const meta = el('dl', 'kv');
      kvAdd(meta, 'kind', record.kind);
      kvAdd(meta, 'source', record.source);
      kvAdd(meta, 'citation', record.citation);
      kvAdd(meta, 'matched', Array.isArray(record.matched) ? record.matched.join(', ') : '—');
      add(detail, meta, el('pre', null, record.body || ''));
      add(wrap, detail);
    }
    if (exact.sanitization && exact.sanitization.redacted > 0) {
      add(wrap, renderNote(`${exact.sanitization.redacted} sensitive value${exact.sanitization.redacted === 1 ? '' : 's'} redacted before this context can reach a model.`, 'cy'));
    }
    const promptDetail = el('details', 'box');
    promptDetail.open = false;
    add(promptDetail, el('summary', null,
      `Exact bounded prompt · ${exact.characters || 0}/${exact.limit || 0} characters · sha256 ${short(exact.hash, 18)}`));
    const prompt = el('pre', null, exact.prompt || '');
    prompt.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;user-select:text';
    add(promptDetail, prompt);
    add(wrap, promptDetail);
    return wrap;
  }

  async function loadContext() {
    if (S.contextBusy) return;
    S.contextBusy = true; S.contextErr = null;
    paintA(); paintC();
    const result = await api('/skills');
    S.contextBusy = false;
    if (!result.ok) { S.contextErr = errText(result); S.context = null; S.skillIds.clear(); }
    else {
      S.context = result.data || {};
      const available = new Set((S.context.skills || []).map((skill) => skill.id));
      S.skillIds = new Set([...S.skillIds].filter((id) => available.has(id)));
    }
    // A refresh may have changed rule or skill bytes even when the selected ids
    // stayed the same. Their previous hash is no longer a truthful preflight.
    for (const session of S.sessions) invalidateRunContext(session);
    paintA(); paintC();
  }

  async function loadMemory() {
    if (S.memoryBusy) return;
    S.memoryBusy = true; S.memoryErr = null;
    paintC();
    const result = await api('/memory');
    S.memoryBusy = false;
    if (!result.ok) { S.memory = null; S.memoryErr = `Vault memory could not be read: ${errText(result)}`; }
    else { S.memory = result.data || { notes: [] }; S.memoryErr = null; }
    paintC();
  }

  async function loadTests() {
    if (S.testsBusy) return;
    S.testsBusy = true; S.testsErr = null;
    paintA(); paintD();
    const result = await api('/forge/tests');
    S.testsBusy = false;
    if (!result.ok) { S.tests = null; S.testsErr = errText(result); }
    else S.tests = result.data || { scripts: [] };
    paintA(); paintD();
  }

  async function runTest(script) {
    if (!OWNER_TOKEN || S.testRunId || !script || !script.id) return;
    S.testRunId = script.id;
    S.testsErr = null;
    paintA(); paintD();
    const result = await api('/forge/tests/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: script.id }),
    });
    S.testRunId = '';
    if (!result.ok) S.testsErr = `Test request failed: ${errText(result)}`;
    else S.testResults.set(script.id, result.data);
    paintA(); paintD();
    await Promise.all([loadStatus(), rereadOpenFile(), loadContext()]);
  }

  async function loadExtensions() {
    if (S.extensionsBusy) return;
    S.extensionsBusy = true; S.extensionsErr = null;
    paintA(); paintC();
    const result = await api('/forge/extensions');
    S.extensionsBusy = false;
    if (!result.ok) { S.extensions = null; S.extensionsErr = errText(result); }
    else S.extensions = result.data || {};
    paintA(); paintC();
  }

  async function loadConnectors() {
    if (S.connectorsBusy) return;
    S.connectorsBusy = true; S.connectorsErr = null;
    paintA();
    const result = await api('/forge/connectors');
    S.connectorsBusy = false;
    if (!result.ok) { S.connectors = null; S.connectorsErr = errText(result); }
    else S.connectors = result.data || {};
    paintA();
  }

  async function runTerminal() {
    const terminal = activeTerminal();
    if (!OWNER_TOKEN || S.terminalBusy || S.choosing || !terminal.draft.trim()) return;
    S.terminalCommand = terminal.draft.trim();
    S.terminalBusy = true; S.terminalErr = null; S.terminalResult = null;
    const started = Date.now();
    paintD(); paintA();
    const result = await api('/forge/terminal', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: S.terminalCommand }),
    });
    S.terminalBusy = false;
    if (!result.ok) S.terminalErr = `Command request failed: ${errText(result)}`;
    else {
      S.terminalResult = result.data;
      terminal.history.push({
        command: S.terminalCommand,
        durationMs: Math.max(0, Date.now() - started),
        ...result.data,
      });
      if (terminal.history.length > 40) terminal.history.splice(0, terminal.history.length - 40);
      terminal.draft = '';
    }
    paintD(); paintA();
    await Promise.all([loadStatus(), rereadOpenFile(), loadContext()]);
  }

  async function chooseFolder() {
    if (S.choosing || anySessionRunning() || S.terminalBusy || !!S.testRunId || S.saving) return;
    if (!window.zenoProject || typeof window.zenoProject.choose !== 'function') {
      S.folderNote = 'Folder selection is available in the Zeno desktop app.'; paintA(); return;
    }
    if (dirtyPaths.size && !window.confirm('Open another folder and discard unsaved editor changes?')) return;
    S.choosing = true; S.folderNote = ''; paintA();
    try {
      const result = await window.zenoProject.choose();
      if (result && result.ok) { section.replaceChildren(renderNote(`Switching to ${result.path || 'the selected folder'}…`)); return; }
      S.folderNote = result && result.canceled ? 'Folder selection canceled.' : (result && result.error ? String(result.error) : 'The folder could not be opened.');
    } catch (error) { S.folderNote = `The folder could not be opened: ${error.message || error}`; }
    S.choosing = false; paintA();
  }

  async function loadStatus() {
    const r = await api('/forge/status');
    if (!r.ok) {
      S.status = null;
      S.statusErr = errText(r);
    } else {
      S.status = r.data;
      S.statusErr = null;
      restoreEditorLayout();
    }
    paintA();
    paintB();
    paintTop();
    paintE();
  }

  /**
   * The rgA head button. It is labelled "reload", so it must re-read everything
   * the screen claims to be showing — not the tree alone.
   *
   * It used to call loadStatus() and nothing else. With a file open that was
   * worse than a no-op: the tree came back correctly marking that file CHANGED
   * while the pane beside it went on showing the copy read minutes earlier, so
   * the one control whose job is freshness left two halves of the same screen
   * disagreeing about the same file. It now re-reads the open file as well.
   */
  async function reloadRepo() {
    if (S.reloading) return;
    S.reloading = true;
    paintA();
    try {
      await Promise.all([
        loadStatus(), loadAgents(), rereadOpenFile(), loadContext(),
        ...(S.tests ? [loadTests()] : []),
        ...(S.extensions ? [loadExtensions()] : []),
        ...(S.connectors ? [loadConnectors()] : []),
      ]);
    } finally {
      S.reloading = false;
      S.readAt = new Date();
      paintA();
    }
  }

  /**
   * Re-read the file already in the code pane. What is on screen (and the caret)
   * stays put until the new contents land, so a reload does not blink the pane
   * empty the way opening a file does — this is a refresh, not an open.
   */
  async function rereadOpenFile(discardEdits) {
    const path = S.file;
    return path ? rereadPath(path, discardEdits) : undefined;
  }

  async function rereadPath(path, discardEdits) {
    if (!path) return;
    // A re-read never throws away unsaved edits on its own — modelFor guards
    // them. `discardEdits` is the one case where that guard is deliberately
    // lifted: the owner asked to revert, or their edit just landed on disk.
    if (discardEdits === true) dirtyPaths.delete(path);
    const record = recordFor(path);
    const request = ++record.request;
    record.busy = true;
    const r = await api(`/forge/file?path=${encodeURIComponent(path)}`);
    if (record.request !== request) return;
    record.busy = false;
    if (!r.ok) {
      record.data = null;
      record.error = `${path} could not be read: ${errText(r)}`;
    } else {
      record.data = r.data;
      record.error = null;
    }
    paintB();
    paintE();
  }

  async function loadAgents() {
    const r = await api('/forge/agents');
    if (!r.ok) {
      S.agents = null;
      S.agentsErr = errText(r);
    } else {
      S.agents = r.data;
      S.agentsErr = null;
      const list = (r.data && r.data.agents) || [];
      const efforts = (r.data && r.data.efforts) || [];
      const available = firstAvailableProvider();
      for (const session of S.sessions) {
        if (session.running || session.routing) continue;
        const selected = list.find((a) => a && a.id === session.agentId);
        if ((!selected || selected.available === false) && available) {
          session.agentId = available.id;
          session.model = '';
          session.hostedConfirmation = null;
          session.route = {
            rationale: `${available.label || available.id} selected because the previous provider is not runnable on this machine.`,
          };
        }
        if (efforts.length && !efforts.includes(session.effort)) session.effort = efforts[0];
      }
    }
    paintC();
    paintE();
  }

  /**
   * Open one sandbox file in the code pane, from GET /forge/file. `line` is
   * optional and 1-based: a search hit passes the line it was found on, so the
   * pane lands on it rather than at the top of a two-thousand-line file.
   */
  async function openFile(path, line, paneIndex = S.focusedGroup) {
    if (!path) return;
    const at = Number(line);
    const index = paneIndex === 1 && S.splitEditor ? 1 : 0;
    const target = group(index);
    focusEditorGroup(index, false);
    target.file = path;
    if (!target.tabs.includes(path)) target.tabs.push(path);
    target.caret = Number.isInteger(at) && at > 0 ? at : 0;
    const record = recordFor(path);
    const request = ++record.request;
    record.busy = record.data === null;
    record.error = null;
    persistEditorLayout();
    paintA();
    paintB();
    paintE();

    if (record.data !== null) {
      revealCaret(index);
      return;
    }
    const r = await api(`/forge/file?path=${encodeURIComponent(path)}`);
    if (record.request !== request) return;
    record.busy = false;
    if (!r.ok) {
      record.data = null;
      record.error = `${path} could not be read: ${errText(r)}`;
    } else {
      record.data = r.data;
      record.error = null;
    }
    paintB();
    paintE();
    revealCaret(index);
  }

  /**
   * Scroll the code pane to the caret line, if there is one on screen.
   *
   * The line may genuinely not be there: /forge/file caps a long file, so a hit
   * past the cap has no row. In that case the pane is scrolled to the bottom,
   * where the cap's own "file continues — N lines in total" row is — which says
   * why the line is not shown instead of silently doing nothing.
   */
  function revealCaret(paneIndex = S.focusedGroup) {
    const target = group(paneIndex);
    const view = paneViews[paneIndex];
    if (!target.caret) return;
    if (view.editor && view.editor.getModel()) {
      view.editor.setPosition({ lineNumber: target.caret, column: 1 });
      view.editor.revealLineInCenter(target.caret);
      return;
    }
    const code = view.aux.querySelector('.code');
    if (!code) return;
    const row = code.querySelector(`.row[data-line="${target.caret}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
    else if (recordFor(target.file)?.data?.truncated) code.scrollTop = code.scrollHeight;
  }

  async function resolveRoute(session, task) {
    if (!session.autoRoute) {
      const available = !S.agents || providerAvailable(session.agentId);
      const route = {
        automatic: false,
        agentId: session.agentId,
        model: session.model,
        effort: session.effort,
        blocked: !available,
        rationale: available
          ? 'Manual routing was used because automatic routing is off for this session.'
          : (provider(session.agentId)?.unavailableReason || 'The selected provider is unavailable on this machine.'),
      };
      session.route = route;
      return route;
    }
    const response = await api('/forge/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    if (!response.ok || !response.data || !response.data.route) {
      const route = {
        automatic: false,
        agentId: session.agentId,
        model: session.model,
        effort: session.effort,
        rationale: `Automatic routing was unavailable (${errText(response)}). Forge kept the visible picker values for this run.`,
      };
      session.route = route;
      return route;
    }
    const chosen = response.data.route;
    const agents = (S.agents && S.agents.agents) || [];
    const agent = agents.find((candidate) => candidate.id === chosen.agentId);
    const efforts = (S.agents && S.agents.efforts) || [];
    if (!agent || !efforts.includes(chosen.effort)) {
      const route = {
        automatic: false,
        agentId: session.agentId,
        model: session.model,
        effort: session.effort,
        rationale: 'The automatic router returned a choice this Forge build does not expose. The visible picker values were kept.',
      };
      session.route = route;
      return route;
    }
    if (chosen.runnable === false) {
      const route = {
        automatic: true,
        agentId: chosen.agentId,
        model: typeof chosen.model === 'string' ? chosen.model : '',
        effort: chosen.effort,
        kind: chosen.kind || 'general',
        blocked: true,
        rationale: String(chosen.rationale || 'No safe provider is available for this task.'),
      };
      session.route = route;
      return route;
    }
    if (agent.available === false) {
      const localOnly = chosen.kind === 'private-local';
      const order = chosen.kind === 'architecture'
        ? ['codex', 'local', 'claude-code']
        : chosen.kind === 'frontend'
          ? ['local', 'claude-code', 'codex']
          : ['local', 'codex', 'claude-code'];
      const fallback = localOnly ? null : order.map((id) => agents.find((item) => item.id === id && item.available !== false)).find(Boolean);
      if (!fallback) {
        const route = {
          automatic: true,
          agentId: chosen.agentId,
          model: typeof chosen.model === 'string' ? chosen.model : '',
          effort: chosen.effort,
          kind: chosen.kind || 'general',
          blocked: true,
          rationale: localOnly
            ? 'This task names sensitive data, but no local Ollama model is available. Forge will not send it to a hosted provider.'
            : 'No coding provider is currently runnable on this machine.',
        };
        session.route = route;
        return route;
      }
      const models = fallback.id === 'local' ? ((S.agents && S.agents.localModels) || []) : (fallback.models || []);
      const route = {
        automatic: true,
        agentId: fallback.id,
        model: models[0] || '',
        effort: chosen.effort,
        kind: chosen.kind || 'general',
        rationale: `${fallback.label || fallback.id} selected because ${agent.label || agent.id} is unavailable on this machine.`,
      };
      session.agentId = route.agentId;
      session.model = route.model;
      session.effort = route.effort;
      session.route = route;
      return route;
    }
    const route = {
      automatic: true,
      agentId: chosen.agentId,
      model: typeof chosen.model === 'string' ? chosen.model : '',
      effort: chosen.effort,
      kind: chosen.kind || 'general',
      rationale: String(chosen.rationale || 'Automatic routing selected this provider, model, and effort.'),
    };
    session.agentId = route.agentId;
    session.model = route.model;
    session.effort = route.effort;
    session.route = route;
    return route;
  }

  /** POST /forge/run — the agent proposes; nothing here applies anything. */
  async function doRun(runSession = activeSession()) {
    if (!canRun(runSession)) return;
    const task = runSession.draft.trim();
    runSession.routing = true;
    paintC();
    const preparedContext = await loadRunContext(runSession, task);
    if (!preparedContext) {
      runSession.routing = false;
      runSession.route = {
        blocked: true,
        rationale: `Forge did not start because its exact context could not be prepared.${runSession.contextPreviewErr ? ' ' + runSession.contextPreviewErr : ''}`,
      };
      paintC();
      paintE();
      return;
    }
    const route = await resolveRoute(runSession, task);
    runSession.routing = false;
    if (route.blocked) {
      runSession.route = route;
      paintC();
      paintE();
      return;
    }
    const chosen = provider(route.agentId);
    if ((chosen && chosen.hosted === true) || route.agentId === 'claude-code' || route.agentId === 'codex') {
      // Consent is bound to the exact task and resolved route. Editing either
      // clears it, and every later hosted run asks again.
      runSession.hostedConfirmation = { task, route };
      paintC();
      paintE();
      return;
    }
    await runResolved(runSession, task, route, false);
  }

  async function runHosted(runSession) {
    const pending = runSession.hostedConfirmation;
    if (!pending || runSession.running || runSession.routing || anotherHostedRunIsActive(runSession)) return;
    runSession.hostedConfirmation = null;
    await runResolved(runSession, pending.task, pending.route, true);
  }

  /** Ask the daemon to stop this exact process tree. The running card stays
   * visible until the original /forge/run request reports what the stopped run
   * actually left behind; accepting a cancel request is not the run outcome. */
  async function cancelRun(runSession) {
    if (!runSession.running || !runSession.runId || runSession.canceling) return;
    const runId = runSession.runId;
    runSession.canceling = true;
    runSession.cancelNote = 'Stopping the agent process and its descendants…';
    paintC();
    const r = await api('/forge/run/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    // The original request may have settled while this small request was in
    // flight. Never let an old cancellation repaint a later run.
    if (runSession.runId !== runId) return;
    if (!r.ok) {
      runSession.canceling = false;
      runSession.cancelNote = `The cancellation request failed: ${errText(r)}`;
      paintC();
      return;
    }
    runSession.cancelNote = r.data && r.data.cancelled === false
      ? String(r.data.note || 'The run already finished; waiting for its result.')
      : 'Cancellation accepted. Waiting for the stopped run and any partial files it left for review.';
    // Keep canceling=true until /forge/run settles. That is the only response
    // that can truthfully say the process stopped and enumerate partial files.
    paintC();
  }

  async function runResolved(runSession, task, route, hostedConfirmed) {
    if (!runSession.chat.length && !runSession.runs.length) runSession.name = short(task, 26);
    runSession.chat.push({ who: 'you', text: task, at: new Date(), route });
    runSession.running = true;
    runSession.canceling = false;
    runSession.cancelNote = null;
    runSession.hostedRun = hostedConfirmed;
    runSession.runId = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? `ui-${globalThis.crypto.randomUUID()}`
      : `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    runSession.runAt = new Date();
    runSession.runProgress = initialRunProgress(runSession.runId, route.agentId, route.model || '');
    runSession.runProgressStale = false;
    runSession.draft = '';
    S.insp = 'chat';
    paintC();
    paintE();
    startRunClock();

    const selectedSkillIds = [...S.skillIds];
    const body = {
      ...forgeContextBody(task, runSession.memoryEnabled, selectedSkillIds),
      agentId: route.agentId,
      runId: runSession.runId,
    };
    if (runSession.contextPreview && runSession.contextPreview.hash) body.contextHash = runSession.contextPreview.hash;
    if (route.model) body.model = route.model;
    if (route.effort) body.effort = route.effort;
    if (hostedConfirmed) body.hostedConfirmed = true;
    const r = await api('/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    runSession.running = false;
    runSession.canceling = false;
    runSession.cancelNote = null;
    runSession.hostedRun = false;
    runSession.runId = null;
    runSession.runAt = null;
    runSession.runProgress = null;
    // This POST response is authoritative for the completed run and reconciles
    // any bounded-stream replay gap that happened while it was in flight.
    runSession.runProgressStale = false;
    stopRunClock();

    if (!r.ok) {
      if (r.error && r.error.code === 'context-changed') {
        // The hash did its job: nothing was sent. Require a fresh Lens preview
        // before the next click rather than retrying against unseen context.
        invalidateRunContext(runSession);
      }
      // A failed request is not an agent turn. It is reported as what it is.
      const started = r.error && r.error.code === 'run-failed-after-start';
      runSession.chat.push({
        who: 'agent', at: new Date(), agentId: route.agentId, model: route.model, effort: route.effort,
        files: [], waiting: 0, applied: 0, log: '',
        note: started ? errText(r) : `The run did not start: ${errText(r)}`,
        ...(started ? { tokenUsage: finalTokenUsage(route.agentId, null, null) } : {}),
      });
      runSession.runs.push({
        at: new Date(), task, ok: false, agentId: route.agentId, model: route.model, effort: route.effort,
        automatic: route.automatic, routeRationale: route.rationale,
        files: 0, waiting: 0, applied: 0, note: errText(r),
      });
      paintC();
      paintE();
      return;
    }

    const d = r.data || {};
    const run = d.run || {};
    if (d.context && typeof d.context === 'object') {
      runSession.contextPreview = d.context;
      runSession.contextPreviewKey = forgeContextKey(task, runSession.memoryEnabled, selectedSkillIds);
      runSession.contextPreviewTask = task;
    }
    const proposed = Array.isArray(d.proposed) ? d.proposed : [];
    const changed = Array.isArray(d.changed) ? d.changed : [];
    const skipped = Array.isArray(d.skipped) ? d.skipped : [];
    const tokenUsage = finalTokenUsage(
      run.agentId || route.agentId,
      run.tokensIn,
      run.tokensOut,
    );

    // The tool rows: the files the run really wrote. The line count comes from
    // the run's own output where the harness emitted it, and is simply absent
    // where it did not — an absent number is shown as an absent number.
    const emitted = parseEmittedLines(run.log);
    const byPath = new Map(proposed.map((p) => [p.path, p]));
    const skippedByPath = new Map(skipped.map((item) => [item.path, item]));
    const files = changed.map((path) => ({
      path,
      lines: emitted.get(path) || 0,
      tier: (byPath.get(path) || {}).tier || '',
      skipped: skippedByPath.get(path) || null,
    }));

    // `auto:true` means the kernel already committed and receipted that write —
    // it is NOT waiting on Command. Split here, once, so every panel that talks
    // about this run is talking about the same two numbers.
    const applied = proposed.filter((p) => p && p.auto).length;
    const waiting = proposed.length - applied;

    runSession.proposals = proposed;
    runSession.chat.push({
      who: 'agent',
      at: new Date(),
      agentId: run.agentId || route.agentId,
      model: run.model || route.model,
      effort: run.effort || route.effort,
      files,
      waiting,
      applied,
      log: typeof run.log === 'string' ? run.log : '',
      cancelled: run.cancelled === true,
      tokenUsage,
      // run.ok:false is a plain statement, never dressed up as a partial success.
      note: run.ok === false ? (run.note || 'The agent did not complete this task.') : (run.note || ''),
    });
    runSession.runs.push({
      at: new Date(), task, ok: run.ok === true,
      agentId: run.agentId || route.agentId, model: run.model || route.model, effort: run.effort || route.effort,
      automatic: route.automatic, routeRationale: route.rationale,
      files: changed.length, waiting, applied,
      cancelled: run.cancelled === true,
      tokenUsage,
      note: run.ok === false ? (run.note || '') : '',
    });

    paintC();
    void loadStatus();
    // Whatever the run left waiting is now a real capsule on the daemon. Ask
    // for it by its payload rather than drawing one from the run's summary —
    // a capsule the owner cannot re-hash is a capsule they cannot approve.
    void syncGates();
    // The file on screen may be one the run touched; re-read it rather than
    // leaving stale bytes under a fresh status bar.
    if (S.file) void openFile(S.file);
  }

  /**
   * The agent emits files as `===FILE: path ===` … `===END===` blocks. Where
   * that is what came back, the block's real line count is a real number we can
   * show; where the agent used some other shape, the map is simply empty.
   */
  function parseEmittedLines(log) {
    const out = new Map();
    if (typeof log !== 'string' || log === '') return out;
    const re = /===FILE:[ \t]*([^\r\n]*?\S)[ \t]*===\r?\n([\s\S]*?)\r?\n===END===/g;
    let m;
    while ((m = re.exec(log)) !== null) {
      out.set(m[1].trim(), m[2].split(/\r?\n/).length);
    }
    return out;
  }

  /** POST /forge/commit — the one write Forge lands, sealed from its receipt. */
  async function doCommit() {
    if (!canCommit()) return;
    S.committing = true;
    S.commitErr = null;
    S.receipt = null;
    paintA();

    const r = await api('/forge/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: S.commitMsg.trim() }),
    });
    S.committing = false;

    if (!r.ok) {
      S.commitErr = `The commit did not land${r.status ? ` (${r.status})` : ''}: ${errText(r)}`;
      paintA();
      return;
    }
    const receipt = r.data && r.data.receipt;
    if (!receipt || typeof receipt !== 'object') {
      // A 200 with no receipt proves nothing. No seal is drawn.
      S.commitErr = 'The daemon answered without a receipt, so whether the commit landed cannot be shown. Reload the repository to check.';
      paintA();
      return;
    }
    S.receipt = receipt;
    S.commitMsg = '';
    paintA();
    void loadStatus();
  }

  /**
   * The receipt. This is the ONE place a green, verified state is drawn on this
   * surface, and it is drawn from the receipt in hand — never from the click,
   * and never from a run's `ok`.
   */
  function renderReceipt(receipt) {
    const box = el('div', 'box');
    const verified = receipt.outcome === 'verified';
    const seal = el('span', 'state');
    seal.dataset.state = verified ? 'verified' : String(receipt.outcome || 'outcome-unknown');
    // tokens.css draws the seal ONLY for a verified state that also carries a
    // receipt id. There is no way to produce this attribute from a click.
    if (receipt.id) seal.dataset.receipt = String(receipt.id);
    add(seal, glyph('', 'state__glyph'));
    add(seal, el('span', 'state__label', verified ? `Verified · ${clock(receipt.at)}` : ''));
    const head = el('b');
    add(head, seal);
    add(box, head);

    if (!verified) {
      add(box, renderNote(
        receipt.outcome === 'refused'
          ? 'The base drifted between the preview and the commit, so the kernel refused it and nothing was applied. Reload and commit again against what is actually there.'
          : `The commit did not verify (${String(receipt.outcome || 'unknown outcome')}).${receipt.reason ? ' ' + receipt.reason : ''}`,
        receipt.outcome === 'refused' || receipt.outcome === 'denied' ? 'rd' : '',
      ));
    }

    const kv = el('dl', 'kv');
    kvAdd(kv, 'receipt id', receipt.id);
    kvAdd(kv, 'self hash', short(receipt.selfHash, 24));
    kvAdd(kv, 'prev receipt', receipt.prevReceipt ?? 'null · genesis entry');
    kvAdd(kv, 'policy hash', short(receipt.policyHash, 24));
    if (receipt.externalEffect && receipt.externalEffect.effect) kvAdd(kv, 'external effect', receipt.externalEffect.effect);
    add(box, kv);

    if (verified) {
      const acts = el('div', 'acts');
      const go = btn('btn sm', 'See it in Command');
      go.setAttribute('data-go', 'command');
      add(acts, go);
      add(box, acts);
    }
    return box;
  }

  /* ================================================================ *
   * 3b · the gate, made visible: inline capsules and the two views    *
   * ================================================================ *
   * THIS IS THE PAYOFF OF THE WHOLE PRODUCT, so it is worth saying what
   * it is and what it is not.
   *
   * A capsule is not re-implemented here. `/capsule.js` is the component
   * Command already uses — the one that re-hashes the binding in front of
   * the owner, refuses to enable Approve when a field is unresolved,
   * spends its Approve control after exactly one click, and draws a green
   * seal only from a receipt whose outcome is 'verified'. Forge renders
   * THAT component, with the same payload and the same /approvals
   * endpoint. There is no second, friendlier approval path.
   *
   * WHERE THE CAPSULES COME FROM. Always GET /state, never a local guess:
   * `pending` there carries each held preview WITH its exact payload,
   * which is the only form a capsule can verify. A run's response and a
   * save's response name an actionHash; /state is what turns that name
   * into something the owner can check. So every capsule on this surface
   * is one the daemon is really holding, and every capsule the daemon is
   * really holding is on this surface — including ones raised by
   * something other than Forge, which are labelled as what they are
   * rather than filtered out.
   *
   * WHY A LIVE STREAM. A run that proposes at the END could be handled by
   * polling once when it returns. A run that has to ASK MID-FLIGHT
   * cannot: "may I run this command?" is a capsule that appears while the
   * POST is still open, and an owner who has to wait for the run to
   * finish before seeing it is not being asked, they are being told. So
   * this subscribes to /stream and renders each `preview` the instant it
   * is published. The kernel already has `shell.exec` and `net.fetch`
   * action kinds; the moment the Forge agent proposes one, it arrives
   * here through this same path and renders through the same capsule,
   * with its own kind, tier and payload. NOTHING IS STUBBED FOR IT: there
   * is no placeholder tool-call UI and no sample command in this file.
   * The seam is that the capsule is kind-agnostic, which is a property of
   * the component, not a promise made here.
   */

  const VIEW_KEY = 'zeno.forge.view';

  /** The current capsule node and preview for each held action hash. */
  const gateNodes = new Map();
  const gatePreviews = new Map();
  /** Hashes whose receipt has already been applied — applyReceipt is not idempotent. */
  const receiptApplied = new Set();

  /**
   * Reconcile the session's capsules with what the daemon is actually holding.
   *
   * Adds a capsule for every held preview that has none yet, and settles every
   * capsule that has left the held set: from its receipt when there is one, and
   * as a plain "decided elsewhere" line when there is not. It never invents an
   * outcome, and it never removes a capsule from the thread — a decision that
   * was made is part of the session's history.
   */
  async function syncGates() {
    if (!OWNER_TOKEN) return;
    const r = await api('/state');
    if (!r.ok) {
      S.gatesErr = errText(r);
      paintC();
      return;
    }
    S.gatesErr = null;
    const pending = Array.isArray(r.data && r.data.pending) ? r.data.pending : [];
    const receipts = Array.isArray(r.data && r.data.receipts) ? r.data.receipts : [];
    const live = new Set();

    for (const p of pending) {
      const hash = p && typeof p.actionHash === 'string' ? p.actionHash : null;
      if (!hash) continue;
      live.add(hash);
      const previous = gatePreviews.get(hash);
      if (gateNodes.has(hash) && !pendingCapsuleNeedsRefresh(previous, p)) continue;
      // The payload travels with the preview precisely so the capsule can
      // re-hash it. Passing it is what makes Approve reachable at all.
      const node = renderCapsule(p, {
        payload: p.payload,
        review: p.review,
        ownerToken: OWNER_TOKEN,
        endpoint: '/approvals',
      });
      const oldNode = gateNodes.get(hash);
      oldNode?.destroy?.();
      gateNodes.set(hash, node);
      gatePreviews.set(hash, p);
      const oldGate = S.gates.find((g) => g.hash === hash && !g.settled);
      if (oldGate) {
        // Same action, fresher observed review. `paintC()` below reattaches this
        // node in the existing timeline position, so drift disables approval
        // before the owner can click. Receipt events also resolve through the
        // current gateNodes entry and therefore stay wired to this replacement.
        oldGate.tier = p.tier;
        oldGate.kind = (p.binding && p.binding.kind) || 'unknown-kind';
        oldGate.summary = p.summary || '';
        continue;
      }
      S.gates.push({
        hash,
        at: new Date(),
        tier: p.tier,
        kind: (p.binding && p.binding.kind) || 'unknown-kind',
        summary: p.summary || '',
        settled: false,
        outcome: null,
      });
    }

    for (const g of S.gates) {
      if (g.settled || live.has(g.hash)) continue;
      g.settled = true;
      const rc = receipts.find((x) => x && x.actionHash === g.hash) || null;
      g.outcome = rc ? String(rc.outcome || 'outcome unknown') : null;
      const node = gateNodes.get(g.hash);
      if (rc && node && typeof node.applyReceipt === 'function' && !receiptApplied.has(g.hash)) {
        receiptApplied.add(g.hash);
        node.applyReceipt(rc);
      }
    }
    paintC();
  }

  /** How many capsules on this surface are still owed a decision. */
  function gatesWaiting() {
    return S.gates.filter((g) => !g.settled).length;
  }

  /**
   * One capsule in the thread, with a line above it saying where it came from
   * and when. The capsule itself is the component from /capsule.js, retained
   * across ordinary repaints and replaced only when `/state` refreshes its bound
   * review. A settled node is never rebuilt, so a spent control stays spent.
   */
  function gateBlock(g) {
    const box = el('div', 'fgate');
    box.dataset.settled = g.settled ? '1' : '0';
    const head = el('div', 'fghead');
    add(head, glyph('◈', 'fgglyph'));
    add(head, el('span', 'fgwho', g.settled ? 'decided' : 'the kernel is asking'));
    add(head, el('span', 'fgkind', `${g.kind} · ${g.tier}`));
    add(head, el('span', 'sp'));
    // WHEN THIS WINDOW FIRST SAW IT, and it is labelled as that rather than as
    // "when it was proposed". /state's held previews carry no timestamp, so for
    // a capsule that was already waiting when this page loaded the only honest
    // reading is the moment it arrived here.
    const at = el('span', 'fgat', clock(g.at));
    at.title = 'When this window first saw this capsule. A held preview carries no timestamp of its own, so this is not necessarily when it was proposed.';
    add(head, at);
    add(box, head);
    /* A TOOL CALL IS NOT A FILE WRITE, and the difference is worth one line.
       `shell.exec` and `net.fetch` are the two kinds the kernel gates as an
       effect on this machine rather than a change to a file, and the daemon
       holds the agent's call open while the capsule is on screen: the run is
       stopped, not queued. Saying so is the difference between the owner
       reading at their own pace and the owner not knowing anyone is waiting.
       The lapse rule is the daemon's own and is stated as it is written there:
       an unanswered call is refused, never assumed. */
    if (!g.settled && (g.kind === 'shell.exec' || g.kind === 'net.fetch')) {
      add(box, renderNote(
        'This is a tool call, not a file change: the run that asked is blocked on it right now. ' +
        'Nothing happens until you approve — and if the call goes unanswered long enough it lapses, ' +
        'which the daemon treats as a refusal. Silence is never taken for agreement.',
      ));
    }
    const node = gateNodes.get(g.hash);
    if (node) add(box, node);
    if (g.settled && g.outcome === null) {
      add(box, renderNote(
        'This action is no longer held by the daemon and there is no receipt for it in the ledger. ' +
        'It was decided somewhere else, or it lapsed unanswered — either way nothing was applied ' +
        'on the strength of it, and nothing here can say which of the two it was.',
      ));
    }
    return box;
  }

  /* ---- the live subscription -------------------------------------------- *
   * A second reader on /stream, beside the one Command holds. It is a plain
   * EventSource rather than app.js's authenticated fetch reader, and that is a
   * deliberate, smaller contract: it cannot send a Last-Event-Id header, so it
   * cannot do gap accounting — and it does not need to, because it never uses
   * the event's CONTENTS as state. Every event means the same thing here: "ask
   * /state again". The daemon is the record; this is only a doorbell.
   *
   * It authenticates on the owner cookie, which is same-origin and rides along
   * automatically. A window with no owner token never opens it — an endlessly
   * retrying 401 is worse than no stream. */
  function openStream() {
    if (!OWNER_TOKEN || typeof EventSource !== 'function') return;
    let es;
    try {
      es = new EventSource('/stream');
    } catch {
      return;
    }
    const ring = () => { void syncGates(); };
    es.addEventListener('preview', ring);
    es.addEventListener('gap', ring);
    es.addEventListener('chain', ring);
    es.addEventListener('receipt', (ev) => {
      let rc = null;
      try {
        rc = JSON.parse(ev.data);
      } catch {
        rc = null;
      }
      if (rc && typeof rc.actionHash === 'string' && !receiptApplied.has(rc.actionHash)) {
        const node = gateNodes.get(rc.actionHash);
        if (node && typeof node.applyReceipt === 'function') {
          receiptApplied.add(rc.actionHash);
          node.applyReceipt(rc);
        }
      }
      void syncGates();
      void loadStatus();
    });
    es.addEventListener('open', () => {
      if (S.streamDown) { S.streamDown = false; paintC(); }
      void syncGates();
    });
    es.addEventListener('error', () => {
      // EventSource retries on its own. Say the connection is down rather than
      // letting the thread imply nothing has happened since.
      if (!S.streamDown) { S.streamDown = true; paintC(); }
    });
  }

  /** Run ids and token facts use a separate owner-only stream. */
  function openRunProgressStream() {
    if (!OWNER_TOKEN || typeof EventSource !== 'function') return;
    let es;
    try {
      es = new EventSource('/forge/run-progress');
    } catch {
      S.runProgressStreamDown = true;
      return;
    }
    es.addEventListener('run-progress', (ev) => {
      let progress = null;
      try {
        progress = JSON.parse(ev.data);
      } catch {
        progress = null;
      }
      const updatedId = progress ? applyRunProgress(S.sessions, progress) : null;
      if (!updatedId) return;
      const updatedSession = S.sessions.find((session) => session.id === updatedId);
      if (shouldRepaintRunProgress(S.selectedSessionId, updatedId)) paintC();
      else if (updatedSession) updateSessionTabProgress(updatedSession);
    });
    es.addEventListener('gap', () => {
      const updatedIds = markRunProgressGap(S.sessions);
      for (const id of updatedIds) {
        const updatedSession = S.sessions.find((session) => session.id === id);
        if (!updatedSession) continue;
        if (shouldRepaintRunProgress(S.selectedSessionId, id)) paintC();
        else updateSessionTabProgress(updatedSession);
      }
    });
    es.addEventListener('open', () => {
      if (S.runProgressStreamDown) {
        S.runProgressStreamDown = false;
        if (activeSession().running) paintC();
        for (const session of S.sessions) {
          if (session.running && session.id !== S.selectedSessionId) updateSessionTabProgress(session);
        }
      }
    });
    es.addEventListener('error', () => {
      if (!S.runProgressStreamDown) {
        S.runProgressStreamDown = true;
        if (activeSession().running) paintC();
        for (const session of S.sessions) {
          if (session.running && session.id !== S.selectedSessionId) updateSessionTabProgress(session);
        }
      }
    });
  }

  /* ---- the two views ----------------------------------------------------- *
   * IDE — the five regions, unchanged.
   * AGENT — rgA, rgB and rgD collapse and rgC becomes a focused conversation
   *         workspace with a compact history rail and readable transcript.
   *         The CSS owns the layout (one attribute on :root,
   *         exactly as the drawer's collapsed state works); this owns the
   *         attribute, the preference and the two things that must be told the
   *         window changed shape — the editor, which measures itself, and the
   *         composer, which should have the caret when the chat is the window. */

  function setView(next) {
    S.view = next === 'agent' ? 'agent' : 'ide';
    // Agent mode is the focused conversation surface. Do not carry a dense
    // diagnostic/catalog tab into it when the owner switches from the IDE.
    if (S.view === 'agent') S.insp = 'chat';
    R.setAttribute('data-forge-view', S.view);
    try {
      localStorage.setItem(VIEW_KEY, S.view);
    } catch {
      /* a browser that refuses storage simply does not remember the choice */
    }
    syncPaneVisibility();
    paintC();
    paintE();
    requestAnimationFrame(layoutEditors);
    if (S.view === 'agent') {
      const inp = rgC.querySelector('#zf-task');
      if (inp && !inp.disabled) inp.focus();
    }
  }

  function restoreView() {
    let v = null;
    try {
      v = localStorage.getItem(VIEW_KEY);
    } catch {
      v = null;
    }
    S.view = v === 'agent' ? 'agent' : 'ide';
    R.setAttribute('data-forge-view', S.view);
    syncPaneVisibility();
  }

  /* ---- the run clock ----------------------------------------------------- *
   * Elapsed time complements the daemon's live five-step orchestration facts.
   * Neither value estimates how far a provider is through generation. */
  let runClock = null;

  function elapsedLabel(session = activeSession()) {
    if (!session.runAt) return '0s';
    const s = Math.max(0, Math.round((Date.now() - session.runAt.getTime()) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  function startRunClock() {
    if (runClock !== null) return;
    runClock = setInterval(() => {
      const n = rgC.querySelector('.fgrun-el');
      if (n) n.textContent = elapsedLabel(activeSession());
    }, 1000);
  }

  function stopRunClock() {
    if (S.sessions.some((session) => session.running)) return;
    if (runClock !== null) clearInterval(runClock);
    runClock = null;
  }

  /** The in-flight turn. The disclosure reports bounded orchestration only. */
  function runningBlock() {
    const session = activeSession();
    const progress = session.runProgress || initialRunProgress(
      session.runId || 'pending', session.agentId, session.model || '',
    );
    const m = el('div', 'msg me fgrunning');
    m.setAttribute('aria-live', 'polite');
    const who = el('div', 'who');
    add(who, el('span', null, 'Zeno Forge'), el('span', 'mchip', `${progress.agentId}${progress.model ? ' · ' + progress.model : ''}`));
    add(m, who);
    const shell = el('div', 'bub');
    const row = el('div', 'fgrun');
    const transport = runTransportState(session);
    const disclosure = el('details', 'fgthinking');
    disclosure.open = S.thinkingExpanded;
    disclosure.addEventListener('toggle', () => {
      S.thinkingExpanded = disclosure.open;
      try { localStorage.setItem('zeno-forge-thinking-expanded', disclosure.open ? '1' : '0'); } catch { /* storage is optional */ }
    });
    const summary = el('summary', 'fgthinking-summary');
    const spin = el('span', `fgspin${transport.terminal ? ` terminal ${transport.label}` : ''}`);
    spin.setAttribute('aria-hidden', 'true');
    add(summary, spin, el('span', 'fgrun-lb', transport.terminal ? 'Finishing' : 'Thinking'),
      el('span', 'fgrun-phase', phaseLabel(progress)), el('span', 'sp'), el('span', 'fgrun-el', elapsedLabel(session)), glyph('›', 'fgthinking-chev'));
    add(disclosure, summary);

    const body = el('div', 'fgthinking-body');
    const track = el('div', 'fgrun-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Forge orchestration progress');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(progress.total));
    track.setAttribute('aria-valuenow', String(progress.completed));
    const fill = el('span', 'fgrun-fill');
    fill.style.width = `${progress.orchestrationPercent}%`;
    add(track, fill);
    add(body, track, el('div', 'fgrun-facts',
      `Orchestration ${progress.completed}/${progress.total} · ${progress.orchestrationPercent}%`));
    const milestones = [
      'Check selected provider',
      'Prepare isolated worktree and governed tools',
      'Run selected provider',
      'Inspect changed files',
      'Prepare governed proposals',
    ];
    const plan = el('ol', 'fgthinking-plan');
    for (let index = 0; index < milestones.length; index++) {
      const item = el('li', index < progress.completed ? 'done' : index === progress.completed && !progress.terminal ? 'active' : 'pending', milestones[index]);
      add(plan, item);
    }
    add(body, plan, el('div', 'fgrun-tokens', tokenUsageLabel(progress.tokenUsage)));
    add(body, el('div', 'hint',
      `Tool calls and files changed become available only in the final run response · ${gatesWaiting()} approval${gatesWaiting() === 1 ? '' : 's'} currently waiting.`));
    add(body, el('div', 'hint', 'Provider plan steps, private reasoning, and model activity summaries are not exposed by this backend.'));
    if (S.runProgressStreamDown) add(body, renderNote('Live orchestration updates are reconnecting. The final run response remains authoritative.', 'cy'));
    if (session.runProgressStale) add(body, renderNote('Some live progress events could not be replayed. The final response will reconcile this state.', 'cy'));
    if (session.cancelNote) add(body, renderNote(session.cancelNote, session.canceling ? 'cy' : 'rd'));
    if (session.route && session.route.rationale) add(body, renderNote(session.route.rationale, 'cy'));
    add(disclosure, body);
    const cancel = btn('btn sm ghost', transport.terminal ? 'Finished' : session.canceling ? 'Canceling…' : 'Cancel', () => void cancelRun(session));
    cancel.disabled = !transport.canCancel;
    cancel.title = transport.terminal
      ? 'The provider ended; waiting for the authoritative run response.'
      : session.canceling ? 'Stopping the agent process and its descendants.' : 'Stop this agent process and all descendants.';
    add(row, disclosure, cancel);
    add(shell, row);
    add(m, shell);
    return m;
  }

  /* ================================================================ *
   * 4 · first paint, then the live reads                              *
   * ================================================================ */

  restoreView();

  paintA();
  paintB();
  paintC();
  paintD();
  paintE();
  void loadStatus();
  void loadAgents();
  void loadContext();
  void syncGates();
  openStream();
  openRunProgressStream();

  /* THE SHORTCUT. Registered on the document as well as inside the editor,
     because the editor is exactly the thing the agent-only view hides — a key
     that only works while the code pane has focus could never be used to get
     back. Guarded on `section.hidden`, which is how nav.js shows a surface, so
     it is inert while Command or Counsel is on screen. */
  document.addEventListener('keydown', (ev) => {
    if (section.hidden) return;
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    if (!ev.shiftKey && ev.key === '\\') {
      ev.preventDefault();
      setSplitEditor(!S.splitEditor);
      return;
    }
    if (!ev.shiftKey && (ev.key === '1' || ev.key === '2')) {
      if (ev.key === '2' && !S.splitEditor) return;
      ev.preventDefault();
      focusEditorGroup(ev.key === '2' ? 1 : 0);
      if (ed) ed.focus();
      return;
    }
    if (!ev.shiftKey && String(ev.key).toLowerCase() === 'w' && S.file) {
      ev.preventDefault();
      closeTab(S.focusedGroup, S.file);
      return;
    }
    if (!ev.shiftKey) return;
    if (String(ev.key).toLowerCase() !== 'a') return;
    ev.preventDefault();
    setView(S.view === 'agent' ? 'ide' : 'agent');
  });

  /* A capsule that reaches a receipt changes two things this surface shows: the
     working tree, and possibly the bytes of the file in the pane. Both are
     re-read from the daemon rather than assumed. The event bubbles out of the
     capsule component, so this catches an approval made in line here. */
  rgC.addEventListener('zeno:receipt', (ev) => {
    const rc = ev.detail && ev.detail.receipt;
    if (rc && typeof rc.actionHash === 'string') receiptApplied.add(rc.actionHash);
    void loadStatus();
    void rereadOpenFile(true);
    void syncGates();
  });

  /* Coming back to Forge from another surface: the window may have been
     resized while it was hidden, and monaco measures itself against a box that
     had none. */
  section.addEventListener('zeno:surface-shown', () => {
    requestAnimationFrame(layoutEditors);
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirtyPaths.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/* nav.js looks up `mod.init || mod.default`; the brief names the export
   `initForge`. All three are provided so both contracts hold. */
export const init = initForge;
export default initForge;
