/**
 * The GitHub work-item source.
 *
 * Every request is served by an injected fake fetch, so this file never touches
 * the network: a test suite that needs GitHub to be up, and a rate limit to be
 * available, is a test suite that is skipped.
 *
 * The happy path is the short half. The long half is the one that matters — the
 * six ways a poll can fail must each be TELLABLE APART, and not one of them may
 * come back as an empty list, because downstream "no issues" means "you are
 * clear for the day".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GITHUB_SOURCE, GithubSourceError, githubSource } from '../src/github.js';
import type { GithubFailure } from '../src/github.js';
import { dedupe, toSummary } from '../src/work-item.js';
import type { WorkItem, WorkItemSource } from '../src/work-item.js';

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  /**
   * The abort signal the adapter attached, if any. Recorded because a request
   * with NO deadline is the one failure that looks like success right up until
   * the poller has been silently dead for a day.
   */
  readonly signal: AbortSignal | null;
}

/** A fetch that answers from a script and records what it was asked. */
function stubFetch(reply: (url: string, call: number) => Response | Promise<Response>): {
  impl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      signal: init?.signal ?? null,
    });
    // `async` matters: a synchronous throw from `reply` becomes a rejected
    // promise here, which is what a real fetch does with a network error.
    return reply(url, calls.length);
  };
  return { impl, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function issue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 12,
    title: 'Ledger verify is slow on large chains',
    body: 'Takes 40s over 100k receipts.',
    html_url: 'https://github.com/abheet19/zeno/issues/12',
    updated_at: '2026-09-03T11:22:33Z',
    labels: [{ name: 'bug' }, { name: 'kernel' }],
    ...over,
  };
}

function source(reply: (url: string, call: number) => Response | Promise<Response>, over: Record<string, unknown> = {}): {
  src: WorkItemSource;
  calls: Call[];
} {
  const { impl, calls } = stubFetch(reply);
  const src = githubSource({ owner: 'abheet19', repo: 'zeno', fetchImpl: impl, ...over });
  return { src, calls };
}

/**
 * Assert that a poll FAILED, and hand back the error.
 *
 * The `assert.fail` on the success path is the point of the helper: a silent
 * empty list is the specific bug this adapter exists to prevent, so a scenario
 * that resolves with `[]` must break the build rather than pass quietly.
 */
async function failure(src: WorkItemSource): Promise<GithubSourceError> {
  let items: readonly WorkItem[];
  try {
    items = await src.list();
  } catch (err) {
    if (err instanceof GithubSourceError) return err;
    throw err; // something nobody modelled — let it fail loudly and by name
  }
  return assert.fail(
    `expected a failure, but list() resolved with ${items.length} item(s). A poll that could not ask must never look like a backlog that is empty.`,
  );
}

// ─── the ordinary read ──────────────────────────────────────────────────────

test('a normal issue list maps onto the port', async () => {
  const { src, calls } = source(() =>
    json([
      issue(),
      issue({ number: 13, title: 'Windows path handling', labels: ['windows'], updated_at: '2026-09-04T08:00:00Z' }),
    ]),
  );

  const items = await src.list();

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    id: 'github:abheet19/zeno#12',
    source: GITHUB_SOURCE,
    title: 'Ledger verify is slow on large chains',
    body: 'Takes 40s over 100k receipts.',
    url: 'https://github.com/abheet19/zeno/issues/12',
    updatedAt: '2026-09-03T11:22:33Z',
    labels: ['bug', 'kernel'],
  });
  assert.deepEqual(items[1]?.labels, ['windows'], 'string labels are accepted as well as objects');
  assert.equal(src.name, 'github:abheet19/zeno', 'the feed names the repo, not just the adapter');
  assert.equal(calls.length, 1, 'one page, one request');
});

test('the request is the documented one: open issues, JSON, a user-agent, no token', async () => {
  const { src, calls } = source(() => json([]));
  await src.list();

  const call = calls[0];
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(url.pathname, '/repos/abheet19/zeno/issues');
  assert.equal(url.searchParams.get('state'), 'open');
  assert.equal(
    url.searchParams.get('per_page'),
    '100',
    'the API maximum — the ceiling the `truncated` failure quotes is 10 pages × 100, and that number is only true if the request actually asks for 100',
  );
  assert.equal(call.headers['accept'], 'application/vnd.github+json');
  assert.ok((call.headers['user-agent'] ?? '').length > 0, 'GitHub rejects requests with no user-agent');
  assert.equal('authorization' in call.headers, false, 'a public repo is read with no credential at all');
  assert.equal(
    call.headers['x-github-api-version'],
    '2022-11-28',
    'the API version is PINNED, so a breaking change to the issue shape arrives as a legible error rather than as silently reshaped work items',
  );
});

/**
 * The timeout is the difference between a poller that reports a failure and a
 * poller that has stopped and told nobody.
 *
 * The 'abandoned request is a timeout' test below proves only that a
 * TimeoutError is CLASSIFIED correctly — it fakes the error and never touches
 * the mechanism. Delete `signal: AbortSignal.timeout(...)` from the adapter and
 * that test still passes, while a real GitHub connection that accepts and then
 * never answers hangs this poll forever. This is the test that notices.
 */
test('every request carries a deadline — a poll that hangs is a poll that stopped reporting', async () => {
  const { src, calls } = source(() => json([]));
  await src.list();

  const signal = calls[0]?.signal;
  assert.ok(signal instanceof AbortSignal, 'the request was sent with no abort signal at all');
  assert.equal(signal.aborted, false, 'and it had not already fired');

  // A signal that can never fire is the same as no signal. Proving the deadline
  // is real without waiting 10s for it: an already-elapsed timeout must abort.
  const expired = AbortSignal.timeout(0);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(expired.aborted, true, 'AbortSignal.timeout is the mechanism being relied on');
});

test('the deadline is armed on EVERY page and EVERY poll — a fresh one each time', async () => {
  // A second page is a second chance to hang, and pagination reuses one init
  // object — a signal created once at construction would already be spent.
  const page2 = 'https://api.github.com/repos/abheet19/zeno/issues?page=2';
  const { src, calls } = source((_u, n) => (n % 2 === 1 ? linked([issue()], page2) : linked([], null)));
  await src.list();

  assert.equal(calls.length, 2);
  for (const [i, call] of calls.entries()) {
    assert.ok(call.signal instanceof AbortSignal, `page ${i + 1} was sent with no deadline`);
    assert.equal(call.signal.aborted, false, `page ${i + 1} was sent with a signal that had already fired`);
  }

  // THE ASSERTIONS THAT DO THE WORK, and the reason the two above are not
  // enough on their own. "an AbortSignal, not yet aborted" is satisfied exactly
  // as well by ONE ten-second signal shared by every request this source will
  // ever make — the precise bug this test is named for — because nothing here
  // waits ten seconds for it to fire. A deadline is per-request or it is not a
  // per-request deadline, and the only way to say that is by identity.
  assert.notEqual(
    calls[0]?.signal,
    calls[1]?.signal,
    'page two reused page one’s deadline: a three-page poll would then get 10s in total rather than 10s per request',
  );

  // Across polls is the version that kills a long-running daemon. `nodeWorkDesk`
  // builds this source once at startup and polls it forever; a signal armed at
  // construction is spent ten seconds later, and every poll from then on aborts
  // before it is sent — a trigger that has silently stopped firing, which is the
  // failure this entire package exists to make impossible.
  await src.list();
  assert.equal(calls.length, 4, 'the second poll asked again rather than replaying the first');
  assert.equal(new Set(calls.map((c) => c.signal)).size, 4, 'four requests, four separate deadlines');
});

test('a token, when given, travels in the Authorization header — and only then', async () => {
  const withToken = source(() => json([]), { token: 'ghp_secret' });
  await withToken.src.list();
  assert.equal(withToken.calls[0]?.headers['authorization'], 'Bearer ghp_secret');

  // An unset environment variable arrives as "" once a shell has been through
  // it; sending "Bearer " would earn a 401 that reports a BROKEN credential
  // when the truth is that there is no credential.
  const blank = source(() => json([]), { token: '   ' });
  await blank.src.list();
  assert.equal('authorization' in (blank.calls[0]?.headers ?? {}), false);
});

test('an assignee narrows the question', async () => {
  const { src, calls } = source(() => json([]), { assignee: 'abheet19' });
  await src.list();
  assert.equal(new URL(calls[0]?.url ?? '').searchParams.get('assignee'), 'abheet19');
});

test('an empty repo is an honest empty list — the one time [] is true', async () => {
  const { src } = source(() => json([]));
  assert.deepEqual(await src.list(), []);
});

test('missing optional fields degrade, they do not fail', async () => {
  const { src } = source(() =>
    json([issue({ body: null, html_url: undefined, labels: 'not-an-array' })]),
  );

  const item = (await src.list())[0];
  assert.equal(item?.body, '', 'an issue with no description has an empty body, not a null one');
  assert.equal(item?.url, null, 'the port says null when there is nowhere to go');
  assert.deepEqual(item?.labels, [], 'a label array in a shape we cannot read costs a tag, nothing more');
});

// ─── the classic bug ────────────────────────────────────────────────────────

test('PULL REQUESTS ARE EXCLUDED — every PR is also an issue on this endpoint', async () => {
  const { src } = source(() =>
    json([
      issue({ number: 12 }),
      issue({
        number: 14,
        title: 'Add the GitHub adapter',
        pull_request: { url: 'https://api.github.com/repos/abheet19/zeno/pulls/14' },
      }),
      issue({ number: 15, title: 'Docs are stale' }),
    ]),
  );

  const items = await src.list();
  assert.deepEqual(
    items.map((i) => i.id),
    ['github:abheet19/zeno#12', 'github:abheet19/zeno#15'],
    'the PR never becomes a work item',
  );
  assert.equal(
    items.some((i) => i.title.includes('Add the GitHub adapter')),
    false,
    'a PR reaching intake would burn an approval on work that does not exist',
  );
});

test('a page of nothing but pull requests is empty, and that is not a failure', async () => {
  const { src } = source(() => json([issue({ pull_request: { url: 'x' } })]));
  assert.deepEqual(await src.list(), [], 'we asked, and there were no ISSUES');
});

// ─── the failures, each one distinguishable ─────────────────────────────────

test('403 rate limit: says wait, and says when', async () => {
  const reset = 1_789_000_000;
  const { src } = source(() =>
    json(
      { message: 'API rate limit exceeded' },
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } },
    ),
  );

  const err = await failure(src);
  assert.equal(err.reason, 'rate-limited');
  assert.equal(err.status, 403);
  assert.match(err.message, /rate limit/i);
  assert.ok(err.message.includes(new Date(reset * 1000).toISOString()), 'names the instant it resets');
  assert.match(err.message, /60\/hour/, 'and tells an unauthenticated caller what a token would buy');
});

test('a reset header past the end of time still fails BY NAME, not as a crash', async () => {
  // `x-ratelimit-reset` is foreign text and `Date` only spans ±8.64e15 ms. A
  // value past that used to reach `toISOString()` and throw a bare RangeError
  // out of `list()` — an unmodelled crash in place of the named failure, with
  // none of the doctrine sentence and nothing for a caller to branch on.
  for (const reset of ['99999999999999', '-0', 'soon', '']) {
    const { src } = source(() =>
      json(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset } },
      ),
    );

    const err = await failure(src); // rethrows anything that is not a GithubSourceError
    assert.equal(err.reason, 'rate-limited', `reset=${JSON.stringify(reset)}`);
    assert.match(err.message, /rate limit/i);
    assert.equal(err.message.includes('It resets at'), false, 'an unreadable reset costs the clause, nothing else');
  }
});

test('403 that is NOT a rate limit is a different diagnosis and different advice', async () => {
  const { src } = source(() => json({ message: 'Must have push access' }, { status: 403 }), {
    token: 'ghp_valid_but_unscoped',
  });

  const err = await failure(src);
  assert.equal(err.reason, 'forbidden');
  assert.match(err.message, /scope|SSO/, 'a permission problem, not a "wait an hour" problem');
  assert.equal(/rate limit reached/i.test(err.message), false);
});

test('404: names the private-repo case, because GitHub hides private repos behind a 404', async () => {
  const { src } = source(() => json({ message: 'Not Found' }, { status: 404 }));

  const err = await failure(src);
  assert.equal(err.reason, 'not-found');
  assert.equal(err.status, 404);
  assert.match(err.message, /private/i, 'a 404 here can mean "not yours" as easily as "not there"');
});

test('401: the token is rejected, and dropping it is a real option', async () => {
  const { src } = source(() => json({ message: 'Bad credentials' }, { status: 401 }), { token: 'ghp_expired' });

  const err = await failure(src);
  assert.equal(err.reason, 'unauthorized');
  assert.match(err.message, /public repo reads fine with no token/);
});

test('a network throw is reported as a fact about the network', async () => {
  const { src } = source(() => {
    throw new TypeError('fetch failed');
  });

  const err = await failure(src);
  assert.equal(err.reason, 'unreachable');
  assert.equal(err.status, null, 'nothing was answered, so there is no status to report');
  assert.match(err.message, /offline|DNS|proxy/i);
  assert.equal((err.cause as Error | undefined)?.message, 'fetch failed', 'the original is kept for debugging');
});

test('an abandoned request is a timeout, not a refusal', async () => {
  const { src } = source(() => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  });

  const err = await failure(src);
  assert.equal(err.reason, 'timeout');
  assert.match(err.message, /Abandoned is not refused/);
});

test('a malformed body says what actually came back', async () => {
  const { src } = source(() => new Response('<!DOCTYPE html><title>Sign in to the proxy</title>', { status: 200 }));

  const err = await failure(src);
  assert.equal(err.reason, 'malformed');
  assert.equal(err.status, 200);
  assert.match(err.message, /not JSON/);
  assert.match(err.message, /DOCTYPE/, 'quotes the first bytes, so a captive portal is recognisable on sight');
});

test('200 with a JSON object instead of an array is malformed, not empty', async () => {
  const { src } = source(() => json({ message: 'Moved Permanently' }));

  const err = await failure(src);
  assert.equal(err.reason, 'malformed');
  assert.match(err.message, /Moved Permanently/, 'surfaces the envelope it got instead');
});

test('an issue with no updated_at is refused: that field is what dedupe keys on', async () => {
  const { src } = source(() => json([issue({ updated_at: undefined })]));

  const err = await failure(src);
  assert.equal(err.reason, 'malformed');
  assert.match(err.message, /updated_at/);
});

/**
 * The other half of the adapter's stated rule — "degrade on what is cosmetic,
 * refuse on what is load-bearing" — and the half no test read. 'missing optional
 * fields degrade' proves the cosmetic side; this is the side it is contrasted
 * with, and without it the contrast is a comment rather than a behaviour.
 *
 * Tolerating a missing `number` is worse than it first looks. The id becomes
 * "github:owner/repo#undefined", so EVERY issue missing a number collapses onto
 * that single id — and `dedupe` keys on exactly that, so all but the first are
 * swallowed permanently, with nothing anywhere reporting a short list.
 */
test('an issue with no usable "number" is refused: the number IS the identity', async () => {
  for (const number of [undefined, null, 'twelve', 1.5, Number.MAX_SAFE_INTEGER + 2]) {
    const { src } = source(() => json([issue({ number })]));

    const err = await failure(src); // resolving with an item at all fails the test
    assert.equal(err.reason, 'malformed', `number=${JSON.stringify(number) ?? 'undefined'}`);
    assert.match(err.message, /number/);
    assert.equal(err.message.includes('#undefined'), false, 'and no id was invented out of the gap');
  }
});

test('a non-object entry in the array is refused, never quietly skipped', async () => {
  // Skipping it is the one move this file forbids: a list one item shorter than
  // the truth, indistinguishable from a repo with one fewer issue. Note the
  // valid issue sitting in front of it — the tempting fix ("drop the junk, keep
  // what parsed") is exactly the plausible short backlog.
  for (const junk of [null, 'a string where an issue should be', 42, ['nested']]) {
    const { src } = source(() => json([issue(), junk]));

    const err = await failure(src);
    assert.equal(err.reason, 'malformed', `entry=${JSON.stringify(junk)}`);
    assert.match(err.message, /entry 1 is not an object/);
  }
});

test('NO FAILURE IS SILENT, AND NO TWO ARE ALIKE', async () => {
  const scenarios: ReadonlyArray<readonly [GithubFailure, () => Response | Promise<Response>]> = [
    ['unreachable', () => { throw new TypeError('fetch failed'); }],
    ['timeout', () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; }],
    ['unauthorized', () => json({}, { status: 401 })],
    ['forbidden', () => json({}, { status: 403 })],
    ['rate-limited', () => json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })],
    ['not-found', () => json({}, { status: 404 })],
    ['http', () => json({}, { status: 502 })],
    ['malformed', () => new Response('nonsense', { status: 200 })],
  ];

  const seen = new Set<string>();
  for (const [expected, reply] of scenarios) {
    const { src } = source(reply);
    const err = await failure(src); // fails the test outright if [] comes back
    assert.equal(err.reason, expected);
    assert.equal(err.name, 'GithubSourceError');
    // The doctrine, on every single one: nothing returned is not zero found.
    assert.match(err.message, /I could not ask/);
    seen.add(err.message);
  }
  assert.equal(seen.size, scenarios.length, 'eight failures, eight different sentences');
});

// ─── pagination, and the interrupted poll ───────────────────────────────────

function linked(body: unknown, next: string | null): Response {
  return json(body, next === null ? {} : { headers: { link: `<${next}>; rel="next", <${next}>; rel="last"` } });
}

test('pagination follows the Link header and returns every page, once', async () => {
  const page2 = 'https://api.github.com/repos/abheet19/zeno/issues?state=open&per_page=100&page=2';
  const { src, calls } = source((_url, n) =>
    n === 1 ? linked([issue({ number: 1 })], page2) : linked([issue({ number: 2 })], null),
  );

  const items = await src.list();
  assert.deepEqual(items.map((i) => i.id), ['github:abheet19/zeno#1', 'github:abheet19/zeno#2']);
  assert.equal(calls[1]?.url, page2, 'the second request goes exactly where GitHub pointed');
});

test('INTERRUPTED POLL — a failure on page two loses page one rather than lying about it', async () => {
  const page2 = 'https://api.github.com/repos/abheet19/zeno/issues?page=2';
  const { src } = source((_url, n) => {
    if (n === 1) return linked([issue({ number: 1 }), issue({ number: 2 })], page2);
    throw new TypeError('fetch failed'); // the connection dies mid-poll
  });

  const err = await failure(src);
  assert.equal(err.reason, 'unreachable');
  // Returning the two items from page one would have been indistinguishable, to
  // every caller, from a complete backlog of exactly two items.
});

test('INTERRUPTED BODY — a response whose body dies mid-read is not a shorter list', async () => {
  const { src } = source(() => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"number":1,'));
        controller.error(new Error('socket hang up'));
      },
    });
    return new Response(stream, { status: 200 });
  });

  const err = await failure(src);
  assert.equal(err.reason, 'unreachable');
  assert.equal(err.status, 200, 'the status line did arrive; the body did not');
  assert.match(err.message, /cut off mid-sentence/);
});

test('INTERRUPTED BODY — our own deadline expiring mid-body is a timeout, not the network', async () => {
  // `AbortSignal.timeout` arms the whole exchange, so the same clock that gives
  // a `timeout` before the status line gives an abort AFTER it when GitHub is
  // slow to finish sending. Reading that second case as `unreachable` sends the
  // owner to inspect a network that was working perfectly.
  const { src } = source(() => {
    const deadline = new Error('The operation was aborted due to timeout');
    deadline.name = 'TimeoutError';
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('[{"number":1,'));
          controller.error(deadline);
        },
      }),
      { status: 200 },
    );
  });

  const err = await failure(src);
  assert.equal(err.reason, 'timeout', 'one clock, one name for it, wherever it happens to land');
  assert.equal(err.status, 200, 'the status line did arrive; the rest did not');
  assert.match(err.message, /Abandoned is not refused/);
  assert.equal(/this machine's network/.test(err.message), false, 'the network was never the problem');
});

test('a backlog too large to read in one poll is refused, not silently clipped', async () => {
  const next = 'https://api.github.com/repos/abheet19/zeno/issues?page=99';
  const { src, calls } = source(() => linked([issue()], next)); // always another page

  const err = await failure(src);
  assert.equal(err.reason, 'truncated');
  assert.match(err.message, /pass an assignee/, 'tells the owner how to make the question answerable');
  // EXACTLY ten, not "at most ten". `<=` is satisfied by an adapter that gives
  // up after one page, which would refuse an eleven-page backlog it could have
  // read — the bound has to be the documented one in both directions.
  assert.equal(calls.length, 10, `the poll reads its full budget and then refuses (made ${calls.length} requests)`);
  assert.match(err.message, /1000/, 'and the message states the ceiling it actually hit');
});

test('a last page that still sends a Link header terminates — it does not loop', async () => {
  // GitHub's LAST page carries a Link header too: rel="first" and rel="prev",
  // and no "next". A `nextPageUrl` that matched any relation would follow
  // rel="prev" back to page one and page forever, and the only symptom would be
  // a poll that never returns.
  const page1 = 'https://api.github.com/repos/abheet19/zeno/issues?page=1';
  const { src, calls } = source((_u, n) =>
    n === 1
      ? linked([issue({ number: 1 })], 'https://api.github.com/repos/abheet19/zeno/issues?page=2')
      : json([issue({ number: 2 })], {
          headers: { link: `<${page1}>; rel="prev", <${page1}>; rel="first"` },
        }),
  );

  const items = await src.list();
  assert.deepEqual(items.map((i) => i.id), ['github:abheet19/zeno#1', 'github:abheet19/zeno#2']);
  assert.equal(calls.length, 2, 'it stopped when GitHub stopped offering a next page');
});

test('pagination that points off api.github.com is refused before the token follows it', async () => {
  const { src, calls } = source(() => linked([issue()], 'https://api.github.com.evil.test/repos/x/y/issues?page=2'), {
    token: 'ghp_secret',
  });

  const err = await failure(src);
  assert.equal(err.reason, 'malformed');
  assert.match(err.message, /refusing to send credentials/);
  assert.equal(calls.length, 1, 'the second request was never made');
});

test('a Link header we cannot READ is refused, not read as "there is no next page"', async () => {
  // The quietest possible truncation: give up on the cursor, return page one,
  // and every caller sees a complete backlog of exactly one item. A proxy that
  // rewrites headers looks precisely like this.
  const { src, calls } = source(() =>
    // The angle brackets RFC 8288 requires are gone, so there is no link value
    // here to read — not a link value that happens to lack a "next".
    json([issue({ number: 1 })], {
      headers: { link: 'https://api.github.com/repos/abheet19/zeno/issues?page=2; rel="next"' },
    }),
  );

  const err = await failure(src);
  assert.equal(err.reason, 'malformed');
  assert.match(err.message, /Link header/);
  assert.equal(calls.length, 1, 'and nothing was invented about where page two lives');
});

test('the LAST page has a Link header with no "next", and that is an ordinary end', async () => {
  // rel="prev" and rel="first" without a rel="next" is exactly what GitHub
  // sends on the final page. Refusing that would break every paginated read.
  const { src } = source((_url, n) =>
    n === 1
      ? linked([issue({ number: 1 })], 'https://api.github.com/repos/abheet19/zeno/issues?page=2')
      : json([issue({ number: 2 })], {
          headers: {
            link: '<https://api.github.com/repos/abheet19/zeno/issues?page=1>; rel="prev", <https://api.github.com/repos/abheet19/zeno/issues?page=1>; rel="first"',
          },
        }),
  );

  const items = await src.list();
  assert.deepEqual(items.map((i) => i.id), ['github:abheet19/zeno#1', 'github:abheet19/zeno#2']);
});

// ─── caller mistakes, caught at the door ────────────────────────────────────

test('owner/repo are validated at construction, so a typo is not reported as a 404', () => {
  assert.throws(() => githubSource({ owner: '', repo: 'zeno' }), /needs an owner/);
  assert.throws(() => githubSource({ owner: 'abheet19', repo: '  ' }), /needs a repo/);
  assert.throws(() => githubSource({ owner: 'abheet19/zeno', repo: 'zeno' }), /separately/);
});

test('a repo name cannot escape its path segment', async () => {
  // The "/" case is refused outright above; this is the rest of the surface —
  // a name that would otherwise smuggle in query parameters of its own.
  const { src, calls } = source(() => json([]), { repo: 'zeno?state=closed&assignee=someone-else' });
  await src.list();

  const url = new URL(calls[0]?.url ?? '');
  assert.equal(
    url.pathname,
    '/repos/abheet19/zeno%3Fstate%3Dclosed%26assignee%3Dsomeone-else/issues',
    'encoded, so it stays a repo name instead of rewriting the request',
  );
  assert.equal(url.searchParams.get('state'), 'open', 'the question we asked is still the question we asked');
  assert.equal(url.searchParams.get('assignee'), null);
});

// ─── it is the same port ────────────────────────────────────────────────────

test('GitHub items flow through the port machinery untouched', async () => {
  const { src } = source(() =>
    json([issue({ title: 'Fix ‮reversed‬ title', labels: [{ name: 'bug' }] })]),
  );
  const items = await src.list();

  const first = dedupe(items);
  assert.equal(first.fresh.length, 1);
  assert.equal(dedupe(items, first.seen).fresh.length, 0, 'an unchanged issue is not new work');

  const changed = items.map((i) => ({ ...i, updatedAt: '2026-09-05T00:00:00Z' }));
  assert.equal(dedupe(changed, first.seen).fresh.length, 1, 'a changed issue is worth another look');

  const summary = toSummary(items[0] as WorkItem);
  assert.equal(summary.includes('‮'), false, 'the capsule strips bidi overrides from attacker-set titles');
  assert.match(summary, /^github:abheet19\/zeno#12 — /);
});
