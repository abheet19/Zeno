/**
 * Adding, removing, and reporting on locally installed Ollama models — the
 * owner-facing half of local-model management. Ollama's own up/down lifecycle
 * lives in `ollama-lifecycle.ts`; this module is the routes built on top of it.
 */
import { totalmem, freemem } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../tokens.js';
import { ollamaEndpoint, type ModelPullState, type ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { ensureOllama, installedModelSizes, ollamaUp, probeGpu } from './ollama-lifecycle.js';

/**
 * A live model pull, keyed by model name. Pulling a model is a streaming
 * download from the Ollama registry — network egress AND a multi-gigabyte disk
 * write — so the route that starts one is owner-only and the window discloses
 * the egress before it calls (the same explicit-confirmation shape Forge uses
 * for hosted-provider egress; a pull is not a file-write capsule). This map is
 * in-memory only: a pull is not durable state, and its real receipt is the
 * model appearing in `/api/tags`. Finished pulls are pruned so a long-lived
 * daemon does not accumulate them.
 */
function pruneModelPulls(ctx: ServerCtx): void {
  const now = Date.now();
  for (const [name, st] of ctx.modelPulls) {
    if (st.done && now - st.updatedAt > 300_000) ctx.modelPulls.delete(name);
  }
}

/**
 * Add a model natively: pull it from the Ollama registry so the owner never
 * has to leave Zeno for a terminal. Owner-only, because it egresses and writes
 * gigabytes; the window has already disclosed that before this is called. The
 * download runs fire-and-forget and the window polls GET /forge/models/pull.
 */
export async function postForgeModelPull(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can add a model.', resolve: 'Add it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const name = (str(body, 'name') ?? '').trim();
  // An Ollama model tag: a name, an optional /namespace, an optional :tag. No
  // spaces, no shell metacharacters — this only ever names a registry model.
  // A literal (not a hoisted-away const) so it evaluates when this route runs.
  const modelNameRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
  if (name.length > 96 || !modelNameRe.test(name)) {
    return json(res, 400, { error: { code: 'bad-request', message: 'That is not a valid model name.', resolve: 'Use an Ollama tag such as qwen3:8b or llama3.2.' } });
  }
  const existing = ctx.modelPulls.get(name);
  if (existing !== undefined && !existing.done) {
    return json(res, 200, { started: true, name, already: true, pull: existing });
  }
  if (!(await ensureOllama(ctx))) {
    return json(res, 503, { error: { code: 'ollama-down', message: 'The local Ollama runtime is not running and could not be started.', resolve: 'Start Ollama, then add the model again.' } });
  }
  const state: ModelPullState = {
    name, status: 'starting', completed: 0, total: 0,
    done: false, ok: false, error: null, startedAt: Date.now(), updatedAt: Date.now(),
  };
  ctx.modelPulls.set(name, state);
  void (async () => {
    try {
      const r = await fetch(ollamaEndpoint(ctx, '/api/pull'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!r.ok || r.body === null) {
        state.status = 'error';
        state.error = `Ollama answered ${r.status} when asked to pull ${name}.`;
        state.done = true; state.ok = false; state.updatedAt = Date.now();
        return;
      }
      // Ollama streams NDJSON: one JSON object per line, ending on
      // {"status":"success"} or an {"error":"…"} line for an unknown model.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (line === '') continue;
          let obj: Record<string, unknown>;
          try { obj = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (typeof obj['error'] === 'string') { state.error = obj['error']; state.status = 'error'; }
          if (typeof obj['status'] === 'string') state.status = obj['status'];
          if (typeof obj['total'] === 'number') state.total = obj['total'];
          if (typeof obj['completed'] === 'number') state.completed = obj['completed'];
          state.updatedAt = Date.now();
        }
      }
      state.done = true;
      state.ok = state.error === null && /success/i.test(state.status);
      state.updatedAt = Date.now();
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : 'The pull failed.';
      state.done = true; state.ok = false; state.updatedAt = Date.now();
    }
  })();
  json(res, 202, { started: true, name, pull: state });
}

/** Progress for one pull (?name=) or every tracked pull. Read-only, so it is
 * legible to either role; only starting a pull is owner-gated. */
export function serveForgeModelPulls(ctx: ServerCtx, res: ServerResponse, url: URL): void {
  pruneModelPulls(ctx);
  const name = url.searchParams.get('name');
  if (name !== null) {
    return json(res, 200, { pull: ctx.modelPulls.get(name) ?? null });
  }
  json(res, 200, { pulls: [...ctx.modelPulls.values()] });
}

export async function serveForgeModelHost(ctx: ServerCtx, res: ServerResponse): Promise<void> {
  const [gpu, models] = await Promise.all([probeGpu(ctx), installedModelSizes(ctx)]);
  json(res, 200, { totalMem: totalmem(), freeMem: freemem(), gpu, models });
}

/**
 * Remove a local model. Owner-only: it frees gigabytes of the owner's disk,
 * and it is their own model — reversible by pulling it again, which is exactly
 * what the window says before it asks. Deletes through Ollama's own API so the
 * daemon never touches the model store directly. `name`/`model` are both sent
 * because Ollama renamed the field across versions.
 */
export async function postForgeModelRemove(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can remove a model.', resolve: 'Remove it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const name = (str(body, 'name') ?? '').trim();
  const modelNameRe = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
  if (name.length > 96 || !modelNameRe.test(name)) {
    return json(res, 400, { error: { code: 'bad-request', message: 'That is not a valid model name.', resolve: 'Name a model exactly as it is installed.' } });
  }
  if (!(await ollamaUp(ctx))) {
    return json(res, 503, { error: { code: 'ollama-down', message: 'The local Ollama runtime is not running.', resolve: 'Start Ollama, then remove the model again.' } });
  }
  try {
    const r = await fetch(ollamaEndpoint(ctx, '/api/delete'), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, model: name }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json(res, r.status === 404 ? 404 : 502, {
        error: {
          code: r.status === 404 ? 'not-found' : 'ollama-error',
          message: r.status === 404 ? `Ollama has no model named ${name}.` : `Ollama answered ${r.status} when asked to remove ${name}.`,
          resolve: detail ? detail.slice(0, 300) : 'Check the model name against the installed list.',
        },
      });
    }
    ctx.modelPulls.delete(name); // drop any finished-pull record for a model that is now gone
    json(res, 200, { removed: true, name });
  } catch (err) {
    json(res, 502, { error: { code: 'ollama-error', message: err instanceof Error ? err.message : 'The remove failed.', resolve: 'Check the local Ollama runtime and try again.' } });
  }
}
