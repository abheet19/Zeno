/**
 * NeoSapien — the owner's connected personal-memory MCP server.
 *
 * REAL and EXTERNAL: `search_memories`, `list_all_memories`, `get_memory_by_id`,
 * `get_reminders` and `get_daily_summary` are genuine tools a genuine server at
 * `https://api.neosapien.xyz/mcp` answers — this is not a fabricated connector.
 * But it is also not this machine's own state: everything it returns is the
 * owner's own data reflected back, over the network, from an account this
 * daemon does not otherwise touch. It is folded into Ask Zeno's snapshot as its
 * own EXTERNAL MEMORY section (see `@abheet19/zeno-assistant`'s `snapshot.ts`)
 * precisely so it is never mistaken for Zeno's own governed Vault.
 *
 * CONFIGURATION IS ONE CREDENTIAL. `ZENO_NEOSAPIEN_TOKEN`, read fresh from the
 * process environment on every call — never cached, never written to disk,
 * never logged. Unset means NOT CONFIGURED, reported as a plain fact and
 * exactly like every other "this daemon does not have that" answer in this
 * codebase (the GitHub adapter without a token, Ollama not running): no
 * network call is even attempted, and the owner is told what would turn it on.
 *
 * THE SAME HONESTY RULE AS `github.ts`: a failed call must never look like an
 * empty result. Every failure below carries a distinct reason a caller can
 * branch on, and the one true empty result is `{ ok: true, hits: [] }` — asked,
 * and there was nothing.
 */
import { randomUUID } from 'node:crypto';

/** The one endpoint this file will ever call. */
const NEOSAPIEN_ENDPOINT = 'https://api.neosapien.xyz/mcp';
/** A call that hangs is a call that has silently stopped answering. */
const REQUEST_TIMEOUT_MS = 8_000;
/** The MCP protocol revision this daemon speaks. */
const PROTOCOL_VERSION = '2024-11-05';

export interface NeosapienHit {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export type NeosapienFailureReason = 'not-configured' | 'timeout' | 'unreachable' | 'http-error' | 'malformed';

export type NeosapienResult =
  | { readonly ok: true; readonly hits: readonly NeosapienHit[] }
  | { readonly ok: false; readonly reason: NeosapienFailureReason; readonly message: string };

/** The bearer token, or `null` when none is configured. Read fresh each call. */
function token(): string | null {
  const t = (process.env['ZENO_NEOSAPIEN_TOKEN'] ?? '').trim();
  return t === '' ? null : t;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * One JSON-RPC round trip. The Streamable HTTP transport MCP uses may answer
 * as a plain JSON body or as a single `data:` SSE line carrying the same
 * JSON-RPC envelope — both are accepted, since which one a given server
 * chooses is a transport detail this daemon has no reason to care about.
 */
async function rpc(
  bearer: string,
  method: string,
  params: unknown,
  sessionId: string | null,
): Promise<{ readonly body: Record<string, unknown>; readonly sessionId: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${bearer}`,
  };
  if (sessionId !== null) headers['mcp-session-id'] = sessionId;

  const res = await fetch(NEOSAPIEN_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const nextSession = res.headers.get('mcp-session-id');
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`NeoSapien answered ${res.status} for ${method}`);
    (err as Error & { httpStatus: number }).httpStatus = res.status;
    throw err;
  }
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  const payload = (line ? line.slice(5) : text).trim();
  let parsed: unknown;
  try {
    parsed = payload === '' ? {} : JSON.parse(payload);
  } catch {
    throw new Error(`NeoSapien's reply to ${method} was not valid JSON: ${payload.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`NeoSapien's reply to ${method} was not an object.`);
  }
  return { body: parsed as Record<string, unknown>, sessionId: nextSession ?? sessionId };
}

/**
 * Search the owner's NeoSapien personal memory for the terms in `query`.
 *
 * Always safe to call: with no `ZENO_NEOSAPIEN_TOKEN` configured this returns
 * `not-configured` immediately, with no network attempted at all.
 */
export async function searchNeosapienMemories(query: string, limit = 5): Promise<NeosapienResult> {
  const q = query.trim();
  const bearer = token();
  if (bearer === null) {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'NeoSapien is not connected to this daemon — set ZENO_NEOSAPIEN_TOKEN to enable personal-memory recall.',
    };
  }
  if (q === '') return { ok: true, hits: [] };

  try {
    const init = await rpc(
      bearer,
      'initialize',
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'zeno-command', version: '0.1.0' } },
      null,
    );
    const call = await rpc(bearer, 'tools/call', { name: 'search_memories', arguments: { query: q, limit } }, init.sessionId);
    const errorField = call.body['error'] as { message?: unknown } | undefined;
    if (errorField) {
      throw new Error(typeof errorField.message === 'string' ? errorField.message : 'NeoSapien returned an error.');
    }
    const result = call.body['result'] as { content?: unknown } | undefined;
    const content = Array.isArray(result?.content) ? (result?.content as unknown[]) : [];
    const hits: NeosapienHit[] = [];
    for (const item of content) {
      const rec = item as { type?: unknown; text?: unknown } | null;
      if (rec && rec.type === 'text' && typeof rec.text === 'string' && rec.text.trim() !== '') {
        hits.push({ id: `ns-${hits.length + 1}`, title: 'NeoSapien memory', body: rec.text.trim() });
      }
      if (hits.length >= limit) break;
    }
    return { ok: true, hits };
  } catch (err) {
    if (isTimeout(err)) {
      return { ok: false, reason: 'timeout', message: `NeoSapien did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.` };
    }
    const httpStatus = (err as { httpStatus?: unknown } | null)?.httpStatus;
    if (typeof httpStatus === 'number') {
      return { ok: false, reason: 'http-error', message: `NeoSapien answered ${httpStatus}.` };
    }
    if (err instanceof Error && /not valid JSON|was not an object/.test(err.message)) {
      return { ok: false, reason: 'malformed', message: err.message };
    }
    return { ok: false, reason: 'unreachable', message: `Could not reach NeoSapien: ${(err as Error).message ?? err}.` };
  }
}
