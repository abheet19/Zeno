/**
 * A recorded meeting: one call, one file, human-readable forever.
 *
 * The Vault's anti-lock-in promise applies here too, and harder — a meeting is
 * the most personal thing Zeno ever writes down. So a Meeting is Markdown with
 * frontmatter, exactly the convention `packages/vault/src/note.ts` uses: the
 * owner can open a call in Notepad, read it, and delete it with the Recycle Bin.
 * Nothing needs Zeno running to be legible, and nothing is encrypted into a
 * format only Zeno can open.
 *
 * Two rules shape the parser:
 *
 *   1. TOLERANT ON THE WAY IN. Windows writes CRLF and PowerShell's `>` writes a
 *      BOM; an editor may reorder frontmatter keys or add a blank line. None of
 *      that is corruption, so none of it is treated as corruption.
 *
 *   2. NEVER THROW, NEVER SILENTLY DROP. A file we cannot read is a FACT the
 *      owner needs — "you have no meetings" and "one of your meetings is
 *      unreadable" are different sentences. So `parseMeeting` returns a result,
 *      not an exception, and it fails the whole file rather than quietly
 *      discarding the one transcript line it could not understand.
 */
import type { Action, Decision, KeyPoint, Lifecycle, MeetingSummary, OpenQuestion } from './extract.js';
import type { Speaker, Utterance } from './transcript.js';

export interface Meeting {
  /** Stable id; also the filename stem. */
  readonly id: string;
  readonly title: string;
  /** ISO-8601. When recording started. */
  readonly startedAt: string;
  /** ISO-8601. When recording stopped. */
  readonly endedAt: string;
  /**
   * Who was in the room, as the OWNER typed them. These are labels the owner
   * tagged, never names Counsel inferred — there is no diarization here and no
   * voice biometrics, so a participant list is testimony, not detection.
   */
  readonly participants: readonly string[];
  readonly utterances: readonly Utterance[];
  readonly summary: MeetingSummary;
}

/** A parse either yields a meeting or says, in one legible sentence, why it did not. */
export type ParsedMeeting =
  | { readonly ok: true; readonly meeting: Meeting }
  | { readonly ok: false; readonly reason: string };

const FM = '---';

/**
 * The field separator inside a body line. A middle dot with spaces around it
 * reads as punctuation to a human and is effectively absent from speech — and
 * `enc` escapes any real one, so the separator is unambiguous even if someone
 * dictates "·" out loud.
 */
const SEP = ' · ';

const SPEAKERS: readonly Speaker[] = ['owner', 'other', 'unknown'];
const LIFECYCLES: readonly Lifecycle[] = ['proposed', 'agreed', 'disputed'];

/** The em-dash placeholder for "there genuinely isn't one" — matches renderSummary. */
const NONE = '—';

// ── frontmatter values (the note.ts convention, verbatim) ────────────────────

function esc(v: string): string {
  // Only quote when needed, and never let a value break the frontmatter block.
  return /[:#\n"]/.test(v) ? JSON.stringify(v) : v;
}

function unesc(v: string): string {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

// ── body values: one item per line, so the file stays greppable ──────────────

/**
 * Escape the four characters that would otherwise change the SHAPE of the file:
 * a backslash (the escape itself), CR and LF (which would split one utterance
 * across two lines), and the separator's middle dot (which would invent a field).
 * Everything else — quotes, brackets, colons — passes through untouched, because
 * a transcript full of `\"` would be unreadable and readability is the point.
 */
function enc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/·/g, '\\·');
}

/** The inverse, in ONE pass — so a literal `\\n` in speech decodes to `\n`, not a newline. */
function dec(s: string): string {
  return s.replace(/\\([\\rn·])/g, (_m, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === '·' ? '·' : '\\',
  );
}

function citeList(cites: readonly string[]): string {
  return `cites: ${cites.map(enc).join(', ')}`;
}

function parseCites(field: string): string[] | null {
  if (!field.startsWith('cites:')) return null;
  return field
    .slice('cites:'.length)
    .split(',')
    .map((c) => dec(c.trim()))
    .filter((c) => c.length > 0);
}

// ── serialize ────────────────────────────────────────────────────────────────

export function serializeMeeting(m: Meeting): string {
  const head = [
    FM,
    `id: ${esc(m.id)}`,
    `title: ${esc(m.title)}`,
    `startedAt: ${m.startedAt}`,
    `endedAt: ${m.endedAt}`,
    `participants: [${m.participants.map(esc).join(', ')}]`,
    FM,
    '',
  ].join('\n');

  const body: string[] = [];

  body.push('## Transcript', '');
  for (const u of m.utterances) {
    body.push(`- ${enc(u.id)}${SEP}${u.at}${SEP}${u.speaker}${SEP}${enc(u.text)}`);
  }
  body.push('');

  body.push('## Decisions', '');
  for (const d of m.summary.decisions) {
    body.push(`- ${d.lifecycle}${SEP}${enc(d.text)}${SEP}${citeList(d.cites)}`);
  }
  body.push('');

  body.push('## Actions', '');
  for (const a of m.summary.actions) {
    const owner = a.owner === null ? NONE : enc(a.owner);
    const due = a.due === null ? NONE : enc(a.due);
    body.push(`- ${enc(a.text)}${SEP}owner: ${owner}${SEP}due: ${due}${SEP}${citeList(a.cites)}`);
  }
  body.push('');

  body.push('## Open questions', '');
  for (const q of m.summary.questions) {
    body.push(`- ${enc(q.text)}${SEP}${citeList(q.cites)}`);
  }
  body.push('');

  body.push('## Key points', '');
  for (const k of m.summary.keyPoints) {
    body.push(`- ${enc(k.text)}${SEP}${citeList(k.cites)}`);
  }

  return head + body.join('\n') + '\n';
}

// ── parse ────────────────────────────────────────────────────────────────────

/** The `- ` item lines under each `## Heading`, keyed by the lower-cased heading. */
function sectionsOf(body: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading && heading[1] !== undefined) {
      current = [];
      out.set(heading[1].trim().toLowerCase(), current);
      continue;
    }
    if (current !== null && line.startsWith('- ')) current.push(line.slice(2));
  }
  return out;
}

function isSpeaker(s: string): s is Speaker {
  return (SPEAKERS as readonly string[]).includes(s);
}

function isLifecycle(s: string): s is Lifecycle {
  return (LIFECYCLES as readonly string[]).includes(s);
}

/**
 * Parse a meeting file. Returns a failure — never throws — so a single corrupt
 * file surfaces in the library's `failed` list instead of taking down a whole
 * archive load.
 */
export function parseMeeting(text: string, fallbackId: string): ParsedMeeting {
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n');
  if (!clean.startsWith(FM + '\n')) {
    return { ok: false, reason: 'No frontmatter block — this file is not a meeting record.' };
  }
  const end = clean.indexOf('\n' + FM, FM.length);
  if (end < 0) {
    return { ok: false, reason: 'The frontmatter block was opened but never closed with a "---" line.' };
  }

  const front = clean.slice(FM.length + 1, end);
  const body = clean.slice(end + 1 + FM.length + 1).replace(/^\n/, '');

  const fields: Record<string, string> = {};
  for (const line of front.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const participants = (fields['participants'] ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((p) => unesc(p))
    .filter((p) => p.length > 0);

  const sections = sectionsOf(body);

  // ---- transcript -----------------------------------------------------------
  const utterances: Utterance[] = [];
  for (const line of sections.get('transcript') ?? []) {
    const parts = line.split(SEP);
    if (parts.length < 4) {
      return { ok: false, reason: `A transcript line is malformed (expected id, time, speaker, text): ${JSON.stringify(line)}` };
    }
    const [id, at, speaker] = parts as [string, string, string, ...string[]];
    if (!isSpeaker(speaker)) {
      return { ok: false, reason: `A transcript line has an unknown speaker channel ${JSON.stringify(speaker)} (expected owner, other or unknown).` };
    }
    utterances.push({ id: dec(id), at, speaker, text: dec(parts.slice(3).join(SEP)) });
  }

  // ---- decisions ------------------------------------------------------------
  const decisions: Decision[] = [];
  for (const line of sections.get('decisions') ?? []) {
    const parts = line.split(SEP);
    if (parts.length < 3) {
      return { ok: false, reason: `A decision line is malformed (expected lifecycle, text, cites): ${JSON.stringify(line)}` };
    }
    const lifecycle = parts[0]!;
    if (!isLifecycle(lifecycle)) {
      return { ok: false, reason: `A decision line has an unknown lifecycle ${JSON.stringify(lifecycle)} (expected proposed, agreed or disputed).` };
    }
    const cites = parseCites(parts[parts.length - 1]!);
    if (cites === null) return { ok: false, reason: `A decision line is missing its "cites:" field: ${JSON.stringify(line)}` };
    decisions.push({ lifecycle, text: dec(parts.slice(1, -1).join(SEP)), cites });
  }

  // ---- actions --------------------------------------------------------------
  const actions: Action[] = [];
  for (const line of sections.get('actions') ?? []) {
    const parts = line.split(SEP);
    if (parts.length < 4) {
      return { ok: false, reason: `An action line is malformed (expected text, owner, due, cites): ${JSON.stringify(line)}` };
    }
    const cites = parseCites(parts[parts.length - 1]!);
    if (cites === null) return { ok: false, reason: `An action line is missing its "cites:" field: ${JSON.stringify(line)}` };
    const dueField = parts[parts.length - 2]!;
    const ownerField = parts[parts.length - 3]!;
    if (!ownerField.startsWith('owner:') || !dueField.startsWith('due:')) {
      return { ok: false, reason: `An action line is missing its "owner:"/"due:" fields: ${JSON.stringify(line)}` };
    }
    const owner = dec(ownerField.slice('owner:'.length).trim());
    const due = dec(dueField.slice('due:'.length).trim());
    actions.push({
      text: dec(parts.slice(0, -3).join(SEP)),
      // An em-dash is how renderSummary writes "nobody was named"; reading it back
      // as the literal string "—" would invent an owner called "—".
      owner: owner === NONE || owner === '' ? null : owner,
      due: due === NONE || due === '' ? null : due,
      cites,
    });
  }

  // ---- open questions and key points ----------------------------------------
  function simpleItems(name: string, label: string): OpenQuestion[] | { reason: string } {
    const out: OpenQuestion[] = [];
    for (const line of sections.get(name) ?? []) {
      const parts = line.split(SEP);
      if (parts.length < 2) return { reason: `A ${label} line is malformed (expected text, cites): ${JSON.stringify(line)}` };
      const cites = parseCites(parts[parts.length - 1]!);
      if (cites === null) return { reason: `A ${label} line is missing its "cites:" field: ${JSON.stringify(line)}` };
      out.push({ text: dec(parts.slice(0, -1).join(SEP)), cites });
    }
    return out;
  }

  const questions = simpleItems('open questions', 'open question');
  if (!Array.isArray(questions)) return { ok: false, reason: questions.reason };
  const keyPoints = simpleItems('key points', 'key point');
  if (!Array.isArray(keyPoints)) return { ok: false, reason: keyPoints.reason };

  const summary: MeetingSummary = {
    decisions,
    actions,
    questions,
    keyPoints: keyPoints as KeyPoint[],
  };

  return {
    ok: true,
    meeting: {
      id: unesc(fields['id'] ?? '') || fallbackId,
      title: unesc(fields['title'] ?? '') || '(untitled meeting)',
      startedAt: fields['startedAt'] ?? '',
      endedAt: fields['endedAt'] ?? (fields['startedAt'] ?? ''),
      participants: [...new Set(participants)],
      utterances,
      summary,
    },
  };
}
