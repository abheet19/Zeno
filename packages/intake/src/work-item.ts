/**
 * The WorkItem PORT — the shape of "a work item I own has arrived".
 *
 * The flagship journey was written as Jira -> Intake -> context -> TASK -> approve
 * -> Forge, and when the Jira account went away the journey went with it. That was
 * a design bug, not bad luck: the trigger was never Jira, it was a work item
 * arriving. Jira was one ADAPTER that had been welded into the trigger. This file
 * is the seam that should always have been there — a port narrow enough that a
 * local JSONL backlog and a GitHub issue feed are the same thing to everything
 * downstream, and wide enough to carry what an approval capsule must show.
 *
 * Pure and dependency-free on purpose: no fs, no network, no clock. Adapters do
 * the I/O; this file only describes what they must produce.
 */

/**
 * One unit of work that has arrived for the owner.
 *
 * Every field is what a HUMAN needs in order to decide, not what a provider
 * happens to return. Provider-shaped extras (Jira issue versions, GitHub node
 * ids) belong in the adapter — the moment they leak in here the port stops being
 * a port and becomes a second copy of one vendor's schema.
 */
export interface WorkItem {
  /** Stable across polls, e.g. "local:7" or "github:owner/repo#12". */
  readonly id: string;
  /** Which adapter produced it: 'local' | 'github'. */
  readonly source: string;
  readonly title: string;
  readonly body: string;
  /** Where a human can go and look. null when there is nowhere to go. */
  readonly url: string | null;
  /** ISO-8601. The version marker dedupe keys on. */
  readonly updatedAt: string;
  readonly labels: readonly string[];
}

/**
 * An adapter. `list()` returns the CURRENT set — it is not a queue and it does
 * not remember what it has already handed out. Dedupe is the caller's job, on
 * purpose: a source that silently withheld an item it had emitted before would
 * make a dropped item indistinguishable from an empty backlog.
 */
export interface WorkItemSource {
  readonly name: string;
  list(): Promise<readonly WorkItem[]>;
}

/**
 * The identity dedupe keys on: the item AND the version of it we saw. Same id
 * with a new `updatedAt` means the item changed and deserves another look; same
 * id with the same `updatedAt` means nothing happened.
 *
 * JSON-encoded rather than joined with a separator, so an id that itself
 * contains the separator cannot forge another item's key.
 */
export function workItemKey(item: Pick<WorkItem, 'id' | 'updatedAt'>): string {
  return JSON.stringify([item.id, item.updatedAt]);
}

export interface DedupeResult {
  /** Items not present in `seen`, in first-seen order. */
  readonly fresh: readonly WorkItem[];
  /** `seen` plus every key in this batch. Feed it back on the next poll. */
  readonly seen: ReadonlySet<string>;
}

const NOTHING_SEEN: ReadonlySet<string> = new Set<string>();

/**
 * Pure dedupe. Given the keys already seen, return what is new and the set to
 * carry into the next poll. Neither argument is mutated — the caller keeps
 * whatever memory it likes (a field, a file, a daemon) and this stays a plain
 * function of its inputs, which is what makes the polling loop testable without
 * a clock or a disk.
 *
 * Called with one argument it still collapses duplicates WITHIN the batch, which
 * is what a paginated source hands you when an item moves between pages mid-read.
 */
export function dedupe(
  items: readonly WorkItem[],
  seen: ReadonlySet<string> = NOTHING_SEEN,
): DedupeResult {
  const next = new Set(seen);
  const fresh: WorkItem[] = [];
  for (const item of items) {
    const key = workItemKey(item);
    if (next.has(key)) continue;
    next.add(key);
    fresh.push(item);
  }
  return { fresh, seen: next };
}

/** Longest title the capsule sentence carries before it is clipped. */
const TITLE_LIMIT = 80;
/** Longest label run the capsule sentence carries before it is clipped. */
const LABELS_LIMIT = 60;
/**
 * The id and the timestamp are bounded too, and for the same reason the title
 * is. Both are FOREIGN TEXT: `mapIssue` accepts any non-empty string as
 * `updated_at` — there is nothing else true to check about a foreign timestamp —
 * so whatever answers for api.github.com decides how long it is, and a
 * hand-edited backlog line, which this product supports, decides the same thing
 * locally. Left unclipped they were the two remaining ways to push the rest of
 * the capsule off the screen, which is the one thing this sentence promises
 * cannot happen.
 *
 * Generous, because unlike a title neither has a legitimate long form to
 * protect: 120 clears `github:${owner}/${repo}#${number}` at GitHub's own limits
 * (a 39-character login, a 100-character repo name), and 40 clears any ISO-8601
 * instant with room left over.
 */
const ID_LIMIT = 120;
const AT_LIMIT = 40;

/**
 * Code points that must never reach an approval capsule. Three groups:
 *   - C0 and C1 controls, which break the one-line contract;
 *   - line/paragraph separators, same reason; and
 *   - bidi overrides and zero-width marks, which can visually REORDER a line, so
 *     the sentence the owner reads is not the sentence the item contains.
 *
 * The capsule is a security surface: the whole product rests on the owner seeing
 * what they are actually agreeing to, and a work item's title becomes attacker-
 * controlled text the moment the second adapter (GitHub) exists. Written as code
 * point ranges rather than a regex literal so the ranges are readable and cannot
 * be mangled by an editor that normalizes escapes.
 */
function isUnsafeCodePoint(c: number): boolean {
  if (c <= 0x1f) return true; // C0 controls, including tab/CR/LF
  if (c >= 0x7f && c <= 0x9f) return true; // DEL and the C1 controls
  if (c >= 0x200b && c <= 0x200f) return true; // zero-width + LRM/RLM
  if (c === 0x2028 || c === 0x2029) return true; // line / paragraph separator
  if (c >= 0x202a && c <= 0x202e) return true; // bidi embedding + overrides
  if (c >= 0x2066 && c <= 0x2069) return true; // bidi isolates
  return c === 0xfeff; // zero-width no-break space / BOM
}

/** Strip unsafe code points, collapse whitespace, trim. Always one line. */
export function oneLine(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    out += c !== undefined && isUnsafeCodePoint(c) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Clip to `limit` characters INCLUDING the ellipsis, so the bound is exact.
 *
 * The cut never splits a surrogate pair. `slice` counts UTF-16 code units, and
 * an emoji or any other astral character is two of them — cutting between them
 * leaves a lone surrogate, which is not a character at all and renders as a
 * replacement glyph. Everything above works in code points precisely so the
 * capsule shows what the item says; it would be a poor joke to hand that back at
 * the last step.
 */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = limit - 1;
  const last = text.charCodeAt(cut - 1);
  // A high surrogate at the end has lost its partner to the cut — drop it too.
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * The one human sentence the approval capsule shows above everything else.
 *
 * Deterministic and length-bounded: the same item always renders the same
 * sentence, and no item — however long its title — can push the rest of the
 * capsule off the screen.
 */
export function toSummary(item: WorkItem): string {
  const title = clip(oneLine(item.title), TITLE_LIMIT) || '(untitled)';
  const labels = item.labels.map(oneLine).filter((l) => l.length > 0);
  const tail = labels.length > 0 ? ` [${clip(labels.join(', '), LABELS_LIMIT)}]` : '';
  const id = clip(oneLine(item.id), ID_LIMIT) || '(unidentified)';
  const at = clip(oneLine(item.updatedAt), AT_LIMIT) || 'unknown';
  return `${id} — "${title}"${tail} (updated ${at})`;
}
