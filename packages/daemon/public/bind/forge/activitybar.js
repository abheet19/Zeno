/**
 * bind/forge/activitybar.js — the activity-bar side views that are not the
 * Explorer/SCM (owned by forge/explorer.js): Testing, Debug, the sidebar's
 * other Ports view, Extensions, and the Zeno view (rules/skills/schedule/
 * connectors).
 *
 * Each of these replaces a fully-fabricated artifact fixture (a green test
 * suite that never ran, an installed-extensions marketplace nothing here
 * backs, invented schedule times) with either a real daemon read or an
 * honest "not available in this build" — never a placeholder left standing.
 *
 * Owns `S.selectedSkillIds`: the Zeno view's skill checkboxes are the REAL
 * selection session.js's `sendTask`/`runResolved` send as `skillIds`.
 */
import {
  $, el, fill, getJSON,
} from '../../bind.js';
import {
  add, bytesLabel, disableCtl, fileMeta, postJSON, setTrailingText,
} from './dom.js';

export function setupActivityBar(S) {
  const ide = S.ide;

  /* ============================================================ *
   * TESTING view — the real script catalog (GET /forge/tests)      *
   * ============================================================ *
   * The artifact ships this view already reporting a GREEN SUITE:
   * a tick beside "tests/ingest.spec.ts", a named passing test, and
   * "142 passed · exited 0 · 3.1s". Nothing ran. That file is not in
   * the workspace and never was. A fabricated PASS is the worst thing
   * this window can draw — it is the one claim an owner acts on
   * without checking — so the fixture is cleared unconditionally the
   * instant this binder runs, before any fetch can succeed or fail.
   *
   * What replaces it is GET /forge/tests: the package.json scripts the
   * daemon actually discovered in the workspace, and only the ones it is
   * willing to run. A run goes through POST /forge/tests/run (owner
   * only, one at a time, no command or arguments from the browser) and
   * what is drawn afterwards is that answer's own exit code, duration
   * and output. Nothing on this panel is summarised into a verdict
   * here; "142 passed" can only ever be words the run itself printed.
   *
   * Read lazily — the catalog is a directory walk of the workspace, so it
   * happens when the view is opened or refreshed, not on every boot.
   */
  const testingView = $('.vsside .vsview[data-vsview="testing"]', ide);
  if (testingView) {
    const testPad = $('.vspad', testingView);
    // "Run All Tests" has no route behind it: the daemon runs ONE declared
    // script at a time, addressed by id. A control that cannot do what its
    // label says is worse than no control, so it goes.
    const runAllBtn = testingView.querySelector('button[title="Run All Tests"]');
    if (runAllBtn) runAllBtn.remove();

    let testsData = null, testsErr = null, testsBusy = false, testsRead = false;
    const testRuns = new Map(); // script id -> the daemon's own answer, verbatim

    function renderTests() {
      if (!testPad) return;
      if (!testsRead) { fill(testPad, el('div', 'fempty', 'Open this view to read the workspace’s package scripts.')); return; }
      if (testsErr) { fill(testPad, el('div', 'fempty', `The script catalog could not be read: ${testsErr}`)); return; }
      if (!testsData) { fill(testPad, el('div', 'fempty', 'Reading the workspace’s package scripts…')); return; }
      const scripts = Array.isArray(testsData.scripts) ? testsData.scripts : [];
      if (!scripts.length) {
        fill(testPad,
          el('div', 'fempty', 'No package.json in this workspace declares a test, check, typecheck or lint script, so Forge has nothing here to run.'),
          el('div', 'vsnote', testsData.note || ''));
        return;
      }
      const nodes = [];
      for (const s of scripts) {
        const row = el('div', 'vsfile');
        add(row, el('b', null, `${s.packageName || s.packagePath || 'package'} · ${s.script}`), el('span', 'fm', ` ${s.displayCommand || ''}`));
        const runBtn = el('button', 'laction cy', testsBusy ? 'Running…' : 'Run');
        runBtn.type = 'button';
        runBtn.disabled = testsBusy || !S.OWNER;
        runBtn.title = S.OWNER
          ? 'Runs exactly this declared script through the daemon. The result below is its own exit code and output.'
          : 'This window has no owner token, so it can list scripts but cannot run one.';
        runBtn.addEventListener('click', () => void runTestScript(s.id));
        add(row, runBtn);
        nodes.push(row);
        const r = testRuns.get(s.id);
        if (!r) {
          nodes.push(el('div', 'vsnote', 'Not run in this session — this says nothing about whether it passes.'));
        } else if (r.error) {
          nodes.push(el('div', 'vsnote', `The run could not be started: ${r.error}`));
        } else {
          const verdict = r.failedToSpawn
            ? (r.timedOut ? 'timed out' : 'could not start')
            : `exited ${r.code} · ${r.durationMs}ms`;
          nodes.push(el('div', 'vsnote', `${r.displayCommand || s.displayCommand || s.script} — ${verdict}`));
          const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
          if (out) {
            const pre = el('pre', 'fterm', out.slice(-4000));
            pre.style.cssText = 'margin:4px 0;max-height:180px;overflow:auto;white-space:pre-wrap';
            nodes.push(pre);
          }
          if (r.outputClipped) nodes.push(el('div', 'vsnote', 'The daemon clipped this output — it is not the whole log.'));
        }
      }
      nodes.push(el('div', 'vsnote', testsData.note || ''));
      fill(testPad, ...nodes);
    }

    async function loadTests() {
      testsRead = true;
      const r = await getJSON('/forge/tests');
      if (r.ok) { testsData = r.data; testsErr = null; } else { testsData = null; testsErr = r.error || 'could not be read'; }
      renderTests();
    }

    async function runTestScript(id) {
      if (testsBusy) return;
      testsBusy = true;
      renderTests();
      const r = await postJSON('/forge/tests/run', { id });
      testsBusy = false;
      testRuns.set(id, r.ok ? r.data : { error: r.error });
      renderTests();
    }
    // The menu bar's Run Tests / Run Task… and Quick Open's `task ` mode use
    // this same catalog and runner, so a task run always lands in this view.
    S.loadTests = loadTests;
    S.listTestScripts = () => (testsData && Array.isArray(testsData.scripts) ? testsData.scripts : (testsErr ? [] : null));
    S.openTesting = () => { const b = $('.vsact [data-vsview="testing"]', ide); if (b) b.click(); if (!testsData) void loadTests(); };
    S.runTestScript = async (id) => { S.openTesting(); await runTestScript(id); };

    // Clear the fabricated green suite NOW; the real catalog arrives when the
    // view is opened. Nothing invented stands for even one frame.
    renderTests();
    const testsRefresh = testingView.querySelector('button[title="Refresh"]');
    if (testsRefresh) testsRefresh.addEventListener('click', (e) => { e.stopPropagation(); void loadTests(); });
    const testsActBtn = $('.vsact [data-vsview="testing"]', ide);
    if (testsActBtn) testsActBtn.addEventListener('click', () => { if (!testsData) void loadTests(); });
  }

  // The activity bar's "Accounts" and the title bar's avatar: Zeno is a
  // single-user, local product — there is no account to sign in to and no
  // profile behind either. Both had no listener; both now say so.
  const noAccount = S.OWNER
    ? 'Zeno is single-user and local — this window holds the owner token, and there is no account to sign in to.'
    : 'Zeno is single-user and local — there is no account to sign in to. This window is read-only (no owner token).';
  // By position, not title: bind/controls.js also switches the Accounts icon
  // off (retitling it), the two binders load in parallel, and whichever runs
  // second must still find it.
  disableCtl($('.vsact button:not([data-vsview]):not([data-open-settings])', ide), noAccount);
  disableCtl($('.tb .tbavatar', ide), noAccount);

  // Debug view + Debug menu — grepped this whole daemon: there is no debug
  // route (no /forge/debug, no launch-config concept anywhere in server.ts).
  // The Run menu's own "Start Debugging"/"Run Without Debugging" already say
  // "no launch.json" and are disabled for exactly that reason; this sidebar
  // button was the one place that same honest claim was still missing.
  const debugView = $('.vsside .vsview[data-vsview="debug"] .vspad', ide);
  if (debugView) {
    const debugBtn = debugView.querySelector('button');
    if (debugBtn) {
      debugBtn.disabled = true;
      debugBtn.title = 'Zeno has no debugger; there is no debug route.';
    }
  }

  // The sidebar's OTHER "Ports" view (data-vsview="remote" — distinct from
  // the bottom drawer's ports tab already handled by forge/terminal.js) ships
  // the same three fabricated rows plus a "Forward a Port" button with no
  // real forwarding capability behind it anywhere in this daemon.
  const remoteView = $('.vsside .vsview[data-vsview="remote"] .vspad', ide);
  if (remoteView) {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80');
    const row = el('div', 'fchg');
    add(row, el('span', 'fdot ok'), document.createTextNode(` ${port} `), el('span', 'fm', `Zeno daemon · ${location.hostname}`));
    const note = el('div', 'vsnote', 'Forge cannot observe or forward other ports from the browser.');
    const fwd = el('button', 'btn g sm', 'Forward a Port');
    fwd.type = 'button';
    fwd.disabled = true;
    fwd.title = 'Not available in this build.';
    fill(remoteView, row, note, fwd);
  }

  /* ============================================================ *
   * EXTENSIONS view — the real capability catalog                 *
   * ============================================================ *
   * GET /forge/extensions returns Zeno's own catalog: the handful of
   * bundled capabilities that are actually enabled (the Monaco core, the
   * glass themes, bracket colouring), the skills this machine can see
   * (with provenance and screening verdict), and any VS Code snippet
   * files found on disk. There is no VS Code Marketplace and no external
   * extension host here — the artifact's "ESLint / Prettier / GitLens /
   * Zeno Governance / Error Lens, installed" plus a Tailwind/Vitest/
   * Python/Docker/C++ marketplace with working "Install" buttons was
   * entirely invented, none of it backed by anything this daemon runs.
   * Dropped unconditionally, same as every other fabricated fixture on
   * this screen, and replaced with the real catalog, read lazily (like
   * Testing, above) when the view is opened.
   */
  const extensionsView = $('.vsside .vsview[data-vsview="extensions"]', ide);
  if (extensionsView) {
    const extHeader = $('.vsvh', extensionsView);
    const filterBtn = extHeader ? extHeader.querySelector('button[title="Filter Extensions"]') : null;
    const extMoreBtn = extHeader ? extHeader.querySelector('button[title="Views and More Actions"]') : null;
    let extNode = extHeader ? extHeader.nextElementSibling : null;
    while (extNode) { const next = extNode.nextElementSibling; extNode.remove(); extNode = next; }
    const searchIn = el('input', 'vsinput');
    searchIn.placeholder = 'Filter this catalog';
    const padWrap = el('div', 'vspad');
    add(padWrap, searchIn);
    const listWrap = el('div');
    if (extHeader) {
      extHeader.insertAdjacentElement('afterend', listWrap);
      extHeader.insertAdjacentElement('afterend', padWrap);
    }
    if (filterBtn) filterBtn.addEventListener('click', (e) => { e.stopPropagation(); searchIn.focus(); });
    disableCtl(extMoreBtn, 'No extension actions in this build.');

    function extSectHead(text) {
      const h = el('div', 'vssect open');
      add(h, el('span', 'chev', '▾'), document.createTextNode(text));
      return h;
    }
    let extData = null, extErr = null, extRead = false;
    function renderExtensions() {
      const q = searchIn.value.trim().toLowerCase();
      const matches = (s) => !q || String(s || '').toLowerCase().includes(q);
      if (!extRead) { fill(listWrap, el('div', 'fempty', 'Open this view to read Zeno’s capability catalog.')); return; }
      if (extErr) { fill(listWrap, el('div', 'fempty', `The catalog could not be read: ${extErr}`)); return; }
      if (!extData) { fill(listWrap, el('div', 'fempty', 'Reading the catalog…')); return; }
      const nodes = [];

      const builtins = (Array.isArray(extData.builtins) ? extData.builtins : []).filter((b) => matches(b.name) || matches(b.kind));
      nodes.push(extSectHead(`BUILT IN · ${builtins.length}`));
      if (!builtins.length) nodes.push(el('div', 'vsnote', q ? 'No built-in capability matches.' : 'None.'));
      for (const b of builtins) {
        const row = el('div', 'vsext');
        const icon = el('span', 'vsxi', String(b.name || '?').slice(0, 2).toUpperCase());
        const body = el('span', 'vsxb');
        add(body, el('b', null, b.name || b.id), el('span', null, `${b.provenance || ''}${Array.isArray(b.variants) ? ` · ${b.variants.join(', ')}` : ''}`));
        add(row, icon, body, el('span', 'pill gr', b.status === 'enabled' ? 'enabled' : String(b.status || '—')));
        row.title = Array.isArray(b.permissions) && b.permissions.length ? b.permissions.join('; ') : 'No permissions beyond the existing Zeno gate.';
        nodes.push(row);
      }

      const skills = (Array.isArray(extData.skills) ? extData.skills : []).filter((s) => matches(s.name) || matches(s.provenance));
      nodes.push(extSectHead(`SKILLS VISIBLE TO THIS MACHINE · ${skills.length}`));
      if (!skills.length) nodes.push(el('div', 'vsnote', q ? 'No skill matches.' : 'No skills found on this machine.'));
      for (const s of skills) {
        const row = el('div', 'vsext');
        const icon = el('span', 'vsxi', s.status === 'unreadable' ? '!' : String(s.name || s.id || '?').slice(0, 2).toUpperCase());
        const body = el('span', 'vsxb');
        add(body, el('b', null, s.name || s.id), el('span', null, `${s.provenance || ''}${s.selectableInThisRepository ? ' · selectable this run' : ' · reference only'}`));
        add(row, icon, body);
        if (s.status === 'unreadable') {
          add(row, el('span', 'pill rd', 'unreadable'));
          row.title = s.reason || 'Could not be parsed.';
        } else {
          add(row, el('span', s.verdict === 'suspicious' ? 'pill am' : 'pill gr', s.verdict === 'suspicious' ? 'flagged' : 'screened'));
          row.title = s.description || s.authority || '';
        }
        nodes.push(row);
      }

      const snippets = Array.isArray(extData.snippets) ? extData.snippets : [];
      if (snippets.length) {
        nodes.push(extSectHead(`SNIPPET FILES ON DISK · ${snippets.length}`));
        for (const sn of snippets) {
          const row = el('div', 'vsfile');
          add(row, el('span', 'vsi txt', '≡'), document.createTextNode(sn.file),
            el('span', 'vsmod', sn.status === 'unreadable' ? 'unreadable' : `${sn.entries} snippet${sn.entries === 1 ? '' : 's'}`));
          row.title = `${sn.provenance}${sn.enabledInMonaco ? '' : ' — not loaded into this editor'}`;
          nodes.push(row);
        }
      }

      nodes.push(el('div', 'vsnote', extData.note || 'This is Zeno’s own capability catalog — not the VS Code Marketplace, and no external extension host runs here.'));
      fill(listWrap, ...nodes);
    }
    async function loadExtensions() {
      extRead = true;
      renderExtensions();
      const r = await getJSON('/forge/extensions');
      if (r.ok) { extData = r.data; extErr = null; } else { extData = null; extErr = r.error || 'could not be read'; }
      renderExtensions();
    }
    renderExtensions();
    searchIn.addEventListener('input', renderExtensions);
    const extActBtn = $('.vsact [data-vsview="extensions"]', ide);
    if (extActBtn) extActBtn.addEventListener('click', () => { if (!extData) void loadExtensions(); });
    const extGoBtn = $('[data-vsgo="extensions"]', ide);
    if (extGoBtn) extGoBtn.addEventListener('click', () => { if (!extData) void loadExtensions(); });
  }

  /* ============================================================ *
   * ZENO sidebar view — real rules/skills/schedule/connectors      *
   * ============================================================ *
   * GET /skills -> {rules[], skills[], failed[]}; GET /schedule ->
   * {tasks[]}; GET /forge/connectors -> {servers[]}. The artifact's
   * version is entirely invented: fixed rule/skill byte counts, a
   * "pdf … Install" skill-marketplace row nothing here backs, made-up
   * schedule entries with times ("next in 6h"), an invented CLI
   * version string, and a "GitHub Connect" button with nothing behind
   * it. Every row below is read, or the section says it wasn't.
   * Ticking a skill here is the REAL selection — S.selectedSkillIds is
   * what session.js's sendTask()/runResolved() actually send as
   * `skillIds`, and the composer's "N skills" pill reads its size, not
   * a fixed 2. */
  const zenoView = $('.vsside .vsview[data-vsview="zeno"] .vspad', ide);
  const skillsPill = $('#s-skills', ide);
  const MAX_SELECTED_SKILLS = 16;
  function renderSkillsPill() {
    if (!skillsPill) return;
    const skills = `${S.selectedSkillIds.size} skill${S.selectedSkillIds.size === 1 ? '' : 's'}`;
    const rules = S.ruleSelectionExplicit
      ? `${S.selectedRuleIds.size} rule${S.selectedRuleIds.size === 1 ? '' : 's'}`
      : 'all rules';
    setTrailingText(skillsPill, ` ${skills} · ${rules} ▾`);
  }
  function sectHead(text, key) {
    const h = el('div', 'vssect open');
    if (key) h.dataset.zenoSect = key;
    add(h, el('span', 'chev', '▾'), document.createTextNode(text));
    return h;
  }
  if (zenoView) fill(zenoView, el('div', 'fnote', 'Reading rules, skills, schedule and connectors from the daemon…'));
  renderSkillsPill();
  // The composer's "Scheduled tasks" item and the menu bar land here: open
  // the Zeno view and bring the named section into view.
  S.openZenoSection = (key) => {
    const b = $('.vsact [data-vsview="zeno"]', ide);
    if (b) b.click();
    const h = zenoView ? zenoView.querySelector(`[data-zeno-sect="${key}"]`) : null;
    if (h) { h.scrollIntoView({ block: 'start' }); h.style.outline = '1px solid var(--cyan)'; setTimeout(() => { h.style.outline = ''; }, 1600); }
    return !!h;
  };
  function syncCapabilityChecks() {
    if (!zenoView) return;
    zenoView.querySelectorAll('input[data-skill-id]').forEach((cb) => {
      const checked = S.selectedSkillIds.has(cb.dataset.skillId);
      cb.checked = checked;
      cb.disabled = !checked && S.selectedSkillIds.size >= MAX_SELECTED_SKILLS;
    });
    zenoView.querySelectorAll('input[data-rule-id]').forEach((cb) => {
      cb.checked = !S.ruleSelectionExplicit || S.selectedRuleIds.has(cb.dataset.ruleId);
    });
    renderSkillsPill();
  }
  S.selectSkillById = (id) => {
    if (!S.availableSkills.some((skill) => skill.id === id)) return false;
    if (!S.selectedSkillIds.has(id) && S.selectedSkillIds.size >= MAX_SELECTED_SKILLS) return false;
    S.selectedSkillIds.add(id);
    syncCapabilityChecks();
    S.openZenoSection('skills');
    return true;
  };
  S.selectRuleById = (id) => {
    if (!S.availableRules.some((rule) => rule.id === id)) return false;
    // A named slash command is an explicit, singular rule choice. This makes
    // /rule-foo observable even though the safe default is to load all rules.
    S.ruleSelectionExplicit = true;
    S.selectedRuleIds.clear();
    S.selectedRuleIds.add(id);
    syncCapabilityChecks();
    S.openZenoSection('rules');
    return true;
  };
  async function loadZenoView() {
    if (!zenoView) return;
    const [skillsRes, schedRes, connRes, mcpRes] = await Promise.all([
      getJSON('/skills'), getJSON('/schedule'), getJSON('/forge/connectors'), getJSON('/forge/mcp/servers'),
    ]);
    const nodes = [];

    if (skillsRes.ok) {
      const rules = Array.isArray(skillsRes.data.rules) ? skillsRes.data.rules : [];
      const skills = Array.isArray(skillsRes.data.skills) ? skillsRes.data.skills : [];
      S.availableRules = rules.map((rule) => ({ ...rule }));
      S.availableSkills = skills.map((skill) => ({ ...skill }));
      if (!S.capabilityCatalogLoaded) {
        for (const rule of rules) S.selectedRuleIds.add(rule.id);
        // Skills are optional task-specific instructions. Loading every clean
        // skill by default made repositories with more than the server's
        // bounded 16-skill limit unable to run at all. Start with none and let
        // the owner opt in through this panel or a /skill-* command.
        S.selectedSkillIds.clear();
        S.capabilityCatalogLoaded = true;
      } else {
        const ruleIds = new Set(rules.map((rule) => rule.id));
        const skillIds = new Set(skills.map((skill) => skill.id));
        for (const id of [...S.selectedRuleIds]) if (!ruleIds.has(id)) S.selectedRuleIds.delete(id);
        for (const id of [...S.selectedSkillIds]) if (!skillIds.has(id)) S.selectedSkillIds.delete(id);
      }
    }

    nodes.push(sectHead('RULES · this run', 'rules'));
    if (!skillsRes.ok) {
      nodes.push(el('div', 'vsnote', `Rules could not be read: ${skillsRes.error}`));
    } else {
      const rules = Array.isArray(skillsRes.data.rules) ? skillsRes.data.rules : [];
      if (!rules.length) nodes.push(el('div', 'vsnote', 'No AGENTS.md, CLAUDE.md, or .agents/.cursor/.claude rule files were found.'));
      for (const r of rules) {
        const [cls, txt] = fileMeta(r.path.split('/').pop());
        const label = el('label', 'vsck');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.ruleId = r.id;
        cb.checked = !S.ruleSelectionExplicit || S.selectedRuleIds.has(r.id);
        cb.addEventListener('change', () => {
          if (!S.ruleSelectionExplicit) {
            S.ruleSelectionExplicit = true;
            S.selectedRuleIds.clear();
            for (const rule of S.availableRules) S.selectedRuleIds.add(rule.id);
          }
          if (cb.checked) S.selectedRuleIds.add(r.id); else S.selectedRuleIds.delete(r.id);
          syncCapabilityChecks();
        });
        add(label, cb, el('span', cls, txt), document.createTextNode(` ${r.path} `), el('em', null, bytesLabel(r.bytes)));
        if (r.truncated) label.title = `${r.path} is truncated for this preview.`;
        nodes.push(label);
      }
    }

    nodes.push(sectHead('SKILLS · this run', 'skills'));
    if (!skillsRes.ok) {
      nodes.push(el('div', 'vsnote', `Skills could not be read: ${skillsRes.error}`));
    } else {
      const skills = Array.isArray(skillsRes.data.skills) ? skillsRes.data.skills : [];
      if (!skills.length) nodes.push(el('div', 'vsnote', 'No skills installed under .agents/skills.'));
      for (const s of skills) {
        const label = el('label', 'vsck');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.skillId = s.id;
        const suspicious = s.verdict === 'suspicious';
        cb.checked = S.selectedSkillIds.has(s.id);
        cb.addEventListener('change', () => {
          if (cb.checked && S.selectedSkillIds.size >= MAX_SELECTED_SKILLS) {
            cb.checked = false;
            cb.title = `Choose at most ${MAX_SELECTED_SKILLS} skills for one run.`;
          } else if (cb.checked) S.selectedSkillIds.add(s.id);
          else S.selectedSkillIds.delete(s.id);
          syncCapabilityChecks();
        });
        const trust = el('span', 'trust', suspicious ? 'flagged · review' : 'screened');
        const whys = Array.isArray(s.findings) ? s.findings.map((f) => f.why).filter(Boolean) : [];
        trust.title = suspicious && whys.length ? whys.join('; ') : 'Read as text by the model. It never grants a permission — every effect still goes through the kernel.';
        add(label, cb, document.createTextNode(` ${s.name || s.id} `), trust, el('em', null, bytesLabel(s.bytes)));
        nodes.push(label);
      }
      const failed = Array.isArray(skillsRes.data.failed) ? skillsRes.data.failed : [];
      if (failed.length) nodes.push(el('div', 'vsnote', `${failed.length} skill file${failed.length === 1 ? '' : 's'} could not be parsed.`));
    }
    nodes.push(el('div', 'vsnote', 'A skill is text the model reads. It never grants a permission — every effect still goes through the kernel.'));
    renderSkillsPill();

    nodes.push(sectHead('SCHEDULED TASKS', 'schedule'));
    if (!schedRes.ok) {
      nodes.push(el('div', 'vsnote', `Scheduled tasks could not be read: ${schedRes.error}`));
    } else {
      const tasks = Array.isArray(schedRes.data.tasks) ? schedRes.data.tasks : [];
      if (!tasks.length) nodes.push(el('div', 'vsnote', 'No scheduled tasks on this machine.'));
      for (const t of tasks) {
        const row = el('div', 'vsfile');
        row.dataset.sched = '1';
        let when;
        try { when = t.paused ? 'paused' : t.overdue ? 'overdue' : `next ${new Date(t.nextRunAt).toLocaleString()}`; } catch { when = t.paused ? 'paused' : '—'; }
        add(row, el('span', t.paused ? 'vsi' : 'vsi ok', t.paused ? '○' : '●'), document.createTextNode(String(t.title || '(untitled)')), el('span', t.paused ? 'vsmod' : 'vsmod ok', when));
        nodes.push(row);
      }
    }
    nodes.push(el('div', 'vsnote', 'Ceiling T1 · missed runs are skipped, not stacked · a schedule can never inherit a broader approval than you gave it.'));

    nodes.push(sectHead('MCP & CONNECTORS · per-run'));
    if (!connRes.ok) {
      nodes.push(el('div', 'vsnote', `Connectors could not be read: ${connRes.error}`));
    } else {
      const servers = Array.isArray(connRes.data.servers) ? connRes.data.servers : [];
      if (!servers.length) nodes.push(el('div', 'vsnote', 'No MCP connectors are configured.'));
      for (const s of servers) {
        const row = el('div', 'vsfile');
        const nTools = Array.isArray(s.tools) ? s.tools.length : 0;
        add(row, el('span', s.configured ? 'vsi ok' : 'vsi', s.configured ? '●' : '○'), document.createTextNode(String(s.name || s.id)),
          el('span', s.configured ? 'vsmod ok' : 'vsmod', s.configured ? `${nTools} tool${nTools === 1 ? '' : 's'}` : 'not configured'));
        if (s.permissions) row.title = s.permissions;
        nodes.push(row);
      }
      if (connRes.data.note) nodes.push(el('div', 'vsnote', connRes.data.note));
    }

    // Distinct from the bundled connectors above: these are MCP servers the
    // owner has explicitly RECORDED (POST /forge/mcp/servers, names/transport/
    // command only — never a secret value). Recording one here does not load
    // or connect it; it is a separate, gated step before any run can use it.
    nodes.push(sectHead('MCP SERVERS · recorded'));
    if (!mcpRes.ok) {
      nodes.push(el('div', 'vsnote', `Recorded MCP servers could not be read: ${mcpRes.error}`));
    } else {
      const recorded = Array.isArray(mcpRes.data.servers) ? mcpRes.data.servers : [];
      if (!recorded.length) nodes.push(el('div', 'vsnote', 'No MCP servers recorded on this machine.'));
      for (const s of recorded) {
        const row = el('div', 'vsfile');
        add(row, el('span', 'vsi', '○'), document.createTextNode(String(s.name || s.id)), el('span', 'vsmod', s.transport || ''));
        row.title = s.command || s.url || '';
        nodes.push(row);
      }
      if (mcpRes.data.note) nodes.push(el('div', 'vsnote', mcpRes.data.note));
    }

    // POLICY describes the kernel's fixed tiering (a build constant, not
    // per-run instance data), so it is kept as the artifact stated it.
    nodes.push(sectHead('POLICY'));
    nodes.push(el('div', 'vsnote', 'built-in default · T2 needs one owner approval · single-use · receipts Ed25519-signed'));

    fill(zenoView, ...nodes);
  }

  return { loadZenoView };
}
