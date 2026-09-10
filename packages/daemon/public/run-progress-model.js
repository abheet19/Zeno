/** Pure validation and presentation model for Forge's live run-progress SSE. */

export const FORGE_ORCHESTRATION_TOTAL = 5;

const PHASE_LABELS = Object.freeze({
  'checking-provider': 'Checking the selected provider',
  'preparing-worktree': 'Preparing the isolated worktree and governed tools',
  'running-provider': 'Running the selected provider',
  'inspecting-changes': 'Inspecting the files the provider changed',
  'proposing-changes': 'Preparing governed change proposals',
  complete: 'Orchestration complete',
  failed: 'Run ended with a failure',
  cancelled: 'Run cancelled',
});

const OUTCOMES = new Set(['completed', 'failed', 'cancelled']);
const RUN_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function exactCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function finalTokenUsage(agentId, input, output) {
  if (agentId !== 'local') {
    return { status: 'unavailable', reason: 'hosted-cli-does-not-report' };
  }
  if (exactCounter(input) && exactCounter(output)) {
    return { status: 'measured', input, output, source: 'ollama-final-response' };
  }
  return { status: 'unavailable', reason: 'ollama-final-counters-missing' };
}

export function initialRunProgress(runId, agentId, model) {
  return {
    runId,
    agentId,
    model: model || null,
    phase: 'checking-provider',
    completed: 0,
    total: FORGE_ORCHESTRATION_TOTAL,
    orchestrationPercent: 0,
    terminal: false,
    outcome: null,
    tokenUsage: agentId === 'local'
      ? { status: 'pending' }
      : { status: 'unavailable', reason: 'hosted-cli-does-not-report' },
  };
}

function parseTokenUsage(raw, agentId, terminal) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.status === 'pending') {
    return agentId === 'local' && terminal === false ? { status: 'pending' } : null;
  }
  if (raw.status === 'measured') {
    return agentId === 'local' && exactCounter(raw.input) && exactCounter(raw.output)
      && raw.source === 'ollama-final-response'
      ? { status: 'measured', input: raw.input, output: raw.output, source: raw.source }
      : null;
  }
  if (raw.status === 'unavailable') {
    const allowed = raw.reason === 'hosted-cli-does-not-report' || raw.reason === 'ollama-final-counters-missing';
    if (!allowed) return null;
    if (agentId === 'local' && raw.reason !== 'ollama-final-counters-missing') return null;
    if (agentId !== 'local' && raw.reason !== 'hosted-cli-does-not-report') return null;
    return { status: 'unavailable', reason: raw.reason };
  }
  return null;
}

/** Reject malformed or self-contradictory events instead of painting guessed state. */
export function parseRunProgress(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.runId !== 'string' || !RUN_ID.test(raw.runId)) return null;
  if (typeof raw.agentId !== 'string' || !(raw.phase in PHASE_LABELS)) return null;
  if (raw.model !== null && typeof raw.model !== 'string') return null;
  if (!Number.isInteger(raw.completed) || raw.completed < 0 || raw.completed > FORGE_ORCHESTRATION_TOTAL) return null;
  if (raw.total !== FORGE_ORCHESTRATION_TOTAL) return null;
  const expectedPercent = Math.round((raw.completed / FORGE_ORCHESTRATION_TOTAL) * 100);
  if (raw.orchestrationPercent !== expectedPercent || typeof raw.terminal !== 'boolean') return null;
  const outcome = raw.outcome === null ? null : raw.outcome;
  if ((raw.terminal && !OUTCOMES.has(outcome)) || (!raw.terminal && outcome !== null)) return null;
  const tokenUsage = parseTokenUsage(raw.tokenUsage, raw.agentId, raw.terminal);
  if (!tokenUsage) return null;
  return {
    runId: raw.runId,
    agentId: raw.agentId,
    model: raw.model,
    phase: raw.phase,
    completed: raw.completed,
    total: raw.total,
    orchestrationPercent: raw.orchestrationPercent,
    terminal: raw.terminal,
    outcome,
    tokenUsage,
  };
}

/** Only the still-running session with the exact run id can consume an event. */
export function applyRunProgress(sessions, raw) {
  const progress = parseRunProgress(raw);
  if (!progress || !Array.isArray(sessions)) return null;
  const session = sessions.find((item) => item && item.running === true && item.runId === progress.runId);
  if (!session || typeof session.id !== 'string') return null;
  const current = session.runProgress;
  if (current && current.runId === progress.runId) {
    if (progress.completed < current.completed) return null;
    if (current.terminal === true && progress.terminal === false) return null;
  }
  session.runProgress = progress;
  return session.id;
}

/** Background sessions update their compact tab only; the active composer keeps focus and text. */
export function shouldRepaintRunProgress(selectedSessionId, updatedSessionId) {
  return typeof updatedSessionId === 'string' && updatedSessionId !== '' && selectedSessionId === updatedSessionId;
}

/** A replay gap makes every currently running session explicitly stale. */
export function markRunProgressGap(sessions) {
  if (!Array.isArray(sessions)) return [];
  const updated = [];
  for (const session of sessions) {
    if (!session || session.running !== true || typeof session.id !== 'string') continue;
    session.runProgressStale = true;
    updated.push(session.id);
  }
  return updated;
}

/**
 * SSE can deliver a terminal event before the authoritative POST settles.
 * Keep that short transport interval terminal in the UI and disable Cancel.
 */
export function runTransportState(session) {
  const progress = session && session.runProgress;
  if (progress && progress.terminal === true) {
    const label = progress.outcome === 'completed'
      ? 'complete'
      : progress.outcome === 'cancelled' ? 'cancelled' : 'failed';
    return { terminal: true, label, canCancel: false };
  }
  const canceling = Boolean(session && session.canceling);
  return {
    terminal: false,
    label: canceling ? 'canceling' : 'running',
    canCancel: Boolean(session && session.runId) && !canceling,
  };
}

export function phaseLabel(progress) {
  return PHASE_LABELS[progress && progress.phase] || 'Waiting for a verified progress event';
}

export function tokenUsageLabel(usage) {
  if (usage && usage.status === 'measured') {
    return `Ollama tokens: ${usage.input.toLocaleString('en-US')} input · ${usage.output.toLocaleString('en-US')} output (final response)`;
  }
  if (usage && usage.status === 'pending') {
    return 'Token usage pending — Ollama reports exact counts only with its final response.';
  }
  if (usage && usage.reason === 'hosted-cli-does-not-report') {
    return 'Exact token usage unavailable — this hosted CLI does not report counters to Zeno.';
  }
  return 'Exact token usage unavailable — Ollama did not return both final counters.';
}
