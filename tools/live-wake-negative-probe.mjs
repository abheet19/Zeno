/* Deterministic desktop probe: speech without a leading wake phrase stays inert. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT;
if (!endpoint) throw new Error('ZENO_CDP_ENDPOINT is required.');
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  const openModal = page.locator('.modal:not([hidden])');
  if (await openModal.count()) await page.keyboard.press('Escape');
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
  await page.waitForTimeout(8_000);
  const beforeStop = await page.evaluate((turns) => ({
    status: document.querySelector('.zv-status')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    wake: localStorage.getItem('zeno.voice.wake') ? 'true' : 'false',
    voice: document.querySelector('#voice-state')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    turns,
  }), await page.locator('#home-turns').locator(':scope > *').count());
  assert.equal(beforeStop.wake, 'true');
  assert.match(beforeStop.voice, /listening/i);
  assert.equal(beforeStop.turns, turnsBefore, 'silence must not create a Command turn');
  await page.locator('.product[data-product="command"] [data-open-settings]').click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('[data-setcat="voice"]').click();
  await toggle.click();
  await page.waitForFunction(() => !localStorage.getItem('zeno.voice.wake'));
  const afterStop = await page.evaluate(() => ({
    wake: localStorage.getItem('zeno.voice.wake') ? 'true' : 'false',
    voice: document.querySelector('#voice-state')?.textContent?.replace(/\s+/g, ' ').trim() || '',
  }));
  assert.equal(afterStop.wake, 'false');
  assert.doesNotMatch(afterStop.voice, /listening/i);
  process.stdout.write(`${JSON.stringify({ beforeStop, afterStop })}\n`);
} finally {
  await browser.close();
}
