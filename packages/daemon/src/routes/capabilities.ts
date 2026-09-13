/**
 * Command's Customize screen, made real: a repository rule or an Agent Skill
 * is AUTHORED here and lands as an ordinary file-write proposal through
 * `proposeFileWrite` — the same jail, risk assessment, secret scan, kernel
 * preview, hold, owner approval and receipt every other write gets. Nothing in
 * this module touches the sandbox itself; it only shapes a path and a body and
 * hands them to the gate.
 *
 * Both writes are always HELD (never routine). A rule file is folded into every
 * future run's prompt and a SKILL.md is prose fed to a model with the run's
 * permissions — the kernel already treats CLAUDE.md/AGENTS.md as sensitive for
 * exactly that reason, and a rule folder or a skill folder is the same fact
 * wearing a different path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseSkill, screen } from '@abheet19/zeno-skills';
import type { Role } from '../tokens.js';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { proposeFileWrite } from './approvals.js';
import { RULE_CONVENTIONS } from './forge-context.js';

/** One folder name: what `nodeSkillReader` lists and what a rule folder accepts. */
const NUL = String.fromCharCode(0);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_CHARS = 64;
const MAX_LINE_CHARS = 200;
/** The same cap `projectRules` reads a rule with — a bigger file would be truncated anyway. */
const MAX_RULE_CHARS = 64_000;
/** Under the skill reader's 128,000-byte source limit, with room for multibyte text. */
const MAX_SKILL_CHARS = 100_000;

const RULE_HOLD = 'A repository rule is folded into every future Forge run — never a routine edit.';
const SKILL_HOLD = 'A skill is prose handed to a model with the run’s permissions — installing one is never a routine edit.';

function bad(res: ServerResponse, message: string, resolve: string): void {
  json(res, 400, { error: { code: 'bad-request', message, resolve } });
}

function tooLarge(res: ServerResponse, what: string, limit: number): void {
  json(res, 413, {
    error: { code: 'too-large', message: `${what} is too long.`, resolve: `Keep it under ${limit.toLocaleString('en-US')} characters.` },
  });
}

/** Same surface labelling /previews uses: the window proposed, or an agent did. */
function requestedBy(role: Role): string {
  return role === 'owner' ? 'window' : 'agent';
}

function oneLine(value: string | null): value is string {
  return value !== null && value.trim() !== '' && !/[\r\n]/.test(value) && !value.includes(NUL) && value.length <= MAX_LINE_CHARS;
}

export function serveRuleConventions(res: ServerResponse): void {
  json(res, 200, { conventions: RULE_CONVENTIONS });
}

/**
 * POST /capabilities/rules { convention, name?, text }
 * `convention` is one of RULE_CONVENTIONS' paths. A directory convention also
 * needs `name` (kebab-case) and gets that directory's extension.
 */
export async function postRule(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const convention = str(body, 'convention');
  const text = str(body, 'text');
  const name = str(body, 'name');
  const conv = RULE_CONVENTIONS.find((c) => c.path === convention);
  if (conv === undefined) {
    return bad(res, 'A rule needs a known convention.', `Pick one of: ${RULE_CONVENTIONS.map((c) => c.path).join(', ')}.`);
  }
  if (text === null || text.trim() === '') {
    return bad(res, 'A rule needs text.', 'Write the rule the way you would say it to a colleague.');
  }
  if (text.length > MAX_RULE_CHARS || text.includes(NUL)) return tooLarge(res, 'The rule', MAX_RULE_CHARS);
  let relPath = conv.path;
  if (conv.kind === 'dir') {
    if (name === null || !KEBAB.test(name) || name.length > MAX_ID_CHARS) {
      return bad(res, 'A rule in a rule folder needs a kebab-case file name.', `Something like "no-console-logs" — it becomes ${conv.path}/<name>${conv.extension}.`);
    }
    relPath = `${conv.path}/${name}${conv.extension}`;
  }
  const contents = text.endsWith('\n') ? text : `${text}\n`;
  const out = await proposeFileWrite(ctx, relPath, contents, `Customize: write rule ${relPath}`, requestedBy(role), { hold: RULE_HOLD });
  json(res, 200, { relPath, ...out });
}

/**
 * POST /capabilities/skills { id, name, description, instructions }
 * Writes `.agents/skills/<id>/SKILL.md` with the same front-matter the skill
 * reader requires, parsed and screened BEFORE it is proposed so a file that
 * would not load — or that reaches for the gate — is said so up front.
 */
export async function postSkill(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role): Promise<void> {
  const body = await readJson(req);
  const id = str(body, 'id');
  const name = str(body, 'name');
  const description = str(body, 'description');
  const instructions = str(body, 'instructions');
  if (id === null || !KEBAB.test(id) || id.length > MAX_ID_CHARS) {
    return bad(res, 'A skill needs a kebab-case id.', 'Lower-case letters, digits and single hyphens, e.g. "review-migrations" — it names the folder under .agents/skills.');
  }
  if (!oneLine(name)) return bad(res, 'A skill needs a one-line name.', 'A short human name, on one line.');
  if (!oneLine(description)) return bad(res, 'A skill needs a one-line description.', 'One sentence saying when the skill applies — it is what a task is matched against.');
  if (instructions === null || instructions.trim() === '') {
    return bad(res, 'A skill needs instructions.', 'The markdown body a model reads after the front-matter.');
  }
  if (instructions.length > MAX_SKILL_CHARS || instructions.includes(NUL)) return tooLarge(res, 'The instructions', MAX_SKILL_CHARS);
  const contents = `---\nname: ${name.trim()}\ndescription: ${description.trim()}\n---\n\n${instructions.trim()}\n`;
  const parsed = parseSkill(contents, id);
  if (!parsed.ok) return bad(res, `That SKILL.md would not load: ${parsed.reason}`, 'Adjust the fields and try again.');
  const verdict = screen(parsed.skill);
  const relPath = `.agents/skills/${id}/SKILL.md`;
  const out = await proposeFileWrite(ctx, relPath, contents, `Customize: install skill ${id}`, requestedBy(role), { hold: SKILL_HOLD });
  json(res, 200, {
    relPath,
    id,
    screening: { verdict: verdict.verdict, findings: verdict.findings.map((f) => ({ rule: f.rule, severity: f.severity, why: f.why })) },
    ...out,
  });
}

/** The one seam server.ts calls; true when the path was one of ours. */
export async function handleCapabilities(
  ctx: ServerCtx, req: IncomingMessage, res: ServerResponse, role: Role, path: string,
): Promise<boolean> {
  if (req.method === 'GET' && path === '/capabilities/conventions') { serveRuleConventions(res); return true; }
  if (req.method === 'POST' && path === '/capabilities/rules') { await postRule(ctx, req, res, role); return true; }
  if (req.method === 'POST' && path === '/capabilities/skills') { await postSkill(ctx, req, res, role); return true; }
  return false;
}
