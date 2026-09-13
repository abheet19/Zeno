/**
 * The adapter name a GitHub item reports as its `WorkItem.source`.
 *
 * Its own leaf module so `github-issue.ts` (which stamps it onto every mapped
 * `WorkItem`) and `github.ts` (which re-exports it and names the feed) can both
 * import it without either depending on the other.
 */
export const GITHUB_SOURCE = 'github';
