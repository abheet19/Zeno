/**
 * Shell command shapes `classifyToolCall` escalates on, split out of
 * `tools.ts` so the pattern lists — the part most likely to be reviewed or
 * extended on their own — sit in a file with nothing else in it.
 *
 * Re-exported unchanged from `tools.ts`. Deliberately few and legible, in the
 * spirit of `SENSITIVE_PATHS` elsewhere in Zeno: a rule you cannot hold in your
 * head is a rule you cannot audit.
 */

/**
 * Shapes of command that are not merely "running something".
 *
 * Matching one raises the capsule from `shell.exec` to `destructive`; matching
 * none changes nothing about whether the owner is asked.
 */
export const DESTRUCTIVE_SHELL: readonly RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, // rm -rf, rm -fr, rm -r -f
  /\b(rmdir|rd)\b.*\/s\b/i, // Windows recursive remove
  /\bdel\b.*\/[sq]\b/i,
  /\b(mkfs|format)\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot)\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd])/i,
  /\b(npm|pnpm|yarn)\s+publish\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
];

/**
 * The one place a command reaches back at Zeno itself.
 *
 * The ledger is the evidence; the signing key is what makes it evidence; the
 * proposer token and policy are what decide who may ask for what. A command
 * naming any of them is not an ordinary command, and it is rated `destructive`
 * so the capsule says so in the loudest words the tier model has. It is still
 * only a pattern — the real answer is that the owner sees the command.
 */
export const GOVERNANCE_SURFACE: readonly RegExp[] = [
  /\.zeno\b/i,
  /\bledger\.jsonl\b/i,
  /\bproposer\.token\b/i,
  /\bpolicy\.json\b/i,
  // A `keys` PATH SEGMENT — `ls keys/`, `.zeno\keys`, `cat keys` — and not the
  // ordinary word, so `Object.keys(x)` in a one-liner is left alone.
  /(^|[\s/\\'"])keys([/\\]|$|[\s'"])/i,
];
