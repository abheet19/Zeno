/**
 * Durability for open approvals.
 *
 * Without this, restarting the daemon voids every capsule the owner has not yet
 * acted on, and an approval granted a moment before a crash can never be
 * committed — the kernel would have forgotten it ever issued one. The pending
 * set is small and short-lived, so it is rewritten whole rather than appended
 * to; a torn write costs at most the open previews, never the receipt chain.
 *
 * Injected exactly like `LedgerStore` and `Signer`, so the kernel itself still
 * touches no filesystem.
 */
import type { ActionHash, ActionRequest, Approval, Binding } from './types.js';

export interface PendingStore {
  /** Every persisted pending record, as JSONL. Empty string when there are none. */
  readAll(): string;
  /** Replace the whole set. Implementations must be atomic and flush. */
  writeAll(text: string): void;
}

/** The serialized form of one open action. */
export interface PendingRecord {
  readonly req: ActionRequest;
  readonly binding: Binding;
  readonly actionHash: ActionHash;
  readonly state: 'PREVIEWED' | 'AUTO' | 'DENIED' | 'APPROVED' | 'SPENT';
  readonly approval: Approval | null;
  readonly nonce: string | null;
  /** When the preview was taken — the clock the TTL sweep measures against. */
  readonly previewedAt: string;
}

export function serializePending(records: readonly PendingRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n');
}

/**
 * Parse persisted records. A line that cannot be read is DROPPED rather than
 * fatal: a corrupt pending file costs the owner a re-preview, whereas refusing
 * to start would strand them. The receipt chain has the opposite rule, because
 * there a missing line is missing evidence.
 */
export function parsePending(text: string): PendingRecord[] {
  const out: PendingRecord[] = [];
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of clean.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const r = parsed as Partial<PendingRecord>;
    if (typeof r.actionHash !== 'string' || typeof r.state !== 'string') continue;
    if (typeof r.previewedAt !== 'string' || r.binding === undefined || r.req === undefined) continue;
    out.push(r as PendingRecord);
  }
  return out;
}
