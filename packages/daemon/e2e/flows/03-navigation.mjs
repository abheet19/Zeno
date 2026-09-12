/*
 * "There should not be a no-op button or CTA in the entire app; everything
 * should have meaning."
 *
 * This is the structural half of that: every navigation control in all three
 * products must land on a screen that actually rendered. A rail item that
 * switches to an empty div is a dead end the owner discovers by clicking.
 *
 * It also holds the line on the compound wordmark and the window title, which
 * are how you know WHICH of the three products you are looking at.
 */

export const id = 'navigation';
export const title = 'Every product and rail CTA lands on a real, non-empty screen';
export const criteria = ['SUITE-AC-02', 'GAP-VISUAL-MATRIX'];

const SURFACES = [
  { product: 'command', word: 'Zeno Command' },
  { product: 'forge', word: 'Zeno Forge' },
  { product: 'counsel', word: 'Zeno Counsel' },
];

export async function run({ page, ok }) {
  const bind = await page.evaluate(() => window.__zenoBind || null);
  ok('every binder loaded', bind && bind.failed.length === 0, JSON.stringify(bind && bind.failed));

  for (const s of SURFACES) {
    await page.click(`[data-product="${s.product}"]`);
    await page.waitForTimeout(700);

    const state = await page.evaluate((p) => ({
      surface: document.documentElement.getAttribute('data-zeno-surface'),
      title: document.title,
      wordmark: document.querySelector('.brand .brand-word')?.textContent,
      onProduct: !!document.querySelector(`.product.on[data-product="${p}"]`),
    }), s.product);

    ok.eq(`${s.product}: the surface attribute follows the switch`, state.surface, s.product);
    ok.eq(`${s.product}: the window title names the surface`, state.title, s.word);
    ok.eq(`${s.product}: the wordmark names the surface`, state.wordmark, s.word);
    ok(`${s.product}: its panel is the visible one`, state.onProduct);

    // Every rail item inside THIS product must reach a screen with content.
    const rails = await page.$$eval(
      `.product[data-product="${s.product}"] .nav-i[data-screen]`,
      (els) => els.map((b) => ({ screen: b.dataset.screen, label: b.textContent.trim() })),
    );
    for (const r of rails) {
      await page.click(`.product[data-product="${s.product}"] .nav-i[data-screen="${r.screen}"]`);
      await page.waitForTimeout(450);
      const shown = await page.evaluate((screen) => {
        const el = document.querySelector(`section.screen[data-screen="${screen}"], .screen[data-screen="${screen}"]`);
        if (!el) return { exists: false };
        const box = el.getBoundingClientRect();
        return {
          exists: true,
          visible: el.offsetParent !== null,
          height: Math.round(box.height),
          chars: (el.innerText || '').trim().length,
          placeholders: /Lorem|TODO|coming soon|placeholder/i.test(el.innerText || ''),
        };
      }, r.screen);

      ok(`${s.product} › ${r.screen}: the screen exists`, shown.exists);
      ok(`${s.product} › ${r.screen}: it is actually visible`, shown.visible === true, JSON.stringify(shown));
      ok(`${s.product} › ${r.screen}: it has content`, shown.chars > 40, `${shown.chars} chars`);
      ok(`${s.product} › ${r.screen}: no placeholder text`, shown.placeholders === false);
    }
  }
}
