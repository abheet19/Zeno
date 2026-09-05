/**
 * Zeno Skills — an agent skill is knowledge, never capability.
 *
 * A skill is a folder of prose a stranger wrote, installed with one command, fed
 * straight into a model prompt. The CLI that installs them says so out loud: review
 * skills before use, they run with full agent permissions. This package is Zeno's
 * answer to that sentence, in four small pieces:
 *
 *   parseSkill       — read one SKILL.md, tolerantly, and say plainly when it is broken
 *   screen           — show the owner the text that reaches for the gate (informs, never blocks)
 *   loadLibrary      — a whole folder, with nothing silently disappearing
 *   buildSkillPrompt — hand a skill to a model as quoted DATA, with the owner's task last
 *
 * None of it is what makes running a skill safe. The kernel is: classify, preview,
 * approve, commit once, sign a receipt — and an agent may propose but never approve.
 * A skill can add to what an agent KNOWS. Nothing here, and nothing a skill can say,
 * adds to what an agent may DO.
 */
export { parseSkill, type Skill, type ParseResult } from './parse.js';
export {
  screen,
  SCREEN_RULES,
  MAX_QUOTE_CHARS,
  type Severity,
  type Verdict,
  type Finding,
  type ScreenResult,
  type ScreenRule,
} from './screen.js';
export {
  loadLibrary,
  suspicious,
  type SkillReader,
  type LoadedSkill,
  type FailedSkill,
  type Library,
} from './library.js';
export { buildSkillPrompt, MAX_SKILL_BODY_CHARS } from './prompt.js';
export { nodeSkillReader, SKILL_FILE } from './skills-node.js';
