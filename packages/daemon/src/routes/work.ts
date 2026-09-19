/**
 * The backlog: read and add are legible to either role, deliberately — noticing
 * something needs doing is not deciding to do it. Close/reopen are owner-only:
 * an agent may propose and execute work, but cannot declare the owner's work
 * complete or revive it behind their back.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BacklogState } from '@abheet19/zeno-intake';
import type { ServerCtx } from '../server/context.js';
import type { Role } from '../tokens.js';
import { WorkTransitionError } from '../work.js';
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

/** Completing work is an owner decision; an agent may add/propose work only. */
export async function postWorkTransition(
  ctx: ServerCtx,
  req: IncomingMessage,
  res: ServerResponse,
  role: Role,
  state: BacklogState,
): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: `Only the owner can ${state === 'closed' ? 'mark work complete' : 'reopen work'}.`,
        resolve: 'Use the Work screen in the Zeno owner window; an agent or proposer cannot close work directly.',
      },
    });
  }
  const body = await readJson(req);
  const id = str(body, 'id');
  if (id === null || id.trim() === '' || id.length > 120) {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'A bounded work item id is required.',
        resolve: `POST {"id":"local:1"} to /work/${state === 'closed' ? 'close' : 'reopen'}.`,
      },
    });
  }
  try {
    const transition = state === 'closed' ? ctx.opts.work.close(id) : ctx.opts.work.reopen(id);
    return json(res, 200, transition);
  } catch (error) {
    if (error instanceof WorkTransitionError) {
      if (error.code === 'not-local') {
        return json(res, 409, {
          error: {
            code: 'remote-work-item',
            message: error.message,
            resolve: 'Complete the item in its remote source, then refresh Work.',
          },
        });
      }
      return json(res, 404, {
        error: {
          code: 'work-item-not-found',
          message: error.message,
          resolve: 'Refresh Work and choose an item that still exists in the local backlog.',
        },
      });
    }
    throw error;
  }
}
