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
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.seg [data-product="command"]').click();
  await page.locator('.product[data-product="command"] .nav-i[data-screen="home"]').click();
  await page.locator('.product[data-product="command"] [data-open-settings]').click();
  const modal = page.locator('#settings-modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('[data-setcat="voice"]').click();
  const toggle = modal.locator('.setrow', { hasText: 'Wake word' }).locator('.toggle[role="switch"]');
  if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
  page.once('dialog', dialog => dialog.accept());
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('#voice-state')?.textContent?.includes('listening'));
  await page.keyboard.press('Escape');
  const turnsBefore = await page.locator('#home-turns').locator(':scope > *').count();
  await page.waitForTimeout(500);
  await speak(phrase);
  await page.waitForTimeout(5_000);
  const beforeStop = await page.evaluate((before) => ({
    wake: localStorage.getItem('zeno.voice.wake') ? 'true' : 'false',
    voice: document.querySelector('#voice-state')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    captureOwner: document.body.getAttribute('data-zeno-capture') || '',
    turnsBefore: before,
    turnsAfter: document.querySelector('#home-turns')?.children.length || 0,
  }), turnsBefore);
  assert.equal(beforeStop.wake, 'true');
  assert.match(beforeStop.voice, /listening/i);
  assert.notEqual(beforeStop.captureOwner, 'counsel', 'Counsel did not own the microphone during Command wake mode');
  const acoustic = beforeStop.turnsAfter > beforeStop.turnsBefore
    ? 'PASS'
    : 'BLOCKED — synthesized speaker output was not captured by the physical microphone input';
  await page.locator('.product[data-product="command"] [data-open-settings]').click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('[data-setcat="voice"]').click();
  await toggle.click();
  await page.waitForFunction(() => !localStorage.getItem('zeno.voice.wake'));
  const afterStop = await page.evaluate(() => ({
    wake: localStorage.getItem('zeno.voice.wake') ? 'true' : 'false',
    voice: document.querySelector('#voice-state')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    captureOwner: document.body.getAttribute('data-zeno-capture') || '',
  }));
  assert.equal(afterStop.wake, 'false');
  assert.doesNotMatch(afterStop.voice, /listening/i);
  process.stdout.write(`${JSON.stringify({ phrase, acoustic, beforeStop, afterStop })}\n`);
} finally {
  await browser.close();
}
