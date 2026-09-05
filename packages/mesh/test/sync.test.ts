/**
 * Sync end to end — the whole threat model driven through a hostile channel.
 *
 * THE BIG ONE is the property test: two endpoints, a seeded channel that drops,
 * reorders, duplicates, and injects garbage, and — after a final reliable
 * exchange — identical state hashes every time. It stands on everything else in
 * this file: an unknown/revoked sender is refused, a tampered frame fails the
 * tag, a replayed frame is caught, and a malformed frame is shrugged off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptPairing, beginPairing, completePairing, createIdentity, TrustStore } from '../src/pairing.js';
import { counterNonce, randomNonceSource } from '../src/envelope.js';
import { emptyReplica } from '../src/replica.js';
import { createSync, SyncEndpoint } from '../src/sync.js';

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

/** Pair A and B honestly and give each a trust store that knows the other. */
function pairedWorld() {
  const a = createIdentity();
  const b = createIdentity();
  const offer = beginPairing(a);
  const bSide = acceptPairing(b, offer.invite, offer.code);
  const aSide = completePairing(a, bSide.response, offer.code);
  const trustA = new TrustStore();
  trustA.remember(aSide.session);
  const trustB = new TrustStore();
  trustB.remember(bSide.session);
  return { a, b, sessionA: aSide.session, sessionB: bSide.session, trustA, trustB };
}

test('a clean exchange converges two endpoints', () => {
  const w = pairedWorld();
  const inboxA: Buffer[] = [];
  const inboxB: Buffer[] = [];
  const epA = createSync(w.sessionA, emptyReplica(w.a.deviceId), w.trustA, (b) => inboxB.push(b), counterNonce);
  const epB = createSync(w.sessionB, emptyReplica(w.b.deviceId), w.trustB, (b) => inboxA.push(b), counterNonce);

  epA.set('approval:1', { state: 'waiting' });
  epB.set('receipt:9', { ok: true });
  epA.push();
  epB.push();
  for (const bytes of inboxA.splice(0)) assert.equal(epA.receive(bytes).accepted, true);
  for (const bytes of inboxB.splice(0)) assert.equal(epB.receive(bytes).accepted, true);

  assert.equal(epA.stateHash(), epB.stateHash(), 'both sides now hold the same state');
  assert.notEqual(epA.replica.entries.get('receipt:9')?.value, undefined, 'A learned B’s receipt');
  assert.notEqual(epB.replica.entries.get('approval:1')?.value, undefined, 'B learned A’s approval');
});

test('receive REJECTS an unknown, then a revoked, sender', () => {
  const w = pairedWorld();
  const inboxA: Buffer[] = [];
  const epA = createSync(w.sessionA, emptyReplica(w.a.deviceId), w.trustA, () => {}, counterNonce);
  const epB = createSync(w.sessionB, emptyReplica(w.b.deviceId), w.trustB, (b) => inboxA.push(b), counterNonce);

  epB.set('x', 1);
  epB.push();
  assert.equal(epA.receive(inboxA[0]!).accepted, true, 'A trusts B, so it accepts');

  // Revoke B; the next authentic frame from B is now refused as unknown.
  epB.set('x', 2);
  epB.push();
  assert.equal(w.trustA.revoke(w.b.deviceId), true);
  const res = epA.receive(inboxA[1]!);
  assert.equal(res.accepted, false);
  assert.equal(res.accepted === false && res.reason, 'unknown-device');
});

test('receive REJECTS a replay, a tampered frame, and a malformed frame', () => {
  const w = pairedWorld();
  const inboxA: Buffer[] = [];
  const epA = createSync(w.sessionA, emptyReplica(w.a.deviceId), w.trustA, () => {}, counterNonce);
  const epB = createSync(w.sessionB, emptyReplica(w.b.deviceId), w.trustB, (b) => inboxA.push(b), counterNonce);

  epB.set('x', 1);
  epB.push();
  assert.equal(epA.receive(inboxA[0]!).accepted, true, 'first delivery lands');
  const replay = epA.receive(inboxA[0]!);
  assert.equal(replay.accepted === false && replay.reason, 'replay', 'the same frame again is a replay');

  // Tamper the last byte (inside the ciphertext) of a fresh frame.
  epB.set('x', 2);
  epB.push();
  const fresh = Buffer.from(inboxA[1]!);
  fresh[fresh.length - 1] = fresh[fresh.length - 1]! ^ 0x01;
  const bad = epA.receive(fresh);
  assert.equal(bad.accepted === false && bad.reason, 'bad-tag');

  // A frame that is not even well-formed.
  const junk = epA.receive(Buffer.from([0x00]));
  assert.equal(junk.accepted === false && junk.reason, 'malformed');
});

test('a forged frame wearing a TRUSTED label still fails the tag and moves nothing', () => {
  const w = pairedWorld();
  const epA = createSync(w.sessionA, emptyReplica(w.a.deviceId), w.trustA, () => {}, counterNonce);
  const before = epA.stateHash();
  // Attacker frames noise but stamps it with B's (trusted) device id.
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(Buffer.byteLength(w.b.deviceId), 0);
  const forged = Buffer.concat([
    idLen,
    Buffer.from(w.b.deviceId, 'utf8'),
    Buffer.alloc(8 + 12 + 16 + 8, 0xab), // seq + nonce + tag + ciphertext of pure noise
  ]);
  const res = epA.receive(forged);
  assert.equal(res.accepted === false && res.reason, 'bad-tag', 'a trusted label does not buy a valid tag');
  assert.equal(epA.stateHash(), before, 'the replica did not budge');
});

test('THE BIG ONE — two replicas converge through a lossy, reordering, duplicating, injecting channel', () => {
  let totalInjected = 0;
  let totalDuplicatesCaught = 0;

  for (let seed = 1; seed <= 30; seed++) {
    const rnd = prng(seed);
    const w = pairedWorld();

    // One unreliable channel: a queue of { target, bytes } deliveries.
    type Pending = { target: SyncEndpoint; bytes: Buffer };
    const pending: Pending[] = [];
    let epA!: SyncEndpoint;
    let epB!: SyncEndpoint;
    epA = createSync(
      w.sessionA,
      emptyReplica(w.a.deviceId),
      w.trustA,
      (bytes) => pending.push({ target: epB, bytes }),
      counterNonce,
    );
    epB = createSync(
      w.sessionB,
      emptyReplica(w.b.deviceId),
      w.trustB,
      (bytes) => pending.push({ target: epA, bytes }),
      counterNonce,
    );

    const ids = ['a', 'b', 'c', 'd', 'e'];

    for (let step = 0; step < 200; step++) {
      // 1. A random local mutation on a random endpoint, then it pushes.
      const ep = rnd() < 0.5 ? epA : epB;
      const id = ids[Math.floor(rnd() * ids.length)]!;
      if (rnd() < 0.2) ep.remove(id);
      else ep.set(id, { by: ep === epA ? 'A' : 'B', step });
      ep.push();

      // 2. Maybe inject garbage at a random target — it must be refused.
      if (rnd() < 0.15) {
        const victim = rnd() < 0.5 ? epA : epB;
        assert.equal(victim.receive(Buffer.from([0xff, 0xff, 0xff, 0xff])).accepted, false);
        totalInjected++;
      }
      // 3. Deliver some pending frames out of order, dropping and duplicating.
      const rounds = Math.floor(rnd() * 4);
      for (let d = 0; d < rounds && pending.length > 0; d++) {
        const idx = Math.floor(rnd() * pending.length);
        const msg = pending.splice(idx, 1)[0]!;
        const roll = rnd();
        if (roll < 0.2) continue; // DROP — the frame is lost forever
        msg.target.receive(msg.bytes);
        if (roll > 0.8) {
          // DUPLICATE — the very same bytes again must be caught as a replay.
          assert.equal(msg.target.receive(msg.bytes).accepted, false, 'a duplicated frame is caught');
          totalDuplicatesCaught++;
        }
      }
    }

    // Final RELIABLE reconciliation: no more local writes, one clean exchange
    // each way. Because merge is a lattice join, merge(Sa,Sb) == merge(Sb,Sa),
    // so a single delivered snapshot in each direction is all convergence needs —
    // no matter how much the channel lost or scrambled before this point.
    pending.length = 0;
    epA.push();
    epB.push();
    while (pending.length > 0) {
      const msg = pending.shift()!;
      msg.target.receive(msg.bytes);
    }

    assert.equal(epA.stateHash(), epB.stateHash(), `seed ${seed}: replicas did NOT converge`);
  }

  assert.ok(totalInjected > 0, 'the test never actually injected garbage');
  assert.ok(totalDuplicatesCaught > 0, 'the channel never actually duplicated a frame');
});

test('random nonces also work end to end', () => {
  const w = pairedWorld();
  const inboxA: Buffer[] = [];
  const src = randomNonceSource();
  const epA = createSync(w.sessionA, emptyReplica(w.a.deviceId), w.trustA, () => {}, src);
  const epB = createSync(w.sessionB, emptyReplica(w.b.deviceId), w.trustB, (b) => inboxA.push(b), src);
  epB.set('k', 'v');
  epB.push();
  assert.equal(epA.receive(inboxA[0]!).accepted, true);
  assert.equal(epA.replica.entries.get('k')?.value, 'v');
});
