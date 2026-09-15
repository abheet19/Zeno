/*
 * PLAN-FIRST INTAKE: with "Plan first" on, a task does not go straight to a
 * run. The daemon's read-only POST /forge/plan reads the repository and hands
 * back a structured plan; the owner approves (optionally after editing),
 * or discards it. Only Approve starts the real run — through the same
 * /forge/run path — and that run carries the approved plan.
 *
 * Every claim below is about an EFFECT the daemon can confirm, not a screen:
 *   - planning is read-only  -> /state is unchanged (no proposal, no receipt)
 *                               and no worktree directory appeared
 *   - approve is the run     -> POST /forge/run fires only after the click,
 *                               the daemon's response says the run carried
 *                               the plan, and a risky change comes back HELD
 *   - discard runs nothing   -> no /forge/run, /state unchanged
 *   - off means unchanged    -> a task goes straight to /forge/run, no /forge/plan
 *   - Command respects it    -> the zeno:command-run event plans too when on
 */

import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const id = 'plan-first';
export const title = 'Plan first: a read-only plan the owner approves, edits, or discards before a run';
export const criteria = ['owner: intake — research before work', 'forge: planning never touches the repository'];

/** Where `packages/forge/src/worktree.ts` puts a run's isolated checkout. */
const WORKTREE_DIR = join(tmpdir(), 'zeno-forge-worktrees');
const PREFERRED_LOCAL = ['qwen3:8b', 'qwen3:14b'];
// Routine T0 edits auto-apply by policy. This flow needs to exercise the held
// approval branch after planning, so it targets a configuration path.
const TASK = 'Create a file named .env.plan-example whose entire contents are the single line: ZENO_PLAN_FIRST=true';

function worktrees() {
  try { return existsSync(WORKTREE_DIR) ? readdirSync(WORKTREE_DIR).sort() : []; } catch { return []; }
}

const count = (network, entry) => network.filter((n) => n === entry).length;

/** Choose the local model through the real picker, so the run is the owner's explicit choice. */
async function pickLocal(page, model) {
  await page.click('#s-model');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const single = [...document.querySelectorAll('.mp .mp-mode button')].find((b) => b.textContent.trim() === 'Single');
    if (single) single.click();
  });
  await page.waitForTimeout(300);
  const picked = await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll('.mp .mp-row')]
      .find((b) => (b.querySelector('.mn')?.firstChild?.textContent?.trim() ?? '') === wanted);
    if (!row) return false;
    row.click();
    return true;
  }, model);
  await page.waitForTimeout(300);
  return picked;
}

async function waitForPlanCard(page, timeoutMs) {
  return page.waitForFunction(() => {
    const turns = [...document.querySelectorAll('#s-turns .turn')];
    const last = turns[turns.length - 1];
    if (!last) return false;
    if (last.querySelector('.plan-card.pending .dvsteps li')) return 'card';
    if (/Plan failed/.test(last.textContent || '')) return 'failed';
    return false;
  }, null, { timeout: timeoutMs }).then((h) => h.jsonValue()).catch(() => null);
}

export async function run({ daemon, page, ok, network, Blocked }) {
  const lensBodies = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/forge/context') return;
    try { lensBodies.push(request.postDataJSON()); } catch { lensBodies.push(null); }
  });
  const agents = await daemon.api('/forge/agents?passive=1');
  const localModels = Array.isArray(agents.body?.localModels) ? agents.body.localModels : [];
  if (localModels.length === 0) {
    throw new Blocked('an Ollama model installed on this machine (e.g. `ollama pull qwen3:8b`) — planning runs on a local model');
  }
  const model = PREFERRED_LOCAL.find((m) => localModels.includes(m)) ?? localModels[0];

  const before = await daemon.api('/state');
  ok.eq('the ledger starts empty', before.body.receipts.length, 0);
  ok.eq('nothing is held before planning', before.body.pending.length, 0);
  const treesBefore = worktrees();

  /* ---------------------------------------------------------------- *
   * 1 · the toggle defaults ON, and Send produces a plan, not a run   *
   * ---------------------------------------------------------------- */
  await page.click('[data-product="forge"]');
  await page.waitForTimeout(600);
  await page.click('#s-new');
  await page.waitForTimeout(300);
  ok('the picker offers the local model', await pickLocal(page, model), model);

  const toggle = await page.evaluate(() => {
    const b = document.querySelector('#s-planfirst');
    let stored = null;
    try { stored = localStorage.getItem('zeno-plan-first'); } catch { /* unavailable */ }
    return b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), stored } : null;
  });
  ok('the composer carries a Plan first toggle, on by default', toggle?.text === 'Plan first: on' && toggle.pressed === 'true', JSON.stringify(toggle));

  await page.fill('#s-ta', TASK);
  await page.click('#s-send');
  const planning = await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Planning'),
    // Options are waitForFunction's THIRD argument; passed second they become
    // the `arg` and Playwright's default 30s silently applies instead.
    null, { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('the session says it is planning, not working', planning);

  const outcome = await waitForPlanCard(page, 150_000);
  if (outcome === 'failed') {
    const text = await page.evaluate(() => document.querySelector('#s-turns .turn:last-child')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
    throw new Blocked(`a local model that can return a plan — ${model} could not: ${text}`);
  }
  ok('a plan card with numbered steps appears within 150s', outcome === 'card',
    await page.evaluate(() => document.querySelector('#s-turns .turn:last-child')?.innerText.replace(/\s+/g, ' ').slice(0, 300)));

  ok('the window called the read-only plan route', network.includes('POST /forge/plan'), JSON.stringify(network.filter((n) => n.startsWith('POST'))));
  ok('and did NOT start a run', !network.includes('POST /forge/run'), JSON.stringify(network.filter((n) => n.startsWith('POST'))));

  const afterPlan = await daemon.api('/state');
  ok.eq('planning filed no proposal', afterPlan.body.pending.length, 0);
  ok.eq('planning sealed no receipt', afterPlan.body.receipts.length, 0);
  ok('planning created no worktree', JSON.stringify(worktrees()) === JSON.stringify(treesBefore), JSON.stringify(worktrees()));
  const sandbox = await daemon.api('/forge/status');
  ok.eq('the sandbox working tree is untouched by planning', sandbox.body.changed.length, 0);

  const card = await page.evaluate(() => {
    const c = document.querySelector('#s-turns .plan-card.pending');
    if (!c) return null;
    return {
      steps: [...c.querySelectorAll('.dvsteps li span')].map((s) => s.textContent.trim()),
      note: c.querySelector('.vsnote')?.textContent || '',
      buttons: [...c.querySelectorAll('button[data-plan-act]')].map((b) => ({ act: b.dataset.planAct, label: b.textContent.trim(), disabled: b.disabled })),
      model: c.querySelector('.plan-head .frm')?.textContent || '',
    };
  });
  ok('the card lists real steps', (card?.steps.length ?? 0) >= 1, JSON.stringify(card?.steps));
  ok('the card says, in the daemon’s words, that planning touched nothing', /no worktree was created/.test(card?.note ?? '') && /no file was written/.test(card?.note ?? ''), card?.note);
  ok('the card names the model that planned', card?.model.includes(model) === true, card?.model);
  ok('the owner is offered approve, edit, and discard — all live',
    JSON.stringify((card?.buttons ?? []).map((b) => b.act)) === JSON.stringify(['approve', 'edit', 'discard']) && card.buttons.every((b) => !b.disabled),
    JSON.stringify(card?.buttons));

  /* ---------------------------------------------------------------- *
   * 2 · edit a step inline, then approve — that is the run            *
   * ---------------------------------------------------------------- */
  await page.click('#s-turns .plan-card button[data-plan-act="edit"]');
  await page.waitForTimeout(200);
  const editing = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('#s-turns .plan-card.editing input.plan-step-in')];
    if (!inputs.length) return 0;
    inputs[0].value = `${inputs[0].value} (edited by the owner)`;
    return inputs.length;
  });
  ok('Edit plan makes every step an editable field', editing >= 1 && editing === card.steps.length, `${editing} inputs for ${card.steps.length} steps`);
  await page.click('#s-turns .plan-card button[data-plan-act="edit"]');
  await page.waitForTimeout(200);
  const edited = await page.evaluate(() => [...document.querySelectorAll('#s-turns .plan-card.pending .dvsteps li span')].map((s) => s.textContent.trim()));
  ok('the edited step is what the card now shows', /\(edited by the owner\)$/.test(edited[0] ?? ''), JSON.stringify(edited));

  const runsBeforeApprove = count(network, 'POST /forge/run');
  await page.click('#s-turns .plan-card button[data-plan-act="approve"]');
  const working = await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Working'),
    null, { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('approving the plan starts the run', working);
  const approvedCard = await page.evaluate(() => document.querySelector('#s-turns .plan-card.approved')?.textContent.replace(/\s+/g, ' ') || '');
  ok('the card now reads as approved', /Plan approved/.test(approvedCard), approvedCard.slice(0, 120));

  const settled = await page.waitForFunction(
    () => !(document.querySelector('#s-status')?.textContent || '').includes('Working'),
    null, { timeout: 180_000 }
  ).then(() => true).catch(() => false);
  ok('the run finishes within 180s', settled);
  ok.eq('exactly one real run was started by the approval', count(network, 'POST /forge/run'), runsBeforeApprove + 1);

  const agentTurn = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#s-turns .turn.z')].reverse().find((x) => x.querySelector('.frh .pill') && !x.querySelector('.plan-card'));
    return t ? t.innerText.replace(/\s+/g, ' ') : '';
  });
  ok('the run reports that it carried the approved plan (the daemon’s word, not the window’s)',
    new RegExp(`ran with your approved plan \\(${edited.length} steps\\)`).test(agentTurn), agentTurn.slice(0, 200));

  await page.click('#s-tabs [data-stab="lens"]');
  await page.waitForSelector('[data-lens-prompt="1"]', { timeout: 10_000 });
  const plannedLens = await page.evaluate(() => document.querySelector('[data-lens-prompt="1"]')?.textContent || '');
  ok('Lens calls the context route for the approved-plan session', network.includes('POST /forge/context'));
  ok('Lens sends the same owner-approved plan bytes the run used',
    /OWNER-APPROVED PLAN/.test(lensBodies[lensBodies.length - 1]?.task || '') && (lensBodies[lensBodies.length - 1]?.task || '').includes(edited[0]),
    JSON.stringify(lensBodies[lensBodies.length - 1]));
  ok('Lens renders that exact approved plan in the daemon prompt', /OWNER-APPROVED PLAN/.test(plannedLens) && plannedLens.includes(edited[0]), plannedLens.slice(-600));

  const afterRun = await daemon.api('/state');
  if (afterRun.body.pending.length === 0) {
    throw new Blocked(`a local Ollama model that can follow Forge's ===FILE:=== envelope — ${model} proposed no file change for a one-line task ("${agentTurn.slice(0, 200)}")`);
  }
  ok('the planned run’s changes arrive as held proposals', afterRun.body.pending.length >= 1, `${afterRun.body.pending.length} held`);
  ok('none of them may auto-apply', afterRun.body.pending.every((h) => h.auto === false));
  ok('the proposal summary names the task, not the plan prose',
    afterRun.body.pending.every((h) => /^Forge \(local\): write .* — Create a file named \.env\.plan-example/.test(h.summary)),
    JSON.stringify(afterRun.body.pending.map((h) => h.summary)));
  ok.eq('a planned run still seals no receipt on its own', afterRun.body.receipts.length, 0);

  const runsTab = await page.evaluate(() => {
    document.querySelector('#s-tabs button[data-stab="runs"]')?.click();
    return document.querySelector('.sessview[data-stab="runs"] .frun .frm')?.textContent || '';
  });
  ok('the Runs tab marks the run as planned', /planned \(\d+ steps\)/.test(runsTab), runsTab);

  /* ---------------------------------------------------------------- *
   * 3 · Discard runs nothing                                          *
   * ---------------------------------------------------------------- */
  await page.click('#s-new');
  await page.waitForTimeout(300);
  await pickLocal(page, model);
  const runsBeforeDiscard = count(network, 'POST /forge/run');
  const pendingBeforeDiscard = afterRun.body.pending.length;
  await page.fill('#s-ta', 'Create a file named discard-me.txt containing the single word: discard');
  await page.click('#s-send');
  const outcome2 = await waitForPlanCard(page, 150_000);
  ok('a second task also stops at a plan card', outcome2 === 'card', String(outcome2));
  if (outcome2 === 'card') {
    await page.click('#s-turns .plan-card button[data-plan-act="discard"]');
    await page.waitForTimeout(300);
  }
  const discarded = await page.evaluate(() => document.querySelector('#s-turns .turn:last-child')?.innerText.replace(/\s+/g, ' ') || '');
  ok('the card says the plan was discarded and nothing ran', /Plan discarded — nothing ran/.test(discarded), discarded.slice(0, 120));
  ok.eq('discarding started no run', count(network, 'POST /forge/run'), runsBeforeDiscard);
  const afterDiscard = await daemon.api('/state');
  ok.eq('discarding filed nothing', afterDiscard.body.pending.length, pendingBeforeDiscard);
  ok.eq('discarding sealed nothing', afterDiscard.body.receipts.length, 0);
  ok('the plan tab shows the session’s plan as discarded', await page.evaluate(() => {
    document.querySelector('#s-tabs button[data-stab="plan"]')?.click();
    return /discarded/.test(document.querySelector('.sessview[data-stab="plan"]')?.textContent || '');
  }));

  /* ---------------------------------------------------------------- *
   * 4 · toggle OFF: a task goes straight to a run, as before          *
   * ---------------------------------------------------------------- */
  await page.click('#s-planfirst');
  const off = await page.evaluate(() => {
    let stored = null;
    try { stored = localStorage.getItem('zeno-plan-first'); } catch { /* unavailable */ }
    return { text: document.querySelector('#s-planfirst')?.textContent.trim(), hero: document.querySelector('#ag-planfirst')?.textContent.trim(), stored };
  });
  ok('the toggle turns off and is remembered', off.text === 'Plan first: off' && off.hero === 'Plan first: off' && off.stored === 'off', JSON.stringify(off));

  await page.click('#s-new');
  await page.waitForTimeout(300);
  await pickLocal(page, model);
  const plansBeforeOff = count(network, 'POST /forge/plan');
  const runsBeforeOff = count(network, 'POST /forge/run');
  await page.fill('#s-ta', 'Create a file named straight.txt whose entire contents are the single line: no plan');
  await page.click('#s-send');
  const straight = await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Working'),
    null, { timeout: 15_000 }
  ).then(() => true).catch(() => false);
  ok('with the toggle off the session goes straight to Working', straight);
  ok.eq('no plan was requested', count(network, 'POST /forge/plan'), plansBeforeOff);
  ok.eq('the run started at once', count(network, 'POST /forge/run'), runsBeforeOff + 1);
  await page.waitForFunction(
    () => !(document.querySelector('#s-status')?.textContent || '').includes('Working'),
    null, { timeout: 180_000 }
  ).catch(() => {});
  const plainTurn = await page.evaluate(() => document.querySelector('#s-turns')?.innerText.replace(/\s+/g, ' ') || '');
  ok('an unplanned run is not described as planned', !/ran with your approved plan/.test(plainTurn));

  /* ---------------------------------------------------------------- *
   * 5 · Command's "Run in Forge now" respects the toggle              *
   * ---------------------------------------------------------------- */
  await page.click('#s-planfirst');
  const plansBeforeCommand = count(network, 'POST /forge/plan');
  await page.click('.seg [data-product="command"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('zeno:command-run', { detail: { task: 'Create a file named from-command.txt containing the single word: command' } })));
  const viaCommand = await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Planning'),
    null, { timeout: 15_000 }
  ).then(() => true).catch(() => false);
  ok('a task dispatched from Command plans first when the toggle is on', viaCommand,
    await page.evaluate(() => document.querySelector('#s-status')?.textContent || ''));
  const outcome3 = await waitForPlanCard(page, 150_000);
  ok('…and reaches a plan card', outcome3 === 'card', String(outcome3));
  ok.eq('that was one more plan request', count(network, 'POST /forge/plan'), plansBeforeCommand + 1);
  if (outcome3 === 'card') await page.click('#s-turns .plan-card button[data-plan-act="discard"]');

  /* ---------------------------------------------------------------- *
   * 6 · Agent mode is a real chat-first layout: sessions rail, full-  *
   *     width transcript, live quick actions — and it survives reload *
   * ---------------------------------------------------------------- */
  await page.click('#forge-viewseg [data-forge-view="agent"]');
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const ide = document.querySelector('#ide');
    const sess = document.querySelector('#sess');
    const rail = document.querySelector('#ag-rail');
    const quick = document.querySelector('#ag-quick');
    const turns = document.querySelector('#s-turns');
    return {
      agent: ide?.classList.contains('mode-agent'),
      display: sess ? getComputedStyle(sess).display : null,
      railShown: !!rail && rail.offsetParent !== null,
      quickShown: !!quick && quick.offsetParent !== null,
      railW: rail?.getBoundingClientRect().width, sessW: sess?.getBoundingClientRect().width, turnsW: turns?.getBoundingClientRect().width,
      rows: [...document.querySelectorAll('#ag-list .dvsess')].map((b) => ({ title: b.querySelector('b')?.textContent, state: b.querySelector('.ag-state')?.textContent })),
      sessions: [...document.querySelectorAll('#ag-list .dvsess')].length,
    };
  });
  ok('Agent mode lays the session panel out as a grid with a rail and quick actions',
    layout.agent === true && layout.display === 'grid' && layout.railShown && layout.quickShown, JSON.stringify(layout));
  ok('the transcript takes the centre of the workbench, not a narrow column',
    layout.sessW > 1000 && layout.turnsW > 500, `session panel ${layout.sessW}px, transcript ${layout.turnsW}px`);
  ok.eq('the rail lists every session this flow created', layout.sessions, 4);
  ok('the rail is newest-first and names the sessions', /from-command/.test(layout.rows[0]?.title ?? ''), JSON.stringify(layout.rows));
  const plannedRow = layout.rows.find((r) => /\.env\.plan-example/.test(r.title || ''));
  ok('the planned session’s row reports its held changes from the daemon’s queue', /\d+ held/.test(plannedRow?.state ?? ''), JSON.stringify(plannedRow));

  await page.evaluate(() => [...document.querySelectorAll('#ag-list .dvsess')].find((b) => /\.env\.plan-example/.test(b.textContent)).click());
  await page.waitForTimeout(300);
  ok('clicking a rail row opens that session', await page.evaluate(() => /\.env\.plan-example/.test(document.querySelector('#s-title')?.textContent || '') && !!document.querySelector('#s-turns .plan-card.approved')));

  await page.fill('#ag-search', 'discard');
  await page.waitForTimeout(150);
  ok.eq('the rail search filters sessions', await page.evaluate(() => document.querySelectorAll('#ag-list .dvsess').length), 1);
  await page.fill('#ag-search', '');
  await page.waitForTimeout(150);

  await page.click('#ag-new');
  await page.waitForTimeout(300);
  ok('New session in the rail opens a fresh session', await page.evaluate(() => document.querySelectorAll('#ag-list .dvsess').length === 5 && (document.querySelector('#s-title')?.textContent || '') === 'New session'));

  const quickState = await page.evaluate(() => {
    const d = document.querySelector('#aq-diffs');
    return { text: d?.textContent, disabled: d?.disabled, links: [...document.querySelectorAll('#ag-links button, .ag-links button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()) };
  });
  const heldNow = (await daemon.api('/state')).body.pending.length;
  ok('View diffs counts the daemon’s held changes and is live because there are some',
    quickState.text === `View diffs (${heldNow} held change${heldNow === 1 ? '' : 's'})` && quickState.disabled === false, JSON.stringify(quickState));
  await page.click('#aq-diffs');
  await page.waitForTimeout(400);
  ok('View diffs lands on Command → Approvals, where the real diffs are', await page.evaluate(() =>
    document.documentElement.getAttribute('data-zeno-surface') === 'command' && document.querySelector('.screen[data-screen="approvals"]')?.classList.contains('on')));
  await page.click('.seg [data-product="forge"]');
  await page.waitForTimeout(300);
  await page.click('#aq-open');
  await page.waitForTimeout(300);
  ok('Open file switches to the editor and opens the real quick-open picker', await page.evaluate(() =>
    !document.querySelector('#ide')?.classList.contains('mode-agent') && document.querySelector('#quick')?.hidden === false));
  await page.keyboard.press('Escape');
  await page.click('#forge-viewseg [data-forge-view="agent"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => [...document.querySelectorAll('.ag-links button')].find((b) => /Automations/.test(b.textContent)).click());
  await page.waitForTimeout(300);
  ok('Automations opens the real ZENO sidebar view (scheduled tasks) in the editor', await page.evaluate(() =>
    !document.querySelector('#ide')?.classList.contains('mode-agent') && document.querySelector('.vsact [data-vsview="zeno"]')?.getAttribute('aria-current') === 'page'));
  await page.click('#forge-viewseg [data-forge-view="agent"]');

  // Persistence: the rail's history is this browser's own, and it must survive a reload as real transcripts.
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('zeno-forge-sessions') || 'null'); } catch { return null; } });
  ok('sessions are persisted in this browser', Array.isArray(stored) && stored.length === 5 && stored.some((s) => /\.env\.plan-example/.test(s.title || '')), JSON.stringify((stored || []).map((s) => s.title)));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const bound = await page.waitForFunction(() => window.__zenoBind !== undefined, null, { timeout: 20_000 }).then(() => true).catch(() => false);
  ok('the window binds again after a reload', bound);
  await page.click('[data-product="forge"]');
  await page.waitForTimeout(600);
  const restored = await page.evaluate(() => ({
    agent: document.querySelector('#ide')?.classList.contains('mode-agent'),
    rows: [...document.querySelectorAll('#ag-list .dvsess')].map((b) => b.querySelector('b')?.textContent),
  }));
  ok('Agent mode and every past session come back after a reload', restored.agent === true && restored.rows.length === 5, JSON.stringify(restored));
  await page.evaluate(() => [...document.querySelectorAll('#ag-list .dvsess')].find((b) => /\.env\.plan-example/.test(b.textContent))?.click());
  await page.waitForTimeout(300);
  ok('a restored session carries its real transcript, approved plan card included', await page.evaluate(() =>
    !!document.querySelector('#s-turns .plan-card.approved') && /ran with your approved plan/.test(document.querySelector('#s-turns')?.innerText || '')));
}
