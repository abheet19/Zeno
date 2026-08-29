/**
 * Append-only, hash-chained receipt ledger. Tamper-EVIDENT (not tamper-proof):
 * any edit or deletion breaks the chain, and verifyChain() localizes the first
 * break. Real cryptographic signing arrives with the later Signer slice — this
 * `selfHash` is computed by an injected Signer that is plain SHA-256 for now.
 */
import { hashOf } from './hash.js';
import type { EffectProof, Outcome, Receipt } from './types.js';

/** Pluggable signer. v1 = SHA-256; a keypair/HSM replaces it later. */
export type Signer = (content: string) => string;
export const sha256Signer: Signer = (content) => hashOf(content);

export interface NewReceipt {
  readonly id: string;
  readonly actionHash: string;
  readonly outcome: Outcome;
  readonly reason: string | null;
  readonly casBaseObserved: string;
  readonly externalEffect: EffectProof;
  readonly at: string;
}

export class Ledger {
  private readonly entries: Receipt[] = [];
  constructor(private readonly sign: Signer = sha256Signer) {}

  /** Append a receipt, linking it to the current chain tip. */
  append(r: NewReceipt): Receipt {
    const prevReceipt = this.entries.at(-1)?.selfHash ?? null;
    const body = {
      id: r.id,
      actionHash: r.actionHash,
      outcome: r.outcome,
      reason: r.reason,
      casBaseObserved: r.casBaseObserved,
      externalEffect: r.externalEffect,
      prevReceipt,
      at: r.at,
    };
    const selfHash = this.sign(hashOf(body));
    const receipt: Receipt = { ...body, selfHash };
    this.entries.push(receipt);
    return receipt;
  }

  all(): readonly Receipt[] {
    return this.entries;
  }

  /** Serialize as JSONL (one receipt per line) — the on-disk form. */
  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }

  /**
   * Walk the chain and verify every link. Returns the index of the first broken
   * link, or ok. Recomputes each selfHash and checks prevReceipt continuity.
   */
  verify(): { ok: boolean; firstBreakAt?: number } {
    let prev: string | null = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      const body = {
        id: e.id,
        actionHash: e.actionHash,
        outcome: e.outcome,
        reason: e.reason,
        casBaseObserved: e.casBaseObserved,
        externalEffect: e.externalEffect,
        prevReceipt: e.prevReceipt,
        at: e.at,
      };
      const expected = this.sign(hashOf(body));
      if (e.selfHash !== expected || e.prevReceipt !== prev) {
        return { ok: false, firstBreakAt: i };
      }
      prev = e.selfHash;
    }
    return { ok: true };
  }

  /** Load a JSONL string into a fresh ledger (for verifying an on-disk file). */
  static fromJSONL(text: string, sign: Signer = sha256Signer): Ledger {
    const l = new Ledger(sign);
    for (const line of text.split('\n').filter((x) => x.trim())) {
      l.entries.push(JSON.parse(line) as Receipt);
    }
    return l;
  }
}
