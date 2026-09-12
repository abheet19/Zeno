/*
 * The loop this whole product exists for:
 *   an agent proposes -> it is HELD -> the agent cannot approve its own effect
 *   -> the owner approves in the window -> exactly one effect -> a sealed
 *   receipt on a verified chain -> the same approval cannot be replayed.
 *
 * Every step is exercised against a real daemon through the real window. If
 * any single one of these stops being true, Zeno is not what it claims to be.
 */

export const id = 'governed-loop';
export const title = 'Agent proposes, owner approves, one effect, sealed receipt';
export const criteria = ['SUITE-AC-02', 'kernel: one-attempt', 'kernel: no self-approval'];

export async function run({ daemon, page, ok }) {
  const clean = await daemon.api('/state');
  ok.eq('starts with an empty ledger', clean.body.receipts.length, 0);
  ok.eq('starts with nothing held', clean.body.pending.length, 0);

  // --- an AGENT proposes two memory writes (T1 by policy, so both must hold)
  const mk = (d, b) => daemon.agent('/memory/propose', {
    method: 'POST',
    body: JSON.stringify({ kind: 'fact', description: d, body: b, requestedBy: 'agent:e2e' }),
  });
  const refuse = await mk('E2E refusal', 'This must never be written.');
  const accept = await mk('E2E approval', 'This is approved once and sealed.');
  ok('agent may propose', refuse.status === 200 && accept.status === 200, `${refuse.status}/${accept.status}`);
  ok('a T1 proposal is HELD, not applied', refuse.body.pending === true && accept.body.pending === true);
  ok.eq('policy rates a memory write T1', accept.body.preview.tier, 'T1');

  // --- the agent must not be able to approve what it proposed
  const selfApprove = await daemon.agent('/memory/approvals', {
    method: 'POST',
    body: JSON.stringify({ actionHash: accept.body.preview.actionHash }),
  });
  ok.eq('an agent cannot approve its own effect', selfApprove.status, 403);
  ok.eq('and is told why', selfApprove.body.error.code, 'self-approval-forbidden');

  // --- both appear on the owner's Approvals screen, with live controls
  await page.click('.nav-i[data-screen="approvals"]');
  await page.waitForTimeout(1200);
  const cards = await page.$$eval('.screen[data-screen="approvals"] .caps', (els) => els.map((c) => ({
    text: c.textContent.replace(/\s+/g, ' ').slice(0, 90),
    buttons: [...c.querySelectorAll('.caps-acts button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
  })));
  ok.eq('both held actions are on screen', cards.length, 2);
  ok('every held action offers a live Allow and a live Deny',
    cards.every((c) => c.buttons.length >= 2 && c.buttons.every((b) => !b.disabled)),
    JSON.stringify(cards.map((c) => c.buttons)));

  // --- REFUSE one, from the window
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.screen[data-screen="approvals"] .caps')].find((x) => /refusal/.test(x.textContent));
    c.querySelector('.caps-acts button.dz').click();
  });
  await page.waitForTimeout(1500);
  const afterDeny = await daemon.api('/state');
  const memAfterDeny = await daemon.api('/memory');
  ok.eq('a refusal removes it from the queue', afterDeny.body.pending.length, 1);
  ok.eq('a refusal writes nothing', memAfterDeny.body.notes.length, 0);
  ok.eq('a refusal seals no receipt — a receipt records an effect', afterDeny.body.receipts.length, 0);

  // --- APPROVE the other, from the window
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.screen[data-screen="approvals"] .caps')].find((x) => /approval/.test(x.textContent));
    c.querySelector('.caps-acts button.p').click();
  });
  await page.waitForTimeout(2500);
  const afterAllow = await daemon.api('/state');
  const memAfter = await daemon.api('/memory');
  ok.eq('approval applies exactly one effect', memAfter.body.notes.length, 1);
  ok.eq('the approved note is the one approved', memAfter.body.notes[0].title, 'E2E approval');
  ok.eq('approval seals exactly one receipt', afterAllow.body.receipts.length, 1);
  ok.eq('the queue is empty', afterAllow.body.pending.length, 0);
  ok('the receipt chain verifies', afterAllow.body.chain.ok === true, JSON.stringify(afterAllow.body.chain));
  ok.eq('the receipt records the outcome', afterAllow.body.receipts[0].outcome, 'verified');

  // --- the same approval cannot be replayed
  const replay = await daemon.api('/memory/approvals', {
    method: 'POST',
    body: JSON.stringify({ actionHash: accept.body.preview.actionHash }),
  });
  ok.eq('one approval is one attempt', replay.status, 404);
  const afterReplay = await daemon.api('/memory');
  ok.eq('a replay applies no second effect', afterReplay.body.notes.length, 1);
}
