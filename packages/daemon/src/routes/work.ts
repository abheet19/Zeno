/**
 * The backlog: read and add. Legible to either role, deliberately — noticing
 * something needs doing is not deciding to do it; the line L6 draws is at
 * /approvals, and drawing a second one here would only teach the owner that
 * Zeno asks about things it does not need to ask about.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str, strings } from './http.js';

export async function serveWork(ctx: ServerCtx, res: ServerResponse): Promise<void> {
  json(res, 200, await ctx.opts.work.list());
}

export async function postWork(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const title = str(body, 'title');
  if (title === null || title.trim() === '') {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'A work item needs a non-empty title.',
        resolve: 'POST {"title":"what needs doing","body":"optional detail","labels":["optional"]}.',
      },
    });
  }
  // Labels are cosmetic, but a caller that sent the wrong shape wanted
  // something — silently dropping it would lose a tag with no way to notice.
  const labels = strings(body, 'labels');
  if (labels === null) {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'labels must be an array of strings.',
        resolve: 'POST {"title":"…","labels":["bug"]}, or leave labels out entirely.',
      },
    });
  }
  // A failed write throws and leaves as a legible 500. The backlog writes
  // through to disk before it changes in memory, so a refused write means the
  // item exists nowhere — including in the answer this route is about to give.
  json(res, 200, { item: ctx.opts.work.add(title, str(body, 'body') ?? '', labels) });
}
