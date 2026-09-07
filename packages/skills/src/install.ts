/**
 * Ingesting somebody else's folder of skills — the decision half.
 *
 * The ecosystem's install command is `npx skills add <owner>/<repo>`: it fetches a
 * repository, copies its `SKILL.md` folders into `.agents/skills`, and prints a
 * warning that skills run with full agent permissions. Zeno cannot adopt that command
 * as-is, for a reason that is structural rather than stylistic: FETCHING IS AN EFFECT.
 * Bytes arriving from a network are `net.fetch`, which this repo's policy rates T2 —
 * previewed, authenticated, approved by the owner, and written into a receipt. An
 * installer that quietly opened a socket would be the one place in Zeno where an
 * agent reached the internet without the kernel noticing.
 *
 * So this module ingests from a FOLDER ALREADY ON DISK, and nothing else. The owner
 * clones, downloads, or unzips by whatever means they like — that is their machine
 * and their choice — and Zeno's job starts at the point where a folder of strangers'
 * prose wants to become part of what a model reads.
 *
 * THE NETWORK SEAM, LEFT DELIBERATELY OPEN
 * ----------------------------------------
 * A future `zeno skills add owner/repo` is a small piece of work and a specific shape:
 *
 *   1. Build an ActionRequest of kind `net.fetch`, targetRef the tarball URL, payload
 *      the resolved ref (a commit sha, never a moving branch), dataZones ['external'].
 *   2. Kernel preview → the owner sees the URL and the sha → approve → commit ONCE.
 *      The receipt is then the record of what was downloaded and when.
 *   3. Unpack into a temp directory, and hand that directory to `planInstall` below.
 *      Everything from that point on is already written.
 *
 * The one thing that must NOT happen is step 3 growing its own fetch. The seam is the
 * boundary: this file starts at a directory, and the only way bytes get into that
 * directory from off this machine is through a receipt.
 *
 * WHAT INGESTION ACTUALLY DECIDES
 * -------------------------------
 * Very little, on purpose. Every incoming skill is parsed and screened (loadLibrary
 * does both), and the plan reports what it found. It does not block a suspicious
 * skill: screening informs, it never decides — the same line `screen.ts` draws. What
 * the plan DOES refuse is silence. An id that already exists is a conflict the owner
 * resolves, never an overwrite that happens while they are not looking, because
 * replacing `pdf` with a different `pdf` changes what every future prompt says while
 * the library still lists the same twenty names.
 */
import type { Library, LoadedSkill } from './library.js';

export type InstallAction =
  /** Not installed here yet: copy it in. */
  | 'install'
  /** Already installed, byte-identical on every field that reaches a prompt. */
  | 'unchanged'
  /** An installed skill has this id and DIFFERENT content. The owner decides. */
  | 'conflict'
  /** A conflict the owner already said yes to, via `overwrite`. */
  | 'replace'
  /** It never parsed, so it is not a skill and cannot be installed. */
  | 'reject';

export interface InstallEntry {
  readonly id: string;
  /** The incoming skill's declared name, or null when it never parsed. */
  readonly name: string | null;
  readonly action: InstallAction;
  /** One sentence saying why this entry got that action. Always present. */
  readonly reason: string;
  /**
   * The screening verdict on the INCOMING prose. Null only for a reject, where
   * there was no parsed skill to screen. A `suspicious` entry is still installable
   * — the owner is told, and the gate downstream is unchanged.
   */
  readonly verdict: 'clean' | 'suspicious' | null;
  readonly findings: readonly { readonly rule: string; readonly severity: string; readonly why: string }[];
}

export interface InstallPlan {
  readonly entries: readonly InstallEntry[];
  /** The ids `applyInstallPlan` would actually copy — `install` plus `replace`. */
  readonly toCopy: readonly string[];
  /** Ids whose incoming prose tripped a screen rule. A view, not a decision. */
  readonly suspicious: readonly string[];
  /** Ids that could not be parsed at all, with their reasons. Nothing disappears. */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
  /** Ids already present with different content, awaiting the owner's call. */
  readonly conflicts: readonly string[];
}

export interface InstallOptions {
  /**
   * Replace an existing skill of the same id. Off by default: an install that can
   * silently rewrite what the agent reads is an install nobody reviewed.
   */
  readonly overwrite?: boolean;
}

/**
 * Two skills are "the same" when everything that reaches a prompt is the same.
 * `bytes` is deliberately excluded: a file that gained a trailing newline is not a
 * different skill, and reporting it as a conflict would train the owner to click
 * through conflicts.
 */
function sameContent(a: LoadedSkill, b: LoadedSkill): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.license === b.license &&
    a.body === b.body
  );
}

/**
 * Decide what ingesting `incoming` into `installed` would do. Pure: both sides are
 * already-loaded libraries, so a test can plan an install of a hostile library
 * without a hostile library existing anywhere on disk.
 */
export function planInstall(
  incoming: Library,
  installed: Library,
  opts: InstallOptions = {},
): InstallPlan {
  const have = new Map(installed.skills.map((s) => [s.id, s]));
  const entries: InstallEntry[] = [];

  for (const skill of incoming.skills) {
    const findings = skill.screen.findings.map((f) => ({ rule: f.rule, severity: f.severity, why: f.why }));
    const existing = have.get(skill.id);
    const base = { id: skill.id, name: skill.name, verdict: skill.screen.verdict, findings } as const;
    if (existing === undefined) {
      entries.push({ ...base, action: 'install', reason: 'new — no skill with this id is installed.' });
    } else if (sameContent(existing, skill)) {
      entries.push({ ...base, action: 'unchanged', reason: 'already installed, and identical.' });
    } else if (opts.overwrite === true) {
      entries.push({
        ...base,
        action: 'replace',
        reason: `replaces the installed "${existing.name}" — you asked for overwrite.`,
      });
    } else {
      entries.push({
        ...base,
        action: 'conflict',
        reason: `"${existing.name}" is already installed under this id with different text. Nothing was touched; re-run with overwrite to replace it, or rename the incoming folder.`,
      });
    }
  }

  for (const f of incoming.failed) {
    entries.push({ id: f.id, name: null, action: 'reject', reason: f.reason, verdict: null, findings: [] });
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    entries,
    toCopy: entries.filter((e) => e.action === 'install' || e.action === 'replace').map((e) => e.id),
    suspicious: entries.filter((e) => e.verdict === 'suspicious').map((e) => e.id),
    rejected: entries.filter((e) => e.action === 'reject').map((e) => ({ id: e.id, reason: e.reason })),
    conflicts: entries.filter((e) => e.action === 'conflict').map((e) => e.id),
  };
}

/** The plan as lines an owner can read before saying yes. No colour, no counts-only. */
export function describeInstallPlan(plan: InstallPlan): readonly string[] {
  const lines = plan.entries.map((e) => `${e.action.toUpperCase().padEnd(9)} ${e.id} — ${e.reason}`);
  for (const id of plan.suspicious) {
    const entry = plan.entries.find((e) => e.id === id);
    const rules = [...new Set((entry?.findings ?? []).map((f) => f.rule))].join(', ');
    lines.push(`SCREEN    ${id} — its own prose tripped: ${rules}. Installing it is allowed; reading it first is wiser.`);
  }
  return lines;
}
