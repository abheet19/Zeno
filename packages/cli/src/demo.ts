/**
 * The two canonical journeys, end to end, against real files on disk.
 *
 *   1. An agent proposes a change -> you approve -> the file really changes ->
 *      a receipt proves it.
 *   2. An agent proposes a change -> you approve -> the world moves underneath
 *      the approval -> it REFUSES rather than clobbering, and the file is
 *      untouched.
 *
 * This is the whole governance argument in ninety seconds. It is also the smoke
 * test for every executor added later, so it asserts its own invariants rather
 * than merely printing them.
 */
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  DEFAULT_POLICY,
  Kernel,
  jail,
  makeWritePayload,
  nodeLedgerFiles,
  nodeLedgerStore,
  nodeSandboxFs,
  policyHash,
  readPolicyFile,
  worktreeExecutor,
  type ActionRequest,
  type Binding,
  type Executor,
  type Receipt,
} from '@abheet19/zeno-kernel';
import { nodeWorld } from './world.js';

const EDITOR_BEFORE = `export function insert(html: string) {
  range.insertNode(parse(html));
}
`;
const EDITOR_AFTER = `export function insert(html: string) {
  // single blocks must be wrapped or Docs collapses the paragraph
  range.insertNode(parse(wrapIfSingleBlock(html)));
}
`;
const TOOLBAR_BEFORE = `export const Toolbar = () => <div className="zeno-toolbar" />;
`;
const TOOLBAR_AFTER = `export const Toolbar = () => <div className="zeno-toolbar" role="toolbar" />;
`;
const TOOLBAR_TEAMMATE = `export const Toolbar = () => <div className="zeno-toolbar" aria-label="Zeno" />;
`;

export interface DemoResult {
  readonly verified: Receipt;
  readonly refused: Receipt;
  /** Contents of the drift target after the refusal — must be the teammate's edit. */
  readonly driftTargetContents: string | null;
  /** How many times the executor was invoked during the refused journey. */
  readonly refusedExecutorCalls: number;
  readonly chain: { ok: boolean; firstBreakAt?: number };
  readonly ledgerPath: string;
  readonly priorReceipts: number;
}

export interface DemoOptions {
  /** Zeno's working directory — holds ledger.jsonl, policy.json and sandbox/. */
  readonly dir: string;
  /** Keep the existing ledger instead of starting clean (shows persistence). */
  readonly resume: boolean;
  readonly log: (line: string) => void;
}

/** Count executor invocations, so "it never ran" is asserted, not assumed. */
function counting(exec: Executor): Executor & { calls: () => number } {
  let n = 0;
  const fn = async (bound: Binding) => {
    n++;
    return exec(bound);
  };
  return Object.assign(fn, { calls: () => n });
}

export async function runDemo(opts: DemoOptions): Promise<DemoResult> {
  const { dir, resume, log } = opts;
  const ledgerPath = join(dir, 'ledger.jsonl');
  const sandbox = join(dir, 'sandbox');

  // Start clean unless resuming. Only these two named paths are ever removed.
  if (!resume) {
    for (const f of nodeLedgerFiles(ledgerPath)) rmSync(f, { force: true });
    rmSync(sandbox, { recursive: true, force: true });
  }

  const fs = nodeSandboxFs();
  const world = nodeWorld(fs);
  const policy = readPolicyFile(join(dir, 'policy.json')) ?? DEFAULT_POLICY;
  const fromFile = policy !== DEFAULT_POLICY;
  const kernel = new Kernel(world, { store: nodeLedgerStore(ledgerPath), policy });
  const priorReceipts = kernel.receipts().length;

  /** Paths inside the workspace read best relative to it... */
  const rel = (p: string) => relative(dir, p).replace(/\\/g, '/');
  /** ...but a path you are told to go and open must be relative to where you are. */
  const fromCwd = (p: string) => relative(process.cwd(), p).replace(/\\/g, '/') || p;

  log('');
  log(head('ZENO — the gate, end to end'));
  log(kv('workspace', dir));
  log(kv('ledger', `${fromCwd(ledgerPath)}  ${resume ? `(resumed, ${priorReceipts} prior receipts)` : '(fresh)'}`));
  log(kv('policy', `${fromFile ? 'policy.json' : 'built-in default'} · ${policyHash(policy).slice(0, 12)}`));

  // ── Journey 1 ────────────────────────────────────────────────────────────
  log('');
  log(step('1', 'AN AGENT PROPOSES A CHANGE'));
  const relPath = 'src/Editor.tsx';
  const abs = jail(fs, sandbox, relPath);
  fs.writeAtomic(abs, EDITOR_BEFORE);
  // Each run proposes a genuinely NEW edit. Re-proposing a byte-identical action
  // would be correctly refused — the ledger remembers that it already had its one
  // attempt — which is the law working, but a confusing thing to demo.
  const run = Math.floor(priorReceipts / 2) + 1;
  const editorAfter = EDITOR_AFTER.replace('the paragraph', `the paragraph (run ${run})`);
  const payload = makeWritePayload(relPath, EDITOR_BEFORE, editorAfter);
  const req: ActionRequest = {
    kind: 'patch.task',
    summary: `wrap a single block before inserting, so Docs keeps the paragraph (run ${run})`,
    targetRef: abs,
    payload,
    baseHash: payload.expectBaseHash,
    requestedBy: 'work-agent',
    dataZones: ['personal'],
  };

  const preview = kernel.preview(req);
  log(kv('summary', req.summary));
  log(kv('target', rel(abs)));
  log(kv('tier', `${preview.tier}   ${preview.reasons.join(' · ')}`));
  log(kv('action', `${preview.actionHash.slice(0, 16)}…  (payload + base + target + tier + provenance)`));
  log(kv('needs', preview.auto ? 'nothing — T0 runs in the sandbox' : 'YOUR approval — no agent can grant this'));

  log('');
  log(step('2', 'YOU APPROVE — AND THE FILE REALLY CHANGES'));
  const approval = kernel.approve(preview.actionHash);
  const verified = await kernel.commit(approval, worktreeExecutor({ root: sandbox, fs }, payload));
  log(kv('outcome', `${verified.outcome.toUpperCase()}   effect ${verified.externalEffect.effect.slice(0, 24)}…`));
  log(kv('on disk', changedLine(EDITOR_BEFORE, fs.readFile(abs))));
  log(note('that line was not there a moment ago — the approval became a real edit'));
  log(kv('receipt', `${verified.selfHash.slice(0, 16)}…  prev ${short(verified.prevReceipt)}`));

  // ── Journey 2 ────────────────────────────────────────────────────────────
  log('');
  log(step('3', 'A SECOND CHANGE — BUT THE WORLD MOVES UNDERNEATH IT'));
  const relPath2 = 'src/Toolbar.tsx';
  const abs2 = jail(fs, sandbox, relPath2);
  fs.writeAtomic(abs2, TOOLBAR_BEFORE);
  const toolbarAfter = TOOLBAR_AFTER.replace('role="toolbar"', `role="toolbar" data-run="${run}"`);
  const payload2 = makeWritePayload(relPath2, TOOLBAR_BEFORE, toolbarAfter);
  const req2: ActionRequest = {
    kind: 'patch.task',
    summary: `add an ARIA role to the toolbar (run ${run})`,
    targetRef: abs2,
    payload: payload2,
    baseHash: payload2.expectBaseHash,
    requestedBy: 'work-agent',
    dataZones: ['personal'],
  };
  const preview2 = kernel.preview(req2);
  const approval2 = kernel.approve(preview2.actionHash);
  log(kv('approved', `${preview2.actionHash.slice(0, 16)}…  bound to base ${short(payload2.expectBaseHash)}`));

  // ...and now somebody else edits the very file this approval was bound to.
  fs.writeAtomic(abs2, TOOLBAR_TEAMMATE);
  log(kv('meanwhile', 'someone else edits that exact file'));

  log('');
  log(step('4', 'IT REFUSES RATHER THAN CLOBBERING'));
  const exec2 = counting(worktreeExecutor({ root: sandbox, fs }, payload2));
  const refused = await kernel.commit(approval2, exec2);
  log(kv('outcome', refused.outcome.toUpperCase()));
  log(kv('why', refused.reason ?? ''));
  log(kv('executor', `invoked ${exec2.calls()} times — the effect never happened`));
  log(kv('on disk', changedLine(TOOLBAR_BEFORE, fs.readFile(abs2))));
  log(note("that is the OTHER person's edit, intact — ours was never applied"));

  // ── The chain ────────────────────────────────────────────────────────────
  log('');
  log(step('5', 'THE RECEIPT CHAIN'));
  const chain = kernel.verifyChain();
  for (const [i, r] of kernel.receipts().entries()) {
    log(
      `     ${String(i).padStart(2)}  ${r.outcome.padEnd(15)} ${String(r.tier ?? '--').padEnd(3)} ` +
        `${r.selfHash.slice(0, 10)}  ${r.summary ?? '(v1 receipt)'}`,
    );
  }
  log('');
  log(kv('chain', chain.ok ? `VERIFIED — ${kernel.receipts().length} receipts, every link intact` : `BROKEN at index ${chain.firstBreakAt}`));
  log('');
  log(`  Now try tampering with the audit log:`);
  log(`     open ${fromCwd(ledgerPath)}, change one character, then run:  npm run ledger:verify`);
  log('');

  return {
    verified,
    refused,
    driftTargetContents: fs.readFile(abs2),
    refusedExecutorCalls: exec2.calls(),
    chain,
    ledgerPath,
    priorReceipts,
  };
}

/** The invariants the demo exists to prove. Returns the problems it found. */
export function demoProblems(r: DemoResult): string[] {
  const bad: string[] = [];
  if (r.verified.outcome !== 'verified') bad.push(`journey 1 produced ${r.verified.outcome}, expected verified`);
  if (r.refused.outcome !== 'refused') bad.push(`journey 2 produced ${r.refused.outcome}, expected refused`);
  if (r.refusedExecutorCalls !== 0) bad.push(`the executor ran ${r.refusedExecutorCalls} times on a refused action`);
  if (r.driftTargetContents !== TOOLBAR_TEAMMATE) bad.push('the drift target was modified — it must be byte-identical');
  if (!r.chain.ok) bad.push(`the receipt chain is broken at index ${r.chain.firstBreakAt}`);
  return bad;
}

// ── tiny presentation helpers ───────────────────────────────────────────────
function head(s: string): string {
  return `  ${s}\n  ${'-'.repeat(s.length)}`;
}
function step(n: string, s: string): string {
  return `  [${n}]  ${s}`;
}
function kv(k: string, v: string): string {
  return `     ${k.padEnd(10)} ${v}`;
}
function short(h: string | null): string {
  return h === null ? '(genesis)' : h.slice(0, 10);
}
function note(s: string): string {
  return `${' '.repeat(16)}${s}`;
}
/** The first line of `current` that differs from `before` — i.e. what changed. */
function changedLine(before: string, current: string | null): string {
  if (current === null) return '(absent)';
  const b = before.split('\n');
  const a = current.split('\n');
  const i = a.findIndex((line, n) => line !== b[n]);
  if (i < 0) return '(byte-identical to the original)';
  const line = (a[i] ?? '').trim();
  return line.length > 62 ? line.slice(0, 62) + '…' : line;
}
