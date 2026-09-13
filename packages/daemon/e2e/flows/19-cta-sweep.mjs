/*
 * The "verify every CTA" flow.
 *
 * The owner: "test each screen and cta", "make every cta live", "there should
 * not be a no-op button in the entire app." This walks every product and every
 * screen, enumerates every visible control, clicks the safe ones, and records
 * whether the click produced ANY real effect — a network request, a DOM change,
 * a navigation, or an opened menu/modal — or nothing at all. A control that is
 * DISABLED is fine (it honestly says it can't act). A control that looks live
 * and does nothing is the failure this flow exists to catch.
 *
 * It never clicks destructive or outward controls (approve, deny, delete, send,
 * run, commit, …) — those are exercised by their own dedicated flows. The point
 * here is breadth: no dead buttons anywhere.
 */

export const id = 'cta-sweep';
export const title = 'Every visible control does something or is honestly disabled';
export const criteria = ['owner: no no-op CTA anywhere'];

// Never auto-click these — they cause real effects or are covered elsewhere.
const DESTRUCTIVE = /\b(approve|allow|deny|refuse|delete|remove|discard|dismiss|send|run|start|commit|push|pull|confirm|save|clear|forget|reset|sign out|pair|record|stop)\b/i;

// Electron title-bar window controls (minimize/maximize/close) do nothing in a
// browser but are real in the packaged app — the browser sweep can't judge them.
const WINDOW_CONTROL = /^(–|—|☐|▢|□|×|✕|⤢|⛶|◻|⬜|_)$/;
const WINDOW_TITLE = /minimize|maximize|restore|close window|full ?screen/i;

export async function run({ daemon, page, ok }) {
  // Count fetches in-page so a click that only makes a network call still reads
  // as a real effect.
  await page.evaluate(() => {
    if (window.__ctaNetInstalled) return;
    window.__ctaNetInstalled = true;
    window.__ctaNet = 0;
    const of = window.fetch;
    window.fetch = function counted(...a) { window.__ctaNet += 1; return of.apply(this, a); };
  });

  const products = ['command', 'forge', 'counsel'];
  const dead = [];
  let tested = 0;

  for (const product of products) {
    await page.click(`.seg [data-product="${product}"]`);
    await page.waitForTimeout(600);

    const screens = await page.$$eval(
      `.product[data-product="${product}"] .nav-i[data-screen]`,
      (els) => els.map((b) => b.dataset.screen),
    );
    const targets = screens.length ? screens : [null];

    for (const screen of targets) {
      if (screen) {
        await page.click(`.product[data-product="${product}"] .nav-i[data-screen="${screen}"]`).catch(() => {});
        await page.waitForTimeout(350);
      }
      const label = screen ? `${product}/${screen}` : product;

      // Enumerate visible, safe-to-click controls in the active surface.
      const controls = await page.evaluate((p) => {
        const host = document.querySelector(`.product[data-product="${p}"]`);
        if (!host) return [];
        const out = [];
        const els = host.querySelectorAll('button, [role="button"], .laction, [data-jump], [data-go], [data-vsview], [data-stab], [data-vsp-open], [data-setcat]');
        let i = 0;
        for (const el of els) {
          if (el.offsetParent === null) continue; // not visible
          el.setAttribute('data-cta-id', `cta-${i}`);
          out.push({
            id: `cta-${i}`,
            text: (el.textContent || '').trim().slice(0, 30),
            title: (el.title || '').slice(0, 30),
            disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          });
          i += 1;
        }
        return out;
      }, product);

      for (const c of controls) {
        const name = c.text || c.title || c.id;
        if (c.disabled) continue; // honestly disabled — fine
        if (DESTRUCTIVE.test(name)) continue; // covered by dedicated flows
        if (WINDOW_CONTROL.test(name.trim()) || WINDOW_TITLE.test(c.title)) continue; // Electron-only

        // Snapshot, click, observe any effect.
        const effect = await page.evaluate(async (ctaId) => {
          const el = document.querySelector(`[data-cta-id="${ctaId}"]`);
          if (!el || el.offsetParent === null) return { skipped: true };
          // The app toggles screens by class/visibility, not the [hidden]
          // attribute, so "what is visible" must be read from offsetParent, and
          // the active nav item from aria-current — otherwise a working
          // navigation click reads as a no-op (a false positive in the test).
          // Visible text is the most reliable "did anything happen" signal: a
          // navigation, a modal opening, a sidebar view switching, a menu
          // appearing, a toast — every one of them changes what is on screen.
          // innerText (not innerHTML) reflects only what is actually visible.
          const snap = () => ({
            net: window.__ctaNet || 0,
            text: document.body.innerText.length,
            surface: document.documentElement.getAttribute('data-zeno-surface'),
            focused: (document.activeElement?.tagName || '') + (document.activeElement?.id || '') + (document.activeElement?.className || ''),
          });
          const before = snap();
          el.click();
          await new Promise((r) => setTimeout(r, 260));
          const after = snap();
          const changed = after.net !== before.net
            || Math.abs(after.text - before.text) > 3
            || after.surface !== before.surface
            || after.focused !== before.focused;
          return { changed };
        }, c.id);

        if (effect.skipped) continue;
        tested += 1;
        if (!effect.changed) dead.push(`${label}: "${name}"`);

        // Close any menu/modal we opened, and return to a known surface.
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(60);
      }
      // Re-assert the product after clicks may have navigated away.
      await page.click(`.seg [data-product="${product}"]`).catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  // Instrument network for the count the page reads above (best-effort; the
  // harness already records all requests, this is just for the in-page delta).
  ok(`swept ${tested} controls across all products`, tested > 0, `tested ${tested}`);
  ok('no control is a silent no-op', dead.length === 0, dead.length ? `DEAD (${dead.length}): ${dead.slice(0, 25).join(' | ')}` : 'all live or honestly disabled');
}
