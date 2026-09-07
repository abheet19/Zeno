/**
 * Publishing the OWNER'S OWN CHROME to the CLI, beside the permission host and
 * the sandboxed window.
 *
 * `gate-config.ts` and `browse-config.ts` explain the two decisions this file
 * inherits and does not repeat: the config carries NO SECRET (the run credential
 * travels in the environment), and it is passed as JSON rather than as a path.
 *
 * WHAT IS DIFFERENT HERE, and it is worth stating even though this file is four
 * lines of plumbing: the server this declares is a bridge to a browser Zeno DID
 * NOT START and CANNOT KILL. `browse-config.ts` argues, correctly, that the
 * embedded window is exempt from the generic "a process Zeno neither started nor
 * bounds" rule because Zeno starts and bounds it. That argument does NOT extend
 * to this one, and it is not stretched to: the owner's Chrome is emphatically a
 * process Zeno neither started nor bounds. What replaces the argument is not a
 * weaker version of it but a different, stricter set of conditions — an env
 * switch that is off by default, a per-origin allowlist checked before any
 * capsule exists, a never-list the allowlist cannot override, a liveness proof,
 * and a tier on every operation strictly above its sandboxed twin. See
 * `tools.ts` (`classifyChromeCall`) and `@abheet19/zeno-chrome`'s `origins.ts`.
 */
import { fileURLToPath } from 'node:url';
import { CHROME_SERVER } from './tools.js';

/** Absolute path to the built Chrome bridge, resolved relative to THIS module. */
export function chromeBridgePath(): string {
  return fileURLToPath(new URL('./chrome-main.js', import.meta.url));
}

/** The `mcpServers` entry for the owner's Chrome. Merged into the gate's config document. */
export function chromeMcpServer(
  bridgePath: string = chromeBridgePath(),
): Record<string, { command: string; args: string[] }> {
  return { [CHROME_SERVER]: { command: process.execPath, args: [bridgePath] } };
}
