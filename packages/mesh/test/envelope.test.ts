/**
 * The envelope: confidentiality, integrity, and replay defense.
 *
 * The AEAD promise is tested as failure modes, because that is where it earns
 * its keep — a tampered byte, a wrong key, and a swapped seq must ALL fail to
 * open — and the replay guard is tested as the sliding window it is: reordering
 * within the window survives, a duplicate does not, and a stale seq off the back
 * of the window does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  counterNonce,
  decodeEnvelope,
  encodeEnvelope,
  open,
  randomNonceSource,
  ReplayGuard,
  seal,
} from '../src/envelope.js';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

test('a sealed envelope opens with the right key and round-trips the plaintext', () => {
  const pt = Buffer.from('approvals waiting: 3');
  const env = seal(KEY, pt, 5, counterNonce(5));
  assert.equal(env.seq, 5);
  assert.equal(env.nonce.length, 12);
  assert.equal(env.tag.length, 16);
  assert.deepEqual(open(KEY, env), pt);
});

test('a TAMPERED ciphertext byte fails to open', () => {
  const env = seal(KEY, Buffer.from('do not touch'), 1, counterNonce(1));
  const bad = { ...env, ciphertext: Buffer.from(env.ciphertext) };
  bad.ciphertext[0] = bad.ciphertext[0]! ^ 0x01;
  assert.throws(() => open(KEY, bad), 'the tag no longer verifies');
});

test('a TAMPERED tag byte fails to open', () => {
  const env = seal(KEY, Buffer.from('hello'), 1, counterNonce(1));
  const bad = { ...env, tag: Buffer.from(env.tag) };
  bad.tag[0] = bad.tag[0]! ^ 0xff;
  assert.throws(() => open(KEY, bad));
});

test('the WRONG key fails to open', () => {
  const env = seal(KEY, Buffer.from('hello'), 1, counterNonce(1));
  assert.throws(() => open(OTHER_KEY, env));
});

test('a SWAPPED seq fails to open — seq is authenticated as AAD', () => {
  const env = seal(KEY, Buffer.from('hello'), 1, counterNonce(1));
  // Present the same bytes but claim a different seq: the AAD no longer matches.
  const swapped = { ...env, seq: 2 };
  assert.throws(() => open(KEY, swapped), 'you cannot relabel an old message as a new one');
});

test('seal validates its inputs', () => {
  assert.throws(() => seal(Buffer.alloc(31), Buffer.from('x'), 0, counterNonce(0)), /key must be 32/);
  assert.throws(() => seal(KEY, Buffer.from('x'), 0, Buffer.alloc(11)), /nonce must be 12/);
  assert.throws(() => seal(KEY, Buffer.from('x'), -1, counterNonce(0)), /seq/);
  assert.throws(() => seal(KEY, Buffer.from('x'), 1.5, counterNonce(0)), /seq/);
});

test('open validates the key length', () => {
  const env = seal(KEY, Buffer.from('x'), 0, counterNonce(0));
  assert.throws(() => open(Buffer.alloc(16), env), /key must be 32/);
});

test('encode/decode round-trips, and decode rejects a runt frame', () => {
  const env = seal(KEY, Buffer.from('payload'), 42, counterNonce(42));
  const bytes = encodeEnvelope(env);
  const back = decodeEnvelope(bytes);
  assert.equal(back.seq, 42);
  assert.deepEqual(open(KEY, back), Buffer.from('payload'));
  assert.throws(() => decodeEnvelope(Buffer.alloc(10)), /too short/);
});

test('encode validates nonce and tag widths', () => {
  const env = seal(KEY, Buffer.from('x'), 0, counterNonce(0));
  assert.throws(() => encodeEnvelope({ ...env, nonce: Buffer.alloc(8) }), /nonce must be 12/);
  assert.throws(() => encodeEnvelope({ ...env, tag: Buffer.alloc(8) }), /tag must be 16/);
});

test('open FAILS CLOSED on a truncated tag — no 128→32-bit downgrade', () => {
  // A short-but-GCM-legal tag (4/8/12/13/14/15 bytes) is not a malformation GCM
  // rejects on its own: setAuthTag accepts it and final() then verifies only that
  // many bytes, so a 4-byte tag would open plaintext at 2^-32 forgery odds. open
  // must reject any tag that is not the full 16 bytes.
  const env = seal(KEY, Buffer.from('SENSITIVE'), 5, counterNonce(5));
  for (const n of [4, 8, 12, 13, 14, 15]) {
    assert.throws(
      () => open(KEY, { ...env, tag: env.tag.subarray(0, n) }),
      /tag must be 16/,
      `a ${n}-byte tag must not open`,
    );
  }
  // And a wrong-width nonce is a malformation open refuses rather than feeds to GCM.
  assert.throws(() => open(KEY, { ...env, nonce: env.nonce.subarray(0, 8) }), /nonce must be 12/);
});

test('a byte flipped ANYWHERE in the encoded frame fails to open', () => {
  const env = seal(KEY, Buffer.from('the quick brown fox'), 3, counterNonce(3));
  const bytes = encodeEnvelope(env);
  for (let i = 0; i < bytes.length; i++) {
    const mangled = Buffer.from(bytes);
    mangled[i] = mangled[i]! ^ 0x80;
    let threw = false;
    try {
      open(KEY, decodeEnvelope(mangled));
    } catch {
      threw = true;
    }
    assert.ok(threw, `flipping byte ${i} slipped past the tag`);
  }
});

test('counterNonce is 12 bytes and unique per seq; randomNonceSource yields 12 fresh bytes', () => {
  assert.equal(counterNonce(0).length, 12);
  assert.ok(!counterNonce(1).equals(counterNonce(2)));
  const src = randomNonceSource();
  assert.equal(src(0).length, 12);
  assert.ok(!src(0).equals(src(0)), 'random nonces do not repeat');
});

test('ReplayGuard: fresh seqs accepted, a duplicate rejected', () => {
  const g = new ReplayGuard();
  assert.equal(g.accept(0), true);
  assert.equal(g.accept(1), true);
  assert.equal(g.accept(1), false, 'the second copy of seq 1 is a replay');
  assert.equal(g.accept(2), true);
  assert.equal(g.accept(0), false, 'and the captured seq 0 cannot come back as new');
});

test('ReplayGuard: reordering WITHIN the window is tolerated', () => {
  const g = new ReplayGuard(8);
  assert.equal(g.accept(5), true); // jump ahead
  assert.equal(g.accept(2), true, 'a delayed earlier message still lands');
  assert.equal(g.accept(4), true);
  assert.equal(g.accept(2), false, 'but only once');
});

test('ReplayGuard: a seq off the BACK of the window is rejected as stale', () => {
  const g = new ReplayGuard(4);
  assert.equal(g.accept(10), true);
  assert.equal(g.accept(6), false, 'window is [7..10]; 6 fell off the back');
  assert.equal(g.accept(7), true, 'the edge of the window is still fresh');
});

test('ReplayGuard: a large forward jump resets the window and still rejects the old high', () => {
  const g = new ReplayGuard(8);
  assert.equal(g.accept(3), true);
  assert.equal(g.accept(100), true, 'a jump far beyond the window');
  assert.equal(g.accept(3), false, 'the pre-jump seq is now ancient');
  assert.equal(g.accept(100), false, 'and the new high cannot repeat');
  assert.equal(g.accept(-1), false, 'a negative seq is never accepted');
});

test('ReplayGuard rejects a nonsensical window size', () => {
  assert.throws(() => new ReplayGuard(0), /windowSize/);
});
