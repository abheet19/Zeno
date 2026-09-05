/**
 * A pure, dependency-free JSON-RPC 2.0 line codec.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0: one message per line, no
 * framing headers, no envelope. This file is the whole wire format — parse one
 * request line, format a result or an error, and dispatch a request to a handler
 * map — and it does it with no I/O and no clock, so `main.ts` is the ONLY place
 * that ever touches a stream. That split is what makes the protocol testable as
 * plain objects: a test drives `dispatch(handlers, parse(line))` and never spawns
 * a process.
 *
 * `dispatch` is total: a handler that throws becomes a JSON-RPC error response,
 * never an unhandled rejection that could take the pipe down. The model on the
 * other end is untrusted, so a malformed or hostile line must degrade into a
 * clean error object, never a crash.
 */

/** The only version this codec speaks. Anything else is an invalid request. */
export const JSONRPC_VERSION = '2.0' as const;

/** JSON-RPC ids are a string, a number, or null. Absent id ⇒ a notification. */
export type JsonRpcId = string | number | null;

/**
 * A parsed inbound message. `id` is ABSENT for a notification (which is exactly
 * how `dispatch` knows to answer with nothing); present — including present and
 * null — for a request that expects a response.
 */
export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly method: string;
  readonly id?: JsonRpcId;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** The standard JSON-RPC 2.0 error codes, named so call sites read as intent. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/**
 * The error a handler throws to choose the code the client sees. Anything else a
 * handler throws is reported as INTERNAL_ERROR with its message — the handler
 * decides the wording, never leaks a stack trace.
 */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    // Omit `data` entirely when there is none — an explicit `undefined` would be
    // a key on the wire that the spec says should not be there.
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** A notification carries no id, so no response is ever owed to it. */
export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined;
}

export type ParseResult =
  | { readonly ok: true; readonly request: JsonRpcRequest }
  | { readonly ok: false; readonly error: JsonRpcFailure };

/**
 * Parse ONE line into a request, or into the error response that line earns.
 * Never throws. A parse failure answers with id `null` because the id is exactly
 * what could not be read; a structurally invalid object answers with its id when
 * that much was legible.
 */
export function parse(line: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, error: failure(null, PARSE_ERROR, 'Parse error: the line is not valid JSON.') };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: failure(null, INVALID_REQUEST, 'A JSON-RPC request must be a single JSON object.'),
    };
  }
  const rec = value as Record<string, unknown>;

  const hasId = 'id' in rec;
  const rawId = rec['id'];
  const idValid = rawId === null || typeof rawId === 'string' || typeof rawId === 'number';
  if (hasId && !idValid) {
    return {
      ok: false,
      error: failure(null, INVALID_REQUEST, 'The "id" must be a string, a number, or null.'),
    };
  }
  const id: JsonRpcId = hasId ? (rawId as JsonRpcId) : null;

  if (rec['jsonrpc'] !== JSONRPC_VERSION) {
    return {
      ok: false,
      error: failure(id, INVALID_REQUEST, 'Missing or invalid "jsonrpc": it must be exactly "2.0".'),
    };
  }
  if (typeof rec['method'] !== 'string') {
    return { ok: false, error: failure(id, INVALID_REQUEST, 'A request needs a string "method".') };
  }

  const request: JsonRpcRequest = {
    jsonrpc: JSONRPC_VERSION,
    method: rec['method'],
    // A key is included only when it was actually present, so a notification stays
    // a notification (no `id`) and an absent `params` never becomes `undefined`.
    ...(hasId ? { id } : {}),
    ...('params' in rec ? { params: rec['params'] } : {}),
  };
  return { ok: true, request };
}

export type Handler = (params: unknown) => unknown | Promise<unknown>;
export type Handlers = Readonly<Record<string, Handler>>;

/**
 * Route one request to its handler and turn the outcome into a response — or into
 * `null` when nothing is owed (a notification: no id, so no reply, whatever the
 * handler did or threw).
 *
 * TOTAL by construction: an unknown method is METHOD_NOT_FOUND, a thrown
 * `RpcError` carries its own code, and anything else a handler throws becomes an
 * INTERNAL_ERROR with that error's message. Nothing escapes as a rejection.
 */
export async function dispatch(
  handlers: Handlers,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const notification = request.id === undefined;
  const id: JsonRpcId = request.id ?? null;
  // Resolve the method as an OWN, callable property only. `method` is untrusted
  // text from the model on the pipe, and a bare `handlers[method]` walks the
  // prototype chain: names like "constructor", "toString", "valueOf" or
  // "__proto__" would otherwise resolve to `Object.prototype` members and be
  // INVOKED — handing back a bogus success (e.g. `constructor` returns the params
  // echoed) or an INTERNAL_ERROR, where the one correct answer is METHOD_NOT_FOUND.
  const handler = Object.prototype.hasOwnProperty.call(handlers, request.method)
    ? handlers[request.method]
    : undefined;

  if (typeof handler !== 'function') {
    return notification ? null : failure(id, METHOD_NOT_FOUND, `Method not found: ${request.method}`);
  }
  try {
    const result = await handler(request.params);
    return notification ? null : success(id, result);
  } catch (err) {
    if (notification) return null;
    if (err instanceof RpcError) return failure(id, err.code, err.message, err.data);
    const message = err instanceof Error ? err.message : 'Internal error.';
    return failure(id, INTERNAL_ERROR, message);
  }
}
