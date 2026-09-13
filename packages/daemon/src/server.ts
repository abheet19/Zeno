/**
 * Zeno Command daemon — the process boundary that makes law L6 structural.
 *
 * In-process, `kernel.approve()` is just a method: "an agent must not approve
 * its own work" is a rule people agree to follow. Here the agent holds only the
 * proposer token, and `POST /approvals` rejects it outright. The agent cannot
 * mint an approval because it has no way to ask for one — not because it is
 * well behaved.
 *
 * Bound to 127.0.0.1 only. This is a single-user local product; there is no
 * reason for the socket to be reachable from the network, so it is not.
 *
 * STRUCTURE. This file used to be the whole daemon — every route handler, a
 * router, and the shared state they all closed over, in one ~5,700-line
 * function. That state now lives in one `ServerCtx` (server/context.ts), and
 * every handler is a plain `handler(ctx, ...)` function in its own module
 * under `routes/`, grouped by domain (approvals, forge-*, counsel, mesh, …).
 * What is left here is exactly three things: assembling `ctx`, the top-level
 * router that dispatches a request to the right handler, and the
 * http.createServer/listen glue that owns the socket.
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { nodeGitRunner, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { Stream } from './stream.js';
import { installBeforeServerClose } from './lifecycle.js';
import { Memory } from '@abheet19/zeno-vault';
import { createMemoryRoutes } from './memory-routes.js';
import { ALLOWLIST_FILE, chromeDesk, readOriginPolicy, type ChromeDesk } from '@abheet19/zeno-chrome';
import { TrustStore } from '@abheet19/zeno-mesh';
import { parseHeld } from './held-store.js';
import { publishMemoryChanged, publishPending, type ServerCtx } from './server/context.js';
import type { DaemonOptions } from './server/options.js';
import { cookie, fail, header, json, readJson } from './routes/http.js';
import { resolveOllamaBaseUrl } from './routes/ollama-lifecycle.js';
import { isStaticish, serveShell, serveStatic, tokenFileLabel } from './routes/static.js';
import { serveReceipts, serveState } from './routes/state.js';
import { serveStream } from './routes/stream.js';
import { postWork, serveWork } from './routes/work.js';
import { postMemory, serveBrief, serveMemory } from './routes/memory.js';
import { postApproval, postApprovalDecline, postPreview } from './routes/approvals.js';
import { postForgeCommit, serveForgeFile, serveForgeSearch, serveForgeStatus } from './routes/forge-git.js';
import {
  postForgeRoute,
  postForgeTerminal,
  postForgeTestRun,
  serveForgeAgents,
  serveForgeTests,
} from './routes/forge-ops.js';
import { serveForgeConnectors, serveForgeExtensions } from './routes/forge-catalog.js';
import { postForgeContext, serveSkills } from './routes/forge-context.js';
import {
  postForgeModelPull,
  postForgeModelRemove,
  serveForgeModelHost,
  serveForgeModelPulls,
} from './routes/forge-models.js';
import {
  deleteMcpServer,
  fireDueScheduledTasks,
  loadMcpServers,
  loadSchedule,
  postMcpServer,
  postSchedule,
  scheduleDelete,
  scheduleRunNow,
  scheduleToggle,
  serveMcpServers,
  serveSchedule,
} from './routes/config.js';
import { postForgeCancel } from './routes/forge-run.js';
import { postForgeRun } from './routes/forge-run-route.js';
import {
  postChromeAttach,
  postChromeOrigins,
  postChromeResult,
  postForgeBrowse,
  postForgeChrome,
  postForgePermission,
  postForgePermissionDecline,
} from './routes/forge-gate.js';
import { postDelegate } from './routes/delegate.js';
import { postAssistantAsk } from './routes/assistant.js';
import {
  deleteMeeting,
  postCounselAsk,
  postCounselSummarize,
  postMeeting,
  serveMeeting,
  serveMeetings,
} from './routes/counsel.js';
import { postMeshPairing, postMeshPairingCancel, postMeshSelfCheck, serveMeshDevices } from './routes/mesh.js';

// ---- re-exports: preserved so existing imports of these names from
// './server.js' (the daemon's own tests, and any external consumer) keep
// working unchanged even though the implementations now live in routes/. ----
export type { DelegateAvailability, DelegateProbe } from './routes/delegate-probe.js';
export { CODEX_HOSTED_BECAUSE, HOSTED_BECAUSE, NO_AGENT_NOTE } from './routes/delegate-probe.js';
export {
  canAutoStartOllama,
  resolveOllamaBaseUrl,
  resolveOllamaExecutable,
  shouldRetryOllamaStart,
} from './routes/ollama-lifecycle.js';
export type { BoundedForgePrompt } from './routes/forge-prompt.js';
export {
  boundForgePrompt,
  localTaskAllowsPlainAnswer,
  localTaskNeedsRepositoryContext,
  MAX_FORGE_EFFECTIVE_PROMPT_CHARS,
} from './routes/forge-prompt.js';
export type { ForgeFileReview } from './routes/forge-review.js';
export { buildForgeFileReview } from './routes/forge-review.js';
export type { ForgeProposalCandidate, ForgeProposalSkipReason } from './routes/forge-text.js';
export { decodeForgeText, readForgeProposalCandidate } from './routes/forge-text.js';
export type { DaemonOptions } from './server/options.js';

export function createServer(opts: DaemonOptions): Server {
  const held: ServerCtx['held'] = new Map();

  // Bring proposals that were waiting when we last stopped back to life. Each is
  // re-registered with the kernel by re-previewing its exact request — the
  // binding is content-addressed, so the same request regenerates the same
  // actionHash and the kernel can approve it again. A record whose action the
  // ledger already settled is dropped rather than resurrected.
  if (opts.heldStore) {
    for (const rec of parseHeld(opts.heldStore.readAll())) {
      try {
        const fresh = opts.kernel.preview(rec.req);
        if (fresh.actionHash !== rec.preview.actionHash || fresh.auto || fresh.denied) continue;
        held.set(fresh.actionHash, { preview: fresh, payload: rec.payload, req: rec.req });
      } catch {
        // A record that no longer previews cleanly (a policy change moved it) is
        // dropped: the owner re-proposes, which is a harmless cost.
      }
    }
  }

  // `ctx` is assigned once, below, after every piece of state it holds has
  // been built. Referenced here (via `let` + definite assignment) only inside
  // closures that are CALLED after that assignment — never read during it —
  // exactly as `memoryRoutes`'s callbacks below do.
  let ctx!: ServerCtx;

  // Forge's own memory write is a kernel action (see memory-gate.ts): preview,
  // owner approval, one commit, a receipt — the same governance every other
  // effect in this file gets. Built here, over the same Vault `/memory` already
  // reads from, and mounted in `handle()` for everything under `/memory/`
  // except the owner's own direct read/write, which stay ungated for the L6
  // reason that module documents.
  const memory = opts.vault ? new Memory(opts.vault) : undefined;
  const memoryRoutes = memory
    ? createMemoryRoutes({
        memory,
        kernel: opts.kernel,
        vaultRef: opts.workspace ?? opts.sandbox,
        projectRoot: opts.sandbox,
        onPendingChanged: () => publishPending(ctx),
        onMemoryChanged: () => publishMemoryChanged(ctx),
        onReceipt: (receipt) => {
          opts.stream.publish('receipt', receipt);
          opts.stream.publish('chain', opts.kernel.verifyChain());
        },
      })
    : undefined;

  // Owner-configured MCP servers and scheduled tasks are persisted to the
  // workspace, if there is one.
  const schedulePath = opts.workspace !== undefined ? join(opts.workspace, 'schedule.json') : null;
  const mcpConfigPath = opts.workspace !== undefined ? join(opts.workspace, 'mcp-servers.json') : null;

  // The owner's Chrome allowlist lives beside the workspace; a daemon with no
  // named workspace keeps its allowlist beside the default one, and the file
  // being absent means an EMPTY allowlist rather than an error.
  const chromeOriginsPath = join(opts.workspace ?? '.zeno', ALLOWLIST_FILE);
  const chrome: ChromeDesk = opts.chromeDeskFor ?? chromeDesk({ policy: () => readOriginPolicy(chromeOriginsPath) });

  ctx = {
    opts,
    server: null,
    held,
    publicRoot: resolve(opts.publicDir),
    runProgressStream: opts.runProgressStream ?? new Stream(200),
    memory,
    memoryRoutes,
    // Forge drives git through the same jailed executor the kernel uses.
    gitRunner: nodeGitRunner(),
    // Forge worktrees live under the OS temp directory rather than the selected
    // sandbox, so their paths must be canonicalised with the real filesystem. A
    // lexical jail alone follows a repository symlink or NTFS junction and can
    // otherwise turn an isolated read/write into a host-filesystem read/write.
    forgeFs: nodeSandboxFs(),
    modelPulls: new Map(),
    ollamaBaseUrl: resolveOllamaBaseUrl(),
    ollamaStarting: null,
    ollamaLastStartAttemptAt: null,
    scheduledTasks: new Map(),
    schedulePath,
    mcpServers: new Map(),
    mcpConfigPath,
    activeTestRunId: null,
    // Forge's permission gate: the credential is minted per RUN and opens
    // exactly one route. See routes/forge-gate.ts for the full reasoning.
    gateRuns: new Map(),
    activeForgeRuns: new Map(),
    gateHeld: new Map(),
    browseRuns: new Map(),
    chromeOriginsPath,
    chrome,
    chromeRuns: new Set(),
    // Mesh: this machine's device identity is minted LAZILY (see routes/mesh.ts
    // `meshIdentity`) and `meshTrust` is the genuine, empty-until-paired store —
    // no pairing has ever been completed, because no second device exists yet.
    meshTrust: new TrustStore(),
    mesh: { self: null, since: '', pairing: null },
  };

  loadSchedule(ctx);
  loadMcpServers(ctx);
  const scheduleTimer = setInterval(() => fireDueScheduledTasks(ctx), 30_000);
  if (typeof scheduleTimer.unref === 'function') scheduleTimer.unref();

  // Held in a const rather than returned straight, because a governed run has to
  // tell its permission bridge where to reach this daemon — and the only honest
  // source for that is the socket the daemon actually bound to.
  const server = createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => fail(res, err));
  });
  ctx.server = server;
  installBeforeServerClose(server, () => {
    for (const controller of ctx.activeForgeRuns.values()) controller.abort();
    ctx.activeForgeRuns.clear();
    clearInterval(scheduleTimer);
  });
  return server;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    // A browser's EventSource cannot set headers, so the shell is served with a
    // cookie and both are accepted. Header first — that is what API clients use.
    const role =
      opts.tokens.roleOf(header(req, 'x-zeno-token')) ??
      opts.tokens.roleOf(cookie(req, 'zeno_token'));

    // ---- the UI (served to a browser, which cannot set a header) -----------
    // CRITICAL: the shell only hands out the owner token to a caller that proves
    // it is the owner's own browser launch — by presenting the one-time launch
    // nonce (?k=), or by already holding the owner cookie from a prior launch.
    // A blind GET / from any other local process gets a READ-ONLY page with no
    // token and no cookie. Without this gate, one unauthenticated loopback GET
    // scraped the owner token and defeated the whole approval boundary.
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const authorized =
        role === 'owner' ||
        (opts.launchNonce !== undefined && url.searchParams.get('k') === opts.launchNonce);
      return serveShell(ctx, res, authorized);
    }
    if (req.method === 'GET' && !path.startsWith('/api') && isStaticish(path)) {
      return serveStatic(ctx, res, path);
    }

    // ---- the permission bridge, which holds neither Zeno token -------------
    //
    // Handled ABOVE the authentication below, and that is the point rather than
    // an exemption. The bridge is a process the Claude Code CLI spawns during a
    // run; giving it the proposer token to get past the check would hand a token
    // to something the agent can read the environment of. Instead it carries a
    // credential minted for one run that opens this one route, and the route
    // checks it itself. Everything it can do is ask a question.
    if (req.method === 'POST' && path === '/forge/permissions') return await postForgePermission(ctx, req, res);
    if (req.method === 'POST' && path === '/forge/browse') return await postForgeBrowse(ctx, req, res);
    if (req.method === 'POST' && path === '/forge/chrome') return await postForgeChrome(ctx, req, res);
    // The native-messaging host's two routes. Its own credential, checked inside
    // each handler — it holds neither Zeno token and must not.
    if (req.method === 'POST' && path === '/chrome/attach') return await postChromeAttach(ctx, req, res);
    if (req.method === 'POST' && path === '/chrome/result') return await postChromeResult(ctx, req, res);

    // ---- everything below is authenticated ---------------------------------
    //
    // Two different failures, and they had one answer between them. "You sent no
    // token" and "you sent a token this daemon has never issued" need opposite
    // things done about them, and the second is the common one on this machine:
    // tokens are minted per PROCESS, so a `proposer.token` read out of the wrong
    // workspace — or out of the right workspace after a restart — is a perfectly
    // well-formed credential belonging to some other daemon. Answering that with
    // "this endpoint needs a Zeno token" sends the owner looking for a header
    // they already sent.
    //
    // The old `resolve` then compounded it: "The daemon prints both tokens on
    // startup." It prints NEITHER. The proposer token is written to
    // <workspace>/proposer.token precisely so a live credential stays out of
    // shell scrollback, and the owner token is handed only to an authorised
    // window. The fix told the owner to go read something that does not exist.
    if (role === null) {
      // An EMPTY header or cookie is "none sent", not "a token that was wrong":
      // the read-only shell is served with an empty meta token on purpose, and
      // its fetches must not be told their credential was rejected.
      const sent = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';
      const presented = sent(header(req, 'x-zeno-token')) || sent(cookie(req, 'zeno_token'));
      return json(res, 401, {
        error: {
          code: presented ? 'token-not-recognised' : 'unauthenticated',
          message: presented
            ? 'That token is not one this daemon issued.'
            : 'This endpoint needs a Zeno token, and none was sent.',
          resolve: presented
            ? 'Tokens are minted fresh by each daemon process, so one from another workspace — or ' +
              'from a previous run of this one — is never valid here. Re-read the proposer token ' +
              `from ${tokenFileLabel(ctx)}, and check that ZENO_DIR and ZENO_PORT name the same Zeno ` +
              'you meant.'
            : `Send it as the "x-zeno-token" header. The proposer token is in ${tokenFileLabel(ctx)}; ` +
              'it is never printed, because a live credential does not belong in a log. The owner ' +
              'token is only ever handed to the window this daemon serves, by opening the ?k= URL ' +
              'it announced.',
        },
      });
    }

    if (req.method === 'GET' && path === '/state') return serveState(ctx, res, role);
    if (req.method === 'GET' && path === '/receipts') return serveReceipts(ctx, res, url);
    if (req.method === 'GET' && path === '/stream') return serveStream(ctx, req, res);
    if (req.method === 'GET' && path === '/forge/run-progress') {
      if (role !== 'owner') {
        return json(res, 403, {
          error: {
            code: 'owner-only',
            message: 'Only the owner can subscribe to Forge run progress.',
            resolve: 'Open Forge from the Zeno owner window.',
          },
        });
      }
      return serveStream(ctx, req, res, ctx.runProgressStream);
    }
    // Work is READ and ADDED by either role, deliberately. Noticing that
    // something needs doing is not deciding to do it; the line L6 draws is at
    // /approvals, and drawing a second one here would only teach the owner that
    // Zeno asks about things it does not need to ask about.
    if (req.method === 'GET' && path === '/work') return await serveWork(ctx, res);
    if (req.method === 'POST' && path === '/work') return await postWork(ctx, req, res);
    if (req.method === 'GET' && path === '/memory') return serveMemory(ctx, res, url);
    // Everything under /memory/ (propose, approvals, pending, recall, context,
    // delete) is the gated module. /memory itself stays above: GET is the plain
    // read the UI already polls, and POST is the owner's own ungated write —
    // see the L6 reasoning in memory-routes.ts for why that one is not gated.
    if (ctx.memoryRoutes && path !== '/memory' && path.startsWith('/memory/')) {
      const result = await ctx.memoryRoutes.handle(req.method ?? '', path, url.searchParams, role, () => readJson(req));
      if (result) return json(res, result.status, result.body);
    }
    if (req.method === 'POST' && path === '/memory') return await postMemory(ctx, req, res, role);
    if (req.method === 'GET' && path === '/brief') return serveBrief(ctx, res);
    if (req.method === 'POST' && path === '/previews') return await postPreview(ctx, req, res, role);
    if (req.method === 'POST' && path === '/approvals') return await postApproval(ctx, req, res, role);
    if (req.method === 'POST' && path === '/approvals/decline') return await postApprovalDecline(ctx, req, res, role);
    if (req.method === 'GET' && path === '/forge/status') return serveForgeStatus(ctx, res);
    if (req.method === 'GET' && path === '/forge/file') return serveForgeFile(ctx, res, url);
    if (req.method === 'GET' && path === '/forge/search') return serveForgeSearch(ctx, res, url);
    if (req.method === 'POST' && path === '/forge/commit') return await postForgeCommit(ctx, req, res, role);
    if (req.method === 'POST' && path === '/forge/terminal') return await postForgeTerminal(ctx, req, res, role);
    if (req.method === 'GET' && path === '/forge/tests') return serveForgeTests(ctx, res);
    if (req.method === 'POST' && path === '/forge/tests/run') return await postForgeTestRun(ctx, req, res, role);
    if (req.method === 'GET' && path === '/forge/extensions') return serveForgeExtensions(ctx, res);
    if (req.method === 'GET' && path === '/forge/connectors') return serveForgeConnectors(ctx, res);
    if (req.method === 'GET' && path === '/skills') return serveSkills(ctx, res);
    if (req.method === 'GET' && path === '/forge/agents') {
      return await serveForgeAgents(ctx, res, url.searchParams.get('passive') !== '1');
    }
    // Add a model natively: pull it from the Ollama registry (owner-only, egress
    // disclosed by the window). GET reports live download progress for polling.
    if (req.method === 'POST' && path === '/forge/models/pull') return await postForgeModelPull(ctx, req, res, role);
    if (req.method === 'GET' && path === '/forge/models/pull') return serveForgeModelPulls(ctx, res, url);
    if (req.method === 'POST' && path === '/forge/models/remove') return await postForgeModelRemove(ctx, req, res, role);
    if (req.method === 'GET' && path === '/forge/models/host') return await serveForgeModelHost(ctx, res);
    // Scheduled tasks: a timed trigger that adds a work item (which still needs
    // approval). List is legible to either role; changing the schedule is owner-only.
    if (req.method === 'GET' && path === '/schedule') return serveSchedule(ctx, res);
    if (req.method === 'POST' && path === '/schedule') return await postSchedule(ctx, req, res, role);
    if (req.method === 'POST' && path.startsWith('/schedule/') && path.endsWith('/toggle')) return scheduleToggle(ctx, res, role, path);
    if (req.method === 'POST' && path.startsWith('/schedule/') && path.endsWith('/run')) return scheduleRunNow(ctx, res, role, path);
    if (req.method === 'DELETE' && path.startsWith('/schedule/')) return scheduleDelete(ctx, res, role, path);
    // Owner-configured MCP servers (the Customize surface). Recorded config only;
    // admitting a server into a governed run is a separate gated layer.
    if (req.method === 'GET' && path === '/forge/mcp/servers') return serveMcpServers(ctx, res);
    if (req.method === 'POST' && path === '/forge/mcp/servers') return await postMcpServer(ctx, req, res, role);
    if (req.method === 'DELETE' && path.startsWith('/forge/mcp/servers/')) return deleteMcpServer(ctx, res, role, path);
    if (req.method === 'POST' && path === '/forge/context') return await postForgeContext(ctx, req, res);
    if (req.method === 'POST' && path === '/forge/route') return await postForgeRoute(ctx, req, res, role);
    if (req.method === 'POST' && path === '/forge/run/cancel') return await postForgeCancel(ctx, req, res, role);
    if (req.method === 'POST' && path === '/forge/run') return await postForgeRun(ctx, req, res, role);
    // Which sites Zeno may act on in the owner's OWN Chrome. Owner-only, and
    // deliberately not reachable by an agent under any credential.
    if (req.method === 'POST' && path === '/chrome/origins') return await postChromeOrigins(ctx, req, res, role);
    if (req.method === 'GET' && path === '/chrome/origins') {
      return json(res, 200, { policy: readOriginPolicy(ctx.chromeOriginsPath), attached: ctx.chrome.attached() });
    }
    if (req.method === 'POST' && path === '/forge/permissions/decline') {
      return await postForgePermissionDecline(ctx, req, res, role);
    }
    // Delegation. Not owner-gated at the route, because the ANSWER is legible to
    // either role — a proposer is told what would run and that only the owner can
    // start it. `resolveDelegation` is where the role decides whether anything
    // actually starts, and a hosted agent starts from neither.
    if (req.method === 'POST' && path === '/delegate') return await postDelegate(ctx, req, res, role);
    if (req.method === 'POST' && path === '/assistant/ask') return await postAssistantAsk(ctx, req, res, role);
    if (req.method === 'POST' && path === '/counsel/summarize') return await postCounselSummarize(req, res);
    if (req.method === 'GET' && path === '/counsel/meetings') return serveMeetings(ctx, res);
    if (req.method === 'POST' && path === '/counsel/meetings') return await postMeeting(ctx, req, res, role);
    if (req.method === 'GET' && path.startsWith('/counsel/meetings/')) return serveMeeting(ctx, res, path);
    if (req.method === 'DELETE' && path.startsWith('/counsel/meetings/')) return deleteMeeting(ctx, res, path, role);
    if (req.method === 'POST' && path === '/counsel/ask') return await postCounselAsk(ctx, req, res);
    if (req.method === 'GET' && path === '/mesh/devices') return serveMeshDevices(ctx, res, role);
    if (req.method === 'POST' && path === '/mesh/pairing') return postMeshPairing(ctx, res, role);
    if (req.method === 'POST' && path === '/mesh/pairing/cancel') return postMeshPairingCancel(ctx, res, role);
    if (req.method === 'POST' && path === '/mesh/selfcheck') return postMeshSelfCheck(ctx, res, role);

    return json(res, 404, {
      error: { code: 'not-found', message: `No route for ${req.method} ${path}.`, resolve: 'Check the URL.' },
    });
  }
}
