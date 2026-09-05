/**
 * Discovery: a folder of skills becomes a list the owner can actually look at.
 *
 * There is no `fs` in this file, on purpose. Reading is injected as a `SkillReader`,
 * so the whole of discovery — which files exist, which parsed, which screened dirty,
 * what order they appear in — is a pure function of what the reader returned, and a
 * test can hand it a hostile library without writing a hostile library to disk.
 *
 * The load-bearing rule here is that NOTHING DISAPPEARS. A file that will not parse
 * goes into `failed` with the reason, never into a swallowed catch. An empty library
 * and an unreadable one are different facts about the machine: the first says the
 * owner installed nothing, the second says something on disk is broken or lying, and
 * a loader that reported both as "no skills" would hide exactly the case worth
 * seeing. The same applies to anything that throws while one skill is being loaded —
 * a locked file, a bad id, or a parser meeting a document larger than it was built
 * for — which is recorded as a failure of that one skill rather than of the whole
 * library. A loader that let one exception escape would turn nineteen good skills into
 * a stack trace, which is the loudest possible way to disappear.
 */
import { parseSkill, type Skill } from './parse.js';
import { screen, type ScreenResult } from './screen.js';

/**
 * The only capability this module needs: name the installed skills, and hand over
 * the raw text of one. `read` MAY throw; the loader treats that as a fact to report.
 */
export interface SkillReader {
  list(): string[];
  read(id: string): string;
}

/** A parsed skill plus what its own prose asked for. */
export interface LoadedSkill extends Skill {
  readonly screen: ScreenResult;
}

export interface FailedSkill {
  readonly id: string;
  readonly reason: string;
}

export interface Library {
  readonly skills: readonly LoadedSkill[];
  readonly failed: readonly FailedSkill[];
}

/**
 * Codepoint order, tie-broken by id. Deliberately NOT `localeCompare`: the order two
 * skills appear in must not depend on the machine's locale, because this list is what
 * the owner reads before approving anything and a list that reshuffles itself between
 * runs is a list nobody can review by diffing.
 */
function byNameThenId(a: LoadedSkill, b: LoadedSkill): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Whatever a thrown value turns out to be, said in one line a human can act on. */
function reasonFrom(err: unknown, doing: string): string {
  return `${doing}: ${err instanceof Error ? err.message : String(err)}`;
}

export function loadLibrary(reader: SkillReader): Library {
  const skills: LoadedSkill[] = [];
  const failed: FailedSkill[] = [];
  for (const id of reader.list()) {
    let raw: string;
    try {
      raw = reader.read(id);
    } catch (err) {
      failed.push({ id, reason: reasonFrom(err, 'could not be read') });
      continue;
    }
    // parseSkill and screen are both total by contract — every malformed document is
    // supposed to come back as `{ ok: false }`, never as a throw. This catch is here
    // because the contract is a promise about code, and the input is a stranger's file
    // of unbounded size. If one of them ever breaks that promise, the cost must be one
    // skill in `failed` with the reason attached, not twenty skills vanishing and an
    // exception where the owner expected a list. Nothing disappears is the rule; a rule
    // that only holds while every other function behaves is not a rule.
    let loaded: LoadedSkill;
    try {
      const parsed = parseSkill(raw, id);
      if (!parsed.ok) {
        failed.push({ id, reason: parsed.reason });
        continue;
      }
      loaded = { ...parsed.skill, screen: screen(parsed.skill) };
    } catch (err) {
      failed.push({ id, reason: reasonFrom(err, 'could not be parsed or screened') });
      continue;
    }
    skills.push(loaded);
  }
  skills.sort(byNameThenId);
  failed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { skills, failed };
}

/** The skills whose prose tripped at least one screen rule. A view, not a decision. */
export function suspicious(library: Library): readonly LoadedSkill[] {
  return library.skills.filter((s) => s.screen.verdict === 'suspicious');
}
