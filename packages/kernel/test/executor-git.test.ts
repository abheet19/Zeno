/**
 * P1-03 — the GitExecutor: jailed, atomic, proven.
 *
 * Everything below the last section runs against an injected git double, so the
 * laws are proven with no repository and no subprocess. The last section drives
 * one full kernel → approve → commit cycle against a REAL temp repository, and
 * skips gracefully when git is not on PATH.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pResolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kernel } from '../src/index.js';
import { hashOf } from '../src/hash.js';
import { PolicyError, type ActionRequest, type Binding, type World } from '../src/types.js';
import { nodeSandboxFs } from '../src/executor-node-fs.js';
import type { SandboxFs } from '../src/executor.js';
import {
  gitExecutor,
  gitHead,
  makeCommitPayload,
  NO_COMMITS,
  type CommitPayload,
  type GitResult,
  type GitRunner,
  type GitSpec,
} from '../src/executor-git.js';
import { GIT_UNAVAILABLE, nodeGitRunner } from '../src/executor-git-node.js';
import { prng, pick, TestWorld } from './harness.js';

/** Platform-native repo root: "/repo" on POSIX, "<drive>:\repo" on Windows. */
const ROOT = pResolve(sep + 'repo');
const HEAD0 = 'a'.repeat(40);

/* ------------------------------------------------------------------ */
/* The git double                                                     */
/* ------------------------------------------------------------------ */

interface FakeState {
  head: string;
  /** Paths whose WORKTREE content differs from HEAD. `git add` stages these. */
  dirty: string[];
  /**
   * Paths currently staged in the INDEX — what `diff --cached` reports, and the
   * durable side effect `git add` leaves behind. Modelling it separately from
   * `dirty` is the whole point: without an index there is no way to ask whether a
   * failed attempt left one dirty, which is what ATOMIC means here.
   */
  indexed: string[];
  /** Paths the last landed commit contains. */
  landed: string[];
  /** What `rev-parse --show-toplevel` reports. */
  toplevel: string;
  /** Git's cwd relative to that root: empty only when cwd is the root itself. */
  prefix: string;
  /**
   * What `ls-files --error-unmatch` knows about, i.e. the paths git has by exactly
   * these names. `null` means "git knows whatever you ask about", which is the
   * ordinary case; a list models a repository where a pathspec matches nothing —
   * the mis-cased path that stages silently on a case-insensitive filesystem.
   */
  tracked: string[] | null;
}

const OK = (stdout = ''): GitResult => ({ status: 0, stdout, stderr: '' });
/** NUL-separated, as git's `-z` emits it. */
const zed = (xs: readonly string[]): string => xs.map((x) => x + '\0').join('');
/** Deterministic "next commit" sha — no clock, no randomness. */
const nextSha = (head: string): string => hashOf(head).slice(0, 40);

function afterDashDash(args: readonly string[]): string[] {
  const i = args.indexOf('--');
  return i === -1 ? [] : [...args.slice(i + 1)];
}

/**
 * git's pathspec rule, which is the one the executor is jailed against: a
 * pathspec matches the file of that exact name, AND everything beneath it when
 * it names a directory. `git add -- src` reaching `src/a.ts` is not an edge
 * case, it is how `add` has always worked.
 */
const matches = (specs: readonly string[], p: string): boolean =>
  specs.some((s) => p === s || p.startsWith(s + '/'));

type Override = (args: readonly string[], state: FakeState) => GitResult | null;

interface FakeGit extends GitRunner {
  readonly calls: string[][];
  readonly cwds: string[];
  readonly state: FakeState;
  ran(verb: string): boolean;
  count(verb: string): number;
}

/** An in-memory git that models exactly the verbs this executor may use. */
function fakeGit(init: Partial<FakeState> = {}, override?: Override): FakeGit {
  const state: FakeState = { head: HEAD0, dirty: [], indexed: [], landed: [], toplevel: ROOT, prefix: '', tracked: null, ...init };
  const calls: string[][] = [];
  const cwds: string[] = [];
  return {
    calls,
    cwds,
    state,
    ran: (verb) => calls.some((c) => c.includes(verb)),
    count: (verb) => calls.filter((c) => c.includes(verb)).length,
    run(args, cwd) {
      calls.push([...args]);
      cwds.push(cwd);
      // Recorded HERE rather than per-test, so "nothing this suite ran named a
      // remote verb" is a claim about every invocation, not about one test's.
      everyArgument.push(...args);
      const forced = override?.(args, state);
      if (forced) return forced;
      const a = args.filter((x) => x !== '--literal-pathspecs');
      const verb = a[0] ?? '';
      const specs = afterDashDash(a);
      /** What the INDEX holds under these pathspecs — `git diff --cached`. */
      const staged = state.indexed.filter((p) => matches(specs, p));
      if (verb === 'rev-parse' && a[1] === '--show-toplevel') return OK(state.toplevel + '\n');
      if (verb === 'rev-parse' && a[1] === '--show-prefix') return OK(state.prefix + '\n');
      if (verb === 'rev-parse') {
        return state.head === NO_COMMITS ? { status: 1, stdout: '', stderr: '' } : OK(state.head + '\n');
      }
      if (verb === 'add') {
        // add MUTATES the index — durably, and whether or not a commit follows.
        for (const p of state.dirty) if (matches(specs, p) && !state.indexed.includes(p)) state.indexed.push(p);
        return OK();
      }
      if (verb === 'diff') return OK(zed(staged));
      // The two ways to put the index back: with a HEAD to restore from, and
      // (unborn HEAD) without one.
      if (verb === 'restore' || verb === 'update-index') {
        state.indexed = state.indexed.filter((p) => !matches(specs, p));
        return OK();
      }
      if (verb === 'ls-files') {
        const known = state.tracked;
        if (known === null) return OK(zed(specs));
        // git's own rule: a pathspec matches a tracked file, or a directory of them.
        const unmatched = specs.filter((s) => !known.some((t) => t === s || t.startsWith(s + '/')));
        return unmatched.length === 0
          ? OK(zed(specs))
          : {
              status: 1,
              stdout: '',
              stderr: `error: pathspec '${unmatched[0] ?? ''}' did not match any file(s) known to git`,
            };
      }
      if (verb === 'commit') {
        state.head = nextSha(state.head);
        state.landed = staged;
        // A commit consumes the index it was built from, as git's `--only` does.
        state.indexed = state.indexed.filter((p) => !staged.includes(p));
        state.dirty = state.dirty.filter((p) => !staged.includes(p));
        return OK();
      }
      if (verb === 'diff-tree') return OK(zed(state.landed));
      return { status: 128, stdout: '', stderr: `fake git: unsupported "${a.join(' ')}"` };
    },
  };
}

/** A Binding whose payloadHash matches the payload, as the kernel would produce. */
function bindingFor(payload: CommitPayload): Binding {
  return {
    payloadHash: hashOf(payload),
    baseHash: payload.expectHead,
    targetRef: ROOT + '@HEAD',
    kind: 'vcs.commit',
    tier: 'T1',
    provenanceHash: 'p',
  };
}

/**
 * A filesystem with no links in it: every path is already its own real path.
 * `GitSpec.fs` is REQUIRED — the link-resolving half of the jail is not optional,
 * because git follows a symlink or a junction without being asked — so a suite
 * that wants to exercise everything ELSE still has to say what the real paths are.
 * Saying "nothing here is a link" is the honest default for a pure-logic test.
 */
const noLinks: SandboxFs = {
  readFile: () => null,
  writeAtomic: () => {
    throw new Error('the git executor never writes files');
  },
  realpath: (p) => p,
};

/** The spec under test. `fs` defaults to the link-free filesystem above. */
function specOf(git: GitRunner, fs: SandboxFs = noLinks): GitSpec {
  return { repoRoot: ROOT, git, fs };
}

/** Build + run the executor in one step. */
function runExec(spec: GitSpec, payload: CommitPayload): Promise<{ effect: string }> {
  return gitExecutor(spec, payload)(bindingFor(payload));
}

const commitOf = (paths: readonly string[], expectHead = HEAD0, message = 'chore: governed edit'): CommitPayload => ({
  message,
  paths: [...paths],
  expectHead,
});

/**
 * Every git argument this suite ever produced — scanned at the end for a remote
 * verb. Filled by the fake's own `run` and by the recording wrapper around the
 * REAL runner the governed executor uses, so it covers every invocation the
 * executor made rather than one test's.
 */
const everyArgument: string[] = [];

/** Wrap a runner so every governed invocation lands in `everyArgument`. */
function recording(inner: GitRunner): GitRunner {
  return {
    run(args, cwd) {
      everyArgument.push(...args);
      return inner.run(args, cwd);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Happy path                                                          */
/* ------------------------------------------------------------------ */

test('happy path: stages exactly the named paths, commits once, returns the real sha', async () => {
  const git = fakeGit({ dirty: ['src/a.ts', 'src/b.ts', 'src/unapproved.ts'] });
  const payload = commitOf(['src/a.ts', 'src/b.ts']);
  const proof = await runExec(specOf(git), payload);

  assert.equal(proof.effect, 'git:' + git.state.head);
  assert.notEqual(git.state.head, HEAD0);
  assert.equal(git.count('commit'), 1, 'exactly one attempt (L2)');
  assert.deepEqual(git.state.landed, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(git.state.dirty, ['src/unapproved.ts'], 'an unapproved change is left alone');
  // every invocation happened in the repo root, nowhere else
  for (const cwd of git.cwds) assert.equal(cwd, ROOT);
});

test('every pathspec-carrying invocation is armed with --literal-pathspecs, first', async () => {
  // The regex in `jailPaths` is the first lock against a widening glob; this flag
  // is the second, and the fake deliberately ignores it — so without this test a
  // dropped flag would break nothing anywhere in the suite. Position matters too:
  // `--literal-pathspecs` is a git-level option, and git rejects it after the verb.
  const git = fakeGit({ dirty: ['src/a.ts'] });
  await runExec(specOf(git), commitOf(['src/a.ts']));
  let checked = 0;
  for (const call of git.calls) {
    if (!call.includes('--')) continue; // no pathspec, no glob to worry about
    assert.equal(call[0], '--literal-pathspecs', `unarmed: git ${call.join(' ')}`);
    checked++;
  }
  assert.ok(checked >= 3, `add, diff --cached and commit all carry a pathspec (saw ${checked})`);
});

test('paths are normalised for git and de-duplicated', async () => {
  const git = fakeGit({ dirty: ['src/a.ts'] });
  // "src/./a.ts", "src\a.ts" and "src/a.ts" are one and the same file.
  const payload = commitOf(['src/./a.ts', 'src/a.ts']);
  await runExec(specOf(git), payload);
  const add = git.calls.find((c) => c.includes('add'));
  assert.deepEqual(afterDashDash(add ?? []), ['src/a.ts'], 'one canonical pathspec');
});

test('a backslash is translated only where it IS a separator', async () => {
  // Windows: "src\a.ts" is the same file as "src/a.ts", and git wants the slash.
  // POSIX: a backslash is a legal character IN a filename, so rewriting it would
  // hand git a pathspec naming a different file than the jail just cleared — an
  // approval for "src\a.ts" landing on "src/a.ts".
  const WIN = sep === '\\';
  const expected = WIN ? 'src/a.ts' : 'src\\a.ts';
  const git = fakeGit({ dirty: [expected] });
  await runExec(specOf(git), commitOf(['src\\a.ts']));
  const add = git.calls.find((c) => c.includes('add'));
  assert.deepEqual(afterDashDash(add ?? []), [expected]);
  assert.deepEqual(git.state.landed, [expected], 'and that is the file that was committed');
});

/* ------------------------------------------------------------------ */
/* JAIL                                                                */
/* ------------------------------------------------------------------ */

test('JAIL — no adversarial path is ever staged (property)', async () => {
  const rnd = prng(1201);
  const escapes = ['../x', '../../etc/passwd', '/etc/passwd', 'a/../../b', '../../../../root', '/tmp/x'];
  for (let i = 0; i < 400; i++) {
    const git = fakeGit();
    const bad = pick(rnd, escapes) + (rnd() < 0.5 ? '/' + Math.floor(rnd() * 99) : '');
    // The escaping path rides alongside a perfectly legitimate one, so a jail
    // that only checked the first entry would be caught here.
    const payload = commitOf(['src/ok.ts', bad]);
    await assert.rejects(
      () => runExec(specOf(git), payload),
      (e) => e instanceof PolicyError && /escapes/.test(e.message),
      bad,
    );
    assert.equal(git.ran('add'), false, 'nothing staged');
    assert.equal(git.ran('commit'), false, 'nothing committed');
  }
  // and a legitimate nested path is allowed through
  const good = fakeGit({ dirty: ['src/toolbar/x.tsx'] });
  await runExec(specOf(good), commitOf(['src/toolbar/x.tsx']));
  assert.equal(good.count('commit'), 1);
});

test('JAIL — Windows path traps are rejected before anything is staged', async () => {
  const traps: [string, RegExp][] = [
    ['notes.txt:hidden', /alternate data stream/],
    ['sub/a.txt:$DATA', /alternate data stream/],
    ['NUL', /reserved device name/],
    ['sub/con.txt', /reserved device name/],
    ['COM1', /reserved device name/],
    ['a.txt.', /dot or space/],
    ['sub/name ', /dot or space/],
  ];
  for (const [bad, expected] of traps) {
    const git = fakeGit();
    await assert.rejects(
      () => runExec(specOf(git), commitOf([bad])),
      (e) => e instanceof PolicyError && expected.test(e.message),
      bad,
    );
    assert.equal(git.ran('add'), false, bad);
  }
});

test('JAIL — pathspec glob magic is refused (one approval cannot widen itself)', async () => {
  for (const bad of ['src/*', 'src/*.ts', 'a?.ts', 'src/[ab].ts']) {
    const git = fakeGit();
    await assert.rejects(
      () => runExec(specOf(git), commitOf([bad])),
      (e) => e instanceof PolicyError && /glob magic/.test(e.message),
      bad,
    );
    assert.equal(git.ran('add'), false, bad);
  }
});

test('JAIL — the repository root itself is not an approvable path', async () => {
  const git = fakeGit();
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['.'])),
    (e) => e instanceof PolicyError && /repository root itself/.test(e.message),
  );
  assert.equal(git.ran('add'), false);
});

test('JAIL — a commit with no paths is refused (that would be "add everything")', async () => {
  const git = fakeGit();
  await assert.rejects(
    () => runExec(specOf(git), commitOf([])),
    (e) => e instanceof PolicyError && /at least one path/.test(e.message),
  );
  assert.equal(git.ran('add'), false);
});

test('JAIL — a path that leaves the root through a link is refused, link or junction', async () => {
  // Every one of these resolves INSIDE the root lexically and is therefore
  // invisible to containment: only the real path gives it away. `git add` would
  // read straight through all three — to git (and to Windows) a junction IS a
  // directory — and stage a file from outside the repository.
  const outside = pResolve(sep + 'outside', 'secret');
  const cases: [string, string][] = [
    ['link.ts', pResolve(ROOT, 'link.ts')], // a symlinked FILE
    ['junc/secret.txt', pResolve(ROOT, 'junc')], // an NTFS junction as a DIRECTORY
    ['a/b/link.ts', pResolve(ROOT, 'a', 'b', 'link.ts')], // nested, so depth is no defence
  ];
  for (const [relPath, linkAt] of cases) {
    const fs: SandboxFs = {
      readFile: () => null,
      writeAtomic: () => {
        throw new Error('the git executor never writes files');
      },
      realpath: (p) => (p === linkAt || p.startsWith(linkAt + sep) ? outside : p),
    };
    const git = fakeGit({ dirty: [relPath] });
    await assert.rejects(
      () => runExec(specOf(git, fs), commitOf([relPath])),
      (e) => e instanceof PolicyError && /symlink/.test(e.message),
      relPath,
    );
    assert.equal(git.ran('add'), false, relPath);
    assert.equal(git.ran('commit'), false, relPath);
  }
});

test('JAIL — the link check is not opt-in: a spec cannot be built without a real fs', () => {
  // The escape this closes was a TYPE hole, not a logic one: while `fs` was
  // optional, `{ repoRoot, git }` compiled, skipped `realpath` entirely, and
  // committed whatever a junction pointed at. Assert the shape structurally —
  // a test that only exercised the with-fs path would have passed throughout.
  const src = readFileSync(fileURLToPath(new URL('../../src/executor-git.ts', import.meta.url)), 'utf8');
  assert.equal(/\bfs\?\s*:/.test(src), false, 'GitSpec.fs must not be optional');
  assert.match(src, /readonly fs: SandboxFs/);
  // and the executor must reach for the link-resolving jail, never the lexical half
  assert.match(src, /jail\(spec\.fs, root, p\)/);
  assert.equal(/jailPath\(/.test(src), false, 'the fs-free jail is not enough for a pathspec');
});

test('JAIL — a repoRoot nested inside someone else’s checkout is refused', async () => {
  // git would happily act on the ENCLOSING repository; containment against the
  // wrong root is not containment. Git reports that cwd's non-empty position.
  const git = fakeGit({ toplevel: pResolve(sep + 'other-repo'), prefix: 'nested/' });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    (e) => e instanceof PolicyError && /not the root of the repository/.test(e.message),
  );
  assert.equal(git.ran('add'), false);
});

test('JAIL — Git root position accepts 8.3, long-name, and linked aliases of one directory', async () => {
  // Git resolved the cwd itself. An empty prefix proves cwd is the repository
  // root even when --show-toplevel returns a different string spelling for it.
  const alias = pResolve(sep + 'repo-long-name');
  const git = fakeGit({ toplevel: alias, prefix: '', dirty: ['a.ts'] });
  const proof = await runExec(specOf(git), commitOf(['a.ts']));
  assert.equal(proof.effect, 'git:' + git.state.head);
  assert.equal(git.ran('--show-prefix'), true, 'identity came from Git, not path-string equality');
});

test('JAIL — a DIRECTORY cannot widen one approval into every file beneath it', async () => {
  // The glob check refuses `src/*` and says why: "an approval for two files
  // becoming a commit of two hundred". Plain `src` does the identical thing —
  // `git add` is recursive — and carries no magic character to catch it on.
  // Reconcile cannot see it either: the extra files are staged AND landed, so
  // its two lists agree with each other and only the approval is betrayed.
  const git = fakeGit({ dirty: ['src/a.ts', 'src/SECRET.env', 'src/deep/x.ts'] });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['src'])),
    (e) =>
      e instanceof PolicyError &&
      /would also commit/.test(e.message) &&
      e.message.includes('src/SECRET.env') &&
      e.message.includes('src/deep/x.ts'),
  );
  assert.equal(git.ran('commit'), false, 'nothing committed');
  assert.deepEqual(git.state.indexed, [], 'and the index it staged to look was put back');
  assert.equal(git.state.head, HEAD0, 'history untouched');
});

test('JAIL — a file whose NAME starts with an approved path is not thereby approved', async () => {
  // "src/a.ts" must not authorise "src/a.ts.bak": a prefix is not a path.
  const git = fakeGit({ dirty: ['src/a.ts'] });
  await runExec(specOf(git), commitOf(['src/a.ts']));
  assert.deepEqual(git.state.landed, ['src/a.ts']);

  // src/a.ts is tracked and already committed; only its neighbour is dirty.
  const sneaky = fakeGit({ dirty: ['src/a.ts.bak'], tracked: ['src/a.ts'] });
  const proof = await runExec(specOf(sneaky), commitOf(['src/a.ts']));
  assert.equal(proof.effect, 'git:' + HEAD0, 'a no-op, not a commit of the neighbour');
  assert.deepEqual(sneaky.state.landed, []);
});

/* ------------------------------------------------------------------ */
/* Integrity, base check, message                                      */
/* ------------------------------------------------------------------ */

test('integrity — a tampered payload is refused and git is never invoked', async () => {
  const git = fakeGit({ dirty: ['a.ts'] });
  const approved = commitOf(['a.ts'], HEAD0, 'chore: the approved message');
  const tampered = commitOf(['a.ts', 'secrets.env'], HEAD0, 'chore: the approved message');
  await assert.rejects(
    () => gitExecutor(specOf(git), tampered)(bindingFor(approved)),
    (e) => e instanceof PolicyError && e.code === 'tuple-mismatch',
  );
  assert.equal(git.calls.length, 0, 'nothing staged — git was not even asked');
});

test('integrity — an empty commit message is refused', async () => {
  const git = fakeGit({ dirty: ['a.ts'] });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'], HEAD0, '   ')),
    (e) => e instanceof PolicyError && /commit message is required/.test(e.message),
  );
  assert.equal(git.calls.length, 0);
});

test('base check — HEAD moved between approve and commit: base-drifted, nothing committed', async () => {
  const moved = 'b'.repeat(40);
  const git = fakeGit({ head: moved, dirty: ['a.ts'] });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'], HEAD0)),
    (e) =>
      e instanceof PolicyError &&
      e.code === 'base-drifted' &&
      e.message.includes(HEAD0.slice(0, 7)) &&
      e.message.includes(moved.slice(0, 7)),
  );
  assert.equal(git.ran('add'), false, 'nothing staged');
  assert.equal(git.ran('commit'), false, 'nothing committed');
  assert.equal(git.state.head, moved, 'the repository is exactly as we found it');
});

test('base check — an unborn HEAD is its own base, and a root commit still lands', async () => {
  const git = fakeGit({ head: NO_COMMITS, dirty: ['a.ts'] });
  assert.equal(gitHead(specOf(git)), NO_COMMITS);
  const proof = await runExec(specOf(git), commitOf(['a.ts'], NO_COMMITS));
  assert.equal(proof.effect, 'git:' + git.state.head);
  // drift the other way: a repo that has commits cannot satisfy `no_commits`
  const populated = fakeGit({ dirty: ['a.ts'] });
  await assert.rejects(
    () => runExec(specOf(populated), commitOf(['a.ts'], NO_COMMITS)),
    (e) => e instanceof PolicyError && e.code === 'base-drifted' && e.message.includes(NO_COMMITS),
  );
});

/* ------------------------------------------------------------------ */
/* PROVEN                                                              */
/* ------------------------------------------------------------------ */

test('PROVEN — a lying git (reports success, HEAD never moves) is caught', async () => {
  const git = fakeGit({ dirty: ['a.ts'] }, (args) => (args.includes('commit') ? OK() : null));
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    /reconcile failed: HEAD did not move/,
  );
  assert.equal(git.state.head, HEAD0);
});

test('PROVEN — a failing commit (a hook says no) surfaces git’s own words', async () => {
  const git = fakeGit({ dirty: ['a.ts'] }, (args) =>
    args.includes('commit') ? { status: 1, stdout: '', stderr: 'pre-commit hook refused the change' } : null,
  );
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    /reconcile failed: HEAD did not move.*pre-commit hook refused/s,
  );
});

test('PROVEN — HEAD moved but git reported failure: never claimed as success', async () => {
  const git = fakeGit({ dirty: ['a.ts'] }, (args, state) => {
    if (!args.includes('commit')) return null;
    state.head = nextSha(state.head);
    state.landed = ['a.ts'];
    return { status: 1, stdout: '', stderr: 'something went sideways' };
  });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    /reconcile failed: HEAD moved to .* but git commit exited 1/,
  );
});

test('PROVEN — a commit missing a staged path is refused', async () => {
  const git = fakeGit({ dirty: ['a.ts', 'b.ts'] }, (args, state) => {
    if (!args.includes('diff-tree')) return null;
    state.landed = ['a.ts']; // b.ts silently vanished
    return OK(zed(['a.ts']));
  });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts', 'b.ts'])),
    /is not what was staged \(missing: b\.ts; unexpected: none\)/,
  );
});

test('PROVEN — a commit carrying a path nobody staged is refused', async () => {
  const git = fakeGit({ dirty: ['a.ts'] }, (args) =>
    args.includes('diff-tree') ? OK(zed(['a.ts', 'secrets.env'])) : null,
  );
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    /is not what was staged \(missing: none; unexpected: secrets\.env\)/,
  );
});

/* ------------------------------------------------------------------ */
/* ATOMIC — the index is not collateral                                */
/* ------------------------------------------------------------------ */

test('ATOMIC — a refused commit leaves the index exactly as it was found', async () => {
  // `git add` is a durable mutation of a SHARED index and nothing undoes it on
  // its own. Left behind, the approved file rides into the next commit any human
  // makes: an agent's edit reaching history with no approval and no receipt.
  const git = fakeGit({ dirty: ['a.ts', 'untouched.ts'] }, (args) =>
    args.includes('commit') ? { status: 1, stdout: '', stderr: 'pre-commit hook refused the change' } : null,
  );
  await assert.rejects(() => runExec(specOf(git), commitOf(['a.ts'])), /pre-commit hook refused/);
  assert.equal(git.state.head, HEAD0, 'no commit');
  assert.deepEqual(git.state.indexed, [], 'and no staged leftovers to ambush the next commit');
  assert.deepEqual(git.state.dirty, ['a.ts', 'untouched.ts'], 'the work itself is untouched, ready to retry');
  assert.ok(
    git.calls.some((c) => c.includes('restore') && c.includes('--staged')),
    'the index was put back with an unstage, not a working-tree reset',
  );
});

test('ATOMIC — with no HEAD to restore from, the rollback removes the entry instead', async () => {
  // A root commit has no HEAD: "as we found it" cannot mean "as HEAD has it", it
  // means no index entry at all. `restore --staged` cannot even run here — real
  // git exits 128 with "could not resolve HEAD".
  const git = fakeGit({ head: NO_COMMITS, dirty: ['README.md'] }, (args) =>
    args.includes('commit') ? { status: 1, stdout: '', stderr: 'hook says no' } : null,
  );
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['README.md'], NO_COMMITS)),
    /reconcile failed: HEAD did not move from no_commits/,
  );
  assert.deepEqual(git.state.indexed, []);
  assert.ok(
    git.calls.some((c) => c.includes('update-index')),
    'an unborn HEAD is rolled back by removing the entry',
  );
  assert.equal(git.ran('restore'), false, 'and never by restoring from a HEAD that does not exist');
});

test('ATOMIC — a rollback that itself fails is REPORTED, never swallowed', async () => {
  // An index this could not put back is precisely what the operator must be
  // told, and the original failure must survive alongside it.
  const stuck = fakeGit({ dirty: ['a.ts'] }, (args) => {
    if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'hook says no' };
    if (args.includes('restore')) return { status: 128, stdout: '', stderr: 'fatal: index.lock exists' };
    return null;
  });
  await assert.rejects(
    () => runExec(specOf(stuck), commitOf(['a.ts'])),
    /reconcile failed: HEAD did not move.*hook says no.*index could not be restored.*index\.lock/s,
  );
  assert.deepEqual(stuck.state.indexed, ['a.ts'], 'and it does not pretend the rollback happened');

  // …and the same when the index cannot even be READ back.
  let diffs = 0;
  const blind = fakeGit({ dirty: ['a.ts'] }, (args) => {
    if (args.includes('commit')) return { status: 1, stdout: '', stderr: 'hook says no' };
    // the pre-flight and post-add reads succeed; the rollback's read does not
    if (args[1] === 'diff' && ++diffs === 3) return { status: 128, stdout: '', stderr: 'fatal: broken index' };
    return null;
  });
  await assert.rejects(
    () => runExec(specOf(blind), commitOf(['a.ts'])),
    /index could not be inspected.*broken index/s,
  );
});

test('ATOMIC — a governed commit will not consume work a human staged for the same path', async () => {
  // `git add` would overwrite their staged version with the worktree, and
  // `commit --only` would then commit over the top: their work gone, with no
  // receipt and nothing in the reflog to get it back from.
  const git = fakeGit({ dirty: ['a.ts'], indexed: ['a.ts'] });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    (e) => e instanceof PolicyError && /already holds staged changes for a\.ts/.test(e.message),
  );
  assert.equal(git.ran('add'), false, 'refused BEFORE the index was touched');
  assert.equal(git.ran('commit'), false);
  assert.deepEqual(git.state.indexed, ['a.ts'], 'their staging is exactly as they left it');
});

/* ------------------------------------------------------------------ */
/* Idempotence                                                         */
/* ------------------------------------------------------------------ */

test('idempotent — nothing to commit is a SUCCESS, not a failure (property)', async () => {
  const rnd = prng(1202);
  const names = ['a.ts', 'src/b.ts', 'docs/c.md', 'deep/nest/d.json'];
  for (let i = 0; i < 300; i++) {
    const head = hashOf(i).slice(0, 40);
    const paths = names.slice(0, 1 + Math.floor(rnd() * names.length));
    // the tree already matches: `git add` finds nothing to stage
    const git = fakeGit({ head, dirty: [] });
    const proof = await runExec(specOf(git), commitOf(paths, head));
    assert.equal(proof.effect, 'git:' + head);
    assert.equal(git.ran('commit'), false, 'no second commit');
    assert.equal(git.state.head, head, 'history untouched');
  }
});

test('idempotent — the no-op is PROVEN, not inferred from an empty diff', async () => {
  // An empty `diff --cached` has two causes and the diff cannot tell them apart:
  // "these paths already match HEAD", and "the pathspec matched nothing". The
  // second is not hypothetical — on a case-insensitive filesystem
  // `git add -- SRC/A.TS` against a tracked `src/a.ts` exits 0 and stages nothing.
  // Reporting THAT as an idempotent success is a `verified` receipt for a file
  // still sitting dirty in the tree.
  const git = fakeGit({ dirty: [], tracked: ['src/a.ts'] });
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['SRC/A.TS'])),
    (e) =>
      e instanceof PolicyError &&
      /git does not know these paths by these names/.test(e.message) &&
      /did not match any file/.test(e.message),
  );
  assert.equal(git.ran('commit'), false, 'and nothing was committed');
  assert.equal(git.state.head, HEAD0);

  // the genuine no-op — git knows the path by that name — still succeeds
  const real = fakeGit({ dirty: [], tracked: ['src/a.ts'] });
  const proof = await runExec(specOf(real), commitOf(['src/a.ts']));
  assert.equal(proof.effect, 'git:' + HEAD0);
  assert.equal(real.ran('commit'), false);
});

test('makeCommitPayload binds the payload to the repository’s current HEAD', () => {
  const head = 'd'.repeat(40);
  const git = fakeGit({ head });
  const p = makeCommitPayload(specOf(git), 'chore: x', ['a.ts']);
  assert.deepEqual(p, { message: 'chore: x', paths: ['a.ts'], expectHead: head });
});

/* ------------------------------------------------------------------ */
/* A git that is absent or broken                                      */
/* ------------------------------------------------------------------ */

test('a git binary that is absent surfaces legibly, and nothing is staged', async () => {
  const absent: GitRunner = {
    run: () => ({ status: GIT_UNAVAILABLE, stdout: '', stderr: 'git could not be run: spawnSync git ENOENT' }),
  };
  await assert.rejects(
    () => runExec(specOf(absent), commitOf(['a.ts'])),
    /git rev-parse --show-toplevel failed \(exit 127\).*ENOENT/s,
  );
});

test('a git that errors mid-flight surfaces legibly', async () => {
  const git = fakeGit({ dirty: ['a.ts'] }, (args) =>
    args.includes('add') ? { status: 128, stdout: '', stderr: "fatal: pathspec 'a.ts' did not match any files" } : null,
  );
  await assert.rejects(
    () => runExec(specOf(git), commitOf(['a.ts'])),
    /git add failed \(exit 128\).*did not match any files/s,
  );
  assert.equal(git.ran('commit'), false);
});

test('gitHead — a sha, an unborn HEAD, a broken repo, and a nonsense answer', () => {
  const sha = 'c'.repeat(40);
  assert.equal(gitHead(specOf(fakeGit({ head: sha }))), sha);
  assert.equal(gitHead(specOf(fakeGit({ head: NO_COMMITS }))), NO_COMMITS);

  const broken: GitRunner = { run: () => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }) };
  assert.throws(() => gitHead(specOf(broken)), /git rev-parse failed \(exit 128\).*not a git repository/s);

  const liar: GitRunner = { run: () => OK('definitely-not-a-sha\n') };
  assert.throws(() => gitHead(specOf(liar)), /not a sha/);
});

/* ------------------------------------------------------------------ */
/* No remote, ever                                                     */
/* ------------------------------------------------------------------ */

test('there is no code path to a remote, and none was ever taken', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/executor-git.ts', import.meta.url)), 'utf8');
  // Comments are stripped first: what matters is that no remote-mutating verb
  // exists in the CODE, where it could reach git. Every git argument in that
  // file is a quoted literal, so a quoted verb is the thing to look for.
  // (`out.push(x)` is an array method, not a verb, and survives this check.)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const verb of ['push', 'remote', 'fetch', 'clone', 'submodule', 'reset', '-f', '--force', '-A', '--all']) {
    const asArgument = new RegExp('[\'"`]' + verb + '[\'"`]');
    assert.equal(asArgument.test(code), false, `git must never be passed "${verb}"`);
  }
  for (const banned of [/force-with-lease/, /filter-branch/, /--hard\b/]) {
    assert.equal(banned.test(code), false, String(banned));
  }
});

/* ------------------------------------------------------------------ */
/* The real adapter                                                    */
/* ------------------------------------------------------------------ */

const GIT_OK = nodeGitRunner().run(['--version'], tmpdir()).status === 0;
const skipNoGit = GIT_OK ? false : 'git is not on PATH';

test('the real runner reports a missing binary instead of throwing', () => {
  const r = nodeGitRunner({ binary: 'zeno-no-such-git-binary', timeoutMs: 5000 }).run(['--version'], tmpdir());
  assert.equal(r.status, GIT_UNAVAILABLE);
  assert.match(r.stderr, /could not be run/);
  assert.equal(r.stdout, '');
});

test('the real runner reports an argument spawnSync itself refuses, instead of throwing', () => {
  // "NEVER THROWS" has a case that is not about git at all: `spawnSync` validates
  // its own arguments and throws a TypeError for a NUL byte, before any process
  // exists — so `r.error` is never reached and there is nothing to inspect. A
  // NUL can arrive from a payload path or a commit message, and a raw TypeError
  // out of the adapter is an unhandled error where the contract promises a
  // reported result.
  const NUL = '\u0000';
  for (const args of [
    ['rev-parse', 'a' + NUL + 'b'], // a NUL inside a pathspec
    ['commit', '-m', 'subject' + NUL + 'hidden'], // a NUL inside a commit message
  ]) {
    const r = nodeGitRunner({ timeoutMs: 5000 }).run(args, tmpdir());
    assert.equal(r.status, GIT_UNAVAILABLE, JSON.stringify(args));
    assert.match(r.stderr, /could not be run/);
    assert.equal(r.stdout, '');
  }
  // and the same for a NUL in the working directory
  const r = nodeGitRunner({ timeoutMs: 5000 }).run(['--version'], tmpdir() + NUL + 'x');
  assert.equal(r.status, GIT_UNAVAILABLE);
});

test('the real runner reports a non-zero exit instead of throwing', { skip: skipNoGit }, () => {
  const r = nodeGitRunner().run(['rev-parse', '--verify', '--quiet', 'zeno-no-such-ref-zzz'], tmpdir());
  assert.notEqual(r.status, 0, 'a ref that does not exist');
  assert.equal(typeof r.stdout, 'string');
});

test('the real runner runs git', { skip: skipNoGit }, () => {
  const r = nodeGitRunner().run(['--version'], tmpdir());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /git version/);
});

/* ------------------------------------------------------------------ */
/* THE REAL ONE — a genuine repository, driven by the kernel           */
/* ------------------------------------------------------------------ */

/** realpath, so a Windows 8.3 name or a linked /tmp cannot fail the root check. */
const repo = GIT_OK ? realpathSync(mkdtempSync(join(tmpdir(), 'zeno-git-'))) : '';
after(() => {
  if (repo !== '') {
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      /* a temp dir the OS will reap anyway */
    }
  }
});

const realGit = nodeGitRunner();
/** The governed spec records what it asked git to do; `raw()` below does not. */
const realSpec: GitSpec = { repoRoot: repo, git: recording(realGit), fs: nodeSandboxFs() };
/** Setup helper: raw git, outside the governed path, so the test can arrange state. */
function raw(...args: string[]): GitResult {
  const r = realGit.run(args, repo);
  assert.equal(r.status, 0, `setup "git ${args.join(' ')}" failed: ${r.stderr}`);
  return r;
}
function log(): string[] {
  return raw('log', '--pretty=format:%H').stdout.trim().split(/\r?\n/).filter((l) => l !== '');
}

function worldOver(spec: GitSpec): World {
  const tw = new TestWorld();
  return { now: () => tw.now(), id: () => tw.id(), readBase: () => gitHead(spec), approvalTtlMs: 60_000 };
}

function commitRequest(payload: CommitPayload, summary: string): ActionRequest {
  return {
    kind: 'vcs.commit', // T1 — needs an owner approval
    summary,
    targetRef: repo + '@HEAD',
    payload,
    baseHash: payload.expectHead,
    requestedBy: 'work-agent',
    dataZones: ['personal'],
  };
}

test('REAL: kernel → approve → gitExecutor lands exactly one real commit', { skip: skipNoGit }, async () => {
  raw('init', '-q');
  // Local identity + no signing, so this works on a machine with no global config.
  raw('config', 'user.email', 'zeno@example.invalid');
  raw('config', 'user.name', 'Zeno Test');
  raw('config', 'commit.gpgsign', 'false');

  // ---- a governed ROOT commit, in a repository with no commits at all ----
  writeFileSync(join(repo, 'README.md'), 'first\n');
  assert.equal(gitHead(realSpec), NO_COMMITS);

  const first = makeCommitPayload(realSpec, 'chore: seed the repository', ['README.md']);
  assert.equal(first.expectHead, NO_COMMITS);
  const k = new Kernel(worldOver(realSpec));
  const pv0 = k.preview(commitRequest(first, 'seed the repository'));
  assert.equal(pv0.tier, 'T1');
  const r0 = await k.commit(k.approve(pv0.actionHash), gitExecutor(realSpec, first));
  assert.equal(r0.outcome, 'verified', r0.reason ?? '');
  const head1 = raw('rev-parse', 'HEAD').stdout.trim();
  assert.equal(r0.externalEffect.effect, 'git:' + head1, 'the REAL sha is in the receipt');
  assert.equal(log().length, 1);

  // ---- a governed edit, with an unapproved change sitting beside it ----
  writeFileSync(join(repo, 'README.md'), 'first\nsecond\n');
  writeFileSync(join(repo, 'NOT-APPROVED.md'), 'nobody approved this\n');

  const payload = makeCommitPayload(realSpec, 'docs: add a line to the readme', ['README.md']);
  assert.equal(payload.expectHead, head1);
  const pv = k.preview(commitRequest(payload, 'add a line to the readme'));
  const receipt = await k.commit(k.approve(pv.actionHash), gitExecutor(realSpec, payload));

  assert.equal(receipt.outcome, 'verified', receipt.reason ?? '');
  const head2 = raw('rev-parse', 'HEAD').stdout.trim();
  assert.equal(receipt.externalEffect.effect, 'git:' + head2);
  assert.notEqual(head2, head1);
  assert.equal(log().length, 2, 'exactly one NEW commit');
  const files = raw('show', '--pretty=format:', '--name-only', 'HEAD').stdout;
  assert.match(files, /README\.md/);
  assert.equal(/NOT-APPROVED/.test(files), false, 'the unapproved file never entered the commit');
  assert.match(raw('log', '-1', '--pretty=format:%s').stdout, /docs: add a line to the readme/);
  assert.equal(k.verifyChain().ok, true);
});

test('REAL: nothing to commit is an idempotent success on a real repo', { skip: skipNoGit }, async () => {
  const head = gitHead(realSpec);
  // README.md is already exactly as HEAD has it.
  const payload = makeCommitPayload(realSpec, 'docs: no-op', ['README.md']);
  const proof = await gitExecutor(realSpec, payload)(bindingFor(payload));
  assert.equal(proof.effect, 'git:' + head);
  assert.equal(raw('rev-parse', 'HEAD').stdout.trim(), head, 'no new commit');
});

test('REAL: a competing commit between approve and commit refuses, tree untouched', { skip: skipNoGit }, async () => {
  const before = gitHead(realSpec);
  writeFileSync(join(repo, 'governed.md'), 'a\n');
  const payload = makeCommitPayload(realSpec, 'docs: governed', ['governed.md']);
  const k = new Kernel(worldOver(realSpec));
  const pv = k.preview(commitRequest(payload, 'governed'));
  const ap = k.approve(pv.actionHash);

  // somebody else commits first
  writeFileSync(join(repo, 'competing.md'), 'theirs\n');
  raw('add', '--', 'competing.md');
  raw('commit', '-q', '-m', 'someone else got there first');
  const competing = raw('rev-parse', 'HEAD').stdout.trim();
  assert.notEqual(competing, before);

  // the kernel's own compare-and-swap refuses first, and does NOT spend the approval
  const refused = await k.commit(ap, gitExecutor(realSpec, payload));
  assert.equal(refused.outcome, 'refused');
  assert.equal(raw('rev-parse', 'HEAD').stdout.trim(), competing, 'no commit of ours');
  // "working tree untouched" means untracked — `??`, not `A `. A refusal that had
  // already staged the file would still contain the string "governed.md".
  assert.match(raw('status', '--porcelain', '--', 'governed.md').stdout, /^\?\? governed\.md/m);

  // and the executor's own git-layer base check refuses the same thing on its own
  await assert.rejects(
    () => gitExecutor(realSpec, payload)(bindingFor(payload)),
    (e) => e instanceof PolicyError && e.code === 'base-drifted',
  );
  assert.equal(raw('rev-parse', 'HEAD').stdout.trim(), competing, 'still no commit of ours');
  assert.equal(log().length, 3);
});

test('REAL: an escaping path is refused against a real repository', { skip: skipNoGit }, async () => {
  const payload = commitOf(['../escape.md'], gitHead(realSpec));
  await assert.rejects(
    () => gitExecutor(realSpec, payload)(bindingFor(payload)),
    (e) => e instanceof PolicyError && /escapes/.test(e.message),
  );
  assert.equal(log().length, 3, 'no commit happened');
});

test('REAL: a link out of the repository cannot carry an outside file into a commit', { skip: skipNoGit }, async () => {
  // The one escape a lexical jail cannot see. `junc/secret.txt` is inside the
  // root by every string test there is, and git does not care that `junc` is a
  // reparse point — on Windows a junction IS a directory, so `git add` reads the
  // file and stages its contents. The approval named one path in the repository;
  // the commit would carry a file from somewhere else on the machine entirely.
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'zeno-outside-')));
  writeFileSync(join(outside, 'secret.txt'), 'a private key, or anything else at all\n');
  const linked = join(repo, 'junc');
  // A junction needs no privilege on Windows; a POSIX symlink needs none either.
  // If the platform refuses anyway, skip rather than pass silently.
  let made = true;
  try {
    symlinkSync(outside, linked, 'junction');
  } catch {
    made = false;
  }
  try {
    if (!made) return;
    const beforeLog = log().length;
    const payload = commitOf(['junc/secret.txt'], gitHead(realSpec));
    await assert.rejects(
      () => gitExecutor(realSpec, payload)(bindingFor(payload)),
      (e) => e instanceof PolicyError && /symlink/.test(e.message),
    );
    assert.equal(log().length, beforeLog, 'no commit happened');
    assert.equal(raw('status', '--porcelain', '--', 'junc').stdout.includes('junc'), true, 'and nothing was staged');
    // The proof that matters: the bytes never entered the repository at all.
    assert.equal(
      raw('log', '--all', '--pretty=format:', '--name-only').stdout.includes('junc'),
      false,
      'no commit in this repository mentions the linked path',
    );
  } finally {
    rmSync(linked, { recursive: true, force: true, maxRetries: 5 });
    rmSync(outside, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('REAL: a change the human STAGED beside the approved one is neither committed nor lost', { skip: skipNoGit }, async () => {
  // This is what `--only` is for, and no test covered it: the earlier "unapproved
  // file" is UNTRACKED, which every spelling of `git commit` excludes anyway, so
  // that test passes just as happily with `--only` swapped for its dangerous
  // opposite, `--include` (stage the named paths ON TOP of the index and commit
  // the lot). A file the human has actually STAGED is the case that tells them
  // apart, and it is the realistic one — half a rebase, a partial `git add -p`.
  writeFileSync(join(repo, 'README.md'), 'first\nsecond\nthird\n');
  writeFileSync(join(repo, 'secrets.env'), 'TOKEN=hunter2\n');
  raw('add', '--', 'secrets.env'); // the human staged this; nobody approved it
  assert.match(raw('status', '--porcelain', '--', 'secrets.env').stdout, /^A {2}secrets\.env/m);

  const payload = makeCommitPayload(realSpec, 'docs: a third line', ['README.md']);
  const k = new Kernel(worldOver(realSpec));
  const pv = k.preview(commitRequest(payload, 'a third line'));
  const receipt = await k.commit(k.approve(pv.actionHash), gitExecutor(realSpec, payload));
  assert.equal(receipt.outcome, 'verified', receipt.reason ?? '');

  const landed = raw('show', '--pretty=format:', '--name-only', 'HEAD').stdout;
  assert.match(landed, /README\.md/);
  assert.equal(/secrets\.env/.test(landed), false, 'the staged-but-unapproved file stayed out of the commit');
  // and it was not silently discarded either — the human's work is exactly as they left it
  assert.match(raw('status', '--porcelain', '--', 'secrets.env').stdout, /^A {2}secrets\.env/m);
  assert.notEqual(realGit.run(['show', 'HEAD:secrets.env'], repo).status, 0, 'not in history at all');
  assert.equal(log().length, 4);
  raw('rm', '-q', '--cached', '--', 'secrets.env');
  rmSync(join(repo, 'secrets.env'), { force: true });
});

test('REAL: a refused pre-commit hook lands NOTHING (the attempt is not a partial commit)', { skip: skipNoGit }, async () => {
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho "pre-commit hook refused the change" >&2\nexit 1\n', { mode: 0o755 });
  const before = gitHead(realSpec);
  const depth = log().length;
  writeFileSync(join(repo, 'README.md'), 'first\nsecond\nthird\nfourth\n');

  const payload = makeCommitPayload(realSpec, 'docs: a fourth line', ['README.md']);
  try {
    // ONE attempt, and it must throw rather than claim a commit it cannot show.
    await assert.rejects(
      () => gitExecutor(realSpec, payload)(bindingFor(payload)),
      /reconcile failed: HEAD did not move.*pre-commit hook refused/s,
    );
    // The half of the claim the fake cannot make: the REAL repository has no new
    // history, and HEAD is exactly where it was.
    assert.equal(gitHead(realSpec), before, 'HEAD did not move');
    assert.equal(log().length, depth, 'no commit, not even an empty one');
    assert.equal(raw('show', '--pretty=format:', '--name-only', 'HEAD').stdout.includes('fourth'), false);
    // The approved work is still there to retry — it was not silently discarded.
    assert.match(readFileSync(join(repo, 'README.md'), 'utf8'), /fourth/);
    // ATOMIC, and this is the half a fake cannot assert: the INDEX is a durable,
    // shared mutation that `git add` already made. Against real git, a refused
    // commit leaves the approved path STAGED unless something puts it back — so
    // this line is what separates "nothing landed" from "nothing landed, and the
    // repository is as we found it". ` M` (unstaged), never `M ` (staged).
    assert.match(raw('status', '--porcelain', '--', 'README.md').stdout, /^ M README\.md/m);
  } finally {
    rmSync(hook, { force: true });
    raw('reset', '-q', 'HEAD', '--', 'README.md');
    raw('checkout', '--', 'README.md');
  }
});

test('REAL: a mis-cased path never reports a commit that did not happen', { skip: skipNoGit }, async () => {
  // On Windows and macOS `git add -- README.MD` matches the file, exits 0 and
  // stages NOTHING; the executor's `diff --cached` then comes back empty, which
  // is indistinguishable from "already applied" unless it asks git. On a
  // case-sensitive filesystem `add` fails outright. Either way the one forbidden
  // outcome is the same: a success for a commit that never happened.
  const before = gitHead(realSpec);
  const depth = log().length;
  writeFileSync(join(repo, 'README.md'), 'first\nsecond\nthird\nfifth\n');
  const payload = commitOf(['README.MD'], before, 'docs: mis-cased');
  await assert.rejects(
    () => gitExecutor(realSpec, payload)(bindingFor(payload)),
    (e) =>
      e instanceof Error &&
      /(does not know these paths by these names|did not match any files)/.test(e.message),
  );
  assert.equal(gitHead(realSpec), before);
  assert.equal(log().length, depth, 'no commit');
  assert.match(raw('status', '--porcelain', '--', 'README.md').stdout, /README\.md/, 'still uncommitted');
  raw('reset', '-q', 'HEAD', '--', 'README.md');
  raw('checkout', '--', 'README.md');
});

test('REAL: a rename lands, and is not mistaken for a file nobody staged', { skip: skipNoGit }, async () => {
  // The two halves of reconcile ask git the same question in different dialects.
  // `diff --cached` is porcelain and detects renames, so it reports a rename as
  // the destination alone; `diff-tree` is plumbing and reports the delete and the
  // add. Without one vocabulary for both, every renamed file lands perfectly and
  // is then declared "unexpected" — a real commit written down as outcome-unknown.
  const body = 'aaa\nbbb\nccc\nddd\neee\nfff\nggg\n';
  writeFileSync(join(repo, 'old.ts'), body);
  const seed = makeCommitPayload(realSpec, 'chore: a file to rename', ['old.ts']);
  await gitExecutor(realSpec, seed)(bindingFor(seed));

  rmSync(join(repo, 'old.ts'));
  writeFileSync(join(repo, 'new.ts'), body); // a plain mv: same bytes, new name
  const payload = makeCommitPayload(realSpec, 'refactor: rename old.ts to new.ts', ['old.ts', 'new.ts']);
  const proof = await gitExecutor(realSpec, payload)(bindingFor(payload));

  assert.equal(proof.effect, 'git:' + gitHead(realSpec), 'verified, not outcome-unknown');
  const landed = raw('diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', 'HEAD').stdout;
  assert.match(landed, /new\.ts/);
  assert.match(landed, /old\.ts/, 'the deletion is part of the same governed commit');
  assert.equal(raw('status', '--porcelain', '--', 'old.ts', 'new.ts').stdout.trim(), '', 'nothing left behind');
});

test('REAL: a directory approval is refused, and the index is put back', { skip: skipNoGit }, async () => {
  const depth = log().length;
  mkdirSync(join(repo, 'sub'), { recursive: true });
  writeFileSync(join(repo, 'sub', 'a.ts'), 'the approved edit\n');
  writeFileSync(join(repo, 'sub', 'SECRET.env'), 'TOKEN=hunter2\n');

  // ONE approved path — and real `git add -- sub` expands it to both files.
  const payload = makeCommitPayload(realSpec, 'chore: the whole directory', ['sub']);
  await assert.rejects(
    () => gitExecutor(realSpec, payload)(bindingFor(payload)),
    (e) => e instanceof PolicyError && /would also commit/.test(e.message) && /sub\/SECRET\.env/.test(e.message),
  );
  assert.equal(log().length, depth, 'no commit');
  assert.equal(
    /^[AMD]/m.test(raw('status', '--porcelain', '--', 'sub').stdout),
    false,
    'and the staging it did to find out was undone',
  );
  rmSync(join(repo, 'sub'), { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Last: the dynamic half of "no remote, ever"                         */
/* ------------------------------------------------------------------ */

test('and no invocation this suite made — fake or real — ever named a remote verb', () => {
  // Declared last so it sees every governed call the whole file produced, rather
  // than the handful that happened to run before it.
  for (const arg of everyArgument) {
    assert.ok(!/^(push|remote|fetch|clone|-f|-A|--all|--force|--hard)$/.test(arg), `git was passed "${arg}"`);
  }
  // Prove the sweep is broad rather than vacuous: every verb the executor can
  // reach for had to pass through it.
  for (const verb of [
    'rev-parse',
    'add',
    'diff',
    'commit',
    'diff-tree',
    'ls-files',
    // the two rollback spellings — proof the ATOMIC path was actually exercised
    'restore',
    'update-index',
    '--literal-pathspecs',
  ]) {
    assert.ok(everyArgument.includes(verb), `the sweep saw "${verb}"`);
  }
});
