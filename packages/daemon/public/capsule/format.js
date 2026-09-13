/*
 * capsule/format.js — tabular mono formatting for every hash/clock the
 * capsule renders.
 */

const HEAD = 10;
const TAIL = 6;

export function truncHash(s) {
  if (typeof s !== 'string') return '';
  if (s.length <= HEAD + TAIL + 1) return s;
  return s.slice(0, HEAD) + '…' + s.slice(-TAIL);
}

export function fmtClock(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso ?? '');
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtAbsolute(ms) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Countdown as h:mm:ss / mm:ss, tabular. Never negative. */
export function fmtCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
