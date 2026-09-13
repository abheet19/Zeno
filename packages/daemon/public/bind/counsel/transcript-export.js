/**
 * bind/counsel/transcript-export.js — turning one saved meeting into a
 * downloadable file (Markdown/JSON, wired up by post-view.js's export tab)
 * or an email draft's plain-text body. Pure functions of the meeting record;
 * no daemon calls, no DOM state.
 */
import { fmtDate, fmtMinutes } from './format.js';

export function downloadFile(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

export function callMarkdown(m) {
  const out = [];
  const utter = new Map((m.utterances || []).map((u) => [u.id, u]));
  const cited = (cites) => (cites || []).map((id) => {
    const u = utter.get(id);
    return u ? `\n  > [${id}] ${u.text}` : `\n  > [missing line ${id}]`;
  }).join('');
  out.push(`# ${m.title || 'Untitled call'}`, '');
  out.push(`- **When:** ${fmtDate(m.startedAt)} → ${fmtDate(m.endedAt)}`);
  out.push(`- **Participants:** ${(m.participants || []).join(', ') || 'none named'}`);
  out.push(`- **Lines:** ${(m.utterances || []).length}`);
  out.push(`- **Record id:** ${m.id}`, '');
  const sum = m.summary || {};
  const section = (label, items, fmtItem) => {
    out.push(`## ${label}`);
    if (!items || items.length === 0) out.push(`_Nothing in this call was extracted as ${label.toLowerCase()}._`);
    else for (const it of items) out.push(fmtItem(it));
    out.push('');
  };
  section('Decisions', sum.decisions, (d) => `- (${d.lifecycle}) ${d.text}${cited(d.cites)}`);
  section('Action items', sum.actions, (a) => `- ${a.text} — owner: ${a.owner || 'nobody named'}; due: ${a.due || 'no date said'}${cited(a.cites)}`);
  section('Open questions', sum.questions, (q) => `- ${q.text}${cited(q.cites)}`);
  section('Key points', sum.keyPoints, (k) => `- ${k.text}${cited(k.cites)}`);
  out.push('## Transcript');
  for (const u of (m.utterances || [])) out.push(`- **${u.speaker || 'unknown'}** [${u.id}]: ${u.text}`);
  out.push('', '> Exported from Zeno Counsel — generated locally on this machine; nothing left it.');
  return out.join('\n');
}

export function emailDraftText(m) {
  const sum = m.summary || {};
  const line = (label, items, pick) => {
    const n = (items || []).length;
    const preview = (items || []).slice(0, 3).map(pick).join(' · ');
    return `${label} (${n}): ${n ? preview : 'none found'}`;
  };
  return [
    `Subject: ${m.title || 'Untitled call'} · summary`,
    '',
    line('Decisions', sum.decisions, (d) => d.text),
    line('Action items', sum.actions, (a) => `${a.text}${a.owner ? ' (' + a.owner + ')' : ''}`),
    line('Open questions', sum.questions, (q) => q.text),
  ].join('\n');
}
