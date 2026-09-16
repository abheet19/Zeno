/*
 * Command's conversation. The complaint that produced this flow was literal:
 * "nothing happening on sending a message". The artifact's composer made ZERO
 * network calls, invented a reply, and printed a fabricated activity trace
 * claiming it had read /state and /memory to produce it.
 *
 * So this asserts the two things that distinguish a real assistant from a
 * mock: a request actually leaves the window, and what comes back on screen is
 * what the daemon said — not prose the renderer wrote.
 */

export const id = 'command-ask';
export const title = 'Asking Zeno hits the daemon and renders the real grounded answer';
export const criteria = ['GAP-COMMAND-GROUNDING'];

export async function run({ daemon, page, ok, network, Blocked }) {
  const agents = await daemon.api('/forge/agents?passive=1');
  const locals = agents.body?.localModels || [];
  if (!locals.length) throw new Blocked('no local model is installed — run `ollama pull qwen3:8b` so Command has something to answer with');

  // Warm the model first. The first inference after a fresh daemon loads the
  // model into Ollama's memory, which can take tens of seconds; letting the
  // window's own ask below pay that cold-start makes this flow flaky under load
  // (it passes alone, times out mid-suite). This server-side call absorbs the
  // load so the UI ask we actually time hits a warm model and completes fast.
  // It asserts nothing — the real grounding checks below still go through the
  // window and the daemon exactly as before.
  await daemon.api('/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ question: 'warm-up' }),
  }).catch(() => {});

  await page.click('.nav-i[data-screen="home"]');
  await page.waitForTimeout(400);

  const before = network.filter((n) => n.includes('/assistant/ask')).length;
  await page.fill('#home-ta', 'What is in the sandbox right now?');
  await page.click('#home-send');

  // The composer must show it is working, not sit dead.
  const pending = await page.waitForSelector('#home-turns .turn.z', { timeout: 5000 }).then(() => true).catch(() => false);
  ok('a reply turn appears while the daemon is working', pending);

  await page.waitForFunction(
    () => {
      const t = [...document.querySelectorAll('#home-turns .turn.z')];
      return t.length > 0 && !/Asking Zeno/.test(t[t.length - 1].textContent);
    },
    { timeout: 180_000 },
  ).catch(() => {});

  const asks = network.filter((n) => n === 'POST /assistant/ask').length;
  ok('sending a message actually calls the daemon', asks > before, `POST /assistant/ask seen ${asks} times`);

  const turns = await page.$$eval('#home-turns .turn', (els) => els.map((t) => ({
    who: t.classList.contains('you') ? 'you' : 'zeno',
    text: t.querySelector('.bt')?.innerText || '',
  })));
  ok.eq('the question is echoed as the owner turn', turns[0]?.text.trim(), 'What is in the sandbox right now?');
  const reply = turns.find((t) => t.who === 'zeno')?.text || '';
  ok('a reply is rendered', reply.trim().length > 0, reply.slice(0, 120));

  // The mock's tells. Any of these on screen means the fake path came back.
  ok('no fabricated activity trace', !/read \/state · read \/memory/.test(reply), reply.slice(0, 160));
  ok('no "in the live app" disclaimer', !/In the live app/i.test(reply), reply.slice(0, 160));

  // What the daemon actually returned, compared with what the screen shows.
  const direct = await daemon.api('/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ question: 'What is in the sandbox right now?' }),
  });
  ok.eq('the ask endpoint answers', direct.status, 200);
  ok('the endpoint reports grounding fields', 'cited' in direct.body && 'ungrounded' in direct.body, Object.keys(direct.body || {}).join(','));

  // A grounded answer carries its citation markers onto the screen.
  if (Array.isArray(direct.body.cited) && direct.body.cited.length) {
    ok('a grounded reply shows its sources', /Sources:/.test(reply), reply.slice(-160));
  }

  // Text navigation is deliberately local: it must activate the same product
  // controls as a mouse click and never fall through to a model refusal.
  async function textNavigation(text, product) {
    await page.click('.seg [data-product="command"]');
    await page.click('.nav-i[data-screen="home"]');
    const beforeNavigationAsk = network.filter((n) => n === 'POST /assistant/ask').length;
    await page.fill('#home-ta', text);
    await page.click('#home-send');
    const activated = await page.waitForFunction(
      (name) => document.querySelector(`.seg [data-product="${name}"]`)?.getAttribute('aria-current') === 'page',
      product,
      { timeout: 8_000 },
    ).then(() => true).catch(() => false);
    const afterNavigationAsk = network.filter((n) => n === 'POST /assistant/ask').length;
    ok(`${text} opens ${product} through the real product control`, activated);
    ok(`${text} does not send a model request`, afterNavigationAsk === beforeNavigationAsk,
      `assistant asks before=${beforeNavigationAsk}, after=${afterNavigationAsk}`);
  }

  await textNavigation('go to forge', 'forge');
  await textNavigation('go to counsel', 'counsel');
}
