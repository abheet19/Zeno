/**
 * How the permission host is published to the CLI — and, more to the point,
 * what is NOT in the thing that publishes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  GATE_ENV_RUN,
  GATE_ENV_TOKEN,
  GATE_ENV_URL,
  GATE_SERVER,
  GATE_TOOL,
  gateBridgePath,
  gateEnv,
  gateMcpConfig,
} from '../src/index.js';

test('the config declares exactly one server, under the name the tool flag expects', () => {
  const parsed = JSON.parse(gateMcpConfig('/bridge/permission-main.js')) as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  assert.deepEqual(Object.keys(parsed.mcpServers), [GATE_SERVER], 'one server, and no other joins a governed run');
  assert.equal(
    GATE_TOOL,
    `mcp__${GATE_SERVER}__request_permission`,
    'the --permission-prompt-tool name is built from the same server name the config declares',
  );
  assert.deepEqual(parsed.mcpServers[GATE_SERVER]!.args, ['/bridge/permission-main.js']);
});

test('the config carries no credential — a config is a file, and files can be read', () => {
  const text = gateMcpConfig('/bridge/permission-main.js');
  for (const name of [GATE_ENV_TOKEN, GATE_ENV_URL, GATE_ENV_RUN, 'token', 'env']) {
    assert.equal(text.includes(name), false, `"${name}" must not appear in the published config`);
  }
});

test('the config is one argv element — compact, and never spread over lines', () => {
  // Several configs are passed as several argv ELEMENTS, so this has to stay
  // one. An indented document with newlines in it is asking to be split by
  // something on the way. (Spaces are tolerated here and only here: an
  // interpreter path contains one on every Windows machine with a default
  // install. The tool lists, which the CLI splits on spaces itself, may not.)
  const text = gateMcpConfig('/bridge/permission-main.js');
  assert.equal(/[\n\r\t]/.test(text), false, 'no newline or tab may appear in a single argv element');
  assert.equal(text, JSON.stringify(JSON.parse(text)), 'compact — exactly what JSON.stringify produces with no indent');
});

test('the run credential travels in the environment, under names both ends agree on', () => {
  const env = gateEnv('http://127.0.0.1:7777', 'run-token', 'run-9');
  assert.deepEqual(env, {
    [GATE_ENV_URL]: 'http://127.0.0.1:7777',
    [GATE_ENV_TOKEN]: 'run-token',
    [GATE_ENV_RUN]: 'run-9',
  });
});

test('the bridge the config points at is a file that was actually built', () => {
  const path = gateBridgePath();
  assert.match(path, /permission-main\.js$/);
  assert.equal(existsSync(path), true, `the published bridge must exist on disk: ${path}`);
});
