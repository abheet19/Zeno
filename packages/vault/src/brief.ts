/**
 * The morning brief — the Assistant's first honest sentence of the day.
 *
 * Its whole discipline is the one the master prompt insists on: every item shows
 * its SOURCE and its AGE, a missing source is stated rather than hidden, and a
 * brief with a required source missing is `partial`, never dressed up as
 * `complete`. This is the function that keeps "here is your day" from quietly
 * becoming a guess.
 *
 * Pure: it takes the material and a now-timestamp and returns a structured
 * brief. Rendering to text is a separate, also-pure step.
 */
import type { Note } from './note.js';

export interface BriefItem {
  readonly text: string;
  readonly source: string;
  /** Human age, e.g. "2h ago", "3d ago" — always shown, never omitted. */
  readonly age: string;
}

export interface BriefSource {
  readonly name: string;
  /** 'ok' with items, or 'unavailable' — which makes the whole brief partial. */
  readonly state: 'ok' | 'unavailable';
  readonly items: readonly BriefItem[];
  /** Present when unavailable: why, and what to do. */
  readonly note?: string;
}

export interface Brief {
  readonly at: string;
  /** `complete` only when every required source answered. Otherwise `partial`. */
  readonly status: 'complete' | 'partial';
  readonly sources: readonly BriefSource[];
  /** The sources that could not be reached — named, never silently dropped. */
  readonly missing: readonly string[];
}

/** Age of an ISO timestamp relative to `now`, in the shortest honest unit. */
export function ageOf(iso: string, now: string): string {
  const then = Date.parse(iso);
  const t = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(t)) return 'unknown age';
  const s = Math.max(0, Math.floor((t - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface BriefInput {
  readonly now: string;
  /** Recent facts from the Vault. */
  readonly recentNotes: readonly Note[];
  /** Proposals waiting on the owner. */
  readonly pending: readonly { summary: string; tier: string; source: string; at: string }[];
  /** A source that was configured but could not be reached this morning. */
  readonly unavailable?: readonly { name: string; note: string }[];
}

export function buildBrief(input: BriefInput): Brief {
  const sources: BriefSource[] = [];

  sources.push({
    name: 'Waiting for you',
    state: 'ok',
    items: input.pending.map((p) => ({
      text: `${p.tier} · ${p.summary}`,
      source: p.source,
      age: ageOf(p.at, input.now),
    })),
  });

  sources.push({
    name: 'Recent memory',
    state: 'ok',
    items: input.recentNotes.slice(0, 5).map((n) => ({
      text: n.title,
      source: n.source,
      age: ageOf(n.updatedAt, input.now),
    })),
  });

  for (const u of input.unavailable ?? []) {
    sources.push({ name: u.name, state: 'unavailable', items: [], note: u.note });
  }

  const missing = sources.filter((s) => s.state === 'unavailable').map((s) => s.name);
  return {
    at: input.now,
    status: missing.length === 0 ? 'complete' : 'partial',
    sources,
    missing,
  };
}

/** Render a brief to plain text. Every item keeps its source and age. */
export function renderBrief(b: Brief): string {
  const lines: string[] = [];
  lines.push(`  Morning brief — ${b.status.toUpperCase()}`);
  if (b.status === 'partial') {
    lines.push(`  (partial: could not reach ${b.missing.join(', ')} — nothing here is guessed to fill the gap)`);
  }
  lines.push('');
  for (const s of b.sources) {
    lines.push(`  ${s.name}`);
    if (s.state === 'unavailable') {
      lines.push(`     unavailable — ${s.note ?? 'no reason given'}`);
    } else if (s.items.length === 0) {
      lines.push('     nothing');
    } else {
      for (const it of s.items) lines.push(`     · ${it.text}   [${it.source} · ${it.age}]`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
