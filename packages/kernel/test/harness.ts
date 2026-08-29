/**
 * Test harness: a seeded deterministic PRNG (so property tests are themselves
 * replayable — fitting for a kernel whose whole point is determinism), a
 * controllable injected World, and request builders. Zero test-framework deps
 * beyond node:test / node:assert.
 */
import type {
  ActionKind,
  ActionRequest,
  DataZone,
  World,
} from '../src/types.js';
import { hashOf } from '../src/hash.js';

/** mulberry32 — tiny, fast, seedable PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

/**
 * A controllable world. `bases` maps targetRef -> current base hash; mutate it to
 * simulate drift. Clock and ids are deterministic functions of a counter.
 */
export class TestWorld implements World {
  private clock = 0;
  private counter = 0;
  readonly bases = new Map<string, string>();
  approvalTtlMs = 60_000;

  now(): string {
    // deterministic, strictly increasing
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + this.clock++ * 1000).toISOString();
  }
  id(): string {
    return `id_${(this.counter++).toString(16).padStart(6, '0')}`;
  }
  readBase(targetRef: string): string {
    return this.bases.get(targetRef) ?? 'base_absent';
  }
  setBase(targetRef: string, base: string): void {
    this.bases.set(targetRef, base);
  }
  /** Advance the clock by N seconds without emitting a receipt (for expiry tests). */
  tick(seconds: number): void {
    this.clock += seconds;
  }
}

export const ALL_KINDS: readonly ActionKind[] = [
  'read',
  'local.write',
  'patch.task',
  'vcs.commit',
  'vcs.push',
  'vcs.mr',
  'jira.write',
  'message.send',
  'settings.change',
  'payment',
  'destructive',
];

export const ALL_ZONES: readonly DataZone[] = [
  'personal',
  'company',
  'cloud',
  'external',
  'financial',
  'ephemeral',
];

let reqSeq = 0;

export interface BuildOpts {
  kind?: ActionKind;
  summary?: string;
  targetRef?: string;
  payload?: unknown;
  base?: string;
  zones?: readonly DataZone[];
  requestedBy?: string;
}

/** Build a request AND register its base in the world (so CAS passes by default). */
export function buildRequest(world: TestWorld, o: BuildOpts = {}): ActionRequest {
  const n = reqSeq++;
  const targetRef = o.targetRef ?? `repo/x@head_${n}`;
  const base = o.base ?? `base_${hashOf(n).slice(0, 8)}`;
  world.setBase(targetRef, base);
  return {
    kind: o.kind ?? 'patch.task',
    summary: o.summary ?? `synthetic action #${n}`,
    targetRef,
    payload: o.payload ?? { n, note: 'synthetic' },
    baseHash: base,
    requestedBy: o.requestedBy ?? `agent_${n % 3}`,
    dataZones: o.zones ?? ['personal'],
  };
}

/** A no-op executor that claims a synthetic external effect. */
export function okExecutor(effect = 'provider_receipt_synthetic') {
  let calls = 0;
  const fn = async () => {
    calls++;
    return { effect };
  };
  return Object.assign(fn, { calls: () => calls });
}

/** An executor that always throws (to exercise the OUTCOME_UNKNOWN path). */
export function failingExecutor() {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new Error('synthetic executor failure');
  };
  return Object.assign(fn, { calls: () => calls });
}
