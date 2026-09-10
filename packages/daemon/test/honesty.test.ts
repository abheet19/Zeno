/**
 * Two things the daemon used to say that were not true.
 *
 * 1. A REJECTED TOKEN was reported as a MISSING one — "This endpoint needs a
 *    Zeno token", with a fix that read "The daemon prints both tokens on
 *    startup". It prints neither, on purpose. So the one error an owner hits
 *    every time they point a CLI at the wrong workspace told them to go and read
 *    something that does not exist, about a header they had already sent.
 *
 * 2. A FAILED AGENT RUN had its output deleted and was announced as having
 *    changed nothing. `performRun` enumerated the worktree only when the run
 *    exited cleanly, then removed the worktree — so an agent that wrote three
 *    files and then hit an API error left the owner with "No changes were
 *    proposed" and no files. `runner.ts` had always said the opposite: read what
 *    it left behind, hand it to the gate, and say the run did not succeed.
 *
 * The second test spawns a REAL agent process, because that is the only way to
 * observe the real branch: a stub `claude` on PATH that writes a file and exits
 * non-zero, which is exactly the shape of a rate limit or a crash after a write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeGitRunner, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { createServer } from '../src/server.js';
import { Stream } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

interface Harness {
  readonly base: string;
  readonly owner: string;
  readonly proposer: string;
  readonly dir: string;
  readonly sandbox: string;
  readonly kernel: Kernel;
  close(): Promise<void>;
}

/**
 * A daemon over a real git sandbox, set up the way `main.ts` sets one up — a
 * repository with one empty root commit, because `git worktree add` (which every
 * run goes through) has nothing to branch from without a HEAD.
 *
 * `workspace` is passed exactly as the real launcher passes it, so the 401 text
 * under test is the text an owner actually reads.
 */
async function start(opts: { git: boolean }): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-honesty-'));
  const sandbox = join(dir, 'sandbox');
  mkdirSync(sandbox, { recursive: true });
  if (opts.git) {
    const g = nodeGitRunner();
    g.run(['init'], sandbox);
    g.run(['config', 'user.email', 'owner@zeno.local'], sandbox);
    g.run(['config', 'user.name', 'Zeno Owner'], sandbox);
    g.run(['commit', '--allow-empty', '-m', 'zeno: sandbox initialised'], sandbox);
  }
  const fs = nodeSandboxFs();
  const kernel = new Kernel(nodeWorld(fs), {
    store: nodeLedgerStore(join(dir, 'ledger.jsonl')),
    policy: DEFAULT_POLICY,
  });
  const tokens = mintTokens();
  const server = createServer({
    kernel,
    sandbox,
    workspace: dir,
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${addr.port}`,
    owner: tokens.owner,
    proposer: tokens.proposer,
    dir,
    sandbox,
    kernel,
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          ok();
        });
      }),
  };
}

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly resolve: string };
}

test('a token this daemon never issued is told so — not told it sent no token', async () => {
  const h = await start({ git: false });
  try {
    const none = await fetch(h.base + '/state');
    assert.equal(none.status, 401);
    const noneBody = (await none.json()) as ErrorBody;
    assert.equal(noneBody.error.code, 'unauthenticated');

    // A well-formed credential from some OTHER daemon — the everyday case, since
    // tokens are minted per process and proposer.token is read off disk.
    const stranger = mintTokens().proposer;
    const wrong = await fetch(h.base + '/state', { headers: { 'x-zeno-token': stranger } });
    assert.equal(wrong.status, 401);
    const wrongBody = (await wrong.json()) as ErrorBody;
    assert.equal(
      wrongBody.error.code,
      'token-not-recognised',
      'a presented-and-rejected token is a different problem from a missing one',
    );
    assert.match(wrongBody.error.message, /not one this daemon issued/);
  } finally {
    await h.close();
  }
});

test('the 401 names the real proposer.token path, and never claims a token is printed', async () => {
  const h = await start({ git: false });
  try {
    const res = await fetch(h.base + '/state');
    const body = (await res.json()) as ErrorBody;
    assert.ok(
      body.error.resolve.includes(join(h.dir, 'proposer.token')),
      `the fix must name the file that actually holds the token.\n${body.error.resolve}`,
    );
    assert.equal(
      /prints? (both )?tokens? on startup/i.test(body.error.resolve),
      false,
      'the daemon deliberately prints neither token; saying it does sends the owner nowhere',
    );
  } finally {
    await h.close();
  }
});

test('an empty token header is "none sent", not "a token that was refused"', async () => {
  // The read-only shell is served with an EMPTY meta token on purpose. Its
  // fetches must not be told their credential was rejected — they have none.
  const h = await start({ git: false });
  try {
    const res = await fetch(h.base + '/state', { headers: { 'x-zeno-token': '' } });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as ErrorBody).error.code, 'unauthenticated');
  } finally {
    await h.close();
  }
});

/**
 * Put a `claude` on PATH that writes a file and then exits 1.
 *
 * Both shims are written because the runner tries the bare name first and falls
 * back to `cmd.exe /c <name>.cmd` on Windows, where npm-installed CLIs are batch
 * shims. Returns the directory to prepend to PATH.
 */
function stubAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-stub-agent-'));
  writeFileSync(
    join(dir, 'claude.cmd'),
    ['@echo off', 'echo edited before failing> partial.txt', 'echo I wrote partial.txt, then failed.', 'exit /b 1', ''].join('\r\n'),
    'utf8',
  );
  const posix = join(dir, 'claude');
  writeFileSync(
    posix,
    ['#!/bin/sh', 'echo "edited before failing" > partial.txt', 'echo "I wrote partial.txt, then failed."', 'exit 1', ''].join('\n'),
    'utf8',
  );
  try {
    chmodSync(posix, 0o755);
  } catch {
    /* Windows has no execute bit; the .cmd shim is what runs there */
  }
  return dir;
}

test('a run that FAILS after writing keeps what it wrote — the files are not silently deleted', async () => {
  const h = await start({ git: true });
  const stub = stubAgentDir();
  const savedPath = process.env['PATH'];
  const savedPathCased = process.env['Path'];
  try {
    // The runner spawns with the parent's environment, so prepending here is
    // what puts the stub in front of any real CLI for the duration of this test.
    process.env['PATH'] = stub + (process.platform === 'win32' ? ';' : ':') + (savedPath ?? '');
    if (savedPathCased !== undefined) process.env['Path'] = process.env['PATH'];

    const res = await fetch(h.base + '/forge/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zeno-token': h.owner },
      body: JSON.stringify({ task: 'edit partial.txt', agentId: 'claude-code', hostedConfirmed: true }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      run: { ok: boolean; note: string | null };
      changed: string[];
      proposed: { path: string }[];
    };

    assert.equal(body.run.ok, false, 'the run really did fail — that is the case under test');
    assert.ok(body.run.note, 'and the failure is still reported, not swallowed by the rescue');
    assert.deepEqual(
      body.changed,
      ['partial.txt'],
      `the file the agent wrote before failing must survive the run.\n${JSON.stringify(body)}`,
    );
    assert.equal(body.proposed.length, 1, 'and it must reach the gate as a capsule like any other change');
    assert.equal(body.proposed[0]?.path, 'partial.txt');
  } finally {
    process.env['PATH'] = savedPath ?? '';
    if (savedPathCased !== undefined) process.env['Path'] = savedPathCased;
    rmSync(stub, { recursive: true, force: true });
    await h.close();
  }
});
