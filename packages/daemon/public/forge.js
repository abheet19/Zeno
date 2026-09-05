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
 *   POST /forge/run     -> { run:{ok,agentId,model,effort,log,note}, changed[],
 *                            proposed[] }                    the chat
 *   POST /forge/commit  -> { receipt }                        the seal
 *
 * WHERE THERE IS NO REAL SOURCE, THE PANEL SAYS SO. Forge has no test runner, no
 * CI, no terminal, no rules engine and no MCP registry — so the Tests, CI,
 * Terminal, Rules, MCP, Debug and Plan surfaces render a plain sentence
 * naming what is missing, and render nothing else. A panel that invented a
 * passing test run would be worse than an absent panel; it would be a lie the
 * owner cannot see through. `renderUnwired()` is the single shape all of them use.
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
 * innerHTML. There is no innerHTML in this file.
 *
 * Exports init / initForge / default — nav.js lazy-imports this once, via
 * data-init="/forge.js", and calls `mod.init || mod.default` with the section.
 */

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

    pan: 'explorer',     // rgA panel
    insp: 'chat',        // rgC inspector tab
    draw: 'terminal',    // rgD drawer tab

    open: [],            // open file tabs, in order: [path]
    file: null,          // the path showing in the code pane
    fileData: null,      // GET /forge/file for S.file
    fileErr: null,
    fileBusy: false,
    caret: 0,            // 1-based current line; 0 when the owner has not picked one

    agentId: 'claude-code',
    model: '',
    effort: 'medium',

    chat: [],            // real turns only: {who:'you'|'agent', ...}
    runs: [],            // this session's runs: {at, task, ok, agentId, model, effort, files, waiting, applied}
    proposals: [],       // the newest run's proposed[] capsules
    running: false,

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

  /* ---- the five regions, built once and refilled in place ---------------- */
  const root = el('div', 'forge');
  const rgA = el('aside', 'rgA');
  const rgB = el('div', 'rgB');
  const rgC = el('div', 'rgC');
  const rgD = el('div', 'rgD');
  const rgE = el('div', 'rgE');
  rgA.setAttribute('aria-label', 'Explorer');
  rgB.setAttribute('aria-label', 'Code');
  rgC.setAttribute('aria-label', 'Agent session');
  rgD.setAttribute('aria-label', 'Terminal, tests, CI and processes');
  rgE.setAttribute('aria-label', 'Repository status');
  add(root, rgA, rgB, rgD, rgC, rgE);
  section.replaceChildren(root);

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
  const syncLock = () => { lockPill.hidden = R.getAttribute('data-lock') !== '1'; };
  syncLock();
  new MutationObserver(syncLock).observe(R, { attributes: true, attributeFilter: ['data-lock'] });

  /* ================================================================ *
   * rgA — the explorer rail: repo head, panel body, panel switcher    *
   * ================================================================ */

  const PANELS = [
    ['explorer', 'Explorer'],
    ['search', 'Search'],
    ['scm', 'Source control'],
    ['rules', 'Rules & skills'],
    ['mcp', 'MCP servers'],
    ['tests', 'Tests'],
    ['debug', 'Debug'],
    ['tasks', 'Task board'],
  ];

  function paintA() {
    const st = S.status;

    // The workspace head. There is exactly one workspace — the sandbox — so this
    // names it and re-reads it, rather than offering a switcher over one item.
    const head = btn('mdl', null, () => void reloadRepo());
    add(head, glyph('☰'));
    const name = el('b', null, st && st.repo ? repoName(st) : 'sandbox');
    name.title = st && st.root ? String(st.root) : 'the daemon sandbox';
    add(head, name, el('span', 'sp'));
    /* The word alone was a dead control on the common case. A repository that
       has not changed redraws an identical tree, so a click produced no visible
       difference whatsoever and the honest reading was "this button is broken".
       The clock time of the read changes on every click even when the repository
       does not, so the button now answers the only question it was being asked. */
    head.disabled = S.reloading;
    add(head, el('span', null,
      S.reloading ? 'reading…' : (S.readAt ? `reload · ${clockOf(S.readAt)}` : 'reload')));
    head.title = S.readAt
      ? `Re-read the sandbox and the open file from disk. Last read at ${clockOf(S.readAt)}.`
      : 'Re-read the sandbox and the open file from disk.';

    const body = el('div', 'panbody');
    add(body, PANEL[S.pan] ? PANEL[S.pan]() : PANEL.explorer());

    const bar = el('div', 'panbar');
    const d = el('div', 'd', 'panels');
    const tree = el('div', 'tree');
    for (const [id, label] of PANELS) {
      const b = btn(null, label, () => { S.pan = id; paintA(); });
      b.setAttribute('aria-current', id === S.pan ? 'true' : 'false');
      add(tree, b);
    }
    add(bar, d, tree);

    rgA.replaceChildren(head, body, bar);
  }

  function repoName(st) {
    const b = String(st.branch || '');
    return b ? `sandbox · ${b}` : 'sandbox';
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

      const tree = el('div', 'tree');
      let group = null;
      for (const p of paths) {
        const cut = p.lastIndexOf('/');
        const dir = cut === -1 ? '' : p.slice(0, cut);
        const base = cut === -1 ? p : p.slice(cut + 1);
        if (dir !== group) {
          group = dir;
          const d = el('div', 'd', dir === '' ? '/' : dir.toUpperCase() + '/');
          d.title = dir === '' ? 'repository root' : dir;
          add(tree, d);
        }
        const b = btn(null, null, () => openFile(p));
        const dirty = changed.has(p);
        add(b, glyph(dirty ? '●' : '○'));
        b.firstChild.style.color = dirty ? 'var(--green)' : 'var(--ink-3)';
        const nm = el('span', 'nm', base);
        add(b, nm);
        b.title = dirty ? `${p} — ${statusWord(changed.get(p))}` : p;
        b.setAttribute('aria-current', p === S.file ? 'true' : 'false');
        add(tree, b);
      }
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

    /* ---- the five with no live source. Each names what is missing. -------- */
    rules() {
      return renderUnwired(
        'No rules engine is wired',
        'Nothing in this daemon loads per-repo rules or skills, so there is no rule set, no hash and no conflict to report. This panel will have content when a rules source exists — not before.',
      );
    },
    mcp() {
      return renderUnwired(
        'No MCP servers are registered',
        'This daemon holds no connector registry, so there is nothing to list and no tool permissions to show. An empty list here is the true one.',
      );
    },
    tests() {
      return renderUnwired(
        'No test runner is wired',
        'Forge cannot run tests: there is no daemon route that executes a test command, so there is no pass, no fail and no coverage to report. Any number shown here would be invented.',
      );
    },
    debug() {
      return renderUnwired(
        'No debugger is wired',
        'Forge cannot attach to a process. There is no debug session, and there is no route that could start one.',
      );
    },
    tasks() {
      const wrap = el('div', 'pw');
      add(wrap, renderUnwired(
        'The work desk lives on Command',
        'Forge does not hold a task board of its own. What is assigned, proposed and waiting is Command’s list, drawn from the same daemon.',
      ));
      const acts = el('div', 'acts');
      const go = btn('btn sm', 'Open Command');
      go.setAttribute('data-go', 'command');
      add(acts, go);
      add(wrap, acts);
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
   * rgB — crumbs, file tabs, the code pane, the minimap               *
   * ================================================================ */

  function paintB() {
    /* crumbs: repository › directory › file, then the branch. */
    const crumbs = el('div', 'crumbs');
    add(crumbs, el('span', null, 'sandbox'));
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

    /* file tabs */
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    if (S.open.length === 0) {
      const none = el('span', 'tb');
      none.textContent = 'no file open';
      add(tabs, none);
    }
    const changed = new Set(((S.status && S.status.changed) || []).map((c) => c.path));
    for (const p of S.open) {
      const t = btn('tb', null, () => openFile(p));
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', p === S.file ? 'true' : 'false');
      const dot = el('span', changed.has(p) ? 'fdot' : 'fdot clean');
      dot.setAttribute('aria-hidden', 'true');
      add(t, dot, el('span', null, p.split('/').pop()));
      t.title = changed.has(p) ? `${p} — changed in the working tree` : p;
      add(tabs, t);
    }
    add(tabs, el('span', 'sp'));

    /* the pane itself */
    placeViewport = null;
    const wrap = el('div', 'edwrap');
    const code = el('div', 'code');
    code.tabIndex = 0;
    const mini = el('div', 'mini');
    mini.setAttribute('aria-hidden', 'true');

    if (S.fileBusy) {
      add(code, paneMessage('Reading the file from the sandbox…'));
    } else if (S.fileErr) {
      add(code, paneMessage(S.fileErr));
    } else if (!S.file || !S.fileData) {
      add(code, paneMessage(
        'No file is open. Pick one from the Explorer and its real contents are read from the sandbox and shown here.\n\n' +
        'This pane never shows source that is not in the repository — with nothing selected it shows nothing, not a sample.',
      ));
    } else if (S.fileData.binary) {
      add(code, paneMessage(
        `${S.file} is not a text file (${bytesLabel(S.fileData.bytes)}). There is nothing to render as source, so nothing is rendered.`,
      ));
    } else {
      const lines = String(S.fileData.contents).split('\n');
      const colour = highlights(S.file);
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
        S.caret = Number(r.dataset.line) || 0;
        paintB();
        paintE();
      });
      if (S.fileData.truncated) {
        const cut = el('div', 'row');
        add(cut, el('span', 'ln', '…'), el('span', 'tx',
          `file continues — ${S.fileData.lines} lines in total, the first ${lines.length} are shown`));
        code.appendChild(cut);
      }
      // The minimap is a picture of THIS file: one bar per sampled line, its
      // width the real length of that line. It is drawn from the bytes on
      // screen, so it cannot disagree with them.
      drawMini(mini, lines);
      placeViewport = trackViewport(code, mini);
    }

    add(wrap, code, mini);
    rgB.replaceChildren(crumbs, tabs, wrap);
    // Placed HERE, and not a moment earlier: the rectangle is a measurement of
    // the pane, and until replaceChildren has put the pane in the document there
    // is no height to measure. Everything above builds detached.
    if (placeViewport) placeViewport();
  }

  /** Set by paintB for the pane it just built; null when no file is on screen. */
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
   * Both observers hang off the `code` element, which paintB rebuilds on every
   * repaint — so they are dropped with it and nothing accumulates.
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
    // pane getting a height on first show and every resize after. paintB calls
    // the returned `place` once the pane is actually in the document.
    if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(code);
    return place;
  }

  /* ================================================================ *
   * rgC — the agent session: tabs, the conversation, the composer     *
   * ================================================================ */

  const INSP = [['chat', 'Chat'], ['plan', 'Plan'], ['runs', 'Runs'], ['actions', 'Actions'], ['lens', 'Lens']];

  function paintC() {
    const ses = el('div', 'sesrow');
    const last = S.runs[S.runs.length - 1];
    const label = el('span', 'sesname', last ? `session · ${short(last.task, 40)}` : 'session · nothing run yet');
    if (last) label.title = last.task;
    add(ses, label);

    const tabs = el('div', 'insp-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const [id, name] of INSP) {
      const b = btn(null, name, () => { S.insp = id; paintC(); });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', id === S.insp ? 'true' : 'false');
      add(tabs, b);
    }

    const bd = el('div', 'insp-bd');
    add(bd, INSPECTOR[S.insp] ? INSPECTOR[S.insp]() : INSPECTOR.chat());

    /* the composer: the task that starts a run */
    const compose = el('div', 'compose');
    const input = el('input');
    input.type = 'text';
    input.id = 'zf-task';
    input.placeholder = S.running ? 'a run is in flight…' : 'Describe the change… ↵ to run';
    input.setAttribute('aria-label', 'The task to hand the agent');
    input.value = taskDraft;
    input.disabled = S.running || !OWNER_TOKEN;
    input.addEventListener('input', () => { taskDraft = input.value; sendBtn.disabled = !canRun(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && canRun()) { ev.preventDefault(); void doRun(); }
    });
    const sendBtn = btn('btn sm', S.running ? 'Running…' : 'Run', () => void doRun());
    sendBtn.disabled = !canRun();
    add(compose, input, sendBtn);

    /* the footer: the model and effort selectors, from GET /forge/agents */
    const crow = el('div', 'crow');
    add(crow, buildPickers());
    rgC.replaceChildren(ses, tabs, bd, compose, crow);
  }

  let taskDraft = '';

  function canRun() {
    return Boolean(OWNER_TOKEN && !S.running && taskDraft.trim() !== '');
  }

  function buildPickers() {
    const box = el('span');
    box.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:100%';
    if (S.agentsErr) {
      add(box, el('span', null, `agents unavailable — ${S.agentsErr}`));
      return box;
    }
    if (!S.agents) {
      add(box, el('span', null, 'reading the available agents…'));
      return box;
    }
    const agents = S.agents.agents || [];
    const agentSel = el('select');
    agentSel.setAttribute('aria-label', 'Agent');
    for (const a of agents) {
      const o = el('option', null, a.label || a.id);
      o.value = a.id;
      if (a.id === S.agentId) o.selected = true;
      add(agentSel, o);
    }
    agentSel.addEventListener('change', () => { S.agentId = agentSel.value; S.model = ''; paintC(); paintE(); });

    const modelSel = el('select');
    modelSel.setAttribute('aria-label', 'Model');
    const chosen = agents.find((a) => a.id === S.agentId);
    const models = S.agentId === 'local' ? (S.agents.localModels || []) : ((chosen && chosen.models) || []);
    if (models.length === 0) {
      const o = el('option', null, S.agentId === 'local' ? 'no local model installed' : 'the agent’s default');
      o.value = '';
      add(modelSel, o);
      modelSel.disabled = true;
      modelSel.title = S.agentId === 'local'
        ? 'Ollama listed no installed models, so there is nothing to pick.'
        : 'This agent chooses its own model; the daemon offers no list.';
    } else {
      const dflt = el('option', null, 'the agent’s default');
      dflt.value = '';
      add(modelSel, dflt);
      for (const m of models) {
        const o = el('option', null, m);
        o.value = m;
        if (m === S.model) o.selected = true;
        add(modelSel, o);
      }
    }
    modelSel.addEventListener('change', () => { S.model = modelSel.value; paintE(); });

    const effortSel = el('select');
    effortSel.setAttribute('aria-label', 'Effort');
    for (const e of S.agents.efforts || []) {
      const o = el('option', null, `effort: ${e}`);
      o.value = e;
      if (e === S.effort) o.selected = true;
      add(effortSel, o);
    }
    const supports = !chosen || chosen.supportsEffort !== false;
    effortSel.disabled = !supports;
    if (!supports) effortSel.title = 'This agent does not take an effort level.';
    effortSel.addEventListener('change', () => { S.effort = effortSel.value; paintE(); });

    add(box, agentSel, modelSel, effortSel, el('span', 'sp'), el('span', null, '↵ to run'));
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
      if (S.chat.length === 0) {
        add(wrap, renderUnwired(
          'Nothing has been run yet',
          'Type a task below and press Run. The agent works headless in an isolated throwaway worktree, and every file it changes arrives in Command as an approval capsule — nothing here touches the sandbox on its own.',
        ));
        return wrap;
      }
      for (const turn of S.chat) add(wrap, turn.who === 'you' ? youTurn(turn) : agentTurn(turn));
      if (S.running) {
        const m = el('div', 'msg me');
        add(m, el('div', 'who', 'Zeno Forge'));
        const b = el('div', 'bub', 'Running. Progress is genuinely unknown until the agent returns, so nothing here pretends to measure it.');
        add(m, b);
        add(wrap, m);
      }
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
        kvAdd(kv, 'agent finished', r.ok ? 'yes' : 'no');
        kvAdd(kv, 'files changed', String(r.files));
        // Split, for the same reason the chat footer is split: "proposed" was a
        // total that silently included the routine writes the kernel had already
        // committed, so a run whose every change auto-applied still reported
        // capsules as if they were waiting for the owner.
        kvAdd(kv, 'awaiting your approval', String(r.waiting));
        kvAdd(kv, 'auto-applied (routine)', String(r.applied));
        add(box, kv);
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
    lens() {
      return renderUnwired(
        'No rules or skills are loaded',
        'Nothing keys rules or skills into a run, so there is no list, no hash and no conflict to report. This panel stays empty until a rules source exists.',
      );
    },
  };

  function youTurn(t) {
    const m = el('div', 'msg');
    add(m, el('div', 'who', 'you'));
    add(m, el('div', 'bub', t.text));
    return m;
  }

  function agentTurn(t) {
    const m = el('div', 'msg me');
    const who = el('div', 'who');
    add(who, el('span', null, 'Zeno Forge'));
    add(who, el('span', 'mchip', `${t.agentId}${t.model ? ' · ' + t.model : ''}${t.effort ? ' · ' + t.effort : ''}`));
    add(m, who);

    // A factual line about what the run did, in the prototype's slot for the
    // agent's inner voice. It reports mechanics we actually know — never
    // invented reasoning.
    add(m, el('div', 'think',
      `ran headless in an isolated worktree · ${t.files.length} ${t.files.length === 1 ? 'file' : 'files'} changed · ${clock(t.at)}`));

    // TOOL CALLS as discrete rows: one per file the run actually wrote, with the
    // real line range it produced. Clicking one opens that file in the pane.
    for (const f of t.files) {
      const row = btn('tool', null, () => openFile(f.path));
      add(row, el('span', 'th', 'write'));
      const p = el('span', 'pth', f.lines ? `${f.path}:1–${f.lines}` : f.path);
      p.title = f.path;
      add(row, p);
      add(row, el('span', 'ok', f.tier ? f.tier : '·'));
      add(m, row);
    }
    if (t.files.length === 0) {
      add(m, el('div', 'tool', 'no file operations — the run changed nothing'));
    }

    const bub = el('div', 'bub');
    if (t.note) add(bub, el('div', null, t.note));
    if (t.log) {
      const pre = el('pre');
      pre.textContent = t.log;
      add(bub, pre);
    }
    if (!t.note && !t.log) add(bub, el('div', null, 'The agent returned without any output to show.'));
    add(m, bub);

    /* WAITING AND APPLIED ARE DIFFERENT FACTS, so they are different lines.
       The daemon returns `auto` on every proposed capsule: a routine (T0) write
       is committed and receipted by the kernel on the spot, and only a capsule
       with `auto:false` is actually sitting on Command waiting for a decision.
       Counting them together and calling the total "review before anything
       lands" told the owner a change was waiting when it had ALREADY landed —
       the one sentence this surface must never say. */
    if (t.waiting > 0) {
      const c = btn('cite', `↗ ${t.waiting} ${t.waiting === 1 ? 'capsule' : 'capsules'} on Command — ${t.waiting === 1 ? 'it has' : 'they have'} not landed until you approve ${t.waiting === 1 ? 'it' : 'them'}`);
      c.setAttribute('data-go', 'command');
      add(m, c);
    }
    if (t.applied > 0) {
      const c = btn('cite', `✓ ${t.applied} routine ${t.applied === 1 ? 'change was' : 'changes were'} applied and receipted automatically — already in Command’s timeline, not awaiting a decision`);
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

  const DRAWER = [['terminal', 'Terminal'], ['tests', 'Tests'], ['ci', 'CI'], ['procs', 'Processes & ports']];

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
    if (!colBtn) return;
    colBtn.textContent = min ? '▲ expand' : '▼ collapse';
    colBtn.setAttribute('aria-expanded', min ? 'false' : 'true');
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
      });
      c.setAttribute('role', 'tab');
      c.setAttribute('aria-selected', id === S.draw ? 'true' : 'false');
      if (id === S.draw) c.dataset.state = 'listening';
      add(hd, c);
    }
    add(hd, el('span', 'sp'));
    colBtn = btn('drawcol', drawerMin() ? '▲ expand' : '▼ collapse', () => setDrawerMin(!drawerMin()));
    colBtn.setAttribute('aria-expanded', drawerMin() ? 'false' : 'true');
    add(hd, colBtn);

    const bd = el('div', 'drawbody');
    add(bd, DRAWER_BODY[S.draw] ? DRAWER_BODY[S.draw]() : DRAWER_BODY.terminal());

    rgD.replaceChildren(drag, hd, bd);
  }

  const DRAWER_BODY = {
    terminal() {
      const wrap = el('div');
      add(wrap, renderUnwired(
        'No terminal is wired',
        'There is no daemon route that runs a shell command, so this window cannot execute anything and nothing is running. ' +
        'Opening a terminal never runs anything on its own — and here there is not even a shell to open.',
      ));
      return wrap;
    },
    tests() {
      return renderUnwired(
        'No test runner is wired',
        'Nothing here runs tests, so there is no pass, no fail, no duration and no coverage. A green line in this panel would be fiction, so the panel stays empty.',
      );
    },
    ci() {
      return renderUnwired(
        'No CI is wired',
        'This daemon talks to no CI system. There is no pipeline, no job and no status to mirror, so none is drawn.',
      );
    },
    procs() {
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
    /* The height the drawer HAS when open — taken from the variable, never
       measured. Measuring is what made the shut drawer eat the owner's size:
       while it is shut the measurement is 34px, the collapsed track, so a drag
       started from 34px and wrote that back over a drawer the owner had sized to
       343px. Opening it first does not help, because the layout the measurement
       needs has not been recomputed by the time the drag reads it. 150 is the
       stylesheet's own `var(--fdrawer,150px)` default, for a never-resized drawer. */
    const openHeight = () => {
      const inline = parseFloat(root.style.getPropertyValue('--fdrawer'));
      if (Number.isFinite(inline)) return inline;
      return drawerMin() ? 150 : rgD.offsetHeight;
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

    const repo = el('b', null, 'sandbox');
    bits.push(repo);
    if (st && st.repo) {
      bits.push(el('span', null, st.branch || '(no branch)'));
      bits.push(el('span', null, st.head ? `HEAD ${st.head}` : 'HEAD — no commits yet'));
      const n = (st.changed || []).length;
      bits.push(el('span', null, n === 0 ? 'worktree clean' : `worktree ${n} changed`));
    } else {
      // Before the first answer we know nothing about the repository, so we say
      // nothing about it. Reporting "not a git repository" here was a claim the
      // window had not yet earned — it would have been printed even where a
      // perfectly good repository existed and the read was simply in flight.
      bits.push(el('span', null,
        S.statusErr ? 'status unavailable' : S.status ? 'not a git repository' : 'reading the repository…'));
    }

    if (S.file && S.fileData && !S.fileData.binary) {
      bits.push(el('span', null,
        `${S.fileData.encoding} · ${S.fileData.eol} · ${S.fileData.lines} ln · ${bytesLabel(S.fileData.bytes)}`));
      bits.push(el('span', null, S.caret ? `ln ${S.caret}` : 'ln —'));
    } else if (S.file && S.fileData && S.fileData.binary) {
      bits.push(el('span', null, `binary · ${bytesLabel(S.fileData.bytes)}`));
    } else {
      bits.push(el('span', null, 'no file open'));
    }

    const sp = el('span', 'sp');
    bits.push(sp);

    /* EFFORT IS ONLY STATED WHERE IT MEANS SOMETHING. The registry tells us, per
       rung, whether that agent takes an effort level (`supportsEffort`); the
       picker already disables the control when it does not. Printing "effort
       medium" here regardless described a setting that will not reach the run —
       a small claim, but a false one, and the status bar is read as fact. Where
       the rung declares no effort, the bar says nothing about effort. */
    const chosenAgent = (S.agents && Array.isArray(S.agents.agents))
      ? S.agents.agents.find((a) => a && a.id === S.agentId)
      : null;
    const effortCounts = !chosenAgent || chosenAgent.supportsEffort !== false;
    const agent = el('span');
    add(agent, el('b', null, S.agentId));
    add(agent, document.createTextNode(
      ` · ${S.model || 'default model'}${effortCounts ? ` · effort ${S.effort}` : ''}`));
    bits.push(agent);

    /* The egress line, and it is a statement of fact rather than a badge: a
       local model runs on this machine and nothing leaves it; a hosted agent
       reaches its own provider, and saying "local only" there would be false. */
    const eg = el('span', 'chip');
    const egLocal = S.agentId === 'local';
    eg.dataset.state = egLocal ? 'listening' : 'warn';
    add(eg, glyph(egLocal ? '⌂' : '↗', 'chip-glyph'));
    add(eg, document.createTextNode(egLocal ? 'egress: local only' : 'egress: this agent reaches its own provider'));
    bits.push(eg);

    const mode = el('span', 'chip');
    add(mode, glyph('◇', 'chip-glyph'));
    add(mode, document.createTextNode('mode: propose — Forge never approves'));
    bits.push(mode);

    rgE.replaceChildren(...bits);
  }

  /* ================================================================ *
   * 3 · the reads and the two writes                                  *
   * ================================================================ */

  async function loadStatus() {
    const r = await api('/forge/status');
    if (!r.ok) {
      S.status = null;
      S.statusErr = errText(r);
    } else {
      S.status = r.data;
      S.statusErr = null;
    }
    paintA();
    paintB();
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
      await Promise.all([loadStatus(), rereadOpenFile()]);
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
  async function rereadOpenFile() {
    const path = S.file;
    if (!path) return;
    const r = await api(`/forge/file?path=${encodeURIComponent(path)}`);
    if (S.file !== path) return;   // the owner opened something else mid-read
    if (!r.ok) {
      S.fileData = null;
      S.fileErr = `${path} could not be read: ${errText(r)}`;
    } else {
      S.fileData = r.data;
      S.fileErr = null;
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
      if (!list.some((a) => a.id === S.agentId) && list.length) S.agentId = list[0].id;
      const efforts = (r.data && r.data.efforts) || [];
      if (efforts.length && !efforts.includes(S.effort)) S.effort = efforts[0];
    }
    paintC();
    paintE();
  }

  /**
   * Open one sandbox file in the code pane, from GET /forge/file. `line` is
   * optional and 1-based: a search hit passes the line it was found on, so the
   * pane lands on it rather than at the top of a two-thousand-line file.
   */
  async function openFile(path, line) {
    if (!path) return;
    const at = Number(line);
    S.file = path;
    if (!S.open.includes(path)) S.open.push(path);
    S.fileBusy = true;
    S.fileErr = null;
    S.fileData = null;
    S.caret = Number.isInteger(at) && at > 0 ? at : 0;
    paintA();
    paintB();
    paintE();

    const r = await api(`/forge/file?path=${encodeURIComponent(path)}`);
    S.fileBusy = false;
    if (!r.ok) {
      S.fileData = null;
      S.fileErr = `${path} could not be read: ${errText(r)}`;
    } else {
      S.fileData = r.data;
      S.fileErr = null;
    }
    paintB();
    paintE();
    revealCaret();
  }

  /**
   * Scroll the code pane to the caret line, if there is one on screen.
   *
   * The line may genuinely not be there: /forge/file caps a long file, so a hit
   * past the cap has no row. In that case the pane is scrolled to the bottom,
   * where the cap's own "file continues — N lines in total" row is — which says
   * why the line is not shown instead of silently doing nothing.
   */
  function revealCaret() {
    if (!S.caret) return;
    const code = rgB.querySelector('.code');
    if (!code) return;
    const row = code.querySelector(`.row[data-line="${S.caret}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
    else if (S.fileData && S.fileData.truncated) code.scrollTop = code.scrollHeight;
  }

  /** POST /forge/run — the agent proposes; nothing here applies anything. */
  async function doRun() {
    if (!canRun()) return;
    const task = taskDraft.trim();
    S.chat.push({ who: 'you', text: task });
    S.running = true;
    taskDraft = '';
    S.insp = 'chat';
    paintC();
    paintE();

    const body = { task, agentId: S.agentId };
    if (S.model) body.model = S.model;
    if (S.effort) body.effort = S.effort;
    const r = await api('/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    S.running = false;

    if (!r.ok) {
      // A failed request is not an agent turn. It is reported as what it is.
      S.chat.push({
        who: 'agent', at: new Date(), agentId: S.agentId, model: S.model, effort: S.effort,
        files: [], waiting: 0, applied: 0, log: '', note: `The run did not start: ${errText(r)}`,
      });
      S.runs.push({ at: new Date(), task, ok: false, agentId: S.agentId, model: S.model, effort: S.effort, files: 0, waiting: 0, applied: 0, note: errText(r) });
      paintC();
      paintE();
      return;
    }

    const d = r.data || {};
    const run = d.run || {};
    const proposed = Array.isArray(d.proposed) ? d.proposed : [];
    const changed = Array.isArray(d.changed) ? d.changed : [];

    // The tool rows: the files the run really wrote. The line count comes from
    // the run's own output where the harness emitted it, and is simply absent
    // where it did not — an absent number is shown as an absent number.
    const emitted = parseEmittedLines(run.log);
    const byPath = new Map(proposed.map((p) => [p.path, p]));
    const files = changed.map((path) => ({
      path,
      lines: emitted.get(path) || 0,
      tier: (byPath.get(path) || {}).tier || '',
    }));

    // `auto:true` means the kernel already committed and receipted that write —
    // it is NOT waiting on Command. Split here, once, so every panel that talks
    // about this run is talking about the same two numbers.
    const applied = proposed.filter((p) => p && p.auto).length;
    const waiting = proposed.length - applied;

    S.proposals = proposed;
    S.chat.push({
      who: 'agent',
      at: new Date(),
      agentId: run.agentId || S.agentId,
      model: run.model || S.model,
      effort: run.effort || S.effort,
      files,
      waiting,
      applied,
      log: typeof run.log === 'string' ? run.log : '',
      // run.ok:false is a plain statement, never dressed up as a partial success.
      note: run.ok === false ? (run.note || 'The agent did not complete this task.') : (run.note || ''),
    });
    S.runs.push({
      at: new Date(), task, ok: run.ok === true,
      agentId: run.agentId || S.agentId, model: run.model || S.model, effort: run.effort || S.effort,
      files: changed.length, waiting, applied,
      note: run.ok === false ? (run.note || '') : '',
    });

    paintC();
    void loadStatus();
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
    const re = /===FILE:\s*(\S+)\s*===\r?\n([\s\S]*?)\r?\n===END===/g;
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
   * 4 · first paint, then the live reads                              *
   * ================================================================ */

  paintA();
  paintB();
  paintC();
  paintD();
  paintE();
  void loadStatus();
  void loadAgents();
}

/* nav.js looks up `mod.init || mod.default`; the brief names the export
   `initForge`. All three are provided so both contracts hold. */
export const init = initForge;
export default initForge;
