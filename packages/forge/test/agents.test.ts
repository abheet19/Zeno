/**
 * The agent registry and the effort model — the pure catalogue the picker reads.
 *
 * The two properties that must not drift: the registry names exactly the three
 * rungs the runner knows how to dispatch, and an unknown id is a loud, legible
 * error rather than a quietly-empty result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENTS,
  EFFORTS,
  UnknownAgentError,
  chooseAgent,
  isEffort,
} from '../src/agents.js';

test('AGENTS holds exactly the three rungs, honestly shaped', () => {
  assert.deepEqual(
    AGENTS.map((a) => a.id),
    ['claude-code', 'codex', 'local'],
    'the registry is the closed set the runner dispatches over',
  );

  const claude = AGENTS.find((a) => a.id === 'claude-code')!;
  assert.equal(claude.label, 'Claude Code');
  assert.ok(claude.models.length > 0, 'claude-code offers model choices');
  assert.equal(claude.supportsEffort, true, 'the installed Claude Code CLI exposes --effort in -p mode');

  const codex = AGENTS.find((a) => a.id === 'codex')!;
  assert.equal(codex.label, 'Codex');
  assert.ok(codex.models.includes('gpt-6-astra'), 'the installed Codex host offers its current flagship alias');
  assert.equal(codex.supportsEffort, true, 'Codex accepts model_reasoning_effort under strict config');

  const local = AGENTS.find((a) => a.id === 'local')!;
  assert.deepEqual(local.models, [], 'installed Ollama models are discovered live by the daemon');
  assert.equal(local.supportsEffort, true, 'a local thinking model has a real effort dial');
});

test('chooseAgent resolves a known id to its Agent', () => {
  assert.equal(chooseAgent('claude-code').id, 'claude-code');
  assert.equal(chooseAgent('codex').id, 'codex');
  assert.equal(chooseAgent('local').id, 'local');
});

test('chooseAgent throws a LEGIBLE error for an unknown id', () => {
  assert.throws(
    () => chooseAgent('gpt-9000'),
    (err: unknown) => {
      assert.ok(err instanceof UnknownAgentError);
      assert.equal(err.id, 'gpt-9000', 'the offending id is carried, not just described');
      assert.match(err.message, /gpt-9000/);
      assert.match(err.message, /claude-code/, 'the message lists what IS known');
      assert.match(err.message, /codex/);
      assert.match(err.message, /local/);
      return true;
    },
  );
});

test('the effort model: EFFORTS in order, isEffort narrows honest input', () => {
  assert.deepEqual(EFFORTS, ['low', 'medium', 'high']);
  assert.ok(isEffort('low') && isEffort('medium') && isEffort('high'));
  assert.equal(isEffort('extreme'), false);
  assert.equal(isEffort(''), false);
  assert.equal(isEffort('LOW'), false, 'case matters — it is a stored token, not free text');
});
