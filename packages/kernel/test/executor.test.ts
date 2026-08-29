/** P1-02 — the WorktreeExecutor: jailed, atomic, proven. Unit + property tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../src/hash.js';
import { PolicyError, type Binding } from '../src/types.js';
import {
  jail,
  worktreeExecutor,
  makeWritePayload,
  type SandboxFs,
  type WritePayload,
} from '../src/executor.js';
import { prng, pick } from './harness.js';

const ROOT = '/sandbox';

/** In-memory sandbox fs. `links` overrides realpath to simulate escaping symlinks. */
function memFs(init: [string, string][] = []) {
  const files = new Map<string, string>(init);
  const links = new Map<string, string>();
  let writes = 0;
  const fs: SandboxFs & {
    files: Map<string, string>;
    writes(): number;
    link(from: string, to: string): void;
  } = {
    files,
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeAtomic: (p, c) => {
      writes++;
      files.set(p, c);
    },
    realpath: (p) => links.get(p) ?? p,
    writes: () => writes,
    link: (from, to) => links.set(from, to),
  };
  return fs;
}

/** A Binding whose payloadHash matches the given payload (as the kernel would produce). */
function bindingFor(payload: WritePayload): Binding {
  return {
    payloadHash: hashOf(payload),
    baseHash: payload.expectBaseHash,
    targetRef: ROOT + '/' + payload.relPath,
    tier: 'T1',
    provenanceHash: 'p',
  };
}

test('happy path: applies the write and returns a file receipt', async () => {
  const fs = memFs([[ROOT + '/a.txt', 'old']]);
  const payload = makeWritePayload('a.txt', 'old', 'new');
  const exec = worktreeExecutor({ root: ROOT, fs }, payload);
  const proof = await exec(bindingFor(payload));
  assert.equal(fs.files.get(ROOT + '/a.txt'), 'new');
  assert.equal(proof.effect, 'file:' + hashOf('new'));
});

test('JAIL — no adversarial path ever resolves outside the sandbox (property)', () => {
  const rnd = prng(1201);
  const escapes = ['../x', '../../etc/passwd', '/etc/passwd', 'a/../../b', '../../../../root', '/tmp/x'];
  for (let i = 0; i < 400; i++) {
    const fs = memFs();
    const bad = pick(rnd, escapes) + (rnd() < 0.5 ? '/' + Math.floor(rnd() * 99) : '');
    assert.throws(() => jail(fs, ROOT, bad), (e) => e instanceof PolicyError && /escapes/.test(e.message));
  }
  // and a legitimate nested path is allowed
  assert.equal(jail(memFs(), ROOT, 'src/toolbar/x.tsx'), ROOT + '/src/toolbar/x.tsx');
});

test('JAIL — an escaping symlink is rejected', () => {
  const fs = memFs();
  fs.link(ROOT + '/link', '/outside/secret'); // realpath of the target points outside
  assert.throws(() => jail(fs, ROOT, 'link'), (e) => e instanceof PolicyError);
});

test('integrity — a payload that is not the approved one is refused', async () => {
  const fs = memFs([[ROOT + '/a.txt', 'old']]);
  const approved = makeWritePayload('a.txt', 'old', 'new');
  const bound = bindingFor(approved);
  const tampered = makeWritePayload('a.txt', 'old', 'EVIL');
  const exec = worktreeExecutor({ root: ROOT, fs }, tampered); // executor holds a different payload
  await assert.rejects(() => exec(bound), (e) => e instanceof PolicyError && e.code === 'tuple-mismatch');
  assert.equal(fs.files.get(ROOT + '/a.txt'), 'old', 'nothing written');
});

test('base-check — a drifted base is refused, nothing written', async () => {
  const fs = memFs([[ROOT + '/a.txt', 'DIFFERENT']]); // file is not what the payload expects
  const payload = makeWritePayload('a.txt', 'old', 'new'); // expects base "old"
  const exec = worktreeExecutor({ root: ROOT, fs }, payload);
  await assert.rejects(() => exec(bindingFor(payload)), (e) => e instanceof PolicyError && e.code === 'base-drifted');
  assert.equal(fs.files.get(ROOT + '/a.txt'), 'DIFFERENT');
});

test('idempotent — re-applying an already-applied payload writes nothing (property)', async () => {
  const rnd = prng(1202);
  for (let i = 0; i < 300; i++) {
    const next = 'v' + Math.floor(rnd() * 1000);
    const fs = memFs([[ROOT + '/a.txt', next]]); // file already equals the target
    const payload = makeWritePayload('a.txt', 'old', next);
    const exec = worktreeExecutor({ root: ROOT, fs }, payload);
    const proof = await exec(bindingFor(payload));
    assert.equal(proof.effect, 'file:' + hashOf(next));
    assert.equal(fs.writes(), 0, 'no second write');
  }
});

test('PROVEN — a lying fs (write silently drops) is caught by reconcile', async () => {
  const files = new Map([[ROOT + '/a.txt', 'old']]);
  const liar: SandboxFs = {
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeAtomic: () => {
      /* claims to write, does nothing */
    },
    realpath: (p) => p,
  };
  const payload = makeWritePayload('a.txt', 'old', 'new');
  const exec = worktreeExecutor({ root: ROOT, fs: liar }, payload);
  await assert.rejects(() => exec(bindingFor(payload)), /reconcile failed/);
});

test('atomic — a throwing write surfaces as an error (kernel will mark outcome-unknown)', async () => {
  const files = new Map([[ROOT + '/a.txt', 'old']]);
  const flaky: SandboxFs = {
    readFile: (p) => (files.has(p) ? files.get(p)! : null),
    writeAtomic: () => {
      throw new Error('disk full');
    },
    realpath: (p) => p,
  };
  const payload = makeWritePayload('a.txt', 'old', 'new');
  const exec = worktreeExecutor({ root: ROOT, fs: flaky }, payload);
  await assert.rejects(() => exec(bindingFor(payload)), /disk full/);
  assert.equal(files.get(ROOT + '/a.txt'), 'old', 'original intact');
});
