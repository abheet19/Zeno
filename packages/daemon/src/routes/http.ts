/**
 * Small, stateless HTTP helpers shared by every route module.
 *
 * Nothing here closes over daemon state (no `held`, no `opts`, no kernel) — it
 * is pure request/response plumbing, which is why it lives outside `ServerCtx`
 * entirely: every route module just imports what it needs directly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PolicyError } from '@abheet19/zeno-kernel';

export const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  // The two self-hosted UI faces. Without this they fall through to
  // application/octet-stream, which browsers will still render — but a font
  // served as an unknown blob is the kind of thing that stops working after
  // someone tightens a header, and the whole point of self-hosting them is
  // that the window never has to reach the network for type.
  '.woff2': 'font/woff2',
};

export function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (raw === undefined) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** One matching line, exactly as git reported it. */
export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  /** True when the line was longer than SEARCH_TEXT_CAP and was cut here. */
  readonly clipped: boolean;
}

/**
 * Search's text-per-line cap. A minified bundle is a single line megabytes
 * long and `git grep` will happily hand the whole of it over; this bounds ONE
 * line so `parseGrep` cannot turn that into an unbounded response.
 */
const SEARCH_TEXT_CAP = 400;

/**
 * The NUL separator `git grep -z` frames records with. Built from a char code
 * rather than an escaped source literal, since an escape naming that
 * codepoint does not survive every text pipeline a source file passes
 * through unmangled.
 */
const NUL = String.fromCharCode(0);

/**
 * Parse `git grep -n -z` output: `<path> NUL <line> NUL <text> LF`, repeating.
 *
 * Scanned with a cursor rather than split on a separator, and that is not
 * fussiness — `-z` exists precisely so a path may contain anything, newline
 * included. Splitting the stream on LF would cut such a record in half and
 * report a path fragment as a filename. The NULs are the frame; the LF only
 * ends a record whose text is already known to hold none (grep is line-based,
 * and `-I` has already dropped every file that could carry a stray NUL).
 */
export function parseGrep(stdout: string): GrepMatch[] {
  const out: GrepMatch[] = [];
  let i = 0;
  while (i < stdout.length) {
    const afterPath = stdout.indexOf(NUL, i);
    if (afterPath === -1) break;
    const afterLine = stdout.indexOf(NUL, afterPath + 1);
    if (afterLine === -1) break;
    let end = stdout.indexOf('\n', afterLine + 1);
    if (end === -1) end = stdout.length;
    const n = Number(stdout.slice(afterPath + 1, afterLine));
    // A CRLF working tree leaves the CR on the end of every line git hands back.
    const raw = stdout.slice(afterLine + 1, end).replace(/\r$/, '');
    const clipped = raw.length > SEARCH_TEXT_CAP;
    out.push({
      path: stdout.slice(i, afterPath),
      line: Number.isInteger(n) ? n : 0,
      text: clipped ? raw.slice(0, SEARCH_TEXT_CAP) : raw,
      clipped,
    });
    i = end + 1;
  }
  return out;
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
  res.end(text);
}

/**
 * A code that is definitely NOT the one shown — the mesh self-check uses it to
 * demonstrate that a peer given the wrong code derives a different session and
 * simply cannot talk. Flipping one digit is enough; the codes are 6 digits.
 */
export function otherCode(code: string): string {
  return (code.charAt(0) === '0' ? '1' : '0') + code.slice(1);
}

export function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' ? v : null;
}

/**
 * An optional array of strings. Absent is `[]`; present-but-wrong is null, so
 * the caller can tell "you did not send labels" from "what you sent is not
 * labels" and answer each differently.
 */
export function strings(body: Record<string, unknown>, key: string): string[] | null {
  const v = body[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((e) => typeof e !== 'string')) return null;
  return v as string[];
}

/** The body limit, in bytes. A local daemon still refuses to buffer an unbounded body. */
const MAX_BODY = 1_000_000;

/**
 * The body was too big. A distinct type because it is the CALLER's input being
 * refused, not the daemon breaking: as a generic 500 "internal" it told the
 * owner of a long meeting to "check the daemon output", where they would have
 * found nothing wrong, for a limit that is working exactly as designed.
 */
export class RequestTooLarge extends Error {}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > MAX_BODY) {
      // Over the cap: hold NOTHING from here on — the buffer is dropped and
      // never grows again, so memory stays flat however long the body runs.
      //
      // But keep reading to the end. Throwing out of this loop abandons the
      // async iterator, which destroys the request stream mid-upload and tears
      // the socket down under the client. The refusal still arrived, and then
      // the NEXT request on that keep-alive connection died with a bare
      // ECONNRESET — a legible 413 followed immediately by an illegible network
      // error, which is the whole window going dark one request later. Draining
      // is what buys a connection that still works after the refusal.
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buf);
  }
  if (tooLarge) throw new RequestTooLarge(`Request body is too large (limit ${MAX_BODY / 1_000_000} MB).`);
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/** Every failure leaves as a legible object, never a stack trace to a browser. */
export function fail(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof PolicyError) {
    // A refusal is a normal, expected outcome — it is the product working.
    return json(res, 409, { error: { code: err.code, message: err.message, resolve: err.resolve } });
  }
  if (err instanceof RequestTooLarge) {
    // A body refused MID-UPLOAD leaves unread bytes in the socket. Left alone,
    // the honest 413 was delivered and then the NEXT request on that keep-alive
    // connection died with a bare "fetch failed" — a legible refusal followed
    // immediately by an illegible one, which is the same tab going dark. The
    // connection is closed with the refusal so the client opens a fresh one.
    return json(res, 413, {
      error: {
        code: 'body-too-large',
        message: err.message,
        resolve:
          'Send fewer lines at once. A very long call can be summarised in parts, or saved to the archive and read back from there.',
      },
    });
  }
  const message = err instanceof Error ? err.message : 'Unknown failure';
  json(res, 500, { error: { code: 'internal', message, resolve: 'Check the daemon output.' } });
}
