/**
 * `zeno backlog` — the work you own, on a disk nobody can revoke.
 *
 * The old trigger was a Jira assignment, and it went away with the account. This
 * is the replacement that cannot: a JSONL file beside the ledger, written by
 * this command and read by the daemon's `GET /work` through the same
 * `WorkItemSource` port a GitHub feed arrives on.
 *
 * It talks to the FILE, not to the daemon. `zeno propose` needs a running daemon
 * because only the daemon holds the kernel; a backlog item is local state and
 * needs nothing running. `Backlog` re-reads before every read, so having the
 * daemon up at the same time is a supported way to work, not a hazard.
 */
import {
  Backlog,
  backlogPathIn,
  nodeBacklogStore,
  oneLine,
  systemClock,
  toSummary,
  toWorkItem,
  type BacklogEntry,
} from '@abheet19/zeno-intake';

/** Longest title a row carries before it is clipped, so output stays tabular. */
const TITLE_LIMIT = 72;

export interface OpenedBacklog {
  readonly backlog: Backlog;
  readonly path: string;
}

/**
 * Open the backlog beside the ledger in `dir`. Reading happens here, so an
 * unreadable file throws with the path in the message rather than presenting an
 * empty backlog that the next `add` would write over the top of.
 */
export function openBacklog(dir: string): OpenedBacklog {
  const path = backlogPathIn(dir);
  return { backlog: new Backlog(nodeBacklogStore(path), systemClock), path };
}

export interface BacklogView {
  readonly path: string;
  /** The rows to print — open only, unless `all`. */
  readonly rows: readonly BacklogEntry[];
  readonly open: number;
  readonly total: number;
  /** Lines in the file the parser could not read. Never hidden. */
  readonly skipped: number;
  readonly all: boolean;
}

export function backlogView(o: OpenedBacklog, all: boolean): BacklogView {
  const every = o.backlog.list();
  const open = every.filter((e) => e.state === 'open');
  return {
    path: o.path,
    rows: all ? every : open,
    open: open.length,
    total: every.length,
    skipped: o.backlog.skippedLines(),
    all,
  };
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** Always through `oneLine`: a hand-edited title is untrusted text. */
function row(e: BacklogEntry): string {
  const labels = e.labels.length === 0 ? '' : `  [${clip(oneLine(e.labels.join(', ')), 40)}]`;
  return `     ${e.id.padEnd(10)} ${e.state.padEnd(7)} ${clip(oneLine(e.title), TITLE_LIMIT)}${labels}`;
}

export function renderBacklog(v: BacklogView, log: (s: string) => void): void {
  log('');
  log(`  BACKLOG  ${v.path}`);
  log('');
  if (v.rows.length === 0) {
    // "nothing yet" is a claim about the BACKLOG. A file whose every line the
    // parser rejected supports no such claim: the honest reading is that this
    // command could not tell what is in there. The damage count printed below
    // is the detail; the headline must not have already said the opposite.
    log(
      v.total > 0
        ? '     nothing open —  zeno backlog list --all  shows the closed ones'
        : v.skipped > 0
          ? '     nothing in this file could be read — see below. That is not the same as an empty backlog.'
          : '     nothing yet —  zeno backlog add "what needs doing"',
    );
  }
  for (const e of v.rows) log(row(e));
  log('');
  log(
    v.all
      ? `  ${v.total} item${v.total === 1 ? '' : 's'} · ${v.open} open · ${v.total - v.open} closed.`
      : `  ${v.open} open of ${v.total}. --all includes the closed ones.`,
  );
  // Damage is stated, never quietly absorbed. One unreadable line costs one
  // item, and a shorter list that says nothing is indistinguishable from a
  // shorter backlog.
  if (v.skipped > 0) {
    log(
      `  ${v.skipped} line${v.skipped === 1 ? '' : 's'} could not be read and ${v.skipped === 1 ? 'was' : 'were'} skipped. ` +
        'Nothing was rewritten — they are still in the file.',
    );
  }
  log('');
}

export function renderAdded(entry: BacklogEntry, path: string, log: (s: string) => void): void {
  log('');
  log(`  ADDED  ${toSummary(toWorkItem(entry))}`);
  log(`  ${path}`);
  log('');
}

/**
 * `already` matters: closing a closed item writes nothing, on purpose — a
 * revision that changed only `updatedAt` would wake every downstream poller for
 * an item that did not change. Saying "already closed" is the honest report of
 * a command that deliberately did nothing.
 */
export function renderClosed(entry: BacklogEntry, already: boolean, log: (s: string) => void): void {
  log('');
  if (already) {
    log(`  ALREADY CLOSED  ${toSummary(toWorkItem(entry))}`);
    log('  Nothing was written.');
  } else {
    log(`  CLOSED  ${toSummary(toWorkItem(entry))}`);
    log('  A closed revision was appended. Nothing was deleted.');
  }
  log('');
}
