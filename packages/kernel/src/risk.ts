/**
 * How risky is this write, really?
 *
 * The tier model answers "how dangerous is this KIND of action". On its own that
 * is far too coarse: renaming a variable in a component and rewriting the CI
 * pipeline are both "a file write". Stopping the owner for the first one teaches
 * them to click Approve without reading — which is precisely the failure mode
 * this whole product exists to prevent. An approval that is always asked for is
 * an approval nobody reads.
 *
 * So a write is assessed on what it ACTUALLY does, and only the risky ones are
 * escalated to a decision. Ordinary edits inside the sandbox just happen, and
 * the receipt still records every one of them.
 *
 * Pure and dependency-free: strings in, a kind and its reasons out. The rules
 * are deliberately few and legible — you can hold all of them in your head,
 * which matters for something that decides when to interrupt you.
 *
 * WHAT THIS TRADES AWAY, STATED PLAINLY.
 * Before routine writes applied unattended, the proposer capability could only
 * ever QUEUE something; causing an effect required the owner. Now a proposer can
 * cause an effect directly — but only one that is, by these rules, an ordinary
 * edit to an ordinary file inside the sandbox, and every one of them is
 * receipted into the same tamper-evident chain. The blast radius of a leaked
 * proposer token is therefore "small edits in your sandbox, all of them on the
 * record", never a config change, a deletion, a rewrite, or anything outside the
 * jail. That is the price of not training the owner to click Approve without
 * reading, and it is worth paying — but it is a real change in posture and it
 * should be re-read whenever these rules are widened.
 */
import type { ActionKind } from './types.js';

/**
 * Paths where a change is never routine, no matter how small. One character in
 * any of these can execute code, leak a secret, or change what every future
 * build does.
 */
export const SENSITIVE_PATHS: readonly RegExp[] = [
  /(^|[/\\])package(-lock)?\.json$/i,
  /(^|[/\\])(pnpm-lock\.yaml|yarn\.lock)$/i,
  /(^|[/\\])\.env($|\.)/i,
  /(^|[/\\])\.git([/\\]|$)/i,
  /(^|[/\\])\.github([/\\]|$)/i,
  /(^|[/\\])(Dockerfile|docker-compose\.ya?ml)$/i,
  /(^|[/\\])(tsconfig|eslint\.config|vite\.config|next\.config)\./i,
  /\.(key|pem|pfx|p12|crt|cer)$/i,
  /(^|[/\\])(id_rsa|id_ed25519|credentials|secrets?)([/\\.]|$)/i,
  /(^|[/\\])(CLAUDE|AGENTS)\.md$/i,
  /(^|[/\\])\.(npmrc|gitconfig|bashrc|profile|ps1)$/i,
];

/**
 * A change larger than this stops being "an edit" and starts being "a rewrite".
 * Chosen to be generous enough that ordinary work never interrupts you, and
 * small enough that nobody slips a rewrite past as an edit.
 */
export const ROUTINE_LINE_BUDGET = 40;

export interface WriteRisk {
  /** The action kind to classify under: 'local.write' is T0, 'patch.task' T1, 'destructive' T3. */
  readonly kind: ActionKind;
  /** Why, in the owner's words. Always at least one reason. */
  readonly reasons: readonly string[];
  /** True when this needs no decision — it simply happens, and is receipted. */
  readonly routine: boolean;
}

/** Lines added + lines removed, by the cheapest honest measure. */
function changedLines(before: string, after: string): number {
  const a = before === '' ? [] : before.split('\n');
  const b = after.split('\n');
  // Trim the common prefix and suffix; what remains is the edit.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail++;
  }
  return a.length - head - tail + (b.length - head - tail);
}

export function isSensitivePath(relPath: string): boolean {
  return SENSITIVE_PATHS.some((rx) => rx.test(relPath));
}

/**
 * Assess one file write.
 *
 * `before` is null when the file does not exist yet. Escalation only ever goes
 * UP: the first rule that fires wins, and they are ordered most-severe first, so
 * a small edit to a sensitive file is still treated as sensitive.
 */
export function assessWrite(relPath: string, before: string | null, after: string): WriteRisk {
  const existed = before !== null;

  // 1. Destroying work that is already there. The one case worth the loudest tier.
  if (existed && before.trim().length > 0 && after.trim().length === 0) {
    return {
      kind: 'destructive',
      reasons: [`"${relPath}" would be emptied — everything currently in it is deleted`],
      routine: false,
    };
  }
  if (existed && before.length > 200 && after.length < before.length / 4) {
    return {
      kind: 'destructive',
      reasons: [
        `"${relPath}" would lose most of its content (${before.length} to ${after.length} characters)`,
      ],
      routine: false,
    };
  }

  // 2. Files where one character changes what every future run does.
  if (isSensitivePath(relPath)) {
    return {
      kind: 'patch.task',
      reasons: [`"${relPath}" is configuration, credentials or build setup — never a routine edit`],
      routine: false,
    };
  }

  // 3. A rewrite wearing an edit's clothes.
  const delta = changedLines(before ?? '', after);
  if (delta > ROUTINE_LINE_BUDGET) {
    return {
      kind: 'patch.task',
      reasons: [`${delta} lines change — past the ${ROUTINE_LINE_BUDGET}-line budget for a routine edit`],
      routine: false,
    };
  }

  // 4. Everything else: an ordinary edit inside the sandbox. It happens, and it
  //    is receipted like everything else — "routine" means unattended, not unrecorded.
  return {
    kind: 'local.write',
    reasons: [
      existed
        ? `${delta} lines change in an ordinary source file — routine`
        : `creates "${relPath}", an ordinary source file — routine`,
    ],
    routine: true,
  };
}
