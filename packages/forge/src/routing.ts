import { AGENTS, type AgentId, type Effort } from './agents.js';

/** The result of Zeno's deterministic task router. It selects execution
 * controls only; it grants no tools and never bypasses the approval kernel. */
export interface TaskRoute {
  readonly agentId: AgentId;
  readonly model: string;
  readonly effort: Effort;
  readonly kind: 'private-local' | 'frontend' | 'architecture' | 'documentation' | 'general';
  readonly rationale: string;
  /** False only when live availability was supplied and no safe provider can run it. */
  readonly runnable?: boolean;
}

export interface TaskRouteOptions {
  readonly localModels?: readonly string[];
  /** Providers the daemon proved runnable on this machine. Omit for catalogue-only callers. */
  readonly availableAgentIds?: readonly AgentId[];
}

function firstModel(agentId: AgentId, preferred: string): string {
  const agent = AGENTS.find((candidate) => candidate.id === agentId);
  return agent?.models.includes(preferred) ? preferred : (agent?.models[0] ?? '');
}

function preferredLocal(models: readonly string[]): string {
  // 8B is the measured local sweet spot on the supported workstation: it
  // follows Qwen's non-thinking prefill reliably while 4B can loop and 14B can
  // exceed the bounded provider timeout. Manual selection still exposes both.
  const ranked = ['qwen3:8b', 'qwen3:14b', 'qwen3:4b'];
  return ranked.find((name) => models.includes(name)) ?? models[0] ?? 'qwen3:8b';
}

function fallbackModel(agentId: AgentId, kind: TaskRoute['kind'], localModels: readonly string[]): string {
  if (agentId === 'local') return preferredLocal(localModels);
  if (agentId === 'codex') {
    if (kind === 'architecture') return firstModel('codex', 'gpt-6-astra');
    if (kind === 'documentation') return firstModel('codex', 'gpt-5.6-luna');
    if (kind === 'frontend') return firstModel('codex', 'gpt-5.6-terra');
    return firstModel('codex', 'gpt-5.6-sol');
  }
  if (kind === 'architecture') return firstModel('claude-code', 'opus');
  if (kind === 'documentation') return firstModel('claude-code', 'haiku');
  return firstModel('claude-code', 'sonnet');
}

/**
 * Keep the semantic route when its runtime exists, otherwise choose an honest
 * live fallback. Credential-bearing work is deliberately different: it never
 * falls from local to a hosted provider merely because Ollama is unavailable.
 */
function availableRoute(preferred: TaskRoute, options: TaskRouteOptions): TaskRoute {
  if (options.availableAgentIds === undefined) return preferred;
  const available = new Set(options.availableAgentIds);
  if (available.has(preferred.agentId)) return { ...preferred, runnable: true };

  if (preferred.kind === 'private-local') {
    return {
      ...preferred,
      runnable: false,
      rationale: 'This task names sensitive data, but no local Ollama model is available. Forge will not send it to a hosted provider.',
    };
  }

  const order: readonly AgentId[] = preferred.kind === 'architecture'
    ? ['codex', 'local', 'claude-code']
    : preferred.kind === 'documentation'
      ? ['local', 'codex', 'claude-code']
      : preferred.kind === 'frontend'
        ? ['local', 'claude-code', 'codex']
        : ['local', 'codex', 'claude-code'];
  const agentId = order.find((id) => available.has(id));
  if (agentId === undefined) {
    return {
      ...preferred,
      runnable: false,
      rationale: 'No coding provider is available on this machine. Install a hosted CLI or pull an Ollama model before running this task.',
    };
  }

  const labels: Record<AgentId, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    local: 'local Ollama',
  };
  return {
    ...preferred,
    agentId,
    model: fallbackModel(agentId, preferred.kind, options.localModels ?? []),
    runnable: true,
    rationale: `${labels[agentId]} selected because ${labels[preferred.agentId]} is unavailable on this machine. The choice uses task type, privacy, and live provider availability.`,
  };
}

/** Detect credential values even when the task never labels them as secrets. */
function containsSensitiveMaterial(task: string, lower: string): boolean {
  if (/\b(api[ -]?key|password|credential|private[ -]?key|access[ -]?token|refresh[ -]?token|secret|\.env|pii|personal data)\b/.test(lower)) return true;
  return [
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/i,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  ].some((pattern) => pattern.test(task));
}

/**
 * Choose a provider, model, and effort from observable task signals.
 *
 * This is deliberately a small, explainable ruleset rather than another model
 * call: routing is instant, costs nothing, and the exact reason can be shown to
 * the owner before work begins. A manual selection in Forge skips this helper.
 */
export function routeAgentTask(task: string, options: TaskRouteOptions = {}): TaskRoute {
  const text = task.trim().toLowerCase();
  const localModels = options.localModels ?? [];

  if (containsSensitiveMaterial(task, text)) {
    return availableRoute({
      agentId: 'local',
      model: preferredLocal(localModels),
      effort: 'medium',
      kind: 'private-local',
      rationale: 'Local Ollama selected because the task names or contains credentials, secrets, or personal data; the prompt stays on this machine.',
    }, options);
  }

  const compactCodeRequest = text.length <= 280
    && /^(?:write|show|give|provide|return|generate)\b/.test(text)
    && /(?:\b(?:for|while)\s+loop\b|\b(?:function|class|snippet|code example)\b)/.test(text);
  if (compactCodeRequest) {
    return availableRoute({
      agentId: 'local',
      model: preferredLocal(localModels),
      effort: 'low',
      kind: 'general',
      rationale: 'Local Qwen 8B at low effort selected for a small standalone code request; it avoids hosted usage and does not need repository context.',
    }, options);
  }

  if (/\b(react|typescript|javascript|tsx|jsx|css|html|frontend|front-end|ui|ux|component|responsive|accessibility|a11y|playwright|browser)\b/.test(text)) {
    return availableRoute({
      agentId: 'codex',
      model: firstModel('codex', 'gpt-5.6-terra'),
      effort: /\b(architecture|redesign|migration|performance|security)\b/.test(text) ? 'high' : 'medium',
      kind: 'frontend',
      rationale: 'Codex Terra selected for a frontend or browser task; effort rises to high only when architecture, performance, migration, or security is named.',
    }, options);
  }

  if (/\b(architecture|system design|distributed|concurrency|security|threat model|migration|root cause|database schema|microservice|kubernetes)\b/.test(text)) {
    return availableRoute({
      agentId: 'claude-code',
      model: firstModel('claude-code', 'opus'),
      effort: 'high',
      kind: 'architecture',
      rationale: 'Claude Opus at high effort selected because the task asks for architecture, distributed-systems, security, migration, or root-cause work.',
    }, options);
  }

  if (/\b(readme|documentation|docs|explain|comment|copy|wording|summari[sz]e)\b/.test(text)) {
    return availableRoute({
      agentId: 'claude-code',
      model: firstModel('claude-code', 'haiku'),
      effort: 'low',
      kind: 'documentation',
      rationale: 'Claude Haiku at low effort selected because the task is a bounded documentation or explanation change.',
    }, options);
  }

  return availableRoute({
    agentId: 'claude-code',
    model: firstModel('claude-code', 'sonnet'),
    effort: 'medium',
    kind: 'general',
    rationale: 'Claude Sonnet at medium effort selected as the balanced default because no privacy, frontend, documentation, or deep-architecture signal matched.',
  }, options);
}
