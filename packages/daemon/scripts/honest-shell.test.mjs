import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const html = readFileSync(join(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');

test('the static shell does not seed fabricated Forge actions or Counsel meeting data', () => {
  assert.doesNotMatch(html, /<div class="sessview" data-stab="actions" hidden><div class="fact-c">/);
  assert.match(html, /data-stab="actions">Actions <span class="fct am" hidden><\/span>/);
  assert.doesNotMatch(html, /The home should lead with the orb|Design review — Command home|Port Gate-2 orb renderer/);
  assert.doesNotMatch(html, /value="abheet19@gmail\.com"/);
  assert.match(html, /Open a saved meeting to see its cited summary/);
});

test('the static Forge copy distinguishes owner terminal commands from agent proposals', () => {
  assert.match(html, /Commands you type in Terminal run immediately as your explicit action/);
  assert.doesNotMatch(html, /Zeno plans it in an isolated worktree — every effect waits for your approval/);
});
