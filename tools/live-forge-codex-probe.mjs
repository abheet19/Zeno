/*
 * Live acceptance probe for the real Forge surface in the Electron app.
 * It drives rendered controls, confirms one hosted Codex run, proves the
 * generated file waits behind Zeno's approval capsule, applies it once, and
 * removes the disposable fixture afterward.
 */
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT || 'http://127.0.0.1:9228';
const fixtureFile = 'D:/Work/zeno-e2e-fixture-20260909/codex-forge-smoke.txt';
const expected = 'Codex reached the isolated Forge worktree.\n';
const task = 'Create codex-forge-smoke.txt with exactly one line: Codex reached the isolated Forge worktree.';

await rm(fixtureFile, { force: true });
const browser = await chromium.connectOverCDP(endpoint);
let page;

try {
  page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  page.setDefaultTimeout(20_000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-nav="forge"]').click();

  const agent = page.locator('select[aria-label="Agent"]');
  const model = page.locator('select[aria-label="Model"]');
  const effort = page.locator('select[aria-label="Effort"]');
  await agent.waitFor({ state: 'visible' });

  const bodyBefore = (await page.locator('body').textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(bodyBefore, /hello\.txt/);
  assert.match(bodyBefore, /worktree clean/i);
  assert.match(bodyBefore, /AGENTS\.md/);

  await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
  const command = page.getByLabel('Terminal command');
  await command.fill('git status --short');
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await page.getByText(/git status --short .* exit 0/).waitFor();

  const options = await agent.locator('option').evaluateAll(items => items.map(item => ({
    value: item.value,
    label: item.textContent?.trim() || '',
    disabled: item.disabled,
  })));
  assert.deepEqual(options.map(item => item.value), ['claude-code', 'codex', 'local']);
  assert.equal(options.find(item => item.value === 'codex')?.disabled, false);
  assert.equal(options.find(item => item.value === 'claude-code')?.disabled, false);
  assert.equal(options.find(item => item.value === 'local')?.disabled, false);

  await agent.selectOption('codex');
  assert.equal(await effort.isEnabled(), true, 'Codex effort must be selectable');
  await effort.selectOption('low');
  const modelLabels = await model.locator('option').allTextContents();
  assert.ok(modelLabels.some(label => label.includes('gpt-6-astra')));
  if (await model.locator('option[value="gpt-6-astra"]').count()) await model.selectOption('gpt-6-astra');

  await page.locator('#zf-task').fill(task);
  await page.locator('.rgC').getByRole('button', { name: 'Run', exact: true }).click();
  const confirmation = page.getByRole('alert', { name: 'Confirm hosted agent run' });
  await confirmation.waitFor({ state: 'visible' });
  const confirmationText = (await confirmation.textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(confirmationText, /consume your provider plan or API allowance/i);
  assert.match(confirmationText, /will not retry automatically/i);
  assert.match(confirmationText, /every file still waits for your approval/i);
  assert.equal(await readFile(fixtureFile, 'utf8').then(() => true, () => false), false);

  await confirmation.locator('[data-intent="confirm-hosted"]').click();
  await page.locator('.fgrunning').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.fgrunning').waitFor({ state: 'detached', timeout: 240_000 });
  await page.waitForFunction(
    () => /codex-forge-smoke\.txt|Codex reached the isolated Forge worktree/i.test(document.querySelector('.insp-bd')?.textContent || ''),
    null,
    { timeout: 30_000 },
  );

  // The isolated agent may create the file in its throwaway worktree, but the
  // selected repository must still be unchanged until the owner approves.
  assert.equal(await readFile(fixtureFile, 'utf8').then(() => true, () => false), false);
  await page.waitForFunction(() => Boolean(document.querySelector('.fgate[data-settled="0"] .zn-approve:not(:disabled)')),
    null, { timeout: 30_000 });
  const capsule = page.locator('.fgate[data-settled="0"]').filter({ hasText: 'codex-forge-smoke.txt' }).first();
  await capsule.waitFor({ state: 'visible' });
  const capsuleText = (await capsule.textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(capsuleText, /codex-forge-smoke\.txt/);
  await capsule.locator('.zn-approve').click();
  await page.waitForFunction(() => document.querySelector('.fgate[data-settled="1"]')?.textContent?.includes('codex-forge-smoke.txt'),
    null, { timeout: 30_000 });

  const landed = await readFile(fixtureFile, 'utf8');
  assert.equal(landed.replace(/\r\n/g, '\n'), expected);
  const result = await page.evaluate(() => ({
    agent: document.querySelector('select[aria-label="Agent"]')?.value || '',
    model: document.querySelector('select[aria-label="Model"]')?.value || '',
    effort: document.querySelector('select[aria-label="Effort"]')?.value || '',
    chat: document.querySelector('.insp-bd')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    status: document.querySelector('.rgE')?.textContent?.replace(/\s+/g, ' ').trim() || '',
  }));
  assert.equal(result.agent, 'codex');
  assert.equal(result.effort, 'low');
  process.stdout.write(`${JSON.stringify({
    options,
    modelLabels,
    result: { ...result, capsule: capsuleText, confirmation: confirmationText },
    landed: true,
  })}\n`);
} finally {
  await rm(fixtureFile, { force: true });
  await browser.close();
}
