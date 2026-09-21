import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { modelCapabilityProfile, scoreLabel } from '../public/bind/forge/modelprofiles.js';

test('current hosted models receive qualitative capability profiles', () => {
  for (const [agent, model] of [
    ['claude-code', 'opus'],
    ['claude-code', 'sonnet'],
    ['claude-code', 'haiku'],
    ['codex', 'gpt-6-astra'],
    ['codex', 'gpt-5.6-sol'],
    ['codex', 'gpt-5.6-terra'],
    ['codex', 'gpt-5.6-luna'],
  ]) {
    const profile = modelCapabilityProfile(agent, model);
    for (const key of ['code', 'reasoning', 'speed']) {
      assert.equal(Number.isFinite(profile[key]), true, `${agent}/${model} ${key}`);
      assert.match(scoreLabel(profile[key]), /excellent|strong|balanced|basic|limited/);
    }
    assert.match(profile.note, /not a live benchmark/i);
  }
});

test('local guidance shows the usual size versus speed trade-off', () => {
  const small = modelCapabilityProfile('local', 'qwen3:4b');
  const medium = modelCapabilityProfile('local', 'qwen3:8b');
  const large = modelCapabilityProfile('local', 'qwen3:14b');
  assert.ok(small.speed > medium.speed && medium.speed > large.speed);
  assert.ok(small.code < medium.code && medium.code < large.code);
});

test('unknown future models stay visible with a neutral profile', () => {
  assert.deepEqual(modelCapabilityProfile('future-provider', 'future-model'), {
    code: 65,
    reasoning: 65,
    speed: 65,
    summary: 'Code balanced · reasoning balanced · speed balanced',
    note: 'Curated relative guidance — not a live benchmark or quality guarantee.',
  });
});

test('the live picker appends each label, meter, and qualitative value to its row', async () => {
  const source = await readFile(new URL('../public/bind/forge/modelpicker.js', import.meta.url), 'utf8');
  assert.match(source, /const row = el\('div'\)/);
  assert.match(source, /add\(row, document\.createTextNode\(label\), bar, el\('span', null, scoreLabel\(score\)\)\)/);
  assert.match(source, /add\(strengths, row\)/);
});

test('Command uses the same profile source and complete strength rows', async () => {
  const source = await readFile(new URL('../public/bind/ask.js', import.meta.url), 'utf8');
  assert.match(source, /modelCapabilityProfile\('local', model\)/);
  assert.match(source, /strengthRow\.append\(document\.createTextNode\(label\), bar, el\('span', null, scoreLabel\(score\)\)\)/);
  assert.match(source, /row\.addEventListener\('mouseenter', \(\) => showCommandModelDetail\(model, row\)\)/);
});
