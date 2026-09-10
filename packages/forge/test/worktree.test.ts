/**
 * Isolating the work.
 *
 * The fake-`GitRunner` tests fix the argv and the refusal behaviour with no
 * repository; the one REAL test (skipped cleanly when git is absent) proves the
 * whole lifecycle against a live git — create a detached worktree, see a file
 * the "agent" wrote, and remove it.
 *
 * The load-bearing assertion is the refusal: when a worktree cannot be made,
 * `createWorktree` THROWS. There is no branch anywhere that falls back to running
 * on the real working tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nodeGitRunner, type GitRunner, type GitResult } from '@abheet19/zeno-kernel';
import {
  WORKTREE_NAMESPACE,
  WorktreeCleanupError,
  WorktreeUnavailableError,
  createWorktree,
  diffFiles,
} from '../src/worktree.js';

/** A GitRunner whose behaviour is scripted on argv, recording every call. */
function fakeGit(script: (args: readonly string[]) => GitResult): {
  git: GitRunner;
  calls: { args: readonly string[]; cwd: string }[];
} {
  const calls: { args: readonly string[]; cwd: string }[] = [];
  const git: GitRunner = {
    run(args, cwd) {
      calls.push({ args, cwd });
      return script(args);
    },
  };
  return { git, calls };
}

const G = (status: number, stdout = '', stderr = ''): GitResult => ({ status, stdout, stderr });
const z = (...records: string[]): string => records.map((r) => r + '\0').join('');

const BASE = join(tmpdir(), 'forge-fake-base');

test('createWorktree adds a detached throwaway under the namespace, cleanup removes it', () => {
  const { git, calls } = fakeGit(() => G(0));
  const wt = createWorktree('/repo', 'run-42', git, { tmpBase: BASE });

  assert.ok(wt.path.includes(WORKTREE_NAMESPACE), 'it lives under the sweepable namespace');
  assert.ok(wt.path.endsWith('run-42'));
  assert.deepEqual(calls[0]!.args, ['worktree', 'add', '--detach', wt.path]);
  assert.equal(calls[0]!.cwd, '/repo');

  wt.cleanup();
  assert.deepEqual(calls[1]!.args, ['worktree', 'remove', '--force', wt.path]);
});

test('a failed `worktree add` REFUSES — no un-isolated fallback', () => {
  const { git } = fakeGit((a) =>
    a[1] === 'add' ? G(128, '', "git: 'worktree' is not a git command") : G(0),
  );
  assert.throws(
    () => createWorktree('/repo', 'r', git, { tmpBase: BASE }),
    (err: unknown) => {
      assert.ok(err instanceof WorktreeUnavailableError);
      assert.match(err.detail, /not a git command/);
      assert.match(err.message, /un-isolated fallback/, 'the refusal is stated, not implied');
      return true;
    },
  );
});

test('a failure with no git output still yields a legible reason', () => {
  const { git } = fakeGit((a) => (a[1] === 'add' ? G(128) : G(0)));
  assert.throws(
    () => createWorktree('/repo', 'r', git, { tmpBase: BASE }),
    (err: unknown) => {
      assert.ok(err instanceof WorktreeUnavailableError);
      assert.match(err.detail, /git exited 128/, 'a silent git still gets a reason, never a blank');
      return true;
    },
  );
});

test('a name that climbs out of the namespace is rejected before git is called', () => {
  const { git, calls } = fakeGit(() => G(0));
  assert.throws(() => createWorktree('/repo', '../escape', git, { tmpBase: BASE }), /escapes the sandbox/);
  assert.equal(calls.length, 0, 'the jail rejects it up front — git is never asked');
});

test('a failed `worktree remove` surfaces as a cleanup error, not a silent leak', () => {
  const { git } = fakeGit((a) => (a[1] === 'remove' ? G(1, '', 'fatal: still in use') : G(0)));
  const wt = createWorktree('/repo', 'r', git, { tmpBase: BASE });
  assert.throws(() => wt.cleanup(), WorktreeCleanupError);
});

test('diffFiles parses the changeset, and a failed status refuses', () => {
  const ok = fakeGit(() => G(0, z(' M a.ts', '?? b.ts')));
  assert.deepEqual(diffFiles('/wt', ok.git), ['a.ts', 'b.ts']);
  assert.deepEqual(ok.calls[0]!.args, ['status', '--porcelain', '-z', '-uall']);

  const bad = fakeGit(() => G(128, '', 'fatal: not a git repository'));
  assert.throws(() => diffFiles('/wt', bad.git), WorktreeUnavailableError);
});

test('diffFiles refuses a changed path that escapes through a symlink or junction', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-jail-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'forge-jail-outside-'));
  const linked = join(root, 'linked');
  writeFileSync(join(outside, 'secret.txt'), 'must stay outside\n');
  try {
    try {
      symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('this machine does not allow creating a directory link');
      return;
    }
    const escaped = fakeGit(() => G(0, z('?? linked/secret.txt')));
    assert.throws(
      () => diffFiles(root, escaped.git),
      /escapes the sandbox via a symlink/,
      'a git-reported path is canonicalised before a caller may read it',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('createWorktree refuses a temporary namespace redirected through a symlink or junction', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'forge-worktree-base-'));
  const outside = mkdtempSync(join(tmpdir(), 'forge-worktree-outside-'));
  const namespace = join(base, WORKTREE_NAMESPACE);
  try {
    try {
      symlinkSync(outside, namespace, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('this machine does not allow creating a directory link');
      return;
    }
    const { git, calls } = fakeGit(() => G(0));
    assert.throws(
      () => createWorktree('/repo', 'escaped-run', git, { tmpBase: base }),
      /escapes the sandbox via a symlink/,
    );
    assert.equal(calls.length, 0, 'the redirected checkout is refused before git can write into it');
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

/** git subcommands that would LAND history locally or PUBLISH it to a remote. */
const LANDS_OR_PUBLISHES = new Set([
  'commit', 'push', 'fetch', 'pull', 'clone', 'remote', 'merge', 'rebase',
  'cherry-pick', 'revert', 'reset', 'branch', 'switch', 'checkout', 'tag',
  'am', 'apply', 'update-ref', 'stash', 'format-patch', 'send-email',
]);

test('SAFETY — the worktree flow only isolates and reads; it never lands or publishes', () => {
  // The whole lifecycle the gate depends on: make the throwaway, read back what
  // the agent changed, tear it down. Every git command it spawns is recorded.
  const { git, calls } = fakeGit((a) => (a[0] === 'status' ? G(0, z(' M a.ts', '?? b.ts')) : G(0)));

  const wt = createWorktree('/repo', 'run-safety', git, { tmpBase: BASE });
  assert.deepEqual(diffFiles(wt.path, git), ['a.ts', 'b.ts'], 'the changeset is read for the gate');
  wt.cleanup();

  assert.ok(calls.length >= 3, 'add, status and remove all ran');
  for (const c of calls) {
    // The flow may use exactly two verbs: `worktree` (the isolation itself) and a
    // read-only `status`. Anything else would be a path to an effect.
    assert.ok(
      c.args[0] === 'worktree' || c.args[0] === 'status',
      `the flow may only isolate (worktree) or read (status) — saw "${c.args[0]}"`,
    );
    // A `worktree` call is only ever add/remove — never a `worktree`-hosted commit.
    if (c.args[0] === 'worktree') {
      assert.ok(c.args[1] === 'add' || c.args[1] === 'remove', `unexpected worktree op "${c.args[1]}"`);
    }
    // No token ANYWHERE in ANY argv lands or publishes history — not as a verb,
    // not smuggled in as an argument.
    for (const tok of c.args) {
      assert.ok(!LANDS_OR_PUBLISHES.has(tok), `no landing/publishing verb may be spawned — saw "${tok}"`);
    }
  }

  // The one `add` is detached: the throwaway is on NO branch, so nothing the agent
  // does inside it can advance one of the owner's branches.
  const add = calls.find((c) => c.args[0] === 'worktree' && c.args[1] === 'add')!;
  assert.ok(add.args.includes('--detach'), 'the worktree is created detached — never on a branch');
});

/** True when a real git is on PATH — the one integration test needs it. */
function gitAvailable(): boolean {
  try {
    return nodeGitRunner().run(['--version'], tmpdir()).status === 0;
  } catch {
    return false;
  }
}

test('REAL — create a worktree, see the agent write, remove it', (t) => {
  if (!gitAvailable()) {
    t.skip('git is not on PATH');
    return;
  }
  const git = nodeGitRunner();
  const repo = mkdtempSync(join(tmpdir(), 'forge-repo-'));
  const base = mkdtempSync(join(tmpdir(), 'forge-base-'));
  try {
    // A fresh repository with one commit — `worktree add --detach` needs a HEAD.
    assert.equal(git.run(['init', '-q'], repo).status, 0, 'git init');
    git.run(['config', 'user.email', 'forge@test.local'], repo);
    git.run(['config', 'user.name', 'Forge Test'], repo);
    git.run(['config', 'commit.gpgsign', 'false'], repo);
    writeFileSync(join(repo, 'seed.txt'), 'seed\n');
    assert.equal(git.run(['add', 'seed.txt'], repo).status, 0, 'git add');
    assert.equal(git.run(['commit', '-q', '-m', 'seed'], repo).status, 0, 'git commit');

    mkdirSync(join(base, WORKTREE_NAMESPACE), { recursive: true });
    const wt = createWorktree(repo, 'run-real', git, { tmpBase: base });
    assert.ok(existsSync(wt.path), 'the worktree directory exists');

    // The "agent" writes a new file into the isolated worktree.
    writeFileSync(join(wt.path, 'new.ts'), 'export const x = 1;\n');
    assert.deepEqual(diffFiles(wt.path, git), ['new.ts'], 'the change is seen for the gate');

    wt.cleanup();
    assert.equal(existsSync(wt.path), false, 'cleanup removed the worktree');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(base, { recursive: true, force: true });
  }
});
