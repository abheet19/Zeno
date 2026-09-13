/**
 * Counsel: summarise a live transcript, archive finished meetings, and answer
 * questions grounded ONLY in saved meetings — with every citation checked
 * before an answer is allowed to render as fact.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sanitize } from '@abheet19/zeno-sanitizer';
import {
  buildAnswerPrompt,
  groundedAnswer,
  NOT_FOUND,
  renderPartial,
  renderSummary,
  summarize,
  tooShortToSummarize,
  transcriptOf,
  type Meeting,
  type Meetings,
  type Utterance,
} from '@abheet19/zeno-counsel';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str, strings } from './http.js';
import { askLocalModel } from './counsel-model.js';

/** A meeting question stays small enough for retrieval and a bounded local prompt. */
const MAX_COUNSEL_QUESTION_CHARS = 4_000;

const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Validate owner-provided capture time and store one canonical UTC spelling. */
function counselTimestamp(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export async function postCounselSummarize(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const raw = Array.isArray(body['utterances']) ? (body['utterances'] as unknown[]) : null;
  if (raw === null) {
    return json(res, 400, { error: { code: 'bad-request', message: 'Provide utterances: an array of {id, at, speaker, text}.', resolve: 'POST {"utterances":[...]}.' } });
  }
  const receivedAt = new Date().toISOString();
  const utterances: Utterance[] = [];
  for (let i = 0; i < raw.length; i++) {
    const u = raw[i];
    if (typeof u !== 'object' || u === null) continue;
    const record = u as Record<string, unknown>;
    const at = counselTimestamp(record['at'], receivedAt);
    if (at === null) {
      return json(res, 400, {
        error: { code: 'bad-timestamp', message: `Utterance ${i + 1} has an invalid timestamp.`, resolve: 'Use an RFC 3339 timestamp such as 2026-03-01T10:00:00.000Z.' },
      });
    }
    utterances.push({
      id: typeof record['id'] === 'string' ? record['id'] : `u${i}`,
      at,
      speaker: record['speaker'] === 'owner' || record['speaker'] === 'other' ? record['speaker'] : 'unknown',
      text: typeof record['text'] === 'string' ? record['text'] : '',
    });
  }
  const transcript = transcriptOf(utterances);
  // BELOW THE THRESHOLD, THERE IS NO SUMMARY TO GIVE. `summarize` will happily
  // run on one garbled fragment and hand back a shape that renders as
  // "DECISIONS: none extracted · ACTIONS: none extracted" — which reads as a
  // finished analysis of a real meeting, not as "you have said one thing so
  // far". The package has said this since it was written (`tooShortToSummarize`
  // + `renderPartial`, the honest-partial rule); this route simply never asked.
  // It asks now, and answers with the captured lines verbatim instead.
  if (tooShortToSummarize(transcript)) {
    return json(res, 200, {
      summary: { decisions: [], actions: [], questions: [], keyPoints: [] },
      text: renderPartial(transcript),
      partial: true,
      lines: utterances.length,
      note:
        `${utterances.length} line${utterances.length === 1 ? '' : 's'} captured — too little to summarize honestly. ` +
        'Nothing here is inferred; as the meeting continues this fills in.',
    });
  }
  const summary = summarize(transcript);
  json(res, 200, { summary, text: renderSummary(summary), partial: false, lines: utterances.length, note: null });
}

/** Every meetings route needs a store. Absent is a legible 404, not a crash. */
function requireMeetings(ctx: ServerCtx, res: ServerResponse): Meetings | null {
  if (!ctx.opts.meetings) {
    json(res, 404, {
      error: {
        code: 'no-meetings',
        message: 'The meeting archive is not enabled.',
        resolve: 'Start the daemon with a meetings directory.',
      },
    });
    return null;
  }
  return ctx.opts.meetings;
}

/**
 * The id in `/counsel/meetings/<id>`, percent-decoded. Null when it is missing
 * or unusable.
 *
 * The check happens AFTER decoding as well as before. Rejecting a raw `/` and
 * then decoding hands `..%2F..%2Fetc%2Fpasswd` through as the id `../../etc/passwd`
 * — the archive's own filename jail is what stopped it going anywhere, and a
 * route should not be spending someone else's defence. A meeting id names one
 * file in one folder; a separator, a drive letter or a control character in it
 * means it is not one.
 */
function meetingIdFrom(path: string): string | null {
  const raw = path.slice('/counsel/meetings/'.length);
  if (raw === '' || raw.includes('/')) return null;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null; // a malformed escape is not an id
  }
  if (id === '' || id === '.' || id === '..') return null;
  // A meeting id names ONE file in ONE folder: no separator, no drive letter,
  // no wildcard, no control character.
  const forbidden = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
  if ([...id].some((c) => forbidden.has(c) || c.charCodeAt(0) < 0x20)) return null;
  return id;
}

/**
 * The dashboard list: newest first, with counts rather than whole transcripts —
 * a tab that renders a list must not have to download every word ever spoken.
 *
 * `failed` ships alongside. A meeting file the archive could not read is a fact
 * the owner needs; a list that quietly omits it would be the dashboard lying by
 * omission, and "you have no meetings" is a very different sentence from "one
 * of your meetings is unreadable".
 */
export function serveMeetings(ctx: ServerCtx, res: ServerResponse): void {
  const lib = requireMeetings(ctx, res);
  if (lib === null) return;
  const meetings = lib.all().map((m) => ({
    id: m.id,
    title: m.title,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
    participants: m.participants,
    counts: {
      lines: m.utterances.length,
      decisions: m.summary.decisions.length,
      actions: m.summary.actions.length,
      questions: m.summary.questions.length,
      keyPoints: m.summary.keyPoints.length,
    },
  }));
  // Whether the FOLDER could be read at all is a separate fact from whether
  // the files in it parsed. Without it, an unreadable archive — a permission
  // wall, an unmounted drive, a file where the folder should be — serves the
  // exact bytes a first run serves, and the tab says "no meetings yet" over a
  // hundred recordings it simply could not open.
  const unreadable = lib.unreadable();
  json(res, 200, {
    meetings,
    failed: lib.failed(),
    archive:
      unreadable === null
        ? { readable: true, reason: null, resolve: null }
        : {
            readable: false,
            reason: `The meetings folder could not be read: ${unreadable}`,
            resolve: 'Check that the folder exists and this account can read it. Nothing below is a complete list until it can.',
          },
  });
}

export function serveMeeting(ctx: ServerCtx, res: ServerResponse, path: string): void {
  const lib = requireMeetings(ctx, res);
  if (lib === null) return;
  const id = meetingIdFrom(path);
  const meeting = id === null ? undefined : lib.get(id);
  if (!meeting) {
    return json(res, 404, {
      error: {
        code: 'no-such-meeting',
        message: `No meeting with id ${JSON.stringify(id ?? '')} is in the archive.`,
        resolve: 'List the archive at GET /counsel/meetings.',
      },
    });
  }
  json(res, 200, { meeting, text: renderSummary(meeting.summary) });
}

/**
 * Save a finished call: summarise it, persist it, hand back what was stored.
 *
 * Every spoken line goes through the sanitizer FIRST, exactly as postMemory
 * does. A meeting is the single most likely place for a credential to be said
 * out loud — someone reads an API key over a call — and this route is the last
 * point before it becomes a file on disk that outlives the conversation. The
 * summary is computed from the REDACTED lines, so a secret cannot survive in a
 * key point either.
 */
export async function postMeeting(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can save a recording to the meeting archive.',
        resolve: 'Save it from the Zeno Counsel window.',
      },
    });
  }
  const lib = requireMeetings(ctx, res);
  if (lib === null) return;
  const body = await readJson(req);
  const title = str(body, 'title');
  const raw = Array.isArray(body['utterances']) ? (body['utterances'] as unknown[]) : null;
  if (title === null || title.trim() === '' || raw === null) {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'A saved meeting needs a title and an array of utterances.',
        resolve: 'POST {"title":"...","participants":["..."],"utterances":[{"id","at","speaker","text"}]}.',
      },
    });
  }
  const participants = strings(body, 'participants');
  if (participants === null) {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'participants must be an array of strings.', resolve: 'Send participants: ["Abheet", "Priya"].' },
    });
  }

  // EVERY field that becomes part of the file, not just the spoken line.
  //
  // The transcript used to be the only thing sanitized, which quietly assumed a
  // credential can only arrive by being spoken. It cannot: the title is where a
  // handover call gets named "Handover — token ghp_…" by the person pasting the
  // agenda in, the participant list carries whatever the recorder labelled the
  // channels with, and the line id is whatever the recorder chose to call it.
  // All four land in the same `.md` on disk and in the same prompt to a model,
  // so all four go through the sanitizer, and `redacted` counts all of it.
  let redacted = 0;
  const scrub = (s: string): string => {
    const clean = sanitize(s);
    redacted += clean.findings.length;
    return clean.clean;
  };

  // Line ids are citation addresses. Keep a caller's id when it is unique,
  // but scope a collision to this meeting so two calls can never make `[u0]`
  // resolve to whichever file happened to load first.
  const meetingId = `m-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const occupied = new Set<string>([meetingId]);
  for (const saved of lib.all()) {
    occupied.add(saved.id);
    for (const line of saved.utterances) occupied.add(line.id);
  }
  const receivedAt = new Date().toISOString();
  const utterances: Utterance[] = [];
  for (let i = 0; i < raw.length; i++) {
    const u = raw[i];
    if (typeof u !== 'object' || u === null) continue;
    const record = u as Record<string, unknown>;
    const at = counselTimestamp(record['at'], receivedAt);
    if (at === null) {
      return json(res, 400, {
        error: { code: 'bad-timestamp', message: `Utterance ${i + 1} has an invalid timestamp.`, resolve: 'Use an RFC 3339 timestamp such as 2026-03-01T10:00:00.000Z.' },
      });
    }
    const requested = typeof record['id'] === 'string' && record['id'] !== '' ? scrub(record['id']) : `u${i}`;
    const id = occupied.has(requested) ? `${meetingId}/u${i}` : requested;
    occupied.add(id);
    utterances.push({
      id,
      at,
      speaker: record['speaker'] === 'owner' || record['speaker'] === 'other' ? record['speaker'] : 'unknown',
      text: scrub(typeof record['text'] === 'string' ? record['text'] : ''),
    });
  }

  const startedAt = utterances[0]?.at ?? new Date().toISOString();
  // The id is also the filename stem, so it stays inside [A-Za-z0-9_-].
  const meeting: Meeting = {
    id: meetingId,
    title: scrub(title.trim()),
    startedAt,
    endedAt: utterances[utterances.length - 1]?.at ?? startedAt,
    participants: participants.map(scrub),
    utterances,
    // Computed from the REDACTED lines, so a secret cannot survive by hiding
    // inside a key point.
    summary: summarize(transcriptOf(utterances)),
  };

  // Save BEFORE answering. The archive writes through to disk before it changes
  // in memory, so a refused write throws and leaves as a legible 500 — and the
  // owner is never told a call was saved that is not actually on disk.
  lib.save(meeting);
  json(res, 200, { meeting, redacted });
}

/**
 * Delete a recording. This really deletes: the file is removed from disk, not
 * flagged. A meeting is a recording of the owner's own voice and the people who
 * were in the room with them — "delete" that leaves a copy behind is a lie.
 *
 * OWNER-ONLY, on the same reasoning as /approvals and /forge/commit: this is
 * irreversible. Reading the archive is not deciding to destroy part of it, so
 * the other routes stay open to either role and this one does not.
 */
export function deleteMeeting(ctx: ServerCtx, res: ServerResponse, path: string, role: Role): void {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can delete a recording.',
        resolve: 'Delete it from the Zeno window, or from the meetings folder itself.',
      },
    });
  }
  const lib = requireMeetings(ctx, res);
  if (lib === null) return;
  const id = meetingIdFrom(path);
  if (id === null || !lib.remove(id)) {
    return json(res, 404, {
      error: {
        code: 'no-such-meeting',
        message: `No meeting with id ${JSON.stringify(id ?? '')} is in the archive.`,
        resolve: 'List the archive at GET /counsel/meetings.',
      },
    });
  }
  json(res, 200, { deleted: id });
}

/**
 * Ask the local model a question about past meetings.
 *
 * The chain is: retrieve -> build a grounded prompt -> ask Ollama -> CHECK the
 * answer's citations -> return. The check is the part that is not optional. A
 * model that cites `[m-014/u7]` for a meeting that never happened has invented
 * the owner's own history, so `grounded:false` ships with the exact fabricated
 * ids and the UI must refuse to render it as fact.
 *
 * Two paths never reach a model at all: no retrieval hits, and Ollama absent.
 * Both answer honestly rather than guessing, because there is no answer that
 * would be better than saying so.
 */
export async function postCounselAsk(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const lib = requireMeetings(ctx, res);
  if (lib === null) return;
  const body = await readJson(req);
  const questionRaw = str(body, 'question');
  if (questionRaw === null || questionRaw.trim() === '') {
    return json(res, 400, {
      error: { code: 'bad-request', message: 'Ask a question.', resolve: 'POST {"question":"what did I commit to last week?"}.' },
    });
  }
  if (questionRaw.length > MAX_COUNSEL_QUESTION_CHARS || questionRaw.includes(String.fromCharCode(0))) {
    return json(res, 413, {
      error: { code: 'question-too-large', message: 'The meeting question is too long.', resolve: 'Ask one question under 4,000 characters.' },
    });
  }
  const question = questionRaw.trim();

  const hits = lib.recall(question);
  const cited = hits.map((h) => ({ id: h.meeting.id, title: h.meeting.title, startedAt: h.meeting.startedAt, matched: h.matched, lines: h.lines.map((l) => l.id) }));

  // Nothing retrieved: say so in the product's own words. Sending an empty
  // context to a model and hoping it refuses is exactly how a hallucination
  // gets in, so we do not send one.
  if (hits.length === 0) {
    return json(res, 200, {
      ok: true,
      answer: NOT_FOUND,
      unverified: null,
      cites: [],
      ungrounded: [],
      fabricated: [],
      grounded: true,
      hits: cited,
      note: 'No meeting in your archive matched that question, so nothing was sent to a model.',
    });
  }

  const prompt = buildAnswerPrompt(question, hits);
  const model = str(body, 'model') ?? undefined;
  const run = await askLocalModel(ctx, prompt, model);
  if (!run.ok) {
    return json(res, 200, {
      ok: false,
      answer: null,
      unverified: null,
      cites: [],
      ungrounded: [],
      fabricated: [],
      grounded: false,
      hits: cited,
      model: run.model,
      note: run.note,
    });
  }

  const check = groundedAnswer(run.text, hits);
  // `answer` is the field a client renders, so an ungrounded one never goes in
  // it. The text is still returned — under a name no UI would print by
  // accident — because the owner is entitled to see what their machine said
  // and why it was rejected. Leaving it in `answer` with a `grounded:false`
  // flag beside it would make a client's careless `if (d.ok) show(d.answer)`
  // render an invented meeting as fact, and the flag would be doing the work
  // that the field name should be doing. Same shape as the two branches above:
  // when there is no answer that can be trusted, `answer` is null.
  json(res, 200, {
    ok: true,
    answer: check.ok ? run.text : null,
    unverified: check.ok ? null : run.text,
    cites: check.citedIds,
    ungrounded: check.uncited,
    fabricated: check.fabricated,
    grounded: check.ok,
    hits: cited,
    model: run.model,
    note: check.ok
      ? null
      : check.fabricated.length > 0
        ? `The model cited ${check.fabricated.length} missing or ambiguous id(s). This answer is not grounded and must not be shown as fact.`
        : 'Part of this answer carries no citation. The uncited claims are listed; they are not supported by your meetings.',
  });
}
