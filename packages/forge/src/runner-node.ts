/**
 * The real process adapter for the runner. Isolated here so `runner.ts` stays
 * pure and subprocess-free. Shells out with `node:child_process` — zero npm
 * dependencies, as the suite requires.
 *
 * Three properties, each a safety concern rather than a convenience:
 *
 *   NEVER A SHELL — `shell: false`, so no argument is ever re-parsed by cmd.exe
 *     or sh. This is the runtime half of the promise `agentArgv` makes: a task
 *     containing `;`, `|`, `$(…)`, backticks or a newline is passed to the agent
 *     as one datum and can inject no command. There is no code path in this file
 *     that joins argv into a string.
 *
 *   NEVER THROWS — a missing binary, a crash, a timeout kill and an argument
 *     `spawn` itself refuses (a NUL byte makes it throw before any process
 *     starts) all come back as a reported `SpawnResult`. `runner.ts` decides what
 *     a failure means; an adapter that threw would turn "the CLI is not
 *     installed" into an unhandled crash.
 *
 *   NEVER BLOCKS — this used to be `spawnSync`, and that was load-bearing in the
 *     wrong direction. A governed run asks the owner a question every time the
 *     agent wants to run a command, and the process that serves that question is
 *     the very one that started the agent. Held by a blocking spawn, it could not
 *     answer until the agent exited — and the agent could not exit until it was
 *     answered. The gate deadlocked on itself. Asynchronous is what lets the
 *     approval arrive while the thing waiting for it is still waiting.
 */
import { extname } from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { SPAWN_FAILED, type Spawner, type SpawnOptions, type SpawnResult } from './runner.js';

/** 16 MiB: far past any agent transcript or `status` listing, and still bounded. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** A signal-killed process reports a null status; 128 reads correctly and is not the missing-binary sentinel. */
const KILLED = 128;

/** Said in place of the bytes that were dropped, so a clipped log never reads as a complete one. */
const CLIPPED = '\n…[Zeno clipped this stream at 16 MiB]';

export interface NodeSpawnerOptions {
  /** Default hard ceiling per invocation, in milliseconds. An agent run can be long. */
  readonly timeoutMs?: number;
}

/**
 * ENOENT: no extensionless file of that name exists at all.
 * EINVAL: Node >=20 refuses to spawn a .cmd/.bat without a shell.
 */
function isBatchLaunchFailure(err: NodeJS.ErrnoException | null): boolean {
  return err !== null && (err.code === 'ENOENT' || err.code === 'EINVAL');
}

/** What one child process came to, before any of it is interpreted. */
interface Ran {
  readonly error: NodeJS.ErrnoException | null;
  readonly timedOut: boolean;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run one child to completion and report. Resolves for every outcome — a spawn
 * error, a timeout kill, a clean exit and a crash all arrive as a `Ran`.
 *
 * The output cap TRUNCATES rather than failing the run. `spawnSync`'s `maxBuffer`
 * turned an over-long transcript into an error, which threw away the changeset a
 * chatty agent had just written; the files it produced are the point of the run,
 * and a clipped log (which says it is clipped) costs nothing that matters.
 */
function runOnce(
  command: string,
  args: readonly string[],
  opts: SpawnOptions,
  timeoutMs: number,
): Promise<Ran> {
  return new Promise<Ran>((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, [...args], {
        cwd: opts.cwd,
        // Layered OVER the parent's environment, never replacing it: the agent
        // still needs PATH, HOME and its own credentials to run at all.
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        // stdin closed: a headless agent can never sit waiting for input nobody will type.
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      // `spawn` validates its own arguments and THROWS (not emits) for a NUL
      // byte in an argument or in cwd. Reported, like everything else.
      const e = err as NodeJS.ErrnoException;
      resolve({ error: e, timedOut: false, status: null, stdout: '', stderr: '' });
      return;
    }

    let out = '';
    let err = '';
    let timedOut = false;
    let settled = false;

    const collect = (which: 'out' | 'err') => (chunk: Buffer | string) => {
      const text = String(chunk);
      if (which === 'out') {
        if (out.length >= MAX_OUTPUT) return;
        out = out.length + text.length > MAX_OUTPUT ? out + text.slice(0, MAX_OUTPUT - out.length) + CLIPPED : out + text;
      } else {
        if (err.length >= MAX_OUTPUT) return;
        err = err.length + text.length > MAX_OUTPUT ? err + text.slice(0, MAX_OUTPUT - err.length) + CLIPPED : err + text;
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));

    // Our own timer rather than spawn's `timeout`, so a killed run is reported
    // as a TIMEOUT and not as an ordinary signal death. The two mean different
    // things to the owner and only one of them is Zeno's doing.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();

    const finish = (e: NodeJS.ErrnoException | null, status: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: e, timedOut, status, stdout: out, stderr: err });
    };

    child.on('error', (e) => finish(e as NodeJS.ErrnoException, null));
    child.on('close', (code) => finish(null, code));
  });
}

export function nodeSpawner(opts: NodeSpawnerOptions = {}): Spawner {
  const defaultTimeout = opts.timeoutMs ?? 600_000;
  return {
    async run(command: string, args: readonly string[], o: SpawnOptions): Promise<SpawnResult> {
      const timeoutMs = o.timeoutMs ?? defaultTimeout;
      let r = await runOnce(command, args, o, timeoutMs);
      let viaCmd = false;

      // On Windows an npm-installed CLI is a .cmd shim: there is no extensionless
      // file (ENOENT) and Node >=20 will not spawn a batch file without a shell
      // (EINVAL, CVE-2024-27980). So retry through cmd.exe — but only after the
      // direct spawn has actually failed, because most tools (git, node) ARE real
      // executables and wrapping those unconditionally breaks them.
      if (process.platform === 'win32' && extname(command) === '' && isBatchLaunchFailure(r.error)) {
        const comspec = process.env['ComSpec'] ?? 'cmd.exe';
        // Each argument stays its OWN argv element — deliberately not shell:true,
        // which would re-parse owner-supplied task text for metacharacters.
        const viaShim = await runOnce(comspec, ['/d', '/s', '/c', `${command}.cmd`, ...args], o, timeoutMs);
        // Only ADOPT the retry if it got further than the first attempt did; a
        // second spawn error means cmd.exe itself is missing, and the original
        // failure is the more useful thing to report.
        if (viaShim.error === null) {
          r = viaShim;
          viaCmd = true;
        }
      }

      if (r.timedOut) {
        return {
          code: SPAWN_FAILED,
          failedToSpawn: true,
          stdout: '',
          stderr: `${command} could not be run to completion: it was still running after ${timeoutMs}ms and was stopped`,
        };
      }
      if (r.error) {
        // ENOENT (not on PATH), EACCES, a refused argument — all reported, never thrown.
        return { code: SPAWN_FAILED, failedToSpawn: true, stdout: '', stderr: `${command} could not be run: ${r.error.message}` };
      }
      // Through cmd.exe a MISSING command is no longer ENOENT: cmd runs fine and
      // reports "'x' is not recognized…" on stderr with its own exit code. Left
      // alone that reads as "the agent ran and failed", which sends the owner
      // hunting a bug instead of installing the CLI. Translate it back to the
      // one fact that is true: it never ran.
      const notFound =
        viaCmd && (r.status === 9009 || /is not recognized as an internal or external command/i.test(r.stderr));
      if (notFound) {
        return {
          code: SPAWN_FAILED,
          failedToSpawn: true,
          stdout: '',
          stderr: `${command} could not be run: it is not installed, or not on this machine's PATH`,
        };
      }
      // The process ran to a real exit (0, or any non-zero the program chose —
      // 127 included). That code is honest now; `failedToSpawn` is false so the
      // runner reads it as the program's own result, not a missing binary.
      return { code: r.status ?? KILLED, failedToSpawn: false, stdout: r.stdout, stderr: r.stderr };
    },
  };
}
