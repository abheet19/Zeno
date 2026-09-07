/**
 * The proof that the gate is live — and, more importantly, what it refuses to
 * accept as proof.
 *
 * The failure this guards against is not a crash. It is a run that LOOKS
 * governed: the flags are right, the bridge is named, and the CLI quietly never
 * asks. So every assertion below is about the negative case — the probe must say
 * `live: false` for a bridge that is missing, silent, unregistered, or denying
 * for its OWN reasons rather than relaying the kernel's.
 *
 * The last of those is the subtle one. The bridge fails closed by design, so a
 * daemon that is not there produces a denial too. A probe that accepted any
 * denial as proof of life would be proving the opposite of what it claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GATE_METHOD,
  GATE_PROBE_TOOL,
  classifyToolCall,
  expectedProbeDenial,
  gateProbeRequests,
  nodeGateProber,
  readGateProbe,
} from '../src/index.js';

/** One JSON-RPC response line, as the bridge writes them. */
function line(id: number, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/** The tool result shape a permission decision travels in. */
function decisionLine(id: number, decision: unknown): string {
  return line(id, { content: [{ type: 'text', text: JSON.stringify(decision) }] });
}

/** Everything a healthy bridge says, in order. */
function healthy(): string[] {
  return [
    line(0, { protocolVersion: '2025-06-18', capabilities: { tools: {} } }),
    line(1, { tools: [{ name: GATE_METHOD }] }),
    decisionLine(2, { behavior: 'deny', message: expectedProbeDenial() }),
  ];
}

test('the probe names a tool Zeno will never classify, so it disturbs nobody', () => {
  const verdict = classifyToolCall(GATE_PROBE_TOOL, {});
  assert.equal(
    verdict.gate,
    'refused',
    'the probe must be refused by the classifier — a probe that reached the owner would put a capsule at the top of every run',
  );
});

test('a healthy bridge proves the gate is live', () => {
  const proof = readGateProbe(healthy());
  assert.equal(proof.live, true);
  assert.match(proof.note, /kernel/, 'and says what it proved');
});

test('silence is not proof', () => {
  assert.equal(readGateProbe([]).live, false, 'a bridge that said nothing proves nothing');
  assert.equal(readGateProbe(['', '   ']).live, false);
  assert.equal(readGateProbe(['not json at all']).live, false);
});

test('a bridge that publishes no permission tool is not a gate', () => {
  const lines = healthy();
  lines[1] = line(1, { tools: [{ name: 'something_else' }] });
  const proof = readGateProbe(lines);
  assert.equal(proof.live, false);
  assert.match(proof.note, new RegExp(GATE_METHOD), 'and names the tool the CLI would have looked for');
});

test('THE SUBTLE ONE — a denial in the bridge’s own words is not the kernel answering', () => {
  // This is exactly what a daemon that has gone away produces: the bridge fails
  // closed, on its own, without ever reaching the kernel. It is a denial, and it
  // is NOT evidence that a capsule would ever reach the owner.
  const lines = healthy();
  lines[2] = decisionLine(2, {
    behavior: 'deny',
    message: 'Zeno’s gate could not be reached (ECONNREFUSED), so nothing was run and nobody was asked.',
  });
  const proof = readGateProbe(lines);
  assert.equal(proof.live, false, 'a "no" from the wrong place is not proof the right place is listening');
  assert.match(proof.note, /could not reach Zeno/);
});

test('an ALLOW for an unclassified tool is the loudest possible failure', () => {
  // Nothing legitimate answers "yes" to a tool nobody has classified. Something
  // that does is not Zeno's host, whatever else it might be.
  const lines = healthy();
  lines[2] = decisionLine(2, { behavior: 'allow', updatedInput: {} });
  assert.equal(readGateProbe(lines).live, false);
});

test('the requests are well-formed MCP, and the last one asks the real question', () => {
  const reqs = gateProbeRequests().map((r) => JSON.parse(r) as Record<string, unknown>);
  assert.equal(reqs[0]!['method'], 'initialize');
  assert.equal(reqs[2]!['method'], 'tools/list');
  assert.equal(reqs[3]!['method'], 'tools/call');
  const params = reqs[3]!['params'] as { name: string; arguments: { tool_name: string } };
  assert.equal(params.name, GATE_METHOD, 'called by its bare name, as an MCP client calls it');
  assert.equal(params.arguments.tool_name, GATE_PROBE_TOOL);
});

test('THE REAL EDGE — a bridge that cannot start is reported, never assumed away', async () => {
  const prober = nodeGateProber({ timeoutMs: 8000, bridgePath: join(tmpdir(), 'zeno-no-such-bridge-xyz.js') });
  const proof = await prober.prove({ ZENO_GATE_URL: 'http://127.0.0.1:1', ZENO_GATE_TOKEN: 't', ZENO_GATE_RUN: 'r' });
  assert.equal(proof.live, false, 'no bridge, no proof, no shell');
});

test('THE REAL EDGE — a bridge that says nothing at all times out rather than passing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-mute-bridge-'));
  try {
    // Reads its input and answers nothing — the shape of a bridge whose protocol
    // has moved on. It must cost the run its shell, not be waited on forever.
    const mute = join(dir, 'mute.mjs');
    writeFileSync(mute, 'process.stdin.resume();\nsetTimeout(() => process.exit(0), 30_000);\n', 'utf8');
    const proof = await nodeGateProber({ timeoutMs: 1500, bridgePath: mute }).prove({
      ZENO_GATE_URL: 'http://127.0.0.1:1',
      ZENO_GATE_TOKEN: 't',
      ZENO_GATE_RUN: 'r',
    });
    assert.equal(proof.live, false);
    assert.match(proof.note, /did not answer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
