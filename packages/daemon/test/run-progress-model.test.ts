import { test } from 'node:test';
import assert from 'node:assert/strict';

interface BrowserModel {
  initialRunProgress(runId: string, agentId: string, model: string): Record<string, unknown>;
  parseRunProgress(raw: unknown): Record<string, unknown> | null;
  applyRunProgress(sessions: Record<string, unknown>[], raw: unknown): string | null;
  shouldRepaintRunProgress(selectedSessionId: string, updatedSessionId: string | null): boolean;
  markRunProgressGap(sessions: Record<string, unknown>[]): string[];
  runTransportState(session: Record<string, unknown>): { terminal: boolean; label: string; canCancel: boolean };
  finalTokenUsage(agentId: string, input: unknown, output: unknown): Record<string, unknown>;
  phaseLabel(progress: unknown): string;
  tokenUsageLabel(usage: unknown): string;
}

const moduleUrl = new URL('../../public/run-progress-model.js', import.meta.url).href;
const model = await import(moduleUrl) as BrowserModel;

function event(runId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId,
    agentId: 'local',
    model: 'qwen3:14b',
    phase: 'running-provider',
    completed: 2,
    total: 5,
    orchestrationPercent: 40,
    terminal: false,
    outcome: null,
    tokenUsage: { status: 'pending' },
    ...overrides,
  };
}

test('run progress updates only the matching active session', () => {
  const sessions: Record<string, unknown>[] = [
    { id: 'a', running: true, runId: 'run-a', runProgress: null },
    { id: 'b', running: true, runId: 'run-b', runProgress: null },
    { id: 'old', running: false, runId: 'run-old', runProgress: null },
  ];
  assert.equal(model.applyRunProgress(sessions, event('run-b')), 'b');
  assert.equal(model.shouldRepaintRunProgress('a', 'b'), false, 'background progress must not repaint the active composer');
  assert.equal(model.shouldRepaintRunProgress('b', 'b'), true);
  assert.equal(sessions[0]?.['runProgress'], null);
  assert.equal((sessions[1]?.['runProgress'] as Record<string, unknown>)?.['orchestrationPercent'], 40);
  assert.equal(model.applyRunProgress(sessions, event('run-b', {
    phase: 'preparing-worktree', completed: 1, orchestrationPercent: 20,
  })), null, 'an out-of-order event cannot move a session backwards');
  const terminal = event('run-b', {
    phase: 'failed', completed: 5, orchestrationPercent: 100,
    terminal: true, outcome: 'failed',
    tokenUsage: { status: 'unavailable', reason: 'ollama-final-counters-missing' },
  });
  assert.equal(model.applyRunProgress(sessions, terminal), 'b');
  assert.equal(model.applyRunProgress(sessions, event('run-b')), null, 'a terminal state cannot become non-terminal');
  assert.equal(model.applyRunProgress(sessions, event('run-old')), null, 'finished sessions reject replayed events');
  assert.equal(model.applyRunProgress(sessions, event('unknown')), null);
});

test('the UI rejects contradictory percentages and invented token counts', () => {
  assert.equal(model.parseRunProgress(event('run-a', { orchestrationPercent: 72 })), null);
  assert.equal(model.parseRunProgress(event('run-a', {
    agentId: 'codex', tokenUsage: { status: 'measured', input: 10, output: 5, source: 'ollama-final-response' },
  })), null);
  assert.equal(model.parseRunProgress(event('run-a', {
    terminal: true, outcome: 'completed', phase: 'complete', completed: 5,
    orchestrationPercent: 100, tokenUsage: { status: 'pending' },
  })), null);
  assert.deepEqual(model.finalTokenUsage('local', 20, 7), {
    status: 'measured', input: 20, output: 7, source: 'ollama-final-response',
  });
  assert.deepEqual(model.finalTokenUsage('claude-code', 20, 7), {
    status: 'unavailable', reason: 'hosted-cli-does-not-report',
  });
});

test('progress copy names orchestration and labels token certainty', () => {
  const initial = model.initialRunProgress('run-a', 'local', 'qwen3:14b');
  assert.equal(model.phaseLabel(initial), 'Checking the selected provider');
  assert.match(model.tokenUsageLabel(initial.tokenUsage), /pending.*final response/i);
  assert.match(model.tokenUsageLabel({ status: 'measured', input: 120, output: 24 }), /120 input.*24 output.*final response/i);
  assert.match(model.tokenUsageLabel({ status: 'unavailable', reason: 'hosted-cli-does-not-report' }), /unavailable.*hosted CLI/i);
  assert.equal(model.phaseLabel({ phase: 'failed', completed: 5 }), 'Run ended with a failure');
});

test('a bounded-stream gap stays scoped to running sessions until POST reconciliation', () => {
  const sessions: Record<string, unknown>[] = [
    { id: 'active', running: true, runProgressStale: false },
    { id: 'background', running: true, runProgressStale: false },
    { id: 'settled', running: false, runProgressStale: false },
  ];
  assert.deepEqual(model.markRunProgressGap(sessions), ['active', 'background']);
  assert.equal(sessions[0]?.['runProgressStale'], true);
  assert.equal(sessions[1]?.['runProgressStale'], true);
  assert.equal(sessions[2]?.['runProgressStale'], false);
});

test('a terminal SSE never looks cancellable while the final POST is in flight', () => {
  assert.deepEqual(model.runTransportState({
    runId: 'run-a', canceling: false, runProgress: { terminal: true, outcome: 'completed' },
  }), { terminal: true, label: 'complete', canCancel: false });
  assert.deepEqual(model.runTransportState({
    runId: 'run-b', canceling: true, runProgress: { terminal: true, outcome: 'cancelled' },
  }), { terminal: true, label: 'cancelled', canCancel: false });
  assert.deepEqual(model.runTransportState({
    runId: 'run-c', canceling: false, runProgress: { terminal: true, outcome: 'failed' },
  }), { terminal: true, label: 'failed', canCancel: false });
  assert.deepEqual(model.runTransportState({ runId: 'run-d', canceling: false, runProgress: null }), {
    terminal: false, label: 'running', canCancel: true,
  });
});
