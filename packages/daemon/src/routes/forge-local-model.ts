/**
 * Run an open-source model (via Ollama) as a basic coding agent.
 *
 * The model cannot touch the filesystem itself, so it is asked to choose
 * exactly one strict envelope: FILE blocks for an edit, or one ANSWER block
 * for a question that needs no repository change. File output is parsed into
 * the ISOLATED worktree (jailed) and then flows through the ordinary gate.
 * Answer output is bounded and returned as chat text with zero changed files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jail } from '@abheet19/zeno-kernel';
import { ollamaEndpoint, type ServerCtx } from '../server/context.js';
import { localTaskAllowsPlainAnswer, localTaskNeedsRepositoryContext } from './forge-prompt.js';
import { readUtf8Bounded } from './forge-text.js';
import { ensureOllama } from './ollama-lifecycle.js';

/** The NUL byte, built from a char code so it survives every text pipeline unmangled. */
const NUL = String.fromCharCode(0);

/** Bound one local model reply before parsing envelopes or writing files. */
const MAX_LOCAL_MODEL_RESPONSE_CHARS = 1_000_000;
/** Answer-only runs are chat turns, not an unbounded document transport. */
const MAX_LOCAL_MODEL_ANSWER_CHARS = 32_000;
/** One reply may not fan out into an unbounded number of filesystem writes. */
const MAX_LOCAL_MODEL_FILE_BLOCKS = 64;

/**
 * A thinking model's private reasoning, cut off the front of its answer.
 *
 * `think:false` asks Ollama to suppress it and a Qwen3-class model does not
 * obey: the reasoning arrives INSIDE `response`, terminated by a bare
 * `</think>` that has no opening tag. Passed on verbatim it becomes the
 * answer, and that is not a cosmetic problem. Counsel scored five thousand
 * characters of the model talking to itself, found every sentence uncited,
 * and threw away the one grounded line that came after the sentinel -- so a
 * question it had answered correctly was reported as ungrounded and withheld.
 *
 * Cut at the LAST sentinel, because the answer is whatever the model said
 * after it stopped thinking. No sentinel means nothing leaked, and the text
 * is returned exactly as it arrived: this removes reasoning, and never
 * rewrites an answer.
 */
export function withoutReasoning(text: string): string {
  const marker = '</think>';
  const end = text.lastIndexOf(marker);
  return end === -1 ? text : text.slice(end + marker.length);
}

export async function runLocalModel(
  ctx: ServerCtx,
  worktree: string,
  task: string,
  model: string | undefined,
  effort: 'low' | 'medium' | 'high' | undefined,
  signal?: AbortSignal,
  ownerTask = task,
): Promise<{ ok: boolean; agentId: 'local'; model: string | null; effort: typeof effort | null; log: string; note?: string; cancelled?: boolean; tokensIn?: number | null; tokensOut?: number | null }> {
  const chosen = model && model.trim() ? model.trim() : 'qwen3:8b';
  const base = { agentId: 'local' as const, model: chosen, effort: effort ?? null };
  const answerOnly = localTaskAllowsPlainAnswer(ownerTask);
  const standaloneAnswer = answerOnly && !localTaskNeedsRepositoryContext(ownerTask);
  const ownerCancelled = (): boolean => signal?.aborted === true;
  if (ownerCancelled()) {
    return { ...base, ok: false, cancelled: true, log: '', note: 'The owner cancelled this local run before it started.' };
  }
  const think = effort !== 'low'; // low = no_think (fast); medium/high = reason first
  // THE CONTEXT PACK. Without this the model received the task string and
  // nothing else, so "optimise the code" could only be answered with "which
  // code?" — an agent that cannot see the repository can do nothing but create
  // new files. It now gets the tree, then the contents of the files most likely
  // to matter, bounded so a large repo cannot blow the context window.
  const NL = String.fromCharCode(10);
  // Bound the string before splitting: a repository with millions of tracked
  // paths must not turn one local request into millions of JS allocations.
  // A standalone snippet does not need the repository. Omitting it removes a
  // large source of ambiguity for compact models and materially lowers first
  // token latency. Repository questions and edits retain the full context pack.
  const treeOutput = standaloneAnswer ? '' : ctx.gitRunner.run(['ls-files'], worktree).stdout;
  const tree = treeOutput.slice(0, 1_000_000).split(NL).map((f) => f.trim()).filter(Boolean);
  const SRC = /\.(js|mjs|cjs|ts|tsx|jsx|json|css|html|md|py)$/i;
  const lower = task.toLowerCase();
  // Files the task actually names come first; then ordinary source. A budget
  // buys the most files this way rather than one enormous one.
  const named = tree.filter((f) => lower.includes((f.split('/').pop() ?? '').toLowerCase()));
  const rest = tree.filter((f) => !named.includes(f) && SRC.test(f));
  const pack: string[] = [];
  let spent = 0;
  for (const rel of [...named, ...rest].slice(0, 12)) {
    let body: string;
    try {
      const remaining = 24_000 - spent;
      if (remaining <= 0) break;
      const source = readUtf8Bounded(jail(ctx.forgeFs, worktree, rel), remaining);
      if (source.truncated) continue;
      body = source.text;
    } catch {
      continue;
    }
    if (spent + body.length > 24_000) continue;
    spent += body.length;
    pack.push(`===FILE: ${rel}===${NL}${body}${NL}===END===`);
  }
  const prompt = (standaloneAnswer
    ? [
        'You are a concise coding assistant answering in chat.',
        'This request needs no repository edit. Do not discuss or modify project files.',
        'Return only the final answer. Do not include analysis or a preface.',
        'For a code request with no language named, use JavaScript.',
        'Prefer exactly one answer envelope:',
        '===ANSWER===',
        '<the answer; fenced code is allowed>',
        '===END===',
        'TASK: ' + ownerTask,
      ]
    : [
        'You are a coding assistant editing files in a real project.',
        tree.length === 0
          ? 'THE REPOSITORY IS EMPTY — there are no existing files.'
          : `THE REPOSITORY CONTAINS THESE FILES:${NL}${tree.slice(0, 200).join(NL)}`,
        pack.length === 0
          ? ''
          : `CURRENT CONTENTS OF THE MOST RELEVANT FILES. To CHANGE one, output it again in full with your edits applied:${NL}${NL}${pack.join(NL + NL)}`,
        'Choose exactly ONE response form. Never mix the two forms.',
        'If this task needs repository edits, output one or more file blocks and no other text:',
        '===FILE: <relative/path>===',
        '<the COMPLETE new file content>',
        '===END===',
        'If this task is a question or explanation that needs no repository edit, output exactly one answer block:',
        '===ANSWER===',
        '<the concise answer; markdown and fenced code are allowed here>',
        '===END===',
        'Outside the selected envelope output nothing: no preface, reasoning, or trailing explanation.',
        'TASK: ' + task,
      ]).filter((l) => l !== '').join(NL + NL);
  let text: string;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  // Picking a local model IS the instruction to use one, so start the server
  // rather than sending the owner to a terminal to do it by hand.
  await ensureOllama(ctx);
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 120_000);
  timeout.unref?.();
  const cancel = (): void => requestController.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (ownerCancelled()) cancel();
  try {
    const lowEffortQwen = effort === 'low' && /^qwen3(?:[:-]|$)/i.test(chosen);
    const numPredict = answerOnly && effort === 'low'
      ? 512
      : effort === 'high'
        ? 4096
        : effort === 'medium'
          ? 2048
          : 1024;
    // Ollama's bundled Qwen3 template always appends an open <think> tag, even
    // when `think:false` is requested. In low-effort mode use Qwen's documented
    // empty-thinking assistant prefill through the structured chat API. This
    // prevents private reasoning from consuming the whole answer budget while
    // keeping the owner's task in a properly escaped message.
    const endpoint = lowEffortQwen ? '/api/chat' : '/api/generate';
    const requestBody = lowEffortQwen
      ? {
          model: chosen,
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: '<think>\n\n</think>\n\n' },
          ],
          stream: false,
          keep_alive: '60s',
          options: { num_ctx: 16384, num_predict: numPredict, temperature: 0.7, top_p: 0.8, top_k: 20 },
        }
      : { model: chosen, prompt, stream: false, think, keep_alive: '60s', options: { num_ctx: 16384, num_predict: numPredict } };
    const r = await fetch(ollamaEndpoint(ctx, endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: requestController.signal,
    });
    if (!r.ok) {
      return { ...base, ok: false, log: '', note: `Ollama returned ${r.status}. Is the model pulled? (ollama pull ${chosen})` };
    }
    const body = (await r.json()) as {
      response?: unknown;
      message?: { content?: unknown };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: unknown;
    };
    // Ollama reports what it actually consumed and produced. Forge shows it in
    // the status bar: an owner running a local model on their own GPU has a
    // right to see the cost of a run, and a context that is filling up is the
    // first thing that explains a worse answer.
    tokensIn = body.prompt_eval_count ?? null;
    tokensOut = body.eval_count ?? null;
    text = lowEffortQwen
      ? typeof body.message?.content === 'string' ? body.message.content : ''
      : typeof body.response === 'string' ? body.response : '';
    if (body.done_reason === 'length') {
      return {
        ...base,
        tokensIn,
        tokensOut,
        ok: false,
        log: '',
        note: `The local model exhausted its ${numPredict.toLocaleString('en-US')}-token response budget before producing a complete result. Nothing was written; try qwen3:8b, automatic routing, or a narrower task.`,
      };
    }
  } catch (error) {
    if (ownerCancelled()) {
      return { ...base, ok: false, cancelled: true, log: '', note: 'The owner cancelled this local run.' };
    }
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ...base, ok: false, log: '', note: timedOut || aborted
      ? 'The local model did not finish within two minutes. No files were applied. Try low effort, a smaller model, or a narrower task.'
      : 'Ollama could not complete the request. Check the local runtime and selected model, then retry.' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
  const metrics = { tokensIn, tokensOut };
  if (text.length > MAX_LOCAL_MODEL_RESPONSE_CHARS) {
    return { ...base, ...metrics, ok: false, log: '', note: `The local model reply exceeded the ${MAX_LOCAL_MODEL_RESPONSE_CHARS.toLocaleString('en-US')}-character safety limit. Nothing was written.` };
  }
  text = withoutReasoning(text).trim();

  // An answer-only turn succeeds without manufacturing a file edit. Keep the
  // wrapper out of the chat bubble and reject nested protocol markers: one
  // model reply is either an answer or a set of files, never both.
  const answerBlock = /^===ANSWER===\r?\n([\s\S]*?)\r?\n===END===$/.exec(text);
  if (answerBlock) {
    const answer = (answerBlock[1] ?? '').trim();
    if (
      answer === '' ||
      answer.length > MAX_LOCAL_MODEL_ANSWER_CHARS ||
      answer.includes(NUL) ||
      /^===(?:ANSWER|FILE:).*===$/m.test(answer)
    ) {
      return { ...base, ...metrics, ok: false, log: '', note: `The model returned an empty, mixed, or oversized answer envelope. Nothing was written; keep one answer under ${MAX_LOCAL_MODEL_ANSWER_CHARS.toLocaleString('en-US')} characters.` };
    }
    return { ...base, ...metrics, ok: true, log: answer };
  }

  // Qwen and other compact local models occasionally return the requested
  // snippet directly despite the strict ANSWER envelope. For an owner task
  // that is clearly answer-only, the raw text is still a valid chat result.
  // A task that names the repository/files or asks for an edit never reaches
  // this branch, so missing FILE blocks remain a hard failure.
  if (
    answerOnly &&
    text !== '' &&
    text.length <= MAX_LOCAL_MODEL_ANSWER_CHARS &&
    !text.includes(NUL) &&
    !/^===(?:ANSWER|FILE:|END===)/m.test(text)
  ) {
    return { ...base, ...metrics, ok: true, log: text };
  }

  // Parse the ===FILE:...=== / ===END=== envelopes and write each, JAILED to
  // the worktree so a hallucinated path can never escape it. Parsing and path
  // validation finish before the first write, so a mixed/malformed response
  // cannot land only its valid-looking prefix.
  // A repository path may contain spaces. Keep the header on one line and
  // require a non-whitespace final character, then let the ordinary path jail
  // decide whether the resulting relative path is valid for this worktree.
  const fileBlock = /===FILE:[ \t]*([^\r\n]*?\S)[ \t]*===[\r\n]+([\s\S]*?)[\r\n]+===END===/g;
  const blocks = [...text.matchAll(fileBlock)];
  const remainder = text.replace(fileBlock, '').trim();
  if (blocks.length === 0 || blocks.length > MAX_LOCAL_MODEL_FILE_BLOCKS || remainder !== '') {
    return { ...base, ...metrics, ok: false, log: '', note: 'The model reply did not contain exactly one valid answer envelope or a clean set of file envelopes. Nothing was written.' };
  }
  // Only validated file envelopes are safe and useful in the Forge transcript.
  // Some small models ignore `think:false` and place scratch reasoning before
  // the first envelope without a </think> marker. Showing the raw response
  // leaks that private working text and makes a successful run look like a
  // rambling chat. Rebuild the visible log from files that passed the path jail
  // and were actually written; the change list remains independently derived
  // from git below.
  const parsed: { rel: string; abs: string; content: string }[] = [];
  const targets = new Set<string>();
  for (const m of blocks) {
    const rel = (m[1] ?? '').trim();
    const content = m[2] ?? '';
    let abs: string;
    try {
      abs = jail(ctx.forgeFs, worktree, rel);
    } catch {
      return { ...base, ...metrics, ok: false, log: '', note: 'The model returned a file path outside the isolated worktree. Nothing was written.' };
    }
    const target = process.platform === 'win32' ? abs.toLocaleLowerCase('en-US') : abs;
    if (targets.has(target) || content.includes(NUL)) {
      return { ...base, ...metrics, ok: false, log: '', note: 'The model returned duplicate file targets or binary content. Nothing was written.' };
    }
    targets.add(target);
    parsed.push({ rel, abs, content });
  }

  const visibleBlocks: string[] = [];
  let wrote = 0;
  for (const { rel, abs, content } of parsed) {
    try {
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content, 'utf8');
      visibleBlocks.push(`===FILE: ${rel}===${NL}${content}${NL}===END===`);
      wrote++;
    } catch {
      /* skip an unwritable path */
    }
  }
  if (wrote === 0) {
    return { ...base, ...metrics, ok: false, log: '', note: 'The model produced no writable file edits in the expected format. Try a clearer task or a larger model.' };
  }
  return { ...base, ...metrics, ok: true, log: visibleBlocks.join(NL + NL) };
}
