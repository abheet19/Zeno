/**
 * The JSON-RPC line codec, tested as pure objects: a line in, a request or the
 * error it earns out; a request routed to a handler, or the total, never-throwing
 * failure a bad handler earns. No stream, no child process — the whole point of
 * keeping this layer pure is that it can be driven exactly like this.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatch,
  failure,
  isNotification,
  parse,
  success,
  JSONRPC_VERSION,
  RpcError,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  type Handlers,
  type JsonRpcId,
  type JsonRpcRequest,
} from '../src/rpc.js';

function reqOf(method: string, id?: JsonRpcId, params?: unknown): JsonRpcRequest {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    ...(id === undefined ? {} : { id }),
    ...(params === undefined ? {} : { params }),
  };
}

// ── parse ────────────────────────────────────────────────────────────────────

test('parse: a well-formed request round-trips, id and params intact', () => {
  const r = parse('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"x"}}');
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.request.id === 7);
  assert.ok(r.ok && r.request.method === 'tools/call');
  assert.deepEqual(r.ok && r.request.params, { name: 'x' });
  assert.equal(r.ok && isNotification(r.request), false);
});

test('parse: a notification has no id and is recognized as one', () => {
  const r = parse('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  assert.ok(r.ok);
  assert.equal('id' in r.request, false, 'no id key at all — not id:null');
  assert.equal(isNotification(r.request), true);
});

test('parse: a request may carry an explicit null id and is still a request', () => {
  const r = parse('{"jsonrpc":"2.0","id":null,"method":"ping"}');
  assert.ok(r.ok);
  assert.equal(isNotification(r.request), false);
  assert.equal(r.request.id, null);
});

test('parse: malformed JSON is a parse error against a null id', () => {
  const r = parse('{ not json');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error.error.code === PARSE_ERROR);
  assert.ok(!r.ok && r.error.id === null);
});

test('parse: an empty line is a parse error, never a silent success', () => {
  const r = parse('');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.error.error.code === PARSE_ERROR);
});

test('parse: a JSON primitive is an invalid request', () => {
  assert.equal(parse('5').ok, false);
  assert.equal(parse('"hi"').ok, false);
  const r = parse('5');
  assert.ok(!r.ok && r.error.error.code === INVALID_REQUEST);
});

test('parse: an array is not a request object', () => {
  const r = parse('[1,2,3]');
  assert.ok(!r.ok && r.error.error.code === INVALID_REQUEST);
  assert.ok(!r.ok && r.error.id === null);
});

test('parse: a non-string, non-number, non-null id is rejected before anything else', () => {
  const r = parse('{"jsonrpc":"2.0","id":{"nope":1},"method":"x"}');
  assert.ok(!r.ok && r.error.error.code === INVALID_REQUEST);
  assert.match(r.ok ? '' : r.error.error.message, /id.*must be/i);
});

test('parse: the wrong jsonrpc version is invalid, and keeps the legible id', () => {
  const r = parse('{"jsonrpc":"1.0","id":3,"method":"x"}');
  assert.ok(!r.ok && r.error.error.code === INVALID_REQUEST);
  assert.ok(!r.ok && r.error.id === 3, 'the id was readable, so the error carries it');
});

test('parse: a missing or non-string method is invalid', () => {
  const missing = parse('{"jsonrpc":"2.0","id":4}');
  assert.ok(!missing.ok && missing.error.error.code === INVALID_REQUEST);
  assert.ok(!missing.ok && missing.error.id === 4);
  const wrong = parse('{"jsonrpc":"2.0","id":4,"method":99}');
  assert.ok(!wrong.ok && wrong.error.error.code === INVALID_REQUEST);
});

// ── format ───────────────────────────────────────────────────────────────────

test('success formats a result envelope', () => {
  assert.deepEqual(success(1, { ok: true }), {
    jsonrpc: '2.0',
    id: 1,
    result: { ok: true },
  });
});

test('failure omits data when there is none, and includes it when there is', () => {
  assert.deepEqual(failure('a', INVALID_PARAMS, 'bad'), {
    jsonrpc: '2.0',
    id: 'a',
    error: { code: INVALID_PARAMS, message: 'bad' },
  });
  assert.deepEqual(failure('a', INVALID_PARAMS, 'bad', { field: 'x' }), {
    jsonrpc: '2.0',
    id: 'a',
    error: { code: INVALID_PARAMS, message: 'bad', data: { field: 'x' } },
  });
});

// ── dispatch: total, never throws ────────────────────────────────────────────

const handlers: Handlers = {
  echo: (params) => ({ echoed: params }),
  boom: () => {
    throw new RpcError(INVALID_PARAMS, 'a controlled refusal', { why: 'test' });
  },
  crash: () => {
    throw new Error('kaboom');
  },
  weird: () => {
    throw 'not an Error object';
  },
  noticed: () => 'ack',
};

test('dispatch: a known method returns a success with the handler result', async () => {
  const res = await dispatch(handlers, reqOf('echo', 1, { a: 1 }));
  assert.deepEqual(res, { jsonrpc: '2.0', id: 1, result: { echoed: { a: 1 } } });
});

test('dispatch: an unknown method is METHOD_NOT_FOUND, not a throw', async () => {
  const res = await dispatch(handlers, reqOf('nope', 2));
  assert.ok(res && 'error' in res && res.error.code === METHOD_NOT_FOUND);
});

test('dispatch: an unknown method sent as a notification gets no response', async () => {
  assert.equal(await dispatch(handlers, reqOf('nope')), null);
});

test('dispatch: a handler RpcError becomes a failure with its code and data', async () => {
  const res = await dispatch(handlers, reqOf('boom', 3));
  assert.ok(res && 'error' in res);
  if (res && 'error' in res) {
    assert.equal(res.error.code, INVALID_PARAMS);
    assert.equal(res.error.message, 'a controlled refusal');
    assert.deepEqual(res.error.data, { why: 'test' });
  }
});

test('dispatch: any other thrown Error becomes INTERNAL_ERROR with its message', async () => {
  const res = await dispatch(handlers, reqOf('crash', 4));
  assert.ok(res && 'error' in res);
  if (res && 'error' in res) {
    assert.equal(res.error.code, INTERNAL_ERROR);
    assert.equal(res.error.message, 'kaboom');
  }
});

test('dispatch: a thrown non-Error still degrades to a clean INTERNAL_ERROR', async () => {
  const res = await dispatch(handlers, reqOf('weird', 5));
  assert.ok(res && 'error' in res && res.error.code === INTERNAL_ERROR);
  assert.ok(res && 'error' in res && res.error.message === 'Internal error.');
});

test('dispatch: a notification to a known handler still returns nothing', async () => {
  assert.equal(await dispatch(handlers, reqOf('noticed')), null);
});

test('dispatch: a notification whose handler throws is swallowed, not surfaced', async () => {
  assert.equal(await dispatch(handlers, reqOf('boom')), null);
});

// ── hostile input: the model on the pipe is untrusted ────────────────────────

// A JSON-RPC `method` is attacker-controlled text. A naive `handlers[method]`
// walks the prototype chain, so these inherited `Object.prototype` names would
// resolve to real functions and be invoked: "constructor" would return the
// params echoed back as a bogus success, "toString"/"valueOf"/"hasOwnProperty"
// an INTERNAL_ERROR — anywhere the one correct answer is METHOD_NOT_FOUND.
for (const reserved of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
  test(`dispatch: reserved name "${reserved}" is METHOD_NOT_FOUND, never an inherited member invoked`, async () => {
    const res = await dispatch(handlers, reqOf(reserved, 1, { pwned: true }));
    // A failure (has `error`) is by construction not a success: the old bug
    // returned success({pwned:true}) for "constructor" and INTERNAL_ERROR for
    // "valueOf"/"hasOwnProperty" — both are ruled out here.
    assert.ok(res && 'error' in res, 'must be a METHOD_NOT_FOUND failure, never an invoked inherited member');
    if (res && 'error' in res) {
      assert.equal(res.error.code, METHOD_NOT_FOUND);
    }
  });
}

test('dispatch: a reserved name as a notification still gets no response', async () => {
  assert.equal(await dispatch(handlers, reqOf('constructor')), null);
  assert.equal(await dispatch(handlers, reqOf('__proto__')), null);
});

test('parse: absurdly deep nesting never throws — it degrades to a clean result', () => {
  // V8 parses deep structures iteratively, so this returns ok:true with the deep
  // params intact; the contract that matters is only that parse NEVER throws and
  // the pipe stays up, whatever the depth.
  const depth = 200_000;
  const line = `{"jsonrpc":"2.0","id":1,"method":"echo","params":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
  const r = parse(line); // must not throw
  assert.equal(typeof r.ok, 'boolean');
});

test('deeply nested params pass through dispatch untouched — no recursion, no crash', async () => {
  // A 10k-deep object. The kernel's recursive canonical hasher would stack-overflow
  // on this, but the pure dispatcher and these handlers never recurse INTO params —
  // they wrap it and hand it back — so a hostile depth is just an ordinary echo.
  let nested: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 10_000; i++) nested = { a: nested };
  const res = await dispatch(handlers, reqOf('echo', 9, nested));
  assert.ok(res && 'result' in res, 'the deep payload round-trips without crashing the dispatcher');
});

test('interleaved garbage between valid requests: each line stands alone, the pipe stays up', async () => {
  // This is exactly what main.ts does per line — parse, then dispatch — run over a
  // hostile mix. A garbage line must not poison the valid request beside it.
  const lines = [
    '{"jsonrpc":"2.0","id":1,"method":"echo","params":{"a":1}}', // valid
    'not json at all }{',                                          // garbage
    '',                                                            // blank
    '[1,2,3]',                                                     // valid JSON, invalid request
    '{"jsonrpc":"2.0","id":2,"method":"echo","params":{"b":2}}', // valid
    '{"jsonrpc":"2.0","id":3,"method":"constructor"}',            // hostile method name
  ];
  const out: unknown[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue; // main.ts drops blank lines
    const parsed = parse(line);
    if (!parsed.ok) {
      out.push(parsed.error);
      continue;
    }
    const res = await dispatch(handlers, parsed.request);
    if (res !== null) out.push(res);
  }
  // Two valid echoes succeed, in order, untouched by the garbage around them.
  const successes = out.filter((m): m is { id: number; result: unknown } => !!m && typeof m === 'object' && 'result' in m);
  assert.deepEqual(successes.map((s) => s.id), [1, 2]);
  assert.deepEqual(successes.map((s) => s.result), [{ echoed: { a: 1 } }, { echoed: { b: 2 } }]);
  // The garbage line is a PARSE_ERROR, the array an INVALID_REQUEST, the hostile
  // method a METHOD_NOT_FOUND — three clean errors, no crash, nothing swallowed.
  const errors = out.filter((m): m is { error: { code: number } } => !!m && typeof m === 'object' && 'error' in m);
  assert.deepEqual(errors.map((e) => e.error.code).sort((a, b) => a - b), [PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND].sort((a, b) => a - b));
});
