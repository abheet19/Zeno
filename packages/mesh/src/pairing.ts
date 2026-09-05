/**
 * Device pairing over a short, human-transcribable code.
 *
 * Every device holds a long-lived X25519 identity keypair; its `deviceId` is the
 * hash of its public key, so an id is a commitment to a key rather than a name an
 * attacker can claim. Pairing does an X25519 Diffie-Hellman between the two
 * identities and runs the shared secret through HKDF into a 256-bit session key.
 *
 * Two independent defenses guard that handshake, aimed at the two ways a network
 * attacker can subvert a bare DH:
 *
 *   1. The CODE. One device shows a short code; the human carries it out of band
 *      to the other and types it in. The code is folded into HKDF as the salt, so
 *      a passive attacker who records both public keys still cannot derive the
 *      key without the code, and a device that was given the WRONG code derives a
 *      different key and simply cannot talk — the failure is silent and total,
 *      not a warning someone can click through.
 *
 *   2. The SAS. A short authentication string is derived from the shared secret
 *      AND both public keys and shown on both screens for the humans to compare.
 *      A man in the middle must substitute its own public key to each side, which
 *      gives each side a different shared secret and a different transcript — so
 *      the two SAS strings disagree and the humans catch it by eye. This is the
 *      belt to the code's suspenders: even if a code leaked, the SAS still exposes
 *      an active MITM.
 *
 * node:crypto only. No libsodium, no npm crypto.
 */
import {
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

const DOMAIN = 'zeno-mesh';
const SESSION_KEY_LEN = 32;
const SAS_BYTES = 5; // enough entropy for a 6-digit SAS with room to spare
const DEVICE_ID_HEX = 32; // 16 bytes of the pubkey hash, hex-encoded
const PUBLIC_KEY_LEN = 32; // raw X25519 public key

/** A device's long-lived identity. The private key stays a KeyObject — it is
 *  never exported, serialized, or logged. */
export interface Identity {
  readonly deviceId: string;
  readonly publicKey: Buffer; // raw 32-byte X25519 public key
  readonly privateKey: KeyObject;
}

/** What one device transmits to the other over the (hostile) wire. */
export interface Invite {
  readonly deviceId: string;
  readonly publicKey: Buffer; // raw 32-byte X25519 public key
}

/** The offer the initiating device produces: an invite to send, a code to show. */
export interface PairingOffer {
  readonly invite: Invite;
  readonly code: string;
}

/** A completed, authenticated pairing. The key is symmetric — both devices
 *  derive byte-identical `key` and `sas` — and each keeps its own view of who is
 *  local and who is remote. */
export interface Session {
  readonly localDeviceId: string;
  readonly remoteDeviceId: string;
  readonly key: Buffer;
  readonly sas: string;
}

/** Extract the raw 32-byte public key via JWK — stable across Node versions,
 *  unlike slicing a fixed offset out of the SPKI DER. */
function rawPublic(pub: KeyObject): Buffer {
  const jwk = pub.export({ format: 'jwk' }) as { x?: string };
  if (typeof jwk.x !== 'string') throw new Error('not an X25519 public key');
  return Buffer.from(jwk.x, 'base64url');
}

/** Rebuild a public KeyObject from raw bytes received over the wire. */
function publicKeyFrom(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') },
    format: 'jwk',
  });
}

/** A device id is a commitment to its public key: half a SHA-256, hex. */
function deviceIdOf(rawPub: Buffer): string {
  return createHash('sha256').update(rawPub).digest('hex').slice(0, DEVICE_ID_HEX);
}

/**
 * Enforce the commitment on an invite that arrived over the wire. `deviceId` is
 * DEFINED as `deviceIdOf(publicKey)`, but that only holds if it is checked where
 * an invite is consumed — minting the id honestly is not enough when the id
 * travels separately as an attacker-controllable field. An invite whose id does
 * not hash from its key is a device claiming a name it cannot back: reject it
 * loudly (a protocol violation, unlike a wrong code) before it can be paired
 * with or, worse, remembered under someone else's id and evict the real peer
 * from the trust store. The length check pins the key to 32 raw X25519 bytes so
 * the hash is taken over a canonical key and the DH cannot be fed a runt.
 */
function assertInviteBinding(invite: Invite): void {
  if (!Buffer.isBuffer(invite.publicKey) || invite.publicKey.length !== PUBLIC_KEY_LEN) {
    throw new Error('invite public key must be 32 raw X25519 bytes');
  }
  if (invite.deviceId !== deviceIdOf(invite.publicKey)) {
    throw new Error('invite deviceId does not commit to its public key');
  }
}

/** Mint a fresh device identity. */
export function createIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const raw = rawPublic(publicKey);
  return { deviceId: deviceIdOf(raw), publicKey: raw, privateKey };
}

function inviteOf(self: Identity): Invite {
  return { deviceId: self.deviceId, publicKey: self.publicKey };
}

/** A 6-digit code from a CSPRNG — short enough to read aloud, drawn without
 *  modulo bias by rejecting the tail above the last whole 1e6 block. */
function randomCode(): string {
  const LIMIT = 4_294_000_000; // largest multiple of 1e6 below 2^32, for unbiased mod
  let n = randomBytes(4).readUInt32BE(0);
  while (n >= LIMIT) n = randomBytes(4).readUInt32BE(0);
  return (n % 1_000_000).toString().padStart(6, '0');
}

/**
 * The shared derivation both sides run. Because ECDH is symmetric and both the
 * key-info and the SAS-info sort the two device ids and public keys, the two
 * devices compute identical `key` and `sas` from opposite viewpoints. The code
 * is the HKDF salt (wrong code -> wrong key), and the sorted public keys are
 * mixed into both derivations (substituted key -> different key AND different
 * SAS).
 */
function deriveSession(self: Identity, peer: Invite, code: string): Session {
  assertInviteBinding(peer); // the id must commit to the key, or there is no peer to speak of
  const shared = diffieHellman({ privateKey: self.privateKey, publicKey: publicKeyFrom(peer.publicKey) });
  const ids = [self.deviceId, peer.deviceId].sort();
  const transcript = Buffer.concat([self.publicKey, peer.publicKey].sort(Buffer.compare));
  const salt = Buffer.from(code, 'utf8');

  const keyInfo = Buffer.concat([Buffer.from(`${DOMAIN}/session/v1|${ids.join('|')}|`, 'utf8'), transcript]);
  const key = Buffer.from(hkdfSync('sha256', shared, salt, keyInfo, SESSION_KEY_LEN));

  const sasInfo = Buffer.concat([Buffer.from(`${DOMAIN}/sas/v1|${ids.join('|')}|`, 'utf8'), transcript]);
  const sasBytes = Buffer.from(hkdfSync('sha256', shared, salt, sasInfo, SAS_BYTES));
  const sas = renderSas(sasBytes);

  return { localDeviceId: self.deviceId, remoteDeviceId: peer.deviceId, key, sas };
}

/** Render SAS material as a grouped 6-digit string, e.g. "047 913". */
function renderSas(material: Buffer): string {
  const digits = (material.readUIntBE(0, SAS_BYTES) % 1_000_000).toString().padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

/** Device A: produce an invite to transmit and a code to display. A keeps the
 *  code and its own identity to finish with `completePairing`. */
export function beginPairing(self: Identity): PairingOffer {
  return { invite: inviteOf(self), code: randomCode() };
}

/** Device B: given A's invite (over the wire) and the code (from the human),
 *  derive the session and produce B's own invite to send back to A. */
export function acceptPairing(
  self: Identity,
  invite: Invite,
  code: string,
): { session: Session; response: Invite } {
  return { session: deriveSession(self, invite, code), response: inviteOf(self) };
}

/** Device A: given B's response and the code A displayed, derive the same
 *  session. Both sides now hold an identical key and SAS. */
export function completePairing(self: Identity, response: Invite, code: string): { session: Session } {
  return { session: deriveSession(self, response, code) };
}

/**
 * The set of remembered devices — the answer to "who am I paired with".
 *
 * An UNKNOWN device id is rejected by construction: it is simply not in the
 * store, so `session` returns undefined and the sync layer refuses it. `revoke`
 * forgets a device (and reports whether it was there), which instantly turns a
 * once-trusted peer back into an unknown one whose next message is dropped.
 * Keyed on the remote device id — the store on device A remembers B.
 */
export class TrustStore {
  private readonly byId = new Map<string, Session>();

  remember(session: Session): void {
    this.byId.set(session.remoteDeviceId, session);
  }

  session(deviceId: string): Session | undefined {
    return this.byId.get(deviceId);
  }

  isPaired(deviceId: string): boolean {
    return this.byId.has(deviceId);
  }

  revoke(deviceId: string): boolean {
    return this.byId.delete(deviceId);
  }

  devices(): readonly string[] {
    return [...this.byId.keys()];
  }

  get size(): number {
    return this.byId.size;
  }
}
