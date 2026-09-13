/**
 * `POST /forge/plan` — the intake step BEFORE a run: a read-only research pass
 * that returns a structured plan the owner approves, edits, or discards.
 *
 * What makes it read-only is what it does NOT do: no worktree is created, no
 * file is written, no command is spawned, no proposal is filed. The model sees
 * the same bounded repository context a run would (rules, Vault memory,
 * selected skills, the file pack) and answers with a plan — nothing else. The
 * plan is stored server-side by id so the eventual run can carry the owner's
 * approved text as context, and `approvedPlanFromBody` is what /forge/run uses
 * to accept the (possibly owner-edited) plan back.
 *
 * Planning always uses a LOCAL model, even when the run will go to a hosted
 * CLI: neither Claude Code nor Codex has a plan mode that spends nothing, so a
 * "free" hosted plan would be a fabrication. With no local model installed the
 * route says so and the window offers to run without a plan.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { jail } from '@abheet19/zeno-kernel';
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';
import type { Role } from '../tokens.js';
import { json, readJson, str } from './http.js';
import { probeAgents } from './delegate-probe.js';
import { prepareForgeContext } from './forge-context.js';
import { withoutReasoning } from './forge-local-model.js';
import { MAX_FORGE_TASK_CHARS } from './forge-prompt.js';
import { readUtf8Bounded } from './forge-text.js';
import { pickLocalModel } from './forge-run.js';
import { ensureOllama } from './ollama-lifecycle.js';

export interface ForgePlan {
  readonly goal: string;
  readonly steps: readonly string[];
  readonly files: readonly string[];
  readonly risks: readonly string[];
}

interface StoredPlan {
  readonly planId: string;
  readonly task: string;
  readonly plan: ForgePlan;
  readonly model: string;
  readonly at: number;
}

/** Bounds on what an approved plan may carry back into a run prompt. */
const MAX_PLAN_STEPS = 40;
const MAX_PLAN_ITEM_CHARS = 600;
const MAX_STORED_PLANS = 32;
const PLAN_ID = /^plan-[a-z0-9]+-[a-f0-9-]{36}$/;

/** Plans this daemon produced and has not yet handed to a run. Bounded; never persisted. */
const plans = new Map<string, StoredPlan>();

/** Strings only, trimmed, non-empty, bounded — a model or a client can send anything. */
function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAN_ITEM_CHARS))
    .filter((v) => v !== '')
    .slice(0, max);
}

function planFromUnknown(value: unknown): ForgePlan | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const goal = typeof v['goal'] === 'string' ? v['goal'].replace(/\s+/g, ' ').trim().slice(0, MAX_PLAN_ITEM_CHARS) : '';
  const steps = cleanList(v['steps'], MAX_PLAN_STEPS);
  if (steps.length === 0) return null;
  return { goal, steps, files: cleanList(v['files'], MAX_PLAN_STEPS), risks: cleanList(v['risks'], MAX_PLAN_STEPS) };
}

/** The plan as prose for a run prompt — one canonical rendering, shared by the run and the window. */
export function planText(plan: ForgePlan): string {
  const lines = [
    'OWNER-APPROVED PLAN (produced by a read-only planning pass; follow it, and say so if a step proves wrong):',
    plan.goal ? `Goal: ${plan.goal}` : '',
    'Steps:',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    plan.files.length ? `Files expected to change: ${plan.files.join(', ')}` : '',
    plan.risks.length ? `Risks and open questions: ${plan.risks.join('; ')}` : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export type ApprovedPlan =
  | { readonly ok: true; readonly plan: ForgePlan | null; readonly planId: string | null }
  | { readonly ok: false; readonly status: number; readonly body: Record<string, unknown> };

/**
 * Accept the plan a run body carries. The window sends the FINAL plan (the
 * owner may have edited steps) and, when it has one, the id of the daemon's
 * original; the id is consumed so one plan cannot be replayed into two runs.
 */
export function approvedPlanFromBody(body: Record<string, unknown>): ApprovedPlan {
  if (body['plan'] === undefined || body['plan'] === null) return { ok: true, plan: null, planId: null };
  const plan = planFromUnknown(body['plan']);
  if (plan === null) {
    return { ok: false, status: 400, body: { error: { code: 'bad-plan', message: 'The approved plan needs at least one step.', resolve: 'Approve or edit the plan card, or run without a plan.' } } };
  }
  const planId = str(body, 'planId');
  if (planId !== null && planId !== '' && !PLAN_ID.test(planId)) {
    return { ok: false, status: 400, body: { error: { code: 'bad-plan-id', message: 'The plan id is not one this daemon issued.', resolve: 'Plan again, or run without a plan.' } } };
  }
  if (planId) plans.delete(planId);
  return { ok: true, plan, planId: planId || null };
}

/**
 * The same file pack `runLocalModel` builds — but read from the SANDBOX, not a
 * worktree, because a plan must not create one. Both reads are jailed and
 * bounded; neither writes.
 */
function repositoryPack(ctx: ServerCtx, task: string): { tree: string[]; pack: string[] } {
  const NL = String.fromCharCode(10);
  const treeOutput = ctx.gitRunner.run(['ls-files'], ctx.opts.sandbox).stdout;
  const tree = treeOutput.slice(0, 1_000_000).split(NL).map((f) => f.trim()).filter(Boolean);
  const SRC = /\.(js|mjs|cjs|ts|tsx|jsx|json|css|html|md|py)$/i;
  const lower = task.toLowerCase();
  const named = tree.filter((f) => lower.includes((f.split('/').pop() ?? '').toLowerCase()));
  const rest = tree.filter((f) => !named.includes(f) && SRC.test(f));
  const pack: string[] = [];
  let spent = 0;
  for (const rel of [...named, ...rest].slice(0, 12)) {
    try {
      const remaining = 24_000 - spent;
      if (remaining <= 0) break;
      const source = readUtf8Bounded(jail(ctx.forgeFs, ctx.opts.sandbox, rel), remaining);
      if (source.truncated || spent + source.text.length > 24_000) continue;
      spent += source.text.length;
      pack.push(`===FILE: ${rel}===${NL}${source.text}${NL}===END===`);
    } catch { /* an unreadable file contributes nothing, never an invented one */ }
  }
  return { tree, pack };
}

/** Ollama's structured-output schema: the model is constrained to this shape. */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['goal', 'steps', 'files', 'risks'],
};

export async function postForgePlan(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can ask for a plan.', resolve: 'Plan it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const task = str(body, 'task');
  if (task === null || task.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'A plan needs a task.', resolve: 'POST {"task":"..."}.' } });
  }
  if (task.length > MAX_FORGE_TASK_CHARS || task.includes(String.fromCharCode(0))) {
    return json(res, 413, { error: { code: 'task-too-large', message: 'The task is too long.', resolve: 'Keep one task under 16,000 characters.' } });
  }
  // Rules, Vault memory and selected skills: the plan reads exactly what the run will.
  const prepared = prepareForgeContext(ctx, body);
  if (!prepared.ok) return json(res, prepared.status, prepared.body);
  if (ctx.opts.ollamaAutoStart === true) await ensureOllama(ctx);
  const availability = await probeAgents(ctx);
  const requestedModel = str(body, 'model')?.trim() || undefined;
  const agentId = str(body, 'agentId') ?? 'local';
  const model = (agentId === 'local' && requestedModel && availability.localModels.includes(requestedModel))
    ? requestedModel
    : pickLocalModel(availability.localModels);
  if (model === null) {
    return json(res, 409, {
      error: {
        code: 'plan-unavailable',
        message: 'No local model is installed, and a hosted agent has no plan mode that spends nothing — Zeno will not pretend it planned.',
        resolve: 'Pull an Ollama model (ollama pull qwen3:8b) to plan on this machine, or run without a plan.',
      },
    });
  }
  const NL = String.fromCharCode(10);
  const { tree, pack } = repositoryPack(ctx, task);
  const prompt = [
    'You are a senior engineer doing INTAKE for a coding task. You are READ-ONLY: you must not edit anything, only plan.',
    tree.length === 0 ? 'THE REPOSITORY IS EMPTY — there are no existing files.' : `THE REPOSITORY CONTAINS THESE FILES:${NL}${tree.slice(0, 200).join(NL)}`,
    pack.length === 0 ? '' : `CURRENT CONTENTS OF THE MOST RELEVANT FILES:${NL}${NL}${pack.join(NL + NL)}`,
    prepared.boundedTask.prompt,
    // Last on purpose: Ollama's Qwen3 template appends its own "/no_think"
    // switch to the END of the prompt when thinking is off, and a model copied
    // it into the goal when the owner's task sat there. It now lands here.
    'Answer with JSON only: {"goal": one-sentence restatement of the owner task, "steps": [3 to 8 concrete steps], "files": [relative paths you expect to create or change], "risks": [risks or questions for the owner; may be empty]}.',
    'Name only files that exist in the list above or that the task asks to create. Never invent repository contents. Output the JSON now.',
  ].filter((l) => l !== '').join(NL + NL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  timeout.unref?.();
  let text = '';
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  try {
    const r = await fetch(ollamaEndpoint(ctx, '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false, format: PLAN_SCHEMA, options: { num_predict: 2048 } }),
      signal: controller.signal,
    });
    if (!r.ok) {
      return json(res, 502, { error: { code: 'plan-failed', message: `Ollama returned ${r.status} while planning with ${model}.`, resolve: `Check the model is pulled (ollama pull ${model}), or run without a plan.` } });
    }
    const reply = (await r.json()) as { response?: unknown; prompt_eval_count?: number; eval_count?: number };
    text = typeof reply.response === 'string' ? reply.response : '';
    tokensIn = reply.prompt_eval_count ?? null;
    tokensOut = reply.eval_count ?? null;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return json(res, 502, {
      error: {
        code: 'plan-failed',
        message: aborted ? `The local model (${model}) did not finish planning within two minutes.` : `Ollama could not be reached for planning: ${(err as Error).message}`,
        resolve: 'Start Ollama, try a smaller model, or run without a plan.',
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  // The schema constrains the reply, but a model can still return an empty
  // step list or (without the schema honoured) reasoning around the object.
  let parsed: unknown = null;
  try { parsed = JSON.parse(withoutReasoning(text).trim()); } catch {
    const m = /\{[\s\S]*\}/.exec(withoutReasoning(text));
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }
  const plan = planFromUnknown(parsed);
  if (plan === null) {
    return json(res, 502, { error: { code: 'plan-unparseable', message: `${model} did not return a usable plan (no steps).`, resolve: 'Plan again with a larger model, or run without a plan.' } });
  }
  const planId = `plan-${Date.now().toString(36)}-${randomUUID()}`;
  if (plans.size >= MAX_STORED_PLANS) {
    const oldest = [...plans.values()].sort((a, b) => a.at - b.at)[0];
    if (oldest) plans.delete(oldest.planId);
  }
  plans.set(planId, { planId, task, plan, model, at: Date.now() });
  json(res, 200, {
    planId,
    plan,
    agentId: 'local',
    model,
    tokensIn,
    tokensOut,
    readOnly: true,
    note: `Planned on ${model} on this machine by reading the repository — no worktree was created, no file was written, no command ran, and nothing was proposed.`,
    contextHash: prepared.view.hash,
  });
}
