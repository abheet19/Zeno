/*
 * Windows-only manual acceptance probe for the real microphone path. It holds
 * the rendered push-to-talk control while Windows TTS plays through the local
 * output device, so Whisper, wake parsing, grammar, and UI feedback are all
 * exercised together. Launch Zeno with a loopback-only CDP port before running.
 */
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

  const stopWake = page.locator('.zv-live-stop');
  if (await stopWake.isVisible()) await stopWake.click();
  await page.locator('[data-nav="command"]').click();

  const button = page.locator('.zv-ptt');
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  const box = await button.boundingBox();
  if (!box) throw new Error('Push-to-talk is not visible.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await speak(phrase);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => ({
    heard: document.querySelector('.zv-heard')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    outcome: document.querySelector('.zv-outcome')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    status: document.querySelector('.zv-status')?.textContent?.trim() || '',
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
  }));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
}
