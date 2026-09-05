/**
 * The Vault — memory that stays legible and cites its sources.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Vault,
  buildBrief,
  parseNote,
  renderBrief,
  serializeNote,
  ageOf,
  nodeClock,
  nodeNoteStore,
  type Note,
  type NoteStore,
  type VaultClock,
} from '../src/index.js';

/** A deterministic in-memory store + clock, so tests are replayable. */
function harness(): { store: NoteStore; clock: VaultClock; files: Map<string, string> } {
  const files = new Map<string, string>();
  let t = 0;
  let n = 0;
  return {
    files,
    store: {
      readAll: () => new Map(files),
      write: (id, text) => void files.set(id, text),
      remove: (id) => void files.delete(id),
    },
    clock: {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(),
      id: () => `note_${(n++).toString(16).padStart(4, '0')}`,
    },
  };
}

// ── note format: legible, round-trips, tolerant ─────────────────────────────

test('a note round-trips through Markdown byte-stably', () => {
  const note: Note = {
    id: 'n1',
    title: 'Abheet prefers PowerShell',
    tags: ['preference', 'shell'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'chat',
    body: 'He is on Windows and uses PowerShell, not bash.',
  };
  const back = parseNote(serializeNote(note), 'fallback');
  assert.deepEqual(back, note);
});

test('a hand-edited note (reordered keys, CRLF, BOM) still parses', () => {
  const text = '﻿---\r\nsource: chat\r\ntitle: A fact\r\ntags: [x, y]\r\nid: n9\r\ncreatedAt: 2026-01-01T00:00:00.000Z\r\nupdatedAt: 2026-01-02T00:00:00.000Z\r\n---\r\nthe body\r\n';
  const n = parseNote(text, 'fallback');
  assert.ok(n);
  assert.equal(n!.id, 'n9');
  assert.equal(n!.title, 'A fact');
  assert.deepEqual(n!.tags, ['x', 'y']);
  assert.equal(n!.body, 'the body');
});

test('a title with a colon survives serialization (frontmatter is not broken)', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  const n = v.remember({ title: 'note: colons are tricky', body: 'x', source: 's' });
  const back = parseNote(serializeNote(n), 'f');
  assert.equal(back!.title, 'note: colons are tricky');
});

test('text with no frontmatter is not a note', () => {
  assert.equal(parseNote('just some text', 'f'), null);
});

// ── remember / recall / forget ──────────────────────────────────────────────

test('remember then recall, with the matched terms shown', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  v.remember({ title: 'Barclays used KDB+', body: 'time-series database for transactions', source: 'resume', tags: ['barclays'] });
  v.remember({ title: 'QuillBot stack', body: 'React and NestJS at scale', source: 'resume', tags: ['quillbot'] });

  const hits = v.recall('what database did barclays use');
  assert.equal(hits[0]?.note.title, 'Barclays used KDB+');
  assert.ok(hits[0]!.matched.includes('barclays'), 'the result names why it matched');
  assert.ok(hits[0]!.score >= 5, 'a title/tag hit outweighs a body hit');
});

test('recall returns nothing for a query with no real terms', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  v.remember({ title: 'a fact', body: 'content', source: 's' });
  assert.deepEqual(v.recall('the a of to'), []);
});

test('a recalled memory always carries its source (never a rumour)', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  v.remember({ title: 'laid off from QuillBot', body: 'on 2026-09-02', source: 'owner' });
  const [hit] = v.recall('quillbot');
  assert.equal(hit?.note.source, 'owner');
});

test('forget removes a memory for good — no tombstone', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  const n = v.remember({ title: 'x', body: 'y', source: 's' });
  assert.equal(v.forget(n.id), true);
  assert.equal(v.size(), 0);
  assert.equal(h.files.has(n.id), false, 'the file is gone, not marked deleted');
  assert.equal(v.forget(n.id), false, 'forgetting twice is a no-op');
});

test('a Vault reloads its notes from the store on construction', () => {
  const h = harness();
  const v1 = new Vault(h.store, h.clock);
  v1.remember({ title: 'persisted', body: 'across a restart', source: 's', tags: ['keep'] });

  const v2 = new Vault(h.store, h.clock); // fresh instance, same store
  assert.equal(v2.size(), 1);
  assert.equal(v2.recall('persisted')[0]?.note.title, 'persisted');
});

// ── the morning brief: sources, ages, and honest partials ───────────────────

test('ageOf renders the shortest honest unit', () => {
  const now = '2026-01-02T00:00:00.000Z';
  assert.equal(ageOf('2026-01-02T00:00:00.000Z', now), '0s ago');
  assert.equal(ageOf('2026-01-01T23:59:30.000Z', now), '30s ago');
  assert.equal(ageOf('2026-01-01T23:30:00.000Z', now), '30m ago');
  assert.equal(ageOf('2026-01-01T20:00:00.000Z', now), '4h ago');
  assert.equal(ageOf('2025-12-30T00:00:00.000Z', now), '3d ago');
});

test('a brief with every source present is COMPLETE', () => {
  const b = buildBrief({
    now: '2026-01-02T00:00:00.000Z',
    recentNotes: [],
    pending: [{ summary: 'bump version', tier: 'T1', source: 'agent', at: '2026-01-01T23:00:00.000Z' }],
  });
  assert.equal(b.status, 'complete');
  assert.equal(b.missing.length, 0);
  const text = renderBrief(b);
  assert.match(text, /COMPLETE/);
  assert.match(text, /agent · 1h ago/, 'every item shows its source and age');
});

test('a brief with an unreachable source is PARTIAL, and says so — never a guess', () => {
  const b = buildBrief({
    now: '2026-01-02T00:00:00.000Z',
    recentNotes: [],
    pending: [],
    unavailable: [{ name: 'GitHub', note: 'rate limited — try again later' }],
  });
  assert.equal(b.status, 'partial');
  assert.deepEqual(b.missing, ['GitHub']);
  const text = renderBrief(b);
  assert.match(text, /PARTIAL/);
  assert.match(text, /could not reach GitHub/);
  assert.match(text, /unavailable — rate limited/, 'the unreachable source states why, in place');
});

// ── real filesystem: memory that opens in any editor ────────────────────────

test('REAL FS — notes are plain .md files, and reload after a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-vault-'));
  try {
    const notes = join(dir, 'notes');
    const v1 = new Vault(nodeNoteStore(notes), nodeClock());
    const n = v1.remember({ title: 'a real memory', body: 'on disk as markdown', source: 'test', tags: ['real'] });

    const files = readdirSync(notes).filter((f) => f.endsWith('.md'));
    assert.equal(files.length, 1);
    const raw = readFileSync(join(notes, files[0]!), 'utf8');
    assert.match(raw, /^---/, 'it is frontmatter + markdown, openable in any editor');
    assert.match(raw, /a real memory/);

    const v2 = new Vault(nodeNoteStore(notes), nodeClock());
    assert.equal(v2.size(), 1);
    assert.equal(v2.get(n.id)?.title, 'a real memory');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REAL FS — an unsafe note id is refused rather than escaping the folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-vault-'));
  try {
    const store = nodeNoteStore(join(dir, 'notes'));
    assert.throws(() => store.write('../escape', 'x'), /Unsafe note id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── coverage: the paths the happy cases skip ────────────────────────────────

test('all() lists notes newest-updated first', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  v.remember({ title: 'first', body: 'x', source: 's' });
  v.remember({ title: 'second', body: 'y', source: 's' });
  const titles = v.all().map((n) => n.title);
  assert.deepEqual(titles, ['second', 'first'], 'newest first');
});

test('a body-only match scores lower than a title match', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  v.remember({ title: 'unrelated heading', body: 'mentions kubernetes once', source: 's' });
  v.remember({ title: 'kubernetes guide', body: 'nothing else', source: 's' });
  const hits = v.recall('kubernetes');
  assert.equal(hits[0]?.note.title, 'kubernetes guide', 'the title hit ranks first');
  assert.equal(hits.length, 2, 'the body-only hit still comes back, just lower');
});

test('get() on a missing id is undefined; forget() honours the limit param', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  assert.equal(v.get('nope'), undefined);
  for (let i = 0; i < 8; i++) v.remember({ title: `deploy note ${i}`, body: 'deploy', source: 's' });
  assert.equal(v.recall('deploy', 3).length, 3, 'the recall limit is honoured');
});

test('an empty/untitled note is stored with safe defaults', () => {
  const h = harness();
  const v = new Vault(h.store, h.clock);
  const n = v.remember({ title: '   ', body: '  x  ', source: '  ' });
  assert.equal(n.title, '(untitled)');
  assert.equal(n.source, 'unknown');
  assert.equal(n.body, 'x');
});

test('parseNote falls back to the given id when the frontmatter omits one', () => {
  const n = parseNote('---\ntitle: t\ntags: []\ncreatedAt: 2026-01-01T00:00:00.000Z\nupdatedAt: 2026-01-01T00:00:00.000Z\nsource: s\n---\nbody', 'fallback-id');
  assert.equal(n?.id, 'fallback-id');
});

test('an empty recent-notes brief renders "nothing" rather than a blank block', () => {
  const b = buildBrief({ now: '2026-01-02T00:00:00.000Z', recentNotes: [], pending: [] });
  const text = renderBrief(b);
  assert.match(text, /Recent memory[\s\S]*nothing/);
});

test('ageOf reports unknown for an unparseable timestamp', () => {
  assert.equal(ageOf('not-a-date', '2026-01-01T00:00:00.000Z'), 'unknown age');
});
