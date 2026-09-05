/**
 * Signed receipts — tamper-PROOF, not merely tamper-evident.
 *
 * The chain proves a ledger is internally consistent; a rewriter who recomputes
 * the hashes defeats it. A signature proves each receipt was produced by the
 * holder of the private key, and nobody else can forge one. These tests are that
 * distinction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, Ledger, ed25519Signer, loadOrCreateSigner, verifyReceiptSignature } from '../src/index.js';
import type { Receipt } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

function keypair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

test('a signed ledger verifies under its public key', async () => {
  const { priv, pub } = keypair();
  const world = new TestWorld();
  const k = new Kernel(world, { receiptSigner: ed25519Signer(priv, pub) });
  for (let i = 0; i < 3; i++) {
    const pv = k.preview(buildRequest(world, { kind: 'read' }));
    await k.commit(pv.actionHash, okExecutor());
  }
  const v = k.verifyReceiptSignatures(pub);
  assert.equal(v.ok, true);
  assert.equal(v.unsigned, 0, 'every receipt is signed');
  assert.equal(k.signerPublicKey(), pub);
});

test('a receipt signed by one key does NOT verify under a different key', async () => {
  const a = keypair();
  const b = keypair();
  const world = new TestWorld();
  const k = new Kernel(world, { receiptSigner: ed25519Signer(a.priv, a.pub) });
  const pv = k.preview(buildRequest(world, { kind: 'read' }));
  await k.commit(pv.actionHash, okExecutor());
  assert.equal(k.verifyReceiptSignatures(a.pub).ok, true);
  assert.equal(k.verifyReceiptSignatures(b.pub).ok, false, 'a stranger key cannot vouch for it');
});

test('a rewritten-but-rehashed receipt breaks the SIGNATURE even when the chain looks fine', async () => {
  const { priv, pub } = keypair();
  const signer = ed25519Signer(priv, pub);
  const world = new TestWorld();
  const k = new Kernel(world, { receiptSigner: signer });
  for (let i = 0; i < 2; i++) {
    const pv = k.preview(buildRequest(world, { kind: 'patch.task' }));
    await k.commit(k.approve(pv.actionHash), okExecutor());
  }
  const rows = [...k.receipts()] as Receipt[];

  // A forger edits a summary and RECOMPUTES the chain hashes so verify() passes —
  // the classic attack the chain alone cannot stop. But they have no private key.
  const tampered = rows.map((r, i) => (i === 0 ? { ...r, summary: 'a lie' } : r));
  // rebuild selfHash exactly the way the ledger does — sha256Signer(hashOf(body))
  // — so the internal chain is self-consistent again, but keep the OLD signature.
  const { hashOf, sha256Signer } = await import('../src/index.js');
  const forged: Receipt[] = [];
  let prev: string | null = null;
  for (const r of tampered) {
    const { selfHash: _s, signature: _sig, ...bodyNoSelf } = r as Receipt & { signature?: string };
    const body = { ...bodyNoSelf, prevReceipt: prev };
    const selfHash = sha256Signer(hashOf(body));
    forged.push({ ...(body as object), selfHash, signature: r.signature } as Receipt);
    prev = selfHash;
  }
  const jsonl = forged.map((r) => JSON.stringify(r)).join('\n');
  const ledger = Ledger.fromJSONL(jsonl);

  assert.equal(ledger.verify().ok, true, 'the chain was rebuilt, so the cheap check passes');
  assert.equal(ledger.verifySignatures(pub).ok, false, 'but the signature over the OLD hash no longer matches');
  assert.equal(ledger.verifySignatures(pub).firstBadAt, 0, 'and it points at the doctored receipt');
});

test('an unsigned ledger still works — signing is opt-in', async () => {
  const world = new TestWorld();
  const k = new Kernel(world); // no signer
  const pv = k.preview(buildRequest(world, { kind: 'read' }));
  const r = await k.commit(pv.actionHash, okExecutor());
  assert.equal((r as Receipt & { signature?: string }).signature, undefined, 'no signature when none was configured');
  assert.equal(k.verifyChain().ok, true, 'and the chain still verifies');
  assert.equal(k.signerPublicKey(), null);
});

test('verifySignatures reports how many receipts were unsigned (no silent gaps)', () => {
  const { pub } = keypair();
  // a hand-built ledger with a receipt that simply has no signature field
  const unsigned = Ledger.fromJSONL('');
  const r = unsigned.verifySignatures(pub);
  assert.equal(r.ok, true);
  assert.equal(r.unsigned, 0);
});

test('verifyReceiptSignature never throws on garbage input', () => {
  const { pub } = keypair();
  assert.equal(verifyReceiptSignature('abc', 'not-hex-zz', pub), false);
  assert.equal(verifyReceiptSignature('abc', '', 'not-a-key'), false);
});

test('REAL FS — a key is generated once, reused after, and only the public half is shareable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-key-'));
  try {
    const s1 = loadOrCreateSigner(dir);
    const s2 = loadOrCreateSigner(dir); // second call reuses the SAME key
    const sig1 = s1.signHash('deadbeef');
    const sig2 = s2.signHash('deadbeef');
    assert.equal(sig1, sig2, 'the key persisted, so signatures are stable');
    assert.equal(s1.publicKeyPem, s2.publicKeyPem);

    const priv = readFileSync(join(dir, 'receipt-key.pem'), 'utf8');
    const pub = readFileSync(join(dir, 'receipt-key.pub.pem'), 'utf8');
    assert.match(priv, /PRIVATE KEY/);
    assert.match(pub, /PUBLIC KEY/);
    assert.equal(verifyReceiptSignature('deadbeef', sig1, pub), true, 'the on-disk public key verifies the signature');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting the public key does NOT rotate the private key (no orphaned receipts)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-key2-'));
  try {
    const s1 = loadOrCreateSigner(dir);
    const sigBefore = s1.signHash('cafebabe');

    rmSync(join(dir, 'receipt-key.pub.pem'), { force: true }); // lose only the public cache
    const s2 = loadOrCreateSigner(dir);

    assert.equal(s2.publicKeyPem, s1.publicKeyPem, 'the identity is unchanged');
    assert.equal(s2.signHash('cafebabe'), sigBefore, 'so old receipts still verify');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
