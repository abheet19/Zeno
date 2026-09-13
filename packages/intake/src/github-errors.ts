/**
 * Why a GitHub poll failed, and how to say so.
 *
 * Split out of `github.ts`: the reason codes, the error class, and the
 * response-to-error translation are one cohesive unit — "what happened" and
 * "how do we describe it" — and keeping them together here makes that unit
 * legible on its own, separate from the pagination (`github-pagination.ts`)
 * and issue-shape mapping (`github-issue.ts`) that live alongside it.
 *
 * THE RULE THIS FILE EXISTS TO KEEP, same as the rest of the adapter: a failed
 * poll must never look like an empty backlog. "There is nothing to do" and "I
 * could not ask" are different facts, and a briefing that renders the second
 * as the first lies quietly on exactly the mornings you most need it not to.
 * So every failure here throws a distinct, named, actionable error, and no
 * code path returns a short list to paper over a problem.
 */
import { oneLine } from './work-item.js';

/** Longest quoted fragment of a foreign response body an error will carry. */
const SNIPPET_LIMIT = 120;

/** One line, clipped, safe to embed in an error message. */
export function snippet(text: string): string {
  const clean = oneLine(text);
  return clean.length <= SNIPPET_LIMIT ? clean : `${clean.slice(0, SNIPPET_LIMIT - 1)}…`;
}

export function describe(err: unknown): string {
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
export function isDeadline(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

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

/** Shared by the issue mapper and the pagination reader: a 2xx body this adapter cannot make sense of. */
export function malformed(url: string, status: number, detail: string): GithubSourceError {
  return new GithubSourceError(
    'malformed',
    `${url} answered ${status}, but the body is not a GitHub issue list: ${detail}. Either this is not the GitHub API answering (a proxy or captive portal looks exactly like this) or the API's shape has changed and this adapter must be updated.`,
    status,
  );
}

/** Seconds-since-epoch reset header rendered as an absolute instant, or ''. */
export function resetClause(header: string | null): string {
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
export function httpFailure(res: Response, url: string, authenticated: boolean): GithubSourceError {
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
