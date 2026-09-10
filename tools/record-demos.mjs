/**
 * Record Zeno's hero flows as real GIFs.
 * ======================================
 *
 * Every frame in every GIF this script produces is a screenshot of the real
 * daemon serving the real window, driving the real kernel. Nothing is mocked,
 * drawn, or staged: the script starts a daemon, proposes through the same HTTP
 * routes an agent uses, clicks the same buttons the owner clicks, and
 * photographs whatever comes back. If a flow breaks, the GIF shows it breaking.
 *
 *   node tools/record-demos.mjs                 # current flows
 *   node tools/record-demos.mjs gate shell      # only these
 *
 * Current flows:  gate · self-approval · forge · shell
 *
 * `forge.gif` records the current owner-review workbench flow against a small,
 * disposable repository. `shell` starts a governed Claude Code run and needs
 * the `claude` CLI on PATH and signed in. The other scenes need only the daemon.
 *
 * Requires:  npm install                        (playwright is a devDependency)
 *            npx playwright install chromium
 *            python with Pillow                 (assembles the frames)
 *
 * ffmpeg is deliberately NOT used and is not required.
 *
 * The daemon this starts owns its OWN workspace (.zeno-demo) and its own port,
 * so it never contends with a Zeno you already have running — two daemons on one
 * workspace would fork the receipt chain, and the daemon correctly refuses. The
 * workspace is removed on exit; the captured frames stay in .demo-scratch (which
 * is gitignored) so a GIF can be re-assembled without re-recording it.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE = join(ROOT, '.zeno-demo');
const SCRATCH = join(ROOT, '.demo-scratch');
const PROJECT = join(SCRATCH, 'forge-fixture');
const OUTDIR = join(ROOT, 'docs', 'demos');
const PORT = Number(process.env['ZENO_DEMO_PORT'] ?? 7399);

// The viewport width matters more than it looks. GitHub lays README images out
// in a column about 850px wide, so a 1600px-wide page arrives at roughly half
// size and every label in it turns to mush. A 1040px page shown at 850 is at
// ~82%, which is the difference between reading the capsule and squinting at it.
// Captured at 2x so the downscale has real detail to work from.
const VIEWPORT = { width: 1040, height: 700 };
const SCALE = 2;
// Emitted at 1.5x the CSS width. GitHub still lays the image out at ~850 CSS px,
// so the extra pixels are density, not size: on any modern display the small type
// resolves instead of smearing.
const GIF_WIDTH = 1560;
const PYTHON = process.env['PYTHON'] ?? 'python';

/* -------------------------------------------------------------- the daemon */

/**
 * Start a daemon on our own workspace and wait for it to say where it is.
 * The `?k=` nonce in that banner is what authorises the owner session, so the
 * banner is not decoration — it is the only way in.
 */
function startDaemon() {
  const child = spawn(process.execPath, [join('packages', 'daemon', 'dist', 'src', 'main.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ZENO_DIR: WORKSPACE,
      ZENO_PROJECT_DIR: PROJECT,
      ZENO_PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let banner = '';
  child.stdout.on('data', (b) => (banner += String(b)));
  child.stderr.on('data', (b) => (banner += String(b)));
  return {
    child,
    async ready() {
      for (let i = 0; i < 300; i++) {
        const m = /window\s+(http:\/\/127\.0\.0\.1:\d+\/\?k=[0-9a-f]+)/.exec(banner);
        if (m) return m[1];
        await sleep(100);
      }
      throw new Error('daemon never printed its window url:\n' + banner);
    },
    async stop() {
      child.kill();
      await sleep(600);
    },
  };
}

const proposerToken = () => readFileSync(join(WORKSPACE, 'proposer.token'), 'utf8').trim();

/** Build the real, disposable repository shown in every recording. */
function prepareProject() {
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(join(PROJECT, '.agents', 'skills', 'verify'), { recursive: true });
  writeFileSync(join(PROJECT, 'README.md'), '# Zeno recording fixture\n\nA disposable repository used only by the demo recorder.\n');
  writeFileSync(join(PROJECT, 'AGENTS.md'), '# Repository rules\n\n- Keep changes exact and reviewable.\n- Run verification before reporting success.\n');
  writeFileSync(join(PROJECT, 'hello.ts'), 'export const hello = (name: string) => `Hello, ${name}`;\n');
  writeFileSync(join(PROJECT, 'package.json'), JSON.stringify({
    name: 'zeno-recording-fixture',
    version: '1.0.0',
    private: true,
    scripts: { test: 'node --test' },
  }, null, 2) + '\n');
  writeFileSync(join(PROJECT, '.agents', 'skills', 'verify', 'SKILL.md'), '# Verify\n\nRun the smallest relevant check and report its real result.\n');
  execFileSync('git', ['init', '-q'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Zeno Demo'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'demo@localhost'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'recording fixture'], { cwd: PROJECT, stdio: 'ignore' });
}

/** POST as the AGENT — the proposer token, the one that can ask for anything and approve nothing. */
async function agentPost(path, body) {
  const res = await fetch('http://127.0.0.1:' + PORT + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeno-token': proposerToken() },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/* ------------------------------------------------------------- the recorder */

/**
 * A frame list with per-frame durations.
 *
 * This is the whole size strategy. A three-second hold on the receipt is ONE
 * frame that says `ms: 3000`, not thirty identical ones — so a twenty-five
 * second demo is thirty pictures, not two hundred and fifty.
 */
class Recorder {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.dir = join(SCRATCH, 'frames', name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
  }

  /**
   * Hold the current state for (up to) `ms` — but never as one frozen frame.
   * Real continuous capture: a screenshot every ~110ms for the duration, so
   * anything moving on screen (an SSE update, a focus ring, a scroll) still
   * reads as motion instead of a jump-cut. No single beat is allowed to
   * freeze for more than ~1.4s — a moment that matters still gets a beat to
   * be readable, but nothing waits.
   */
  async hold(ms) {
    const CAP = 1400;
    const SAMPLE = 110;
    const total = Math.min(ms, CAP);
    const n = Math.max(1, Math.round(total / SAMPLE));
    const step = total / n;
    for (let i = 0; i < n; i++) {
      const file = join(this.dir, String(this.frames.length).padStart(4, '0') + '.png');
      await this.page.screenshot({ path: file });
      this.frames.push({ file, ms: Math.round(step) });
      if (i < n - 1) await sleep(step);
    }
  }

  /** `count` frames `ms` apart — for the moments where the movement is the point. */
  async burst(count, ms = 100) {
    const step = Math.max(80, Math.min(140, ms));
    for (let i = 0; i < count; i++) {
      await this.hold(step);
      await sleep(step);
    }
  }

  async write() {
    const manifest = join(this.dir, 'manifest.json');
    writeFileSync(
      manifest,
      JSON.stringify(
        // 224 colours, not 128: the window says things in colour that it also
        // says in words — amber for "approval owed", green for a verified seal —
        // and a palette tight enough to grey those out is a palette that edits
        // the meaning out of the picture.
        { out: join(OUTDIR, this.name + '.gif'), width: GIF_WIDTH, colors: 224, frames: this.frames },
        null,
        1,
      ),
    );
    await run(PYTHON, [join('tools', 'gif-assemble.py'), manifest]);
  }
}

function run(cmd, args) {
  return new Promise((ok, bad) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    c.on('exit', (code) => (code === 0 ? ok() : bad(new Error(cmd + ' exited ' + code))));
    c.on('error', bad);
  });
}

/** Bring an element into view and give it the product's own focus ring, so a click reads as a click. */
async function aim(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await el.focus().catch(() => {});
  await page.waitForTimeout(250);
  return el;
}

async function openWindow(browser, url) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'dark' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // The window opens a live SSE stream, so `networkidle` never arrives. Wait for
  // something the modules mount instead.
  await page.waitForSelector('[data-jump="pending"]');
  await page.waitForTimeout(2400);
  return page;
}

/* ------------------------------------------------------------------ scenes */

/**
 * gate.gif — the whole thesis in one clip.
 * An agent proposes something risky, it is HELD, the capsule states exactly what
 * will happen, the owner approves, and a signed receipt lands in the ledger.
 */
async function gate(browser, url) {
  const page = await openWindow(browser, url);
  const rec = new Recorder(page, 'gate');

  // The resting state. Ninety-nine times in a hundred, this is what the owner sees.
  await rec.hold(1800);

  // The agent asks. Same route, same proposer token, no privilege.
  await agentPost('/previews', {
    relPath: 'package.json',
    contents: '{\n  "name": "acme-web",\n  "version": "2.0.0",\n  "scripts": { "build": "vite build" }\n}\n',
    summary: 'bump the release version to 2.0.0',
  });
  await rec.burst(8, 130); // the hero flips live, over SSE
  await rec.hold(2200);

  await aim(page, '[data-jump="pending"]');
  await page.click('[data-jump="pending"]');
  await page.waitForTimeout(1000);
  await rec.hold(2600); // HELD · tier T1 · nothing has happened yet

  await aim(page, 'button:has-text("Open")');
  await page.click('button:has-text("Open")');
  await page.waitForTimeout(1300);
  await rec.hold(3200); // the capsule: what will happen, and the hash that binds it

  await page.mouse.wheel(0, 540);
  await page.waitForTimeout(800);
  await rec.hold(2800); // risk tier and why · the exact target path

  const approve = await aim(page, 'button.zn-approve');
  await rec.hold(1800); // the one control, armed
  await approve.click();
  await rec.burst(10, 160); // single use · one attempt
  await page.waitForTimeout(1400);
  await rec.hold(3600); // the receipt, as written

  await aim(page, '[data-jump="timeline"]');
  await page.click('[data-jump="timeline"]');
  await page.waitForTimeout(1200);
  await rec.hold(3800); // chain verified — signed, and on the record

  await rec.write();
  await page.close();
}

/**
 * self-approval.gif — the refusal.
 * The agent holds the proposer token. It drives the same window and presses the
 * same button. The daemon answers 403 self-approval-forbidden and the window
 * says so. Nothing here is prompted: the route has no branch that says yes.
 */
async function selfApproval(browser, url) {
  const page = await openWindow(browser, url);
  const rec = new Recorder(page, 'self-approval');

  await agentPost('/previews', {
    relPath: '.env',
    contents: 'DATABASE_URL=postgres://acme:hunter2@db.internal:5432/prod\n',
    summary: 'write the production database credentials into .env',
  });
  await page.waitForTimeout(1600);
  await aim(page, '[data-jump="pending"]');
  await page.click('[data-jump="pending"]');
  await page.waitForTimeout(1000);
  await rec.hold(3000);

  await aim(page, 'button:has-text("Open")');
  await page.click('button:has-text("Open")');
  await page.waitForTimeout(1300);
  await rec.hold(3200);

  // Now be the agent. Every POST /approvals this window makes goes out carrying
  // the PROPOSER token instead of the owner's — which is the attack exactly as it
  // would happen, an agent holding its own credential and asking for a yes.
  // Only the request header is substituted. Nothing on the server is touched and
  // the answer it gives below is its own, unedited.
  const token = proposerToken();
  await page.route('**/approvals', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-zeno-token': token } }),
  );

  await page.mouse.wheel(0, 540);
  await page.waitForTimeout(800);
  const approve = await aim(page, 'button.zn-approve');
  await rec.hold(2200);
  await approve.click();
  await rec.burst(8, 160);
  await page.waitForTimeout(1600);
  await page.mouse.wheel(0, -110); // keep the 403 strip and the refusal in one frame
  await page.waitForTimeout(500);
  await rec.hold(5200); // blocked · self-approval-forbidden, and an empty ledger under it

  await rec.write();
  await page.close();
}

/**
 * forge.gif — the current workbench, using a real repository and gate.
 *
 * The proposer creates a package change through /previews. Forge receives that
 * exact held action over SSE, the owner reviews and approves it in the Session
 * pane, and the terminal then proves the selected repository changed. The
 * fixture is discarded after the recording.
 */
async function forge(browser, url) {
  const page = await openWindow(browser, url);
  const rec = new Recorder(page, 'forge');

  await page.click('[data-nav="forge"]');
  await page.waitForSelector('.forge .rgTop');
  await page.waitForTimeout(1800);

  const agentsFile = page.getByRole('button', { name: /AGENTS\.md/ }).last();
  if (await agentsFile.count()) {
    await agentsFile.click();
    await page.waitForTimeout(900);
  }
  await rec.hold(2200); // readable Explorer, Monaco, terminal and Session together

  const nextPackage = JSON.stringify({
    name: 'zeno-recording-fixture',
    version: '2.0.0',
    private: true,
    scripts: { test: 'node --test' },
  }, null, 2) + '\n';
  const proposed = await agentPost('/previews', {
    relPath: 'package.json',
    contents: nextPackage,
    summary: 'Update the recording fixture package version to 2.0.0',
  });
  if (proposed.status !== 200) throw new Error('Forge preview failed: ' + JSON.stringify(proposed));

  await page.waitForSelector('.rgC button.zn-approve', { timeout: 20_000 });
  await rec.burst(8, 140);
  await rec.hold(2600); // the held proposal is visible in the active agent session

  const approve = await aim(page, '.rgC button.zn-approve');
  await rec.hold(1700);
  await approve.click();
  await page.waitForSelector('.rgC [data-receipt], .rgC .zn-seal', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1400);
  await rec.burst(8, 130);
  await rec.hold(2600); // the same capsule now carries its durable outcome

  const terminalTab = page.getByRole('tab', { name: 'Terminal' });
  await terminalTab.click();
  const command = page.locator('.rgD input[placeholder^="Type a command"]');
  await command.fill('git status --short');
  await rec.hold(1200);
  await page.getByRole('button', { name: 'Run command' }).click();
  await page.waitForFunction(() => document.querySelector('.rgD')?.textContent?.includes('exit 0'), null, { timeout: 20_000 });
  await rec.hold(3000); // a real owner-triggered terminal result in the selected folder

  await rec.write();
  await page.close();
}

/**
 * shell.gif — a command through the same gate.
 * A governed Forge run asks to run a shell command. It does not get to run it.
 * The capsule carries the literal command string, the owner grants it once, and
 * the ledger keeps a `shell.exec` receipt beside the file edits.
 */
async function shell(browser, ctx) {
  const page = await openWindow(browser, ctx.url());
  const rec = new Recorder(page, 'shell');

  await page.click('[data-nav="forge"]');
  await page.waitForTimeout(2200);
  await rec.hold(1800);

  // Type the task the way the owner types it, into the window's own box.
  const box = page.locator('input[placeholder^="Describe the change"]');
  await box.click();
  await box.type(SHELL_TASK, { delay: 26 });
  await rec.hold(2000);

  await box.press('Enter'); // the box says "↵ to run", and it means it
  await rec.burst(6, 320); // the agent starts, headless, in a throwaway worktree

  // The run BLOCKS on the owner. This is the capsule it raised, not a summary of one.
  await page.waitForSelector('button.zn-approve', { timeout: 300_000 });
  await page.waitForTimeout(2000);
  await rec.hold(3000); // "1 awaiting your decision" — the agent is stopped, mid-run

  // Read it where there is room to read it: the same queue every file edit lands in.
  await page.click('[data-nav="command"]');
  await page.waitForTimeout(1400);
  await aim(page, '[data-jump="pending"]');
  await page.click('[data-jump="pending"]');
  await page.waitForTimeout(1000);
  await rec.hold(2600); // T3 · Run: node --version

  await aim(page, 'button:has-text("Open")');
  await page.click('button:has-text("Open")');
  await page.waitForTimeout(1300);
  await rec.hold(4200); // the literal command string, before anything runs

  await page.mouse.wheel(0, 540);
  await page.waitForTimeout(800);
  const approve = await aim(page, 'button.zn-approve');
  await rec.hold(1800);
  await approve.click();
  await rec.burst(10, 220);
  await page.waitForTimeout(2500);
  await rec.hold(4200); // shell.exec · verified · one attempt, and a receipt for it

  await aim(page, '[data-jump="timeline"]');
  await page.click('[data-jump="timeline"]');
  await page.waitForTimeout(1400);
  await rec.hold(4000); // on the record, in the same ledger as every file edit

  await rec.write();
  await page.close();
}

const SHELL_TASK = 'Run the command node --version with the Bash tool, then stop. Do not edit any file.';

/* -------------------------------------------------------------------- main */

const SCENES = { gate, 'self-approval': selfApproval, forge, shell };

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = wanted.length > 0 ? wanted : Object.keys(SCENES);
  for (const n of names) {
    if (!(n in SCENES)) throw new Error('unknown demo: ' + n);
  }

  mkdirSync(OUTDIR, { recursive: true });

  let daemon = null;
  let url = '';
  const ctx = {
    url: () => url,
    daemon: () => daemon,
    async restart() {
      url = await (daemon = startDaemon()).ready();
    },
  };
  const browser = await chromium.launch();
  try {
    for (const n of names) {
      process.stdout.write('\n  recording ' + n + '\n');
      // Every demo starts from an empty ledger, so what it shows is only what it did.
      if (daemon) await daemon.stop();
      rmSync(WORKSPACE, { recursive: true, force: true });
      prepareProject();
      await ctx.restart();
      await (n === 'shell' ? SCENES[n](browser, ctx) : SCENES[n](browser, url));
    }
  } finally {
    await browser.close();
    if (daemon) await daemon.stop();
    rmSync(WORKSPACE, { recursive: true, force: true });
    rmSync(PROJECT, { recursive: true, force: true });
  }
}

await main();
