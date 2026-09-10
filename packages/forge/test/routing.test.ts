import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAgentTask } from '../src/routing.js';

test('routing keeps credential-bearing work on the local Ollama rung', () => {
  const route = routeAgentTask('Audit the .env and rotate an API key', {
    localModels: ['qwen3:4b', 'qwen3:14b'],
  });
  assert.deepEqual(
    { agentId: route.agentId, model: route.model, effort: route.effort, kind: route.kind },
    { agentId: 'local', model: 'qwen3:14b', effort: 'medium', kind: 'private-local' },
  );
  assert.match(route.rationale, /stays on this machine/i);
});

test('routing recognizes literal credential shapes even when the prompt does not label them', () => {
  const literals = [
    `deploy ${`AKIA${'A'.repeat(16)}`}`,
    `send eyJ${'a'.repeat(10)}.${'b'.repeat(12)}.${'c'.repeat(16)}`,
    'replace -----BEGIN PRIVATE KEY----- in the fixture',
    `use sk-proj-${'z'.repeat(32)}`,
    `clone with ghp_${'d'.repeat(36)}`,
    `authenticate github_pat_${'E'.repeat(30)}`,
  ];
  for (const task of literals) {
    const route = routeAgentTask(task, { localModels: [], availableAgentIds: ['codex', 'claude-code'] });
    assert.equal(route.kind, 'private-local', task);
    assert.equal(route.agentId, 'local', task);
    assert.equal(route.runnable, false, `${task}: a literal secret must never fall through to a hosted agent`);
  }
});

test('short lookalikes do not turn ordinary work into a credential-bearing task', () => {
  for (const task of ['polish the sketch UI', 'document AKIA-prefix identifiers', 'parse eyJ.not.jwt', 'render a PUBLIC KEY heading']) {
    assert.notEqual(routeAgentTask(task).kind, 'private-local', task);
  }
});

test('routing sends a compact code request to the proven free local model', () => {
  const route = routeAgentTask('WRITE A for loop', {
    localModels: ['qwen3:4b', 'qwen3:8b', 'qwen3:14b'],
    availableAgentIds: ['local', 'codex', 'claude-code'],
  });
  assert.equal(route.agentId, 'local');
  assert.equal(route.model, 'qwen3:8b');
  assert.equal(route.effort, 'low');
  assert.equal(route.runnable, true);
  assert.match(route.rationale, /small standalone code request/i);

  const fallback = routeAgentTask('WRITE A for loop', {
    localModels: [],
    availableAgentIds: ['codex'],
  });
  assert.equal(fallback.agentId, 'codex');
  assert.equal(fallback.runnable, true);
});

test('routing makes frontend and architecture choices explicit and deterministic', () => {
  const frontend = routeAgentTask('Fix the React responsive UI and Playwright test');
  assert.equal(frontend.agentId, 'codex');
  assert.equal(frontend.model, 'gpt-5.6-terra');
  assert.equal(frontend.effort, 'medium');

  const architecture = routeAgentTask('Design a distributed microservice threat model');
  assert.equal(architecture.agentId, 'claude-code');
  assert.equal(architecture.model, 'opus');
  assert.equal(architecture.effort, 'high');
});

test('routing uses a fast documentation route and a balanced general fallback', () => {
  assert.deepEqual(
    routeAgentTask('Update the README wording'),
    {
      agentId: 'claude-code',
      model: 'haiku',
      effort: 'low',
      kind: 'documentation',
      rationale: 'Claude Haiku at low effort selected because the task is a bounded documentation or explanation change.',
    },
  );
  const general = routeAgentTask('Implement the requested feature');
  assert.equal(general.agentId, 'claude-code');
  assert.equal(general.model, 'sonnet');
  assert.equal(general.effort, 'medium');
});

test('routing falls back from an unavailable preferred provider using live availability', () => {
  const architecture = routeAgentTask('Design a distributed microservice threat model', {
    localModels: ['qwen3:8b'],
    availableAgentIds: ['codex', 'local'],
  });
  assert.equal(architecture.agentId, 'codex');
  assert.equal(architecture.model, 'gpt-6-astra');
  assert.equal(architecture.runnable, true);
  assert.match(architecture.rationale, /Claude Code is unavailable/i);

  const docs = routeAgentTask('Update the README wording', {
    localModels: ['qwen3:8b'],
    availableAgentIds: ['codex', 'local'],
  });
  assert.equal(docs.agentId, 'local', 'bounded documentation uses the free local fallback first');
  assert.equal(docs.model, 'qwen3:8b');
});

test('routing never leaks a sensitive task to a hosted fallback', () => {
  const route = routeAgentTask('Inspect my .env API key', {
    localModels: [],
    availableAgentIds: ['codex', 'claude-code'],
  });
  assert.equal(route.agentId, 'local');
  assert.equal(route.runnable, false);
  assert.match(route.rationale, /will not send it to a hosted provider/i);
});

test('routing reports when no provider can run instead of inventing availability', () => {
  const route = routeAgentTask('Implement the requested feature', { availableAgentIds: [] });
  assert.equal(route.runnable, false);
  assert.match(route.rationale, /No coding provider is available/i);
});
