/*
 * The window must be LIVE, not a photograph of the moment it loaded.
 *
 * The daemon has always published /stream — receipts, previews, chain checks,
 * the size of the decision queue — and the renderer subscribed to none of it.
 * Every binder ran once at boot and never again, so an agent proposing
 * something while the window was open was simply invisible: no card, no rail
 * count, no sealed receipt in the ledger, until the owner happened to reload.
 * For a product whose entire job is catching what needs a human, that silence
 * was the failure.
 *
 * This flow does not navigate, does not reload, and does not click anything
 * before asserting. It sits on a screen and waits for the daemon to tell it.
 */

export const id = 'live-updates';
export const title = 'A proposal raised while the window is open appears without a reload';
export const criteria = ['SUITE-AC-02'];

export async function run({ daemon, page, ok }) {
  await page.click('.nav-i[data-screen="approvals"]');
  await page.waitForTimeout(1000);

  const before = await page.$$eval('.screen[data-screen="approvals"] .caps', (e) => e.length);
  ok.eq('the queue starts empty on screen', before, 0);

  const railBefore = await page.evaluate(() =>
    document.querySelector('.rail .nav-i[data-screen="approvals"] .ct')?.textContent || '');
  ok.eq('the rail count starts blank', railBefore, '');

  // An AGENT proposes. Nothing in the window is touched.
  const proposed = await daemon.agent('/memory/propose', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'fact',
      description: 'Arrived while you were watching',
      body: 'This proposal was raised after the window had finished loading.',
      requestedBy: 'agent:e2e',
    }),
  });
  ok.eq('the agent could propose', proposed.status, 200);

  // No reload, no navigation, no click. Just wait for the stream to do its job.
  const appeared = await page.waitForFunction(
    () => document.querySelectorAll('.screen[data-screen="approvals"] .caps').length > 0,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('the held action appears on its own', appeared, 'nothing arrived within 15s of the proposal');

  if (appeared) {
    const shown = await page.$$eval('.screen[data-screen="approvals"] .caps', (els) =>
      els.map((c) => c.textContent.replace(/\s+/g, ' ').slice(0, 80)));
    ok('and it is the one that was proposed',
      shown.some((t) => /Arrived while you were watching/.test(t)), JSON.stringify(shown));
  }

  const railAfter = await page.waitForFunction(
    () => (document.querySelector('.rail .nav-i[data-screen="approvals"] .ct')?.textContent || '') === '1',
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('the rail count follows the queue', railAfter,
    await page.evaluate(() => `rail shows "${document.querySelector('.rail .nav-i[data-screen="approvals"] .ct')?.textContent}"`));

  // …and it must go back down when the action is settled, for the same reason.
  const st = await daemon.api('/state');
  await daemon.api('/memory/approvals/decline', {
    method: 'POST',
    body: JSON.stringify({ actionHash: st.body.pending[0].actionHash }),
  });
  const cleared = await page.waitForFunction(
    () => document.querySelectorAll('.screen[data-screen="approvals"] .caps').length === 0,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('settling an action clears it from the window too', cleared);
}
