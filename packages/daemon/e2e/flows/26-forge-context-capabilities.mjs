/**
 * Forge capability selection and Lens are one path, not decorative controls.
 * The flow installs a rule and skill into the harness's throwaway repository,
 * selects each through the real Forge slash menu, and verifies that Lens sends
 * those exact ids to POST /forge/context and renders that route's exact prompt.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const id = 'forge-context-capabilities';
export const title = 'Forge slash-selected rules/skills enter the exact Lens context';
export const criteria = ['every visible selector is functional', 'Lens renders daemon truth', 'selection reaches the request'];

export async function run({ daemon, page, ok, network, Blocked }) {
  const status = await daemon.api('/forge/status');
  const sandbox = status.body?.root;
  ok('the test has an isolated repository', typeof sandbox === 'string' && sandbox.length > 0, String(sandbox));

  writeFileSync(join(sandbox, 'CLAUDE.md'), 'E2E_RULE_SENTINEL: inspect inputs before changing code.\n', 'utf8');
  const skillDir = join(sandbox, '.agents', 'skills', 'e2e-review');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), [
    '---',
    'name: E2E review',
    'description: Verify the Forge context selector end to end.',
    '---',
    'E2E_SKILL_SENTINEL: report evidence before conclusions.',
    '',
  ].join('\n'), 'utf8');

  const contextBodies = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/forge/context') return;
    try { contextBodies.push(request.postDataJSON()); } catch { contextBodies.push(null); }
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zenoBind !== undefined, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__zenoStreamReady === true, null, { timeout: 10_000 });
  await page.click('[data-product="forge"]');
  await page.click('#s-new');
  await page.waitForSelector('input[data-skill-id="e2e-review"]', { state: 'attached', timeout: 10_000 });

  const initialSkills = await page.evaluate(() => ({
    selected: [...document.querySelectorAll('input[data-skill-id]')].filter((cb) => cb.checked).map((cb) => cb.dataset.skillId),
    pill: document.querySelector('#s-skills')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('skills load for deliberate opt-in without silently selecting every installed skill',
    initialSkills.selected.length === 0 && /0 skills/.test(initialSkills.pill || ''), JSON.stringify(initialSkills));

  // Prove the named command performs a selection, rather than merely opening
  // the sidebar on a checkbox that happened to default on.
  await page.evaluate(() => {
    const cb = document.querySelector('input[data-skill-id="e2e-review"]');
    if (cb?.checked) cb.click();
  });
  await page.fill('#s-ta', '/skill-e2e-review');
  await page.waitForSelector('.cmdmenu-row');
  const skillCommand = await page.evaluate(() => [...document.querySelectorAll('.cmdmenu-row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
  ok('Forge exposes the installed skill as a slash command', skillCommand.some((row) => row.startsWith('/skill-e2e-review')), JSON.stringify(skillCommand));
  await page.keyboard.press('Enter');
  ok('the skill command selects the real skill checkbox', await page.evaluate(() => document.querySelector('input[data-skill-id="e2e-review"]')?.checked === true));

  await page.fill('#s-ta', '/rule-claude-md');
  await page.waitForSelector('.cmdmenu-row');
  const ruleCommand = await page.evaluate(() => [...document.querySelectorAll('.cmdmenu-row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
  ok('Forge exposes the installed rule as a slash command', ruleCommand.some((row) => row.startsWith('/rule-claude-md')), JSON.stringify(ruleCommand));
  await page.keyboard.press('Enter');
  const ruleSelection = await page.evaluate(() => ({
    checked: [...document.querySelectorAll('input[data-rule-id]')].filter((cb) => cb.checked).map((cb) => cb.dataset.ruleId),
    claude: document.querySelector('input[data-rule-id]')?.checked,
    pill: document.querySelector('#s-skills')?.textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok('the rule command makes an explicit, visible one-rule selection', ruleSelection.claude === true && ruleSelection.checked.length === 1 && /1 rule/.test(ruleSelection.pill || ''), JSON.stringify(ruleSelection));

  const task = 'Explain the exact context for this task without changing a file.';
  await page.fill('#s-ta', task);
  await page.click('#s-tabs [data-stab="lens"]');
  await page.waitForSelector('[data-lens-prompt="1"]', { timeout: 10_000 });

  const lastBody = contextBodies[contextBodies.length - 1];
  ok('Lens calls the real context endpoint', network.includes('POST /forge/context'), JSON.stringify(network.filter((item) => item.includes('forge/context'))));
  ok('the exact draft task reaches POST /forge/context', lastBody?.task === task, JSON.stringify(lastBody));
  ok('the selected skill id reaches the context request', Array.isArray(lastBody?.skillIds) && lastBody.skillIds.includes('e2e-review'), JSON.stringify(lastBody));
  ok('the selected rule id reaches the context request', Array.isArray(lastBody?.ruleIds) && lastBody.ruleIds.length === 1 && typeof lastBody.ruleIds[0] === 'string', JSON.stringify(lastBody));

  const lens = await page.evaluate(() => ({
    prompt: document.querySelector('[data-lens-prompt="1"]')?.textContent || '',
    text: document.querySelector('.sessview[data-stab="lens"]')?.textContent || '',
  }));
  ok('Lens renders the owner task from the daemon prompt', lens.prompt.includes(task), lens.prompt.slice(-300));
  ok('Lens renders the selected rule bytes', lens.prompt.includes('E2E_RULE_SENTINEL'), lens.prompt.slice(0, 500));
  ok('Lens renders the selected skill bytes', lens.prompt.includes('E2E_SKILL_SENTINEL'), lens.prompt.slice(0, 500));
  ok('Lens shows the daemon context hash and measured counts', /SHA-256 [a-f0-9]{64}/.test(lens.text) && /1 rule/.test(lens.text) && /1 skill/.test(lens.text), lens.text.slice(0, 500));

  // The same selection helper feeds the real run path. Drive one bounded
  // local run far enough to inspect the renderer's actual POST body.
  const agents = await daemon.api('/forge/agents?passive=1');
  const models = Array.isArray(agents.body?.localModels) ? agents.body.localModels : [];
  const model = models.find((name) => /8b|14b/.test(name)) || models[0];
  if (!model) throw new Blocked('an installed local model to inspect the real Forge run request');
  await page.click('#s-model');
  await page.evaluate(() => [...document.querySelectorAll('.mp .mp-mode button')].find((button) => button.textContent.trim() === 'Single')?.click());
  const picked = await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll('.mp .mp-row')].find((button) => (button.querySelector('.mn')?.firstChild?.textContent?.trim() || '') === wanted);
    if (!row) return false;
    row.click();
    return true;
  }, model);
  ok('the installed local model is selectable for the run', picked, model);
  if (await page.getAttribute('#s-planfirst', 'aria-pressed') === 'true') await page.click('#s-planfirst');
  const runRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/forge/run', { timeout: 20_000 });
  await page.fill('#s-ta', 'Create .env.capability-e2e with the single line ZENO_CAPABILITY_E2E=true');
  await page.click('#s-send');
  const runBody = (await runRequest).postDataJSON();
  ok('the actual Forge run carries the selected skill and rule ids',
    runBody.skillIds?.includes('e2e-review') && runBody.ruleIds?.length === 1 && runBody.ruleIds[0] === lastBody.ruleIds[0],
    JSON.stringify(runBody));
  await page.waitForFunction(() => !(document.querySelector('#s-status')?.textContent || '').includes('Working'), null, { timeout: 180_000 });
}
