/*
 * WORK and DEVICES — the two screens whose whole value is saying a true thing
 * about something that lives outside the window.
 *
 * Work is the product's trigger: "a work item I own has arrived". The daemon
 * composes a local backlog on disk with a remote feed that is usually not
 * configured, and the one rule that makes the screen worth reading is that a
 * source nobody configured must NEVER render as a source with nothing to say.
 * So this flow writes a real item through POST /work, proves the DAEMON's state
 * changed (not just that a response echoed back), and then proves the window
 * shows that item and names the unasked source honestly.
 *
 * Devices is the opposite problem: the honest answer is "you have no second
 * device", and the artifact ships a screen that looks like you do — a Phone
 * card with mock copy about a code "scanned there", a `#pair-sheet` whose
 * mock countdown and random 6 digits come from ui.js's startPair(), and a rail
 * badge of 1. Every assertion here therefore ties the DOM back to a value the
 * daemon actually reported: the real deviceId, the real pairing code, the real
 * phoneClient.built === false.
 *
 * Pairing cannot be COMPLETED here and this flow never pretends otherwise.
 * There is no second device and the phone client does not exist, so the last
 * thing this flow does is throw Blocked with that prerequisite — the half it
 * could execute is asserted, the half it could not is reported as blocked.
 *
 * Route note (checked against packages/daemon/src/server.ts): there is no
 * `GET /mesh/pairing` — the daemon answers 404 for it. Pairing state is served
 * WITH the device list on `GET /mesh/devices` (`pairing: null | {…}`), and
 * that is what both the binder and this flow read. Nothing here invents an
 * endpoint that does not exist.
 */

export const id = 'work-devices';
export const title = 'Work shows the real backlog and names unasked sources; Devices shows the real mesh';
export const criteria = [
  'work: POST /work stores, GET /work lists',
  'work: an unconfigured source is never rendered as "nothing to do"',
  'devices: the screen shows the real device and pairing state',
  'devices: pairing cannot be completed without a second device (BLOCKED)',
];

const WORK_TITLE = 'E2E: rotate the staging credential';

/** Reload and wait for the binders to settle, the way openWindow does. */
async function reload(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zenoBind !== undefined, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export async function run({ daemon, page, ok, network, Blocked }) {
  /* ==================================================================
   * WORK — the backlog is real, and the sources report is honest
   * ================================================================== */

  const clean = await daemon.api('/work');
  ok.eq('GET /work answers', clean.status, 200);
  ok.eq('the backlog starts empty', clean.body.items.length, 0);

  const sourceOf = (body, name) => (body.sources || []).find((s) => String(s.name).startsWith(name)) || null;
  const localClean = sourceOf(clean.body, 'local');
  const ghClean = sourceOf(clean.body, 'github');
  ok('the local backlog is reported as a source that answered', localClean && localClean.state === 'ok',
    JSON.stringify(clean.body.sources));
  ok('a source nobody configured is reported as not-configured, not as an empty answer',
    ghClean && ghClean.state === 'not-configured' && ghClean.count === null,
    JSON.stringify(ghClean));

  // --- a write lands in the daemon's state, not just in the response
  const added = await daemon.api('/work', {
    method: 'POST',
    body: JSON.stringify({ title: WORK_TITLE, body: 'The staging token is older than the rotation window.', labels: ['e2e', 'chore'] }),
  });
  ok.eq('POST /work accepts a backlog item', added.status, 200);
  ok.eq('and answers with the stored item', added.body.item.title, WORK_TITLE);

  const listed = await daemon.api('/work');
  ok.eq('GET /work lists exactly what was added', listed.body.items.length, 1);
  ok.eq('and it is the same item, by id', listed.body.items[0].id, added.body.item.id);
  ok.eq('stored against the local source', listed.body.items[0].source, 'local');
  ok('the labels survived the round trip', JSON.stringify(listed.body.items[0].labels) === JSON.stringify(['e2e', 'chore']),
    JSON.stringify(listed.body.items[0].labels));

  // --- a refused write must refuse for real: no blank item may exist afterwards
  const blank = await daemon.api('/work', { method: 'POST', body: JSON.stringify({ title: '   ' }) });
  ok.eq('a blank title is refused', blank.status, 400);
  const afterBlank = await daemon.api('/work');
  ok.eq('and the refusal stored nothing', afterBlank.body.items.length, 1);

  /* ---- the WINDOW, showing the same backlog ---------------------------- */

  await reload(page);
  await page.click('.rail .nav-i[data-screen="work"]');
  await page.waitForTimeout(600);

  ok('the renderer actually asked the daemon for the backlog', network.includes('GET /work'),
    JSON.stringify([...new Set(network)].slice(0, 40)));

  const rows = await page.$$eval('#work-list .lrow', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const listText = flat(await page.$eval('#work-list', (e) => e.textContent));

  ok('the real backlog item is on screen', listText.includes(WORK_TITLE), listText.slice(0, 300));
  ok('and it is drawn with its real id', rows.some((t) => t.includes(added.body.item.id)),
    JSON.stringify(rows.slice(0, 6)));

  // The artifact ships a hardcoded ticket. If it is still here, the screen is
  // showing sample data as if it were the owner's work.
  ok('no artifact fixture survives on the Work screen',
    !/INGEST-12|Rotate the ingest token before Friday/.test(listText), listText.slice(0, 300));

  // The rule this screen exists for.
  const ghRow = rows.find((t) => /github/i.test(t));
  ok('the unasked source is named on screen', !!ghRow, JSON.stringify(rows.slice(0, 8)));
  ok('and the screen says it was never asked, rather than showing it as answered',
    !!ghRow && /not configured/i.test(ghRow) && /never asked/i.test(ghRow), String(ghRow));
  ok('an unconfigured source is never rendered as "nothing to do"',
    !!ghRow && !/\b0 items?\b/i.test(ghRow) && !/nothing to do/i.test(ghRow), String(ghRow));

  const railWork = await page.evaluate(() =>
    document.querySelector('.rail .nav-i[data-screen="work"] .ct')?.textContent || '');
  ok.eq('the rail count is the real backlog size, not the artifact’s 5', railWork, '1');

  /* ==================================================================
   * DEVICES — the real mesh, and an honest account of what is missing
   * ================================================================== */

  const mesh = await daemon.api('/mesh/devices');
  ok.eq('GET /mesh/devices answers', mesh.status, 200);
  ok('this machine has a real mesh identity',
    typeof mesh.body.thisDevice?.deviceId === 'string' && /^[0-9a-f]{8,}$/.test(mesh.body.thisDevice.deviceId),
    JSON.stringify(mesh.body.thisDevice));
  ok.eq('no device is paired', mesh.body.paired.length, 0);
  ok('pairing state is served with the device list', Object.prototype.hasOwnProperty.call(mesh.body, 'pairing'),
    JSON.stringify(Object.keys(mesh.body)));
  ok.eq('nothing is pairing yet', mesh.body.pairing, null);
  ok.eq('the daemon states that no phone client exists to pair with', mesh.body.phoneClient.built, false);

  await page.click('.rail .nav-i[data-screen="devices"]');
  await page.waitForTimeout(600);
  ok('the renderer read the real device list', network.includes('GET /mesh/devices'),
    JSON.stringify([...new Set(network)].slice(0, 40)));

  const cards = await page.$$eval('section.screen[data-screen="devices"] .live-cards .lcard',
    (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok.eq('the screen draws this device and the absent one', cards.length, 2);

  const pcCard = cards[0] || '';
  const phoneCard = cards[1] || '';
  ok('the This PC card shows the device id the daemon reported',
    pcCard.includes(mesh.body.thisDevice.deviceId.slice(0, 8)), pcCard.slice(0, 220));
  ok('and it is the live daemon host, not the artifact’s 127.0.0.1:7317',
    pcCard.includes(String(daemon.port)) && !pcCard.includes('7317'), pcCard.slice(0, 220));

  ok('the Phone card says, plainly, that nothing is paired',
    /not paired yet/i.test(phoneCard), phoneCard.slice(0, 260));
  ok('and gives the real reason — there is no phone client to answer',
    /phone client is not built/i.test(phoneCard), phoneCard.slice(0, 260));
  ok('no invented peer is shown as paired', !/\bpaired\b(?!\s*yet)/i.test(phoneCard), phoneCard.slice(0, 260));
  ok('the artifact’s mock pairing copy is gone from the card',
    !/scanned there|short-lived code/i.test(phoneCard), phoneCard.slice(0, 260));

  /* ---- starting a pairing is a REAL effect, with the REAL code ---------- */

  const beforePair = [...network].length;
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('section.screen[data-screen="devices"] .lcard button')]
      .find((b) => /^pair/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });

  const pairing = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const r = await daemon.api('/mesh/devices');
      if (r.body && r.body.pairing) return r.body.pairing;
      await page.waitForTimeout(250);
    }
    return null;
  })();

  ok('clicking Pair opened a pairing in the DAEMON, not just in the window', !!pairing,
    'GET /mesh/devices still reports pairing: null 10s after the click');
  ok('the renderer posted the pairing itself', network.slice(beforePair).includes('POST /mesh/pairing'),
    JSON.stringify(network.slice(beforePair)));

  if (pairing) {
    ok('the pairing carries a real 6-digit code', /^[0-9]{6}$/.test(String(pairing.code)), String(pairing.code));
    ok('and a real invite naming this device', pairing.invite?.deviceId === mesh.body.thisDevice.deviceId,
      JSON.stringify(pairing.invite));
    ok('the daemon states the pairing cannot be completed', pairing.completable === false, JSON.stringify(pairing.completable));

    await page.waitForFunction(
      (code) => {
        const el = document.getElementById('pair-code');
        return !!el && el.textContent.replace(/\D/g, '') === code;
      },
      String(pairing.code),
      { timeout: 10_000 },
    ).catch(() => {});

    const shown = await page.evaluate(() => document.getElementById('pair-code')?.textContent || '');
    ok('the sheet shows the daemon’s code, not ui.js’s random mock one',
      shown.replace(/\D/g, '') === String(pairing.code), `sheet shows "${shown}", daemon minted ${pairing.code}`);

    const sheet = flat(await page.$eval('#pair-sheet', (e) => e.textContent));
    ok('the sheet does not run a mock expiry countdown — the real pairing has no expiry',
      !/expires in/i.test(sheet), sheet.slice(0, 300));
    ok('the sheet states that nothing can answer this invite',
      /not built|no second device|nothing can answer/i.test(sheet), sheet.slice(0, 400));
    // The steps and subtitle are the first thing an owner reads. A screen that
    // says "no phone client exists" in a footnote while instructing "open Zeno
    // on the phone → scan this" above it has told the owner both stories.
    ok('and it does not instruct an impossible phone flow as if it worked',
      !/Open Zeno on the phone|Phone scans or types the code|becomes an owner device/i.test(sheet),
      sheet.slice(0, 400));
  }

  /* ---- and cancelling it is a real effect too --------------------------- */

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('section.screen[data-screen="devices"] .lcard button')]
      .find((b) => /cancel pairing/i.test(b.textContent.trim()));
    if (btn) btn.click();
  });
  const cancelled = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const r = await daemon.api('/mesh/devices');
      if (r.body && r.body.pairing === null) return true;
      await page.waitForTimeout(250);
    }
    return false;
  })();
  ok('cancelling from the window closes the pairing in the daemon', cancelled,
    'GET /mesh/devices still reports an open pairing 10s after Cancel');
  const afterCancel = await daemon.api('/mesh/devices');
  ok.eq('a cancelled pairing pairs nothing', afterCancel.body.paired.length, 0);

  /* ==================================================================
   * The half that cannot be executed here. It is not a pass.
   * ================================================================== */
  throw new Blocked(
    'a second device running a Zeno client: pairing can be STARTED and cancelled here (both asserted above), ' +
    'but it cannot be COMPLETED — GET /mesh/devices reports phoneClient.built === false and the open pairing ' +
    'reports completable === false, so there is nothing on the other end to accept the invite, confirm the ' +
    'verification code, or enter the trust store. Unblocked by: a built Zeno phone/second-desktop client ' +
    'reachable from this machine.',
  );
}
