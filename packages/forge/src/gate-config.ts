/**
 * Publishing the permission host to the CLI.
 *
 * `--mcp-config` is how the Claude Code CLI is told which MCP servers exist for
 * a session, and `--permission-prompt-tool` names one tool on one of them as the
 * answerer. This module builds that declaration: where the bridge script is, and
 * the exact JSON that points at it.
 *
 * Two decisions worth stating, because both are security choices rather than
 * plumbing:
 *
 *   THE CONFIG CARRIES NO SECRET. It names a command and nothing else. The
 *     run-scoped credential the bridge presents travels in the ENVIRONMENT of
 *     the agent process, which the bridge inherits. A config file would be a
 *     file, and a file is something a governed agent with Bash can go and read.
 *
 *   IT IS PASSED AS JSON, NOT AS A PATH. There is then no file to write, no file
 *     to clean up after a crashed run, and nothing on disk holding the wiring of
 *     a run that has ended.
 */
import { fileURLToPath } from 'node:url';
import { GATE_SERVER } from './tools.js';
import { browseMcpServer } from './browse-config.js';

/** Environment variable names the bridge reads. Named here so both ends agree. */
export const GATE_ENV_URL = 'ZENO_GATE_URL';
export const GATE_ENV_TOKEN = 'ZENO_GATE_TOKEN';
export const GATE_ENV_RUN = 'ZENO_GATE_RUN';

/**
 * Absolute path to the built bridge, resolved relative to THIS module rather
 * than to a working directory or a package lookup — the daemon runs with the
 * sandbox as its cwd, and `require.resolve` does not exist in an ESM build.
 */
export function gateBridgePath(): string {
  return fileURLToPath(new URL('./permission-main.js', import.meta.url));
}

/**
 * The `--mcp-config` value: one compact JSON document declaring the gate server
 * and nothing else.
 *
 * Compact, and never pretty-printed. `--mcp-config` is variadic — several
 * configs are passed as several argv ELEMENTS — so this must stay one element,
 * and an indented document with newlines in it is asking to be misread by
 * something along the way. (It is not the same rule as the tool lists, which the
 * CLI documents as comma-or-space separated and which therefore may contain no
 * space at all; an interpreter path legitimately can, and does on Windows.)
 */
export function gateMcpConfig(opts: GateMcpConfigOptions = {}): string {
  const bridgePath = opts.bridgePath ?? gateBridgePath();
  return JSON.stringify({
    mcpServers: {
      [GATE_SERVER]: { command: process.execPath, args: [bridgePath] },
      // The browser, when this run proved it has one. Declared on the SAME
      // document as the permission host so a single `--strict-mcp-config` run
      // has exactly two servers, both of them Zeno's own processes, and no
      // server the machine happens to have configured joins either way.
      ...(opts.browser === true ? browseMcpServer() : {}),
    },
  });
}

/** What may vary between one run's MCP config and another's. */
export interface GateMcpConfigOptions {
  /** Override the gate bridge entrypoint. Tests only. */
  readonly bridgePath?: string;
  /**
   * Publish Zeno's browser alongside the permission host. Only ever true for a
   * run whose browser subsystem PROVED itself live — see the daemon's
   * `performRun`. A config that declared a server the run cannot reach would
   * hand the agent tools that fail at the moment of use.
   */
  readonly browser?: boolean;
}

/**
 * The environment the agent process is started with, so the bridge it spawns
 * inherits the run's credential.
 *
 * This is the whole of what the agent is trusted with, and it is worth being
 * precise about the blast radius: a `Bash` call could print it. What it would
 * find is a token that opens exactly one route, answers exactly one question,
 * and expires with the run — not the proposer token, and not the owner's. The
 * worst an agent can do with it is ask itself a question, and the answer still
 * comes from a click it cannot produce.
 */
export function gateEnv(url: string, token: string, runId: string): Record<string, string> {
  return { [GATE_ENV_URL]: url, [GATE_ENV_TOKEN]: token, [GATE_ENV_RUN]: runId };
}
