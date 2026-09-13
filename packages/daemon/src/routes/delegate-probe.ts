/**
 * What can actually run a job on this machine, and the sentences shown before
 * a hosted agent spends the owner's money or a local one spends their GPU.
 *
 * `DelegateAvailability` and `DelegateProbe` are exported because `server.ts`
 * re-exports them (its `DaemonOptions.delegateProbe` field is typed by
 * `DelegateProbe`) and the daemon's tests still import the type from there.
 */
import { CLAUDE_BINARY, CODEX_BINARY, nodeSpawner } from '@abheet19/zeno-forge';
import type { ServerCtx } from '../server/context.js';
import { installedLocalModels } from './ollama-lifecycle.js';

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
  /** Optional for backwards-compatible injected probes; live probes always set it. */
  readonly codexOnPath?: boolean;
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
 * needs no approval capsule. But it SPENDS something real, and the local and
 * hosted rungs spend differently. A local model spends GPU time on a machine the owner
 * already owns and the code never leaves. A hosted one spends the owner's money
 * and sends their code to somebody else's computer. The second is not something
 * to infer from a sentence someone said out loud across the room, so it is put
 * in front of them in these words and waits for a click.
 */
export const HOSTED_BECAUSE =
  'this sends your code to Anthropic and spends your Claude usage';

export const CODEX_HOSTED_BECAUSE =
  'this sends your code to OpenAI and spends your Codex or API usage';

/** What is said when there is no agent on this machine at all. */
export const NO_AGENT_NOTE =
  'Nothing ran, and nothing was started. There is no coding agent on this machine to run it: ' +
  'Ollama reported no local model (start it and pull one, e.g. ollama pull qwen3:8b), and the ' +
  'claude and codex CLIs are not runnable from here. Your task was not sent anywhere.';

/**
 * The real availability probe: what can actually run a job on this machine.
 *
 * `claude --version` is spawned through the SAME injected spawner Forge uses,
 * with `shell: false` and a short ceiling, and the answer is read off
 * `failedToSpawn` rather than the exit code — a CLI that ran and exited
 * non-zero is still installed, and calling it missing would send the owner off
 * to reinstall something that is already there.
 */
export async function probeAgents(ctx: ServerCtx): Promise<DelegateAvailability> {
  if (ctx.opts.delegateProbe !== undefined) return await ctx.opts.delegateProbe.available();
  const localModels = await installedLocalModels(ctx);
  const runner = nodeSpawner({ timeoutMs: 10_000 });
  const installed = async (binary: string): Promise<boolean> => {
    try {
      const r = await runner.run(binary, ['--version'], { cwd: ctx.opts.sandbox, timeoutMs: 10_000 });
      return !r.failedToSpawn;
    } catch {
      return false; // an availability probe reports; it never crashes the request
    }
  };
  const [claudeOnPath, codexOnPath] = await Promise.all([
    installed(CLAUDE_BINARY),
    installed(CODEX_BINARY),
  ]);
  return { localModels, claudeOnPath, codexOnPath };
}
