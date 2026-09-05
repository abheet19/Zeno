/**
 * Zeno · Mesh — the Windows-side protocol core for pairing a phone to the PC and
 * converging a small amount of state between them, end-to-end encrypted.
 *
 * Four layers, each pure and independently testable:
 *   - pairing:  X25519 identities, a short-code + SAS handshake, a trust store.
 *   - envelope: the AES-256-GCM message frame and the replay window.
 *   - replica:  the last-writer-wins CRDT that guarantees convergence.
 *   - sync:     the seam that seals snapshots and applies them over a hostile wire.
 *
 * The phone client is a separate app; this package is proven against a SIMULATED
 * second device, which is the whole point — the protocol is correct before any
 * hardware exists.
 */
export {
  acceptPairing,
  beginPairing,
  completePairing,
  createIdentity,
  TrustStore,
  type Identity,
  type Invite,
  type PairingOffer,
  type Session,
} from './pairing.js';
export {
  counterNonce,
  decodeEnvelope,
  encodeEnvelope,
  open,
  randomNonceSource,
  ReplayGuard,
  seal,
  type Envelope,
  type NonceSource,
} from './envelope.js';
export {
  applyOp,
  emptyReplica,
  merge,
  mergeSnapshot,
  removeValue,
  setValue,
  snapshot,
  stateHash,
  type Entry,
  type Op,
  type Replica,
  type Snapshot,
  type Stamp,
} from './replica.js';
export {
  createSync,
  SyncEndpoint,
  type ReceiveResult,
  type RejectReason,
  type Transport,
} from './sync.js';
