/**
 * The chat over the archive — and the honesty boundary that makes it safe.
 *
 * The owner asks "what did I commit to last week?" and a language model answers.
 * A model will happily invent a meeting that never happened, so this module does
 * two things and nothing else:
 *
 *   `buildAnswerPrompt` assembles a GROUNDED prompt. The model sees only the
 *   retrieved excerpts, each labelled with the meeting id and the line ids it
 *   came from, and it is told — in the imperative, before the question — that it
 *   must cite those ids and must refuse when the excerpts do not support an
 *   answer. Nothing about the owner's life reaches the prompt except what
 *   retrieval actually returned.
 *
 *   `groundedAnswer` checks the answer afterwards. Instructions are a request; a
 *   check is a guarantee. An id the model cited must name exactly one source in
 *   `hits`. Missing ids and ambiguous duplicates are unsafe, and are reported so
 *   the caller can refuse to render them. This is
 *   the same rule `summarize` already lives under: every claim cites a real
 *   line, or it does not ship.
 *
 * Both are pure. No fetch, no model, no clock lives here; the daemon owns the
 * call to Ollama and passes the text back in.
 */
import type { Hit } from './library.js';

/** The exact sentence the model is told to use when the excerpts do not support an answer. */
export const NOT_FOUND = 'I could not find that in your meetings.';

/**
 * How much retrieved context the prompt may carry. A local 8B model has a small
 * window, and silently dropping the second half of the evidence would make the
 * answer look grounded while it was not — so the cap is enforced HERE and
 * announced in the prompt itself.
 */
export const DEFAULT_MAX_CHARS = 12_000;

export interface PromptOptions {
  readonly maxChars?: number;
}

export interface Grounding {
  /**
   * True when the answer is safe to render: every id it cited is real, and it
   * either cited something or gave the honest refusal.
   */
  readonly ok: boolean;
  /** The real ids the answer cited, deduped, in first-appearance order. */
  readonly citedIds: readonly string[];
  /** Missing or ambiguous ids the answer cited. Both make the answer unsafe. */
  readonly fabricated: readonly string[];
  /** Claim sentences that carry no valid citation at all. */
  readonly uncited: readonly string[];
}

/** One meeting's excerpt block, rendered. Built separately so the cap can drop whole blocks. */
function excerptBlock(hit: Hit): string {
  const m = hit.meeting;
  const lines: string[] = [];
  lines.push(`--- MEETING ${m.id} — "${m.title}" — ${m.startedAt} ---`);
  if (m.participants.length > 0) lines.push(`participants: ${m.participants.join(', ')}`);
  lines.push(`matched on: ${hit.matched.join(', ')}`);

  const s = m.summary;
  if (s.decisions.length > 0) {
    lines.push('decisions:');
    for (const d of s.decisions) lines.push(`  [${d.cites.join(', ')}] (${d.lifecycle}) ${d.text}`);
  }
  if (s.actions.length > 0) {
    lines.push('actions:');
    for (const a of s.actions) {
      lines.push(`  [${a.cites.join(', ')}] ${a.text} (owner: ${a.owner ?? 'nobody named'}; due: ${a.due ?? 'none said'})`);
    }
  }
  if (s.questions.length > 0) {
    lines.push('open questions:');
    for (const q of s.questions) lines.push(`  [${q.cites.join(', ')}] ${q.text}`);
  }
  if (hit.lines.length > 0) {
    lines.push('transcript lines that matched:');
    for (const u of hit.lines) lines.push(`  [${u.id}] ${u.speaker}: ${u.text}`);
  }
  return lines.join('\n');
}

/**
 * Build the grounded prompt: excerpts FIRST, then the rules, then the question.
 *
 * Excerpts lead because a model that reads the question first starts answering
 * from its own weights and treats the evidence as decoration. The question is
 * last, immediately before generation, so the evidence is what it is holding.
 */
export function buildAnswerPrompt(question: string, hits: readonly Hit[], opts: PromptOptions = {}): string {
  const requestedMaxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  // Treat a caller mistake as an empty context budget rather than letting a
  // negative or fractional value weaken the boundary below.
  const maxChars = Number.isFinite(requestedMaxChars) ? Math.max(0, Math.floor(requestedMaxChars)) : DEFAULT_MAX_CHARS;

  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  let shortened = false;
  for (const hit of hits) {
    const block = excerptBlock(hit);
    const separatorChars = kept.length === 0 ? 0 : 2;
    const available = maxChars - used - separatorChars;
    if (available <= 0) {
      dropped++;
      continue;
    }

    // Preserve whole later meetings: a half excerpt can separate a claim from
    // its citation. The first hit is the sole exception because an empty prompt
    // is less useful; even then, slice it strictly at the configured boundary.
    if (block.length > available) {
      if (kept.length > 0) {
        dropped++;
        continue;
      }
      kept.push(block.slice(0, available));
      used += available;
      shortened = true;
      continue;
    }

    kept.push(block);
    used += separatorChars + block.length;
  }

  const out: string[] = [];
  out.push('You are answering a question about the owner\'s OWN past meetings.');
  out.push('Everything you know about those meetings is in the EXCERPTS below. You have no other source.');
  out.push('');
  out.push('EXCERPTS');
  out.push('');
  if (kept.length === 0) {
    out.push('(none — retrieval found no meeting matching this question)');
  } else {
    out.push(kept.join('\n\n'));
  }
  out.push('');
  if (dropped > 0 || shortened) {
    // Said out loud, in the prompt, because a silently truncated context is how a
    // grounded answer quietly becomes a confident wrong one.
    out.push(
      `(TRUNCATED: ${kept.length} of ${hits.length} matching meetings are shown above; ${dropped} more were cut to fit. ` +
        'If the answer might depend on a meeting not shown, say so.)',
    );
    if (shortened) {
      out.push(`(The shown excerpt itself was shortened to fit the ${maxChars}-character context cap.)`);
    }
    out.push('');
  }
  out.push('RULES');
  out.push('1. Answer ONLY from the excerpts above. Do not use anything you know from elsewhere.');
  out.push('2. Cite the id of every excerpt you use, in square brackets, like [u3] or [m-2026-01-04].');
  out.push('   Use the ids exactly as they appear above. Never invent an id.');
  out.push('3. Every claim in your answer must carry a citation.');
  out.push(
    '4. Do NOT accept the premise of the question. If it assumes something the excerpts do not show — ' +
      'a meeting, a promise, a date — say that the excerpts do not show it instead of confirming it.',
  );
  out.push(`5. If the excerpts do not support an answer, reply with exactly this and nothing else: ${NOT_FOUND}`);
  out.push('   Those words must then be your WHOLE answer. Never refuse and then guess anyway.');
  out.push('6. Be brief. No preamble, no apology, no restating the question.');
  out.push('');
  out.push('QUESTION');
  out.push(question.trim());
  out.push('');
  out.push('ANSWER');
  return out.join('\n');
}

/** Count every citation id so an ambiguous id can never masquerade as evidence. */
function idOccurrences(hits: readonly Hit[]): Map<string, number> {
  const ids = new Map<string, number>();
  const add = (id: string): void => {
    ids.set(id, (ids.get(id) ?? 0) + 1);
  };
  for (const hit of hits) {
    add(hit.meeting.id);
    // Every line of a retrieved meeting counts, not only the ones the prompt had
    // room for. Counting rather than collecting into a Set also exposes legacy
    // archives where multiple meetings reused ids such as `u0`.
    for (const u of hit.meeting.utterances) add(u.id);
  }
  return ids;
}

/** Pull every `[a, b]` bracket group out of the answer and flatten it to ids. */
function citationsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\][]{1,200})\]/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const id = part.trim();
      if (id !== '') out.push(id);
    }
  }
  return out;
}

/** Sentence-ish claims. A bare heading or bullet marker is not a claim. */
function claimsIn(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((s) => /[a-z0-9]/i.test(s));
}

/**
 * The refusal sentence itself, wherever it appears — tolerant of case and of a
 * dropped full stop, because a model reproduces a sentence it was told to use
 * approximately rather than byte for byte.
 *
 * Fresh each call: a `/g` regex carries `lastIndex` between uses, and a shared
 * one would skip the refusal in every other answer.
 */
function refusalPattern(): RegExp {
  const stem = NOT_FOUND.replace(/\.$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${stem}\\.?`, 'gi');
}

/**
 * Check that the model actually cited real ids.
 *
 * The honest refusal is grounded BY DEFINITION — "I could not find that in your
 * meetings" cites nothing because there is nothing to cite, and treating it as
 * ungrounded would punish exactly the behaviour we want.
 *
 * But ONLY when the refusal is the whole answer. The hedge — "I could not find
 * that in your meetings. That said, you did agree to ship on Friday." — is the
 * single most likely way a small local model answers a leading question, and
 * counting it as a refusal would wave the guess through as grounded fact while
 * the honest half of the sentence provides the cover. So the refusal is deleted
 * from the text first: if nothing but punctuation is left, it really was a
 * refusal; if a claim survives, that claim is judged like any other and the
 * whole answer fails unless it cites a real line.
 */
export function groundedAnswer(answerText: string, hits: readonly Hit[]): Grounding {
  const text = answerText.trim();
  const occurrences = idOccurrences(hits);
  const isUnique = (id: string): boolean => occurrences.get(id) === 1;

  const cited: string[] = [];
  const fabricated: string[] = [];
  for (const id of citationsIn(text)) {
    // A duplicate id is not a usable pointer: it names more than one possible
    // source. Report it through the existing unsafe-citation channel so callers
    // that already reject fabrications also reject ambiguous archive evidence.
    const bucket = isUnique(id) ? cited : fabricated;
    if (!bucket.includes(id)) bucket.push(id);
  }

  // What the answer says BESIDES refusing. The refusal is not a claim about the
  // owner's meetings, so it is neither credited as one nor reported as uncited.
  const besideTheRefusal = text.replace(refusalPattern(), ' ');
  const refused = besideTheRefusal !== text;
  if (refused && !/[a-z0-9]/i.test(besideTheRefusal)) {
    return { ok: true, citedIds: [], fabricated: [], uncited: [] };
  }

  const uncited = claimsIn(besideTheRefusal).filter((claim) => !citationsIn(claim).some(isUnique));

  return {
    ok: fabricated.length === 0 && uncited.length === 0 && cited.length > 0,
    citedIds: cited,
    fabricated,
    uncited,
  };
}
