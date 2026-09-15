/**
 * `POST /forge/run`: validate the request, prepare and hash its context, and
 * hand off to `performRun`. Split out of `forge-run.ts` (which keeps the
 * shared `performRun`/`postForgeCancel`/`pickLocalModel`) purely to stay under
 * this repository's per-file line budget — there is no behavioural seam here.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AGENTS, EFFORTS } from '@abheet19/zeno-forge';
import { ForgeRunProgressReporter } from '../forge-run-progress.js';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { FORGE_RUN_ID, MAX_FORGE_TASK_CHARS } from './forge-prompt.js';
import { prepareForgeContext } from './forge-context.js';
import { CODEX_HOSTED_BECAUSE, HOSTED_BECAUSE, probeAgents } from './delegate-probe.js';
import { ensureOllama } from './ollama-lifecycle.js';
import { reserveForgeRun, releaseForgeRun } from './forge-gate.js';
import { performRun, pickLocalModel, WorktreeUnavailable } from './forge-run.js';
import { approvedPlanFromBody, planText } from './forge-plan.js';

/**
 * Run a coding agent HEADLESS in an isolated throwaway worktree, then turn each
 * file it changed into a normal approval capsule against the workspace. The agent
 * proposes by editing a jailed worktree; nothing reaches the workspace until the
 * owner approves each change. Owner-only: starting an agent is the owner's call.
 *
 * This is also the route the window calls when the owner CONFIRMS a hosted
 * delegation — see `resolveDelegation`, which hands back exactly this request.
 */
export async function postForgeRun(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can run an agent.', resolve: 'Run it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const task = str(body, 'task');
  const agentId = str(body, 'agentId') ?? 'claude-code';
  const mode = str(body, 'mode') ?? 'code';
  if (mode !== 'code' && mode !== 'ask') {
    return json(res, 400, { error: { code: 'bad-mode', message: `Unknown Forge mode "${mode}".`, resolve: 'Choose code or ask.' } });
  }
  const agent = AGENTS.find((candidate) => candidate.id === agentId);
  if (agent === undefined) {
    return json(res, 400, {
      error: {
        code: 'unknown-agent',
        message: `Unknown agent "${agentId}".`,
        resolve: `Choose one of: ${AGENTS.map((candidate) => candidate.id).join(', ')}.`,
      },
    });
  }
  if (mode === 'ask' && agent.id !== 'local') {
    return json(res, 409, { error: { code: 'ask-local-only', message: 'Ask mode is read-only and only runs on the local model in this build.', resolve: 'Choose an installed Ollama model, or switch to Code mode for a hosted agent.' } });
  }
  if (task === null || task.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'A run needs a task.', resolve: 'POST {"task":"...","agentId":"claude-code"}.' } });
  }
  if (task.length > MAX_FORGE_TASK_CHARS || task.includes(String.fromCharCode(0))) {
    return json(res, 413, { error: { code: 'task-too-large', message: 'The task is too long.', resolve: 'Keep one run under 16,000 characters and split larger work into bounded tasks.' } });
  }
  const runId = (str(body, 'runId')?.trim() || `run-${Date.now().toString(36)}-${randomUUID()}`);
  if (!FORGE_RUN_ID.test(runId)) {
    return json(res, 400, { error: { code: 'bad-run-id', message: 'The run id is invalid.', resolve: 'Use 1–128 letters, numbers, dots, underscores, colons, or hyphens.' } });
  }
  if (ctx.activeForgeRuns.has(runId)) {
    return json(res, 409, { error: { code: 'run-id-active', message: 'That run id is already active.', resolve: 'Reuse its session or choose a new run id.' } });
  }
  if (agent.id !== 'local' && body['hostedConfirmed'] !== true) {
    const because = agent.id === 'codex' ? CODEX_HOSTED_BECAUSE : HOSTED_BECAUSE;
    const provider = agent.id === 'codex' ? 'OpenAI' : 'Anthropic';
    return json(res, 428, {
      error: {
        code: 'hosted-confirmation-required',
        message: `Confirm this ${agent.label} run before it starts.`,
        resolve: 'Review the provider and usage notice, then resubmit with hostedConfirmed: true.',
      },
      confirmation: { agentId: agent.id, provider, because },
    });
  }
  const requestedModel = str(body, 'model')?.trim() || undefined;
  if (requestedModel !== undefined && agent.id !== 'local' && !agent.models.includes(requestedModel)) {
    return json(res, 400, {
      error: {
        code: 'unsupported-model',
        message: `${agent.label} does not expose model "${requestedModel}" in this build.`,
        resolve: `Choose one of: default, ${agent.models.join(', ')}.`,
      },
    });
  }
  const requestedEffort = str(body, 'effort')?.trim() || undefined;
  if (requestedEffort !== undefined && !(EFFORTS as readonly string[]).includes(requestedEffort)) {
    return json(res, 400, {
      error: { code: 'unsupported-effort', message: `Unknown effort "${requestedEffort}".`, resolve: 'Choose low, medium, high, or the provider default.' },
    });
  }
  // A plan the owner approved on the plan card rides into the prompt as
  // context UNDER the task, never instead of it: the owner's task stays the
  // operative request (and the summary line a held proposal is decided from —
  // `ownerTask` below is still the bare task), the plan is how to do it.
  const approved = approvedPlanFromBody(body);
  if (!approved.ok) return json(res, approved.status, approved.body);
  const taskWithPlan = approved.plan === null ? task : `${task}\n\n${planText(approved.plan)}`;
  if (taskWithPlan.length > MAX_FORGE_TASK_CHARS) {
    return json(res, 413, { error: { code: 'task-too-large', message: 'The task plus its approved plan is too long.', resolve: 'Shorten the plan steps, or run without a plan.' } });
  }
  const prepared = prepareForgeContext(ctx, { ...body, task: taskWithPlan });
  if (!prepared.ok) return json(res, prepared.status, prepared.body);
  if (body['contextHash'] !== undefined && typeof body['contextHash'] !== 'string') {
    return json(res, 400, {
      error: {
        code: 'bad-context-hash',
        message: 'contextHash must be the hash returned by Forge Lens.',
        resolve: 'Refresh the Lens context and start the run again.',
      },
    });
  }
  const contextHash = typeof body['contextHash'] === 'string' ? body['contextHash'].trim().toLowerCase() : '';
  if (contextHash !== '' && !/^[a-f0-9]{64}$/.test(contextHash)) {
    return json(res, 400, {
      error: {
        code: 'bad-context-hash',
        message: 'contextHash is not a complete SHA-256 context binding.',
        resolve: 'Refresh the Lens context and start the run again.',
      },
    });
  }
  if (contextHash !== '' && contextHash !== prepared.view.hash) {
    return json(res, 409, {
      error: {
        code: 'context-changed',
        message: 'The Vault, repository rules, or selected skills changed after Forge Lens prepared this run.',
        resolve: 'Review the refreshed exact context in Forge Lens, then run again.',
      },
      context: prepared.view,
    });
  }
  const boundedTask = prepared.boundedTask;
  // Reserve the id BEFORE the first provider probe/autostart await. Without
  // this reservation two simultaneous requests can both pass the early
  // duplicate check, then the later request can overwrite the first run's
  // controller and make that paid process impossible to cancel or count.
  const reservation = reserveForgeRun(ctx, runId);
  if (!reservation.ok) {
    return reservation.reason === 'run-limit'
      ? json(res, 429, { error: { code: 'run-limit', message: 'Eight Forge runs are already active.', resolve: 'Wait for one to finish or cancel an active session.' } })
      : json(res, 409, { error: { code: 'run-id-active', message: 'That run id is already active.', resolve: 'Reuse its session or choose a new run id.' } });
  }
  const { controller } = reservation;
  const progress = new ForgeRunProgressReporter(ctx.runProgressStream, runId, agent.id, requestedModel);
  try {
    if (agent.id === 'local' && ctx.opts.ollamaAutoStart === true) await ensureOllama(ctx);
    const availability = await probeAgents(ctx);
    const available = agent.id === 'local'
      ? availability.localModels.length > 0
      : agent.id === 'codex'
        ? availability.codexOnPath === true
        : availability.claudeOnPath;
    if (!available) {
      const resolve = agent.id === 'local'
        ? 'Start Ollama and pull a model, then press Reload in Forge.'
        : `Install or repair the ${agent.label} CLI, then press Reload in Forge.`;
      return json(res, 409, {
        error: { code: 'provider-unavailable', message: `${agent.label} is not runnable from this desktop session.`, resolve },
      });
    }
    let model = requestedModel;
    if (agent.id === 'local') {
      if (requestedModel !== undefined && !availability.localModels.includes(requestedModel)) {
        return json(res, 409, {
          error: {
            code: 'model-unavailable',
            message: `The local model "${requestedModel}" is not installed.`,
            resolve: `Choose an installed model or run: ollama pull ${requestedModel}`,
          },
        });
      }
      model = requestedModel ?? pickLocalModel(availability.localModels) ?? undefined;
    }
    progress.providerReady(model);
    const effort = requestedEffort as 'low' | 'medium' | 'high' | undefined;
    const outcome = await performRun(ctx, boundedTask.prompt, agentId, model, effort, progress, runId, controller.signal, task, mode === 'ask');
    json(res, 200, {
      ...outcome,
      context: prepared.view,
      // What the run was told to follow, so the window can say "planned" only
      // about a run that really carried a plan.
      plan: approved.plan === null ? null : { planId: approved.planId, steps: approved.plan.steps.length },
    });
  } catch (err) {
    if (err instanceof WorktreeUnavailable) {
      return json(res, 409, { error: { code: 'worktree-unavailable', message: `Could not isolate the run: ${err.message}`, resolve: 'Ensure the workspace has at least one commit.' } });
    }
    const started = progress.providerStarted;
    progress.stop(controller.signal.aborted ? 'cancelled' : 'failed');
    return json(res, 500, {
      error: started
        ? {
            code: 'run-failed-after-start',
            message: 'The provider started, but Forge could not collect a complete governed result.',
            resolve: 'Review the daemon log, then retry with a new run id. No success or token count is assumed.',
          }
        : {
            code: 'run-preparation-failed',
            message: 'Forge stopped before the provider started.',
            resolve: 'Review the daemon log and retry with a new run id.',
          },
    });
  } finally {
    if (!progress.settled) progress.stop(controller.signal.aborted ? 'cancelled' : 'failed');
    // Never let a late completion erase a newer reservation if this code is
    // changed to support explicit id reuse in the future.
    releaseForgeRun(ctx, runId, controller);
  }
}
