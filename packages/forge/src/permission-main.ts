#!/usr/bin/env node
/**
 * `zeno-forge-gate` — the stdio bridge the Claude Code CLI asks for permission
 * through.
 *
 * The CLI, run with `--permission-prompts host --permission-prompt-tool
 * mcp__zeno_gate__request_permission`, hands every tool call it cannot decide
 * for itself to an MCP tool. This process publishes that tool. It is spawned by
 * the CLI, not by Zeno, and it is deliberately the DUMBEST thing in the chain:
 *
 *   IT DECIDES NOTHING. It relays the call to the daemon and relays the answer
 *     back. Classification, the kernel preview, the owner's click and the
 *     receipt all happen on the other side of the loopback, in the one process
 *     that holds the kernel. Two places that decide is two policies that drift.
 *
 *   IT CANNOT APPROVE, and it does not even hold a credential that could ask to.
 *     Its token is minted per RUN and authorises exactly one verb — "ask about a
 *     tool call in this run" — at exactly one route. It is not the proposer
 *     token and it is certainly not the owner's.
 *
 *   IT FAILS CLOSED. A daemon that is not there, a socket that drops, a body it
 *     cannot parse: every one of them is a DENIAL. There is no branch in this
 *     file where something going wrong ends in the tool call proceeding.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0, and stdout is that pipe:
 * nothing but responses may ever be written to it, or the client's parse breaks.
 * Everything else goes to stderr.
 *
 * Like the other production edges in this repo it carries no logic worth unit
 * testing — the deciding all lives behind it, in `permission.ts` and
 * `permission-gate.ts`, and is exercised there.
 */
import { createInterface } from 'node:readline';
import { GATE_METHOD, GATE_SERVER } from './tools.js';
import { permissionToolResult, type PermissionDecision } from './permission.js';

/** stderr only — stdout is the JSON-RPC pipe and must stay clean. */
function log(line: string): void {
  process.stderr.write(line + '\n');
}

const PROTOCOL_VERSION = '2025-06-18';

/** The one tool this server publishes. Its full name is `mcp__zeno_gate__request_permission`. */
const TOOL = {
  name: GATE_METHOD,
  description:
    'Zeno decides whether one tool call may proceed. It is called by the CLI’s permission machinery, ' +
    'never by the model: a call that can reach outside the run’s worktree becomes an approval capsule ' +
    'the owner reads and clicks, and the answer comes back with the receipt that proves it.',
  inputSchema: {
    type: 'object',
    properties: {
      tool_name: { type: 'string' },
      input: { type: 'object' },
      tool_use_id: { type: 'string' },
    },
    required: ['tool_name'],
  },
} as const;

function deny(message: string): PermissionDecision {
  return { behavior: 'deny', message };
}

/**
 * Ask the daemon. Every failure mode resolves to a denial with a sentence the
 * model can act on — there is no throw path out of here.
 */
async function ask(url: string, token: string, runId: string, params: unknown): Promise<PermissionDecision> {
  let res: Response;
  try {
    res = await fetch(`${url}/forge/permissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-gate': token },
      body: JSON.stringify({ runId, request: params }),
    });
  } catch (err) {
    return deny(
      `Zeno’s gate could not be reached (${(err as Error).message}), so nothing was run and nobody was asked. ` +
        'The run is still governed; it simply cannot grant anything right now.',
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return deny('Zeno’s gate answered with something this bridge could not read. Nothing was run.');
  }
  const decision = (body as { decision?: PermissionDecision } | null)?.decision;
  if (decision === undefined || (decision.behavior !== 'allow' && decision.behavior !== 'deny')) {
    return deny(`Zeno’s gate did not return a decision (HTTP ${res.status}). Nothing was run.`);
  }
  return decision;
}

interface Rpc {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

function write(message: unknown): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(line: string, url: string, token: string, runId: string): Promise<void> {
  if (line.trim() === '') return;
  let msg: Rpc;
  try {
    msg = JSON.parse(line) as Rpc;
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  const id = msg.id;
  const isNotification = id === undefined || id === null;

  if (msg.method === 'initialize') {
    if (!isNotification) {
      write({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: GATE_SERVER, version: '0.1.0' },
          instructions:
            'This server exists for the CLI’s permission machinery. It answers one question — may this ' +
            'tool call proceed — by putting it in front of Zeno’s owner. It grants nothing itself.',
        },
      });
    }
    return;
  }
  if (msg.method === 'tools/list') {
    if (!isNotification) write({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    return;
  }
  if (msg.method === 'tools/call') {
    const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (p.name !== TOOL.name) {
      if (!isNotification) {
        write({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${String(p.name)}` } });
      }
      return;
    }
    const decision = await ask(url, token, runId, p.arguments ?? {});
    if (!isNotification) write({ jsonrpc: '2.0', id, result: permissionToolResult(decision) });
    return;
  }
  if (isNotification) return; // a notification we do not implement needs no reply
  write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(msg.method)}` } });
}

function main(): void {
  const url = (process.env['ZENO_GATE_URL'] ?? '').replace(/\/+$/, '');
  const token = process.env['ZENO_GATE_TOKEN'] ?? '';
  const runId = process.env['ZENO_GATE_RUN'] ?? '';
  if (url === '' || token === '' || runId === '') {
    // Started without its wiring: it stays up and denies everything, rather than
    // exiting and leaving the CLI to fall back to some other permission answer.
    log('zeno-forge-gate · no ZENO_GATE_URL / ZENO_GATE_TOKEN / ZENO_GATE_RUN — every call will be denied.');
  } else {
    log(`zeno-forge-gate · run ${runId} · asking ${url}. This bridge decides nothing and can approve nothing.`);
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // Serialize handling so responses leave in request order and never interleave.
  let tail: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    tail = tail.then(() => handle(line, url, token, runId)).catch((err: unknown) => {
      log(`zeno-forge-gate · ${(err as Error).message}`);
    });
  });
  rl.on('close', () => {
    process.exitCode = 0;
  });
}

main();
