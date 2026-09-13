/**
 * The Vault: `/memory` (owner-ungated read/write) and `/brief`. Everything
 * under `/memory/` (propose, approvals, pending, recall, context, delete) is
 * the gated module wired directly in `handle()` — see memory-routes.ts for
 * why an agent write goes through the kernel and the owner's own does not.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sanitize } from '@abheet19/zeno-sanitizer';
import { buildBrief, renderBrief, MEMORY_KINDS, type MemoryKind } from '@abheet19/zeno-vault';
import type { Role } from '../tokens.js';
import { publishMemoryChanged, type ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';

export function serveMemory(ctx: ServerCtx, res: ServerResponse, url: URL): void {
  if (!ctx.opts.vault) return json(res, 404, { error: { code: 'no-vault', message: 'Memory is not enabled.', resolve: 'Start the daemon with a vault directory.' } });
  const q = url.searchParams.get('q');
  if (q && q.trim()) {
    return json(res, 200, { query: q, hits: ctx.opts.vault.recall(q).map((h) => ({ note: h.note, score: h.score, matched: h.matched })) });
  }
  json(res, 200, { notes: ctx.opts.vault.all().slice(0, 50) });
}

export async function postMemory(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (!ctx.opts.vault) return json(res, 404, { error: { code: 'no-vault', message: 'Memory is not enabled.', resolve: 'Start the daemon with a vault directory.' } });
  // THE FIX: this route used to write straight to the Vault for whichever
  // token called it — owner or an agent's own proposer token, no kernel, no
  // approval, no receipt. Only the owner may write memory directly now,
  // matching the L6 reasoning memory-routes.ts documents for its own owner
  // route: the owner IS the approval authority, so this is not a gate that
  // was skipped, it is the one write that was never supposed to need one. An
  // agent goes through POST /memory/propose instead, which this file now
  // mounts for real.
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can write memory directly — an agent must propose it.',
        resolve: 'POST /memory/propose instead; the owner approves it at POST /memory/approvals.',
      },
    });
  }
  const b = await readJson(req);
  const title = str(b, 'title');
  const bodyText = str(b, 'body');
  if (title === null || bodyText === null) {
    return json(res, 400, { error: { code: 'bad-request', message: 'A memory needs a title and a body.', resolve: 'POST {"title":"...","body":"..."}.' } });
  }
  // Every persisted field is sanitized, not only the prose body: titles,
  // provenance and tags are later rendered in Forge Lens and model prompts too.
  const clean = (value: string): string => sanitize(value).clean;
  const tags = Array.isArray(b['tags'])
    ? (b['tags'] as unknown[]).filter((t): t is string => typeof t === 'string').map(clean)
    : [];
  const requestedKind = str(b, 'kind') ?? 'fact';
  const kind: MemoryKind = (MEMORY_KINDS as readonly string[]).includes(requestedKind)
    ? requestedKind as MemoryKind
    : 'fact';
  // The owner-facing legacy route now writes an ordinary tagged Memory entry,
  // rather than an untagged Vault note Forge could never recall. The response
  // keeps its historical Note shape for existing clients.
  const entry = ctx.memory!.record({
    kind,
    description: clean(title),
    body: clean(bodyText),
    source: clean(str(b, 'source') ?? 'owner'),
    tags,
  });
  const note = ctx.opts.vault.get(entry.id);
  // The window has to hear about this. See publishMemoryChanged: an ungated
  // write that tells nobody leaves every open Vault screen showing a memory
  // that is no longer the one on disk.
  publishMemoryChanged(ctx);
  json(res, 200, { note });
}

export function serveBrief(ctx: ServerCtx, res: ServerResponse): void {
  const recentNotes = ctx.opts.vault ? ctx.opts.vault.all().slice(0, 5) : [];
  const pending = [...ctx.held.values()].map((h) => ({
    summary: h.preview.summary,
    tier: h.preview.tier,
    source: h.req.requestedBy,
    at: new Date().toISOString(),
  }));
  const brief = buildBrief({ now: new Date().toISOString(), recentNotes, pending });
  json(res, 200, { brief, text: renderBrief(brief) });
}
