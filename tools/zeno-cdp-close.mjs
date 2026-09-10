import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT;
if (!endpoint) throw new Error('ZENO_CDP_ENDPOINT is required.');
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error('Zeno renderer was not found.');
await page.close({ runBeforeUnload: true });
await browser.close();
