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
        const els = host.querySelectorAll([
          'button', '[role="button"]', '[role="switch"]', '.toggle', '.laction',
          'a[href]', 'input[type="checkbox"]', 'input[type="radio"]',
          '[data-jump]', '[data-go]', '[data-vsview]', '[data-stab]', '[data-vsp-open]',
          '[data-setcat]', '[data-setpane] button', '[data-model-pill]', '[data-effort-pill]',
          '[data-product-go]', '[data-screen-jump]', '[data-vsgo]', '[data-vsp]', '[data-cngo]',
          '[data-cntab]', '[data-mscreen]', '.mp-row', '.starter', '.cbtn', '.fico', '.plus-item',
        ].join(','));
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
          // A control's effect is not always visible text or a navigation. A
          // toggle (Reduce motion, Reduce transparency, a wake switch) flips its
          // OWN aria-checked/aria-pressed and may set a root attribute
          // (data-reduce, data-flat, data-theme) or persist a preference — none
          // of which touches body text, the surface, or focus. Read those too,
          // so a working toggle is credited instead of read as a dead no-op.
          const rootFp = () => [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort().join('|');
          const lsFp = () => { try { let s = ''; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); s += `${k}=${(localStorage.getItem(k) || '').length};`; } return s; } catch { return ''; } };
          const selfState = (n) => `${n.getAttribute('aria-checked')}|${n.getAttribute('aria-pressed')}|${n.getAttribute('aria-current')}`;
          const snap = () => ({
            net: window.__ctaNet || 0,
            text: document.body.innerText.length,
            surface: document.documentElement.getAttribute('data-zeno-surface'),
            focused: (document.activeElement?.tagName || '') + (document.activeElement?.id || '') + (document.activeElement?.className || ''),
            root: rootFp(),
            ls: lsFp(),
            self: selfState(el),
          });
          // A view-switch control's job is to make its declared target the
          // active one. When the sweep clicks controls in sequence, an earlier
          // click can already have switched to that target, so this control's
          // click is a correct no-op ("show Problems" when Problems is already
          // shown) — not a dead control. Credit any control whose declared
          // target pane is active after the click, regardless of prior state.
          const targetActive = (n) => {
            const pairs = [['vspOpen', '.vsp[data-vsp="$"]'], ['vsp', '.vsp[data-vsp="$"]'],
              ['setcat', '.set-pane[data-setpane="$"]'], ['vsview', '.vsview[data-vsview="$"]'],
              ['stab', '.sessview[data-stab="$"]'], ['cntab', '.cnp[data-cntab="$"]']];
            for (const [k, sel] of pairs) {
              const v = n.dataset[k];
              if (!v) continue;
              const t = document.querySelector(sel.replace('$', v));
              if (t && t.offsetParent !== null && (t.classList.contains('on') || t.getAttribute('aria-selected') === 'true')) return true;
            }
            return false;
          };
          const before = snap();
          el.click();
          await new Promise((r) => setTimeout(r, 260));
          const after = snap();
          const changed = after.net !== before.net
            || Math.abs(after.text - before.text) > 3
            || after.surface !== before.surface
            || after.focused !== before.focused
            || after.root !== before.root
            || after.ls !== before.ls
            || after.self !== before.self
            || targetActive(el);
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

  // ---- overlays: the controls that only exist once something is opened ------
  // Per-screen enumeration only sees what is on screen. The Settings modal, the
  // model picker, and the composer "+" menu each reveal a whole set of controls
  // that a "no dead CTA" claim must also cover. Open each, sweep the controls
  // inside it against the SAME effect test, then close.
  const sweepContainer = async (containerSel, tag) => {
    const controls = await page.$$eval(`${containerSel} button, ${containerSel} [role="switch"], ${containerSel} .toggle, ${containerSel} .mp-row, ${containerSel} .set-btn, ${containerSel} [data-setcat], ${containerSel} a[href]`, (els) => {
      const out = [];
      let i = 0;
      for (const el of els) {
        if (el.offsetParent === null) continue;
        el.setAttribute('data-cta-ov', `ov-${i}`);
        out.push({
          id: `ov-${i}`,
          text: (el.textContent || '').trim().slice(0, 30),
          title: (el.title || '').slice(0, 30),
          disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        });
        i += 1;
      }
      return out;
    }).catch(() => []);
    for (const c of controls) {
      const name = c.text || c.title || c.id;
      if (c.disabled || DESTRUCTIVE.test(name) || WINDOW_CONTROL.test(name.trim())) continue;
      const effect = await page.evaluate(async (ovId) => {
        const el = document.querySelector(`[data-cta-ov="${ovId}"]`);
        if (!el || el.offsetParent === null) return { skipped: true };
        // Same as the per-screen sweep: a toggle's effect is its own aria state,
        // a root attribute, or a persisted preference — not visible text. Credit
        // those so a working switch is not mistaken for a dead control.
        const rootFp = () => [...document.documentElement.attributes].map((x) => `${x.name}=${x.value}`).sort().join('|');
        const lsFp = () => { try { let s = ''; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); s += `${k}=${(localStorage.getItem(k) || '').length};`; } return s; } catch { return ''; } };
        const snap = () => ({
          net: window.__ctaNet || 0,
          text: document.body.innerText.length,
          focused: (document.activeElement?.tagName || '') + (document.activeElement?.className || ''),
          root: rootFp(),
          ls: lsFp(),
          self: `${el.getAttribute('aria-checked')}|${el.getAttribute('aria-pressed')}|${el.getAttribute('aria-current')}`,
        });
        const b = snap();
        el.click();
        await new Promise((r) => setTimeout(r, 240));
        const a = snap();
        return { changed: a.net !== b.net || Math.abs(a.text - b.text) > 3 || a.focused !== b.focused || a.root !== b.root || a.ls !== b.ls || a.self !== b.self };
      }, c.id);
      if (effect.skipped) continue;
      tested += 1;
      if (!effect.changed) dead.push(`${tag}: "${name}"`);
    }
  };

  // Settings modal (opened from any Command screen's rail/footer).
  await page.click('.seg [data-product="command"]').catch(() => {});
  await page.click('[data-open-settings]').catch(() => {});
  await page.waitForTimeout(500);
  await sweepContainer('#settings-modal, .set-modal, [data-setpane]', 'settings-modal');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);

  // Model picker (opened from the composer's model pill on Home).
  await page.click('.nav-i[data-screen="home"]').catch(() => {});
  await page.click('[data-model-pill]').catch(() => {});
  await page.waitForTimeout(400);
  await sweepContainer('.mp', 'model-picker');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);

  // Forge composer "+" context menu.
  await page.click('.seg [data-product="forge"]').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('#ag-plus, #s-attach, .ag-composer [title*="context" i], .ag-composer .plus').catch(() => {});
  await page.waitForTimeout(300);
  await sweepContainer('.plusmenu, .ctxmenu, [role="menu"]', 'forge-plus-menu');
  await page.keyboard.press('Escape').catch(() => {});

  ok(`swept ${tested} controls across all products and overlays`, tested > 0, `tested ${tested}`);
  ok('no control is a silent no-op', dead.length === 0, dead.length ? `DEAD (${dead.length}): ${dead.slice(0, 30).join(' | ')}` : 'all live or honestly disabled');
}
