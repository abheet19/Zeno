/*
 * sections.js — the four Command sections that used to be dead rail items.
 *
 * The left rail promised nine destinations and delivered five. Today &
 * Attention, Workstation, Vault, Integrations and Settings all carried
 * data-jump="cmd-hero", so five of the nine scrolled you back to the field you
 * were already looking at. Half the navigation was decoration.
 *
 * This module builds the four that had no section at all. Today & Attention
 * keeps the hero — the dashboard top IS its destination — and the other four
 * now render live daemon state:
 *
 *   Workstation   GET /forge/status   branch, HEAD, uncommitted files, the last
 *                                     commits, and the tracked-file count with
 *                                     its cap stated. Acts: open it in Forge.
 *   Vault         GET /memory         recent notes, and a search box that asks
 *                 GET /memory?q=      the daemon's own recall — matched terms
 *                 GET /brief          and score shown, never a black box — plus
 *                                     today's brief with its missing sources.
 *   Integrations  GET /work           every work source with its TRUE state.
 *                 GET /forge/agents   the local model runtime and the agents the
 *                                     daemon offers. Each row states three
 *                                     things and never fewer: is it configured,
 *                                     is it reachable, and does it leave this
 *                                     machine.
 *   Settings      GET /state          the policy hash that actually governed the
 *                                     newest receipt, the chain's own verdict,
 *                                     the two capability tokens (presence only —
 *                                     no secret is ever put in the DOM), the
 *                                     per-device display preferences, and the
 *                                     daemon's real origin.
 *
 * THE RULES THIS FILE KEEPS, the same ones command.js and mesh.js keep:
 *
 *   S1  A section claims "empty" only after its read SUCCEEDED. Before the first
 *       answer it says it has not read the daemon; a failed read says the read
 *       failed. Neither is ever rendered as "there is nothing".
 *   S2  NOTHING IS INVENTED, and a missing data source is stated rather than
 *       stubbed. Installed skills have no route on this daemon, and the MCP edge
 *       is a separate stdio process this window cannot see — so both say exactly
 *       that instead of drawing a plausible row. The ledger PATH is likewise not
 *       served by any route, and this file says so rather than printing a path
 *       it cannot verify.
 *   S3  It reads. Every fetch in this file is a GET; nothing here can approve,
 *       commit, delete or configure anything. The Vault search box is a GET to
 *       127.0.0.1 and the only control that sends anything at all.
 *   S4  No secret reaches the DOM. The owner token's PRESENCE is reported; its
 *       value is never rendered, never logged and never put in a title.
 *   S5  It writes into its own four mounts and nowhere else. The rail counts,
 *       the masthead and the tally belong to field.js — one writer per number.
 *
 * Masked mode (`:root[data-lock="1"]`) redacts what the prototype redacts:
 * titles, paths, note bodies and hashes go; the shape and every count stay,
 * because hiding that something exists is the one dishonesty masked mode must
 * not commit.
 *
 * No framework, no bundler, no CDN, no build step, and no request that leaves
 * this machine.
 */

const R = document.documentElement;

/* ---- auth: the same token the page was handed (empty on a read-only shell) - */
function token() {
  const m = document.querySelector('meta[name="zeno-token"]');
  const v = m ? m.getAttribute('content') : '';
  return typeof v === 'string' ? v.trim() : '';
}

/** One shape for every daemon call, the same one mesh.js and forge.js use. */
async function api(path) {
  const t = token();
  const headers = { accept: 'application/json' };
  if (t) headers['x-zeno-token'] = t;
  let res;
  try {
    res = await fetch(path, { headers, cache: 'no-store', credentials: 'same-origin' });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: { message: (err && err.message) || 'the daemon could not be reached' } };
  }
  const data = await res.json().catch(() => null);
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : ((data && data.error) || { message: `The daemon answered ${res.status}.` }),
  };
}

/* ---- text ------------------------------------------------------------------
   Every string that reaches innerHTML goes through esc() first. Branch names,
   file paths, note bodies, commit summaries and source details are all data
   written by something other than this file, and none of it is markup. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function plural(n, one, many) { return n === 1 ? one : many; }
function masked() { return R.getAttribute('data-lock') === '1'; }

/** Masked text: the shape survives, the identifier does not. */
function mk(s, n) {
  if (!masked()) return esc(clip(s, n || 120));
  return '<span class="mk">' + '█'.repeat(Math.min(18, Math.max(6, String(s || '').length))) + '</span>';
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = (Date.now() - t) / 60000;
  return m < 0 ? 0 : m;
}
function ageStr(m) {
  if (m == null) return null;
  return m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
}
function ageOf(iso) { const a = ageStr(minutesSince(iso)); return a ? a + ' ago' : null; }

/* ================================================================== *
 * this module's styles — tokens only, the approved palette as fallback *
 * ================================================================== */

const STYLE_ID = 'zeno-sections-styles';
const CSS = `
.zs{ display:flex; flex-direction:column; gap:14px; }
.zs p{ margin:0; }
.zs-k{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3,#6C7480); font-weight:600; margin:0;
}
/* the fact grid: a label and the thing it names, never a label alone */
.zs-kv{ display:grid; grid-template-columns:minmax(88px,auto) minmax(0,1fr); gap:5px 14px; margin:0; }
.zs-kv dt{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3,#6C7480);
}
.zs-kv dd{ margin:0; font-size:12px; line-height:1.5; color:var(--ink,#ECEBE6); overflow-wrap:anywhere; }
.zs-kv dd .sub{ color:var(--ink-2,#9AA1AC); }
.zs-kv dd.mono, .zs-mono{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:11px; }

/* a row: one file, one note, one integration, one commit */
.zs-row{
  display:flex; gap:11px; align-items:flex-start;
  padding:9px 11px; border:1px solid var(--rule,#242C31); border-radius:var(--r-1,6px);
  background:var(--g3,#151A1D);
}
.zs-rows{ display:flex; flex-direction:column; gap:5px; }
.zs-mark{
  flex:none; min-width:26px; text-align:center; padding:2px 5px; border-radius:4px;
  border:1px solid var(--rule-2,#2C363B); background:var(--g4,#1B2124);
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.06em; color:var(--ink-2,#9AA1AC);
}
.zs-bd{ min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
.zs-top{ display:flex; align-items:baseline; gap:9px; justify-content:space-between; }
.zs-t{ font-size:12.5px; font-weight:600; color:var(--ink,#ECEBE6); min-width:0; overflow-wrap:anywhere; }
.zs-m{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:10.5px; line-height:1.55; color:var(--ink-3,#6C7480); overflow-wrap:anywhere;
}
.zs-w{ font-size:11.5px; line-height:1.55; color:var(--ink-2,#9AA1AC); overflow-wrap:anywhere; }

/* the three facts every integration row must state, as one line of chips */
.zs-facts{ display:flex; flex-wrap:wrap; gap:5px; margin-top:4px; }
.zs-f{
  font-family:var(--font-mono,ui-monospace,Consolas,monospace);
  font-size:9.5px; letter-spacing:.05em; padding:2px 7px; border-radius:4px;
  border:1px solid var(--rule-2,#2C363B); color:var(--ink-3,#6C7480);
}
.zs-f.gr{ color:var(--green,#5FBF8F); border-color:color-mix(in srgb,var(--green,#5FBF8F) 36%,var(--rule,#242C31)); }
.zs-f.am{ color:var(--amber,#E0A128); border-color:color-mix(in srgb,var(--amber,#E0A128) 40%,var(--rule,#242C31)); }
.zs-f.rd{ color:var(--red,#D9634F);   border-color:color-mix(in srgb,var(--red,#D9634F) 40%,var(--rule,#242C31)); }
.zs-f.cy{ color:var(--cyan,#38C3D6);  border-color:color-mix(in srgb,var(--cyan,#38C3D6) 38%,var(--rule,#242C31)); }

/* the amber-ruled standing note, the shape .tnote already uses */
.zs-note{ font-size:11.5px; color:var(--ink-2,#9AA1AC); display:flex; gap:8px; padding-left:2px; line-height:1.55; }
.zs-note::before{ content:""; width:3px; background:var(--amber,#E0A128); border-radius:2px; flex:none; }
.zs-note.cy::before{ background:var(--cyan,#38C3D6); }
.zs-note.gr::before{ background:var(--green,#5FBF8F); }
.zs-note.rd::before{ background:var(--red,#D9634F); }

.zs-acts{ display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
.zs-find{ display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
.zs-find input{
  flex:1; min-width:180px; font:inherit; font-size:12px;
  padding:7px 10px; border-radius:var(--r-1,6px);
  border:1px solid var(--rule-2,#2C363B); background:var(--g2,#0F1214); color:var(--ink,#ECEBE6);
}
.zs-find input::placeholder{ color:var(--ink-3,#6C7480); }
.zs-more{ font-family:var(--font-mono,ui-monospace,Consolas,monospace); font-size:10px; color:var(--ink-3,#6C7480); padding-left:2px; }
.zs-hr{ height:1px; background:var(--rule,#242C31); border:0; margin:2px 0; }
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ---- shared fragments ------------------------------------------------------ */

function plane(id, title, sub, body) {
  return '<section class="plane" aria-labelledby="' + esc(id) + '-h">'
    + '<div class="plane-head">'
    + '<h2 class="plane-h" id="' + esc(id) + '-h">' + esc(title) + '</h2>'
    + '<p class="plane-sub">' + esc(sub) + '</p>'
    + '</div><div class="plane-body"><div class="zs">' + body + '</div></div></section>';
}

function empty(glyph, title, sub) {
  return '<div class="empty"><span class="empty-glyph" aria-hidden="true">' + esc(glyph) + '</span>'
    + '<div><p class="empty-title">' + esc(title) + '</p>'
    + '<p class="empty-sub">' + esc(sub) + '</p></div></div>';
}

function note(text, channel) {
  return '<p class="zs-note' + (channel ? ' ' + esc(channel) : '') + '"><span>' + esc(text) + '</span></p>';
}

function kvs(pairs) {
  const rows = pairs.filter(Boolean).map(([k, v, mono]) =>
    '<dt>' + esc(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + v + '</dd>').join('');
  return '<dl class="zs-kv">' + rows + '</dl>';
}

function heading(t) { return '<p class="zs-k">' + esc(t) + '</p>'; }

function row(mark, title, meta, why, facts) {
  return '<div class="zs-row"><span class="zs-mark">' + esc(mark) + '</span><div class="zs-bd">'
    + '<div class="zs-top"><div class="zs-t">' + title + '</div></div>'
    + (meta ? '<p class="zs-m">' + meta + '</p>' : '')
    + (why ? '<p class="zs-w">' + esc(why) + '</p>' : '')
    + (facts ? '<div class="zs-facts">' + facts + '</div>' : '')
    + '</div></div>';
}

function fact(text, channel) { return '<span class="zs-f' + (channel ? ' ' + esc(channel) : '') + '">' + esc(text) + '</span>'; }

/** The read has not happened / could not happen. Never "there is nothing". */
function unread(what) {
  return empty('—', what + ' not loaded.',
    'This page has not read the daemon for this section yet. Treat it as unknown, not as empty — '
    + 'it fills in as soon as the read succeeds.');
}
function unreadable(what, err) {
  return empty('⚠', what + ' could not be read.',
    (err && err.message ? err.message + ' ' : '')
    + 'This is a failure to read, not an absence. Nothing below is a complete picture until it succeeds.');
}

/* ================================================================== *
 * WORKSTATION — the sandbox repository, exactly as git reports it     *
 * ================================================================== */

/* git's porcelain XY code, said in words. Anything unrecognised keeps its raw
   code and is called what it is — an unmapped code — rather than guessed at. */
function gitWord(code) {
  const c = String(code || '').trim();
  const map = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged', '??': 'untracked', '!!': 'ignored', AM: 'added, then modified', MM: 'modified, staged and again', RM: 'renamed, then modified' };
  return map[c] || null;
}

function renderWorkstation(st) {
  if (!st) return plane('sec-workstation', 'Workstation', WORDS.workstationSub, unread('The sandbox'));
  if (!st.ok) return plane('sec-workstation', 'Workstation', WORDS.workstationSub, unreadable('The sandbox', st.error));

  const d = st.data || {};
  const openBtn = '<div class="zs-acts"><button type="button" class="btn sm p" data-go="forge">Open in Forge</button>'
    + '<span class="zs-more">Forge proposes. A commit is still a separate approval.</span></div>';

  if (!d.repo) {
    return plane('sec-workstation', 'Workstation', WORDS.workstationSub,
      empty('○', 'The sandbox is not a git repository.',
        String(d.note || 'The daemon reported no repository at the sandbox path.'))
      + openBtn);
  }

  const changed = Array.isArray(d.changed) ? d.changed : [];
  const log = Array.isArray(d.log) ? d.log : [];
  const trackedTotal = Number.isFinite(d.trackedTotal) ? d.trackedTotal : null;
  const shown = Array.isArray(d.tracked) ? d.tracked.length : null;

  let body = kvs([
    ['branch', mk(d.branch || '(not reported)', 40), true],
    ['head', d.head ? mk(String(d.head), 40) : '<span class="sub">no commits yet — the sandbox has never been committed to</span>', true],
    ['uncommitted', changed.length
      ? '<span>' + changed.length + ' ' + plural(changed.length, 'file', 'files') + '</span>'
      : '<span class="sub">none — the working tree is clean</span>'],
    ['tracked', trackedTotal == null
      ? '<span class="sub">not reported</span>'
      : trackedTotal + ' ' + plural(trackedTotal, 'file', 'files') + (d.trackedCapped
        ? ' <span class="sub">· the daemon returned the first ' + shown + ', so any file list here is a part, not the whole</span>'
        : '')],
  ]);

  if (changed.length) {
    const cap = 14;
    body += heading('uncommitted changes')
      + '<div class="zs-rows">'
      + changed.slice(0, cap).map((c) => {
        const word = gitWord(c.status);
        return row(
          String(c.status || '·'),
          mk(c.path || '(no path reported)', 90),
          word ? esc(word) : 'git status code ' + esc(String(c.status || '?')) + ' — not one this window has words for',
          null, null,
        );
      }).join('')
      + '</div>'
      + (changed.length > cap ? '<p class="zs-more">+ ' + (changed.length - cap) + ' more, not listed here</p>' : '');
  }

  if (log.length) {
    body += heading('recent commits')
      + '<div class="zs-rows">'
      + log.map((c) => row(
        masked() ? '···' : String(c.sha || '·'),
        mk(c.summary || '(no message)', 96),
        null, null, null,
      )).join('')
      + '</div>';
  } else {
    body += note('No commit has been made in the sandbox yet, so there is no history to show. '
      + 'This is the repository as git reports it, not a cache.', 'cy');
  }

  body += openBtn;
  body += note(changed.length
    ? 'These files are on disk in the sandbox and nowhere else. Committing them is a T1 action that '
      + 'goes through the same gate as everything else, and it lands its own receipt.'
    : 'Nothing is staged and nothing is uncommitted. Every write into this repository arrives as an '
      + 'approval capsule first — the sandbox is never edited behind your back.');

  return plane('sec-workstation', 'Workstation', WORDS.workstationSub, body);
}

/* ================================================================== *
 * VAULT — governed local memory, and today's brief                    *
 * ================================================================== */

function noteRow(n, score, matched) {
  const tags = Array.isArray(n.tags) ? n.tags : [];
  const hide = masked();
  // Under the mask the SHAPE survives and the content does not: how many tags
  // there are is shape, what they say is content — and a tag is exactly the
  // kind of word that names a person or a client.
  const meta = [
    n.source ? 'source ' + (hide ? '████' : esc(String(n.source))) : null,
    ageOf(n.updatedAt || n.createdAt),
    tags.length ? tags.length + ' ' + plural(tags.length, 'tag', 'tags') + (hide ? '' : ': ' + esc(tags.join(', '))) : null,
    score != null ? 'score ' + esc(String(score)) : null,
    Array.isArray(matched) && matched.length
      ? 'matched: ' + (hide ? matched.length + ' ' + plural(matched.length, 'term', 'terms') : esc(matched.join(', ')))
      : null,
  ].filter(Boolean).join(' · ');
  return row('▪', mk(n.title || n.id || '(untitled note)', 90), meta, masked() ? null : clip(String(n.body || ''), 190), null);
}

function renderVault(mem, brief, query) {
  const sub = WORDS.vaultSub;
  if (!mem) return plane('sec-vault', 'Vault', sub, unread('Memory'));

  // A daemon started without a vault directory answers 404 no-vault. That is a
  // configuration fact, not a read failure, and it is said as one.
  if (!mem.ok && mem.status === 404 && mem.error && mem.error.code === 'no-vault') {
    return plane('sec-vault', 'Vault', sub,
      empty('○', 'Governed memory is not enabled on this daemon.',
        String(mem.error.message || '') + ' ' + String(mem.error.resolve || ''))
      + note('Nothing is remembered and nothing can be recalled. This is the daemon saying it has no '
        + 'vault, not this window failing to read one.', 'cy'));
  }
  if (!mem.ok) return plane('sec-vault', 'Vault', sub, unreadable('Memory', mem.error));

  const d = mem.data || {};
  const searching = typeof d.query === 'string' && d.query !== '';
  const hits = Array.isArray(d.hits) ? d.hits : null;
  const notes = Array.isArray(d.notes) ? d.notes : null;

  let body = '<div class="zs-find">'
    + '<input type="search" id="zs-vq" placeholder="Search your memory — the daemon\'s own recall" '
    + 'aria-label="Search governed memory" value="' + esc(query || '') + '">'
    + '<button type="button" class="btn sm p" data-vault-find="1">Search</button>'
    + (searching ? '<button type="button" class="btn sm g" data-vault-clear="1">Clear</button>' : '')
    + '</div>'
    + note('The query goes to this daemon on 127.0.0.1 and nowhere else. Recall is a plain term match, '
      + 'so every result shows the terms it matched on and its score — a memory you cannot trace is a '
      + 'rumour, and the Vault does not deal in rumours.', 'cy');

  if (searching) {
    body += heading('results for “' + clip(d.query, 40) + '” · ' + (hits ? hits.length : 0));
    body += hits && hits.length
      ? '<div class="zs-rows">' + hits.map((h) => noteRow(h.note || {}, h.score, h.matched)).join('') + '</div>'
      : empty('○', 'No note matched that.',
        'The search ran and came back with nothing. That is an answer about your memory, not a failure to read it.');
  } else if (notes) {
    body += heading('recent notes · ' + notes.length);
    body += notes.length
      ? '<div class="zs-rows">' + notes.map((n) => noteRow(n)).join('') + '</div>'
        + '<p class="zs-more">The daemon returns the 50 most recent; search reaches the rest.</p>'
      : empty('○', 'Your memory is empty.',
        'The vault was read and holds no notes. Anything Zeno is told to remember is written here as a '
        + 'file on this disk, redacted for secrets before it is stored.');
  }

  /* ---- the brief. It is a second read, and it fails on its own. ---- */
  body += '<hr class="zs-hr">' + heading('today’s brief');
  if (!brief) {
    body += unread('The brief');
  } else if (!brief.ok) {
    body += unreadable('The brief', brief.error);
  } else {
    const b = (brief.data && brief.data.brief) || {};
    const sources = Array.isArray(b.sources) ? b.sources : [];
    const missing = Array.isArray(b.missing) ? b.missing : [];
    const any = sources.some((s) => Array.isArray(s.items) && s.items.length);
    body += kvs([
      ['status', b.status === 'complete'
        ? '<span>complete — every source answered</span>'
        : '<span class="sub">partial — at least one source could not be reached</span>'],
      ['built', b.at ? esc(ageOf(b.at) || String(b.at)) : '<span class="sub">not reported</span>'],
    ]);
    if (any) {
      body += '<div class="zs-rows">' + sources.map((s) => {
        const items = Array.isArray(s.items) ? s.items : [];
        if (!items.length) return '';
        return items.map((i) => row('·', mk(i.text || '', 110),
          [esc(String(i.source || s.name || '')), esc(String(i.age || ''))].filter(Boolean).join(' · '), null, null)).join('');
      }).join('') + '</div>';
    } else {
      body += empty('○', 'The brief has nothing in it.',
        'Every source it asked answered, and none of them had anything to report. That is a quiet '
        + 'morning, not a missing brief.');
    }
    if (missing.length) {
      body += note(missing.length + ' ' + plural(missing.length, 'source', 'sources') + ' could not be reached: '
        + missing.join(', ') + '. The brief above is short by an unknown amount.', 'rd');
    }
  }

  return plane('sec-vault', 'Vault', sub, body);
}

/* ================================================================== *
 * INTEGRATIONS — what this Zeno is actually connected to              *
 * ================================================================== *
 * Every row states three things and never fewer:
 *   configured   was it set up at all
 *   reachable    did it answer, and does this window actually know
 *   egress       does using it leave this machine
 * A row that cannot honestly answer one of the three says "not reported" for
 * that one. That is the whole point of the section.
 */

function sourceRow(s) {
  const configured = s.state !== 'not-configured';
  /* EGRESS IS A PROPERTY OF THE SOURCE, NOT OF ITS CONFIGURATION. Reading it
     off `configured` said "stays on this machine" about GitHub — true only in
     the sense that an unasked question never left the room, and exactly the
     reassurance a reader must not be given by accident. The local backlog is
     the one source on this disk; every other one is somewhere else, whether or
     not it has been switched on yet. */
  const remote = s.name !== 'local';
  const facts =
    fact(configured ? 'configured' : 'not configured', configured ? 'gr' : null)
    + fact(
      s.state === 'ok' ? 'answered in full'
        : s.state === 'partial' ? 'answered in part'
          : s.state === 'failed' ? 'did not answer'
            : 'never asked',
      s.state === 'ok' ? 'gr' : s.state === 'partial' ? 'am' : s.state === 'failed' ? 'rd' : null,
    )
    + fact(
      !remote ? 'stays on this machine'
        : configured ? '⚡ leaves this machine'
          : '⚡ would leave this machine — nothing has been sent',
      !remote ? 'gr' : configured ? 'am' : null,
    );
  const meta = [
    s.count == null ? 'contributed nothing' : s.count + ' ' + plural(s.count, 'item', 'items') + ' contributed',
    s.reason ? esc(String(s.reason)) : null,
  ].filter(Boolean).join(' · ');
  return row('SRC', mk(s.name || 'a work source', 44), meta, s.detail ? String(s.detail) : null, facts);
}

function renderIntegrations(work, agents) {
  const sub = WORDS.integrationsSub;
  let body = '';

  /* ---- 1 · work sources ---- */
  body += heading('work sources');
  if (!work) body += unread('Work sources');
  else if (!work.ok) body += unreadable('Work sources', work.error);
  else {
    const sources = (work.data && Array.isArray(work.data.sources)) ? work.data.sources : [];
    body += sources.length
      ? '<div class="zs-rows">' + sources.map(sourceRow).join('') + '</div>'
      : empty('○', 'No work source is configured.',
        'The daemon reported no sources at all — not even the local backlog. Nothing is being polled.');
  }

  /* ---- 2 · the local model runtime ---- */
  body += '<hr class="zs-hr">' + heading('local model runtime');
  if (!agents) body += unread('The local runtime');
  else if (!agents.ok) body += unreadable('The local runtime', agents.error);
  else {
    const models = (agents.data && Array.isArray(agents.data.localModels)) ? agents.data.localModels : [];
    /* THE HONEST LIMIT: /forge/agents returns an empty localModels both when
       Ollama is not running and when it is running with nothing pulled. The
       route does not distinguish them, so neither does this row. */
    const facts =
      fact('configured', 'gr')
      + fact(models.length ? 'answered · ' + models.length + ' ' + plural(models.length, 'model', 'models') + ' installed' : 'answered with no models — or did not answer', models.length ? 'gr' : 'am')
      + fact('stays on this machine', 'gr');
    body += '<div class="zs-rows">' + row(
      'OLL', 'Ollama',
      '127.0.0.1:11434 · the daemon asks over HTTP, never the ollama binary',
      models.length
        ? 'The daemon listed installed models, so Ollama answered on this machine. A local run reaches nothing outside it.'
        : 'The daemon listed no models. That is the same answer whether Ollama is stopped or running with '
          + 'nothing pulled — this route cannot tell the two apart, so neither can this row. Pull a model '
          + '(ollama pull qwen3:8b) and re-check.',
      facts,
    ) + '</div>';
    if (models.length) {
      body += '<div class="zs-rows">' + models.map((m) => row('▸', mk(m, 44), 'installed locally', null, null)).join('') + '</div>';
    }
    body += '<div class="zs-acts"><button type="button" class="btn sm g" data-recheck="1">Re-check the runtime</button>'
      + '<span class="zs-more">Asks the daemon again. Nothing leaves 127.0.0.1.</span></div>';

    /* ---- 3 · the coding agents the daemon offers ---- */
    const list = (agents.data && Array.isArray(agents.data.agents)) ? agents.data.agents : [];
    if (list.length) {
      body += '<hr class="zs-hr">' + heading('coding agents Forge can run');
      body += '<div class="zs-rows">' + list.map((a) => {
        const local = a.id === 'local';
        return row(
          local ? 'LOC' : 'EXT',
          esc(String(a.label || a.id || 'an agent')),
          'id ' + esc(String(a.id || '?')) + (Array.isArray(a.models) && a.models.length ? ' · models: ' + esc(a.models.join(', ')) : ''),
          local
            ? 'Runs against Ollama on this machine.'
            : 'Runs the agent’s own CLI, which reaches its own provider. Whether that CLI is installed here '
              + 'is not reported by any route — the daemon offers the id, and the run itself is what finds out.',
          fact('offered by the daemon', 'gr')
          + fact(local ? 'reachable if Ollama is' : 'installation not reported', local ? 'gr' : null)
          + fact(local ? 'stays on this machine' : '⚡ reaches its own provider', local ? 'gr' : 'am'),
        );
      }).join('') + '</div>';
    }
  }

  /* ---- 4 · the two things with no data source. Stated, never stubbed. ---- */
  body += '<hr class="zs-hr">' + heading('no route reports these');
  body += '<div class="zs-rows">'
    + row('MCP', 'The MCP edge',
      'a separate stdio process · zeno-mcp',
      'The MCP server is its own binary that an MCP client starts over stdio. It is not this daemon and '
      + 'has no HTTP route here, so this window cannot say whether a client is connected. What is fixed '
      + 'either way: it exposes tools that propose and read, and there is deliberately no approve tool.',
      fact('separate process') + fact('not visible from here', 'am') + fact('stdio — no socket'))
    + row('SKL', 'Installed skills',
      'no route',
      'The skills library is built, but this daemon serves no endpoint that lists what is installed. '
      + 'Rather than draw a plausible list, this section says there is nothing to read.',
      fact('not served') + fact('not reported', 'am') + fact('egress unknown'))
    + '</div>';

  body += note('A source is read-only: it can be cited, never obeyed. Nothing on this list can approve '
    + 'anything, and the ⚡ rows are the only ones whose use leaves this machine at all.');

  return plane('sec-integrations', 'Integrations', sub, body);
}

/* ================================================================== *
 * SETTINGS — the rules in force, the two tokens, and this window      *
 * ================================================================== */

/* A preference row. The control itself is the top bar's — this button forwards
   the click to it rather than keeping a second copy of the state, which is how
   two readouts of one setting start disagreeing. */
function prefRow(id, label, value, why) {
  return '<div class="zs-row"><span class="zs-mark">·</span><div class="zs-bd">'
    + '<div class="zs-top"><div class="zs-t">' + esc(label) + '</div></div>'
    + '<p class="zs-m">' + esc(value) + '</p>'
    + '<p class="zs-w">' + esc(why) + '</p>'
    + '<div class="zs-facts">' + fact('stored on this device only') + fact('never synced', 'cy') + '</div>'
    + '<div class="zs-acts"><button type="button" class="btn sm g" data-ctl="' + esc(id) + '">Change</button></div>'
    + '</div></div>';
}

function renderSettings(state) {
  const sub = WORDS.settingsSub;
  let body = '';

  /* ---- 1 · the rules that were actually in force ---- */
  body += heading('policy');
  if (!state) body += unread('Policy');
  else if (!state.ok) body += unreadable('Policy', state.error);
  else {
    const receipts = (state.data && Array.isArray(state.data.receipts)) ? state.data.receipts : [];
    const chain = (state.data && state.data.chain) || null;
    const newest = receipts.length ? receipts[receipts.length - 1] : null;
    const ph = newest && newest.policyHash ? String(newest.policyHash) : null;
    body += kvs([
      ['policy hash', ph
        ? mk(ph, 80)
        : '<span class="sub">no receipt has been written yet, so no policy hash has been recorded. '
          + '/state does not report the policy directly — this is read off the newest receipt, which '
          + 'records the rules that governed it.</span>', !!ph],
      ['read from', ph
        ? 'the newest receipt (' + mk(String(newest.id || 'no id'), 40) + ')'
        : '<span class="sub">nothing — there is no receipt to read it from</span>', !!ph],
      ['receipts', String(receipts.length)],
      ['chain', chain
        ? (chain.ok
          ? '<span>verified — every link hashes to the one before it</span>'
          : '<span class="sub">BROKEN at entry ' + esc(String(chain.firstBreakAt)) + '</span>')
        : '<span class="sub">not reported</span>'],
    ]);
  }

  /* ---- 2 · the two capability tokens. Presence only. ---- */
  const hasOwner = token() !== '';
  body += '<hr class="zs-hr">' + heading('capability tokens');
  body += '<div class="zs-rows">'
    + row('OWN', 'Owner token',
      hasOwner ? 'present in this window' : 'absent — this page was not launched with the nonce',
      hasOwner
        ? 'This window holds it, so it may approve, commit, delete a recording and start a pairing. '
          + 'Its value is never rendered, never logged and is not in this page’s text.'
        : 'Without it this page can read but not approve. Open Zeno from the launch link the daemon printed.',
      fact(hasOwner ? 'held by this window' : 'not held', hasOwner ? 'gr' : 'am')
      + fact('may approve') + fact('value never shown', 'cy'))
    + row('PRP', 'Proposer token',
      'never sent to this window',
      'Every agent holds this one. It may propose and read, and POST /approvals rejects it outright — '
      + 'that is law L6 as topology rather than as a rule people agree to follow. The daemon prints it '
      + 'on startup; this window has no copy and could not show one.',
      fact('held by agents') + fact('may never approve', 'gr') + fact('not in this page', 'cy'))
    + '</div>';

  /* ---- 3 · this window's own preferences ---- */
  const themeAttr = R.getAttribute('data-theme');
  body += '<hr class="zs-hr">' + heading('display · this device only');
  body += '<div class="zs-rows">'
    + prefRow('ctl-theme', 'Theme', themeAttr === 'dark' ? 'dark' : themeAttr === 'light' ? 'light' : 'follow the system',
      'Cycles system → dark → light. Stored in this browser profile and never synced.')
    + prefRow('ctl-motion', 'Motion', R.getAttribute('data-reduce') === '1' ? 'reduced — the field does not animate' : 'on — the field breathes and drifts',
      'An explicit choice here beats the operating system’s reduce-motion setting, in both directions.')
    + prefRow('ctl-flat', '2D', R.getAttribute('data-flat') === '1' ? 'flattened — the field is drawn face-on' : 'off — the field is drawn in depth',
      'Flattening removes the tilt and the rotation. It changes the picture, never the nodes in it.')
    + prefRow('ctl-mask', 'Masked', masked() ? 'on — identifiers are redacted on screen' : 'off',
      'Masking hides titles, paths and hashes. Counts and shape always survive: hiding that something is '
      + 'waiting on you is the one thing masking must not do.')
    + '</div>';

  /* ---- 4 · where this daemon is, and what it will not tell this window ---- */
  let origin = '';
  try { origin = String(location.origin || ''); } catch { origin = ''; }
  let port = '';
  try { port = String(location.port || (location.protocol === 'https:' ? '443' : '80')); } catch { port = ''; }
  body += '<hr class="zs-hr">' + heading('daemon');
  body += kvs([
    ['origin', origin ? esc(origin) : '<span class="sub">not readable</span>', true],
    ['port', port ? esc(port) : '<span class="sub">not readable</span>', true],
    ['bound to', 'loopback only — the socket is not reachable from the network'],
    ['ledger path', '<span class="sub">not served. No route reports where the ledger file lives, so this '
      + 'window cannot show you a path it has not been told. The daemon prints it on startup, and the CLI '
      + 'reads the same file.</span>'],
  ]);
  body += note('The origin and port above are read from this page’s own address bar — they are where this '
    + 'window is actually talking, not a configured value someone typed.', 'cy');

  return plane('sec-settings', 'Settings', sub, body);
}

/* ---- the standing sentences, in one place so they cannot drift ------------- */
const WORDS = {
  workstationSub: 'The sandbox repository as git reports it right now — the branch, the commit under it, '
    + 'and every file that has changed and not yet been committed.',
  vaultSub: 'Governed local memory. Notes are files on this disk, redacted for secrets before they are '
    + 'written, and recall shows the terms it matched on.',
  integrationsSub: 'Everything this Zeno is connected to, and for each one: whether it is configured, '
    + 'whether it answered, and whether using it leaves this machine.',
  settingsSub: 'The rules that were in force, the two capabilities that make approval structural, and '
    + 'what this particular window has been told.',
};

/* ================================================================== *
 * state, painting and the one control that sends anything             *
 * ================================================================== */

const S = {
  forge: null,      // GET /forge/status
  mem: null,        // GET /memory  (or /memory?q=)
  brief: null,      // GET /brief
  work: null,       // GET /work
  agents: null,     // GET /forge/agents
  state: null,      // GET /state
  query: '',        // the Vault search box's current query
  agentsAt: 0,      // when the runtime was last asked — it pokes Ollama, so it is not polled hard
};

function mount(name) { return document.querySelector('[data-mount="' + name + '"]'); }
function paint(name, html) { const el = mount(name); if (el) el.innerHTML = html; }

/* A repaint replaces the search box, which would eat what is being typed into
   it on the next poll. So the Vault is left alone while its box has focus: the
   data behind it is still refreshed and lands on the next paint. */
function typing() {
  const a = document.activeElement;
  return !!(a && a.id === 'zs-vq');
}

function repaint() {
  paint('sec-workstation', renderWorkstation(S.forge));
  if (!typing()) paint('sec-vault', renderVault(S.mem, S.brief, S.query));
  paint('sec-integrations', renderIntegrations(S.work, S.agents));
  paint('sec-settings', renderSettings(S.state));
}

/* After a search, the box is redrawn — put the cursor back in it, or the second
   query has to be started by finding the box again with the mouse. */
function repaintAndFocusSearch() {
  paint('sec-workstation', renderWorkstation(S.forge));
  paint('sec-vault', renderVault(S.mem, S.brief, S.query));
  paint('sec-integrations', renderIntegrations(S.work, S.agents));
  paint('sec-settings', renderSettings(S.state));
  const input = document.getElementById('zs-vq');
  if (input && input.focus) {
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* not a text input */ }
  }
}

/* /forge/agents makes the daemon poke Ollama, so it is asked at boot, on an
   explicit re-check, and at most once a minute after that. Every other read is
   a cheap local one and polls with the rest of the surface. */
const AGENTS_MIN_MS = 60000;

let reading = false;
let queued = null;   // a click that arrived mid-poll — dropped, it would look like the click did nothing

async function refresh(opts) {
  if (reading) {
    // A search typed while the 15s poll was in flight must not be swallowed:
    // remember it and run it the moment the poll lands.
    if (opts) queued = Object.assign({}, queued || {}, opts);
    return;
  }
  reading = true;
  try {
    const wantAgents = (opts && opts.agents) || S.agents === null || (Date.now() - S.agentsAt) > AGENTS_MIN_MS;
    const memPath = S.query ? '/memory?q=' + encodeURIComponent(S.query) : '/memory';
    const [forge, mem, brief, work, state, agents] = await Promise.all([
      api('/forge/status'),
      api(memPath),
      api('/brief'),
      api('/work'),
      api('/state'),
      wantAgents ? api('/forge/agents') : Promise.resolve(S.agents),
    ]);
    // Each read is settled on its own: a vault that is not enabled must not
    // blank the workstation, and a failed brief must not blank the notes.
    S.forge = forge; S.mem = mem; S.brief = brief; S.work = work; S.state = state;
    if (wantAgents) { S.agents = agents; S.agentsAt = Date.now(); }
    if (opts && opts.focusSearch) repaintAndFocusSearch(); else repaint();
  } finally {
    reading = false;
    if (queued) { const q = queued; queued = null; refresh(q); }
  }
}

/* ---- the controls. One GET, and four clicks that forward to the top bar. --- */
function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('[data-vault-find]')) {
      const input = document.getElementById('zs-vq');
      S.query = input ? String(input.value || '').trim() : '';
      refresh({ focusSearch: true });
      return;
    }
    if (t.closest('[data-vault-clear]')) {
      S.query = '';
      refresh({ focusSearch: true });
      return;
    }
    if (t.closest('[data-recheck]')) {
      S.agents = null;
      refresh({ agents: true });
      return;
    }
    // A preference is owned by the top bar's control. Clicking it there is the
    // single source of truth; this button forwards rather than keeping a second
    // copy of the state that could drift from it.
    const ctl = t.closest('[data-ctl]');
    if (ctl) {
      const b = document.getElementById(ctl.getAttribute('data-ctl'));
      if (b) b.click();
      repaint();
    }
  });

  // Enter in the search box searches, and does not submit anything anywhere.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (!el || el.id !== 'zs-vq') return;
    e.preventDefault();
    S.query = String(el.value || '').trim();
    refresh({ focusSearch: true });
  });
}

/* ---- boot ------------------------------------------------------------------ */
let started = false;
export function init() {
  if (started) return; started = true;
  if (!mount('sec-workstation')) return;   // the shell does not have these sections
  ensureStyles();
  repaint();                            // the honest "not loaded" state, first
  wire();
  refresh();

  window.addEventListener('zeno:state', () => { refresh(); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);

  // Masking changes what may be shown, not what is true: repaint from state
  // already in hand. This never re-reads and never re-counts.
  try {
    new MutationObserver(() => repaint())
      .observe(R, { attributes: true, attributeFilter: ['data-lock', 'data-theme', 'data-reduce', 'data-flat'] });
  } catch { /* no MutationObserver: the sections simply do not repaint on a toggle */ }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
else init();

export default { init };
