/**
 * Load or create the Ed25519 receipt-signing key on disk. Isolated here because
 * it generates a key (randomness) and touches the filesystem — neither belongs
 * in the pure kernel core. The private key is written 0600; the public key sits
 * beside it so it can be shared for verification.
 */
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519Signer, type ReceiptSigner } from './signer.js';

export function loadOrCreateSigner(dir: string): ReceiptSigner {
  mkdirSync(dir, { recursive: true });
  const privPath = join(dir, 'receipt-key.pem');
  const pubPath = join(dir, 'receipt-key.pub.pem');

  // The PRIVATE key is the source of truth. If it exists, the public key is
  // always DERIVED from it — never read from a possibly-missing file. Reading
  // both and regenerating on any failure meant that deleting the public key
  // silently minted a whole new keypair, orphaning every receipt signed with
  // the old one. The private key is the identity; the public file is a cache.
  let priv: string;
  try {
    priv = readFileSync(privPath, 'utf8');
  } catch {
    const { privateKey } = generateKeyPairSync('ed25519');
    priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    writeFileSync(privPath, priv, { mode: 0o600 });
  }
  const pub = createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
  writeFileSync(pubPath, pub); // (re)materialise the cache from the real key
  return ed25519Signer(priv, pub);
}

/** Read just the public key, for a verifier that must never see the private one. */
export function readSignerPublicKey(dir: string): string | null {
  try {
    return readFileSync(join(dir, 'receipt-key.pub.pem'), 'utf8');
  } catch {
    return null;
  }
}
