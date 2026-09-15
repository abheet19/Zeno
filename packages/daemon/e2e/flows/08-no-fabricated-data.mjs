/*
 * Nothing invented may reach the screen.
 *
 * The renderer is the design artifact's markup, and that markup ships a
 * complete set of plausible sample data: a ticket called INGEST-12, a worktree
 * wt-7f2a, "7 receipts", a Vault of 12 notes, a backlog of 5. Binders replace
 * each of those with what the daemon actually reports — but a binder that is
 * missing, throws, or simply does not reach one corner leaves the fixture
 * sitting there looking exactly like the owner's own state.
 *
 * That is the single worst failure this product can have. A wrong number on a
 * surface whose entire promise is "every figure here was measured" is worse
 * than no surface. So this walks every screen in all three products on a
 * WORKSPACE THAT IS PROVABLY EMPTY and asserts two things: no artifact fixture
 * survives anywhere, and every count reads as genuinely zero rather than as
 * someone else's busy afternoon.
 */

export const id = 'no-fabricated-data';
export const title = 'On an empty workspace, no screen shows invented state';
export const criteria = ['GAP-VISUAL-MATRIX', 'honesty: measured or absent'];

/* Strings that exist ONLY in the design artifact. Any one of them on screen is
   a fixture that escaped its binder. */
const FIXTURES = [
  'INGEST-12',
  'Rotate the ingest token',
  'patch.task',
  'createIngestClient',
  'wt-7f2a',
  'Scaffold the App shell',
  'Add ingest tests',
  'Bump vitest',
  'Design review — Command home',
  'vault.remember',
  'forge.run — codex',
  'Abheet Isher, 2 hours ago',
];

/* Counts the artifact hardcodes. On an empty workspace every one of these must
   be gone — not merely different, gone. */
const FIXTURE_COUNTS = [
  { re: /\b7\s+receipts\b/, what: '"7 receipts"' },
];

export async function run({ daemon, page, ok }) {
  // Prove the workspace really is empty before judging anything on screen.
  const st = await daemon.api('/state');
  const mem = await daemon.api('/memory');
  const work = await daemon.api('/work');
  ok.eq('the ledger is empty', st.body.receipts.length, 0);
  ok.eq('nothing is held', st.body.pending.length, 0);
  ok.eq('the Vault is empty', mem.body.notes.length, 0);
  ok.eq('the backlog is empty', (work.body.items || []).length, 0);

  // A real installed model may legitimately be qwen3:8b. The honesty claim is
  // that the shipped shell does not invent it before discovery, so inspect the
  // raw HTML rather than rejecting the truthful value the binder later reads.
  const shell = await page.evaluate(async () => {
    const response = await fetch('/', { cache: 'no-store' });
    return response.ok ? await response.text() : '';
  });
  ok('the shipped shell has no hardcoded local-model identity',
    !/data-model-pill[^>]*>[\s\S]{0,200}?qwen3:8b · local/.test(shell),
    'a model name appeared before /forge/agents discovery');

  // The owner sees Command Home before any async binder can finish. Its raw
  // first frame must therefore be neutral: sample approvals, runs and counts
  // cannot be present even briefly and then swept away later.
  const homeShell = shell.split('<!-- ================= CHATS')[0];
  for (const fixture of ['INGEST-12', 'wt-7f2a', '>3</dd>', '>5</dd>', '>12</dd>']) {
    ok(`the first Command frame has no fixture "${fixture}"`, !homeShell.includes(fixture),
      'the raw Home markup painted sample state before daemon binding');
  }
  ok('the first Command frame does not claim a verified ledger',
    !/chain verified|<b>7<\/b> receipts/.test(homeShell),
    'the raw Home markup claimed verification before /state answered');

  const products = ['command', 'forge', 'counsel'];
  for (const product of products) {
    await page.click(`[data-product="${product}"]`);
    await page.waitForTimeout(600);

    const screens = await page.$$eval(
      `.product[data-product="${product}"] .nav-i[data-screen]`,
      (els) => els.map((b) => b.dataset.screen),
    );
    // A product with no rail (Forge, Counsel) is still walked once, as it is.
    const targets = screens.length ? screens : [null];

    for (const screen of targets) {
      if (screen) {
        await page.click(`.product[data-product="${product}"] .nav-i[data-screen="${screen}"]`);
        await page.waitForTimeout(400);
      }
      const label = screen ? `${product} › ${screen}` : product;

      const text = await page.evaluate((p) => {
        const host = document.querySelector(`.product[data-product="${p}"]`);
        if (!host) return '';
        // Only what is actually VISIBLE: a hidden screen's markup is not a lie.
        const visible = [...host.querySelectorAll('.screen, .cnview, .sessview, #ide')]
          .filter((n) => n.offsetParent !== null);
        const scope = visible.length ? visible : [host];
        return scope.map((n) => n.innerText || '').join('\n');
      }, product);

      for (const f of FIXTURES) {
        ok(`${label}: no fixture "${f}"`, !text.includes(f),
          text.split('\n').find((l) => l.includes(f))?.slice(0, 90) || '');
      }
      for (const { re, what } of FIXTURE_COUNTS) {
        ok(`${label}: no hardcoded ${what}`, !re.test(text),
          text.split('\n').find((l) => re.test(l))?.slice(0, 90) || '');
      }
    }
  }

  // The shared chrome carries its own set of invented counts.
  await page.click('[data-product="command"]');
  await page.waitForTimeout(500);
  const badges = await page.$$eval('.rail .nav-i[data-screen] .ct', (els) =>
    els.map((n) => ({ screen: n.closest('.nav-i').dataset.screen, text: n.textContent.trim(), hidden: n.hidden })));

  /* Every rail badge must be blank here. The queues are provably empty, and
     Integrations deliberately carries no badge at all: a catalogue whose size is
     fixed by what is installed never needs attention, and the number the rail
     used to show (the agent count) agreed with nothing the owner could open —
     that screen lists work sources, the local runtime, the agents AND the
     repository skills. A badge that disagrees with the screen it points at is
     the same lie in a smaller space, because it is acted on without opening it. */
  for (const b of badges) {
    ok(`rail badge "${b.screen}" is blank on an empty workspace`, b.text === '' || b.hidden === true,
      `shows "${b.text}"`);
  }

  // Integrations itself must still render its real catalogue, not nothing.
  await page.click('.rail .nav-i[data-screen="integrations"]');
  await page.waitForTimeout(700);
  const cat = await page.evaluate(() => {
    const s = document.querySelector('.screen[data-screen="integrations"]');
    return s ? { cards: s.querySelectorAll('.lcard').length, text: (s.innerText || '').slice(0, 400) } : null;
  });
  ok('the Integrations screen lists a real catalogue', cat && cat.cards > 0, JSON.stringify(cat && cat.cards));
  ok('it names the work sources it actually read',
    !!cat && /local/.test(cat.text) && /not configured|never asked|configured/.test(cat.text),
    (cat && cat.text.slice(0, 160)) || '');

  // The kernel line states the ledger it actually read. innerText concatenates
  // adjacent spans without whitespace, so normalise before matching.
  const kernel = await page.evaluate(() =>
    document.querySelector('.screen[data-screen="home"] .kernel')?.innerText.replace(/\s+/g, ' ') || '');
  ok('the kernel line reports a real, empty ledger', /(^|\D)0 receipts/.test(kernel), kernel.slice(0, 140));
  ok('the kernel line reports the chain honestly',
    /chain verified|chain not reported|chain unread/.test(kernel), kernel.slice(0, 140));
}
