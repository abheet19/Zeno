/**
 * Forge's smaller operational routes: which agents/models are available, the
 * automatic agent router, the owner terminal, and repository test discovery
 * and execution.
 */
import { dirname, join, relative, sep } from 'node:path';
import { existsSync, opendirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AGENTS, EFFORTS, nodeSpawner, routeAgentTask } from '@abheet19/zeno-forge';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { ensureOllama } from './ollama-lifecycle.js';
import { probeAgents } from './delegate-probe.js';
import { readUtf8Bounded } from './forge-text.js';

/** Test discovery and execution stay useful in a monorepo without walking an unbounded tree. */
const MAX_TEST_PACKAGE_FILES = 256;
const MAX_TEST_DIRECTORIES = 512;
const MAX_TEST_DEPTH = 5;
const MAX_TEST_OUTPUT_CHARS = 250_000;
const TEST_TIMEOUT_MS = 5 * 60_000;
const TEST_SCRIPT_NAME = /^(?:test(?::[A-Za-z0-9_.-]+)?|check|typecheck|lint)$/;

export async function serveForgeAgents(ctx: ServerCtx, res: ServerResponse, mayStartLocalRuntime: boolean): Promise<void> {
  if (mayStartLocalRuntime && ctx.opts.ollamaAutoStart === true) await ensureOllama(ctx);
  const availability = await probeAgents(ctx);
  const localModels = [...availability.localModels];
  const agents = AGENTS.map((agent) => {
    const available = agent.id === 'claude-code'
      ? availability.claudeOnPath
      : agent.id === 'codex'
        ? availability.codexOnPath === true
        : localModels.length > 0;
    const unavailableReason = available
      ? null
      : agent.id === 'claude-code'
        ? 'Claude Code CLI is not installed or is not runnable from this desktop session.'
        : agent.id === 'codex'
          ? 'Codex CLI is not installed or is not runnable from this desktop session.'
          : 'Ollama has no installed model available to run.';
    return { ...agent, available, unavailableReason, hosted: agent.id !== 'local' };
  });
  json(res, 200, { agents, efforts: EFFORTS, localModels });
}

/**
 * Resolve the automatic picker before a run starts. The router is a pure,
 * explainable ruleset: no prompt leaves the loopback daemon, no model is
 * called, and this route grants no capability. The selected agent still runs
 * inside Forge's isolated worktree and every effect crosses the usual gate.
 */
export async function postForgeRoute(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can route an agent task.', resolve: 'Route it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const task = str(body, 'task');
  if (task === null || task.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'Routing needs a task.', resolve: 'POST {"task":"..."}.' } });
  }
  if (ctx.opts.ollamaAutoStart === true) await ensureOllama(ctx);
  const availability = await probeAgents(ctx);
  const availableAgentIds = AGENTS
    .filter((agent) => agent.id === 'local'
      ? availability.localModels.length > 0
      : agent.id === 'codex'
        ? availability.codexOnPath === true
        : availability.claudeOnPath)
    .map((agent) => agent.id);
  json(res, 200, { route: routeAgentTask(task, { localModels: availability.localModels, availableAgentIds }) });
}

export async function postForgeTerminal(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can run a terminal command.', resolve: 'Run it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const command = str(body, 'command');
  if (command === null || command.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'Type a command to run.', resolve: 'The command runs in the selected repository.' } });
  }
  if (command.length > 4_000 || command.includes(String.fromCharCode(0))) {
    return json(res, 413, { error: { code: 'command-too-large', message: 'The command is too long.', resolve: 'Run one bounded command at a time (maximum 4,000 characters).' } });
  }
  const runner = ctx.opts.terminalRunner ?? nodeSpawner({ timeoutMs: 30_000, killTreeOnTimeout: true });
  const shell = process.platform === 'win32' ? (process.env['ComSpec'] ?? 'cmd.exe') : (process.env['SHELL'] ?? '/bin/sh');
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
  const result = await runner.run(shell, args, { cwd: ctx.opts.sandbox, timeoutMs: 30_000 });
  const cap = (value: string): string => value.length > 250_000 ? `${value.slice(0, 250_000)}\n…[output clipped at 250,000 characters]` : value;
  json(res, 200, {
    ok: !result.failedToSpawn && result.code === 0,
    code: result.code,
    failedToSpawn: result.failedToSpawn,
    stdout: cap(result.stdout),
    stderr: cap(result.stderr),
    cwd: ctx.opts.sandbox,
  });
}

interface TestScriptEntry {
  readonly id: string;
  readonly packageName: string;
  readonly packagePath: string;
  readonly script: string;
  readonly scriptBody: string;
  readonly scriptBodyClipped: boolean;
  readonly packageManager: 'npm' | 'pnpm' | 'yarn';
  readonly displayCommand: string;
  /** Kept server-side; never trusted from the client. */
  readonly cwd: string;
}

interface TestCatalog {
  readonly scripts: readonly TestScriptEntry[];
  readonly scannedPackages: number;
  readonly scannedDirectories: number;
  readonly truncated: boolean;
  readonly packageManager: 'npm' | 'pnpm' | 'yarn';
}

/**
 * Discover only exact, named verification scripts from package manifests.
 *
 * The client sends back an opaque id, never a command. Execution re-runs this
 * discovery and resolves the id against the current package.json, so a stale
 * or forged browser request cannot smuggle shell text into the process call.
 */
function discoverForgeTests(ctx: ServerCtx): TestCatalog {
  const ignored = new Set([
    '.git', '.next', '.turbo', '.venv', '__pycache__', 'build', 'coverage',
    'dist', 'node_modules', 'out', 'target', 'vendor',
  ]);
  const rootManager = (() => {
    try {
      const parsed = JSON.parse(readUtf8Bounded(join(ctx.opts.sandbox, 'package.json'), 128_000).text) as { packageManager?: unknown };
      const declared = typeof parsed.packageManager === 'string' ? parsed.packageManager.split('@')[0] : '';
      if (declared === 'pnpm' || declared === 'yarn' || declared === 'npm') return declared;
    } catch { /* lockfiles below are the next source of truth */ }
    if (existsSync(join(ctx.opts.sandbox, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(ctx.opts.sandbox, 'yarn.lock'))) return 'yarn';
    return 'npm';
  })();

  const scripts: TestScriptEntry[] = [];
  const queue: { readonly abs: string; readonly depth: number }[] = [{ abs: ctx.opts.sandbox, depth: 0 }];
  let scannedDirectories = 0;
  let scannedPackages = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (scannedDirectories >= MAX_TEST_DIRECTORIES || scannedPackages >= MAX_TEST_PACKAGE_FILES) {
      truncated = true;
      break;
    }
    const current = queue.shift();
    if (!current) break;
    scannedDirectories++;
    let handle: ReturnType<typeof opendirSync> | undefined;
    try {
      handle = opendirSync(current.abs);
      for (let item = handle.readSync(); item !== null; item = handle.readSync()) {
        if (item.isSymbolicLink()) continue;
        if (item.isDirectory()) {
          if (current.depth < MAX_TEST_DEPTH && !ignored.has(item.name)) {
            queue.push({ abs: join(current.abs, item.name), depth: current.depth + 1 });
          }
          continue;
        }
        if (!item.isFile() || item.name !== 'package.json') continue;
        if (++scannedPackages > MAX_TEST_PACKAGE_FILES) {
          truncated = true;
          break;
        }
        const manifestPath = join(current.abs, item.name);
        let manifest: { name?: unknown; scripts?: unknown };
        try {
          manifest = JSON.parse(readUtf8Bounded(manifestPath, 128_000).text) as typeof manifest;
        } catch {
          continue; // malformed package manifests are not runnable test entries
        }
        if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) continue;
        const packagePathRaw = relative(ctx.opts.sandbox, current.abs);
        const packagePath = packagePathRaw === '' ? '.' : packagePathRaw.split(sep).join('/');
        const packageName = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name.trim() : packagePath;
        for (const [script, rawBody] of Object.entries(manifest.scripts as Record<string, unknown>)) {
          if (!TEST_SCRIPT_NAME.test(script) || typeof rawBody !== 'string') continue;
          const scriptBodyClipped = rawBody.length > 500;
          const scriptBody = scriptBodyClipped ? `${rawBody.slice(0, 500)}…` : rawBody;
          const id = Buffer.from(JSON.stringify([packagePath, script]), 'utf8').toString('base64url');
          const displayCommand = rootManager === 'yarn'
            ? `yarn run ${script}`
            : `${rootManager} run ${script}`;
          scripts.push({
            id, packageName, packagePath, script, scriptBody, scriptBodyClipped,
            packageManager: rootManager, displayCommand, cwd: dirname(manifestPath),
          });
        }
      }
    } catch {
      // A directory that cannot be read contributes no invented scripts.
    } finally {
      try { handle?.closeSync(); } catch { /* keep the original result */ }
    }
  }
  scripts.sort((a, b) => a.packagePath === b.packagePath
    ? a.script.localeCompare(b.script)
    : a.packagePath.localeCompare(b.packagePath));
  return { scripts, scannedPackages: Math.min(scannedPackages, MAX_TEST_PACKAGE_FILES), scannedDirectories, truncated, packageManager: rootManager };
}

function publicTestEntry(entry: TestScriptEntry): Omit<TestScriptEntry, 'cwd'> {
  return {
    id: entry.id,
    packageName: entry.packageName,
    packagePath: entry.packagePath,
    script: entry.script,
    scriptBody: entry.scriptBody,
    scriptBodyClipped: entry.scriptBodyClipped,
    packageManager: entry.packageManager,
    displayCommand: entry.displayCommand,
  };
}

export function serveForgeTests(ctx: ServerCtx, res: ServerResponse): void {
  const catalog = discoverForgeTests(ctx);
  json(res, 200, {
    ...catalog,
    scripts: catalog.scripts.map(publicTestEntry),
    activeRunId: ctx.activeTestRunId,
    note: 'Only test, test:*, check, typecheck, and lint scripts declared in package.json are runnable here. Forge passes the selected script name directly to the detected package manager; it accepts no command or extra arguments from the browser.',
  });
}

export async function postForgeTestRun(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can run repository tests.', resolve: 'Run the selected package script from the Zeno window.' } });
  }
  const body = await readJson(req);
  const id = str(body, 'id');
  if (id === null || id.length > 1_024 || id.includes(String.fromCharCode(0))) {
    return json(res, 400, { error: { code: 'bad-test-id', message: 'Choose a discovered test script.', resolve: 'Refresh the Tests panel and use one of its Run buttons.' } });
  }
  if (ctx.activeTestRunId !== null) {
    return json(res, 409, { error: { code: 'test-run-active', message: 'A repository verification script is already running.', resolve: 'Wait for it to finish before starting another.' } });
  }
  const entry = discoverForgeTests(ctx).scripts.find((candidate) => candidate.id === id);
  if (!entry) {
    return json(res, 404, { error: { code: 'test-not-found', message: 'That test script is no longer declared by this repository.', resolve: 'Refresh the Tests panel.' } });
  }

  ctx.activeTestRunId = entry.id;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const runner = ctx.opts.testRunner ?? nodeSpawner({ timeoutMs: TEST_TIMEOUT_MS, killTreeOnTimeout: true });
  const args = entry.packageManager === 'yarn'
    ? ['run', entry.script]
    : ['run', entry.script, '--silent'];
  try {
    const result = await runner.run(entry.packageManager, args, { cwd: entry.cwd, timeoutMs: TEST_TIMEOUT_MS });
    const cap = (value: string): { readonly text: string; readonly clipped: boolean } => value.length > MAX_TEST_OUTPUT_CHARS
      ? { text: `${value.slice(0, MAX_TEST_OUTPUT_CHARS)}\n…[output clipped at ${MAX_TEST_OUTPUT_CHARS.toLocaleString('en-US')} characters]`, clipped: true }
      : { text: value, clipped: false };
    const stdout = cap(result.stdout);
    const stderr = cap(result.stderr);
    json(res, 200, {
      id: entry.id,
      packageName: entry.packageName,
      packagePath: entry.packagePath,
      script: entry.script,
      displayCommand: entry.displayCommand,
      startedAt,
      durationMs: Math.max(0, Date.now() - started),
      ok: !result.failedToSpawn && result.code === 0,
      code: result.code,
      failedToSpawn: result.failedToSpawn,
      timedOut: result.failedToSpawn && /still running after/i.test(result.stderr),
      stdout: stdout.text,
      stderr: stderr.text,
      outputClipped: stdout.clipped || stderr.clipped,
    });
  } finally {
    if (ctx.activeTestRunId === entry.id) ctx.activeTestRunId = null;
  }
}
