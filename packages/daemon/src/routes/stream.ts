/** The one long-lived SSE connection every open window (and Forge's owner-only progress rail) attaches to. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stream } from '../stream.js';
import type { ServerCtx } from '../server/context.js';
import { header } from './http.js';

export function serveStream(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, stream: Stream = ctx.opts.stream): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  const raw = header(req, 'last-event-id');
  const lastId = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  res.write(stream.attach(res, lastId));
  req.on('close', () => stream.detach(res));
}
