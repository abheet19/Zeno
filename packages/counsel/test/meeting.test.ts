/**
 * The on-disk meeting record.
 *
 * Two claims are tested here, and they are the whole point of the format:
 *   - a meeting round-trips EXACTLY, through CRLF and a BOM, because Windows
 *     writes both and neither is corruption;
 *   - a malformed file NEVER throws. It comes back as a legible failure the
 *     caller can put in front of the owner, because "unreadable" is a fact the
 *     owner needs and an exception is a fact only the daemon log gets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMeeting,
  serializeMeeting,
  summarize,
  transcriptOf,
  type Meeting,
  type Speaker,
  type Utterance,
} from '../src/index.js';

function u(id: string, speaker: Speaker, text: string, min = 0): Utterance {
  return { id, at: new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString(), speaker, text };
}

const LINES: Utterance[] = [
  u('u1', 'owner', "Let's go with Postgres for the ledger.", 0),
  u('u2', 'other', 'Sounds good, that works for me.', 1),
  u('u3', 'owner', 'Sarah, can you send the migration notes by Friday?', 2),
  u('u4', 'other', 'What is the storage cost going to be?', 3),
  u('u5', 'unknown', 'This is important: keep the write path bounded.', 4),
];

function meetingOf(over: Partial<Meeting> = {}): Meeting {
  const utterances = over.utterances ?? LINES;
  return {
    id: 'm-2026-01-01',
    title: 'Ledger storage sync',
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:30:00.000Z',
    participants: ['Abheet', 'Sarah'],
    utterances,
    summary: summarize(transcriptOf(utterances)),
    ...over,
  };
}

test('a meeting round-trips through serialize and parse, byte-for-byte in its values', () => {
  const m = meetingOf();
  const back = parseMeeting(serializeMeeting(m), 'fallback');
  assert.equal(back.ok, true);
  assert.ok(back.ok);
  assert.deepEqual(back.meeting, JSON.parse(JSON.stringify(m)) as Meeting);
});

test('the file is readable Markdown a human can open, with the transcript in it', () => {
  const text = serializeMeeting(meetingOf());
  assert.match(text, /^---\nid: m-2026-01-01\n/);
  assert.match(text, /title: Ledger storage sync/);
  assert.match(text, /participants: \[Abheet, Sarah\]/);
  assert.match(text, /## Transcript/);
  assert.match(text, /## Decisions/);
  assert.match(text, /## Actions/);
  assert.match(text, /## Open questions/);
  assert.match(text, /## Key points/);
  assert.match(text, /Let's go with Postgres for the ledger\./, 'the words are in the file, not encoded away');
});

test('CRLF and a BOM — what Windows and PowerShell actually write — still parse', () => {
  const m = meetingOf();
  const onDisk = '\ufeff' + serializeMeeting(m).replace(/\n/g, '\r\n');
  const back = parseMeeting(onDisk, 'fallback');
  assert.ok(back.ok, 'a BOM + CRLF file is not corruption');
  assert.deepEqual(back.meeting.utterances, JSON.parse(JSON.stringify(m.utterances)) as Utterance[]);
  assert.equal(back.meeting.title, 'Ledger storage sync');
});

test('a newline inside a spoken line survives without splitting the record', () => {
  // Some speech-to-text engines emit a line break mid-utterance. It must not turn
  // one utterance into two, and it must come back exactly as it went in.
  const utterances = [u('n1', 'owner', 'first part\nsecond part', 0), u('n2', 'other', 'ok', 1)];
  const m = meetingOf({ utterances, summary: summarize(transcriptOf(utterances)) });
  const back = parseMeeting(serializeMeeting(m), 'f');
  assert.ok(back.ok);
  assert.equal(back.meeting.utterances.length, 2);
  assert.equal(back.meeting.utterances[0]?.text, 'first part\nsecond part');
});

test('a spoken middle dot or backslash does not forge a field separator', () => {
  // ` · ` is the field separator. If speech containing it were written raw, the
  // parser would read an invented field — so it is escaped, and comes back whole.
  const utterances = [u('s1', 'owner', 'the path is C:\\ledger · and the flag is on', 0), u('s2', 'other', 'ok', 1)];
  const m = meetingOf({ utterances, summary: summarize(transcriptOf(utterances)) });
  const back = parseMeeting(serializeMeeting(m), 'f');
  assert.ok(back.ok);
  assert.equal(back.meeting.utterances[0]?.text, 'the path is C:\\ledger · and the flag is on');
});

test('a literal backslash-n in speech stays two characters — it is not decoded into a newline', () => {
  const utterances = [u('e1', 'owner', 'type \\n to break the line', 0), u('e2', 'other', 'ok', 1)];
  const m = meetingOf({ utterances, summary: summarize(transcriptOf(utterances)) });
  const back = parseMeeting(serializeMeeting(m), 'f');
  assert.ok(back.ok);
  assert.equal(back.meeting.utterances[0]?.text, 'type \\n to break the line');
});

test('an action with no named owner and no stated due comes back as null, not as "—"', () => {
  const utterances = [u('a1', 'unknown', "I'll look into the retry budget.", 0), u('a2', 'other', 'ok', 1)];
  const m = meetingOf({ utterances, summary: summarize(transcriptOf(utterances)) });
  assert.equal(m.summary.actions[0]?.owner, null, 'the fixture really has an unattributed action');
  const back = parseMeeting(serializeMeeting(m), 'f');
  assert.ok(back.ok);
  assert.equal(back.meeting.summary.actions[0]?.owner, null, 'the em-dash placeholder is not read back as a person');
  assert.equal(back.meeting.summary.actions[0]?.due, null);
});

test('an empty meeting serializes and parses to an empty meeting, not to a failure', () => {
  const m = meetingOf({ utterances: [], summary: summarize(transcriptOf([])), participants: [] });
  const back = parseMeeting(serializeMeeting(m), 'f');
  assert.ok(back.ok);
  assert.deepEqual(back.meeting.utterances, []);
  assert.deepEqual(back.meeting.summary.decisions, []);
});

// ── malformed files: a legible failure, never a throw ───────────────────────

test('a file with no frontmatter is a legible failure, not an exception', () => {
  const r = parseMeeting('just some text a human dropped in the folder', 'x');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /not a meeting record/i.test(r.reason), r.ok ? '' : r.reason);
});

test('frontmatter that is opened but never closed fails legibly', () => {
  const r = parseMeeting('---\nid: x\ntitle: half a file\n', 'x');
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /never closed/i.test(r.reason));
});

test('every malformed body line names the field it is missing, and names the line', () => {
  const head = '---\nid: m1\ntitle: T\nstartedAt: 2026-01-01T00:00:00.000Z\nendedAt: 2026-01-01T00:10:00.000Z\nparticipants: []\n---\n\n';
  const cases: [string, RegExp][] = [
    ['## Transcript\n\n- u1 · only-three · owner\n', /transcript line is malformed/i],
    ['## Transcript\n\n- u1 · 2026-01-01T00:00:00.000Z · narrator · hello\n', /unknown speaker channel/i],
    ['## Decisions\n\n- agreed · text only\n', /decision line is malformed/i],
    ['## Decisions\n\n- maybe · text · cites: u1\n', /unknown lifecycle/i],
    ['## Decisions\n\n- agreed · text · sources: u1\n', /decision line is missing its "cites:"/i],
    ['## Actions\n\n- text · owner: x · due: y\n', /action line is malformed/i],
    ['## Actions\n\n- text · owner: x · due: y · sources: u1\n', /action line is missing its "cites:"/i],
    ['## Actions\n\n- text · who: x · when: y · cites: u1\n', /missing its "owner:"\/"due:"/i],
    ['## Open questions\n\n- just text\n', /open question line is malformed/i],
    ['## Open questions\n\n- text · sources: u1\n', /open question line is missing its "cites:"/i],
    ['## Key points\n\n- just text\n', /key point line is malformed/i],
    ['## Key points\n\n- text · sources: u1\n', /key point line is missing its "cites:"/i],
  ];
  for (const [body, expected] of cases) {
    const r = parseMeeting(head + body, 'x');
    assert.equal(r.ok, false, `expected a failure for: ${body}`);
    assert.ok(!r.ok && expected.test(r.reason), r.ok ? '' : `reason was: ${r.reason}`);
  }
});

test('a hand-edited file — reordered keys, a stray section, a quoted title — still reads', () => {
  const text = [
    '---',
    'title: "Q3: budget, and other things"',
    'participants: [Abheet]',
    'id: m-hand',
    'startedAt: 2026-02-02T09:00:00.000Z',
    'endedAt: 2026-02-02T09:20:00.000Z',
    '---',
    '',
    '## My own notes',
    '',
    '- remember to follow up',
    '',
    '## Transcript',
    '',
    '- h1 · 2026-02-02T09:00:00.000Z · owner · we agreed to freeze the budget',
    '',
    '## Decisions',
    '',
    '- agreed · we agreed to freeze the budget · cites: h1',
    '',
  ].join('\n');
  const r = parseMeeting(text, 'fallback');
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.equal(r.meeting.title, 'Q3: budget, and other things', 'a quoted title with a colon survives');
  assert.equal(r.meeting.id, 'm-hand');
  assert.equal(r.meeting.utterances.length, 1);
  assert.equal(r.meeting.summary.decisions[0]?.lifecycle, 'agreed');
});

test('a file with no id falls back to its filename stem, and an empty title is named honestly', () => {
  const r = parseMeeting('---\ntitle:\n---\n', 'from-the-filename');
  assert.ok(r.ok);
  assert.equal(r.meeting.id, 'from-the-filename');
  assert.equal(r.meeting.title, '(untitled meeting)');
  assert.equal(r.meeting.endedAt, '', 'a missing endedAt mirrors the missing startedAt rather than inventing one');
});
