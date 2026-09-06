#!/usr/bin/env node
/**
 * `zeno up` — start the daemon and serve the window.
 *
 * Everything it needs lives in one directory (default `./.zeno`): the receipt
 * ledger, an optional `policy.json`, and the sandbox the executor is jailed to.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_POLICY,
  Kernel,
  PolicyError,
  loadOrCreateSigner,
  nodeLedgerStore,
  nodeSandboxFs,
  policyHash,
  readPolicyFile,
} from '@abheet19/zeno-kernel';
import { createServer } from './server.js';
import { Stream } from './stream.js';
import { nodeHeldStore } from './held-store.js';
import { mintTokens } from './tokens.js';
import { githubFromEnv, nodeWorkDesk } from './work.js';
import { Vault, nodeNoteStore, nodeClock } from '@abheet19/zeno-vault';
import { Meetings, nodeMeetingStore } from '@abheet19/zeno-counsel';
import { nodeGitRunner } from '@abheet19/zeno-kernel';
import { nodeWorld } from './world.js';

const PORT = Number(process.env['ZENO_PORT'] ?? 7317);
const HOST = '127.0.0.1'; // loopback only, deliberately

/**
 * Where the window's static files live.
 *
 * Two very different situations. Run from source, they sit next to this module.
 * Run from the single executable, there IS no module directory — the exe embeds
 * its own code — so they ship in a `public` folder beside the .exe. Check that
 * first: `import.meta.url` does not survive being bundled into the executable
 * and throws "Invalid URL" if we reach for it there.
 */
function resolvePublicDir(): string {
  const besideExe = join(dirname(process.execPath), 'public');
  if (existsSync(join(besideExe, 'index.html'))) return besideExe;
  try {
    return fileURLToPath(new URL('../../public', import.meta.url));
  } catch {
    return resolve('packages/daemon/public');
  }
}


/**
 * Take exclusive ownership of the workspace directory.
 *
 * The port is guarded (EADDRINUSE), but the WORKSPACE was not — and the two are
 * different resources. A second daemon started on another port against the same
 * ZENO_DIR holds its own in-memory `prevReceipt`, so both append to one
 * hash-chained ledger from stale heads and the chain forks. That is exactly the
 * corruption this product exists to make impossible, and the old EADDRINUSE
 * message actively invited it by suggesting ZENO_PORT=7318 as the fix.
 *
 * `wx` is the atomic primitive: create-or-fail, no read-then-write race. A lock
 * whose process is gone is stale and may be taken over — a crash must not lock
 * the owner out of their own data.
 */
function acquireWorkspace(dir: string, port: number): () => void {
  const lockPath = join(dir, 'zeno.lock');
  const mine = JSON.stringify({ pid: process.pid, port, since: new Date().toISOString() });

  const claim = (): boolean => {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, mine);
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  };

  if (!claim()) {
    let held: { pid?: number; port?: number; since?: string } = {};
    try {
      held = JSON.parse(readFileSync(lockPath, 'utf8')) as typeof held;
    } catch {
      /* an unreadable lock is treated as stale below */
    }
    let alive = false;
    if (typeof held.pid === 'number') {
      // Signal 0 tests for existence without touching the process.
      try {
        process.kill(held.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
    }
    if (alive) {
      process.stderr.write(
        `
  Another Zeno already owns this workspace.
` +
          `    workspace  ${dir}
` +
          `    held by    pid ${held.pid}${held.port === undefined ? '' : ` on port ${held.port}`}` +
          `${held.since === undefined ? '' : ` since ${held.since}`}

` +
          `  Two daemons sharing one workspace append to the same receipt ledger from
` +
          `  stale heads, which forks the hash chain and destroys the audit trail.
` +
          `  Close the other Zeno, or start this one with its own ZENO_DIR.

`,
      );
      process.exitCode = 1;
      return () => {};
    }
    // Stale: the holder is gone. Take it over rather than stranding the owner.
    try {
      unlinkSync(lockPath);
    } catch {
      /* someone else won the race; the claim below will fail honestly */
    }
    if (!claim()) {
      process.stderr.write(`
  Could not take the workspace lock at ${lockPath}.

`);
      process.exitCode = 1;
      return () => {};
    }
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      release();
      process.exit(0);
    });
  }
  return release;
}

function main(): void {
  const dir = resolve(process.env['ZENO_DIR'] ?? '.zeno');
  mkdirSync(dir, { recursive: true });
  acquireWorkspace(dir, PORT);
  if (process.exitCode === 1) return; // another Zeno owns this workspace

  const sandbox = join(dir, 'sandbox');
  // forge init: the sandbox is a git repository so Forge can commit through the
  // gate. Idempotent — a repo that already exists is left alone.
  mkdirSync(sandbox, { recursive: true });
  // Init the sandbox as its OWN repo when it has no .git of its own. Checking
  // rev-parse would find a PARENT repo (the sandbox lives under the project) and
  // skip init, leaving Forge pointed at the wrong repository — the git executor
  // would then refuse on its repo-root check anyway, so make it a real own repo.
  if (!existsSync(join(sandbox, '.git'))) {
    const g = nodeGitRunner();
    g.run(['init'], sandbox);
    g.run(['config', 'user.email', 'owner@zeno.local'], sandbox);
    g.run(['config', 'user.name', 'Zeno Owner'], sandbox);
    // A HEAD must exist for `git worktree add` (Forge) to work, so seed an empty
    // root commit. It carries nothing — the sandbox's real history starts after.
    g.run(['commit', '--allow-empty', '-m', 'zeno: sandbox initialised'], sandbox);
  }
  const publicDir = resolvePublicDir();

  const fs = nodeSandboxFs();
  const world = nodeWorld(fs);
  const policy = readPolicyFile(join(dir, 'policy.json')) ?? DEFAULT_POLICY;
  const receiptSigner = loadOrCreateSigner(join(dir, 'keys'));
  const kernel = new Kernel(world, { store: nodeLedgerStore(join(dir, 'ledger.jsonl')), policy, receiptSigner });

  const tokens = mintTokens();
  const stream = new Stream();
  // A misconfigured ZENO_GITHUB_REPO throws here, before the socket opens: a
  // daemon that runs while quietly never consulting a source you configured is
  // worse than one that refuses to start and tells you which variable is wrong.
  const remote = githubFromEnv(process.env);
  const work = nodeWorkDesk(dir, remote);
  const heldStore = nodeHeldStore(join(dir, 'pending.jsonl'));
  const vault = new Vault(nodeNoteStore(join(dir, 'memory')), nodeClock());
  // Past calls live beside the memory, as one readable Markdown file each. A
  // missing directory is an empty archive, so a first run needs no setup.
  const meetings = new Meetings(nodeMeetingStore(join(dir, 'meetings')));
  const launchNonce = randomBytes(18).toString('hex');
  // `workspace` is passed so a 401 can name the exact proposer.token file the
  // caller should have read, instead of telling them the daemon printed it.
  // Whether a governed Forge run may be handed the network-egress tools at all.
  //
  // OFF unless the owner names it, in the same shape as every other outbound
  // path here: `ZENO_GITHUB_REPO` is how GitHub gets asked, and this is how
  // WebFetch and WebSearch get to exist. Turning it on does not GRANT anything —
  // every call is still a capsule — it decides whether the tools are on the
  // command line. See the README's "what can reach the internet".
  const forgeNetwork = /^(1|true|on|yes)$/i.test((process.env['ZENO_FORGE_NETWORK'] ?? '').trim());

  const server = createServer({ kernel, sandbox, workspace: dir, fs, tokens, stream, publicDir, work, heldStore, vault, meetings, launchNonce, forgeNetwork });

  // The proposer token is a LIVE credential. Printing it to stdout put it in
  // shell scrollback and — when stdout is redirected to a file — on disk in
  // cleartext. Write it to a single gitignored file the owner reads on demand
  // instead; `zeno propose` picks it up from here automatically. (SAN-AC-06.)
  const tokenPath = join(dir, 'proposer.token');
  mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath, tokens.proposer + '\n', { encoding: 'utf8', mode: 0o600 });

  // A second copy of Zeno is a normal thing to do by accident — double-clicking
  // the launcher twice. Say so in one plain sentence and point at the window that
  // is already running, instead of throwing a Node stack trace at the owner.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `
  Zeno is already running on port ${PORT}.
` +
          `  Open the window that is already open, or close it and start again.
` +
          `  (To run a second copy on another port: set ZENO_PORT=7318 first.)

`,
      );
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`
  ${err.message}

`);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    const out = (s: string): void => {
      process.stdout.write(s + '\n');
    };
    out('');
    out('  ZENO — reason before action');
    out('  ' + '-'.repeat(26));
    out(`     window     http://${HOST}:${PORT}/?k=${launchNonce}`);
    out('                (open THIS url — the ?k= is what authorises approvals; a plain visit is read-only)');
    out(`     workspace  ${dir}`);
    out(`     policy     ${policy === DEFAULT_POLICY ? 'built-in default' : 'policy.json'} · ${policyHash(policy).slice(0, 12)}`);
    out(`     receipts   ${kernel.receipts().length} on record · chain ${kernel.verifyChain().ok ? 'verified' : 'BROKEN'} · signed (Ed25519)`);
    out(
      `     work       local backlog${
        remote === null ? ' only · set ZENO_GITHUB_REPO="owner/repo" to add GitHub' : ` + ${remote.name}`
      }`,
    );
    // An unreadable meeting file is said out loud on startup. A corrupt recording
    // of the owner's own call is not something to discover silently three weeks
    // later, and "no meetings" and "a broken meeting" are different facts.
    const broken = meetings.failed().length;
    const noFolder = meetings.unreadable();
    out(
      noFolder === null
        ? `     meetings   ${meetings.size()} recorded${broken === 0 ? '' : ` · ${broken} UNREADABLE (listed in the Counsel tab)`}`
        : // Not "0 recorded". The folder was never read, so how many calls are in
          // it is unknown — and printing a zero here would be the startup banner
          // telling the owner their meetings do not exist.
          `     meetings   FOLDER UNREADABLE — ${noFolder}`,
    );
    out('');
    out('     The window already holds the owner token. To propose from an agent,');
    out('     use the PROPOSER token — it can ask for anything and approve nothing.');
    out('     It is NOT printed here (a live credential does not belong in a log); it is in:');
    out('');
    out(`       ${tokenPath}`);
    out('');
    out('     Propose from a second terminal — the CLI reads that file for you:');
    out(`       npm run propose -- --rel src/App.tsx --summary "scaffold the App shell" --contents "export const App = () => null;"`);
    out('');
    // The daemon no longer opens anything. The desktop app (packages/desktop)
    // is the window and owns this process's lifetime; `npm run up` is the
    // headless path, where printing the URL is the honest thing to do. Spawning
    // a browser from here was the old Edge-wrapper route and is deliberately gone.
  });
}

try {
  main();
} catch (err) {
  if (err instanceof PolicyError) {
    process.stderr.write(`\n  ${err.name}: ${err.message}\n  fix: ${err.resolve}\n\n`);
  } else {
    process.stderr.write(`\n  ${String(err)}\n\n`);
  }
  process.exitCode = 1;
}
