import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('composer autosizing uses the actual CSS max-height before hiding overflow', async () => {
  const source = await readFile(new URL('../public/ui.js', import.meta.url), 'utf8');
  assert.match(source, /parseFloat\(getComputedStyle\(t\)\.maxHeight\)/);
  assert.match(source, /Math\.min\(viewportCap,cssMax\)/);
  assert.match(source, /want > cap \? 'scroll' : 'hidden'/);
  assert.doesNotMatch(source, /Math\.min\(t\.scrollHeight,160\)/);
  assert.doesNotMatch(source, /dataset\.userSized/);
  assert.doesNotMatch(source, /new ResizeObserver/);
});

test('Command composer provides a native vertical-scroll fallback', async () => {
  const source = await readFile(new URL('../public/screens/home-composer.css', import.meta.url), 'utf8');
  assert.match(source, /\.composer textarea\s*\{[\s\S]*overflow-y:auto/);
  assert.match(source, /scrollbar-gutter:stable/);
  assert.match(source, /::-webkit-scrollbar-thumb/);
});
