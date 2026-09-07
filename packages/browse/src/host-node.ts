/**
 * The real edge: start the window, talk to it, kill it.
 *
 * Kept apart from `protocol.ts` for the same reason `runner-node.ts` is kept
 * apart from `runner.ts` — the decisions live in a pure module a test drives with
 * strings, and this file holds only the subprocess.
 *
 * NO NEW RUNTIME DEPENDENCY, which is the whole reason the browser is embedded
 * rather than reached through an external MCP server. Zeno already ships
 * Chromium: `electron` is a devDependency of the workspace root and, in a
 * packaged build, the application's own binary. This module finds that binary and
 * runs one more script with it. There is nothing in `dependencies` here, and the
 * README's zero-runtime-dependency badge (and the CI job that proves it) is not
 * touched.
 *
 * IT NEVER THROWS. A missing Electron, a window that will not start, a page that
 * hangs — each is a `BrowseResponse` with `ok: false` and a sentence, and the
 * caller narrows the run. There is no branch here where something going wrong
 * ends in an ungoverned capability.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBrowseCall, type BrowseResponse } from './protocol.js';
import { readBrowserProbe, type BrowserProof } from './probe.js';

/** Absolute path to the Electron entry script that becomes the window. */
export function sessionEntryPath(): string {
  return fileURLToPath(new URL('../../session-main.cjs', import.meta.url));
}

/**
 * Where Chromium already is on this machine.
 *
 * Two answers, in order, and neither of them installs anything:
 *
 *   1. THIS PROCESS IS ALREADY ELECTRON. The desktop shell starts the daemon
 *      with `ELECTRON_RUN_AS_NODE=1`, so `process.execPath` is the very binary
 *      the app ships. Nothing to resolve.
 *   2. A CHECKOUT. `electron` is a root devDependency; its package exports the
 *      path to the binary it downloaded. Resolved rather than guessed, so a
 *      hoisted, nested or pnpm layout all answer correctly.
 *
 * Anything else returns null, and null is not an error — it is the honest input
 * to a liveness proof that will fail and cost the run its browser tools.
 */
export function electronBinary(): string | null {
  if (process.versions['electron'] !== undefined && process.execPath !== '') return process.execPath;
  try {
    const required = createRequire(import.meta.url)('electron') as unknown;
    if (typeof required === 'string' && required !== '' && existsSync(required)) return required;
  } catch {
    /* not installed here — see the note above */
  }
  return null;
}

/** One run's browser. Every method is total; none of them throws. */
export interface BrowseSession {
  /** Perform one operation. Validation is `protocol.ts`; this only carries it. */
  ask(op: string, input: unknown): Promise<BrowseResponse>;
  /** Prove the window is live and belongs to this run. */
  prove(): Promise<BrowserProof>;
  /** End the window. Idempotent — a run's end must never fail on cleanup. */
  close(): void;
}

/** How a run gets a browser. Injectable, so a test can supply one that fails. */
export interface BrowserHost {
  open(runId: string): BrowseSession;
}

export interface NodeBrowserHostOptions {
  /** Ceiling for one operation, including the page load. */
  readonly timeoutMs?: number;
  /** Override the Electron entry. Tests only. */
  readonly entryPath?: string;
  /** Override the binary. Tests only; the default is the Electron already here. */
  readonly binaryPath?: string | null;
}

/**
 * A session that never had a browser, and says the same true sentence to
 * everything asked of it. Returned rather than thrown: "there is no browser" is
 * an outcome the caller acts on by publishing no browser tools.
 */
function deadSession(reason: string): BrowseSession {
  return {
    ask: () => Promise.resolve({ id: 0, ok: false, detail: reason }),
    prove: () => Promise.resolve({ live: false, note: reason }),
    close: () => undefined,
  };
}

export function nodeBrowserHost(opts: NodeBrowserHostOptions = {}): BrowserHost {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const entry = opts.entryPath ?? sessionEntryPath();
  return {
    open(runId: string): BrowseSession {
      const binary = opts.binaryPath === undefined ? electronBinary() : opts.binaryPath;
      if (binary === null) {
        return deadSession(
          'no Electron binary was found — Zeno ships Chromium with the desktop app, and a source checkout needs its devDependencies installed',
        );
      }

      let child: ChildProcess | null = null;
      let nextId = 1;
      const waiting = new Map<number, (r: BrowseResponse) => void>();
      let dead: string | null = null;

      const die = (why: string): void => {
        if (dead === null) dead = why;
        for (const [id, resolve] of [...waiting]) {
          waiting.delete(id);
          resolve({ id, ok: false, detail: why });
        }
      };

      try {
        // The child must be ELECTRON, not Electron-behaving-as-Node. The daemon
        // is very often started BY the desktop shell with ELECTRON_RUN_AS_NODE=1
        // in its environment, and inheriting that here would start a plain Node
        // process with no `app`, no window, and a liveness proof that fails for a
        // reason nobody could read off the note.
        const env = { ...process.env };
        delete env['ELECTRON_RUN_AS_NODE'];
        // 'ipc', not a pipe. An Electron binary on Windows is a GUI-subsystem
        // executable whose stdin ends the moment it starts, so a newline-JSON
        // protocol over stdin — the shape the permission bridge uses — silently
        // does not work: the window comes up and quits. The IPC channel is
        // structured, needs no parser, and opens NO listening socket, so nothing
        // about Zeno's "no inbound surface" claim changes.
        child = spawn(binary, [entry, runId], {
          env,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          windowsHide: false,
        });
      } catch (err) {
        return deadSession(`the browser could not be started — ${(err as Error).message}`);
      }

      child.on('message', (raw) => {
        const msg = raw as BrowseResponse | null;
        if (msg === null || typeof msg !== 'object') return;
        const resolve = waiting.get(msg.id);
        if (resolve !== undefined) {
          waiting.delete(msg.id);
          resolve(msg);
        }
      });
      child.on('error', (err) => die(`the browser could not be started — ${err.message}`));
      child.on('close', () => die('the browser window has ended'));

      function send(request: Record<string, unknown>): Promise<BrowseResponse> {
        const id = nextId++;
        if (dead !== null) return Promise.resolve({ id, ok: false, detail: dead });
        return new Promise<BrowseResponse>((resolve) => {
          const timer = setTimeout(() => {
            if (waiting.delete(id)) {
              resolve({ id, ok: false, detail: `the browser did not answer within ${timeoutMs}ms` });
            }
          }, timeoutMs);
          timer.unref?.();
          waiting.set(id, (r) => {
            clearTimeout(timer);
            resolve(r);
          });
          try {
            child?.send({ ...request, id });
          } catch (err) {
            waiting.delete(id);
            clearTimeout(timer);
            resolve({ id, ok: false, detail: `the browser could not be reached — ${(err as Error).message}` });
          }
        });
      }

      return {
        async ask(op: string, input: unknown): Promise<BrowseResponse> {
          // Validated HERE and not in the window: the bounds are a pure decision
          // and belong on this side of the process boundary, where they are
          // tested. The window enforces them again anyway — a scheme jail that
          // only worked when someone remembered to call it would be decoration.
          const call = parseBrowseCall(op, input);
          if (!call.ok) return { id: 0, ok: false, detail: `Zeno's browser refused this: ${call.reason}` };
          return await send({ ...call.request });
        },
        async prove(): Promise<BrowserProof> {
          const answer = await send({ op: 'ping' });
          return readBrowserProbe(runId, answer);
        },
        close(): void {
          die('the run this browser belonged to has ended');
          try {
            child?.disconnect();
          } catch {
            /* already gone */
          }
          try {
            child?.kill();
          } catch {
            /* already gone */
          }
          child = null;
        },
      };
    },
  };
}
