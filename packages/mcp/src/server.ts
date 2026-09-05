/**
 * The MCP method set, as PURE handlers over an injected Kernel and work source.
 *
 * This is the same L6 line the daemon draws, drawn again at the MCP edge: the
 * model on the other end of the pipe is untrusted, and this server must be safe
 * even if that model is actively hostile. So the tools it exposes can only ever
 *   PROPOSE  — run the risk assessment + the kernel preview, and (for a routine
 *              T0 write, and only that) commit it and hand back the receipt; or
 *   READ     — the backlog, the receipt history, the chain status.
 * There is deliberately NO `zeno.approve`. Approval is a single-use, hash-bound
 * grant that the kernel issues only through the owner channel — a human act in
 * the Zeno window. A proposer cannot mint one here because there is no method
 * that asks for one, not because this code is well behaved. That is L6 as
 * structure, at the model's own doorstep.
 *
 * Everything non-deterministic (the clock, ids, the filesystem) arrives through
 * the injected Kernel / SandboxFs / WorkSource, so the whole method set is a
 * plain function of its inputs and every handler is testable as pure objects.
 */
import {
  assessWrite,
  jail,
  makeWritePayload,
  worktreeExecutor,
  PolicyError,
  type ActionRequest,
  type Kernel,
  type SandboxFs,
} from '@abheet19/zeno-kernel';
import { INVALID_PARAMS, RpcError, type Handler, type Handlers } from './rpc.js';

/** The MCP protocol revision this server reports at `initialize`. */
export const PROTOCOL_VERSION = '2025-06-18';

export const SERVER_INFO = { name: 'zeno-mcp', version: '0.1.0' } as const;

/**
 * What the client is told the server is — and, plainly, what it will never do.
 * The refusal is documented where a connecting model actually reads: the
 * `instructions` the server hands back at initialize.
 */
export const SERVER_INSTRUCTIONS =
  'Zeno governs an "agent proposes, owner disposes" boundary. These tools let you ' +
  'PROPOSE file writes and READ the backlog, receipts and chain status. They can ' +
  'never ACT on their own: a routine sandbox edit is applied and receipted; anything ' +
  'riskier is held for the owner and returns its actionHash. There is no approve ' +
  'tool — approval is a human act in the Zeno window and cannot happen over MCP.';

/**
 * One unit of work the owner keeps. Deliberately minimal — id, the two lines a
 * human reads, and when it arrived — so the work source stays a narrow port and
 * not a second copy of any provider's schema.
 */
export interface WorkItem {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * The backlog port. `list` and `add` may be sync or async; the impure adapter in
 * `main.ts` fills it from disk, a test fills it from memory. Adding an item is a
 * PROPOSAL to do something later — it records intent and causes no effect.
 */
export interface WorkSource {
  list(): Promise<readonly WorkItem[]> | readonly WorkItem[];
  add(input: { readonly title: string; readonly body: string }): Promise<WorkItem> | WorkItem;
}

export interface McpServerOptions {
  readonly kernel: Kernel;
  readonly fs: SandboxFs;
  /** Absolute sandbox root. Nothing is ever written outside it. */
  readonly sandbox: string;
  readonly work: WorkSource;
  /**
   * The proposer identity recorded on every request. Defaults to 'agent'. It is
   * never trusted to approve — the kernel's L6 check and the absence of an
   * approve method both see to that — it is only recorded as who asked.
   */
  readonly requestedBy?: string;
}

// ── MCP tool result shape ────────────────────────────────────────────────────

interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

interface ToolResult {
  readonly content: readonly TextContent[];
  /** The same payload as data, so a client need not re-parse the text block. */
  readonly structuredContent?: unknown;
  /** True when the tool ran but the outcome is a refusal, not a protocol error. */
  readonly isError?: boolean;
}

/** A successful tool result: the payload as pretty text AND as structured data. */
function ok(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/**
 * A refusal the kernel handed back as a `PolicyError` — a path that escapes the
 * sandbox, say. It is a normal outcome, not a crash: the tool ran and the answer
 * is "no", carrying the reason and the one action that resolves it.
 */
function refusal(err: PolicyError): ToolResult {
  const payload = { status: 'refused', code: err.code, message: err.message, resolve: err.resolve };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

// ── the tool catalogue (full JSON Schemas) ───────────────────────────────────

export const TOOLS = [
  {
    name: 'zeno.propose_write',
    description:
      'Propose writing a file inside the sandbox. Runs the risk assessment and the ' +
      'kernel preview. A routine edit (T0) is applied and its receipt returned; ' +
      'anything riskier is HELD for the owner and returns its actionHash. This tool ' +
      'cannot approve — approval happens only in the Zeno window.',
    inputSchema: {
      type: 'object',
      properties: {
        relPath: {
          type: 'string',
          description: 'Path relative to the sandbox root. Absolute or climbing paths are rejected.',
        },
        contents: { type: 'string', description: 'The exact bytes to write.' },
        summary: {
          type: 'string',
          description: 'One human sentence describing the change; shown in the preview and recorded on the receipt.',
        },
      },
      required: ['relPath', 'contents', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'zeno.list_work',
    description: 'List the local backlog of work items (read-only).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'zeno.add_work',
    description:
      'Add a local backlog item — a proposal to do something later. Records intent; ' +
      'causes no effect.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The one line that names the work. Required, non-empty.' },
        body: { type: 'string', description: 'Optional detail.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'zeno.list_receipts',
    description: 'The receipt history (read-only). Pass "after" to page from a known receipt id.',
    inputSchema: {
      type: 'object',
      properties: {
        after: { type: 'string', description: 'Return only receipts recorded after the one with this id.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'zeno.verify_chain',
    description: 'Report the tamper-evident receipt chain integrity status (read-only).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

// ── handlers ─────────────────────────────────────────────────────────────────

/**
 * Build the JSON-RPC method map for one server instance. Wire it to a stream in
 * `main.ts`, or drive it directly with `dispatch` in a test.
 */
export function mcpHandlers(opts: McpServerOptions): Handlers {
  return {
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }),
    // A notification: the client tells us it is ready. Nothing is owed back, and
    // `dispatch` answers a notification with nothing regardless of this return.
    'notifications/initialized': () => undefined,
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS }),
    'tools/call': (params) => callTool(opts, params),
  };
}

function callTool(opts: McpServerOptions, params: unknown): ToolResult | Promise<ToolResult> {
  const p = asObject(params);
  const name = p['name'];
  if (typeof name !== 'string') {
    throw new RpcError(INVALID_PARAMS, 'tools/call needs a string "name".');
  }
  const args = asObject(p['arguments']);
  switch (name) {
    case 'zeno.propose_write':
      return proposeWrite(opts, args);
    case 'zeno.list_work':
      return listWork(opts);
    case 'zeno.add_work':
      return addWork(opts, args);
    case 'zeno.list_receipts':
      return listReceipts(opts, args);
    case 'zeno.verify_chain':
      return verifyChain(opts);
    default:
      throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
  }
}

/**
 * The one tool that can cause an effect — and only ever a routine one. It runs
 * the SAME pipeline the daemon runs: jail the path, assess the risk, preview, and
 * commit ONLY when the preview says auto (a routine T0 sandbox edit). Anything
 * else returns its actionHash and stops, because the thing that would move it
 * forward — an owner approval — does not and cannot arrive over this pipe.
 */
async function proposeWrite(
  opts: McpServerOptions,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const relPath = str(args, 'relPath');
  const contents = str(args, 'contents');
  const summary = str(args, 'summary');
  if (relPath === null || contents === null || summary === null) {
    throw new RpcError(INVALID_PARAMS, 'propose_write needs string "relPath", "contents" and "summary".');
  }

  let abs: string;
  try {
    // The jail proves the target stays inside the sandbox. A hostile path is a
    // refusal, not a crash — and nothing is written.
    abs = jail(opts.fs, opts.sandbox, relPath);
  } catch (err) {
    if (err instanceof PolicyError) return refusal(err);
    throw err;
  }

  const before = opts.fs.readFile(abs);
  const payload = makeWritePayload(relPath, before, contents);
  // Risk comes from what the change DOES, not from it being "a file write": an
  // ordinary sandbox edit is routine and simply happens; config, a rewrite or a
  // deletion is held for the owner. Assessing everything is how the owner learns
  // to approve without reading.
  const risk = assessWrite(relPath, before, contents);

  const request: ActionRequest = {
    kind: risk.kind,
    summary,
    targetRef: abs,
    payload,
    baseHash: payload.expectBaseHash,
    requestedBy: opts.requestedBy ?? 'agent',
    dataZones: ['personal'],
  };
  const preview = opts.kernel.preview(request);

  if (preview.auto) {
    // Routine: apply it now and return the receipt. Still previewed, still
    // classified, still receipted — unattended is not unrecorded.
    const receipt = await opts.kernel.commit(
      preview.actionHash,
      worktreeExecutor({ root: opts.sandbox, fs: opts.fs }, payload),
    );
    // L5, honestly reported at the edge: the success state derives ONLY from the
    // receipt, never from the fact that we asked. A T0 action previews as `auto`,
    // but the commit can still land on `refused` (the base drifted under us) or
    // `outcome-unknown` (the write could not be proven) — and in both the effect
    // is `none` and NOTHING was applied. Announcing `committed` there would be a
    // receipt without a real write, the one lie the whole kernel is built to
    // avoid. So the status is read off the receipt, and a non-verified outcome is
    // surfaced as an honest tool-level failure — not the false success it was.
    if (receipt.outcome === 'verified') {
      return ok({ status: 'committed', preview, receipt, risk });
    }
    const notApplied = {
      status: 'not-applied',
      outcome: receipt.outcome,
      preview,
      receipt,
      risk,
      note:
        'Previewed as a routine auto-commit, but the receipt outcome is not "verified": nothing was proven applied. ' +
        'This is a truthful non-effect recorded on the chain, not a fault in the pipe — re-preview against the current state.',
    };
    return { ...ok(notApplied), isError: true };
  }

  // Held for the owner. This is the whole point: the server hands back the
  // identity of the waiting action and says, in the payload, that it cannot be
  // the one to approve it.
  return ok({
    status: 'awaiting-owner-approval',
    actionHash: preview.actionHash,
    preview,
    risk,
    note: 'Held for the owner. Approval is a human act in the Zeno window; this server has no tool that can grant it.',
  });
}

async function listWork(opts: McpServerOptions): Promise<ToolResult> {
  const items = await opts.work.list();
  return ok({ items });
}

async function addWork(
  opts: McpServerOptions,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const title = str(args, 'title');
  if (title === null || title.trim() === '') {
    throw new RpcError(INVALID_PARAMS, 'add_work needs a non-empty string "title".');
  }
  const body = str(args, 'body') ?? '';
  const item = await opts.work.add({ title, body });
  return ok({ item });
}

function listReceipts(opts: McpServerOptions, args: Record<string, unknown>): ToolResult {
  const after = str(args, 'after');
  const all = opts.kernel.receipts();
  if (after === null) return ok({ receipts: all });
  // Page from a known id. An unknown id returns the whole history rather than
  // nothing, so a stale cursor never looks like an empty ledger.
  const i = all.findIndex((r) => r.id === after);
  return ok({ receipts: i < 0 ? all : all.slice(i + 1) });
}

function verifyChain(opts: McpServerOptions): ToolResult {
  return ok({ chain: opts.kernel.verifyChain() });
}

// ── small helpers ────────────────────────────────────────────────────────────

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

// Re-exported so `main.ts` can build the dispatcher without importing `./rpc.js`
// twice over — the server package's public surface is "handlers + how to run them".
export type { Handler, Handlers };
