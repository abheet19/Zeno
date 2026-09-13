/*
 * The call banner: "counsel should show some banner when any video or any
 * call is triggered — click to take notes — it should auto open."
 *
 * Ordered by what would be worst if it were false:
 *
 *   1. the banner must never claim a call in a window that cannot see one. A
 *      headless browser has no desktop bridge (window.zenoMeeting), so here
 *      the banner must be absent and the daemon must hold no sighting.
 *   2. "Take notes" must ROUTE, not RECORD. It lands on Counsel's consent card
 *      with both boxes unticked, no microphone claimed, and nothing posted to
 *      the archive — the banner is a shortcut to the consent step, never past it.
 *   3. Dismiss is per call: the same sighting stays hidden, a different one
 *      shows again, and a report of "no window" clears it.
 *   4. while Counsel is recording, the banner stays down.
 *
 * The desktop's window-title discovery cannot run in headless Chromium, so the
 * sighting is driven through the seam the desktop window itself uses: the
 * owner POSTs to /calls/detected and the daemon nudges the page over /stream.
 * That exercises everything from the daemon's record to the banner's buttons;
 * only the Electron title enumeration is outside what this flow can execute.
 */

export const id = 'call-banner';
export const title = 'A detected call raises a banner that routes to Counsel’s consent step and never records';
export const criteria = [
  'call-banner: no signal, no banner',
  'call-banner: take notes lands on consent, not capture',
  'call-banner: dismiss is per call',
  'call-banner: silent while recording',
];

const CN = '.product[data-product="counsel"]';

export async function run({ daemon, page, ok, network, Blocked }) {
  /* The banner floats (position:fixed), and a fixed element's offsetParent is
     null even when it is on screen — so visibility is read from computed style
     and a real box, not from the offsetParent shortcut other flows use. */
  const banner = () => page.evaluate(() => {
    const b = document.getElementById('call-banner');
    if (!b) return { exists: false };
    return {
      exists: true,
      visible: !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0,
      text: b.innerText.replace(/\s+/g, ' ').trim(),
      compact: b.classList.contains('compact'),
      notesDisabled: !!document.getElementById('call-banner-notes')?.disabled,
      notesTitle: document.getElementById('call-banner-notes')?.title || '',
    };
  });
  const waitBanner = (visible, timeout = 8_000) => page.waitForFunction((want) => {
    const b = document.getElementById('call-banner');
    return !!b && (!b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0) === want;
  }, visible, { timeout }).then(() => true).catch(() => false);
  const report = (candidates) => daemon.api('/calls/detected', { method: 'POST', body: JSON.stringify({ candidates }) });

  /* ---------------------------------------------------------------- *
   * 1 · no signal, no banner                                          *
   * ---------------------------------------------------------------- */
  const bridge = await page.evaluate(() => typeof window.zenoMeeting);
  ok.eq('this window has no desktop meeting bridge (headless Chromium)', bridge, 'undefined');
  const b0 = await banner();
  ok('the banner element is in the shell', b0.exists);
  ok('with no signal the banner is absent', b0.exists && !b0.visible, JSON.stringify(b0));
  const c0 = await daemon.api('/calls/current');
  ok.eq('the daemon serves call presence to the owner', c0.status, 200);
  ok.eq('and holds no sighting', c0.body.call, null);
  ok.eq('and states what a sighting would be based on', c0.body.basis, 'capturable-window-title');
  ok.eq('nothing on this page reported a call', network.filter((n) => n === 'POST /calls/detected').length, 0);

  const agent = await daemon.agent('/calls/detected', { method: 'POST', body: JSON.stringify({ candidates: [{ app: 'Zoom', title: 'Zoom Meeting' }] }) });
  ok.eq('an agent cannot report a call', agent.status, 403, JSON.stringify(agent.body));
  const bad = await report('nope');
  ok.eq('a malformed report is refused', bad.status, 400);

  /* ---------------------------------------------------------------- *
   * 2 · a sighting raises the banner, with the app and the title      *
   * ---------------------------------------------------------------- */
  const zoom = await report([{ app: 'Zoom', title: 'Zoom Meeting | Weekly sync' }]);
  ok.eq('the owner’s report is accepted', zoom.status, 200, JSON.stringify(zoom.body));
  ok.eq('and it is now the current sighting', zoom.body.call && zoom.body.call.app, 'Zoom');
  ok('the banner appears without a reload', await waitBanner(true), 'no banner within 8s of the sighting');
  const b1 = await banner();
  ok('it says a call looks live', /call looks live/i.test(b1.text), b1.text);
  ok('it names the app and the window', b1.text.includes('Zoom: Zoom Meeting | Weekly sync'), b1.text);
  ok('it offers notes with Counsel', /take notes/i.test(b1.text), b1.text);
  ok('it is the full-size banner outside Counsel', !b1.compact);

  /* ---------------------------------------------------------------- *
   * 3 · Take notes lands on consent — and nothing else                *
   * ---------------------------------------------------------------- */
  const counselState = () => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return {
      surface: document.documentElement.getAttribute('data-zeno-surface'),
      view: [...root.querySelectorAll('.cnview.on')].map((v) => v.dataset.cnview)[0] || null,
      c1: !!root.querySelector('#cn-c1')?.checked,
      c2: !!root.querySelector('#cn-c2')?.checked,
      startDisabled: !!root.querySelector('#cn-start')?.disabled,
      capture: document.body.dataset.zenoCapture || '',
    };
  }, CN);

  if (b1.notesDisabled) {
    throw new Blocked(
      `Counsel's Record button is disabled in this window ("${b1.notesTitle}"), so Take notes is honestly disabled ` +
      'too and the routing step cannot be executed here. It needs a window with a speech engine (the desktop app).');
  }
  const before = network.length;
  await page.click('#call-banner-notes');
  await page.waitForTimeout(600);
  const s1 = await counselState();
  ok.eq('Take notes switches to Counsel', s1.surface, 'counsel');
  ok.eq('and opens the consent card', s1.view, 'preflight');
  ok('with nothing consented to', !s1.c1 && !s1.c2);
  ok('and Start still held closed', s1.startDisabled);
  ok.eq('no microphone was claimed', s1.capture, '');
  const posted = network.slice(before).filter((n) => n.startsWith('POST /counsel'));
  ok.eq('and nothing was sent to Counsel’s routes', posted.length, 0, JSON.stringify(posted));
  const archive = await daemon.api('/counsel/meetings');
  ok.eq('and no meeting was created', archive.body.meetings.length, 0);
  const b2 = await banner();
  ok('inside Counsel the banner stays, smaller', b2.visible && b2.compact, JSON.stringify(b2));

  /* ---------------------------------------------------------------- *
   * 4 · Dismiss is per call                                           *
   * ---------------------------------------------------------------- */
  await page.click('#call-banner-dismiss');
  await page.waitForTimeout(200);
  const b3 = await banner();
  ok('Dismiss hides the banner', !b3.visible);
  const same = await report([{ app: 'Zoom', title: 'Zoom Meeting | Weekly sync' }]);
  ok.eq('re-reporting the same window is not a change', same.body.changed, false);
  await page.waitForTimeout(700);
  ok('and does not bring the banner back', !(await banner()).visible);

  const meet = await report([{ app: 'Google Meet', title: 'Standup – Google Meet' }]);
  ok.eq('a different window is a change', meet.body.changed, true);
  ok('a second, distinct call re-shows the banner', await waitBanner(true), 'still hidden 8s after a new sighting');
  const b4 = await banner();
  ok('and it names the new call', b4.text.includes('Google Meet: Standup – Google Meet'), b4.text);

  const none = await report([]);
  ok.eq('"no meeting window" clears the sighting', none.body.call, null);
  ok('and takes the banner down', await waitBanner(false), 'still shown 8s after the window went away');

  /* ---------------------------------------------------------------- *
   * 5 · silent while Counsel is recording                             *
   *                                                                   *
   * body.dataset.zenoCapture === 'counsel' is the flag Counsel sets   *
   * the instant it takes the microphone (see 13-counsel.mjs). Setting *
   * it by hand here simulates only the FLAG — no audio is captured.   *
   * ---------------------------------------------------------------- */
  await page.evaluate(() => { document.body.dataset.zenoCapture = 'counsel'; });
  await report([{ app: 'Microsoft Teams', title: 'Design review | Microsoft Teams' }]);
  await page.waitForTimeout(1200);
  ok('a sighting during a recording raises no banner', !(await banner()).visible);
  await page.evaluate(() => { delete document.body.dataset.zenoCapture; });
  ok('releasing the microphone lets the pending sighting show', await waitBanner(true), 'still hidden after capture ended');
  await report([]);
  await waitBanner(false);
}
