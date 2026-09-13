/**
 * Ollama discovery and lifecycle: find the executable, probe whether the
 * server is up, start it on demand, and read back what is installed.
 *
 * The pure resolution helpers (`resolveOllamaExecutable` and friends) have no
 * daemon state and are exported because `server.ts` and the daemon's tests
 * still import them by that name. The rest takes `ServerCtx` because they
 * share the in-flight-start guard (`ctx.ollamaStarting`) so three simultaneous
 * requests (Forge, Ask Zeno, Counsel) start one server between them, not three.
 */
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter as pathDelimiter, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import { nodeSpawner } from '@abheet19/zeno-forge';
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const OLLAMA_PROBE_TIMEOUT_MS = 1_000;
const OLLAMA_SOCKET_TIMEOUT_MS = 350;
const OLLAMA_START_RETRY_MS = 30_000;

/**
 * Resolve the Ollama executable without assuming the desktop shell inherited a
 * developer terminal's PATH. The official Windows installer keeps it below
 * LOCALAPPDATA, which is exactly where a Start-menu launch needs to look.
 *
 * Falling back to the command name preserves portable installations and the
 * ordinary Unix PATH contract. The injected arguments keep this tiny piece of
 * environment-specific logic deterministic in its regression tests.
 */
export function resolveOllamaExecutable(
  platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (candidate: string) => boolean = existsSync,
): string {
  if (platform !== 'win32') return 'ollama';
  const localAppData = env['LOCALAPPDATA']?.trim();
  const standardInstall = localAppData
    ? join(localAppData, 'Programs', 'Ollama', 'ollama.exe')
    : null;
  if (standardInstall && exists(standardInstall)) return standardInstall;

  // Never let Windows resolve a bare executable from the selected repository.
  // Only absolute PATH entries are eligible after the official per-user path.
  const configuredPath = env['PATH'] ?? env['Path'] ?? '';
  const delimiter = platform === 'win32' ? ';' : pathDelimiter;
  for (const rawEntry of configuredPath.split(delimiter)) {
    const entry = rawEntry.trim().replace(/^"|"$/g, '');
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, 'ollama.exe');
    if (exists(candidate)) return candidate;
  }
  return standardInstall ?? join(homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe');
}

/** A failed launch attempt gets one bounded retry window instead of flashing a process per request. */
export function shouldRetryOllamaStart(now: number, lastAttemptAt: number | null): boolean {
  return lastAttemptAt === null || now < lastAttemptAt || now - lastAttemptAt >= OLLAMA_START_RETRY_MS;
}

/** Discovery may use a configured host; process auto-start is restricted to this machine. */
export function canAutoStartOllama(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Resolve the same Ollama host for discovery, generation, and auto-start checks. */
export function resolveOllamaBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env['OLLAMA_HOST']?.trim();
  if (!configured) return DEFAULT_OLLAMA_BASE_URL;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured)
    ? configured
    : `http://${configured}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('OLLAMA_HOST must be a valid HTTP or HTTPS host, for example 127.0.0.1:11434.');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.hostname === '' || parsed.username !== '' || parsed.password !== '') {
    throw new Error('OLLAMA_HOST must be a valid HTTP or HTTPS host without embedded credentials.');
  }
  return parsed.origin;
}

async function ollamaSocketUp(ctx: ServerCtx): Promise<boolean> {
  const endpoint = new URL(ctx.ollamaBaseUrl);
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const host = endpoint.hostname.replace(/^\[|\]$/g, '');
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (up: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(OLLAMA_SOCKET_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * Start Ollama if it is not already up, and answer whether it is now.
 *
 * Every local-model path used to dead-end at "Ollama is not running. Start
 * it." — correct, and useless: the owner picked a local model, which IS the
 * instruction to use it. Zeno already owns a child process (the window owns
 * the daemon), so owning the inference server it depends on is the same
 * bargain, not a new one.
 *
 * Nothing here is a governed effect: it starts a local server on loopback
 * that the owner installed, reads nothing and writes nothing. An action that
 * changes the world still goes through the gate exactly as before.
 *
 * Serialised through `ctx.ollamaStarting` so that three simultaneous requests
 * (Forge, Ask Zeno, Counsel) start one server between them rather than three.
 */
export async function ollamaUp(ctx: ServerCtx): Promise<boolean> {
  let response: Response | null = null;
  try {
    response = await fetch(ollamaEndpoint(ctx, '/api/tags'), { signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS) });
    if (response.ok) {
      ctx.ollamaLastStartAttemptAt = null;
      return true;
    }
  } catch {
    /* A loaded Ollama can miss the HTTP deadline while its socket is still healthy. */
  } finally {
    try { await response?.body?.cancel(); } catch { /* the peer already closed the probe body */ }
  }
  if (await ollamaSocketUp(ctx)) {
    ctx.ollamaLastStartAttemptAt = null;
    return true;
  }
  return false;
}

export async function ensureOllama(ctx: ServerCtx): Promise<boolean> {
  if (await ollamaUp(ctx)) return true;
  if (ctx.ollamaStarting) return ctx.ollamaStarting;
  if (!canAutoStartOllama(ctx.ollamaBaseUrl)) return false;
  const now = Date.now();
  if (!shouldRetryOllamaStart(now, ctx.ollamaLastStartAttemptAt)) return false;
  ctx.ollamaLastStartAttemptAt = now;

  ctx.ollamaStarting = (async () => {
    try {
      // `ollama serve` detached and fully unhooked: it must outlive the request
      // that started it, and inheriting our stdio would keep the pipe open.
      const ollamaExecutable = resolveOllamaExecutable();
      const child = spawn(ollamaExecutable, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false, // direct executable: no visible Windows command shell
      });
      child.on('error', () => {
        /* not installed — the poll below simply times out and we report honestly */
      });
      child.unref();
    } catch {
      return false;
    }

    // Ollama takes a moment to bind. Poll rather than sleep a fixed guess, so a
    // fast machine is not punished and a slow one is not cut off early.
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
      if (await ollamaUp(ctx)) return true;
    }
    return false;
  })();

  try {
    return await ctx.ollamaStarting;
  } finally {
    ctx.ollamaStarting = null;
  }
}

/**
 * The installed Ollama models, discovered live so the open-source models the
 * owner pulled show up in the picker. Queried over the HTTP API
 * (the configured `OLLAMA_HOST`), not the `ollama` CLI — the daemon's PATH may not include
 * the binary, but the server is always on the same loopback.
 */
export async function installedLocalModels(ctx: ServerCtx): Promise<string[]> {
  try {
    const r = await fetch(ollamaEndpoint(ctx, '/api/tags'), { signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS) });
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
 * Per-model VRAM footprints for the Compare picker's GPU meter. Ollama's
 * /api/tags reports each model's on-disk byte size (≈ the resident weight
 * memory); we add a headroom margin for the KV cache and CUDA context to get a
 * usable "will these fit at once" estimate. Names-only `installedLocalModels`
 * stays unchanged for the picker's existing paths; this is a separate, richer
 * read fed only to the capability meter (an estimate, never a guarantee — real
 * resident VRAM varies with context length and quantisation).
 */
export async function installedModelSizes(ctx: ServerCtx): Promise<{ name: string; sizeBytes: number; estVramBytes: number; parameterSize?: string; quantization?: string }[]> {
  try {
    const r = await fetch(ollamaEndpoint(ctx, '/api/tags'), { signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS) });
    if (!r.ok) return [];
    const body = (await r.json()) as { models?: { name?: string; size?: number; details?: { parameter_size?: string; quantization_level?: string } }[] };
    return (body.models ?? [])
      .filter((m): m is { name: string; size?: number; details?: { parameter_size?: string; quantization_level?: string } } => typeof m.name === 'string' && m.name !== '')
      .map((m) => {
        const sizeBytes = Number.isFinite(m.size) ? Number(m.size) : 0;
        // Footprint ≈ weights (file size) + ~10% KV cache + ~300 MB CUDA context.
        const estVramBytes = sizeBytes > 0 ? Math.round(sizeBytes * 1.1 + 300 * 1024 * 1024) : 0;
        const out: { name: string; sizeBytes: number; estVramBytes: number; parameterSize?: string; quantization?: string } = { name: m.name, sizeBytes, estVramBytes };
        if (m.details?.parameter_size) out.parameterSize = m.details.parameter_size;
        if (m.details?.quantization_level) out.quantization = m.details.quantization_level;
        return out;
      });
  } catch {
    return [];
  }
}

/**
 * What this machine can actually hold a model in — so the window can say, before
 * a multi-gigabyte download, whether a model will fit. System RAM is read from
 * the OS (reliable, cross-platform). The GPU is a best-effort probe: nvidia-smi
 * if it is on PATH, and honest silence otherwise — an undetected GPU is reported
 * as undetected, never as "no GPU". Ollama runs a model in GPU VRAM when it fits
 * and spills to system RAM otherwise, so both numbers matter to the estimate.
 */
export async function probeGpu(ctx: ServerCtx): Promise<{ detected: boolean; name?: string; totalVram?: number; freeVram?: number }> {
  try {
    const runner = nodeSpawner({ timeoutMs: 4_000 });
    const r = await runner.run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { cwd: ctx.opts.sandbox, timeoutMs: 4_000 },
    );
    if (r.failedToSpawn || r.code !== 0) return { detected: false };
    const line = String(r.stdout || '').split(/\r?\n/).find((l) => l.trim() !== '');
    if (line === undefined) return { detected: false };
    const parts = line.split(',').map((s) => s.trim());
    const name = parts[0];
    const total = Number(parts[1]);
    const free = Number(parts[2]);
    // Build with only the fields we actually resolved: under exactOptional
    // property types, an optional field must be absent, never set to undefined.
    const out: { detected: boolean; name?: string; totalVram?: number; freeVram?: number } = { detected: true };
    if (name) out.name = name;
    if (Number.isFinite(total)) out.totalVram = total * 1024 * 1024;
    if (Number.isFinite(free)) out.freeVram = free * 1024 * 1024;
    return out;
  } catch {
    return { detected: false }; // a probe reports; it never crashes the request
  }
}
