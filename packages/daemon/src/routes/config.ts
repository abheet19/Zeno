/**
 * Two small pieces of owner-configured, workspace-persisted state: scheduled
 * tasks (a timed trigger that only ever ADDS A WORK ITEM — never an approved
 * action) and the "customize" MCP server list (a recorded configuration,
 * never an ambient connection).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../tokens.js';
import type { McpServerConfig, ScheduledTask, ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';

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
