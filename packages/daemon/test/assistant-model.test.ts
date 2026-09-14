/**
 * Ask Zeno lets the owner choose which LOCAL model answers.
 *
 * `POST /assistant/ask` takes an optional `model` — an id from the same list
 * `GET /forge/agents` shows. Three cases are pinned, against a fake Ollama on
 * a configured loopback host so nothing here depends on what is installed on
 * the machine running the suite:
 *
 *   - absent → the default model, exactly as before;
 *   - present and installed → that model is the one in the Ollama request;
 *   - present and NOT installed → the default answers, and the reply says so.
 *
 * On every reply `modelUsed` names what actually answered. The field only ever
 * changes the `model` in a loopback request — it cannot route a question off
 * the machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { CANNOT_ANSWER } from '@abheet19/zeno-assistant';
import { createServer } from '../src/server.js';
import { DEFAULT_ASSISTANT_MODEL } from '../src/routes/assistant.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

const FAKE_OLLAMA = 'http://127.0.0.1:22435';

test('ASK — the model field picks an installed local model, falls back honestly, and defaults when absent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ask-model-'));
  const sandbox = join(dir, 'sandbox');
  mkdirSync(sandbox, { recursive: true });
  const tokens = mintTokens();
  const installed = ['qwen3:8b', 'llama3.1:8b'];
  // The daemon reads OLLAMA_HOST once, at creation; point it at the fake below.
  const server = (() => {
    const previousHost = process.env['OLLAMA_HOST'];
    process.env['OLLAMA_HOST'] = FAKE_OLLAMA;
    try {
      return createServer({
        kernel: new Kernel(nodeWorld(nodeSandboxFs()), { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), policy: DEFAULT_POLICY }),
        sandbox,
        fs: nodeSandboxFs(),
        tokens,
        stream: new Stream(),
        publicDir: join(dir, 'public'),
        work: nodeWorkDesk(dir),
        delegateProbe: { available: async () => ({ localModels: installed, claudeOnPath: false, codexOnPath: false }) },
      });
    } finally {
      if (previousHost === undefined) delete process.env['OLLAMA_HOST'];
      else process.env['OLLAMA_HOST'] = previousHost;
    }
  })();
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The fake Ollama: it records which model every generation asked for and
  // answers with the honest refusal, which grounds cleanly (nothing to cite).
  const realFetch = globalThis.fetch;
  const generatedWith: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === FAKE_OLLAMA + '/api/tags') {
      return new Response(JSON.stringify({ models: installed.map((name) => ({ name })) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === FAKE_OLLAMA + '/api/generate') {
      const sent = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      generatedWith.push(sent.model ?? '(none)');
      return new Response(JSON.stringify({ response: CANNOT_ANSWER }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return await realFetch(input, init);
  }) as typeof fetch;

  interface Reply { answer: string | null; modelUsed: string | null; note: string | null }
  const ask = async (body: Record<string, unknown>): Promise<Reply> => {
    const res = await realFetch(base + '/assistant/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner },
      body: JSON.stringify({ question: 'what is waiting on me?', ...body }),
    });
    const raw = await res.text();
    assert.equal(res.status, 200, raw);
    return JSON.parse(raw) as Reply;
  };

  try {
    const absent = await ask({});
    assert.equal(absent.modelUsed, DEFAULT_ASSISTANT_MODEL, 'no model field: the default answers, as before');
    assert.equal(absent.note, null, 'and nothing is flagged');
    assert.equal(generatedWith.at(-1), DEFAULT_ASSISTANT_MODEL, 'the Ollama request names the default');

    const picked = await ask({ model: 'llama3.1:8b' });
    assert.equal(picked.modelUsed, 'llama3.1:8b', 'an installed model is the one that answers');
    assert.equal(picked.note, null);
    assert.equal(generatedWith.at(-1), 'llama3.1:8b', 'and it is the one in the loopback request');

    const missing = await ask({ model: 'mistral:7b' });
    assert.equal(missing.modelUsed, DEFAULT_ASSISTANT_MODEL, 'an uninstalled model falls back to the default');
    assert.equal(generatedWith.at(-1), DEFAULT_ASSISTANT_MODEL, 'the fallback is what Ollama was asked for');
    assert.match(missing.note ?? '', /mistral:7b is not installed; answered with qwen3:8b/, 'and the reply says so, honestly');
    assert.ok(typeof missing.answer === 'string' && missing.answer !== '', 'the question is still answered');

    const bad = await realFetch(base + '/assistant/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner },
      body: JSON.stringify({ question: 'what is waiting on me?', model: 42 }),
    });
    assert.equal(bad.status, 400, 'a non-string model is refused, not coerced');
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, 'bad-model');

    assert.ok(generatedWith.every((m) => installed.includes(m)), 'no generation ever named a model this machine does not have');
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});
