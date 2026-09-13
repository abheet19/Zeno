/**
 * Reading a WORK-ITEM REFERENCE out of a task's own words.
 *
 * Autonomous intake starts from a sentence the owner typed, not a form: "fix
 * the flaky test in owner/repo#482" or "clear out ZENO-118 before the demo".
 * This file is the one place that reads such a sentence for a GitHub issue
 * reference or a Jira ticket key, so the daemon route that gathers context for
 * it — and every future caller — parses text exactly once, the same way,
 * rather than each growing its own regex.
 *
 * Deliberately narrow, the same discipline `@abheet19/zeno-assistant`'s
 * `actionable-request.ts` uses: a reference must match one of a small number
 * of well-known SHAPES, or nothing is read from the sentence at all. Guessing
 * wrong here would send a network request built from a false positive;
 * finding nothing costs only the owner typing the reference again.
 *
 * Pure: a string in, structure or nothing out. No fetch, no fs, no clock.
 */

export interface GithubReference {
  readonly kind: 'github';
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface JiraReference {
  readonly kind: 'jira';
  readonly key: string;
}

/** `owner/repo#123` — the shape the owner types most often. */
const GITHUB_SHORT = /\b([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})#(\d{1,10})\b/;
/** The same reference, pasted as a github.com issue or pull-request URL. */
const GITHUB_URL = /\bhttps?:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/(?:issues|pull)\/(\d{1,10})\b/i;

/** A Jira issue key: a project prefix in capitals, a hyphen, then digits. */
const JIRA_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/;
/** Shapes that fit JIRA_KEY but name no project — refused rather than guessed at. */
const JIRA_STOPWORDS = new Set(['UTF-8', 'ISO-8', 'UTC-8', 'GMT-8']);

/** A GitHub issue/PR reference, whichever shape the owner used, or `null`. */
export function findGithubReference(text: string): GithubReference | null {
  const url = GITHUB_URL.exec(text);
  if (url) {
    const owner = url[1];
    const repo = url[2];
    const num = url[3];
    if (owner && repo && num) return { kind: 'github', owner, repo, number: Number(num) };
  }
  const short = GITHUB_SHORT.exec(text);
  if (short) {
    const owner = short[1];
    const repo = short[2];
    const num = short[3];
    if (owner && repo && num) return { kind: 'github', owner, repo, number: Number(num) };
  }
  return null;
}

/** A Jira ticket key named in the text, or `null`. */
export function findJiraReference(text: string): JiraReference | null {
  const m = JIRA_KEY.exec(text);
  const key = m?.[1];
  if (key === undefined || JIRA_STOPWORDS.has(key)) return null;
  return { kind: 'jira', key };
}
