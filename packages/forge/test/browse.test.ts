/**
 * Zeno's own browser, as the classifier and the command line see it.
 *
 * The claims under test are the ones the design rests on, and each of them has
 * failed somewhere in this repository before:
 *
 *   The browser tools are GOVERNED — every one of them, including the ones that
 *     look like reads. None is ever routine, and the CLI is not left to decide
 *     any of them for itself (`permissions.ask`), because "not in the
 *     pre-approved list" was already proved insufficient once, live.
 *   They are TIERED by what they actually do: navigate and read are egress
 *     (T2), clicking and typing are rated where running a command is (T3).
 *   The capsule carries the LITERAL URL, the LITERAL selector and the LITERAL
 *     text — the same protection `shell.exec` gets and for the same reason.
 *   A navigation Zeno's browser would refuse never becomes a capsule at all.
 *   The tools EXIST only when the run was granted both the network and a proved
 *     browser. Absent from `--tools` is stronger than refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSE_METHODS,
  CLAUDE_BINARY,
  alwaysAskTools,
  browseToolName,
  browseTools,
  classifyToolCall,
  gateMcpConfig,
  isBrowseTool,
  preApprovedTools,
  toolSurface,
  runAgent,
  type RunSpec,
  type SpawnResult,
  type Spawner,
} from '../src/index.js';

const OK: SpawnResult = { code: 0, failedToSpawn: false, stdout: '', stderr: '' };

function recorder(): { spawner: Spawner; calls: { command: string; args: readonly string[] }[] } {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    spawner: {
      run(command, args) {
        calls.push({ command, args });
        return Promise.resolve(OK);
      },
    },
  };
}

function gated(over: Partial<RunSpec> = {}): RunSpec {
  return {
    agentId: 'claude-code',
    task: 'read the docs',
    worktree: 'C:\\ws\\tree',
    gate: { mcpConfig: '{"mcpServers":{}}', network: true, browser: true },
    ...over,
  };
}

async function argvFor(spec: RunSpec): Promise<readonly string[]> {
  const { spawner, calls } = recorder();
  await runAgent(spec, spawner);
  const agent = calls.find((c) => c.command === CLAUDE_BINARY);
  assert.ok(agent, 'the agent was spawned');
  return agent.args;
}

function listAfter(args: readonly string[], flag: string): string[] {
  const at = args.indexOf(flag);
  return at === -1 ? [] : (args[at + 1] ?? '').split(',');
}

test('every browser operation is governed — there is no read here that is routine', () => {
  for (const method of BROWSE_METHODS) {
    const v = classifyToolCall(browseToolName(method), { url: 'https://example.test/', selector: '#go', text: 'hi' });
    assert.equal(v.gate, 'governed', `${method} must stop for the owner`);
  }
});

test('a navigation is egress, and the capsule carries the literal URL', () => {
  const v = classifyToolCall(browseToolName('navigate'), { url: 'https://example.test/order?id=7' });
  assert.equal(v.kind, 'net.fetch', 'the same kind, and so the same tier, as WebFetch');
  assert.deepEqual(v.dataZones, ['external']);
  assert.match(v.summary, /https:\/\/example\.test\/order\?id=7/, 'the owner reads exactly where it goes');
  assert.ok(v.reasons.some((r) => /cannot be recalled/i.test(r)));
  assert.ok(v.reasons.some((r) => /no profile, no cookies and no logins/i.test(r)), 'and what the window is bounded to');
});

test('a URL Zeno’s browser would not open is REFUSED, never put to the owner as a question', () => {
  for (const url of ['file:///C:/Users/abheet/.ssh/id_ed25519', 'data:text/html,<h1>x', 'javascript:alert(1)', 'not a url']) {
    const v = classifyToolCall(browseToolName('navigate'), { url });
    assert.equal(v.gate, 'refused', `${url} is not a page fetch`);
  }
});

test('a credential in a URL is refused rather than printed on a capsule', () => {
  const v = classifyToolCall(browseToolName('navigate'), { url: 'https://user:hunter2@example.test/' });
  assert.equal(v.gate, 'refused');
  assert.ok(v.reasons.some((r) => /credential/i.test(r)));
});

test('reading an open page is egress-rated too — what arrives is untrusted and enters the context', () => {
  for (const method of ['read', 'screenshot']) {
    const v = classifyToolCall(browseToolName(method), {});
    assert.equal(v.kind, 'net.fetch');
    assert.deepEqual(v.dataZones, ['external']);
    assert.ok(v.reasons.some((r) => /no new request is made/i.test(r)), 'and it says it opens nothing new');
    assert.ok(v.reasons.some((r) => /untrusted/i.test(r)));
  }
});

test('a click and a keystroke are rated where a COMMAND is rated, with the literal target shown', () => {
  const click = classifyToolCall(browseToolName('click'), { selector: 'button#place-order' });
  assert.equal(click.kind, 'shell.exec', 'a click can submit, send, accept or buy — it is not a read');
  assert.match(click.summary, /button#place-order/);
  assert.ok(click.dataZones.includes('personal') && click.dataZones.includes('external'));

  const typed = classifyToolCall(browseToolName('type'), { selector: '#q', text: 'my home address' });
  assert.equal(typed.kind, 'shell.exec');
  assert.match(typed.summary, /my home address/, 'the owner reads the exact text before it is entered');
  assert.match(typed.summary, /#q/, 'and the exact element');
});

test('FAIL CLOSED — a browser verb Zeno does not have is refused, not rounded to the generic MCP rule', () => {
  const v = classifyToolCall(browseToolName('download'), { url: 'https://example.test/x.exe' });
  assert.ok(isBrowseTool(browseToolName('download')));
  assert.equal(v.gate, 'refused', 'something calling itself Zeno’s browser is the last thing to round down');
  assert.ok(v.reasons.some((r) => r.includes('navigate')), 'and it says what the browser actually has');
});

test('the browser is never pre-approved, and is ALWAYS on the ask-list', () => {
  const preApproved = preApprovedTools();
  const ask = alwaysAskTools();
  for (const tool of browseTools()) {
    assert.ok(!preApproved.includes(tool), `${tool} must never be pre-granted`);
    // The fail-open that cost a live run was the CLI deciding for itself which
    // calls were harmless. An MCP tool is not exempt from that judgement, so the
    // ask-list names every browser operation on every run, granted or not.
    assert.ok(ask.includes(tool), `${tool} must reach the permission host on every call`);
  }
});

test('ARGV — the browser exists only when the run has BOTH the network and a browser', async () => {
  const none = await argvFor(gated({ gate: { mcpConfig: 'x' } }));
  const netOnly = await argvFor(gated({ gate: { mcpConfig: 'x', network: true } }));
  const browserWithoutNet = await argvFor(gated({ gate: { mcpConfig: 'x', browser: true } }));
  const both = await argvFor(gated());

  for (const [label, args] of [['neither', none], ['network only', netOnly], ['browser without network', browserWithoutNet]] as const) {
    const surface = listAfter(args, '--tools');
    for (const tool of browseTools()) {
      assert.ok(!surface.includes(tool), `${tool} must not exist for a run with ${label}`);
    }
  }
  const granted = listAfter(both, '--tools');
  for (const tool of browseTools()) {
    assert.ok(granted.includes(tool), `${tool} exists once the network is on and the browser was proved`);
    assert.ok(!listAfter(both, '--allowedTools').includes(tool), 'and still needs an approval per call');
  }
});

test('ARGV — the browser rides the SAME --mcp-config as the permission host, and only when granted', () => {
  const withBrowser = JSON.parse(gateMcpConfig({ bridgePath: '/b/permission-main.js', browser: true })) as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(withBrowser.mcpServers).sort(), ['zeno_browse', 'zeno_gate']);

  const without = JSON.parse(gateMcpConfig({ bridgePath: '/b/permission-main.js' })) as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(without.mcpServers), ['zeno_gate'], 'a run that proved no browser declares no browser server');
  assert.equal(gateMcpConfig({ browser: true }).includes('\n'), false, '--mcp-config stays ONE argv element');
});

test('toolSurface: the browser is opt-in on both axes and never leaks into the file-only grant', () => {
  assert.equal(toolSurface(false).some(isBrowseTool), false);
  assert.equal(toolSurface(true).some(isBrowseTool), false, 'the network alone is not a browser');
  assert.equal(toolSurface(true, true).filter(isBrowseTool).length, BROWSE_METHODS.length);
});
