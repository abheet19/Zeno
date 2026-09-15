/**
 * Ask Ollama one question and hand the raw text back. Same transport as
 * `runLocalModel` (the configured Ollama HTTP API, never the `ollama` CLI —
 * the daemon's PATH may not have the binary), but this one wants prose, not a
 * file envelope, so it does not parse the response into anything.
 */
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';
import { ensureOllama } from './ollama-lifecycle.js';
import { withoutReasoning } from './forge-local-model.js';

export async function askLocalModel(
  ctx: ServerCtx,
  prompt: string,
  model: string | undefined,
): Promise<{ ok: true; text: string; model: string } | { ok: false; note: string; model: string }> {
  const chosen = model && model.trim() ? model.trim() : 'qwen3:8b';
  // The CONNECTION is what tells us whether Ollama is running, so only the
  // connection is inside this try. Reading the body used to be in here too,
  // which meant a live Ollama answering with something unparseable was
  // reported as "Ollama is not running" — a confident statement about the
  // owner's machine that was simply false, and one that sends them to restart
  // a service that never stopped.
  let r: Response;
  await ensureOllama(ctx); // summarising is the instruction to start the summariser
  try {
    r = await fetch(ollamaEndpoint(ctx, '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: chosen, prompt, stream: false, think: false,
        keep_alive: 0, options: { num_ctx: 8192, num_predict: 512 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return {
      ok: false,
      model: chosen,
      // No answer is invented in this branch, and none ever will be: with no
      // model there is nothing to ground an answer against.
      note: timedOut
        ? 'The local model did not finish this answer within one minute. Nothing unverified was shown; try a narrower question or a smaller model.'
        : `Ollama is not running, so nobody can answer this. Start it, then pull a model (e.g. ollama pull ${chosen}). Your meetings are still on disk and still searchable.`,
    };
  }
  if (!r.ok) {
    return { ok: false, model: chosen, note: `Ollama returned ${r.status}. Is the model pulled? (ollama pull ${chosen})` };
  }
  let text: string;
  try {
    text = withoutReasoning(((await r.json()) as { response?: string }).response ?? '');
  } catch {
    return {
      ok: false,
      model: chosen,
      note: `Ollama is running and answered ${r.status}, but the reply was not the JSON this expects, so there is no answer to ground. Nothing was invented. Check that ${ctx.ollamaBaseUrl} is Ollama and not another service.`,
    };
  }
  if (text.trim() === '') {
    return { ok: false, model: chosen, note: 'The local model returned an empty answer. Try again, or a larger model.' };
  }
  return { ok: true, model: chosen, text: text.trim() };
}
