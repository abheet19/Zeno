/**
 * `GET /work` and `POST /work` — the trigger, restored.
 *
 * The claim these tests defend is not "the route returns some items". It is the
 * one the whole WorkItem port exists for: A SOURCE THAT COULD NOT BE ASKED MUST
 * NEVER RENDER AS A SOURCE WITH NOTHING TO SAY. So the long half of this file is
 * the failing half — GitHub down, GitHub cut off mid-sentence, the backlog file
 * locked, the write refused — and in every one of those the answer must still
 * carry the items it does have, name the source that failed, and say so in
 * `complete`.
 *
 * No test here touches the network. The remote is an injected `WorkItemSource`,
 * or a `githubSource` over a fake fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import {
  Backlog,
  GithubSourceError,
  backlogPathIn,
  githubSource,
  nodeBacklogStore,
  systemClock,
  toSummary,
  type BacklogStore,
  type WorkItem,
  type WorkItemSource,
} from '@abheet19/zeno-intake';
import { createServer } from '../src/server.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { WorkDesk, githubFromEnv, nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

interface WorkResponse {
  readonly items: readonly WorkItem[];
  readonly closedItems: readonly WorkItem[];
  readonly sources: readonly { name: string; state: string; count: number | null; detail?: string; reason?: string }[];
  readonly complete: boolean;
}

interface Harness {
  readonly base: string;
  readonly owner: string;
  readonly proposer: string;
  readonly dir: string;
  close(): Promise<void>;
}

/** `makeWork` receives the temp dir, so a test can point a desk at that file. */
async function start(makeWork?: (dir: string) => WorkDesk): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-work-'));
  const fs = nodeSandboxFs();
  const kernel = new Kernel(nodeWorld(fs), {
    store: nodeLedgerStore(join(dir, 'ledger.jsonl')),
    policy: DEFAULT_POLICY,
  });
  const tokens = mintTokens();
  const server = createServer({
    kernel,
    sandbox: join(dir, 'sandbox'),
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: makeWork === undefined ? nodeWorkDesk(dir) : makeWork(dir),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${addr.port}`,
    owner: tokens.owner,
    proposer: tokens.proposer,
    dir,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          ok();
        });
      }),
  };
}

function headers(token: string | null): Record<string, string> {
  return { 'content-type': 'application/json', ...(token === null ? {} : { 'x-zeno-token': token }) };
}

function addWork(h: Harness, token: string | null, body: unknown): Promise<Response> {
  return fetch(h.base + '/work', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
}

function transitionWork(h: Harness, token: string, action: 'close' | 'reopen', id: unknown): Promise<Response> {
  return fetch(h.base + `/work/${action}`, {
    method: 'POST', headers: headers(token), body: JSON.stringify({ id }),
  });
}

async function getWork(h: Harness, token: string): Promise<WorkResponse> {
  const res = await fetch(h.base + '/work', { headers: headers(token) });
  assert.equal(res.status, 200);
  return (await res.json()) as WorkResponse;
}

function reportFor(w: WorkResponse, prefix: string): { name: string; state: string; count: number | null; detail?: string; reason?: string } {
  const found = w.sources.find((s) => s.name.startsWith(prefix));
  assert.ok(found !== undefined, `no source report starting "${prefix}" — sources must never be silently omitted`);
  return found;
}

/** A remote that answers with exactly these items. */
function feed(name: string, items: readonly WorkItem[]): WorkItemSource {
  return { name, list: () => Promise.resolve(items) };
}

function remoteItem(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'github:abheet19/zeno#12',
    source: 'github',
    title: 'Ledger verify is slow on large chains',
    body: '',
    url: 'https://github.com/abheet19/zeno/issues/12',
    updatedAt: '2026-09-03T11:22:33Z',
    labels: ['bug'],
    ...over,
  };
}

// ── authentication: the same door as everything else ────────────────────────

test('GET /work with no token is 401 — work is not public, even on loopback', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/work');
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unauthenticated');
  } finally {
    await h.close();
  }
});

test('POST /work with no token is 401, and writes nothing', async () => {
  const h = await start();
  try {
    const res = await addWork(h, null, { title: 'should never land' });
    assert.equal(res.status, 401);
    const after = await getWork(h, h.owner);
    assert.deepEqual(after.items, [], 'a refused request must not leave an item behind');
  } finally {
    await h.close();
  }
});

// ── the ordinary path ───────────────────────────────────────────────────────

test('an item added by the PROPOSER appears in GET /work', async () => {
  const h = await start();
  try {
    const res = await addWork(h, h.proposer, {
      title: 'Rewrite the intake trigger',
      body: 'Jira is gone; the port is not.',
      labels: ['intake', 'intake'],
    });
    assert.equal(res.status, 200);
    const { item } = (await res.json()) as { item: WorkItem };
    assert.equal(item.id, 'local:1');
    assert.equal(item.source, 'local');
    assert.deepEqual(item.labels, ['intake'], 'a repeated label is collapsed, not duplicated');

    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items.map((i) => i.id), ['local:1']);
    assert.equal(work.items[0]?.title, 'Rewrite the intake trigger');
    assert.equal(reportFor(work, 'local').count, 1);
    assert.equal(work.complete, true);
  } finally {
    await h.close();
  }
});

test('the OWNER may add too — noticing work is not deciding to do it', async () => {
  const h = await start();
  try {
    assert.equal((await addWork(h, h.owner, { title: 'from the owner' })).status, 200);
    assert.equal((await addWork(h, h.proposer, { title: 'from an agent' })).status, 200);
    const work = await getWork(h, h.proposer);
    assert.deepEqual(work.items.map((i) => i.id), ['local:1', 'local:2'], 'ids are sequential and never reused');
  } finally {
    await h.close();
  }
});

test('a closed item leaves the list but stays in the record', async () => {
  const h = await start();
  try {
    await addWork(h, h.owner, { title: 'one' });
    await addWork(h, h.owner, { title: 'two' });
    const backlog = new Backlog(nodeBacklogStore(backlogPathIn(h.dir)), systemClock);
    backlog.close('local:1');

    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items.map((i) => i.id), ['local:2'], 'only open items are work');
    assert.deepEqual(work.closedItems.map((i) => i.id), ['local:1'], 'completed work stays visible for reopening');
    assert.equal(backlog.list().length, 2, 'and the closed one is still on record');
  } finally {
    await h.close();
  }
});

test('the OWNER can complete and reopen local work, idempotently', async () => {
  const h = await start();
  try {
    await addWork(h, h.owner, { title: 'finish the real loop' });

    const closed = await transitionWork(h, h.owner, 'close', 'local:1');
    assert.equal(closed.status, 200);
    const first = (await closed.json()) as { state: string; changed: boolean; item: WorkItem };
    assert.equal(first.state, 'closed');
    assert.equal(first.changed, true);
    assert.equal(first.item.id, 'local:1');
    const afterClose = await getWork(h, h.owner);
    assert.deepEqual(afterClose.items, []);
    assert.deepEqual(afterClose.closedItems.map((item) => item.id), ['local:1']);

    const closedAgain = await transitionWork(h, h.owner, 'close', 'local:1');
    assert.equal(closedAgain.status, 200);
    const duplicate = (await closedAgain.json()) as { changed: boolean; item: WorkItem };
    assert.equal(duplicate.changed, false, 'a repeated close is a successful no-op');
    assert.equal(duplicate.item.updatedAt, first.item.updatedAt, 'a no-op does not create a new revision timestamp');

    const reopened = await transitionWork(h, h.owner, 'reopen', 'local:1');
    assert.equal(reopened.status, 200);
    assert.equal(((await reopened.json()) as { changed: boolean }).changed, true);
    const afterReopen = await getWork(h, h.owner);
    assert.deepEqual(afterReopen.items.map((item) => item.id), ['local:1']);
    assert.deepEqual(afterReopen.closedItems, []);

    const reopenedAgain = await transitionWork(h, h.owner, 'reopen', 'local:1');
    assert.equal(reopenedAgain.status, 200);
    assert.equal(((await reopenedAgain.json()) as { changed: boolean }).changed, false);
  } finally {
    await h.close();
  }
});

test('a PROPOSER cannot complete or reopen work directly', async () => {
  const h = await start();
  try {
    await addWork(h, h.proposer, { title: 'owner decides when this is done' });
    for (const action of ['close', 'reopen'] as const) {
      const refused = await transitionWork(h, h.proposer, action, 'local:1');
      assert.equal(refused.status, 403);
      assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'owner-only');
    }
    assert.deepEqual((await getWork(h, h.owner)).items.map((item) => item.id), ['local:1']);
  } finally {
    await h.close();
  }
});

test('completion refuses remote, unknown, and malformed ids without changing local work', async () => {
  const h = await start((dir) => new WorkDesk(
    new Backlog(nodeBacklogStore(backlogPathIn(dir)), systemClock),
    feed('github:abheet19/zeno', [remoteItem()]),
  ));
  try {
    await addWork(h, h.owner, { title: 'local work survives every refusal' });

    const remote = await transitionWork(h, h.owner, 'close', 'github:abheet19/zeno#12');
    assert.equal(remote.status, 409);
    assert.equal(((await remote.json()) as { error: { code: string } }).error.code, 'remote-work-item');

    const missing = await transitionWork(h, h.owner, 'close', 'local:999');
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { error: { code: string } }).error.code, 'work-item-not-found');

    for (const id of ['', 1, `local:${'9'.repeat(121)}`]) {
      const malformed = await transitionWork(h, h.owner, 'close', id);
      assert.equal(malformed.status, 400);
      assert.equal(((await malformed.json()) as { error: { code: string } }).error.code, 'bad-request');
    }

    const after = await getWork(h, h.owner);
    assert.deepEqual(after.items.map((item) => item.id), ['local:1', 'github:abheet19/zeno#12']);
    assert.deepEqual(after.closedItems, []);
  } finally {
    await h.close();
  }
});

test('a work item with no title is a 400 that says what was missing', async () => {
  const h = await start();
  try {
    for (const body of [{}, { title: '   ' }, { title: 7 }]) {
      const res = await addWork(h, h.proposer, body);
      assert.equal(res.status, 400);
      const err = (await res.json()) as { error: { code: string; message: string; resolve: string } };
      assert.equal(err.error.code, 'bad-request');
      assert.match(err.error.message, /non-empty title/);
      assert.ok(err.error.resolve.length > 0, 'a refusal always names the way forward');
    }
  } finally {
    await h.close();
  }
});

test('labels in the wrong shape are refused, not silently dropped', async () => {
  const h = await start();
  try {
    const res = await addWork(h, h.proposer, { title: 'ok', labels: ['fine', 3] });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: { message: string } }).error.message, /array of strings/);
    assert.deepEqual((await getWork(h, h.owner)).items, [], 'and nothing was written');
  } finally {
    await h.close();
  }
});

/**
 * THE TRUST BOUNDARY, WALKED END TO END.
 *
 * `POST /work` is open to the PROPOSER token on purpose — noticing that
 * something needs doing is not deciding to do it — and the proposer is the role
 * this entire product declines to trust. It validates labels as "an array of
 * strings", which is the only true thing there is to check about them. The
 * capsule sentence the OWNER reads before approving is then built from that same
 * item.
 *
 * So an untrusted caller writes text; a JSONL file carries it; the owner reads
 * it. Nothing tested that path. The two halves have to hold at once and they
 * pull in opposite directions: the ITEM must keep the bytes verbatim, because
 * sanitising there would corrupt the context a task is built from, while the
 * CAPSULE must not, because the owner approves the sentence they read.
 */
test('a PROPOSER cannot smuggle a reordering character into the owner’s capsule', async () => {
  const h = await start();
  try {
    const rlo = String.fromCharCode(0x202e);
    const res = await addWork(h, h.proposer, {
      title: 'Tidy the sandbox',
      // A newline is the other half: an unescaped one would end the JSONL
      // record early and the next read would count this item as damage.
      labels: [`safe${rlo}gnihtyreve eteled`, 'two\nlines'],
    });
    assert.equal(res.status, 200);

    const work = await getWork(h, h.owner);
    const item = work.items[0];
    assert.ok(item, 'the item survived the round trip through the file at all');
    assert.equal(reportFor(work, 'local').state, 'ok', 'a newline inside a label is not a torn line');

    assert.ok(
      item.labels[0]?.includes(rlo),
      'the ITEM keeps the bytes verbatim — stripping here would corrupt the context a task is built from',
    );

    const summary = toSummary(item);
    assert.equal(summary.includes(rlo), false, 'the CAPSULE strips them: the owner approves the sentence they READ');
    assert.equal(summary.includes('\n'), false, 'and a capsule sentence is one line, whatever a proposer sends');
  } finally {
    await h.close();
  }
});

// ── the sources report: never claim a source was consulted ──────────────────

test('with GitHub unconfigured, /work SAYS it never asked', async () => {
  const h = await start();
  try {
    await addWork(h, h.owner, { title: 'local only' });
    const work = await getWork(h, h.owner);
    const github = reportFor(work, 'github');
    assert.equal(github.state, 'not-configured');
    assert.equal(github.count, null, '0 would be a claim about GitHub; null is the truth');
    assert.match(github.detail ?? '', /ZENO_GITHUB_REPO/);
    assert.equal(work.complete, true, 'a source nobody asked for does not make the answer incomplete');
  } finally {
    await h.close();
  }
});

test('with GitHub answering, both feeds arrive through the one port', async () => {
  const h = await start((dir) => new WorkDesk(new Backlog(nodeBacklogStore(backlogPathIn(dir)), systemClock), feed('github:abheet19/zeno', [remoteItem()])));
  try {
    await addWork(h, h.owner, { title: 'local one' });
    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items.map((i) => i.source), ['local', 'github'], 'two adapters, one shape');
    assert.equal(reportFor(work, 'local').count, 1);
    assert.equal(reportFor(work, 'github').count, 1);
    assert.equal(work.complete, true);
  } finally {
    await h.close();
  }
});

// ── the failing half ────────────────────────────────────────────────────────

test('FAILURE — a GitHub outage degrades honestly and does NOT empty the list', async () => {
  const broken: WorkItemSource = {
    name: 'github:abheet19/zeno',
    list: () =>
      Promise.reject(
        new GithubSourceError('rate-limited', 'GitHub rate limit reached for https://api.github.com/…', 403),
      ),
  };
  const h = await start((dir) => new WorkDesk(new Backlog(nodeBacklogStore(backlogPathIn(dir)), systemClock), broken));
  try {
    await addWork(h, h.owner, { title: 'still mine, still here' });
    const work = await getWork(h, h.owner);

    assert.deepEqual(work.items.map((i) => i.id), ['local:1'], 'the local backlog survives a GitHub outage');
    const github = reportFor(work, 'github');
    assert.equal(github.state, 'failed');
    assert.equal(github.count, null);
    assert.equal(github.reason, 'rate-limited', 'callers branch on the reason, never on message text');
    assert.match(github.detail ?? '', /rate limit/);
    assert.match(github.detail ?? '', /not "there is nothing to do"/, 'the doctrine sentence travels with the failure');
    assert.equal(work.complete, false, 'one boolean tells a caller the list is short');
    assert.equal(reportFor(work, 'local').state, 'ok', 'and one failure does not condemn the other source');
  } finally {
    await h.close();
  }
});

test('INTERRUPTED — GitHub cut off mid-body fails the poll, and the backlog is untouched', async () => {
  // A status line arrived and the body did not. A prefix of an issue list is
  // not a shorter issue list, so the whole poll must fail.
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('[{"number":1,'));
            c.error(new Error('socket hang up'));
          },
        }),
        { status: 200 },
      ),
    );
  const remote = githubSource({ owner: 'abheet19', repo: 'zeno', fetchImpl });
  const h = await start((dir) => new WorkDesk(new Backlog(nodeBacklogStore(backlogPathIn(dir)), systemClock), remote));
  try {
    await addWork(h, h.owner, { title: 'unaffected by a dropped socket' });
    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items.map((i) => i.id), ['local:1']);
    const github = reportFor(work, 'github');
    assert.equal(github.state, 'failed');
    assert.equal(github.reason, 'unreachable');
    assert.match(github.detail ?? '', /cut off mid-sentence|still arriving/);
    assert.equal(work.complete, false);
  } finally {
    await h.close();
  }
});

test('FAILURE — an unreadable backlog file is reported, never shown as an empty backlog', async () => {
  // Readable at startup, locked afterwards: exactly what a backup process or an
  // editor holding the file looks like to a long-running daemon.
  let reads = 0;
  const store: BacklogStore = {
    readAll(): string {
      if (++reads > 1) throw new Error('EBUSY: resource busy or locked');
      return '';
    },
    writeAll(): void {
      /* never reached in this test */
    },
  };
  const h = await start(() => new WorkDesk(new Backlog(store, systemClock), null));
  try {
    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items, []);
    const local = reportFor(work, 'local');
    assert.equal(local.state, 'failed', 'an empty list plus "ok" would be a lie about your own disk');
    assert.equal(local.count, null);
    assert.match(local.detail ?? '', /EBUSY/);
    assert.equal(work.complete, false);
  } finally {
    await h.close();
  }
});

test('PARTIAL — a backlog read in PART is not a complete answer, in the fields callers read', async () => {
  // The middle case between "ok" and "failed", and the easiest one to render as
  // a lie: the file opened, some of it parsed, and the items behind the lines
  // that did not are simply absent. Saying so in `detail` alone is not saying
  // it — `detail` is prose, and nobody branches on prose.
  const good = JSON.stringify({
    id: 'local:1',
    seq: 1,
    title: 'the one line that survived',
    body: '',
    labels: [],
    state: 'open',
    createdAt: '2026-09-04T09:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
  });
  const store: BacklogStore = {
    // A crash mid-append: half a record, no newline. The item it held is gone.
    readAll: () => `${good}\n{"id":"local:2","seq":2,"title":"the one that`,
    writeAll(): void {
      /* never reached in this test */
    },
  };
  const h = await start(() => new WorkDesk(new Backlog(store, systemClock), null));
  try {
    const work = await getWork(h, h.owner);

    assert.deepEqual(work.items.map((i) => i.id), ['local:1'], 'what could be read is still returned');
    const local = reportFor(work, 'local');
    assert.equal(local.state, 'partial', 'neither "ok" (whole) nor "failed" (nothing)');
    assert.equal(local.count, 1, 'and it says how many it did manage');
    assert.match(local.detail ?? '', /could not be read/);
    assert.match(local.detail ?? '', /still in the file/, 'reporting damage is not repairing it');
    assert.equal(
      work.complete,
      false,
      'one boolean must not say "whole" about a list with a known hole in it',
    );
  } finally {
    await h.close();
  }
});

test('INTERRUPTED — a refused write is a legible failure, and the item exists nowhere', async () => {
  const store: BacklogStore = {
    readAll: () => '',
    writeAll(): void {
      throw new Error('EACCES: permission denied, rename');
    },
  };
  const h = await start(() => new WorkDesk(new Backlog(store, systemClock), null));
  try {
    const res = await addWork(h, h.proposer, { title: 'never durable' });
    assert.equal(res.status, 500);
    const err = (await res.json()) as { error: { code: string; message: string; resolve: string } };
    assert.equal(err.error.code, 'internal');
    assert.match(err.error.message, /EACCES/, 'the reason reaches the caller rather than a stack trace');

    const work = await getWork(h, h.owner);
    assert.deepEqual(work.items, [], 'durable-first: a failed write leaves nothing in memory either');
  } finally {
    await h.close();
  }
});

test('a concurrent write from another process is NOT clobbered by the daemon', async () => {
  // The CLI writes this same file. `Backlog` rebuilds the whole file from the
  // bytes it last read, so a daemon appending onto stale bytes would replace an
  // item the CLI had already reported as saved.
  const h = await start();
  try {
    await addWork(h, h.owner, { title: 'from the daemon' });
    await getWork(h, h.owner); // the daemon's view is now loaded

    const cli = new Backlog(nodeBacklogStore(backlogPathIn(h.dir)), systemClock);
    cli.add('from the CLI, in another window');

    await addWork(h, h.owner, { title: 'from the daemon again' });

    const work = await getWork(h, h.owner);
    assert.deepEqual(
      work.items.map((i) => i.title),
      ['from the daemon', 'from the CLI, in another window', 'from the daemon again'],
      'all three survive; nobody wrote over anybody',
    );
  } finally {
    await h.close();
  }
});

// ── configuration ───────────────────────────────────────────────────────────

test('githubFromEnv: unset means null, and null means "never asked"', () => {
  assert.equal(githubFromEnv({}), null);
  assert.equal(githubFromEnv({ ZENO_GITHUB_REPO: '   ' }), null, 'an unset variable through a shell is ""');
});

test('githubFromEnv: "owner/repo" builds a named feed', () => {
  const src = githubFromEnv({ ZENO_GITHUB_REPO: 'abheet19/zeno', ZENO_GITHUB_ASSIGNEE: 'abheet19' });
  assert.equal(src?.name, 'github:abheet19/zeno', 'the FEED is named, so "github failed" says which repo');
});

test('githubFromEnv: a malformed repo THROWS rather than silently never asking', () => {
  for (const bad of ['zeno', 'a/b/c', '/zeno', 'abheet19/']) {
    assert.throws(
      () => githubFromEnv({ ZENO_GITHUB_REPO: bad }),
      /ZENO_GITHUB_REPO must be exactly "owner\/repo"/,
      `"${bad}" must not start a daemon that quietly ignores the source you configured`,
    );
  }
});

// ── routing ─────────────────────────────────────────────────────────────────

test('an unsupported method on /work is a legible 404, not a crash', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/work', { method: 'DELETE', headers: headers(h.owner) });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'not-found');
  } finally {
    await h.close();
  }
});
