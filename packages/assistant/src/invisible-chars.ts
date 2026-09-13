/**
 * Characters that are invisible, or that reorder what is drawn around them.
 *
 * Split out of `intent.ts` because both `path-safety.ts` (a path is not just a
 * lookup key — it is the sentence the owner reads in the approval preview) and
 * `intent.ts` itself (a task or a summary is prose the owner reads, and the CLI
 * prints straight to a terminal) need the same class of characters scrubbed for
 * the same reason: `src/exe\u202Etxt.js` draws as `src/exesj.txt`, a zero-width
 * space hides a segment boundary, and a C0/C1 escape can move the cursor in a
 * terminal preview. None of these is a legal part of a filename or a sentence
 * anybody meant to write, so they are refused or scrubbed rather than rendered.
 */
const INVISIBLE_CLASS =
  '[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e' +
  '\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]';

/** For a yes/no on a path. Never `/g` — a sticky `lastIndex` would skip every other test. */
export const INVISIBLE = new RegExp(INVISIBLE_CLASS);

/**
 * For scrubbing a summary or a task. `/g` is safe here only because it is
 * handed to `String.replace`, which resets `lastIndex` itself.
 */
export const INVISIBLE_ALL = new RegExp(INVISIBLE_CLASS, 'g');
