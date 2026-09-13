/**
 * The GITHUB work-item source: the second adapter behind the same port.
 *
 * A port with one implementation is only a guess. This is the one that proves
 * the seam — a GitHub issue and a line in a local JSONL file arrive downstream
 * as the same `WorkItem`, so intake, context assembly and the approval capsule
 * never learn either vendor's name. When the Jira account went away it took the
 * flagship journey with it; that must not be possible a second time.
 *
 * It runs UNAUTHENTICATED on purpose. The budget is $0 and the owner has no
 * company account: a public repo answers with no token at 60 requests/hour,
 * which is plenty for a poll every few minutes. A token is an optional upgrade
 * (5000/hour, private repos), never a requirement to start.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: a failed poll must never look like an empty
 * backlog. "There is nothing to do" and "I could not ask" are different facts,
 * and a briefing that renders the second as the first lies quietly on exactly
 * the mornings you most need it not to. So every failure below throws a
 * distinct, named, actionable error, and no code path in this file returns a
 * short list to paper over a problem. The single honest empty list is a 200 with
 * an empty array: we asked, and there was nothing.
 *
 * Impurity lives here by design, exactly as the filesystem lives in
 * `backlog-node-fs.ts`. The port stays pure; adapters do the I/O.
 *
 * THE SPLIT. This file is the entry point: the public options shape, the
 * request/pagination loop, and the one door in (`githubSource`). The reason
 * codes and the `GithubSourceError` class live in `github-errors.ts`; turning
 * one raw issue into a `WorkItem` (and rejecting a pull request masquerading as
 * one) lives in `github-issue.ts`; reading the `Link` header lives in
 * `github-pagination.ts`; and the adapter's source name is a one-line leaf,
 * `github-source-name.ts`, so neither of the above needs to import this file.
 * Every export below is re-exported unchanged from where it used to live.
 */
import type { WorkItem, WorkItemSource } from './work-item.js';
import { GITHUB_SOURCE } from './github-source-name.js';
import {
  GithubSourceError,
  describe,
  httpFailure,
  isDeadline,
  malformed,
  snippet,
  type GithubFailure,
} from './github-errors.js';
import { asRecord, isPullRequest, mapIssue } from './github-issue.js';
import { nextPageUrl } from './github-pagination.js';

// Re-exported so every one of these stays importable from `./github.js` exactly
// as before the split. See the file comment above for where each now lives.
export { GITHUB_SOURCE, GithubSourceError };
export type { GithubFailure };

/**
 * The only host this adapter will talk to. Held as an origin rather than a
 * prefix so a pagination link to `https://api.github.com.evil.test/…` cannot
 * pass a `startsWith` check and be handed the token.
 */
const API_ORIGIN = 'https://api.github.com';

/** Documented media type for the REST v3 JSON representation. */
const ACCEPT = 'application/vnd.github+json';

/**
 * Pinning the API version means a future breaking change to the issue shape
 * arrives as a legible error rather than as silently reshaped work items.
 */
const API_VERSION = '2022-11-28';

/** GitHub rejects requests with no user-agent outright, so this is required. */
const USER_AGENT = 'zeno-intake/0.1';

/** The API's maximum. Fewer round trips, fewer chances to be rate limited. */
const PER_PAGE = 100;

/** Ceiling on pages followed in one poll. See the `truncated` failure below. */
const MAX_PAGES = 10;

/** A poller that hangs is a poller that has silently stopped reporting. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface GithubSourceOptions {
  /** Repository owner: a user or org login. Not "owner/repo". */
  readonly owner: string;
  /** Repository name on its own. */
  readonly repo: string;
  /**
   * Optional PAT. Absent is a supported, first-class mode — public repos work
   * without one, which is what keeps this adapter inside a $0 budget.
   *
   * Typed `| undefined` rather than plain optional because the real call site is
   * `token: process.env['GITHUB_TOKEN']`, and under `exactOptionalPropertyTypes`
   * a bare `token?: string` would reject exactly that.
   */
  readonly token?: string | undefined;
  /** Filter to one login's assigned issues. GitHub also accepts `*` and `none`. */
  readonly assignee?: string | undefined;
  /** Injected so tests never touch the network. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch | undefined;
}

/**
 * Reject a bad owner/repo at the door rather than building a nonsense URL and
 * reporting GitHub's 404 for it — a 404 caused by a typo in our own arguments
 * would be indistinguishable from a repo that has been deleted.
 */
function requireSegment(value: string, field: 'owner' | 'repo'): string {
  const clean = value.trim();
  if (clean.length === 0) throw new Error(`githubSource needs ${field === 'owner' ? 'an owner' : 'a repo'}`);
  if (clean.includes('/')) {
    throw new Error(`githubSource ${field} must not contain "/" — pass owner and repo separately (got ${JSON.stringify(clean)})`);
  }
  return clean;
}

/**
 * A GitHub repository's open issues, as a `WorkItemSource`.
 *
 * `list()` re-reads every time — the port promises the CURRENT set, not a queue;
 * remembering what it already emitted would make a dropped item look identical
 * to a quiet backlog. Dedupe stays the caller's job, with `dedupe()`.
 */
export function githubSource(opts: GithubSourceOptions): WorkItemSource {
  const owner = requireSegment(opts.owner, 'owner');
  const repo = requireSegment(opts.repo, 'repo');
  const assignee = opts.assignee?.trim() ?? '';
  // An empty-string token is what an unset environment variable looks like once
  // it has been through a shell. Sending "Bearer " earns a 401, which would
  // report a broken credential when the truth is that there is no credential.
  const token = opts.token?.trim() ?? '';
  const fetchImpl = opts.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    accept: ACCEPT,
    'user-agent': USER_AGENT,
    'x-github-api-version': API_VERSION,
  };
  if (token !== '') headers['authorization'] = `Bearer ${token}`;

  function firstPageUrl(): string {
    // Both segments are percent-encoded: a repo name of "../../users/someone"
    // must stay a repo name and not re-point the request at another endpoint.
    const url = new URL(`${API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`);
    url.searchParams.set('state', 'open');
    url.searchParams.set('per_page', String(PER_PAGE));
    if (assignee !== '') url.searchParams.set('assignee', assignee);
    return url.toString();
  }

  async function readPage(url: string): Promise<{ raw: readonly unknown[]; next: string | null; status: number }> {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      if (isDeadline(err)) {
        throw new GithubSourceError(
          'timeout',
          `GitHub did not answer ${url} within ${REQUEST_TIMEOUT_MS / 1000}s, so the request was abandoned. Abandoned is not refused: the repo may be fine and the network slow.`,
          null,
          err,
        );
      }
      throw new GithubSourceError(
        'unreachable',
        `Could not reach ${url}: ${describe(err)}. That is a fact about this machine's network — offline, DNS, a proxy, TLS interception — not an answer from GitHub.`,
        null,
        err,
      );
    }

    if (!res.ok) throw httpFailure(res, url, token !== '');

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      // The status line arrived and the body did not: an INTERRUPTED read. What
      // GitHub was in the middle of saying is unknowable, and a prefix of an
      // issue list is not a shorter issue list.
      //
      // WHICH interruption it was still matters. `AbortSignal.timeout` covers
      // the whole exchange, body included, so a slow trickle ends up here as an
      // abort — and calling our own expired deadline "unreachable" sends the
      // owner off to inspect a network that was working, for a GitHub that was
      // merely slow. A dropped socket is a fact about the network; a deadline is
      // a fact about us, and the adapter already has a name for each.
      if (isDeadline(err)) {
        throw new GithubSourceError(
          'timeout',
          `GitHub began answering ${url} but had not finished sending the issue list within ${REQUEST_TIMEOUT_MS / 1000}s, so the read was abandoned. Abandoned is not refused: the repo may be fine and the connection slow.`,
          res.status,
          err,
        );
      }
      throw new GithubSourceError(
        'unreachable',
        `The connection to ${url} dropped while the response body was still arriving (${describe(err)}). Whatever GitHub was about to say was cut off mid-sentence.`,
        res.status,
        err,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw malformed(url, res.status, `the body is not JSON at all — it begins "${snippet(text)}"`);
    }
    if (!Array.isArray(body)) {
      const record = asRecord(body);
      const message = record?.['message'];
      const detail =
        typeof message === 'string'
          ? `it is an error envelope saying "${snippet(message)}" rather than an array`
          : `expected an array, got ${body === null ? 'null' : typeof body}`;
      throw malformed(url, res.status, detail);
    }

    const next = nextPageUrl(res.headers.get('link'), url, res.status);
    if (next !== null) {
      // The next page's address is server-controlled text, and this request
      // carries a bearer token. Following it off-origin would hand the token to
      // whoever wrote the header.
      let origin: string;
      try {
        origin = new URL(next).origin;
      } catch {
        throw malformed(url, res.status, `its Link header points at "${snippet(next)}", which is not a URL`);
      }
      if (origin !== API_ORIGIN) {
        throw malformed(url, res.status, `its Link header points pagination at ${origin}, not ${API_ORIGIN} — refusing to send credentials there`);
      }
    }

    return { raw: body, next, status: res.status };
  }

  async function list(): Promise<readonly WorkItem[]> {
    const items: WorkItem[] = [];
    let url = firstPageUrl();

    for (let page = 1; page <= MAX_PAGES; page++) {
      // Any failure here THROWS rather than returning what earlier pages held:
      // page one of three is indistinguishable, once returned, from a complete
      // list, and the caller would act on a backlog that is missing items it
      // was never told were missing.
      const { raw, next, status } = await readPage(url);

      for (let index = 0; index < raw.length; index++) {
        const record = asRecord(raw[index]);
        if (record === null) throw malformed(url, status, `entry ${index} is not an object`);
        // Drop pull requests before validating them: a PR is not a shape this
        // adapter must understand, only one it must not mistake for work.
        if (isPullRequest(record)) continue;
        items.push(mapIssue(record, owner, repo, url, status, index));
      }

      // The one honest empty list: GitHub answered, and there was nothing (or
      // nothing but pull requests). Reached only after a complete, successful read.
      if (next === null) return items;
      url = next;
    }

    throw new GithubSourceError(
      'truncated',
      // Says "entries", not "issues". This endpoint counts pull requests as
      // issues and there is no server-side filter for them, so a repo of a
      // thousand open PRs lands here too — and claiming it has a thousand open
      // ISSUES would be this adapter inventing a fact about the repo at exactly
      // the moment it is admitting it does not know one.
      `${owner}/${repo} returned more than ${MAX_PAGES * PER_PAGE} open entries from /issues — which counts pull requests as issues — and that is more than one poll will read. Returning the first ${MAX_PAGES * PER_PAGE} would look like the whole backlog, so narrow the question instead — pass an assignee.`,
    );
  }

  return {
    // The FEED's name, not the adapter's. `WorkItem.source` says which adapter
    // produced an item ('github'); this says which of possibly several GitHub
    // feeds, because "github failed" does not tell you which repo went dark.
    name: `${GITHUB_SOURCE}:${owner}/${repo}`,
    list,
  };
}
