/*
 * The Standing Field — the orb on Command's home.
 *
 * Reported as "clicking orb should make something happen, it doesn't work".
 * It was broken in three places at once, all from the artifact lift: the
 * canvas had no node-card host to render into, so a picked node drew nothing;
 * the card's "Open Forge" button looked up [data-nav], which the shipped markup
 * does not use; and its "Open the Vault" button used section ids from the
 * previous renderer. Selecting worked the whole time — nothing downstream of it
 * did.
 *
 * So this asserts the whole chain: the field paints, a node can be picked, the
 * card describes it, and the card's action actually navigates.
 */

export const id = 'orb';
export const title = 'The Standing Field paints, picks a node, and its actions navigate';
export const criteria = ['GAP-VISUAL-MATRIX'];

export async function run({ daemon, page, ok }) {
  await page.click('.nav-i[data-screen="home"]');
  await page.waitForTimeout(2500);

  const canvas = await page.evaluate(() => {
    const w = document.querySelector('.orb-wrap');
    const c = w && w.querySelector('canvas');
    if (!c) return null;
    return { attrW: c.width, attrH: c.height, cssW: c.clientWidth, cssH: c.clientHeight, host: !!w.querySelector('[data-mount="node-card"]') };
  });
  ok('the field canvas is mounted', canvas !== null);
  ok('the canvas is sized to its container, not left at the 300x150 default',
    canvas && canvas.attrW > 400 && canvas.attrH > 200, JSON.stringify(canvas));
  ok('a node-card host exists for a picked node', canvas && canvas.host === true);

  // It must actually PAINT, not merely be sized.
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.orb-wrap canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0, sampled = 0;
    for (let i = 3; i < d.length; i += 4 * 37) { sampled++; if (d[i] > 8) lit++; }
    return { pct: +(100 * lit / sampled).toFixed(2) };
  });
  ok('the field is actually painting', painted.pct > 0.5, `${painted.pct}% of sampled pixels drawn`);

  // Pick a node the way a person does: a pointer press and release on it.
  const picked = await page.evaluate(async () => {
    const c = document.querySelector('.orb-wrap canvas');
    const b = c.getBoundingClientRect();
    // Walk a grid until the canvas reports a hover (cursor turns to pointer).
    for (let gx = 0.15; gx <= 0.85; gx += 0.05) {
      for (let gy = 0.15; gy <= 0.85; gy += 0.05) {
        const x = b.left + b.width * gx, y = b.top + b.height * gy;
        c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
        if (c.style.cursor === 'pointer') {
          c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
          c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
          await new Promise((r) => setTimeout(r, 250));
          const card = document.querySelector('[data-mount="node-card"] .nodecard');
          return card ? { hit: true, text: card.innerText.replace(/\s+/g, ' ').slice(0, 140), actions: [...card.querySelectorAll('button')].map((x2) => x2.textContent.trim()) } : { hit: true, text: null, actions: [] };
        }
      }
    }
    return { hit: false };
  });

  ok('a node in the field can be picked', picked.hit === true, 'no node responded to a pointer anywhere on the canvas');
  if (picked.hit) {
    ok('picking a node renders its card', !!picked.text, 'the card host stayed empty after a pick');
    ok('the card describes what was picked', picked.text && picked.text.length > 20, String(picked.text).slice(0, 120));
    ok('the card offers a way out', picked.actions.includes('Close'), JSON.stringify(picked.actions));
  }

  // Every action the card can offer must resolve to a control that exists.
  const resolvable = await page.evaluate(() => {
    const targets = { forge: '[data-product="forge"]', counsel: '[data-product="counsel"]', command: '[data-product="command"]' };
    const bad = [];
    for (const [name, sel] of Object.entries(targets)) if (!document.querySelector(sel)) bad.push(name);
    for (const screen of ['vault', 'devices', 'home', 'receipts', 'approvals']) {
      if (!document.querySelector(`.nav-i[data-screen="${screen}"]`)) bad.push(`screen:${screen}`);
    }
    return bad;
  });
  ok('every destination the node card can name exists', resolvable.length === 0, resolvable.join(', '));

  // ---- every node, every action --------------------------------------------
  // The owner: "click all orbs in Command's field and see what they open — the
  // qwen node should open Forge with qwen selected; every node should do some
  // action; Go to approvals / Find it in the receipts did nothing." Walk the
  // engine's OWN node list (the same module instance the field runs on), so
  // every kind is exercised rather than whichever pixel a grid walk hits first,
  // and assert where each card's action actually lands.
  const sweep = await page.evaluate(async () => {
    const st = await import('/field/state.js');
    const eng = await import('/field/engine.js');
    const nodes = Array.isArray(st.N) ? st.N : [];
    const c = document.querySelector('.orb-wrap canvas');
    const results = [];
    const home = async () => {
      document.querySelector('.seg [data-product="command"]')?.click();
      document.querySelector('.nav-i[data-screen="home"]')?.click();
      await new Promise((r) => setTimeout(r, 220));
    };
    // Find each node where the PICKER says it is (the engine projects its own
    // positions), by walking the canvas on a fine grid — the way a pointer does.
    // The field keeps turning, so a node is located at CLICK time, not once.
    const locate = (id) => {
      for (let gx = 0.02; gx <= 0.98; gx += 0.02) {
        for (let gy = 0.02; gy <= 0.98; gy += 0.02) {
          const px = c.clientWidth * gx, py = c.clientHeight * gy;
          const h = eng.pick(px, py);
          if (h && h.id === id) return { px, py };
        }
      }
      return null;
    };
    for (const n of [...nodes]) {
      await home();
      const at = locate(n.id);
      if (!at) { results.push({ id: n.id, k: n.k, l: n.l, card: false, unreachable: true, hit: null }); continue; }
      const b = c.getBoundingClientRect();
      const x = b.left + at.px, y = b.top + at.py;
      for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
      await new Promise((r) => setTimeout(r, 220));
      const card = document.querySelector('[data-mount="node-card"] .nodecard');
      const btn = card && card.querySelector('[data-go],[data-jump]');
      const rec = {
        id: n.id, k: n.k, l: n.l, card: !!card, action: btn ? btn.textContent.trim() : null, model: btn ? btn.getAttribute('data-model') : null,
        hit: n.id, cardFor: card ? (card.querySelector('b,.nk,h3,h4')?.textContent || '').trim().slice(0, 30) : null,
      };
      if (btn) {
        btn.click();
        await new Promise((r) => setTimeout(r, 450));
        rec.product = document.querySelector('.product.on')?.getAttribute('data-product') || null;
        rec.screen = document.querySelector('.nav-i[data-screen][aria-current]')?.getAttribute('data-screen') || null;
        if (rec.model) {
          rec.pill = (document.querySelector('#s-model') || {}).textContent || '';
          rec.applyHook = typeof window.zenoApplyForgeModel;
          rec.forgeFailed = (window.__zenoBind?.failed || []).filter((f) => /forge/.test(f.path || f)).map((f) => f.path || f);
          rec.ide = document.querySelector('.ide')?.className;
        }
      }
      results.push(rec);
    }
    await home();
    return results;
  });
  ok('the field exposes its nodes for a full sweep', sweep.length > 0, 'engine.N was empty');
  const noCard = sweep.filter((r) => !r.card);
  ok('every node renders a card when picked', noCard.length === 0, JSON.stringify(noCard.map((r) => ({ id: r.id, unreachable: !!r.unreachable }))));
  // The core is the one node with no destination (it is the gate, not a place),
  // and the agent node for the product already on screen offers no "open" —
  // that button would move nothing (card.js says so).
  const dead = sweep.filter((r) => r.k !== 'core' && !(r.k === 'agent' && /command/i.test(r.l)) && r.card && !r.action);
  ok('every node except the core offers an action', dead.length === 0, JSON.stringify(dead.map((r) => `${r.k}:${r.l}`)));
  const lost = sweep.filter((r) => r.action && !r.product && !r.screen);
  ok('every node action lands somewhere', lost.length === 0, JSON.stringify(lost.map((r) => `${r.k}:${r.action}`)));
  const approvals = sweep.filter((r) => /go to approvals/i.test(r.action || ''));
  ok('"Go to approvals" opens Approvals', approvals.every((r) => r.screen === 'approvals'), JSON.stringify(approvals.map((r) => r.screen)));
  const receipts = sweep.filter((r) => /find it in the receipts/i.test(r.action || ''));
  ok('"Find it in the receipts" opens Receipts', receipts.every((r) => r.screen === 'receipts'), JSON.stringify(receipts.map((r) => r.screen)));
  const models = sweep.filter((r) => r.k === 'model');
  ok('a model node opens Forge with that model selected',
    models.length > 0 && models.every((r) => r.model && r.product === 'forge' && r.pill.includes(r.model)),
    JSON.stringify(models.map((r) => ({ l: r.l, model: r.model, product: r.product, pill: r.pill, hook: r.applyHook, failed: r.forgeFailed, ide: r.ide }))));
}
