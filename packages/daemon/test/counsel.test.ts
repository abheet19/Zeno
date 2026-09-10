/**
 * Counsel, served: the archive of past calls, and the chat over it.
 *
 * The Counsel tab is a dashboard plus a copilot chat pointed at the owner's own
 * life, so three lines are held here and they are the ones that make it safe:
 *
 *   - a spoken credential is redacted BEFORE the call becomes a file on disk;
 *   - DELETE really deletes — the recording leaves the disk, with no tombstone;
 *   - an answer citing a meeting the owner never had is CAUGHT and reported,
 *     not passed off as fact. And with no local model running, nothing is
 *     invented at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { Meetings, nodeMeetingStore } from '@abheet19/zeno-counsel';
import { createServer } from '../src/server.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

interface Harness {
  readonly base: string;
  readonly owner: string;
  readonly proposer: string;
  readonly meetingsDir: string;
  close(): Promise<void>;
}

/** A daemon over a real meetings directory. `withArchive: false` omits the store. */
async function start(withArchive = true, existing?: string): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-counsel-'));
  // `existing` reopens a folder a previous daemon wrote — what a restart looks like.
  const meetingsDir = existing ?? join(dir, 'meetings');
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server: Server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'),
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
    ...(withArchive ? { meetings: new Meetings(nodeMeetingStore(meetingsDir)) } : {}),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    owner: tokens.owner,
    proposer: tokens.proposer,
    meetingsDir,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          ok();
        });
      }),
  };
}

function api(h: Harness, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(h.base + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-zeno-token': h.owner },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * Stand in for Ollama so the ask route is deterministic on any machine.
 * `answer === null` means the connection simply fails — exactly what happens
 * when nothing is listening on 11434. Everything not addressed to the model
 * goes to the real fetch, so the test can still talk to the daemon.
 */
function stubOllama(answer: string | null): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    if (url.includes('11434')) {
      if (answer === null) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ response: answer }), { headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

const CALL = {
  title: 'Ledger storage sync',
  participants: ['Abheet', 'Sarah'],
  utterances: [
    { id: 'u1', at: '2026-03-01T10:00:00.000Z', speaker: 'owner', text: "Let's go with Postgres for the ledger." },
    { id: 'u2', at: '2026-03-01T10:01:00.000Z', speaker: 'other', text: 'Sounds good, that works for me.' },
    { id: 'u3', at: '2026-03-01T10:02:00.000Z', speaker: 'owner', text: "I'll send the migration plan by Friday." },
    { id: 'u4', at: '2026-03-01T10:03:00.000Z', speaker: 'other', text: 'What is the storage cost?' },
  ],
};

interface SavedMeeting {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  participants: string[];
  utterances: { id: string; text: string }[];
  summary: { decisions: { cites: string[] }[]; actions: unknown[] };
}

async function save(h: Harness, call: unknown = CALL): Promise<SavedMeeting> {
  const res = await api(h, '/counsel/meetings', 'POST', call);
  assert.equal(res.status, 200);
  return ((await res.json()) as { meeting: SavedMeeting }).meeting;
}

// ── the dashboard ───────────────────────────────────────────────────────────

test('Counsel — a finished call is summarised, persisted, and comes back in the archive', async () => {
  const h = await start();
  try {
    const meeting = await save(h);
    assert.equal(meeting.title, 'Ledger storage sync');
    assert.equal(meeting.startedAt, '2026-03-01T10:00:00.000Z', 'the call starts when the first line was spoken');
    assert.equal(meeting.endedAt, '2026-03-01T10:03:00.000Z');
    assert.ok(meeting.summary.decisions.length >= 1, 'it was summarised on the way in');
    assert.ok(meeting.summary.decisions[0]!.cites.length > 0, 'and the decision cites its lines — never a rumour');

    // It is a real Markdown file the owner could open in Notepad.
    assert.deepEqual(readdirSync(h.meetingsDir), [`${meeting.id}.md`]);
    const raw = readFileSync(join(h.meetingsDir, `${meeting.id}.md`), 'utf8');
    assert.match(raw, /^---\n/);
    assert.match(raw, /Let's go with Postgres for the ledger\./);

    const list = (await (await api(h, '/counsel/meetings')).json()) as {
      meetings: { id: string; title: string; participants: string[]; counts: { lines: number; decisions: number } }[];
      failed: unknown[];
    };
    assert.equal(list.meetings.length, 1);
    assert.equal(list.meetings[0]?.counts.lines, 4, 'the list carries counts, not whole transcripts');
    assert.ok((list.meetings[0]?.counts.decisions ?? 0) >= 1);
    assert.deepEqual(list.meetings[0]?.participants, ['Abheet', 'Sarah']);
    assert.deepEqual(list.failed, [], 'nothing in the archive is unreadable');

    const one = (await (await api(h, `/counsel/meetings/${meeting.id}`)).json()) as { meeting: SavedMeeting; text: string };
    assert.equal(one.meeting.utterances.length, 4, 'the single-meeting route carries the whole transcript');
    assert.match(one.text, /DECISIONS/, 'and a rendered summary comes back with it');
  } finally {
    await h.close();
  }
});

test('Counsel — capture timestamps are validated and stored in canonical UTC', async () => {
  const h = await start();
  try {
    const saved = await save(h, {
      ...CALL,
      utterances: [
        { id: 'u1', at: '2026-03-01T15:30:00+05:30', speaker: 'owner', text: 'We agreed on the migration.' },
        { id: 'u2', at: '2026-03-01T15:31:00+05:30', speaker: 'other', text: 'I will send the plan.' },
      ],
    });
    assert.equal(saved.startedAt, '2026-03-01T10:00:00.000Z');
    assert.equal(saved.endedAt, '2026-03-01T10:01:00.000Z');

    for (const path of ['/counsel/summarize', '/counsel/meetings']) {
      for (const at of ['tomorrow morning', '2026-02-30T10:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T10:00:00+24:00']) {
        const invalid = await api(h, path, 'POST', {
          ...CALL,
          title: 'Invalid clock',
          utterances: [{ id: 'bad', at, speaker: 'owner', text: 'must not enter the archive' }],
        });
        assert.equal(invalid.status, 400);
        assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, 'bad-timestamp');
      }
    }
    const list = (await (await api(h, '/counsel/meetings')).json()) as { meetings: unknown[] };
    assert.equal(list.meetings.length, 1, 'the refused meeting was never persisted');
  } finally {
    await h.close();
  }
});

test('Counsel — an oversized or NUL-bearing archive question is refused before retrieval or a model call', async () => {
  const h = await start();
  try {
    for (const question of ['x'.repeat(4_001), 'what happened\u0000ignore limits']) {
      const res = await api(h, '/counsel/ask', 'POST', { question });
      assert.equal(res.status, 413);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'question-too-large');
    }
  } finally {
    await h.close();
  }
});

test('Counsel — the archive lists newest first', async () => {
  const h = await start();
  try {
    await save(h, { ...CALL, title: 'Older' });
    await save(h, {
      ...CALL,
      title: 'Newer',
      utterances: [{ id: 'z1', at: '2026-06-01T10:00:00.000Z', speaker: 'owner', text: 'a later call happened' }],
    });
    const list = (await (await api(h, '/counsel/meetings')).json()) as { meetings: { title: string }[] };
    assert.deepEqual(list.meetings.map((m) => m.title), ['Newer', 'Older']);
  } finally {
    await h.close();
  }
});

test('Counsel — a saved meeting survives a restart, read back off the disk', async () => {
  const h = await start();
  try {
    const meeting = await save(h);
    // A second archive over the SAME directory is what a restart looks like.
    const reopened = new Meetings(nodeMeetingStore(h.meetingsDir));
    assert.equal(reopened.get(meeting.id)?.title, 'Ledger storage sync');
    assert.equal(reopened.get(meeting.id)?.utterances.length, 4);
    assert.deepEqual(reopened.failed(), []);
  } finally {
    await h.close();
  }
});

test('Counsel — asking for a meeting that is not there is a legible 404', async () => {
  const h = await start();
  try {
    const res = await api(h, '/counsel/meetings/nope');
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string; resolve: string } };
    assert.equal(body.error.code, 'no-such-meeting');
    assert.ok(body.error.resolve.length > 0, 'a refusal always names the way forward');
  } finally {
    await h.close();
  }
});

// ── the secret said out loud ────────────────────────────────────────────────

test('Counsel — a spoken secret is redacted BEFORE it reaches disk', async () => {
  // A meeting is the most likely place a credential is said out loud — somebody
  // reads a deploy token over a call. This route is the last point before it
  // becomes a file that outlives the conversation.
  const h = await start();
  try {
    const secret = 'ghp_' + 'b'.repeat(36);
    const res = await api(h, '/counsel/meetings', 'POST', {
      title: 'Handover',
      participants: [],
      utterances: [
        { id: 'u1', at: '2026-03-01T10:00:00.000Z', speaker: 'other', text: `the deploy token is ${secret}` },
        { id: 'u2', at: '2026-03-01T10:01:00.000Z', speaker: 'owner', text: 'got it, thanks' },
      ],
    });
    const { meeting, redacted } = (await res.json()) as { meeting: SavedMeeting; redacted: number };
    assert.ok(redacted >= 1, 'the daemon says how much it redacted');

    const stored = readFileSync(join(h.meetingsDir, `${meeting.id}.md`), 'utf8');
    assert.doesNotMatch(stored, new RegExp(secret), 'the raw token must never reach the meeting file');
    assert.match(stored, /REDACTED/, 'it is redacted, not silently dropped');
    assert.doesNotMatch(JSON.stringify(meeting), new RegExp(secret), 'nor is it echoed back in the response');

    // The summary is computed from the REDACTED lines, so a secret cannot survive
    // by hiding inside a key point.
    const full = (await (await api(h, `/counsel/meetings/${meeting.id}`)).json()) as { meeting: SavedMeeting };
    assert.doesNotMatch(JSON.stringify(full.meeting.summary), new RegExp(secret));
  } finally {
    await h.close();
  }
});

// ── delete really deletes ───────────────────────────────────────────────────

test('Counsel — DELETE really deletes: the file leaves the disk and stays gone', async () => {
  const h = await start();
  try {
    const meeting = await save(h);
    const file = join(h.meetingsDir, `${meeting.id}.md`);
    assert.equal(existsSync(file), true);

    const del = await api(h, `/counsel/meetings/${meeting.id}`, 'DELETE');
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { deleted: meeting.id });

    assert.equal(existsSync(file), false, 'the recording is gone from disk, not tombstoned');
    assert.deepEqual(readdirSync(h.meetingsDir), [], 'and nothing was moved aside into an archive folder');
    const list = (await (await api(h, '/counsel/meetings')).json()) as { meetings: unknown[] };
    assert.deepEqual(list.meetings, []);
    assert.equal((await api(h, `/counsel/meetings/${meeting.id}`)).status, 404);
    assert.equal((await api(h, `/counsel/meetings/${meeting.id}`, 'DELETE')).status, 404, 'deleting twice is a clean 404');
    assert.equal(new Meetings(nodeMeetingStore(h.meetingsDir)).size(), 0, 'and it stays gone across a restart');
  } finally {
    await h.close();
  }
});

// ── an unreadable file is a fact, not a silence ─────────────────────────────

test('Counsel — a corrupt file on disk surfaces in `failed`, never as an empty shelf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-counsel-bad-'));
  const meetingsDir = join(dir, 'meetings');
  mkdirSync(meetingsDir, { recursive: true });
  writeFileSync(join(meetingsDir, 'm-corrupt.md'), 'not a meeting record at all\n', 'utf8');
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'),
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
    meetings: new Meetings(nodeMeetingStore(meetingsDir)),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const list = (await (
      await fetch(base + '/counsel/meetings', { headers: { 'x-zeno-token': tokens.owner } })
    ).json()) as { meetings: unknown[]; failed: { id: string; reason: string }[] };
    assert.deepEqual(list.meetings, [], 'no meeting loaded');
    assert.equal(list.failed.length, 1, 'but the dashboard does NOT report an empty, healthy archive');
    assert.equal(list.failed[0]?.id, 'm-corrupt');
    assert.ok((list.failed[0]?.reason ?? '').length > 0, 'and it says why, in words the owner can read');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Counsel — saving without a title, utterances or a list of participants is a clean 400', async () => {
  const h = await start();
  try {
    assert.equal((await api(h, '/counsel/meetings', 'POST', { utterances: [] })).status, 400);
    assert.equal((await api(h, '/counsel/meetings', 'POST', { title: 'x' })).status, 400);
    assert.equal((await api(h, '/counsel/meetings', 'POST', { title: '   ', utterances: [] })).status, 400);
    const bad = await api(h, '/counsel/meetings', 'POST', { title: 'x', utterances: [], participants: 'Abheet' });
    assert.equal(bad.status, 400, 'participants must be a list — saying so beats guessing what was meant');
  } finally {
    await h.close();
  }
});

// ── the chat, and its honesty boundary ──────────────────────────────────────

test('Counsel — a question matching no meeting NEVER reaches a model', async () => {
  const h = await start();
  const restore = stubOllama('I definitely remember that meeting [m-999].');
  try {
    await save(h);
    const res = await api(h, '/counsel/ask', 'POST', { question: 'what did we decide about kubernetes?' });
    assert.equal(res.status, 200);
    const d = (await res.json()) as { answer: string; cites: string[]; grounded: boolean; note: string; hits: unknown[] };
    assert.equal(d.answer, 'I could not find that in your meetings.');
    assert.deepEqual(d.cites, []);
    assert.deepEqual(d.hits, []);
    assert.match(d.note, /nothing was sent to a model/, 'an empty context is never handed to a model and hoped about');
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — a grounded answer comes back with the ids it cited', async () => {
  const h = await start();
  const restore = stubOllama('You committed to sending the migration plan by Friday [u3].');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as {
      ok: boolean; answer: string; cites: string[]; ungrounded: string[]; fabricated: string[];
      grounded: boolean; note: string | null; hits: { id: string; matched: string[]; lines: string[] }[];
    };
    assert.equal(d.ok, true);
    assert.equal(d.grounded, true);
    assert.deepEqual(d.cites, ['u3']);
    assert.deepEqual(d.ungrounded, []);
    assert.deepEqual(d.fabricated, []);
    assert.equal(d.note, null);
    assert.equal(d.hits.length, 1, 'the retrieved meetings come back, so the UI can show its working');
    assert.ok(d.hits[0]?.matched.includes('migration'), 'including WHY each meeting was retrieved');
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — local model generation is bounded by an output cap and a timeout signal', async () => {
  const h = await start();
  const real = globalThis.fetch;
  let generate: RequestInit | undefined;
  try {
    await save(h);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      if (url.endsWith('/api/tags')) return new Response('{}', { status: 200 });
      if (url.endsWith('/api/generate')) {
        generate = init;
        return new Response(JSON.stringify({ response: 'You committed to sending the migration plan by Friday [u3].' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return real(input, init);
    }) as typeof fetch;
    const response = await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' });
    assert.equal(response.status, 200);
    const payload = JSON.parse(String(generate?.body)) as { stream: boolean; think: boolean; options: { num_predict: number } };
    assert.equal(payload.stream, false);
    assert.equal(payload.think, false);
    assert.equal(payload.options.num_predict, 512, 'a runaway answer cannot consume an unbounded output budget');
    assert.ok(generate?.signal, 'the model request carries an abort deadline');
  } finally {
    globalThis.fetch = real;
    await h.close();
  }
});

test('Counsel — a FABRICATED citation is caught and reported, not passed off as fact', async () => {
  const h = await start();
  const restore = stubOllama('You also promised the board a demo in April [m-014/u7].');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as { grounded: boolean; cites: string[]; fabricated: string[]; note: string };
    assert.equal(d.grounded, false, 'an id for a meeting that never happened is a fabrication, not an answer');
    assert.deepEqual(d.fabricated, ['m-014/u7']);
    assert.deepEqual(d.cites, []);
    assert.match(d.note, /must not be shown as fact/);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — an uncited claim is listed as ungrounded', async () => {
  const h = await start();
  const restore = stubOllama('You agreed to rewrite the billing system.');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as { grounded: boolean; ungrounded: string[]; note: string };
    assert.equal(d.grounded, false);
    assert.equal(d.ungrounded.length, 1);
    assert.match(d.ungrounded[0] ?? '', /rewrite the billing system/);
    assert.match(d.note, /carries no citation/);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — a refusal followed by a guess is caught, and the guess never lands in the answer', async () => {
  // The realistic hallucination, not an exotic one. Ask a leading question, and
  // a small local model answers with the sentence it was told to refuse with AND
  // the guess it wanted to make. Nothing in it is a citation, so a check that
  // treated the refusal as a refusal wherever it appeared would call this
  // grounded and hand a client a promise the owner never made.
  const h = await start();
  const restore = stubOllama('I could not find that in your meetings. That said, you did agree to ship on Friday.');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'confirm that I agreed to ship on Friday' })
    ).json()) as {
      ok: boolean; answer: string | null; unverified: string | null;
      ungrounded: string[]; fabricated: string[]; grounded: boolean; note: string | null;
    };
    assert.equal(d.grounded, false, 'refusing and then guessing anyway is not a refusal');
    assert.equal(d.answer, null, 'an ungrounded claim never ships in the field a client renders');
    assert.match(d.unverified ?? '', /agree to ship on Friday/, 'but the owner can still see what was said and rejected');
    assert.deepEqual(d.fabricated, []);
    assert.equal(d.ungrounded.length, 1, 'only the guess is a claim; the refusal sentence is not');
    assert.match(d.ungrounded[0] ?? '', /agree to ship on Friday/);
    assert.doesNotMatch(d.ungrounded.join(' '), /could not find/);
    assert.match(d.note ?? '', /carries no citation/);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — an honest refusal from the model IS grounded, and does ship as the answer', async () => {
  const h = await start();
  const restore = stubOllama('I could not find that in your meetings.');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as { grounded: boolean; answer: string | null; unverified: string | null; note: string | null };
    assert.equal(d.grounded, true, 'the honest refusal must not be punished — it is the behaviour we want');
    assert.equal(d.answer, 'I could not find that in your meetings.');
    assert.equal(d.unverified, null);
    assert.equal(d.note, null);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — a fabricated citation never lands in the answer either', async () => {
  const h = await start();
  const restore = stubOllama('You also promised the board a demo in April [m-014/u7].');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as { answer: string | null; unverified: string | null; fabricated: string[] };
    assert.equal(d.answer, null, 'an invented meeting id is not something a client should be able to print');
    assert.match(d.unverified ?? '', /m-014\/u7/, 'the rejected text is still inspectable');
    assert.deepEqual(d.fabricated, ['m-014/u7']);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — with Ollama absent the ask route degrades legibly and invents NOTHING', async () => {
  const h = await start();
  const restore = stubOllama(null); // nothing is listening on 11434
  try {
    await save(h);
    const res = await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' });
    assert.equal(res.status, 200, 'a missing local model is a state of the machine, not a server error');
    const d = (await res.json()) as {
      ok: boolean; answer: null; cites: string[]; ungrounded: string[]; grounded: boolean;
      note: string; model: string; hits: { id: string }[];
    };
    assert.equal(d.ok, false);
    assert.equal(d.answer, null, 'no answer is invented when there is nobody to answer');
    assert.deepEqual(d.cites, []);
    assert.equal(d.grounded, false);
    assert.match(d.note, /Ollama is not running/);
    assert.match(d.note, /ollama pull/, 'and it names the way forward');
    assert.match(d.note, /still on disk and still searchable/, 'the archive itself is unaffected, and says so');
    assert.equal(d.model, 'qwen3:8b');
    assert.equal(d.hits.length, 1, 'retrieval still worked — only the answerer is missing');
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — an empty model response is reported, never rendered as an answer', async () => {
  const h = await start();
  const restore = stubOllama('   ');
  try {
    await save(h);
    const d = (await (
      await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
    ).json()) as { ok: boolean; answer: null; note: string };
    assert.equal(d.ok, false);
    assert.equal(d.answer, null);
    assert.match(d.note, /empty answer/);
  } finally {
    restore();
    await h.close();
  }
});

test('Counsel — asking with no question is a clean 400', async () => {
  const h = await start();
  try {
    assert.equal((await api(h, '/counsel/ask', 'POST', {})).status, 400);
    assert.equal((await api(h, '/counsel/ask', 'POST', { question: '  ' })).status, 400);
  } finally {
    await h.close();
  }
});

// ── the boundaries every other route already keeps ──────────────────────────

test('Counsel — with no archive configured every meeting route says so plainly', async () => {
  const h = await start(false);
  try {
    for (const [path, method] of [
      ['/counsel/meetings', 'GET'],
      ['/counsel/meetings', 'POST'],
      ['/counsel/meetings/whatever', 'GET'],
      ['/counsel/meetings/whatever', 'DELETE'],
      ['/counsel/ask', 'POST'],
    ] as [string, string][]) {
      const res = await fetch(h.base + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-zeno-token': h.owner },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(res.status, 404, `${method} ${path}`);
      const body = (await res.json()) as { error: { code: string; resolve: string } };
      assert.equal(body.error.code, 'no-meetings');
      assert.ok(body.error.resolve.length > 0, 'a refusal always names the way forward');
    }
  } finally {
    await h.close();
  }
});

test('Counsel — an AGENT cannot create a persistent meeting record', async () => {
  const h = await start();
  try {
    const tried = await fetch(h.base + '/counsel/meetings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': h.proposer },
      body: JSON.stringify(CALL),
    });
    assert.equal(tried.status, 403);
    const body = (await tried.json()) as { error: { code: string; resolve: string } };
    assert.equal(body.error.code, 'owner-only');
    assert.ok(body.error.resolve.length > 0);
    const files = existsSync(h.meetingsDir) ? readdirSync(h.meetingsDir) : [];
    assert.deepEqual(files, [], 'the proposer cannot poison the owner archive');
  } finally {
    await h.close();
  }
});

test('Counsel — line ids stay globally unique when separate captures reuse u1, u2 and friends', async () => {
  const h = await start();
  try {
    const first = await save(h);
    const second = await save(h, { ...CALL, title: 'Second capture with reset sequence' });
    const firstIds = first.utterances.map((line) => line.id);
    const secondIds = second.utterances.map((line) => line.id);
    assert.deepEqual(firstIds, CALL.utterances.map((line) => line.id), 'the first unique ids stay readable');
    assert.ok(secondIds.every((id) => id.startsWith(`${second.id}/u`)), 'collisions are scoped to the later meeting');
    assert.equal(new Set([...firstIds, ...secondIds]).size, firstIds.length + secondIds.length);

    const loaded = (await (await api(h, `/counsel/meetings/${second.id}`)).json()) as { meeting: SavedMeeting };
    const savedIds = new Set(loaded.meeting.utterances.map((line) => line.id));
    for (const decision of loaded.meeting.summary.decisions) {
      for (const cite of decision.cites) assert.ok(savedIds.has(cite), 'summary citations use the rewritten ids');
    }
  } finally {
    await h.close();
  }
});

test('Counsel — an AGENT cannot delete the owner`s recordings', async () => {
  // Deleting a call is irreversible, so it sits behind the same line as
  // /approvals and /forge/commit. Reading the archive is not deciding to destroy
  // part of it, which is why only this route is gated.
  const h = await start();
  try {
    const meeting = await save(h);
    const tried = await fetch(h.base + `/counsel/meetings/${meeting.id}`, {
      method: 'DELETE',
      headers: { 'x-zeno-token': h.proposer },
    });
    assert.equal(tried.status, 403);
    const body = (await tried.json()) as { error: { code: string; resolve: string } };
    assert.equal(body.error.code, 'owner-only');
    assert.ok(body.error.resolve.length > 0);
    assert.equal(existsSync(join(h.meetingsDir, `${meeting.id}.md`)), true, 'and the recording is still there');
  } finally {
    await h.close();
  }
});

test('Counsel — the meeting routes are authenticated like everything else', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/counsel/meetings');
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unauthenticated');
  } finally {
    await h.close();
  }
});

test('Counsel — /counsel/summarize still works, and still persists nothing', async () => {
  // Summarising is pure and needs no archive. It must stay that way: the overlay
  // during a live call summarises without deciding to keep the recording.
  const h = await start(false);
  try {
    const res = await api(h, '/counsel/summarize', 'POST', { utterances: CALL.utterances });
    assert.equal(res.status, 200);
    const d = (await res.json()) as { summary: { decisions: unknown[] }; text: string };
    assert.ok(d.summary.decisions.length >= 1);
    assert.equal(existsSync(h.meetingsDir), false, 'summarising alone writes nothing to disk');
  } finally {
    await h.close();
  }
});

// ── honest degradation: the states that must never render alike ─────────────

/**
 * A meetings folder that EXISTS and cannot be read is not an empty archive.
 *
 * `{"meetings":[],"failed":[]}` is the correct answer for an owner who has
 * never recorded a call. It was also the answer for an owner whose archive sat
 * behind a permission wall, on a drive that was not mounted, or under a path
 * that turned out to be a file — byte for byte the same response, so the tab
 * said "no meetings yet" over a hundred recordings it had simply failed to
 * open. The two states now carry different bytes, and this proves it.
 */
test('Counsel — an UNREADABLE archive does not answer like an empty one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-counsel-unreadable-'));
  // A file where the folder should be: readdir answers ENOTDIR, not ENOENT.
  const wrong = join(dir, 'meetings');
  writeFileSync(wrong, 'a file, not a folder', 'utf8');
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'),
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
    meetings: new Meetings(nodeMeetingStore(wrong)),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(base + '/counsel/meetings', { headers: { 'x-zeno-token': tokens.owner } });
    assert.equal(res.status, 200, 'the daemon is fine; the folder is not');
    const body = (await res.json()) as {
      meetings: unknown[];
      failed: unknown[];
      archive: { readable: boolean; reason: string | null; resolve: string | null };
    };
    assert.deepEqual(body.meetings, [], 'nothing could be loaded');
    assert.deepEqual(body.failed, [], 'and no individual FILE failed — none was ever reached');
    assert.equal(body.archive.readable, false, 'the folder itself is the failure, and it is reported');
    assert.match(body.archive.reason ?? '', /could not be read/i);
    assert.match(body.archive.reason ?? '', /ENOTDIR/, 'in an errno the owner can act on');
    assert.ok((body.archive.resolve ?? '').length > 0, 'with something to do about it');

    // The comparison that is the whole point: a first run over a folder that was
    // never created must NOT produce this response.
    const firstRun = await start();
    try {
      const fine = (await (await api(firstRun, '/counsel/meetings')).json()) as {
        meetings: unknown[];
        archive: { readable: boolean; reason: string | null };
      };
      assert.deepEqual(fine.meetings, []);
      assert.equal(fine.archive.readable, true, 'never recorded a call is not an error');
      assert.equal(fine.archive.reason, null);
      assert.notDeepEqual(body.archive, fine.archive, '"no meetings yet" and "could not read your meetings" differ');
    } finally {
      await firstRun.close();
    }
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Too short to summarise is not a summary that found nothing.
 *
 * `summarize` runs happily on one garbled fragment and hands back a shape that
 * renders as "DECISIONS: none extracted · ACTIONS: none extracted" — which
 * reads as a finished analysis of a real meeting. The package has had
 * `tooShortToSummarize` and `renderPartial` since it was written; this route
 * never asked them, so the honest partial existed and was never served.
 */
test('Counsel — a transcript too short to summarise says so, and is not a summary', async () => {
  const h = await start(false);
  try {
    const one = await api(h, '/counsel/summarize', 'POST', {
      utterances: [{ id: 'u1', at: '2026-03-01T10:00:00.000Z', speaker: 'owner', text: 'and then he said' }],
    });
    assert.equal(one.status, 200);
    const d = (await one.json()) as {
      partial: boolean;
      lines: number;
      note: string | null;
      text: string;
    };
    assert.equal(d.partial, true, 'the SERVER says it is a partial — the window must not have to guess');
    assert.equal(d.lines, 1);
    assert.match(d.text, /TRANSCRIPT TOO SHORT/, 'the plain text says it in the first line');
    assert.doesNotMatch(d.text, /MEETING SUMMARY/, 'and never dresses one line up as a finished summary');
    assert.match(d.text, /"and then he said"/, 'the captured line is shown verbatim instead');
    assert.doesNotMatch(d.text, /none extracted/, '"none extracted" claims an extraction that was not attempted');
    assert.ok((d.note ?? '').length > 0, 'with a sentence the window can show as-is');

    const zero = (await (await api(h, '/counsel/summarize', 'POST', { utterances: [] })).json()) as {
      partial: boolean;
      lines: number;
      text: string;
    };
    assert.equal(zero.partial, true);
    assert.equal(zero.lines, 0);
    assert.match(zero.text, /0 lines captured/);
    assert.doesNotMatch(zero.text, /MEETING SUMMARY/, 'an empty transcript is emphatically not a summary');

    // And a real call is still a real summary — the partial flag is not a new
    // excuse to under-report a meeting that genuinely happened.
    const full = (await (await api(h, '/counsel/summarize', 'POST', { utterances: CALL.utterances })).json()) as {
      partial: boolean;
      text: string;
      summary: { decisions: unknown[] };
    };
    assert.equal(full.partial, false);
    assert.match(full.text, /MEETING SUMMARY/);
    assert.ok(full.summary.decisions.length >= 1);
  } finally {
    await h.close();
  }
});

/**
 * "Ollama is not running" is a claim about the owner's machine, and it has to
 * be true. A live Ollama answering with something this cannot parse used to
 * land in the same catch as a refused connection, so the owner was sent to
 * restart a service that had never stopped.
 */
test('Counsel — a live Ollama that answers strangely is not reported as a dead one', async () => {
  const h = await start();
  try {
    await save(h);
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      if (url.includes('11434')) return new Response('<html>not json</html>', { status: 200 });
      return real(input, init);
    }) as typeof fetch;
    let note = '';
    try {
      const res = (await (
        await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
      ).json()) as { ok: boolean; answer: string | null; note: string };
      assert.equal(res.ok, false, 'no answer is invented when there is nothing to ground');
      assert.equal(res.answer, null);
      note = res.note;
    } finally {
      globalThis.fetch = real;
    }
    assert.doesNotMatch(note, /is not running/, 'it IS running — saying otherwise is a false fact about the machine');
    assert.match(note, /running/, 'the note says what actually happened instead');

    // The three model-side failures stay distinguishable from each other.
    const notes: string[] = [];
    for (const kind of ['down', 'not-pulled', 'empty'] as const) {
      const restore = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
        if (url.includes('11434')) {
          if (kind === 'down') throw new TypeError('fetch failed');
          if (kind === 'not-pulled') return new Response('{"error":"model not found"}', { status: 404 });
          return new Response(JSON.stringify({ response: '   ' }), { headers: { 'content-type': 'application/json' } });
        }
        return restore(input, init);
      }) as typeof fetch;
      try {
        const r = (await (
          await api(h, '/counsel/ask', 'POST', { question: 'what did I commit to on the migration?' })
        ).json()) as { note: string };
        notes.push(r.note);
      } finally {
        globalThis.fetch = restore;
      }
    }
    assert.match(notes[0] ?? '', /not running/, 'nothing listening: say so');
    assert.match(notes[1] ?? '', /404|pulled/, 'listening but the model is not pulled: a different sentence');
    assert.match(notes[2] ?? '', /empty answer/, 'answered with nothing: a third');
    assert.equal(new Set([...notes, note]).size, 4, 'four different failures, four different sentences');
  } finally {
    await h.close();
  }
});

/**
 * A 50MB transcript is the owner's very long call, not a broken daemon. As a
 * 500 `internal` with "check the daemon output" it blamed the wrong party and
 * sent them somewhere there was nothing to find.
 */
test('Counsel — an oversized transcript is a legible refusal, not an internal error', async () => {
  const h = await start();
  try {
    const line = 'We decided to go with Postgres for the ledger and I will send the plan by Friday. ';
    const utterances: { id: string; at: string; speaker: string; text: string }[] = [];
    // Comfortably past the 1 MB body cap, without building a real 50 MB string
    // in the test process — the cap is what is under test, not the arithmetic.
    for (let i = 0; i < 20_000; i++) {
      utterances.push({ id: `u${i}`, at: '2026-03-01T10:00:00.000Z', speaker: 'owner', text: line });
    }
    for (const path of ['/counsel/summarize', '/counsel/meetings']) {
      const res = await api(h, path, 'POST', { title: 'Very long call', participants: [], utterances });
      assert.equal(res.status, 413, `${path}: too big is 413, not 500`);
      const e = ((await res.json()) as { error: { code: string; message: string; resolve: string } }).error;
      assert.equal(e.code, 'body-too-large');
      assert.notEqual(e.code, 'internal', 'the owner sending a long call is not the daemon breaking');
      assert.match(e.message, /too large/i);
      assert.doesNotMatch(e.resolve, /daemon output/, 'there is nothing for them to find there');
      assert.ok(e.resolve.length > 0, 'and there is something they can actually do');
    }
    // Nothing was half-saved on the way to the refusal.
    const list = (await (await api(h, '/counsel/meetings')).json()) as { meetings: unknown[] };
    assert.deepEqual(list.meetings, [], 'a refused save leaves no partial meeting behind');
  } finally {
    await h.close();
  }
});


// ── the secret that was never spoken ────────────────────────────────────────
//
// A credential does not only arrive by being said out loud. The title is where
// somebody pastes the agenda ("Handover — token ghp_…"), the participant list is
// whatever the recorder labelled the channels with, and the line id is whatever
// the recorder chose to call it. All four fields become the same file on disk and
// the same prompt to a model, so the sanitizer has to cover all four — sanitizing
// only the spoken line was an assumption about how secrets travel, not a defence.

test('Counsel — a secret in the TITLE, a participant or a line id is redacted before disk too', async () => {
  const h = await start();
  try {
    const inTitle = 'ghp_' + 'a'.repeat(36);
    const inPerson = 'ghp_' + 'c'.repeat(36);
    const inLineId = 'ghp_' + 'd'.repeat(36);
    const res = await api(h, '/counsel/meetings', 'POST', {
      title: `Handover — deploy token ${inTitle}`,
      participants: [`Sarah (${inPerson})`],
      utterances: [
        { id: `line-${inLineId}`, at: '2026-03-01T10:00:00.000Z', speaker: 'owner', text: 'walking through the handover' },
      ],
    });
    const { meeting, redacted } = (await res.json()) as { meeting: SavedMeeting; redacted: number };
    assert.equal(redacted, 3, 'all three findings are counted, not silently passed through');

    const stored = readFileSync(join(h.meetingsDir, `${meeting.id}.md`), 'utf8');
    for (const [what, secret] of [['title', inTitle], ['participant', inPerson], ['line id', inLineId]] as const) {
      assert.doesNotMatch(stored, new RegExp(secret), `the ${what} secret must never reach the meeting file`);
      assert.doesNotMatch(JSON.stringify(meeting), new RegExp(secret), `nor be echoed back in the ${what}`);
    }
    assert.match(stored, /REDACTED/, 'it is redacted, not silently dropped');

    // The citations still line up: the summary was built from the SAME redacted
    // ids, so redacting one did not orphan the lines that cite it.
    const full = (await (await api(h, `/counsel/meetings/${meeting.id}`)).json()) as { meeting: SavedMeeting };
    const ids = new Set(full.meeting.utterances.map((u) => u.id));
    for (const d of full.meeting.summary.decisions) {
      for (const c of d.cites) assert.ok(ids.has(c), 'every citation still names a line that exists');
    }
  } finally {
    await h.close();
  }
});

// ── DELETE, when the file is not named after the id ─────────────────────────

test('Counsel — DELETE removes the real file even when the owner renamed it', async () => {
  const h = await start();
  try {
    const meeting = await save(h);
    // The archive is Markdown so the owner CAN do this: rename it in Explorer. The
    // id in the frontmatter stays what it was; the filename no longer matches it.
    const original = join(h.meetingsDir, `${meeting.id}.md`);
    const renamed = join(h.meetingsDir, 'call with sarah.md');
    writeFileSync(renamed, readFileSync(original, 'utf8'), 'utf8');
    rmSync(original);

    // A fresh daemon over the same folder is the owner's next launch.
    const h2 = await start(true, h.meetingsDir);
    try {
      const del = await api(h2, `/counsel/meetings/${meeting.id}`, 'DELETE');
      assert.equal(del.status, 200);
      assert.deepEqual(await del.json(), { deleted: meeting.id });

      // The regression: the route answered "deleted" while the recording sat in
      // the folder, and the next restart handed it straight back.
      assert.equal(existsSync(renamed), false, 'the recording left the disk, not just the list');
      assert.deepEqual(readdirSync(h.meetingsDir), [], 'nothing was moved aside, nothing was kept');
      assert.equal(new Meetings(nodeMeetingStore(h.meetingsDir)).size(), 0, 'and it stays gone across a restart');
    } finally {
      await h2.close();
    }
  } finally {
    await h.close();
  }
});

test('Counsel — a meeting id can never address a file outside the archive', async () => {
  const h = await start();
  try {
    await save(h);
    const neighbour = join(h.meetingsDir, '..', 'proposer.token');
    writeFileSync(neighbour, 'a live credential that is none of this route\'s business\n', 'utf8');

    // Traversal in both slashes, percent-encoded so the raw "/" check cannot see
    // it; an absolute path; a drive letter; a device name; a trailing dot.
    for (const suffix of [
      '..%2F..%2Fetc%2Fpasswd',
      '..%5C..%5Cproposer.token',
      '%2E%2E%2Fproposer.token',
      '%2Fetc%2Fpasswd',
      'C%3A%5CWindows%5Cwin.ini',
      '..%2Fproposer.token',
      'CON',
      'abc.',
    ]) {
      const path = `/counsel/meetings/${suffix}`;
      assert.equal((await api(h, path)).status, 404, `GET ${suffix} is a clean 404`);
      assert.equal((await api(h, path, 'DELETE')).status, 404, `DELETE ${suffix} is a clean 404`);
    }
    assert.equal(existsSync(neighbour), true, 'the file beside the archive is untouched');
    assert.equal(readdirSync(h.meetingsDir).length, 1, 'and the one real meeting is still there');
  } finally {
    await h.close();
  }
});
