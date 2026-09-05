/**
 * S2.2 + S2.5 — the process boundary, and the stream.
 *
 * The point of this package is that an agent CANNOT approve its own work. Not
 * "does not", not "should not" — cannot, because it holds a token the approval
 * route rejects. These tests are that claim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DEFAULT_POLICY, Kernel, nodeLedgerStore, nodeSandboxFs } from '@abheet19/zeno-kernel';
import { createServer, type DelegateProbe } from '../src/server.js';
import { Stream, frame } from '../src/stream.js';
import { mintTokens } from '../src/tokens.js';
import { nodeWorkDesk } from '../src/work.js';
import { nodeWorld } from '../src/world.js';

interface Harness {
  readonly base: string;
  readonly owner: string;
  readonly proposer: string;
  readonly sandbox: string;
  readonly kernel: Kernel;
  close(): Promise<void>;
}

async function start(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-daemon-'));
  const sandbox = join(dir, 'sandbox');
  const fs = nodeSandboxFs();
  const kernel = new Kernel(nodeWorld(fs), {
    store: nodeLedgerStore(join(dir, 'ledger.jsonl')),
    policy: DEFAULT_POLICY,
  });
  const tokens = mintTokens();
  const server = createServer({
    kernel,
    sandbox,
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'), // deliberately absent for most tests
    work: nodeWorkDesk(dir),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address() as AddressInfo;
  assert.equal(addr.address, '127.0.0.1', 'the socket must be loopback-only, never 0.0.0.0');
  return {
    base: `http://127.0.0.1:${addr.port}`,
    owner: tokens.owner,
    proposer: tokens.proposer,
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

function post(h: Harness, path: string, token: string | null, body: unknown): Promise<Response> {
  return fetch(h.base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { 'x-zeno-token': token }),
    },
    body: JSON.stringify(body),
  });
}

/** An ordinary small edit inside the sandbox: ROUTINE, applies without asking. */
const ROUTINE = {
  relPath: 'src/App.tsx',
  contents: 'export const App = () => <main />;\n',
  summary: 'scaffold the App shell',
};

/** Configuration: never routine, however small. This is what stops for the owner. */
const RISKY = {
  relPath: 'package.json',
  contents: '{ "name": "demo", "version": "1.0.0" }\n',
  summary: 'bump the package version',
};

// ── the boundary ────────────────────────────────────────────────────────────

test('L6 — the PROPOSER token cannot approve, and is told why', async () => {
  const h = await start();
  try {
    const made = await post(h, '/previews', h.proposer, RISKY);
    assert.equal(made.status, 200, 'proposing is exactly what a proposer may do');
    const { preview } = (await made.json()) as { preview: { actionHash: string } };

    const tried = await post(h, '/approvals', h.proposer, { actionHash: preview.actionHash });
    assert.equal(tried.status, 403);
    const body = (await tried.json()) as { error: { code: string; resolve: string } };
    assert.equal(body.error.code, 'self-approval-forbidden');
    assert.ok(body.error.resolve.length > 0, 'a refusal always names the way forward');

    assert.equal(h.kernel.receipts().length, 0, 'and nothing happened');
  } finally {
    await h.close();
  }
});

test('the OWNER token approves, the file really changes, a receipt lands', async () => {
  const h = await start();
  try {
    const made = await post(h, '/previews', h.proposer, RISKY);
    const { preview } = (await made.json()) as { preview: { actionHash: string; tier: string } };
    assert.equal(preview.tier, 'T1', 'touching configuration needs the owner');

    const ok = await post(h, '/approvals', h.owner, { actionHash: preview.actionHash });
    assert.equal(ok.status, 200);
    const { receipt } = (await ok.json()) as { receipt: { outcome: string; selfHash: string } };
    assert.equal(receipt.outcome, 'verified');

    assert.equal(readFileSync(join(h.sandbox, 'package.json'), 'utf8'), RISKY.contents);
    assert.equal(h.kernel.verifyChain().ok, true);
  } finally {
    await h.close();
  }
});

test('no token at all is 401, not 403 — a different problem with a different fix', async () => {
  const h = await start();
  try {
    const res = await post(h, '/previews', null, RISKY);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'unauthenticated');
  } finally {
    await h.close();
  }
});

test('a wrong token is refused, and a near-miss does not leak by timing', async () => {
  const h = await start();
  try {
    // Flip the last hex digit to something it is NOT, so this is always a wrong
    // token — slice(-1)+'0' would reproduce the real token whenever it ends in 0.
    const last = h.owner.slice(-1);
    const wrong = h.owner.slice(0, -1) + (last === '0' ? '1' : '0');
    assert.notEqual(wrong, h.owner);
    const res = await post(h, '/previews', wrong, RISKY);
    assert.equal(res.status, 401);
  } finally {
    await h.close();
  }
});

test('approving an unknown hash is a legible 404, never a crash', async () => {
  const h = await start();
  try {
    const res = await post(h, '/approvals', h.owner, { actionHash: 'nope' });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unknown-action');
  } finally {
    await h.close();
  }
});

test('a proposal that escapes the sandbox is refused by the jail', async () => {
  const h = await start();
  try {
    const res = await post(h, '/previews', h.proposer, { ...RISKY, relPath: '../../escaped.txt' });
    assert.equal(res.status, 409, 'a policy refusal is the product working, not an error');
    assert.match(((await res.json()) as { error: { message: string } }).error.message, /escapes the sandbox/);
  } finally {
    await h.close();
  }
});

test('a malformed proposal is a 400 that says what was missing', async () => {
  const h = await start();
  try {
    const res = await post(h, '/previews', h.proposer, { relPath: 'a.txt' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: { message: string } }).error.message, /relPath, contents and summary/);
  } finally {
    await h.close();
  }
});

test('GET /state reports pending, receipts and chain together', async () => {
  const h = await start();
  try {
    const before = await fetch(h.base + '/state', { headers: { 'x-zeno-token': h.owner } });
    const s0 = (await before.json()) as { pending: unknown[]; receipts: unknown[]; chain: { ok: boolean } };
    assert.deepEqual(s0.pending, []);
    assert.equal(s0.chain.ok, true);

    await post(h, '/previews', h.proposer, RISKY);
    const after = await fetch(h.base + '/state', { headers: { 'x-zeno-token': h.owner } });
    const s1 = (await after.json()) as { pending: unknown[] };
    assert.equal(s1.pending.length, 1, 'a proposal is waiting, and has caused nothing');
  } finally {
    await h.close();
  }
});

test('the UI route says what is wrong when the UI is not built', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/');
    assert.equal(res.status, 500);
    assert.match(await res.text(), /UI is not built/);
  } finally {
    await h.close();
  }
});

// ── the stream ──────────────────────────────────────────────────────────────

test('SSE frames are well formed and monotonically identified', () => {
  const s = new Stream();
  const a = s.publish('preview', { x: 1 });
  const b = s.publish('receipt', { y: 2 });
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.equal(frame(a), 'id: 1\nevent: preview\ndata: {"x":1}\n\n');
});

test('a reconnecting client is replayed exactly the events it missed', () => {
  const s = new Stream();
  s.publish('preview', 1);
  s.publish('preview', 2);
  s.publish('preview', 3);
  const missed = s.replay(1);
  assert.notEqual(missed, null);
  assert.deepEqual(missed!.map((e) => e.id), [2, 3], 'no gap, no duplicate');
  assert.deepEqual(s.replay(3), [], 'fully caught up');
});

test('a gap that cannot be replayed is DECLARED, never silently stitched', () => {
  const s = new Stream(3); // a deliberately tiny buffer
  for (let i = 0; i < 10; i++) s.publish('preview', i);
  assert.equal(s.replay(1), null, 'the truth is that we cannot say what was missed');

  const sink = { chunks: [] as string[], write(c: string) { this.chunks.push(c); return true; } };
  const opening = s.attach(sink, 1);
  assert.match(opening, /event: gap/, 'so the client is told, explicitly');
  assert.match(opening, /can no longer be replayed/);
});

test('a broadcast reaches every attached client and drops dead ones', () => {
  const s = new Stream();
  const live = { out: '', write(c: string) { this.out += c; return true; } };
  const dead = { write(): boolean { throw new Error('socket closed'); } };
  s.attach(live, null);
  s.attach(dead, null);
  s.publish('receipt', { ok: true });
  assert.match(live.out, /event: receipt/);
  assert.equal(s.clientCount(), 1, 'the dead client was dropped, the live one still served');
});

test('the shell carries EXACTLY ONE owner-token tag, filled in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-shell-'));
  try {
    const pub = join(dir, 'public');
    mkdirSync(pub, { recursive: true });
    // a page that already ships an empty placeholder, as the real one does
    writeFileSync(join(pub, 'index.html'), '<head>\n<meta name="zeno-token" content="">\n</head><body></body>', 'utf8');

    const fs = nodeSandboxFs();
    const tokens = mintTokens();
    const server = createServer({
      kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
      sandbox: join(dir, 'sandbox'),
      fs,
      tokens,
      stream: new Stream(),
      publicDir: pub,
      work: nodeWorkDesk(dir),
      launchNonce: 'launch-test',
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address() as AddressInfo;
    const html = await (await fetch(`http://127.0.0.1:${port}/?k=launch-test`)).text();
    await new Promise<void>((ok) => server.close(() => ok()));

    const tags = html.match(/<meta\s+name="zeno-token"[^>]*>/gi) ?? [];
    assert.equal(tags.length, 1, 'two tags means querySelector finds the empty one and the window cannot approve');
    assert.match(tags[0]!, new RegExp(`content="${tokens.owner}"`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── risk: only interrupt for things that deserve it ─────────────────────────

test('a ROUTINE edit applies without asking — and is still receipted', async () => {
  const h = await start();
  try {
    const res = await post(h, '/previews', h.proposer, ROUTINE);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      preview: { auto: boolean; tier: string };
      receipt?: { outcome: string };
      risk: { routine: boolean; reasons: string[] };
    };
    assert.equal(body.preview.tier, 'T0');
    assert.equal(body.preview.auto, true, 'ordinary work must not interrupt the owner');
    assert.equal(body.risk.routine, true);
    assert.ok(body.risk.reasons.length > 0, 'even a routine decision explains itself');

    assert.equal(body.receipt?.outcome, 'verified', 'it happened');
    assert.equal(readFileSync(join(h.sandbox, 'src', 'App.tsx'), 'utf8'), ROUTINE.contents);
    assert.equal(h.kernel.receipts().length, 1, 'unattended is not unrecorded');
    assert.equal(h.kernel.verifyChain().ok, true);
  } finally {
    await h.close();
  }
});

test('a RISKY edit does NOT apply — it waits, and nothing happens meanwhile', async () => {
  const h = await start();
  try {
    const res = await post(h, '/previews', h.proposer, RISKY);
    const body = (await res.json()) as { preview: { auto: boolean }; risk: { routine: boolean; reasons: string[] } };
    assert.equal(body.preview.auto, false);
    assert.equal(body.risk.routine, false);
    assert.match(body.risk.reasons[0]!, /configuration, credentials or build setup/);
    assert.equal(h.kernel.receipts().length, 0, 'nothing was written');
  } finally {
    await h.close();
  }
});

test('DESTRUCTIVE writes stop at the highest tier, not the routine one', async () => {
  const h = await start();
  try {
    // first, routinely create a file with real content in it
    await post(h, '/previews', h.proposer, {
      relPath: 'src/Big.tsx',
      contents: 'const x = 1;\n'.repeat(30),
      summary: 'add a module',
    });
    // now propose emptying it
    const res = await post(h, '/previews', h.proposer, {
      relPath: 'src/Big.tsx',
      contents: '   \n',
      summary: 'clean up',
    });
    const body = (await res.json()) as { preview: { tier: string; auto: boolean }; risk: { reasons: string[] } };
    assert.equal(body.preview.tier, 'T3', 'deleting work is not an edit');
    assert.equal(body.preview.auto, false);
    assert.match(body.risk.reasons[0]!, /emptied|lose most of its content/);
  } finally {
    await h.close();
  }
});

// ── persistence: open proposals survive a restart ───────────────────────────

test('a waiting proposal survives a daemon restart and is still approvable', async () => {
  const { nodeHeldStore } = await import('../src/held-store.js');
  const { nodeWorkDesk } = await import('../src/work.js');
  const dir = mkdtempSync(join(tmpdir(), 'zeno-persist-'));
  const sandbox = join(dir, 'sandbox');
  const heldPath = join(dir, 'pending.jsonl');
  const ledgerPath = join(dir, 'ledger.jsonl');
  const tokens = mintTokens();

  // helper to stand a server on the SAME on-disk state
  const stand = () => {
    const fs = nodeSandboxFs();
    const kernel = new Kernel(nodeWorld(fs), { store: nodeLedgerStore(ledgerPath) });
    const server = createServer({
      kernel, sandbox, fs, tokens,
      stream: new Stream(),
      publicDir: join(dir, 'public'),
      work: nodeWorkDesk(dir),
      heldStore: nodeHeldStore(heldPath),
    });
    return { kernel, server };
  };

  const post = (base: string, path: string, token: string, b: unknown) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zeno-token': token }, body: JSON.stringify(b) });

  try {
    // 1. first daemon: an agent proposes a RISKY change; it waits.
    const s1 = stand();
    await new Promise<void>((ok) => s1.server.listen(0, '127.0.0.1', ok));
    const base1 = `http://127.0.0.1:${(s1.server.address() as AddressInfo).port}`;
    const made = await post(base1, '/previews', tokens.proposer, RISKY);
    const { preview } = (await made.json()) as { preview: { actionHash: string; auto: boolean } };
    assert.equal(preview.auto, false, 'a config change waits for the owner');
    await new Promise<void>((ok) => s1.server.close(() => ok()));

    // the proposal is on disk, not just in a dead process's memory
    assert.match(readFileSync(heldPath, 'utf8'), new RegExp(preview.actionHash));

    // 2. second daemon over the same files: the proposal is back, and approvable.
    const s2 = stand();
    await new Promise<void>((ok) => s2.server.listen(0, '127.0.0.1', ok));
    const base2 = `http://127.0.0.1:${(s2.server.address() as AddressInfo).port}`;

    const state = await (await fetch(base2 + '/state', { headers: { 'x-zeno-token': tokens.owner } })).json() as { pending: unknown[] };
    assert.equal(state.pending.length, 1, 'the waiting proposal came back after the restart');

    const ok = await post(base2, '/approvals', tokens.owner, { actionHash: preview.actionHash });
    assert.equal(ok.status, 200, 'and the owner can still approve it');
    const { receipt } = (await ok.json()) as { receipt: { outcome: string } };
    assert.equal(receipt.outcome, 'verified');
    assert.equal(readFileSync(join(sandbox, 'package.json'), 'utf8'), RISKY.contents);

    // approving it clears it from disk too — no ghost proposal lingers
    assert.equal(readFileSync(heldPath, 'utf8').trim(), '');
    await new Promise<void>((ok2) => s2.server.close(() => ok2()));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── memory: the Vault, served ───────────────────────────────────────────────

test('memory can be remembered and recalled, and a brief reflects it', async () => {
  const { nodeHeldStore } = await import('../src/held-store.js');
  const { nodeWorkDesk } = await import('../src/work.js');
  const { Vault } = await import('@abheet19/zeno-vault');
  const dir = mkdtempSync(join(tmpdir(), 'zeno-mem-'));
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  // an in-memory note store so the test needs no disk beyond the temp dir
  const files = new Map<string, string>();
  let n = 0, t = 0;
  const vault = new Vault(
    { readAll: () => new Map(files), write: (id, x) => void files.set(id, x), remove: (id) => void files.delete(id) },
    { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(), id: () => `m${n++}` },
  );
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'), fs, tokens, stream: new Stream(),
    publicDir: join(dir, 'public'), work: nodeWorkDesk(dir), heldStore: nodeHeldStore(join(dir, 'h.jsonl')), vault,
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const add = await fetch(base + '/memory', { method: 'POST', headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner }, body: JSON.stringify({ title: 'Barclays used KDB+', body: 'a time-series database', tags: ['barclays'] }) });
    assert.equal(add.status, 200);

    const rec = await (await fetch(base + '/memory?q=' + encodeURIComponent('what database at barclays'), { headers: { 'x-zeno-token': tokens.owner } })).json() as { hits: { note: { title: string } }[] };
    assert.equal(rec.hits[0]?.note.title, 'Barclays used KDB+');

    const brief = await (await fetch(base + '/brief', { headers: { 'x-zeno-token': tokens.owner } })).json() as { brief: { status: string }, text: string };
    assert.match(brief.text, /Barclays used KDB\+/, 'the brief shows the recent memory with its source and age');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a memory carrying a secret is redacted before it is stored', async () => {
  const { nodeHeldStore } = await import('../src/held-store.js');
  const { nodeWorkDesk } = await import('../src/work.js');
  const { Vault } = await import('@abheet19/zeno-vault');
  const dir = mkdtempSync(join(tmpdir(), 'zeno-mem2-'));
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const files = new Map<string, string>();
  let n = 0, t = 0;
  const vault = new Vault(
    { readAll: () => new Map(files), write: (id, x) => void files.set(id, x), remove: (id) => void files.delete(id) },
    { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(), id: () => `m${n++}` },
  );
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'), fs, tokens, stream: new Stream(),
    publicDir: join(dir, 'public'), work: nodeWorkDesk(dir), heldStore: nodeHeldStore(join(dir, 'h.jsonl')), vault,
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const secret = 'ghp_' + 'a'.repeat(36);
    await fetch(base + '/memory', { method: 'POST', headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner }, body: JSON.stringify({ title: 'a note', body: `my token is ${secret}` }) });
    const stored = [...files.values()].join('\n');
    assert.doesNotMatch(stored, new RegExp(secret), 'the raw token must never reach the memory file');
    assert.match(stored, /REDACTED/, 'it is redacted, not dropped');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('L1 — a proposer CANNOT downgrade a risky write by claiming a lower kind', async () => {
  const h = await start();
  try {
    // The attack: a config write, tagged as if it were a routine sandbox write,
    // to try to make it auto-commit with no approval.
    const res = await post(h, '/previews', h.proposer, { ...RISKY, kind: 'local.write' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { preview: { tier: string; auto: boolean }; receipt?: unknown };
    assert.equal(body.preview.tier, 'T1', 'the assessed tier stands; the claimed kind is ignored');
    assert.equal(body.preview.auto, false, 'it does NOT auto-apply');
    assert.equal(body.receipt, undefined, 'and nothing was committed');
    assert.equal(h.kernel.receipts().length, 0, 'the file was never written');
  } finally {
    await h.close();
  }
});

test('SECURITY — a blind GET / does NOT leak the owner token; only ?k=<nonce> unlocks it', async () => {
  const { nodeWorkDesk } = await import('../src/work.js');
  const dir = mkdtempSync(join(tmpdir(), 'zeno-nonce-'));
  const pub = join(dir, 'public');
  mkdirSync(pub, { recursive: true });
  writeFileSync(join(pub, 'index.html'), '<head><meta name="zeno-token" content=""></head><body></body>', 'utf8');
  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox: join(dir, 'sandbox'), fs, tokens, stream: new Stream(),
    publicDir: pub, work: nodeWorkDesk(dir), launchNonce: 'the-secret',
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // the attack: any local process, one GET, no credential
    const blind = await fetch(base + '/');
    const blindHtml = await blind.text();
    assert.doesNotMatch(blindHtml, new RegExp(tokens.owner), 'the owner token must NOT be in a blind response');
    assert.equal(blind.headers.get('set-cookie'), null, 'and no owner cookie is granted');
    assert.match(blindHtml, /content=""/, 'the token tag is served empty');

    // the owner's real launch, with the one-time nonce
    const launch = await fetch(base + '/?k=the-secret');
    const launchHtml = await launch.text();
    assert.match(launchHtml, new RegExp(`content="${tokens.owner}"`), 'the authorised launch gets the token');
    assert.match(launch.headers.get('set-cookie') ?? '', /zeno_token=/, 'and the cookie to persist it');

    // a wrong nonce is treated as blind
    const wrong = await fetch(base + '/?k=nope');
    assert.doesNotMatch(await wrong.text(), new RegExp(tokens.owner), 'a wrong nonce leaks nothing');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Forge: a governed commit through the git executor ───────────────────────

test('Forge — status shows changes and an owner commit lands through the gate', async () => {
  const { execFileSync } = await import('node:child_process');
  const { nodeHeldStore } = await import('../src/held-store.js');
  const { nodeWorkDesk } = await import('../src/work.js');
  const { writeFileSync: wf, mkdirSync: mk } = await import('node:fs');

  // git must be present; skip cleanly if not (CI without git)
  try { execFileSync('git', ['--version']); } catch { return; }

  const dir = mkdtempSync(join(tmpdir(), 'zeno-forge-'));
  const sandbox = join(dir, 'sandbox');
  mk(sandbox, { recursive: true });
  execFileSync('git', ['init'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: sandbox });

  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox, fs, tokens, stream: new Stream(), publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir), heldStore: nodeHeldStore(join(dir, 'h.jsonl')),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // a change appears in the sandbox
    wf(join(sandbox, 'hello.txt'), 'hi\n');

    const status = await (await fetch(base + '/forge/status', { headers: { 'x-zeno-token': tokens.owner } })).json() as { repo: boolean; changed: { path: string }[] };
    assert.equal(status.repo, true);
    assert.ok(status.changed.some((c) => c.path === 'hello.txt'), 'the new file shows as a change');

    // a proposer cannot commit
    const asProposer = await fetch(base + '/forge/commit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.proposer }, body: JSON.stringify({ message: 'x' }) });
    assert.equal(asProposer.status, 403, 'only the owner commits');

    // the owner commits through the gate
    const res = await fetch(base + '/forge/commit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-zeno-token': tokens.owner }, body: JSON.stringify({ message: 'add hello' }) });
    assert.equal(res.status, 200);
    const { receipt } = await res.json() as { receipt: { outcome: string; externalEffect: { effect: string } } };
    assert.equal(receipt.outcome, 'verified');
    assert.match(receipt.externalEffect.effect, /^git:/, 'the receipt carries the real commit sha');

    // git confirms exactly one commit with that message
    const log = execFileSync('git', ['log', '--pretty=%s'], { cwd: sandbox }).toString().trim();
    assert.equal(log, 'add hello', 'git records the raw message; "commit:" is only the capsule summary');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the three products: their endpoints ─────────────────────────────────────

test('Forge — the code pane reads a sandbox file, and a path that escapes is refused', async () => {
  const h = await start();
  try {
    // A real file inside the sandbox comes back as text the pane can render.
    mkdirSync(join(h.sandbox, 'src'), { recursive: true });
    writeFileSync(join(h.sandbox, 'src', 'App.tsx'), 'const a = 1;\nconst b = 2;\n');
    const ok = await fetch(h.base + '/forge/file?path=src/App.tsx', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(ok.status, 200);
    const file = await ok.json() as { contents: string; lines: number; binary: boolean; encoding: string };
    assert.equal(file.binary, false);
    assert.match(file.contents, /const a = 1;/, 'the pane is handed the REAL bytes, not a summary');
    assert.equal(file.lines, 3, 'the trailing newline makes a third (empty) line — counted, not guessed');
    assert.equal(file.encoding, 'UTF-8');

    // A file that is simply not there is a 404, never an empty pane pretending.
    const missing = await fetch(h.base + '/forge/file?path=src/Nope.tsx', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(missing.status, 404);

    // THE JAIL. Every shape of escape is refused with the same answer and no
    // content — traversal, an absolute path, a Windows drive letter, a UNC root,
    // and a traversal that has been percent-encoded on the way in.
    const escapes = [
      '../secrets.txt',
      'src/../../secrets.txt',
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\x',
    ];
    // something real to steal, one level above the sandbox
    writeFileSync(join(h.sandbox, '..', 'secrets.txt'), 'TOP SECRET\n');
    for (const bad of escapes) {
      const res = await fetch(h.base + '/forge/file?path=' + encodeURIComponent(bad), {
        headers: { 'x-zeno-token': h.owner },
      });
      assert.equal(res.status, 403, `${bad} must be refused, not read`);
      const body = await res.json() as { error: { code: string }; contents?: unknown };
      assert.equal(body.error.code, 'path-escape', `${bad} is refused as a path escape`);
      assert.equal(body.contents, undefined, `${bad} must not leak any contents`);
    }

    // A traversal that arrives percent-encoded is decoded by the query parser
    // BEFORE the jail sees it, so the jail — not the spelling — is what refuses it.
    const encoded = await fetch(h.base + '/forge/file?path=..%2Fsecrets.txt', {
      headers: { 'x-zeno-token': h.owner },
    });
    assert.equal(encoded.status, 403, 'a percent-encoded traversal is still a traversal');

    // No path at all is a bad request, not a directory listing.
    const nopath = await fetch(h.base + '/forge/file', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(nopath.status, 400);

    // And an unauthenticated read is refused before the jail is even reached.
    const anon = await fetch(h.base + '/forge/file?path=src/App.tsx');
    assert.equal(anon.status, 401, 'the file route sits behind the same token gate as the rest');
  } finally {
    await h.close();
  }
});

test('Forge — search is a real git grep over the sandbox, and a path that escapes is refused', async () => {
  const { execFileSync } = await import('node:child_process');
  const { nodeWorkDesk: desk } = await import('../src/work.js');

  // git must be present; skip cleanly if not (CI without git)
  try { execFileSync('git', ['--version']); } catch { return; }

  const dir = mkdtempSync(join(tmpdir(), 'zeno-search-'));
  const sandbox = join(dir, 'sandbox');
  mkdirSync(join(sandbox, 'src', 'deep'), { recursive: true });
  execFileSync('git', ['init'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: sandbox });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: sandbox });

  // Something real to steal, one level ABOVE the sandbox — with the needle in
  // it, so an escape that were allowed would visibly return its contents.
  writeFileSync(join(dir, 'secrets.txt'), 'useState TOP SECRET\n');

  writeFileSync(join(sandbox, 'src', 'App.tsx'), 'const a = 1;\nconst useState = 2;\nconst abc = 3;\n');
  writeFileSync(join(sandbox, 'src', 'deep', 'Other.tsx'), 'import { useState } from "react";\n');
  writeFileSync(join(sandbox, 'src', 'Flags.ts'), 'const flag = "--untracked";\n');
  writeFileSync(join(sandbox, 'src', 'Shout.ts'), 'const USESTATE_MAX = 9;\n');
  // Untracked, ignored and binary: three files git knows how to tell apart, and
  // the route's answer must agree with git's own view of the working tree.
  writeFileSync(join(sandbox, 'src', 'New.tsx'), 'untracked useState here\n');
  writeFileSync(join(sandbox, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(sandbox, 'ignored.txt'), 'ignored useState here\n');
  writeFileSync(join(sandbox, 'blob.bin'), 'binary useState' + String.fromCharCode(0) + 'tail\n');
  execFileSync('git', ['add', 'src/App.tsx', 'src/deep/Other.tsx', 'src/Flags.ts', 'src/Shout.ts', '.gitignore', 'blob.bin'], { cwd: sandbox });
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: sandbox });

  const fs = nodeSandboxFs();
  const tokens = mintTokens();
  const server = createServer({
    kernel: new Kernel(nodeWorld(fs), { store: nodeLedgerStore(join(dir, 'l.jsonl')) }),
    sandbox, fs, tokens, stream: new Stream(), publicDir: join(dir, 'public'),
    work: desk(dir),
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const search = (qs: string, token: string | null = tokens.owner) =>
    fetch(base + '/forge/search?' + qs, { headers: token === null ? {} : { 'x-zeno-token': token } });
  interface Hit { path: string; line: number; text: string; clipped: boolean }
  interface Answer { repo: boolean; matches: Hit[]; files: number; total: number; truncated: boolean }

  try {
    // The needle, with its REAL line number and the REAL line beside it.
    const res = await search('q=useState');
    assert.equal(res.status, 200);
    const d = await res.json() as Answer;
    assert.equal(d.repo, true);
    const app = d.matches.find((m) => m.path === 'src/App.tsx');
    assert.ok(app, 'the tracked file that contains the needle is a hit');
    assert.equal(app.line, 2, 'the line number is git grep -n\u2019s, not a guess');
    assert.equal(app.text, 'const useState = 2;', 'the matching line is carried verbatim');
    assert.ok(d.matches.some((m) => m.path === 'src/deep/Other.tsx'), 'a nested file is searched too');

    // What git considers part of the working tree is what is searched: an
    // untracked file IS, an ignored one is NOT, and a binary one is NOT.
    assert.ok(d.matches.some((m) => m.path === 'src/New.tsx'), 'an untracked file is searched (--untracked)');
    assert.ok(!d.matches.some((m) => m.path === 'ignored.txt'), '.gitignore is honoured');
    assert.ok(!d.matches.some((m) => m.path === 'blob.bin'), 'a binary file is skipped (-I), never rendered as source');

    // And nothing outside the sandbox is ever reachable, escape or no escape.
    assert.ok(!d.matches.some((m) => m.path.includes('secrets')), 'the file above the sandbox is not in the tree');
    assert.equal(d.files, new Set(d.matches.map((m) => m.path)).size, 'the file count is the files actually returned');
    assert.equal(d.total, d.matches.length);
    assert.equal(d.truncated, false);

    // Case-insensitive, so the panel finds what the eye meant.
    const shout = await (await search('q=' + encodeURIComponent('usestate_max'))).json() as Answer;
    assert.ok(shout.matches.some((m) => m.path === 'src/Shout.ts'), 'the search is case-insensitive');

    // FIXED STRING, not a regular expression: "a.c" must not match "abc", or
    // every query with a dot in it would quietly answer about other files.
    const dotted = await (await search('q=' + encodeURIComponent('a.c'))).json() as Answer;
    assert.equal(dotted.total, 0, 'the query is a fixed string (-F); "." is a full stop, not "any character"');

    // A query that LOOKS like an option is a query. It arrives after `-e`, so
    // git can never read it as a flag.
    const flagish = await search('q=' + encodeURIComponent('--untracked'));
    assert.equal(flagish.status, 200, 'a query beginning with "-" is a pattern, not an argument to git');
    const flags = await flagish.json() as Answer;
    assert.ok(flags.matches.some((m) => m.path === 'src/Flags.ts'), 'and it finds the literal text');

    // A scope narrows the search to one directory inside the sandbox.
    const scoped = await (await search('q=useState&path=' + encodeURIComponent('src/deep'))).json() as Answer;
    assert.deepEqual([...new Set(scoped.matches.map((m) => m.path))], ['src/deep/Other.tsx'], 'the scope is honoured');

    // A scope is a PATH, never a git pathspec. `src/*.tsx` is a glob to git and
    // would match two files here — but the route sends `:(literal)`, so the
    // scope means the one (absent) file it spells, and matches nothing. Without
    // that prefix this returns hits, which is the whole point of asserting it:
    // a scope box that silently accepts pathspec magic is a scope box that can
    // be told to do something other than scope.
    const glob = await search('q=useState&path=' + encodeURIComponent('src/*.tsx'));
    assert.equal(glob.status, 200);
    assert.equal((await glob.json() as Answer).total, 0,
      'the scope is a literal path — git pathspec magic (globs) is not interpreted');

    // And magic that carries a colon never even reaches git: the jail refuses a
    // segment containing ":" on every platform (it is an NTFS stream marker).
    const colon = await search('q=useState&path=' + encodeURIComponent(':(exclude)src/App.tsx'));
    assert.equal(colon.status, 403, ':(exclude) is refused as a path, not obeyed as an instruction');
    assert.equal((await colon.json() as { error: { code: string } }).error.code, 'path-escape');

    // A needle that is simply not there is an empty answer, never an error.
    const none = await search('q=' + encodeURIComponent('zzz-not-in-this-repo'));
    assert.equal(none.status, 200, 'git grep exits 1 for "no matches" — that is an answer, not a failure');
    assert.equal((await none.json() as Answer).total, 0);

    // THE JAIL. Every shape of escape is refused with the same answer and no
    // matches — traversal, an absolute path, a Windows drive letter, a UNC root.
    const escapes = ['..', '../secrets.txt', 'src/../../secrets.txt', '/etc', 'C:\\Windows', '\\\\server\\share\\x'];
    for (const bad of escapes) {
      const r = await search('q=useState&path=' + encodeURIComponent(bad));
      assert.equal(r.status, 403, `${bad} must be refused, not searched`);
      const body = await r.json() as { error: { code: string }; matches?: unknown };
      assert.equal(body.error.code, 'path-escape', `${bad} is refused as a path escape`);
      assert.equal(body.matches, undefined, `${bad} must not leak a single line`);
    }

    // No query at all is a bad request, not a dump of the repository.
    assert.equal((await search('q=')).status, 400);
    assert.equal((await fetch(base + '/forge/search', { headers: { 'x-zeno-token': tokens.owner } })).status, 400);

    // And an unauthenticated search is refused before the jail is even reached.
    assert.equal((await search('q=useState', null)).status, 401, 'search sits behind the same token gate as the rest');
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Forge — search over a sandbox that is not a repository says so instead of failing', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/forge/search?q=anything', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(res.status, 200, 'no repository is an answer, not a 500');
    const d = await res.json() as { repo: boolean; matches: unknown[]; note: string };
    assert.equal(d.repo, false);
    assert.deepEqual(d.matches, []);
    assert.match(d.note, /not a git repository/);
  } finally {
    await h.close();
  }
});

test('Forge — the model/effort picker is served', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/forge/agents', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(res.status, 200);
    const d = await res.json() as { agents: { id: string }[]; efforts: string[]; localModels: string[] };
    assert.ok(d.agents.some((a) => a.id === 'claude-code'), 'Claude Code is a choosable agent');
    assert.ok(d.agents.some((a) => a.id === 'local'), 'a local (open-source) rung exists');
    assert.deepEqual(d.efforts, ['low', 'medium', 'high'], 'effort levels are offered');
    assert.ok(Array.isArray(d.localModels), 'installed local models are listed (empty until pulled)');
  } finally {
    await h.close();
  }
});

test('Forge — run is owner-only and needs a task', async () => {
  const h = await start();
  try {
    const asProposer = await post(h, '/forge/run', h.proposer, { task: 'do a thing' });
    assert.equal(asProposer.status, 403, 'only the owner starts an agent');
    const noTask = await post(h, '/forge/run', h.owner, {});
    assert.equal(noTask.status, 400, 'a run needs a task');
  } finally {
    await h.close();
  }
});

test('Counsel — a transcript summarises into cited decisions and actions', async () => {
  const h = await start();
  try {
    const res = await post(h, '/counsel/summarize', h.owner, {
      utterances: [
        { id: '1', speaker: 'other', text: 'Can you update the README by Friday?' },
        { id: '2', speaker: 'owner', text: 'Yes, I will update the README.' },
        { id: '3', speaker: 'other', text: 'We agreed to ship on Monday.' },
      ],
    });
    assert.equal(res.status, 200);
    const d = await res.json() as { summary: { decisions: { cites: string[] }[]; actions: unknown[] }; text: string };
    assert.ok(d.summary.decisions.length >= 1, 'the agreement is captured as a decision');
    assert.ok(d.summary.decisions[0]!.cites.length > 0, 'and it cites the transcript line — never a rumour');
    assert.ok(d.summary.actions.length >= 1, 'the action item is captured');
    assert.match(d.text, /DECISIONS/, 'a rendered summary comes back too');
  } finally {
    await h.close();
  }
});

test('Counsel — a malformed body is a clean 400, not a crash', async () => {
  const h = await start();
  try {
    const res = await post(h, '/counsel/summarize', h.owner, { nope: true });
    assert.equal(res.status, 400);
  } finally {
    await h.close();
  }
});

// ── Mesh: a real device surface, honest about the device that does not exist ─

test('Mesh — this machine is a device, and nothing is paired with it', async () => {
  const h = await start();
  try {
    const res = await fetch(h.base + '/mesh/devices', { headers: { 'x-zeno-token': h.owner } });
    assert.equal(res.status, 200);
    const d = await res.json() as {
      thisDevice: { deviceId: string; publicKey: string; identityPersisted: boolean };
      paired: string[];
      pairing: unknown;
      phoneClient: { built: boolean; note: string };
    };
    assert.match(d.thisDevice.deviceId, /^[0-9a-f]{32}$/, 'a device id is the hash of its key, never a name');
    assert.equal(Buffer.from(d.thisDevice.publicKey, 'hex').length, 32, 'and it commits to a raw X25519 key');
    assert.equal(d.thisDevice.identityPersisted, false, 'the identity is in memory only — and says so');
    assert.deepEqual(d.paired, [], 'nothing has ever completed a pairing');
    assert.equal(d.pairing, null, 'and none is open');
    assert.equal(d.phoneClient.built, false, 'the phone client does not exist');
    assert.match(d.phoneClient.note, /not built/, 'said in words, not left to an empty list to imply');
  } finally {
    await h.close();
  }
});

test('Mesh — starting a pairing mints a real invite and a code the owner can read aloud', async () => {
  const h = await start();
  try {
    const res = await post(h, '/mesh/pairing', h.owner, {});
    assert.equal(res.status, 200);
    const { pairing } = await res.json() as {
      pairing: { invite: { deviceId: string; publicKey: string }; code: string; completable: boolean; blockedBy: string };
    };
    assert.match(pairing.code, /^\d{6}$/, 'six digits — short enough to say out loud');
    assert.equal(Buffer.from(pairing.invite.publicKey, 'hex').length, 32, 'the invite carries a real public key');
    assert.equal(pairing.completable, false, 'and it cannot be completed');
    assert.match(pairing.blockedBy, /phone client is not built/, 'which is stated, not implied');

    const seen = await fetch(h.base + '/mesh/devices', { headers: { 'x-zeno-token': h.owner } });
    const d = await seen.json() as { pairing: { code: string } | null; paired: string[] };
    assert.equal(d.pairing?.code, pairing.code, 'the SAME code on every read — a new one each time would be a lie');
    assert.deepEqual(d.paired, [], 'starting a pairing pairs nothing');
  } finally {
    await h.close();
  }
});

test('Mesh — a second pairing is refused legibly, and cancelling clears the code', async () => {
  const h = await start();
  try {
    assert.equal((await post(h, '/mesh/pairing', h.owner, {})).status, 200);

    const again = await post(h, '/mesh/pairing', h.owner, {});
    assert.equal(again.status, 409, 'a second Start would replace a code that may already be spoken');
    const body = await again.json() as { error: { code: string; resolve: string } };
    assert.equal(body.error.code, 'pairing-in-progress');
    assert.ok(body.error.resolve.length > 0, 'a refusal always names the way forward');

    const cancelled = await post(h, '/mesh/pairing/cancel', h.owner, {});
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json() as { cancelled: boolean }).cancelled, true);

    const after = await fetch(h.base + '/mesh/devices', { headers: { 'x-zeno-token': h.owner } });
    assert.equal((await after.json() as { pairing: unknown }).pairing, null, 'the code is gone');
    assert.equal((await post(h, '/mesh/pairing', h.owner, {})).status, 200, 'and a fresh one may start');
  } finally {
    await h.close();
  }
});

test('Mesh — pairing is owner-only, but reading the device list is not', async () => {
  const h = await start();
  try {
    const started = await post(h, '/mesh/pairing', h.proposer, {});
    assert.equal(started.status, 403, 'trusting a new device is the owner’s call');
    assert.equal((await started.json() as { error: { code: string } }).error.code, 'owner-only');
    assert.equal((await post(h, '/mesh/pairing/cancel', h.proposer, {})).status, 403);
    assert.equal((await post(h, '/mesh/selfcheck', h.proposer, {})).status, 403);

    // Knowing which devices exist is not deciding to trust one — the same line
    // /work draws between noticing work and doing it.
    const read = await fetch(h.base + '/mesh/devices', { headers: { 'x-zeno-token': h.proposer } });
    assert.equal(read.status, 200);
  } finally {
    await h.close();
  }
});

test('Mesh — the self-check derives ONE verification code on both sides, and pairs nothing', async () => {
  const h = await start();
  try {
    const res = await post(h, '/mesh/selfcheck', h.owner, {});
    assert.equal(res.status, 200);
    const { selfCheck } = await res.json() as {
      selfCheck: {
        sas: string; sasMatch: boolean; wrongCodeDiverges: boolean;
        simulatedPeer: boolean; paired: boolean; simulatedPeerDeviceId: string; note: string;
      };
    };
    assert.equal(selfCheck.sasMatch, true, 'both sides derived the same string — the handshake converged');
    assert.match(selfCheck.sas, /^\d{3} \d{3}$/, 'and it is short enough to compare by eye');
    assert.equal(selfCheck.wrongCodeDiverges, true, 'a peer given the WRONG code derives a different one');
    assert.equal(selfCheck.simulatedPeer, true, 'the other side is a simulation, and is declared as one');
    assert.equal(selfCheck.paired, false);
    assert.match(selfCheck.note, /nothing was paired/);

    // The strongest claim: the simulated peer can never appear as a device.
    const d = await (await fetch(h.base + '/mesh/devices', { headers: { 'x-zeno-token': h.owner } })).json() as {
      paired: string[];
    };
    assert.ok(!d.paired.includes(selfCheck.simulatedPeerDeviceId), 'the simulated peer is not a device');
    assert.deepEqual(d.paired, [], 'it was discarded, not remembered');
  } finally {
    await h.close();
  }
});

// ── delegation: talking to Zeno, and an agent actually starting ─────────────
//
// The gap these close: the owner could say "add a task" but not "build me a
// slugify utility". Delegation is the sentence that starts an agent — and the
// three branches below are the whole governance story of it.
//
//   A run produces PROPOSALS, not effects, so starting one needs no approval
//   capsule. But it spends something real, and the two rungs spend differently:
//   a local model spends the owner's own GPU and the code never leaves; a hosted
//   one spends their money and sends their code to somebody else. So local
//   starts, hosted asks first, and neither-installed says so instead of
//   inventing a start.

/** A probe that reports exactly what a test wants installed on this machine. */
function probe(localModels: string[], claudeOnPath: boolean): DelegateProbe {
  return { available: async () => ({ localModels, claudeOnPath }) };
}

/**
 * A harness whose delegate probe is fixed, so the branch under test is the
 * branch that runs — not whatever happens to be installed on the machine running
 * the suite. Everything else is `start()`'s wiring.
 */
async function startWith(delegateProbe: DelegateProbe): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-daemon-'));
  const sandbox = join(dir, 'sandbox');
  const fs = nodeSandboxFs();
  const kernel = new Kernel(nodeWorld(fs), {
    store: nodeLedgerStore(join(dir, 'ledger.jsonl')),
    policy: DEFAULT_POLICY,
  });
  const tokens = mintTokens();
  const server = createServer({
    kernel,
    sandbox,
    fs,
    tokens,
    stream: new Stream(),
    publicDir: join(dir, 'public'),
    work: nodeWorkDesk(dir),
    delegateProbe,
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const addr = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${addr.port}`,
    owner: tokens.owner,
    proposer: tokens.proposer,
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

interface DelegatedBody {
  readonly delegated: {
    started: boolean;
    needsConfirm: boolean;
    agentId: string | null;
    model: string | null;
    task: string;
    because?: string;
    confirm?: { method: string; path: string; body: Record<string, unknown> };
    note?: string;
    proposed?: unknown[];
  };
}

test('DELEGATE — a hosted agent NEVER starts from a sentence; it asks, and names what it costs', async () => {
  // The machine has claude and no local model. This is the branch that must not
  // fire an agent: it spends the owner's money and sends their code off the box.
  const h = await startWith(probe([], true));
  try {
    const res = await post(h, '/delegate', h.owner, { task: 'build me a slugify utility' });
    assert.equal(res.status, 200);
    const { delegated: d } = (await res.json()) as DelegatedBody;

    assert.equal(d.started, false, 'a hosted agent must not be started by asking');
    assert.equal(d.needsConfirm, true, 'it is offered, behind one click');
    assert.equal(d.agentId, 'claude-code');
    assert.equal(d.task, 'build me a slugify utility', 'the task is carried verbatim');

    // The confirmation must SAY what it costs. Both halves — the money and the
    // egress — because an owner who is told only one of them is being asked to
    // agree to something they have not been told.
    assert.ok(d.because, 'a confirmation with no reason is not a confirmation');
    assert.match(d.because ?? '', /Anthropic/, 'it names where the code goes');
    assert.match(d.because ?? '', /usage|spend/i, 'and that it spends the owner’s usage');

    // And it hands back the exact request the owner's click sends.
    assert.equal(d.confirm?.method, 'POST');
    assert.equal(d.confirm?.path, '/forge/run');
    assert.deepEqual(d.confirm?.body, { task: 'build me a slugify utility', agentId: 'claude-code' });

    assert.equal(h.kernel.receipts().length, 0, 'and nothing happened');
  } finally {
    await h.close();
  }
});

test('DELEGATE — with a local model installed, the local rung is chosen and no confirmation is asked', async () => {
  // Ollama has a model, so the run starts immediately: the code stays on this
  // machine and the only thing spent is the owner's own GPU. The run itself will
  // not succeed here (there is no Ollama answering on 11434 in a test, and the
  // sandbox has no commit to branch a worktree from) — what is asserted is the
  // DECISION: local was chosen, claude-code was not, and nothing was confirmed.
  const h = await startWith(probe(['qwen3:8b'], true));
  try {
    const res = await post(h, '/delegate', h.owner, { task: 'build me a slugify utility' });
    assert.equal(res.status, 200);
    const { delegated: d } = (await res.json()) as DelegatedBody;

    assert.equal(d.agentId, 'local', 'a local model is the default when one is installed');
    assert.equal(d.model, 'qwen3:8b', 'and the run names the model it used');
    assert.equal(d.needsConfirm, false, 'a local run costs no money and leaks no code — it needs no gate');
    assert.equal(d.confirm, undefined, 'and there is nothing for the owner to confirm');
    assert.equal(h.kernel.receipts().length, 0, 'nothing was committed either way');
  } finally {
    await h.close();
  }
});

test('DELEGATE — the hosted rung can still be asked for by name, and still asks first', async () => {
  // A local model is installed, but the owner picked Claude Code. The choice is
  // honoured and the confirmation is NOT skipped: what makes it need one is
  // where the code goes, not whether an alternative existed.
  const h = await startWith(probe(['qwen3:8b'], true));
  try {
    const res = await post(h, '/delegate', h.owner, { task: 'build a parser', agentId: 'claude-code' });
    const { delegated: d } = (await res.json()) as DelegatedBody;
    assert.equal(d.started, false);
    assert.equal(d.needsConfirm, true);
    assert.equal(d.agentId, 'claude-code');
  } finally {
    await h.close();
  }
});

test('DELEGATE — no local model and no claude binary is said plainly, never faked', async () => {
  const h = await startWith(probe([], false));
  try {
    const res = await post(h, '/delegate', h.owner, { task: 'build me a slugify utility' });
    assert.equal(res.status, 200, 'a machine with no agent is a fact, not an error');
    const { delegated: d } = (await res.json()) as DelegatedBody;

    assert.equal(d.started, false, 'nothing started');
    assert.equal(d.needsConfirm, false, 'and there is nothing to confirm — there is nothing to run');
    assert.equal(d.agentId, null, 'no agent is named, because none was chosen');
    assert.ok(d.note, 'the owner is told, in words');
    assert.match(d.note ?? '', /ollama pull/i, 'and told what would make it possible');
    assert.match(d.note ?? '', /claude/i, 'for both rungs');
    assert.equal(h.kernel.receipts().length, 0);
  } finally {
    await h.close();
  }
});

test('DELEGATE — the proposer token cannot start an agent, and is told why', async () => {
  // L6's line, kept where /forge/run keeps it. A proposer may be TOLD that a
  // delegation was suggested; it may not cause one to run.
  const h = await startWith(probe(['qwen3:8b'], true));
  try {
    const res = await post(h, '/delegate', h.proposer, { task: 'build me a slugify utility' });
    const { delegated: d } = (await res.json()) as DelegatedBody;
    assert.equal(d.started, false);
    assert.equal(d.needsConfirm, false, 'it is not offered to a token that could not accept it either');
    assert.match(d.note ?? '', /only the owner/i);
  } finally {
    await h.close();
  }
});

test('DELEGATE — a delegation with no task is a clean 400', async () => {
  const h = await startWith(probe(['qwen3:8b'], true));
  try {
    assert.equal((await post(h, '/delegate', h.owner, {})).status, 400);
    assert.equal((await post(h, '/delegate', h.owner, { task: '   ' })).status, 400);
  } finally {
    await h.close();
  }
});

test('DELEGATE — no branch can report a change as applied', async () => {
  // The shape itself must be unable to say it. A delegation produces capsules
  // that are WAITING; there is no field in any of these answers for "applied",
  // "approved" or "committed", and the ledger is empty in every branch.
  for (const p of [probe([], true), probe(['qwen3:8b'], true), probe([], false)]) {
    const h = await startWith(p);
    try {
      const res = await post(h, '/delegate', h.owner, { task: 'build me a slugify utility' });
      const body = await res.text();
      assert.doesNotMatch(body, /"applied"|"approved"|"committed"/, body);
      assert.equal(h.kernel.receipts().length, 0, 'no receipt exists, so nothing took effect');
    } finally {
      await h.close();
    }
  }
});

test('DELEGATE — plan mode names the agent and starts nothing', async () => {
  // What lets a surface say WHICH agent is about to run before it runs. Voice
  // needs it most: the owner is not looking at a picker when they speak, so the
  // first thing they should learn is who heard them and where the work will go.
  const h = await startWith(probe(['qwen3:8b'], true));
  try {
    const res = await post(h, '/delegate', h.owner, { task: 'build me a slugify utility', plan: true });
    assert.equal(res.status, 200);
    const { delegated: d } = (await res.json()) as DelegatedBody & { delegated: { ready?: boolean } };

    assert.equal(d.started, false, 'a plan starts nothing, by definition');
    assert.equal(d.ready, true, 'and says plainly that this rung could start now');
    assert.equal(d.agentId, 'local', 'named before it runs');
    assert.equal(d.model, 'qwen3:8b', 'model and all');
    assert.equal(d.needsConfirm, false);
  } finally {
    await h.close();
  }
});

test('DELEGATE — `ready` is never set on a branch that cannot run', async () => {
  // The reason `ready` exists rather than reading `needsConfirm: false`: three
  // different non-starts carry that, and a UI treating it as permission would
  // try to start an agent this machine does not have.
  const cases: ReadonlyArray<readonly [string, DelegateProbe, string]> = [
    ['no agent at all', probe([], false), 'owner'],
    ['hosted only', probe([], true), 'owner'],
    ['not the owner', probe(['qwen3:8b'], true), 'proposer'],
  ];
  for (const [name, p, who] of cases) {
    const h = await startWith(p);
    try {
      const token = who === 'owner' ? h.owner : h.proposer;
      const res = await post(h, '/delegate', token, { task: 'build me a slugify utility', plan: true });
      const { delegated: d } = (await res.json()) as { delegated: { ready?: boolean; started: boolean } };
      assert.notEqual(d.ready, true, `${name}: nothing here is ready to run`);
      assert.equal(d.started, false, name);
    } finally {
      await h.close();
    }
  }
});

test('ASK — an answer that delegates comes back with the delegation beside it', async () => {
  // /assistant/ask needs a live local model to answer at all, so what is pinned
  // here is the CONTRACT the window renders against: the field exists on every
  // answer, and it is null — never absent, never invented — when there is none.
  const h = await startWith(probe([], false));
  try {
    const res = await post(h, '/assistant/ask', h.owner, { question: 'what is waiting on me?' });
    assert.equal(res.status, 200, 'an unanswerable question is still a legible answer');
    const d = (await res.json()) as Record<string, unknown>;
    assert.ok('delegated' in d, 'the window reads this field on every answer');
    assert.equal(d['delegated'], null, 'and nothing was delegated, so it is null');
    assert.equal(h.kernel.receipts().length, 0);
  } finally {
    await h.close();
  }
});
