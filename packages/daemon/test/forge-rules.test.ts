/**
 * Project rules are individually selectable per run.
 *
 * Before this, every rule file `projectRules` found was prepended to every
 * Forge run; a rule had a path and nothing else to name it by. Now each carries
 * a STABLE id (a slug of its project-relative path) and a display name, and a
 * run may say `ruleIds: [...]` to carry only those. Three things are pinned:
 *
 *   1. ids are a pure function of the path — the same repository yields the
 *      same ids on every scan and every restart — and never collide;
 *   2. `ruleIds` narrows the prompt to exactly the named rules, in scan order,
 *      ignoring (and reporting) an id that matches nothing;
 *   3. an ABSENT `ruleIds` is today's behaviour, every rule, so no client that
 *      never heard of the field sees a different prompt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { createServer } from '../src/server.js';
import { projectRules, ruleIdFor, ruleNameFor, selectRules, type ProjectRule } from '../src/routes/forge-context.js';
import type { ServerCtx } from '../src/server/context.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

function rule(path: string, body = `rule at ${path}`): ProjectRule {
  return { id: ruleIdFor(path), name: ruleNameFor(path), path, bytes: body.length, body, truncated: false };
}

test('rule ids are a stable slug of the project-relative path, and names are the file stem', () => {
  assert.equal(ruleIdFor('.cursor/rules/react.mdc'), 'cursor-rules-react-mdc');
  assert.equal(ruleIdFor('AGENTS.md'), 'agents-md');
  assert.equal(ruleIdFor('.github/copilot-instructions.md'), 'github-copilot-instructions-md');
  assert.equal(ruleIdFor('.cursor/rules/react.mdc'), ruleIdFor('.cursor/rules/react.mdc'), 'the same path always yields the same id');
  assert.match(ruleIdFor('.agents/rules/Weird Name (v2).md'), /^[a-z0-9-]+$/, 'an id is always a plain slug');

  assert.equal(ruleNameFor('AGENTS.md'), 'AGENTS');
  assert.equal(ruleNameFor('.cursor/rules/react.mdc'), 'react');
  assert.equal(ruleNameFor('.github/copilot-instructions.md'), 'copilot-instructions');
});

test('a scanned repository yields unique ids that survive a re-scan, and /skills reports them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-rules-'));
  const sandbox = join(dir, 'sandbox');
  try {
    mkdirSync(join(sandbox, '.cursor', 'rules'), { recursive: true });
    mkdirSync(join(sandbox, '.agents', 'rules'), { recursive: true });
    writeFileSync(join(sandbox, 'AGENTS.md'), '# Agents\nBe truthful.\n');
    writeFileSync(join(sandbox, '.cursor', 'rules', 'react.mdc'), 'Prefer function components.\n');
    // Two paths that slug to the same id: the later one (scan order) gets a
    // deterministic suffix, so both are still individually selectable.
    writeFileSync(join(sandbox, '.agents', 'rules', 'a-b.md'), 'first\n');
    writeFileSync(join(sandbox, '.agents', 'rules', 'a_b.md'), 'second\n');

    const ctx = { opts: { fs: nodeSandboxFs(), sandbox } } as unknown as ServerCtx;
    const first = projectRules(ctx);
    const again = projectRules(ctx);
    assert.deepEqual(first.map((r) => r.id), again.map((r) => r.id), 'ids are stable across scans');
    assert.equal(new Set(first.map((r) => r.id)).size, first.length, 'ids are unique');
    assert.deepEqual(
      first.filter((r) => !r.path.startsWith('.agents/')).map((r) => [r.id, r.name, r.path]),
      [
        ['agents-md', 'AGENTS', 'AGENTS.md'],
        ['cursor-rules-react-mdc', 'react', '.cursor/rules/react.mdc'],
      ],
    );
    // The colliding pair: the directory scan's (locale) sort decides which of
    // the two is first — what is pinned is that the first keeps the bare slug,
    // the second gets the suffix, and neither is dropped or shares an id.
    const colliding = first.filter((r) => r.path.startsWith('.agents/'));
    assert.deepEqual(colliding.map((r) => r.id), ['agents-rules-a-b-md', 'agents-rules-a-b-md-2']);
    assert.deepEqual(colliding.map((r) => r.name).sort(), ['a-b', 'a_b']);

    // The wire: GET /skills carries {id, name, path, bytes} beside the fields it always had.
    const tokens = mintTokens();
    const server = createServer({
      kernel: new Kernel(nodeWorld(nodeSandboxFs()), { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), policy: DEFAULT_POLICY }),
      sandbox,
      fs: nodeSandboxFs(),
      tokens,
      stream: new Stream(),
      publicDir: join(dir, 'public'),
      work: nodeWorkDesk(dir),
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(base + '/skills', { headers: { 'x-zeno-token': tokens.owner } });
      assert.equal(res.status, 200);
      const body = await res.json() as { rules: { id: string; name: string; path: string; bytes: number; body: string }[] };
      const react = body.rules.find((r) => r.path === '.cursor/rules/react.mdc');
      assert.ok(react);
      assert.equal(react.id, 'cursor-rules-react-mdc');
      assert.equal(react.name, 'react');
      assert.ok(react.bytes > 0);
      assert.match(react.body, /function components/, 'the existing fields are untouched');
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('selectRules keeps only the named rules in scan order, reports unknown ids, and treats absent as all', () => {
  const all = [rule('AGENTS.md'), rule('.cursor/rules/react.mdc'), rule('.claude/rules/tests.md')];

  const absent = selectRules(all, undefined);
  assert.deepEqual(absent.rules.map((r) => r.path), all.map((r) => r.path), 'no selection means every rule, as before');
  assert.deepEqual(absent.unknownIds, []);

  const some = selectRules(all, ['claude-rules-tests-md', 'agents-md']);
  assert.deepEqual(some.rules.map((r) => r.id), ['agents-md', 'claude-rules-tests-md'], 'scan order, not selection order');
  assert.deepEqual(some.unknownIds, []);

  const stale = selectRules(all, ['cursor-rules-react-mdc', 'renamed-since-md']);
  assert.deepEqual(stale.rules.map((r) => r.id), ['cursor-rules-react-mdc'], 'an unknown id is ignored, never invented');
  assert.deepEqual(stale.unknownIds, ['renamed-since-md']);

  const none = selectRules(all, []);
  assert.deepEqual(none.rules, [], 'an empty selection is a real choice of no rules');
});

test('POST /forge/context: ruleIds narrows the prompt, an absent ruleIds carries every rule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-rules-ctx-'));
  const sandbox = join(dir, 'sandbox');
  mkdirSync(join(sandbox, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(sandbox, 'AGENTS.md'), 'AGENTS-RULE-MARKER\n');
  writeFileSync(join(sandbox, '.cursor', 'rules', 'react.mdc'), 'REACT-RULE-MARKER\n');
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(nodeSandboxFs()), { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), policy: DEFAULT_POLICY }),
    sandbox,
    fs: nodeSandboxFs(),
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  interface ContextBody {
    context: { hash: string; prompt: string; rules: { id: string; name: string; path: string }[]; ruleIds: string[]; unknownRuleIds: string[] };
  }
  const context = async (body: Record<string, unknown>): Promise<ContextBody['context']> => {
    const res = await fetch(base + '/forge/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner },
      body: JSON.stringify({ task: 'tidy the README', memoryEnabled: false, ...body }),
    });
    const raw = await res.text();
    assert.equal(res.status, 200, raw);
    return (JSON.parse(raw) as ContextBody).context;
  };
  try {
    const every = await context({});
    assert.deepEqual(every.ruleIds, ['agents-md', 'cursor-rules-react-mdc'], 'absent ruleIds = every scanned rule');
    assert.match(every.prompt, /AGENTS-RULE-MARKER/);
    assert.match(every.prompt, /REACT-RULE-MARKER/);
    assert.deepEqual(every.unknownRuleIds, []);
    assert.equal(every.rules[0]?.name, 'AGENTS', 'the view names each rule the way the picker does');

    const onlyReact = await context({ ruleIds: ['cursor-rules-react-mdc', 'no-such-rule-md'] });
    assert.deepEqual(onlyReact.ruleIds, ['cursor-rules-react-mdc']);
    assert.match(onlyReact.prompt, /REACT-RULE-MARKER/);
    assert.doesNotMatch(onlyReact.prompt, /AGENTS-RULE-MARKER/, 'an unselected rule is not sent');
    assert.deepEqual(onlyReact.unknownRuleIds, ['no-such-rule-md'], 'a stale id is ignored and reported, never fatal');
    assert.notEqual(onlyReact.hash, every.hash, 'the context binding reflects the selection');

    const none = await context({ ruleIds: [] });
    assert.deepEqual(none.ruleIds, []);
    assert.doesNotMatch(none.prompt, /RULE-MARKER/);
    assert.match(none.prompt, /tidy the README/, 'the owner task is still the operative request');

    const bad = await fetch(base + '/forge/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner },
      body: JSON.stringify({ task: 'tidy the README', ruleIds: 'agents-md' }),
    });
    assert.equal(bad.status, 400, 'a non-array ruleIds is refused legibly, like skillIds');
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, 'bad-rule-ids');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});
