/**
 * The real edge of the gate proof: spawn the bridge and speak MCP to it.
 *
 * Kept apart from `gate-probe.ts` for the same reason `runner-node.ts` is kept
 * apart from `runner.ts` — the protocol is decided in a pure module a test can
 * drive with strings, and this file holds only the subprocess.
 *
 * It NEVER THROWS and it never resolves to a maybe. A bridge that will not
 * start, will not answer, or answers slowly all come back as `live: false` with
 * a sentence, and the caller narrows the run. The timeout is short on purpose:
 * this runs before every governed run, and a gate that needs longer than a few
 * seconds to prove itself is not one to bet a shell on.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { gateBridgePath } from './gate-config.js';
import { gateProbeRequests, readGateProbe, type GateProof } from './gate-probe.js';

/** The seam the daemon injects, so a test can drive a run with a gate that fails. */
export interface GateProber {
  prove(env: Readonly<Record<string, string>>): Promise<GateProof>;
}

export interface NodeGateProberOptions {
  /** Hard ceiling for the whole handshake. */
  readonly timeoutMs?: number;
  /** Override the bridge entrypoint. Tests only; the default is the built bridge. */
  readonly bridgePath?: string;
}

export function nodeGateProber(opts: NodeGateProberOptions = {}): GateProber {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const bridge = opts.bridgePath ?? gateBridgePath();
  return {
    prove(env: Readonly<Record<string, string>>): Promise<GateProof> {
      return new Promise<GateProof>((resolve) => {
        let settled = false;
        let child: ChildProcessByStdio<Writable, Readable, null> | null = null;
        const done = (proof: GateProof): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            child?.kill();
          } catch {
            /* already gone */
          }
          resolve(proof);
        };

        const timer = setTimeout(
          () => done({ live: false, note: `the permission bridge did not answer within ${timeoutMs}ms` }),
          timeoutMs,
        );
        timer.unref?.();

        try {
          // Spawned exactly as `gateMcpConfig` tells the CLI to spawn it —
          // the same interpreter, the same entrypoint, the same environment —
          // so what is proved here is what the CLI will get.
          child = spawn(process.execPath, [bridge], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true,
          });
        } catch (err) {
          done({ live: false, note: `the permission bridge could not be started — ${(err as Error).message}` });
          return;
        }

        let out = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          out += chunk;
          // Answer to the third request in hand? Decide now rather than waiting
          // for a process that has no reason to exit on its own.
          const lines = out.split('\n');
          if (lines.length > 3) done(readGateProbe(lines));
        });
        child.on('error', (err) =>
          done({ live: false, note: `the permission bridge could not be started — ${err.message}` }),
        );
        child.on('close', () => done(readGateProbe(out.split('\n'))));
        child.stdin.on('error', () => {
          /* a bridge that died mid-write is reported by the close/error handlers */
        });
        child.stdin.write(gateProbeRequests().join('\n') + '\n');
      });
    },
  };
}
