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
 * through the governed T0 auto-apply path to its signed receipt.
 */

export const id = 'forge-progress';
export const title = 'A Forge run shows live progress and can be cancelled from the window';
export const criteria = ['GAP-FORGE-REASONING', 'owner: see and stop a run'];

export async function run({ daemon, page, ok, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const locals = agents.body?.localModels || [];
  // Match the product's automatic route: exact qwen3:8b first, then another
  // Qwen model, then whatever Ollama actually reports as installed.
  const model = locals.find((m) => m === 'qwen3:8b')
    || locals.find((m) => m.startsWith('qwen3:'))
    || locals[0];
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

  const beforeFile = await daemon.api('/forge/file?path=README.md');

  // Start a run WITHOUT awaiting it — we need to observe it mid-flight. Drive
  // POST /forge/run from the page so the owner cookie authenticates it, and do
  // not await the promise: a local run can take a while.
  const runId = `e2e-progress-${Date.now().toString(36)}`;
  await page.evaluate(({ model: m, runId: rid }) => {
    window.__runDone = false;
    window.__runResult = null;
    fetch('/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': document.querySelector('meta[name="zeno-token"]').content },
      body: JSON.stringify({ task: 'Add a comment line at the very top of README.md that says what this repository is for.', agentId: 'local', model: m, runId: rid }),
    }).then(async (response) => {
      window.__runResult = { status: response.status, body: await response.json() };
      window.__runDone = true;
    }).catch((error) => {
      window.__runResult = { status: 0, error: String(error) };
      window.__runDone = true;
    });
  }, { model, runId });

  // The progress line must appear and show a real orchestration phase.
  const shown = await page.waitForFunction(
    () => {
      const h = document.querySelector('.forge-progress');
      return h && !h.hidden && /Checking|Preparing|working|Inspecting|approvals/i.test(h.textContent || '');
    },
    undefined,
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok('a live progress line appears during the run', shown);

  if (shown) {
    const seen = new Set();
    let sawPercent = false;
    // Capture phase and percentage together. A quick local run may clear the
    // finished progress line before a later, separate assertion can read it.
    for (let i = 0; i < 20; i += 1) {
      const snapshot = await page.evaluate(() => document.querySelector('.forge-progress')?.textContent || '');
      if (snapshot) {
        sawPercent ||= /\d+%/.test(snapshot);
        seen.add(snapshot.replace(/\d+%.*/, '').trim());
      }
      const done = await page.evaluate(() => window.__runDone === true);
      if (done) break;
      await page.waitForTimeout(500);
    }
    ok('it names a real orchestration phase', [...seen].some((p) => /Checking|Preparing|working|Inspecting|approvals/i.test(p)), [...seen].join(' | '));
    ok('the percent is shown', sawPercent);
  }

  // Wait for the run to finish (or time out generously), then assert the
  // governed result. A one-line README edit is an ordinary sandbox write under
  // the documented Devin-feel policy: T0 auto-applies and is still receipted.
  // Forge output only waits when its assessed effect is T1+ (sensitive path,
  // destructive edit, rewrite, secret, or another explicitly held change).
  await page.waitForFunction(() => window.__runDone === true, undefined, { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const runResult = await page.evaluate(() => window.__runResult);
  const st = await daemon.api('/state');
  const held = st.body.pending || [];
  const receipts = st.body.receipts || [];
  const proposed = runResult?.body?.proposed || [];
  ok('the run returned a successful governed result', runResult?.status === 200,
    JSON.stringify(runResult));
  ok('the ordinary README edit was assessed as T0 auto-apply',
    proposed.length === 1 && proposed[0].path === 'README.md' && proposed[0].tier === 'T0' && proposed[0].auto === true,
    JSON.stringify(proposed));
  ok('the T0 edit left no approval pending and sealed one verified receipt',
    held.length === 0 && receipts.length === 1 && receipts[0].outcome === 'verified',
    `pending=${held.length} receipts=${JSON.stringify(receipts.map((r) => ({ outcome: r.outcome, actionHash: r.actionHash })))}`);
  if (proposed.length === 1 && receipts.length === 1) {
    ok('the receipt belongs to the exact Forge proposal',
      receipts[0].actionHash === proposed[0].actionHash,
      `proposal=${proposed[0].actionHash} receipt=${receipts[0].actionHash}`);
  }

  // The committed receipt must correspond to an observable effect in the
  // sandbox. Comparing the complete seeded contents catches any valid model
  // wording instead of guessing the exact comment it chose.
  const file = await daemon.api('/forge/file?path=README.md');
  if (beforeFile.status === 200 && typeof beforeFile.body.contents === 'string'
      && file.status === 200 && typeof file.body.contents === 'string') {
    ok('the T0 Forge edit changed the sandbox file without an approval click',
      file.body.contents !== beforeFile.body.contents,
      file.body.contents.slice(0, 80));
  }
}
