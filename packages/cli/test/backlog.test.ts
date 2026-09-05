/**
 * `zeno backlog` — the surfaces the owner actually reads.
 *
 * The interesting claims are not "add then list". They are: a closed item leaves
 * the list without leaving the record, and a file the parser could only partly
 * read produces a SHORTER LIST THAT SAYS SO. A short list that says nothing is
 * the failure this whole build exists to stop, and on a CLI the renderer is the
 * last place it can happen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backlogPathIn } from '@abheet19/zeno-intake';
import { backlogView, openBacklog, renderAdded, renderBacklog, renderClosed } from '../src/backlog.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'zeno-cli-backlog-'));
}

/** Collect what the command would print, as one string. */
function capture(): { log: (s: string) => void; out: () => string } {
  const lines: string[] = [];
  return { log: (s) => void lines.push(s), out: () => lines.join('\n') };
}

test('add, list, close — and the closed item leaves the list, not the record', () => {
  const dir = tempDir();
  try {
    const opened = openBacklog(dir);
    const added = opened.backlog.add('Rewrite the intake trigger', 'Jira is gone; the port is not.', ['intake']);
    opened.backlog.add('Write the README');
    assert.equal(added.id, 'local:1');

    const open = capture();
    renderBacklog(backlogView(opened, false), open.log);
    assert.match(open.out(), /local:1\s+open\s+Rewrite the intake trigger\s+\[intake\]/);
    assert.match(open.out(), /2 open of 2/);

    opened.backlog.close('2'); // the bare number a human types
    const after = capture();
    renderBacklog(backlogView(opened, false), after.log);
    assert.doesNotMatch(after.out(), /Write the README/, 'a closed item is a record, not a request');
    assert.match(after.out(), /1 open of 2/);

    const all = capture();
    renderBacklog(backlogView(opened, true), all.log);
    assert.match(all.out(), /local:2\s+closed\s+Write the README/);
    assert.match(all.out(), /1 open · 1 closed/);

    // Three revisions on disk: two adds and a close. Nothing was removed.
    const raw = readFileSync(backlogPathIn(dir), 'utf8').trim().split('\n');
    assert.equal(raw.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the renderers say what happened, including when nothing happened', () => {
  const dir = tempDir();
  try {
    const opened = openBacklog(dir);
    const entry = opened.backlog.add('Ship the WorkItem port', '', ['intake', 'p1']);

    const add = capture();
    renderAdded(entry, opened.path, add.log);
    assert.match(add.out(), /ADDED\s+local:1 — "Ship the WorkItem port" \[intake, p1\]/);
    assert.match(add.out(), /backlog\.jsonl/, 'the owner is told which file changed');

    const closed = capture();
    renderClosed(opened.backlog.close('local:1'), false, closed.log);
    assert.match(closed.out(), /CLOSED/);
    assert.match(closed.out(), /Nothing was deleted/);

    // Closing a closed item writes NOTHING — a revision that changed only
    // updatedAt would wake every downstream poller for an item that did not move.
    const before = readFileSync(backlogPathIn(dir), 'utf8');
    const again = capture();
    renderClosed(opened.backlog.close('local:1'), true, again.log);
    assert.match(again.out(), /ALREADY CLOSED/);
    assert.match(again.out(), /Nothing was written/);
    assert.equal(readFileSync(backlogPathIn(dir), 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty backlog says how to start, rather than showing an empty table', () => {
  const dir = tempDir();
  try {
    const c = capture();
    renderBacklog(backlogView(openBacklog(dir), false), c.log);
    assert.match(c.out(), /nothing yet/);
    assert.match(c.out(), /zeno backlog add/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file NOTHING could be read from must not be greeted as an empty backlog', () => {
  const dir = tempDir();
  try {
    // Every line rejected: an encoding accident, a truncated restore, a file
    // that was never a backlog. "nothing yet — add something" is a claim about
    // the backlog, and this command has no grounds to make it.
    writeFileSync(backlogPathIn(dir), 'not json at all\nnor is this\n', 'utf8');

    const c = capture();
    const view = backlogView(openBacklog(dir), false);
    renderBacklog(view, c.log);

    assert.equal(view.skipped, 2);
    assert.equal(view.total, 0);
    assert.doesNotMatch(c.out(), /nothing yet/, '"nothing yet" is what an EMPTY backlog says');
    assert.match(c.out(), /not the same as an empty backlog/);
    assert.match(c.out(), /2 lines could not be read/, 'and the count is still there');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('INTERRUPTED — a torn line costs one item, and the listing SAYS so', () => {
  const dir = tempDir();
  try {
    const first = openBacklog(dir);
    first.backlog.add('one');
    first.backlog.add('two');
    // Exactly what a crash mid-append leaves: half a record, no newline.
    appendFileSync(backlogPathIn(dir), '{"id":"local:3","seq":3,"title":"th', 'utf8');

    const c = capture();
    const view = backlogView(openBacklog(dir), false);
    renderBacklog(view, c.log);

    assert.equal(view.skipped, 1);
    assert.equal(view.total, 2, 'the torn record is not an item');
    assert.match(c.out(), /1 line could not be read/);
    assert.match(c.out(), /still in the file/, 'reporting damage is not repairing it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a hand-edited title cannot break the one-line contract of a row', () => {
  const dir = tempDir();
  try {
    const opened = openBacklog(dir);
    // Someone pasted a multi-line title, with a bidi override for good measure.
    opened.backlog.add('first line\nsecond line‮gnihtemos');

    const c = capture();
    renderBacklog(backlogView(opened, false), c.log);
    const out = c.out();

    // ASSERT ON THE WHOLE LISTING, not on the lines that happen to mention the
    // id. Selecting rows with `includes('local:1')` reads only the FIRST
    // physical line of a row that spilled — so filtering first and then checking
    // that one line made both of the original assertions satisfiable by exactly
    // the bug they were written to catch: drop `oneLine` from the renderer and
    // the tail of the title, override included, simply moves onto a line the
    // filter has already discarded, leaving one clean row and a green test.
    assert.doesNotMatch(out, /‮/, 'no bidi override reaches the listing, on any line of it');
    assert.equal(
      out.split('\n').filter((l) => l.includes('second line')).length,
      1,
      'the tail of the title is on one line, and it is the row — not a stray line below it',
    );

    const rows = out.split('\n').filter((l) => l.includes('local:1'));
    assert.equal(rows.length, 1, 'one item is one row, whatever its title contains');
    assert.ok(
      (rows[0] ?? '').includes('first line second line'),
      `the whole title is on the row, collapsed onto one line: ${JSON.stringify(rows[0])}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FAILURE — an unreadable backlog throws with its path, never reads as empty', () => {
  const dir = tempDir();
  try {
    // A directory where the file should be: readFileSync gives EISDIR, and
    // presenting that as an empty backlog would let the next add write over it.
    mkdirSync(backlogPathIn(dir));
    assert.throws(() => openBacklog(dir), (err: unknown) => {
      const message = (err as Error).message;
      assert.match(message, /Cannot read the backlog at/);
      assert.ok(message.includes('backlog.jsonl'), 'the message names the file to go and look at');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a backlog written by another process is picked up on the next read', () => {
  const dir = tempDir();
  try {
    const opened = openBacklog(dir);
    opened.backlog.add('mine');
    // The daemon, in the other window, appending its own revision.
    const line = JSON.stringify({
      id: 'local:2',
      seq: 2,
      title: 'from the daemon',
      body: '',
      labels: [],
      state: 'open',
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    writeFileSync(backlogPathIn(dir), readFileSync(backlogPathIn(dir), 'utf8') + line + '\n', 'utf8');

    const view = backlogView(openBacklog(dir), false);
    assert.deepEqual(view.rows.map((e) => e.id), ['local:1', 'local:2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
