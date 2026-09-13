/**
 * Ranking candidate local repositories against a task's own words.
 *
 * "Full-PC repo access" means Zeno can find the repository a task is about
 * without being pointed at it directly — but "any repository already on this
 * machine" is a big list, and guessing WHICH one a task means has to be
 * legible, not a black box the owner has to trust blind. This file is the
 * whole of that judgment call: given the directory names a scan turned up,
 * which ones does the task's own text name or imply, and by how much. The
 * scan itself — which directories exist, which have a `.git` — is the
 * daemon's job (see `routes/intake.ts`); this file never touches a
 * filesystem, so the ranking is testable as plain data in and plain data out.
 */

export interface RepoCandidate {
  /** The directory's own name — e.g. "weft", not the full path. */
  readonly name: string;
  /** Absolute path. Opaque here; the caller acts on it. */
  readonly path: string;
}

export interface RankedRepo extends RepoCandidate {
  /** Higher is a stronger match. A repo named nowhere in the task still gets 0 — see below. */
  readonly score: number;
  /** Which of the repo's own name-words appeared in the task, for the owner to check. */
  readonly matched: readonly string[];
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

/**
 * Rank every candidate against the task text.
 *
 * A repo whose name appears WHOLE in the task ("the weft build is broken")
 * scores highest; one that only shares a word from a hyphenated name scores
 * lower; a repo named nowhere in the text still comes back, at score 0 —
 * dropping it would make "no strong match" indistinguishable from "nothing is
 * on this machine at all", and only one of those is true.
 */
export function rankRepoCandidates(task: string, candidates: readonly RepoCandidate[]): readonly RankedRepo[] {
  const flat = task.toLowerCase();
  const taskWords = new Set(words(task));
  return candidates
    .map((c): RankedRepo => {
      const wholeName = c.name.length > 1 && flat.includes(c.name.toLowerCase());
      const matched = words(c.name).filter((w) => taskWords.has(w));
      const score = (wholeName ? 10 : 0) + matched.length * 3;
      return { ...c, score, matched };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
