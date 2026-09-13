/**
 * Forge's permission bridge, isolated browser, and owner-Chrome bridge.
 *
 * These three routes are the daemon's side of a governed run's tool surface:
 * a run gets a per-run credential (`openGateRun`) that opens exactly the
 * routes below, and every operation that arrives through them is either an
 * ordinary approval capsule (`postForgePermission`) or an already-approved
 * operation being carried out (`postForgeBrowse`, `postForgeChrome`). Nothing
 * here decides on its own authority — see server.ts's original commentary,
 * preserved on each function, for why each design choice is load-bearing.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  decidePermission,
  kernelGate,
  type GovernedCall,
  type OwnerChannel,
  type OwnerVerdict,
} from '@abheet19/zeno-forge';
import { BROWSER_UNPROVEN_NOTE, nodeBrowserHost } from '@abheet19/zeno-browse';
import { CHROME_UNPROVEN_NOTE, addOrigin, readOriginPolicy, removeOrigin } from '@abheet19/zeno-chrome';
import type { Preview } from '@abheet19/zeno-kernel';
import type { Role } from '../tokens.js';
import type { ForgeReservation, PendingPermission, ServerCtx } from '../server/context.js';
import { header, json, readJson, str } from './http.js';

/** UI and server agree on the maximum simultaneous coding processes. */
export const MAX_ACTIVE_FORGE_RUNS = 8;

/** One atomic, shared admission gate for explicit and delegated runs. */
export function reserveForgeRun(ctx: ServerCtx, runId: string): ForgeReservation {
  if (ctx.activeForgeRuns.has(runId)) return { ok: false, reason: 'run-id-active' };
  if (ctx.activeForgeRuns.size >= MAX_ACTIVE_FORGE_RUNS) return { ok: false, reason: 'run-limit' };
  const controller = new AbortController();
  ctx.activeForgeRuns.set(runId, controller);
  return { ok: true, controller };
}

export function releaseForgeRun(ctx: ServerCtx, runId: string, controller: AbortController): void {
  // Identity matters if explicit id reuse is ever introduced: a late finish
  // cannot erase a newer controller stored under the same public id.
  if (ctx.activeForgeRuns.get(runId) === controller) ctx.activeForgeRuns.delete(runId);
}

/** What the model is told when nobody ever looked at the capsule. */
const PERMISSION_LAPSED =
  'Nobody approved this call and it has lapsed. Nothing was run. An unanswered request is a refusal ' +
  'here — silence is never taken for agreement.';

/** Constant-time compare, so a run token cannot be recovered a byte at a time. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * The owner's channel for one run: hold the capsule, stream it to the window,
 * and wait.
 *
 * Waiting is the honest cost of this design — the agent's tool call is open
 * while the owner reads it. The ceiling exists so a run cannot hang forever on
 * a window nobody is in front of, and lapsing DENIES: an owner who walked away
 * has agreed to nothing. The window has an Approve control and no decline
 * control yet, so ignoring a capsule is how a command is refused today.
 */
function gateOwnerChannel(ctx: ServerCtx, runId: string): OwnerChannel {
  return {
    decide(preview: Preview, _call: GovernedCall, payload: unknown): Promise<OwnerVerdict> {
      return new Promise<OwnerVerdict>((resolve) => {
        let done = false;
        const settle = (verdict: OwnerVerdict): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          ctx.gateHeld.delete(preview.actionHash);
          resolve(verdict);
        };
        const timer = setTimeout(
          () => settle({ approved: false, reason: PERMISSION_LAPSED }),
          ctx.opts.permissionTimeoutMs ?? 5 * 60_000,
        );
        timer.unref?.();
        ctx.gateHeld.set(preview.actionHash, { preview, payload, runId, settle });
        // The same event a file proposal publishes, so the window renders it
        // with the component it already has: the capsule recomputes the
        // payload hash in front of the owner either way.
        ctx.opts.stream.publish('preview', { ...preview, payload, secretWarning: null });
      });
    },
  };
}

/**
 * Open a governed run: mint its credential and its gate. Returns what the
 * agent process needs in its environment.
 */
export function openGateRun(ctx: ServerCtx, runId: string): { readonly token: string } {
  const token = randomBytes(24).toString('hex');
  ctx.gateRuns.set(runId, {
    token,
    gate: kernelGate({
      kernel: ctx.opts.kernel,
      owner: gateOwnerChannel(ctx, runId),
      // The identity a run proposes under. L6 reads it: the kernel refuses an
      // approval whose approver is the same string, and the /approvals route
      // only ever approves as 'owner'.
      requestedBy: `forge:${runId}`,
      runId,
    }),
  });
  return { token };
}

/**
 * Where the bridge reaches this daemon: the loopback address it is already
 * bound to, read off the live socket rather than guessed from configuration.
 * A guessed port would send the bridge somewhere else, and "somewhere else"
 * answering a permission question is the one thing that must not happen — so
 * a socket that cannot be read yields no URL and the run stays ungated.
 */
export function gateUrl(ctx: ServerCtx): string | null {
  const addr = ctx.server?.address() ?? null;
  if (addr === null || typeof addr === 'string') return null;
  return `http://127.0.0.1:${addr.port}`;
}

/**
 * Close a run: forget its credential, and refuse anything still waiting.
 *
 * A capsule outliving its run would be an approval for a command with nothing
 * left to run it — worse, one the owner could still click. So the run's own
 * end is a denial for everything it left open.
 */
export function closeGateRun(ctx: ServerCtx, runId: string): void {
  ctx.gateRuns.delete(runId);
  for (const [hash, pending] of [...ctx.gateHeld]) {
    if (pending.runId !== runId) continue;
    ctx.gateHeld.delete(hash);
    pending.settle({
      approved: false,
      reason: 'The run this call belonged to has ended, so there is nothing left to grant.',
    });
  }
}

/**
 * Give a run a browser, or don't — and prove it either way.
 *
 * Three conditions, all of which must hold, and the order is the argument:
 * the run must be governed at all (no gate, no browser), the network must be
 * switched on (a navigation IS egress and is rated exactly as WebFetch is),
 * and the window must ANSWER. A subsystem that cannot be proved live costs the
 * run its browser tools — they are absent from the command line rather than
 * merely refused — and the run says so out loud.
 */
export async function openBrowseRun(ctx: ServerCtx, runId: string): Promise<{ readonly granted: boolean; readonly note: string | null }> {
  if (ctx.opts.forgeBrowser === false || ctx.opts.forgeNetwork !== true) return { granted: false, note: null };
  const host = ctx.opts.browserHost ?? nodeBrowserHost();
  let session;
  try {
    session = host.open(runId);
  } catch (err) {
    // A host is not supposed to throw. One that does is exactly the
    // unproven case, never a reason to fall through into a granted capability.
    return { granted: false, note: `${BROWSER_UNPROVEN_NOTE} (the browser host failed — ${(err as Error).message})` };
  }
  let proof;
  try {
    proof = await session.prove();
  } catch (err) {
    proof = { live: false, note: `the browser proof itself failed — ${(err as Error).message}` };
  }
  if (!proof.live) {
    try { session.close(); } catch { /* best effort */ }
    return { granted: false, note: `${BROWSER_UNPROVEN_NOTE} (${proof.note})` };
  }
  ctx.browseRuns.set(runId, session);
  return { granted: true, note: null };
}

/** End a run's browser. The window does not outlive the run that opened it. */
export function closeBrowseRun(ctx: ServerCtx, runId: string): void {
  const session = ctx.browseRuns.get(runId);
  if (session === undefined) return;
  ctx.browseRuns.delete(runId);
  try { session.close(); } catch { /* best effort */ }
}

/**
 * Perform one approved browser operation. Authenticated by the RUN credential,
 * exactly as /forge/permissions is, and handled before the general
 * authentication in `handle()` for the same reason: the bridge holds neither
 * the owner's token nor the proposer's, and should not.
 *
 * This route does not decide. By the time a call arrives the owner has already
 * read a capsule naming the literal URL or the literal element and approved it
 * once, and a receipt exists. What is left is to do the thing.
 */
export async function postForgeBrowse(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const presented = header(req, 'x-zeno-gate') ?? '';
  const body = await readJson(req);
  const runId = str(body, 'runId') ?? '';
  const run = ctx.gateRuns.get(runId);
  if (presented === '' || run === undefined || !sameSecret(presented, run.token)) {
    return json(res, 403, {
      error: {
        code: 'gate-credential-invalid',
        message: 'That is not a live Zeno run credential.',
        resolve: 'A run credential is minted per run and dies with it. Nothing was opened.',
      },
    });
  }
  const session = ctx.browseRuns.get(runId);
  if (session === undefined) {
    return json(res, 200, {
      result: { ok: false, detail: 'This run has no browser. Zeno grants one only when it has proved a window of its own is live.' },
    });
  }
  const result = await session.ask(str(body, 'op') ?? '', body['input']);
  json(res, 200, { result });
}

/**
 * Give a run the owner's Chrome, or don't — and prove it either way.
 *
 * Two conditions before the proof is even attempted: the owner switched the
 * capability on, and the run is governed at all. Then the extension must
 * ANSWER and name the profile it is installed in. A subsystem that cannot be
 * proved live costs the run its Chrome tools — absent from the command line
 * rather than merely refused — and the run says so out loud.
 */
export async function openChromeRun(ctx: ServerCtx, runId: string): Promise<{ readonly granted: boolean; readonly note: string | null }> {
  if (ctx.opts.forgeChrome !== true) return { granted: false, note: null };
  let proof;
  try {
    proof = await ctx.chrome.prove();
  } catch (err) {
    proof = { live: false, note: `the Chrome proof itself failed — ${(err as Error).message}` };
  }
  if (!proof.live) return { granted: false, note: `${CHROME_UNPROVEN_NOTE} (${proof.note})` };
  ctx.chromeRuns.add(runId);
  return { granted: true, note: null };
}

/** A run's grant dies with the run. The browser outlives it; the permission does not. */
export function closeChromeRun(ctx: ServerCtx, runId: string): void {
  ctx.chromeRuns.delete(runId);
}

/** Both host routes carry the same credential, so they check it the same way. */
function chromeHostAuthorised(ctx: ServerCtx, req: IncomingMessage): boolean {
  const presented = header(req, 'x-zeno-chrome') ?? '';
  return ctx.opts.chromeToken !== undefined && presented !== '' && sameSecret(presented, ctx.opts.chromeToken);
}

const chromeHostDenial = {
  error: {
    code: 'chrome-credential-invalid',
    message: 'That is not this Zeno’s Chrome bridge credential.',
    resolve:
      'Re-register the native host against this workspace: node packages/chrome-bridge/install/register-host.mjs <extension-id>',
  },
};

/**
 * The native host's long poll. Authenticated by the CHROME credential, which
 * opens this route and `/chrome/result` and nothing else — it cannot approve,
 * cannot propose, and cannot read the ledger.
 *
 * This route only hands out work the daemon itself created. There is no shape
 * of request here that lets the browser ORIGINATE an operation.
 */
export async function postChromeAttach(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!chromeHostAuthorised(ctx, req)) return json(res, 403, chromeHostDenial);
  await readJson(req);
  const request = await ctx.chrome.take();
  json(res, 200, { request });
}

/** The native host's answer to one operation. Same credential, same two routes. */
export async function postChromeResult(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!chromeHostAuthorised(ctx, req)) return json(res, 403, chromeHostDenial);
  const body = await readJson(req);
  const carry = (name: string): Record<string, string> => {
    const v = str(body, name);
    return v === null || v === '' ? {} : { [name]: v };
  };
  const accepted = ctx.chrome.settle({
    id: typeof body['id'] === 'number' ? body['id'] : -1,
    ok: body['ok'] === true,
    detail: str(body, 'detail') ?? '',
    ...carry('url'),
    ...carry('title'),
    ...carry('text'),
    ...carry('jpeg'),
    ...carry('profile'),
  });
  json(res, 200, { accepted });
}

/**
 * Perform one approved operation in the owner's Chrome. Authenticated by the
 * RUN credential, exactly as /forge/browse is.
 *
 * This route does not decide. By the time a call arrives, the origin has been
 * checked against the owner's allowlist and Zeno's never-list, the owner has
 * read a capsule naming that origin and saying it is their authenticated
 * profile, approved it once, and a receipt exists.
 */
export async function postForgeChrome(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const presented = header(req, 'x-zeno-gate') ?? '';
  const body = await readJson(req);
  const runId = str(body, 'runId') ?? '';
  const run = ctx.gateRuns.get(runId);
  if (presented === '' || run === undefined || !sameSecret(presented, run.token)) {
    return json(res, 403, {
      error: {
        code: 'gate-credential-invalid',
        message: 'That is not a live Zeno run credential.',
        resolve: 'A run credential is minted per run and dies with it. Nothing happened in your browser.',
      },
    });
  }
  if (!ctx.chromeRuns.has(runId)) {
    return json(res, 200, {
      result: {
        ok: false,
        detail:
          'This run was never given your Chrome. Zeno grants it only when you have switched it on and the extension in your own browser has proved itself live.',
      },
    });
  }
  const result = await ctx.chrome.ask(str(body, 'op') ?? '', body['input']);
  json(res, 200, { result });
}

/**
 * The owner's Chrome allowlist, read and changed. OWNER-ONLY, and that is the
 * whole design: adding an origin is a standing decision made deliberately in
 * the Zeno window, never a capsule an agent can raise mid-run. An agent that
 * could request its own allowlist entry would have turned the one decision
 * that bounds this capability into one more click in a stream of clicks.
 */
export async function postChromeOrigins(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can change which sites Zeno may act on in their own Chrome.',
        resolve: 'Do it from the Zeno window.',
      },
    });
  }
  const body = await readJson(req);
  const origin = str(body, 'origin') ?? '';
  if (str(body, 'action') === 'remove') {
    return json(res, 200, { policy: removeOrigin(ctx.chromeOriginsPath, origin) });
  }
  const added = addOrigin(ctx.chromeOriginsPath, origin);
  if (!added.ok) {
    return json(res, 400, {
      error: {
        code: 'chrome-origin-refused',
        message: added.reason,
        resolve: 'Pick an https origin that is not on Zeno’s never-list.',
      },
    });
  }
  json(res, 200, { policy: added.policy, origin: added.origin });
}

/**
 * The bridge's one route. Authenticated by the RUN credential, not by a Zeno
 * token — it is handled before the general authentication in `handle()`
 * because the bridge holds neither the owner's token nor the proposer's, and
 * should not.
 */
export async function postForgePermission(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const presented = header(req, 'x-zeno-gate') ?? '';
  const body = await readJson(req);
  const runId = str(body, 'runId') ?? '';
  const run = ctx.gateRuns.get(runId);
  if (presented === '' || run === undefined || !sameSecret(presented, run.token)) {
    return json(res, 403, {
      error: {
        code: 'gate-credential-invalid',
        message: 'That is not a live Zeno run credential.',
        resolve: 'A run credential is minted per run and dies with it. Nothing was asked of the owner.',
      },
    });
  }
  // Everything about the decision — classifying the call, previewing it,
  // holding it, reading the receipt — happens here, in the one process that
  // holds the kernel. The bridge relays; it does not decide.
  // The owner's Chrome allowlist is read FRESH for every request, not captured
  // when the run started: they may add or remove an origin while a run is in
  // flight, and the decision must be made against what they have decided now.
  const decision = await decidePermission(body['request'], run.gate, readOriginPolicy(ctx.chromeOriginsPath));
  json(res, 200, { decision });
}

/**
 * The owner refusing a tool call outright, rather than letting it lapse.
 *
 * Owner-only for the same reason /approvals is: it decides what an agent may
 * do. A proposer that could deny would be an agent choosing its own outcome —
 * a smaller version of the thing L6 forbids, and still the wrong shape.
 */
export async function postForgePermissionDecline(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner decides a tool call.',
        resolve: 'Decline it from the Zeno window.',
      },
    });
  }
  const body = await readJson(req);
  const actionHash = str(body, 'actionHash');
  const pending: PendingPermission | undefined = actionHash === null ? undefined : ctx.gateHeld.get(actionHash);
  if (pending === undefined) {
    return json(res, 404, {
      error: {
        code: 'unknown-action',
        message: 'No tool call with that hash is waiting.',
        resolve: 'It may already have been answered, or its run may have ended.',
      },
    });
  }
  pending.settle({ approved: false, reason: str(body, 'reason') ?? 'The owner declined this call.' });
  json(res, 200, { declined: actionHash });
}
