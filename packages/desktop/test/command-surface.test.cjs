'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const publicDir = join(__dirname, '../../daemon/public');
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, '');
const themeBoot = readFileSync(join(publicDir, 'theme-boot.js'), 'utf8');

/*
 * The renderer was rebuilt on the design artifact's markup, which names things
 * differently: a rail button is `data-screen`, not `data-jump`; a product button
 * is `data-product`, not `data-nav`; a surface is `.product[data-product]`, not
 * `<section data-surface>`. These tests were pinned to the OLD vocabulary, so
 * they failed for a naming reason while the thing they exist to protect — no
 * navigation control may lead nowhere — went unchecked. Re-expressed against the
 * shipped vocabulary, and widened: every rail across all three products, not
 * just Command's.
 */

test('every rail CTA in every product resolves to a real screen', () => {
  const rails = [...visibleHtml.matchAll(/<button class="nav-i[^"]*"[^>]*data-screen="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(rails.length > 0, 'the rails must expose real destinations');
  for (const target of new Set(rails)) {
    const hasScreen = new RegExp(`<section[^>]+class="[^"]*\\bscreen\\b[^"]*"[^>]*data-screen="${target}"`).test(visibleHtml)
      || new RegExp(`<div[^>]+class="[^"]*\\bscreen\\b[^"]*"[^>]*data-screen="${target}"`).test(visibleHtml);
    assert.equal(hasScreen, true, `rail target "${target}" must resolve to a rendered screen`);
  }
  assert.ok(rails.includes('receipts'), 'the receipt ledger must be reachable from the rail');
});

test('product navigation has one real surface for every CTA', () => {
  const navNames = [...visibleHtml.matchAll(/<button[^>]*data-product="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(navNames)], ['command', 'forge', 'counsel']);
  for (const name of navNames) {
    const surface = new RegExp(`<div class="product[^"]*"[^>]*data-product="${name}"`).test(visibleHtml);
    assert.ok(surface, `${name} navigation must have a surface`);
  }
});

test('the shipped wordmark is compound and no visible button promises coming-soon behavior', () => {
  // Compound, because one window holds three products: the title bar and the
  // taskbar entry have to say WHICH one you are looking at.
  assert.match(visibleHtml, /<span class="brand-word">Zeno Command<\/span>/);
  assert.doesNotMatch(visibleHtml, /<span class="wm">Zeno<\/span>/);
  // …and it is kept in step with the surface, not left at its initial value.
  const bind = readFileSync(join(publicDir, 'bind.js'), 'utf8');
  assert.match(bind, /\.brand \.brand-word/);
  assert.match(bind, /document\.title = `Zeno \$\{word\}`/);
  assert.doesNotMatch(visibleHtml, /<button[^>]*>[\s\S]*?coming soon[\s\S]*?<\/button>/i);
});

function runThemeBoot(saved, storageFails = false) {
  const attributes = new Map([['data-theme', 'dark']]);
  const root = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
  };
  const context = {
    document: { documentElement: root },
    localStorage: {
      getItem() {
        if (storageFails) throw new Error('storage disabled');
        return saved;
      },
    },
  };
  vm.runInNewContext(themeBoot, context);
  return root.getAttribute('data-theme');
}

test('first launch is Graphite-dark before CSS, while every saved theme still wins', () => {
  assert.match(visibleHtml, /<html\s+lang="en"\s+data-theme="dark">/);
  const bootIndex = visibleHtml.indexOf('<script src="/theme-boot.js"></script>');
  const paletteIndex = visibleHtml.indexOf('<style>');
  assert.ok(bootIndex > 0 && bootIndex < paletteIndex, 'saved theme must resolve before CSS is parsed');

  assert.equal(runThemeBoot(null), 'dark', 'a new profile should keep the Graphite default');
  assert.equal(runThemeBoot('system'), null, 'System should follow the operating system');
  assert.equal(runThemeBoot('light'), 'light', 'Glass Dawn should remain an explicit override');
  assert.equal(runThemeBoot('dark'), 'dark', 'Graphite should remain an explicit override');
  assert.equal(runThemeBoot('unexpected'), 'dark', 'invalid storage must not override the default');
  assert.equal(runThemeBoot(null, true), 'dark', 'disabled storage should keep the default');
});
