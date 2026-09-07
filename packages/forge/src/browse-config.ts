/**
 * Publishing Zeno's own browser to the CLI, beside the permission host.
 *
 * `gate-config.ts` explains the two decisions this file inherits and does not
 * repeat: the config carries NO SECRET (the run credential travels in the
 * environment, which the bridge inherits, because a config file is a file a
 * governed agent with `Bash` can go and read), and it is passed as JSON rather
 * than as a path (nothing on disk holds the wiring of a run that has ended).
 *
 * WHAT IS NEW HERE, and it is the whole architectural argument for embedding the
 * browser instead of pointing Forge at an external MCP server:
 *
 *   THE SERVER IS ONE ZENO STARTS. `tools.ts` rates a generic MCP call as egress
 *     because "an MCP server is a process outside the worktree that Zeno neither
 *     started nor bounds". The browse bridge below is spawned by the CLI, but
 *     what it talks to is the daemon — and the daemon spawns the WINDOW, from
 *     this repository, with a session it configured, for the length of one run.
 *     There is no third party in the loop, nothing is installed, no driver is
 *     downloaded, and nothing leaves the machine except the page fetches the
 *     owner approved one at a time.
 *
 *   IT IS THE SAME BRIDGE SHAPE AS THE GATE. Same stdio MCP, same run
 *     credential, same fail-closed posture. A second mechanism would be a second
 *     policy, and two policies drift.
 */
import { fileURLToPath } from 'node:url';
import { BROWSE_SERVER } from './tools.js';

/**
 * Absolute path to the built browse bridge, resolved relative to THIS module for
 * the same reason `gateBridgePath` is: the daemon runs with the sandbox as its
 * cwd, and `require.resolve` does not exist in an ESM build.
 */
export function browseBridgePath(): string {
  return fileURLToPath(new URL('./browse-main.js', import.meta.url));
}

/** The `mcpServers` entry for the browser. Merged into the gate's config document. */
export function browseMcpServer(bridgePath: string = browseBridgePath()): Record<string, { command: string; args: string[] }> {
  return { [BROWSE_SERVER]: { command: process.execPath, args: [bridgePath] } };
}
