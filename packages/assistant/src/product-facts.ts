/**
 * Versioned product facts for questions about Zeno itself.
 *
 * These answers are deliberately deterministic. A local model may explain
 * general software concepts, but it must not invent what Command, Forge,
 * Counsel, Vault, or Voice can do. Each answer carries stable source ids so
 * the UI can distinguish product documentation from generated prose.
 */

export const PRODUCT_FACTS_VERSION = '2026-09-20.2';

export interface ProductAnswer {
  readonly answer: string;
  readonly cited: readonly { readonly id: string; readonly source: string }[];
}

interface ProductFact {
  readonly id: string;
  readonly names: readonly string[];
  readonly source: string;
  readonly text: string;
}

const FACTS: readonly ProductFact[] = [
  {
    id: 'z-command',
    names: ['command'],
    source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Command`,
    text: 'Command is Zeno’s local control plane. It answers from current Zeno state and selected local-model knowledge, recalls owner-approved Vault memory, opens product surfaces, and shows approvals and signed receipts. A task request can be handed to Forge or started through Forge’s own governed run path, but Command cannot approve an agent proposal or bypass the kernel.',
  },
  {
    id: 'z-forge',
    names: ['forge'],
    source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Forge`,
    text: 'Forge is Zeno’s governed coding workspace. It accepts a goal, assembles bounded repository context, selects an available provider, exposes constrained read/propose tools, runs in an isolated Git worktree, and reports progress and changes. Claude Code and Codex provide their own inner reasoning and tool loop; Zeno supplies the context, isolation, policy, approvals, stale-state checks, verification surfaces, and receipts around that work. The local Ollama path is currently a single bounded answer-or-file-change generation, not a generic planner that repeatedly calls tools.',
  },
  {
    id: 'z-counsel',
    names: ['counsel'],
    source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Counsel`,
    text: 'Counsel is Zeno’s consent-first meeting workspace. It needs an explicit meeting and consent state before capture, keeps transcription local when the optional Whisper runtime is installed, and prepares cited notes and follow-up proposals. Physical microphone and packaged-audio behavior must be verified on the current machine before it is presented as working.',
  },
  {
    id: 'z-vault',
    names: ['vault', 'memory'],
    source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Vault`,
    text: 'Vault is Zeno’s owner-controlled local memory. Command can recall relevant saved notes, and Forge can receive selected memories as bounded context. Retrieved memory is context, not authority: it cannot approve an action, override policy, or execute a tool.',
  },
  {
    id: 'z-voice',
    names: ['voice', 'whisper', 'microphone'],
    source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Voice`,
    text: 'Voice is an optional Electron capability. Hold-to-talk and Counsel transcription need the desktop bridge, microphone permission, and a separately installed, checksum-verified Whisper executable and model. Browser mode has no local speech bridge, and Zeno must report missing runtime, permission denial, or device ownership instead of pretending voice is available.',
  },
];

const PRODUCT_INTENT = /^(?:(?:what|who)\s+(?:is|are|does|do)|how\s+(?:does|do)|explain|describe|tell\s+me\s+about)\b/i;
const PRODUCT_NAME = /\b(command|forge|counsel|vault|memory|voice|whisper|microphone)\b/gi;

/** Return a bounded product answer, or null for every non-product question. */
export function answerProductQuestion(question: string): ProductAnswer | null {
  const normalized = question.replace(/\s+/g, ' ').trim();
  if (!PRODUCT_INTENT.test(normalized)) return null;

  const names = [...normalized.matchAll(PRODUCT_NAME)].map((match) => (match[1] ?? '').toLowerCase());
  const facts = FACTS.filter((candidate) => candidate.names.some((name) => names.includes(name)));
  if (facts.length === 0) return null;

  return {
    answer: facts.map((fact) => `${fact.text} [${fact.id}]`).join('\n\n'),
    cited: facts.map((fact) => ({ id: fact.id, source: fact.source })),
  };
}
