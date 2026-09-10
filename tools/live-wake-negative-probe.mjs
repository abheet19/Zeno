/* Deterministic desktop probe: speech without a leading wake phrase stays inert. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT;
if (!endpoint) throw new Error('ZENO_CDP_ENDPOINT is required.');
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  await page.locator('[data-nav="command"]').click();
  const toggle = page.locator('.zv-wake-toggle');
  await toggle.click();
  await page.locator('#zv-disclosure').waitFor({ state: 'visible' });
  await page.locator('.zv-ack-box').check();
  await page.locator('.zv-confirm').click();
  await page.waitForFunction(() => document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') === 'true');
  await page.locator('.zv-live').waitFor({ state: 'visible' });
  await page.waitForTimeout(8_000);
  const beforeStop = await page.evaluate(() => ({
    heard: document.querySelector('.zv-heard')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    outcome: document.querySelector('.zv-outcome')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    status: document.querySelector('.zv-status')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    retention: document.querySelector('.zv-retention-text')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
  }));
  assert.equal(beforeStop.heard, '', 'speech without a leading wake phrase must not become a command');
  assert.equal(beforeStop.outcome, '', 'speech without a leading wake phrase must not produce an outcome');
  assert.equal(beforeStop.wake, 'true');
  assert.equal(beforeStop.microphoneBarVisible, true);
  await page.locator('.zv-live-stop').click();
  await page.waitForFunction(() => document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') === 'false');
  const afterStop = await page.evaluate(() => ({
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
    retention: document.querySelector('.zv-retention-text')?.textContent?.replace(/\s+/g, ' ').trim() || '',
  }));
  assert.deepEqual(afterStop, { wake: 'false', microphoneBarVisible: false, retention: 'Holding now: nothing.' });
  process.stdout.write(`${JSON.stringify({ beforeStop, afterStop })}\n`);
} finally {
  await browser.close();
}
