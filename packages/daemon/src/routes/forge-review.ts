/**
 * The bounded, hash-bound file review the owner sees before a Forge file-write
 * capsule's action: an exact-line diff between the sandbox base and the
 * proposed bytes, built and re-checked against the payload's hashes.
 *
 * Pure — no daemon state. `buildForgeFileReview` and `MAX_FORGE_PROPOSED_
 * FILE_BYTES`'s sibling caps below are exported because `server.ts` and the
 * daemon's tests both still need to import them by that name.
 */
import { fileHash, type WritePayload } from '@abheet19/zeno-kernel';

/** Keep approval diffs responsive even when a model replaces a generated file. */
const FORGE_DIFF_SCAN_CHAR_CAP = 2_000_000;
const FORGE_DIFF_ROW_CAP = 220;
const FORGE_DIFF_LINE_CHAR_CAP = 180;

export interface ForgeReviewFileFacts {
  readonly exists: boolean;
  readonly bytes: number;
  readonly lines: number;
  readonly lineEndings: 'absent' | 'none' | 'LF' | 'CRLF' | 'CR' | 'mixed';
  readonly finalNewline: boolean;
}

/** A bounded, hash-bound review the owner sees before a file-write capsule's action. */
export interface ForgeFileReview {
  readonly version: 1;
  readonly state: 'ready' | 'drifted' | 'unavailable';
  readonly relPath: string;
  readonly expectedBaseHash: string;
  readonly observedBaseHash: string | null;
  readonly expectedPostHash: string;
  readonly observedPostHash: string;
  readonly observed: ForgeReviewFileFacts | null;
  readonly proposed: ForgeReviewFileFacts;
  readonly diff: string | null;
  readonly truncated: boolean;
  readonly omittedDiffLines: number;
  readonly omittedCharacters: number;
  readonly note: string;
}

interface ExactLine {
  readonly text: string;
  readonly ending: '' | '\n' | '\r' | '\r\n';
}

function exactLines(text: string): ExactLine[] {
  if (text === '') return [];
  const out: ExactLine[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\r' && ch !== '\n') continue;
    const ending: ExactLine['ending'] = ch === '\r' && text[i + 1] === '\n' ? '\r\n' : ch;
    out.push({ text: text.slice(start, i), ending });
    if (ending === '\r\n') i++;
    start = i + 1;
  }
  if (start < text.length) out.push({ text: text.slice(start), ending: '' });
  return out;
}

function reviewFacts(contents: string | null): ForgeReviewFileFacts {
  if (contents === null) {
    return { exists: false, bytes: 0, lines: 0, lineEndings: 'absent', finalNewline: false };
  }
  const lines = exactLines(contents);
  const endings = new Set(lines.map((line) => line.ending).filter((ending) => ending !== ''));
  const lineEndings = endings.size === 0
    ? 'none'
    : endings.size > 1
      ? 'mixed'
      : endings.has('\r\n')
        ? 'CRLF'
        : endings.has('\r')
          ? 'CR'
          : 'LF';
  return {
    exists: true,
    bytes: Buffer.byteLength(contents, 'utf8'),
    lines: lines.length,
    lineEndings,
    finalNewline: lines.length > 0 && lines[lines.length - 1]?.ending !== '',
  };
}

function reviewPath(path: string): string {
  return path
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function sameExactLine(a: ExactLine | undefined, b: ExactLine | undefined): boolean {
  return a !== undefined && b !== undefined && a.text === b.text && a.ending === b.ending;
}

function endingMark(ending: ExactLine['ending']): string {
  if (ending === '\r\n') return ' ␍␊';
  if (ending === '\n') return ' ␊';
  if (ending === '\r') return ' ␍';
  return ' ∅';
}

function boundDiffRows(rows: readonly string[]): {
  readonly rows: readonly string[];
  readonly truncated: boolean;
  readonly omittedDiffLines: number;
  readonly omittedCharacters: number;
} {
  let chosen = [...rows];
  let omittedDiffLines = 0;
  if (chosen.length > FORGE_DIFF_ROW_CAP) {
    const head = Math.floor((FORGE_DIFF_ROW_CAP - 1) / 2);
    const tail = FORGE_DIFF_ROW_CAP - head - 1;
    omittedDiffLines = chosen.length - head - tail;
    chosen = [
      ...chosen.slice(0, head),
      `# … ${omittedDiffLines.toLocaleString('en-US')} diff lines omitted by the review bound …`,
      ...chosen.slice(-tail),
    ];
  }

  let omittedCharacters = 0;
  const bounded = chosen.map((line) => {
    if (line.length <= FORGE_DIFF_LINE_CHAR_CAP) return line;
    const omitted = line.length - FORGE_DIFF_LINE_CHAR_CAP;
    omittedCharacters += omitted;
    return `${line.slice(0, FORGE_DIFF_LINE_CHAR_CAP)}… [${omitted.toLocaleString('en-US')} characters omitted]`;
  });
  return {
    rows: bounded,
    truncated: omittedDiffLines > 0 || omittedCharacters > 0,
    omittedDiffLines,
    omittedCharacters,
  };
}

function rangeStart(start: number, count: number): string {
  return count === 0 ? '0,0' : `${start + 1},${count}`;
}

function buildReviewDiff(relPath: string, before: string | null, after: string): {
  readonly diff: string;
  readonly truncated: boolean;
  readonly omittedDiffLines: number;
  readonly omittedCharacters: number;
} {
  const beforeFacts = reviewFacts(before);
  const afterFacts = reviewFacts(after);
  const path = reviewPath(relPath);
  const header = [
    `--- ${before === null ? '/dev/null' : `a/${path}`}`,
    `+++ b/${path}`,
    `# before · ${beforeFacts.bytes.toLocaleString('en-US')} bytes · ${beforeFacts.lines.toLocaleString('en-US')} lines · ${beforeFacts.lineEndings}${beforeFacts.finalNewline ? ' · final newline' : ' · no final newline'}`,
    `# after  · ${afterFacts.bytes.toLocaleString('en-US')} bytes · ${afterFacts.lines.toLocaleString('en-US')} lines · ${afterFacts.lineEndings}${afterFacts.finalNewline ? ' · final newline' : ' · no final newline'}`,
  ];
  const beforeText = before ?? '';
  if (beforeText.length + after.length > FORGE_DIFF_SCAN_CHAR_CAP) {
    return {
      diff: [...header, '# diff body omitted because the two file states exceed the bounded review scan'].join('\n'),
      truncated: true,
      omittedDiffLines: beforeFacts.lines + afterFacts.lines,
      omittedCharacters: beforeText.length + after.length,
    };
  }

  const oldLines = exactLines(beforeText);
  const newLines = exactLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && sameExactLine(oldLines[prefix], newLines[prefix])) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    sameExactLine(oldLines[oldLines.length - suffix - 1], newLines[newLines.length - suffix - 1])
  ) suffix++;

  const context = 3;
  const oldContextStart = Math.max(0, prefix - context);
  const newContextStart = Math.max(0, prefix - context);
  const suffixShown = Math.min(context, suffix);
  const oldChangedEnd = oldLines.length - suffix;
  const newChangedEnd = newLines.length - suffix;
  const oldCount = oldChangedEnd - oldContextStart + suffixShown;
  const newCount = newChangedEnd - newContextStart + suffixShown;
  const body: string[] = [
    `@@ -${rangeStart(oldContextStart, oldCount)} +${rangeStart(newContextStart, newCount)} @@`,
  ];
  for (const line of oldLines.slice(oldContextStart, prefix)) body.push(` ${line.text}${endingMark(line.ending)}`);
  for (const line of oldLines.slice(prefix, oldChangedEnd)) body.push(`-${line.text}${endingMark(line.ending)}`);
  for (const line of newLines.slice(prefix, newChangedEnd)) body.push(`+${line.text}${endingMark(line.ending)}`);
  for (const line of newLines.slice(newChangedEnd, newChangedEnd + suffixShown)) body.push(` ${line.text}${endingMark(line.ending)}`);
  if (beforeText === after) body.push(' # no byte change');

  const bounded = boundDiffRows(body);
  return {
    diff: [...header, ...bounded.rows].join('\n'),
    truncated: bounded.truncated,
    omittedDiffLines: bounded.omittedDiffLines,
    omittedCharacters: bounded.omittedCharacters,
  };
}

/**
 * Build the review from the bytes observed in the sandbox now. A ready review
 * exists only when those bytes match the base hash carried by the action.
 */
export function buildForgeFileReview(payload: WritePayload, observed: string | null): ForgeFileReview {
  const observedBaseHash = fileHash(observed);
  const observedPostHash = fileHash(payload.contents);
  const common = {
    version: 1 as const,
    relPath: payload.relPath,
    expectedBaseHash: payload.expectBaseHash,
    observedBaseHash,
    expectedPostHash: payload.expectPostHash,
    observedPostHash,
    observed: reviewFacts(observed),
    proposed: reviewFacts(payload.contents),
  };
  if (observedPostHash !== payload.expectPostHash) {
    return {
      ...common,
      state: 'unavailable', diff: null, truncated: false, omittedDiffLines: 0, omittedCharacters: 0,
      note: 'The proposed bytes no longer match the post-state hash in the approval payload. Re-propose this edit.',
    };
  }
  if (observedBaseHash !== payload.expectBaseHash) {
    return {
      ...common,
      state: 'drifted', diff: null, truncated: false, omittedDiffLines: 0, omittedCharacters: 0,
      note: 'The sandbox file moved after this action was proposed. No diff is shown against the wrong base; re-propose against the current file.',
    };
  }
  const bounded = buildReviewDiff(payload.relPath, observed, payload.contents);
  return {
    ...common,
    state: 'ready',
    ...bounded,
    note: bounded.truncated
      ? 'This is a bounded diff excerpt. The omitted counts are exact, but approval stays blocked until the change is narrowed or split so the complete before/after diff can be shown.'
      : 'The server re-read this base and matched it to the payload’s expected base hash before building this exact line diff.',
  };
}

export function unavailableForgeFileReview(payload: WritePayload): ForgeFileReview {
  return {
    version: 1,
    state: 'unavailable',
    relPath: payload.relPath,
    expectedBaseHash: payload.expectBaseHash,
    observedBaseHash: null,
    expectedPostHash: payload.expectPostHash,
    observedPostHash: fileHash(payload.contents),
    observed: null,
    proposed: reviewFacts(payload.contents),
    diff: null,
    truncated: false,
    omittedDiffLines: 0,
    omittedCharacters: 0,
    note: 'The server could not re-read the sandbox base safely. Re-propose after checking that the file still exists inside the workspace.',
  };
}
