/*
 * A local-first product must never make "send my code to a paid cloud" the only
 * button.
 *
 * Forge's first-run hero has no model selector (the design keeps it minimal), so
 * a first task always auto-routes, and the balanced-default router escalates a
 * generic task to a hosted agent. The egress boundary holds — nothing runs until
 * the owner confirms — but the owner's only offered action was to confirm that
 * egress. This asserts the second button: "Run locally instead", which runs the
 * same task on this machine, agentId=local, nothing leaving.
 */

export const id = 'run-locally-instead';
export const title = 'A hosted-escalated task can be redirected to a local run in one click';
export const criteria = ['owner: local-first, no surprise egress'];

export async function run({ daemon, page, ok, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const locals = agents.body?.localModels || [];
  if (!locals.length) throw new Blocked('an installed Ollama model, so there is a local option to fall back to');

  // The router must actually escalate a generic task to hosted for this to mean
  // anything. If this machine has no hosted CLI, there is nothing to escalate to.
  const route = await daemon.api('/forge/route', { method: 'POST', body: JSON.stringify({ task: 'Create utils.js exporting double(n)=n*2' }) });
  const escalates = route.body?.route && route.body.route.agentId !== 'local';
  if (!escalates) throw new Blocked('a hosted agent CLI (claude or codex) installed, so a generic task escalates and there is a hosted confirmation to redirect');

  await page.click('[data-product="forge"]');
  await page.waitForTimeout(800);

  // "Plan first" is on by default and would stop this Send at a plan card
  // (24-plan-first.mjs covers that path). This flow is about the hosted→local
  // redirect, so turn it off through the real first-run toggle, as an owner who
  // wants a straight run would.
  await page.evaluate(() => { const t = document.querySelector('#ag-planfirst'); if (t && t.getAttribute('aria-pressed') === 'true') t.click(); });
  ok('plan-first is off for this flow', await page.evaluate(() => document.querySelector('#ag-planfirst')?.getAttribute('aria-pressed') === 'false'));

  await page.evaluate(() => {
    const ta = document.querySelector('#ag-ta');
    ta.value = 'Create utils.js at the repo root exporting a function double(n) that returns n*2. Plain JavaScript.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#ag-send').click();
  });

  // The confirmation turn must offer BOTH actions.
  await page.waitForFunction(
    () => [...document.querySelectorAll('#s-turns .turn.z button')].some((b) => /run locally/i.test(b.textContent)),
    { timeout: 15_000 },
  ).catch(() => {});
  const buttons = await page.$$eval('#s-turns .turn.z button', (els) => els.map((b) => b.textContent.trim()));
  ok('the hosted confirmation is shown', buttons.some((b) => /confirm/i.test(b)), buttons.join(' | '));
  ok('a local alternative is offered next to it', buttons.some((b) => /run locally/i.test(b)), buttons.join(' | '));

  // Click it, and prove the run that starts is LOCAL.
  const localRun = await page.evaluate(() => {
    window.__ranLocal = null;
    const of = window.fetch;
    window.fetch = function patched(...a) {
      const u = String(a[0]);
      if (/\/forge\/run\b/.test(u) && a[1] && a[1].body) {
        try { const b = JSON.parse(a[1].body); window.__ranLocal = b.agentId; } catch { /* ignore */ }
      }
      return of.apply(this, a);
    };
    const b = [...document.querySelectorAll('#s-turns .turn.z button')].find((x) => /run locally/i.test(x.textContent));
    if (b) b.click();
    return !!b;
  });
  ok('the local button is clickable', localRun);

  await page.waitForFunction(() => window.__ranLocal !== null, { timeout: 10_000 }).catch(() => {});
  const agentId = await page.evaluate(() => window.__ranLocal);
  ok.eq('the redirected run targets a LOCAL agent, not a hosted one', agentId, 'local');

  // No hosted run may have been dispatched.
  const st = await daemon.api('/state');
  // Let the local run land a proposal (or at least not leave via a hosted receipt).
  await page.waitForFunction(async () => true, { timeout: 1000 }).catch(() => {});
  ok('nothing was sealed as an egress effect', (st.body.receipts || []).every((r) => !['T2', 'T3', 'T4'].includes(r.tier)),
    JSON.stringify((st.body.receipts || []).map((r) => r.tier)));
}
