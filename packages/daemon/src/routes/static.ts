/** The self-hosted UI shell (`GET /`) and its static assets. */
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { ServerCtx } from '../server/context.js';
import { json, MIME } from './http.js';

/**
 * The shell carries the owner token in a meta tag. A browser cannot set a
 * request header on its first navigation, and this is a loopback-only,
 * single-user daemon — so handing the page its token is the honest
 * simplification. It is NOT a pattern for a multi-user server.
 */
export function serveShell(ctx: ServerCtx, res: ServerResponse, authorized: boolean): void {
  let html: string;
  try {
    html = readFileSync(join(ctx.publicRoot, 'index.html'), 'utf8');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The Zeno UI is not built. Expected index.html in ' + ctx.publicRoot);
    return;
  }
  // The owner token goes into the page ONLY for an authorized launch. An
  // unauthorized caller gets the page with an EMPTY token: it can look, but its
  // fetches to /approvals will be 401. Fill the single placeholder (never add a
  // second tag — querySelector would then find the empty one first).
  const value = authorized ? ctx.opts.tokens.owner : '';
  const tag = `<meta name="zeno-token" content="${value}">`;
  const withToken = /<meta\s+name="zeno-token"[^>]*>/i.test(html)
    ? html.replace(/<meta\s+name="zeno-token"[^>]*>/i, tag)
    : html.replace('</head>', `  ${tag}\n</head>`);
  const headers: Record<string, string> = {
    'content-type': MIME['.html']!,
    'cache-control': 'no-store',
  };
  // Only an authorized launch is granted the cookie that keeps the session
  // able to approve across navigations. SameSite=Strict blocks cross-site use;
  // HttpOnly keeps it out of page script.
  if (authorized) {
    headers['set-cookie'] = `zeno_token=${ctx.opts.tokens.owner}; Path=/; SameSite=Strict; HttpOnly`;
  }
  res.writeHead(200, headers);
  res.end(withToken);
}

/**
 * How to name the proposer token file in an error, without ever naming one
 * that may not exist. A daemon told its workspace points at the real path; one
 * that was not says where the file lives in words, and guesses nothing.
 */
export function tokenFileLabel(ctx: ServerCtx): string {
  return ctx.opts.workspace === undefined
    ? 'the proposer.token file in the workspace directory this daemon was started with'
    : join(ctx.opts.workspace, 'proposer.token');
}

export function isStaticish(path: string): boolean {
  return extname(path) !== '';
}

export function serveStatic(ctx: ServerCtx, res: ServerResponse, path: string): void {
  // Resolve inside publicRoot and prove it stayed there — the same jail rule
  // the executor uses, for the same reason.
  const publicRoot = ctx.publicRoot;
  const target = resolve(join(publicRoot, normalize(path)));
  if (target !== publicRoot && !target.startsWith(publicRoot + sep)) {
    return json(res, 403, {
      error: { code: 'path-escape', message: 'That path leaves the UI directory.', resolve: 'Request a file inside the UI directory.' },
    });
  }
  let body: Buffer;
  try {
    body = readFileSync(target);
  } catch {
    return json(res, 404, {
      error: { code: 'not-found', message: `No such file: ${path}`, resolve: 'Check the path.' },
    });
  }
  res.writeHead(200, {
    'content-type': MIME[extname(target)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}
