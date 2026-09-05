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
 */
import { oneLine, type WorkItem, type WorkItemSource } from './work-item.js';

/** The adapter name a GitHub item reports as its `WorkItem.source`. */
export const GITHUB_SOURCE = 'github';

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

/** Longest quoted fragment of a foreign response body an error will carry. */
const SNIPPET_LIMIT = 120;

/**
 * Why a poll produced no answer. The code is the machine-readable half; the
 * message is the human half and says what to DO. Callers branch on `reason`
 * rather than on message text, so wording can improve without breaking anyone.
 *
 * Deliberately finer-grained than HTTP status: a 403 that means "you are out of
 * requests, wait" and a 403 that means "this token cannot see this repo" call
 * for opposite responses from the owner, and collapsing them into "403" pushes
 * that diagnosis onto a human at the worst possible moment.
 */
export type GithubFailure =
  /** The request never got an answer: offline, DNS, TLS, proxy. */
  | 'unreachable'
  /** No answer within the deadline. Abandoned, not refused. */
  | 'timeout'
  /** 401 — the token was rejected. */
  | 'unauthorized'
  /** 403/404-shaped access denial that is NOT a rate limit. */
  | 'forbidden'
  /** 403/429 with the rate-limit signature. Retry later, do not re-auth. */
  | 'rate-limited'
  /** 404 — no such repo, or a private one this request cannot see. */
  | 'not-found'
  /** Any other non-2xx, including GitHub's own 5xx. */
  | 'http'
  /** 2xx whose body is not the issue list this adapter knows how to read. */
  | 'malformed'
  /** More open issues than one poll will read. A partial list would mislead. */
  | 'truncated';

/**
 * A poll that could not be answered.
 *
 * The doctrine sentence is appended by the constructor rather than written into
 * each message, so a branch added later cannot forget it: whenever this is
 * thrown, `list()` returns nothing at all, and nothing is not zero.
 *
 * Structurally generic (reason + status + cause) so a third adapter can adopt
 * the same shape when one exists; it lives here rather than in the port because
 * the port is pure and must stay free of I/O vocabulary.
 */
export class GithubSourceError extends Error {
  /** Machine-readable cause. Branch on this, never on the message. */
  readonly reason: GithubFailure;
  /** HTTP status when there was one, null when the request never landed. */
  readonly status: number | null;

  constructor(reason: GithubFailure, message: string, status: number | null = null, cause?: unknown) {
    super(`${message} (No items were returned: this is "I could not ask", not "there is nothing to do".)`);
    this.name = 'GithubSourceError';
    this.reason = reason;
    this.status = status;
    // Guarded because `exactOptionalPropertyTypes` forbids writing undefined
    // into an optional property, and an absent cause is not a cause of undefined.
    if (cause !== undefined) this.cause = cause;
  }
}

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

/** One line, clipped, safe to embed in an error message. */
function snippet(text: string): string {
  const clean = oneLine(text);
  return clean.length <= SNIPPET_LIMIT ? clean : `${clean.slice(0, SNIPPET_LIMIT - 1)}…`;
}

function describe(err: unknown): string {
  return snippet(err instanceof Error ? err.message : String(err));
}

/**
 * Did this rejection come from OUR deadline rather than from the network?
 *
 * `AbortSignal.timeout` arms the whole exchange, so the same clock can fire
 * while we wait for a status line or later, halfway through a body. Both places
 * have to read it the same way, or one identical event gets reported as two
 * different facts about the world depending on when it happened to land.
 */
function isDeadline(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * PULL REQUESTS ARE NOT ISSUES — and this endpoint returns both.
 *
 * In GitHub's data model every pull request IS an issue: it has an issue number
 * from the same sequence and comes back from `/issues` alongside real issues.
 * The only thing that distinguishes one is the `pull_request` key. Forgetting
 * this filter is the classic bug with this endpoint, and here it would be worse
 * than cosmetic: a PR would enter intake as a work item, get a TASK proposed
 * against it, and burn an approval on work that does not exist.
 */
function isPullRequest(issue: Record<string, unknown>): boolean {
  const marker = issue['pull_request'];
  return marker !== undefined && marker !== null;
}

/**
 * Labels are decoration; the identity fields are not. A label array in an
 * unexpected shape costs a tag and is tolerated, whereas a missing `number`
 * costs the item its identity and is fatal below. That asymmetry is the whole
 * rule: degrade on what is cosmetic, refuse on what is load-bearing.
 */
function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    let name: string | null = null;
    if (typeof entry === 'string') name = entry;
    else {
      const record = asRecord(entry);
      const candidate = record?.['name'];
      if (typeof candidate === 'string') name = candidate;
    }
    const clean = name === null ? '' : name.trim();
    if (clean.length > 0 && !out.includes(clean)) out.push(clean);
  }
  return out;
}

function malformed(url: string, status: number, detail: string): GithubSourceError {
  return new GithubSourceError(
    'malformed',
    `${url} answered ${status}, but the body is not a GitHub issue list: ${detail}. Either this is not the GitHub API answering (a proxy or captive portal looks exactly like this) or the API's shape has changed and this adapter must be updated.`,
    status,
  );
}

/**
 * Project one issue onto the port. Provider-shaped extras (node_id, reactions,
 * milestones) stop here on purpose: the moment they leak through, the port stops
 * being a port and becomes a second copy of GitHub's schema.
 *
 * Titles and bodies are attacker-controlled text and are carried through
 * VERBATIM. Sanitising here would corrupt the context a task is built from; the
 * capsule's `oneLine`/`toSummary` is where display-safety belongs.
 */
function mapIssue(
  issue: Record<string, unknown>,
  owner: string,
  repo: string,
  url: string,
  status: number,
  index: number,
): WorkItem {
  const number = issue['number'];
  const title = issue['title'];
  const updatedAt = issue['updated_at'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw malformed(url, status, `entry ${index} has no usable "number"`);
  }
  if (typeof title !== 'string') throw malformed(url, status, `issue #${number} has no "title"`);
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
    // updatedAt is the version marker `dedupe` keys on. Substituting a clock
    // reading would make every poll look like a change; substituting a constant
    // would make a real change look like none. Both are worse than saying so.
    throw malformed(url, status, `issue #${number} has no "updated_at", and that is the field dedupe keys on`);
  }
  const html = issue['html_url'];
  const body = issue['body'];
  return {
    id: `${GITHUB_SOURCE}:${owner}/${repo}#${number}`,
    source: GITHUB_SOURCE,
    title,
    // The API sends null for an issue with no description; the port wants a
    // string, and "" is the honest rendering of an empty body.
    body: typeof body === 'string' ? body : '',
    url: typeof html === 'string' && html.length > 0 ? html : null,
    updatedAt,
    labels: labelNames(issue['labels']),
  };
}

/** One `<uri>` optionally followed by `; params`, which is RFC 8288's grammar. */
const LINK_VALUE = /^\s*<([^>]*)>\s*(?:;\s*(.*))?$/;

/**
 * RFC 8288 `Link` header, reduced to the one relation pagination needs.
 *
 * NULL MEANS "GITHUB SAID THERE IS NO NEXT PAGE", and nothing else. The last
 * page of a real listing carries `rel="prev"` and `rel="first"` with no `next`,
 * so a header we can read and that has no `next` in it is the ordinary end of
 * the list. But a header we CANNOT read is a different fact, and returning null
 * for it would end pagination early and hand back the pages collected so far —
 * the one way left in this file to produce a plausible, quietly short backlog.
 * A caller acting on page one of five would never learn that four are missing.
 * So an unreadable `Link` is fatal, exactly like an unreadable body.
 */
function nextPageUrl(header: string | null, url: string, status: number): string | null {
  if (header === null) return null;
  for (const part of header.split(',')) {
    // A trailing comma is sloppy, not unreadable; it says nothing either way.
    if (part.trim() === '') continue;
    const match = LINK_VALUE.exec(part);
    const target = match?.[1];
    if (match === null || target === undefined) {
      throw malformed(url, status, `its Link header is not RFC 8288 link values: "${snippet(header)}"`);
    }
    // `match[2]` is absent for a bare `<uri>` with no parameters, which the RFC
    // permits and which simply carries no relation — readable, just not `next`.
    const params = match[2];
    if (params !== undefined && /\brel\s*=\s*"?next"?/.test(params)) return target;
  }
  return null;
}

/** Seconds-since-epoch reset header rendered as an absolute instant, or ''. */
function resetClause(header: string | null): string {
  if (header === null) return '';
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  // The header is FOREIGN TEXT and `Date` only spans ±8.64e15 ms. A finite,
  // positive value past that makes an Invalid Date whose `toISOString()`
  // THROWS — and thrown from here it escapes `list()` as a bare RangeError,
  // replacing the named `rate-limited` failure with an unmodelled crash. That
  // is precisely the outcome this file exists to prevent, so an unreadable
  // reset time costs this one clause and nothing else.
  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return '';
  return ` It resets at ${at.toISOString()}.`;
}

/**
 * Turn a non-2xx response into the most specific true statement available.
 * Every branch names the next action, because an error a human cannot act on is
 * only a more polite silence.
 */
function httpFailure(res: Response, url: string, authenticated: boolean): GithubSourceError {
  const status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const retryAfter = res.headers.get('retry-after');

  // A 403 is overloaded: primary rate limits answer 403 with x-ratelimit-
  // remaining: 0, secondary limits answer 403/429 with retry-after. Neither is
  // an authorization problem, and telling someone to fix their token when they
  // simply need to wait sends them off to solve the wrong thing.
  if ((status === 403 || status === 429) && (remaining === '0' || retryAfter !== null)) {
    const wait = retryAfter === null ? '' : ` GitHub asked for a ${retryAfter}s pause.`;
    const advice = authenticated
      ? 'That token is already authenticated (5000/hour), so poll less often rather than re-authenticating.'
      : 'Unauthenticated requests get 60/hour; a personal access token raises it to 5000/hour.';
    return new GithubSourceError(
      'rate-limited',
      `GitHub rate limit reached for ${url}.${resetClause(res.headers.get('x-ratelimit-reset'))}${wait} ${advice} Wait and poll again; nothing about the repo has changed.`,
      status,
    );
  }

  if (status === 401) {
    return new GithubSourceError(
      'unauthorized',
      `GitHub rejected the token for ${url} (401). It is expired, revoked, or mistyped. Fix it — or drop it entirely, since a public repo reads fine with no token at all.`,
      status,
    );
  }

  if (status === 403) {
    return new GithubSourceError(
      'forbidden',
      `GitHub refused ${url} (403) and this is not a rate limit. The token is valid but not allowed here: it is missing the "repo" scope, or the org requires SSO authorization for it.`,
      status,
    );
  }

  if (status === 404) {
    // The single most misread status on this API. GitHub answers 404 rather
    // than 403 for a private repo you cannot see, precisely so that a 403 does
    // not confirm the repo exists — so "not found" and "not yours" arrive
    // identically and the message has to name both.
    const because = authenticated
      ? 'Check the spelling; if it is private, this token cannot see it — it needs the "repo" scope and, in an SSO org, authorization.'
      : 'Check the spelling; if the repo is PRIVATE this is exactly what an unauthenticated request sees, so pass a token with the "repo" scope.';
    return new GithubSourceError(
      'not-found',
      `No repository visible at ${url} (404). ${because}`,
      status,
    );
  }

  if (status >= 500) {
    return new GithubSourceError(
      'http',
      `GitHub itself failed on ${url} (${status}). This is the API being unwell, not a problem with the repo or the token — retry later.`,
      status,
    );
  }

  return new GithubSourceError(
    'http',
    `Unexpected ${status} from ${url}. This adapter has no specific reading of that status, which is itself worth knowing.`,
    status,
  );
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
