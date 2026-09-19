/**
 * Ask Zeno — the assistant, answering about the owner's OWN Zeno, and now a
 * real conversational agent besides.
 *
 * THE GROUNDED CORE IS UNCHANGED. It is shown a clipped snapshot of real local
 * state and must cite the fact ids it used. `groundReply` then checks every
 * citation against that snapshot, so an invented id or an uncited factual
 * claim is reported as a FAILURE and the prose is handed back flagged rather
 * than rendered as an answer. A confident lie about your own machine is worse
 * than a refusal, so the refusal is the default for THIS kind of question.
 *
 * WHAT IS NEW is what happens once the grounded model has genuinely failed —
 * no fact to cite, and the question was never actionable in the first place —
 * because that used to be a dead end: "I cannot answer that from your Zeno."
 * for a completely ordinary question that had nothing to do with Zeno. Three
 * things now happen, in order, none of them weakening the grounded core:
 *
 *   1. The snapshot's own MEMORY section is no longer just "whatever notes are
 *      newest" — it is the Vault's own keyword recall run against the actual
 *      question, so "what did we decide about X" has a real, cited note to
 *      answer from instead of hoping X happened to be recent.
 *   2. A second, external memory — the owner's own connected NeoSapien account
 *      (see `./neosapien.js`) — is folded in as its own EXTERNAL MEMORY
 *      section, clearly separate from Zeno's own governed Vault.
 *   3. If NEITHER of those, nor the local state, nor an actionable request
 *      (the existing Forge delegation path) answers it, the question may
 *      still be an ordinary one with a real answer — just not about this
 *      Zeno. `askGeneral` tries a SEPARATE, clearly-labelled general reply
 *      rather than end on the same refusal for every non-Zeno question. And
 *      if the question instead names something CURRENT or external no local
 *      model's frozen weights could ever honestly know, it is offered to
 *      Forge — which owns the real isolated browser and every governed MCP
 *      bridge — instead of guessing.
 *
 * It may PROPOSE a file write, which becomes an ordinary approval capsule the
 * owner approves by hand. It may also DELEGATE a job to a coding agent, which
 * produces a stack of those same capsules. It never touches /approvals — L6 is
 * unchanged, and a hosted agent never starts from an answer alone.
 */
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  answerProductQuestion,
  buildAssistantPrompt,
  buildGeneralPrompt,
  buildSnapshot,
  CANNOT_ANSWER,
  cleanGroundedReply,
  describeTruncation,
  fallbackDelegation,
  groundReply,
  needsLiveLookup,
  parseIntent,
  type SnapshotTier,
} from '@abheet19/zeno-assistant';
import type { Role } from '../tokens.js';
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { ensureOllama, installedLocalModels } from './ollama-lifecycle.js';
import { withoutReasoning } from './forge-local-model.js';
import { proposeFileWrite, pruneDriftedHeld } from './approvals.js';
import { resolveDelegation, type Delegated } from './delegate.js';
import { probeAgents } from './delegate-probe.js';
import { searchNeosapienMemories } from './neosapien.js';

/** The model Ask Zeno answers with when the owner has not picked one. */
export const DEFAULT_ASSISTANT_MODEL = 'qwen3:8b';
/** Bound Command latency: a wedged or memory-starved local model must not leave
 * the composer spinning forever. A cold model swap on this pilot machine can
 * legitimately take more than one minute, so a normal turn gets two. */
export const ASSISTANT_MODEL_TIMEOUT_MS = 120_000;
/** Larger local models can spend most of the normal turn budget loading their
 * weights after another model was used. The owner explicitly chose that
 * tradeoff, so give 14B+ models one bounded cold-start window while keeping
 * the responsive default at one minute. */
export const LARGE_ASSISTANT_MODEL_TIMEOUT_MS = 180_000;

export function assistantTurnTimeoutMs(model: string): number {
  const billions = /(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[:_-])/i.exec(model)?.[1];
  return billions !== undefined && Number(billions) >= 14
    ? LARGE_ASSISTANT_MODEL_TIMEOUT_MS
    : ASSISTANT_MODEL_TIMEOUT_MS;
}

/**
 * Product help is part of Zeno's own interface contract, not a general-
 * knowledge question for a local model to improvise. Keep this deliberately
 * narrow so ordinary questions still use the real assistant path below.
 */
export const ZENO_CAPABILITY_HELP = [
  'Zeno has three connected surfaces:',
  '',
  '- Command — chat with a local model, inspect current work, search Vault memory, navigate the app, and review exact approvals and signed receipts.',
  '- Forge — open a Git repository, inspect and edit code, plan and run governed coding tasks, use installed skills and rules, and review every proposed effect before it is applied.',
  '- Counsel — record a meeting only after explicit consent, transcribe it locally when Whisper is available, and create a cited summary and follow-up notes.',
  '',
  'Try “open Forge”, “show approvals”, “what is waiting on me?”, or type / to see available commands.',
].join('\n');

export const ZENO_APPROVAL_KERNEL_HELP = [
  'Zeno’s approval kernel is the local boundary between an agent’s proposal and a real side effect.',
  'An agent can propose an exact action, but it cannot approve that action. Zeno classifies the risk, binds the preview to the action and current base state, and either applies a routine action under policy or holds it for the owner. If the base state changes, the proposal becomes stale and must be proposed again. Every executed result is recorded in the signed receipt chain.',
].join('\n\n');

export function isCapabilityHelpQuestion(question: string): boolean {
  return /^(?:help|what can you do|what does zeno do|show (?:me )?(?:zeno(?:'s)? )?(?:help|capabilities))\s*[?!.]*$/i.test(question.trim());
}

export function isApprovalKernelQuestion(question: string): boolean {
  return /^(?:(?:what|how) (?:is|does)|explain|describe) (?:the )?zeno(?:'s)? approval kernel(?: work)?\s*[?!.]*$/i.test(question.trim());
}

export function isOwnerMemoryQuestion(question: string): boolean {
  return /^(?:what do you know about me|recall my preferences|what are my preferences)\s*[?!.]*$/i.test(question.trim());
}

export function isRepositoryOverviewQuestion(question: string): boolean {
  return /^(?:what(?:'s| is) (?:in|the state of|currently active in) (?:(?:the|this) )?(?:sandbox|forge (?:workspace|project)|workspace)(?: right now)?|what (?:git )?branch is (?:the )?(?:current )?(?:forge )?(?:workspace|project|sandbox) on)\s*[?!.]*$/i.test(question.trim());
}

/**
 * Plain technical concepts are not about the owner's current Zeno state.
 * Keep them off the grounded prompt so a local fact id cannot be presented as
 * evidence for a general answer.
 */
export function isStandaloneConceptQuestion(question: string): boolean {
  const q = question.replace(/\s+/g, ' ').trim();
  if (q === '' || needsLiveLookup(q)) return false;
  if (/\b(?:zeno|forge|counsel|vault|approval|receipt|workspace|sandbox|project|repo(?:sitory)?|branch|memory|device|agent|task|pending|waiting|running|current|today|local state)\b/i.test(q)) return false;
  return /^(?:what (?:is|are)|how (?:does|do)|why (?:does|do))\b/i.test(q) || /\b(?:explain|define)\b/i.test(q);
}

/**
 * The local models this machine can answer with — the same list
 * `GET /forge/agents` shows in the picker. An injected probe (the tests' fixed
 * one) is honoured; otherwise Ollama is asked directly rather than through
 * `probeAgents`, which would also spawn the hosted CLIs' `--version` checks for
 * a question that will never leave this machine.
 */
async function installedModels(ctx: ServerCtx): Promise<readonly string[]> {
  if (ctx.opts.delegateProbe !== undefined) return (await ctx.opts.delegateProbe.available()).localModels;
  return await installedLocalModels(ctx);
}

/**
 * Which local model answers this question, and what to tell the owner about it.
 *
 * An absent `model` is today's behaviour. A named one is used only when Ollama
 * actually lists it: an uninstalled name falls back to the default AND says so
 * in the reply, because an answer silently produced by a different model than
 * the one on the picker would be a small lie about the owner's own machine.
 * Whatever is chosen only ever goes into the loopback Ollama request — this
 * field cannot route a question anywhere else.
 */
export async function resolveAssistantModel(
  ctx: ServerCtx,
  requested: string | undefined,
): Promise<{ readonly modelUsed: string; readonly note: string | null }> {
  if (requested === undefined) return { modelUsed: DEFAULT_ASSISTANT_MODEL, note: null };
  const installed = await installedModels(ctx);
  if (installed.includes(requested)) return { modelUsed: requested, note: null };
  return {
    modelUsed: DEFAULT_ASSISTANT_MODEL,
    note: `model ${requested} is not installed; answered with ${DEFAULT_ASSISTANT_MODEL}`,
  };
}

/**
 * The recalled-first, recent-second Vault memory Ask Zeno is shown.
 *
 * The bug this fixes: the snapshot used to pass only the 12 MOST RECENT notes,
 * with the question never consulted at all — so "what did we decide about the
 * release checklist" answered from whatever happened to be newest, and a real,
 * relevant note written weeks ago had no way to be cited. `vault.recall` is the
 * Vault's own keyword scorer (see `@abheet19/zeno-vault`'s `vault.ts`); running
 * it against the OWNER's actual question is what makes a memory question
 * answerable at all. Recency still matters — it is why the recalled notes are
 * merged ahead of the plain recent ones rather than replacing them — so a
 * question with no keyword match still sees what the owner saved most recently.
 */
function recalledMemory(ctx: ServerCtx, question: string): readonly { id: string; title: string; body: string }[] {
  const vault = ctx.opts.vault;
  if (!vault) return [];
  const recalled = question.trim() === '' ? [] : vault.recall(question, 8).map((h) => h.note);
  const recent = vault.all().slice(0, 12);
  const seen = new Set<string>();
  const merged: { id: string; title: string; body: string }[] = [];
  for (const note of [...recalled, ...recent]) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    merged.push({ id: note.id, title: note.title, body: note.body });
    if (merged.length >= 12) break;
  }
  return merged;
}

/**
 * The SEPARATE, ungrounded general-knowledge reply — tried only after the
 * grounded model, the memory it was shown, and the Forge delegation path have
 * all already failed to answer. `null` on any failure (Ollama unreachable, an
 * empty reply) so the caller falls through to the honest final refusal rather
 * than rendering nothing as something.
 */
async function askGeneral(
  ctx: ServerCtx,
  question: string,
  model: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const qwenChat = /^qwen3(?:[:-]|$)/i.test(model);
    const r = await fetch(ollamaEndpoint(ctx, qwenChat ? '/api/chat' : '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(qwenChat
        ? { model, messages: [{ role: 'user', content: buildGeneralPrompt(question) }], stream: false, think: false, keep_alive: '30s', options: { num_ctx: 8192 } }
        : { model, prompt: buildGeneralPrompt(question), stream: false, think: false, keep_alive: '30s', options: { num_ctx: 8192 } }),
      signal,
    });
    if (!r.ok) return null;
    const raw = (await r.json()) as { response?: string; message?: { content?: string } };
    const text = withoutReasoning(qwenChat ? raw.message?.content ?? '' : raw.response ?? '').trim();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

function repositoryState(ctx: ServerCtx): { branch: string; head: string; changed: string[] } | null {
  try {
    const st = ctx.gitRunner.run(['rev-parse', '--abbrev-ref', 'HEAD'], ctx.opts.sandbox);
    if (st.status !== 0) return null;
    const ch = ctx.gitRunner.run(['status', '--porcelain', '-z', '--untracked-files=all'], ctx.opts.sandbox)
      .stdout.split(String.fromCharCode(0)).filter(Boolean).map((entry) => entry.slice(3));
    const hd = ctx.gitRunner.run(['rev-parse', 'HEAD'], ctx.opts.sandbox);
    return { branch: st.stdout.trim(), head: hd.status === 0 ? hd.stdout.trim().slice(0, 12) : 'no commits yet', changed: ch };
  } catch {
    return null;
  }
}

function pendingSnapshot(ctx: ServerCtx): { id: string; summary: string; tier: SnapshotTier; ageMin: number }[] {
  pruneDriftedHeld(ctx);
  return [
    ...[...ctx.held.values()].map((h) => h.preview),
    ...[...ctx.gateHeld.values()].map((h) => h.preview),
    ...(ctx.memoryRoutes?.waiting() ?? []),
  ].flatMap((preview) => {
    const tier = String(preview.tier);
    if (!/^T[0-4]$/.test(tier)) return [];
    return [{
      id: preview.actionHash.slice(0, 8),
      summary: preview.summary,
      tier: tier as SnapshotTier,
      ageMin: 0,
    }];
  });
}

function localModelFailureNote(model: string, error: unknown, timeoutMs: number): string {
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return timedOut
    ? `${model} did not answer within ${timeoutMs / 1000} seconds, so this turn was stopped. Try a smaller installed model or ask again after the current model finishes loading.`
    : `Zeno could not reach Ollama for this turn. Start Ollama, then confirm ${model} is installed (ollama pull ${model}). Your Zeno state is unaffected.`;
}

export async function postAssistantAsk(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const question = str(body, 'question');
  if (question === null || question.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'Ask a question.', resolve: 'POST {"question":"what is waiting on me?"}.' } });
  }
  // An optional local model id from the picker. Validated as a NAME here;
  // whether it is installed is decided against Ollama's own list below.
  if (body['model'] !== undefined && typeof body['model'] !== 'string') {
    return json(res, 400, { error: { code: 'bad-model', message: 'model must be a string.', resolve: 'Send an installed local model id from GET /forge/agents, or omit it.' } });
  }
  const requestedModel = str(body, 'model')?.trim() || undefined;
  if (requestedModel !== undefined && (requestedModel.length > 128 || /\s/.test(requestedModel) || requestedModel.includes(String.fromCharCode(0)))) {
    return json(res, 400, { error: { code: 'bad-model', message: 'model is not a valid local model id.', resolve: 'Send an installed local model id from GET /forge/agents, or omit it.' } });
  }

  if (isCapabilityHelpQuestion(question)) {
    return json(res, 200, {
      answer: ZENO_CAPABILITY_HELP,
      cited: [],
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: null,
      modelUsed: null,
      help: true,
    });
  }

  if (isApprovalKernelQuestion(question)) {
    return json(res, 200, {
      answer: ZENO_APPROVAL_KERNEL_HELP,
      cited: [],
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: null,
      modelUsed: null,
      help: true,
    });
  }

  const productAnswer = answerProductQuestion(question);
  if (productAnswer !== null) {
    return json(res, 200, {
      answer: productAnswer.answer,
      cited: productAnswer.cited,
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: null,
      modelUsed: null,
      help: true,
    });
  }

  if (isOwnerMemoryQuestion(question)) {
    const memories = recalledMemory(ctx, question).slice(0, 5);
    return json(res, 200, {
      answer: memories.length === 0
        ? 'Vault has no saved memories yet.'
        : memories.map((memory, index) => `- ${memory.body || memory.title} [m${index + 1}]`).join('\n'),
      cited: memories.map((memory, index) => ({ id: `m${index + 1}`, source: memory.id })),
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: null,
      modelUsed: null,
    });
  }

  // Repository-state questions are fully local. Answer before backlog reads,
  // hosted-agent probes, or optional external-memory searches so a private
  // workspace question can never cause unrelated data to leave this machine.
  if (isRepositoryOverviewQuestion(question)) {
    const repo = repositoryState(ctx);
    const id = repo === null ? 'g0' : 'g1';
    const answer = repo === null
      ? `No Git repository state was captured for the current Forge workspace [${id}].`
      : `The current Forge workspace is on branch ${repo.branch} at ${repo.head}. It has ${repo.changed.length} uncommitted ${repo.changed.length === 1 ? 'file' : 'files'} [${id}].`;
    return json(res, 200, {
      answer,
      cited: [{ id, source: 'current Forge repository state' }],
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: null,
      modelUsed: null,
    });
  }

  // The whole conversational request shares one deadline, including optional
  // source reads and Ollama startup/model discovery. A series of individually
  // bounded awaits must not turn a one-minute turn into several minutes.
  const requestedOrDefaultModel = requestedModel ?? DEFAULT_ASSISTANT_MODEL;
  const turnTimeoutMs = assistantTurnTimeoutMs(requestedOrDefaultModel);
  const turnDeadline = Date.now() + turnTimeoutMs;
  const remainingMs = () => Math.max(1, turnDeadline - Date.now());
  const withinTurn = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new DOMException('Turn timed out', 'TimeoutError')), remainingMs()); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const work = await withinTurn(ctx.opts.work.list().catch(() => null)).catch(() => null);
  const availability = await withinTurn(probeAgents(ctx)).catch(() => ({ localModels: [], claudeOnPath: false, codexOnPath: false }));
  const repo = repositoryState(ctx);

  // NeoSapien is queried unconditionally: cheap (an immediate, no-network
  // "not-configured" answer) on every machine that has not set the token, and
  // this is the only point in the request where the snapshot can still be
  // assembled with what it finds. Its own honesty is kept separate from
  // Zeno's local state either way — see `neosapien.ts` and `ExternalFact`.
  const neosapien = await withinTurn(searchNeosapienMemories(question)).catch(() => ({ ok: false as const, reason: 'turn-timeout' }));

  const snapshot = buildSnapshot({
    at: new Date().toISOString(),
    pending: pendingSnapshot(ctx),
    receipts: ctx.opts.kernel.receipts().slice(-20).map((r) => ({ id: r.id, outcome: r.outcome, summary: r.summary ?? '', at: r.at })),
    work: (work?.items ?? []).map((i: { id: string; title: string; labels?: readonly string[]; state?: string }) => ({ id: i.id, title: i.title, labels: [...(i.labels ?? [])], state: i.state ?? 'open' })),
    repo,
    memory: recalledMemory(ctx, question),
    devices: [{ name: hostname(), paired: true }],
    agents: [
      {
        id: 'local',
        available: availability.localModels.length > 0,
        detail: availability.localModels.length > 0
          ? `installed local models: ${availability.localModels.join(', ')}`
          : 'Ollama has no installed local model available to Forge.',
      },
      {
        id: 'claude-code',
        available: availability.claudeOnPath,
        detail: availability.claudeOnPath
          ? 'available through the local Claude Code CLI; starting it requires an explicit hosted confirmation.'
          : 'Claude Code CLI is not runnable from this machine.',
      },
      {
        id: 'codex',
        available: availability.codexOnPath === true,
        detail: availability.codexOnPath === true
          ? 'available through the local Codex CLI; starting it requires an explicit hosted confirmation.'
          : 'Codex CLI is not runnable from this machine.',
      },
    ],
    external: neosapien.ok
      ? neosapien.hits.map((h) => ({ id: h.id, title: h.title, body: h.body, source: 'NeoSapien' }))
      : [],
  });

  const prompt = buildAssistantPrompt(question, snapshot);
  const truncationNote = snapshot.truncated.length > 0 ? snapshot.truncated.map(describeTruncation).join(' · ') : null;

  let answer: string;
  try {
    await withinTurn(ensureOllama(ctx)); // asking a question is the instruction to start the answerer
  } catch (error) {
    return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: localModelFailureNote(requestedOrDefaultModel, error, turnTimeoutMs), modelUsed: requestedOrDefaultModel });
  }
  let chosen: { readonly modelUsed: string; readonly note: string | null };
  try {
    chosen = await withinTurn(resolveAssistantModel(ctx, requestedModel));
  } catch (error) {
    return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: localModelFailureNote(requestedOrDefaultModel, error, turnTimeoutMs), modelUsed: requestedOrDefaultModel });
  }
  const modelUsed = chosen.modelUsed;
  // A standalone concept should use the existing fact-free path. Otherwise a
  // small model can attach a real local fact id to unrelated general prose.
  if (isStandaloneConceptQuestion(question)) {
    const general = await askGeneral(ctx, question, modelUsed, AbortSignal.timeout(remainingMs()));
    return json(res, 200, {
      answer: general,
      general: general !== null,
      cited: [],
      ungrounded: null,
      proposal: null,
      delegated: null,
      note: general === null ? `The local model did not return a general answer. Try ${modelUsed} again.` : chosen.note,
      modelUsed,
    });
  }
  // `note` keeps carrying truncation; a model fallback is appended to it so the
  // window shows it without a new field, and `modelUsed` names the model on
  // every reply so a picker can confirm what actually answered.
  const note = [truncationNote, chosen.note].filter((part): part is string => part !== null).join(' · ') || null;
  // One conversational turn gets one latency budget. Reusing this signal for
  // the grounded attempt and its optional general-knowledge fallback prevents
  // a conservative first answer from silently turning a 60-second ceiling
  // into two consecutive 60-second waits.
  const turnSignal = AbortSignal.timeout(remainingMs());
  try {
    const qwenChat = /^qwen3(?:[:-]|$)/i.test(modelUsed);
    const r = await fetch(ollamaEndpoint(ctx, qwenChat ? '/api/chat' : '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(qwenChat
        ? { model: modelUsed, messages: [{ role: 'user', content: prompt }], stream: false, think: false, keep_alive: '30s', options: { num_ctx: 8192 } }
        : { model: modelUsed, prompt, stream: false, think: false, keep_alive: '30s', options: { num_ctx: 8192 } }),
      signal: turnSignal,
    });
    if (!r.ok) {
      return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: `The local model answered ${r.status}. Is ${modelUsed} pulled?`, modelUsed });
    }
    const raw = (await r.json()) as { response?: string; message?: { content?: string } };
    answer = cleanGroundedReply(withoutReasoning(qwenChat ? raw.message?.content ?? '' : raw.response ?? ''), snapshot);
  } catch (error) {
    return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: localModelFailureNote(modelUsed, error, turnTimeoutMs), modelUsed });
  }

  const grounding = groundReply(answer, snapshot);
  if (!grounding.ok) {
    // Do NOT render it as an answer. Say which id was invented — that specific
    // sentence is what earns the owner's trust in every other answer.
    //
    // But an INSTRUCTION ("check the dsa folder") must not dead-end here. The
    // small model's usual reply to one is a hedge plus the refusal ("The facts
    // do not show… I cannot answer…"), which fails grounding as an uncited
    // claim — and returning before the delegation fallback meant every such
    // request ended in "no answer text". The owner's own words decide the
    // delegation (never the flagged prose), and it is still only an offer.
    const fallback = fallbackDelegation(question, '');
    if (fallback !== null && fallback.kind === 'delegate') {
      const delegatedOffer = await resolveDelegation(ctx, fallback.task, role);
      return json(res, 200, {
        answer: null, flagged: answer, cited: grounding.cited,
        ungrounded: { unknownIds: grounding.unknownIds, claimsWithoutCitation: grounding.claimsWithoutCitation },
        proposal: null, delegated: delegatedOffer, note, modelUsed,
      });
    }

    // BROADENING THE MIDDLE, part one: a question that names something
    // CURRENT or plainly external — "what's the latest…", a bare URL — has no
    // honest answer here at all. Not a fact this snapshot could ever hold, and
    // not something a local model's frozen weights can know either; guessing
    // and labelling it "general" would still be a guess dressed as an answer.
    // The honest move is the same one an actionable request already gets:
    // hand it to Forge, which owns the real isolated browser and every
    // governed MCP bridge, and say so plainly. Still only an OFFER — the same
    // `resolveDelegation` seam, the same owner click before a hosted rung ever
    // starts.
    if (needsLiveLookup(question)) {
      const delegatedOffer = await resolveDelegation(
        ctx,
        `Research and answer, using web browsing or an MCP tool as needed: ${question.trim()}`,
        role,
      );
      return json(res, 200, {
        answer: 'That needs something current or external — nothing in your local state answers it, and my own '
          + 'knowledge may be stale or wrong for it. Forge can look it up.',
        cited: [], ungrounded: null, proposal: null, delegated: delegatedOffer, note, modelUsed,
      });
    }

    // BROADENING THE MIDDLE, part two: neither a fact to cite nor an
    // instruction to delegate — but that does not mean the question has no
    // real answer, only that it is not a question ABOUT this Zeno. This is a
    // SEPARATE reply, from a separate prompt (`buildGeneralPrompt`) that never
    // sees the snapshot and is never checked by `groundReply`, and the caller
    // is told plainly which kind of answer it is (`general: true`) — grounded
    // and general are never allowed to look the same on screen.
    const general = await askGeneral(ctx, question, modelUsed, turnSignal);
    if (general !== null) {
      // `note` stays exactly what it means everywhere else in this response —
      // truncation plus, at most, the model fallback. The UI labels a general
      // answer from the `general` flag alone (bind/ask.js), so the two are
      // never duplicated.
      return json(res, 200, {
        answer: general, general: true, cited: [], ungrounded: null, proposal: null, delegated: null, note, modelUsed,
      });
    }

    return json(res, 200, {
      answer: null, flagged: answer, cited: grounding.cited,
      ungrounded: { unknownIds: grounding.unknownIds, claimsWithoutCitation: grounding.claimsWithoutCitation },
      proposal: null, delegated: null, note, modelUsed,
    });
  }

  // A proposal is an intent, not an act: it goes through the ordinary gate.
  // A delegation is an intent too — it names a job, and `resolveDelegation`
  // decides whether anything starts and says so honestly either way.
  let proposal: unknown = null;
  let delegated: Delegated | null = null;
  // The model was ASKED (rule 8) to end with a `DELEGATE:` line whenever the
  // owner wants a piece of work done, but a small local model does not
  // reliably obey that — it far more often finds nothing to cite and falls
  // back to the plain refusal (rule 5). Without the fallback below, that
  // makes every actionable request dead-end on "I cannot answer that from
  // your Zeno." `fallbackDelegation` is deterministic and looks only at the
  // OWNER's question, never the model's prose, so it never competes with an
  // intent the model actually wrote — it only fires when `parseIntent` found
  // nothing. Either way the result is the same `delegate` intent shape,
  // decided by the same `resolveDelegation` seam: still just an OFFER, and a
  // hosted agent still waits on the owner's click.
  const intent = parseIntent(answer) ?? fallbackDelegation(question, answer);
  if (intent !== null && intent.kind === 'propose-write') {
    try {
      const out = await proposeFileWrite(ctx, intent.relPath, '', intent.summary, 'assistant');
      proposal = { relPath: intent.relPath, summary: intent.summary, preview: out['preview'] };
    } catch (err) {
      proposal = { relPath: intent.relPath, refused: (err as Error).message };
    }
  } else if (intent !== null && intent.kind === 'delegate') {
    delegated = await resolveDelegation(ctx, intent.task, role);
  }
  // A greeting or ordinary question can reach this point when the grounded
  // model emits its conservative refusal. It is not a request to act, so use
  // the separate general prompt rather than replacing a real model answer with
  // canned product copy. General answers carry an explicit flag in the UI.
  // Local models often omit the final period despite the exact prompt. The
  // grounding checker deliberately accepts that equivalent bare refusal; use the
  // same normalization here so a normal question reaches the general-answer
  // fallback instead of rendering a false dead end.
  const bareRefusal = answer.trim().replace(/[.!?]+$/, '') === CANNOT_ANSWER.replace(/[.!?]+$/, '');
  if (bareRefusal && intent === null) {
    const general = await askGeneral(ctx, question, modelUsed, turnSignal);
    if (general !== null) {
      return json(res, 200, { answer: general, general: true, cited: [], ungrounded: null, proposal: null, delegated: null, note, modelUsed });
    }
  }
  json(res, 200, { answer, cited: grounding.cited, ungrounded: null, proposal, delegated, note, modelUsed });
}
