/**
 * The daemon's WORK DESK — where the WorkItem port meets the loopback API.
 *
 * The flagship journey used to begin "a Jira ticket is assigned to me". That
 * sentence died with the Jira account, and the lesson was that the trigger was
 * never Jira: it was A WORK ITEM I OWN HAS ARRIVED. This file is the composition
 * point for that trigger — the local backlog on disk, plus a GitHub feed when
 * one is configured, folded into one answer for `GET /work`.
 *
 * THE RULE THIS FILE EXISTS TO KEEP, inherited from `github.ts`: a source that
 * could not be asked must never render as a source with nothing to say. So the
 * answer carries a `sources` report alongside the items, one entry per source,
 * saying for each whether it was asked and what happened. A caller that reads
 * only `items` can still check `complete` in one comparison.
 *
 * A failure in one source never suppresses another: a GitHub outage must not
 * empty a backlog that lives on your own disk.
 */
import {
  Backlog,
  GITHUB_SOURCE,
  GithubSourceError,
  LOCAL_SOURCE,
  backlogPathIn,
  githubSource,
  nodeBacklogStore,
  systemClock,
  toWorkItem,
  type WorkItem,
  type WorkItemSource,
} from '@abheet19/zeno-intake';

/**
 * What happened to one source on one poll.
 *
 * `not-configured` is a first-class state and NOT a kind of failure: nobody
 * asked for GitHub, so nothing is wrong, and saying "ok, 0 items" there would be
 * the exact lie this file is built to prevent.
 *
 * `partial` is the third fact this route has to be able to state. A source can
 * answer and still not answer fully — a backlog file with lines the parser
 * cannot read hands back a list with a known hole in it. That is neither `ok`
 * (which promises the list is whole) nor `failed` (which promises nothing came
 * back), and collapsing it into either one is the same lie in a smaller coat.
 */
export type SourceState = 'ok' | 'partial' | 'failed' | 'not-configured';

export interface SourceReport {
  /** The FEED's name — `local`, or `github:owner/repo`. */
  readonly name: string;
  readonly state: SourceState;
  /** How many items this source contributed. null when it did not answer. */
  readonly count: number | null;
  /** Words for a human, whenever there is something to say. */
  readonly detail?: string;
  /** The adapter's machine-readable cause, when it gave one. Branch on this. */
  readonly reason?: string;
}

export interface WorkReport {
  readonly items: readonly WorkItem[];
  /** One entry per source, always — including the ones that were never asked. */
  readonly sources: readonly SourceReport[];
  /**
   * True only when every source that was asked answered IN FULL. A caller that
   * reads `items` without reading this is reading a list that may be short —
   * and short because a source failed, or short because a source could only be
   * read in part. One boolean has to cover both, because a caller that has to
   * remember to also check for a second kind of shortness will not.
   */
  readonly complete: boolean;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The backlog, plus at most one remote feed.
 *
 * One remote is deliberate: a second feed is a second `WorkItemSource` and this
 * class would grow a list, which is a change to make when a second feed exists
 * and not before.
 */
export class WorkDesk {
  constructor(
    private readonly backlog: Backlog,
    /** The configured remote feed, or null when there is none. */
    private readonly remote: WorkItemSource | null = null,
  ) {}

  /**
   * Add a local item.
   *
   * RELOAD FIRST. `Backlog` rebuilds the whole file from the bytes it last read,
   * and the CLI writes this same file from another process. Appending onto stale
   * bytes would replace whatever the CLI added a second ago with a file that
   * never contained it. Re-reading immediately before the append does not make
   * this atomic across processes — it narrows the window to the write itself,
   * which is the honest cheap fix for a single-user local product.
   */
  add(title: string, body = '', labels: readonly string[] = []): WorkItem {
    this.backlog.reload();
    return toWorkItem(this.backlog.add(title, body, labels));
  }

  /** Every open item every source will admit to, and the truth about each source. */
  async list(): Promise<WorkReport> {
    const items: WorkItem[] = [];
    const sources: SourceReport[] = [this.readLocal(items)];
    sources.push(await this.readRemote(items));
    // Whitelisted, not blacklisted. `!== 'failed'` would silently welcome every
    // state added after it — `partial` was exactly such a state — and a boolean
    // that quietly says "complete" about a case nobody has thought about yet is
    // the failure mode this whole file is a response to.
    return {
      items,
      sources,
      complete: sources.every((s) => s.state === 'ok' || s.state === 'not-configured'),
    };
  }

  /**
   * The local backlog. It is a disk read, so it can fail — a locked file, a
   * permission change — and a failure here is reported exactly like a remote
   * one rather than passed off as an empty backlog.
   */
  private readLocal(into: WorkItem[]): SourceReport {
    try {
      this.backlog.reload();
      const open = this.backlog.listOpen().map(toWorkItem);
      into.push(...open);
      const damaged = this.backlog.skippedLines();
      // Unreadable lines cost items, so they are never left unsaid — and saying
      // it only in `detail` is not saying it. `detail` is prose for a human;
      // `state` and `complete` are what a caller branches on, and a list that is
      // knowably missing items must be short in the fields that get READ, not
      // only in the one that gets rendered.
      if (damaged > 0) {
        return {
          name: LOCAL_SOURCE,
          state: 'partial',
          count: open.length,
          reason: 'damaged-lines',
          // They stay in the file: this reports damage, it does not repair it.
          detail: `${damaged} line${damaged === 1 ? '' : 's'} in the backlog file could not be read and ${damaged === 1 ? 'was' : 'were'} skipped. They are still in the file, and the items they held are missing from this list.`,
        };
      }
      return { name: LOCAL_SOURCE, state: 'ok', count: open.length };
    } catch (err) {
      return { name: LOCAL_SOURCE, state: 'failed', count: null, detail: describe(err) };
    }
  }

  private async readRemote(into: WorkItem[]): Promise<SourceReport> {
    if (this.remote === null) {
      return {
        name: GITHUB_SOURCE,
        state: 'not-configured',
        count: null,
        detail: 'GitHub was never asked: ZENO_GITHUB_REPO is not set. This list is the local backlog only.',
      };
    }
    try {
      const got = await this.remote.list();
      into.push(...got);
      return { name: this.remote.name, state: 'ok', count: got.length };
    } catch (err) {
      // Caught, never rethrown: the local backlog is already in `into`, and
      // dropping it because a network call failed would be the outage taking
      // work with it — the thing the whole port exists to stop happening twice.
      return {
        name: this.remote.name,
        state: 'failed',
        count: null,
        detail: describe(err),
        ...(err instanceof GithubSourceError ? { reason: err.reason } : {}),
      };
    }
  }
}

/**
 * Read the GitHub feed out of the environment.
 *
 *   ZENO_GITHUB_REPO="owner/repo"   the only required variable
 *   ZENO_GITHUB_TOKEN               optional; a public repo reads without one
 *   ZENO_GITHUB_ASSIGNEE            optional; narrows to one login's issues
 *
 * Unset means null, and null means the desk reports `not-configured` — no
 * request, no pretending. But SET AND UNUSABLE throws, because the owner asked
 * for a feed: starting anyway would give them a daemon that quietly never
 * consults the source they configured, which is the failure mode this whole
 * build is a response to.
 *
 * Takes the environment as an argument rather than reading `process.env`, so it
 * is a pure function of its input and testable without mutating the process.
 */
export function githubFromEnv(env: Readonly<Record<string, string | undefined>>): WorkItemSource | null {
  const configured = (env['ZENO_GITHUB_REPO'] ?? '').trim();
  if (configured === '') return null;

  const parts = configured.split('/').map((p) => p.trim());
  const owner = parts[0] ?? '';
  const repo = parts[1] ?? '';
  if (parts.length !== 2 || owner === '' || repo === '') {
    throw new Error(
      `ZENO_GITHUB_REPO must be exactly "owner/repo" — got ${JSON.stringify(configured)}. ` +
        'Refusing to start rather than run with a GitHub feed that would silently never answer.',
    );
  }

  return githubSource({
    owner,
    repo,
    token: env['ZENO_GITHUB_TOKEN'],
    assignee: env['ZENO_GITHUB_ASSIGNEE'],
  });
}

/**
 * The desk a daemon rooted at `dir` uses: the backlog file beside the ledger.
 * Constructing it READS that file, so an unreadable backlog fails at startup
 * where it is visible, not on the first request.
 */
export function nodeWorkDesk(dir: string, remote: WorkItemSource | null = null): WorkDesk {
  return new WorkDesk(new Backlog(nodeBacklogStore(backlogPathIn(dir)), systemClock), remote);
}
