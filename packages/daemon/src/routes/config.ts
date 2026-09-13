/**
 * Three small pieces of owner-configured, workspace-persisted state: scheduled
 * tasks (a timed trigger that only ever ADDS A WORK ITEM — never an approved
 * action), the "customize" MCP server list (a recorded configuration, never
 * an ambient connection), and the ACTIVE PROJECT ROOT — the repository every
 * Forge read, terminal command, agent run and governed write is jailed to.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import type { GitRunner } from '@abheet19/zeno-kernel';
import type { Role } from '../tokens.js';
import type { McpServerConfig, ScheduledTask, ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';

// ---- the active project root ---------------------------------------------
//
// Forge used to show the owner a "SANDBOX" — the scratch repository under
// ZENO_DIR that the E2E suite seeds — and offered no way to point it at their
// own code short of restarting the daemon with ZENO_PROJECT_DIR. The root is
// now a piece of owner state like the schedule: read here, changed by an
// owner-only route, persisted to the workspace so it survives a restart, and
// resolved once at startup by main.ts through the SAME inspector the route
// uses, so "a folder Forge will open" means exactly one thing.

/** The one file that remembers the owner's choice, beside the ledger. */
export function projectConfigPath(workspace: string): string {
  return join(workspace, 'project.json');
}

/** The built-in scratch repository, used only when nothing else is chosen. */
export function scratchProjectRoot(workspace: string): string {
  return join(workspace, 'sandbox');
}

export type ProjectInspection =
  | { readonly ok: true; readonly root: string; readonly requested: string }
  | { readonly ok: false; readonly message: string; readonly resolve: string };

/**
 * Decide whether a folder can be Forge's project. It must exist, be a
 * directory, and sit inside a Git repository — every agent run is isolated
 * in a `git worktree`, so a plain folder cannot host one. A sub-folder is
 * accepted and resolved UP to its repository root (git's own answer), the way
 * the desktop picker already behaves; the caller is told when that happened.
 */
export function inspectProjectRoot(git: GitRunner, requested: string): ProjectInspection {
  const wanted = requested.trim();
  if (wanted === '') return { ok: false, message: 'Name the folder to work in.', resolve: 'POST {"path":"D:\\\\code\\\\my-repo"}, or {"path":null} for the scratch repository.' };
  let dir: string;
  try {
    dir = realpathSync.native(resolve(wanted));
    if (!statSync(dir).isDirectory()) throw new Error('not a directory');
  } catch {
    return { ok: false, message: `That folder cannot be read: ${wanted}`, resolve: 'Check the path exists on this machine and is a directory.' };
  }
  const top = git.run(['rev-parse', '--show-toplevel'], dir);
  if (top.status !== 0 || top.stdout.trim() === '') {
    return {
      ok: false,
      message: `${dir} is not inside a Git repository.`,
      resolve: 'Forge isolates every agent run with git worktrees, so it needs a repository — run `git init` there first, or choose a folder that already has one.',
    };
  }
  let root: string;
  try { root = realpathSync.native(resolve(top.stdout.trim())); }
  catch { return { ok: false, message: `Git found a repository root that cannot be read: ${top.stdout.trim()}`, resolve: 'Check the repository is intact.' }; }
  return { ok: true, root, requested: dir };
}

/** The saved choice, or null when none was saved (or the file is unreadable). */
export function readSavedProject(workspace: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(projectConfigPath(workspace), 'utf8')) as { path?: unknown };
    return typeof parsed.path === 'string' && parsed.path.trim() !== '' ? parsed.path.trim() : null;
  } catch {
    return null;
  }
}

function saveProject(workspace: string, root: string | null): void {
  const path = projectConfigPath(workspace);
  if (root === null) { rmSync(path, { force: true }); return; }
  writeFileSync(path, JSON.stringify({ path: root }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/**
 * The scratch repository has to be a real git repo with a HEAD so `git
 * worktree add` (a Forge run) works. Idempotent — a repo that already exists
 * is left alone. It is its OWN repo on purpose: checking rev-parse would find
 * the PARENT repository (the workspace lives under a checkout) and skip init,
 * leaving Forge pointed at the wrong repository.
 */
export function ensureScratchRepo(git: GitRunner, workspace: string): string {
  const root = scratchProjectRoot(workspace);
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, '.git'))) {
    git.run(['init'], root);
    git.run(['config', 'user.email', 'owner@zeno.local'], root);
    git.run(['config', 'user.name', 'Zeno Owner'], root);
    // An empty root commit carries nothing — the scratch repo's real history
    // starts after it — but a HEAD must exist for worktrees to be created.
    git.run(['commit', '--allow-empty', '-m', 'zeno: sandbox initialised'], root);
  }
  return root;
}

export interface StartupProject {
  readonly root: string;
  readonly source: 'environment' | 'saved' | 'scratch';
  /** A saved choice that could not be opened this start, with the reason. */
  readonly savedProblem: { readonly path: string; readonly problem: string } | null;
}

/**
 * What main.ts opens at startup. `ZENO_PROJECT_DIR` is an explicit, per-launch
 * override and an invalid one is a hard error (a launcher that named a folder
 * must not quietly get the scratch repo instead). The saved choice is softer:
 * a repository that was deleted or moved since must not lock the owner out,
 * so it falls back to scratch AND the reason is carried to the window.
 */
export function resolveStartupProject(git: GitRunner, workspace: string, env: NodeJS.ProcessEnv): StartupProject {
  const requested = (env['ZENO_PROJECT_DIR'] ?? '').trim();
  if (requested !== '') {
    const seen = inspectProjectRoot(git, requested);
    if (!seen.ok) throw new Error(`ZENO_PROJECT_DIR: ${seen.message} ${seen.resolve}`);
    return { root: seen.root, source: 'environment', savedProblem: null };
  }
  const saved = readSavedProject(workspace);
  if (saved !== null) {
    const seen = inspectProjectRoot(git, saved);
    if (seen.ok) return { root: seen.root, source: 'saved', savedProblem: null };
    return { root: ensureScratchRepo(git, workspace), source: 'scratch', savedProblem: { path: saved, problem: seen.message } };
  }
  return { root: ensureScratchRepo(git, workspace), source: 'scratch', savedProblem: null };
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The wire shape both project routes answer with — everything the window shows is read from here. */
function wireProject(ctx: ServerCtx): Record<string, unknown> {
  const root = ctx.opts.sandbox;
  const workspace = ctx.opts.workspace;
  const scratch = workspace !== undefined && samePath(root, scratchProjectRoot(workspace));
  const env = (process.env['ZENO_PROJECT_DIR'] ?? '').trim();
  const saved = workspace !== undefined ? readSavedProject(workspace) : null;
  let savedProblem: { path: string; problem: string } | null = null;
  if (saved !== null && !samePath(resolve(saved), root)) {
    // A saved project that is NOT the open one: either it could not be opened
    // at startup (say why), or an explicit env override took precedence.
    const seen = inspectProjectRoot(ctx.gitRunner, saved);
    savedProblem = { path: saved, problem: seen.ok ? 'ZENO_PROJECT_DIR took precedence for this launch.' : seen.message };
  }
  const source = env !== '' && samePath(resolve(env), root) ? 'environment' : scratch ? 'scratch' : 'chosen';
  // Nothing may be switched from under a proposal the owner has not decided,
  // a run that is mid-flight in a worktree of THIS repository, or a test
  // script still running in it — each is reported so the window can disable
  // its control with the real reason rather than let a click fail.
  const waiting = ctx.held.size + ctx.gateHeld.size;
  const blocker = waiting > 0
    ? `${waiting} proposal${waiting === 1 ? ' is' : 's are'} waiting for your decision in Command — approve or refuse them first.`
    : ctx.activeForgeRuns.size > 0
      ? 'An agent run is in progress in this repository — wait for it to finish or cancel it.'
      : ctx.activeTestRunId !== null
        ? 'A repository test script is still running — wait for it to finish.'
        : null;
  return {
    root,
    name: basename(root),
    scratch,
    source,
    persisted: workspace !== undefined,
    savedProblem,
    canChange: blocker === null,
    changeBlockedBy: blocker,
    scratchRoot: workspace !== undefined ? scratchProjectRoot(workspace) : null,
    note: scratch
      ? 'Zeno scratch repository — choose a folder to work on your own code.'
      : 'Every Forge read, terminal command, agent run and governed write is jailed to this repository.',
  };
}

export function serveForgeProject(ctx: ServerCtx, res: ServerResponse): void {
  json(res, 200, { project: wireProject(ctx) });
}

/**
 * Change the active project root in place — no restart. `{path: null}` goes
 * back to the scratch repository. Owner-only: which repository an agent may
 * touch is the owner's decision, not something a proposer may redirect.
 */
export async function postForgeProject(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can choose the working folder.', resolve: 'Choose it from the Zeno window.' } });
  const current = wireProject(ctx);
  if (current['canChange'] !== true) {
    return json(res, 409, { error: { code: 'project-busy', message: String(current['changeBlockedBy']), resolve: 'Then choose the folder again.' } });
  }
  const body = await readJson(req);
  const requested = str(body, 'path');
  let root: string;
  let requestedDir: string | null = null;
  if (requested === null || requested.trim() === '') {
    if (ctx.opts.workspace === undefined) {
      return json(res, 400, { error: { code: 'no-scratch', message: 'This daemon has no workspace, so there is no scratch repository to return to.', resolve: 'Name a repository folder instead.' } });
    }
    root = ensureScratchRepo(ctx.gitRunner, ctx.opts.workspace);
  } else {
    const seen = inspectProjectRoot(ctx.gitRunner, requested);
    if (!seen.ok) return json(res, 400, { error: { code: 'bad-project', message: seen.message, resolve: seen.resolve } });
    root = seen.root;
    requestedDir = seen.requested;
  }
  // `DaemonOptions.sandbox` is declared readonly because no ROUTE should be
  // able to move the jail as a side effect. This is the one deliberate,
  // owner-only exception, and it is done here in one place rather than by
  // threading a second "current root" through every handler: everything
  // (jail, git, terminal cwd, worktrees, catalogs) reads `ctx.opts.sandbox`
  // at call time, so after this line they all mean the new repository.
  (ctx.opts as { sandbox: string }).sandbox = root;
  if (ctx.opts.workspace !== undefined) {
    try { saveProject(ctx.opts.workspace, samePath(root, scratchProjectRoot(ctx.opts.workspace)) ? null : root); }
    catch { /* best effort; the in-memory root is still true, and GET says persisted only when a workspace exists */ }
  }
  // A nudge, not the truth: every window re-reads /forge/project and
  // /forge/status, exactly as it does for every other movement.
  ctx.opts.stream.publish('state', { project: root });
  json(res, 200, {
    project: wireProject(ctx),
    // Told plainly when a sub-folder was resolved up to its repository root.
    resolvedFrom: requestedDir !== null && !samePath(requestedDir, root) ? requestedDir : null,
  });
}

// ---- scheduled tasks -------------------------------------------------------

export function loadSchedule(ctx: ServerCtx): void {
  if (ctx.schedulePath === null || !existsSync(ctx.schedulePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(ctx.schedulePath, 'utf8')) as { tasks?: ScheduledTask[] };
    for (const t of parsed.tasks ?? []) if (t && typeof t.id === 'string') ctx.scheduledTasks.set(t.id, t);
  } catch { /* a corrupt schedule file starts empty rather than crashing the daemon */ }
}

function saveSchedule(ctx: ServerCtx): void {
  if (ctx.schedulePath === null) return;
  try { writeFileSync(ctx.schedulePath, JSON.stringify({ tasks: [...ctx.scheduledTasks.values()] }, null, 2)); } catch { /* best effort; the in-memory copy is still true */ }
}

export function fireDueScheduledTasks(ctx: ServerCtx): void {
  const now = Date.now();
  let changed = false;
  for (const t of ctx.scheduledTasks.values()) {
    if (t.paused || t.nextRunAt > now) continue;
    changed = true;
    try {
      const item = ctx.opts.work.add(`${t.title} (scheduled)`, t.body, ['scheduled']);
      t.lastResult = `added work item ${item.id} — waiting for your approval like any other`;
    } catch (err) {
      t.lastResult = `failed to add work: ${err instanceof Error ? err.message : 'error'}`;
    }
    t.lastRunAt = now;
    t.nextRunAt = now + t.everyMinutes * 60_000; // from now, so missed windows do not stack
  }
  if (changed) saveSchedule(ctx);
}

function wireSchedule(t: ScheduledTask): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    body: t.body,
    everyMinutes: t.everyMinutes,
    nextRunAt: new Date(t.nextRunAt).toISOString(),
    lastRunAt: t.lastRunAt === null ? null : new Date(t.lastRunAt).toISOString(),
    lastResult: t.lastResult,
    paused: t.paused,
    overdue: !t.paused && t.nextRunAt <= Date.now(),
  };
}

export function serveSchedule(ctx: ServerCtx, res: ServerResponse): void {
  json(res, 200, {
    tasks: [...ctx.scheduledTasks.values()].map(wireSchedule),
    now: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    persisted: ctx.schedulePath !== null,
  });
}

function scheduleOwnerOnly(res: ServerResponse, what: string): void {
  json(res, 403, { error: { code: 'owner-only', message: `Only the owner can ${what}.`, resolve: 'Do it from the Zeno window; an agent cannot schedule work.' } });
}

export async function postSchedule(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') return scheduleOwnerOnly(res, 'schedule a task');
  const body = await readJson(req);
  const title = (str(body, 'title') ?? '').trim();
  const everyMinutes = Math.round(Number(body['everyMinutes']));
  if (title === '' || title.length > 200) {
    return json(res, 400, { error: { code: 'bad-request', message: 'A scheduled task needs a title.', resolve: 'POST {"title":"…","everyMinutes":60}.' } });
  }
  if (!Number.isFinite(everyMinutes) || everyMinutes < 1 || everyMinutes > 10_080) {
    return json(res, 400, { error: { code: 'bad-request', message: 'everyMinutes must be a whole number between 1 and 10080 (a week).', resolve: 'POST {"title":"…","everyMinutes":60}.' } });
  }
  const now = Date.now();
  const task: ScheduledTask = {
    id: `sch-${now.toString(36)}-${randomUUID().slice(0, 8)}`,
    title,
    body: (str(body, 'body') ?? '').slice(0, 2000),
    everyMinutes,
    nextRunAt: now + everyMinutes * 60_000,
    lastRunAt: null,
    lastResult: null,
    paused: false,
    createdAt: now,
  };
  ctx.scheduledTasks.set(task.id, task);
  saveSchedule(ctx);
  json(res, 200, { task: wireSchedule(task) });
}

function scheduleIdFrom(path: string, suffix: string): string {
  return decodeURIComponent(path.slice('/schedule/'.length, suffix === '' ? undefined : -suffix.length));
}

export function scheduleToggle(ctx: ServerCtx, res: ServerResponse, role: Role, path: string): void {
  if (role !== 'owner') return scheduleOwnerOnly(res, 'pause a scheduled task');
  const task = ctx.scheduledTasks.get(scheduleIdFrom(path, '/toggle'));
  if (task === undefined) return json(res, 404, { error: { code: 'not-found', message: 'No scheduled task with that id.', resolve: 'It may have been deleted; re-read GET /schedule.' } });
  task.paused = !task.paused;
  if (!task.paused) task.nextRunAt = Date.now() + task.everyMinutes * 60_000; // resume from now
  saveSchedule(ctx);
  json(res, 200, { task: wireSchedule(task) });
}

export function scheduleRunNow(ctx: ServerCtx, res: ServerResponse, role: Role, path: string): void {
  if (role !== 'owner') return scheduleOwnerOnly(res, 'run a scheduled task now');
  const task = ctx.scheduledTasks.get(scheduleIdFrom(path, '/run'));
  if (task === undefined) return json(res, 404, { error: { code: 'not-found', message: 'No scheduled task with that id.', resolve: 'Re-read GET /schedule.' } });
  task.nextRunAt = Date.now();
  fireDueScheduledTasks(ctx); // adds the work item now; it still goes through the gate
  json(res, 200, { task: wireSchedule(task) });
}

export function scheduleDelete(ctx: ServerCtx, res: ServerResponse, role: Role, path: string): void {
  if (role !== 'owner') return scheduleOwnerOnly(res, 'delete a scheduled task');
  const id = scheduleIdFrom(path, '');
  const existed = ctx.scheduledTasks.delete(id);
  if (existed) saveSchedule(ctx);
  json(res, 200, { id, deleted: existed });
}

// ---- MCP servers: the owner's "customize" list (Claude-Code shaped) -------

export function loadMcpServers(ctx: ServerCtx): void {
  if (ctx.mcpConfigPath === null || !existsSync(ctx.mcpConfigPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(ctx.mcpConfigPath, 'utf8')) as { servers?: McpServerConfig[] };
    for (const s of parsed.servers ?? []) if (s && typeof s.id === 'string') ctx.mcpServers.set(s.id, s);
  } catch { /* a corrupt file starts empty rather than crashing the daemon */ }
}

function saveMcpServers(ctx: ServerCtx): void {
  if (ctx.mcpConfigPath === null) return;
  try { writeFileSync(ctx.mcpConfigPath, JSON.stringify({ servers: [...ctx.mcpServers.values()] }, null, 2)); } catch { /* best effort */ }
}

function wireMcp(s: McpServerConfig): Record<string, unknown> {
  return { id: s.id, name: s.name, transport: s.transport, command: s.command, args: s.args, url: s.url, envKeys: s.env, createdAt: new Date(s.createdAt).toISOString() };
}

export function serveMcpServers(ctx: ServerCtx, res: ServerResponse): void {
  json(res, 200, {
    servers: [...ctx.mcpServers.values()].map(wireMcp),
    persisted: ctx.mcpConfigPath !== null,
    note: 'These are RECORDED configurations. Zeno does not ambiently load MCP — recording a server here does not connect it or run it; admitting one into a governed run is a separate, gated layer. Only environment variable NAMES are stored, never their values.',
  });
}

export async function postMcpServer(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can add an MCP server.', resolve: 'Add it from the Zeno window.' } });
  const body = await readJson(req);
  const name = (str(body, 'name') ?? '').trim();
  const transport = str(body, 'transport') ?? 'stdio';
  if (name === '' || name.length > 120) return json(res, 400, { error: { code: 'bad-request', message: 'An MCP server needs a name.', resolve: 'POST {"name":"…","transport":"stdio","command":"…"}.' } });
  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'http') return json(res, 400, { error: { code: 'bad-request', message: 'transport must be stdio, sse or http.', resolve: 'Pick one of the three.' } });
  const command = (str(body, 'command') ?? '').trim();
  const url = (str(body, 'url') ?? '').trim();
  if (transport === 'stdio' && command === '') return json(res, 400, { error: { code: 'bad-request', message: 'A stdio MCP server needs a command.', resolve: 'e.g. npx -y @modelcontextprotocol/server-filesystem /path' } });
  if ((transport === 'sse' || transport === 'http') && !/^https?:\/\//.test(url)) return json(res, 400, { error: { code: 'bad-request', message: 'An sse/http MCP server needs an http(s) URL.', resolve: 'e.g. https://host/mcp' } });
  const listOf = (key: string): string[] => Array.isArray(body[key]) ? (body[key] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
  const now = Date.now();
  const server: McpServerConfig = {
    id: `mcp-${now.toString(36)}-${randomUUID().slice(0, 8)}`,
    name, transport, command, url,
    args: listOf('args'),
    env: listOf('env'), // variable names only
    createdAt: now,
  };
  ctx.mcpServers.set(server.id, server);
  saveMcpServers(ctx);
  json(res, 200, { server: wireMcp(server) });
}

export function deleteMcpServer(ctx: ServerCtx, res: ServerResponse, role: Role, path: string): void {
  if (role !== 'owner') return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can remove an MCP server.', resolve: 'Remove it from the Zeno window.' } });
  const id = decodeURIComponent(path.slice('/forge/mcp/servers/'.length));
  const existed = ctx.mcpServers.delete(id);
  if (existed) saveMcpServers(ctx);
  json(res, 200, { id, deleted: existed });
}
