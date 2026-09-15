/*
 * Voice — the surface with the most to lose.
 *
 * A microphone is the one control in Zeno that nobody is looking at when it
 * fires. Everything else in this product is a button the owner pressed on
 * purpose; voice is a room being listened to. So the claims that matter are not
 * "does dictation work" — they are ownership, honesty and the hard boundary:
 *
 *   1. EVERY microphone control in the window is driven by bind/voice.js. The
 *      artifact's ui.js shipped a MOCK that mimed a recording and then typed a
 *      canned sentence into the composer ("Rotate the ingest token and add a
 *      test for it", "Add a retry with backoff to the ingest client"). A
 *      fabricated transcript presented as something the owner said is the worst
 *      lie this surface can tell, so those strings must be unreachable.
 *   2. The voice pill is a live status region (role=status) that reports the
 *      engine that actually exists — including admitting when the "local" claim
 *      is not true in this window.
 *   3. With no speech engine at all, every control is DISABLED and carries the
 *      exact reason. Not hidden, not silently inert, not enabled-and-failing.
 *   4. The wake word — a microphone that stays open — can only be armed behind
 *      an explicit disclosure, and disarms immediately when switched off.
 *   5. Voice can ask and propose. It can NEVER approve, send, delete or pay.
 *      Proven three ways: the grammar refuses it, the shipped voice.js contains
 *      no path to /approvals at all, and no such request is ever observed.
 *
 * WHAT THIS FLOW CANNOT DO. Headless Chromium exposes window.SpeechRecognition
 * but has no audio input device and no speech-to-text backend behind it, so no
 * real utterance can be captured or transcribed here. That is asserted, not
 * assumed — the flow performs a genuine capture attempt and records what the
 * engine actually did — and the flow ends in Blocked for exactly that reason.
 * Where a transcript is needed to exercise logic that is NOT audio (consent,
 * arming, the command grammar, the approval refusal), a scripted recognizer
 * stands in for the transducer ONLY; every other line of the real voice stack
 * runs unmodified, against the real daemon, and the effects are checked against
 * the daemon's own state rather than against the DOM.
 */

/** ui.js's mock transcripts. Neither may ever reach a composer. */
const CANNED = [
  'Rotate the ingest token and add a test for it',
  'Add a retry with backoff to the ingest client',
];
/** ui.js's mock pill text, which claimed a capture that never happened. */
const MOCK_PILL = 'voice: listening · mic: Command';

/** The exact reason bind/voice.js gives when no engine exists. Held here in
 *  full on purpose: "disabled with an exact reason" is the acceptance claim, so
 *  the words are part of the contract, not incidental copy. */
const NO_ENGINE_REASON =
  'No speech engine is available in this window — local Whisper needs the Zeno desktop app’s '
  + 'speech service, and this browser has no Web Speech API either. Typed chat still works.';

/**
 * Every microphone control the shipped markup has.
 *
 * Matched on the markup's own structure, not on the title text: voice.js
 * rewrites every title it claims, so a `[title="Voice"]` selector would quietly
 * stop finding exactly the controls that ARE bound and "all claimed" would pass
 * by finding nothing. `.cbtn.mic` is Home, Chats and Forge's session composer;
 * the fourth is the icon button in Forge's first-run composer, which is the one
 * `.ag-ic` there that is not the "+" context button.
 */
const MIC_SELECTOR = '.cbtn.mic, .ag-composer .ag-ic:not(#ag-plus)';

/* ---------------------------------------------------------------- *
 * Page init scripts — the only things this flow substitutes          *
 * ------------------------------------------------------------------ */

/** Record window.confirm rather than let Playwright auto-dismiss it, so the
 *  disclosure TEXT can be read and "was the owner asked at all" is answerable. */
const CONFIRM_SPY = `
  window.__voice = { confirms: [], recs: [], log: [], pill: [] };
  window.confirm = (msg) => { window.__voice.confirms.push(String(msg)); return window.__voice.answer === true; };
`;

/** A browser with no Web Speech API — Firefox today, and the desktop app
 *  whenever its local Whisper service is not running. Nothing is faked here;
 *  a capability is removed. */
const NO_ENGINE = `${CONFIRM_SPY}
  for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    try { delete window[k]; } catch (e) { /* fall through */ }
    try { Object.defineProperty(window, k, { value: undefined, configurable: true, writable: true }); } catch (e) { /* ignore */ }
  }
`;

/** A scripted recognizer: the SAME interface the Web Speech API exposes, with
 *  the audio-to-text transducer replaced by a function the test calls. Every
 *  lifecycle callback voice.js relies on (onstart/onend/onerror/onresult) is
 *  delivered exactly as the platform delivers it. */
const SCRIPTED_ENGINE = `${CONFIRM_SPY}
  class ScriptedRecognition {
    constructor() { this.started = false; window.__voice.recs.push(this); }
    start() {
      if (this.started) throw new Error('recognition has already started');
      this.started = true;
      window.__voice.log.push('start');
      setTimeout(() => { if (this.onstart) this.onstart(); }, 0);
    }
    stop() {
      if (!this.started) return;
      this.started = false;
      window.__voice.log.push('stop');
      setTimeout(() => { if (this.onend) this.onend(); }, 0);
    }
    abort() {
      const was = this.started;
      this.started = false;
      window.__voice.log.push('abort');
      if (was) setTimeout(() => { if (this.onend) this.onend(); }, 0);
    }
    /** Deliver one settled utterance in the shape the platform uses. */
    say(transcript, isFinal) {
      if (!this.onresult) return false;
      const res = [{ transcript: String(transcript), confidence: 0.9 }];
      res.isFinal = isFinal !== false;
      this.onresult({ resultIndex: 0, results: [res] });
      return true;
    }
  }
  /** Speak into whichever recognizer is currently open; if none is, speak into
   *  the most recent one anyway — a late result from a closed session is
   *  exactly the case the product has to ignore. */
  window.__voice.say = (text, isFinal) => {
    const live = window.__voice.recs.filter((r) => r.started);
    const target = live[live.length - 1] || window.__voice.recs[window.__voice.recs.length - 1];
    return target ? target.say(text, isFinal) : false;
  };
  window.SpeechRecognition = ScriptedRecognition;
  window.webkitSpeechRecognition = ScriptedRecognition;
`;

/* ---------------------------------------------------------------- *
 * Helpers                                                            *
 * ------------------------------------------------------------------ */

async function openExtraWindow(page, daemon, initScript) {
  const ctx = page.context();
  const p = await ctx.newPage();
  await p.addInitScript(initScript);
  const net = [];
  const errs = [];
  p.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port === String(daemon.port)) net.push(`${r.method()} ${u.pathname}`);
  });
  p.on('pageerror', (e) => errs.push(String(e && e.message).slice(0, 200)));
  // Navigate to the bare ORIGIN, not daemon.url — the launch nonce (?k=) is
  // single-use and openWindow already spent it, so re-using that URL gets a
  // degraded page whose binders never fully run. The owner COOKIE that the
  // first window received is shared across this context, so the origin loads
  // the full authenticated shell.
  await p.goto(`http://127.0.0.1:${daemon.port}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__zenoBind !== undefined, { timeout: 20_000 }).catch(() => {});
  // voice.js finishes the Settings switch on the `zeno:bound` event, which fires
  // immediately after __zenoBind is published.
  await p.waitForTimeout(400);
  return { page: p, net, errs };
}

/**
 * Requests to the APPROVAL ROUTES — not every URL with the word in it.
 *
 * The renderer legitimately fetches `/bind/approvals.js`, the binder that draws
 * the owner's own Approvals screen; a substring match on "/approvals" counts
 * that as an approval attempt and the check becomes noise. The kernel's routes
 * are `POST /approvals`, `POST /approvals/decline` and the memory-scoped pair.
 */
const APPROVAL_ROUTE = /^[A-Z]+ \/(?:[a-z]+\/)?approvals(?:\/[a-z]+)?$/;
const approvalCalls = (list) => list.filter((n) => APPROVAL_ROUTE.test(n));

/** Read every microphone control the way an auditor would. */
function micReport(sel) {
  return [...document.querySelectorAll(sel)].map((b) => ({
    id: b.id || '',
    where: b.closest('.screen[data-screen]')?.getAttribute('data-screen')
      || b.closest('[data-product]')?.getAttribute('data-product') || '',
    disabled: !!b.disabled,
    title: b.title,
    wired: b.dataset.wired || '',
    pressed: b.getAttribute('aria-pressed'),
    cursor: b.style.cursor,
    opacity: b.style.opacity,
    inDom: document.contains(b),
  }));
}

/** The Settings → Voice → "Wake word" switch, as an expression usable inside a
 *  string passed to page.evaluate. */
const TOGGLE_EXPR = `(() => {
  const modal = document.querySelector('#settings-modal');
  const pane = modal && modal.querySelector('.set-pane[data-setpane="voice"]');
  const row = pane && [...pane.querySelectorAll('.setrow')]
    .find((r) => r.querySelector('.lab') && r.querySelector('.lab').textContent.trim() === 'Wake word');
  return row ? row.querySelector('.toggle[role="switch"]') : null;
})()`;

/** One snapshot of everything wake mode is allowed to touch. */
function wakeState(sel) {
  const modal = document.querySelector('#settings-modal');
  const pane = modal && modal.querySelector('.set-pane[data-setpane="voice"]');
  const row = pane && [...pane.querySelectorAll('.setrow')]
    .find((r) => r.querySelector('.lab') && r.querySelector('.lab').textContent.trim() === 'Wake word');
  const t = row && row.querySelector('.toggle[role="switch"]');
  const p = document.querySelector('#voice-state');
  return {
    checked: t ? t.getAttribute('aria-checked') : null,
    ariaDisabled: t ? t.getAttribute('aria-disabled') : null,
    toggleTitle: t ? t.title : null,
    pill: p ? p.textContent.trim() : null,
    pillTitle: p ? p.title : null,
    capture: document.body.dataset.zenoCapture || '',
    stored: window.localStorage.getItem('zeno.voice.wake'),
    micsDisabled: [...document.querySelectorAll(sel)].map((b) => !!b.disabled),
    product: document.querySelector('.product.on[data-product]')?.getAttribute('data-product') || '',
    log: window.__voice.log.slice(),
    confirms: window.__voice.confirms.slice(),
    pillLog: window.__voice.pill.slice(),
  };
}

export const id = 'voice';
export const title = 'Voice owns every microphone, reports the real engine, and can never approve';
export const criteria = [
  'voice: every mic control is bound by voice.js, not ui.js\'s mock',
  'voice: the state pill is a live status region reporting the real engine',
  'voice: no engine => every control disabled with an exact reason',
  'voice: the local Whisper installer row is honest about needing the desktop app',
  'voice: wake word requires an explicit disclosure and disarms immediately',
  'voice: ask & propose only — never approve, send, delete or pay',
];

export async function run({ daemon, page, ok, network, Blocked }) {
  /* =================================================================
   * 1. OWNERSHIP — every microphone control belongs to bind/voice.js
   * ================================================================= */

  const bound = await page.evaluate(() => window.__zenoBind || null);
  ok('the voice binder mounted', !!bound && bound.loaded.includes('./bind/voice.js'),
    JSON.stringify(bound && bound.failed));

  const mics = await page.evaluate(micReport, MIC_SELECTOR);
  ok('the window still has every microphone control the markup ships',
    mics.length === 4, `found ${mics.length}: ${JSON.stringify(mics.map((m) => m.id || m.where))}`);
  ok('no microphone control was left unclaimed',
    mics.length > 0 && mics.every((m) => m.wired === '1'),
    JSON.stringify(mics.map((m) => ({ id: m.id, where: m.where, wired: m.wired }))));

  // Ownership proven by EFFECT, per control: only voice.js takes the shared
  // capture lock and names which control opened it. ui.js's mock did neither.
  const holds = await page.evaluate((sel) => {
    const out = [];
    for (const b of [...document.querySelectorAll(sel)]) {
      delete document.body.dataset.zenoCapture;
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      out.push({
        id: b.id || '',
        capture: document.body.dataset.zenoCapture || '',
        pill: (document.querySelector('#voice-state')?.textContent || '').trim(),
      });
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    }
    return out;
  }, MIC_SELECTOR);
  ok('holding any microphone control takes voice.js\'s capture lock',
    holds.length > 0 && holds.every((h) => h.capture === 'command'), JSON.stringify(holds));
  ok('and the pill names which control opened the microphone',
    holds.every((h) => /^voice: listening · mic: (Home|Chats|Forge)$/.test(h.pill)),
    JSON.stringify(holds.map((h) => h.pill)));
  ok('no control reports the mock\'s invented capture label',
    holds.every((h) => h.pill !== MOCK_PILL), JSON.stringify(holds.map((h) => h.pill)));

  /* =================================================================
   * 2. ui.js's MOCK IS GONE — the canned transcripts are unreachable
   * ================================================================= */

  const canned = await page.evaluate(([strings, sel]) => {
    const ta = () => ({ home: document.querySelector('#home-ta'), forge: document.querySelector('#s-ta') });
    const before = ta();
    const seen = [];
    // A plain click is exactly what ui.js's mock listened for. If that listener
    // survived anywhere, this is what re-attaches the canned sentence.
    for (const b of [...document.querySelectorAll(sel)]) {
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const now = ta();
      seen.push(`${now.home?.value || ''}|${now.forge?.value || ''}`);
    }
    const after = ta();
    return {
      seen,
      homeValue: after.home?.value ?? null,
      forgeValue: after.forge?.value ?? null,
      homePlaceholder: after.home?.placeholder ?? null,
      forgePlaceholder: after.forge?.placeholder ?? null,
      anywhere: strings.filter((s) => document.body.innerText.includes(s)),
      startedEmpty: (before.home?.value || '') === '' && (before.forge?.value || '') === '',
    };
  }, [CANNED, MIC_SELECTOR]);
  ok('the composers start empty', canned.startedEmpty);
  ok.eq('clicking a microphone types nothing into Home\'s composer', canned.homeValue, '');
  ok.eq('clicking a microphone types nothing into Forge\'s composer', canned.forgeValue, '');
  ok('no canned transcript ever appeared while clicking every mic',
    canned.seen.every((s) => CANNED.every((c) => !s.includes(c))), JSON.stringify(canned.seen));
  ok('neither canned transcript exists anywhere in the window',
    canned.anywhere.length === 0, JSON.stringify(canned.anywhere));
  ok('the mock\'s "Listening…" placeholder never appears either',
    !/Listening…/.test(String(canned.homePlaceholder)) && !/Listening…/.test(String(canned.forgePlaceholder)),
    `${canned.homePlaceholder} / ${canned.forgePlaceholder}`);

  /* =================================================================
   * 3. THE PILL — a live status region, reporting the real engine
   * ================================================================= */

  const pill = await page.evaluate(() => {
    const p = document.querySelector('#voice-state');
    if (!p) return null;
    const mic = document.querySelector('#home-mic');
    return {
      role: p.getAttribute('role'),
      live: p.getAttribute('aria-live'),
      text: p.textContent.trim(),
      title: p.title,
      visible: p.offsetParent !== null,
      micTitle: mic ? mic.title : null,
      localBridge: !!window.zenoLocalSpeech,
      hasWebSpeech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    };
  });
  ok('the voice pill exists', !!pill);
  ok.eq('the pill is a live status region', pill && pill.role, 'status');
  ok.eq('and announces politely rather than interrupting', pill && pill.live, 'polite');
  ok('the pill is actually on screen', !!pill && pill.visible);
  // The honesty claim: this window has the browser's Web Speech API and NO local
  // Whisper bridge, so it must say so rather than inherit the artifact's
  // "local only" framing. Audio leaving the machine is the owner's decision.
  ok('this window has a Web Speech engine but no local Whisper bridge',
    !!pill && pill.hasWebSpeech && !pill.localBridge,
    JSON.stringify({ hasWebSpeech: pill?.hasWebSpeech, localBridge: pill?.localBridge }));
  ok('the microphone admits that voice here is NOT local and uploads audio',
    !!pill && /not local/i.test(pill.micTitle || '') && /uploads audio/i.test(pill.micTitle || ''),
    String(pill && pill.micTitle));

  /* =================================================================
   * 3b. THE INSTALLER ROW — honestly desktop-app-only in a real browser
   *
   * Headless Chromium has no window.zenoLocalSpeech (that bridge only exists
   * inside the Electron desktop app), so Settings → Voice's "Local speech
   * (Whisper)" row has nothing to install here. This asserts the row tells
   * the truth about that rather than showing a button that would silently do
   * nothing when clicked.
   * ================================================================= */

  const localWhisperRow = await page.evaluate(() => {
    const modal = document.querySelector('#settings-modal');
    const pane = modal && modal.querySelector('.set-pane[data-setpane="voice"]');
    const row = pane && [...pane.querySelectorAll('.setrow')]
      .find((r) => r.querySelector('.lab') && r.querySelector('.lab').textContent.trim() === 'Local speech (Whisper)');
    const button = row ? row.querySelector('[data-lw-ctl] button') : null;
    const sub = row ? row.querySelector('.sub') : null;
    return {
      found: !!row,
      hasBridge: !!window.zenoLocalSpeech,
      disabled: button ? button.disabled : null,
      label: button ? button.textContent.trim() : null,
      sub: sub ? sub.textContent.trim() : null,
    };
  });
  ok('this window has no desktop speech bridge — it is a real browser, not Electron',
    !localWhisperRow.hasBridge);
  ok('the Local speech (Whisper) row exists in Settings → Voice', localWhisperRow.found, JSON.stringify(localWhisperRow));
  ok('its Install button carries the real ~1.1 GB size, not a placeholder',
    /install local whisper/i.test(localWhisperRow.label || '') && /1\.1\s*gb/i.test(localWhisperRow.label || ''),
    String(localWhisperRow.label));
  ok('with no bridge, that button is honestly disabled rather than fake-clickable',
    localWhisperRow.disabled === true, JSON.stringify(localWhisperRow));
  ok('and the row says so in plain words, not a fake progress or installed state',
    /available in the zeno desktop app/i.test(localWhisperRow.sub || ''), String(localWhisperRow.sub));

  /* =================================================================
   * 4. THE HARD BOUNDARY — voice may ask and propose, nothing more
   * ================================================================= */

  // (a) The shipped file itself. Not a claim in a comment — the served bytes.
  const src = await page.evaluate(async () => {
    const res = await fetch('/bind/voice.js', { cache: 'no-store' });
    return res.ok ? await res.text() : '';
  });
  ok('the voice binder was served', src.length > 1000, `${src.length} bytes`);
  // The file DISCUSSES /approvals in its header ("It never calls /approvals").
  // A prose mention is not a path, so the code is what gets searched: comments
  // stripped, then every remaining occurrence is a reachable reference.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Guard the guard: if comment-stripping ate the file, "no /approvals" would
  // be true of nothing. The real request machinery must survive it.
  ok('stripping comments leaves the binder\'s actual request code intact',
    code.includes('fetch(') && code.includes('postJSON(') && code.length > src.length / 3,
    `${code.length} of ${src.length} bytes survived`);
  ok('no executable line of bind/voice.js references /approvals',
    !code.includes('/approvals'),
    JSON.stringify(code.split('\n').filter((l) => l.includes('/approvals')).slice(0, 5)));
  const posted = [...src.matchAll(/postJSON\(\s*'([^']+)'/g)].map((m) => m[1]);
  ok('the only endpoints voice can POST are ask/propose endpoints',
    posted.length > 0 && posted.every((p) => ['/work', '/previews', '/delegate'].includes(p)),
    JSON.stringify([...new Set(posted)]));
  ok('voice issues no mutating verb of its own and no payment path',
    !/method:\s*'(DELETE|PUT|PATCH)'/.test(src) && !/['"]\/pay/.test(src) && !/['"]\/send/.test(src));

  // (b) The grammar — the real pure pipeline, run in the real window.
  const DANGEROUS = [
    'Zeno, approve it',
    'Zeno, approve the ingest change',
    'Zeno, yes do it',
    'Zeno, ship it',
    'Zeno, allow it',
    'Zeno, click approve',
    'Zeno, confirm the payment',
    'Zeno, sign off on it',
    'Zeno, send the email to finance',
    'Zeno, delete the vault',
    'Zeno, pay the invoice',
    'Zeno, transfer five hundred dollars to Bob',
  ];
  const APPROVAL_SHAPED = 8; // the first eight are approval attempts
  const verdicts = await page.evaluate(async (phrases) => {
    const m = await import('/session.js');
    return phrases.map((t) => {
      const r = m.interpret(t);
      return {
        t,
        kind: r.kind === 'idle' ? 'idle' : r.intent.kind,
        reason: r.kind === 'idle' ? r.reason : (r.intent.reason || ''),
      };
    });
  }, DANGEROUS);
  const acting = verdicts.filter((v) => !['unrecognized', 'idle', 'cancel'].includes(v.kind));
  ok('no dangerous utterance produces an acting intent',
    acting.length === 0, JSON.stringify(acting));
  const approvals = verdicts.slice(0, APPROVAL_SHAPED);
  ok('every approval-shaped utterance is refused with "approval is by hand"',
    approvals.every((v) => /approval is by hand/i.test(v.reason)),
    JSON.stringify(approvals.map((v) => [v.t, v.reason.slice(0, 60)])));

  // (c) And the things voice IS allowed to do still parse, so the refusal above
  //     is a boundary rather than a grammar that understands nothing.
  const allowed = await page.evaluate(async () => {
    const m = await import('/session.js');
    const one = (t) => { const r = m.interpret(t); return r.kind === 'idle' ? 'idle' : r.intent.kind; };
    return {
      task: one('Zeno, add a task called ship the voice flow'),
      read: one('Zeno, what is waiting?'),
      nav: one('Zeno, open Forge'),
    };
  });
  ok.eq('a spoken task is still understood', allowed.task, 'add_task');
  ok.eq('a spoken question is still understood', allowed.read, 'read');
  ok.eq('spoken navigation is still understood', allowed.nav, 'navigate');

  // (d) Nothing the window has done so far went anywhere near an approval.
  ok('the window has made no approval request at all',
    approvalCalls(network).length === 0, JSON.stringify(approvalCalls(network)));

  /* =================================================================
   * 5. NO ENGINE — disabled, with the exact reason, not hidden
   * ================================================================= */

  const off = await openExtraWindow(page, daemon, NO_ENGINE);
  try {
    const offMics = await off.page.evaluate(micReport, MIC_SELECTOR);
    ok('with no engine, the microphone controls are still present',
      offMics.length === 4 && offMics.every((m) => m.inDom), `found ${offMics.length}`);
    ok('with no engine, EVERY microphone control is disabled',
      offMics.length > 0 && offMics.every((m) => m.disabled),
      JSON.stringify(offMics.map((m) => ({ id: m.id, where: m.where, disabled: m.disabled }))));
    ok('each disabled control carries the exact reason, not a shrug',
      offMics.length > 0 && offMics.every((m) => m.title === NO_ENGINE_REASON),
      JSON.stringify([...new Set(offMics.map((m) => m.title))]));
    ok('a disabled control looks disabled rather than merely inert',
      offMics.every((m) => m.cursor === 'not-allowed' && m.opacity === '0.5' && m.pressed === 'false'),
      JSON.stringify(offMics.map((m) => [m.cursor, m.opacity, m.pressed])));

    const offPill = await off.page.evaluate(() => {
      const p = document.querySelector('#voice-state');
      return { text: p ? p.textContent.trim() : null, title: p ? p.title : null, role: p ? p.getAttribute('role') : null };
    });
    ok.eq('the pill is still a status region with no engine', offPill.role, 'status');
    ok('the pill does not report a ready "idle" state when nothing can listen',
      !!offPill.text && !/^voice: idle$/.test(offPill.text), `pill reads "${offPill.text}"`);
    ok.eq('the pill carries the exact reason in its tooltip', offPill.title, NO_ENGINE_REASON);

    const offHold = await off.page.evaluate(() => {
      delete document.body.dataset.zenoCapture;
      const b = document.querySelector('#home-mic');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      return { capture: document.body.dataset.zenoCapture || '', home: document.querySelector('#home-ta')?.value ?? null };
    });
    ok.eq('holding a disabled control opens no microphone', offHold.capture, '');
    ok.eq('and types nothing into the composer', offHold.home, '');

    // The wake switch must refuse too, and say why — an opt-in you can flip into
    // a state the engine cannot reach is worse than one that is plainly off.
    const beforeWake = await off.page.evaluate(wakeState, MIC_SELECTOR);
    await off.page.evaluate(`{ const t = ${TOGGLE_EXPR}; if (t) t.click(); }`);
    await off.page.waitForTimeout(400);
    const offWake = await off.page.evaluate(wakeState, MIC_SELECTOR);
    ok('the Settings wake switch exists', beforeWake.checked !== null);
    ok.eq('it starts off', beforeWake.checked, 'false');
    ok.eq('it is marked unavailable with no engine', offWake.ariaDisabled, 'true');
    ok.eq('it carries the same exact reason', offWake.toggleTitle, NO_ENGINE_REASON);
    ok.eq('clicking it cannot arm wake mode', offWake.checked, 'false');
    ok.eq('and it never raises a disclosure it could not honour', offWake.confirms.length, 0);
    ok.eq('nothing was persisted', offWake.stored, null);
    ok.eq('no microphone was opened', offWake.capture, '');
    ok('the degraded window threw nothing', off.errs.length === 0, JSON.stringify(off.errs));
    ok('a window with no voice engine still made no approval request',
      approvalCalls(off.net).length === 0, JSON.stringify(approvalCalls(off.net)));
  } finally {
    await off.page.close();
  }

  /* =================================================================
   * 6. WAKE MODE — disclosed before it arms, gone the moment it is off
   *
   * A scripted recognizer stands in for the audio transducer here and for
   * nothing else: consent, arming, capture ownership, persistence, the command
   * grammar and every network effect below are the shipped code paths, and the
   * effects are checked against the DAEMON, not the DOM.
   * ================================================================= */

  const wake = await openExtraWindow(page, daemon, SCRIPTED_ENGINE);
  try {
    // The pill settles fast and can pass through the state we care about, so
    // record every value it takes rather than sampling it.
    await wake.page.evaluate(() => {
      const p = document.querySelector('#voice-state');
      if (!p) return;
      const rec = () => window.__voice.pill.push({ text: p.textContent.trim(), title: p.title });
      new MutationObserver(rec).observe(p, { attributes: true, childList: true, subtree: true, characterData: true });
      rec();
    });

    const idle = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok('with a working engine the microphones are enabled',
      idle.micsDisabled.length === 4 && idle.micsDisabled.every((d) => d === false),
      JSON.stringify(idle.micsDisabled));
    ok.eq('wake mode starts off', idle.checked, 'false');
    ok.eq('and nothing is listening', idle.log.join(','), '');

    // Holding the button already addresses Zeno. Whisper can omit the leading
    // name even when it was spoken, so push-to-talk must accept the command
    // itself while ambient wake mode below continues to require "Zeno".
    await wake.page.evaluate(() => {
      const b = document.querySelector('#home-mic');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41 }));
    });
    await wake.page.waitForTimeout(80);
    await wake.page.evaluate(() => window.__voice.say('open Forge'));
    await wake.page.evaluate(() => {
      const b = document.querySelector('#home-mic');
      b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41 }));
    });
    await wake.page.waitForTimeout(700);
    const pttProduct = await wake.page.evaluate(() => document.querySelector('.product.on')?.dataset.product || '');
    ok.eq('push-to-talk treats the held button as the address and accepts a command without a second wake word', pttProduct, 'forge');
    await wake.page.click('[data-product="command"]');
    await wake.page.evaluate(() => { window.__voice.log.length = 0; });

    // --- (a) DECLINE the disclosure: nothing may change, at all.
    await wake.page.evaluate(`{ window.__voice.answer = false; const t = ${TOGGLE_EXPR}; t.click(); }`);
    await wake.page.waitForTimeout(500);
    const declined = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok.eq('turning wake on asks first', declined.confirms.length, 1);
    ok.eq('declining leaves wake off', declined.checked, 'false');
    ok.eq('declining opens no microphone', declined.capture, '');
    ok.eq('declining starts no recognizer', declined.log.join(','), '');
    ok.eq('declining persists nothing', declined.stored, null);

    const disclosure = declined.confirms[0] || '';
    ok('the disclosure says the microphone stays open on the whole room',
      /stays open until you switch this off/i.test(disclosure) && /hears the whole room/i.test(disclosure),
      disclosure.slice(0, 200));
    ok('the disclosure states how long untriggered speech is held',
      /last \d+ seconds of untriggered speech/i.test(disclosure), disclosure.slice(0, 400));
    ok('the disclosure names the engine honestly',
      /uploads audio to your browser maker/i.test(disclosure), disclosure.slice(0, 400));
    ok('the disclosure repeats the hard boundary',
      /voice can never approve anything/i.test(disclosure), disclosure.slice(0, 600));

    // --- (b) ACCEPT: wake arms, and says so in every place that matters.
    await wake.page.evaluate(`{ window.__voice.answer = true; const t = ${TOGGLE_EXPR}; t.click(); }`);
    await wake.page.waitForTimeout(900);
    const armed = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok.eq('accepting arms wake mode', armed.checked, 'true');
    ok('the recognizer actually started', armed.log.includes('start'), JSON.stringify(armed.log));
    ok.eq('wake mode holds the capture lock', armed.capture, 'command');
    ok('the pill says the room is being listened to', /listening for/i.test(armed.pill || ''), String(armed.pill));
    ok('one microphone at a time — push-to-talk is disabled while wake is armed',
      armed.micsDisabled.length === 4 && armed.micsDisabled.every((d) => d === true),
      JSON.stringify(armed.micsDisabled));
    const pref = armed.stored ? JSON.parse(armed.stored) : null;
    ok('the accepted disclosure is what is persisted, not merely "on"',
      !!pref && pref.on === true && Number.isInteger(pref.disclosure) && pref.disclosure > 0,
      String(armed.stored));

    // --- (c) With the microphone genuinely open, the boundary still holds.
    const beforeVoice = await daemon.api('/state');
    await wake.page.evaluate(() => window.__voice.say('Zeno, approve everything that is waiting'));
    await wake.page.waitForTimeout(1200);
    const afterApprove = await daemon.api('/state');
    ok.eq('a spoken approval seals no receipt',
      afterApprove.body.receipts.length, beforeVoice.body.receipts.length);
    ok('a spoken approval issues no approval request',
      approvalCalls(wake.net).length === 0, JSON.stringify(approvalCalls(wake.net)));
    const spoken = await wake.page.evaluate(() => window.__voice.pill.slice());
    ok('and the owner is told, in words, that approval is by hand',
      spoken.some((s) => /approval is by hand/i.test(s.title)),
      JSON.stringify(spoken.slice(-4)));

    // --- (d) …while what voice IS for still has a real effect on the daemon.
    const workBefore = await daemon.api('/work');
    await wake.page.evaluate(() => window.__voice.say('Zeno, add a task called voice e2e proof'));
    await wake.page.waitForTimeout(2000);
    const workAfter = await daemon.api('/work');
    const titles = (workAfter.body.items || []).map((i) => i.title);
    ok('a spoken task is really added to the daemon\'s Work list',
      (workAfter.body.items || []).length === (workBefore.body.items || []).length + 1
      && titles.some((t) => /voice e2e proof/i.test(t)),
      JSON.stringify(titles));
    ok('and it took the real /work route',
      wake.net.some((n) => n === 'POST /work'), JSON.stringify([...new Set(wake.net)].slice(0, 24)));

    // --- (e) DISARM: off means off, now — not at the next restart.
    const t0 = Date.now();
    await wake.page.evaluate(`{ const t = ${TOGGLE_EXPR}; t.click(); }`);
    const closed = await wake.page.waitForFunction(
      () => !document.body.dataset.zenoCapture && window.__voice.log.includes('abort'),
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
    const elapsed = Date.now() - t0;
    ok('switching wake off closes the microphone immediately', closed && elapsed < 3_000,
      `capture released after ${elapsed}ms, log ${JSON.stringify(await wake.page.evaluate(() => window.__voice.log))}`);
    const disarmed = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok.eq('the switch reports off', disarmed.checked, 'false');
    ok.eq('the stored consent is dropped, not left armed for the next launch', disarmed.stored, null);
    ok('the microphones are usable again', disarmed.micsDisabled.every((d) => d === false),
      JSON.stringify(disarmed.micsDisabled));

    // A result that arrives from the session that was just closed must do nothing.
    await wake.page.evaluate(() => window.__voice.say('Zeno, open Counsel'));
    await wake.page.waitForTimeout(600);
    const late = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok('a transcript arriving after disarm is ignored, not acted on',
      late.product !== 'counsel' && late.capture === '',
      JSON.stringify({ product: late.product, capture: late.capture, pill: late.pill }));

    // --- (f) A stored preference is not consent: a stale disclosure re-asks.
    await wake.page.evaluate(() => window.localStorage.setItem(
      'zeno.voice.wake', JSON.stringify({ on: true, disclosure: 1, engine: 'browser' })));
    await wake.page.reload({ waitUntil: 'domcontentloaded' });
    await wake.page.waitForFunction(() => window.__zenoBind !== undefined, { timeout: 20_000 }).catch(() => {});
    await wake.page.waitForTimeout(800);
    const stale = await wake.page.evaluate(wakeState, MIC_SELECTOR);
    ok('a preference recorded under an older disclosure does not re-arm the microphone',
      stale.log.length === 0 && stale.capture === '' && !/listening for/i.test(stale.pill || ''),
      JSON.stringify({ log: stale.log, capture: stale.capture, pill: stale.pill }));
    ok.eq('and nothing is armed behind a silent re-ask', stale.confirms.length, 0);
    ok.eq('the switch shows off, matching what is actually happening', stale.checked, 'false');
  } finally {
    await wake.page.close();
  }

  /* =================================================================
   * 7. THE PART THAT NEEDS A REAL MICROPHONE
   *
   * Everything above is executed. This last claim — that a real utterance
   * through a real microphone is captured, transcribed, and routed — cannot
   * be. Demonstrate that rather than assume it, then report it as BLOCKED.
   * ================================================================= */

  const attempt = await page.evaluate(async () => {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) return { outcome: 'no-engine', detail: 'no Web Speech API in this window' };
    const rec = new Rec();
    rec.lang = 'en-US';
    return await new Promise((resolve) => {
      let settled = false;
      const done = (outcome, detail) => {
        if (settled) return;
        settled = true;
        try { rec.abort(); } catch { /* already closed */ }
        resolve({ outcome, detail: String(detail || '') });
      };
      rec.onerror = (e) => done('error', e && e.error);
      rec.onresult = () => done('transcript', 'an utterance was transcribed');
      rec.onend = () => done('ended', 'the session ended with no result');
      setTimeout(() => done('timeout', 'no event within 8s'), 8_000);
      try { rec.start(); } catch (err) { done('throw', err && err.message); }
    });
  });
  ok('a genuine capture attempt does not silently pretend to work',
    attempt.outcome !== 'transcript',
    `the engine reported: ${attempt.outcome} ${attempt.detail}`);

  throw new Blocked(
    'a real microphone and a working speech-to-text backend. Headless Chromium exposes '
    + 'window.SpeechRecognition but has no audio input device behind it (a genuine capture attempt '
    + `reported "${attempt.outcome}: ${attempt.detail}"), so no spoken utterance can be captured or `
    + 'transcribed. Every non-audio claim in this flow — ownership of all four mic controls, the removal '
    + 'of ui.js\'s canned transcripts, the status pill, the no-engine disabled path, the wake '
    + 'disclosure/arm/disarm cycle, and the ask-and-propose-only boundary against the real daemon — was '
    + 'executed and is recorded in the checks above.',
  );
}
