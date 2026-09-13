/*
 * Forge's editor has to be a REAL editor, and a save has to be a PROPOSAL.
 *
 * Two things regressed when Forge was rebuilt on the design artifact, and both
 * are the kind of thing a screenshot cannot tell you about:
 *
 *   1. THE EDITOR. The artifact shipped a `<pre id="vs-code">` holding eleven
 *      hardcoded lines of somebody else's App.tsx, four decorative tabs, and a
 *      fabricated held diff in the second pane. It looks exactly like an editor.
 *      It cannot open a file. Monaco — VS Code's own editor core, vendored onto
 *      this machine — was restored once already, so this flow pins it hard:
 *      window.monaco is really there, every VISIBLE group hosts exactly one
 *      real editor instance (and the mock pre is gone), the buffer is byte-for-
 *      byte what GET /forge/file answered, tabs open and close, and typing
 *      marks the tab dirty.
 *
 *   2. THE SAVE. An editor that writes to disk when you press Ctrl+S is the one
 *      thing Zeno may never ship. Every save crosses POST /previews — the same
 *      gate an agent's write crosses. So this flow saves twice: once on an
 *      ordinary file (routine, so the kernel commits it and seals a receipt)
 *      and once on a sensitive one (held, so NOTHING reaches disk and a capsule
 *      waits for the owner). The second is the safety assertion: the bytes on
 *      disk are re-read afterwards and must be untouched.
 *
 * The sandbox starts empty, so the flow seeds it through the product's own
 * governed routes (POST /previews, POST /approvals, POST /forge/commit) rather
 * than reaching around the daemon to write files itself. That way the Explorer
 * tree it then asserts on is git's own answer about a real repository.
 */

export const id = 'forge-editor';
export const title = 'Forge opens real files in the real Monaco editor, and a save is a proposal';
export const criteria = ['SUITE-AC-02', 'forge: real editor', 'forge: a save is governed'];

/* The artifact's hardcoded file tree. None of these paths exist in the sandbox,
   so any one of them on screen is fabricated state wearing real state's clothes. */
const ARTIFACT_FILES = [
  'App.tsx', 'ingest.ts', 'kernel.ts', 'Capsule.tsx', 'Receipt.tsx',
  'types.ts', 'ingest.spec.ts', 'README.md', 'AGENTS.md', 'package.json',
];

const GREETING = `export function greeting(name: string): string {
  // ZENO-E2E-REAL-BYTES — this line only exists in the seeded sandbox.
  return \`hello, \${name}\`;
}
`;

const SECOND = `export const SECOND_FILE_MARKER = 'ZENO-E2E-SECOND';
`;

const TSCONFIG = `{
  "compilerOptions": { "strict": true }
}
`;

export async function run({ daemon, page, ok, network }) {
  /* ---------------------------------------------------------------- *
   * 0 · seed the sandbox through the governed routes, then commit      *
   * ---------------------------------------------------------------- */
  const propose = (relPath, contents) => daemon.api('/previews', {
    method: 'POST',
    body: JSON.stringify({ relPath, contents, summary: `e2e seed: ${relPath}`, requestedBy: 'e2e-seed' }),
  });

  const a = await propose('src/greeting.ts', GREETING);
  const b = await propose('src/second.ts', SECOND);
  ok('the seed writes were accepted', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
  ok('an ordinary new file is routine, so the kernel applies and receipts it',
    !!(a.body && a.body.receipt) && !!(b.body && b.body.receipt),
    JSON.stringify({ a: a.body && a.body.preview, b: b.body && b.body.preview }));

  // tsconfig.json is configuration: the kernel holds it rather than applying it.
  // That is the whole point of seeding it — it gives the save test below a path
  // whose edit can never be a silent write.
  const t = await propose('tsconfig.json', TSCONFIG);
  ok('a config file is held rather than applied', t.status === 200 && !(t.body && t.body.receipt), JSON.stringify(t.body && t.body.preview));
  const seedApproved = await daemon.api('/approvals', {
    method: 'POST',
    body: JSON.stringify({ actionHash: t.body.preview.actionHash }),
  });
  ok.eq('the owner can approve the seed', seedApproved.status, 200);

  const committed = await daemon.api('/forge/commit', {
    method: 'POST',
    body: JSON.stringify({ message: 'e2e: seed the sandbox' }),
  });
  ok.eq('the seeded files can be committed, so git tracks them', committed.status, 200);

  const status = await daemon.api('/forge/status');
  const tracked = (status.body && status.body.tracked) || [];
  ok('git now tracks the three seeded files',
    ['src/greeting.ts', 'src/second.ts', 'tsconfig.json'].every((p) => tracked.includes(p)),
    JSON.stringify(tracked));

  const baseline = await daemon.api('/state');
  const receiptsBefore = baseline.body.receipts.length;
  const pendingBefore = baseline.body.pending.length;
  ok.eq('nothing is left held after seeding', pendingBefore, 0);

  /* ---------------------------------------------------------------- *
   * 1 · open Forge and make it re-read the sandbox                     *
   * ---------------------------------------------------------------- */
  await page.click('[data-product="forge"]');
  await page.waitForTimeout(400);
  // The SANDBOX header's actions only exist on hover (`.vssect:hover .vsvh-a`),
  // so this is the real gesture: hover the section, then click its Refresh.
  const sandboxSect = '#ide .vsside .vsview[data-vsview="explorer"] .vssect.open';
  await page.hover(sandboxSect);
  await page.click(`${sandboxSect} button[title="Refresh"]`);

  // The primary group auto-opens the first tracked file. Waiting for the real
  // editor to be MOUNTED (not merely for monaco to exist) is what makes every
  // assertion below about the thing the owner is actually looking at.
  const mounted = await page.waitForFunction(
    () => !!window.monaco && !!window.monaco.editor
      && document.querySelectorAll('#ide .vsbody .vspane .edmon > .monaco-editor').length > 0,
    { timeout: 45_000 },
  ).then(() => true).catch(() => false);
  ok('the real Monaco editor mounts', mounted, 'no .monaco-editor appeared inside a Forge group within 45s');
  if (!mounted) {
    const why = await page.evaluate(() => (document.querySelector('.vsed .edaux')?.textContent || '').slice(0, 300));
    ok('…and the pane says why', false, why);
    return;
  }

  /* ---------------------------------------------------------------- *
   * 2 · the Explorer tree is git's answer, not the artifact's fixture  *
   * ---------------------------------------------------------------- */
  const tree = await page.$$eval('#ide .vsside .vsview[data-vsview="explorer"] .vstree [data-file]',
    (els) => els.map((e) => e.dataset.file));
  const expected = [...new Set([...tracked, ...((status.body.changed) || []).map((c) => c.path)])].sort();
  ok('the Explorer lists exactly the files the daemon reported',
    JSON.stringify([...tree].sort()) === JSON.stringify(expected),
    `tree=${JSON.stringify(tree)} daemon=${JSON.stringify(expected)}`);
  ok('and none of the artifact\'s sample files survive in it',
    !tree.some((p) => ARTIFACT_FILES.includes(p.split('/').pop())),
    JSON.stringify(tree));

  /* ---------------------------------------------------------------- *
   * 3 · the editor: one real instance per visible group, real bytes    *
   * ---------------------------------------------------------------- */
  const groupsOf = () => page.evaluate(() => {
    const panes = [...document.querySelectorAll('#ide .vsbody .vspane')];
    return {
      visible: panes.filter((p) => !p.hidden).map((p) => ({
        instances: p.querySelectorAll('.edmon > .monaco-editor').length,
        mockPre: p.querySelectorAll('#vs-code, pre.fcode').length,
      })),
      hidden: panes.filter((p) => p.hidden).length,
      apiEditors: window.monaco.editor.getEditors().length,
    };
  });

  const g1 = await groupsOf();
  ok.eq('one group is visible to start', g1.visible.length, 1);
  ok('every visible group hosts exactly one real editor instance',
    g1.visible.every((v) => v.instances === 1), JSON.stringify(g1.visible));
  ok('the artifact\'s fake code pane is gone from every visible group',
    g1.visible.every((v) => v.mockPre === 0), JSON.stringify(g1.visible));
  ok.eq('monaco itself agrees there is exactly one editor', g1.apiEditors, 1);

  ok('the window really fetched the file over /forge/file',
    network.some((n) => n === 'GET /forge/file'), JSON.stringify([...new Set(network)].slice(0, 40)));

  const onDisk = await daemon.api(`/forge/file?path=${encodeURIComponent('src/greeting.ts')}`);
  const opened = await page.evaluate(() => {
    const ed = window.monaco.editor.getEditors()[0];
    const model = ed.getModel();
    return {
      uri: String(model.uri),
      value: model.getValue(window.monaco.editor.EndOfLinePreference.LF),
      language: model.getLanguageId(),
      lines: model.getLineCount(),
    };
  });
  ok('the open buffer is byte-for-byte what GET /forge/file answered',
    opened.value === onDisk.body.contents,
    `editor=${JSON.stringify(opened.value.slice(0, 120))} daemon=${JSON.stringify(String(onDisk.body.contents).slice(0, 120))}`);
  ok('and it is the seeded file, not a sample buffer',
    opened.value.includes('ZENO-E2E-REAL-BYTES') && !/createIngestClient/.test(opened.value),
    opened.value.slice(0, 160));
  ok.eq('monaco typed the model from the real path', opened.language, 'typescript');

  const tabsOf = () => page.evaluate(() => ({
    real: [...document.querySelectorAll('.vsed .vstabs .vstab[data-real-tab]')].map((t) => ({
      path: t.dataset.realTab,
      selected: t.getAttribute('aria-selected') === 'true',
      dirty: !t.querySelector('.vsdirty')?.hidden,
    })),
    mock: document.querySelectorAll('.vsed .vstabs .vstab[data-vstab]').length,
  }));

  const t1 = await tabsOf();
  ok.eq('the artifact\'s four decorative tabs are gone', t1.mock, 0);
  ok.eq('exactly one real tab is open', t1.real.length, 1);
  ok.eq('and it is the file on screen', t1.real[0].path, 'src/greeting.ts');

  /* ---------------------------------------------------------------- *
   * 4 · a tab can be opened, and closed                                *
   * ---------------------------------------------------------------- */
  await page.click('#ide .vstree [data-file="src/second.ts"]');
  await page.waitForFunction(
    () => document.querySelectorAll('.vsed .vstabs .vstab[data-real-tab]').length === 2,
    { timeout: 15_000 },
  ).catch(() => {});
  const t2 = await tabsOf();
  ok.eq('opening a second file opens a second tab', t2.real.length, 2);
  ok('the newly opened tab is the selected one',
    (t2.real.find((x) => x.path === 'src/second.ts') || {}).selected === true, JSON.stringify(t2.real));

  // The tab appears the moment it is opened; its bytes arrive one /forge/file
  // round trip later (the pane says "Reading …" meanwhile). So wait for the
  // model to actually BE that file rather than reading whatever is mounted.
  await page.waitForFunction(
    () => /second\.ts$/.test(String(window.monaco.editor.getEditors()[0].getModel()?.uri || '')),
    { timeout: 15_000 },
  ).catch(() => {});
  const secondBuffer = await page.evaluate(() => {
    const ed = window.monaco.editor.getEditors()[0];
    return ed.getModel().getValue(window.monaco.editor.EndOfLinePreference.LF);
  });
  ok('the second file shows its own real bytes', secondBuffer.includes('ZENO-E2E-SECOND'), secondBuffer.slice(0, 120));

  const g2 = await groupsOf();
  ok('opening a second file did not mount a second editor in the same group',
    g2.visible.every((v) => v.instances === 1) && g2.apiEditors === 1, JSON.stringify(g2));

  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('.vsed .vstabs .vstab[data-real-tab]')]
      .find((t) => t.dataset.realTab === 'src/second.ts');
    [...tab.querySelectorAll('.x')].pop().click();
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.vsed .vstabs .vstab[data-real-tab]').length === 1,
    { timeout: 15_000 },
  ).catch(() => {});
  const t3 = await tabsOf();
  ok.eq('closing a tab closes it', t3.real.length, 1);
  ok.eq('and the remaining file takes the editor back', t3.real[0] && t3.real[0].path, 'src/greeting.ts');
  const backToFirst = await page.evaluate(() =>
    window.monaco.editor.getEditors()[0].getModel().getValue(window.monaco.editor.EndOfLinePreference.LF));
  ok('the editor really re-mounted the remaining file', backToFirst.includes('ZENO-E2E-REAL-BYTES'), backToFirst.slice(0, 120));

  /* ---------------------------------------------------------------- *
   * 5 · a real keystroke marks the tab dirty — and touches no disk     *
   * ---------------------------------------------------------------- */
  await page.click('#ide .vsbody .vspane:not([hidden]) .edmon .view-lines');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('// zeno-e2e-edit');
  await page.waitForFunction(
    () => !document.querySelector('.vsed .vstabs .vstab[data-real-tab="src/greeting.ts"] .vsdirty')?.hidden,
    { timeout: 10_000 },
  ).catch(() => {});

  const t4 = await tabsOf();
  ok('typing marks the tab dirty', (t4.real[0] || {}).dirty === true, JSON.stringify(t4.real));
  const edited = await page.evaluate(() =>
    window.monaco.editor.getEditors()[0].getModel().getValue(window.monaco.editor.EndOfLinePreference.LF));
  ok('the keystrokes reached the real buffer', edited.includes('// zeno-e2e-edit'), edited.slice(-80));

  const stillClean = await daemon.api(`/forge/file?path=${encodeURIComponent('src/greeting.ts')}`);
  ok('an unsaved edit has written nothing to the sandbox',
    stillClean.body.contents === onDisk.body.contents, JSON.stringify(String(stillClean.body.contents).slice(-80)));

  /* ---------------------------------------------------------------- *
   * 6 · Save is a PROPOSAL. Routine edit: the kernel commits, receipts *
   * ---------------------------------------------------------------- */
  const saveBtn = '.vsed .vsblame button.laction';
  const saveLabel = await page.$eval(saveBtn, (b) => ({ text: b.textContent.trim(), disabled: b.disabled })).catch(() => null);
  ok('a dirty buffer offers a live save control', saveLabel && saveLabel.disabled === false, JSON.stringify(saveLabel));
  ok.eq('and it says what it does — proposes, never writes', saveLabel && saveLabel.text, 'Propose save');

  await page.click(saveBtn);
  const sealed = await page.waitForFunction(
    () => !document.querySelector('.vsed .vstabs .vstab[data-real-tab="src/greeting.ts"] .vsdirty')
      || document.querySelector('.vsed .vstabs .vstab[data-real-tab="src/greeting.ts"] .vsdirty').hidden,
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);
  ok('a routine save settles the buffer', sealed, 'the tab was still dirty 20s after Propose save');

  ok('the save went through POST /previews, the governed gate',
    network.some((n) => n === 'POST /previews'), JSON.stringify([...new Set(network)].filter((n) => n.includes('previews'))));

  const afterRoutine = await daemon.api('/state');
  ok.eq('the routine save sealed exactly one receipt', afterRoutine.body.receipts.length, receiptsBefore + 1);
  ok('the receipt chain still verifies', afterRoutine.body.chain.ok === true, JSON.stringify(afterRoutine.body.chain));
  const savedFile = await daemon.api(`/forge/file?path=${encodeURIComponent('src/greeting.ts')}`);
  ok('and only then does the sandbox carry the edit',
    String(savedFile.body.contents).includes('// zeno-e2e-edit'), String(savedFile.body.contents).slice(-90));

  /* ---------------------------------------------------------------- *
   * 7 · Save is a PROPOSAL. Sensitive file: HELD, and disk is untouched *
   * ---------------------------------------------------------------- */
  const configBefore = await daemon.api(`/forge/file?path=${encodeURIComponent('tsconfig.json')}`);
  await page.click('#ide .vstree [data-file="tsconfig.json"]');
  await page.waitForFunction(
    () => window.monaco.editor.getEditors()[0].getModel()
      && /tsconfig\.json$/.test(String(window.monaco.editor.getEditors()[0].getModel().uri)),
    { timeout: 15_000 },
  ).catch(() => {});
  await page.click('#ide .vsbody .vspane:not([hidden]) .edmon .view-lines');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('// zeno-e2e-config-edit');
  await page.waitForFunction(
    () => !document.querySelector('.vsed .vstabs .vstab[data-real-tab="tsconfig.json"] .vsdirty')?.hidden,
    { timeout: 10_000 },
  ).catch(() => {});

  const receiptsBeforeHold = (await daemon.api('/state')).body.receipts.length;
  await page.click(saveBtn);
  const held = await page.waitForFunction(
    () => /held for approval/i.test(document.querySelector('.vsed .vsblame')?.textContent || ''),
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);
  ok('a save that touches configuration is reported as HELD, not as saved', held,
    await page.evaluate(() => (document.querySelector('.vsed .vsblame')?.textContent || '').slice(0, 200)));

  const afterHold = await daemon.api('/state');
  const capsule = afterHold.body.pending.find((p) => p.payload && p.payload.relPath === 'tsconfig.json');
  ok('the daemon is holding a capsule for that exact file', !!capsule,
    JSON.stringify(afterHold.body.pending.map((p) => p.payload && p.payload.relPath)));
  ok('the capsule says the Forge editor proposed it',
    !!capsule && /Forge editor: edit tsconfig\.json/.test(capsule.summary), capsule && capsule.summary);
  ok('the capsule carries the edited bytes, so the owner decides on what was typed',
    !!capsule && String(capsule.payload.contents).includes('// zeno-e2e-config-edit'),
    capsule && String(capsule.payload.contents).slice(-80));

  const configAfter = await daemon.api(`/forge/file?path=${encodeURIComponent('tsconfig.json')}`);
  ok('NOTHING reached disk — the sandbox file is byte-for-byte unchanged',
    configAfter.body.contents === configBefore.body.contents,
    `after=${JSON.stringify(String(configAfter.body.contents).slice(-80))}`);
  ok.eq('a hold seals no receipt — a receipt records an effect', afterHold.body.receipts.length, receiptsBeforeHold);
  const t5 = await tabsOf();
  ok('the tab stays dirty while its save waits on the owner',
    (t5.real.find((x) => x.path === 'tsconfig.json') || {}).dirty === true, JSON.stringify(t5.real));

  /* ---------------------------------------------------------------- *
   * 8 · split: a second VISIBLE group gets its own single instance     *
   * ---------------------------------------------------------------- */
  await page.click('#vs-split');
  await page.waitForFunction(
    () => document.querySelectorAll('#ide .vsbody .vspane:not([hidden]) .edmon > .monaco-editor').length === 2,
    { timeout: 30_000 },
  ).catch(() => {});
  const g3 = await groupsOf();
  ok.eq('splitting shows a second group', g3.visible.length, 2);
  ok('each visible group hosts exactly one real editor instance',
    g3.visible.length === 2 && g3.visible.every((v) => v.instances === 1), JSON.stringify(g3.visible));
  ok.eq('monaco agrees there are two editors', g3.apiEditors, 2);
  ok('and the artifact\'s fabricated held diff is gone from the second pane',
    !(await page.evaluate(() => /INGEST-12/.test(document.querySelector('#vs-pane2')?.textContent || ''))));

  await page.click('#vs-split');
  await page.waitForTimeout(500);
  const g4 = await groupsOf();
  ok.eq('unsplitting hides the second group again', g4.visible.length, 1);
  ok('the primary group still hosts exactly one editor',
    g4.visible.every((v) => v.instances === 1), JSON.stringify(g4.visible));

  /* ---------------------------------------------------------------- *
   * 9 · no fabricated state anywhere on this screen                    *
   * ---------------------------------------------------------------- */
  // textContent, not innerText: a fabricated run log sitting behind a panel tab
  // is one click from being read as real state, so "it is not visible right now"
  // is not an answer.
  const fixtures = await page.evaluate(() => {
    const text = (sel) => (document.querySelector(sel)?.textContent || '');
    const hay = `${text('#ide .vsside')}\n${text('.vsed')}`;
    const marks = [
      'INGEST-12', 'wt-7f2a', '142 passed', 'createIngestClient',
      'Abheet Isher, 2 hours ago', 'Rotate the ingest token', 'ingest.spec.ts',
    ];
    return marks.filter((m) => hay.includes(m));
  });
  ok('the Forge editor and Explorer carry no artifact fixture',
    fixtures.length === 0, `still on screen: ${JSON.stringify(fixtures)}`);

  // The Ports tab still counted three ports after the panel below it was cut
  // down to the one port this page can actually observe. A badge is state too.
  const portsTab = await page.evaluate(() => {
    const tab = document.querySelector('.vsptabs [data-vsp="ports"]');
    const rows = document.querySelectorAll('.vsp[data-vsp="ports"] .fchg').length;
    return { badge: (tab?.querySelector('.fct')?.textContent || '').trim(), rows };
  });
  ok('the Ports tab badge matches the ports actually listed',
    portsTab.badge === '' || portsTab.badge === String(portsTab.rows),
    `badge="${portsTab.badge}" rows=${portsTab.rows}`);

  // The sidebar's Testing view shipped a green suite nobody ran. What it says
  // now has to be GET /forge/tests's own answer about THIS sandbox.
  const catalog = await daemon.api('/forge/tests');
  await page.click('#ide .vsact [data-vsview="testing"]');
  await page.waitForFunction(
    () => !/Open this view|Reading the sandbox/.test(document.querySelector('.vsside .vsview[data-vsview="testing"] .vspad')?.textContent || ''),
    { timeout: 15_000 },
  ).catch(() => {});
  const testing = await page.evaluate(() => ({
    text: (document.querySelector('.vsside .vsview[data-vsview="testing"] .vspad')?.textContent || '').replace(/\s+/g, ' ').trim(),
    runAll: !!document.querySelector('.vsside .vsview[data-vsview="testing"] button[title="Run All Tests"]'),
  }));
  ok.eq('the daemon discovered no runnable script in this sandbox', (catalog.body.scripts || []).length, 0);
  ok('so the Testing view says there is nothing to run, instead of claiming a pass',
    /nothing here to run/i.test(testing.text) && !/142 passed|ingest\.spec/.test(testing.text), testing.text.slice(0, 220));
  ok('and the "Run All Tests" control, which has no route behind it, is gone', testing.runAll === false);
}
