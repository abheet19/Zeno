/**
 * The convergent state — pure, dependency-free, and the reason "losing the
 * network never loses data".
 *
 * This is a last-writer-wins map (a CvRDT): a map keyed by item id whose values
 * each carry a Lamport timestamp and the origin device id. Those two together
 * give every write a position in a TOTAL order, so two replicas that have seen
 * the same set of operations end up byte-identical no matter what order the
 * operations arrived in — dropped, duplicated, reordered, it does not matter.
 * That order-independence is what lets `merge` be a proper lattice join:
 * commutative, associative, and idempotent. Sync ships whole snapshots and
 * merges them; because merge is a join, receiving a snapshot any number of times
 * in any order can only move both replicas UP toward the same least-upper-bound.
 *
 * A DELETE is a tombstone, never a hole. A deleted id keeps its stamp and a
 * `deleted` flag, so a create that was in flight when the delete happened — and
 * arrives late — is compared against the tombstone and LOSES if it is older. A
 * hole (just removing the key) would let that late create silently resurrect the
 * item; the tombstone is what makes "a delete cannot be undone by a late create"
 * true rather than aspirational.
 *
 * No fs, no network, no clock, no ambient randomness. The Lamport clock is the
 * only notion of time and it is carried in the data itself.
 */
import { createHash } from 'node:crypto';

/** A write's position in the total order: Lamport time, origin as tiebreak. */
export interface Stamp {
  readonly lamport: number;
  readonly origin: string;
}

/** One id's current fact: its stamp, whether it is a tombstone, and its value. */
export interface Entry {
  readonly stamp: Stamp;
  readonly deleted: boolean;
  /** null on a tombstone. Any JSON value otherwise. */
  readonly value: unknown;
}

/**
 * A replica: its own `origin` (used to stamp the writes it originates), its
 * Lamport `clock` (the highest time it has observed), and the map itself. The
 * `entries` map is never mutated in place — every operation returns a new
 * replica, so a replica value is a safe thing to hold, hash, and compare.
 */
export interface Replica {
  readonly origin: string;
  readonly clock: number;
  readonly entries: ReadonlyMap<string, Entry>;
}

export type Op =
  | { readonly kind: 'set'; readonly id: string; readonly value: unknown; readonly stamp: Stamp }
  | { readonly kind: 'delete'; readonly id: string; readonly stamp: Stamp };

/**
 * Total order over stamps. Higher Lamport wins; ties break on origin id so the
 * order is total and deterministic on every device. Two DIFFERENT writes can
 * never share a stamp: an origin bumps its own Lamport clock on every write it
 * makes, so (lamport, origin) is unique per write, and a compare of 0 means the
 * very same write — which is exactly why applying it twice is a no-op.
 */
function stampCompare(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport < b.lamport ? -1 : 1;
  if (a.origin === b.origin) return 0;
  return a.origin < b.origin ? -1 : 1;
}

export function emptyReplica(origin: string): Replica {
  return { origin, clock: 0, entries: new Map() };
}

/** Originate a write. Returns the advanced replica AND the op to broadcast. */
export function setValue(replica: Replica, id: string, value: unknown): { replica: Replica; op: Op } {
  const op: Op = { kind: 'set', id, value, stamp: { lamport: replica.clock + 1, origin: replica.origin } };
  return { replica: applyOp(replica, op), op };
}

/** Originate a delete (a tombstone, not a hole). Returns replica AND the op. */
export function removeValue(replica: Replica, id: string): { replica: Replica; op: Op } {
  const op: Op = { kind: 'delete', id, stamp: { lamport: replica.clock + 1, origin: replica.origin } };
  return { replica: applyOp(replica, op), op };
}

/**
 * Apply one op. The clock advances to the op's time whether or not the op wins
 * the LWW comparison — observing a higher time is a fact independent of who wins
 * the cell — so a replica that has SEEN an op carries its causal weight even when
 * a newer local write already superseded it.
 */
export function applyOp(replica: Replica, op: Op): Replica {
  const existing = replica.entries.get(op.id);
  const clock = replica.clock >= op.stamp.lamport ? replica.clock : op.stamp.lamport;
  // Incoming loses or is the very same write: the cell does not change. Return a
  // new replica only if the clock actually moved, so an idempotent re-apply of an
  // already-known op is a genuine no-op (=== the same value).
  if (existing && stampCompare(op.stamp, existing.stamp) <= 0) {
    return clock === replica.clock ? replica : { origin: replica.origin, clock, entries: replica.entries };
  }
  const entries = new Map(replica.entries);
  entries.set(op.id, {
    stamp: op.stamp,
    deleted: op.kind === 'delete',
    value: op.kind === 'set' ? op.value : null,
  });
  return { origin: replica.origin, clock, entries };
}

/**
 * The lattice join. For every id present in either replica, the entry with the
 * greater stamp wins. Commutative and associative because the winner is chosen
 * by the total order alone, idempotent because merging a replica with itself
 * (or with anything it already dominates) changes nothing. The result keeps
 * `a`'s origin — you are merging what you received INTO your own replica — but
 * `stateHash` ignores origin, so both directions land on the same hash.
 */
export function merge(a: Replica, b: Replica): Replica {
  const entries = new Map(a.entries);
  for (const [id, be] of b.entries) {
    const ae = entries.get(id);
    if (!ae || stampCompare(be.stamp, ae.stamp) > 0) entries.set(id, be);
  }
  const clock = a.clock >= b.clock ? a.clock : b.clock;
  return { origin: a.origin, clock, entries };
}

/**
 * A hash of the DATA the replicas are supposed to agree on: every id mapped to
 * its stamp, its tombstone flag, and its value, canonically serialized. Origin
 * and clock are local bookkeeping and are deliberately excluded — two replicas
 * that have seen the same ops must produce the same hash even though one of them
 * originated more of those ops than the other.
 */
export function stateHash(replica: Replica): string {
  const obj: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [id, e] of replica.entries) {
    obj[id] = { l: e.stamp.lamport, o: e.stamp.origin, d: e.deleted, v: e.deleted ? null : e.value };
  }
  return sha256(canonicalJSON(obj));
}

/**
 * The wire form of a replica: a plain, JSON-round-trippable object. Snapshots
 * are what sync seals and sends. Built on Object.create(null) so an item whose
 * id is "__proto__" is stored as an ordinary own key rather than vanishing into
 * the prototype.
 */
export interface Snapshot {
  readonly v: 1;
  readonly entries: Readonly<Record<string, { l: number; o: string; d: boolean; v: unknown }>>;
}

export function snapshot(replica: Replica): Snapshot {
  const entries: Record<string, { l: number; o: string; d: boolean; v: unknown }> = Object.create(
    null,
  ) as Record<string, { l: number; o: string; d: boolean; v: unknown }>;
  for (const [id, e] of replica.entries) {
    entries[id] = { l: e.stamp.lamport, o: e.stamp.origin, d: e.deleted, v: e.deleted ? null : e.value };
  }
  return { v: 1, entries };
}

function isSnapEntry(e: unknown): e is { l: number; o: string; d: boolean; v: unknown } {
  if (e === null || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  // `l` must be a FINITE, non-negative INTEGER, not merely a number. This is the
  // wire's only door into the Lamport ordering and a non-finite value poisons it:
  //   - Infinity is wire-reachable — `1e999` is valid JSON and parses to Infinity,
  //     and `typeof Infinity === 'number'`. Admitted, it wins every LWW compare
  //     forever (nothing finite beats it) and pins the receiver's clock at
  //     `max(clock, Infinity) = Infinity`, after which every local write stamps at
  //     {Infinity, origin} — colliding, so re-writes to a key are silently dropped.
  //   - NaN makes stampCompare non-TOTAL: it reaches the origin tie-break only when
  //     `a.lamport !== b.lamport` is false, but `NaN !== NaN` is TRUE, so ties skip
  //     the tie-break and resolve by apply order — order-dependent, so two replicas
  //     that saw the same ops in a different order DIVERGE.
  // Honest snapshots only ever carry integer lamports >= 1, so rejecting the rest
  // skips exactly the malformed entries — the same "merge as far as it validates,
  // never throw" contract the rest of this function keeps.
  return (
    Number.isInteger(r.l) && (r.l as number) >= 0 && typeof r.o === 'string' && typeof r.d === 'boolean'
  );
}

/**
 * Merge a decoded snapshot into a replica. Defensive on shape — a snapshot that
 * arrives malformed (or with an unrecognized entry) is merged as far as it
 * validates rather than throwing, because a sender at a newer version must never
 * be able to stall an older receiver. Each valid entry is fed through `applyOp`
 * so the LWW rule and the clock advance are the exact same code the local path
 * uses; there is no second, subtly-different merge to keep in step.
 */
export function mergeSnapshot(replica: Replica, snap: unknown): Replica {
  if (snap === null || typeof snap !== 'object') return replica;
  const rawEntries = (snap as { entries?: unknown }).entries;
  if (rawEntries === null || typeof rawEntries !== 'object') return replica;
  const map = rawEntries as Record<string, unknown>;
  let next = replica;
  for (const id of Object.keys(map)) {
    const e = map[id];
    if (!isSnapEntry(e)) continue;
    const stamp: Stamp = { lamport: e.l, origin: e.o };
    const op: Op = e.d ? { kind: 'delete', id, stamp } : { kind: 'set', id, value: e.v, stamp };
    next = applyOp(next, op);
  }
  return next;
}

// --- canonical hashing (leaf package: a local copy, never a kernel import) ----

/** Stable stringify: object keys sorted recursively; arrays keep their order. */
function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  // Object.create(null), NOT {}: assigning "__proto__" to a plain object literal
  // hits the inherited accessor and the key silently disappears from the hash.
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
  return out;
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
