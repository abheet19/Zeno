/**
 * The engine: a consented transcript in, a structured MeetingSummary out. Pure.
 *
 * The four honesty rules from the brief live here, in code:
 *   1. Every extracted item CITES the transcript line(s) it came from. No item
 *      is ever produced without a non-empty `cites`.
 *   2. A decision's lifecycle is EXTRACTED, never invented — `proposed` unless an
 *      agreement phrase actually accompanies it, `disputed` when contradicted.
 *      A tentative remark ("we could maybe…") is never upgraded to a commitment.
 *   3. An owner is never assigned to an action nobody named. Unassigned stays
 *      null.
 *   4. A `due` is read only from an explicit date/day phrase, otherwise null —
 *      never inferred.
 *
 * The whole "understanding" is a set of open, inspectable cue lexicons below —
 * there is no model, and nothing here is stochastic.
 */
import type { Speaker, Transcript, Utterance } from './transcript.js';
import { firstSentence, keywords, norm, phraseMatcher, sentencesOf } from './text.js';

export type Lifecycle = 'proposed' | 'agreed' | 'disputed';

export interface Decision {
  readonly text: string;
  readonly lifecycle: Lifecycle;
  readonly cites: readonly string[];
}
export interface Action {
  readonly text: string;
  /** A named person, the channel that said "I will …", or null when nobody was named. */
  readonly owner: string | null;
  /** An explicit date/day phrase from the sentence, or null. Never inferred. */
  readonly due: string | null;
  readonly cites: readonly string[];
}
export interface OpenQuestion {
  readonly text: string;
  readonly cites: readonly string[];
}
export interface KeyPoint {
  readonly text: string;
  readonly cites: readonly string[];
}
export interface MeetingSummary {
  readonly decisions: readonly Decision[];
  readonly actions: readonly Action[];
  readonly questions: readonly OpenQuestion[];
  readonly keyPoints: readonly KeyPoint[];
}

// ── the cue lexicons — the entire "understanding", in the open ──────────────────

const DECISION_CUES = [
  "we decided", "we've decided", "we have decided", "decided to", "decision is",
  "the decision", "go with", "let's go with", "let us go with", "we'll go with",
  "we will go with", "we're going with", "we are going with", "let's use", "let us use",
  "we'll use", "we will use", "we should use", "we chose", "we choose", "let's adopt",
  "we'll adopt", "the plan is", "we'll proceed with", "proceed with", "settle on",
  "settling on", "final decision", "final call", "we agreed to", "we agreed on",
  "we agreed that", "let's stick with", "stick with", "move forward with",
];

const AGREE_CUES = [
  "we agreed", "we've agreed", "we have agreed", "we agree", "i agree", "agreed",
  "let's do it", "let us do it", "let's do that", "let us do that", "let's do this",
  "sounds good", "sounds great", "that works", "works for me", "that works for me",
  "makes sense", "let's do", "let us do", "we're aligned", "we are aligned",
  "it's decided", "we decided", "we've decided", "final decision", "ship it",
  "i'm on board", "go for it", "yes let's", "yeah let's",
];

const DISPUTE_CUES = [
  "disagree", "i don't agree", "we don't agree", "do not agree", "won't work",
  "will not work", "doesn't work", "does not work", "that won't work", "i object",
  "i'm against", "we're against", "against that", "against it", "bad idea", "let's not",
  "we shouldn't", "i don't think we should", "not convinced", "push back", "pushback",
  "that's wrong", "hold on no",
];

const ACTION_CUES = [
  "i will", "i'll", "i am going to", "i'm going to", "i'm gonna", "i can take",
  "let me", "can you", "could you", "would you", "will you", "we need to", "we have to",
  "we must", "you need to", "you should", "you'll need to", "please ", "make sure",
  "follow up", "follow-up", "action item", "to-do", "todo", "let's schedule",
  "let's set up", "let's create", "let's add", "let's write", "let's update", "let's fix",
  "let's send", "let's draft", "let's file", "i'll send", "i'll take", "i'll write",
  "i'll set up", "i'll follow up", "send me", "we'll need to", "needs to be", "need to be",
];

const EMPHASIS_CUES = [
  "important", "key", "critical", "must", "blocker", "risk", "deadline", "the main",
  "priority", "the point is", "bottom line", "to summarize", "in summary", "the goal",
  "concern", "the issue", "big picture", "takeaway",
];

const DECISION_RE = phraseMatcher(DECISION_CUES);
const AGREE_RE = phraseMatcher(AGREE_CUES);
const DISPUTE_RE = phraseMatcher(DISPUTE_CUES);
const ACTION_RE = phraseMatcher(ACTION_CUES);
const EMPHASIS_RE = phraseMatcher(EMPHASIS_CUES);

/** A named subject that commits to a task — "Priya will …", "Sam is going to …". */
const SUBJECT_ACTION_RE =
  /\b[A-Z][a-z]+\s+(?:will|should|is going to|is gonna|needs to|will take|will handle|will own)\b/;

// ── owners: extracted, never invented ───────────────────────────────────────────

/** Capitalized words that look like names but are not, so we don't invent an owner. */
const NOT_A_NAME = new Set<string>([
  'we', 'i', 'you', 'he', 'she', 'they', 'it', 'let', 'can', 'could', 'would', 'will',
  'please', 'the', 'this', 'that', 'also', 'so', 'and', 'but', 'then', 'now', 'maybe',
  'actually', 'ok', 'okay', 'yes', 'no', 'well', 'our', 'my', 'your', 'next', 'first',
  'second', 'third', 'last', 'today', 'tomorrow', 'tonight', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'report', 'reports', 'docs',
  'doc', 'note', 'notes', 'todo', 'action', 'team', 'everyone', 'someone', 'nobody',
  'there', 'here', 'once', 'after', 'before', 'both', 'either', 'neither', 'because',
  'while', 'since', 'everything', 'nothing',
]);

function extractOwner(sentence: string, speaker: Speaker): string | null {
  // "Sarah, can you …" — a name addressed directly. Filtered through NOT_A_NAME so
  // a leading discourse marker ("Also, can you …", "So, will you …") is never mistaken
  // for a person — the same guard the vocative-end and subject branches below apply.
  const voc = sentence.match(/^\s*([A-Z][a-z]+)\s*,\s*(?:can|could|would|will)\s+you\b/);
  if (voc && voc[1] && !NOT_A_NAME.has(voc[1].toLowerCase())) return voc[1];

  // "…, Sarah?" — but only when the sentence is actually a request aimed at "you".
  const end = sentence.match(/,\s*([A-Z][a-z]+)\s*[?.!]?\s*$/);
  if (end && end[1] && !NOT_A_NAME.has(end[1].toLowerCase()) && /\byou\b/i.test(sentence)) {
    return end[1];
  }

  // "Sarah will …", "Priya is going to …" — a named subject who takes the task.
  const subj = sentence.match(
    /\b([A-Z][a-z]+)\s+(?:will\b|should\b|is going to\b|is gonna\b|needs to\b|will take\b|will handle\b|will own\b)/,
  );
  if (subj && subj[1] && !NOT_A_NAME.has(subj[1].toLowerCase())) return subj[1];

  // First person — "I" is unambiguously the speaker, so the channel IS the owner.
  // Unknown channel means we genuinely cannot attribute it: null, not a guess.
  if (/\b(?:i'll|i will|i am going to|i'm going to|i'm gonna|i can take|let me)\b/.test(norm(sentence))) {
    return speaker === 'unknown' ? null : speaker;
  }
  return null;
}

// ── due dates: read only when explicitly said ───────────────────────────────────

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
// A leading deadline preposition (by/on/before) is dropped; a disambiguating
// qualifier (next/this) is kept, because it says WHICH day is meant.
const DUE_RE = new RegExp(
  '\\b(?:by |on |before )?(' +
    '(?:next |this )?(?:' + WEEKDAYS + ')' + '|' +
    'today|tonight|tomorrow' + '|' +
    'end of (?:day|week|the week)' + '|' +
    'eod|eow' + '|' +
    'this week|next week|this month|next month' + '|' +
    '\\d{4}-\\d{2}-\\d{2}' + '|' +
    '(?:' + MONTHS + ')[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?' + '|' +
    'the \\d{1,2}(?:st|nd|rd|th)' +
  ')\\b',
  'i',
);

function extractDue(sentence: string): string | null {
  const m = DUE_RE.exec(norm(sentence));
  return m && m[1] ? m[1].trim() : null;
}

// ── decision lifecycle: extracted from the surrounding turns ─────────────────────

/**
 * Determine a decision's lifecycle from the decision utterance and the next two
 * turns. Dispute wins over agreement; absent either, it stays `proposed`. When a
 * following turn carries the agreement or dispute, that turn is cited too.
 */
function classifyDecision(
  utt: readonly Utterance[],
  i: number,
): { lifecycle: Lifecycle; cites: string[] } {
  const head = utt[i]!;
  const cites: string[] = [head.id];
  const last = Math.min(utt.length - 1, i + 2);

  for (let j = i; j <= last; j++) {
    const uj = utt[j];
    if (!uj) continue;
    if (DISPUTE_RE.test(norm(uj.text))) {
      if (j !== i) cites.push(uj.id);
      return { lifecycle: 'disputed', cites };
    }
  }
  for (let j = i; j <= last; j++) {
    const uj = utt[j];
    if (!uj) continue;
    if (AGREE_RE.test(norm(uj.text))) {
      if (j !== i) cites.push(uj.id);
      return { lifecycle: 'agreed', cites };
    }
  }
  return { lifecycle: 'proposed', cites };
}

// ── content floor: real speech vs. speech-to-text residue ────────────────────────

/**
 * A line carries real content only if it holds a letter or digit. Pure
 * punctuation or whitespace ("...", "?!", "   ") is speech-to-text residue
 * between real speech — never a key point, and never an open question. Extracted
 * decisions and actions already require a lexical cue, so they cannot be residue;
 * questions (matched only by a trailing "?") and the key-point fallback can, so
 * they are held to this floor.
 */
function hasContent(text: string): boolean {
  return /[a-z0-9]/i.test(text);
}

// ── open questions: asked by "other", not answered by the owner ──────────────────

/** Did the owner take a turn after utterance `i` before the next other-speaker turn? */
function ownerAnsweredAfter(utt: readonly Utterance[], i: number): boolean {
  for (let j = i + 1; j < utt.length; j++) {
    const uj = utt[j];
    if (!uj) continue;
    if (uj.speaker === 'other') return false; // reached the next other turn; owner never took one
    if (uj.speaker === 'owner') return true;
  }
  return false;
}

// ── key points: the salient lines, each cited ────────────────────────────────────

function salience(u: Utterance): number {
  const low = norm(u.text);
  let score = Math.min(keywords(u.text).length, 20);
  if (EMPHASIS_RE.test(low)) score += 8;
  if (DECISION_RE.test(low) || AGREE_RE.test(low)) score += 6;
  if (ACTION_RE.test(low)) score += 5;
  if (u.text.includes('?')) score += 2;
  return score;
}

function selectKeyPoints(utt: readonly Utterance[]): KeyPoint[] {
  // Only utterances that render to real content are ever eligible. A blank,
  // whitespace, or punctuation-only line — the debris a speech-to-text engine
  // emits between real speech — has no key point in it, and the padding
  // fallback below must never dress one up as a salient line.
  const ranked = utt
    .map((u, idx) => ({ u, idx, score: salience(u), text: firstSentence(u.text) }))
    .filter((r) => hasContent(r.text))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const chosen = ranked.filter((r) => r.score > 0).slice(0, 7);
  // Aim for at least three lines, but only ever from real utterances — never padded
  // with invented or empty text. When the transcript cannot supply three lines of
  // real content, we return fewer: an honest partial, not a padded one.
  if (chosen.length < 3) {
    for (const r of ranked) {
      if (chosen.length >= Math.min(3, ranked.length)) break;
      if (!chosen.includes(r)) chosen.push(r);
    }
  }
  return chosen
    .sort((a, b) => a.idx - b.idx)
    .map((r) => ({ text: r.text, cites: [r.u.id] }));
}

// ── the engine ───────────────────────────────────────────────────────────────────

export function summarize(t: Transcript): MeetingSummary {
  const utt = t.utterances;
  const decisions: Decision[] = [];
  const actions: Action[] = [];
  const questions: OpenQuestion[] = [];

  for (let i = 0; i < utt.length; i++) {
    const u = utt[i]!;
    for (const s of sentencesOf(u.text)) {
      const low = norm(s);
      if (DECISION_RE.test(low)) {
        const { lifecycle, cites } = classifyDecision(utt, i);
        decisions.push({ text: s, lifecycle, cites });
      } else if (ACTION_RE.test(low) || SUBJECT_ACTION_RE.test(s)) {
        actions.push({ text: s, owner: extractOwner(s, u.speaker), due: extractDue(s), cites: [u.id] });
      }
    }
    if (u.speaker === 'other') {
      const answered = ownerAnsweredAfter(utt, i);
      for (const s of sentencesOf(u.text)) {
        if (s.endsWith('?') && hasContent(s) && !answered) {
          questions.push({ text: s, cites: [u.id] });
        }
      }
    }
  }

  return { decisions, actions, questions, keyPoints: selectKeyPoints(utt) };
}
