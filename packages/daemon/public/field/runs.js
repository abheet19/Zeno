/*
 * field/runs.js — the live half of "Command is the orchestrator": a small
 * tracker for GET /forge/run-progress, the same owner-only SSE
 * bind/forge-progress.js and bind/orchestrator.js already read inside Forge
 * and Command's right rail. This is a THIRD reader of that one stream — never
 * a new poll — so the field can draw a node for whatever agent is actually
 * running right now, not just the workspace's uncommitted-changes proxy
 * topology.js already draws.
 *
 * A read-only page (no owner token, see state.js's token()) gets no stream and
 * this module tracks nothing, exactly like the other two readers.
 */
import { subscribeRunProgress } from '../run-progress-stream.js';

// Same wording as bind/forge-progress.js's PHASE_LABEL — duplicated rather
// than imported because that file does not export it and bind/** is outside
// this lane. bind/orchestrator.js already carries its own duplicate for the
// same reason; keep all three in sync.
export const PHASE_LABEL = {
  'checking-provider': 'Checking the model is available',
  'preparing-worktree': 'Preparing an isolated worktree',
  'running-provider': 'The model is working',
  'inspecting-changes': 'Inspecting what changed',
  'proposing-changes': 'Preparing your approvals',
  complete: 'Done',
  completed: 'Done',
  cancelled: 'Cancelled',
  failed: 'Run failed',
};

// How long a finished run's node lingers, flashing its outcome, before it is
// dropped — the same flash-then-clear window the other two readers use for
// their own terminal rows.
const TERMINAL_HOLD_MS = 2600;

/** runId -> { agentId, model, phase, percent, startedAt, terminal, outcome } */
const runs = new Map();
let onChange = null; // set once by startRunStream(); tells the field to repaint

export function fmtElapsed(startedAt) {
  const s = Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Every run this window currently knows about — active, or still flashing its
 *  terminal outcome. topology.js turns each into a node; nothing here is
 *  invented, only what the daemon's own event named. */
export function liveRuns() {
  return [...runs.entries()].map(([runId, r]) => ({ runId, ...r }));
}

function onEvent(ev) {
  if (!ev || typeof ev !== 'object' || !ev.runId) return;
  const prev = runs.get(ev.runId);
  const next = {
    startedAt: (prev && prev.startedAt) || Date.now(),
    agentId: ev.agentId || (prev && prev.agentId) || '',
    model: ev.model || (prev && prev.model) || '',
    phase: ev.phase || (prev && prev.phase) || '',
    percent: Number.isFinite(ev.orchestrationPercent) ? ev.orchestrationPercent : (prev && prev.percent) || 0,
    terminal: !!ev.terminal,
    outcome: ev.outcome || (prev && prev.outcome) || '',
  };
  runs.set(ev.runId, next);
  if (onChange) onChange();

  if (next.terminal) {
    setTimeout(() => {
      const cur = runs.get(ev.runId);
      if (cur && cur.terminal) { runs.delete(ev.runId); if (onChange) onChange(); }
    }, TERMINAL_HOLD_MS);
  }
}

/* Starts the stream once and remembers the repaint callback. data.js calls
   this from refresh() (lazily, on the surface that actually needs it) rather
   than field.js wiring in a new module, so a second call must be a no-op
   instead of opening a second subscription. The one EventSource is shared with
   Forge's progress line and Command's orchestrator — see run-progress-stream.js. */
let started = false;
export function startRunStream(cb) {
  onChange = cb;
  if (started) return;
  started = true;
  subscribeRunProgress(onEvent);
}
