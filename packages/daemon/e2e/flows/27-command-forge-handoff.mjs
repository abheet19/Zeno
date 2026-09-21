/*
 * Command is the orchestration surface, not a second code generator. A build
 * instruction must skip general chat, open a visible Forge session and enter
 * Forge's ordinary governed route. This flow executes that exact renderer
 * path against a real isolated daemon and installed local model inventory.
 */

export const id = 'command-forge-handoff';
export const title = 'A Command build instruction opens Forge and starts its governed run path';
export const criteria = [
  'command: imperative tasks bypass general chat',
  'command: ready local tasks open visible Forge',
  'command: the selected local provider survives the Forge handoff',
  'command: long task input remains vertically scrollable',
];

const TASK = `Design and build a small dependency-free Python food-quality incident triage system in this repository.

Create complete files:
- app.py
- test_app.py
- ARCHITECTURE.md
- README.md

Requirements:
- Accept incident_id, facility, severity, and description.
- Support low, medium, high, and critical severity.
- Return monitor for low, human_review for medium or high, and escalate for critical.
- Treat incident_id as an idempotency key.
- Never close a high or critical incident automatically.
- Keep policy logic separate from storage behind a repository interface.
- Reject missing fields and unknown severity values.
- Use only the Python standard library and an in-memory repository.
- Test every severity, duplicate retry, invalid input, and the human-review boundary.
- Document the architecture and production extensions.
- Run python -m unittest -v.
- Show the plan, proposed files, diff, and verification output.
- Stop for owner approval before applying files.`;

export async function run({ daemon, page, ok, network, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const localModels = Array.isArray(agents.body?.localModels) ? agents.body.localModels : [];
  if (localModels.length === 0) {
    throw new Blocked('an installed Ollama model such as qwen3:8b, required for the local Forge handoff');
  }
  let runBody = null;
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/forge/run') return;
    try { runBody = request.postDataJSON(); } catch { runBody = null; }
  });

  await page.click('.seg [data-product="command"]');
  await page.click('.nav-i[data-screen="home"]');
  await page.fill('#home-ta', TASK);

  const composer = await page.$eval('#home-ta', (textarea) => ({
    value: textarea.value,
    scrollHeight: textarea.scrollHeight,
    clientHeight: textarea.clientHeight,
    overflowY: getComputedStyle(textarea).overflowY,
  }));
  ok.eq('the complete task remains in the composer', composer.value, TASK);
  ok('the capped long composer exposes vertical scrolling',
    composer.scrollHeight > composer.clientHeight && ['auto', 'scroll'].includes(composer.overflowY),
    JSON.stringify(composer));

  await page.click('#home-send');
  const opened = await page.waitForFunction(
    () => document.querySelector('.product.on[data-product]')?.getAttribute('data-product') === 'forge',
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('the task automatically opens Forge', opened);

  await page.waitForFunction(
    () => document.body.innerText.includes('food-quality incident triage'),
    { timeout: 10_000 },
  ).catch(() => {});
  ok('the new Forge session visibly carries the owner task',
    (await page.locator('body').innerText()).includes('food-quality incident triage'));

  await page.waitForTimeout(1_200);
  ok('Command asked the deterministic task route exactly through /assistant/ask',
    network.includes('POST /assistant/ask'), JSON.stringify([...new Set(network)]));
  ok('Plan first used the read-only planning boundary',
    network.includes('POST /forge/plan'), JSON.stringify([...new Set(network)]));
  const approvePlan = page.locator('#s-turns .plan-card button[data-plan-act="approve"]').first();
  await approvePlan.waitFor({ state: 'visible', timeout: 15_000 });
  await approvePlan.click();
  await page.waitForFunction(
    () => (document.querySelector('#s-status')?.textContent || '').includes('Working'),
    null,
    { timeout: 15_000 },
  ).catch(() => {});
  await page.waitForTimeout(1_000);
  ok('the task entered Forge run execution rather than general-answer rendering',
    network.includes('POST /forge/run'), JSON.stringify([...new Set(network)]));
  ok('Forge preserved Command\'s selected local model instead of rerouting to hosted',
    runBody?.agentId === 'local' && localModels.includes(runBody?.model)
      && !network.includes('POST /forge/route'),
    JSON.stringify({ runBody, localModels, posts: network.filter((entry) => entry.startsWith('POST ')) }));

  const commandText = await page.$eval('#home-turns', (node) => node.innerText);
  ok('Command did not render generated code as general knowledge',
    !/General knowledge|app\.py import|not grounded in your Zeno/i.test(commandText), commandText.slice(-500));

  // Do not spend a full inference on a routing acceptance test. The real Forge
  // run/hold/apply path has its own end-to-end flow; cancel this one only after
  // the real /forge/run request proves the handoff reached that path.
  const cancel = page.locator('.forge-progress button', { hasText: 'Cancel' }).first();
  if (await cancel.count()) await cancel.click().catch(() => {});
}
