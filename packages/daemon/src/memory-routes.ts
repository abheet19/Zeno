/**
 * The routes that make memory something the owner can SEE.
 *
 * A memory system an agent writes to and nobody inspects is not a feature, it is a
 * dossier. So the first thing built here is the list, the second is delete, and only
 * then the write — and the write an AGENT asks for goes through the kernel like every
 * other effect: preview, owner approval, one commit, a receipt. The reasoning for
 * that tier decision lives in `@abheet19/zeno-vault`'s `memory-gate.ts` and is not
 * repeated; the short version is that a memory write outlives its run and steers
 * every run after it, so it is not routine.
 *
 * WHY THIS IS A MODULE AND NOT MORE OF server.ts
 * ----------------------------------------------
 * `handle` takes strings and a body-reader and returns `{status, body}` or null for
 * "not mine". That shape has two payoffs: wiring it into the server is one line, and
 * every route in it is testable by calling a function — no sockets, no ports, no
 * fixture HTTP client. It is the same instinct as the rest of this repo, where the
 * decision is pure and the IO is a thin edge around it.
 *
 * THIS MODULE KEEPS ITS OWN PENDING QUEUE, DELIBERATELY
 * ----------------------------------------------------
 * The server's `held` map is committed with `worktreeExecutor` — everything in it is
 * a file write. A memory capsule dropped into that map would be approved and then
 * executed as a write to a file path that does not exist. Rather than reach into a
 * structure that assumes one kind of effect, the memory queue lives here with the
 * executor that belongs to it. The cost is honest and worth naming: memory proposals
 * do NOT appear in the window's existing approvals list, because that list is drawn
 * from `held`. Until the two queues are unified (see the report accompanying this
 * change), the owner approves a memory write through `POST /memory/approvals`, which
 * enforces the same owner-only rule the file queue does.
 */
import type { Kernel } from '@abheet19/zeno-kernel';
import type { ActionRequest, Preview, Receipt } from '@abheet19/zeno-kernel';
import { sanitize } from '@abheet19/zeno-sanitizer';
import {
  applyMemoryWrite,
  proposeMemoryWrite,
  validateMemoryInput,
  type Memory,
  type MemoryInput,
  type MemoryWritePayload,
} from '@abheet19/zeno-vault';
import { assembleMemoryContext } from './memory-context.js';
import type { Role } from './tokens.js';

export interface RouteReply {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface MemoryRouteDeps {
  readonly memory: Memory;
  readonly kernel: Kernel;
  /** Where the memory notes live. Becomes part of the action's target. */
  readonly vaultRef: string;
  /** The project root ZENO.md is read from. */
  readonly projectRoot: string;
  /** Called with each receipt, so the daemon can stream it like any other. */
  readonly onReceipt?: (receipt: Receipt) => void;
}

interface PendingMemory {
  readonly preview: Preview;
  readonly payload: MemoryWritePayload;
  readonly req: ActionRequest;
}

function bad(message: string, resolve: string): RouteReply {
  return { status: 400, body: { error: { code: 'bad-request', message, resolve } } };
}

function ownerOnly(what: string): RouteReply {
  return {
    status: 403,
    body: {
      error: {
        code: 'owner-only',
        message: `Only the owner can ${what}.`,
        resolve: 'Do it from the Zeno window. An agent is structurally unable to.',
      },
    },
  };
}

function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' ? v : null;
}

/** Secrets never enter a memory preview, Vault note, or model-facing context. */
function scrub(value: string): string {
  return sanitize(value).clean;
}

function scrubTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string').map(scrub)
    : [];
}

export function createMemoryRoutes(deps: MemoryRouteDeps): {
  handle(
    method: string,
    path: string,
    query: URLSearchParams,
    role: Role,
    readBody: () => Promise<Record<string, unknown>>,
  ): Promise<RouteReply | null>;
} {
  const pending = new Map<string, PendingMemory>();

  /** One entry as the wire sees it — everything the owner needs to judge it. */
  const wire = (e: ReturnType<Memory['record']>) => ({
    id: e.id,
    kind: e.kind,
    description: e.description,
    body: e.body,
    source: e.source,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    tags: e.tags,
  });

  async function handle(
    method: string,
    path: string,
    query: URLSearchParams,
    role: Role,
    readBody: () => Promise<Record<string, unknown>>,
  ): Promise<RouteReply | null> {
    if (path !== '/memory' && !path.startsWith('/memory/')) return null;

    // READING IS NOT AN EFFECT, so it is not owner-gated: an agent asking what earlier
    // sessions established is the entire point of the feature, and refusing it would
    // leave memory useful only to the owner, who already remembers.
    if (method === 'GET' && path === '/memory') {
      const kind = query.get('kind');
      const list = deps.memory.list();
      return {
        status: 200,
        body: {
          entries: (kind === null ? list : list.filter((e) => e.kind === kind)).map(wire),
          total: list.length,
        },
      };
    }

    if (method === 'GET' && path === '/memory/recall') {
      const q = query.get('q') ?? '';
      if (q.trim() === '') return bad('Recall needs a query.', 'GET /memory/recall?q=what+you+are+doing');
      return {
        status: 200,
        body: {
          query: q,
          hits: deps.memory.recall(q).map((h) => ({ entry: wire(h.entry), score: h.score, matched: h.matched })),
        },
      };
    }

    /**
     * Everything a run should start with: the project's ZENO.md, the memories
     * relevant to this task, and the framing that says a recorded note is a record.
     * One route, because a caller that had to assemble this itself would eventually
     * assemble it differently and drop the framing.
     */
    if (method === 'GET' && path === '/memory/context') {
      const task = query.get('task') ?? '';
      if (task.trim() === '') return bad('Context needs a task.', 'GET /memory/context?task=what+the+agent+will+do');
      let context;
      try {
        context = assembleMemoryContext({ memory: deps.memory, projectRoot: deps.projectRoot, task });
      } catch (err) {
        // A ZENO.md that exists and cannot be read is worth saying out loud: silently
        // running without the owner's standing instructions is the failure that looks
        // like success.
        return {
          status: 409,
          body: {
            error: {
              code: 'context-unavailable',
              message: `${deps.projectRoot} has a context file that could not be read: ${(err as Error).message}`,
              resolve: 'Repair or remove ZENO.md, then ask for context again.',
            },
          },
        };
      }
      return {
        status: 200,
        body: {
          contextFile: context.project === null
            ? null
            : { path: context.project.path, bytes: context.project.bytes, truncated: context.project.truncated },
          memories: context.recalled.map((hit) => ({
            ...wire(hit.entry),
            score: hit.score,
            matched: hit.matched,
            citation: hit.citation,
          })),
          prompt: context.prompt,
          redacted: context.redacted,
          note: null,
        },
      };
    }

    // THE OWNER'S OWN WRITE. Not gated, and that is not an exception to the rule: the
    // owner IS the approval authority, so asking them to approve their own note would
    // be asking them to authorise themselves. The same line the daemon already draws
    // for a proposal typed in the owner's own window.
    if (method === 'POST' && path === '/memory') {
      if (role !== 'owner') return ownerOnly('write memory directly — an agent must propose it');
      const body = await readBody();
      const checked = validateMemoryInput({
        kind: (str(body, 'kind') ?? 'fact') as MemoryInput['kind'],
        description: scrub(str(body, 'description') ?? ''),
        body: scrub(str(body, 'body') ?? ''),
        source: scrub(str(body, 'source') ?? 'owner'),
        tags: scrubTags(body['tags']),
      });
      if (!checked.ok) return bad(checked.reason, 'Fix that field and post it again.');
      return { status: 200, body: { entry: wire(applyMemoryWrite(deps.memory, checked.payload)) } };
    }

    /**
     * An agent asking to remember something. It gets a capsule, never an entry.
     */
    if (method === 'POST' && path === '/memory/propose') {
      const body = await readBody();
      const suppliedSource = str(body, 'requestedBy')?.trim() ?? '';
      // A proposer token may name an agent, but it can never cite the owner as
      // its source. The prompt treats every record as non-authoritative anyway;
      // this keeps the provenance label factual as well.
      const requestedBy = role === 'owner'
        ? scrub(suppliedSource || 'window')
        : scrub(/^agent(?::[A-Za-z0-9._-]{1,64})?$/.test(suppliedSource) ? suppliedSource : 'agent');
      const checked = validateMemoryInput({
        kind: (str(body, 'kind') ?? 'fact') as MemoryInput['kind'],
        description: scrub(str(body, 'description') ?? ''),
        body: scrub(str(body, 'body') ?? ''),
        source: requestedBy,
        tags: scrubTags(body['tags']),
      });
      if (!checked.ok) return bad(checked.reason, 'Fix that field and propose it again.');
      const req = proposeMemoryWrite(checked.payload, {
        requestedBy,
        vaultRef: deps.vaultRef,
        // The base for a `memory:` target is the ref's own tail — see the CAS note
        // in the vault's memory-gate, and the matching branch in `world.ts`. Passing
        // the vault ref here is what makes preview and commit agree.
        baseHash: deps.vaultRef,
      });
      const preview = deps.kernel.preview(req as unknown as ActionRequest);
      // T1 by policy, so `auto` should be false. Handled rather than asserted: a
      // policy file could rate it T0, and a preview that says auto must then be
      // committed rather than parked forever in a queue nobody drains.
      if (preview.auto) {
        const entry = applyMemoryWrite(deps.memory, checked.payload);
        const receipt = await deps.kernel.commit(preview.actionHash, async () => ({ effect: `memory:${entry.id}` }));
        deps.onReceipt?.(receipt);
        return { status: 200, body: { preview, receipt, entry: wire(entry), note: 'This policy rates memory writes routine, so it was applied and receipted immediately.' } };
      }
      pending.set(preview.actionHash, { preview, payload: checked.payload, req: req as unknown as ActionRequest });
      return { status: 200, body: { preview, pending: true } };
    }

    /** The owner saying yes to one waiting memory write. The line this module exists for. */
    if (method === 'POST' && path === '/memory/approvals') {
      if (role !== 'owner') return ownerOnly('approve a memory write');
      const body = await readBody();
      const actionHash = str(body, 'actionHash');
      if (actionHash === null) return bad('An approval needs an actionHash.', 'POST {"actionHash":"..."}.');
      const item = pending.get(actionHash);
      if (item === undefined) {
        return {
          status: 404,
          body: {
            error: {
              code: 'unknown-action',
              message: 'No memory write with that hash is waiting.',
              resolve: 'Propose it again; a preview may have expired or the daemon restarted.',
            },
          },
        };
      }
      const approval = deps.kernel.approve(actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
      // The entry is created INSIDE the executor, so it exists only if the kernel
      // reached the commit — an approval that fails CAS or expires leaves no memory
      // behind, and the receipt is the only record either way.
      // A box rather than a `let`, because the assignment happens inside a callback
      // and the compiler cannot see it — a plain `let` would be narrowed to null
      // forever and the entry would never reach the response.
      const box: { entry: ReturnType<Memory['record']> | null } = { entry: null };
      const receipt = await deps.kernel.commit(approval, async () => {
        box.entry = applyMemoryWrite(deps.memory, item.payload);
        return { effect: `memory:${box.entry.id}` };
      });
      pending.delete(actionHash);
      deps.onReceipt?.(receipt);
      return { status: 200, body: { approval, receipt, entry: box.entry === null ? null : wire(box.entry) } };
    }

    if (method === 'GET' && path === '/memory/pending') {
      return { status: 200, body: { pending: [...pending.values()].map((p) => ({ preview: p.preview, payload: p.payload })) } };
    }

    if (method === 'DELETE' && path.startsWith('/memory/')) {
      if (role !== 'owner') return ownerOnly('delete memory');
      const id = decodeURIComponent(path.slice('/memory/'.length));
      // Deleting is the owner erasing their own record, not an effect on the world.
      // It is ungated for the same reason writing their own note is, and it is the
      // one operation that must never be harder than remembering.
      return { status: 200, body: { id, forgotten: deps.memory.forget(id) } };
    }

    return {
      status: 404,
      body: {
        error: {
          code: 'not-found',
          message: `No memory route for ${method} ${path}.`,
          resolve: 'GET /memory, GET /memory/recall?q=, GET /memory/context?task=, POST /memory, POST /memory/propose, POST /memory/approvals, DELETE /memory/<id>.',
        },
      },
    };
  }

  return { handle };
}
