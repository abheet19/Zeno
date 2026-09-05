/**
 * Sync — the seam between a Session, a Replica, and the hostile wire.
 *
 * A `SyncEndpoint` owns one device's side of one pairing. It is pure over an
 * injected transport (a function that carries bytes) and an injected nonce
 * source, so a test can wire two endpoints to an in-memory channel that loses,
 * reorders, and duplicates frames at will and watch them converge anyway.
 *
 * Two design choices carry the threat model:
 *
 *   - State-based sync. `push` seals the WHOLE current replica snapshot, not a
 *     delta. Because the replica is a CvRDT and merge is a lattice join, a
 *     snapshot can be dropped, delivered late, or delivered twice with no harm:
 *     the next snapshot supersedes a lost one, and re-merging one already seen
 *     changes nothing. Losing the network can only delay convergence, never lose
 *     a write — the data lives in the durable local replica, and the latest
 *     snapshot to get through in each direction is all convergence needs.
 *
 *   - Directional keys. Both devices share one session key, but each seals under
 *     a key derived from ITS OWN device id, so the two directions never share a
 *     (key, nonce) pair even though both start their seq at 0. The sender id
 *     rides in the clear only as a routing hint; it is not trusted, because a
 *     frame that opens at all must have been sealed with the peer's send key,
 *     which only the peer holds — attribution comes from the key, not the label.
 *
 * Every rejection the wire can provoke is reported, never thrown: an unknown or
 * revoked sender, a tampered frame that fails the tag, a replayed seq, or a
 * malformed frame. `receive` advances the replica only on a genuinely fresh,
 * authentic snapshot.
 */
import { hkdfSync } from 'node:crypto';
import type { Session } from './pairing.js';
import { TrustStore } from './pairing.js';
import {
  decodeEnvelope,
  encodeEnvelope,
  open,
  ReplayGuard,
  seal,
  type Envelope,
  type NonceSource,
} from './envelope.js';
import { mergeSnapshot, snapshot, stateHash, type Replica, removeValue, setValue } from './replica.js';

/** Carries opaque bytes toward the peer. Injected; the test channel is lossy. */
export type Transport = (bytes: Buffer) => void;

export type RejectReason = 'malformed' | 'unknown-device' | 'bad-tag' | 'replay';

export type ReceiveResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: RejectReason };

/** Per-direction key: HKDF of the session key, keyed by the SENDER's id, so both
 *  devices derive the same key for a given sender (A.send === B.recv). */
function directionalKey(sessionKey: Buffer, senderId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', sessionKey, Buffer.alloc(0), Buffer.from(`zeno-mesh/tx/v1|${senderId}`, 'utf8'), 32),
  );
}

/** Frame = senderId length(2) ++ senderId ++ encoded envelope. */
function frame(senderId: string, env: Envelope): Buffer {
  const id = Buffer.from(senderId, 'utf8');
  const head = Buffer.alloc(2);
  head.writeUInt16BE(id.length, 0);
  return Buffer.concat([head, id, encodeEnvelope(env)]);
}

function deframe(bytes: Buffer): { senderId: string; env: Envelope } {
  if (bytes.length < 2) throw new Error('frame too short');
  const idLen = bytes.readUInt16BE(0);
  if (bytes.length < 2 + idLen) throw new Error('frame truncated');
  const senderId = bytes.subarray(2, 2 + idLen).toString('utf8');
  return { senderId, env: decodeEnvelope(bytes.subarray(2 + idLen)) };
}

export class SyncEndpoint {
  private replicaState: Replica;
  private readonly guard: ReplayGuard;
  private sendSeq = 0;
  private readonly sendKey: Buffer;
  private readonly recvKey: Buffer;

  constructor(
    private readonly session: Session,
    replica: Replica,
    private readonly trust: TrustStore,
    private readonly transport: Transport,
    private readonly nonce: NonceSource,
    windowSize = 64,
  ) {
    this.replicaState = replica;
    this.guard = new ReplayGuard(windowSize);
    this.sendKey = directionalKey(session.key, session.localDeviceId);
    this.recvKey = directionalKey(session.key, session.remoteDeviceId);
  }

  get replica(): Replica {
    return this.replicaState;
  }

  stateHash(): string {
    return stateHash(this.replicaState);
  }

  /** Originate a local write. Broadcast happens on the next `push`. */
  set(id: string, value: unknown): void {
    this.replicaState = setValue(this.replicaState, id, value).replica;
  }

  /** Originate a local delete (a tombstone). Broadcast on the next `push`. */
  remove(id: string): void {
    this.replicaState = removeValue(this.replicaState, id).replica;
  }

  /**
   * Seal the current whole-replica snapshot and hand it to the transport. Each
   * push takes a fresh, strictly increasing seq — even a re-push of unchanged
   * state — so a re-send is a NEW message the peer's replay window accepts,
   * while the wire's own duplicate of an old frame keeps that frame's seq and is
   * rejected as the replay it is.
   */
  push(): void {
    const seq = this.sendSeq++;
    const plaintext = Buffer.from(JSON.stringify(snapshot(this.replicaState)), 'utf8');
    const env = seal(this.sendKey, plaintext, seq, this.nonce(seq));
    this.transport(frame(this.session.localDeviceId, env));
  }

  /**
   * Process one inbound frame. Order matters: reject an unknown sender before
   * touching crypto; verify the tag before consulting the replay window (so
   * injected garbage cannot advance the window and starve real messages); check
   * the window before merging (so a duplicate authentic frame is not applied
   * twice — harmless for a CvRDT, but the guard is what proves freshness).
   */
  receive(bytes: Buffer): ReceiveResult {
    let parsed: { senderId: string; env: Envelope };
    try {
      parsed = deframe(bytes);
    } catch {
      return { accepted: false, reason: 'malformed' };
    }
    const { senderId, env } = parsed;
    if (senderId !== this.session.remoteDeviceId || !this.trust.isPaired(senderId)) {
      return { accepted: false, reason: 'unknown-device' };
    }
    let plaintext: Buffer;
    try {
      plaintext = open(this.recvKey, env);
    } catch {
      return { accepted: false, reason: 'bad-tag' };
    }
    if (!this.guard.accept(env.seq)) return { accepted: false, reason: 'replay' };
    let snap: unknown;
    try {
      snap = JSON.parse(plaintext.toString('utf8'));
    } catch {
      return { accepted: false, reason: 'malformed' };
    }
    this.replicaState = mergeSnapshot(this.replicaState, snap);
    return { accepted: true };
  }
}

/** Construct an endpoint for a session's local device over a given replica. */
export function createSync(
  session: Session,
  replica: Replica,
  trust: TrustStore,
  transport: Transport,
  nonce: NonceSource,
  windowSize = 64,
): SyncEndpoint {
  return new SyncEndpoint(session, replica, trust, transport, nonce, windowSize);
}
