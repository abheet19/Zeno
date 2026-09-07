/**
 * The owner's OWN, SIGNED-IN CHROME, as the classifier and the command line see
 * it.
 *
 * The claims under test are the ones the whole design rests on, and every one of
 * them is a claim the README now makes to an owner in plain words:
 *
 *   NOTHING HERE IS T2 OR BELOW. Even a read is a read of authenticated
 *     content. Every operation is rated STRICTLY ABOVE its `zeno_browse` twin,
 *     and this file asserts the comparison rung by rung rather than asserting
 *     two hard-coded tables that could drift apart.
 *   THE CAPSULE SAYS WHOSE BROWSER THIS IS, and names the ORIGIN, on every
 *     single operation — distinctly from a sandboxed-window capsule.
 *   PER-ORIGIN CONSENT IS ENFORCED BEFORE A CAPSULE EXISTS. An origin off the
 *     allowlist is refused, not asked about.
 *   THE NEVER-LIST BEATS THE ALLOWLIST.
 *   A CALLER THAT LOSES THE POLICY LOSES THE CAPABILITY, never gains one.
 *   THEY ARE ABSENT unless the run was granted them, and always on the ask-list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSE_METHODS,
  CHROME_ACT_METHODS,
  CHROME_METHODS,
  CHROME_NAV_METHODS,
  CHROME_READ_METHODS,
  CLAUDE_BINARY,
  alwaysAskTools,
  browseToolName,
  chromeToolName,
  chromeTools,
  classifyToolCall,
  gateMcpConfig,
  isChromeTool,
  preApprovedTools,
  toolSurface,
  runAgent,
  type RunSpec,
  type SpawnResult,
  type Spawner,
} from '../src/index.js';

const OK: SpawnResult = { code: 0, failedToSpawn: false, stdout: '', stderr: '' };
/** An owner who has allowlisted one ordinary site, and nothing else. */
const ALLOW = { allowed: ['https://github.com'] };

/** The arguments every operation needs, so one loop can cover all five. */
const ARGS = { url: 'https://github.com/a/b', origin: 'https://github.com', selector: '#go', text: 'hi' };

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
    task: 'check the dashboard',
    worktree: 'C:\\ws\\tree',
    gate: { mcpConfig: '{"mcpServers":{}}', chrome: true },
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

test('every Chrome operation is governed — there is no read here that is routine', () => {
  for (const method of CHROME_METHODS) {
    const v = classifyToolCall(chromeToolName(method), ARGS, ALLOW);
    assert.equal(v.gate, 'governed', `${method} must stop for the owner`);
  }
});

test('NOTHING IN THE REAL CHROME IS RATED AS A FETCH — every rung is above its sandboxed twin', () => {
  // The kinds, in the order the policy tiers them. `net.fetch` is T2 and is
  // exactly what must not appear on this side; `shell.exec` and `destructive`
  // are both T3, and `destructive` is the louder of the two.
  const loudness: Record<string, number> = { read: 0, 'net.fetch': 1, 'shell.exec': 2, destructive: 3 };
  for (const method of CHROME_METHODS) {
    const real = classifyToolCall(chromeToolName(method), ARGS, ALLOW);
    const sandboxed = classifyToolCall(browseToolName(method), ARGS);
    assert.notEqual(real.kind, 'net.fetch', `${method} in the owner's Chrome must never be rated as a mere fetch`);
    assert.ok(
      (loudness[real.kind] ?? 0) > (loudness[sandboxed.kind] ?? 0),
      `${method} in the owner's Chrome (${real.kind}) must be rated STRICTLY above the sandboxed window's (${sandboxed.kind})`,
    );
    assert.ok(real.dataZones.includes('personal'), `${method} touches the owner's own signed-in content`);
  }
});

test('clicking and typing as the owner are DESTRUCTIVE, which is the loudest legible kind', () => {
  for (const method of CHROME_ACT_METHODS) {
    assert.equal(classifyToolCall(chromeToolName(method), ARGS, ALLOW).kind, 'destructive');
  }
  for (const method of [...CHROME_READ_METHODS, ...CHROME_NAV_METHODS]) {
    assert.equal(classifyToolCall(chromeToolName(method), ARGS, ALLOW).kind, 'shell.exec');
  }
});

test('EVERY capsule names the origin AND says this is the authenticated profile', () => {
  for (const method of CHROME_METHODS) {
    const v = classifyToolCall(chromeToolName(method), ARGS, ALLOW);
    assert.ok(v.summary.includes('https://github.com'), `${method}'s capsule must name the origin`);
    assert.match(v.summary, /signed-in Chrome/, `${method}'s capsule must say whose browser this is`);
    assert.ok(
      v.reasons.some((r) => r.includes('YOUR OWN SIGNED-IN CHROME')),
      `${method} must say in as many words that this is not the throwaway window`,
    );
  }
});

test('a sandboxed capsule and a real-Chrome capsule can never be mistaken for one another', () => {
  const sandboxed = classifyToolCall(browseToolName('click'), { selector: '#go' });
  const real = classifyToolCall(chromeToolName('click'), ARGS, ALLOW);
  assert.match(sandboxed.summary, /Zeno’s browser/);
  assert.ok(!sandboxed.summary.includes('signed-in'), 'the sandboxed window never claims an identity');
  assert.ok(
    sandboxed.reasons.some((r) => r.includes('no profile, no cookies and no logins')),
    'and says it has none',
  );
  assert.match(real.summary, /Your signed-in Chrome/);
});

test('AN ORIGIN OFF THE ALLOWLIST IS REFUSED — before any capsule exists', () => {
  for (const method of CHROME_METHODS) {
    const v = classifyToolCall(chromeToolName(method), { ...ARGS, url: 'https://elsewhere.test/x', origin: 'https://elsewhere.test' }, ALLOW);
    assert.equal(v.gate, 'refused', `${method} at an unnamed origin is not a question to put to the owner`);
    assert.ok(v.reasons.some((r) => r.includes('not on your Chrome allowlist')));
  }
});

test('THE NEVER-LIST BEATS THE ALLOWLIST, even one the owner wrote themselves', () => {
  const permissive = { allowed: ['https://mail.google.com'] };
  const v = classifyToolCall(chromeToolName('read'), { origin: 'https://mail.google.com' }, permissive);
  assert.equal(v.gate, 'refused');
  assert.ok(v.reasons.some((r) => r.includes('never-list')));
});

test('http, file:, data: and credential-bearing URLs are refused in the real browser', () => {
  for (const url of ['http://github.com/a', 'file:///C:/Users/abhee', 'data:text/html,x', 'https://u:p@github.com/a']) {
    assert.equal(classifyToolCall(chromeToolName('navigate'), { url }, ALLOW).gate, 'refused', `${url} must be refused`);
  }
});

test('A CALLER THAT LOSES THE POLICY LOSES THE CAPABILITY — the default refuses everything', () => {
  for (const method of CHROME_METHODS) {
    // No third argument at all: the classifier falls back to an EMPTY allowlist.
    const v = classifyToolCall(chromeToolName(method), ARGS);
    assert.equal(v.gate, 'refused', `${method} must not be classifiable without the owner's allowlist`);
  }
});

test('a verb Zeno’s Chrome bridge does not have is refused, never rounded to the generic MCP rule', () => {
  const v = classifyToolCall(chromeToolName('evaluate'), { origin: 'https://github.com' }, ALLOW);
  assert.equal(v.gate, 'refused');
  assert.ok(v.reasons.some((r) => r.includes('navigate')), 'and it says what the bridge actually has');
});

test('the Chrome tools are never pre-approved, and are ALWAYS on the ask-list', () => {
  const preApproved = preApprovedTools();
  const ask = alwaysAskTools();
  for (const tool of chromeTools()) {
    assert.ok(!preApproved.includes(tool), `${tool} must never be pre-granted`);
    assert.ok(ask.includes(tool), `${tool} must reach the permission host on every call`);
  }
});

test('the two namespaces are separate, and neither claims the other’s tools', () => {
  for (const tool of chromeTools()) assert.ok(tool.startsWith('mcp__zeno_chrome__'));
  for (const tool of chromeTools()) assert.equal(isChromeTool(tool), true);
  assert.equal(isChromeTool(browseToolName('read')), false, 'the sandboxed window is not the owner’s Chrome');
  assert.deepEqual([...CHROME_METHODS], [...BROWSE_METHODS], 'the same five verbs, deliberately — and two different blast radii');
});

test('ARGV — the Chrome tools are ABSENT unless the run was granted them', async () => {
  const off = await argvFor(gated({ gate: { mcpConfig: 'x' } }));
  for (const tool of chromeTools()) {
    assert.ok(!listAfter(off, '--tools').includes(tool), `${tool} must not exist for a run that was not granted it`);
  }
  // …and it does NOT ride on the network switch, unlike the sandboxed window.
  const netOnly = await argvFor(gated({ gate: { mcpConfig: 'x', network: true } }));
  for (const tool of chromeTools()) {
    assert.ok(!listAfter(netOnly, '--tools').includes(tool), 'the network is not consent to act as the owner');
  }

  const on = await argvFor(gated());
  for (const tool of chromeTools()) {
    assert.ok(listAfter(on, '--tools').includes(tool), `${tool} exists once the owner switched it on and it was proved`);
    assert.ok(!listAfter(on, '--allowedTools').includes(tool), 'and still needs an approval per call');
  }
  const settings = JSON.parse(on[on.indexOf('--settings') + 1]!) as { permissions: { ask: string[] } };
  for (const tool of chromeTools()) {
    assert.ok(settings.permissions.ask.includes(tool), `${tool} must always prompt, whatever the CLI thinks of it`);
  }
});

test('ARGV — the Chrome bridge rides the SAME --mcp-config, and only when granted', () => {
  const both = JSON.parse(gateMcpConfig({ bridgePath: '/b/permission-main.js', browser: true, chrome: true })) as {
    mcpServers: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(both.mcpServers).sort(), ['zeno_browse', 'zeno_chrome', 'zeno_gate']);

  const without = JSON.parse(gateMcpConfig({ bridgePath: '/b/permission-main.js' })) as { mcpServers: Record<string, unknown> };
  assert.deepEqual(Object.keys(without.mcpServers), ['zeno_gate'], 'a run that proved no Chrome declares no Chrome server');
  assert.equal(gateMcpConfig({ chrome: true }).includes('\n'), false, '--mcp-config stays ONE argv element');
});

test('toolSurface: the owner’s Chrome is its own axis and never leaks into another grant', () => {
  assert.equal(toolSurface(false).some(isChromeTool), false);
  assert.equal(toolSurface(true, true).some(isChromeTool), false, 'the network and a sandboxed window are not the owner’s browser');
  assert.equal(toolSurface(false, false, true).filter(isChromeTool).length, CHROME_METHODS.length);
});
