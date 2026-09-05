/**
 * The local backlog: the trigger that no employer can switch off.
 *
 * Covers the ordinary operations, then the three things that actually decide
 * whether this is a RECORD or just a file — ids that never move, a failed write
 * that changes nothing, and an interrupted write that loses nothing.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Backlog, foldBacklog, localSource, parseBacklog, toWorkItem } from '../src/backlog.js';
import type { BacklogEntry, BacklogStore, Clock } from '../src/backlog.js';
import { backlogPath, nodeBacklogStore, systemClock } from '../src/backlog-node-fs.js';
import { dedupe } from '../src/work-item.js';

/** An in-memory store honouring the same contract as the node:fs one. */
function memStore(seed = ''): BacklogStore & {
  text(): string;
  set(t: string): void;
  fail(err: Error | null): void;
} {
  let text = seed;
  let failure: Error | null = null;
  return {
    readAll: () => text,
    writeAll: (t) => {
      if (failure !== null) throw failure;
      text = t;
    },
    text: () => text,
    set: (t) => {
      text = t;
    },
    fail: (err) => {
      failure = err;
    },
  };
}

/** A deterministic clock: one second per call, so `updatedAt` is predictable. */
function clock(startMs = Date.UTC(2026, 8, 4, 9, 0, 0)): Clock {
  let n = 0;
  return () => new Date(startMs + n++ * 1000).toISOString();
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** One valid line, written by hand so the parser is tested against real bytes. */
function line(over: Partial<BacklogEntry> & { seq: number }): string {
  const seq = over.seq;
  const entry: BacklogEntry = {
    id: `local:${seq}`,
    title: `item ${seq}`,
    body: '',
    labels: [],
    state: 'open',
    createdAt: '2026-09-04T09:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
    ...over,
  };
  return JSON.stringify(entry);
}

const roots: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-backlog-'));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

// ─── the ordinary operations ────────────────────────────────────────────────

test('add then list: sequential ids, open state, newest last', () => {
  const store = memStore();
  const b = new Backlog(store, clock());

  const first = b.add('Fix the flaky login test', 'one run in five', ['bug', 'ci']);
  const second = b.add('Write the README');

  assert.equal(first.id, 'local:1');
  assert.equal(second.id, 'local:2');
  assert.deepEqual(
    b.list().map((e) => e.id),
    ['local:1', 'local:2'],
  );
  assert.equal(first.state, 'open');
  assert.deepEqual(first.labels, ['bug', 'ci']);
  assert.equal(first.body, 'one run in five');
  assert.equal(second.body, '', 'body is optional');
  assert.equal(first.createdAt, first.updatedAt, 'a new item has never been touched');
  assert.equal(lines(store.text()).length, 2, 'one line per revision');
});

test('add refuses an untitled item — it could never be shown in a capsule', () => {
  const store = memStore();
  const b = new Backlog(store, clock());
  assert.throws(() => b.add('   '), /needs a title/);
  assert.equal(b.list().length, 0);
  assert.equal(store.text(), '', 'and nothing was written');
});

test('add normalizes labels: trimmed, de-duplicated, blanks dropped', () => {
  const b = new Backlog(memStore(), clock());
  assert.deepEqual(b.add('t', '', ['  bug ', 'bug', '', '   ', 'ui']).labels, ['bug', 'ui']);
});

test('get accepts the canonical id or the number a human types', () => {
  const b = new Backlog(memStore(), clock());
  b.add('one');
  b.add('two');
  assert.equal(b.get('local:2')?.title, 'two');
  assert.equal(b.get('2')?.title, 'two');
  assert.equal(b.get(' 2 ')?.title, 'two');
  assert.equal(b.get('local:99'), null, 'a miss is null, not a throw');
  assert.equal(b.get('nonsense'), null);
});

test('close MARKS, it never deletes — the open revision is still in the file', () => {
  const store = memStore();
  const b = new Backlog(store, clock());
  b.add('Fix the flaky login test');
  const openLine = store.text();

  const closed = b.close('local:1');
  assert.equal(closed.state, 'closed');
  assert.notEqual(closed.updatedAt, closed.createdAt, 'closing is an event with a time');

  assert.equal(lines(store.text()).length, 2, 'a revision was APPENDED, not overwritten');
  assert.ok(store.text().startsWith(openLine), 'the earlier bytes are untouched');
  assert.deepEqual(b.listOpen(), [], 'it is gone from the work the port publishes');
  assert.equal(b.list().length, 1, 'but it is still in the record');
  assert.equal(b.get('local:1')?.state, 'closed');
});

test('reopen puts it back, and both transitions are idempotent', () => {
  const store = memStore();
  const b = new Backlog(store, clock());
  b.add('Fix the flaky login test');
  b.close('1');

  const afterClose = store.text();
  assert.equal(b.close('1').state, 'closed');
  assert.equal(store.text(), afterClose, 'closing a closed item writes nothing at all');

  const reopened = b.reopen('1');
  assert.equal(reopened.state, 'open');
  assert.equal(b.listOpen().length, 1);
  assert.equal(lines(store.text()).length, 3);

  const afterReopen = store.text();
  assert.equal(b.reopen('1').state, 'open');
  assert.equal(store.text(), afterReopen, 'and neither does reopening an open one');
});

test('close on an unknown id throws, and says which id', () => {
  const b = new Backlog(memStore(), clock());
  assert.throws(() => b.close('7'), /no backlog item local:7/);
  assert.throws(() => b.reopen('local:7'), /no backlog item local:7/);
});

// ─── ids that never move ────────────────────────────────────────────────────

test('ids are STABLE across a reload, and are never reused', () => {
  const store = memStore();
  const first = new Backlog(store, clock());
  first.add('one');
  first.add('two');
  first.close('local:1');

  // the process dies; a brand-new Backlog over the same bytes is the restart
  const second = new Backlog(store, clock(Date.UTC(2026, 8, 5)));
  assert.deepEqual(
    second.list().map((e) => `${e.id}:${e.state}`),
    ['local:1:closed', 'local:2:open'],
    'the same items, the same ids, the same states',
  );

  const third = second.add('three');
  assert.equal(third.id, 'local:3', 'the next id follows the highest EVER used');

  // ...even though local:1 is closed and could have been "recycled".
  const afterRestart = new Backlog(store, clock());
  assert.equal(afterRestart.add('four').id, 'local:4');
});

test('a WorkItem projection is stable and points nowhere a human cannot follow', () => {
  const b = new Backlog(memStore(), clock());
  const entry = b.add('Fix the flaky login test', 'body', ['bug']);
  const wi = toWorkItem(entry);
  assert.equal(wi.id, 'local:1');
  assert.equal(wi.source, 'local');
  assert.equal(wi.url, null, 'a local item has nowhere to link to, and says so');
  assert.equal(wi.updatedAt, entry.updatedAt);
  assert.deepEqual(wi.labels, ['bug']);
});

// ─── the source, and dedupe over it ─────────────────────────────────────────

test('localSource publishes only OPEN items and re-reads on every poll', async () => {
  const store = memStore();
  const b = new Backlog(store, clock());
  b.add('one');
  b.add('two');
  const source = localSource(b);

  assert.equal(source.name, 'local');
  assert.deepEqual((await source.list()).map((w) => w.id), ['local:1', 'local:2']);

  b.close('local:1');
  assert.deepEqual((await source.list()).map((w) => w.id), ['local:2']);

  // another window appends a line; the next poll must see it
  store.set(store.text() + line({ seq: 3, title: 'edited in by hand' }) + '\n');
  assert.deepEqual((await source.list()).map((w) => w.id), ['local:2', 'local:3']);
});

test('polling twice proposes nothing twice', async () => {
  const b = new Backlog(memStore(), clock());
  b.add('one');
  const source = localSource(b);

  const first = dedupe(await source.list());
  assert.equal(first.fresh.length, 1);

  const second = dedupe(await source.list(), first.seen);
  assert.deepEqual(second.fresh, [], 'an unchanged backlog is a quiet backlog');

  b.add('two');
  const third = dedupe(await source.list(), second.seen);
  assert.deepEqual(third.fresh.map((w) => w.id), ['local:2'], 'only the new item');
});

test('FAILURE — localSource REJECTS, it never throws synchronously', async () => {
  // The port declares `list(): Promise<...>`. A synchronous throw from it walks
  // straight past `.catch()` and `Promise.allSettled`, so one locked file would
  // take down a whole multi-source fan-out instead of degrading to one failed
  // source — and the GitHub adapter, being async, already fails the other way.
  let broken = false;
  const store: BacklogStore = {
    readAll: () => {
      if (broken) throw new Error('EBUSY: resource busy or locked');
      return '';
    },
    writeAll: () => {},
  };
  const source = localSource(new Backlog(store, clock()));
  broken = true;

  const settled = await Promise.allSettled([source.list()]);
  assert.equal(settled[0]?.status, 'rejected', 'the fan-out survives to report it');
  await assert.rejects(source.list(), /EBUSY/, 'and the reason still names the real cause');
});

// ─── damage: skipped, never fatal ───────────────────────────────────────────

test('a corrupt line is SKIPPED, counted, and the rest still loads', () => {
  const text = [
    line({ seq: 1 }),
    'this is not json at all',
    line({ seq: 2, title: 'still fine' }),
    'null',
    '42',
    '[]',
    JSON.stringify({ id: 'local:9', seq: 3, title: 't' }), // half a record
    JSON.stringify({ ...JSON.parse(line({ seq: 4 })), id: 'local:99' }), // id disagrees with seq
    '',
    line({ seq: 5, title: 'last one' }),
  ].join('\n');

  const parsed = parseBacklog(text);
  assert.deepEqual(parsed.revisions.map((r) => r.seq), [1, 2, 5]);
  assert.equal(parsed.skipped, 6, 'every unreadable line is counted, none is fatal');

  const b = new Backlog(memStore(text), clock());
  assert.equal(b.skippedLines(), 6);
  assert.deepEqual(b.list().map((e) => e.id), ['local:1', 'local:2', 'local:5']);
});

test('a write CARRIES corrupt lines through — a parser bug must not eat a record', () => {
  const garbage = 'this is not json at all';
  const store = memStore(line({ seq: 1 }) + '\n' + garbage + '\n');
  const b = new Backlog(store, clock());
  b.add('a new item');

  assert.ok(store.text().includes(garbage), 'the line we could not read is still there');
  assert.equal(b.add('another').id, 'local:3', 'and ids continue from the readable maximum');
});

/**
 * THE ID A DAMAGED LINE STILL HOLDS.
 *
 * `reload` promises "the highest seq EVER written… ids must never be reused".
 * Derived from readable revisions alone that promise breaks exactly when it
 * matters: an interrupted append leaves a torn line, the seq it carried becomes
 * invisible, and the next `add` hands the SAME id to a completely different
 * item — while the file still holds a record under it. Two items, one id, in
 * one file, and a fold that will happily merge their histories.
 *
 * This is the interrupted path for identity, as opposed to for content, which
 * the test above it covers.
 */
test('INTERRUPTED — a torn line keeps its id; the next add does not reuse it', () => {
  // Written the way `append` writes it: id first, seq second. A tear anywhere
  // after those two still leaves the number legible, which is the whole reason
  // recovery is possible at all.
  const real = (seq: number, title: string): string =>
    JSON.stringify({
      id: `local:${seq}`,
      seq,
      title,
      body: '',
      labels: [],
      state: 'open',
      createdAt: '2026-09-04T09:00:00.000Z',
      updatedAt: '2026-09-04T09:00:00.000Z',
    });

  const whole = `${real(1, 'one')}\n${real(2, 'two')}\n`;
  const torn = whole.slice(0, whole.length - 40); // a crash mid-append
  assert.ok(torn.includes('"seq":2'), 'the torn line still says which id it was');
  assert.equal(torn.endsWith('\n'), false, 'and it is genuinely unterminated');

  const store = memStore(torn);
  const b = new Backlog(store, clock());
  assert.equal(b.skippedLines(), 1);
  assert.deepEqual(b.list().map((e) => e.id), ['local:1'], 'the torn item is lost, as it must be');

  const next = b.add('a completely different item');
  assert.equal(next.id, 'local:3', 'local:2 is spent — a damaged line still spent it');
  assert.equal(
    store.text().split('"id":"local:2"').length - 1,
    1,
    'local:2 names exactly one record, and it is the torn one',
  );
});

test('INTERRUPTED — an id recovered even when the tear took the seq field with it', () => {
  // The other recovery route. `line()` here serialises seq LAST, so cutting the
  // tail removes "seq" entirely and only the leading "id":"local:2" survives.
  const whole = [line({ seq: 1 }), line({ seq: 2 })].join('\n') + '\n';
  const torn = whole.slice(0, whole.length - 40);
  assert.equal(torn.includes('"seq":2'), false, 'the seq field is gone');
  assert.ok(torn.includes('"id":"local:2"'), 'but the id is still there to be read');

  const b = new Backlog(memStore(torn), clock());
  assert.equal(b.add('a completely different item').id, 'local:3', 'the id is still spent');
});

/**
 * The recovery route the other two miss: the id field is the casualty.
 *
 * `claimedSeq` reads BOTH `"id"` and `"seq"` because a line may have been
 * mangled across either one — but every damaged line elsewhere in this file
 * still carries a readable `"id":"local:N"`, so the `"seq"` pattern is never
 * once load-bearing. Delete it from the adapter and the whole suite stays green,
 * while a line whose id was the part that broke hands its number straight back
 * to the next `add`, under a record the file still holds.
 */
test('INTERRUPTED — a line whose ID is the mangled part still spends its number', () => {
  const mangled = JSON.stringify({
    id: 'lokal:5', // a hand-edit, an encoding accident, a tear that landed here
    seq: 5,
    title: 'the id is wrong, the number is not',
    body: '',
    labels: [],
    state: 'open',
    createdAt: '2026-09-04T09:00:00.000Z',
    updatedAt: '2026-09-04T09:00:00.000Z',
  });

  const b = new Backlog(memStore(`${line({ seq: 1 })}\n${mangled}\n`), clock());
  assert.equal(b.skippedLines(), 1, 'an id that disagrees with its seq is damage, not an item');
  assert.deepEqual(b.list().map((e) => e.id), ['local:1']);
  assert.equal(b.add('a completely different item').id, 'local:6', 'local:5 was handed out and stays handed out');
});

test('a damaged line that names a HIGH id still reserves it', () => {
  // The same rule from the other end: an id-vs-seq mismatch is unreadable, but
  // whatever number it claims has been handed out and must not come round again.
  const store = memStore(line({ seq: 1 }) + '\n' + JSON.stringify({ ...JSON.parse(line({ seq: 9 })), id: 'local:99' }) + '\n');
  const b = new Backlog(store, clock());
  assert.equal(b.skippedLines(), 1);
  assert.deepEqual(b.list().map((e) => e.id), ['local:1'], 'the mismatched line is not an item');
  assert.equal(b.add('next').id, 'local:100', 'the highest number any line claims is the one to beat');
});

test('parseBacklog reports the highest seq it saw, readable or not', () => {
  assert.equal(parseBacklog('').highestSeq, 0, 'an empty file has handed out nothing');
  assert.equal(parseBacklog(line({ seq: 4 })).highestSeq, 4);
  assert.equal(
    parseBacklog(line({ seq: 4 }) + '\n{"id":"local:7","seq":7,"tit').highestSeq,
    7,
    'a torn line counts',
  );
  assert.equal(parseBacklog('total nonsense').highestSeq, 0, 'a line claiming nothing reserves nothing');
});

test('INTERRUPTED — a half-written last line costs that revision and nothing else', () => {
  const whole = [line({ seq: 1 }), line({ seq: 1, state: 'closed', updatedAt: 'T2' })].join('\n');
  const torn = whole.slice(0, whole.length - 12); // the close revision is cut off

  const b = new Backlog(memStore(torn), clock());
  assert.equal(b.skippedLines(), 1, 'the torn line is reported');
  assert.equal(b.get('local:1')?.state, 'open', 'the last COMPLETE revision wins');
  assert.equal(b.list().length, 1, 'and the item itself survives');
});

test('CRLF and a BOM load correctly (this is a Windows-first product)', () => {
  const bom = String.fromCharCode(0xfeff);
  const text = bom + [line({ seq: 1 }), line({ seq: 2 })].join('\r\n') + '\r\n';
  const b = new Backlog(memStore(text), clock());
  assert.equal(b.skippedLines(), 0, 'a BOM is the file speaking, not a damaged record');
  assert.deepEqual(b.list().map((e) => e.id), ['local:1', 'local:2']);
});

test('foldBacklog keeps the last revision per id, in id order', () => {
  const revs = parseBacklog(
    [
      line({ seq: 2 }),
      line({ seq: 1 }),
      line({ seq: 2, state: 'closed', title: 'renamed' }),
    ].join('\n'),
  ).revisions;
  const folded = foldBacklog(revs);
  assert.deepEqual(folded.map((e) => e.id), ['local:1', 'local:2']);
  assert.equal(folded[1]!.state, 'closed');
  assert.equal(folded[1]!.title, 'renamed');
});

// ─── the failure path ───────────────────────────────────────────────────────

test('FAILURE — a store that throws leaves the backlog exactly as it was', () => {
  const store = memStore();
  const b = new Backlog(store, clock());

  store.fail(new Error('ENOSPC: no space left on device'));
  assert.throws(() => b.add('the item that could not be saved'), /ENOSPC/);

  assert.deepEqual(b.list(), [], 'nothing entered memory that is not on disk');
  assert.equal(store.text(), '', 'and nothing reached the store');

  // the sequence number was not burned either — the next add is still local:1
  store.fail(null);
  assert.equal(b.add('the item that could').id, 'local:1');
  assert.equal(b.list().length, 1);
});

test('FAILURE — a failed close leaves the item open, in memory and on disk', () => {
  const store = memStore();
  const b = new Backlog(store, clock());
  b.add('one');
  const before = store.text();

  store.fail(new Error('EACCES: permission denied'));
  assert.throws(() => b.close('1'), /EACCES/);

  assert.equal(b.get('local:1')?.state, 'open', 'the owner is not told it closed');
  assert.equal(store.text(), before);
  assert.equal(b.listOpen().length, 1);
});

test('FAILURE — a store that cannot be READ is not mistaken for an empty backlog', () => {
  const store: BacklogStore = {
    readAll: () => {
      throw new Error('EBUSY: resource busy or locked');
    },
    writeAll: () => {
      throw new Error('should never be reached');
    },
  };
  // Constructing must fail loudly. Swallowing this would present an empty
  // backlog, and the next add would replace a real file with one line.
  assert.throws(() => new Backlog(store, clock()), /EBUSY/);
});

// ─── the real filesystem ────────────────────────────────────────────────────

test('REAL FS — items survive a process restart through an actual file', () => {
  const root = tempRoot();
  const path = backlogPath(root);
  assert.ok(path.endsWith(join('.zeno', 'backlog.jsonl')));

  const first = new Backlog(nodeBacklogStore(path), clock());
  first.add('Fix the flaky login test', 'one run in five', ['bug']);
  first.add('Write the README');
  first.close('local:2');

  const onDisk = readFileSync(path, 'utf8');
  assert.equal(lines(onDisk).length, 3, 'two adds and a close');

  const second = new Backlog(nodeBacklogStore(path), clock());
  assert.deepEqual(second.list().map((e) => `${e.id}:${e.state}`), ['local:1:open', 'local:2:closed']);
  assert.equal(second.add('a third').id, 'local:3');
  assert.equal(lines(readFileSync(path, 'utf8')).length, 4);
});

test('REAL FS — a missing backlog reads as empty, not as an error', () => {
  const store = nodeBacklogStore(join(tempRoot(), 'nope', 'backlog.jsonl'));
  assert.equal(store.readAll(), '');
  assert.equal(new Backlog(store, clock()).list().length, 0);
});

test('REAL FS — the write is atomic: no temp file survives a success', () => {
  const root = tempRoot();
  const dir = join(root, '.zeno');
  const b = new Backlog(nodeBacklogStore(backlogPath(root)), clock());
  b.add('one');
  b.add('two');
  assert.deepEqual(readdirSync(dir), ['backlog.jsonl'], 'the directory holds one file, not litter');
});

test('REAL FS INTERRUPTED — a temp file left by a crash is ignored, not merged', () => {
  const root = tempRoot();
  const path = backlogPath(root);
  const b = new Backlog(nodeBacklogStore(path), clock());
  b.add('one');
  const good = readFileSync(path, 'utf8');

  // Exactly what a crash between the temp write and the rename leaves behind.
  writeFileSync(`${path}.deadbeef.tmp`, line({ seq: 99, title: 'never committed' }) + '\n', 'utf8');

  const reloaded = new Backlog(nodeBacklogStore(path), clock());
  assert.deepEqual(reloaded.list().map((e) => e.id), ['local:1'], 'the orphan is not part of the record');
  assert.equal(readFileSync(path, 'utf8'), good, 'and the committed file is byte-identical');

  assert.equal(reloaded.add('two').id, 'local:2', 'the next write still commits normally');
  assert.equal(lines(readFileSync(path, 'utf8')).length, 2);
});

test('REAL FS FAILURE — a rename that cannot commit cleans up after itself', () => {
  const root = tempRoot();
  const path = join(root, 'occupied');
  mkdirSync(path); // the destination is a directory: the rename cannot succeed

  assert.throws(() => nodeBacklogStore(path).writeAll('anything'));
  assert.deepEqual(readdirSync(root), ['occupied'], 'the temp file was removed, not abandoned');
});

test('REAL FS — a replace is whole-file: the previous contents never half-survive', () => {
  const root = tempRoot();
  const path = join(root, 'backlog.jsonl');
  const store = nodeBacklogStore(path);
  store.writeAll(line({ seq: 1, title: 'a much much much longer first version' }) + '\n');
  store.writeAll(line({ seq: 2, title: 'short' }) + '\n');

  const text = readFileSync(path, 'utf8');
  assert.equal(lines(text).length, 1);
  assert.equal(text.includes('much much much'), false, 'no tail of the old file remains');
});

test('systemClock returns a parseable ISO-8601 instant', () => {
  const at = systemClock();
  assert.equal(at, new Date(at).toISOString(), 'round-trips, so it is a real timestamp');
});
