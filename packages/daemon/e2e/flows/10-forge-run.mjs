/*
 * FORGE, end to end: the owner describes a task in Forge's composer, a REAL
 * local model runs it in an isolated throwaway worktree, and every file it
 * touched comes back as a HELD proposal — never a write.
 *
 * The line this flow exists to hold is the one Forge's whole design rests on:
 * an agent that edits files does not get to apply them. So every assertion
 * below is about a real EFFECT, not about the screen:
 *
 *   - the run started        -> POST /forge/run actually left the window, and
 *                               the daemon's own /forge/run-progress stream
 *                               reported the five orchestration milestones in
 *                               order for THAT run id
 *   - the changes are held   -> /state.pending carries them, every one of them
 *                               auto:false, and GET /forge/file still 404s
 *                               because nothing reached the sandbox
 *   - the owner sees a diff  -> the capsule on Approvals renders the daemon's
 *                               own review.diff, not a mock
 *   - approval is the effect -> one click, one receipt, a verified chain, and
 *                               the file now exists in the sandbox with the
 *                               model's exact bytes
 *   - cancel loses nothing   -> a cancelled run still hands its changeset to
 *                               the gate. `performRun` is documented as having
 *                               once done `result.ok ? changed : []`, which
 *                               deleted real work and then reported that
 *                               nothing had happened. That regression is what
 *                               the last section pins down.
 *
 * WHY THE CANCEL SECTION SEEDS THE WORKTREE. A local model writes its files in
 * one burst after inference returns, so a cancel that lands during inference
 * can only ever find an empty worktree — asserting "0 files kept out of 0
 * written" would be asserting nothing. To make the claim real, the flow waits
 * until the run is genuinely in its provider phase, writes one file into that
 * run's own isolated worktree (exactly where, and exactly how, the agent
 * writes its own output), and only then cancels. The file is a stand-in for
 * agent output; everything asserted about it afterwards is the product's real
 * behaviour.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const id = 'forge-run';
export const title = 'Forge runs a real local model, holds every change, and loses nothing on cancel';
export const criteria = ['SUITE-AC-02', 'forge: proposals never self-apply', 'forge: a cancelled run keeps its changeset'];

/** Where `packages/forge/src/worktree.ts` puts a run's isolated checkout. */
const WORKTREE_NAMESPACE = 'zeno-forge-worktrees';

/** Models that reliably honour Forge's ===FILE:=== envelope, best first. */
const PREFERRED_LOCAL = ['qwen3:8b', 'qwen3:14b'];

const TASK = 'Create a file named notes.txt whose entire contents are the single line: zeno forge e2e';

/**
 * Read the daemon's owner-only Forge progress stream from the test process, so
 * the flow can say what the daemon REPORTED rather than what a screen drew.
 */
async function subscribeRunProgress(daemon) {
  const events = [];
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${daemon.port}/forge/run-progress`, {
    headers: { 'x-zeno-token': daemon.token, accept: 'text/event-stream' },
    signal: ac.signal,
  });
  const sub = { events, status: res.status, stop: () => ac.abort() };
  if (!res.ok || !res.body) return sub;
  void (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let name = null;
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (name === 'run-progress' && data) {
            try { events.push(JSON.parse(data)); } catch { /* a frame we cannot read is not an event */ }
          }
        }
      }
    } catch { /* the abort on teardown lands here */ }
  })();
  return sub;
}

async function waitFor(predicate, timeoutMs, stepMs = 120) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = await predicate();
    if (hit) return hit;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export async function run({ daemon, page, ok, network, Blocked }) {
  /* ---------------------------------------------------------------- *
   * 0 · prerequisites. A governed coding agent with no model to run   *
   *     is not a failing product, it is a missing one.                *
   * ---------------------------------------------------------------- */
  const agents = await daemon.api('/forge/agents');
  if (agents.status !== 200) {
    throw new Blocked(`GET /forge/agents answered ${agents.status} — the agent inventory could not be read`);
  }
  const localModels = Array.isArray(agents.body.localModels) ? agents.body.localModels : [];
  if (localModels.length === 0) {
    throw new Blocked('an Ollama model installed on this machine (e.g. `ollama pull qwen3:8b`) — Forge cannot run a local agent without one');
  }
  const model = PREFERRED_LOCAL.find((m) => localModels.includes(m)) ?? localModels[0];

  const progress = await subscribeRunProgress(daemon);
  ok.eq('the owner may subscribe to Forge run progress', progress.status, 200);

  const before = await daemon.api('/state');
  ok.eq('the ledger starts empty', before.body.receipts.length, 0);
  ok.eq('nothing is held before the run', before.body.pending.length, 0);

  /* ---------------------------------------------------------------- *
   * 1 · the composer: a real session, a real model, a real send       *
   * ---------------------------------------------------------------- */
  await page.click('[data-product="forge"]');
  await page.waitForTimeout(600);
  await page.click('#s-new');
  await page.waitForTimeout(300);

  // The artifact ships `Actions 1` hardcoded in the session tab strip. A fresh
  // session has proposed nothing, so any count here is fabricated state.
  const freshBadge = await page.evaluate(() => {
    const b = document.querySelector('#s-tabs button[data-stab="actions"]');
    return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  ok('a brand-new session claims no proposed actions',
    freshBadge !== null && !/\d/.test(freshBadge), `the Actions tab reads "${freshBadge}" before anything ran`);

  // Choose the local model through the real picker, so the run is the owner's
  // explicit choice and never an egress to a hosted provider.
  await page.click('#s-model');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const single = [...document.querySelectorAll('.mp .mp-mode button')].find((b) => b.textContent.trim() === 'Single');
    if (single) single.click();
  });
  await page.waitForTimeout(300);

  const offered = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mp .mp-row')];
    const groups = [...document.querySelectorAll('.mp .mp-g')].map((g) => g.textContent.trim());
    const local = [];
    let inLocal = false;
    for (const node of document.querySelectorAll('.mp .mp-g, .mp .mp-row')) {
      if (node.classList.contains('mp-g')) { inLocal = node.textContent.trim() === 'On this machine'; continue; }
      if (inLocal) local.push(node.querySelector('.mn')?.firstChild?.textContent?.trim() ?? '');
    }
    return { count: rows.length, groups, local };
  });
  ok('the picker lists exactly the models Ollama reports',
    JSON.stringify(offered.local) === JSON.stringify(localModels),
    `picker showed ${JSON.stringify(offered.local)}, the daemon reports ${JSON.stringify(localModels)}`);

  const picked = await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll('.mp .mp-row')]
      .find((b) => (b.querySelector('.mn')?.firstChild?.textContent?.trim() ?? '') === wanted);
    if (!row) return false;
    row.click();
    return true;
  }, model);
  ok(`the picker offers ${model}`, picked);
  await page.waitForTimeout(300);

  const pill = await page.evaluate(() => document.querySelector('#s-model')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
  ok('the composer pill names the model the run will use', pill.includes(model) && pill.includes('local'), pill);

  // "Plan first" is on by default and would stop this Send at a plan card
  // (24-plan-first.mjs covers that path). This flow is about the RUN, so turn
  // it off through the real toggle, as an owner who wants a straight run would.
  await page.evaluate(() => { const t = document.querySelector('#s-planfirst'); if (t && t.getAttribute('aria-pressed') === 'true') t.click(); });
  ok('plan-first is off for this flow', await page.evaluate(() => document.querySelector('#s-planfirst')?.getAttribute('aria-pressed') === 'false'));

  await page.fill('#s-ta', TASK);
  await page.click('#s-send');

  const status = await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Working'),
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('the window says the session is working while the agent runs', status);

  /* ---------------------------------------------------------------- *
   * 2 · the run really started, and the daemon reported its progress  *
   * ---------------------------------------------------------------- */
  const finished = await waitFor(
    () => progress.events.some((e) => e.terminal === true),
    150_000,
    200,
  );
  ok('the run reached a terminal state within 150s', !!finished,
    `progress so far: ${JSON.stringify(progress.events.map((e) => e.phase))}`);

  ok('the window called the real run route', network.includes('POST /forge/run'),
    JSON.stringify(network.filter((n) => n.startsWith('POST'))));

  const settled = await page.waitForFunction(
    () => !(document.querySelector('#s-status')?.textContent || '').includes('Working'),
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  ok('the window stops reporting work once the run ends', settled);

  const runId = progress.events[0]?.runId ?? null;
  const mine = progress.events.filter((e) => e.runId === runId);
  const phases = mine.map((e) => e.phase);
  ok('progress is reported for one run id', runId !== null && mine.length === progress.events.length,
    `${progress.events.length} events across ${new Set(progress.events.map((e) => e.runId)).size} run ids`);
  ok('the run id is the one the window minted', typeof runId === 'string' && runId.startsWith('ui-'), String(runId));
  ok('progress walks the five orchestration milestones in order',
    JSON.stringify(phases) === JSON.stringify([
      'checking-provider', 'preparing-worktree', 'running-provider', 'inspecting-changes', 'proposing-changes', 'complete',
    ]),
    JSON.stringify(phases));
  ok('progress never goes backwards',
    mine.every((e, i) => i === 0 || e.completed >= mine[i - 1].completed),
    JSON.stringify(mine.map((e) => e.completed)));
  const terminal = mine.find((e) => e.terminal);
  ok.eq('the terminal event reports the outcome', terminal?.outcome, 'completed');
  ok.eq('progress is Zeno orchestration, out of five', terminal?.total, 5);
  ok('the local run reports measured token usage',
    terminal?.tokenUsage?.status === 'measured' && terminal.tokenUsage.input > 0 && terminal.tokenUsage.output > 0,
    JSON.stringify(terminal?.tokenUsage));

  /* ---------------------------------------------------------------- *
   * 3 · the changes came back HELD, and nothing touched the sandbox   *
   * ---------------------------------------------------------------- */
  const afterRun = await daemon.api('/state');
  const held = afterRun.body.pending;
  if (held.length === 0) {
    // The product worked; this machine's model did not produce a governed edit.
    // Say which model and what it said rather than passing an empty run.
    const chat = await page.evaluate(() => document.querySelector('.sessview[data-stab="chat"]')?.innerText.replace(/\s+/g, ' ').slice(0, 300) ?? '');
    throw new Blocked(`a local Ollama model that can follow Forge's ===FILE:=== envelope — ${model} proposed no file change for a one-line task ("${chat}")`);
  }
  ok('the work the agent did arrives as held proposals', held.length >= 1, `${held.length} held`);
  ok('no proposal from an agent may auto-apply', held.every((h) => h.auto === false),
    JSON.stringify(held.map((h) => ({ kind: h.binding?.kind, tier: h.tier, auto: h.auto }))));
  ok('an agent file write is rated as an agent patch, never a routine write',
    held.every((h) => h.binding?.kind === 'patch.task'),
    JSON.stringify(held.map((h) => h.binding?.kind)));
  ok('the proposal is attributed to the Forge run, not to the owner',
    held.every((h) => typeof h.summary === 'string' && h.summary.startsWith('Forge (local):')),
    JSON.stringify(held.map((h) => h.summary)));
  ok.eq('holding a proposal seals no receipt', afterRun.body.receipts.length, 0);

  const relPath = held[0].payload.relPath;
  const contents = held[0].payload.contents;

  const sandboxBefore = await daemon.api(`/forge/file?path=${encodeURIComponent(relPath)}`);
  ok.eq(`the agent did not write ${relPath} into the sandbox`, sandboxBefore.status, 404);
  const statusBefore = await daemon.api('/forge/status');
  ok.eq('the sandbox working tree is untouched', statusBefore.body.changed.length, 0);

  // …and Forge's own Actions tab must count what is actually waiting. The
  // artifact hardcodes "1" there; the real count arrives over /stream, so this
  // waits for the live value rather than for a reload.
  const badgeLive = await page.waitForFunction(
    (n) => (document.querySelector('#s-tabs button[data-stab="actions"] .fct')?.textContent.trim() ?? '') === String(n),
    held.length,
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('the Actions badge counts what is waiting, without a reload', badgeLive,
    await page.evaluate(() => `the badge reads "${document.querySelector('#s-tabs button[data-stab="actions"] .fct')?.textContent.trim()}"`));

  const actionsTab = await page.evaluate(() => {
    const btn = document.querySelector('#s-tabs button[data-stab="actions"]');
    if (btn) btn.click();
    const view = document.querySelector('.sessview[data-stab="actions"]');
    return {
      cards: view ? [...view.querySelectorAll('.fact-c b')].map((b) => b.textContent.trim()) : [],
      waiting: view ? [...view.querySelectorAll('.fact-c .frm')].map((b) => b.textContent.trim()) : [],
    };
  });
  ok('the Actions tab lists the real proposed paths',
    JSON.stringify(actionsTab.cards) === JSON.stringify(held.map((h) => h.payload.relPath)),
    `${JSON.stringify(actionsTab.cards)} vs ${JSON.stringify(held.map((h) => h.payload.relPath))}`);
  ok('and says every one of them is still waiting on the owner',
    actionsTab.waiting.length === held.length && actionsTab.waiting.every((t) => /waiting for your approval/.test(t)),
    JSON.stringify(actionsTab.waiting));

  // The Runs tab's own verdict on the run. Forge cannot apply anything — the
  // kernel applies, after the owner clicks — so "applied" is the one word this
  // card must never carry while the change is still in the queue.
  const runsTab = await page.evaluate(() => {
    const btn = document.querySelector('#s-tabs button[data-stab="runs"]');
    if (btn) btn.click();
    const view = document.querySelector('.sessview[data-stab="runs"]');
    return view ? [...view.querySelectorAll('.frun')].map((c) => ({
      pill: c.querySelector('.frh .pill')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      detail: c.querySelector('.frm')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
    })) : null;
  });
  ok('the Runs tab shows this run and nothing invented', runsTab !== null && runsTab.length === 1,
    JSON.stringify(runsTab));
  ok('a run whose changes are still held is not reported as applied',
    !/applied/i.test(runsTab?.[0]?.pill ?? ''), JSON.stringify(runsTab?.[0]));
  ok('the run card names the outcome that actually happened — a wait for the owner',
    /waiting/i.test(runsTab?.[0]?.pill ?? ''), JSON.stringify(runsTab?.[0]));

  /* ---------------------------------------------------------------- *
   * 4 · the owner can see the diff before deciding                    *
   * ---------------------------------------------------------------- */
  ok.eq('the daemon built a real before/after review', held[0].review?.state, 'ready');

  await page.click('[data-product="command"]');
  await page.waitForTimeout(400);
  await page.click('.nav-i[data-screen="approvals"]');
  await page.waitForTimeout(1500);

  const capsule = await page.evaluate((rel) => {
    const card = [...document.querySelectorAll('.screen[data-screen="approvals"] .caps')]
      .find((c) => c.textContent.includes(rel));
    if (!card) return null;
    const diff = card.querySelector('pre.diff');
    return {
      text: card.textContent.replace(/\s+/g, ' ').slice(0, 120),
      hasDiff: !!diff,
      added: diff ? [...diff.querySelectorAll('.add')].map((l) => l.textContent) : [],
      removed: diff ? [...diff.querySelectorAll('.del')].map((l) => l.textContent) : [],
      buttons: [...card.querySelectorAll('.caps-acts button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
    };
  }, relPath);
  ok(`the held change is on the owner's Approvals screen`, capsule !== null, `no capsule mentioned ${relPath}`);
  ok('the capsule shows the real diff', capsule?.hasDiff === true, JSON.stringify(capsule));
  ok('the diff shows the bytes the model actually proposed',
    (capsule?.added ?? []).join('\n').includes(contents.split(/\r?\n/)[0]),
    JSON.stringify(capsule?.added));
  ok('the owner is offered a live decision',
    (capsule?.buttons ?? []).length >= 2 && capsule.buttons.every((b) => !b.disabled),
    JSON.stringify(capsule?.buttons));

  /* ---------------------------------------------------------------- *
   * 5 · approving is the only thing that changes a file              *
   * ---------------------------------------------------------------- */
  await page.evaluate((rel) => {
    const card = [...document.querySelectorAll('.screen[data-screen="approvals"] .caps')]
      .find((c) => c.textContent.includes(rel));
    card.querySelector('.caps-acts button.p').click();
  }, relPath);
  await page.waitForTimeout(2500);

  const afterApproval = await daemon.api('/state');
  ok.eq('one approval seals exactly one receipt', afterApproval.body.receipts.length, 1);
  ok('the receipt chain verifies', afterApproval.body.chain.ok === true, JSON.stringify(afterApproval.body.chain));
  ok.eq('the approved change leaves the queue', afterApproval.body.pending.length, held.length - 1);

  const sandboxAfter = await daemon.api(`/forge/file?path=${encodeURIComponent(relPath)}`);
  ok.eq(`${relPath} now exists in the sandbox`, sandboxAfter.status, 200);
  ok('the sandbox holds exactly the bytes the owner approved',
    sandboxAfter.body.contents === contents,
    `${JSON.stringify(sandboxAfter.body.contents)} vs ${JSON.stringify(contents)}`);

  /* ---------------------------------------------------------------- *
   * 6 · cancelling loses no work                                      *
   * ---------------------------------------------------------------- */
  const cancelRunId = 'e2e-cancel-forge';
  const receiptsBeforeCancel = afterApproval.body.receipts.length;
  const pendingBeforeCancel = afterApproval.body.pending.length;

  const cancelled = daemon.api('/forge/run', {
    method: 'POST',
    body: JSON.stringify({
      task: 'Create a file named big.txt containing three hundred numbered lines of placeholder text.',
      agentId: 'local',
      model,
      effort: 'high',
      runId: cancelRunId,
      memoryEnabled: false,
      skillIds: [],
    }),
  });

  const running = await waitFor(
    () => progress.events.some((e) => e.runId === cancelRunId && e.phase === 'running-provider'),
    30_000,
    100,
  );
  ok('the second run reaches its provider phase', !!running,
    JSON.stringify(progress.events.filter((e) => e.runId === cancelRunId).map((e) => e.phase)));

  // The run's own isolated worktree — the only place an agent's output lives
  // before the gate sees it. Stand in for a file the agent had already written
  // when the owner pressed Cancel.
  const worktree = join(tmpdir(), WORKTREE_NAMESPACE, cancelRunId);
  const appeared = await waitFor(() => existsSync(worktree), 20_000, 100);
  ok('the run is isolated in its own throwaway worktree', !!appeared, worktree);
  if (appeared) {
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'rescued.txt'), 'written before the owner cancelled\n', 'utf8');
  }

  const cancelReply = await daemon.api('/forge/run/cancel', {
    method: 'POST',
    body: JSON.stringify({ runId: cancelRunId }),
  });
  ok.eq('the owner can cancel a live run', cancelReply.status, 200);
  ok('cancel reaches the run that is actually active', cancelReply.body.cancelled === true,
    JSON.stringify(cancelReply.body));

  const cancelledRun = await cancelled;
  ok.eq('a cancelled run still answers', cancelledRun.status, 200);
  ok('the run reports that it was cancelled', cancelledRun.body.run.cancelled === true,
    JSON.stringify(cancelledRun.body.run));
  ok('a cancelled run does not claim success', cancelledRun.body.run.ok === false);

  ok('a cancelled run still asks git what it left behind',
    cancelledRun.body.changed.includes('rescued.txt'), JSON.stringify(cancelledRun.body.changed));
  ok('every file a cancelled run wrote is handed to the gate',
    cancelledRun.body.proposed.some((p) => p.path === 'rescued.txt'),
    JSON.stringify({ proposed: cancelledRun.body.proposed, skipped: cancelledRun.body.skipped }));
  ok('nothing a cancelled run wrote may auto-apply',
    cancelledRun.body.proposed.every((p) => p.auto === false),
    JSON.stringify(cancelledRun.body.proposed));

  const afterCancel = await daemon.api('/state');
  ok.eq('the rescued change is waiting for review', afterCancel.body.pending.length, pendingBeforeCancel + cancelledRun.body.proposed.length);
  ok('the rescued change is in the queue by name',
    afterCancel.body.pending.some((p) => p.payload?.relPath === 'rescued.txt'),
    JSON.stringify(afterCancel.body.pending.map((p) => p.payload?.relPath)));
  ok.eq('cancelling seals no receipt', afterCancel.body.receipts.length, receiptsBeforeCancel);
  const rescuedInSandbox = await daemon.api('/forge/file?path=rescued.txt');
  ok.eq('and it is still nowhere near the sandbox', rescuedInSandbox.status, 404);

  // Settling it must be the owner's call too — declining removes it and writes nothing.
  const rescued = afterCancel.body.pending.find((p) => p.payload?.relPath === 'rescued.txt');
  const declined = await daemon.api('/approvals/decline', {
    method: 'POST',
    body: JSON.stringify({ actionHash: rescued.actionHash }),
  });
  ok.eq('the owner can decline what a cancelled run left', declined.status, 200);
  const afterDecline = await daemon.api('/forge/file?path=rescued.txt');
  ok.eq('a decline writes nothing', afterDecline.status, 404);

  /* ---------------------------------------------------------------- *
   * 7 · why any of that was held at all: the proposer, not the bytes  *
   * ---------------------------------------------------------------- *
   * The owner's own hand-written change to an identical routine file is T0 and
   * applies with no decision owed. Forge's was T1 and waited. Nothing about the
   * content differs — `proposeFileWrite` escalates because the proposer is an
   * agent ("a model may propose a harmless-looking file, but it cannot
   * auto-land its own output merely because the path happened to score T0").
   * Run last, because it seals a receipt of its own. */
  const byHand = await daemon.api('/previews', {
    method: 'POST',
    body: JSON.stringify({ relPath: 'owner-note.txt', contents, summary: 'the owner writes a routine file by hand' }),
  });
  ok.eq('the owner may write a routine file with no decision owed', byHand.body.preview.auto, true);
  ok.eq('and it is rated an ordinary local write', byHand.body.preview.binding.kind, 'local.write');
  ok('the same bytes proposed by an agent were rated higher and held instead',
    held[0].binding.kind === 'patch.task' && held[0].auto === false && byHand.body.preview.tier !== held[0].tier,
    `agent: ${held[0].binding.kind}/${held[0].tier}, owner: ${byHand.body.preview.binding.kind}/${byHand.body.preview.tier}`);

  progress.stop();
}
