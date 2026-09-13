/**
 * Delegation: the route the window and the voice panel both call to decide —
 * and, for the local rung only, actually start — a coding agent run.
 *
 * One implementation, so a spoken delegation and a typed one cannot drift into
 * disagreeing about which agent runs or what it costs — which is exactly the
 * kind of divergence that ends with a hosted agent starting from a sentence
 * nobody confirmed.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AGENTS } from '@abheet19/zeno-forge';
import { DEFAULT_FORGE_MEMORY_ENABLED } from '../memory-context.js';
import { ForgeRunProgressReporter } from '../forge-run-progress.js';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { FORGE_RUN_ID, MAX_FORGE_TASK_CHARS } from './forge-prompt.js';
import { prepareForgeContext } from './forge-context.js';
import { CODEX_HOSTED_BECAUSE, HOSTED_BECAUSE, NO_AGENT_NOTE, probeAgents } from './delegate-probe.js';
import { reserveForgeRun, releaseForgeRun } from './forge-gate.js';
import { performRun, pickLocalModel, WorktreeUnavailable, type ProposedChange } from './forge-run.js';

/** What a delegation arrives on the proposer token asking for. */
const DELEGATE_OWNER_ONLY =
  'Only the owner starts an agent. This answer suggested one; nothing was started.';

/**
 * What a delegation came to. One shape for all three answers, so a caller
 * cannot render "it is running" for a case where nothing ran.
 *
 * `started` is the only field a UI may read as "an agent is working": it is
 * true exactly when `performRun` returned, and the `proposed` list beside it
 * is what that run left in the approval queue. Nothing in this shape can ever
 * say "applied" — there is no such field, because there is no such outcome
 * without the owner's click.
 */
export interface Delegated {
  readonly started: boolean;
  readonly needsConfirm: boolean;
  readonly agentId: string | null;
  readonly model: string | null;
  readonly task: string;
  /** Stable public identity used by the same owner-only cancel route as Forge. */
  readonly runId: string;
  /**
   * Plan only: this rung can start right now and needs no confirmation.
   *
   * It exists so a caller cannot read the ABSENCE of a confirmation as
   * permission to run. `needsConfirm: false` is also true of a machine with no
   * agent at all, of a proposer token, and of a worktree that could not be
   * made — a UI keying on that would try to start an agent in all three.
   */
  readonly ready?: boolean;
  /** Why a confirmation is being asked for. Present only when one is. */
  readonly because?: string;
  /** The request the window sends when the owner confirms. Present only then. */
  readonly confirm?: { readonly method: 'POST'; readonly path: '/forge/run'; readonly body: Record<string, unknown> };
  /** A plain sentence for every case that is not a start. */
  readonly note?: string;
  readonly changed?: readonly string[];
  readonly proposed?: readonly ProposedChange[];
  readonly log?: string;
  readonly ok?: boolean;
  readonly cancelled?: boolean;
}

/**
 * DECIDE what a delegation would do, and start nothing.
 *
 * Separated from the run so a caller can SAY which agent is about to work
 * before it works. That matters most for the surface where it is hardest —
 * voice, where the owner is not looking at a form and the first thing they
 * should learn is which agent heard them. `resolveDelegation` is this function
 * plus the local start, so the two can never disagree about the decision.
 *
 * THE LINE THIS DRAWS, and the reasoning behind it:
 *
 *   Running an agent produces PROPOSALS, not effects. Every file it writes
 *   comes back as a capsule the owner approves by hand, so starting one is not
 *   a consequential act and does not need an approval capsule of its own.
 *
 *   But a run SPENDS something real, and the local and hosted rungs spend differently. A
 *   local model spends GPU time on a machine the owner already owns, and their
 *   code never leaves it — so a local run may start the moment they ask,
 *   including from a spoken sentence. A hosted agent spends the owner's money
 *   AND sends their code off the machine. That is not a thing to infer from a
 *   sentence someone said out loud, so it is never started here: the answer
 *   describes what it would cost and hands back the request the owner's click
 *   sends.
 *
 *   With neither installed, the answer says so plainly. It never fabricates a
 *   start, and it never quietly picks the hosted rung because the local one is
 *   missing.
 */
export async function planDelegation(
  ctx: ServerCtx,
  task: string,
  role: Role,
  requested?: string,
  requestedRunId?: string,
  memoryEnabled = DEFAULT_FORGE_MEMORY_ENABLED,
): Promise<Delegated> {
  const trimmed = task.trim();
  const runId = requestedRunId ?? `run-${Date.now().toString(36)}-${randomUUID()}`;
  const base = { started: false, needsConfirm: false, agentId: null, model: null, task: trimmed, runId } as const;

  // L6's line, kept where /forge/run keeps it. A proposer token may be TOLD a
  // delegation was suggested; it may not cause one to run.
  if (role !== 'owner') return { ...base, note: DELEGATE_OWNER_ONLY };

  const { localModels, claudeOnPath, codexOnPath = false } = await probeAgents(ctx);
  const model = pickLocalModel(localModels);

  const hostedPlan = (agentId: 'claude-code' | 'codex'): Delegated => {
    const because = agentId === 'codex' ? CODEX_HOSTED_BECAUSE : HOSTED_BECAUSE;
    return {
      ...base,
      needsConfirm: true,
      agentId,
      because,
      confirm: { method: 'POST', path: '/forge/run', body: { task: trimmed, agentId, hostedConfirmed: true, runId, memoryEnabled } },
    };
  };

  // An explicit provider choice is an identity boundary. Never substitute a
  // different hosted provider just because it happens to be installed: that
  // would send code, and spend usage, somewhere the owner did not choose.
  if (requested === 'claude-code') {
    return claudeOnPath
      ? hostedPlan('claude-code')
      : { ...base, agentId: 'claude-code', note: 'Claude Code was selected, but the claude CLI is not runnable from here. Nothing ran and your task was not sent anywhere.' };
  }
  if (requested === 'codex') {
    return codexOnPath
      ? hostedPlan('codex')
      : { ...base, agentId: 'codex', note: 'Codex was selected, but the codex CLI is not runnable from here. Nothing ran and your task was not sent anywhere.' };
  }

  if (requested === 'local' && model === null) {
    return {
      ...base,
      agentId: 'local',
      note: 'A local model was selected, but Ollama reported none installed. Start Ollama and pull one (for example, ollama pull qwen3:8b). Nothing ran and your task was not sent anywhere.',
    };
  }

  // LOCAL — free to start. `ready` is the only field that says so, and it is
  // deliberately not `needsConfirm: false`: three other branches carry that
  // too, and a UI reading the absence of a confirmation as permission to run
  // would try to start an agent this machine does not have.
  if (model !== null) return { ...base, ready: true, agentId: 'local', model };

  // Automatic routing preserves the existing Claude preference, then uses
  // Codex when it is the only hosted CLI available. Both remain behind the
  // provider-and-usage confirmation above.
  if (claudeOnPath) return hostedPlan('claude-code');
  if (codexOnPath) return hostedPlan('codex');

  // No rung is here. Say that, and say what would make it possible.
  return { ...base, note: NO_AGENT_NOTE };
}

/**
 * Decide, and — for the local rung only — actually run.
 *
 * The local start needs no confirmation for a reason worth restating where it
 * happens: the model runs on hardware the owner already owns, their code never
 * leaves the machine, and everything the run PRODUCES still waits for their
 * click. So the thing being spent is their own GPU, and the thing being
 * decided is still theirs to decide, later, one capsule at a time.
 */
export async function resolveDelegation(
  ctx: ServerCtx,
  task: string,
  role: Role,
  requested?: string,
  requestedRunId?: string,
  memoryEnabled = DEFAULT_FORGE_MEMORY_ENABLED,
): Promise<Delegated> {
  const plan = await planDelegation(ctx, task, role, requested, requestedRunId, memoryEnabled);
  if (plan.ready !== true || plan.model === null) return plan;
  const trimmed = plan.task;
  const model = plan.model;
  const runId = plan.runId;
  const base = { started: false, needsConfirm: false, agentId: null, model: null, task: trimmed, runId } as const;
  const reservation = reserveForgeRun(ctx, runId);
  if (!reservation.ok) {
    return {
      ...base,
      agentId: 'local',
      model,
      note: reservation.reason === 'run-limit'
        ? 'Eight Forge runs are already active. Wait for one to finish or cancel an active session.'
        : 'That run id is already active. Reuse its session or choose a new run id.',
    };
  }
  const { controller } = reservation;
  const progress = new ForgeRunProgressReporter(ctx.runProgressStream, runId, 'local', model);
  progress.providerReady(model);
  try {
    const prepared = prepareForgeContext(ctx, { task: trimmed, memoryEnabled });
    if (!prepared.ok) {
      return {
        ...base,
        agentId: 'local',
        model,
        note: `Could not prepare the governed run context, so nothing was started: ${String(((prepared.body['error'] as Record<string, unknown> | undefined)?.['message']) ?? 'unknown context failure')}`,
      };
    }
    const outcome = await performRun(ctx, prepared.boundedTask.prompt, 'local', model, undefined, progress, runId, controller.signal, task);
    return {
      started: true,
      needsConfirm: false,
      agentId: 'local',
      model,
      task: trimmed,
      runId,
      ok: outcome.run.ok,
      cancelled: outcome.run.cancelled,
      changed: outcome.changed,
      proposed: outcome.proposed,
      log: outcome.run.log,
      ...(outcome.run.note === null ? {} : { note: outcome.run.note }),
    };
  } catch (err) {
    // The worktree could not be made, so the agent never ran. Reported as a
    // non-start with the reason — never as a start with nothing to show.
    const why = err instanceof WorktreeUnavailable ? err.message : (err as Error).message;
    return {
      ...base,
      agentId: 'local',
      model,
      note: `Could not isolate the run, so nothing was started: ${why}`,
    };
  } finally {
    if (!progress.settled) progress.stop(controller.signal.aborted ? 'cancelled' : 'failed');
    releaseForgeRun(ctx, runId, controller);
  }
}

export async function postDelegate(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const task = str(body, 'task');
  if (task === null || task.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'A delegation needs a task.', resolve: 'POST {"task":"build a slugify utility"}.' } });
  }
  if (task.length > MAX_FORGE_TASK_CHARS || task.includes(String.fromCharCode(0))) {
    return json(res, 413, { error: { code: 'task-too-large', message: 'The task is too long.', resolve: 'Keep one delegation under 16,000 characters and split larger work into bounded tasks.' } });
  }
  const runId = str(body, 'runId')?.trim() || `run-${Date.now().toString(36)}-${randomUUID()}`;
  if (!FORGE_RUN_ID.test(runId)) {
    return json(res, 400, { error: { code: 'bad-run-id', message: 'The run id is invalid.', resolve: 'Use 1–128 letters, numbers, dots, underscores, colons, or hyphens.' } });
  }
  const requestedValue = body['agentId'];
  const requested = typeof requestedValue === 'string' ? requestedValue.trim() : undefined;
  if (requestedValue !== undefined && (
    requested === undefined ||
    requested === '' ||
    !AGENTS.some((candidate) => candidate.id === requested)
  )) {
    return json(res, 400, {
      error: {
        code: 'unknown-agent',
        message: typeof requestedValue === 'string' ? `Unknown agent "${requestedValue}".` : 'agentId must be a string.',
        resolve: `Choose one of: ${AGENTS.map((candidate) => candidate.id).join(', ')}.`,
      },
    });
  }
  if (body['memoryEnabled'] !== undefined && typeof body['memoryEnabled'] !== 'boolean') {
    return json(res, 400, {
      error: {
        code: 'bad-memory-setting',
        message: 'memoryEnabled must be true or false.',
        resolve: 'Use a boolean per run; this never changes the Vault globally.',
      },
    });
  }
  const memoryEnabled = body['memoryEnabled'] === undefined
    ? DEFAULT_FORGE_MEMORY_ENABLED
    : body['memoryEnabled'] as boolean;
  // `plan: true` decides and starts NOTHING. It is what lets a surface name the
  // agent before it runs — which is the whole of what the voice panel owes the
  // owner, since they are not looking at a picker when they speak.
  const planOnly = body['plan'] === true;
  const delegated = planOnly
    ? await planDelegation(ctx, task, role, requested, runId, memoryEnabled)
    : await resolveDelegation(ctx, task, role, requested, runId, memoryEnabled);
  json(res, 200, { delegated });
}
