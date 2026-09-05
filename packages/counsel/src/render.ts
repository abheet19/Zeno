/**
 * Rendering to plain text. Also pure.
 *
 * Every item shows its citation ids in `[…]`, so the reader can always jump back
 * to the line an item came from. When the transcript is too short to summarize,
 * `renderPartial` says exactly that and shows the little it has — it never fills
 * the gap with an invented summary (the vault brief's honest-partial rule, §33).
 */
import type { MeetingSummary } from './extract.js';
import type { Transcript } from './transcript.js';

function cite(cites: readonly string[]): string {
  return cites.length > 0 ? `[${cites.join(', ')}]` : '[uncited — bug]';
}

/** True when there is too little transcript to summarize without inventing. */
export function tooShortToSummarize(t: Transcript): boolean {
  return t.utterances.length < 2;
}

export function renderSummary(s: MeetingSummary): string {
  const lines: string[] = [];
  lines.push('MEETING SUMMARY');
  lines.push('');

  lines.push('DECISIONS');
  if (s.decisions.length === 0) lines.push('  none extracted');
  for (const d of s.decisions) lines.push(`  · [${d.lifecycle}] ${d.text}   ${cite(d.cites)}`);
  lines.push('');

  lines.push('ACTIONS');
  if (s.actions.length === 0) lines.push('  none extracted');
  for (const a of s.actions) {
    lines.push(`  · ${a.text}   owner: ${a.owner ?? '—'}   due: ${a.due ?? '—'}   ${cite(a.cites)}`);
  }
  lines.push('');

  lines.push('OPEN QUESTIONS');
  if (s.questions.length === 0) lines.push('  none extracted');
  for (const q of s.questions) lines.push(`  · ${q.text}   ${cite(q.cites)}`);
  lines.push('');

  lines.push('KEY POINTS');
  if (s.keyPoints.length === 0) lines.push('  none extracted');
  s.keyPoints.forEach((k, i) => lines.push(`  ${i + 1} · ${k.text}   ${cite(k.cites)}`));

  return lines.join('\n');
}

export function renderPartial(t: Transcript): string {
  const n = t.utterances.length;
  const lines: string[] = [];
  lines.push('TRANSCRIPT TOO SHORT');
  lines.push(`  ${n} line${n === 1 ? '' : 's'} captured — not enough to summarize honestly.`);
  lines.push('  Nothing here is inferred; as the meeting continues this will fill in.');
  if (n > 0) {
    lines.push('  Captured so far:');
    for (const u of t.utterances) lines.push(`    · ${u.speaker}  "${u.text}"   [${u.id}]`);
  }
  return lines.join('\n');
}
