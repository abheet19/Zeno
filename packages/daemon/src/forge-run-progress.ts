import type { Stream } from './stream.js';

/**
 * Forge reports orchestration milestones, not a guess at provider completion.
 * The denominator is deliberately fixed so every run has the same contract.
 */
export const FORGE_ORCHESTRATION_TOTAL = 5;

export type ForgeRunProgressPhase =
  | 'checking-provider'
  | 'preparing-worktree'
  | 'running-provider'
  | 'inspecting-changes'
  | 'proposing-changes'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type ForgeRunOutcome = 'completed' | 'failed' | 'cancelled';

export type ForgeTokenUsage =
  | { readonly status: 'pending' }
  | {
      readonly status: 'measured';
      readonly input: number;
      readonly output: number;
      readonly source: 'ollama-final-response';
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'hosted-cli-does-not-report' | 'ollama-final-counters-missing';
    };

export interface ForgeRunProgressEvent {
  readonly runId: string;
  readonly agentId: string;
  readonly model: string | null;
  readonly phase: ForgeRunProgressPhase;
  readonly completed: number;
  readonly total: typeof FORGE_ORCHESTRATION_TOTAL;
  /** Percentage of Zeno's five orchestration milestones, never model/token progress. */
  readonly orchestrationPercent: number;
  readonly terminal: boolean;
  readonly outcome: ForgeRunOutcome | null;
  readonly tokenUsage: ForgeTokenUsage;
}

function isExactCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Hosted CLIs expose no exact counters; Ollama counts are accepted only as a complete pair. */
export function finalForgeTokenUsage(
  agentId: string,
  input: unknown,
  output: unknown,
): ForgeTokenUsage {
  if (agentId !== 'local') {
    return { status: 'unavailable', reason: 'hosted-cli-does-not-report' };
  }
  if (isExactCounter(input) && isExactCounter(output)) {
    return { status: 'measured', input, output, source: 'ollama-final-response' };
  }
  return { status: 'unavailable', reason: 'ollama-final-counters-missing' };
}

/**
 * One monotonic publisher per admitted run. It emits no task text or provider
 * output, so reconnect replay carries only bounded operational facts.
 */
export class ForgeRunProgressReporter {
  private completed = 0;
  private model: string | null;
  private tokenUsage: ForgeTokenUsage;
  private terminal = false;

  constructor(
    private readonly stream: Pick<Stream, 'publish'>,
    private readonly runId: string,
    private readonly agentId: string,
    model?: string,
  ) {
    this.model = model ?? null;
    this.tokenUsage = agentId === 'local'
      ? { status: 'pending' }
      : { status: 'unavailable', reason: 'hosted-cli-does-not-report' };
    this.publish('checking-provider', 0, false, null);
  }

  get settled(): boolean {
    return this.terminal;
  }

  /** True only after the run-scoped worktree/tools were ready to invoke the provider. */
  get providerStarted(): boolean {
    return this.completed >= 2;
  }

  /** Provider discovery completed; the next bounded step creates the worktree. */
  providerReady(model?: string): void {
    this.model = model ?? null;
    this.publish('preparing-worktree', 1, false, null);
  }

  /** The isolated worktree and any proved, run-scoped capabilities are ready. */
  providerRunning(): void {
    this.publish('running-provider', 2, false, null);
  }

  /** Provider execution ended. This is the first point exact Ollama counts may exist. */
  providerFinished(input: unknown, output: unknown): void {
    this.tokenUsage = finalForgeTokenUsage(this.agentId, input, output);
    this.publish('inspecting-changes', 3, false, null);
  }

  /** Git has reported the changed paths; each eligible file will now cross the gate. */
  changesInspected(): void {
    this.publish('proposing-changes', 4, false, null);
  }

  /** The full orchestration path ended, independently of the provider outcome. */
  finish(outcome: ForgeRunOutcome): void {
    if (this.terminal) return;
    if (this.tokenUsage.status === 'pending') {
      this.tokenUsage = { status: 'unavailable', reason: 'ollama-final-counters-missing' };
    }
    const phase = outcome === 'completed' ? 'complete' : outcome;
    this.publish(phase, FORGE_ORCHESTRATION_TOTAL, true, outcome);
  }

  /** A thrown/preflight failure ends at the last milestone actually completed. */
  stop(outcome: Exclude<ForgeRunOutcome, 'completed'>): void {
    if (this.terminal) return;
    if (this.tokenUsage.status === 'pending') {
      this.tokenUsage = { status: 'unavailable', reason: 'ollama-final-counters-missing' };
    }
    this.publish(outcome, this.completed, true, outcome);
  }

  private publish(
    phase: ForgeRunProgressPhase,
    completed: number,
    terminal: boolean,
    outcome: ForgeRunOutcome | null,
  ): void {
    if (this.terminal || completed < this.completed) return;
    this.completed = completed;
    this.terminal = terminal;
    const event: ForgeRunProgressEvent = {
      runId: this.runId,
      agentId: this.agentId,
      model: this.model,
      phase,
      completed,
      total: FORGE_ORCHESTRATION_TOTAL,
      orchestrationPercent: Math.round((completed / FORGE_ORCHESTRATION_TOTAL) * 100),
      terminal,
      outcome,
      tokenUsage: this.tokenUsage,
    };
    this.stream.publish('run-progress', event);
  }
}
