/**
 * Call presence: "a meeting window looks live on this machine".
 *
 * The daemon does not detect calls itself — it cannot. Window titles are read
 * by the desktop app's meeting-title discovery (packages/desktop/
 * meeting-presence.cjs, reached from the renderer as window.zenoMeeting) and
 * POSTed here by the owner's window. What the daemon adds is one shared,
 * inspectable record of the latest sighting and a `call` event on /stream so
 * every open window (and the e2e harness) sees the same thing at the same time.
 *
 * What a sighting proves — and does not: a matching window title says a
 * capturable window with a meeting-shaped name EXISTS. It does not say the
 * owner joined, is unmuted, or wants notes. That is why the only thing this
 * state ever drives is a banner offering Counsel; nothing here can start a
 * recording, and Counsel's own consent step stays between the banner and the
 * microphone.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';

/** Same bounds the desktop matcher applies, so a posted title cannot be wider than a detected one. */
const MAX_TITLE = 160;
const MAX_APP = 40;

export interface CallSighting {
  /** Stable per (app, title) so a banner dismissed for one call stays dismissed for THAT call only. */
  readonly key: string;
  readonly app: string;
  readonly title: string;
  /** When the window that reported it last saw it. */
  readonly at: string;
}

interface CallState {
  current: CallSighting | null;
  /** The last time ANY report arrived, including "none" — so a stale sighting is distinguishable from a fresh one. */
  checkedAt: string | null;
}

/**
 * Kept beside the route rather than on `ServerCtx` so this feature adds no
 * field to the shared context bag: it is a single in-memory record that no
 * other route reads, and a daemon restart correctly forgets it — a call seen
 * before a restart is not evidence of one now.
 */
const STATES = new WeakMap<ServerCtx, CallState>();

function stateOf(ctx: ServerCtx): CallState {
  let s = STATES.get(ctx);
  if (s === undefined) {
    s = { current: null, checkedAt: null };
    STATES.set(ctx, s);
  }
  return s;
}

function ownerOnly(res: ServerResponse, role: Role, verb: string): boolean {
  if (role === 'owner') return true;
  json(res, 403, {
    error: {
      code: 'owner-only',
      message: `Only the owner's window may ${verb} call presence.`,
      resolve: 'Call detection is a desktop-app signal about the owner\'s own screen; an agent has no use for it.',
    },
  });
  return false;
}

function clean(value: string | null, max: number): string {
  return (value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function keyOf(app: string, title: string): string {
  return createHash('sha256').update(`${app}\0${title.toLocaleLowerCase()}`).digest('hex').slice(0, 24);
}

function payload(s: CallState): Record<string, unknown> {
  return {
    call: s.current,
    checkedAt: s.checkedAt,
    // Stated on every answer so a reader never mistakes a sighting for attendance.
    basis: 'capturable-window-title',
  };
}

/** GET /calls/current — the latest sighting, or null. Owner-only, like the signal that feeds it. */
export function serveCurrentCall(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  if (!ownerOnly(res, role, 'read')) return;
  json(res, 200, payload(stateOf(ctx)));
}

/**
 * POST /calls/detected {candidates: [{app, title}], checkedAt?}
 *
 * An empty list is a real report — "looked, saw none" — and clears the current
 * sighting. The first well-formed candidate becomes current; the desktop lists
 * at most a handful, and one banner is all the owner can act on. Publishes a
 * `call` stream event only when the sighting actually changed, so a window
 * polling every few seconds does not make the banner flicker.
 */
export async function postCallDetected(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (!ownerOnly(res, role, 'report')) return;
  const body = await readJson(req);
  const raw = body['candidates'];
  if (!Array.isArray(raw)) {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'Provide candidates: an array of {app, title}; an empty array means no meeting window is open.',
        resolve: 'POST {"candidates":[{"app":"Zoom","title":"Zoom Meeting"}]} or {"candidates":[]}.',
      },
    });
  }
  let next: CallSighting | null = null;
  const at = new Date().toISOString();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    // The desktop matcher calls the field `provider`; accept either spelling so
    // its result can be forwarded untouched.
    const app = clean(str(record, 'app') ?? str(record, 'provider'), MAX_APP);
    const title = clean(str(record, 'title'), MAX_TITLE);
    if (app === '' || title === '') continue;
    next = { key: keyOf(app, title), app, title, at };
    break;
  }
  const s = stateOf(ctx);
  const changed = (s.current?.key ?? null) !== (next?.key ?? null);
  s.current = next;
  s.checkedAt = at;
  if (changed) ctx.opts.stream.publish('call', payload(s));
  json(res, 200, { ...payload(s), changed });
}
