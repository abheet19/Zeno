/**
 * Is a suggested path safe to write, and what to normalise it to. Split out of
 * `intent.ts`: this is a complete argument on its own, about what makes a
 * repo-relative path safe to show the owner in an approval preview and safe to
 * hand to the kernel, independent of how the model's answer was parsed into a
 * candidate string in the first place.
 */
import { INVISIBLE } from './invisible-chars.js';

/** How long a suggested path may be. */
const MAX_PATH = 200;

/**
 * Windows device names. `CON`, `NUL`, `COM1` and friends are not files: opening
 * `src/NUL` opens the null device, and a path ending in one is a way to make a
 * write go somewhere nobody previewed. Windows-first means this is a real case,
 * not a curiosity, and the check is on the stem so `NUL.txt` is caught too.
 *
 * The list is Microsoft's, not a memory of it: `COM0`/`LPT0`, the superscript
 * `COM¹`/`COM²`/`COM³` forms, and the console handles `CONIN$`/`CONOUT$` are all
 * reserved. `CONOUT$` in particular is live on Windows 11 today — redirecting to
 * it writes to the console and produces no file at all, so a preview that said
 * "creates src/CONOUT$" would have described a write that never happened.
 */
const DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
  'COM0', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT0', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'COM\u00b9', 'COM\u00b2', 'COM\u00b3', 'LPT\u00b9', 'LPT\u00b2', 'LPT\u00b3',
]);

/**
 * The device name Windows would actually see in this segment.
 *
 * Win32 cuts the name at the first `.` and THEN discards trailing spaces, so
 * `NUL .txt` and `NUL` are the same name. Reading the stem without that trim
 * lets a device through behind one space.
 */
function deviceStem(segment: string): string {
  return (segment.split('.')[0] ?? '').replace(/[ \t]+$/, '').toUpperCase();
}

/** Characters Windows forbids outright. Colon also kills `C:\…` and `file.ts:ads`. */
const FORBIDDEN = /[:*?"<>|]/;

/**
 * Is this string safe read as a repo-relative path? No normalising, no repair —
 * a yes or a no, so it can be asked of more than one reading of the same text.
 */
function shapeIsSafe(candidate: string): boolean {
  if (candidate === '' || candidate.length > MAX_PATH) return false;
  if (FORBIDDEN.test(candidate) || INVISIBLE.test(candidate)) return false;

  const slashed = candidate.replace(/\\/g, '/');
  if (slashed.startsWith('/')) return false; // absolute, or a UNC share once backslashes are folded
  if (slashed.startsWith('~')) return false; // a home-relative path is not repo-relative

  for (const seg of slashed.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
    if (/[. ]$/.test(seg)) return false; // Windows strips these; the preview would lie
    if (DEVICE_NAMES.has(deviceStem(seg))) return false;
  }
  return true;
}

/**
 * Normalise a suggested path, or refuse it.
 *
 * The jail is proved by SHAPE, before anything touches a filesystem: a path that
 * cannot escape textually cannot escape at all. Refused: anything absolute
 * (`/etc`, `C:\`, a UNC `\\server\share`), anything containing `..`, anything
 * with a character Windows forbids, an invisible or a reordering character, an
 * empty or `.` segment, a Windows device name, and a segment ending in a dot or
 * a space (Windows silently strips those, so `evil.ts.` and `evil.ts` are the
 * same file — which is exactly how a preview and a write end up disagreeing).
 *
 * THE SHAPE IS CHECKED TWICE: once as written, and once as Unicode NFKC. `‥／‥／`
 * is four ordinary characters here and `../../` after any consumer folds it, and
 * `Ｃ：` becomes a drive letter the same way. Nothing in this package normalises
 * a path, but this string is handed onward and something downstream might — so a
 * string that is safe in one reading and an escape in the other is refused in
 * both. The value RETURNED is always derived from what the model actually wrote:
 * refusing is safe, but silently handing the owner a path to approve that is not
 * the one they were shown would be the exact failure this seam exists to prevent.
 */
export function normalizeRelPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!shapeIsSafe(trimmed)) return null;
  if (!shapeIsSafe(trimmed.normalize('NFKC'))) return null;
  return trimmed.replace(/\\/g, '/');
}
