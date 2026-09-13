/**
 * Turning one GitHub API issue object into Zeno's `WorkItem` shape, and
 * deciding what does not qualify as one. Split out of `github.ts` so the
 * "read untrusted JSON safely, and know a pull request when we see one" logic
 * sits by itself, next to the error vocabulary it borrows from
 * `github-errors.ts`.
 */
import type { WorkItem } from './work-item.js';
import { malformed } from './github-errors.js';
import { GITHUB_SOURCE } from './github-source-name.js';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * PULL REQUESTS ARE NOT ISSUES — and this endpoint returns both.
 *
 * In GitHub's data model every pull request IS an issue: it has an issue number
 * from the same sequence and comes back from `/issues` alongside real issues.
 * The only thing that distinguishes one is the `pull_request` key. Forgetting
 * this filter is the classic bug with this endpoint, and here it would be worse
 * than cosmetic: a PR would enter intake as a work item, get a TASK proposed
 * against it, and burn an approval on work that does not exist.
 */
export function isPullRequest(issue: Record<string, unknown>): boolean {
  const marker = issue['pull_request'];
  return marker !== undefined && marker !== null;
}

/**
 * Labels are decoration; the identity fields are not. A label array in an
 * unexpected shape costs a tag and is tolerated, whereas a missing `number`
 * costs the item its identity and is fatal below. That asymmetry is the whole
 * rule: degrade on what is cosmetic, refuse on what is load-bearing.
 */
function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    let name: string | null = null;
    if (typeof entry === 'string') name = entry;
    else {
      const record = asRecord(entry);
      const candidate = record?.['name'];
      if (typeof candidate === 'string') name = candidate;
    }
    const clean = name === null ? '' : name.trim();
    if (clean.length > 0 && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/**
 * Project one issue onto the port. Provider-shaped extras (node_id, reactions,
 * milestones) stop here on purpose: the moment they leak through, the port stops
 * being a port and becomes a second copy of GitHub's schema.
 *
 * Titles and bodies are attacker-controlled text and are carried through
 * VERBATIM. Sanitising here would corrupt the context a task is built from; the
 * capsule's `oneLine`/`toSummary` is where display-safety belongs.
 */
export function mapIssue(
  issue: Record<string, unknown>,
  owner: string,
  repo: string,
  url: string,
  status: number,
  index: number,
): WorkItem {
  const number = issue['number'];
  const title = issue['title'];
  const updatedAt = issue['updated_at'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw malformed(url, status, `entry ${index} has no usable "number"`);
  }
  if (typeof title !== 'string') throw malformed(url, status, `issue #${number} has no "title"`);
  if (typeof updatedAt !== 'string' || updatedAt.length === 0) {
    // updatedAt is the version marker `dedupe` keys on. Substituting a clock
    // reading would make every poll look like a change; substituting a constant
    // would make a real change look like none. Both are worse than saying so.
    throw malformed(url, status, `issue #${number} has no "updated_at", and that is the field dedupe keys on`);
  }
  const html = issue['html_url'];
  const body = issue['body'];
  return {
    id: `${GITHUB_SOURCE}:${owner}/${repo}#${number}`,
    source: GITHUB_SOURCE,
    title,
    // The API sends null for an issue with no description; the port wants a
    // string, and "" is the honest rendering of an empty body.
    body: typeof body === 'string' ? body : '',
    url: typeof html === 'string' && html.length > 0 ? html : null,
    updatedAt,
    labels: labelNames(issue['labels']),
  };
}
