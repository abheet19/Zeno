/**
 * The convergent state.
 *
 * Two things must be true of a CvRDT and both are tested here: applying the same
 * set of ops in ANY order lands on the same state (the property test), and a
 * DELETE is a tombstone a late create cannot silently undo. The rest pins the
 * lattice-join laws — idempotent, commutative — that the property rests on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOp,
  emptyReplica,
  merge,
  mergeSnapshot,
  removeValue,
  setValue,
  snapshot,
  stateHash,
  type Op,
  type Replica,
} from '../src/replica.js';

/** mulberry32 — a tiny seeded PRNG so the property test is itself replayable. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('set then read; a newer local write wins and bumps the clock', () => {
  let r = emptyReplica('A');
  r = setValue(r, 'x', 1).replica;
  assert.equal(r.entries.get('x')?.value, 1);
  assert.equal(r.clock, 1);
  r = setValue(r, 'x', 2).replica;
  assert.equal(r.entries.get('x')?.value, 2);
  assert.equal(r.clock, 2, 'each local write advances the Lamport clock');
});

test('applyOp is idempotent — re-applying a known op returns the SAME replica', () => {
  const r0 = emptyReplica('A');
  const { replica: r1, op } = setValue(r0, 'x', 'v');
  const r2 = applyOp(r1, op);
  assert.equal(r2, r1, 'no clock move, no cell change: literally the same object');
});

test('a lower-stamped op LOSES but still advances the observing clock', () => {
  // origin B has seen time 5; an op from A at time 3 loses the cell yet B now
  // knows time has reached 3 elsewhere — the clock reflects observation, not who won.
  let r = emptyReplica('B');
  r = applyOp(r, { kind: 'set', id: 'x', value: 'B-wins', stamp: { lamport: 5, origin: 'B' } });
  const before = r.entries.get('x');
  r = applyOp(r, { kind: 'set', id: 'x', value: 'A-late', stamp: { lamport: 3, origin: 'A' } });
  assert.equal(r.entries.get('x'), before, 'the older write did not touch the cell');
  assert.equal(r.clock, 5, 'clock stays at the max seen');
});

test('equal Lamport ties break on origin id, deterministically', () => {
  let r = emptyReplica('_');
  r = applyOp(r, { kind: 'set', id: 'x', value: 'from-A', stamp: { lamport: 4, origin: 'A' } });
  r = applyOp(r, { kind: 'set', id: 'x', value: 'from-B', stamp: { lamport: 4, origin: 'B' } });
  assert.equal(r.entries.get('x')?.value, 'from-B', 'higher origin id wins the tie');
  // ...and applying them in the other order lands identically.
  let s = emptyReplica('_');
  s = applyOp(s, { kind: 'set', id: 'x', value: 'from-B', stamp: { lamport: 4, origin: 'B' } });
  s = applyOp(s, { kind: 'set', id: 'x', value: 'from-A', stamp: { lamport: 4, origin: 'A' } });
  assert.equal(stateHash(s), stateHash(r), 'order does not matter');
});

test('THE TOMBSTONE RULE — a late create cannot undo a delete', () => {
  let r = emptyReplica('A');
  r = setValue(r, 'x', 'created').replica; // stamp {1, A}
  const deleted = removeValue(r, 'x').replica; // stamp {2, A}, tombstone
  assert.equal(deleted.entries.get('x')?.deleted, true);

  // A create that was in flight at time 1 arrives late — it is OLDER than the delete.
  const late: Op = { kind: 'set', id: 'x', value: 'resurrected?', stamp: { lamport: 1, origin: 'Z' } };
  const after = applyOp(deleted, late);
  assert.equal(after.entries.get('x')?.deleted, true, 'still a tombstone — the delete stands');
  assert.equal(after.entries.get('x')?.value, null);

  // But a create NEWER than the tombstone is a legitimate re-create and wins.
  const fresh: Op = { kind: 'set', id: 'x', value: 'really new', stamp: { lamport: 9, origin: 'A' } };
  const revived = applyOp(after, fresh);
  assert.equal(revived.entries.get('x')?.deleted, false);
  assert.equal(revived.entries.get('x')?.value, 'really new');
});

test('merge is commutative and idempotent', () => {
  let a = emptyReplica('A');
  a = setValue(a, 'x', 1).replica;
  a = setValue(a, 'y', 2).replica;
  let b = emptyReplica('B');
  b = setValue(b, 'y', 3).replica; // conflicts on y
  b = setValue(b, 'z', 4).replica;

  const ab = merge(a, b);
  const ba = merge(b, a);
  assert.equal(stateHash(ab), stateHash(ba), 'merge(a,b) and merge(b,a) agree on the data');
  assert.equal(stateHash(merge(ab, b)), stateHash(ab), 'merging in b again changes nothing');
  assert.equal(stateHash(merge(ab, a)), stateHash(ab), 'nor does merging in a again');
});

test('snapshot -> mergeSnapshot carries state faithfully', () => {
  let a = emptyReplica('A');
  a = setValue(a, 'x', { nested: [1, 2, 3], k: 'v' }).replica;
  a = removeValue(a, 'gone').replica;
  const merged = mergeSnapshot(emptyReplica('B'), snapshot(a));
  assert.equal(stateHash(merged), stateHash(a), 'a fresh replica absorbs the whole snapshot');
});

test('mergeSnapshot is defensive: malformed input is ignored, not fatal', () => {
  const r = setValue(emptyReplica('A'), 'x', 1).replica;
  assert.equal(mergeSnapshot(r, null), r, 'null snapshot: unchanged');
  assert.equal(mergeSnapshot(r, 42), r, 'non-object: unchanged');
  assert.equal(mergeSnapshot(r, { entries: 'nope' }), r, 'bad entries: unchanged');
  // A snapshot with one good entry and one junk entry applies only the good one.
  const mixed = mergeSnapshot(r, { entries: { good: { l: 9, o: 'Z', d: false, v: 5 }, junk: { l: 'x' } } });
  assert.equal(mixed.entries.get('good')?.value, 5);
  assert.equal(mixed.entries.has('junk'), false);
});

test('CONVERGENCE — a non-finite Lamport time cannot enter and break the order', () => {
  // `1e999` is valid JSON and parses to Infinity, and typeof Infinity === 'number',
  // so the old "typeof number" check would have admitted it. Admitted, it beats
  // every honest finite write forever AND pins the receiver's clock at Infinity,
  // after which local re-writes collide at {Infinity, origin} and are dropped.
  const wire = JSON.parse('{"entries":{"poison":{"l":1e999,"o":"peer","d":false,"v":0}}}');
  assert.equal(wire.entries.poison.l, Infinity, 'JSON really did yield Infinity');

  let a = setValue(emptyReplica('A'), 'poison', 'honest').replica; // finite stamp {1, A}
  a = mergeSnapshot(a, wire);
  assert.equal(a.entries.get('poison')?.value, 'honest', 'the Infinity entry was refused, not applied');
  assert.equal(Number.isFinite(a.clock), true, 'the clock was not poisoned to Infinity');

  // Because the clock stayed finite, consecutive local writes still get distinct,
  // strictly increasing stamps — so a re-write to a key actually takes.
  a = setValue(a, 'k', 'first').replica;
  a = setValue(a, 'k', 'second').replica;
  assert.equal(a.entries.get('k')?.value, 'second', 'consecutive local writes keep distinct stamps');

  // NaN (which no JSON literal can carry, but a hand-built entry can) and a
  // negative lamport are refused for the same reason — a NaN would make
  // stampCompare non-total and let two replicas that saw the same ops diverge.
  const junk = mergeSnapshot(emptyReplica('B'), {
    entries: { nan: { l: NaN, o: 'A', d: false, v: 1 }, neg: { l: -1, o: 'A', d: false, v: 2 } },
  });
  assert.equal(junk.entries.has('nan'), false, 'a NaN-stamped entry is skipped');
  assert.equal(junk.entries.has('neg'), false, 'a negative-lamport entry is skipped');
});

test('stateHash ignores origin and clock — only the DATA counts', () => {
  const a = setValue(emptyReplica('A'), 'x', 1).replica;
  const b = mergeSnapshot(emptyReplica('DIFFERENT-ORIGIN'), snapshot(a));
  assert.notEqual(a.origin, b.origin);
  assert.equal(stateHash(a), stateHash(b), 'same data, same hash, regardless of who holds it');
});

test('an item id of "__proto__" is real data, not prototype pollution', () => {
  let r = emptyReplica('A');
  r = setValue(r, '__proto__', 'i am an item').replica;
  const round = mergeSnapshot(emptyReplica('B'), JSON.parse(JSON.stringify(snapshot(r))));
  assert.equal(round.entries.get('__proto__')?.value, 'i am an item');
  assert.equal(stateHash(round), stateHash(r), 'it survives the snapshot round-trip and the hash');
});

test('PROPERTY — the same ops in a shuffled order converge to the same hash', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = prng(seed);
    // Build a pool of ops from two origins over a small id space.
    const ids = ['a', 'b', 'c', 'd'];
    const ops: Op[] = [];
    let clockA = 0;
    let clockB = 0;
    for (let i = 0; i < 60; i++) {
      const origin = rnd() < 0.5 ? 'A' : 'B';
      const lamport = origin === 'A' ? ++clockA : ++clockB;
      const id = ids[Math.floor(rnd() * ids.length)]!;
      ops.push(
        rnd() < 0.25
          ? { kind: 'delete', id, stamp: { lamport, origin } }
          : { kind: 'set', id, value: i, stamp: { lamport, origin } },
      );
    }

    // Apply the pool to two replicas in two different shuffles.
    const shuffle = (xs: Op[]): Op[] => {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const a = out[i]!;
        const b = out[j]!;
        out[i] = b;
        out[j] = a;
      }
      return out;
    };
    const build = (order: Op[]): Replica => order.reduce(applyOp, emptyReplica('_'));

    const h1 = stateHash(build(shuffle(ops)));
    const h2 = stateHash(build(shuffle(ops)));
    assert.equal(h1, h2, `seed ${seed}: order-independence broken`);
  }
});
