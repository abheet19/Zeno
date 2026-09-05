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
 */
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import {
  Kernel,
  PolicyError,
  assessWrite,
  jail,
  makeWritePayload,
  worktreeExecutor,
  jailPath,
  gitExecutor,
  gitHead,
  makeCommitPayload,
  nodeGitRunner,
  NO_COMMITS,
  type ActionKind,
  type ActionRequest,
  type Preview,
  type SandboxFs,
  type WritePayload,
} from '@abheet19/zeno-kernel';
import { buildSkillPrompt, loadLibrary, nodeSkillReader } from '@abheet19/zeno-skills';
import { Stream } from './stream.js';
import { sanitize } from '@abheet19/zeno-sanitizer';
import { buildBrief, renderBrief, type Vault } from '@abheet19/zeno-vault';
import {
  summarize,
  renderSummary,
  renderPartial,
  tooShortToSummarize,
  transcriptOf,
  buildAnswerPrompt,
  groundedAnswer,
  NOT_FOUND,
  type Meeting,
  type Meetings,
  type Utterance,
} from '@abheet19/zeno-counsel';
import { AGENTS, CLAUDE_BINARY, EFFORTS, createWorktree, diffFiles, nodeSpawner, runAgent } from '@abheet19/zeno-forge';
import {
  buildSnapshot,
  buildAssistantPrompt,
  describeTruncation,
  groundReply,
  parseIntent,
} from '@abheet19/zeno-assistant';
import {
  TrustStore,
  acceptPairing,
  beginPairing,
  completePairing,
  createIdentity,
  type Identity,
  type PairingOffer,
} from '@abheet19/zeno-mesh';
import { parseHeld, serializeHeld, type HeldStore } from './held-store.js';
import type { WorkDesk } from './work.js';
import type { Role, Tokens } from './tokens.js';

export interface DaemonOptions {
  readonly kernel: Kernel;
  /** Absolute path to the sandbox root. Nothing is written outside it. */
  readonly sandbox: string;
  readonly fs: SandboxFs;
  readonly tokens: Tokens;
  readonly stream: Stream;
  /** Absolute path to the static UI directory. */
  readonly publicDir: string;
  /** Where work arrives from: the local backlog, and GitHub when configured. */
  readonly work: WorkDesk;
  /**
   * Durable home for proposals that are waiting on the owner. When given, open
   * capsules survive a restart instead of vanishing. Omit for an in-memory daemon.
   */
  readonly heldStore?: HeldStore;
  /** Governed local memory. When given, /memory and /brief are served. */
  readonly vault?: Vault;
  /**
   * The meeting archive. When given, the Counsel tab has a dashboard and a chat:
   * /counsel/meetings and /counsel/ask are served. Omit for a daemon with no
   * meeting store — /counsel/summarize still works, because summarising is pure.
   */
  readonly meetings?: Meetings;
  /**
   * One-time secret the owner's browser presents (as ?k=) to be trusted with the
   * owner token. Without it, GET / serves a read-only page. This is what stops a
   * blind local GET from scraping the owner token.
   */
  readonly launchNonce?: string;
  /**
   * How the daemon finds out WHICH agent a delegation would run on this machine.
   *
   * Injected so the three branches — a local model is installed, only the hosted
   * CLI is, neither is — are drivable in a test without an Ollama on the machine
   * or a `claude` on PATH. Omit for the real probes: Ollama's `/api/tags` over
   * loopback, and one `claude --version`.
   */
  readonly delegateProbe?: DelegateProbe;
}

/**
 * What is actually installed here, as facts rather than assumptions.
 *
 * Both fields are read from the machine, never guessed: an empty `localModels`
 * means Ollama answered and had nothing pulled, or was not running at all, and
 * `claudeOnPath: false` means a `claude --version` could not be spawned. When
 * both are empty the honest answer to "build me a thing" is that there is
 * nothing here to build it with — never a fabricated start.
 */
export interface DelegateAvailability {
  readonly localModels: readonly string[];
  readonly claudeOnPath: boolean;
}

/** The probe as one injectable function. Total: it reports, it never throws. */
export interface DelegateProbe {
  available(): Promise<DelegateAvailability>;
}

/**
 * The sentence the owner is shown before a HOSTED agent runs, and the reason
 * that agent does not start from a spoken sentence alone.
 *
 * Running an agent produces PROPOSALS, not effects — every file it writes still
 * stops at the gate — so launching one is not itself a consequential act and
 * needs no approval capsule. But it SPENDS something real, and the two rungs
 * spend differently. A local model spends GPU time on a machine the owner
 * already owns and the code never leaves. A hosted one spends the owner's money
 * and sends their code to somebody else's computer. The second is not something
 * to infer from a sentence someone said out loud across the room, so it is put
 * in front of them in these words and waits for a click.
 */
export const HOSTED_BECAUSE =
  'this sends your code to Anthropic and spends your Claude usage';

/** What is said when there is no agent on this machine at all. */
export const NO_AGENT_NOTE =
  'Nothing ran, and nothing was started. There is no coding agent on this machine to run it: ' +
  'Ollama reported no local model (start it and pull one, e.g. ollama pull qwen3:8b), and the ' +
  'claude CLI is not runnable from here. Your task was not sent anywhere.';

/**
 * Thrown when the throwaway worktree could not be made — so the agent never ran.
 *
 * Its own type, at module scope, because two callers need to tell it apart from
 * a failure INSIDE a run: `/forge/run` turns it into a 409 carrying git's
 * reason, and a delegation reports a NON-start with that reason rather than a
 * start with nothing to show.
 */
class WorktreeUnavailable extends Error {}

/** What is said when a delegation arrives on the proposer token. */
const DELEGATE_OWNER_ONLY =
  'Only the owner starts an agent. This answer suggested one; nothing was started.';

/** A proposal the daemon is holding between preview and approval. */
interface Held {
  readonly preview: Preview;
  readonly payload: WritePayload;
  readonly req: ActionRequest;
}

/**
 * A pairing this machine has STARTED: the invite it would transmit, and the
 * short code it is showing for a human to carry to the other device. It is only
 * half a pairing, and it cannot become a whole one until a second device exists
 * to answer — see the Mesh routes for what the daemon says about that.
 */
interface MeshPairing {
  readonly offer: PairingOffer;
  readonly startedAt: string;
}

const MIME: Readonly<Record<string, string>> = {
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

/**
 * Forge's two read caps. Both exist so a large repository degrades into a
 * SMALLER honest answer rather than a slow one, and both are reported back in
 * the response (`trackedCapped`, `truncated`) so the window can say it is
 * showing a part rather than implying it is showing the whole.
 */
const TREE_CAP = 2000;
const FILE_LINE_CAP = 4000;

export function createServer(opts: DaemonOptions): Server {
  const held = new Map<string, Held>();
  const publicRoot = resolve(opts.publicDir);

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

  /** Write the open proposals through, if a store is configured. */
  function persistHeld(): void {
    opts.heldStore?.writeAll(serializeHeld(held.values()));
  }

  // Forge drives git through the same jailed executor the kernel uses. Declared
  // here, before the server is returned — a const after the return never runs.
  const gitRunner = nodeGitRunner();
  const gitSpec = () => ({ repoRoot: opts.sandbox, git: gitRunner, fs: opts.fs });

  // ---- Mesh: this machine's device identity, and who it trusts -------------
  //
  // The identity is minted LAZILY, on the first mesh request, and lives only in
  // memory. `Identity.privateKey` is a KeyObject the mesh package deliberately
  // never exports, serializes or logs, so there is nothing to write to disk
  // without breaking that rule. The consequence is real and the window says it
  // out loud: this machine's device id changes every time the daemon restarts.
  //
  // `meshTrust` is the genuine TrustStore, not a stand-in. It is empty because
  // no pairing has ever been completed — and none can be, until a second device
  // exists — and it would fill the moment one was. Nothing writes to it here.
  let meshSelf: Identity | null = null;
  let meshSince = '';
  const meshTrust = new TrustStore();
  let meshPairing: MeshPairing | null = null;

  function meshIdentity(): Identity {
    if (meshSelf === null) {
      meshSelf = createIdentity();
      meshSince = new Date().toISOString();
    }
    return meshSelf;
  }

  return createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => fail(res, err));
  });

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
      return serveShell(res, authorized);
    }
    if (req.method === 'GET' && !path.startsWith('/api') && isStaticish(path)) {
      return serveStatic(res, path);
    }

    // ---- everything below is authenticated ---------------------------------
    if (role === null) {
      return json(res, 401, {
        error: {
          code: 'unauthenticated',
          message: 'This endpoint needs a Zeno token.',
          resolve: 'Send it as the "x-zeno-token" header. The daemon prints both tokens on startup.',
        },
      });
    }

    if (req.method === 'GET' && path === '/state') return serveState(res);
    if (req.method === 'GET' && path === '/receipts') return serveReceipts(res, url);
    if (req.method === 'GET' && path === '/stream') return serveStream(req, res);
    // Work is READ and ADDED by either role, deliberately. Noticing that
    // something needs doing is not deciding to do it; the line L6 draws is at
    // /approvals, and drawing a second one here would only teach the owner that
    // Zeno asks about things it does not need to ask about.
    if (req.method === 'GET' && path === '/work') return await serveWork(res);
    if (req.method === 'POST' && path === '/work') return await postWork(req, res);
    if (req.method === 'GET' && path === '/memory') return serveMemory(res, url);
    if (req.method === 'POST' && path === '/memory') return await postMemory(req, res);
    if (req.method === 'GET' && path === '/brief') return serveBrief(res);
    if (req.method === 'POST' && path === '/previews') return await postPreview(req, res, role);
    if (req.method === 'POST' && path === '/approvals') return await postApproval(req, res, role);
    if (req.method === 'GET' && path === '/forge/status') return serveForgeStatus(res);
    if (req.method === 'GET' && path === '/forge/file') return serveForgeFile(res, url);
    if (req.method === 'POST' && path === '/forge/commit') return await postForgeCommit(req, res, role);
    if (req.method === 'GET' && path === '/skills') return serveSkills(res);
    if (req.method === 'GET' && path === '/forge/agents') return await serveForgeAgents(res);
    if (req.method === 'POST' && path === '/forge/run') return await postForgeRun(req, res, role);
    // Delegation. Not owner-gated at the route, because the ANSWER is legible to
    // either role — a proposer is told what would run and that only the owner can
    // start it. `resolveDelegation` is where the role decides whether anything
    // actually starts, and a hosted agent starts from neither.
    if (req.method === 'POST' && path === '/delegate') return await postDelegate(req, res, role);
    if (req.method === 'POST' && path === '/assistant/ask') return await postAssistantAsk(req, res, role);
    if (req.method === 'POST' && path === '/counsel/summarize') return await postCounselSummarize(req, res);
    if (req.method === 'GET' && path === '/counsel/meetings') return serveMeetings(res);
    if (req.method === 'POST' && path === '/counsel/meetings') return await postMeeting(req, res);
    if (req.method === 'GET' && path.startsWith('/counsel/meetings/')) return serveMeeting(res, path);
    if (req.method === 'DELETE' && path.startsWith('/counsel/meetings/')) return deleteMeeting(res, path, role);
    if (req.method === 'POST' && path === '/counsel/ask') return await postCounselAsk(req, res);
    if (req.method === 'GET' && path === '/mesh/devices') return serveMeshDevices(res);
    if (req.method === 'POST' && path === '/mesh/pairing') return postMeshPairing(res, role);
    if (req.method === 'POST' && path === '/mesh/pairing/cancel') return postMeshPairingCancel(res, role);
    if (req.method === 'POST' && path === '/mesh/selfcheck') return postMeshSelfCheck(res, role);

    return json(res, 404, {
      error: { code: 'not-found', message: `No route for ${req.method} ${path}.`, resolve: 'Check the URL.' },
    });
  }

  // ---- routes -------------------------------------------------------------

  /**
   * The shell carries the owner token in a meta tag. A browser cannot set a
   * request header on its first navigation, and this is a loopback-only,
   * single-user daemon — so handing the page its token is the honest
   * simplification. It is NOT a pattern for a multi-user server.
   */
  function serveShell(res: ServerResponse, authorized: boolean): void {
    let html: string;
    try {
      html = readFileSync(join(publicRoot, 'index.html'), 'utf8');
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The Zeno UI is not built. Expected index.html in ' + publicRoot);
      return;
    }
    // The owner token goes into the page ONLY for an authorized launch. An
    // unauthorized caller gets the page with an EMPTY token: it can look, but its
    // fetches to /approvals will be 401. Fill the single placeholder (never add a
    // second tag — querySelector would then find the empty one first).
    const value = authorized ? opts.tokens.owner : '';
    const tag = `<meta name="zeno-token" content="${value}">`;
    const withToken = /<meta\s+name="zeno-token"[^>]*>/i.test(html)
      ? html.replace(/<meta\s+name="zeno-token"[^>]*>/i, tag)
      : html.replace('</head>', `  ${tag}\n</head>`);
    const headers: Record<string, string> = {
      'content-type': MIME['.html']!,
      'cache-control': 'no-store',
    };
    // Only an authorized launch is granted the cookie that keeps the session
    // able to approve across navigations. SameSite=Strict blocks cross-site use;
    // HttpOnly keeps it out of page script.
    if (authorized) {
      headers['set-cookie'] = `zeno_token=${opts.tokens.owner}; Path=/; SameSite=Strict; HttpOnly`;
    }
    res.writeHead(200, headers);
    res.end(withToken);
  }

  function isStaticish(path: string): boolean {
    return extname(path) !== '';
  }

  function serveStatic(res: ServerResponse, path: string): void {
    // Resolve inside publicRoot and prove it stayed there — the same jail rule
    // the executor uses, for the same reason.
    const target = resolve(join(publicRoot, normalize(path)));
    if (target !== publicRoot && !target.startsWith(publicRoot + sep)) {
      return json(res, 403, {
        error: { code: 'path-escape', message: 'That path leaves the UI directory.', resolve: 'Request a file inside the UI directory.' },
      });
    }
    let body: Buffer;
    try {
      body = readFileSync(target);
    } catch {
      return json(res, 404, {
        error: { code: 'not-found', message: `No such file: ${path}`, resolve: 'Check the path.' },
      });
    }
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  /**
   * The capsule renders the exact payload and re-hashes it against the binding
   * before it will enable Approve. So the payload has to travel WITH the
   * preview — a capsule that cannot see the bytes correctly refuses to approve.
   */
  function withPayload(h: Held): Record<string, unknown> {
    return { ...h.preview, payload: h.payload };
  }

  function serveState(res: ServerResponse): void {
    json(res, 200, {
      pending: [...held.values()].map(withPayload),
      receipts: opts.kernel.receipts(),
      chain: opts.kernel.verifyChain(),
      lastEventId: opts.stream.lastId(),
    });
  }

  function serveReceipts(res: ServerResponse, url: URL): void {
    const after = url.searchParams.get('after');
    const all = opts.kernel.receipts();
    if (after === null) return json(res, 200, { receipts: all });
    const i = all.findIndex((r) => r.id === after);
    json(res, 200, { receipts: i < 0 ? all : all.slice(i + 1) });
  }

  function serveStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    const raw = header(req, 'last-event-id');
    const lastId = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
    res.write(opts.stream.attach(res, lastId));
    req.on('close', () => opts.stream.detach(res));
  }

  /**
   * Every open work item, and the truth about every source.
   *
   * `sources` travels WITH the items rather than behind a second route, because
   * a caller that has to make an extra request to learn the list was short will
   * not make it. A source that was never configured says so; a source that was
   * asked and failed says so; neither is rendered as "nothing to do".
   */
  async function serveWork(res: ServerResponse): Promise<void> {
    json(res, 200, await opts.work.list());
  }

  async function postWork(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const title = str(body, 'title');
    if (title === null || title.trim() === '') {
      return json(res, 400, {
        error: {
          code: 'bad-request',
          message: 'A work item needs a non-empty title.',
          resolve: 'POST {"title":"what needs doing","body":"optional detail","labels":["optional"]}.',
        },
      });
    }
    // Labels are cosmetic, but a caller that sent the wrong shape wanted
    // something — silently dropping it would lose a tag with no way to notice.
    const labels = strings(body, 'labels');
    if (labels === null) {
      return json(res, 400, {
        error: {
          code: 'bad-request',
          message: 'labels must be an array of strings.',
          resolve: 'POST {"title":"…","labels":["bug"]}, or leave labels out entirely.',
        },
      });
    }
    // A failed write throws and leaves as a legible 500. The backlog writes
    // through to disk before it changes in memory, so a refused write means the
    // item exists nowhere — including in the answer this route is about to give.
    json(res, 200, { item: opts.work.add(title, str(body, 'body') ?? '', labels) });
  }

  // ---- Vault: governed local memory --------------------------------------

  function serveMemory(res: ServerResponse, url: URL): void {
    if (!opts.vault) return json(res, 404, { error: { code: 'no-vault', message: 'Memory is not enabled.', resolve: 'Start the daemon with a vault directory.' } });
    const q = url.searchParams.get('q');
    if (q && q.trim()) {
      return json(res, 200, { query: q, hits: opts.vault.recall(q).map((h) => ({ note: h.note, score: h.score, matched: h.matched })) });
    }
    json(res, 200, { notes: opts.vault.all().slice(0, 50) });
  }

  async function postMemory(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!opts.vault) return json(res, 404, { error: { code: 'no-vault', message: 'Memory is not enabled.', resolve: 'Start the daemon with a vault directory.' } });
    const b = await readJson(req);
    const title = str(b, 'title');
    const bodyText = str(b, 'body');
    if (title === null || bodyText === null) {
      return json(res, 400, { error: { code: 'bad-request', message: 'A memory needs a title and a body.', resolve: 'POST {"title":"...","body":"..."}.' } });
    }
    const tags = Array.isArray(b['tags']) ? (b['tags'] as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    // A memory can hold what looks like a secret; redact before it is stored.
    const cleanBody = sanitize(bodyText).clean;
    const note = opts.vault.remember({ title, body: cleanBody, source: str(b, 'source') ?? 'owner', tags });
    json(res, 200, { note });
  }

  function serveBrief(res: ServerResponse): void {
    const recentNotes = opts.vault ? opts.vault.all().slice(0, 5) : [];
    const pending = [...held.values()].map((h) => ({
      summary: h.preview.summary,
      tier: h.preview.tier,
      source: h.req.requestedBy,
      at: new Date().toISOString(),
    }));
    const brief = buildBrief({ now: new Date().toISOString(), recentNotes, pending });
    json(res, 200, { brief, text: renderBrief(brief) });
  }

  // ---- Forge: a governed coding surface over the git executor -------------

  /** The sandbox repo's state: branch, HEAD, and the files that have changed. */
  function serveForgeStatus(res: ServerResponse): void {
    const run = (args: readonly string[]) => gitRunner.run(args, opts.sandbox);
    const isRepo = run(['rev-parse', '--is-inside-work-tree']).status === 0;
    if (!isRepo) {
      return json(res, 200, { repo: false, note: 'The sandbox is not a git repository yet. It is initialised on daemon start.' });
    }
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || '(no commits yet)';
    let head: string | null = null;
    try {
      const h = gitHead(gitSpec());
      head = h === NO_COMMITS ? null : h;
    } catch {
      head = null;
    }
    // -z gives NUL-separated entries; each is "XY path".
    const porcelain = run(['status', '--porcelain', '-z', '--untracked-files=all']).stdout;
    const changed = porcelain.split('\u0000').filter(Boolean).map((e) => ({ status: e.slice(0, 2).trim(), path: e.slice(3) }));
    const log = run(['log', '-5', '--pretty=%h\u001f%s']).stdout
      .split(/\r?\n/).filter(Boolean)
      .map((l) => { const [sha, ...rest] = l.split('\u001f'); return { sha, summary: rest.join('') }; });
    // The tracked file list is what lets the Forge code pane draw a REAL file
    // tree instead of an invented one. It is git's own index, so it never lists
    // a path that is not in this repository. Capped, and the cap is reported so
    // the surface can say "showing the first N of M" rather than quietly lying.
    const all = run(['ls-files', '-z']).stdout.split('\u0000').filter(Boolean);
    const tracked = all.slice(0, TREE_CAP);
    json(res, 200, {
      repo: true, branch, head: head ? head.slice(0, 12) : null, changed, log,
      tracked, trackedTotal: all.length, trackedCapped: all.length > TREE_CAP,
    });
  }

  /**
   * One sandbox file's contents, for the Forge code pane. READ ONLY — this route
   * has no write half and cannot grow one.
   *
   * The whole risk here is the path, so the path goes through the SAME jail the
   * executor uses (`jail`: Windows traps, lexical containment, then a realpath
   * check that catches symlinks and junctions). A path that escapes is refused
   * with 403 path-escape and no content, exactly as serveStatic refuses a path
   * that leaves the UI directory. Nothing else in this function touches the
   * filesystem, so there is no second, subtly different containment rule.
   */
  function serveForgeFile(res: ServerResponse, url: URL): void {
    const relPath = url.searchParams.get('path');
    if (relPath === null || relPath.trim() === '') {
      return json(res, 400, {
        error: { code: 'bad-request', message: 'Name the file to read.', resolve: 'GET /forge/file?path=src/index.ts' },
      });
    }
    let abs: string;
    try {
      abs = jail(opts.fs, opts.sandbox, relPath);
    } catch {
      // Deliberately one shape for every escape (traversal, absolute path, drive
      // letter, UNC root, symlink out): the answer must not report which trick
      // was tried, or it becomes a probe for what lives outside the sandbox.
      return json(res, 403, {
        error: { code: 'path-escape', message: 'That path leaves the sandbox.', resolve: 'Request a file inside the sandbox.' },
      });
    }
    const contents = opts.fs.readFile(abs);
    if (contents === null) {
      return json(res, 404, {
        error: { code: 'not-found', message: `No such file in the sandbox: ${relPath}`, resolve: 'Check the path against GET /forge/status.' },
      });
    }
    // A NUL byte means this is not text. Say so rather than shipping mojibake
    // for the code pane to render as if it were source.
    if (contents.includes('\u0000')) {
      return json(res, 200, {
        path: relPath, binary: true, contents: null, bytes: Buffer.byteLength(contents, 'utf8'),
        lines: 0, truncated: false, encoding: 'binary',
      });
    }
    const bytes = Buffer.byteLength(contents, 'utf8');
    const all = contents.split(/\r?\n/);
    const truncated = all.length > FILE_LINE_CAP;
    const kept = truncated ? all.slice(0, FILE_LINE_CAP) : all;
    json(res, 200, {
      path: relPath,
      binary: false,
      contents: kept.join('\n'),
      lines: all.length,
      bytes,
      truncated,
      eol: /\r\n/.test(contents) ? 'CRLF' : 'LF',
      encoding: 'UTF-8',
    });
  }

  /**
   * Commit the sandbox's changes — through the full gate. The owner asked for
   * this in the Forge surface, so the request itself is the approval: preview a
   * vcs.commit action (T1), approve it as the owner, and let the git executor
   * make the one jailed, proven commit. It lands a receipt like everything else.
   */
  async function postForgeCommit(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    if (role !== 'owner') {
      return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can commit.', resolve: 'Commit from the Zeno window.' } });
    }
    const body = await readJson(req);
    const message = str(body, 'message');
    if (message === null || message.trim() === '') {
      return json(res, 400, { error: { code: 'bad-request', message: 'A commit needs a message.', resolve: 'POST {"message":"..."}.' } });
    }
    const run = (args: readonly string[]) => gitRunner.run(args, opts.sandbox);
    const changed = run(['status', '--porcelain', '-z', '--untracked-files=all']).stdout.split('\u0000').filter(Boolean).map((e) => e.slice(3));
    const paths = Array.isArray(body['paths'])
      ? (body['paths'] as unknown[]).filter((p): p is string => typeof p === 'string')
      : changed;
    if (paths.length === 0) {
      return json(res, 400, { error: { code: 'nothing-to-commit', message: 'There are no changes to commit.', resolve: 'Make a change first.' } });
    }
    const spec = gitSpec();
    const payload = makeCommitPayload(spec, message, paths);
    const request: ActionRequest = {
      kind: 'vcs.commit',
      summary: `commit: ${message}`,
      targetRef: `git:${opts.sandbox}`,
      payload,
      baseHash: payload.expectHead,
      // Forge is the proposer; the owner (clicking Commit in the window) is the
      // approver. They must differ, or L6's self-approval guard rightly fires.
      requestedBy: 'forge',
      dataZones: ['personal'],
    };
    const preview = opts.kernel.preview(request);
    const approval = opts.kernel.approve(preview.actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
    const receipt = await opts.kernel.commit(approval, gitExecutor(spec, payload));
    opts.stream.publish('receipt', receipt);
    opts.stream.publish('chain', opts.kernel.verifyChain());
    json(res, 200, { receipt });
  }

  // ---- Forge: the model/effort picker, and the governed agent run --------

  /**
   * A thinking model's private reasoning, cut off the front of its answer.
   *
   * `think:false` asks Ollama to suppress it and a Qwen3-class model does not
   * obey: the reasoning arrives INSIDE `response`, terminated by a bare
   * `</think>` that has no opening tag. Passed on verbatim it becomes the
   * answer, and that is not a cosmetic problem. Counsel scored five thousand
   * characters of the model talking to itself, found every sentence uncited,
   * and threw away the one grounded line that came after the sentinel -- so a
   * question it had answered correctly was reported as ungrounded and withheld.
   *
   * Cut at the LAST sentinel, because the answer is whatever the model said
   * after it stopped thinking. No sentinel means nothing leaked, and the text
   * is returned exactly as it arrived: this removes reasoning, and never
   * rewrites an answer.
   */
  function withoutReasoning(text: string): string {
    const marker = '</think>';
    const end = text.lastIndexOf(marker);
    return end === -1 ? text : text.slice(end + marker.length);
  }

  /**
   * Run an open-source model (via Ollama) as a basic coding agent. The model
   * cannot touch the filesystem itself, so it is asked to emit files in a strict
   * envelope, which we parse and write into the ISOLATED worktree (jailed). The
   * result then flows through the exact same gate as any other change. Effort
   * maps to the model's thinking budget — real on a Qwen3-class model.
   */
  async function runLocalModel(
    worktree: string,
    task: string,
    model: string | undefined,
    effort: 'low' | 'medium' | 'high' | undefined,
  ): Promise<{ ok: boolean; agentId: 'local'; model: string | null; effort: typeof effort | null; log: string; note?: string; tokensIn?: number | null; tokensOut?: number | null }> {
    const chosen = model && model.trim() ? model.trim() : 'qwen3:8b';
    const base = { agentId: 'local' as const, model: chosen, effort: effort ?? null };
    const think = effort !== 'low'; // low = no_think (fast); medium/high = reason first
    // THE CONTEXT PACK. Without this the model received the task string and
    // nothing else, so "optimise the code" could only be answered with "which
    // code?" — an agent that cannot see the repository can do nothing but create
    // new files. It now gets the tree, then the contents of the files most likely
    // to matter, bounded so a large repo cannot blow the context window.
    const NL = String.fromCharCode(10);
    const tree = gitRunner.run(['ls-files'], worktree).stdout.split(NL).map((f) => f.trim()).filter(Boolean);
    const SRC = /\.(js|mjs|cjs|ts|tsx|jsx|json|css|html|md|py)$/i;
    const lower = task.toLowerCase();
    // Files the task actually names come first; then ordinary source. A budget
    // buys the most files this way rather than one enormous one.
    const named = tree.filter((f) => lower.includes((f.split('/').pop() ?? '').toLowerCase()));
    const rest = tree.filter((f) => !named.includes(f) && SRC.test(f));
    const pack: string[] = [];
    let spent = 0;
    for (const rel of [...named, ...rest].slice(0, 12)) {
      let body: string;
      try {
        body = readFileSync(join(worktree, rel), 'utf8');
      } catch {
        continue;
      }
      if (spent + body.length > 24_000) continue;
      spent += body.length;
      pack.push(`===FILE: ${rel}===${NL}${body}${NL}===END===`);
    }
    const prompt = [
      'You are a coding assistant editing files in a real project.',
      tree.length === 0
        ? 'THE REPOSITORY IS EMPTY — there are no existing files.'
        : `THE REPOSITORY CONTAINS THESE FILES:${NL}${tree.slice(0, 200).join(NL)}`,
      pack.length === 0
        ? ''
        : `CURRENT CONTENTS OF THE MOST RELEVANT FILES. To CHANGE one, output it again in full with your edits applied:${NL}${NL}${pack.join(NL + NL)}`,
      'For EVERY file you create or change, output exactly:',
      '===FILE: <relative/path>===',
      '<the COMPLETE new file content>',
      '===END===',
      'Output ONLY those blocks. No explanation, no markdown fences.',
      'If the task needs no file change, output nothing at all.',
      'TASK: ' + task,
    ].filter((l) => l !== '').join(NL + NL);
    let text: string;
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    try {
      const r = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: chosen, prompt, stream: false, think }),
      });
      if (!r.ok) {
        return { ...base, ok: false, log: '', note: `Ollama returned ${r.status}. Is the model pulled? (ollama pull ${chosen})` };
      }
      const body = (await r.json()) as { response?: string; prompt_eval_count?: number; eval_count?: number };
      // Ollama reports what it actually consumed and produced. Forge shows it in
      // the status bar: an owner running a local model on their own GPU has a
      // right to see the cost of a run, and a context that is filling up is the
      // first thing that explains a worse answer.
      tokensIn = body.prompt_eval_count ?? null;
      tokensOut = body.eval_count ?? null;
      text = withoutReasoning(body.response ?? '');
    } catch {
      return { ...base, ok: false, log: '', note: 'Ollama is not running. Start it, then pull a model (e.g. ollama pull qwen3:14b).' };
    }
    // Parse the ===FILE:...=== / ===END=== envelopes and write each, JAILED to
    // the worktree so a hallucinated path can never escape it.
    const fileBlock = /===FILE:\s*(\S+)\s*===[\r\n]+([\s\S]*?)[\r\n]+===END===/g;
    const blocks = [...text.matchAll(fileBlock)]
    let wrote = 0;
    for (const m of blocks) {
      const rel = (m[1] ?? '').trim();
      const content = m[2] ?? '';
      let abs: string;
      try {
        abs = jailPath(worktree, rel);
      } catch {
        continue; // a path that would escape the worktree is dropped
      }
      try {
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content, 'utf8');
        wrote++;
      } catch {
        /* skip an unwritable path */
      }
    }
    if (wrote === 0) {
      return { ...base, ok: false, log: text, note: 'The model produced no file edits in the expected format. Try a clearer task or a larger model.' };
    }
    return { ...base, ok: true, log: text, tokensIn, tokensOut };
  }

  /**
   * The installed Ollama models, discovered live so the open-source models the
   * owner pulled show up in the picker. Queried over the HTTP API
   * (127.0.0.1:11434), not the `ollama` CLI — the daemon's PATH may not include
   * the binary, but the server is always on the same loopback.
   */
  async function installedLocalModels(): Promise<string[]> {
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags');
      if (!r.ok) return [];
      const body = (await r.json()) as { models?: { name?: string }[] };
      return (body.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string' && n !== '');
    } catch {
      return []; // Ollama not running — the local rung simply shows no models to pick
    }
  }

  /**
   * The real availability probe: what can actually run a job on this machine.
   *
   * `claude --version` is spawned through the SAME injected spawner Forge uses,
   * with `shell: false` and a short ceiling, and the answer is read off
   * `failedToSpawn` rather than the exit code — a CLI that ran and exited
   * non-zero is still installed, and calling it missing would send the owner off
   * to reinstall something that is already there.
   */
  async function probeAgents(): Promise<DelegateAvailability> {
    if (opts.delegateProbe !== undefined) return await opts.delegateProbe.available();
    const localModels = await installedLocalModels();
    let claudeOnPath = false;
    try {
      const r = nodeSpawner({ timeoutMs: 10_000 }).run(CLAUDE_BINARY, ['--version'], { cwd: opts.sandbox });
      claudeOnPath = !r.failedToSpawn;
    } catch {
      claudeOnPath = false; // the adapter does not throw, but a probe never crashes a request
    }
    return { localModels, claudeOnPath };
  }

  /**
   * The installed Agent Skills, with their screening verdict.
   *
   * A skill is third-party prose that gets fed to a model — the skills CLI itself
   * warns they "run with full agent permissions". The screener never BLOCKS one;
   * it tells the owner what it found so the choice is informed. The real
   * protection is unchanged and sits downstream: whatever the agent then writes
   * is still an approval capsule.
   */
  function serveSkills(res: ServerResponse): void {
    const dir = join(process.cwd(), '.agents', 'skills');
    try {
      const lib = loadLibrary(nodeSkillReader(dir));
      json(res, 200, {
        dir,
        skills: lib.skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          bytes: s.bytes,
          verdict: s.screen.verdict,
          findings: s.screen.findings.map((f) => ({ rule: f.rule, severity: f.severity, why: f.why })),
        })),
        // A file that would not parse is REPORTED, never dropped: an empty library
        // and an unreadable one are different facts.
        failed: lib.failed,
      });
    } catch (err) {
      json(res, 200, { dir, skills: [], failed: [], note: `No skills could be read: ${(err as Error).message}` });
    }
  }

  async function serveForgeAgents(res: ServerResponse): Promise<void> {
    json(res, 200, { agents: AGENTS, efforts: EFFORTS, localModels: await installedLocalModels() });
  }

  /** One file the agent wrote, as it now waits in the approval queue. */
  interface ProposedChange {
    readonly path: string;
    readonly actionHash: string;
    readonly tier: string;
    readonly auto: boolean;
  }

  /** Everything one run produced. Every `proposed` entry is a capsule awaiting a click. */
  interface RunOutcome {
    readonly run: {
      readonly ok: boolean;
      readonly agentId: string;
      readonly model: string | null;
      readonly effort: string | null;
      readonly log: string;
      readonly note: string | null;
    };
    readonly changed: readonly string[];
    readonly proposed: readonly ProposedChange[];
  }

  /**
   * THE one path an agent run takes, whoever asked for it — the Forge button, or
   * a delegation from Ask Zeno or a spoken sentence.
   *
   * It is one function on purpose. The governance story of a run lives in what
   * happens to its OUTPUT: the agent edits an isolated throwaway worktree, and
   * every file it touched is turned into an ordinary approval capsule against
   * the sandbox by `proposeFileWrite` — the same gate a hand-typed proposal goes
   * through. A second copy of this loop is how a "convenience" path eventually
   * grows one that writes to the sandbox directly, so there is not one.
   */
  async function performRun(
    task: string,
    agentId: string,
    model: string | undefined,
    effort: 'low' | 'medium' | 'high' | undefined,
  ): Promise<RunOutcome> {
    let tree;
    try {
      tree = createWorktree(opts.sandbox, `run-${opts.kernel.receipts().length}-${Date.now().toString(36)}`, gitRunner);
    } catch (err) {
      throw new WorktreeUnavailable((err as Error).message);
    }
    try {
      const result = agentId === 'local'
        ? await runLocalModel(tree.path, task, model, effort)
        : runAgent({ agentId, task, worktree: tree.path, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, nodeSpawner());
      const changed = result.ok ? diffFiles(tree.path, gitRunner) : [];
      const proposed: ProposedChange[] = [];
      for (const rel of changed) {
        let contents: string;
        try {
          contents = readFileSync(join(tree.path, rel), 'utf8');
        } catch {
          continue; // a deletion or a binary — skip in this minimal surface
        }
        const out = await proposeFileWrite(rel, contents, `Forge (${result.agentId}): ${task.slice(0, 60)}`, `forge:${result.agentId}`);
        const pv = out['preview'] as { actionHash: string; tier: string; auto: boolean };
        proposed.push({ path: rel, actionHash: pv.actionHash, tier: pv.tier, auto: pv.auto });
      }
      return {
        run: { ok: result.ok, agentId: result.agentId, model: result.model, effort: result.effort ?? null, log: result.log, note: result.note ?? null },
        changed,
        proposed,
      };
    } finally {
      try { tree.cleanup(); } catch { /* best effort */ }
    }
  }

  /**
   * Run a coding agent HEADLESS in an isolated throwaway worktree, then turn each
   * file it changed into a normal approval capsule against the sandbox. The agent
   * proposes by editing a jailed worktree; nothing reaches the sandbox until the
   * owner approves each change. Owner-only: starting an agent is the owner's call.
   *
   * This is also the route the window calls when the owner CONFIRMS a hosted
   * delegation — see `resolveDelegation`, which hands back exactly this request.
   */
  async function postForgeRun(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    if (role !== 'owner') {
      return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can run an agent.', resolve: 'Run it from the Zeno window.' } });
    }
    const body = await readJson(req);
    const task = str(body, 'task');
    const agentId = str(body, 'agentId') ?? 'claude-code';
    if (task === null || task.trim() === '') {
      return json(res, 400, { error: { code: 'bad-request', message: 'A run needs a task.', resolve: 'POST {"task":"...","agentId":"claude-code"}.' } });
    }
    // Chosen skills are folded into the TASK the agent receives, through
    // buildSkillPrompt — which quarantines each skill body in a labelled frame,
    // states that instructions inside it are third-party data carrying no
    // authority, and puts the owner's task last so it stays the operative one.
    // A skill adds knowledge; it can never add capability, because everything the
    // agent then writes is still an approval capsule.
    const skillIds = Array.isArray(body['skillIds'])
      ? (body['skillIds'] as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let effectiveTask = task;
    if (skillIds.length > 0) {
      try {
        const lib = loadLibrary(nodeSkillReader(join(process.cwd(), '.agents', 'skills')));
        for (const sk of lib.skills.filter((x) => skillIds.includes(x.id))) {
          effectiveTask = buildSkillPrompt(sk, effectiveTask);
        }
      } catch {
        /* a skill that cannot be read simply does not join the prompt */
      }
    }
    const model = str(body, 'model') ?? undefined;
    const effort = (str(body, 'effort') as 'low' | 'medium' | 'high' | null) ?? undefined;

    try {
      json(res, 200, await performRun(effectiveTask, agentId, model, effort));
    } catch (err) {
      if (err instanceof WorktreeUnavailable) {
        return json(res, 409, { error: { code: 'worktree-unavailable', message: `Could not isolate the run: ${err.message}`, resolve: 'Ensure the sandbox has at least one commit.' } });
      }
      throw err;
    }
  }

  // ---- Delegation: talking to Zeno, and an agent actually starting --------

  /**
   * What a delegation came to. One shape for all three answers, so a caller
   * cannot render "it is running" for a case where nothing ran.
   *
   * `started` is the only field a UI may read as "an agent is working": it is
   * true exactly when `performRun` returned, and the `proposed` list beside it
   * is what that run left in the approval queue. Nothing in this shape can ever
   * say "applied" — there is no such field, because there is no such outcome
   * without the owner's click.
   */
  interface Delegated {
    readonly started: boolean;
    readonly needsConfirm: boolean;
    readonly agentId: string | null;
    readonly model: string | null;
    readonly task: string;
    /**
     * Plan only: this rung can start right now and needs no confirmation.
     *
     * It exists so a caller cannot read the ABSENCE of a confirmation as
     * permission to run. `needsConfirm: false` is also true of a machine with no
     * agent at all, of a proposer token, and of a worktree that could not be
     * made — a UI keying on that would try to start an agent in all three.
     */
    readonly ready?: boolean;
    /** Why a confirmation is being asked for. Present only when one is. */
    readonly because?: string;
    /** The request the window sends when the owner confirms. Present only then. */
    readonly confirm?: { readonly method: 'POST'; readonly path: '/forge/run'; readonly body: Record<string, unknown> };
    /** A plain sentence for every case that is not a start. */
    readonly note?: string;
    readonly changed?: readonly string[];
    readonly proposed?: readonly ProposedChange[];
    readonly log?: string;
    readonly ok?: boolean;
  }

  /**
   * The model a local run gets when nobody named one.
   *
   * Prefers the default the rest of this file already uses when it is installed,
   * and otherwise takes the first model Ollama actually reports — never a name
   * that is not pulled, because that would be a run that fails on a
   * "model not found" the owner cannot see coming.
   */
  function pickLocalModel(installed: readonly string[]): string | null {
    if (installed.length === 0) return null;
    const preferred = installed.find((m) => m === 'qwen3:8b' || m.startsWith('qwen3:'));
    return preferred ?? installed[0] ?? null;
  }

  /**
   * DECIDE what a delegation would do, and start nothing.
   *
   * Separated from the run so a caller can SAY which agent is about to work
   * before it works. That matters most for the surface where it is hardest —
   * voice, where the owner is not looking at a form and the first thing they
   * should learn is which agent heard them. `resolveDelegation` is this function
   * plus the local start, so the two can never disagree about the decision.
   *
   * THE LINE THIS DRAWS, and the reasoning behind it:
   *
   *   Running an agent produces PROPOSALS, not effects. Every file it writes
   *   comes back as a capsule the owner approves by hand, so starting one is not
   *   a consequential act and does not need an approval capsule of its own.
   *
   *   But a run SPENDS something real, and the two rungs spend differently. A
   *   local model spends GPU time on a machine the owner already owns, and their
   *   code never leaves it — so a local run may start the moment they ask,
   *   including from a spoken sentence. A hosted agent spends the owner's money
   *   AND sends their code off the machine. That is not a thing to infer from a
   *   sentence someone said out loud, so it is never started here: the answer
   *   describes what it would cost and hands back the request the owner's click
   *   sends.
   *
   *   With neither installed, the answer says so plainly. It never fabricates a
   *   start, and it never quietly picks the hosted rung because the local one is
   *   missing.
   */
  async function planDelegation(task: string, role: Role, requested?: string): Promise<Delegated> {
    const trimmed = task.trim();
    const base = { started: false, needsConfirm: false, agentId: null, model: null, task: trimmed } as const;

    // L6's line, kept where /forge/run keeps it. A proposer token may be TOLD a
    // delegation was suggested; it may not cause one to run.
    if (role !== 'owner') return { ...base, note: DELEGATE_OWNER_ONLY };

    const { localModels, claudeOnPath } = await probeAgents();
    const wantsHosted = requested !== undefined && requested !== 'local';
    const model = pickLocalModel(localModels);

    // HOSTED — asked for by name, or the only rung installed. Either way it does
    // not start here. The owner is told what it will cost before it can.
    if ((wantsHosted || model === null) && claudeOnPath) {
      return {
        ...base,
        needsConfirm: true,
        agentId: 'claude-code',
        because: HOSTED_BECAUSE,
        confirm: { method: 'POST', path: '/forge/run', body: { task: trimmed, agentId: 'claude-code' } },
      };
    }

    // Neither rung is here. Say that, and say what would make it possible.
    if (model === null) return { ...base, note: NO_AGENT_NOTE };

    // LOCAL — free to start. `ready` is the only field that says so, and it is
    // deliberately not `needsConfirm: false`: three other branches carry that
    // too, and a UI reading the absence of a confirmation as permission to run
    // would try to start an agent this machine does not have.
    return { ...base, ready: true, agentId: 'local', model };
  }

  /**
   * Decide, and — for the local rung only — actually run.
   *
   * The local start needs no confirmation for a reason worth restating where it
   * happens: the model runs on hardware the owner already owns, their code never
   * leaves the machine, and everything the run PRODUCES still waits for their
   * click. So the thing being spent is their own GPU, and the thing being
   * decided is still theirs to decide, later, one capsule at a time.
   */
  async function resolveDelegation(task: string, role: Role, requested?: string): Promise<Delegated> {
    const plan = await planDelegation(task, role, requested);
    if (plan.ready !== true || plan.model === null) return plan;
    const trimmed = plan.task;
    const model = plan.model;
    const base = { started: false, needsConfirm: false, agentId: null, model: null, task: trimmed } as const;
    try {
      const outcome = await performRun(trimmed, 'local', model, undefined);
      return {
        started: true,
        needsConfirm: false,
        agentId: 'local',
        model,
        task: trimmed,
        ok: outcome.run.ok,
        changed: outcome.changed,
        proposed: outcome.proposed,
        log: outcome.run.log,
        ...(outcome.run.note === null ? {} : { note: outcome.run.note }),
      };
    } catch (err) {
      // The worktree could not be made, so the agent never ran. Reported as a
      // non-start with the reason — never as a start with nothing to show.
      const why = err instanceof WorktreeUnavailable ? err.message : (err as Error).message;
      return {
        ...base,
        agentId: 'local',
        model,
        note: `Could not isolate the run, so nothing was started: ${why}`,
      };
    }
  }

  /**
   * The delegation route the window and the voice panel both call.
   *
   * One implementation, so a spoken delegation and a typed one cannot drift into
   * disagreeing about which agent runs or what it costs — which is exactly the
   * kind of divergence that ends with a hosted agent starting from a sentence
   * nobody confirmed.
   */
  async function postDelegate(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    const body = await readJson(req);
    const task = str(body, 'task');
    if (task === null || task.trim() === '') {
      return json(res, 400, { error: { code: 'bad-request', message: 'A delegation needs a task.', resolve: 'POST {"task":"build a slugify utility"}.' } });
    }
    const requested = str(body, 'agentId') ?? undefined;
    // `plan: true` decides and starts NOTHING. It is what lets a surface name the
    // agent before it runs — which is the whole of what the voice panel owes the
    // owner, since they are not looking at a picker when they speak.
    const planOnly = body['plan'] === true;
    const delegated = planOnly
      ? await planDelegation(task, role, requested)
      : await resolveDelegation(task, role, requested);
    json(res, 200, { delegated });
  }

  // ---- Counsel: the meeting copilot — transcript in, cited summary out ----

  /**
   * Ask Zeno — the assistant, answering about the owner's OWN Zeno.
   *
   * Grounded, not generative: it is shown a clipped snapshot of real local state
   * and must cite the fact ids it used. `groundReply` then checks every citation
   * against that snapshot, so an invented id or an uncited factual claim is
   * reported as a FAILURE and the prose is handed back flagged rather than
   * rendered as an answer. A confident lie about your own machine is worse than
   * a refusal, so the refusal is the default.
   *
   * It may PROPOSE a file write, which becomes an ordinary approval capsule the
   * owner approves by hand. It may also DELEGATE a job to a coding agent, which
   * produces a stack of those same capsules. It never touches /approvals — L6 is
   * unchanged, and a hosted agent never starts from an answer alone.
   */
  async function postAssistantAsk(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    const body = await readJson(req);
    const question = str(body, 'question');
    if (question === null || question.trim() === '') {
      return json(res, 400, { error: { code: 'bad-request', message: 'Ask a question.', resolve: 'POST {"question":"what is waiting on me?"}.' } });
    }

    const work = await opts.work.list().catch(() => null);
    let repo: { branch: string; head: string; changed: string[] } | null = null;
    try {
      const st = gitRunner.run(['rev-parse', '--abbrev-ref', 'HEAD'], opts.sandbox);
      if (st.status === 0) {
        const ch = gitRunner.run(['status', '--porcelain', '-z', '--untracked-files=all'], opts.sandbox)
          .stdout.split('\u0000').filter(Boolean).map((e) => e.slice(3));
        const hd = gitRunner.run(['rev-parse', 'HEAD'], opts.sandbox);
        repo = { branch: st.stdout.trim(), head: hd.status === 0 ? hd.stdout.trim().slice(0, 12) : 'no commits yet', changed: ch };
      }
    } catch { /* no repo is a fact, not an error */ }

    const snapshot = buildSnapshot({
      at: new Date().toISOString(),
      pending: [...held.values()].map((h) => ({ id: h.preview.actionHash.slice(0, 8), summary: h.preview.summary, tier: h.preview.tier, ageMin: 0 })),
      receipts: opts.kernel.receipts().slice(-20).map((r) => ({ id: r.id, outcome: r.outcome, summary: r.summary ?? '', at: r.at })),
      work: (work?.items ?? []).map((i: { id: string; title: string; labels?: readonly string[]; state?: string }) => ({ id: i.id, title: i.title, labels: [...(i.labels ?? [])], state: i.state ?? 'open' })),
      repo,
      memory: (opts.vault?.all() ?? []).slice(0, 12).map((n) => ({ id: n.id, title: n.title, body: n.body })),
      devices: [{ name: hostname(), paired: true }],
    });

    const prompt = buildAssistantPrompt(question, snapshot);
    const note = snapshot.truncated.length > 0 ? snapshot.truncated.map(describeTruncation).join(' · ') : null;

    let answer: string;
    try {
      const r = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'qwen3:8b', prompt, stream: false, think: false }),
      });
      if (!r.ok) {
        return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: `The local model answered ${r.status}. Is qwen3:8b pulled?` });
      }
      answer = withoutReasoning(((await r.json()) as { response?: string }).response ?? '');
    } catch {
      return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: 'Ollama is not running, so nobody can answer this. Start it, then pull a model (ollama pull qwen3:8b). Your Zeno state is unaffected.' });
    }

    const grounding = groundReply(answer, snapshot);
    if (!grounding.ok) {
      // Do NOT render it as an answer. Say which id was invented — that specific
      // sentence is what earns the owner's trust in every other answer.
      return json(res, 200, {
        answer: null, flagged: answer, cited: grounding.cited,
        ungrounded: { unknownIds: grounding.unknownIds, claimsWithoutCitation: grounding.claimsWithoutCitation },
        proposal: null, delegated: null, note,
      });
    }

    // A proposal is an intent, not an act: it goes through the ordinary gate.
    // A delegation is an intent too — it names a job, and `resolveDelegation`
    // decides whether anything starts and says so honestly either way.
    let proposal: unknown = null;
    let delegated: Delegated | null = null;
    const intent = parseIntent(answer);
    if (intent !== null && intent.kind === 'propose-write') {
      try {
        const out = await proposeFileWrite(intent.relPath, '', intent.summary, 'assistant');
        proposal = { relPath: intent.relPath, summary: intent.summary, preview: out['preview'] };
      } catch (err) {
        proposal = { relPath: intent.relPath, refused: (err as Error).message };
      }
    } else if (intent !== null && intent.kind === 'delegate') {
      delegated = await resolveDelegation(intent.task, role);
    }
    json(res, 200, { answer, cited: grounding.cited, ungrounded: null, proposal, delegated, note });
  }

  async function postCounselSummarize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req);
    const raw = Array.isArray(body['utterances']) ? (body['utterances'] as unknown[]) : null;
    if (raw === null) {
      return json(res, 400, { error: { code: 'bad-request', message: 'Provide utterances: an array of {id, at, speaker, text}.', resolve: 'POST {"utterances":[...]}.' } });
    }
    const utterances: Utterance[] = raw
      .filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .map((u, i) => ({
        id: typeof u['id'] === 'string' ? (u['id'] as string) : `u${i}`,
        at: typeof u['at'] === 'string' ? (u['at'] as string) : new Date().toISOString(),
        speaker: (u['speaker'] === 'owner' || u['speaker'] === 'other') ? u['speaker'] : 'unknown',
        text: typeof u['text'] === 'string' ? (u['text'] as string) : '',
      }));
    const transcript = transcriptOf(utterances);
    // BELOW THE THRESHOLD, THERE IS NO SUMMARY TO GIVE. `summarize` will happily
    // run on one garbled fragment and hand back a shape that renders as
    // "DECISIONS: none extracted · ACTIONS: none extracted" — which reads as a
    // finished analysis of a real meeting, not as "you have said one thing so
    // far". The package has said this since it was written (`tooShortToSummarize`
    // + `renderPartial`, the honest-partial rule); this route simply never asked.
    // It asks now, and answers with the captured lines verbatim instead.
    if (tooShortToSummarize(transcript)) {
      return json(res, 200, {
        summary: { decisions: [], actions: [], questions: [], keyPoints: [] },
        text: renderPartial(transcript),
        partial: true,
        lines: utterances.length,
        note:
          `${utterances.length} line${utterances.length === 1 ? '' : 's'} captured — too little to summarize honestly. ` +
          'Nothing here is inferred; as the meeting continues this fills in.',
      });
    }
    const summary = summarize(transcript);
    json(res, 200, { summary, text: renderSummary(summary), partial: false, lines: utterances.length, note: null });
  }

  // ---- Counsel: the archive of past calls, and the chat over it -----------

  /** Every meetings route needs a store. Absent is a legible 404, not a crash. */
  function requireMeetings(res: ServerResponse): Meetings | null {
    if (!opts.meetings) {
      json(res, 404, {
        error: {
          code: 'no-meetings',
          message: 'The meeting archive is not enabled.',
          resolve: 'Start the daemon with a meetings directory.',
        },
      });
      return null;
    }
    return opts.meetings;
  }

  /**
   * The id in `/counsel/meetings/<id>`, percent-decoded. Null when it is missing
   * or unusable.
   *
   * The check happens AFTER decoding as well as before. Rejecting a raw `/` and
   * then decoding hands `..%2F..%2Fetc%2Fpasswd` through as the id `../../etc/passwd`
   * — the archive's own filename jail is what stopped it going anywhere, and a
   * route should not be spending someone else's defence. A meeting id names one
   * file in one folder; a separator, a drive letter or a control character in it
   * means it is not one.
   */
  function meetingIdFrom(path: string): string | null {
    const raw = path.slice('/counsel/meetings/'.length);
    if (raw === '' || raw.includes('/')) return null;
    let id: string;
    try {
      id = decodeURIComponent(raw);
    } catch {
      return null; // a malformed escape is not an id
    }
    if (id === '' || id === '.' || id === '..') return null;
    // A meeting id names ONE file in ONE folder: no separator, no drive letter,
    // no wildcard, no control character.
    const forbidden = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);
    if ([...id].some((c) => forbidden.has(c) || c.charCodeAt(0) < 0x20)) return null;
    return id;
  }

  /**
   * The dashboard list: newest first, with counts rather than whole transcripts —
   * a tab that renders a list must not have to download every word ever spoken.
   *
   * `failed` ships alongside. A meeting file the archive could not read is a fact
   * the owner needs; a list that quietly omits it would be the dashboard lying by
   * omission, and "you have no meetings" is a very different sentence from "one
   * of your meetings is unreadable".
   */
  function serveMeetings(res: ServerResponse): void {
    const lib = requireMeetings(res);
    if (lib === null) return;
    const meetings = lib.all().map((m) => ({
      id: m.id,
      title: m.title,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      participants: m.participants,
      counts: {
        lines: m.utterances.length,
        decisions: m.summary.decisions.length,
        actions: m.summary.actions.length,
        questions: m.summary.questions.length,
        keyPoints: m.summary.keyPoints.length,
      },
    }));
    // Whether the FOLDER could be read at all is a separate fact from whether
    // the files in it parsed. Without it, an unreadable archive — a permission
    // wall, an unmounted drive, a file where the folder should be — serves the
    // exact bytes a first run serves, and the tab says "no meetings yet" over a
    // hundred recordings it simply could not open.
    const unreadable = lib.unreadable();
    json(res, 200, {
      meetings,
      failed: lib.failed(),
      archive:
        unreadable === null
          ? { readable: true, reason: null, resolve: null }
          : {
              readable: false,
              reason: `The meetings folder could not be read: ${unreadable}`,
              resolve: 'Check that the folder exists and this account can read it. Nothing below is a complete list until it can.',
            },
    });
  }

  function serveMeeting(res: ServerResponse, path: string): void {
    const lib = requireMeetings(res);
    if (lib === null) return;
    const id = meetingIdFrom(path);
    const meeting = id === null ? undefined : lib.get(id);
    if (!meeting) {
      return json(res, 404, {
        error: {
          code: 'no-such-meeting',
          message: `No meeting with id ${JSON.stringify(id ?? '')} is in the archive.`,
          resolve: 'List the archive at GET /counsel/meetings.',
        },
      });
    }
    json(res, 200, { meeting, text: renderSummary(meeting.summary) });
  }

  /**
   * Save a finished call: summarise it, persist it, hand back what was stored.
   *
   * Every spoken line goes through the sanitizer FIRST, exactly as postMemory
   * does. A meeting is the single most likely place for a credential to be said
   * out loud — someone reads an API key over a call — and this route is the last
   * point before it becomes a file on disk that outlives the conversation. The
   * summary is computed from the REDACTED lines, so a secret cannot survive in a
   * key point either.
   */
  async function postMeeting(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const lib = requireMeetings(res);
    if (lib === null) return;
    const body = await readJson(req);
    const title = str(body, 'title');
    const raw = Array.isArray(body['utterances']) ? (body['utterances'] as unknown[]) : null;
    if (title === null || title.trim() === '' || raw === null) {
      return json(res, 400, {
        error: {
          code: 'bad-request',
          message: 'A saved meeting needs a title and an array of utterances.',
          resolve: 'POST {"title":"...","participants":["..."],"utterances":[{"id","at","speaker","text"}]}.',
        },
      });
    }
    const participants = strings(body, 'participants');
    if (participants === null) {
      return json(res, 400, {
        error: { code: 'bad-request', message: 'participants must be an array of strings.', resolve: 'Send participants: ["Abheet", "Priya"].' },
      });
    }

    // EVERY field that becomes part of the file, not just the spoken line.
    //
    // The transcript used to be the only thing sanitized, which quietly assumed a
    // credential can only arrive by being spoken. It cannot: the title is where a
    // handover call gets named "Handover — token ghp_…" by the person pasting the
    // agenda in, the participant list carries whatever the recorder labelled the
    // channels with, and the line id is whatever the recorder chose to call it.
    // All four land in the same `.md` on disk and in the same prompt to a model,
    // so all four go through the sanitizer, and `redacted` counts all of it.
    let redacted = 0;
    const scrub = (s: string): string => {
      const clean = sanitize(s);
      redacted += clean.findings.length;
      return clean.clean;
    };

    const utterances: Utterance[] = raw
      .filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .map((u, i) => ({
        id: typeof u['id'] === 'string' && u['id'] !== '' ? scrub(u['id'] as string) : `u${i}`,
        at: typeof u['at'] === 'string' ? (u['at'] as string) : new Date().toISOString(),
        speaker: u['speaker'] === 'owner' || u['speaker'] === 'other' ? u['speaker'] : 'unknown',
        text: scrub(typeof u['text'] === 'string' ? (u['text'] as string) : ''),
      }));

    const startedAt = utterances[0]?.at ?? new Date().toISOString();
    // The id is also the filename stem, so it stays inside [A-Za-z0-9_-].
    const meeting: Meeting = {
      id: `m-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      title: scrub(title.trim()),
      startedAt,
      endedAt: utterances[utterances.length - 1]?.at ?? startedAt,
      participants: participants.map(scrub),
      utterances,
      // Computed from the REDACTED lines, so a secret cannot survive by hiding
      // inside a key point.
      summary: summarize(transcriptOf(utterances)),
    };

    // Save BEFORE answering. The archive writes through to disk before it changes
    // in memory, so a refused write throws and leaves as a legible 500 — and the
    // owner is never told a call was saved that is not actually on disk.
    lib.save(meeting);
    json(res, 200, { meeting, redacted });
  }

  /**
   * Delete a recording. This really deletes: the file is removed from disk, not
   * flagged. A meeting is a recording of the owner's own voice and the people who
   * were in the room with them — "delete" that leaves a copy behind is a lie.
   *
   * OWNER-ONLY, on the same reasoning as /approvals and /forge/commit: this is
   * irreversible. Reading the archive is not deciding to destroy part of it, so
   * the other routes stay open to either role and this one does not.
   */
  function deleteMeeting(res: ServerResponse, path: string, role: Role): void {
    if (role !== 'owner') {
      return json(res, 403, {
        error: {
          code: 'owner-only',
          message: 'Only the owner can delete a recording.',
          resolve: 'Delete it from the Zeno window, or from the meetings folder itself.',
        },
      });
    }
    const lib = requireMeetings(res);
    if (lib === null) return;
    const id = meetingIdFrom(path);
    if (id === null || !lib.remove(id)) {
      return json(res, 404, {
        error: {
          code: 'no-such-meeting',
          message: `No meeting with id ${JSON.stringify(id ?? '')} is in the archive.`,
          resolve: 'List the archive at GET /counsel/meetings.',
        },
      });
    }
    json(res, 200, { deleted: id });
  }

  /**
   * Ask the local model a question about past meetings.
   *
   * The chain is: retrieve -> build a grounded prompt -> ask Ollama -> CHECK the
   * answer's citations -> return. The check is the part that is not optional. A
   * model that cites `[m-014/u7]` for a meeting that never happened has invented
   * the owner's own history, so `grounded:false` ships with the exact fabricated
   * ids and the UI must refuse to render it as fact.
   *
   * Two paths never reach a model at all: no retrieval hits, and Ollama absent.
   * Both answer honestly rather than guessing, because there is no answer that
   * would be better than saying so.
   */
  async function postCounselAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const lib = requireMeetings(res);
    if (lib === null) return;
    const body = await readJson(req);
    const question = str(body, 'question');
    if (question === null || question.trim() === '') {
      return json(res, 400, {
        error: { code: 'bad-request', message: 'Ask a question.', resolve: 'POST {"question":"what did I commit to last week?"}.' },
      });
    }

    const hits = lib.recall(question);
    const cited = hits.map((h) => ({ id: h.meeting.id, title: h.meeting.title, startedAt: h.meeting.startedAt, matched: h.matched, lines: h.lines.map((l) => l.id) }));

    // Nothing retrieved: say so in the product's own words. Sending an empty
    // context to a model and hoping it refuses is exactly how a hallucination
    // gets in, so we do not send one.
    if (hits.length === 0) {
      return json(res, 200, {
        ok: true,
        answer: NOT_FOUND,
        unverified: null,
        cites: [],
        ungrounded: [],
        fabricated: [],
        grounded: true,
        hits: cited,
        note: 'No meeting in your archive matched that question, so nothing was sent to a model.',
      });
    }

    const prompt = buildAnswerPrompt(question, hits);
    const model = str(body, 'model') ?? undefined;
    const run = await askLocalModel(prompt, model);
    if (!run.ok) {
      return json(res, 200, {
        ok: false,
        answer: null,
        unverified: null,
        cites: [],
        ungrounded: [],
        fabricated: [],
        grounded: false,
        hits: cited,
        model: run.model,
        note: run.note,
      });
    }

    const check = groundedAnswer(run.text, hits);
    // `answer` is the field a client renders, so an ungrounded one never goes in
    // it. The text is still returned — under a name no UI would print by
    // accident — because the owner is entitled to see what their machine said
    // and why it was rejected. Leaving it in `answer` with a `grounded:false`
    // flag beside it would make a client's careless `if (d.ok) show(d.answer)`
    // render an invented meeting as fact, and the flag would be doing the work
    // that the field name should be doing. Same shape as the two branches above:
    // when there is no answer that can be trusted, `answer` is null.
    json(res, 200, {
      ok: true,
      answer: check.ok ? run.text : null,
      unverified: check.ok ? null : run.text,
      cites: check.citedIds,
      ungrounded: check.uncited,
      fabricated: check.fabricated,
      grounded: check.ok,
      hits: cited,
      model: run.model,
      note: check.ok
        ? null
        : check.fabricated.length > 0
          ? `The model cited ${check.fabricated.length} id(s) that exist in no meeting of yours. This answer is not grounded and must not be shown as fact.`
          : 'Part of this answer carries no citation. The uncited claims are listed; they are not supported by your meetings.',
    });
  }

  /**
   * Ask Ollama one question and hand the raw text back. Same transport as
   * `runLocalModel` (the HTTP API on 127.0.0.1:11434, never the `ollama` CLI —
   * the daemon's PATH may not have the binary), but this one wants prose, not a
   * file envelope, so it does not parse the response into anything.
   */
  async function askLocalModel(
    prompt: string,
    model: string | undefined,
  ): Promise<{ ok: true; text: string; model: string } | { ok: false; note: string; model: string }> {
    const chosen = model && model.trim() ? model.trim() : 'qwen3:8b';
    // The CONNECTION is what tells us whether Ollama is running, so only the
    // connection is inside this try. Reading the body used to be in here too,
    // which meant a live Ollama answering with something unparseable was
    // reported as "Ollama is not running" — a confident statement about the
    // owner's machine that was simply false, and one that sends them to restart
    // a service that never stopped.
    let r: Response;
    try {
      r = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: chosen, prompt, stream: false, think: false }),
      });
    } catch {
      return {
        ok: false,
        model: chosen,
        // No answer is invented in this branch, and none ever will be: with no
        // model there is nothing to ground an answer against.
        note: `Ollama is not running, so nobody can answer this. Start it, then pull a model (e.g. ollama pull ${chosen}). Your meetings are still on disk and still searchable.`,
      };
    }
    if (!r.ok) {
      return { ok: false, model: chosen, note: `Ollama returned ${r.status}. Is the model pulled? (ollama pull ${chosen})` };
    }
    let text: string;
    try {
      text = withoutReasoning(((await r.json()) as { response?: string }).response ?? '');
    } catch {
      return {
        ok: false,
        model: chosen,
        note: `Ollama is running and answered ${r.status}, but the reply was not the JSON this expects, so there is no answer to ground. Nothing was invented. Check that 127.0.0.1:11434 is Ollama and not another service.`,
      };
    }
    if (text.trim() === '') {
      return { ok: false, model: chosen, note: 'The local model returned an empty answer. Try again, or a larger model.' };
    }
    return { ok: true, model: chosen, text: text.trim() };
  }

  // ---- Mesh: devices, and a pairing that has no second end yet ------------
  //
  // THE HONEST PART, stated once here because every route below depends on it:
  // the protocol core is built and the other end is not. Pairing, sealed
  // envelopes and the convergent log are tested against a SIMULATED second
  // device; the phone client that would be the real one does not exist, and no
  // transport carries bytes to it either. So this daemon can start a pairing —
  // mint a real invite, show a real short code — and it can never finish one.
  // These routes say that plainly rather than serving an empty device list that
  // reads like a phone that dropped off.

  /** The transmittable half of a pairing, plus why it cannot be completed. */
  function pairingView(p: MeshPairing): Record<string, unknown> {
    return {
      // What a second device would receive over the wire. The transfer format
      // (QR, deep link, typed) is deliberately NOT invented here: there is no
      // phone client to agree with, and guessing one would be fiction.
      invite: {
        deviceId: p.offer.invite.deviceId,
        publicKey: p.offer.invite.publicKey.toString('hex'),
      },
      // The code the owner reads aloud. Real, from the mesh package's CSPRNG.
      code: p.offer.code,
      startedAt: p.startedAt,
      completable: false,
      blockedBy:
        'The Zeno phone client is not built, so no second device can answer this invite. ' +
        'The invite and the code are real and this pairing is genuinely open — it will simply ' +
        'stay open until you cancel it.',
    };
  }

  /**
   * Who this machine is on the mesh, who it is paired with, and what is missing.
   *
   * Readable by either role: knowing which devices exist is not pairing with
   * one, the same line /work draws. `paired` comes from the real TrustStore.
   */
  function serveMeshDevices(res: ServerResponse): void {
    const self = meshIdentity();
    json(res, 200, {
      thisDevice: {
        label: 'This PC',
        host: hostname(),
        deviceId: self.deviceId,
        publicKey: self.publicKey.toString('hex'),
        since: meshSince,
        // Said out loud because it changes what the owner sees after a restart.
        identityPersisted: false,
      },
      paired: meshTrust.devices(),
      pairing: meshPairing === null ? null : pairingView(meshPairing),
      phoneClient: {
        built: false,
        note:
          'The Zeno phone client is not built. No second device can complete a pairing yet — ' +
          'there is nothing on the other end to receive an invite or send one back.',
      },
    });
  }

  /**
   * Start a pairing: mint the invite this machine would transmit and the short
   * code it shows for the owner to carry by hand. Owner-only — trusting a new
   * device is the owner's call, the same way starting an agent is.
   */
  function postMeshPairing(res: ServerResponse, role: Role): void {
    if (role !== 'owner') {
      return json(res, 403, {
        error: {
          code: 'owner-only',
          message: 'Only the owner can start a pairing.',
          resolve: 'Start it from the Zeno window.',
        },
      });
    }
    // A second Start would silently replace a code the owner may already have
    // read out loud, which is exactly the confusion the code exists to prevent.
    if (meshPairing !== null) {
      return json(res, 409, {
        error: {
          code: 'pairing-in-progress',
          message: 'A pairing is already open, showing a code that may already have been read out.',
          resolve: 'Use the code that is showing, or cancel it (POST /mesh/pairing/cancel) and start again.',
        },
      });
    }
    meshPairing = { offer: beginPairing(meshIdentity()), startedAt: new Date().toISOString() };
    json(res, 200, { pairing: pairingView(meshPairing) });
  }

  /** Forget the open pairing and its code. Cancelling nothing is not an error. */
  function postMeshPairingCancel(res: ServerResponse, role: Role): void {
    if (role !== 'owner') {
      return json(res, 403, {
        error: {
          code: 'owner-only',
          message: 'Only the owner can cancel a pairing.',
          resolve: 'Cancel it from the Zeno window.',
        },
      });
    }
    const cancelled = meshPairing !== null;
    meshPairing = null;
    json(res, 200, { cancelled, pairing: null });
  }

  /**
   * Run the real handshake against a peer simulated INSIDE this process, and
   * report what both sides derived.
   *
   * This is the one honest way to show the protocol works while the other end
   * does not exist. It proves the two claims that matter: both sides derive the
   * SAME verification string from opposite viewpoints, and a peer given the
   * WRONG code derives a different one — the silent, total failure that stops a
   * mistyped or intercepted code from becoming a working session.
   *
   * The simulated peer is ephemeral and is discarded when this function returns.
   * It is NOT remembered in the trust store, so it can never appear as a device.
   */
  function postMeshSelfCheck(res: ServerResponse, role: Role): void {
    if (role !== 'owner') {
      return json(res, 403, {
        error: {
          code: 'owner-only',
          message: 'Only the owner can run the mesh self-check.',
          resolve: 'Run it from the Zeno window.',
        },
      });
    }
    const self = meshIdentity();
    const peer = createIdentity(); // simulated, ephemeral, never stored
    const offer = beginPairing(self);
    const accepted = acceptPairing(peer, offer.invite, offer.code);
    const completed = completePairing(self, accepted.response, offer.code);
    const mistyped = acceptPairing(peer, offer.invite, otherCode(offer.code));
    json(res, 200, {
      selfCheck: {
        simulatedPeer: true,
        paired: false,
        sas: completed.session.sas,
        sasMatch: completed.session.sas === accepted.session.sas,
        wrongCodeDiverges: mistyped.session.sas !== accepted.session.sas,
        localDeviceId: self.deviceId,
        simulatedPeerDeviceId: peer.deviceId,
        note:
          'This ran the real pairing handshake between this machine and a second device simulated ' +
          'inside the daemon. Both sides derived the same verification code, and a peer given the ' +
          'wrong code derived a different one — which is the failure the protocol is designed to ' +
          'have. The simulated peer was discarded: nothing was paired, nothing was stored, and no ' +
          'device was added.',
      },
    });
  }

  async function postPreview(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    const body = await readJson(req);
    const relPath = str(body, 'relPath');
    const contents = str(body, 'contents');
    const summary = str(body, 'summary');
    if (relPath === null || contents === null || summary === null) {
      return json(res, 400, {
        error: {
          code: 'bad-request',
          message: 'A proposal needs relPath, contents and summary.',
          resolve: 'POST {"relPath":"src/App.tsx","contents":"...","summary":"what this does"}.',
        },
      });
    }
    // Label the SURFACE that asked, never the person. L6 refuses when the
    // proposer and the approver are the same identity — which is right for an
    // agent, and wrong for the owner's own window. Labelling an owner-side
    // proposal "owner" made the owner unable to approve it, so anything the
    // window itself proposed (a spoken command, most visibly) was held forever
    // with no way to ever say yes. Voice's documented contract is exactly this:
    // speaking PROPOSES and the hand APPROVES — two deliberate acts by one
    // person. A real agent still carries the proposer token and still cannot
    // approve, because that is enforced by role at the route, not by this label.
    const requestedBy = str(body, 'requestedBy') ?? (role === 'owner' ? 'window' : 'agent');
    const out = await proposeFileWrite(relPath, contents, summary, requestedBy);
    json(res, 200, out);
  }

  /**
   * The one gated path a file change takes, whoever proposed it — a POST to
   * /previews, or a file the Forge agent wrote in its worktree. Jail, assess
   * risk, scan for secrets, preview through the kernel, hold as a capsule (or
   * auto-apply when routine), and stream it. Returns the same shape /previews does.
   */
  async function proposeFileWrite(
    relPath: string,
    contents: string,
    summary: string,
    requestedBy: string,
  ): Promise<Record<string, unknown>> {
    const abs = jail(opts.fs, opts.sandbox, relPath);
    const before = opts.fs.readFile(abs);
    const payload = makeWritePayload(relPath, before, contents);
    const risk = assessWrite(relPath, before, contents);
    const secrets = sanitize(contents).findings;
    const secretWarning =
      secrets.length > 0 ? { count: secrets.length, kinds: [...new Set(secrets.map((f) => f.label))] } : null;
    // ASSESSED, never client-supplied (that was a live L1 breach). A secret in a
    // routine write escalates it to needing the owner.
    const kind: ActionKind = secretWarning && risk.routine ? 'patch.task' : risk.kind;
    const request: ActionRequest = {
      kind, summary, targetRef: abs, payload, baseHash: payload.expectBaseHash, requestedBy, dataZones: ['personal'],
    };
    const preview = opts.kernel.preview(request);
    held.set(preview.actionHash, { preview, payload, req: request });
    persistHeld();
    if (preview.auto) {
      const receipt = await opts.kernel.commit(
        preview.actionHash,
        worktreeExecutor({ root: opts.sandbox, fs: opts.fs }, payload),
      );
      held.delete(preview.actionHash);
      persistHeld();
      opts.stream.publish('receipt', receipt);
      opts.stream.publish('chain', opts.kernel.verifyChain());
      return { preview, receipt, risk, secretWarning };
    }
    opts.stream.publish('preview', { ...withPayload({ preview, payload, req: request }), secretWarning });
    return { preview, risk, secretWarning };
  }

  async function postApproval(req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
    // THE line this whole package exists to draw.
    if (role !== 'owner') {
      return json(res, 403, {
        error: {
          code: 'self-approval-forbidden',
          message: 'The proposer token cannot approve. Only the owner token can.',
          resolve: 'Approve from the Zeno window. An agent is structurally unable to grant this.',
        },
      });
    }
    const body = await readJson(req);
    const actionHash = str(body, 'actionHash');
    if (actionHash === null) {
      return json(res, 400, {
        error: { code: 'bad-request', message: 'An approval needs an actionHash.', resolve: 'POST {"actionHash":"..."}.' },
      });
    }
    const item = held.get(actionHash);
    if (item === undefined) {
      return json(res, 404, {
        error: {
          code: 'unknown-action',
          message: 'No previewed action with that hash is waiting.',
          resolve: 'Re-preview the action; a preview may have expired or the daemon restarted.',
        },
      });
    }

    // The owner token IS the authenticator at this stage. A real platform
    // authenticator (Windows Hello) is a later slice; saying so plainly beats
    // pretending the tier gate is stronger than it is.
    const approval = opts.kernel.approve(actionHash, { method: 'owner-token', ref: 'loopback' }, { approver: 'owner' });
    const receipt = await opts.kernel.commit(
      approval,
      worktreeExecutor({ root: opts.sandbox, fs: opts.fs }, item.payload),
    );

    held.delete(actionHash);
    persistHeld();
    opts.stream.publish('receipt', receipt);
    opts.stream.publish('chain', opts.kernel.verifyChain());
    json(res, 200, { approval, receipt });
  }
}

// ---- small helpers --------------------------------------------------------

function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (raw === undefined) return undefined;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
  res.end(text);
}

/**
 * A code that is definitely NOT the one shown — the mesh self-check uses it to
 * demonstrate that a peer given the wrong code derives a different session and
 * simply cannot talk. Flipping one digit is enough; the codes are 6 digits.
 */
function otherCode(code: string): string {
  return (code.charAt(0) === '0' ? '1' : '0') + code.slice(1);
}

function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' ? v : null;
}

/**
 * An optional array of strings. Absent is `[]`; present-but-wrong is null, so
 * the caller can tell "you did not send labels" from "what you sent is not
 * labels" and answer each differently.
 */
function strings(body: Record<string, unknown>, key: string): string[] | null {
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
class RequestTooLarge extends Error {}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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
function fail(res: ServerResponse, err: unknown): void {
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
