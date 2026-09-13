/**
 * Forge's read-only view of the sandbox repository (status, one file, search)
 * and its one write: the governed commit. All four drive git through the same
 * jailed executor the kernel uses.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, sep } from 'node:path';
import {
  gitExecutor,
  gitHead,
  jail,
  makeCommitPayload,
  NO_COMMITS,
  type ActionRequest,
} from '@abheet19/zeno-kernel';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, parseGrep, readJson, str } from './http.js';

/**
 * Forge's two read caps. Both exist so a large repository degrades into a
 * SMALLER honest answer rather than a slow one, and both are reported back in
 * the response (`trackedCapped`, `truncated`) so the window can say it is
 * showing a part rather than implying it is showing the whole.
 */
const TREE_CAP = 2000;
const FILE_LINE_CAP = 4000;

/**
 * Search's match cap, alongside `SEARCH_TEXT_CAP` in `http.ts` (one line).
 * Both are reported (`truncated`, `clipped`) so the panel says it is showing
 * a part.
 */
const SEARCH_MATCH_CAP = 500;

function gitSpec(ctx: ServerCtx): { repoRoot: string; git: ServerCtx['gitRunner']; fs: ServerCtx['forgeFs'] } {
  return { repoRoot: ctx.opts.sandbox, git: ctx.gitRunner, fs: ctx.opts.fs };
}

/** The sandbox repo's state: branch, HEAD, and the files that have changed. */
export function serveForgeStatus(ctx: ServerCtx, res: ServerResponse): void {
  const run = (args: readonly string[]) => ctx.gitRunner.run(args, ctx.opts.sandbox);
  const isRepo = run(['rev-parse', '--is-inside-work-tree']).status === 0;
  if (!isRepo) {
    return json(res, 200, { repo: false, root: ctx.opts.sandbox, note: 'The sandbox is not a git repository yet. It is initialised on daemon start.' });
  }
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || '(no commits yet)';
  let head: string | null = null;
  try {
    const h = gitHead(gitSpec(ctx));
    head = h === NO_COMMITS ? null : h;
  } catch {
    head = null;
  }
  // -z gives NUL-separated entries; each is "XY path".
  const porcelain = run(['status', '--porcelain', '-z', '--untracked-files=all']).stdout;
  const NUL = String.fromCharCode(0);
  const changed = porcelain.split(NUL).filter(Boolean).map((e) => ({ status: e.slice(0, 2).trim(), path: e.slice(3) }));
  const log = run(['log', '-5', '--pretty=%h' + String.fromCharCode(0x1f) + '%s']).stdout
    .split(/\r?\n/).filter(Boolean)
    .map((l) => { const [sha, ...rest] = l.split(String.fromCharCode(0x1f)); return { sha, summary: rest.join('') }; });
  // The tracked file list is what lets the Forge code pane draw a REAL file
  // tree instead of an invented one. It is git's own index, so it never lists
  // a path that is not in this repository. Capped, and the cap is reported so
  // the surface can say "showing the first N of M" rather than quietly lying.
  const all = run(['ls-files', '-z']).stdout.split(NUL).filter(Boolean);
  const tracked = all.slice(0, TREE_CAP);
  json(res, 200, {
    repo: true, root: ctx.opts.sandbox, branch, head: head ? head.slice(0, 12) : null, changed, log,
    tracked, trackedTotal: all.length, trackedCapped: all.length > TREE_CAP,
  });
}

/**
 * One sandbox file's contents, for the Forge code pane. READ ONLY — this route
 * has no write half and cannot grow one.
 *
 * The whole risk here is the path, so the path goes through the SAME jail the
 * executor uses (`jail`: Windows traps, lexical containment, then a realpath
 * check that catches symlinks and junctions). A path that escapes is refused
 * with 403 path-escape and no content, exactly as serveStatic refuses a path
 * that leaves the UI directory. Nothing else in this function touches the
 * filesystem, so there is no second, subtly different containment rule.
 */
export function serveForgeFile(ctx: ServerCtx, res: ServerResponse, url: URL): void {
  const relPath = url.searchParams.get('path');
  if (relPath === null || relPath.trim() === '') {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'Name the file to read.', resolve: 'GET /forge/file?path=src/index.ts' },
    });
  }
  let abs: string;
  try {
    abs = jail(ctx.opts.fs, ctx.opts.sandbox, relPath);
  } catch {
    // Deliberately one shape for every escape (traversal, absolute path, drive
    // letter, UNC root, symlink out): the answer must not report which trick
    // was tried, or it becomes a probe for what lives outside the sandbox.
    return json(res, 403, {
      error: { code: 'path-escape', message: 'That path leaves the sandbox.', resolve: 'Request a file inside the sandbox.' },
    });
  }
  const contents = ctx.opts.fs.readFile(abs);
  if (contents === null) {
    return json(res, 404, {
      error: { code: 'not-found', message: `No such file in the sandbox: ${relPath}`, resolve: 'Check the path against GET /forge/status.' },
    });
  }
  // A NUL byte means this is not text. Say so rather than shipping mojibake
  // for the code pane to render as if it were source.
  if (contents.includes(String.fromCharCode(0))) {
    return json(res, 200, {
      path: relPath, binary: true, contents: null, bytes: Buffer.byteLength(contents, 'utf8'),
      lines: 0, truncated: false, encoding: 'binary',
    });
  }
  const bytes = Buffer.byteLength(contents, 'utf8');
  const all = contents.split(/\r?\n/);
  const truncated = all.length > FILE_LINE_CAP;
  const kept = truncated ? all.slice(0, FILE_LINE_CAP) : all;
  json(res, 200, {
    path: relPath,
    binary: false,
    contents: kept.join('\n'),
    lines: all.length,
    bytes,
    truncated,
    eol: /\r\n/.test(contents) ? 'CRLF' : 'LF',
    encoding: 'UTF-8',
  });
}

/**
 * Search the sandbox — `git grep -n`, and nothing more than that. READ ONLY,
 * like /forge/file, and built to the same shape on purpose.
 *
 * WHY GIT GREP AND NOT AN INDEX. There is no index here and inventing one
 * would mean a second source of truth about the repository that can go stale.
 * git already knows exactly which files are in this working tree, already
 * honours .gitignore, and already skips binaries with `-I`. The answer this
 * route gives is therefore the same set of files the Explorer tree draws.
 *
 * THE JAIL. Two arguments reach a subprocess, and both are closed:
 *
 *   the QUERY is passed after `-e`, so a query that begins with `-` is a
 *     pattern and never an option; and `-F` makes it a fixed string, so it is
 *     not a regular expression either. `nodeGitRunner` spawns with
 *     `shell: false`, so nothing re-parses it.
 *
 *   the SCOPE goes through the SAME `jail()` the file route and the executor
 *     use — Windows traps, lexical containment, then a realpath check for
 *     symlinks and junctions — and is refused with the identical 403
 *     path-escape answer. It is then handed to git as `:(literal)<rel>`:
 *     without that prefix a scope like `:(exclude)src` is pathspec MAGIC
 *     rather than a path, and git would read it as an instruction. `:(literal)`
 *     makes the scope mean the directory it spells and nothing else.
 *
 * Exit codes are git's: 0 found something, 1 found nothing (NOT an error —
 * an empty result is a real answer), anything else is a failure we report as
 * a failure rather than as "no matches".
 */
export function serveForgeSearch(ctx: ServerCtx, res: ServerResponse, url: URL): void {
  const query = url.searchParams.get('q');
  if (query === null || query.trim() === '') {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'Name what to search for.', resolve: 'GET /forge/search?q=useState' },
    });
  }

  // The optional scope. Absent means the whole sandbox; present means one
  // directory or file inside it, and "inside it" is the jail's word, not ours.
  const scope = url.searchParams.get('path');
  let pathspec: string | null = null;
  if (scope !== null && scope.trim() !== '') {
    let abs: string;
    try {
      abs = jail(ctx.opts.fs, ctx.opts.sandbox, scope);
    } catch {
      // One shape for every escape, exactly as /forge/file answers. The reply
      // must not say WHICH trick was tried, or it becomes a probe for what
      // lives outside the sandbox.
      return json(res, 403, {
        error: { code: 'path-escape', message: 'That path leaves the sandbox.', resolve: 'Search a path inside the sandbox.' },
      });
    }
    // git wants a repo-relative pathspec with forward slashes, even on Windows.
    const rel = relative(ctx.opts.sandbox, abs).split(sep).join('/');
    pathspec = rel === '' ? '.' : rel;
  }

  const run = (args: readonly string[]) => ctx.gitRunner.run(args, ctx.opts.sandbox);
  if (run(['rev-parse', '--is-inside-work-tree']).status !== 0) {
    return json(res, 200, {
      query, scope: scope ?? null, repo: false, matches: [], files: 0, total: 0, truncated: false,
      note: 'The sandbox is not a git repository yet, so there is nothing to search.',
    });
  }

  const args = ['grep', '--no-color', '-n', '-z', '-I', '-F', '-i', '--untracked', '-e', query];
  if (pathspec !== null) args.push('--', `:(literal)${pathspec}`);
  const r = run(args);
  if (r.status !== 0 && r.status !== 1) {
    return json(res, 500, {
      error: {
        code: 'search-failed',
        message: `git grep could not run: ${r.stderr.trim() || `it exited ${r.status}`}`,
        resolve: 'Check that git is installed and that the sandbox is a healthy repository.',
      },
    });
  }

  const all = parseGrep(r.stdout);
  const truncated = all.length > SEARCH_MATCH_CAP;
  const matches = truncated ? all.slice(0, SEARCH_MATCH_CAP) : all;
  json(res, 200, {
    query,
    scope: scope ?? null,
    repo: true,
    matches,
    files: new Set(matches.map((m) => m.path)).size,
    total: all.length,
    truncated,
  });
}

/**
 * Commit the sandbox's changes — through the full gate. The owner asked for
 * this in the Forge surface, so the request itself is the approval: preview a
 * vcs.commit action (T1), approve it as the owner, and let the git executor
 * make the one jailed, proven commit. It lands a receipt like everything else.
 */
export async function postForgeCommit(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can commit.', resolve: 'Commit from the Zeno window.' } });
  }
  const body = await readJson(req);
  const message = str(body, 'message');
  if (message === null || message.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'A commit needs a message.', resolve: 'POST {"message":"..."}.' } });
  }
  const run = (args: readonly string[]) => ctx.gitRunner.run(args, ctx.opts.sandbox);
  const changed = run(['status', '--porcelain', '-z', '--untracked-files=all']).stdout.split(String.fromCharCode(0)).filter(Boolean).map((e) => e.slice(3));
  const paths = Array.isArray(body['paths'])
    ? (body['paths'] as unknown[]).filter((p): p is string => typeof p === 'string')
    : changed;
  if (paths.length === 0) {
    return json(res, 400, { error: { code: 'nothing-to-commit', message: 'There are no changes to commit.', resolve: 'Make a change first.' } });
  }
  const spec = gitSpec(ctx);
  const payload = makeCommitPayload(spec, message, paths);
  const request: ActionRequest = {
    kind: 'vcs.commit',
    summary: `commit: ${message}`,
    targetRef: `git:${ctx.opts.sandbox}`,
    payload,
    baseHash: payload.expectHead,
    // Forge is the proposer; the owner (clicking Commit in the window) is the
    // approver. They must differ, or L6's self-approval guard rightly fires.
    requestedBy: 'forge',
    dataZones: ['personal'],
  };
  const preview = ctx.opts.kernel.preview(request);
  const approval = ctx.opts.kernel.approve(preview.actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
  const receipt = await ctx.opts.kernel.commit(approval, gitExecutor(spec, payload));
  ctx.opts.stream.publish('receipt', receipt);
  ctx.opts.stream.publish('chain', ctx.opts.kernel.verifyChain());
  json(res, 200, { receipt });
}
