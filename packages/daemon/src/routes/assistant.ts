/**
 * Ask Zeno — the assistant, answering about the owner's OWN Zeno.
 *
 * Grounded, not generative: it is shown a clipped snapshot of real local state
 * and must cite the fact ids it used. `groundReply` then checks every citation
 * against that snapshot, so an invented id or an uncited factual claim is
 * reported as a FAILURE and the prose is handed back flagged rather than
 * rendered as an answer. A confident lie about your own machine is worse than
 * a refusal, so the refusal is the default.
 *
 * It may PROPOSE a file write, which becomes an ordinary approval capsule the
 * owner approves by hand. It may also DELEGATE a job to a coding agent, which
 * produces a stack of those same capsules. It never touches /approvals — L6 is
 * unchanged, and a hosted agent never starts from an answer alone.
 */
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildAssistantPrompt,
  buildSnapshot,
  CANNOT_ANSWER,
  cleanGroundedReply,
  conversationalReply,
  describeTruncation,
  fallbackDelegation,
  groundReply,
  parseIntent,
} from '@abheet19/zeno-assistant';
import type { Role } from '../tokens.js';
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { ensureOllama } from './ollama-lifecycle.js';
import { withoutReasoning } from './forge-local-model.js';
import { proposeFileWrite } from './approvals.js';
import { resolveDelegation, type Delegated } from './delegate.js';

export async function postAssistantAsk(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const question = str(body, 'question');
  if (question === null || question.trim() === '') {
    return json(res, 400, { error: { code: 'bad-request', message: 'Ask a question.', resolve: 'POST {"question":"what is waiting on me?"}.' } });
  }

  const work = await ctx.opts.work.list().catch(() => null);
  let repo: { branch: string; head: string; changed: string[] } | null = null;
  try {
    const st = ctx.gitRunner.run(['rev-parse', '--abbrev-ref', 'HEAD'], ctx.opts.sandbox);
    if (st.status === 0) {
      const ch = ctx.gitRunner.run(['status', '--porcelain', '-z', '--untracked-files=all'], ctx.opts.sandbox)
        .stdout.split(String.fromCharCode(0)).filter(Boolean).map((e) => e.slice(3));
      const hd = ctx.gitRunner.run(['rev-parse', 'HEAD'], ctx.opts.sandbox);
      repo = { branch: st.stdout.trim(), head: hd.status === 0 ? hd.stdout.trim().slice(0, 12) : 'no commits yet', changed: ch };
    }
  } catch { /* no repo is a fact, not an error */ }

  const snapshot = buildSnapshot({
    at: new Date().toISOString(),
    pending: [...ctx.held.values()].map((h) => ({ id: h.preview.actionHash.slice(0, 8), summary: h.preview.summary, tier: h.preview.tier, ageMin: 0 })),
    receipts: ctx.opts.kernel.receipts().slice(-20).map((r) => ({ id: r.id, outcome: r.outcome, summary: r.summary ?? '', at: r.at })),
    work: (work?.items ?? []).map((i: { id: string; title: string; labels?: readonly string[]; state?: string }) => ({ id: i.id, title: i.title, labels: [...(i.labels ?? [])], state: i.state ?? 'open' })),
    repo,
    memory: (ctx.opts.vault?.all() ?? []).slice(0, 12).map((n) => ({ id: n.id, title: n.title, body: n.body })),
    devices: [{ name: hostname(), paired: true }],
  });

  const prompt = buildAssistantPrompt(question, snapshot);
  const note = snapshot.truncated.length > 0 ? snapshot.truncated.map(describeTruncation).join(' · ') : null;

  // A greeting, a thank-you, or "what can you do?" has no fact to ground, so
  // the grounded model can only refuse it — and a chat that answers "hey"
  // with "I cannot answer that from your Zeno." reads as broken. These are
  // answered here, deterministically and entirely from the same snapshot the
  // model would have seen: every number below is the owner's real local
  // state, so the reply is grounded by construction and no model is asked.
  const greeting = conversationalReply(question, snapshot);
  if (greeting !== null) {
    return json(res, 200, { answer: greeting, cited: [], ungrounded: null, proposal: null, delegated: null, note });
  }

  let answer: string;
  await ensureOllama(ctx); // asking a question is the instruction to start the answerer
  try {
    const r = await fetch(ollamaEndpoint(ctx, '/api/generate'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3:8b', prompt, stream: false, think: false }),
    });
    if (!r.ok) {
      return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: `The local model answered ${r.status}. Is qwen3:8b pulled?` });
    }
    answer = cleanGroundedReply(
      withoutReasoning(((await r.json()) as { response?: string }).response ?? ''),
      snapshot,
    );
  } catch {
    return json(res, 200, { answer: null, cited: [], ungrounded: null, proposal: null, delegated: null, note: 'Ollama is not running, so nobody can answer this. Start it, then pull a model (ollama pull qwen3:8b). Your Zeno state is unaffected.' });
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
    const delegatedOffer = fallback !== null && fallback.kind === 'delegate'
      ? await resolveDelegation(ctx, fallback.task, role)
      : null;
    return json(res, 200, {
      answer: null, flagged: answer, cited: grounding.cited,
      ungrounded: { unknownIds: grounding.unknownIds, claimsWithoutCitation: grounding.claimsWithoutCitation },
      proposal: null, delegated: delegatedOffer, note,
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
  // The bare refusal is honest but reads as a dead end. When nothing was
  // delegated either, say what CAN be answered instead — a guide, not a shrug.
  // It makes no factual claim, so it needs no citation to stay grounded.
  if (answer.trim() === CANNOT_ANSWER && intent === null) {
    answer = 'I only answer from your local state — I don’t guess. Ask me what’s waiting on you, what’s in the sandbox, what ran today, or what you’ve saved to memory. Or describe a task and I’ll run it in Forge.';
  }
  json(res, 200, { answer, cited: grounding.cited, ungrounded: null, proposal, delegated, note });
}
