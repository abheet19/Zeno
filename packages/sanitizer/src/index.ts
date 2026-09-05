/**
 * Zeno · Sanitizer — the thing behind the tick.
 *
 * Text flows through Zeno toward sinks it must never leak into: a model prompt,
 * a receipt on disk, a log line, the approval capsule. On a zero-budget local
 * build the real threat is the owner's OWN keys, tokens and connection strings
 * ending up in one of those places because some tool echoed them. This leaf
 * package finds them and redacts them to stable, one-way placeholders.
 *
 * `sanitize` is the engine; `hasSecret` and `assertClean` are the guards a sink
 * puts in front of itself. `RULES` (and the entropy helpers) are exported so a
 * caller can see, narrow, or extend exactly what "a secret" means here.
 */
export {
  sanitize,
  hasSecret,
  assertClean,
  SecretLeakError,
  type Finding,
  type Placeholder,
  type SanitizeResult,
  type SanitizeOptions,
} from './sanitize.js';
export {
  RULES,
  shannonEntropy,
  classDiversity,
  type Rule,
  type SecretClass,
} from './patterns.js';
