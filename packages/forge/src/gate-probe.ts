/**
 * Proving the gate is live BEFORE a run is given the tools it governs.
 *
 * WHY THIS EXISTS. Forge's argument for handing a headless agent `Bash` is that
 * every command stops at a capsule the owner reads. That argument rests on a
 * chain of things outside this repository: the CLI must accept the flags, spawn
 * the bridge, complete an MCP handshake, find a tool under exactly the name
 * `--permission-prompt-tool` gives it, and then actually consult it. Any link in
 * that chain can break — a CLI upgrade, a renamed flag, a bridge that fails to
 * start — and the observed failure is the worst possible one: the run proceeds,
 * the command executes, and nothing anywhere says the gate was skipped.
 *
 * So the gate is not assumed, it is DEMONSTRATED, once per run, before the agent
 * is started. If the demonstration fails the run does not proceed ungoverned; it
 * drops to the file-only grant Forge had before any of this — no Bash, no host,
 * `--permission-prompts none` — and says so in the run's note. A broken gate
 * costs a capability. It must never cost the guarantee.
 *
 * WHAT THE PROOF ACTUALLY SHOWS. The bridge is spawned exactly as the CLI will
 * spawn it, with the run's own credential, and asked three things:
 *
 *   1. `initialize` — the process starts and speaks the protocol.
 *   2. `tools/list` — it publishes a tool under the bare name the CLI will
 *      resolve `--permission-prompt-tool` to.
 *   3. `tools/call` — a real permission question, answered by the real host.
 *
 * The third is the load-bearing one, and it is why the probe names a tool nobody
 * has classified. An unclassified tool is REFUSED by `classifyToolCall` without
 * anybody being asked, so the probe reaches the daemon, the run credential, the
 * classifier and the decision path, and still creates no capsule, disturbs no
 * owner and writes no receipt. And because the refusal sentence is composed from
 * the classifier's own words, only the live host can produce it: a bridge that
 * cannot reach the daemon denies too, but denies in different words, and the
 * probe tells the two apart instead of accepting any "no" as proof of life.
 *
 * Pure and I/O-free — the spawning lives in `gate-probe-node.ts`.
 */
import { GATE_METHOD, classifyToolCall } from './tools.js';

/**
 * The tool name the probe asks about.
 *
 * Deliberately one Zeno will never classify. It must stay off every list in
 * `tools.ts`: the moment it became a known tool the probe would start putting a
 * capsule in front of the owner at the top of every run.
 */
export const GATE_PROBE_TOOL = 'ZenoGateLivenessProbe';

/** The protocol version the bridge answers `initialize` with. */
const PROTOCOL_VERSION = '2025-06-18';

/** Ids for the three probe requests, in the order they are written. */
const ID_INIT = 0;
const ID_LIST = 1;
const ID_CALL = 2;

/**
 * The exact denial the live host returns for `GATE_PROBE_TOOL`.
 *
 * Computed from the classifier rather than written down, so it cannot drift away
 * from the sentence the host actually produces — and so that a probe which
 * matched it proves the real classifier ran, not that something said "no".
 */
export function expectedProbeDenial(): string {
  const verdict = classifyToolCall(GATE_PROBE_TOOL, {});
  return `${verdict.summary} ${verdict.reasons.join('; ')}.`;
}

/** The three newline-delimited JSON-RPC lines the probe writes to the bridge. */
export function gateProbeRequests(): readonly string[] {
  return [
    JSON.stringify({
      jsonrpc: '2.0',
      id: ID_INIT,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'zeno-forge-gate-probe', version: '0.1.0' },
      },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: ID_LIST, method: 'tools/list' }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: ID_CALL,
      method: 'tools/call',
      params: { name: GATE_METHOD, arguments: { tool_name: GATE_PROBE_TOOL, input: {} } },
    }),
  ];
}

/**
 * What the proof came to. `live: false` is never an error to throw — it is a
 * decision the caller acts on by narrowing the run.
 */
export interface GateProof {
  readonly live: boolean;
  /** One sentence, in the owner's words. Present either way; a proof says what it proved. */
  readonly note: string;
}

/** The sentence a run carries when the proof failed. Asserted by the tests. */
export const GATE_UNPROVEN_NOTE =
  'Zeno could not prove its permission gate was live, so this run was narrowed to files only — no ' +
  'commands, no network, nothing that could leave its worktree. A gate that cannot be shown to work ' +
  'costs the agent a capability, never the guarantee.';

interface Rpc {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

/** Find the response to one request id among the bridge's output lines. */
function responseTo(lines: readonly string[], id: number): Rpc | null {
  for (const line of lines) {
    if (line.trim() === '') continue;
    let msg: Rpc;
    try {
      msg = JSON.parse(line) as Rpc;
    } catch {
      continue; // not our pipe's business; stdout is responses only, but be tolerant
    }
    if (msg.id === id) return msg;
  }
  return null;
}

/**
 * Read the bridge's answers and say whether the gate is live.
 *
 * Every path that is not an unambiguous success returns `live: false`. There is
 * no "probably fine" here: this function's whole purpose is to be the thing that
 * refuses to assume.
 */
export function readGateProbe(lines: readonly string[]): GateProof {
  const init = responseTo(lines, ID_INIT);
  if (init === null || init.result === undefined) {
    return { live: false, note: 'the permission bridge never completed an MCP handshake' };
  }

  const list = responseTo(lines, ID_LIST);
  const tools = (list?.result as { tools?: unknown } | undefined)?.tools;
  const names = Array.isArray(tools)
    ? tools.map((t) => (t as { name?: unknown }).name).filter((n): n is string => typeof n === 'string')
    : [];
  if (!names.includes(GATE_METHOD)) {
    return {
      live: false,
      note: `the permission bridge publishes no "${GATE_METHOD}" tool, so the CLI would have nothing to ask`,
    };
  }

  const call = responseTo(lines, ID_CALL);
  const content = (call?.result as { content?: unknown } | undefined)?.content;
  const text = Array.isArray(content) ? (content[0] as { text?: unknown } | undefined)?.text : undefined;
  if (typeof text !== 'string') {
    return { live: false, note: 'the permission bridge answered a test question with nothing readable' };
  }
  let decision: { behavior?: unknown; message?: unknown };
  try {
    decision = JSON.parse(text) as { behavior?: unknown; message?: unknown };
  } catch {
    return { live: false, note: 'the permission bridge answered a test question with something unparseable' };
  }
  if (decision.behavior !== 'deny') {
    return { live: false, note: 'the permission host did not refuse a tool call nobody has classified' };
  }
  if (decision.message !== expectedProbeDenial()) {
    // A denial in the wrong words is the bridge failing closed on its own — it
    // could not reach the daemon — rather than the daemon answering. Reported as
    // what it is, because "the gate said no" and "nothing was there to ask" are
    // different facts and only one of them means the gate works.
    return {
      live: false,
      note: `the permission bridge could not reach Zeno — ${String(decision.message ?? '').slice(0, 200)}`,
    };
  }
  return { live: true, note: 'the permission gate answered a test call from the running kernel' };
}
