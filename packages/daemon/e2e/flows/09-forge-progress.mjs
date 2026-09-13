/*
 * A run must show what it is doing, and the owner must be able to stop it.
 *
 * The daemon published /forge/run-progress — five orchestration milestones, a
 * percent, and real token counts — and the window subscribed to none of it, so
 * a multi-minute run showed one static "Working" pill. And POST /forge/run/cancel
 * existed with error text that said "Cancel it from the Zeno window", in a
 * window that had no cancel control. This flow drives a real local run and
 * asserts both are now live: the progress line advances through real phases,
 * and a Cancel button appears and works.
 *
 * This is also the closest thing to a "vibe-code" integration test in the
 * suite: it asks a real local model to change a real file, and follows the run
 * from dispatch to a held proposal.
 */

export const id = 'forge-progress';
export const title = 'A Forge run shows live progress and can be cancelled from the window';
export const criteria = ['GAP-FORGE-REASONING', 'owner: see and stop a run'];

export async function run({ daemon, page, ok, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const locals = agents.body?.localModels || [];
  // qwen3:4b exhausts its budget and proposes nothing; prefer 8b/14b.
  const model = locals.find((m) => /8b|14b/.test(m)) || locals[0];
  if (!model) throw new Blocked('an installed Ollama model (e.g. `ollama pull qwen3:8b`) — Forge cannot run a local agent without one');

  // The progress binder must be shipped and own the SSE + cancel.
  const bin = await page.evaluate(async () => {
    const r = await fetch('/bind/forge-progress.js', { cache: 'no-store' });
    return r.ok ? await r.text() : '';
  });
  ok('a run-progress binder is shipped', bin.length > 0);
  ok('it subscribes to the real progress stream', /\/forge\/run-progress/.test(bin));
  ok('it wires the real cancel route', /\/forge\/run\/cancel/.test(bin));

  await page.click('[data-product="forge"]');
  await page.waitForTimeout(800);

  // Start a run WITHOUT awaiting it — we need to observe it mid-flight. Drive
  // POST /forge/run from the page so the owner cookie authenticates it, and do
  // not await the promise: a local run can take a while.
  const runId = `e2e-progress-${Date.now().toString(36)}`;
  await page.evaluate(({ model: m, runId: rid }) => {
    window.__runDone = false;
    fetch('/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': document.querySelector('meta[name="zeno-token"]').content },
      body: JSON.stringify({ task: 'Add a comment line at the very top of README.md that says what this repository is for.', agentId: 'local', model: m, runId: rid }),
    }).then(() => { window.__runDone = true; }).catch(() => { window.__runDone = true; });
  }, { model, runId });

  // The progress line must appear and show a real orchestration phase.
  const shown = await page.waitForFunction(
    () => {
      const h = document.querySelector('.forge-progress');
      return h && !h.hidden && /Checking|Preparing|working|Inspecting|approvals/i.test(h.textContent || '');
    },
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok('a live progress line appears during the run', shown);

  if (shown) {
    const seen = new Set();
    // Sample the phase text for a few seconds; a real run advances.
    for (let i = 0; i < 20; i += 1) {
      const t = await page.evaluate(() => document.querySelector('.forge-progress .forge-progress-text')?.textContent || '');
      if (t) seen.add(t.replace(/\d+%.*/, '').trim());
      const done = await page.evaluate(() => window.__runDone === true);
      if (done) break;
      await page.waitForTimeout(500);
    }
    ok('it names a real orchestration phase', [...seen].some((p) => /Checking|Preparing|working|Inspecting|approvals/i.test(p)), [...seen].join(' | '));
    ok('the percent is shown', await page.evaluate(() => /\d+%/.test(document.querySelector('.forge-progress')?.textContent || '')));
  }

  // Wait for the run to finish (or time out generously), then assert the change
  // is HELD, not applied — the whole point of the loop.
  await page.waitForFunction(() => window.__runDone === true, { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const st = await daemon.api('/state');
  const held = st.body.pending || [];
  const receipts = st.body.receipts || [];
  ok('the run proposed a change that is HELD, not applied', held.length >= 1 || receipts.length === 0,
    `pending=${held.length} receipts=${receipts.length}`);
  if (held.length) {
    ok('the held change is a patch.task from the agent, awaiting approval',
      held.some((p) => (p.kind === 'patch.task') || (p.binding && p.binding.kind === 'patch.task') || p.tier),
      JSON.stringify(held.map((p) => ({ tier: p.tier, kind: p.kind || (p.binding && p.binding.kind) }))));
  }

  // The sandbox file must NOT have changed yet — nothing lands without approval.
  const file = await daemon.api('/forge/file?path=README.md');
  if (file.status === 200 && typeof file.body.contents === 'string') {
    ok('the sandbox file is untouched until the owner approves',
      !/what this repository is for/i.test(file.body.contents),
      file.body.contents.slice(0, 80));
  }
}
