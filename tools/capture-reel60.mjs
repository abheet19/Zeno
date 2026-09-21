/**
 * Capture Zeno's current product story as one continuous reel.
 *
 * The recorder starts a clean daemon and a disposable Git repository, then
 * drives the real Command, approval, Forge and Counsel surfaces with
 * Playwright. The proposal, approval, receipt and terminal command all travel
 * through the same routes used by the desktop app.
 *
 * Run:
 *   npm run build
 *   node tools/capture-reel60.mjs
 *
 * Outputs:
 *   docs/media/zeno-reel.mp4  (H.264, 60 fps)
 *   docs/media/zeno-demo.gif  (small looping README preview)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MEDIA = join(ROOT, 'docs', 'media');
const OUT_MP4 = join(MEDIA, 'zeno-reel.mp4');
const OUT_GIF = join(MEDIA, 'zeno-demo.gif');
const WORKSPACE = join(ROOT, '.zeno-reel');
const PROJECT = join(ROOT, '.reel-scratch', 'shipment-classifier');
const PORT = Number(process.env.ZENO_REEL_PORT ?? 7412);
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(MEDIA, { recursive: true });

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    // Continue to the standard winget location used by the other project reels.
  }
  const winget =
    'C:/Users/abhee/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe';
  try {
    execSync(`"${winget}" -version`, { stdio: 'ignore' });
    return winget;
  } catch {
    throw new Error('ffmpeg not found. Put it on PATH or set FFMPEG to the executable path.');
  }
}

function prepareProject() {
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  writeFileSync(join(PROJECT, 'README.md'), '# Shipment classifier\n\nA disposable repository used by the Zeno reel.\n');
  writeFileSync(join(PROJECT, 'app.py'), [
    'def classify_delay(hours: int) -> str:',
    '    if hours < 0:',
    '        raise ValueError("hours must be non-negative")',
    '    if hours < 24:',
    '        return "on_time"',
    '    if hours < 48:',
    '        return "monitor"',
    '    return "escalate"',
    '',
  ].join('\n'));
  writeFileSync(join(PROJECT, 'package.json'), JSON.stringify({
    name: 'shipment-classifier-demo',
    version: '1.0.0',
    private: true,
  }, null, 2) + '\n');
  execFileSync('git', ['init', '-q'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Zeno Reel'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'reel@localhost'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: PROJECT, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'reel fixture'], { cwd: PROJECT, stdio: 'ignore' });
}

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
  child.stdout.on('data', (chunk) => { banner += String(chunk); });
  child.stderr.on('data', (chunk) => { banner += String(chunk); });
  return {
    child,
    async ready() {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const match = /window\s+(http:\/\/127\.0\.0\.1:\d+\/\?k=[0-9a-f]+)/.exec(banner);
        if (match) return match[1];
        await sleep(100);
      }
      throw new Error(`Zeno did not start:\n${banner}`);
    },
  };
}

function proposerToken() {
  return readFileSync(join(WORKSPACE, 'proposer.token'), 'utf8').trim();
}

async function proposePackageChange() {
  const response = await fetch(`http://127.0.0.1:${PORT}/previews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeno-token': proposerToken() },
    body: JSON.stringify({
      relPath: 'package.json',
      summary: 'Mark the shipment classifier as demo-ready',
      contents: JSON.stringify({
        name: 'shipment-classifier-demo',
        version: '1.0.1',
        private: true,
      }, null, 2) + '\n',
    }),
  });
  if (!response.ok) throw new Error(`Proposal failed: ${response.status} ${await response.text()}`);
}

async function main() {
  const ffmpeg = findFfmpeg();
  const videoDir = mkdtempSync(join(tmpdir(), 'zeno-reel-'));
  rmSync(WORKSPACE, { recursive: true, force: true });
  rmSync(join(ROOT, '.reel-scratch'), { recursive: true, force: true });
  prepareProject();

  const daemon = startDaemon();
  const url = await daemon.ready();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  let storyAt = startedAt;
  let endedAt = startedAt;
  let webm = '';

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#home-ta');
    await sleep(1800);
    storyAt = Date.now();

    // Command: the calm state becomes a held, reviewable action over live SSE.
    await sleep(1200);
    await proposePackageChange();
    await page.waitForFunction(() => document.body.textContent.includes('1 approval'));
    await sleep(1400);
    await page.locator('.nav-i[data-screen="approvals"]').click();
    await page.getByRole('button', { name: 'Allow once' }).waitFor({ state: 'visible' });
    await sleep(1200);
    await page.getByRole('button', { name: 'Allow once' }).click();
    await page.locator('.nav-i[data-screen="receipts"]').click();
    await page.waitForFunction(() => document.body.textContent.toLowerCase().includes('verified'));
    await sleep(1800);

    // Forge: the same selected repository, exact files and a real terminal result.
    await page.locator('.seg [data-product="forge"]').click();
    await page.waitForSelector('.product[data-product="forge"] #ide', { state: 'visible' });
    await sleep(1700);
    await page.locator('#forge-viewseg [data-forge-view="editor"]').click();
    await page.waitForSelector('.product[data-product="forge"] .wb', { state: 'visible' });
    await sleep(900);
    const appFile = page.getByRole('button', { name: /app\.py/ }).last();
    if (await appFile.count()) {
      await appFile.click();
      await sleep(1300);
    }
    const terminalTab = page.getByRole('tab', { name: 'Terminal' });
    if (await terminalTab.count()) await terminalTab.click();
    if (await page.locator('#vs-termin').count()) {
      await page.evaluate(() => {
        const input = document.querySelector('#vs-termin');
        input.value = 'python -c "from app import classify_delay; print(classify_delay(50))"';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(800);
      await page.evaluate(() => {
        document.querySelector('#vs-termin')?.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      });
      await page.waitForFunction(() => document.querySelector('#vs-term')?.textContent?.includes('escalate'), null, { timeout: 20_000 });
      await sleep(1900);
    }

    // Counsel: finish on the explicit-consent boundary, not a fabricated meeting.
    await page.locator('.seg [data-product="counsel"]').click();
    await sleep(1400);
    const record = page.locator('#cn-record');
    if (await record.count()) {
      await record.click();
      await sleep(1800);
    }
    endedAt = Date.now();
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) webm = await video.path();
    daemon.child.kill();
    await sleep(500);
    rmSync(WORKSPACE, { recursive: true, force: true });
    rmSync(join(ROOT, '.reel-scratch'), { recursive: true, force: true });
  }

  if (!webm) throw new Error('Playwright did not produce a reel recording.');
  const trimStart = Math.max(0, (storyAt - startedAt) / 1000 - 0.2);
  const duration = Math.max(1, (endedAt - storyAt) / 1000 + 0.5);
  // Blend interpolation keeps the reel fluid at 60 fps without turning a
  // short README capture into a several-minute motion-estimation job.
  const mp4Filter = 'minterpolate=fps=60:mi_mode=blend,scale=1280:-2:flags=lanczos,format=yuv420p';
  let result = spawnSync(ffmpeg, [
    '-y', '-ss', trimStart.toFixed(2), '-t', duration.toFixed(2), '-i', webm,
    '-vf', mp4Filter, '-r', '60', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-movflags', '+faststart', '-an', OUT_MP4,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg MP4 encode exited ${result.status}`);

  const gifFilter = 'fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3';
  result = spawnSync(ffmpeg, ['-y', '-i', OUT_MP4, '-filter_complex', gifFilter, '-loop', '0', OUT_GIF], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg GIF encode exited ${result.status}`);

  rmSync(videoDir, { recursive: true, force: true });
  const size = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(2)} MB`;
  console.log(`wrote ${OUT_MP4} (${size(OUT_MP4)})`);
  console.log(`wrote ${OUT_GIF} (${size(OUT_GIF)})`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
