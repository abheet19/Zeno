/**
 * The blast-radius classifier.
 *
 * Two things are being proved here, and only one of them is "the table is
 * right". The other is the direction the table fails in: an unknown tool, an
 * unnamed tool and anything reached through a process Zeno did not start all
 * round UP. A classifier that rounds down is worse than no classifier, because
 * it produces a run that LOOKS governed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATE_TOOL,
  NETWORK_TOOLS,
  NEVER_TOOLS,
  classifyToolCall,
  isMcpTool,
  preApprovedTools,
  toolSurface,
} from '../src/index.js';

test('inside the worktree is routine — reads, writes and the model\'s own bookkeeping', () => {
  for (const name of ['Read', 'Glob', 'Grep', 'NotebookRead']) {
    const v = classifyToolCall(name, { file_path: 'src/a.ts' });
    assert.equal(v.gate, 'routine', `${name} reads inside the throwaway worktree`);
    assert.equal(v.kind, 'read');
  }
  for (const name of ['Write', 'Edit', 'NotebookEdit']) {
    const v = classifyToolCall(name, { file_path: 'src/a.ts', content: 'x' });
    assert.equal(v.gate, 'routine');
    assert.equal(v.kind, 'local.write', 'a write in the worktree is the T0 kind — it becomes a capsule later');
  }
  for (const name of ['TodoWrite', 'ExitPlanMode', 'BashOutput', 'KillShell']) {
    assert.equal(classifyToolCall(name, {}).gate, 'routine', `${name} starts no effect and lets none out`);
  }
});

test('a command is always governed, and the exact command is what the owner is shown', () => {
  const v = classifyToolCall('Bash', { command: 'npm test' });
  assert.equal(v.gate, 'governed');
  assert.equal(v.kind, 'shell.exec');
  assert.match(v.summary, /npm test/, 'the capsule carries the literal command — that IS the check');
  assert.deepEqual(v.dataZones, ['personal']);
});

test('a command with the shape of a destruction is rated destructive, not merely run', () => {
  for (const command of [
    'rm -rf /tmp/x',
    'rm -fr node_modules',
    'git push --force origin main',
    'git reset --hard HEAD~3',
    'npm publish',
    'dd if=/dev/zero of=/dev/sda',
    'shutdown /s',
    'chmod -R 777 /',
  ]) {
    const v = classifyToolCall('Bash', { command });
    assert.equal(v.gate, 'governed');
    assert.equal(v.kind, 'destructive', `"${command}" is not an ordinary command`);
  }
});

test('a command that reaches at Zeno\'s own evidence is rated loudest of all', () => {
  for (const command of [
    'cat ~/.zeno/ledger.jsonl',
    'echo x > ledger.jsonl',
    'type proposer.token',
    'cp policy.json /tmp',
    'ls keys/',
  ]) {
    const v = classifyToolCall('Bash', { command });
    assert.equal(v.kind, 'destructive', `"${command}" names the record this run will be judged by`);
    assert.ok(
      v.reasons.some((r) => /ledger|keys|token|policy/i.test(r)),
      'and the capsule says which part of the governance surface it named',
    );
  }
});

test('an ordinary command says plainly that no rule recognised it — not that it is safe', () => {
  const v = classifyToolCall('Bash', { command: 'node scripts/deploy.js' });
  assert.equal(v.kind, 'shell.exec');
  assert.ok(
    v.reasons.some((r) => /read the command itself/i.test(r)),
    'the patterns raise a tier; they never certify a command as harmless',
  );
});

test('egress is governed and named as the thing with no undo', () => {
  const fetched = classifyToolCall('WebFetch', { url: 'https://example.test/x' });
  assert.equal(fetched.gate, 'governed');
  assert.equal(fetched.kind, 'net.fetch');
  assert.deepEqual(fetched.dataZones, ['external']);
  assert.match(fetched.summary, /example\.test/, 'the owner sees where it is going');
  assert.ok(fetched.reasons.some((r) => /cannot be recalled/i.test(r)));

  const searched = classifyToolCall('WebSearch', { query: 'how to parse porcelain' });
  assert.equal(searched.kind, 'net.fetch');
  assert.match(searched.summary, /porcelain/, 'and what is being sent');
});

test('anything reached through an MCP server is rated as if it leaves the machine', () => {
  const v = classifyToolCall('mcp__chrome__navigate', { url: 'https://example.test' });
  assert.ok(isMcpTool('mcp__chrome__navigate'));
  assert.equal(v.gate, 'governed');
  assert.equal(v.kind, 'net.fetch', 'Zeno cannot bound a process it did not start, so it assumes the most');
  assert.deepEqual(v.dataZones, ['external']);
});

test('FAIL CLOSED — a tool nobody has classified is refused, never waved through', () => {
  const v = classifyToolCall('SomeToolShippedNextTuesday', { anything: true });
  assert.equal(v.gate, 'refused', 'an unclassified capability is not a safe one');
  assert.ok(v.reasons.some((r) => /nobody has decided/i.test(r)));
  assert.ok(v.reasons.some((r) => /forge\/src\/tools\.ts/.test(r)), 'and it says how to widen the surface deliberately');
});

test('FAIL CLOSED — a request with no tool name is refused', () => {
  for (const name of ['', '   ']) {
    assert.equal(classifyToolCall(name, {}).gate, 'refused');
  }
});

test('the never-list is refused whatever anyone approves — subagents and the host itself', () => {
  // Both names, because they are the same tool and the CLI has carried each in
  // turn. An unrecognised name in --tools is silently ignored rather than
  // refused, so a denial naming only one would stop covering the subagent the
  // day the other name won, and nothing would say so.
  for (const name of ['Task', 'Agent']) {
    const task = classifyToolCall(name, { prompt: 'do it for me' });
    assert.equal(task.gate, 'refused', `${name} starts a second agent`);
    assert.ok(task.reasons.some((r) => /second agent/i.test(r)));
  }

  const self = classifyToolCall(GATE_TOOL, { tool_name: 'Bash', input: { command: 'rm -rf /' } });
  assert.equal(self.gate, 'refused', 'the agent may not call the thing that asks the owner questions');
  assert.ok(self.reasons.some((r) => /real tool call/i.test(r)));
});

test('the surface and the pre-approved set differ by exactly the calls that can escape', () => {
  const surface = toolSurface(false);
  const pre = preApprovedTools();
  const needsAsking = surface.filter((t) => !pre.includes(t));
  assert.deepEqual(needsAsking, ['Bash'], 'with the network off, Bash is the whole of what stops');

  const withNetwork = toolSurface(true).filter((t) => !pre.includes(t));
  assert.deepEqual(withNetwork, ['Bash', ...NETWORK_TOOLS], 'and turning the network on adds tools that stop, not tools that run');
});

test('nothing on the never-list is ever in the surface', () => {
  for (const network of [false, true]) {
    for (const banned of NEVER_TOOLS) {
      assert.ok(!toolSurface(network).includes(banned), `${banned} must not exist for a run`);
    }
  }
});

test('every tool in the pre-approved set really does classify as routine', () => {
  // The two lists are written separately and must not be allowed to drift: a
  // tool pre-granted in the argv but rated `governed` here would be a call that
  // runs with nobody asked and a classifier that believes otherwise.
  for (const name of preApprovedTools()) {
    assert.equal(classifyToolCall(name, {}).gate, 'routine', `${name} is pre-granted, so it had better be routine`);
  }
});
