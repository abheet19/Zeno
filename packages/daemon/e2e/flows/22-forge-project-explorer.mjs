/*
 * Forge works in the OWNER'S OWN repository, and the Explorer's chrome is real.
 *
 * The owner, testing live: "why is it showing sandbox — why can't we choose any
 * working directory". Forge showed the scratch repository the E2E suite seeds
 * and had no way to open a real project. This flow creates a real repository
 * of its own (git init + a commit, in a temp dir), points the daemon at it
 * through the new route, and then asserts — against the daemon, not only the
 * DOM — that every Forge surface now means THAT repository: the Explorer tree,
 * the header, the terminal's cwd, the Outline and Timeline, the codemap.
 *
 * Then the governed part. New File / New Folder from the Explorer header go
 * through POST /previews like every other write: a sensitive path is HELD (the
 * bytes are not on disk until the owner approves it in Command, and the tree
 * shows the file afterwards WITHOUT a manual refresh — the live stream nudge
 * does it); a routine creation is applied and receipted. An uploaded image
 * takes the same road.
 *
 * Finally the audit the owner asked for: every item in every menu-bar menu,
 * and every item in the composer's "+" menu, either acts or is disabled with
 * a written reason. Nothing may look live and do nothing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const id = 'forge-project-explorer';
export const title = 'Forge opens the owner’s own repository; Explorer writes are governed; every menu item acts or says why not';
export const criteria = ['owner: choose any working directory', 'forge: governed New File / New Folder', 'owner: no dead menu item', 'forge: real Outline and Timeline'];

const README = '# Zeno e2e project\n\nintro\n\n## Section one\n\ntext\n\n### Sub point\n';
const APP = 'function greet(name) {\n  return `hello from e2e, ${name}`;\n}\nconst answer = 42;\nconsole.log(greet(\'zeno\'), answer);\n';

const norm = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(120); }
  return false;
}

export async function run({ daemon, page, ok, network, Blocked }) {
  /* ---------------------------------------------------------------- *
   * 0 · a real repository of the owner's own                           *
   * ---------------------------------------------------------------- */
  const repo = mkdtempSync(join(tmpdir(), 'zeno-e2e-project-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=e2e@zeno.local', '-c', 'user.name=e2e', ...args], { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), README, 'utf8');
  writeFileSync(join(repo, 'src', 'app.js'), APP, 'utf8');
  git('add', '.');
  git('commit', '-q', '-m', 'e2e: initial commit');
  const root = realpathSync.native(repo);
  const name = basename(root);
  const notRepo = mkdtempSync(join(tmpdir(), 'zeno-e2e-plain-'));

  /* ---------------------------------------------------------------- *
   * 1 · the route: scratch by default, owner-only, validated, persisted *
   * ---------------------------------------------------------------- */
  const before = await daemon.api('/forge/project');
  ok.eq('before any choice the daemon is on the scratch repository', before.body && before.body.project && before.body.project.scratch, true);
  ok('and says so in the owner\'s words', /choose a folder to work on your own code/i.test(String(before.body.project.note)), before.body.project.note);

  const asAgent = await daemon.agent('/forge/project', { method: 'POST', body: JSON.stringify({ path: root }) });
  ok.eq('an agent cannot move the jail', asAgent.status, 403);

  const plain = await daemon.api('/forge/project', { method: 'POST', body: JSON.stringify({ path: notRepo }) });
  ok.eq('a folder that is not a git repository is refused', plain.status, 400);
  ok('…with the next step spelled out', /git init/.test(String(plain.body && plain.body.error && plain.body.error.resolve)), JSON.stringify(plain.body));

  const chosen = await daemon.api('/forge/project', { method: 'POST', body: JSON.stringify({ path: join(repo, 'src') }) });
  ok.eq('the owner can choose a folder', chosen.status, 200);
  ok('a sub-folder resolves up to the repository root, and the answer says so',
    chosen.body && norm(chosen.body.project.root) === norm(root) && norm(chosen.body.resolvedFrom) === norm(join(root, 'src')), JSON.stringify(chosen.body));
  ok.eq('it is no longer the scratch repository', chosen.body.project.scratch, false);
  ok.eq('the choice is persisted in the workspace', chosen.body.project.persisted, true);
  let saved = null;
  try { saved = JSON.parse(readFileSync(join(daemon.dir, 'project.json'), 'utf8')); } catch { /* asserted below */ }
  ok('project.json in ZENO_DIR carries the root, so it survives a restart', saved && norm(saved.path) === norm(root), JSON.stringify(saved));

  const status = await daemon.api('/forge/status');
  ok('git status now describes the chosen repository', norm(status.body.root) === norm(root), status.body.root);
  ok('and lists its tracked files', ['README.md', 'src/app.js'].every((p) => (status.body.tracked || []).includes(p)), JSON.stringify(status.body.tracked));

  const top = await daemon.api('/forge/terminal', { method: 'POST', body: JSON.stringify({ command: 'git rev-parse --show-toplevel' }) });
  ok('the terminal runs in the chosen repository', norm(top.body && top.body.stdout) === norm(root), JSON.stringify(top.body && top.body.stdout));
  const nodeProbe = await daemon.api('/forge/terminal', { method: 'POST', body: JSON.stringify({ command: 'node -v' }) });
  if (!(nodeProbe.body && nodeProbe.body.ok)) throw new Blocked('node on PATH for the daemon shell — Run Code runs .js files with node');

  /* ---------------------------------------------------------------- *
   * 2 · the window shows THAT repository                               *
   * ---------------------------------------------------------------- */
  const answers = [];
  const alerts = [];
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') { const a = answers.shift(); if (a === undefined || a === null) await d.dismiss(); else await d.accept(a); }
    else if (d.type() === 'confirm') await d.accept();
    else { alerts.push(d.message()); await d.accept(); }
  });
  await page.click('.seg [data-product="forge"]');
  await page.click('#forge-viewseg [data-forge-view="editor"]');
  await page.waitForFunction(() => !document.querySelector('#ide')?.classList.contains('mode-agent'));
  await page.waitForTimeout(400);
  const rootSect = '#ide [data-explorer-root]';
  await page.hover(rootSect);
  await page.click(`${rootSect} [data-explorer-act="refresh"]`);
  const listed = await until(() => page.$('#ide .vstree [data-file="src/app.js"]'));
  ok('the Explorer lists the chosen repository\'s files', listed);
  const header = await page.evaluate(() => ({
    name: document.querySelector('#ide [data-project-name]')?.textContent.trim(),
    head: document.querySelector('#ide [data-project-head]')?.textContent.trim(),
    sandboxWord: /SANDBOX/.test(document.querySelector('#ide .vsview[data-vsview="explorer"]')?.textContent || ''),
    noteHidden: document.querySelector('#ide [data-project-note]')?.hidden,
    crumb: document.querySelector('#ide .vscrumbs span')?.textContent.trim(),
    chip: document.querySelector('#ide .vsstat .vsst')?.textContent.trim(),
    pills: [...document.querySelectorAll('#ide .ag-foot .pill, #ide .sessfoot .pill')].map((p) => p.textContent.trim()).filter((t) => /^▣/.test(t)),
  }));
  ok.eq('the header names the repository', header.name, name);
  ok.eq('the tree section is titled with it', header.head, name.toUpperCase());
  ok('the word SANDBOX is gone from the Explorer', header.sandboxWord === false);
  ok('no scratch note is shown for a real project', header.noteHidden === true);
  ok.eq('the breadcrumb starts with the repository', header.crumb, name);
  ok('the status-bar chip names it', header.chip && header.chip.includes(name), header.chip);
  ok('the session panel\'s repository pills follow it', header.pills.length > 0 && header.pills.every((t) => t === `▣ ${name}`), JSON.stringify(header.pills));
  const tree = await page.$$eval('#ide .vstree [data-file]', (els) => els.map((e) => e.dataset.file).sort());
  ok('the tree is exactly the daemon\'s list', JSON.stringify(tree) === JSON.stringify([...status.body.tracked].sort()), JSON.stringify(tree));

  /* ---------------------------------------------------------------- *
   * 3 · New File — HELD, approved in Command, then on disk and in tree *
   * ---------------------------------------------------------------- */
  const receipts0 = (await daemon.api('/state')).body.receipts.length;
  answers.push('tsconfig.json'); // a path the kernel classes as configuration: always held
  const previewsBefore = network.filter((n) => n === 'POST /previews').length;
  await page.hover(rootSect);
  await page.click(`${rootSect} [data-explorer-act="new-file"]`);
  ok('New File went through POST /previews', await until(() => network.filter((n) => n === 'POST /previews').length > previewsBefore));
  const held = await until(async () => {
    const st = await daemon.api('/state');
    return st.body.pending.some((p) => p.payload && p.payload.relPath === 'tsconfig.json');
  });
  ok('the daemon is holding a capsule for the new file', held);
  const pendingState = await daemon.api('/state');
  const capsule = pendingState.body.pending.find((p) => p.payload && p.payload.relPath === 'tsconfig.json');
  ok('the capsule says the Explorer proposed it', !!capsule && /Forge: create tsconfig\.json/.test(capsule.summary), capsule && capsule.summary);
  ok('NOTHING is on disk while it waits', !existsSync(join(root, 'tsconfig.json')));
  ok.eq('a hold seals no receipt', pendingState.body.receipts.length, receipts0);
  const noteText = await page.evaluate(() => document.querySelector('#ide [data-project-note]')?.textContent || '');
  ok('the Explorer says it is held, not created', /held for approval/i.test(noteText) && /Command/.test(noteText), noteText);

  const approved = await daemon.api('/approvals', { method: 'POST', body: JSON.stringify({ actionHash: capsule.actionHash }) });
  ok.eq('the owner approves it through the API', approved.status, 200);
  ok('only then does the file exist', existsSync(join(root, 'tsconfig.json')));
  ok('and the Explorer shows it without anyone pressing Refresh', await until(() => page.$('#ide .vstree [data-file="tsconfig.json"]'), 12_000));

  /* ---------------------------------------------------------------- *
   * 4 · New Folder — <folder>/.gitkeep, routine, receipted             *
   * ---------------------------------------------------------------- */
  const receipts1 = (await daemon.api('/state')).body.receipts.length;
  answers.push('docs');
  await page.hover(rootSect);
  await page.click(`${rootSect} [data-explorer-act="new-folder"]`);
  ok('New Folder lands as docs/.gitkeep in the tree', await until(() => page.$('#ide .vstree [data-file="docs/.gitkeep"]'), 12_000));
  ok('and on disk', existsSync(join(root, 'docs', '.gitkeep')));
  ok.eq('a routine creation seals exactly one receipt', (await daemon.api('/state')).body.receipts.length, receipts1 + 1);

  /* ---------------------------------------------------------------- *
   * 5 · Outline and Timeline are the open file's own facts             *
   * ---------------------------------------------------------------- */
  await page.click('#ide .vstree [data-file="README.md"]');
  await page.waitForFunction(() => window.monaco && /README\.md$/.test(String(window.monaco.editor.getEditors()[0]?.getModel()?.uri || '')), { timeout: 20_000 }).catch(() => {});
  ok('the Outline lists the Markdown headings', await until(() => page.$$eval('#ide .vsoutline [data-outline]', (els) => els.length === 3)));
  const outline = await page.$$eval('#ide .vsoutline [data-outline]', (els) => els.map((e) => ({ line: Number(e.dataset.outline), text: e.textContent.trim() })));
  ok('…at their real lines', JSON.stringify(outline.map((o) => o.line)) === JSON.stringify([1, 5, 9]), JSON.stringify(outline));
  await page.click('#ide .vsoutline [data-outline="5"]');
  const pos = await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber);
  ok.eq('clicking a heading reveals its line in the editor', pos, 5);
  const log = await daemon.api(`/forge/log?path=${encodeURIComponent('README.md')}`);
  ok.eq('the daemon has the file\'s git history', (log.body.commits || []).length, 1);
  ok('the Timeline shows exactly that history', await until(async () => {
    const rows = await page.$$eval('#ide [data-timeline] [data-commit]', (els) => els.map((e) => e.dataset.commit));
    return rows.length === 1 && rows[0] === log.body.commits[0].sha;
  }));

  /* ---------------------------------------------------------------- *
   * 6 · toolbar: Back/Forward walk a real history; Run Code runs a file *
   * ---------------------------------------------------------------- */
  const navBtn = (title) => `#ide .vsed .vstabs button[title^="${title}"], #ide .vsed .vstabs button[title="${title}"]`;
  const runState = await page.$eval('#ide .vsed .vstabs button[title*="No runner"]', (b) => ({ disabled: b.disabled, title: b.title })).catch(() => null);
  ok('Run Code is disabled for a Markdown file, with the reason', !!runState && runState.disabled && /No runner/.test(runState.title), JSON.stringify(runState));
  await page.click('#ide .vstree [data-file="src/app.js"]');
  await page.waitForFunction(() => /app\.js$/.test(String(window.monaco.editor.getEditors()[0]?.getModel()?.uri || '')), { timeout: 20_000 }).catch(() => {});
  const backEnabled = await page.$eval(navBtn('Go Back'), (b) => !b.disabled);
  ok('after two opens, Go Back is live', backEnabled);
  await page.click(navBtn('Go Back'));
  ok('Back returns to the previous file', await until(() => page.$eval('#vs-crumb', (b) => b.textContent.trim() === 'README.md')));
  await page.click(navBtn('Go Forward'));
  ok('Forward goes to it again', await until(() => page.$eval('#vs-crumb', (b) => b.textContent.trim() === 'app.js')));
  const runBtn = '#ide .vsed .vstabs button[title^="Run src/app.js"]';
  ok('Run Code is live for a .js file and says what it will run', !!(await page.$(runBtn)));
  const termBefore = network.filter((n) => n === 'POST /forge/terminal').length;
  await page.click(runBtn);
  ok('Run Code sent the command to the real terminal', await until(() => network.filter((n) => n === 'POST /forge/terminal').length > termBefore));
  ok('and the file\'s own output came back', await until(() => page.$eval('#vs-term', (t) => /hello from e2e, zeno 42/.test(t.textContent)), 30_000),
    await page.evaluate(() => document.getElementById('vs-term').textContent.slice(-200)));
  const termBar = await page.$$eval('#ide .vsptabs button.fico', (els) => els.map((b) => ({ title: b.title, disabled: b.disabled, id: b.id })));
  ok('every terminal toolbar icon acts or is disabled with a reason',
    termBar.every((b) => b.id || (b.disabled ? b.title.length > 20 : b.title.length > 0)), JSON.stringify(termBar));
  ok('Launch Profile and Split Terminal are honestly disabled',
    termBar.filter((b) => /profile|Split/i.test(b.title)).every((b) => b.disabled), JSON.stringify(termBar));
  ok('after a command, @ / clear / copy are live', termBar.filter((b) => /^Pin the last|^Clear this|^Copy the last/.test(b.title)).length === 3 && termBar.filter((b) => !b.id && !b.disabled).length === 3, JSON.stringify(termBar));
  await page.click('#ide .vsptabs button[title^="Pin the last command"]');
  ok('the terminal\'s @ pins its output as context', !!(await page.$('[data-ctx-pin="terminal"]')));
  await page.click('#ide .vsptabs button[title^="Clear this terminal"]');
  ok('"Kill" is the clear it really is', await page.$eval('#vs-term', (t) => !/hello from e2e/.test(t.textContent)));
  const accounts = await page.$$eval('#ide .vsact button:not([data-vsview]):not([data-open-settings]), #ide .tb .tbavatar', (els) => els.map((b) => ({ disabled: b.disabled, title: b.title })));
  ok('Accounts and the avatar are disabled with the single-user reason', accounts.length === 2 && accounts.every((a) => a.disabled && /single-user/.test(a.title)), JSON.stringify(accounts));

  /* ---------------------------------------------------------------- *
   * 7 · the menu bar: every item acts, or is disabled with a reason    *
   * ---------------------------------------------------------------- */
  const menus = await page.$$eval('.tbmenu button', (els) => els.map((b) => b.textContent.trim()));
  const unwired = [];
  const noReason = [];
  let items = 0;
  for (const m of menus) {
    await page.click(`.tbmenu button:has-text("${m}")`);
    await page.waitForSelector('.menu button', { timeout: 5000 }).catch(() => {});
    const rows = await page.$$eval('.menu button', (els) => els.map((b) => ({ text: b.textContent.trim(), cmd: b.dataset.cmd || '', disabled: b.disabled, title: b.title })));
    for (const r of rows) {
      items += 1;
      if (!r.cmd) unwired.push(`${m}: ${r.text}`);
      if (r.disabled && !(r.title && r.title.length > 12 && / — /.test(r.text))) noReason.push(`${m}: ${r.text}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
  ok(`every menu-bar item (${items}) is wired to a registered command`, unwired.length === 0, `UNWIRED: ${unwired.join(' | ')}`);
  ok('every disabled item shows its reason in the row', noReason.length === 0, `NO REASON: ${noReason.join(' | ')}`);

  const menuClick = async (menu, label) => {
    await page.click(`.tbmenu button:has-text("${menu}")`);
    await page.waitForSelector(`.menu button[data-cmd="${menu}:${label}"]`, { timeout: 5000 });
    await page.click(`.menu button[data-cmd="${menu}:${label}"]`);
  };
  await menuClick('Go', 'Go to Line…');
  ok('Go to Line opens the palette in line mode', await until(() => page.$eval('#quick-in', (i) => !i.closest('#quick').hidden && i.value === ':')));
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  ok('…and the editor moves to that line', await until(async () => (await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber)) === 4));
  await menuClick('View', 'Word Wrap');
  const wrap = await page.evaluate(() => window.monaco.editor.getEditors()[0].getOption(window.monaco.editor.EditorOption.wordWrap));
  ok.eq('Word Wrap really toggles the editor option', wrap, 'on');
  await menuClick('Selection', 'Select All');
  const selAll = await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; const s = ed.getSelection(); return s.endLineNumber === ed.getModel().getLineCount(); });
  ok('Select All selects the whole buffer', selAll);
  await menuClick('Terminal', 'New Terminal');
  ok('New Terminal shows the terminal and focuses its input', await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'vs-termin')));
  await menuClick('Help', 'About Zeno');
  ok('About shows the real daemon and working folder, not an invented release', await until(() => alerts.some((a) => a.includes(`daemon http://127.0.0.1:${daemon.port}`) && norm(a).includes(norm(root)))), JSON.stringify(alerts.slice(-1)));
  answers.push('notes.txt');
  await menuClick('File', 'New File');
  ok('File → New File proposes a real file, which the tree then shows', await until(() => page.$('#ide .vstree [data-file="notes.txt"]'), 12_000));
  await menuClick('Help', 'Keyboard Shortcuts Reference');
  ok('the shortcuts sheet lists real bindings', await until(() => page.$eval('[data-shortcuts]', (s) => /Ctrl\+P/.test(s.textContent))));
  await page.keyboard.press('Escape');

  /* ---------------------------------------------------------------- *
   * 8 · the composer "+" menu: twelve items, none disabled, each real  *
   * ---------------------------------------------------------------- */
  // Two "+" anchors exist: the hero's (#ag-plus, before any session) and the
  // session composer's (#s-attach). Use whichever the owner can actually see.
  const plusBtn = async () => ((await page.isVisible('#s-attach')) ? '#s-attach' : '#ag-plus');
  const openPlus = async () => { await page.click(await plusBtn()); await page.waitForSelector('.plus-menu [data-plus-item]', { timeout: 5000 }); };
  await openPlus();
  const plus = await page.$$eval('.plus-menu [data-plus-item]', (els) => els.map((b) => ({ label: b.dataset.plusItem, disabled: b.disabled, title: b.title })));
  ok.eq('the "+" menu has its twelve items', plus.length, 12);
  ok('none of them is disabled', plus.every((p) => !p.disabled), JSON.stringify(plus.filter((p) => p.disabled)));
  ok('each says what it does', plus.every((p) => p.title.length > 10), JSON.stringify(plus));
  const plusClick = async (label) => { await openPlus(); await page.click(`.plus-menu [data-plus-item="${label}"]`); };

  await page.click(`.plus-menu [data-plus-item="Files"]`);
  ok('Files opens the real file palette', await until(() => page.$eval('#quick', (q) => !q.hidden && q.querySelectorAll('.mp-row').length >= 3)));
  await page.keyboard.press('Escape');
  await plusClick('Skills');
  ok('Skills opens the Zeno view', await until(() => page.$eval('.vsact [data-vsview="zeno"]', (b) => b.getAttribute('aria-current') === 'page')));
  await plusClick('Git');
  ok('Git opens Source Control', await until(() => page.$eval('.vsact [data-vsview="scm"]', (b) => b.getAttribute('aria-current') === 'page')));
  await plusClick('Conversations');
  ok('Conversations opens this window\'s session History', await until(() => page.$eval('#s-history', (h) => !h.hidden)));
  await page.click('#s-hist'); // History replaces the hero (and its "+") while open; close it again
  await until(() => page.$eval('#s-history', (h) => h.hidden));
  await plusClick('Scheduled tasks');
  ok('Scheduled tasks opens the Zeno view\'s Scheduled Tasks section', await until(() => page.$eval('[data-zeno-sect="schedule"]', (h) => h.closest('.vsview').classList.contains('on'))));
  await plusClick('Terminal');
  ok('Terminal focuses the real terminal', await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'vs-termin')));
  answers.push(null); // Directories → the folder prompt (no desktop bridge in a browser); dismissing it changes nothing
  await plusClick('Directories');
  await page.waitForTimeout(300);
  ok('Directories opens the working-folder chooser (dismissed here: still the same repository)', norm((await daemon.api('/forge/project')).body.project.root) === norm(root));

  await plusClick('Code Context Items');
  await page.waitForSelector('[data-context-menu] button', { timeout: 5000 });
  await page.click('[data-context-menu] button:not([disabled])');
  ok('Code Context Items pins the editor selection as a chip', await until(() => page.$('[data-ctx-pin="selection"]')));

  const big = randomBytes(6000); // 106 base64 lines: past the kernel's routine budget, so HELD
  await plusClick('Upload image');
  await page.waitForSelector('input[data-forge-upload]', { state: 'attached', timeout: 5000 });
  await page.setInputFiles('input[data-forge-upload]', { name: 'shot.png', mimeType: 'image/png', buffer: big });
  const attachRel = '.zeno/attachments/shot.png.b64';
  const imageHeld = await until(async () => (await daemon.api('/state')).body.pending.some((p) => p.payload && p.payload.relPath === attachRel));
  ok('the image is proposed as a HELD write into .zeno/attachments', imageHeld);
  ok('nothing is on disk while it waits', !existsSync(join(root, '.zeno', 'attachments', 'shot.png.b64')));
  ok('and it is pinned as context, labelled for the text-only local model', await until(() => page.$eval('[data-ctx-pin="image"]', (c) => /text-only/.test(c.title))));
  const imgCapsule = (await daemon.api('/state')).body.pending.find((p) => p.payload && p.payload.relPath === attachRel);
  const imgOk = await daemon.api('/approvals', { method: 'POST', body: JSON.stringify({ actionHash: imgCapsule.actionHash }) });
  ok.eq('the owner approves the attachment', imgOk.status, 200);
  const decoded = existsSync(join(root, '.zeno', 'attachments', 'shot.png.b64')) ? Buffer.from(readFileSync(join(root, '.zeno', 'attachments', 'shot.png.b64'), 'utf8').replace(/\n/g, ''), 'base64') : null;
  ok('once approved the file decodes back to the exact bytes chosen', !!decoded && decoded.equals(big));

  await page.route('**/forge/run', (r) => r.abort()); // never start an agent here; the ROUTE request is what carries the task
  const routed = page.waitForRequest((r) => r.url().includes('/forge/route'), { timeout: 15_000 }).then((r) => (r.postDataJSON() || {}).task || '', () => '');
  const composer = (await page.isVisible('#s-ta')) ? '#s-ta' : '#ag-ta'; // the hero's composer before a session exists
  await page.fill(composer, 'e2e: what does greet do?');
  await page.press(composer, 'Enter');
  const task = await routed;
  ok('the pinned context travels with the task that is sent',
    task.startsWith('e2e: what does greet do?') && /--- Pinned context/.test(task) && /\[selection\]/.test(task) && /\[image\]/.test(task) && /\[terminal\]/.test(task), task.slice(0, 200));
  ok('and the chips are cleared once sent', await until(async () => (await page.$$('[data-ctx-pin]')).length === 0));

  await plusClick('Codemaps');
  await page.waitForSelector('[data-codemap] [data-codemap-file]', { timeout: 10_000 });
  const treeApi = await daemon.api('/forge/tree');
  const mapRows = await page.$$eval('[data-codemap] [data-codemap-file]', (els) => els.map((e) => e.dataset.codemapFile).sort());
  ok('Codemaps lists exactly the repository\'s files', JSON.stringify(mapRows) === JSON.stringify(treeApi.body.files.map((f) => f.path).sort()), JSON.stringify(mapRows));
  ok('…with real sizes from disk', treeApi.body.files.find((f) => f.path === 'README.md').bytes === Buffer.byteLength(README), JSON.stringify(treeApi.body.files));
  await page.fill('[data-codemap-filter]', 'app');
  ok('the map filters', await until(async () => (await page.$$('[data-codemap] [data-codemap-file]')).length === 1));
  await page.click('[data-codemap] [data-codemap-file="src/app.js"]');
  ok('clicking a file scans its symbols', await until(() => page.$eval('[data-codemap]', (s) => /greet/.test(s.textContent) && /answer/.test(s.textContent))));
  await page.click('[data-codemap] [data-codemap-symbol="src/app.js:4"]');
  ok('clicking a symbol opens the file at that line', await until(async () => (await page.evaluate(() => window.monaco.editor.getEditors()[0].getPosition().lineNumber)) === 4));

  /* ---------------------------------------------------------------- *
   * 9 · the folder chooser refuses to move while a decision is pending *
   * ---------------------------------------------------------------- */
  const heldEdit = await daemon.api('/previews', { method: 'POST', body: JSON.stringify({ relPath: 'tsconfig.json', contents: '{ "compilerOptions": {} }\n', summary: 'e2e: a held edit', requestedBy: 'e2e' }) });
  ok('a config edit is held', heldEdit.status === 200 && !heldEdit.body.receipt);
  const busy = await daemon.api('/forge/project');
  ok('the project cannot be changed with a proposal waiting, and says why', busy.body.project.canChange === false && /proposal/.test(busy.body.project.changeBlockedBy), JSON.stringify(busy.body.project));
  const refused = await daemon.api('/forge/project', { method: 'POST', body: JSON.stringify({ path: null }) });
  ok.eq('…and a switch is refused', refused.status, 409);
  await daemon.api('/approvals/decline', { method: 'POST', body: JSON.stringify({ actionHash: heldEdit.body.preview.actionHash }) });

  await page.click('.vsact [data-vsview="explorer"]'); // earlier items left the sidebar on the Zeno view
  await page.click('#ide [data-explorer-project]');
  await page.waitForSelector('[data-project-menu] button', { timeout: 5000 });
  await page.click('[data-project-menu] button:has-text("Use the Zeno scratch repository")');
  ok('the chip menu returns to the scratch repository', await until(async () => (await daemon.api('/forge/project')).body.project.scratch === true));
  ok('and the Explorer labels it honestly', await until(() => page.$eval('#ide [data-project-note]', (n) => !n.hidden && /scratch repository/.test(n.textContent))));
  answers.push(root);
  await page.click('#ide [data-explorer-project]');
  await page.waitForSelector('[data-project-menu] button', { timeout: 5000 });
  await page.click('[data-project-menu] button:has-text("Change working folder")');
  ok('and the chooser opens the repository again', await until(async () => norm((await daemon.api('/forge/project')).body.project.root) === norm(root)));
  ok('the Explorer follows', await until(() => page.$('#ide .vstree [data-file="src/app.js"]')));
}
