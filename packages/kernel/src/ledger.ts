/**
 * Append-only, hash-chained receipt ledger. Tamper-EVIDENT (not tamper-proof):
 * an edit, a deletion or a truncation breaks the chain, and verify() localizes
 * the first break. Real cryptographic signing arrives with the later Signer
 * slice — this `selfHash` is computed by an injected Signer that is plain
 * SHA-256 for now.
 *
 * Durability is injected exactly the way signing is: a `LedgerStore` receives
 * every appended line. The node:fs implementation lives in `ledger-node-fs.ts`
 * so this file stays pure, mirroring the executor / executor-node-fs split.
 */
import { hashOf } from './hash.js';
import { verifyReceiptSignature, type ReceiptSigner } from './signer.js';
import type { ActionKind, EffectProof, Outcome, Receipt, Tier } from './types.js';

/** Pluggable signer. v1 = SHA-256; a keypair/HSM replaces it later. */
export type Signer = (content: string) => string;
export const sha256Signer: Signer = (content) => hashOf(content);

/**
 * Where receipt lines are durably written. Injected, so the ledger itself never
 * touches a filesystem and stays replayable in tests.
 */
export interface LedgerStore {
  /** Append one serialized receipt. Implementations must flush before returning. */
  append(line: string): void;
  /** Every line written so far. Empty string when nothing has been written yet. */
  readAll(): string;
  /**
   * Optional truncation anchor. A hash chain cannot see its own tail being cut
   * off: delete the last N lines and the remaining prefix is still perfectly
   * self-consistent. A store that persists this small head record makes that
   * removal visible. Stores without it simply cannot detect tail truncation.
   */
  readHead?(): string | null;
  writeHead?(head: string): void;
}

export interface ChainStatus {
  readonly ok: boolean;
  readonly firstBreakAt?: number;
  /** Plain words for what is wrong at that index. */
  readonly reason?: string;
}

export interface NewReceipt {
  readonly id: string;
  readonly actionHash: string;
  readonly outcome: Outcome;
  readonly reason: string | null;
  readonly casBaseObserved: string;
  readonly externalEffect: EffectProof;
  readonly at: string;
  /** v2 — everything a capsule needs to render from this one line. */
  readonly schemaVersion: 2;
  readonly kind: ActionKind;
  readonly tier: Tier;
  readonly targetRef: string;
  readonly summary: string;
  readonly policyHash: string;
}

interface Head {
  readonly count: number;
  readonly tip: string | null;
}

/**
 * The bytes a receipt's `selfHash` covers: the whole receipt EXCEPT the hash
 * itself. Deriving this rather than listing fields means append() and verify()
 * cannot drift apart, and a v1 line written before the v2 fields existed still
 * verifies with no special case — the hash covers exactly the keys that line
 * actually carries.
 */
function bodyOf(r: Receipt): Record<string, unknown> {
  // Exclude BOTH selfHash and signature: the signature is produced from selfHash
  // after the fact, so it can never be part of the bytes selfHash covers. A
  // receipt with no signature strips a key that is not there — harmless, and it
  // keeps unsigned and signed ledgers verifying under one code path.
  const { selfHash: _h, signature: _s, ...body } = r as Receipt & { signature?: string };
  return body;
}

export class Ledger {
  private readonly entries: Receipt[] = [];
  /** Index of the first line that could not be read as a receipt at all. */
  private damagedAt: number | null = null;
  /** What the store last recorded the chain to be, if it keeps that anchor. */
  private expected: Head | null = null;
  /**
   * Actions that already reached a terminal outcome. This is what makes "one
   * attempt, ever" (L2/L4) survive a restart: the in-memory pending map can be
   * swept, but the LEDGER remembers permanently, so a re-preview of a spent
   * action can never resurrect it.
   *
   * `refused` is deliberately NOT terminal — a compare-and-swap refusal leaves
   * the approval unspent and a fresh preview is the correct next step.
   */
  private readonly terminal = new Set<string>();

  constructor(
    private readonly sign: Signer = sha256Signer,
    private readonly store: LedgerStore | null = null,
    private readonly receiptSigner: ReceiptSigner | null = null,
  ) {}

  /** Append a receipt, link it to the current chain tip, and write it through. */
  append(r: NewReceipt): Receipt {
    const prevReceipt = this.entries.at(-1)?.selfHash ?? null;
    const body = { ...r, prevReceipt };
    const selfHash = this.sign(hashOf(body));
    const signature = this.receiptSigner ? this.receiptSigner.signHash(selfHash) : undefined;
    const receipt: Receipt = signature === undefined ? { ...body, selfHash } : { ...body, selfHash, signature };

    // DURABLE FIRST, then in memory. If the store throws, nothing enters the
    // in-memory chain, so it can never run ahead of the file and fork it. The
    // caller sees the failure instead of holding a receipt that exists nowhere.
    this.store?.append(JSON.stringify(receipt));
    this.entries.push(receipt);
    this.remember(receipt);
    this.anchor();
    return receipt;
  }

  all(): readonly Receipt[] {
    return this.entries;
  }

  /** Serialize as JSONL (one receipt per line) — the on-disk form. */
  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }

  size(): number {
    return this.entries.length;
  }

  /** Has this exact action already had its one attempt? Survives restarts. */
  hasTerminal(actionHash: string): boolean {
    return this.terminal.has(actionHash);
  }

  /**
   * Walk the chain and verify every link: each record hashes to its own
   * `selfHash`, links to the one before it, the file does not stop mid-record,
   * and — where the store keeps an anchor — nothing has been removed from the
   * end. Returns the index of the first break, in plain words.
   */
  verify(): ChainStatus {
    let prev: string | null = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (typeof e.selfHash !== 'string') {
        return { ok: false, firstBreakAt: i, reason: 'that record carries no hash of its own' };
      }
      if (e.selfHash !== this.sign(hashOf(bodyOf(e)))) {
        return { ok: false, firstBreakAt: i, reason: 'that record no longer matches its own hash' };
      }
      if ((e.prevReceipt ?? null) !== prev) {
        return { ok: false, firstBreakAt: i, reason: 'that record does not link to the one before it' };
      }
      prev = e.selfHash;
    }
    if (this.damagedAt !== null) {
      return {
        ok: false,
        firstBreakAt: this.damagedAt,
        reason: 'the file stops holding readable receipts there',
      };
    }
    const exp = this.expected;
    if (exp !== null && (exp.count !== this.entries.length || exp.tip !== prev)) {
      return {
        ok: false,
        firstBreakAt: this.entries.length,
        reason: `the ledger records ${exp.count} receipts but ${this.entries.length} remain — receipts were removed from the end`,
      };
    }
    return { ok: true };
  }

  /**
   * Verify every detached signature against a public key. This is the
   * tamper-PROOF check: unlike verify() (which only proves the chain is
   * internally consistent), this proves each receipt was signed by the holder of
   * the private key and has not been altered since. A receipt with no signature
   * is reported so a partially-signed ledger cannot masquerade as fully signed.
   */
  verifySignatures(publicKeyPem: string): { ok: boolean; firstBadAt?: number; unsigned: number } {
    let unsigned = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i] as Receipt & { signature?: string };
      if (typeof e.signature !== 'string') {
        unsigned++;
        continue;
      }
      if (typeof e.selfHash !== 'string' || !verifyReceiptSignature(e.selfHash, e.signature, publicKeyPem)) {
        return { ok: false, firstBadAt: i, unsigned };
      }
    }
    return { ok: true, unsigned };
  }

  /** Read an existing ledger out of a store, and keep writing to it. */
  static load(store: LedgerStore, sign: Signer = sha256Signer, receiptSigner: ReceiptSigner | null = null): Ledger {
    const l = new Ledger(sign, store, receiptSigner);
    l.expected = readHead(store);
    l.ingest(store.readAll());
    return l;
  }

  /** Load a JSONL string into a fresh, store-less ledger (for verifying a file). */
  static fromJSONL(text: string, sign: Signer = sha256Signer): Ledger {
    const l = new Ledger(sign);
    l.ingest(text);
    return l;
  }

  /** Record where the chain now stands, so a later truncation is visible. */
  private anchor(): void {
    const head: Head = { count: this.entries.length, tip: this.entries.at(-1)?.selfHash ?? null };
    this.store?.writeHead?.(JSON.stringify(head));
    this.expected = head;
  }

  /**
   * Parse JSONL into entries. Tolerates CRLF (this is a Windows-first product)
   * and blank lines. A line that is not a JSON object ends the record: what came
   * before is kept, and verify() reports that index as the break. Nothing here
   * throws — a hand-edited ledger must be REPORTED, never crash the reader.
   */
  private ingest(text: string): void {
    // Strip a leading UTF-8 byte-order mark. Windows editors add one on save;
    // it wraps the FILE, it is not content of the first receipt. Treating it as
    // damage would report a false break at index 0 on an untouched ledger — and
    // would mask the real reason when a receipt genuinely has been edited.
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (const line of clean.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.damagedAt = this.entries.length;
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        // Valid JSON, but not a receipt — `null`, a number, an array. The record
        // stops making sense here just as surely as if the line were truncated.
        this.damagedAt = this.entries.length;
        return;
      }
      const receipt = parsed as Receipt;
      this.entries.push(receipt);
      this.remember(receipt);
    }
  }

  /** Index a receipt's action if its outcome ends the action for good. */
  private remember(r: Receipt): void {
    if (typeof r.actionHash !== 'string') return;
    if (r.outcome === 'refused') return; // re-previewable by design
    this.terminal.add(r.actionHash);
  }
}

/** Read the store's truncation anchor, tolerating its absence or corruption. */
function readHead(store: LedgerStore): Head | null {
  const raw = store.readHead?.();
  if (raw === undefined || raw === null || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const h = parsed as Partial<Head>;
    if (typeof h.count !== 'number') return null;
    return { count: h.count, tip: typeof h.tip === 'string' ? h.tip : null };
  } catch {
    return null;
  }
}
