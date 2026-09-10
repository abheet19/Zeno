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

test('every Command rail CTA resolves to a real section or mount', () => {
  const rail = visibleHtml.match(/<aside class="rail"[\s\S]*?<\/aside>/)?.[0] || '';
  const targets = [...rail.matchAll(/<button[^>]+data-jump="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.ok(targets.length > 0, 'the Command rail must expose real destinations');
  for (const [, target] of targets) {
    const exists = target === 'cmd-hero'
      ? visibleHtml.includes('<section class="hero"')
      : visibleHtml.includes(`id="${target}"`) || visibleHtml.includes(`data-mount="${target}"`);
    assert.equal(exists, true, `rail target ${target} must resolve to rendered content`);
  }
  const timeline = targets.find(([, target]) => target === 'timeline');
  assert.match(timeline?.[2] || '', /Receipts/i, 'the receipt timeline must not be labelled as an agent runner');
});

test('product navigation has one real surface and loadable module for every CTA', () => {
  const navNames = [...visibleHtml.matchAll(/<button[^>]+data-nav="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(navNames, ['command', 'forge', 'counsel']);
  for (const name of navNames) {
    const surface = visibleHtml.match(new RegExp(`<section[^>]+data-surface="${name}"[^>]*>`))?.[0] || '';
    assert.ok(surface, `${name} navigation must have a surface`);
    const modulePath = surface.match(/data-init="\/([^"]+)"/)?.[1];
    if (modulePath) assert.equal(existsSync(join(publicDir, modulePath)), true, `${name} module must exist`);
  }
});

test('the shipped wordmark is compound and no visible button promises coming-soon behavior', () => {
  assert.match(visibleHtml, /<span class="brand-word">Zeno Command<\/span>/);
  assert.doesNotMatch(visibleHtml, /<span class="brand-word">Zeno<\/span>/);
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
