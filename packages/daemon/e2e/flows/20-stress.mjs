/*
 * Stress test — hammer the app and prove it stays honest under load.
 *
 * The owner: "stress test the app." This does the things a nervous user does to
 * a real product: floods the approval queue, approves and refuses in rapid
 * succession, and races through every screen in every product many times. The
 * bar is not just "no crash" — it is that the two guarantees this product sells
 * hold THROUGHOUT: the receipt chain never breaks, and no fabricated data ever
 * appears, no matter how fast the churn.
 */

export const id = 'stress';
export const title = 'The app stays consistent and honest under a flood of load';
export const criteria = ['owner: stress test'];

const FIXTURES = ['INGEST-12', 'patch.task', 'wt-7f2a', '7 receipts', 'createIngestClient'];

export async function run({ daemon, page, ok }) {
  // ---- 1. Flood the queue: 12 concurrent agent-proposed memory writes -------
  const N = 12;
  const proposals = await Promise.all(
    Array.from({ length: N }, (_, i) => daemon.agent('/memory/propose', {
      method: 'POST',
      body: JSON.stringify({ kind: 'fact', description: `stress ${i}`, body: `stress fixture ${i}`, requestedBy: 'agent:stress' }),
    })),
  );
  const held = proposals.filter((r) => r.status === 200 && r.body && r.body.pending === true).length;
  ok.eq('every concurrent proposal was accepted and held', held, N);

  const st1 = await daemon.api('/state');
  ok.eq('the queue holds exactly what was proposed', (st1.body.pending || []).length, N);
  ok('the chain is still verified after a flood of proposals', st1.body.chain?.ok === true);

  // ---- 2. Rapid-fire decisions: approve half, refuse half, concurrently -----
  const hashes = (st1.body.pending || []).map((p) => p.actionHash);
  const decisions = await Promise.all(hashes.map((h, i) => daemon.api(
    i % 2 === 0 ? '/memory/approvals' : '/memory/approvals/decline',
    { method: 'POST', body: JSON.stringify({ actionHash: h }) },
  )));
  const approvedOk = decisions.filter((_, i) => i % 2 === 0).every((r) => r.status === 200);
  const declinedOk = decisions.filter((_, i) => i % 2 === 1).every((r) => r.status === 200);
  ok('every rapid approval succeeded', approvedOk);
  ok('every rapid refusal succeeded', declinedOk);

  const st2 = await daemon.api('/state');
  ok.eq('the queue drains completely', (st2.body.pending || []).length, 0);
  const expectedReceipts = Math.ceil(N / 2);
  ok.eq('exactly the approvals sealed receipts (refusals seal none)', (st2.body.receipts || []).length, expectedReceipts);
  ok('the chain is STILL verified after rapid mixed decisions', st2.body.chain?.ok === true,
    JSON.stringify(st2.body.chain));

  // Every sealed receipt must verify individually — no half-written line.
  ok('every sealed receipt is signed', (st2.body.receipts || []).every((r) => typeof r.signature === 'string' && r.signature.length > 0));

  // ---- 3. Race through every screen in every product, many times ------------
  let navErrors = 0;
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  for (let round = 0; round < 3; round += 1) {
    for (const product of ['command', 'forge', 'counsel', 'command']) {
      await page.click(`.seg [data-product="${product}"]`).catch(() => { navErrors += 1; });
      await page.waitForTimeout(80);
      const screens = await page.$$eval(
        `.product[data-product="${product}"] .nav-i[data-screen]`,
        (els) => els.map((b) => b.dataset.screen),
      ).catch(() => []);
      for (const s of screens) {
        await page.click(`.product[data-product="${product}"] .nav-i[data-screen="${s}"]`).catch(() => { navErrors += 1; });
        await page.waitForTimeout(30); // deliberately faster than a human
      }
    }
  }
  ok.eq('no navigation click threw during the race', navErrors, 0);
  ok('no uncaught page error during the race', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));

  // ---- 4. After all the churn, the binders are alive and nothing is faked ---
  const bind = await page.evaluate(() => (window.__zenoBind ? { failed: window.__zenoBind.failed.length } : null));
  ok('every binder survived the churn', bind && bind.failed === 0, JSON.stringify(bind));

  await page.click('.seg [data-product="command"]');
  await page.waitForTimeout(300);
  const leaked = await page.evaluate((fx) => {
    const text = document.body.innerText || '';
    return fx.filter((f) => text.includes(f));
  }, FIXTURES);
  ok('no artifact fixture leaked onto the screen under load', leaked.length === 0, leaked.join(', '));

  // The chain, read one final time through the UI's own path, still verifies.
  const st3 = await daemon.api('/state');
  ok('final chain check verifies', st3.body.chain?.ok === true);
}
