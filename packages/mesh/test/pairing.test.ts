/**
 * Pairing: the handshake and the two eyes-on-it defenses.
 *
 * The contract under test is precise: an honest run derives one identical key and
 * one identical SAS on both sides; a wrong code derives neither; and an active
 * man in the middle — who must substitute a public key to each side — is exposed
 * because the two SAS strings disagree. Plus the trust store's job: an unknown
 * device is not remembered, and revoke forgets one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptPairing,
  beginPairing,
  completePairing,
  createIdentity,
  TrustStore,
  type Identity,
} from '../src/pairing.js';
import { open, seal, counterNonce } from '../src/envelope.js';

/** Run the honest three-message handshake and return both sides' sessions. */
function pair(a: Identity, b: Identity, codeForB?: string) {
  const offer = beginPairing(a); // A shows a code
  const bSide = acceptPairing(b, offer.invite, codeForB ?? offer.code); // B types it
  const aSide = completePairing(a, bSide.response, offer.code); // A finishes
  return { aSession: aSide.session, bSession: bSide.session, code: offer.code };
}

test('an honest pairing derives the SAME key and SAS on both sides', () => {
  const a = createIdentity();
  const b = createIdentity();
  const { aSession, bSession } = pair(a, b);

  assert.ok(aSession.key.equals(bSession.key), 'the session key is symmetric');
  assert.equal(aSession.key.length, 32, 'it is a 256-bit key');
  assert.equal(aSession.sas, bSession.sas, 'the SAS matches — the humans would see the same string');
  assert.match(aSession.sas, /^\d{3} \d{3}$/, 'the SAS is a readable 6 digits');

  // Each side names the other correctly.
  assert.equal(aSession.localDeviceId, a.deviceId);
  assert.equal(aSession.remoteDeviceId, b.deviceId);
  assert.equal(bSession.remoteDeviceId, a.deviceId);
});

test('a device id is a commitment to the public key, and both are stable', () => {
  const a = createIdentity();
  assert.equal(a.deviceId.length, 32, 'half a SHA-256, hex');
  assert.match(a.deviceId, /^[0-9a-f]+$/);
  assert.equal(a.publicKey.length, 32, 'raw X25519 public key');
  assert.notEqual(createIdentity().deviceId, a.deviceId, 'two identities differ');
});

test('the derived key actually works: A seals, B opens; and the reverse', () => {
  const a = createIdentity();
  const b = createIdentity();
  const { aSession, bSession } = pair(a, b);

  const env = seal(aSession.key, Buffer.from('waiting: 1 approval'), 0, counterNonce(0));
  assert.equal(open(bSession.key, env).toString(), 'waiting: 1 approval');
});

test('a WRONG code derives a different key and a different SAS — pairing fails silently', () => {
  const a = createIdentity();
  const b = createIdentity();
  // Same handshake, but B fat-fingers the code.
  const { aSession, bSession } = pair(a, b, '000000');

  assert.ok(!aSession.key.equals(bSession.key), 'the keys do not match');
  assert.notEqual(aSession.sas, bSession.sas, 'and neither does the SAS');

  // Concretely: a message A seals cannot be opened by B's mismatched key.
  const env = seal(aSession.key, Buffer.from('secret'), 0, counterNonce(0));
  assert.throws(() => open(bSession.key, env), 'the wrong-code peer cannot read a thing');
});

test('MITM — the SAS DIFFERS on the two honest sides, so the humans catch it', () => {
  // A believes it is pairing with B; B believes it is pairing with A; the
  // attacker M sits in the middle and substitutes its own key to each. The
  // out-of-band code cannot be altered (a human reads A's screen), so both legs
  // use A's code — the attacker's only lever is the key substitution, and that
  // is exactly what the SAS is built to expose.
  const a = createIdentity();
  const b = createIdentity();
  const m = createIdentity();

  const offer = beginPairing(a); // A's real code, carried out of band by the human
  // Leg 1: A <-> M. M poses as the peer to A.
  const mToA = acceptPairing(m, offer.invite, offer.code);
  const aSide = completePairing(a, mToA.response, offer.code);
  // Leg 2: M <-> B, reusing A's code because the human typed it into B.
  const bSide = acceptPairing(b, m2Invite(m), offer.code);
  // (M would finish its own view of leg 2 here; irrelevant to what the humans compare.)

  assert.notEqual(aSide.session.sas, bSide.session.sas, 'A and B see different SAS — MITM detected by eye');
  assert.ok(!aSide.session.key.equals(bSide.session.key), 'and they never share a key to leak through');
});

/** M's public invite as B would receive it (M posing as A toward B). */
function m2Invite(m: Identity) {
  return { deviceId: m.deviceId, publicKey: m.publicKey };
}

test('an invite whose deviceId does NOT commit to its public key is REJECTED', () => {
  // The whole point of deviceId = hash(publicKey) is that an id is a commitment to
  // a key, not a name an attacker can claim. That only holds if it is CHECKED where
  // an invite is consumed — the id travels as its own field and is attacker-forgeable.
  const a = createIdentity();
  const b = createIdentity();
  const m = createIdentity();

  // M presents its own key but wears B's id. Both wire-facing entry points must refuse.
  const spoofed = { deviceId: b.deviceId, publicKey: m.publicKey };
  assert.throws(() => acceptPairing(a, spoofed, '123456'), /commit to its public key/);
  assert.throws(() => completePairing(a, spoofed, '123456'), /commit to its public key/);

  // A malformed key (wrong width) is refused before it can reach the DH.
  const runt = { deviceId: m.deviceId, publicKey: m.publicKey.subarray(0, 16) };
  assert.throws(() => acceptPairing(a, runt, '123456'), /32 raw X25519 bytes/);

  // The honest invite still pairs — the check does not fire on a real device.
  const offer = beginPairing(a);
  assert.doesNotThrow(() => acceptPairing(b, offer.invite, offer.code));
});

test('a rogue device CANNOT claim a trusted id and evict the real peer from the trust store', () => {
  // Concrete attack the commitment closes: A is paired with the real B under idB.
  // A rogue M (its own key) tries to re-pair with A while wearing idB; if it
  // succeeded, trust.remember would overwrite idB and silently replace B with M.
  const a = createIdentity();
  const b = createIdentity();
  const m = createIdentity();

  const offer = beginPairing(a);
  const bSide = acceptPairing(b, offer.invite, offer.code);
  const aFin = completePairing(a, bSide.response, offer.code);
  const trustA = new TrustStore();
  trustA.remember(aFin.session);
  assert.ok(trustA.session(b.deviceId)!.key.equals(aFin.session.key), 'A trusts the real B');

  // M, mid-pairing, hands A a response wearing idB but backed by M's key.
  const offer2 = beginPairing(a);
  const mSpoof = { deviceId: b.deviceId, publicKey: m.publicKey };
  assert.throws(() => completePairing(a, mSpoof, offer2.code), /commit to its public key/);

  // The real B is untouched: no eviction, still B's key in B's slot.
  assert.equal(trustA.size, 1);
  assert.ok(trustA.session(b.deviceId)!.key.equals(aFin.session.key), 'the real B still holds idB');
});

test('TrustStore: an unknown device is rejected, a remembered one is found, revoke forgets', () => {
  const a = createIdentity();
  const b = createIdentity();
  const c = createIdentity();
  const { aSession } = pair(a, b);

  const trust = new TrustStore();
  assert.equal(trust.isPaired(b.deviceId), false, 'nobody is trusted at the start');
  assert.equal(trust.session(b.deviceId), undefined);

  trust.remember(aSession); // A's store now knows B
  assert.equal(trust.isPaired(b.deviceId), true);
  assert.equal(trust.session(b.deviceId), aSession);
  assert.equal(trust.isPaired(c.deviceId), false, 'an UNKNOWN device id is still rejected');
  assert.equal(trust.size, 1);
  assert.deepEqual(trust.devices(), [b.deviceId]);

  assert.equal(trust.revoke(b.deviceId), true, 'revoke reports it existed');
  assert.equal(trust.isPaired(b.deviceId), false, 'and it is gone');
  assert.equal(trust.revoke(b.deviceId), false, 'revoking twice reports it was already absent');
  assert.equal(trust.size, 0);
});
