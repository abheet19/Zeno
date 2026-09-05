/**
 * Walk the ledger on disk and prove it has not been touched.
 *
 * Tamper-EVIDENT, not tamper-proof: anyone can edit the file, and this tells you
 * exactly where they did it. Real signatures (tamper-PROOF) arrive with the
 * Signer slice; the seam for them is already the injected `Signer`.
 */
import { join } from 'node:path';
import { Ledger, nodeLedgerStore, readSignerPublicKey, type Receipt } from '@abheet19/zeno-kernel';

export interface VerifyResult {
  readonly ok: boolean;
  readonly count: number;
  readonly firstBreakAt?: number;
  /** Plain words for what is wrong at that index. */
  readonly reason?: string;
  /** Signature-verification result, when a signing key is present. */
  readonly signatures?: { ok: boolean; firstBadAt?: number; unsigned: number };
  readonly rows: readonly Receipt[];
  readonly ledgerPath: string;
}

export function verifyLedger(dir: string): VerifyResult {
  const ledgerPath = join(dir, 'ledger.jsonl');
  const ledger = Ledger.load(nodeLedgerStore(ledgerPath));
  const v = ledger.verify();
  // Tamper-PROOF check, when a signing key exists: verify every receipt's
  // Ed25519 signature, not just the hash chain. This is what earns the word
  // "signed" — without it, a rewriter who recomputes the hashes passes verify().
  const pub = readSignerPublicKey(join(dir, 'keys'));
  const sig = pub ? ledger.verifySignatures(pub) : null;
  return {
    ok: v.ok,
    count: ledger.size(),
    rows: ledger.all(),
    ledgerPath,
    ...(v.firstBreakAt === undefined ? {} : { firstBreakAt: v.firstBreakAt }),
    ...(v.reason === undefined ? {} : { reason: v.reason }),
    ...(sig === null ? {} : { signatures: sig }),
  };
}

export function renderVerify(r: VerifyResult, log: (s: string) => void): void {
  log('');
  log(`  LEDGER  ${r.ledgerPath}`);
  log('');
  for (const [i, row] of r.rows.entries()) {
    const flag = r.firstBreakAt === i ? ' <-- FIRST BREAK' : '';
    log(
      `     ${String(i).padStart(2)}  ${row.outcome.padEnd(15)} ${String(row.tier ?? '--').padEnd(3)} ` +
        `${row.selfHash.slice(0, 10)}  ${row.summary ?? '(v1 receipt)'}${flag}`,
    );
  }
  log('');
  if (r.signatures) {
    const sg = r.signatures;
    log(sg.ok
      ? `  SIGNATURES — all verified (Ed25519)${sg.unsigned ? `, ${sg.unsigned} unsigned` : ''}.`
      : `  SIGNATURES — BROKEN at index ${sg.firstBadAt}: a receipt's signature does not match.`);
  }
  if (r.ok && (!r.signatures || r.signatures.ok)) {
    log(`  VERIFIED — ${r.count} receipts, every link intact${r.signatures ? ' and every signature valid' : ''}.`);
  } else {
    log(`  BROKEN at index ${r.firstBreakAt} — ${r.reason ?? 'the chain does not hold'}.`);
    const intact = Math.min(r.firstBreakAt ?? 0, r.rows.length);
    log(
      intact === 0
        ? '  Nothing before it survives.'
        : `  Records 0..${intact - 1} verify; the chain stops being trustworthy there.`,
    );
  }
  log('');
}
