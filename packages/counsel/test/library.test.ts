/**
 * The archive.
 *
 * The invariant that matters most here is negative: an unreadable meeting file
 * is NEVER silently dropped. An empty archive and a broken one are different
 * facts about the owner's own life, and an archive that reports "no meetings"
 * while sitting on a corrupt file is lying by omission.
 *
 * The second is that recall explains itself — every hit carries the terms that
 * matched and the transcript lines they matched in, so a result is inspectable
 * rather than a black box.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Meetings,
  serializeMeeting,
  summarize,
  transcriptOf,
  type Meeting,
  type MeetingStore,
  type Speaker,
  type Utterance,
} from '../src/index.js';

/** An in-memory store — the same shape the node one implements, without a disk. */
function memStore(seed: Record<string, string> = {}): MeetingStore & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    list: () => [...files.keys()],
    read: (id) => {
      const t = files.get(id);
      if (t === undefined) throw new Error(`no such meeting: ${id}`);
      return t;
    },
    write: (id, text) => void files.set(id, text),
    remove: (id) => files.delete(id),
  };
}

let seq = 0;
function u(speaker: Speaker, text: string): Utterance {
  const n = seq++;
  return { id: `u${n}`, at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(), speaker, text };
}

function meeting(id: string, title: string, startedAt: string, lines: Utterance[], participants: string[] = []): Meeting {
  return {
    id,
    title,
    startedAt,
    endedAt: startedAt,
    participants,
    utterances: lines,
    summary: summarize(transcriptOf(lines)),
  };
}

const LEDGER = meeting(
  'm-ledger',
  'Ledger storage sync',
  '2026-01-10T10:00:00.000Z',
  [
    u('owner', "Let's go with Postgres for the ledger."),
    u('other', 'Sounds good.'),
    u('owner', "I'll write the migration plan by Friday."),
  ],
  ['Abheet', 'Sarah'],
);

const HIRING = meeting(
  'm-hiring',
  'Hiring loop review',
  '2026-01-14T10:00:00.000Z',
  [u('other', 'What is the headcount budget?'), u('owner', 'Two engineers this quarter.')],
  ['Abheet', 'Priya'],
);

test('an empty archive is empty, and says nothing failed', () => {
  const lib = new Meetings(memStore());
  assert.deepEqual(lib.all(), []);
  assert.deepEqual(lib.failed(), []);
  assert.equal(lib.size(), 0);
});

test('save writes through to the store, and a reload sees the same meeting', () => {
  const store = memStore();
  const lib = new Meetings(store);
  lib.save(LEDGER);
  assert.equal(store.files.size, 1, 'it reached the store, not just memory');

  const reloaded = new Meetings(store);
  assert.equal(reloaded.size(), 1);
  assert.equal(reloaded.get('m-ledger')?.title, 'Ledger storage sync');
  assert.deepEqual(reloaded.failed(), []);
});

test('all() is newest first', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  lib.save(HIRING);
  assert.deepEqual(lib.all().map((m) => m.id), ['m-hiring', 'm-ledger']);
});

// ── the failure list: an unreadable file is a fact, not a silence ────────────

test('a malformed file lands in failed() and is NEVER silently dropped', () => {
  const store = memStore({
    'm-ledger': serializeMeeting(LEDGER),
    'm-broken': 'this file is not a meeting at all',
  });
  const lib = new Meetings(store);

  assert.equal(lib.size(), 1, 'the good meeting still loads');
  const failed = lib.failed();
  assert.equal(failed.length, 1, 'and the bad one is reported, not discarded');
  assert.equal(failed[0]?.id, 'm-broken');
  assert.ok((failed[0]?.reason ?? '').length > 0, 'the failure says why, in words the owner can read');
});

test('an empty archive and an unreadable one are distinguishable', () => {
  const empty = new Meetings(memStore());
  const broken = new Meetings(memStore({ 'x': '---\nid: x\n' }));
  assert.equal(empty.all().length, 0);
  assert.equal(broken.all().length, 0);
  assert.equal(empty.failed().length, 0);
  assert.equal(broken.failed().length, 1, 'same visible archive, different reported fact');
});

test('a file the store cannot even read is a failure, not a crash', () => {
  const store: MeetingStore = {
    list: () => ['unreadable'],
    read: () => {
      throw new Error('EACCES: permission denied');
    },
    write: () => {},
    remove: () => false,
  };
  const lib = new Meetings(store);
  assert.equal(lib.size(), 0);
  assert.match(lib.failed()[0]?.reason ?? '', /Could not be read: EACCES/);
});

test('a store that cannot be listed at all still lets the daemon boot — and says so', () => {
  const store: MeetingStore = {
    list: () => {
      throw new Error('the drive is not mounted');
    },
    read: () => '',
    write: () => {},
    remove: () => false,
  };
  const lib = new Meetings(store);
  assert.equal(lib.size(), 0);
  // No FILE failed, because no file was ever reached — that is a different fact
  // from the corrupt-file case and it keeps its own channel.
  assert.deepEqual(lib.failed(), []);
  // But an empty archive with a reason is not an empty archive. Booting quietly
  // to zero here would tell an owner with a hundred calls on an unmounted drive
  // that they have never recorded one.
  assert.equal(lib.unreadable(), 'the drive is not mounted');
});

test('an archive that WAS read reports no reason — the empty and the unread are distinguishable', () => {
  const empty = new Meetings(memStore());
  assert.equal(empty.size(), 0);
  assert.deepEqual(empty.failed(), []);
  assert.equal(empty.unreadable(), null, 'a genuinely empty archive is not an error');

  const unread = new Meetings({
    list: () => {
      throw new Error('EACCES: permission denied, scandir');
    },
    read: () => '',
    write: () => {},
    remove: () => false,
  });
  // Same size, same failed list, and they must still not be the same answer.
  assert.equal(unread.size(), empty.size());
  assert.deepEqual(unread.failed(), empty.failed());
  assert.notEqual(unread.unreadable(), empty.unreadable());
});

test('a non-Error thrown by list() still leaves a reason rather than a silent zero', () => {
  const lib = new Meetings({
    list: () => {
      throw 'the drive fell off';
    },
    read: () => '',
    write: () => {},
    remove: () => false,
  });
  assert.equal(lib.unreadable(), 'unknown error', 'unnamed is still not the same as absent');
});

// ── delete really deletes ───────────────────────────────────────────────────

test('remove() really deletes — from memory AND from the store', () => {
  const store = memStore();
  const lib = new Meetings(store);
  lib.save(LEDGER);
  assert.equal(lib.remove('m-ledger'), true);
  assert.equal(lib.get('m-ledger'), undefined);
  assert.equal(store.files.size, 0, 'the file is gone from the store, not tombstoned');
  assert.equal(new Meetings(store).size(), 0, 'and it stays gone across a reload');
});

test('removing a meeting that is not there is false, not a throw', () => {
  const lib = new Meetings(memStore());
  assert.equal(lib.remove('nope'), false);
});

test('a file that failed to parse can still be deleted — the owner can clean up', () => {
  const store = memStore({ 'm-broken': 'garbage' });
  const lib = new Meetings(store);
  assert.equal(lib.failed().length, 1);
  assert.equal(lib.remove('m-broken'), true);
  assert.deepEqual(lib.failed(), [], 'it leaves the failure list too');
  assert.equal(store.files.size, 0);
});

// ── recall explains itself ──────────────────────────────────────────────────

test('recall returns the matched terms alongside each hit', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  lib.save(HIRING);

  const hits = lib.recall('postgres migration');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.meeting.id, 'm-ledger');
  assert.deepEqual([...(hits[0]?.matched ?? [])].sort(), ['migration', 'postgres']);
  assert.ok((hits[0]?.score ?? 0) > 0);
});

test('recall returns the transcript lines that matched, so an answer can cite line ids', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  const hits = lib.recall('postgres');
  const lines = hits[0]?.lines ?? [];
  assert.ok(lines.length > 0, 'the matching line comes back, not just the meeting');
  for (const l of lines) {
    assert.ok(LEDGER.utterances.some((x) => x.id === l.id), 'every returned line is a real one');
  }
  assert.match(lines[0]?.text ?? '', /Postgres/i);
});

test('a title hit outranks a passing mention in the transcript', () => {
  const lib = new Meetings(memStore());
  lib.save(meeting('m-title', 'Budget planning', '2026-01-01T10:00:00.000Z', [u('owner', 'nothing relevant here')]));
  lib.save(meeting('m-body', 'Something else', '2026-01-02T10:00:00.000Z', [u('owner', 'we mentioned the budget once')]));
  const hits = lib.recall('budget');
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.meeting.id, 'm-title', 'the meeting ABOUT budget beats the one that mentioned it');
});

test('a participant name is searchable — "what did I discuss with Priya"', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  lib.save(HIRING);
  const hits = lib.recall('priya');
  assert.deepEqual(hits.map((h) => h.meeting.id), ['m-hiring']);
});

test('a query of nothing but stopwords returns nothing rather than everything', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  assert.deepEqual(lib.recall('what did we do about it'), []);
});

test('a query that matches nothing returns an empty list, not a low-confidence guess', () => {
  const lib = new Meetings(memStore());
  lib.save(LEDGER);
  assert.deepEqual(lib.recall('kubernetes'), []);
});

test('recall honours its limit, keeping the highest scores', () => {
  const lib = new Meetings(memStore());
  for (let i = 0; i < 6; i++) {
    lib.save(meeting(`m-${i}`, 'Budget', `2026-01-0${i + 1}T10:00:00.000Z`, [u('owner', 'budget talk')]));
  }
  assert.equal(lib.recall('budget').length, 5, 'the default limit');
  assert.equal(lib.recall('budget', 2).length, 2);
});

test('recall never returns more than a handful of lines per meeting — an excerpt, not a whole call', () => {
  const long = Array.from({ length: 40 }, () => u('owner', 'postgres again'));
  const lib = new Meetings(memStore());
  lib.save(meeting('m-long', 'Long call', '2026-01-01T10:00:00.000Z', long));
  const hits = lib.recall('postgres');
  assert.ok((hits[0]?.lines.length ?? 0) <= 12, 'the excerpt is capped');
  assert.ok((hits[0]?.lines.length ?? 0) > 0);
});

test('a term found ONLY in the transcript body scores lowest — the weakest evidence there is', () => {
  // The aside sits in the second sentence of the line, so the summary never
  // carries it and only the raw body does. This is the branch that makes a
  // leading question ("confirm I agreed to X") retrieve a meeting that merely
  // brushed past the word: the hit is real, it is worth 1, and the answer built
  // on it is only as good as the citation check that follows.
  const lib = new Meetings(memStore());
  lib.save(
    meeting('m-aside', 'Storage decision', '2026-01-01T10:00:00.000Z', [
      u('owner', "Let's go with Postgres for the ledger. Unrelated, the offsite is in Lisbon."),
    ]),
  );
  const hits = lib.recall('lisbon');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.score, 1, 'a passing mention in the body is worth 1, against 3 for a summary hit');
  assert.deepEqual(hits[0]?.matched, ['lisbon'], 'and the hit still says exactly why it came back');
  assert.equal(hits[0]?.lines.length, 1, 'the matching line comes back so its id can be cited');
});


// ── delete is a claim about the DISK, not about a Map ───────────────────────

test('a delete the store did not perform is never reported as a deletion', () => {
  // A store that quietly does nothing is the shape of every real refusal: a name
  // the filesystem will not take, a permission wall, a read-only drive. The
  // archive used to drop the entry and answer true anyway, so the owner was told
  // a private recording had been destroyed while the file sat there — and the
  // next restart handed it back.
  const files = new Map<string, string>([['m-a', serializeMeeting({ ...LEDGER, id: 'm-a' })]]);
  const stubborn: MeetingStore = {
    list: () => [...files.keys()],
    read: (id) => files.get(id) ?? '',
    write: () => {},
    remove: () => false,
  };
  const lib = new Meetings(stubborn);
  assert.equal(lib.size(), 1);
  assert.equal(lib.remove('m-a'), false, 'nothing left the disk, so nothing is claimed');
  assert.equal(lib.size(), 1, 'and the archive still describes what is actually there');
  assert.equal(lib.get('m-a') !== undefined, true, 'it was not quietly forgotten either');
});

test('a recording the owner already deleted in Explorer is forgotten, not re-reported', () => {
  // The other side of the same boolean: the store removed nothing because there
  // was nothing left to remove. The recording IS off the disk, which is what the
  // owner asked for, so the archive stops listing it.
  const files = new Map<string, string>([['m-a', serializeMeeting({ ...LEDGER, id: 'm-a' })]]);
  const store: MeetingStore = {
    list: () => [...files.keys()],
    read: (id) => files.get(id) ?? '',
    write: () => {},
    remove: (id) => {
      files.delete(id); // gone before we were asked
      return false; // ...so the store truthfully says it removed nothing
    },
  };
  const lib = new Meetings(store);
  assert.equal(lib.remove('m-a'), true, 'the file is gone from disk; the archive agrees');
  assert.equal(lib.size(), 0);
});

test('a meeting is deleted by the FILE it came from, not by the id inside it', () => {
  // The filename and the frontmatter id are the same string only for a file Zeno
  // wrote and nobody touched — and this format exists so the owner CAN touch it.
  const files = new Map<string, string>([['call-with-priya', serializeMeeting(LEDGER)]]);
  const store: MeetingStore = {
    list: () => [...files.keys()],
    read: (id) => files.get(id) ?? '',
    write: () => {},
    remove: (id) => files.delete(id),
  };
  const lib = new Meetings(store);
  assert.equal(lib.get('m-ledger') !== undefined, true, 'it is known by its frontmatter id');
  assert.equal(lib.remove('m-ledger'), true);
  assert.deepEqual([...files.keys()], [], 'and the FILE is what was deleted');
});
