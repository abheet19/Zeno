#!/usr/bin/env node
/**
 * `zeno` — the command line for the kernel.
 *
 *   zeno demo    [--dir <path>] [--resume]   run both canonical journeys
 *   zeno verify  [--dir <path>]              verify the receipt chain on disk
 *   zeno backlog add|list|close              the work you own, on your own disk
 *
 * Exit code 0 means the thing it claims happened, happened. Anything else is 1,
 * so every command is usable as a check.
 *
 * WHICH WORKSPACE, AND WHICH DAEMON. The daemon selects both from the
 * environment: `ZENO_DIR` picks the workspace, `ZENO_PORT` picks the socket.
 * This CLI reads THE SAME TWO VARIABLES, and it must keep doing so.
 *
 * It did not, and that was a silent lie rather than an inconvenience. With
 * `ZENO_DIR=.zeno-sweep` — the very thing you must set when a second Zeno is
 * running, so two daemons never fork one hash chain — `zeno verify` read
 * `./.zeno` instead and printed "VERIFIED — 0 receipts, every link intact and
 * every signature valid" about a workspace it had never opened, while the real
 * ledger sat unexamined two directories away. A verifier that reports a clean
 * chain for a ledger it did not read is worse than no verifier: it is the one
 * command in this product whose whole job is to be believed. `zeno propose` had
 * the same fault from the other end — it posted to :7317 no matter which port
 * the daemon had announced, so the token it had just read out of the right
 * workspace was presented to the wrong daemon and came back 401.
 *
 * A flag still wins over the environment, and the environment over the default,
 * so an explicit `--dir`/`--url` continues to mean exactly what it says.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeId } from '@abheet19/zeno-intake';
import { backlogView, openBacklog, renderAdded, renderBacklog, renderClosed } from './backlog.js';
import { demoProblems, runDemo } from './demo.js';
import { propose, proveCannotApprove } from './propose.js';
import { renderVerify, verifyLedger } from './verify.js';

const USAGE = `
  zeno — reason before action

    zeno demo     [--dir <path>] [--resume]  run both canonical journeys
    zeno verify   [--dir <path>]             verify the receipt chain on disk
    zeno propose  --token <proposer token>   propose a change to a running daemon

    zeno backlog add "<title>" [--body ...] [--label x]   a work item has arrived
    zeno backlog list [--all]                             what is waiting
    zeno backlog close <id>                               mark one done

  --dir       Zeno's working directory (default: $ZENO_DIR, else ./.zeno)
  --resume    keep the existing ledger instead of starting clean
  --token     the PROPOSER token, read for you from <dir>/proposer.token.
              It is deliberately NOT printed on startup — a live credential
              does not belong in shell scrollback or a redirected log.
  --url       daemon address (default: http://127.0.0.1:$ZENO_PORT, else :7317)
  --rel       path inside the sandbox (default: src/Proposed.tsx)
  --summary   the one sentence the owner will read
  --prove     also point the same token at /approvals, to watch it be refused
  --body      detail for a backlog item
  --label     tag a backlog item; repeat for several
  --all       include closed items in the backlog listing
`;

/** Flags that consume the token after them, so a positional is never one of them. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--dir',
  '--body',
  '--label',
  '--token',
  '--url',
  '--rel',
  '--summary',
  '--contents',
]);

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Every occurrence, so `--label a --label b` gives both rather than the first. */
function flagValues(args: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (value !== undefined && !value.startsWith('--')) out.push(value);
  }
  return out;
}

/**
 * The bare words, with flags and their values removed. Without this,
 * `zeno backlog close --dir D:\x 3` would try to close an item called "--dir".
 */
function positionals(args: readonly string[]): string[] {
  const out: string[] = [];
  let skip = false;
  for (const arg of args) {
    if (skip) {
      skip = false;
      continue;
    }
    if (arg.startsWith('--')) {
      skip = VALUE_FLAGS.has(arg);
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * The workspace this invocation means: the flag, else the environment the
 * daemon itself reads, else the default. Kept identical to `main.ts` in the
 * daemon (`process.env['ZENO_DIR'] ?? '.zeno'`) so the two halves of one
 * product can never disagree about which ledger is "the" ledger.
 */
function workspaceDir(args: readonly string[]): string {
  const env = process.env['ZENO_DIR'];
  return resolve(flagValue(args, '--dir') ?? (env !== undefined && env !== '' ? env : '.zeno'));
}

/**
 * The daemon this invocation talks to. `ZENO_PORT` is the daemon's own knob for
 * the socket, so honouring it here is what stops the CLI posting a token minted
 * by one daemon to a different one that never issued it.
 */
function daemonUrl(args: readonly string[]): string {
  const flag = flagValue(args, '--url');
  if (flag !== undefined) return flag;
  const env = process.env['ZENO_PORT'];
  const port = env !== undefined && /^\d+$/.test(env) ? env : '7317';
  return `http://127.0.0.1:${port}`;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];
  const dir = workspaceDir(args);
  const log = (s: string): void => {
    process.stdout.write(s + '\n');
  };

  switch (command) {
    case 'demo': {
      const result = await runDemo({ dir, resume: args.includes('--resume'), log });
      const problems = demoProblems(result);
      if (problems.length > 0) {
        log('  DEMO FAILED ITS OWN CHECKS:');
        for (const p of problems) log(`     - ${p}`);
        log('');
        return 1;
      }
      return 0;
    }
    case 'propose': {
      const tokenFile = () => {
        try { return readFileSync(join(dir, 'proposer.token'), 'utf8').trim() || undefined; }
        catch { return undefined; }
      };
      // `??` alone let an EMPTY `--token`, `ZENO_TOKEN=` or blank token file
      // count as a credential: the CLI then posted an empty `x-zeno-token`
      // header and reported the daemon's 401 as though a real token had been
      // rejected, instead of saying it never had one. Blank is absent.
      const some = (v: string | undefined): string | undefined => (v !== undefined && v.trim() !== '' ? v.trim() : undefined);
      const token = some(flagValue(args, '--token')) ?? some(process.env['ZENO_TOKEN']) ?? tokenFile();
      if (token === undefined) {
        log('  zeno propose needs the PROPOSER token.');
        log(`  It is read automatically from ${join(dir, 'proposer.token')} while a daemon`);
        log('  owns that workspace — name the path, so a wrong ZENO_DIR is visible here');
        log('  rather than three steps later as a 401 from some other daemon.');
        log('  Or pass --token <value> / set ZENO_TOKEN.');
        return 1;
      }
      const relPath = flagValue(args, '--rel') ?? 'src/Proposed.tsx';
      const summary = flagValue(args, '--summary') ?? `rewrite ${relPath} from an agent`;
      const url = daemonUrl(args);
      const contents =
        flagValue(args, '--contents') ??
        `// proposed by an agent, approved by nobody yet
export const Proposed = () => null;
`;
      const result = await propose({ url, token, relPath, contents, summary, requestedBy: 'agent', log });
      if (args.includes('--prove') && result.status === 200) {
        const hash = (result.body as { preview: { actionHash: string } }).preview.actionHash;
        const code = await proveCannotApprove(url, token, hash, log);
        log('');
        return code === 403 ? 0 : 1;
      }
      return result.status === 200 ? 0 : 1;
    }
    case 'verify': {
      const result = verifyLedger(dir);
      renderVerify(result, log);
      return result.ok ? 0 : 1;
    }
    case 'backlog': {
      // Opening READS the file, so an unreadable backlog throws here and is
      // printed by the handler below with its path — never mistaken for empty.
      const opened = openBacklog(dir);
      const words = positionals(args);
      switch (words[1]) {
        case 'add': {
          const title = words[2];
          if (title === undefined || title.trim() === '') {
            log('  zeno backlog add needs a title:  zeno backlog add "what needs doing"');
            return 1;
          }
          renderAdded(
            opened.backlog.add(title, flagValue(args, '--body') ?? '', flagValues(args, '--label')),
            opened.path,
            log,
          );
          return 0;
        }
        case 'list':
          renderBacklog(backlogView(opened, args.includes('--all')), log);
          return 0;
        case 'close': {
          const id = words[2];
          if (id === undefined) {
            log('  zeno backlog close needs an id:  zeno backlog close local:3');
            return 1;
          }
          const before = opened.backlog.get(id);
          if (before === null) {
            log(`  no backlog item ${normalizeId(id)}.`);
            log('  zeno backlog list  shows what there is.');
            return 1;
          }
          renderClosed(opened.backlog.close(id), before.state === 'closed', log);
          return 0;
        }
        default:
          log(`  unknown backlog command ${JSON.stringify(words[1] ?? '')} — try add, list or close.`);
          log(USAGE);
          return 1;
      }
    }
    case 'help':
    case '--help':
    case undefined:
      log(USAGE);
      return command === undefined ? 1 : 0;
    default:
      log(`  unknown command "${command}"`);
      log(USAGE);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // A thrown PolicyError is a legible refusal, not a crash — print it as one.
    const e = err as { name?: string; message?: string; resolve?: string };
    process.stderr.write(`\n  ${e.name ?? 'Error'}: ${e.message ?? String(err)}\n`);
    if (e.resolve) process.stderr.write(`  fix: ${e.resolve}\n`);
    process.stderr.write('\n');
    process.exitCode = 1;
  },
);
