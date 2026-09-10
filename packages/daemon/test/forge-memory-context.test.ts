import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { Memory, Vault, nodeClock, nodeNoteStore } from '@abheet19/zeno-vault';
import { createServer } from '../src/server.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

test('Forge Lens and the run share durable, relevant, sanitized Vault context with a per-session opt-out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-forge-memory-'));
  const sandbox = join(dir, 'sandbox');
  const vaultDir = join(dir, 'vault', 'memory');
  mkdirSync(sandbox, { recursive: true });
  execFileSync('git', ['init'], { cwd: sandbox, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'owner@zeno.local'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.name', 'Zeno Owner'], { cwd: sandbox });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'seed'], { cwd: sandbox, stdio: 'ignore' });

  const rawSecret = 'ghp_' + 'a'.repeat(36);
  const beforeReload = new Memory(new Vault(nodeNoteStore(vaultDir), nodeClock()));
  beforeReload.record({
    kind: 'decision',
    description: 'Receipt ledger verification uses the signed chain.',
    body: `Check the receipt self hashes. Historical bad note: ${rawSecret}`,
    source: 'owner',
  });
  beforeReload.record({
    kind: 'preference',
    description: 'Coffee is taken without sugar.',
    body: 'Unrelated personal preference.',
    source: 'owner',
  });
  // A fresh object over the same Markdown directory is the daemon's new-session
  // view. Nothing below depends on renderer or chat state.
  const reloadedVault = new Vault(nodeNoteStore(vaultDir), nodeClock());
  writeFileSync(join(sandbox, 'ZENO.md'), '# Standing context\n\nKeep receipt checks deterministic.\n', 'utf8');

  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const configuredOllama = 'http://127.0.0.1:22439';
  const previousHost = process.env['OLLAMA_HOST'];
  process.env['OLLAMA_HOST'] = configuredOllama;
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), policy: DEFAULT_POLICY }),
    sandbox,
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
    vault: reloadedVault,
    delegateProbe: { available: async () => ({ localModels: ['qwen3:8b'], claudeOnPath: false, codexOnPath: false }) },
  });
  if (previousHost === undefined) delete process.env['OLLAMA_HOST'];
  else process.env['OLLAMA_HOST'] = previousHost;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  const providerPrompts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    if (url === configuredOllama + '/api/tags') return new Response('{}', { status: 200 });
    if (url === configuredOllama + '/api/generate') {
      providerPrompts.push((JSON.parse(String(init?.body)) as { prompt: string }).prompt);
      return new Response(JSON.stringify({ response: '===ANSWER===\nverified\n===END===' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const post = (path: string, body: unknown): Promise<Response> => realFetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner },
    body: JSON.stringify(body),
  });
  const task = 'verify the receipt ledger';

  try {
    const previewResponse = await post('/forge/context', { task });
    assert.equal(previewResponse.status, 200);
    const preview = (await previewResponse.json() as { context: any }).context;
    assert.equal(preview.memory.enabled, true, 'omission means enabled');
    assert.equal(preview.memory.persistent, true);
    assert.equal(preview.memory.entries.length, 1, 'only the task-relevant record is recalled');
    assert.equal(preview.memory.entries[0].source, 'owner');
    assert.match(preview.memory.entries[0].citation, /^vault-memory:/);
    assert.match(preview.prompt, /BEGIN VAULT MEMORY RECORD/);
    assert.match(preview.prompt, /source: owner/);
    assert.doesNotMatch(preview.prompt, /Coffee is taken/);
    assert.doesNotMatch(preview.prompt, new RegExp(rawSecret));
    assert.match(preview.prompt, /REDACTED/);
    assert.equal(preview.prompt.trimEnd().endsWith(task), true, 'the operative owner task remains last');

    const runResponse = await post('/forge/run', {
      task,
      agentId: 'local',
      model: 'qwen3:8b',
      runId: 'memory-enabled',
      contextHash: preview.hash,
    });
    assert.equal(runResponse.status, 200);
    const run = await runResponse.json() as { context: { hash: string; prompt: string } };
    assert.equal(run.context.hash, preview.hash);
    assert.equal(run.context.prompt, preview.prompt, 'the response reports the exact context that was sent');
    assert.ok(providerPrompts[0]?.includes(preview.prompt), 'the provider received the Lens-reviewed prompt bytes');

    const disabledResponse = await post('/forge/context', { task, memoryEnabled: false });
    const disabled = (await disabledResponse.json() as { context: any }).context;
    assert.equal(disabled.memory.enabled, false);
    assert.equal(disabled.memory.entries.length, 0);
    assert.match(disabled.prompt, /DISABLED FOR THIS RUN BY THE OWNER/);
    assert.doesNotMatch(disabled.prompt, /Receipt ledger verification/);
    assert.equal(reloadedVault.size(), 2, 'the per-run switch did not alter or disable the Vault');

    new Memory(reloadedVault).record({
      kind: 'fact',
      description: 'Receipt ledger checks now include the previous hash.',
      body: 'This changes the task-relevant context after preflight.',
      source: 'owner',
    });
    const stale = await post('/forge/run', {
      task,
      agentId: 'local',
      model: 'qwen3:8b',
      runId: 'stale-context',
      contextHash: preview.hash,
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { error: { code: string } }).error.code, 'context-changed');
    assert.equal(providerPrompts.length, 1, 'a changed context is refused before any provider call');
  } finally {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
