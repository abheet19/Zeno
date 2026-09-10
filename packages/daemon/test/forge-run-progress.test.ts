import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_ORCHESTRATION_TOTAL,
  ForgeRunProgressReporter,
  finalForgeTokenUsage,
  type ForgeRunProgressEvent,
} from '../src/forge-run-progress.js';
import { Stream } from '../src/stream.js';

test('Forge run progress is monotonic and exposes Ollama counters only after the final response', () => {
  const stream = new Stream();
  const progress = new ForgeRunProgressReporter(stream, 'run-local', 'local', 'qwen3:14b');
  progress.providerReady('qwen3:14b');
  progress.providerRunning();
  progress.providerFinished(120, 24);
  progress.changesInspected();
  progress.finish('completed');

  const events = (stream.replay(0) ?? []).map((item) => item.data as ForgeRunProgressEvent);
  assert.deepEqual(events.map((item) => item.phase), [
    'checking-provider', 'preparing-worktree', 'running-provider',
    'inspecting-changes', 'proposing-changes', 'complete',
  ]);
  assert.deepEqual(events.map((item) => item.completed), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(events.map((item) => item.orchestrationPercent), [0, 20, 40, 60, 80, 100]);
  assert.equal(events[2]?.tokenUsage.status, 'pending');
  assert.deepEqual(events[3]?.tokenUsage, {
    status: 'measured', input: 120, output: 24, source: 'ollama-final-response',
  });
  assert.equal(events[5]?.total, FORGE_ORCHESTRATION_TOTAL);
  assert.equal(events[5]?.outcome, 'completed');
});

test('Forge progress never accepts partial, negative, or hosted token counters', () => {
  assert.deepEqual(finalForgeTokenUsage('local', 5, undefined), {
    status: 'unavailable', reason: 'ollama-final-counters-missing',
  });
  assert.deepEqual(finalForgeTokenUsage('local', -1, 2), {
    status: 'unavailable', reason: 'ollama-final-counters-missing',
  });
  assert.deepEqual(finalForgeTokenUsage('codex', 500, 100), {
    status: 'unavailable', reason: 'hosted-cli-does-not-report',
  });

  const stream = new Stream();
  const stopped = new ForgeRunProgressReporter(stream, 'run-stopped', 'local');
  stopped.providerReady('qwen3:8b');
  stopped.stop('failed');
  stopped.providerRunning();
  const events = (stream.replay(0) ?? []).map((item) => item.data as ForgeRunProgressEvent);
  assert.equal(events.length, 3, 'a terminal reporter ignores late updates');
  assert.deepEqual(events[2], {
    runId: 'run-stopped', agentId: 'local', model: 'qwen3:8b', phase: 'failed',
    completed: 1, total: 5, orchestrationPercent: 20, terminal: true, outcome: 'failed',
    tokenUsage: { status: 'unavailable', reason: 'ollama-final-counters-missing' },
  });
});

test('a provider failure after start completes orchestration without becoming success', () => {
  const stream = new Stream();
  const progress = new ForgeRunProgressReporter(stream, 'run-provider-failed', 'local', 'qwen3:14b');
  progress.providerReady('qwen3:14b');
  progress.providerRunning();
  assert.equal(progress.providerStarted, true);
  progress.providerFinished(undefined, undefined);
  progress.changesInspected();
  progress.finish('failed');
  const final = (stream.replay(0) ?? []).at(-1)?.data as ForgeRunProgressEvent;
  assert.equal(final.phase, 'failed');
  assert.equal(final.completed, 5, 'all orchestration milestones can finish even when the provider outcome failed');
  assert.equal(final.orchestrationPercent, 100);
  assert.equal(final.outcome, 'failed');
  assert.deepEqual(final.tokenUsage, { status: 'unavailable', reason: 'ollama-final-counters-missing' });
});
