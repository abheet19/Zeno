/*
 * Windows-only acceptance probe for Zeno's opt-in wake mode. It exercises the
 * disclosure gate, persistent microphone indicator, local Whisper path, wake
 * parser, command policy, and one-click stop in the real Electron renderer.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT || 'http://127.0.0.1:9228';
const phrase = process.argv.slice(2).join(' ').trim() || 'Zeno, what is waiting?';

function speak(text) {
  const escaped = text.replaceAll("'", "''");
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$voice = [System.Speech.Synthesis.SpeechSynthesizer]::new()',
    '$voice.Rate = -1',
    '$voice.Volume = 100',
    `$voice.Speak('${escaped}')`,
    '$voice.Dispose()',
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`TTS exited with ${code}`)));
  });
}

const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  const toggle = page.locator('.zv-wake-toggle');
  if (await toggle.getAttribute('aria-pressed') === 'true') {
    const stop = page.locator('.zv-live-stop');
    if (await stop.isVisible()) await stop.click();
  }
  // Reload after any previous wake session is closed so this probe always tests
  // the current served bundle rather than a renderer left open during a rebuild.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-nav="command"]').click();

  await page.evaluate(() => {
    window.__zenoWakeBarEvents = [];
    const bar = document.querySelector('.zv-live');
    const record = () => window.__zenoWakeBarEvents.push({
      at: performance.now(),
      hidden: Boolean(bar?.hidden),
      text: bar?.textContent?.replace(/\s+/g, ' ').trim() || '',
    });
    record();
    if (bar) new MutationObserver(record).observe(bar, { attributes: true, childList: true, subtree: true });
  });

  await toggle.click();
  const disclosure = page.locator('#zv-disclosure');
  await disclosure.waitFor({ state: 'visible' });
  await page.locator('.zv-ack-box').check();
  await page.locator('.zv-confirm').click();
  await page.waitForFunction(() => document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') === 'true');
  await page.locator('.zv-live').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await speak(phrase);
  await page.waitForFunction(() => {
    const heard = document.querySelector('.zv-heard')?.textContent || '';
    return heard.includes('Heard:');
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(1_000);

  const beforeStop = await page.evaluate(() => ({
    heard: document.querySelector('.zv-heard')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    outcome: document.querySelector('.zv-outcome')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    status: document.querySelector('.zv-status')?.textContent?.trim() || '',
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
    captureOwner: document.body.getAttribute('data-zeno-capture') || '',
    events: window.__zenoWakeBarEvents || [],
  }));
  assert.equal(beforeStop.wake, 'true');
  assert.equal(beforeStop.microphoneBarVisible, true);
  assert.notEqual(beforeStop.captureOwner, 'counsel', 'Counsel did not own the microphone during Command wake mode');
  const firstVisible = beforeStop.events.findIndex(event => event.hidden === false);
  assert.ok(firstVisible >= 0, 'the persistent listening bar became visible');
  assert.equal(beforeStop.events.slice(firstVisible).some(event => event.hidden === true), false, 'the listening bar did not flicker closed');

  await page.locator('.zv-live-stop').click();
  await page.waitForFunction(() => document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') === 'false');
  const afterStop = await page.evaluate(() => ({
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
    captureOwner: document.body.getAttribute('data-zeno-capture') || '',
  }));
  assert.deepEqual(afterStop, { wake: 'false', microphoneBarVisible: false, captureOwner: '' });
  process.stdout.write(`${JSON.stringify({ phrase, beforeStop, afterStop })}\n`);
} finally {
  await browser.close();
}
