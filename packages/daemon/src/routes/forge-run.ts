/**
 * THE one path a governed coding agent run takes, whoever asked for it — the
 * Forge button, or a delegation from Ask Zeno or a spoken sentence.
 *
 * It is one function (`performRun`) on purpose. The governance story of a run
 * lives in what happens to its OUTPUT: the agent edits an isolated throwaway
 * worktree, and every file it touched is turned into an ordinary approval
 * capsule against the sandbox by `proposeFileWrite` — the same gate a
 * hand-typed proposal goes through. A second copy of this loop is how a
 * "convenience" path eventually grows one that writes to the sandbox
 * directly, so there is not one.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { jail } from '@abheet19/zeno-kernel';
import {
  createWorktree,
  diffFiles,
  gateEnv,
  gateMcpConfig,
  GATE_UNPROVEN_NOTE,
  nodeGateProber,
  nodeSpawner,
  runAgent,
} from '@abheet19/zeno-forge';
import { ForgeRunProgressReporter, finalForgeTokenUsage } from '../forge-run-progress.js';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { FORGE_RUN_ID } from './forge-prompt.js';
import { runLocalModel } from './forge-local-model.js';
import { readForgeProposalCandidate, type ForgeProposalCandidate, type ForgeProposalSkipReason } from './forge-text.js';
import {
  closeBrowseRun,
  closeChromeRun,
  closeGateRun,
  gateUrl,
  openBrowseRun,
  openChromeRun,
  openGateRun,
} from './forge-gate.js';
import { proposeFileWrite } from './approvals.js';

/**
 * Thrown when the throwaway worktree could not be made — so the agent never ran.
 *
 * Its own type, at module scope, because two callers need to tell it apart from
 * a failure INSIDE a run: `/forge/run` turns it into a 409 carrying git's
 * reason, and a delegation reports a NON-start with that reason rather than a
 * start with nothing to show.
 */
export class WorktreeUnavailable extends Error {}

/** One file the agent wrote, as it now waits in the approval queue. */
export interface ProposedChange {
  readonly path: string;
  readonly actionHash: string;
  readonly tier: string;
  readonly auto: boolean;
}

/** A changed worktree path that deliberately did not become a write capsule. */
interface SkippedForgeChange {
  readonly path: string;
  readonly reason: ForgeProposalSkipReason;
  readonly note: string;
}

/** Everything one run produced. Every `proposed` entry is a capsule awaiting a click. */
export interface RunOutcome {
  readonly runId: string;
  readonly run: {
    readonly ok: boolean;
    readonly cancelled: boolean;
    readonly agentId: string;
    readonly model: string | null;
    readonly effort: string | null;
    readonly log: string;
    readonly note: string | null;
    /** Final measured Ollama usage. Hosted CLIs do not expose this yet. */
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
  };
  readonly changed: readonly string[];
  readonly proposed: readonly ProposedChange[];
  readonly skipped: readonly SkippedForgeChange[];
}

export async function performRun(
  ctx: ServerCtx,
  task: string,
  agentId: string,
  model: string | undefined,
  effort: 'low' | 'medium' | 'high' | undefined,
  progress: ForgeRunProgressReporter,
  requestedRunId?: string,
  signal?: AbortSignal,
  ownerTask = task,
  forceAnswerOnly = false,
): Promise<RunOutcome> {
  const runId = requestedRunId ?? `run-${ctx.opts.kernel.receipts().length}-${Date.now().toString(36)}-${randomUUID()}`;
  let tree;
  try {
    tree = createWorktree(ctx.opts.sandbox, runId, ctx.gitRunner);
  } catch (err) {
    throw new WorktreeUnavailable((err as Error).message);
  }
  // The gate for THIS run. Its presence is what widens the agent's tool
  // surface past the file-only grant — the two move together by construction,
  // so there is no state in which the tools are wide and the gate is absent.
  // A daemon whose own address cannot be read hands over neither.
  const usesForgeGate = agentId === 'claude-code';
  const url = usesForgeGate && ctx.opts.forgeShell !== false ? gateUrl(ctx) : null;
  let wiring = url === null ? null : openGateRun(ctx, runId);
  // …and its presence is not taken on trust. Everything between this process
  // and the CLI's permission machinery — the bridge starting, the handshake,
  // the tool being registered under the name the CLI resolves — is outside
  // this repository and can break silently, and the silent break grants Bash.
  // So the gate answers a question before the agent is started, and a gate
  // that cannot answer costs the run its shell rather than costing the owner
  // the guarantee. `gateNote` is what the run then says out loud.
  let gateNote: string | null = agentId === 'codex'
    ? 'Codex ran in the isolated worktree with its auto-reviewed workspace-write mode; ambient Codex configuration, web search, and MCP connectors were disabled. The installed Codex CLI may still discover global Agent Skills, which remain visible in its run log. Files still pass through Zeno’s proposal gate before they reach this repository.'
    : null;
  if (url !== null && wiring !== null) {
    const prober = ctx.opts.gateProber ?? nodeGateProber();
    let proof;
    try {
      proof = await prober.prove(gateEnv(url, wiring.token, runId));
    } catch (err) {
      // A prober is not supposed to throw. If one does, that is exactly the
      // unproven case — never a reason to fall through into a wide surface.
      proof = { live: false, note: `the gate proof itself failed — ${(err as Error).message}` };
    }
    if (!proof.live) {
      closeGateRun(ctx, runId);
      wiring = null;
      gateNote = `${GATE_UNPROVEN_NOTE} (${proof.note})`;
    }
  }
  // And the browser, on exactly the same terms and in the same order: prove it
  // BEFORE the agent is started, and publish nothing that was not proved. A
  // run with no gate never reaches this — a browser without the permission
  // host would be a navigation nobody was asked about.
  let browserGranted = false;
  let browserNote: string | null = null;
  if (wiring !== null) {
    const browser = await openBrowseRun(ctx, runId);
    browserGranted = browser.granted;
    browserNote = browser.note;
  }
  // And the owner's OWN Chrome, on the same terms and in the same order: the
  // extension in their browser must answer BEFORE the agent is started, and a
  // run with no gate never reaches this. Unlike the sandboxed window it does
  // not ride on `forgeNetwork` - see `GateWiring.chrome` for why acting as the
  // owner and fetching a URL are two different questions with two switches.
  let chromeGranted = false;
  let chromeNote: string | null = null;
  if (wiring !== null) {
    const asOwner = await openChromeRun(ctx, runId);
    chromeGranted = asOwner.granted;
    chromeNote = asOwner.note;
  }
  progress.providerRunning();
  try {
    const result = agentId === 'local'
      ? await runLocalModel(ctx, tree.path, task, model, effort, signal, ownerTask, forceAnswerOnly)
      : await runAgent(
          {
            agentId,
            task,
            worktree: tree.path,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(signal ? { signal } : {}),
            ...(wiring && url
              ? {
                  gate: {
                    // Built HERE, after both proofs, so the MCP config the CLI
                    // is handed can never declare a server this run did not
                    // demonstrate. The tool list and the server list come from
                    // the same two booleans by construction.
                    mcpConfig: gateMcpConfig({ browser: browserGranted, chrome: chromeGranted }),
                    network: ctx.opts.forgeNetwork === true,
                    browser: browserGranted,
                    chrome: chromeGranted,
                  },
                  env: gateEnv(url, wiring.token, runId),
                }
              : {}),
          },
          nodeSpawner(),
        );
    const tokenUsage = finalForgeTokenUsage(
      result.agentId,
      'tokensIn' in result ? result.tokensIn : null,
      'tokensOut' in result ? result.tokensOut : null,
    );
    progress.providerFinished(
      tokenUsage.status === 'measured' ? tokenUsage.input : null,
      tokenUsage.status === 'measured' ? tokenUsage.output : null,
    );
    // ALWAYS ask git what is in the worktree — never `result.ok ? … : []`.
    //
    // That conditional destroyed real work and then said nothing had happened.
    // An agent that edits three files and THEN exits non-zero — an API error,
    // a rate limit, a crash after the writes — is the ordinary case, not an
    // exotic one, and `runner.ts` already says what to do with it: "we could
    // still read what it left behind — hand the changeset to the gate anyway,
    // but say the run did not succeed." This function threw those files away,
    // reported `changed: []`, and then deleted the worktree in the `finally`
    // below, so the window told the owner "No changes were proposed" about a
    // run that had proposed several and lost them irrecoverably.
    //
    // `diffFiles` is a read-only git status of the worktree, so this invents
    // nothing: a run that truly changed nothing still reports nothing. What
    // changed is that a failed run no longer has its output silently deleted.
    // The failure itself is not hidden — `run.ok` and `run.note` travel in the
    // same response and the surfaces render them.
    const changed = diffFiles(tree.path, ctx.gitRunner);
    progress.changesInspected();
    const proposed: ProposedChange[] = [];
    const skipped: SkippedForgeChange[] = [];
    for (const rel of changed) {
      let candidate: ForgeProposalCandidate;
      try {
        candidate = readForgeProposalCandidate(jail(ctx.forgeFs, tree.path, rel));
      } catch {
        candidate = {
          ok: false,
          reason: 'unreadable',
          note: 'the changed path could not be resolved inside the isolated worktree; no proposal was created',
          bytes: null,
        };
      }
      if (!candidate.ok) {
        skipped.push({ path: rel, reason: candidate.reason, note: candidate.note });
        continue;
      }
      // A held proposal's summary is the ONE line the owner decides from, so it
      // must name the EFFECT. Leading with the task text meant a run whose
      // `ownerTask` carried the composed prompt produced a summary that read
      // "Forge (local): PROJECT RULES FROM THE SELECTED REPOSITORY follow. Apply
      // the" — a system-prompt fragment presented as a description of a file
      // write. The path is what is being changed; the task is context after it.
      const why = ownerTask.replace(/\s+/g, ' ').trim().slice(0, 48);
      const out = await proposeFileWrite(
        ctx,
        rel,
        candidate.contents,
        `Forge (${result.agentId}): write ${rel}${why ? ` — ${why}` : ''}`,
        `forge:${result.agentId}`,
      );
      const pv = out['preview'] as { actionHash: string; tier: string; auto: boolean };
      proposed.push({ path: rel, actionHash: pv.actionHash, tier: pv.tier, auto: pv.auto });
    }
    // A narrowed run says so FIRST, ahead of whatever else it has to report.
    // The owner asked for a governed agent and got a file-only one; that is
    // the most important true thing about the run, and burying it under "the
    // CLI exited 1" is how a missing gate goes unnoticed.
    const skippedNote = skipped.length === 0
      ? null
      : `${skipped.length} changed file${skipped.length === 1 ? ' was' : 's were'} explicitly skipped and no approval capsule was created: ${skipped.map((item) => `${item.path} (${item.reason}: ${item.note})`).join('; ')}`;
    const note = [gateNote, browserNote, chromeNote, result.note, skippedNote].filter((n): n is string => typeof n === 'string' && n !== '').join(' ');
    const tokensIn = tokenUsage.status === 'measured' ? tokenUsage.input : null;
    const tokensOut = tokenUsage.status === 'measured' ? tokenUsage.output : null;
    progress.finish(result.cancelled === true ? 'cancelled' : result.ok ? 'completed' : 'failed');
    return {
      runId,
      run: {
        ok: result.ok,
        cancelled: result.cancelled === true,
        agentId: result.agentId,
        model: result.model,
        effort: result.effort ?? null,
        log: result.log,
        note: note === '' ? null : note,
        tokensIn,
        tokensOut,
      },
      changed,
      proposed,
      skipped,
    };
  } finally {
    // The credential dies with the run, and so does anything still waiting on
    // it: an approval for a command with nothing left to run it is not an
    // approval anybody should still be able to click.
    closeGateRun(ctx, runId);
    // The window dies with the run too. A browser outliving its run would be a
    // page left open, logged in, with nothing left to account for what it did.
    closeBrowseRun(ctx, runId);
    // The grant on the owner's own browser dies with the run too. The browser
    // does not - it is theirs - but nothing is left able to act in it.
    closeChromeRun(ctx, runId);
    try { tree.cleanup(); } catch { /* best effort */ }
  }
}

export async function postForgeCancel(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  if (role !== 'owner') {
    return json(res, 403, { error: { code: 'owner-only', message: 'Only the owner can cancel an agent.', resolve: 'Cancel it from the Zeno window.' } });
  }
  const body = await readJson(req);
  const runId = str(body, 'runId')?.trim() ?? '';
  if (!FORGE_RUN_ID.test(runId)) {
    return json(res, 400, { error: { code: 'bad-run-id', message: 'Cancellation needs a valid run id.', resolve: 'Use the runId returned for the active Forge session.' } });
  }
  const controller = ctx.activeForgeRuns.get(runId);
  if (controller === undefined) {
    return json(res, 200, { cancelled: false, runId, note: 'That run is no longer active.' });
  }
  controller.abort();
  return json(res, 200, { cancelled: true, runId });
}

/**
 * The model a local run gets when nobody named one.
 *
 * Prefers the default the rest of this file already uses when it is installed,
 * and otherwise takes the first model Ollama actually reports — never a name
 * that is not pulled, because that would be a run that fails on a
 * "model not found" the owner cannot see coming.
 */
export function pickLocalModel(installed: readonly string[]): string | null {
  if (installed.length === 0) return null;
  const preferred = installed.find((m) => m === 'qwen3:8b')
    ?? installed.find((m) => m.startsWith('qwen3:'));
  return preferred ?? installed[0] ?? null;
}
