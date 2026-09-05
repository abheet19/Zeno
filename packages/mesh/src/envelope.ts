/**
 * The end-to-end-encrypted message envelope.
 *
 * Pure over an injected key and an injected nonce: `seal` takes both, so a test
 * gets deterministic bytes and production wires in whatever nonce discipline it
 * likes. AES-256-GCM gives confidentiality AND integrity in one primitive — the
 * 16-byte tag is a MAC over the ciphertext — and the sequence number is bound in
 * as ADDITIONAL AUTHENTICATED DATA, so it is covered by the tag without being
 * encrypted. That binding is the point: an attacker who flips a ciphertext byte,
 * swaps in a different key, or rewrites the `seq` to make an old message look new
 * cannot produce a tag that verifies, so `open` throws instead of handing back
 * plaintext. Confidentiality (they cannot read it) and integrity (they cannot
 * forge one that decrypts) both reduce to GCM's tag check.
 *
 * Nonce discipline, stated because GCM is unforgiving about it: a (key, nonce)
 * pair must NEVER repeat. Sync gives each direction its own derived key and a
 * strictly monotonic seq, and `counterNonce` turns that seq into the nonce — so
 * within a direction the nonce never repeats, and across directions the KEY
 * differs. `randomNonceSource` is the alternative when no such counter exists.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_LEN = 32; // AES-256
const NONCE_LEN = 12; // 96-bit GCM nonce, the standard/most-tested size
const TAG_LEN = 16; // 128-bit GCM tag
const SEQ_LEN = 8; // 64-bit big-endian sequence number

export interface Envelope {
  readonly seq: number;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
}

/** Produces the 12-byte nonce for a given seq. Injected so tests are exact. */
export type NonceSource = (seq: number) => Buffer;

/** The seq, big-endian in 8 bytes, used as GCM additional authenticated data. */
function seqAad(seq: number): Buffer {
  const b = Buffer.alloc(SEQ_LEN);
  b.writeBigUInt64BE(BigInt(seq), 0);
  return b;
}

/**
 * Seal plaintext under `key` at `seq` with the given `nonce`. The seq travels in
 * the clear (the receiver needs it to check the AAD and the replay window) but
 * is authenticated, so it cannot be altered without breaking the tag.
 */
export function seal(key: Buffer, plaintext: Uint8Array, seq: number, nonce: Buffer): Envelope {
  if (key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} bytes`);
  if (nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`);
  if (!Number.isInteger(seq) || seq < 0) throw new Error('seq must be a non-negative integer');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(seqAad(seq));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { seq, nonce: Buffer.from(nonce), tag: cipher.getAuthTag(), ciphertext };
}

/**
 * Open an envelope, or THROW. Every tampering path lands here: a flipped
 * ciphertext or tag byte, the wrong key, or a `seq` that does not match the one
 * sealed all make `final()` throw. There is no "return null on failure" — a
 * failed open is an event the caller must handle, never a value it can forget to
 * check.
 *
 * The tag width is enforced BEFORE the GCM check, and that guard is load-bearing:
 * GCM treats a short tag as a valid tag over fewer bytes, so `setAuthTag` with a
 * truncated (but still GCM-legal: 4/8/12..15-byte) tag makes `final()` verify
 * only those bytes and hand back plaintext — silently downgrading forgery
 * resistance from 2^-128 to as low as 2^-32. `seal` and `encodeEnvelope` both fix
 * these widths; `open` is the AEAD boundary and must not trust a caller- or
 * peer-supplied length. A wrong-width nonce or tag is a malformation, so `open`
 * fails closed on it exactly as it does on a bad tag.
 */
export function open(key: Buffer, env: Envelope): Buffer {
  if (key.length !== KEY_LEN) throw new Error(`key must be ${KEY_LEN} bytes`);
  if (env.nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`);
  if (env.tag.length !== TAG_LEN) throw new Error(`tag must be ${TAG_LEN} bytes`);
  const decipher = createDecipheriv('aes-256-gcm', key, env.nonce);
  decipher.setAAD(seqAad(env.seq));
  decipher.setAuthTag(env.tag);
  return Buffer.concat([decipher.update(env.ciphertext), decipher.final()]);
}

/** Wire encoding: seq(8) ++ nonce(12) ++ tag(16) ++ ciphertext. */
export function encodeEnvelope(env: Envelope): Buffer {
  if (env.nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`);
  if (env.tag.length !== TAG_LEN) throw new Error(`tag must be ${TAG_LEN} bytes`);
  const head = Buffer.alloc(SEQ_LEN);
  head.writeBigUInt64BE(BigInt(env.seq), 0);
  return Buffer.concat([head, env.nonce, env.tag, env.ciphertext]);
}

/** Inverse of `encodeEnvelope`. Throws on a frame too short to be well-formed. */
export function decodeEnvelope(bytes: Buffer): Envelope {
  if (bytes.length < SEQ_LEN + NONCE_LEN + TAG_LEN) throw new Error('envelope too short');
  const seq = Number(bytes.readBigUInt64BE(0));
  const nonce = bytes.subarray(SEQ_LEN, SEQ_LEN + NONCE_LEN);
  const tag = bytes.subarray(SEQ_LEN + NONCE_LEN, SEQ_LEN + NONCE_LEN + TAG_LEN);
  const ciphertext = bytes.subarray(SEQ_LEN + NONCE_LEN + TAG_LEN);
  return { seq, nonce, tag, ciphertext };
}

/** A deterministic nonce = seq in the low 8 bytes. Unique while seq is unique. */
export function counterNonce(seq: number): Buffer {
  const n = Buffer.alloc(NONCE_LEN);
  n.writeBigUInt64BE(BigInt(seq), NONCE_LEN - SEQ_LEN);
  return n;
}

/** A random-nonce source, for callers without a monotonic counter to lean on. */
export function randomNonceSource(): NonceSource {
  return () => randomBytes(NONCE_LEN);
}

/**
 * Replay defense with a sliding window (the DTLS/IPsec design).
 *
 * A strict "reject anything not strictly newer" counter would defeat replays but
 * also throw away every legitimately reordered message, which a hostile — or
 * merely mobile — network produces constantly. The window instead remembers the
 * last `windowSize` sequence numbers as a bitmap: a seq newer than the high-water
 * mark is accepted and slides the window; a seq inside the window is accepted
 * only if its bit is unset (first time seen) and rejected if set (a duplicate or
 * replay); a seq below the window is too old to prove fresh and is rejected.
 *
 * The result is exactly the threat-model contract: reordering within the window
 * converges, but a captured envelope re-injected later — same seq, already
 * marked — cannot be passed off as new.
 */
export class ReplayGuard {
  private highest = -1;
  private mask = 0n;
  private readonly windowMask: bigint;

  constructor(private readonly windowSize = 64) {
    if (!Number.isInteger(windowSize) || windowSize < 1) throw new Error('windowSize must be >= 1');
    this.windowMask = (1n << BigInt(windowSize)) - 1n;
  }

  /** True if `seq` is fresh (and records it); false if replayed or too old. */
  accept(seq: number): boolean {
    if (!Number.isInteger(seq) || seq < 0) return false;
    if (this.highest < 0) {
      this.highest = seq;
      this.mask = 1n; // bit 0 marks the high-water mark itself
      return true;
    }
    if (seq > this.highest) {
      const shift = BigInt(seq - this.highest);
      this.mask = ((this.mask << shift) & this.windowMask) | 1n;
      this.highest = seq;
      return true;
    }
    const offset = this.highest - seq;
    if (offset >= this.windowSize) return false; // fell off the back of the window
    const bit = 1n << BigInt(offset);
    if ((this.mask & bit) !== 0n) return false; // already accepted — a replay
    this.mask |= bit;
    return true;
  }
}
