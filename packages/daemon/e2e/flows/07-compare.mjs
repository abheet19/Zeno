/*
 * Multi-model Compare — run one task on two or three models and keep one diff.
 *
 * What this replaces is worth stating plainly, because it is the shape of
 * failure this flow exists to catch. The artifact's openCompare() never ran a
 * model. It slept for `1500 + Math.random()*1000` milliseconds per column,
 * printed one of two hardcoded diffs, invented a token count, invented a dollar
 * cost, presented the fabricated sleep as a benchmark "Wall time", and finished
 * by claiming it had staged a change under a random four-hex-digit id. Every
 * number was made up and every one was arranged to look like evidence.
 *
 * So the assertions here are mostly about what must NOT be on screen, and about
 * a real POST /forge/run per column actually happening.
 *
 * The GPU half matters too: the owner asked to run models concurrently "if the
 * GPU supports it", and the honest answer is sometimes no. Whatever this machine
 * decides, the screen must SAY which it did rather than imply parallelism.
 */

export const id = 'compare';
export const title = 'Compare runs real models, measures real time, and keeps a real diff';
export const criteria = ['GAP-FORGE-REASONING', 'owner: real multi-model compare'];

export async function run({ daemon, page, ok, network, Blocked }) {
  const host = await daemon.api('/forge/models/host');
  const installed = (host.body && Array.isArray(host.body.models) ? host.body.models : []).map((m) => m.name);
  if (installed.length < 2) {
    throw new Blocked(`comparing needs at least two installed local models; this machine has ${installed.length} (${installed.join(', ') || 'none'}) — pull another with \`ollama pull qwen3:4b\``);
  }

  ok('the daemon reports the real GPU and per-model VRAM',
    host.status === 200 && 'gpu' in host.body, JSON.stringify(host.body && host.body.gpu));

  // The binder must own the Compare button, not ui.js's fabricated handler.
  const source = await page.evaluate(async () => {
    const r = await fetch('/bind/compare.js', { cache: 'no-store' });
    return r.ok ? await r.text() : '';
  });
  ok('a real compare binder is shipped', source.length > 0);
  ok('it runs the models through the daemon', /fetch\(|post\('\/forge\/run'|'\/forge\/run'/.test(source));

  /* Strip comments before looking for fabrication. The file documents what the
     mock used to do — "slept for 1500 + Math.random()*1000" — and an assertion
     that cannot tell code from the prose describing the bug it fixed fails on
     its own documentation, which is how a test teaches people to delete
     comments. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('it never fabricates a duration', !/Math\.random\(\)/.test(code), 'Math.random() appears in executable compare code');
  ok('it measures real elapsed time', /performance\.now\(\)/.test(code));
  ok('it reads the real GPU before deciding to parallelise', /\/forge\/models\/host/.test(code));
  ok('keeping one diff refuses the others', /\/approvals\/decline/.test(code));

  // And the mock must be unreachable: assert the fabricated artefacts cannot
  // reach the screen even if ui.js still defines them.
  const uiSource = await page.evaluate(async () => {
    const r = await fetch('/ui.js', { cache: 'no-store' });
    return r.ok ? await r.text() : '';
  });
  const mockLives = /DIFF_RICH|DIFF_SIMPLE/.test(uiSource);
  if (mockLives) {
    /* The fabricated renderer may still exist in ui.js; what matters is that it
       is UNREACHABLE from the Compare button. The binder listens in the capture
       phase and stops the event before ui.js's bubbling handler runs, so assert
       both halves of that — capture registration and the stop. */
    ok('the binder listens in the capture phase', /addEventListener\('click',[\s\S]*?\},\s*true\)/.test(code));
    ok('and stops the event before ui.js sees it', /stopImmediatePropagation\(\)/.test(code));
  }

  // Drive it for real: open Forge, type a task, pick two local models, compare.
  await page.click('[data-product="forge"]');
  await page.waitForTimeout(800);

  const typed = await page.evaluate(() => {
    const ta = document.querySelector('#s-ta') || document.querySelector('#ag-ta');
    if (!ta) return false;
    ta.value = 'Add a one-line comment at the top of README.md saying what this repository is.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  ok('Forge has a composer to compare a task from', typed);

  const opened = await page.evaluate(() => {
    // Forge deliberately removes ui.js's shared data-model-pill hook and owns
    // this control itself. Click Forge's actual composer control; falling back
    // to a shared pill opens the unrelated legacy picker and tests the wrong UI.
    const pill = document.querySelector('#s-model');
    if (!pill) return false;
    pill.click();
    return true;
  });
  ok('the model picker opens', opened);
  await page.waitForTimeout(600);

  const picked = await page.evaluate((names) => {
    const toCompare = [...document.querySelectorAll('.mp [data-mpmode], .mp button')]
      .find((b) => /compare/i.test(b.textContent || ''));
    if (toCompare) toCompare.click();
    const rows = [...document.querySelectorAll('.mp .mp-row[data-mid]')]
      .filter((r) => names.includes(r.dataset.mid));
    rows.slice(0, 2).forEach((r) => r.click());
    return rows.slice(0, 2).map((r) => r.dataset.mid);
  }, installed);
  ok('two installed local models can be selected', picked.length === 2, JSON.stringify(picked));

  if (picked.length === 2) {
    const before = network.filter((n) => n === 'POST /forge/run').length;
    await page.evaluate(() => {
      const run = document.querySelector('#mp-run');
      if (run) run.click();
    });
    // A real local run is slow. Wait for the panel, then for both columns.
    const appeared = await page.waitForSelector('.cmpv', { timeout: 15_000 }).then(() => true).catch(() => false);
    ok('the compare panel opens', appeared);

    if (appeared) {
      const says = await page.evaluate(() => document.querySelector('.cmpv .fnote')?.textContent || '');
      ok('it states whether the GPU can run them together',
        /run together|chained|one at a time|could not be read|No GPU/i.test(says), says.slice(0, 160));

      await page.waitForFunction(
        () => [...document.querySelectorAll('.cmpv .cmp-col')].length >= 2,
        { timeout: 20_000 },
      ).catch(() => {});
      const cols = await page.$$eval('.cmpv .cmp-col', (e) => e.length);
      ok.eq('one column per model', cols, 2);

      // The run itself may take minutes on a local model; what this flow must
      // prove is that a REAL run was dispatched, not that it finished.
      await page.waitForTimeout(4000);
      const runs = network.filter((n) => n === 'POST /forge/run').length;
      ok('comparing actually dispatches real runs', runs > before, `POST /forge/run seen ${runs} times`);

      const text = await page.evaluate(() => document.querySelector('.cmpv')?.innerText || '');
      ok('no fabricated cost is shown', !/\$\d/.test(text), text.slice(0, 200));
      ok('no invented "staged" hash is shown', !/staged [0-9a-f]{4}…/.test(text));
    }
  }
}
