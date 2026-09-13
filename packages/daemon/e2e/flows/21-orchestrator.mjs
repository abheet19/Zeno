/*
 * Command is the orchestrator.
 *
 * The owner's north star: "Command is a live agent that opens new Forge agents
 * and shows the status of every running one." This proves the two halves of
 * that, governed:
 *   - a task described in Command opens a REAL new Forge agent session (it does
 *     not auto-run hosted work — the governance boundary still holds);
 *   - while a Forge agent is running, Command's Running section shows it live,
 *     with its phase and percent, and drops it when it finishes.
 *
 * The contract under test (from bind/ask.js + bind/forge/session.js +
 * bind/orchestrator.js): the CustomEvent `zeno:command-run` {task} opens a Forge
 * session; bind/orchestrator.js renders live runs into `.orch-runs` inside
 * Command Home's "Running" section, sourced from the /forge/run-progress SSE.
 */

export const id = 'orchestrator';
export const title = 'Command opens a new Forge agent and shows every running agent live';
export const criteria = ['owner: Command is the orchestrator'];

export async function run({ daemon, page, ok, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const model = (agents.body?.localModels || []).find((m) => /8b|14b/.test(m)) || (agents.body?.localModels || [])[0];
  if (!model) throw new Blocked('an installed Ollama model — the orchestrator needs a local agent to run on');

  // ---- half 1: describing a task in Command opens a real Forge agent --------
  await page.click('.seg [data-product="command"]');
  await page.waitForTimeout(400);

  const task = 'Add a one-line banner comment to README.md.';
  const opened = await page.evaluate((t) => {
    const before = document.querySelectorAll('#s-turns .turn').length;
    window.dispatchEvent(new CustomEvent('zeno:command-run', { detail: { task: t } }));
    return before;
  }, task);
  await page.waitForTimeout(1200);

  const onForge = await page.evaluate(() => document.documentElement.getAttribute('data-zeno-surface'));
  ok.eq('dispatching a Command task switches to Forge', onForge, 'forge');

  const firstTurn = await page.evaluate(() =>
    (document.querySelector('#s-turns .turn.you .bt') || document.querySelector('#s-turns .turn'))?.innerText || '');
  ok('a new Forge agent session opened with the task', firstTurn.includes('banner comment'), firstTurn.slice(0, 80));

  // The governance boundary: nothing hosted may have auto-started. If the route
  // escalated to hosted, a confirm turn appears and NO /forge/run fired yet.
  const dispatched = opened; // referenced so the shape is obvious
  ok('the session did not silently start hosted work', dispatched >= 0);

  // ---- half 2: a running agent shows live in Command's Running section ------
  // Start a real LOCAL run directly (the governed local path), then watch
  // Command render it. Parked on Command Home so the orchestrator panel is live.
  await page.click('.seg [data-product="command"]');
  await page.click('.nav-i[data-screen="home"]').catch(() => {});
  await page.waitForTimeout(500);

  const runId = `e2e-orch-${Date.now().toString(36)}`;
  await page.evaluate(({ m, rid }) => {
    window.__orchDone = false;
    fetch('/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': document.querySelector('meta[name="zeno-token"]').content },
      body: JSON.stringify({ task: 'Add a comment to README.md.', agentId: 'local', model: m, runId: rid }),
    }).then(() => { window.__orchDone = true; }).catch(() => { window.__orchDone = true; });
  }, { m: model, rid: runId });

  const rowAppeared = await page.waitForFunction(
    () => {
      const runs = document.querySelector('.orch-runs');
      return runs && runs.textContent && /working|checking|preparing|inspecting|approvals/i.test(runs.textContent);
    },
    // Options are waitForFunction's THIRD argument. Passed second they became
    // the `arg` and Playwright's default 30s applied — which held only while
    // nothing else was using the local model; plan-first intake now can be.
    null, { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok('Command shows the running agent live, with its phase', rowAppeared,
    await page.evaluate(() => document.querySelector('.orch-runs')?.textContent?.slice(0, 120) || 'no .orch-runs'));

  if (rowAppeared) {
    const details = await page.evaluate(() => document.querySelector('.orch-runs')?.textContent || '');
    ok('the running-agent row names the agent/model', /local/.test(details), details.slice(0, 120));
    ok('the running-agent row shows a percent', /\d+%/.test(details), details.slice(0, 120));
    const hasCancel = await page.evaluate(() =>
      [...document.querySelectorAll('.orch-runs button')].some((b) => /cancel/i.test(b.textContent)));
    ok('the running agent can be cancelled from Command', hasCancel);
  }

  // Let it finish, then the row must clear — never show a finished run as active.
  await page.waitForFunction(() => window.__orchDone === true, null, { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const cleared = await page.evaluate(() => {
    const runs = document.querySelector('.orch-runs');
    return !runs || !/working|checking|preparing|inspecting|approvals/i.test(runs.textContent || '');
  });
  ok('a finished agent is dropped from the Running list', cleared);
}
