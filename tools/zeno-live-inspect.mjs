import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT || 'http://127.0.0.1:9228';
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  const state = await page.evaluate(() => ({
    title: document.title,
    nav: document.querySelector('[data-nav][aria-current="page"]')?.getAttribute('data-nav') || '',
    heard: document.querySelector('.zv-heard')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    outcome: document.querySelector('.zv-outcome')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    status: document.querySelector('.zv-status')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    wake: document.querySelector('.zv-wake-toggle')?.getAttribute('aria-pressed') || 'false',
    microphoneBarVisible: !document.querySelector('.zv-live')?.hidden,
    captureOwner: document.body.getAttribute('data-zeno-capture') || '',
    bodyText: document.body.innerText.slice(0, 4000),
  }));
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
} finally {
  await browser.close();
}
