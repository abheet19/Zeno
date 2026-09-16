/*
 * Forge's terminal, and the bottom panel it lives in.
 *
 * The whole point of Forge's terminal is that it is NOT a transcript widget:
 * the command leaves the browser, a real shell runs it in the sandbox
 * worktree, and what comes back is that shell's actual stdout, stderr and
 * exit code. The artifact this UI was rebuilt from shipped a convincing fake
 * of exactly that — ui.js keeps a lookup table (`git status --short` →
 * " M src/App.tsx", `npm test` → "142 passed") and flips a hardcoded
 * "exit 0"/"exit 1" in the status bar. A flow that only checked that text
 * appeared in #vs-term would pass against the mock forever.
 *
 * So every assertion here is about a REAL effect: a POST actually left the
 * page, the bytes on screen are bytes the local git binary produced, and a
 * command that fails is reported with the exit code the OS gave it.
 *
 * One trap worth naming, because it nearly produced a false P0 in a previous
 * investigation: `git status --short` on a clean tree returns an EMPTY stdout
 * and exit 0. That is correct behaviour, not a broken route. Proving "real
 * stdout" requires a command that MUST produce output — `git --version`.
 */

export const id = 'forge-terminal';
export const title = 'Forge terminal runs real commands; the panel and status bar report them honestly';
export const criteria = ['forge: real shell', 'forge: honest exit codes', 'forge: no artifact fixtures'];

const FIXTURES = ['wt-7f2a', '142 passed', 'qwen3:8b', 'INGEST-12', 'src/App.tsx', '11434', '5173'];
const PANELS = ['problems', 'output', 'debug', 'terminal', 'ports'];

/** Run a command through the window exactly as a person would: type, Enter. */
async function typeCommand(page, cmd) {
  await page.evaluate((c) => {
    const input = document.getElementById('vs-termin');
    if (!input) throw new Error('#vs-termin is not in the document');
    input.value = c;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }, cmd);
}

export async function run({ daemon, page, ok, network, Blocked }) {
  /* ============================================================
   * 1 · the route itself must return REAL stdout
   * ============================================================ */
  const version = await daemon.api('/forge/terminal', {
    method: 'POST',
    body: JSON.stringify({ command: 'git --version' }),
  });
  if (version.status === 200 && version.body && version.body.failedToSpawn) {
    throw new Blocked('a shell the daemon can spawn (POST /forge/terminal reported failedToSpawn)');
  }
  if (version.status === 200 && version.body && /not recognized|not found/i.test(String(version.body.stderr || ''))) {
    throw new Blocked('git on PATH — this flow proves real stdout with `git --version`');
  }
  ok.eq('the terminal route answers the owner', version.status, 200);
  ok('a succeeding command reports success', version.body && version.body.ok === true, JSON.stringify(version.body));
  ok.eq('and its real exit code', version.body && version.body.code, 0);
  // The load-bearing one: bytes only the local git binary could have produced.
  ok('the route returns the shell\'s actual stdout',
    /git version \d+\.\d+/.test(String(version.body && version.body.stdout)),
    `stdout was ${JSON.stringify(String(version.body && version.body.stdout).slice(0, 120))}`);

  // …and the shell is jailed to the sandbox worktree, not the developer's repo.
  const toplevel = await daemon.api('/forge/terminal', {
    method: 'POST',
    body: JSON.stringify({ command: 'git rev-parse --show-toplevel' }),
  });
  const top = String((toplevel.body && toplevel.body.stdout) || '').trim().replace(/\\/g, '/');
  ok('the command runs inside the sandbox worktree, not the real repo',
    /\/sandbox$/.test(top) && !/\/packages\/daemon/.test(top), `toplevel was ${JSON.stringify(top)}`);
  ok('the route reports the cwd it used',
    typeof (toplevel.body && toplevel.body.cwd) === 'string' && /sandbox$/.test(toplevel.body.cwd.replace(/\\/g, '/')),
    JSON.stringify(toplevel.body && toplevel.body.cwd));

  /* ============================================================
   * 2 · a failing command must be reported as failing
   * ============================================================ */
  const badRef = 'git rev-parse --verify zeno-e2e-no-such-ref';
  const failed = await daemon.api('/forge/terminal', { method: 'POST', body: JSON.stringify({ command: badRef }) });
  const failCode = failed.body && failed.body.code;
  ok.eq('a failing command still answers 200 (the request worked; the command did not)', failed.status, 200);
  ok('a non-zero exit is NOT reported as success', failed.body && failed.body.ok === false, JSON.stringify(failed.body));
  ok('the non-zero exit code is passed through, not flattened',
    Number.isInteger(failCode) && failCode !== 0, `code was ${JSON.stringify(failCode)}`);
  ok('the failure\'s own stderr comes back',
    /fatal|error|Needed a single revision/i.test(String(failed.body && failed.body.stderr)),
    `stderr was ${JSON.stringify(String(failed.body && failed.body.stderr).slice(0, 160))}`);

  /* ============================================================
   * 3 · only the owner may run a command
   * ============================================================ */
  const asAgent = await daemon.agent('/forge/terminal', {
    method: 'POST',
    body: JSON.stringify({ command: 'git --version' }),
  });
  ok.eq('an agent cannot run a shell command', asAgent.status, 403);
  ok.eq('and is told why', asAgent.body && asAgent.body.error && asAgent.body.error.code, 'owner-only');

  /* ============================================================
   * 4 · the bottom panel: every tab reveals a real pane
   * ============================================================ */
  await page.click('.seg [data-product="forge"]');
  await page.click('#forge-viewseg [data-forge-view="editor"]');
  await page.waitForFunction(() => !document.querySelector('#ide')?.classList.contains('mode-agent'));
  await page.waitForTimeout(1200);
  const shellLabel = await page.evaluate(() => {
    const label = document.querySelector('.vstermsel');
    const windows = /windows/i.test(navigator.userAgent) || /^win/i.test(navigator.platform || '');
    return label ? { text: label.textContent.trim(), title: label.title, expected: windows ? 'Windows Command Prompt' : 'System shell', windows } : null;
  });
  ok('the terminal names the actual system shell instead of a vague shell label',
    shellLabel && shellLabel.text === shellLabel.expected && (!shellLabel.windows || /cmd\.exe/.test(shellLabel.title)),
    JSON.stringify(shellLabel));

  for (const name of PANELS) {
    await page.click(`.vsptabs [data-vsp="${name}"]`);
    await page.waitForTimeout(150);
    const state = await page.evaluate((n) => {
      const selected = [...document.querySelectorAll('.vsptabs [data-vsp]')]
        .filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.vsp);
      const shown = [...document.querySelectorAll('.vspbody .vsp')]
        .filter((p) => p.classList.contains('on')).map((p) => p.dataset.vsp);
      const pane = document.querySelector(`.vspbody .vsp[data-vsp="${n}"]`);
      return {
        selected,
        shown,
        text: pane ? pane.textContent.replace(/\s+/g, ' ').trim() : null,
        visible: pane ? pane.getClientRects().length > 0 : false,
      };
    }, name);
    ok(`the ${name} tab is the only one selected`,
      state.selected.length === 1 && state.selected[0] === name, JSON.stringify(state.selected));
    ok(`the ${name} tab reveals its own pane, alone`,
      state.shown.length === 1 && state.shown[0] === name, JSON.stringify(state.shown));
    ok(`the ${name} pane is a real, visible pane with content`,
      state.visible && !!state.text && state.text.length > 0, `text=${JSON.stringify((state.text || '').slice(0, 80))}`);
  }

  /* ============================================================
   * 5 · nothing fabricated survives in the panel
   * ============================================================ */
  const panelText = await page.evaluate(() =>
    document.querySelector('.vspbody').textContent.replace(/\s+/g, ' '));
  const leftovers = FIXTURES.filter((f) => panelText.includes(f));
  ok('no artifact sample data is left standing in the panel', leftovers.length === 0,
    `the panel still shows ${JSON.stringify(leftovers)}`);

  // The Ports pane can only honestly report the one process this page talks to.
  const ports = await page.evaluate(() => {
    const pane = document.querySelector('.vspbody .vsp[data-vsp="ports"]');
    const badge = document.querySelector('.vsptabs [data-vsp="ports"] .fct');
    return {
      text: pane ? pane.textContent.replace(/\s+/g, ' ').trim() : '',
      rows: pane ? pane.querySelectorAll('.fchg').length : -1,
      badge: badge ? badge.textContent.trim() : null,
      port: location.port,
    };
  });
  ok('the Ports pane lists this daemon\'s real port', ports.text.includes(ports.port), JSON.stringify(ports.text.slice(0, 120)));
  ok('the Ports tab count is not a fabricated number',
    ports.badge === null || ports.badge === String(ports.rows),
    `the tab claims "${ports.badge}" while the pane draws ${ports.rows} row(s)`);

  /* ============================================================
   * 6 · the window's terminal runs the REAL command
   * ============================================================ */
  await page.click('.vsptabs [data-vsp="terminal"]');
  await page.waitForTimeout(200);

  const seeded = await page.evaluate(() => document.getElementById('vs-term').textContent);
  ok('the artifact\'s fake scrollback is cleared before the owner sees it',
    !/142 passed|src\/App\.tsx/.test(seeded), JSON.stringify(seeded.slice(0, 160)));

  const exitAtRest = await page.evaluate(() => document.getElementById('vs-lastexit').textContent.trim());
  ok('the status bar claims no exit code before a command has run', exitAtRest === 'exit —',
    `it showed "${exitAtRest}" — the artifact ships a hardcoded "exit 0"`);

  const before = network.length;
  await typeCommand(page, 'git --version');
  const ran = await page.waitForFunction(
    () => /git version \d+\.\d+/.test(document.getElementById('vs-term').textContent),
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok('the window shows the real git version the shell printed', ran,
    await page.evaluate(() => document.getElementById('vs-term').textContent.slice(-200)));

  const posts = network.slice(before).filter((r) => r === 'POST /forge/terminal');
  ok.eq('typing a command sent exactly one request to the daemon', posts.length, 1);

  const termText = await page.evaluate(() => document.getElementById('vs-term').textContent);
  ok('the window reports the real exit code of the run', /\[exited 0 · \d+ms\]/.test(termText),
    JSON.stringify(termText.slice(-200)));
  ok('the mock\'s canned table did not answer instead', !/142 passed|not recognized in this sandbox/.test(termText),
    JSON.stringify(termText.slice(-200)));

  const exitOk = await page.evaluate(() => document.getElementById('vs-lastexit').textContent.trim());
  ok.eq('the status bar shows the real exit code after a success', exitOk, 'exit 0');

  /* ============================================================
   * 7 · a failure in the window is reported as a failure
   * ============================================================ */
  await typeCommand(page, badRef);
  const failShown = await page.waitForFunction(
    (code) => document.getElementById('vs-term').textContent.includes(`[exited ${code} ·`),
    failCode,
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok(`the window reports the failing command's real exit ${failCode}`, failShown,
    await page.evaluate(() => document.getElementById('vs-term').textContent.slice(-300)));

  const failText = await page.evaluate(() => document.getElementById('vs-term').textContent);
  ok('the failure\'s stderr is shown, not swallowed', /fatal|Needed a single revision/i.test(failText),
    JSON.stringify(failText.slice(-300)));

  const exitBad = await page.evaluate(() => document.getElementById('vs-lastexit').textContent.trim());
  ok.eq('the status bar reflects the real last exit code, not a hardcoded 1', exitBad, `exit ${failCode}`);
}
