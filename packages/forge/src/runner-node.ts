/**
 * The real process adapter for the runner. Isolated here so `runner.ts` stays
 * pure and subprocess-free. Shells out with `node:child_process` — zero npm
 * dependencies, as the suite requires.
 *
 * Two properties, each a safety concern rather than a convenience:
 *
 *   NEVER A SHELL — `shell: false`, so no argument is ever re-parsed by cmd.exe
 *     or sh. This is the runtime half of the promise `agentArgv` makes: a task
 *     containing `;`, `|`, `$(…)`, backticks or a newline is passed to the agent
 *     as one datum and can inject no command. There is no code path in this file
 *     that joins argv into a string.
 *
 *   NEVER THROWS — a missing binary, a crash, a timeout kill and an argument
 *     `spawnSync` itself refuses (a NUL byte makes it throw a `TypeError` before
 *     any process starts) all come back as a reported `SpawnResult`. `runner.ts`
 *     decides what a failure means; an adapter that threw would turn "the CLI is
 *     not installed" into an unhandled crash.
 */
import { extname } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { SPAWN_FAILED, type Spawner, type SpawnOptions, type SpawnResult } from './runner.js';

/** 16 MiB: far past any agent transcript or `status` listing, and still bounded. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** A signal-killed process reports a null status; 128 reads correctly and is not the missing-binary sentinel. */
const KILLED = 128;

export interface NodeSpawnerOptions {
  /** Default hard ceiling per invocation, in milliseconds. An agent run can be long. */
  readonly timeoutMs?: number;
}


/**
 * Resolve a bare command name to something Windows can actually spawn.
 *
 * npm installs a CLI as three files — `claude`, `claude.cmd`, `claude.ps1` —
 * and NONE of them is an extensionless executable. So `spawnSync('claude')`
 * returns ENOENT, and `spawnSync('claude.cmd')` returns EINVAL, because Node 20
 * refuses to spawn a batch file without a shell (CVE-2024-27980). The result was
 * that the Claude Code rung could never run on Windows at all: it was on PATH,
 * it resolved in a shell, and it failed the moment the daemon tried it.
 *
 * The fix is `cmd.exe /c <name>.cmd`, with every argument still passed as its
 * OWN argv element. That is deliberately not `shell: true`: a shell would take
 * one joined string, and the task text is owner-supplied prose that would then
 * be re-parsed for metacharacters. Here cmd.exe launches the batch file and the
 * arguments are handed over individually, so a task containing `&` or `|` stays
 * one inert argument.
 *
 * On any other platform the command is returned untouched.
 */
function isBatchLaunchFailure(err: NodeJS.ErrnoException | undefined): boolean {
  // ENOENT: no extensionless file of that name exists at all.
  // EINVAL: Node >=20 refuses to spawn a .cmd/.bat without a shell.
  return err !== undefined && (err.code === 'ENOENT' || err.code === 'EINVAL');
}

export function nodeSpawner(opts: NodeSpawnerOptions = {}): Spawner {
  const defaultTimeout = opts.timeoutMs ?? 600_000;
  return {
    run(command: string, args: readonly string[], o: SpawnOptions): SpawnResult {
      let r: SpawnSyncReturns<string>;
      let viaCmd = false;
      try {
        r = spawnSync(command, [...args], {
          cwd: o.cwd,
          encoding: 'utf8',
          // stdin closed: a headless agent can never sit waiting for input nobody will type.
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT,
          timeout: o.timeoutMs ?? defaultTimeout,
        });
      } catch (err) {
        // spawnSync validates its own arguments and THROWS (not reports) for a
        // NUL byte in an argument or in cwd. Reported, like everything else.
        const why = err instanceof Error ? err.message : String(err);
        return { code: SPAWN_FAILED, failedToSpawn: true, stdout: '', stderr: `${command} could not be run: ${why}` };
      }
      // On Windows an npm-installed CLI is a .cmd shim: there is no extensionless
      // file (ENOENT) and Node >=20 will not spawn a batch file without a shell
      // (EINVAL, CVE-2024-27980). So retry through cmd.exe — but only after the
      // direct spawn has actually failed, because most tools (git, node) ARE real
      // executables and wrapping those unconditionally breaks them.
      if (process.platform === 'win32' && extname(command) === '' && isBatchLaunchFailure(r.error)) {
        const comspec = process.env['ComSpec'] ?? 'cmd.exe';
        try {
          // Each argument stays its OWN argv element — deliberately not shell:true,
          // which would re-parse owner-supplied task text for metacharacters.
          r = spawnSync(comspec, ['/d', '/s', '/c', `${command}.cmd`, ...args], {
            cwd: o.cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true,
            maxBuffer: MAX_OUTPUT,
            timeout: o.timeoutMs ?? defaultTimeout,
          });
          viaCmd = true;
        } catch {
          /* keep the original error below */
        }
      }
      if (r.error) {
        // ENOENT (not on PATH), EACCES, a timeout kill — all reported, never thrown.
        return { code: SPAWN_FAILED, failedToSpawn: true, stdout: '', stderr: `${command} could not be run: ${r.error.message}` };
      }
      // Through cmd.exe a MISSING command is no longer ENOENT: cmd runs fine and
      // reports "'x' is not recognized…" on stderr with its own exit code. Left
      // alone that reads as "the agent ran and failed", which sends the owner
      // hunting a bug instead of installing the CLI. Translate it back to the
      // one fact that is true: it never ran.
      const notFound =
        viaCmd &&
        (r.status === 9009 || /is not recognized as an internal or external command/i.test(r.stderr ?? ''));
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
