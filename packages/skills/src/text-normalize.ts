/**
 * Fold a skill's text to the plain-ASCII skeleton a model reads anyway, and
 * quote a match back out of the author's own characters.
 *
 * Split out of `screen.ts`: this is the EVASION half of the module's design —
 * see `screen-rules.ts` for the character classes it folds through and
 * `screen.ts` for how the offset map it produces is used to cut an honest
 * quote out of text that was scanned in its folded form.
 */
import {
  CONFUSABLES,
  INVISIBLE,
  INVISIBLE_CLASS,
  MAX_QUOTE_CHARS,
  UNICODE_DASH,
  UNICODE_QUOTE,
  UNICODE_SPACE,
} from './screen-rules.js';

/**
 * Fold one code point towards the plain-ASCII skeleton a model reads anyway.
 * Returns the replacement, which may be empty (the character is dropped) or longer
 * than one character (`ﬁ` is two letters); the offset map in `fold` is what makes
 * either safe.
 */
function foldChar(ch: string): string {
  if (INVISIBLE.test(ch)) return '';
  if (UNICODE_SPACE.test(ch)) return ' ';
  if (UNICODE_DASH.test(ch)) return '-';
  if (UNICODE_QUOTE.test(ch)) return "'";
  const known = CONFUSABLES.get(ch);
  if (known !== undefined) return known;
  // NFKC is what turns the fullwidth, small-capital, circled and mathematical
  // alphabets back into letters, for free and without a table to maintain.
  const compat = ch.normalize('NFKC');
  if (compat !== ch && /^[\x20-\x7E]+$/.test(compat)) return compat;
  // A letter wearing an accent it does not need: `ígnore` reads as `ignore`.
  const decomposed = ch.normalize('NFD');
  if (decomposed.length > 1 && /^[A-Za-z]$/.test(decomposed[0]!) && /^[\u0300-\u036F]+$/.test(decomposed.slice(1))) {
    return decomposed[0]!;
  }
  return ch;
}

/** A region as the rules see it, plus the way back to the characters the author typed. */
export interface Folded {
  readonly text: string;
  /**
   * `offsets[i]` is the index in the original where folded character `i` came from,
   * with one extra entry at the end holding the original's length. A match at folded
   * `[at, at + len)` is therefore original `[offsets[at], offsets[at + len])` — which
   * is how a finding can be detected on the skeleton and quoted from the real thing.
   */
  readonly offsets: readonly number[];
}

export function fold(text: string): Folded {
  let out = '';
  const offsets: number[] = [];
  let at = 0;
  for (const ch of text) {
    const mapped = foldChar(ch);
    for (let k = 0; k < mapped.length; k += 1) offsets.push(at);
    out += mapped;
    at += ch.length;
  }
  offsets.push(text.length);
  return { text: out, offsets };
}

/** Every invisible character, named, because evidence nobody can see is not evidence. */
const INVISIBLE_GLOBAL = new RegExp('[' + INVISIBLE_CLASS + ']', 'gu');

/**
 * One line of evidence: the invisibles spelled out by codepoint, then whitespace
 * collapsed so a match spanning a wrap still reads. Naming comes first because
 * JavaScript counts U+FEFF as whitespace and would otherwise collapse the proof away.
 */
export function quoteOf(text: string): string {
  const visible = text.replace(
    INVISIBLE_GLOBAL,
    (ch) => '‹U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0') + '›',
  );
  const flat = visible.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_QUOTE_CHARS ? flat : flat.slice(0, MAX_QUOTE_CHARS) + '…';
}
