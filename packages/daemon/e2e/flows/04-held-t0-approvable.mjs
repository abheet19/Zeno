/*
 * A held action must be approvable — whatever its tier.
 *
 * This exists because of a real, reported failure: the owner saw "1 approval"
 * in the rail, opened it, and the Allow button was disabled with "T0 · auto —
 * no decision is owed on this action". The renderer had guessed that every T0
 * action is auto-approved. A T0 write OUTSIDE the sandbox is held, and the
 * kernel said so — {tier:'T0', auto:false} — but the guess overrode the fact,
 * and the owner was locked out of their own decision.
 *
 * The invariant worth pinning is stronger than "T0 is fine": ANYTHING that
 * reaches the queue is, by the queue's own definition, waiting on a human. An
 * auto action commits immediately and never lands here.
 */

export const id = 'held-t0-approvable';
export const title = 'Every action in the queue can actually be decided, at any tier';
export const criteria = ['kernel: held means decidable'];

export async function run({ daemon, page, ok }) {
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  // A local.write OUTSIDE the sandbox is exactly the T0-but-held shape.
  const outside = await daemon.agent('/previews', {
    method: 'POST',
    body: JSON.stringify({
      relPath: '../outside-the-sandbox.txt',
      contents: 'a write beyond the project root\n',
      summary: 'E2E: a T0 action that is still held',
      requestedBy: 'agent:e2e',
    }),
  });

  // Whatever the daemon decides about that path, the rule under test is about
  // what the QUEUE contains — so drive it from /state rather than assuming.
  const st = await daemon.api('/state');
  const held = st.body.pending || [];
  if (!held.length) {
    // Fall back to the queue shape we can always create: a T1 memory write.
    await daemon.agent('/memory/propose', {
      method: 'POST',
      body: JSON.stringify({ kind: 'fact', description: 'E2E decidable', body: 'must be decidable', requestedBy: 'agent:e2e' }),
    });
  }
  const st2 = await daemon.api('/state');
  const queue = st2.body.pending || [];
  ok('something is held', queue.length > 0, `outside-write status ${outside.status}`);

  ok('nothing in the queue is marked auto',
    queue.every((p) => p.auto !== true),
    JSON.stringify(queue.map((p) => ({ tier: p.tier, auto: p.auto }))));

  await page.click('.nav-i[data-screen="approvals"]');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.screen[data-screen="approvals"] .caps').length === expected,
    queue.length,
    { timeout: 5_000 },
  ).catch(() => {});

  const cards = await page.$$eval('.screen[data-screen="approvals"] .caps', (els) => els.map((c) => ({
    tier: c.querySelector('.tier')?.textContent || '',
    buttons: [...c.querySelectorAll('.caps-acts button')].map((b) => ({
      label: b.textContent.trim(), disabled: b.disabled, title: b.title,
    })),
  })));
  const approvalBody = await page.$eval('.screen[data-screen="approvals"] .pbody', (node) => node.textContent || '').catch(() => 'approval body unavailable');
  ok.eq('every held action is on screen', cards.length, queue.length, JSON.stringify({ approvalBody, warnings }));

  for (const c of cards) {
    const allow = c.buttons.find((b) => /Allow/.test(b.label));
    const deny = c.buttons.find((b) => /Deny/.test(b.label));
    ok(`${c.tier}: Allow is clickable`, allow && !allow.disabled, allow ? allow.title : 'no Allow button');
    ok(`${c.tier}: Deny is clickable`, deny && !deny.disabled, deny ? deny.title : 'no Deny button');
    ok(`${c.tier}: no button claims "auto" about a held action`,
      !c.buttons.some((b) => /auto — no decision is owed/.test(b.title || '')),
      JSON.stringify(c.buttons.map((b) => b.title)));
  }
}
