/**
 * The pure engine behind the green tick.
 *
 * A "sanitized" tick with nothing behind it is worse than no tick: it tells the
 * owner a prompt, a receipt, a log line or an approval capsule is safe to expose
 * when it may still carry their own AWS keys, tokens or connection strings. This
 * file is the thing behind the tick — it finds those secrets with the rules in
 * `patterns.ts` and replaces each one with a STABLE, one-way placeholder so the
 * secret bytes never reach the sink and the same secret always redacts the same
 * way (traceable across receipts, never reversible).
 *
 * Everything here is a pure function of its input: same text in, same result
 * out. The only "randomness" is a SHA-256 of the secret, which is deterministic.
 * No clock, no fs, no network, no npm dependency — `node:crypto` is a Node
 * builtin, the same local primitive the kernel hashes with.
 */
import { createHash } from 'node:crypto';
import { RULES, type Rule, type SecretClass } from './patterns.js';

/** One secret located in the text. Carries WHERE and WHAT — never the value. */
export interface Finding {
  readonly ruleId: string;
  readonly label: string;
  readonly klass: SecretClass;
  /** UTF-16 offset of the redacted span in the original text (inclusive). */
  readonly start: number;
  /** UTF-16 offset one past the redacted span (exclusive). */
  readonly end: number;
}

/**
 * A distinct placeholder that appears in the cleaned text, with the human legend
 * a caller needs to explain it. `count` is how many occurrences of the SAME
 * secret collapsed onto this one token — the stable-hash property means one
 * secret is always one token no matter how many times it appears.
 */
export interface Placeholder {
  /** e.g. "[REDACTED:github-token:a1b2c3d4]". Contains no secret bytes. */
  readonly token: string;
  readonly ruleId: string;
  readonly label: string;
  readonly klass: SecretClass;
  readonly count: number;
}

export interface SanitizeResult {
  /** The input with every detected secret replaced by its placeholder. */
  readonly clean: string;
  /** Every secret found, in the order it appears in the text. */
  readonly findings: readonly Finding[];
  /** The distinct placeholders used, in first-appearance order. */
  readonly placeholders: readonly Placeholder[];
}

export interface SanitizeOptions {
  /**
   * Override the detector set. Defaults to the full ordered {@link RULES}.
   * Exposed so a caller can narrow the rules for a specific sink, and so the
   * engine's edge behaviour (an empty group, a non-participating group) can be
   * exercised without waiting for a real-world secret shaped to trigger it.
   */
  readonly rules?: readonly Rule[];
  /**
   * Hex characters of the secret's SHA-256 kept in the placeholder suffix.
   * Longer is more collision-resistant and still one-way; the default is a
   * short, readable tag that is more than enough to tell two secrets apart.
   */
  readonly hashLength?: number;
}

/** 8 hex chars = 32 bits of the digest: readable, and collisions are remote. */
const DEFAULT_HASH_LENGTH = 8;

/**
 * A detected span in the ORIGINAL text, plus the exact secret bytes it covers.
 * The `secret` field never leaves this module — it exists only to derive the
 * stable placeholder hash. `ruleIndex` is the rule's position in the array, the
 * tie-breaker when two spans are the same length.
 */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly ruleIndex: number;
  readonly rule: Rule;
  readonly secret: string;
}

/**
 * Clone a rule's regex with the flags the engine needs: `g` to walk every match
 * and `d` to get match-INDICES so a `redactGroup` can be located exactly. Built
 * from a Set so a rule that already carries a flag is not double-flagged (which
 * would throw). A rule regex is therefore never a shared mutable cursor — the
 * same RULES array is safe to reuse across calls.
 */
function scanning(re: RegExp): RegExp {
  const flags = new Set(re.flags.split(''));
  flags.add('g');
  flags.add('d');
  return new RegExp(re.source, [...flags].join(''));
}

/**
 * Run every rule over the text and collect the spans it wants to redact. The
 * span is the whole match, or the named `redactGroup` when the rule keeps a key
 * and loses only the value. `matchAll` advances past empty matches on its own,
 * so a pathological zero-width rule cannot spin the loop.
 */
function detect(text: string, rules: readonly Rule[]): Span[] {
  const spans: Span[] = [];
  rules.forEach((rule, ruleIndex) => {
    const group = rule.redactGroup ?? 0;
    for (const m of text.matchAll(scanning(rule.regex))) {
      // `indices` is always present: `scanning` compiled the regex with `d`.
      const at = m.indices![group];
      // The chosen group did not participate in this match — nothing to redact.
      if (at === undefined) continue;
      const [start, end] = at;
      // A zero-width group (e.g. an empty `(x*)`) covers no secret bytes.
      if (end <= start) continue;
      const secret = text.slice(start, end);
      // The entropy net's second gate: reject a long-but-boring run.
      if (rule.filter && !rule.filter(secret)) continue;
      spans.push({ start, end, ruleIndex, rule, secret });
    }
  });
  return spans;
}

/** Two spans overlap when neither ends at or before the other begins. */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Order candidates so the winner of any overlap comes first: the LONGEST span,
 * and on a length tie the one from the EARLIER rule (so a 40-char AWS secret is
 * labelled `aws-secret`, not the anonymous `high-entropy` net that also covers
 * it). `start` is the final, purely-stable tie-break.
 */
function compareSpans(a: Span, b: Span): number {
  const lenA = a.end - a.start;
  const lenB = b.end - b.start;
  if (lenA !== lenB) return lenB - lenA;
  if (a.ruleIndex !== b.ruleIndex) return a.ruleIndex - b.ruleIndex;
  return a.start - b.start;
}

/**
 * Resolve overlaps: walk candidates best-first and keep each one that does not
 * touch a span already kept. Longest-wins falls straight out of the ordering —
 * a longer match is always considered before any shorter span it overlaps.
 *
 * Specific rules are resolved BEFORE fallback (last-resort) rules, so a named
 * finding always wins the overlap even when the entropy net's greedy run is
 * longer (it swallows the key name and `=`). The net then only claims the gaps
 * nothing named could explain. Survivors are returned in document order, ready
 * to splice.
 */
function resolve(spans: Span[]): Span[] {
  const specific = spans.filter((s) => !s.rule.fallback).sort(compareSpans);
  const fallback = spans.filter((s) => s.rule.fallback).sort(compareSpans);
  const kept: Span[] = [];
  for (const span of [...specific, ...fallback]) {
    if (!kept.some((k) => overlaps(k, span))) kept.push(span);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * The stable placeholder for a secret. The suffix is a prefix of the secret's
 * SHA-256, so the same secret always yields the same token (traceable) while the
 * token is one-way (the secret cannot be recovered from it). The secret bytes
 * themselves never appear in the returned string.
 */
function placeholderToken(rule: Rule, secret: string, hashLength: number): string {
  const suffix = createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, hashLength);
  return `[REDACTED:${rule.id}:${suffix}]`;
}

/**
 * Detect every secret in `text` and return a cleaned copy with each one replaced
 * by its stable placeholder, the findings in document order, and the distinct
 * placeholders used. Pure and deterministic.
 */
export function sanitize(text: string, opts: SanitizeOptions = {}): SanitizeResult {
  const rules = opts.rules ?? RULES;
  const hashLength = opts.hashLength ?? DEFAULT_HASH_LENGTH;
  const kept = resolve(detect(text, rules));

  const findings: Finding[] = [];
  const byToken = new Map<string, { -readonly [K in keyof Placeholder]: Placeholder[K] }>();
  let clean = '';
  let cursor = 0;
  for (const span of kept) {
    const token = placeholderToken(span.rule, span.secret, hashLength);
    clean += text.slice(cursor, span.start) + token;
    cursor = span.end;
    findings.push({
      ruleId: span.rule.id,
      label: span.rule.label,
      klass: span.rule.klass,
      start: span.start,
      end: span.end,
    });
    const existing = byToken.get(token);
    if (existing) existing.count += 1;
    else
      byToken.set(token, {
        token,
        ruleId: span.rule.id,
        label: span.rule.label,
        klass: span.rule.klass,
        count: 1,
      });
  }
  clean += text.slice(cursor);
  return { clean, findings, placeholders: [...byToken.values()] };
}

/**
 * Does `text` carry any secret at all? Cheaper to read than `sanitize(...).
 * findings.length > 0` and the same truth: one detected span is enough.
 */
export function hasSecret(text: string): boolean {
  return detect(text, RULES).length > 0;
}

/**
 * Thrown by {@link assertClean} at a sink that refuses to carry a secret. Names
 * the sink and the KINDS found — never the value. Echoing the secret into an
 * exception message (which is itself logged) is exactly the leak assertClean
 * exists to prevent, so the value is deliberately withheld from `message`.
 */
export class SecretLeakError extends Error {
  readonly where: string;
  readonly findings: readonly Finding[];
  constructor(where: string, findings: readonly Finding[]) {
    const kinds = [...new Set(findings.map((f) => f.ruleId))].join(', ');
    super(
      `secret detected: refusing to expose text to ${where} ` +
        `(${findings.length} finding(s): ${kinds}); the value was withheld`,
    );
    this.name = 'SecretLeakError';
    this.where = where;
    this.findings = findings;
  }
}

/**
 * Guard a sink. If `text` carries a secret, throw {@link SecretLeakError} naming
 * `where` (the sink: "model-prompt", "receipt", "log", "capsule"). The whole
 * point of the tick is that nothing crosses this line by accident.
 */
export function assertClean(text: string, where: string): void {
  const { findings } = sanitize(text);
  if (findings.length === 0) return;
  throw new SecretLeakError(where, findings);
}
