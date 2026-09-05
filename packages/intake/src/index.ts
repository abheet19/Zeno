/**
 * Zeno · Intake — the WorkItem port and its adapters. Public surface.
 *
 * The port (`work-item.ts`) is pure and knows nothing about where work comes
 * from. The adapters below it are replaceable: `local` is the backlog on your own
 * disk, `github` is a repository's open issues, and a Jira adapter would be one
 * more implementation of the same two methods — never again a dependency the
 * rest of the product is built around.
 */
export {
  dedupe,
  oneLine,
  toSummary,
  workItemKey,
  type DedupeResult,
  type WorkItem,
  type WorkItemSource,
} from './work-item.js';
export {
  Backlog,
  LOCAL_SOURCE,
  foldBacklog,
  localId,
  localSource,
  normalizeId,
  parseBacklog,
  toWorkItem,
  type BacklogEntry,
  type BacklogParse,
  type BacklogState,
  type BacklogStore,
  type Clock,
} from './backlog.js';
export { backlogPath, backlogPathIn, nodeBacklogStore, systemClock } from './backlog-node-fs.js';
export {
  GITHUB_SOURCE,
  GithubSourceError,
  githubSource,
  type GithubFailure,
  type GithubSourceOptions,
} from './github.js';
