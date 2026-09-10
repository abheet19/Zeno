/*
 * Live Windows acceptance probe for Counsel in the running Electron renderer.
 * Uses rendered controls and audible Windows TTS, then removes its saved fixture.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const endpoint = process.env.ZENO_CDP_ENDPOINT || 'http://127.0.0.1:9231';
const stamp = Date.now().toString(36);
const savedTitle = 'Counsel live acceptance ' + stamp;
const discardedTitle = 'Counsel discard acceptance ' + stamp;
const phrase =
  'We decided to use PostgreSQL for the Counsel archive. ' +
  'I will send the migration plan to Priya by Friday. ' +
  'What is the expected storage cost?';

function speak(text) {
  const escaped = text.replaceAll("'", "''");
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$voice = [System.Speech.Synthesis.SpeechSynthesizer]::new()',
    '$voice.Rate = -1',
    '$voice.Volume = 100',
    "$voice.Speak('" + escaped + "')",
    '$voice.Dispose()',
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('TTS exited with ' + code)));
  });
}

async function waitForArchive(page) {
  await page.locator('.cnpanel--calls').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('.cnpanel--calls')?.textContent?.includes('Reading the archive'),
    null,
    { timeout: 15_000 },
  );
}

async function openPreflight(page, title, participants) {
  await page.getByRole('button', { name: 'Start a call', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preflight before capture' });
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('#zc-pre-title').fill(title);
  await dialog.locator('#zc-pre-people').fill(participants);
  return dialog;
}

async function consentAndBegin(page, dialog) {
  const consent = dialog.locator('#zc-pre-consent');
  await consent.check();
  assert.equal(await consent.isChecked(), true);
  const begin = dialog.getByRole('button', { name: /Begin (?:manual )?capture/i });
  assert.equal(await begin.isEnabled(), true);
  await begin.click();
  await page.locator('.ov[aria-label="Live call"]').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      document.body.dataset.zenoCapture === 'counsel' &&
      document.querySelector('.ov .hd .lab')?.textContent?.includes('RECORDING'),
    null,
    { timeout: 15_000 },
  );
}

async function deleteByTitle(page, title) {
  await page.locator('[data-nav="counsel"]').click();
  const row = page.locator('.callrow', { hasText: title });
  if (await row.count() === 0) return false;
  await row.first().click();
  const first = page.getByRole('button', { name: 'Delete this call', exact: true });
  await first.waitFor({ state: 'visible' });
  await first.click();
  const confirm = page.getByRole('button', { name: 'Click again to delete for good', exact: true });
  await confirm.waitFor({ state: 'visible' });
  await confirm.click();
  await row.first().waitFor({ state: 'detached', timeout: 15_000 });
  return true;
}

const browser = await chromium.connectOverCDP(endpoint);
let page;
let created = false;
const requests = [];

try {
  page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Zeno renderer was not found.');
  page.setDefaultTimeout(15_000);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/counsel/')) requests.push({ method: request.method(), path: url.pathname });
  });

  const voiceDisclosureCancel = page.locator('.zv-cancel');
  if (await voiceDisclosureCancel.isVisible()) await voiceDisclosureCancel.click();

  await page.locator('[data-nav="counsel"]').click();
  await waitForArchive(page);
  const baselineRows = await page.locator('.callrow').count();

  let delayed = false;
  await page.route('**/forge/agents', async route => {
    if (!delayed) {
      delayed = true;
      await new Promise(resolve => setTimeout(resolve, 1_200));
    }
    await route.continue();
  });
  const dialog = await openPreflight(page, savedTitle, 'Abheet, Priya');
  const titleInput = dialog.locator('#zc-pre-title');
  await titleInput.focus();
  await titleInput.evaluate(input => input.setSelectionRange(8, 12));
  await page.waitForTimeout(1_600);
  const focusEvidence = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      activeId: active?.id || '',
      title: document.querySelector('#zc-pre-title')?.value || '',
      participants: document.querySelector('#zc-pre-people')?.value || '',
      selectionStart: active && 'selectionStart' in active ? active.selectionStart : null,
      selectionEnd: active && 'selectionEnd' in active ? active.selectionEnd : null,
    };
  });
  assert.deepEqual(focusEvidence, {
    activeId: 'zc-pre-title',
    title: savedTitle,
    participants: 'Abheet, Priya',
    selectionStart: 8,
    selectionEnd: 12,
  });
  await page.unroute('**/forge/agents');

  const preflightText = (await dialog.textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(preflightText, /Local Whisper/i);
  assert.match(preflightText, /system audio.*not captured/i);
  assert.match(preflightText, /transcript text only/i);
  await consentAndBegin(page, dialog);

  await page.locator('.ov button[data-spk="owner"]').click();
  await page.waitForTimeout(350);
  await speak(phrase);
  // Switch the next-line control before inference settles. The current segment
  // must retain the owner label captured at voice onset.
  await page.locator('.ov button[data-spk="other"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll('.ov .trline').length > 0,
    null,
    { timeout: 45_000 },
  );
  const liveLines = await page.locator('.ov .trline').evaluateAll(lines => lines.map(line => ({
    speaker: line.querySelector('.who')?.textContent?.trim() || '',
    text: line.querySelector('.tx')?.textContent?.replace(/\s+/g, ' ').trim() || '',
  })));
  assert.ok(liveLines.every(line => line.speaker === 'owner'), JSON.stringify(liveLines));
  assert.match(liveLines.map(line => line.text).join(' '), /PostgreSQL|Counsel archive|migration plan/i);

  await page.locator('[data-nav="command"]').click();
  const overlayInCommand = await page.locator('.ov[aria-label="Live call"]').isVisible();
  assert.equal(overlayInCommand, true);
  assert.equal(await page.locator('body').getAttribute('data-zeno-capture'), 'counsel');

  const ptt = page.locator('.zv-ptt');
  await ptt.scrollIntoViewIfNeeded();
  const pttBox = await ptt.boundingBox();
  if (!pttBox) throw new Error('Command push-to-talk is not visible.');
  await page.mouse.move(pttBox.x + pttBox.width / 2, pttBox.y + pttBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const pttRefusal = (await page.locator('.zv-outcome').textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(pttRefusal, /Counsel/i);

  const wake = page.locator('.zv-wake-toggle');
  await wake.click();
  await page.waitForTimeout(150);
  const wakeRefusal = (await page.locator('.zv-outcome').textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(wakeRefusal, /Counsel/i);
  assert.notEqual(await wake.getAttribute('aria-pressed'), 'true');

  await page.locator('[data-nav="counsel"]').click();
  assert.equal(await page.locator('.ov[aria-label="Live call"]').isVisible(), true);
  await page.getByRole('button', { name: 'End call & save', exact: true }).click();
  await page.locator('.ov[aria-label="Live call"]').waitFor({ state: 'detached', timeout: 30_000 });
  const savedRow = page.locator('.callrow', { hasText: savedTitle });
  await savedRow.waitFor({ state: 'visible', timeout: 20_000 });
  created = true;
  assert.equal(await page.locator('.callrow').count(), baselineRows + 1);
  assert.equal(requests.filter(item => item.method === 'POST' && item.path === '/counsel/meetings').length, 1);

  await savedRow.click();
  await page.waitForFunction(
    title => document.querySelector('.cnpanel--call')?.textContent?.includes(title),
    savedTitle,
  );
  const detailText = (await page.locator('.cnpanel--call').textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.match(detailText, /PostgreSQL|Counsel archive|migration plan/i);
  assert.match(detailText, /DECISIONS|ACTIONS|OPEN QUESTIONS/i);
  assert.match(detailText, /source|cited|u\d|\/u\d/i);

  const globalAsk = page.getByLabel('Ask about your calls');
  await globalAsk.fill('What database did I choose for the Counsel archive?');
  await globalAsk.press('Enter');
  await page.waitForFunction(
    () => {
      const answers = [...document.querySelectorAll('.cnpanel--ask .a')];
      const last = answers.at(-1);
      return Boolean(last && !last.textContent?.includes('Asking the local model'));
    },
    null,
    { timeout: 75_000 },
  );
  const askText = (await page.locator('.cnpanel--ask .a').last().textContent())?.replace(/\s+/g, ' ').trim() || '';
  assert.doesNotMatch(askText, /Asking the local model/);
  assert.match(askText, /PostgreSQL|\bSQL\b|Coun(?:sel|cil) archive|No answer|could not find|UNGROUNDED/i);

  const firstDelete = page.getByRole('button', { name: 'Delete this call', exact: true });
  await firstDelete.click();
  const confirmDelete = page.getByRole('button', { name: 'Click again to delete for good', exact: true });
  await confirmDelete.waitFor({ state: 'visible' });
  await confirmDelete.click();
  await savedRow.waitFor({ state: 'detached', timeout: 15_000 });
  created = false;
  assert.equal(await page.locator('.callrow').count(), baselineRows);

  const meetingPostsBeforeDiscard = requests.filter(
    item => item.method === 'POST' && item.path === '/counsel/meetings',
  ).length;
  const discardDialog = await openPreflight(page, discardedTitle, 'Abheet');
  await consentAndBegin(page, discardDialog);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.locator('.ov[aria-label="Live call"]').waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  const meetingPostsAfterDiscard = requests.filter(
    item => item.method === 'POST' && item.path === '/counsel/meetings',
  ).length;
  assert.equal(meetingPostsAfterDiscard, meetingPostsBeforeDiscard);
  assert.equal(await page.locator('.callrow', { hasText: discardedTitle }).count(), 0);
  assert.equal(await page.locator('.callrow').count(), baselineRows);

  const evidence = {
    endpoint,
    baselineRows,
    focusEvidence,
    preflight: preflightText,
    liveLines,
    overlayInCommand,
    pttRefusal,
    wakeRefusal,
    detail: detailText,
    globalAsk: askText,
    meetingPosts: meetingPostsAfterDiscard,
    deletedTestMeeting: true,
    discardCreatedMeeting: false,
    finalRows: await page.locator('.callrow').count(),
  };
  process.stdout.write(JSON.stringify(evidence) + '\n');
} catch (error) {
  if (page) {
    try {
      const cancelDisclosure = page.locator('.zv-cancel');
      if (await cancelDisclosure.isVisible()) await cancelDisclosure.click({ force: true });
    } catch {}
    try {
      const discard = page.getByRole('button', { name: 'Discard', exact: true });
      if (await discard.isVisible()) await discard.click({ force: true });
    } catch {}
    try {
      const stopWake = page.locator('.zv-live-stop');
      if (await stopWake.isVisible()) await stopWake.click({ force: true });
    } catch {}
    if (created) {
      try { await deleteByTitle(page, savedTitle); } catch {}
    }
  }
  throw error;
} finally {
  await browser.close();
}
