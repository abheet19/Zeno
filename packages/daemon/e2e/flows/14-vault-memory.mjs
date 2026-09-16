/*
 * The Vault — the one screen whose whole job is to be TRUE.
 *
 * Memory is the most dangerous surface in this product. Everything else Zeno
 * does is scoped to a run; a memory note outlives the run and steers every run
 * after it. So three claims have to hold at once, and this flow refuses to let
 * any of them be taken on faith:
 *
 *   1. WHAT IS ON SCREEN IS WHAT IS ON DISK. The window was rebuilt on a design
 *      artifact whose Vault ships three convincing sample notes ("Release gate…",
 *      "QuillBot: 54 silent-failure cases…", "Say ~3.5 years experience…") and a
 *      rail badge reading 12. A Vault that renders fiction is worse than no Vault,
 *      because the owner reads it as their own record. Every assertion below
 *      compares the screen against a daemon that was just asked.
 *
 *   2. THE OWNER WRITES; AN AGENT ASKS. POST /memory is ungated for the owner by
 *      design — the owner IS the approval authority, so asking them to authorise
 *      themselves is theatre. An AGENT gets the kernel: preview, held, owner
 *      approval, one commit, a receipt. Both halves are exercised here, including
 *      the refusals, because "ungated for the owner" is only safe if it is
 *      genuinely closed to everyone else.
 *
 *   3. A SECRET NEVER REACHES THE DISK. The sanitizer runs BEFORE storage, not
 *      before display. So the test is not "the UI hides it" — it is that the raw
 *      credential is absent from the stored note, from the held preview, and from
 *      the whole of /state.
 */

export const id = 'vault-memory';
export const title = 'The Vault shows real memory: owner writes, agents propose, secrets are redacted';
export const criteria = ['SUITE-AC-02', 'vault: real notes', 'vault: recall', 'sanitizer: redacted before storage'];

/* Credential-shaped, and deliberately not random: a flow that generated its own
   secret could pass because the generator drifted below a detector's floor. These
   are the exact shapes patterns.ts names (`github-token`, `llm-api-key`). */
const AGENT_SECRET = 'ghp_zN4hQ2vB8mK6tR0wX3yL1pD7sG5aJ9cF2eU4';
const OWNER_SECRET = 'sk-ant-api03Q7wE2rT9yU4iO1pA6sD3f';

/** The artifact's hardcoded Vault rows. If any survives, the screen is fiction. */
const FIXTURES = ['Release gate', 'QuillBot: 54 silent-failure', '3.5 years'];

const vaultRows = (page) => page.$$eval('.screen[data-screen="vault"] [data-vault-notes] .lrow', (els) =>
  els.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));

const railVault = (page) => page.evaluate(() =>
  document.querySelector('.rail .nav-i[data-screen="vault"] .ct')?.textContent ?? '(no badge)');

/* Every place in the document that claims a Vault count — the rail, the mobile
   tab bar, and the mobile "More" sheet. A narrow window is still this window;
   a fixture that is only wrong below 900px is still a fixture. */
const everyVaultCount = (page) => page.$$eval(
  '.rail .nav-i[data-screen="vault"] .ct, .mtabs [data-screen="vault"] .mbadge, #msheet .nav-i[data-mscreen="vault"] .ct',
  (els) => els.map((e) => e.textContent.trim()));

export async function run({ daemon, page, ok }) {
  /* Full URLs, which the harness's own recorder cannot give us: it keys on
     pathname, so /memory and /memory?q=… are the same string there, and the
     search box's real call would be indistinguishable from the boot read. */
  const calls = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.port === String(daemon.port)) calls.push(u.pathname + u.search); });

  // ---------------------------------------------------------------- baseline
  const empty = await daemon.api('/memory');
  ok.eq('the vault starts empty', empty.body.notes.length, 0);

  await page.click('.nav-i[data-screen="vault"]');
  // The Vault fetch is asynchronous. Wait for its real empty-state rendering
  // instead of assuming a fixed timeout is enough on a busy local machine.
  await page.waitForFunction(
    () => /empty/i.test(document.querySelector('.screen[data-screen="vault"] [data-vault-notes]')?.textContent || ''),
    { timeout: 15_000 },
  );

  const atBoot = await vaultRows(page);
  ok('no artifact sample note survives on the Vault screen',
    !FIXTURES.some((f) => atBoot.some((r) => r.includes(f))), JSON.stringify(atBoot));
  const emptyState = await page.$eval('.screen[data-screen="vault"] [data-vault-notes]', (el) => el.textContent);
  ok('an empty vault says so, rather than showing something', /empty/i.test(emptyState), emptyState.slice(0, 160));
  ok.eq('the rail does not claim the artifact\'s 12 notes', await railVault(page), '');
  const counts = await everyVaultCount(page);
  ok('no surface anywhere in the window claims a note count of its own',
    counts.length > 0 && counts.every((c) => c === ''), JSON.stringify(counts));

  // ------------------------------------------------- the owner's own write
  // Ungated for the owner is only defensible if it is shut to everyone else.
  const agentWrite = await daemon.agent('/memory', {
    method: 'POST',
    body: JSON.stringify({ title: 'Written by an agent', body: 'This must never be written without approval.' }),
  });
  ok.eq('an agent cannot write memory directly', agentWrite.status, 403);
  ok.eq('and is told to propose instead', agentWrite.body.error.code, 'owner-only');
  ok.eq('the refused write left nothing behind', (await daemon.api('/memory')).body.notes.length, 0);

  const written = await daemon.api('/memory', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'preference',
      title: 'The zeppelin release checklist',
      body: 'Before a zeppelin release: verify the ledger, then tag.',
      tags: ['release'],
    }),
  });
  ok.eq('the owner can write a note directly', written.status, 200);
  const listed = await daemon.api('/memory');
  ok.eq('the note is on disk', listed.body.notes.length, 1);
  ok.eq('with the title the owner gave it', listed.body.notes[0].title, 'The zeppelin release checklist');
  const noteId = listed.body.notes[0].id;

  // No reload, no navigation: the window is supposed to be live.
  const ownerShown = await page.waitForFunction(
    () => [...document.querySelectorAll('.screen[data-screen="vault"] [data-vault-notes] .lrow')]
      .some((r) => /zeppelin release checklist/i.test(r.textContent)),
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('the owner\'s note appears in the window without a reload', ownerShown, JSON.stringify(await vaultRows(page)));
  // The rail is shared chrome, refreshed after the screen binders rather than
  // with them, so it is waited for rather than read in the same tick.
  const railCounted = await page.waitForFunction(
    () => (document.querySelector('.rail .nav-i[data-screen="vault"] .ct')?.textContent ?? '') === '1',
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);
  ok('the rail counts the real note', railCounted, `rail shows "${await railVault(page)}"`);
  const counted = await everyVaultCount(page);
  ok('and every other note count in the window agrees with it',
    counted.every((c) => c === '1'), JSON.stringify(counted));

  // ------------------------------------------------------------------ recall
  const hit = await daemon.api('/memory/recall?q=zeppelin');
  ok.eq('recall answers', hit.status, 200);
  ok.eq('recall finds the note', hit.body.hits.length, 1);
  ok.eq('and it is the right one', hit.body.hits[0].entry.description, 'The zeppelin release checklist');
  ok('recall cites what matched', Array.isArray(hit.body.hits[0].matched) && hit.body.hits[0].matched.includes('zeppelin'),
    JSON.stringify(hit.body.hits[0].matched));
  // A recall that returns everything is not recall.
  const miss = await daemon.api('/memory/recall?q=bathysphere');
  ok.eq('a word that is not there recalls nothing', miss.body.hits.length, 0);

  // The window's own search box, running the daemon's scorer — the score and the
  // matched terms in the row are values only the daemon can compute.
  const before = calls.length;
  await page.fill('.screen[data-screen="vault"] .sbar input', 'zeppelin');
  await page.$eval('.screen[data-screen="vault"] .sbar input', (el) => el.dispatchEvent(new Event('input', { bubbles: true })));
  await page.waitForTimeout(1500);
  ok('typing in the Vault search asks the daemon',
    calls.slice(before).some((c) => c.startsWith('/memory?q=')), JSON.stringify(calls.slice(before)));
  const results = await vaultRows(page);
  ok('the recalled note is rendered with the daemon\'s own match evidence',
    results.some((r) => /zeppelin/i.test(r) && /matched:/.test(r)), JSON.stringify(results));

  await page.fill('.screen[data-screen="vault"] .sbar input', '');
  await page.$eval('.screen[data-screen="vault"] .sbar input', (el) => el.dispatchEvent(new Event('input', { bubbles: true })));
  await page.waitForTimeout(600);

  // ------------------------------------------------------------------ delete
  const agentDelete = await daemon.agent(`/memory/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  ok.eq('an agent cannot delete the owner\'s memory', agentDelete.status, 403);
  ok.eq('the note is still there', (await daemon.api('/memory')).body.notes.length, 1);

  const forgot = await daemon.api(`/memory/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  ok.eq('the owner can forget a note', forgot.body.forgotten, true);
  ok.eq('and it is gone from the vault', (await daemon.api('/memory')).body.notes.length, 0);
  const goneFromScreen = await page.waitForFunction(
    () => [...document.querySelectorAll('.screen[data-screen="vault"] [data-vault-notes] .lrow')]
      .every((r) => !/zeppelin release checklist/i.test(r.textContent)),
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('a deleted note leaves the window too', goneFromScreen, JSON.stringify(await vaultRows(page)));

  // --------------------------------------------- an AGENT asks to remember
  const proposed = await daemon.agent('/memory/propose', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'fact',
      description: 'Deploy key for the release runner',
      body: `The release runner authenticates with ${AGENT_SECRET} — keep it handy.`,
      requestedBy: 'agent:e2e',
    }),
  });
  ok.eq('an agent may ask to remember something', proposed.status, 200);
  ok('the memory write is HELD, not applied', proposed.body.pending === true, JSON.stringify(proposed.body).slice(0, 200));
  ok.eq('a memory write is rated T1', proposed.body.preview.tier, 'T1');
  ok.eq('nothing is written while it waits', (await daemon.api('/memory')).body.notes.length, 0);

  const state = await daemon.api('/state');
  ok.eq('the held memory write is in the owner\'s queue', state.body.pending.length, 1);
  ok.eq('and is named as a memory write', state.body.pending[0].kind, 'memory.write');

  // It has to be actionable on the Approvals screen, not just present in JSON.
  await page.click('.nav-i[data-screen="approvals"]');
  await page.waitForTimeout(1200);
  const cards = await page.$$eval('.screen[data-screen="approvals"] .caps', (els) => els.map((c) => ({
    text: c.textContent.replace(/\s+/g, ' ').slice(0, 120),
    buttons: [...c.querySelectorAll('.caps-acts button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
  })));
  ok.eq('the proposed memory is on the Approvals screen', cards.length, 1);
  ok('with a live Allow and a live Deny',
    cards[0].buttons.length >= 2 && cards[0].buttons.every((b) => !b.disabled), JSON.stringify(cards[0].buttons));
  ok('the secret is not shown on the approval card', !cards[0].text.includes(AGENT_SECRET), cards[0].text);

  // ------------------------------------- the owner approves, from the window
  await page.evaluate(() => {
    document.querySelector('.screen[data-screen="approvals"] .caps .caps-acts button.p').click();
  });
  await page.waitForTimeout(2500);

  const sealed = await daemon.api('/state');
  const stored = await daemon.api('/memory');
  ok.eq('approval applies exactly one memory write', stored.body.notes.length, 1);
  ok.eq('the queue is empty again', sealed.body.pending.length, 0);
  ok.eq('approval seals exactly one receipt', sealed.body.receipts.length, 1);
  ok('the receipt chain verifies', sealed.body.chain.ok === true, JSON.stringify(sealed.body.chain));

  // ------------------------------------------------------------- redaction
  const body = stored.body.notes[0].body;
  ok('the stored note does NOT contain the credential', !body.includes(AGENT_SECRET), body.slice(0, 200));
  ok('it carries the sanitizer\'s placeholder instead', /\[REDACTED:github-token:[0-9a-f]+\]/.test(body), body.slice(0, 200));
  ok('the note is otherwise intact', /release runner authenticates/i.test(body), body.slice(0, 200));
  ok('the credential is nowhere in /state — not in the preview, not in the receipt',
    !JSON.stringify(sealed.body).includes(AGENT_SECRET), 'the raw token appears in /state');

  // The owner's own ungated write is sanitized on the same path — an owner can
  // paste a key into their own note as easily as an agent can propose one.
  const ownerSecretNote = await daemon.api('/memory', {
    method: 'POST',
    body: JSON.stringify({ kind: 'fact', title: 'Model access', body: `The key is ${OWNER_SECRET} for now.` }),
  });
  ok.eq('the owner\'s own note is accepted', ownerSecretNote.status, 200);
  const all = await daemon.api('/memory');
  const ownerBody = all.body.notes.find((n) => n.title === 'Model access').body;
  ok('the owner\'s own write is redacted before storage too', !ownerBody.includes(OWNER_SECRET), ownerBody.slice(0, 200));
  ok('with the placeholder naming the rule that caught it', /\[REDACTED:llm-api-key:[0-9a-f]+\]/.test(ownerBody), ownerBody.slice(0, 200));

  /* live.js re-runs a binder on every event and says in its own comment that
     re-running one is idempotent. By now this window has sat through half a dozen
     of them, so if that is not true the Vault is visibly wrong — the same card
     stacked over and over. This is the cheapest place in the suite to catch it. */
  await page.click('.nav-i[data-screen="vault"]');
  await page.waitForTimeout(1200);
  const briefCards = await page.$$eval('.screen[data-screen="vault"] .pbody .card',
    (els) => els.filter((c) => /today.s brief/i.test(c.textContent)).length);
  ok.eq('the Vault keeps exactly one brief card through live updates', briefCards, 1);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.screen[data-screen="vault"] [data-vault-notes] .lrow')]
      .filter((r) => /Model access/.test(r.textContent)).length === 1,
    { timeout: 15_000 },
  ).catch(() => {});
  const finalRows = await vaultRows(page);
  ok.eq('and lists each stored note exactly once', finalRows.filter((r) => /Model access/.test(r)).length, 1);

  // ------------------------------------------------------------- local import
  // The UI must not leave a persuasive but dead Claude/Codex import card. Use
  // Playwright's in-memory file fixture: it proves the browser only submits
  // structured local content, without reading a real export or user memory.
  await page.click('[data-import]');
  const importInput = page.locator('#import-card input[type="file"]');
  await importInput.setInputFiles({
    name: 'local-memory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ notes: [
      { title: 'Imported preference', body: 'Keep verification evidence close to the change.', tags: ['release'], kind: 'preference' },
      { title: 'Imported secret check', body: `Never retain this token: ${AGENT_SECRET}`, kind: 'fact' },
    ] }), 'utf8'),
  });
  const importCard = page.locator('#import-card');
  await importCard.getByText('2 local notes ready.', { exact: false }).waitFor({ timeout: 10_000 });
  ok('the Vault previews a local structured import before writing it',
    await importCard.locator('.lrow').count() === 2, await importCard.innerText());
  await importCard.getByRole('button', { name: 'Import locally' }).click();
  await importCard.getByText('Imported 2; skipped 0; redacted 1.', { exact: false }).waitFor({ timeout: 15_000 });
  const afterImport = await daemon.api('/memory');
  ok.eq('the owner selected import writes both valid local notes', afterImport.body.notes.length, 4);
  const importedSecret = afterImport.body.notes.find((n) => n.title === 'Imported secret check');
  ok('imported memory is sanitized before storage too', importedSecret
    && !importedSecret.body.includes(AGENT_SECRET)
    && /\[REDACTED:github-token:[0-9a-f]+\]/.test(importedSecret.body), importedSecret && importedSecret.body);
  const importedShown = await page.waitForFunction(
    () => [...document.querySelectorAll('.screen[data-screen="vault"] [data-vault-notes] .lrow')]
      .some((r) => /Imported preference/.test(r.textContent)),
    { timeout: 15_000 },
  ).then(() => true).catch(() => false);
  ok('the imported note appears in the live Vault without a reload', importedShown, JSON.stringify(await vaultRows(page)));
}
