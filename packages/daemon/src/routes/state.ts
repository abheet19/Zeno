/**
 * `/state` and `/receipts`: the two read routes every open window polls to
 * learn what is pending and what has already happened.
 */
import type { ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Role } from '../tokens.js';
import { persistHeld, type ServerCtx } from '../server/context.js';
import { json } from './http.js';
import { withPayload } from './approvals.js';

/** This machine's non-internal IPv4 addresses, for the phone-access URLs. */
export function lanIps(): string[] {
  const out: string[] = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const net of list ?? []) if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  } catch { /* no network info: an empty list, and the panel says so */ }
  return out;
}

export function serveState(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  // Build each file review once. Besides avoiding a second full diff on every
  // state poll, this lets this read atomically remove proposals whose bound
  // base bytes have already drifted before it reports the queue.
  const filePending: Record<string, unknown>[] = [];
  let removedDrifted = false;
  for (const [hash, held] of ctx.held) {
    const item = withPayload(ctx, held) as Record<string, unknown> & { review?: { state?: string } };
    if (item.review?.state === 'drifted') {
      ctx.held.delete(hash);
      removedDrifted = true;
    } else {
      filePending.push(item);
    }
  }
  if (removedDrifted) persistHeld(ctx);
  // Phone-access URLs carry the launch nonce, so they are OWNER-ONLY — a
  // proposer reading /state must never learn the secret that mints owner.
  const lanOn = ctx.opts.lanAccess === true;
  const phoneUrls = (lanOn && role === 'owner' && ctx.opts.launchNonce !== undefined && ctx.opts.port !== undefined)
    ? lanIps().map((ip) => `http://${ip}:${ctx.opts.port}/?k=${ctx.opts.launchNonce}`)
    : [];
  json(res, 200, {
    // All THREE queues. A window that reloaded mid-run must not lose sight of
    // a tool call an agent is still blocked on, and a proposed memory write
    // used to live in a fourth place nothing rendered — held forever, with no
    // control on screen that could approve or refuse it. They render
    // identically: one carries the bytes of a file write, one the bytes of a
    // call, one the text of a note.
    pending: [
      ...filePending,
      ...[...ctx.gateHeld.values()].map((p) => ({ ...p.preview, payload: p.payload })),
      ...(ctx.memoryRoutes ? ctx.memoryRoutes.waiting() : []),
    ],
    receipts: ctx.opts.kernel.receipts(),
    chain: ctx.opts.kernel.verifyChain(),
    lastEventId: ctx.opts.stream.lastId(),
    // Build identity for the diagnostics surface. Stamped from the environment
    // at release time (release.yml sets ZENO_BUILD_SHA / ZENO_VERSION); a dev or
    // unstamped build reports null, and the window says "unstamped" rather than
    // inventing a version. No git is spawned — this is a read of the process env.
    build: {
      sha: process.env['ZENO_BUILD_SHA'] || null,
      version: process.env['ZENO_VERSION'] || process.env['npm_package_version'] || null,
    },
    // Safe-mode LAN access for a phone. lanAccess is legible to either role;
    // the URLs (which carry the nonce) are owner-only, above.
    net: { lanAccess: lanOn, phoneUrls },
  });
}

export function serveReceipts(ctx: ServerCtx, res: ServerResponse, url: URL): void {
  const after = url.searchParams.get('after');
  const all = ctx.opts.kernel.receipts();
  if (after === null) return json(res, 200, { receipts: all });
  const i = all.findIndex((r) => r.id === after);
  json(res, 200, { receipts: i < 0 ? all : all.slice(i + 1) });
}
