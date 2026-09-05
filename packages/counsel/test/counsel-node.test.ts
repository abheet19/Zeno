/**
 * The real filesystem behind the archive.
 *
 * The two behaviours worth locking: a missing directory is an empty archive
 * rather than a crash on startup, and a delete really removes the file from
 * disk — the owner deleting a recording of their own voice is not a UI state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Meetings,
  nodeMeetingStore,
  summarize,
  transcriptOf,
  type Meeting,
  type Utterance,
} from '../src/index.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'zeno-counsel-'));
}

const LINES: Utterance[] = [
  { id: 'u1', at: '2026-01-10T10:00:00.000Z', speaker: 'owner', text: "Let's go with Postgres." },
  { id: 'u2', at: '2026-01-10T10:01:00.000Z', speaker: 'other', text: 'Sounds good.' },
];

const M: Meeting = {
  id: 'm-ledger',
  title: 'Ledger storage sync',
  startedAt: '2026-01-10T10:00:00.000Z',
  endedAt: '2026-01-10T10:30:00.000Z',
  participants: ['Abheet'],
  utterances: LINES,
  summary: summarize(transcriptOf(LINES)),
};

test('a missing directory is an empty archive, not a throw', () => {
  const dir = tmp();
  try {
    const store = nodeMeetingStore(join(dir, 'never-created'));
    assert.deepEqual(store.list(), [], 'no meetings recorded yet is a normal state');
    assert.equal(existsSync(join(dir, 'never-created')), false, 'and constructing a store does not touch the disk');
    assert.equal(new Meetings(store).size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a meeting written to disk is a readable .md file, and reads back whole', () => {
  const dir = tmp();
  try {
    const store = nodeMeetingStore(join(dir, 'meetings'));
    new Meetings(store).save(M);

    const files = readdirSync(join(dir, 'meetings'));
    assert.deepEqual(files, ['m-ledger.md'], 'one call, one file, named by its id');
    const raw = readFileSync(join(dir, 'meetings', 'm-ledger.md'), 'utf8');
    assert.match(raw, /^---\n/, 'Markdown with frontmatter — openable in Notepad');
    assert.match(raw, /Let's go with Postgres\./);
    assert.doesNotMatch(raw, /\.tmp/);

    const reloaded = new Meetings(nodeMeetingStore(join(dir, 'meetings')));
    assert.equal(reloaded.get('m-ledger')?.title, 'Ledger storage sync');
    assert.deepEqual(reloaded.failed(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a write leaves no temp file behind, and overwriting is atomic', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    const lib = new Meetings(nodeMeetingStore(meetings));
    lib.save(M);
    lib.save({ ...M, title: 'Ledger storage sync (revised)' });
    assert.deepEqual(readdirSync(meetings), ['m-ledger.md'], 'temp -> rename leaves exactly one file');
    assert.equal(new Meetings(nodeMeetingStore(meetings)).get('m-ledger')?.title, 'Ledger storage sync (revised)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('delete really removes the file from disk', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    const lib = new Meetings(nodeMeetingStore(meetings));
    lib.save(M);
    assert.equal(existsSync(join(meetings, 'm-ledger.md')), true);
    assert.equal(lib.remove('m-ledger'), true);
    assert.equal(existsSync(join(meetings, 'm-ledger.md')), false, 'gone from the disk, not just from the list');
    assert.deepEqual(readdirSync(meetings), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a meeting that is not on disk does not throw', () => {
  const dir = tmp();
  try {
    const store = nodeMeetingStore(join(dir, 'meetings'));
    store.remove('never-existed');
    store.remove('../escape'); // an unsafe id is refused rather than followed
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt file on disk surfaces in failed(), and can then be deleted', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    const store = nodeMeetingStore(meetings);
    new Meetings(store).save(M);
    writeFileSync(join(meetings, 'm-broken.md'), 'half a file that never closed\n', 'utf8');

    const lib = new Meetings(nodeMeetingStore(meetings));
    assert.equal(lib.size(), 1);
    assert.equal(lib.failed().length, 1, 'the corrupt file is reported, never silently skipped');
    assert.equal(lib.failed()[0]?.id, 'm-broken');

    assert.equal(lib.remove('m-broken'), true);
    assert.equal(existsSync(join(meetings, 'm-broken.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-.md file in the folder is ignored, not treated as a broken meeting', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    const store = nodeMeetingStore(meetings);
    new Meetings(store).save(M);
    writeFileSync(join(meetings, 'notes.txt'), 'a scratch file the owner dropped here', 'utf8');
    const lib = new Meetings(nodeMeetingStore(meetings));
    assert.equal(lib.size(), 1);
    assert.deepEqual(lib.failed(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an id that is not a safe filename stem is refused, never written outside the folder', () => {
  const dir = tmp();
  try {
    const store = nodeMeetingStore(join(dir, 'meetings'));
    assert.throws(() => store.write('../../escape', 'x'), /Unsafe meeting id/);
    assert.throws(() => store.read('../../escape'), /Unsafe meeting id/);
    assert.equal(existsSync(join(dir, 'meetings')), false, 'a refused write creates nothing at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * HONEST DEGRADATION — the folder that is THERE and cannot be read.
 *
 * A missing directory is a first run and reads as an empty archive; that is
 * correct and is locked above. The dangerous neighbour is the folder that
 * exists as far as anyone knows and could not be opened: a permission wall, a
 * drive that is not mounted, a file sitting where the folder should be. Those
 * used to be swallowed into the same empty list, so an owner with a hundred
 * recorded calls behind a bad path was told, in the same eight bytes a first
 * run gets, that they had never recorded one.
 */
test('a meetings folder that cannot be READ is never reported as an empty archive', () => {
  const dir = tmp();
  try {
    // A FILE where the folder should be — the shape of a mistyped path or a
    // restored backup. readdir answers ENOTDIR, which is not ENOENT.
    const wrong = join(dir, 'meetings');
    writeFileSync(wrong, 'a file, not a folder', 'utf8');
    const store = nodeMeetingStore(wrong);
    assert.throws(() => store.list(), /ENOTDIR/, 'unreadable is not silently absent');

    const lib = new Meetings(store);
    assert.equal(lib.size(), 0, 'the daemon still boots with nothing loaded');
    assert.equal(lib.unreadable() !== null, true, 'but the archive knows it never read the folder');
    assert.match(lib.unreadable() ?? '', /ENOTDIR/, 'and says why, in the errno the owner can search for');

    // The line the whole lens is about: these two states must not be the same
    // answer. A first run has nothing to report; this one has a reason.
    const firstRun = new Meetings(nodeMeetingStore(join(dir, 'never-created')));
    assert.equal(firstRun.size(), 0);
    assert.equal(firstRun.unreadable(), null, 'never recorded a call is not an error');
    assert.notDeepEqual(
      { size: lib.size(), why: lib.unreadable() },
      { size: firstRun.size(), why: firstRun.unreadable() },
      '"no meetings yet" and "could not read your meetings" are different sentences',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── deletion, when the file is not named after the id ───────────────────────
//
// The archive keys a meeting by the id in its own frontmatter; the disk keys it
// by filename. Those are the same string only for a file Zeno wrote and nobody
// touched — and this format exists precisely so the owner CAN touch it. Every
// test below is a recording the owner asked Zeno to destroy.

test('deleting a RENAMED meeting removes the real file, and never lies about it', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    new Meetings(nodeMeetingStore(meetings)).save(M);
    // What "open it in Notepad, rename it in Explorer" looks like afterwards: the
    // file is now `call-with-priya.md` while its frontmatter still says m-ledger.
    const renamed = join(meetings, 'call-with-priya.md');
    writeFileSync(renamed, readFileSync(join(meetings, 'm-ledger.md'), 'utf8'), 'utf8');
    rmSync(join(meetings, 'm-ledger.md'));

    const lib = new Meetings(nodeMeetingStore(meetings));
    assert.equal(lib.get('m-ledger')?.title, 'Ledger storage sync', 'it is still the same meeting');

    assert.equal(lib.remove('m-ledger'), true);
    assert.equal(existsSync(renamed), false, 'the RECORDING left the disk, not just the list entry');
    assert.deepEqual(readdirSync(meetings), []);
    // The regression this locks: `remove` aimed at `m-ledger.md`, deleted nothing,
    // and still answered true. The owner was told a private call was destroyed
    // while it sat in the folder — and a restart brought it back.
    assert.equal(new Meetings(nodeMeetingStore(meetings)).size(), 0, 'and it stays gone across a restart');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a meeting file with a human name is readable, and can be deleted', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    new Meetings(nodeMeetingStore(meetings)).save(M);
    const human = join(meetings, 'Q3 planning (with Priya).md');
    writeFileSync(human, readFileSync(join(meetings, 'm-ledger.md'), 'utf8').replace('id: m-ledger', 'id: m-q3'), 'utf8');

    const lib = new Meetings(nodeMeetingStore(meetings));
    assert.deepEqual(lib.failed(), [], 'a name a human chose is not a corrupt file');
    assert.equal(lib.get('m-q3')?.title, 'Ledger storage sync', 'it loads like any other call');
    assert.equal(lib.remove('m-q3'), true);
    assert.equal(existsSync(human), false, 'and the owner can destroy it through Zeno, not only in Explorer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a delete the store did not perform is reported as false, never as success', () => {
  const dir = tmp();
  try {
    const store = nodeMeetingStore(join(dir, 'meetings'));
    assert.equal(store.remove('never-existed'), false, 'nothing was there, so nothing was deleted');
    // An id the store will not touch is a refusal, not a deletion. Answering true
    // here is what let the archive say "deleted" about a file it never opened.
    for (const id of ['../escape', String.raw`..\escape`, String.raw`C:\Windows\evil`, '/etc/passwd', '.', '..', '']) {
      assert.equal(store.remove(id), false, `refused, not "deleted": ${JSON.stringify(id)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no meeting id can name a file outside the archive folder', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    mkdirSync(meetings, { recursive: true });
    const outside = join(dir, 'outside.md');
    writeFileSync(outside, 'a file that is none of Zeno\'s business\n', 'utf8');
    const store = nodeMeetingStore(meetings);

    // Traversal in both slashes, an absolute path, a drive letter, a subdirectory,
    // a URL-decoded escape and a NUL. None of them names a file in this folder, so
    // none of them may reach a byte on ANY verb.
    const escapes = [
      '../outside',
      String.raw`..\outside`,
      '../../etc/passwd',
      '/etc/passwd',
      String.raw`C:\Windows\System32\drivers\etc\hosts`,
      decodeURIComponent('..%2F..%2Fetc%2Fpasswd'),
      'sub/dir',
      'nul\u0000byte',
      '.',
      '..',
    ];
    for (const id of escapes) {
      assert.throws(() => store.read(id), /Unsafe meeting id/, `read refused: ${JSON.stringify(id)}`);
      assert.equal(store.remove(id), false, `remove refused: ${JSON.stringify(id)}`);
      assert.throws(() => store.write(id, 'x'), /Unsafe meeting id/, `write refused: ${JSON.stringify(id)}`);
    }

    // These DO name a file in this folder — a trailing dot, a name with a space,
    // an over-long stem. Reading and deleting them is the anti-lock-in promise
    // (the owner may rename their own recordings in Explorer), but Zeno never
    // CHOOSES such a name, so writing one is still refused.
    for (const id of ['trailing.', 'my call', 'a'.repeat(65)]) {
      assert.throws(() => store.write(id, 'x'), /Unsafe meeting id/, `Zeno never writes: ${JSON.stringify(id)}`);
      assert.equal(store.remove(id), false, `nothing there to delete: ${JSON.stringify(id)}`);
    }

    // A Windows device name is a filename here, never a handle to the console:
    // it is refused nothing and reaches nothing, because the jail is the folder.
    assert.equal(store.remove('CON'), false, 'a reserved name has no file here either');

    assert.equal(existsSync(outside), true, 'the file one directory up is untouched');
    assert.deepEqual(readdirSync(meetings), [], 'and nothing was created inside either');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the copy nobody could see ───────────────────────────────────────────────

test('a write that fails takes its temp file — and the whole transcript in it — with it', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    mkdirSync(meetings, { recursive: true });
    // A directory sitting where the meeting file goes makes the rename fail. Any
    // mid-write failure does; this one is just reproducible.
    mkdirSync(join(meetings, 'm-ledger.md'));
    const store = nodeMeetingStore(meetings);
    assert.throws(() => store.write('m-ledger', 'EVERY WORD SPOKEN, unredacted\n'));

    const left = readdirSync(meetings).filter((n) => n.endsWith('.tmp'));
    // The temp file held the complete transcript, `list()` cannot see it (it is
    // not a .md), the dashboard never showed it and `remove` was never asked
    // about it. A failed save used to leave that copy on disk forever.
    assert.deepEqual(left, [], 'a failed write leaves no unreachable copy of the call behind');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a meeting also destroys any half-written temp copy of it', () => {
  const dir = tmp();
  try {
    const meetings = join(dir, 'meetings');
    const lib = new Meetings(nodeMeetingStore(meetings));
    lib.save(M);
    // What a crash mid-write leaves behind: a complete transcript under a name
    // nothing lists. Deleting the recording has to mean this too.
    const orphan = join(meetings, 'm-ledger.md.deadbeef.tmp');
    writeFileSync(orphan, readFileSync(join(meetings, 'm-ledger.md'), 'utf8'), 'utf8');

    assert.equal(lib.remove('m-ledger'), true);
    assert.equal(existsSync(orphan), false, 'no copy of the call survives the delete');
    assert.deepEqual(readdirSync(meetings), [], 'the folder is empty, not "empty except one file"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
