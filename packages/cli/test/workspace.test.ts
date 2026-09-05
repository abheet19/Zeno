/**
 * The CLI and the daemon must mean the SAME workspace.
 *
 * The daemon picks its workspace from `ZENO_DIR` and its socket from
 * `ZENO_PORT`. The CLI read neither, so it silently answered about `./.zeno` and
 * posted to `:7317` no matter which Zeno the owner had actually started — and
 * running a second daemon under its own `ZENO_DIR` is not an exotic setup, it is
 * the documented way to keep two of them from forking one hash chain.
 *
 * The worst of it was `verify`. With `ZENO_DIR` pointing at a workspace holding
 * real receipts, it read a different directory and printed
 *
 *     VERIFIED — 0 receipts, every link intact and every signature valid.
 *
 * A green verdict about a ledger it never opened. This is the one command in the
 * product whose entire job is to be believed, so these tests spawn the real
 * built CLI — not an internal function — and assert on the bytes an owner reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runDemo } from '../src/demo.js';

/** The built entry point, as `npm run zeno` invokes it. */
const CLI = fileURLToPath(new URL('../src/main.js', import.meta.url));

const quiet = (): void => {};

function runCli(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): string {
  // The suite must not inherit the developer's own Zeno settings: a machine
  // with ZENO_DIR or ZENO_TOKEN exported would otherwise test a workspace and a
  // credential these tests never created.
  const clean = { ...process.env };
  delete clean['ZENO_DIR'];
  delete clean['ZENO_PORT'];
  delete clean['ZENO_TOKEN'];
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...clean, ...env },
    // A CLI that waits for input in a test is a hung suite, not a failure.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return `${r.stdout}\n${r.stderr}`;
}

test('ZENO_DIR selects the workspace the CLI verifies — a flagless verify never reports on another ledger', async () => {
  // Two workspaces: one with real receipts, one empty. Only the environment
  // says which is meant, exactly as it does when a second daemon is running.
  const real = mkdtempSync(join(tmpdir(), 'zeno-ws-real-'));
  const decoy = mkdtempSync(join(tmpdir(), 'zeno-ws-decoy-'));
  try {
    await runDemo({ dir: real, resume: false, log: quiet });
    assert.ok(existsSync(join(real, 'ledger.jsonl')), 'the demo must have written a ledger to verify');

    // cwd is the DECOY, so a CLI that ignores ZENO_DIR resolves "./.zeno"
    // relative to it and finds nothing — the shape of the original bug.
    const out = runCli(['verify'], { ZENO_DIR: real }, decoy);

    assert.match(out, /LEDGER/, 'verify must name the ledger it read');
    assert.ok(
      out.includes(real),
      `verify must read the workspace ZENO_DIR names.\n${out}`,
    );
    assert.equal(
      /VERIFIED — 0 receipts/.test(out),
      false,
      `a workspace with receipts must never be reported as an empty verified chain.\n${out}`,
    );
  } finally {
    rmSync(real, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

test('an explicit --dir still wins over ZENO_DIR — a flag means what it says', async () => {
  const flagged = mkdtempSync(join(tmpdir(), 'zeno-ws-flag-'));
  const env = mkdtempSync(join(tmpdir(), 'zeno-ws-env-'));
  try {
    await runDemo({ dir: flagged, resume: false, log: quiet });
    const out = runCli(['verify', '--dir', flagged], { ZENO_DIR: env }, tmpdir());
    assert.ok(out.includes(flagged), `--dir must win over ZENO_DIR.\n${out}`);
    assert.equal(out.includes(join(env, 'ledger.jsonl')), false, 'the environment must not override the flag');
  } finally {
    rmSync(flagged, { recursive: true, force: true });
    rmSync(env, { recursive: true, force: true });
  }
});

test('ZENO_PORT selects the daemon propose talks to — the token is never sent to the wrong one', () => {
  // No daemon is listening on either port, so `propose` fails either way. WHICH
  // port it names is the point: the failure text is the only evidence of where
  // the request (and the proposer token with it) was actually sent.
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ws-port-'));
  try {
    const out = runCli(
      ['propose', '--token', 'not-a-real-token', '--summary', 'probe'],
      { ZENO_PORT: '7999' },
      dir,
    );
    assert.ok(out.includes('7999'), `propose must address the port ZENO_PORT names.\n${out}`);
    assert.equal(out.includes('7317'), false, `propose must not fall back to the default port.\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a blank ZENO_TOKEN is no token at all, not an empty one to present', () => {
  // `?? process.env['ZENO_TOKEN']` accepted "" as a credential, so the CLI sent
  // an empty x-zeno-token header and relayed the daemon's 401 as if a real token
  // had been refused — the one failure that sends you auditing tokens instead of
  // setting one. ZENO_PORT points at a dead port so nothing can answer either way.
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ws-blank-'));
  try {
    const out = runCli(['propose'], { ZENO_DIR: dir, ZENO_TOKEN: '   ', ZENO_PORT: '7998' }, tmpdir());
    assert.match(out, /needs the PROPOSER token/, `a blank token must be reported as absent.\n${out}`);
    assert.equal(/HTTP 401/.test(out), false, `nothing may be sent when there is no token.\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('propose with no token names the exact file it looked in, so a wrong ZENO_DIR is visible immediately', () => {
  // The old text said the token was "read automatically from <dir>/proposer.token"
  // without saying which dir it had resolved — so a mistargeted workspace showed
  // up three steps later as a 401 from a daemon the owner had not meant to call.
  const dir = mkdtempSync(join(tmpdir(), 'zeno-ws-notok-'));
  try {
    const out = runCli(['propose'], { ZENO_DIR: dir }, tmpdir());
    assert.ok(
      out.includes(join(dir, 'proposer.token')),
      `the missing-token message must name the resolved path.\n${out}`,
    );
    assert.equal(
      /prints? (both )?tokens? on startup/i.test(out),
      false,
      'nothing may tell the owner the daemon prints a token it deliberately does not print',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
