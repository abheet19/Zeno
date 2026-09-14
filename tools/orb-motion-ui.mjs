import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.ZENO_ORB_URL;
if (!url) throw new Error('Set ZENO_ORB_URL to an owner-authorised local Zeno URL.');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript(() => localStorage.setItem('zeno-mo', '1'));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#field').waitFor({ state: 'visible' });

  assert.equal(await page.locator('#field').count(), 1, 'the real Standing Field is mounted');
  assert.equal(await page.locator('#orb').count(), 0, 'the retired artifact canvas is detached');

  const frame = () => page.locator('#field').evaluate((canvas) => canvas.toDataURL());
  const movingA = await frame();
  await page.waitForTimeout(450);
  const movingB = await frame();
  assert.notEqual(movingA, movingB, 'the visible field changes frames when motion is enabled');

  await page.locator('#rm-toggle').evaluate((control) => control.click());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#rm-toggle').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('html').getAttribute('data-reduce'), '1');
  const stillA = await frame();
  await page.waitForTimeout(450);
  const stillB = await frame();
  assert.equal(stillA, stillB, 'Reduce motion freezes the visible field without hiding it');

  await page.locator('#rm-toggle').evaluate((control) => control.click());
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#rm-toggle').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('html').getAttribute('data-reduce'), '0');
  const resumedA = await frame();
  await page.waitForTimeout(450);
  const resumedB = await frame();
  assert.notEqual(resumedA, resumedB, 'turning Reduce motion off resumes the visible field immediately');

  process.stdout.write('PASS: visible orb animates, reduces, and resumes through the real setting.\n');
} finally {
  await browser.close();
}
