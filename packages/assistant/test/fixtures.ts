/** Shared state for the assistant tests: one realistic Zeno, mid-morning. */
import { buildSnapshot, type Snapshot, type SnapshotParts } from '../src/index.js';

export const AT = '2026-09-05T09:00:00.000Z';

export function parts(): SnapshotParts {
  return {
    at: AT,
    pending: [
      { id: 'a1b2c3', summary: 'Commit the ledger migration to the sandbox repo', tier: 'T2', ageMin: 42 },
      { id: 'd4e5f6', summary: 'Push the release branch', tier: 'T3', ageMin: 7 },
    ],
    receipts: [
      { id: 'rc-9', outcome: 'COMMITTED', summary: 'Forge wrote the app shell', at: '2026-09-05T08:10:00.000Z' },
    ],
    work: [{ id: 'wk-1', title: 'Wire the Ask Zeno route', labels: ['assistant', 'daemon'], state: 'open' }],
    repo: { branch: 'zeno/sandbox', head: 'abc1234', changed: ['src/App.tsx', 'src/main.ts'] },
    memory: [{ id: 'mem-1', title: 'Storage decision', body: 'We keep the ledger as JSONL, one record a line.' }],
    devices: [{ name: 'abheet-desktop', paired: true }],
  };
}

export function snapshot(): Snapshot {
  return buildSnapshot(parts());
}
