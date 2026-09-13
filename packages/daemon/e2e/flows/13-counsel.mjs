/*
 * Counsel is the one surface in Zeno that listens to a room full of people who
 * are not the owner. Everything else in this product governs what an agent may
 * DO; Counsel governs what Zeno may HEAR. So the assertions below are ordered
 * by what would be worst if it were false:
 *
 *   1. recording cannot begin without explicit consent — and not merely because
 *      a button was disabled. A disabled button is a hint, not a boundary; any
 *      owner with devtools (or any script on the page) can clear `.disabled`.
 *      The boundary has to live in the code path that starts capture, so this
 *      flow re-enables Start from the page and clicks it anyway.
 *   2. Counsel does not answer questions while it is recording. That is the
 *      product's whole promise — "it takes the notes, it does not feed you
 *      lines mid-conversation". Same rule: the composer must be visibly off AND
 *      the send path must refuse, because only one of those is a boundary.
 *   3. leaving a live call without saving must save nothing and must hand the
 *      microphone back — a call that ends but keeps `body.dataset.zenoCapture`
 *      has silently disabled Command's voice for the rest of the session.
 *   4. saving must produce a REAL meeting: POST /counsel/meetings, which GET
 *      /counsel/meetings then lists. Not a row in the sidebar.
 *
 * The running window loads packages/daemon/public/bind/counsel.js. The root
 * packages/daemon/public/counsel.js is NOT loaded by index.html (it ships only
 * /theme-boot.js, /ui.js and the /bind.js module graph), and the first two
 * checks verify that from the browser's own resource timeline rather than from
 * reading the markup — so this flow is testing the file that actually runs.
 *
 * ui.js also ships a complete MOCK of this screen: three invented meetings in
 * the sidebar, a canned live transcript, and a fake Q&A thread in the Ask tab.
 * Every assertion here is therefore about a real effect — a request on the
 * wire, the daemon's own archive, the capture flag — and several of them exist
 * specifically to catch the artifact's fixtures being mistaken for state.
 */

export const id = 'counsel';
export const title = 'Consent gates recording, questions are off while live, and a saved call is a real meeting';
export const criteria = [
  'counsel: consent-before-capture',
  'counsel: no live answer-feed',
  'counsel: discard saves nothing and releases the mic',
  'counsel: a saved call is a real meeting',
];

const CN = '.product[data-product="counsel"]';

export async function run({ daemon, page, ok, network, Blocked }) {
  /* ---------------------------------------------------------------- *
   * 0 · which code is under test                                      *
   * ---------------------------------------------------------------- */
  const fetched = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname));
  ok('the window really loads bind/counsel.js', fetched.includes('/bind/counsel.js'),
    JSON.stringify(fetched.filter((p) => p.includes('counsel'))));
  ok('the window never loads the root /counsel.js', !fetched.includes('/counsel.js'),
    'index.html would have to ship it for this to be the file under test');

  await page.click('.seg [data-product="counsel"]');
  await page.waitForTimeout(600);

  /* ---------------------------------------------------------------- *
   * 1 · the archive on screen is the daemon's, not the artifact's     *
   * ---------------------------------------------------------------- */
  const archive0 = await daemon.api('/counsel/meetings');
  ok.eq('the daemon serves the meeting archive', archive0.status, 200);
  ok.eq('a fresh workspace has no meetings', archive0.body.meetings.length, 0);

  const sidebar = await page.$eval(`${CN} #cn-list`, (l) => l.textContent.replace(/\s+/g, ' ').trim());
  ok('the sidebar shows the daemon\'s empty archive, not ui.js\'s sample meetings',
    !/Design review — Command home|Weekly sync|Forge terminal bug triage/.test(sidebar), sidebar.slice(0, 160));

  /* ---------------------------------------------------------------- *
   * 2 · consent gates the control                                     *
   * ---------------------------------------------------------------- */
  const gate = () => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const card = root.querySelector('.cnview[data-cnview="preflight"] .cncard');
    const last = card ? card.lastElementChild : null;
    return {
      view: [...root.querySelectorAll('.cnview.on')].map((v) => v.dataset.cnview)[0] || null,
      disabled: !!root.querySelector('#cn-start')?.disabled,
      why: last && last.tagName === 'P' ? last.textContent.trim() : '',
      c1: !!root.querySelector('#cn-c1')?.checked,
      c2: !!root.querySelector('#cn-c2')?.checked,
      capture: document.body.dataset.zenoCapture || '',
    };
  }, CN);

  await page.click(`${CN} #cn-record`);
  await page.waitForTimeout(400);
  const g0 = await gate();
  ok.eq('Record opens the consent card, not a recording', g0.view, 'preflight');
  ok('nothing is consented to yet', !g0.c1 && !g0.c2);
  ok('Start is held closed before consent', g0.disabled);
  ok('and it says which consent is missing', /first box/i.test(g0.why), g0.why);

  await page.click(`${CN} #cn-c1`);
  await page.waitForTimeout(200);
  const g1 = await gate();
  ok('one box is not consent — Start stays closed', g1.disabled, `why: ${g1.why}`);
  ok('and it now names the second consent', /second box/i.test(g1.why), g1.why);

  /* ---------------------------------------------------------------- *
   * 3 · THE BOUNDARY: consent is enforced in the start path itself    *
   *                                                                   *
   * A disabled attribute is advice to a mouse. Clear it the way anyone *
   * with devtools would and press the button with consent incomplete.  *
   * Capture must still not begin, and nothing may reach the daemon.    *
   * ---------------------------------------------------------------- */
  const before = network.length;
  await page.evaluate((sel) => {
    const btn = document.querySelector(`${sel} #cn-start`);
    btn.disabled = false;          // exactly what devtools would do
    btn.click();
  }, CN);
  await page.waitForTimeout(1200);

  const forced = await gate();
  ok.eq('a re-enabled Start does not open a live call without consent', forced.view, 'preflight');
  ok.eq('and it claims no microphone', forced.capture, '');
  const forcedCalls = network.slice(before).filter((n) => n.startsWith('POST /counsel'));
  ok.eq('and it sends the daemon nothing', forcedCalls.length, 0, JSON.stringify(forcedCalls));
  const forcedLines = await page.$eval(`${CN} #cn-lines`, (b) => b.textContent.replace(/\s+/g, ' ').trim());
  ok('and nothing was transcribed', !/Let's start with the terminal|Only on Windows/.test(forcedLines),
    forcedLines.slice(0, 120));

  /* ---------------------------------------------------------------- *
   * 4 · with both consents, Counsel may record                        *
   * ---------------------------------------------------------------- */
  await page.click(`${CN} #cn-c2`);
  await page.waitForTimeout(300);
  const g2 = await gate();
  ok('both boxes ticked', g2.c1 && g2.c2);

  if (g2.disabled) {
    // Distinguish "this machine cannot record" from "the product is broken".
    if (/speech engine|microphone/i.test(g2.why)) {
      throw new Blocked(
        `Counsel cannot start capture in this browser: "${g2.why}" — this flow needs a window with a working ` +
        'speech engine (the desktop app\'s local Whisper bridge, window.zenoLocalSpeech) and a real audio input ' +
        'device. Headless Chromium has neither.');
    }
    ok('with both consents given, Start opens', false, g2.why);
    return;
  }
  ok('with both consents given, Start opens', true);

  const titled = 'E2E counsel call';
  await page.fill(`${CN} #cn-title`, titled);
  await page.click(`${CN} #cn-start`);
  await page.waitForTimeout(1500);

  const live = await gate();
  ok.eq('consent starts the live call', live.view, 'live');
  ok.eq('and Counsel takes the microphone, so Command stops listening', live.capture, 'counsel');
  const startedCalls = network.filter((n) => n === 'POST /counsel/meetings');
  ok.eq('starting a call saves nothing yet', startedCalls.length, 0);

  /* The live bar is the only thing telling the room whether Zeno is listening,
     so it is not allowed to be vague. It may say it is recording, or that it is
     not — but "not recording" while the call is open and Counsel still holds
     the microphone has to come with the reason, or the owner cannot tell a
     finished capture from a broken one. */
  const bar = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const b = root.querySelector('.cnlivebar');
    return {
      label: b ? (b.querySelector('b')?.textContent || '').trim() : '',
      mic: (root.querySelector('#cn-micstate')?.textContent || '').trim(),
      note: (root.querySelector('#cn-lines')?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  }, CN);
  const claimsStopped = /stopped/i.test(bar.label) || /mic: stopped/i.test(bar.mic);
  ok('the live bar never says the microphone is stopped without saying why',
    !claimsStopped || /microphone|speech|capture/i.test(bar.note), JSON.stringify(bar).slice(0, 300));

  /* ---------------------------------------------------------------- *
   * 5 · questions are off while the room is being recorded            *
   * ---------------------------------------------------------------- */
  const askState = await page.evaluate((sel) => {
    const pane = document.querySelector(`${sel} .cnp[data-cntab="ask"]`);
    const ta = pane ? pane.querySelector('textarea') : null;
    const send = pane ? pane.querySelector('.cbtn.send') : null;
    return {
      text: pane ? pane.textContent.replace(/\s+/g, ' ').trim() : '(no ask pane)',
      hasComposer: !!(ta && send),
      taDisabled: !!(ta && ta.disabled),
      sendDisabled: !!(send && send.disabled),
    };
  }, CN);
  ok('the Ask tab has a composer to assert about', askState.hasComposer, askState.text.slice(0, 160));
  ok('the Ask tab shows no invented conversation',
    !/What did we decide about the Settings screen|Settings becomes a floating panel/.test(askState.text),
    askState.text.slice(0, 200));
  ok('the question box is off while recording', askState.taDisabled, 'the textarea is still live mid-call');
  ok('the send button is off while recording', askState.sendDisabled, 'the send button is still live mid-call');
  ok('and the composer says why', /recording/i.test(askState.text), askState.text.slice(-160));

  // Same move as the Start button: re-enable it and send anyway.
  const askBefore = network.length;
  await page.evaluate((sel) => {
    const pane = document.querySelector(`${sel} .cnp[data-cntab="ask"]`);
    const ta = pane.querySelector('textarea');
    const send = pane.querySelector('.cbtn.send');
    if (ta) { ta.disabled = false; ta.value = 'What have we decided so far?'; }
    if (send) { send.disabled = false; send.click(); }
  }, CN);
  await page.waitForTimeout(1500);
  const asked = network.slice(askBefore).filter((n) => n === 'POST /counsel/ask');
  ok.eq('a re-enabled composer still asks nothing mid-call', asked.length, 0, JSON.stringify(asked));
  const stillLive = await gate();
  ok.eq('and the call is still the only thing happening', stillLive.view, 'live');

  /* ---------------------------------------------------------------- *
   * 6 · did anything actually get transcribed?                        *
   * ---------------------------------------------------------------- */
  const heard = await page.waitForFunction(
    (sel) => document.querySelectorAll(`${sel} #cn-lines .cnl`).length > 0,
    CN, { timeout: 20_000 },
  ).then(() => true).catch(() => false);

  /* ---------------------------------------------------------------- *
   * 7 · leaving without saving: saves nothing, releases the mic       *
   * ---------------------------------------------------------------- */
  if (!heard) {
    // What the window says about its own microphone, so the BLOCKED reason
    // below names the real situation rather than guessing at it.
    const mic = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const bar = root.querySelector('.cnlivebar');
      return {
        engine: window.SpeechRecognition || window.webkitSpeechRecognition ? 'web-speech' : 'none',
        bridge: window.zenoLocalSpeech ? 'local-whisper' : 'none',
        bar: bar ? (bar.querySelector('b')?.textContent || '').trim() : '',
        pill: (root.querySelector('#cn-micstate')?.textContent || '').trim(),
        lines: (root.querySelector('#cn-lines')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      };
    }, CN);

    const endBefore = network.length;
    await page.click(`${CN} #cn-end`);
    await page.waitForTimeout(1500);
    const note1 = await page.$eval(`${CN} #cn-lines`, (b) => b.textContent.replace(/\s+/g, ' ').trim());
    ok('an empty call is not saved as if it were a meeting', /nothing to save|Nothing was transcribed/i.test(note1),
      note1.slice(0, 200));
    ok.eq('and nothing was posted to the archive',
      network.slice(endBefore).filter((n) => n === 'POST /counsel/meetings').length, 0);

    // The screen offers exactly one way out: end again to leave without saving.
    await page.click(`${CN} #cn-end`);
    await page.waitForTimeout(1500);
    const left = await gate();
    ok('ending again leaves the call', left.view !== 'live', `still on the ${left.view} view`);
    ok.eq('leaving releases the microphone for Command', left.capture, '');
    ok.eq('leaving saves no meeting',
      network.filter((n) => n === 'POST /counsel/meetings').length, 0);
    const archive1 = await daemon.api('/counsel/meetings');
    ok.eq('and the daemon\'s archive is still empty', archive1.body.meetings.length, 0);

    /* The window's save path is what is blocked below. The ROUTE it would call
       is not — exercise it directly so the BLOCKED reason is narrowed to the
       microphone, and a broken save endpoint could never hide behind it. This
       is explicitly NOT a substitute for the window's save path. */
    const direct = await daemon.api('/counsel/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'E2E route check (not a window save)',
        participants: [],
        utterances: [{ id: 'u0', at: new Date().toISOString(), speaker: 'owner', text: 'Route check line.' }],
      }),
    });
    ok.eq('the route the window would save through is real and stores a meeting', direct.status, 200,
      JSON.stringify(direct.body).slice(0, 200));
    const listed = await daemon.api('/counsel/meetings');
    ok('and GET /counsel/meetings lists what POST stored',
      listed.body.meetings.some((m) => m.id === (direct.body.meeting || {}).id),
      JSON.stringify(listed.body.meetings).slice(0, 200));

    throw new Blocked(
      'a real audio input device carrying audible speech, plus a speech engine that can transcribe it. ' +
      `This window had ${JSON.stringify(mic)} — no line was finalized in 20s of a live call, so Counsel ` +
      'correctly refused to save an empty meeting, and the save path (POST /counsel/meetings, then GET ' +
      '/counsel/meetings listing it) could not be executed through the window. Run this flow in the desktop ' +
      'app, whose local Whisper bridge (window.zenoLocalSpeech) transcribes a real microphone.');
  }

  /* ---------------------------------------------------------------- *
   * 8 · saving produces a real meeting                                *
   * ---------------------------------------------------------------- */
  const saveBefore = network.length;
  await page.click(`${CN} #cn-end`);
  await page.waitForTimeout(6000);

  const posted = network.slice(saveBefore).filter((n) => n === 'POST /counsel/meetings');
  ok.eq('ending a call with a transcript saves it through the daemon', posted.length, 1, JSON.stringify(posted));

  const archive2 = await daemon.api('/counsel/meetings');
  ok.eq('the archive now lists exactly one meeting', archive2.body.meetings.length, 1);
  ok.eq('and it is the call that was just recorded', archive2.body.meetings[0].title, titled);
  ok('the saved meeting kept the transcript', (archive2.body.meetings[0].counts || {}).lines > 0,
    JSON.stringify(archive2.body.meetings[0].counts));

  const after = await gate();
  ok.eq('saving releases the microphone too', after.capture, '');
  const shown = await page.$eval(`${CN} #cn-list`, (l) => l.textContent.replace(/\s+/g, ' ').trim());
  ok('and the saved call is on screen', shown.includes(titled), shown.slice(0, 160));
}
