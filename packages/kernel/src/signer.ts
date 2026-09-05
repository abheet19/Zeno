/**
 * Cryptographically signed receipts — the step from tamper-EVIDENT to
 * tamper-PROOF.
 *
 * The hash chain already catches an edit and says where. But anyone who can
 * rewrite the file can also recompute the hashes, so the chain proves internal
 * consistency, not authenticity. A detached Ed25519 signature over each receipt's
 * selfHash closes that: only the holder of the private key can produce a valid
 * signature, so a forged or rewritten receipt cannot be signed, and anyone with
 * the PUBLIC key can verify the whole ledger without being able to alter it.
 *
 * Ed25519 signatures are deterministic, so a signed ledger stays byte-identical
 * across a replay — the property the whole kernel is built on survives. Uses
 * node:crypto (local primitives, never network), the same module `hash.ts`
 * already depends on.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export interface ReceiptSigner {
  /** Detached Ed25519 signature over a receipt's selfHash, as hex. */
  signHash(selfHashHex: string): string;
  /** The PEM public key, so a verifier needs nothing secret. */
  readonly publicKeyPem: string;
}

/** Build a signer from a keypair already in hand (PEM strings). */
export function ed25519Signer(privateKeyPem: string, publicKeyPem: string): ReceiptSigner {
  const key = createPrivateKey(privateKeyPem);
  // Confirm the public half parses now, not at first verify.
  createPublicKey(publicKeyPem);
  return {
    publicKeyPem,
    signHash(selfHashHex: string): string {
      // Ed25519 takes `null` for the digest algorithm — it hashes internally.
      return cryptoSign(null, Buffer.from(selfHashHex, 'utf8'), key).toString('hex');
    },
  };
}

/** Verify one detached signature. Never throws — a bad input is simply invalid. */
export function verifyReceiptSignature(
  selfHashHex: string,
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  try {
    return cryptoVerify(
      null,
      Buffer.from(selfHashHex, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}
