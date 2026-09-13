/**
 * The daemon's shared closure state, pulled out of `createServer` so route
 * modules can be plain functions of the form `handler(ctx, ...)` instead of
 * closures nested inside one 5,000-line function.
 *
 * `ServerCtx` is deliberately a plain DATA bag: maps, primitives, and the
 * handful of small mutable records several domains touch. It carries no
 * behaviour of its own — every route module imports the functions it needs
 * (from here or from another route module) and calls them with `ctx` as the
 * first argument. That keeps the dependency graph explicit: reading a route
 * module's imports tells you exactly what daemon state it can reach.
 */
import type { Server } from 'node:http';
import type {
  ActionRequest,
  Preview,
  SandboxFs,
  WritePayload,
} from '@abheet19/zeno-kernel';
import type { Memory } from '@abheet19/zeno-vault';
import type { BrowseSession } from '@abheet19/zeno-browse';
import type { ChromeDesk } from '@abheet19/zeno-chrome';
import type { Identity, PairingOffer, TrustStore } from '@abheet19/zeno-mesh';
import type { OwnerVerdict, PermissionGate } from '@abheet19/zeno-forge';
import type { nodeGitRunner } from '@abheet19/zeno-kernel';
import type { Stream } from '../stream.js';
import type { createMemoryRoutes } from '../memory-routes.js';
import type { DaemonOptions } from './options.js';
import { serializeHeld } from '../held-store.js';

/** A proposal the daemon is holding between preview and approval. */
export interface Held {
  readonly preview: Preview;
  readonly payload: WritePayload;
  readonly req: ActionRequest;
}

/**
 * A pairing this machine has STARTED: the invite it would transmit, and the
 * short code it is showing for a human to carry to the other device. It is only
 * half a pairing, and it cannot become a whole one until a second device exists
 * to answer.
 */
export interface MeshPairing {
  readonly offer: PairingOffer;
  readonly startedAt: string;
}

/** A capsule that is a TOOL CALL waiting on the owner, rather than a file write. */
export interface PendingPermission {
  readonly preview: Preview;
  readonly payload: unknown;
  readonly runId: string;
  /** Resolve the agent's blocked tool call. Called exactly once. */
  settle(verdict: OwnerVerdict): void;
}

export type ForgeReservation =
  | { readonly ok: true; readonly controller: AbortController }
  | { readonly ok: false; readonly reason: 'run-id-active' | 'run-limit' };

/**
 * A live model pull, keyed by model name. In-memory only: a pull is not
 * durable state, and its real receipt is the model appearing in `/api/tags`.
 */
export interface ModelPullState {
  name: string;
  status: string;    // Ollama's own phase text: 'pulling manifest' | 'downloading' | 'success' | …
  completed: number; // bytes fetched in the current layer
  total: number;     // bytes of the current layer (0 until Ollama reports one)
  done: boolean;
  ok: boolean;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

export interface ScheduledTask {
  id: string;
  title: string;
  body: string;
  everyMinutes: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastResult: string | null;
  paused: boolean;
  createdAt: number;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command: string;
  args: string[];
  url: string;
  /** Environment VARIABLE NAMES the server needs — never values. The value is
   * read from the process environment at connect time, so no secret is ever
   * written to the config file. */
  env: string[];
  createdAt: number;
}

/**
 * Everything a route handler might need, gathered once in `createServer` and
 * threaded through explicitly. Fields are grouped by the subsystem that owns
 * them; nothing here is private to one route module — if it were, it would
 * live as a local inside that module instead.
 */
export interface ServerCtx {
  readonly opts: DaemonOptions;
  /**
   * The http.Server this ctx belongs to. Assigned once, immediately after
   * `createHttpServer` returns — before any request can be handled — so every
   * route sees it as already live. Typed nullable only because `ctx` itself
   * must exist before that assignment can happen.
   */
  server: Server | null;

  // ---- approvals / file-write capsules ----
  readonly held: Map<string, Held>;

  // ---- UI shell ----
  readonly publicRoot: string;

  // ---- Forge run progress (owner-only channel) ----
  readonly runProgressStream: Stream;

  // ---- Vault / memory ----
  readonly memory: Memory | undefined;
  readonly memoryRoutes: ReturnType<typeof createMemoryRoutes> | undefined;

  // ---- git ----
  readonly gitRunner: ReturnType<typeof nodeGitRunner>;
  readonly forgeFs: SandboxFs;

  // ---- local models (Ollama) ----
  readonly modelPulls: Map<string, ModelPullState>;
  readonly ollamaBaseUrl: string;
  ollamaStarting: Promise<boolean> | null;
  ollamaLastStartAttemptAt: number | null;

  // ---- scheduled tasks ----
  readonly scheduledTasks: Map<string, ScheduledTask>;
  readonly schedulePath: string | null;

  // ---- MCP servers (Customize surface) ----
  readonly mcpServers: Map<string, McpServerConfig>;
  readonly mcpConfigPath: string | null;

  // ---- repository test runner ----
  activeTestRunId: string | null;

  // ---- Forge permission gate / browse / chrome bridge ----
  readonly gateRuns: Map<string, { readonly token: string; readonly gate: PermissionGate }>;
  readonly activeForgeRuns: Map<string, AbortController>;
  readonly gateHeld: Map<string, PendingPermission>;
  readonly browseRuns: Map<string, BrowseSession>;
  readonly chromeOriginsPath: string;
  readonly chrome: ChromeDesk;
  readonly chromeRuns: Set<string>;

  // ---- mesh ----
  readonly meshTrust: TrustStore;
  readonly mesh: { self: Identity | null; since: string; pairing: MeshPairing | null };

}

/** Write the open proposals through, if a store is configured. */
export function persistHeld(ctx: ServerCtx): void {
  ctx.opts.heldStore?.writeAll(serializeHeld(ctx.held.values()));
}

/**
 * Tell every open window that the decision queue moved.
 *
 * The window subscribes to `/stream` and re-reads `/state` when this lands.
 * It carries only a count: the window re-reads the real queue rather than
 * trusting a payload, so there is no second source of truth to drift.
 */
export function publishPending(ctx: ServerCtx): void {
  const memoryWaiting = ctx.memoryRoutes ? ctx.memoryRoutes.waiting().length : 0;
  ctx.opts.stream.publish('state', { pending: ctx.held.size + ctx.gateHeld.size + memoryWaiting });
}

/**
 * Tell every open window that the VAULT moved.
 *
 * It publishes the same `state` event every other movement does: the stream
 * carries a nudge, never the truth, so the window re-reads `/memory` itself.
 */
export function publishMemoryChanged(ctx: ServerCtx): void {
  publishPending(ctx);
}

/** Resolve the same Ollama host for every local-model call this daemon makes. */
export function ollamaEndpoint(ctx: ServerCtx, path: string): string {
  return new URL(path, ctx.ollamaBaseUrl + '/').toString();
}
