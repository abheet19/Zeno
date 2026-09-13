/**
 * Zeno · Intake — the WorkItem port and its adapters. Public surface.
 *
 * The port (`work-item.ts`) is pure and knows nothing about where work comes
 * from. The adapters below it are replaceable: `local` is the backlog on your own
 * disk, `github` is a repository's open issues, and a Jira adapter would be one
 * more implementation of the same two methods — never again a dependency the
 * rest of the product is built around.
 *
 * AUTONOMOUS INTAKE. `reference.ts` reads a GitHub or Jira reference out of a
 * task's own words; `jira.ts` is a single-issue Jira lookup (not a poller —
 * see its own header for why Jira, unlike GitHub, always needs a credential);
 * `repo-match.ts` ranks candidate local repositories a scan turned up against
 * that same task text. All three are used by the daemon's `/intake/gather`
 * route (`routes/intake.ts`) to gather what a human would gather by hand
 * before starting a task, instead of the owner pointing Zeno at each source.
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
export {
  fetchJiraIssue,
  jiraEnvFrom,
  type JiraEnv,
  type JiraFailureReason,
  type JiraIssue,
  type JiraResult,
} from './jira.js';
export {
  findGithubReference,
  findJiraReference,
  type GithubReference,
  type JiraReference,
} from './reference.js';
export {
  rankRepoCandidates,
  type RankedRepo,
  type RepoCandidate,
} from './repo-match.js';
