'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const publicDir = join(__dirname, '../../daemon/public');
const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, '');

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
