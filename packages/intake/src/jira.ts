/**
 * The JIRA single-issue lookup — reads ONE ticket a task already named, never
 * a backlog.
 *
 * Unlike `github.ts`, this is not a `WorkItemSource`: autonomous intake is not
 * polling a Jira project the way it polls a GitHub repo's open issues, it is
 * fetching the ONE ticket a task's own words referenced (see `reference.ts`).
 * Same honesty rule as every other adapter in this package: a failed call
 * must never look like an empty result, and every failure carries a distinct,
 * actionable reason a caller can branch on.
 *
 * ALWAYS REQUIRES CREDENTIALS — and that is a fact about Jira, not a gap in
 * this file. Unlike GitHub's public-repo mode, Jira Cloud's REST API needs a
 * site URL, an account email and an API token on every request; there is no
 * unauthenticated read to fall back to. So "not configured" is the expected,
 * honest answer on a machine that has never connected one — this codebase's
 * own history is exactly that machine (see docs/00-DECISIONS.md: the Jira
 * account this product once depended on "went away with the account", which
 * is why the flagship journey no longer assumes one exists). Setting three
 * environment variables turns this adapter on for real; nothing here
 * fabricates a connection that is not there.
 */
import { oneLine } from './work-item.js';

export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  readonly description: string;
  readonly status: string;
  readonly url: string;
}

export type JiraFailureReason = 'not-configured' | 'not-found' | 'unauthorized' | 'timeout' | 'unreachable' | 'malformed';

export type JiraResult =
  | { readonly ok: true; readonly issue: JiraIssue }
  | { readonly ok: false; readonly reason: JiraFailureReason; readonly message: string };

/** What `fetchJiraIssue` reads out of the environment. Every field optional —
 *  a caller with none of them is exactly the "not configured" case. */
export interface JiraEnv {
  readonly baseUrl?: string | undefined;
  readonly email?: string | undefined;
  readonly apiToken?: string | undefined;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Longest quoted fragment of the ticket's own text this adapter will carry. */
const DESCRIPTION_LIMIT = 2_000;

function isDeadline(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * Flatten Jira's Atlassian Document Format description into plain text — just
 * enough to be readable in a gathered-context summary, never a full renderer.
 * Any shape this does not recognise contributes nothing rather than throwing,
 * because a ticket whose description this adapter cannot parse is still a
 * ticket that was found.
 */
function flattenAdf(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenAdf).join(' ');
  if (typeof node !== 'object' || node === null) return '';
  const rec = node as Record<string, unknown>;
  if (typeof rec['text'] === 'string') return rec['text'];
  if (Array.isArray(rec['content'])) return flattenAdf(rec['content']);
  return '';
}

/** Read the three Jira variables out of an environment object. Pure: takes
 *  the map as an argument rather than reading `process.env` itself, exactly
 *  like `work.ts`'s `githubFromEnv` in the daemon. */
export function jiraEnvFrom(env: Readonly<Record<string, string | undefined>>): JiraEnv {
  return {
    baseUrl: env['ZENO_JIRA_BASE_URL'],
    email: env['ZENO_JIRA_EMAIL'],
    apiToken: env['ZENO_JIRA_API_TOKEN'],
  };
}

/**
 * Fetch one Jira issue by key. Always safe to call: with any of the three
 * credentials missing this returns `not-configured` immediately, with no
 * network request attempted at all.
 */
export async function fetchJiraIssue(key: string, env: JiraEnv, fetchImpl: typeof fetch = fetch): Promise<JiraResult> {
  const baseUrl = (env.baseUrl ?? '').trim().replace(/\/+$/, '');
  const email = (env.email ?? '').trim();
  const apiToken = (env.apiToken ?? '').trim();
  if (baseUrl === '' || email === '' || apiToken === '') {
    return {
      ok: false,
      reason: 'not-configured',
      message: 'Jira is not connected to this daemon — set ZENO_JIRA_BASE_URL, ZENO_JIRA_EMAIL and ZENO_JIRA_API_TOKEN to enable it.',
    };
  }

  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}`;
  const auth = Buffer.from(`${email}:${apiToken}`, 'utf8').toString('base64');
  try {
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 404) {
      return { ok: false, reason: 'not-found', message: `${key} was not found, or this account cannot see it.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'unauthorized', message: `Jira refused this credential for ${key} (${res.status}).` };
    }
    if (!res.ok) {
      return { ok: false, reason: 'unreachable', message: `Jira answered ${res.status} for ${key}.` };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'malformed', message: `Jira's answer for ${key} was not valid JSON.` };
    }
    if (typeof body !== 'object' || body === null) {
      return { ok: false, reason: 'malformed', message: `Jira's answer for ${key} was not an issue.` };
    }
    const fields = ((body as Record<string, unknown>)['fields'] ?? {}) as Record<string, unknown>;
    const summary = typeof fields['summary'] === 'string' ? oneLine(fields['summary']) : '(no summary)';
    const statusName = (fields['status'] as { name?: unknown } | undefined)?.name;
    const description = flattenAdf(fields['description']).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_LIMIT);
    return {
      ok: true,
      issue: {
        key,
        summary,
        description,
        status: typeof statusName === 'string' ? statusName : 'unknown',
        url: `${baseUrl}/browse/${key}`,
      },
    };
  } catch (err) {
    if (isDeadline(err)) {
      return { ok: false, reason: 'timeout', message: `Jira did not answer for ${key} within ${REQUEST_TIMEOUT_MS / 1000}s.` };
    }
    return { ok: false, reason: 'unreachable', message: `Could not reach Jira for ${key}: ${err instanceof Error ? err.message : err}.` };
  }
}
