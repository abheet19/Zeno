import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Command sends ready local tasks through Forge instead of rendering model prose', async () => {
  const source = await readFile(new URL('../public/bind/ask.js', import.meta.url), 'utf8');
  assert.match(source, /d\.ready !== true/);
  assert.match(source, /new CustomEvent\('zeno:command-run'/);
  assert.match(source, /if \(!runReadyTaskInForge\(payload\)\)/);
});

test('voice plans the provider, then uses the same visible Forge task path', async () => {
  const source = await readFile(new URL('../public/bind/voice.js', import.meta.url), 'utf8');
  assert.match(source, /postJSON\('\/delegate', \{ task: intent\.task, plan: true \}\)/);
  assert.match(source, /new CustomEvent\('zeno:command-run'/);
  assert.doesNotMatch(source, /postJSON\('\/delegate', \{ task: intent\.task, agentId: 'local' \}\)/);
});
