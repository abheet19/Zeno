/*
 * Settings must persist, and must never lie.
 *
 * The Settings modal is the single densest patch of the design artifact: seven
 * panes of switches, segmented controls and status pills, every one of which
 * shipped as markup with no behaviour behind it. ui.js gives them all the
 * APPEARANCE of working — a generic `.toggle` handler flips aria-checked on
 * anything with that class, and `grp('.segsm button')` moves aria-current
 * between any segmented buttons — so a row that reaches a daemon and a row that
 * reaches nothing are visually indistinguishable. bind/settings.js is supposed
 * to close that gap.
 *
 * So this flow allows exactly two categories for every row in every pane:
 *
 *   1. it is wired to something REAL (a daemon read, a stored preference, a
 *      navigation that actually happens) and, if it holds a value, that value
 *      survives a full page reload; or
 *   2. it is visibly disabled and states why.
 *
 * There is no third category. A control that looks live and changes nothing is
 * the specific failure this surface exists to avoid, and the census below fails
 * on any live control this flow has not separately proved real.
 *
 * Nothing here asserts "the DOM changed". Every claim is checked against the
 * thing behind it: the daemon's own /forge/agents, /forge/mcp/servers, /state
 * and /mesh/devices answers, localStorage as it exists after a reload, and the
 * attributes theme-boot.js resolves before a single stylesheet is parsed.
 */

export const id = 'settings-persistence';
export const title = 'Every Settings row is real and durable, or visibly disabled with a reason';
export const criteria = [
  'settings: no control that looks live and does nothing',
  'settings: a chosen preference survives a reload',
  'settings: no artifact fixture survives to the screen',
];

/* Rows whose control is allowed to be LIVE. Every entry is separately proved
   real further down; a live control that is not on this list fails the census.
   `voice::Wake word` is live only while the preference is already ON — turning
   it on needs the microphone disclosure, which has no surface in Settings. */
const PROVED_LIVE = new Set([
  'general::Reduce motion',
  'general::Reduce transparency',
  'appearance::Theme',
  'appearance::Density',
  'models::Manage models',
  'connectors::Customize hub',
  'voice::Wake word',
  'account::(link) Review the security model',
]);

/* Strings the design artifact hardcodes into this modal. If any of them is
   still on screen after the binders ran, the owner is reading invented state. */
const ARTIFACT_FIXTURES = [
  'Anthropic · set',       // claimed Zeno holds an API key. It holds none.
  'zeno-pc · 8f2a…c41d',   // a fabricated device fingerprint
  'abheet19@gmail.com',    // one developer's identity, shipped as everyone's
  'Abheet Singh',
];

export async function run({ daemon, page, ok, network, Blocked }) {
  /* "Telemetry — Zeno collects nothing" is a row in this modal. Watch every
     request the window makes from here on and hold it to that. */
  const offMachine = [];
  page.on('request', (r) => {
    try {
      const u = new URL(r.url());
      if (!/^https?:$/.test(u.protocol)) return;
      if (u.hostname !== '127.0.0.1' || u.port !== String(daemon.port)) offMachine.push(u.origin);
    } catch { /* about:blank and data: URIs are not egress */ }
  });

  const openSettings = async () => {
    await page.evaluate(() => document.querySelector('[data-open-settings]')?.click());
    await page.waitForSelector('#settings-modal:not([hidden])', { timeout: 5000 });
  };
  const showPane = async (cat) => {
    await page.evaluate((c) => document.querySelector(`#settings-modal [data-setcat="${c}"]`)?.click(), cat);
    await page.waitForTimeout(80);
  };
  const reload = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const bound = await page.waitForFunction(() => window.__zenoBind !== undefined, { timeout: 25_000 })
      .then(() => true).catch(() => false);
    if (!bound) throw new Blocked('the renderer never finished binding after a reload (window.__zenoBind stayed undefined)');
    await page.waitForTimeout(500);
    await openSettings();
  };
  const ls = (key) => page.evaluate((k) => { try { return localStorage.getItem(k); } catch { return '<storage blocked>'; } }, key);
  const attr = (name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

  /* Record what the root element looked like at the moment each preference
     attribute was first applied, and how many stylesheets had been parsed by
     then. A preference resolved after CSS arrives as a visible flash of the
     wrong theme — which is the whole reason theme-boot.js exists. */
  await page.addInitScript(() => {
    window.__prefTrace = [];
    // Observed on `document`, not on documentElement: an init script runs before
    // the parser has necessarily created <html>, so observing the root directly
    // installed nothing at all and the trace came back empty.
    new MutationObserver((recs) => {
      const root = document.documentElement;
      for (const r of recs) {
        if (r.target !== root) continue;
        window.__prefTrace.push({
          why: r.attributeName,
          value: root.getAttribute(r.attributeName),
          sheets: document.styleSheets.length,
        });
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-theme', 'data-density', 'data-reduce', 'data-flat'] });
  });

  await openSettings();
  ok('the Settings modal opens from the app chrome', true);

  /* ============================================================ *
   * 1. CENSUS — every row of every pane, classified               *
   * ============================================================ */

  const census = await page.evaluate(() => {
    const body = document.querySelector('#settings-modal .set-body2');
    const isCtl = (n) => n.matches('button, input, select, textarea, a[href], [role="switch"], .toggle');
    const state = (n) => {
      const cs = getComputedStyle(n);
      const dead = n.disabled === true
        || n.getAttribute('aria-disabled') === 'true'
        || cs.pointerEvents === 'none';
      return { live: !dead, reason: (n.getAttribute('title') || '').trim(), tag: n.tagName.toLowerCase() };
    };
    const out = [];
    for (const pane of body.querySelectorAll('.set-pane')) {
      const claimed = new Set();
      for (const row of pane.querySelectorAll('.setrow')) {
        const controls = [...row.querySelectorAll('*')].filter(isCtl);
        controls.forEach((c) => claimed.add(c));
        out.push({
          pane: pane.dataset.setpane,
          label: (row.querySelector('.lab')?.textContent || '(unlabelled row)').trim(),
          controls: controls.map(state),
          pills: [...row.querySelectorAll('.pill')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
          sub: (row.querySelector('.sub')?.textContent || '').replace(/\s+/g, ' ').trim(),
          text: row.textContent.replace(/\s+/g, ' ').trim(),
        });
      }
      // Anything interactive in the pane that is not inside a .setrow at all.
      for (const s of [...pane.querySelectorAll('*')].filter((n) => isCtl(n) && !claimed.has(n))) {
        out.push({
          pane: pane.dataset.setpane,
          label: `(link) ${s.textContent.replace(/\s+/g, ' ').trim()}`,
          controls: [state(s)],
          pills: [], sub: '', text: s.textContent.replace(/\s+/g, ' ').trim(), stray: true,
        });
      }
    }
    return out;
  });

  const panes = [...new Set(census.map((r) => r.pane))];
  ok('every Settings pane was enumerated',
    ['general', 'appearance', 'models', 'voice', 'connectors', 'security', 'account'].every((p) => panes.includes(p)),
    JSON.stringify(panes));
  ok('the census found the whole modal, not one pane', census.length >= 22, `${census.length} rows`);

  const key = (r) => `${r.pane}::${r.label}`;
  const liveRows = census.filter((r) => r.controls.some((c) => c.live));
  const unproved = liveRows.map(key).filter((k) => !PROVED_LIVE.has(k));
  ok('no row offers a live control this flow has not proved real', unproved.length === 0,
    `live but unproved: ${JSON.stringify(unproved)}`);

  const unexplained = [];
  for (const r of census) {
    for (const c of r.controls) if (!c.live && c.reason.length < 12) unexplained.push(`${key(r)} (${c.tag}, title="${c.reason}")`);
  }
  ok('every disabled control states its reason in a title', unexplained.length === 0, JSON.stringify(unexplained));

  const fixtures = ARTIFACT_FIXTURES.filter((f) => census.some((r) => r.text.includes(f)));
  ok('no artifact fixture survives into the modal', fixtures.length === 0,
    `still on screen: ${JSON.stringify(fixtures)}`);

  /* ============================================================ *
   * 2. The rows that READ real state — checked against the daemon *
   * ============================================================ */

  const row = (pane, label) => census.find((r) => r.pane === pane && r.label === label);

  /* --- Models.
     `?passive=1` means this read must never be what starts a local Ollama
     runtime, so on a cold machine it answers with no local models. The window's
     own boot makes the non-passive call (bind.js's rail badges), which awaits
     ensureOllama(). Make that same call here first, so the test and the window
     are both looking at a settled machine rather than racing the runtime, then
     hold the rows to exactly what the daemon reports. */
  await daemon.api('/forge/agents');
  const agents = await daemon.api('/forge/agents?passive=1');
  ok.eq('the daemon answers /forge/agents', agents.status, 200);
  ok('the window read the model list passively',
    network.some((n) => n.startsWith('GET /forge/agents')),
    JSON.stringify(network.filter((n) => n.includes('forge'))));
  const locals = Array.isArray(agents.body?.localModels) ? agents.body.localModels : [];
  const wantManage = locals.length === 0
    ? 'No local model is pulled yet'
    : `${locals.length} local model${locals.length === 1 ? '' : 's'} installed`;
  // The rows repaint once the runtime has settled; wait for that repaint rather
  // than for a fixed delay, then assert on what is actually on screen.
  await page.waitForFunction((want) => {
    const r = [...document.querySelectorAll('#settings-modal .setrow')]
      .find((x) => x.querySelector('.lab')?.textContent.trim() === 'Manage models');
    return (r?.querySelector('.sub')?.textContent || '').includes(want);
  }, wantManage, { timeout: 20_000 }).catch(() => {});
  const modelsNow = await page.evaluate(() => {
    const get = (l) => [...document.querySelectorAll('#settings-modal .setrow')]
      .find((x) => x.querySelector('.lab')?.textContent.trim() === l);
    return {
      pill: (get('Default model')?.querySelector('.pill')?.textContent || '').replace(/\s+/g, ' ').trim(),
      manage: (get('Manage models')?.querySelector('.sub')?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  if (locals.length === 0) {
    ok('with no local model installed the row names none',
      !/qwen|llama|mistral|gemma|phi/i.test(modelsNow.pill), modelsNow.pill);
  } else {
    ok('the row names a model the machine actually has',
      locals.some((m) => modelsNow.pill.includes(m)), `${modelsNow.pill} vs ${JSON.stringify(locals)}`);
  }
  ok('the manage-models row reports the real local model count',
    modelsNow.manage.includes(wantManage), `${modelsNow.manage} — expected to contain "${wantManage}"`);

  // --- Voice: "ask & propose only" is a kernel claim. Hold the kernel to it.
  const agentApprove = await daemon.agent('/memory/approvals', {
    method: 'POST', body: JSON.stringify({ actionHash: 'f'.repeat(64) }),
  });
  ok.eq('"ask & propose only" is true — a non-owner cannot approve', agentApprove.status, 403);
  ok('the voice-limits row is a statement, not a control',
    (row('voice', 'What voice may do')?.controls.length ?? -1) === 0);

  // --- Security: Tier 4 promises that NO toggle exists. Check that literally.
  ok('Tier 4 offers no toggle, exactly as it says',
    (row('security', 'Tier 4 — payment, biometric export')?.controls.length ?? -1) === 0);
  ok('Telemetry offers no toggle, exactly as it says',
    (row('security', 'Telemetry')?.controls.length ?? -1) === 0);

  // --- Security: the owner-token row reflects this window's real capability.
  const ownerPill = row('security', 'Owner token')?.pills.join(' ') || '';
  ok('the owner-token row reflects the real token', /held/.test(ownerPill), ownerPill);

  /* ============================================================ *
   * 3. PERSISTENCE — choose, reload, and check the daemon-free    *
   *    preferences came back through theme-boot.js                *
   * ============================================================ */

  await showPane('appearance');
  const clickSeg = (label, button) => page.evaluate(([l, b]) => {
    const rows = [...document.querySelectorAll('#settings-modal .set-pane .setrow')];
    const r = rows.find((x) => x.querySelector('.lab')?.textContent.trim() === l);
    const btn = [...r.querySelectorAll('.segsm button')].find((x) => x.textContent.trim() === b);
    btn.click();
  }, [label, button]);
  const clickToggle = (label) => page.evaluate((l) => {
    const rows = [...document.querySelectorAll('#settings-modal .set-pane .setrow')];
    const r = rows.find((x) => x.querySelector('.lab')?.textContent.trim() === l);
    r.querySelector('.toggle').click();
  }, label);

  await clickSeg('Theme', 'Light');
  await clickSeg('Density', 'Compact');
  await showPane('general');
  await clickToggle('Reduce motion');
  await clickToggle('Reduce transparency');
  await page.waitForTimeout(200);

  ok.eq('choosing Light applies it immediately', await attr('data-theme'), 'light');
  ok.eq('choosing Compact applies it immediately', await attr('data-density'), 'compact');
  ok.eq('Light is written under the documented key', await ls('zeno-th'), 'light');
  ok.eq('Compact is written under the documented key', await ls('zeno-dn'), 'compact');
  const moBefore = await ls('zeno-mo');
  const flBefore = await ls('zeno-fl');
  ok('reduce-motion was stored', moBefore === '0' || moBefore === '1', String(moBefore));
  ok.eq('reduce-transparency was stored', flBefore, '1');

  await reload();

  ok.eq('Theme survives a full reload', await attr('data-theme'), 'light');
  ok.eq('Density survives a full reload', await attr('data-density'), 'compact');
  ok.eq('and Theme is still the stored value', await ls('zeno-th'), 'light');
  ok.eq('and Density is still the stored value', await ls('zeno-dn'), 'compact');
  ok.eq('Reduce transparency survives a full reload', await attr('data-flat'), '1');
  ok.eq('Reduce motion survives a full reload', await attr('data-reduce'), '1');

  const trace = await page.evaluate(() => window.__prefTrace || []);
  const firstSet = (attrName, value) => trace.find((t) => t.why === attrName && t.value === value);
  const preCss = (attrName, value, what) => {
    const at = firstSet(attrName, value);
    ok(`${what} is resolved before any stylesheet is parsed`,
      !!at && at.sheets === 0,
      at ? JSON.stringify(at) : `${attrName}="${value}" was never applied. trace: ${JSON.stringify(trace.slice(0, 6))}`);
  };
  preCss('data-theme', 'light', 'the saved theme');
  preCss('data-density', 'compact', 'the saved density');
  // An accessibility preference applied after CSS has already let the thing it
  // was set to prevent happen once, which is why these belong with the theme.
  preCss('data-reduce', '1', 'reduce motion');
  preCss('data-flat', '1', 'reduce transparency');

  // The reloaded modal must AGREE with what it restored, not just carry it.
  await showPane('appearance');
  const current = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#settings-modal .set-pane[data-setpane="appearance"] .setrow')];
    const pick = (l) => {
      const r = rows.find((x) => x.querySelector('.lab')?.textContent.trim() === l);
      return [...r.querySelectorAll('.segsm button')].find((b) => b.hasAttribute('aria-current'))?.textContent.trim();
    };
    return { theme: pick('Theme'), density: pick('Density') };
  });
  ok.eq('the Theme row shows the restored choice as current', current.theme, 'Light');
  ok.eq('the Density row shows the restored choice as current', current.density, 'Compact');

  /* ============================================================ *
   * 4. Rows that read the DAEMON — change the daemon, reload,     *
   *    and require the row to have moved with it                  *
   * ============================================================ */

  const added = await daemon.api('/forge/mcp/servers', {
    method: 'POST',
    body: JSON.stringify({ name: 'e2e-settings-probe', transport: 'stdio', command: 'node --version', env: ['E2E_PROBE_KEY'] }),
  });
  ok.eq('the owner can record an MCP server', added.status, 200);

  // Seal exactly one receipt so the Policy row has a real policy hash to read.
  const proposed = await daemon.agent('/memory/propose', {
    method: 'POST',
    body: JSON.stringify({ kind: 'fact', description: 'E2E settings probe', body: 'Sealed so Settings has a policy hash to report.', requestedBy: 'agent:e2e' }),
  });
  ok.eq('the agent could propose', proposed.status, 200);
  const approved = await daemon.api('/memory/approvals', {
    method: 'POST', body: JSON.stringify({ actionHash: proposed.body.preview.actionHash }),
  });
  ok.eq('the owner could approve it', approved.status, 200);

  /* Seed a STALE wake-word consent: `{on:true}` with no disclosure version, the
     shape left behind by an owner who accepted an older, weaker description of
     what the microphone does. bind/voice.js deliberately treats that as expired
     (readWakePref requires disclosure === DISCLOSURE_VERSION) and boots with the
     wake word OFF. Settings must agree with the machine, not with the file. */
  await page.evaluate(() => { try { localStorage.setItem('zeno.voice.wake', JSON.stringify({ on: true })); } catch { /* storage off */ } });

  await reload();

  const state = await daemon.api('/state');
  const newest = state.body.receipts[state.body.receipts.length - 1];
  ok.eq('the approval really sealed a receipt', state.body.receipts.length, 1);

  await showPane('connectors');
  await showPane('security');
  await showPane('account');
  await showPane('voice');
  const after = await page.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('#settings-modal .setrow')) {
      const l = r.querySelector('.lab')?.textContent.trim();
      if (!l) continue;
      out[l] = {
        text: r.textContent.replace(/\s+/g, ' ').trim(),
        pill: [...r.querySelectorAll('.pill')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join(' '),
        sub: (r.querySelector('.sub')?.textContent || '').replace(/\s+/g, ' ').trim(),
        toggle: r.querySelector('.toggle')?.getAttribute('aria-checked') ?? null,
        toggleLive: r.querySelector('.toggle')
          ? r.querySelector('.toggle').getAttribute('aria-disabled') !== 'true'
          : null,
        toggleReason: (r.querySelector('.toggle')?.getAttribute('title') || '').trim(),
      };
    }
    return out;
  });

  ok.eq('the MCP row counts what the daemon actually recorded', after['MCP servers']?.pill, '1 configured');
  ok('the Customize row names the recorded server',
    (after['Customize hub']?.sub || '').includes('e2e-settings-probe'), after['Customize hub']?.sub);
  ok('the MCP row never shows an environment variable VALUE',
    !(after['MCP servers']?.text || '').includes('E2E_PROBE_KEY'), after['MCP servers']?.text);

  ok('the Policy row reads the hash off the sealed receipt',
    (after['Policy']?.pill || '').includes(String(newest.policyHash).slice(0, 4)),
    `${after['Policy']?.pill} vs ${newest.policyHash}`);

  const mesh = await daemon.api('/mesh/devices');
  const dev = mesh.body.thisDevice;
  ok('the Device key row shows this machine, not a fixture',
    (after['Device key']?.pill || '').includes(dev.host) && (after['Device key']?.pill || '').includes(String(dev.publicKey).slice(0, 4)),
    `${after['Device key']?.pill} vs ${dev.host} / ${String(dev.publicKey).slice(0, 8)}`);

  /* --- Wake word.
     This row is real in both directions, but bind/voice.js owns it, not
     bind/settings.js: voice.js re-detaches the same node on `zeno:bound` and
     wires it to turnWakeOn()/disarmWake(). Two things are therefore checkable
     here with no microphone, and both are real effects:
       (a) a stale consent must NOT come back as ON, and
       (b) the switch must be gated on a real speech engine.
     Actually ARMING the wake word is not checkable here — see the engine check
     below, and the BLOCKED note at the end of this flow. */
  ok.eq('a stale wake-word consent does not come back as ON', after['Wake word']?.toggle, 'false');
  ok('while a speech engine exists the switch is live, so a wake word can be turned off',
    after['Wake word']?.toggleLive === true, JSON.stringify(after['Wake word']));

  await clickSeg('Theme', 'System');
  await page.waitForTimeout(150);

  /* Take the speech engine away for the final reload. This is the only way to
     prove, without a microphone, that the Wake word switch is gated on the real
     engine rather than on ui.js's generic `.toggle` handler — which would go on
     flipping aria-checked just as happily with no engine at all. */
  await page.addInitScript(() => {
    try {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    } catch { /* leaving it in place only makes the check below stricter */ }
  });

  await reload();

  ok.eq('System theme survives a reload as a real stored choice', await ls('zeno-th'), 'system');
  ok.eq('and System means the OS decides — no forced attribute', await attr('data-theme'), null);
  ok.eq('Density was not disturbed by the theme change', await attr('data-density'), 'compact');

  await showPane('voice');
  const wakeRow = await page.evaluate(() => {
    const r = [...document.querySelectorAll('#settings-modal .setrow')]
      .find((x) => x.querySelector('.lab')?.textContent.trim() === 'Wake word');
    const t = r.querySelector('.toggle');
    return {
      engine: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      checked: t.getAttribute('aria-checked'),
      live: t.getAttribute('aria-disabled') !== 'true',
      reason: (t.getAttribute('title') || '').trim(),
    };
  });
  ok('the speech engine really was removed for this check', wakeRow.engine === false);
  ok.eq('the wake word is off with no engine', wakeRow.checked, 'false');
  ok('with no speech engine the switch is visibly disabled and says why, instead of flipping for nothing',
    wakeRow.live === false && wakeRow.reason.length > 12, JSON.stringify(wakeRow));

  /* An ACCEPTED wake-word consent must survive a reload like every other
     preference in this modal. Written here in exactly the shape bind/voice.js
     writes it, and checked with the speech engine removed so nothing arms a
     microphone this flow has no way to speak into — which isolates the one
     thing under test: whether navigating away destroys a stored consent.
     It did: `pagehide` called disarmWake(), which unconditionally wrote the
     preference off, so bind()'s restore branch could never fire and the row
     read OFF after every reload however the owner had set it. */
  await page.evaluate(() => {
    try { localStorage.setItem('zeno.voice.wake', JSON.stringify({ on: true, disclosure: 4, engine: 'browser' })); } catch { /* storage off */ }
  });
  await reload();
  const keptConsent = await ls('zeno.voice.wake');
  ok('an accepted wake-word consent survives a reload',
    typeof keptConsent === 'string' && JSON.parse(keptConsent).on === true, String(keptConsent));

  /* ============================================================ *
   * 5. The rows whose "value" is a NAVIGATION — assert it happens *
   * ============================================================ */

  await showPane('account');
  await page.evaluate(() => {
    const a = [...document.querySelectorAll('#settings-modal .set-tos a')][0];
    if (a) a.click();
  });
  await page.waitForTimeout(250);
  const securityShown = await page.evaluate(() => {
    const m = document.getElementById('settings-modal');
    return !m.hidden && !!m.querySelector('.set-pane[data-setpane="security"].on');
  });
  ok('"Review the security model" opens the security model — in this modal, where it lives', securityShown);

  await openSettings();
  await showPane('connectors');
  await page.evaluate(() => document.querySelector('#settings-modal [data-set-customize]')?.click());
  await page.waitForTimeout(400);
  const onCustomize = await page.evaluate(() =>
    !!document.querySelector('section.screen[data-screen="customize"].on, .screen[data-screen="customize"].on'));
  ok('"Open Customize" actually navigates to Customize', onCustomize);

  await openSettings();
  await showPane('models');
  await page.evaluate(() => document.querySelector('#settings-modal [data-set-managemodels]')?.click());
  await page.waitForTimeout(500);
  const onForge = await attr('data-zeno-surface');
  ok.eq('"Open model manager" actually switches to Forge, where models are managed', onForge, 'forge');

  /* ============================================================ *
   * 6. The Telemetry row's own claim                              *
   * ============================================================ */

  ok('nothing in this window talked to anything but this daemon',
    offMachine.length === 0, JSON.stringify([...new Set(offMachine)]));
}
