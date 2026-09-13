/**
 * Autonomous intake: given a TASK in the owner's own words, gather what a
 * human would gather by hand before starting it — the GitHub issue or Jira
 * ticket it names, what the owner's connected NeoSapien memory already knows
 * about it, and which local repository on this machine it is probably about
 * — instead of the owner pointing Zeno at each of those separately.
 *
 * NOTHING HERE STARTS A RUN. This is read-only research, the same shape as
 * `/forge/plan`'s read-only pass before any worktree exists: it answers "here
 * is what I found". Turning a gathered task into a Forge run is still the
 * owner's own click, through the ordinary composer — this route proposes
 * nothing and holds nothing for approval, because it changes nothing.
 *
 * HONESTY OVER COMPLETENESS, the same rule `@abheet19/zeno-intake`'s GitHub
 * adapter keeps for its own poll. GitHub works unauthenticated for a public
 * repository. Jira and NeoSapien both need a credential this daemon does not
 * fabricate; when either is unset, this route says so plainly (`not-configured`)
 * rather than silently returning nothing that looks like an empty answer.
 * Repository detection is a BOUNDED scan of a small, honestly-reported set of
 * roots — an owner-configured list (`ZENO_PROJECT_ROOTS`), plus the selected
 * repository's own parent and a few common project folders — never the whole
 * disk, and the roots it actually managed to read are reported back, so "no
 * match" and "could not look" are never the same answer.
 */
import { homedir } from 'node:os';
import { existsSync, opendirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  fetchJiraIssue,
  findGithubReference,
  findJiraReference,
  jiraEnvFrom,
  rankRepoCandidates,
  type GithubReference,
  type JiraResult,
  type RepoCandidate,
} from '@abheet19/zeno-intake';
import type { ServerCtx } from '../server/context.js';
import { json, readJson, str } from './http.js';
import { searchNeosapienMemories } from './neosapien.js';

const REQUEST_TIMEOUT_MS = 10_000;
/** A bounded set of roots, never the whole disk. */
const MAX_ROOTS = 8;
/** Per root, so one enormous folder cannot make a scan run away. */
const MAX_ENTRIES_PER_ROOT = 300;
const MAX_CANDIDATES = 200;
/** How many ranked repositories the response carries. */
const MAX_REPORTED = 20;

/**
 * The roots a scan will look under: the owner's own list
 * (`ZENO_PROJECT_ROOTS`, semicolon- or comma-separated), the selected
 * repository's own parent directory (so sibling projects are found without
 * any configuration at all), and a small set of common project folders.
 * Deduplicated and capped — see `MAX_ROOTS`.
 */
function projectRoots(sandbox: string): string[] {
  const home = homedir();
  const configured = (process.env['ZENO_PROJECT_ROOTS'] ?? '')
    .split(/[;,]/).map((s) => s.trim()).filter((s) => s !== '');
  const defaults = [dirname(sandbox), join(home, 'code'), join(home, 'Code'), join(home, 'projects'), join(home, 'Projects')];
  const all = [...configured, ...defaults].map((p) => resolve(p));
  return [...new Set(all)].slice(0, MAX_ROOTS);
}

/**
 * One level deep under each root: directories that carry their own `.git`.
 * A root that does not exist, or cannot be read, is reported as
 * `unreadableRoots` rather than silently contributing zero candidates —
 * "nothing here" and "could not look here" are different facts.
 */
function scanRepos(roots: readonly string[]): {
  readonly candidates: RepoCandidate[];
  readonly scannedRoots: readonly string[];
  readonly unreadableRoots: readonly string[];
} {
  const candidates: RepoCandidate[] = [];
  const scannedRoots: string[] = [];
  const unreadableRoots: string[] = [];
  for (const root of roots) {
    let handle: ReturnType<typeof opendirSync> | undefined;
    try {
      handle = opendirSync(root);
      scannedRoots.push(root);
      let count = 0;
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        if (++count > MAX_ENTRIES_PER_ROOT) break;
        if (!entry.isDirectory()) continue;
        const path = join(root, entry.name);
        try {
          if (existsSync(join(path, '.git'))) candidates.push({ name: entry.name, path });
        } catch { /* an unreadable child folder is simply not a candidate */ }
        if (candidates.length >= MAX_CANDIDATES) break;
      }
    } catch {
      unreadableRoots.push(root);
    } finally {
      try { handle?.closeSync(); } catch { /* the scan result already stands */ }
    }
  }
  return { candidates, scannedRoots, unreadableRoots };
}

function isDeadline(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * One GitHub issue, by the reference a task named — not a poll, a single
 * lookup, mirroring the honesty (never silently empty) of
 * `@abheet19/zeno-intake`'s own GitHub adapter without duplicating its whole
 * pagination machinery for a job that never paginates.
 */
async function gatherGithub(ref: GithubReference | null): Promise<Record<string, unknown> | null> {
  if (ref === null) return null;
  const token = (process.env['ZENO_GITHUB_TOKEN'] ?? '').trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'zeno-intake/0.1',
    'x-github-api-version': '2022-11-28',
  };
  if (token !== '') headers['authorization'] = `Bearer ${token}`;
  const url = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/issues/${ref.number}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) {
      return {
        ref, ok: false,
        reason: res.status === 404 ? 'not-found' : res.status === 401 || res.status === 403 ? 'unauthorized' : 'http-error',
        message: `GitHub answered ${res.status} for ${ref.owner}/${ref.repo}#${ref.number}.`,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      ref, ok: true,
      title: body['title'] ?? null,
      number: body['number'] ?? ref.number,
      state: body['state'] ?? null,
      url: body['html_url'] ?? null,
      body: typeof body['body'] === 'string' ? body['body'].slice(0, 2_000) : '',
    };
  } catch (err) {
    return {
      ref, ok: false,
      reason: isDeadline(err) ? 'timeout' : 'unreachable',
      message: isDeadline(err)
        ? `GitHub did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : `Could not reach GitHub: ${err instanceof Error ? err.message : err}.`,
    };
  }
}

export async function postIntakeGather(ctx: ServerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const task = str(body, 'task');
  if (task === null || task.trim() === '') {
    return json(res, 400, {
      error: {
        code: 'bad-request',
        message: 'Gathering context needs a task.',
        resolve: 'POST {"task":"fix the flaky login test, owner/repo#482"}.',
      },
    });
  }

  const githubRef = findGithubReference(task);
  const jiraRef = findJiraReference(task);

  const [github, jira, neosapien] = await Promise.all([
    gatherGithub(githubRef),
    jiraRef !== null
      ? fetchJiraIssue(jiraRef.key, jiraEnvFrom(process.env))
      : Promise.resolve<JiraResult | null>(null),
    searchNeosapienMemories(task),
  ]);

  const roots = projectRoots(ctx.opts.sandbox);
  const { candidates, scannedRoots, unreadableRoots } = scanRepos(roots);
  const ranked = rankRepoCandidates(task, candidates).slice(0, MAX_REPORTED);

  json(res, 200, {
    task,
    references: { github: githubRef, jira: jiraRef },
    github,
    jira,
    neosapien: neosapien.ok
      ? { ok: true, hits: neosapien.hits }
      : { ok: false, reason: neosapien.reason, message: neosapien.message },
    repos: {
      scannedRoots,
      unreadableRoots,
      candidates: ranked,
      note: candidates.length === 0
        ? `No local repository (a directory with its own .git) was found under: ${scannedRoots.join(', ') || '(no root could be read)'}. `
          + 'Set ZENO_PROJECT_ROOTS (semicolon- or comma-separated) to add more places to look.'
        : null,
    },
  });
}
