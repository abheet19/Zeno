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
 *   node tools/record-demos.mjs                 # every flow
 *   node tools/record-demos.mjs gate shell      # only these
 *
 * Flows:  gate · self-approval · shell · forge
 *
 * `shell` and `forge` start a governed Forge run, which needs the `claude` CLI
 * on PATH and signed in. The other two need nothing but the daemon.
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
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE = join(ROOT, '.zeno-demo');
const SCRATCH = join(ROOT, '.demo-scratch');
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
    env: { ...process.env, ZENO_DIR: WORKSPACE, ZENO_PORT: String(PORT) },
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

  /** One frame, held for `ms`. */
  async hold(ms) {
    const file = join(this.dir, String(this.frames.length).padStart(4, '0') + '.png');
    await this.page.screenshot({ path: file });
    this.frames.push({ file, ms });
  }

  /** `count` frames `ms` apart — for the moments where the movement is the point. */
  async burst(count, ms = 120) {
    for (let i = 0; i < count; i++) {
      await this.hold(ms);
      await sleep(ms);
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

/**
 * forge.gif — the coding agent, end to end.
 * A task goes in, the agent works headless in a throwaway git worktree, and the
 * file it wrote comes back readable in the editor. An ordinary source file is a
 * routine edit, so it is applied and receipted without interrupting anyone — and
 * then the consequential act, the commit, stops and waits like everything else.
 */
async function forge(browser, ctx) {
  const page = await openWindow(browser, ctx.url());
  const rec = new Recorder(page, 'forge');

  await page.click('[data-nav="forge"]');
  await page.waitForTimeout(2200);
  await rec.hold(1800); // the repository is empty and nothing has run

  const box = page.locator('input[placeholder^="Describe the change"]');
  await box.click();
  await box.type(FORGE_TASK, { delay: 24 });
  await rec.hold(2000);
  await box.press('Enter');
  await rec.burst(6, 340);

  // The agent is headless in a worktree it cannot escape. Waiting for it is the
  // boring part of the demo, so it is waited through rather than filmed.
  await page.waitForSelector('text=greet.js', { timeout: 600_000 });
  await page.waitForTimeout(2500);
  await rec.hold(3000); // the file it wrote, listed by git — not by the agent's say-so

  // Open it in the editor. The pane reads the file out of the repository — with
  // nothing selected it shows nothing, so what appears here is what is on disk.
  await page.locator('.tree button', { hasText: 'greet.js' }).first().click();
  await page.waitForSelector('.monaco-editor', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await rec.hold(4400); // the code the agent actually wrote

  // An ordinary source file is a routine edit: applied and receipted, uninterrupted.
  await page.click('[data-nav="command"]');
  await page.waitForTimeout(1400);
  await aim(page, '[data-jump="timeline"]');
  await page.click('[data-jump="timeline"]');
  await page.waitForTimeout(1400);
  await rec.hold(4000); // local.write · T0 · verified — and one uncommitted change

  // The commit is a separate act, and it is not routine. `Commit through the gate`
  // previews a vcs.commit, takes the owner's click as the approval, and lands one
  // commit with a receipt of its own — it is the only write Forge itself performs.
  await page.click('[data-nav="forge"]');
  await page.waitForTimeout(1600);
  await page.click('button:has-text("Source control")');
  await page.waitForTimeout(1600);
  await rec.hold(2600); // untracked · master · the one button, and what it says it does
  const msg = page.locator('input[placeholder="commit message"]');
  await msg.click();
  await msg.type('add greet.js', { delay: 45 });
  await rec.hold(1800);
  await page.click('button:has-text("Commit through the gate")');
  await rec.burst(8, 240);
  await page.waitForTimeout(2000);
  await rec.hold(3200); // committed once — the working tree is clean again

  await page.click('[data-nav="command"]');
  await page.waitForTimeout(1400);
  await aim(page, '[data-jump="timeline"]');
  await page.click('[data-jump="timeline"]');
  await page.waitForTimeout(1400);
  await rec.hold(4600); // chain verified — 2 receipts: the write, and the commit

  await rec.write();
  await page.close();
}

const FORGE_TASK =
  'Create a file greet.js that exports a function greet(name) returning a greeting string. Nothing else.';

/* -------------------------------------------------------------------- main */

const SCENES = { gate, 'self-approval': selfApproval, shell, forge };

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = wanted.length > 0 ? wanted : Object.keys(SCENES);
  for (const n of names) if (!(n in SCENES)) throw new Error('unknown demo: ' + n);

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
      await ctx.restart();
      await (n === 'shell' || n === 'forge' ? SCENES[n](browser, ctx) : SCENES[n](browser, url));
    }
  } finally {
    await browser.close();
    if (daemon) await daemon.stop();
    rmSync(WORKSPACE, { recursive: true, force: true });
  }
}

await main();
