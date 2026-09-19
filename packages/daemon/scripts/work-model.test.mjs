import test from 'node:test';
import assert from 'node:assert/strict';
import { forgeWorkDetail, workTransitionAction } from '../public/bind/lists/work-model.js';

test('Work controls expose complete/reopen only for canonical local items', () => {
  const local = { id: 'local:7', source: 'local' };
  assert.deepEqual(workTransitionAction(local, 'open'), {
    path: '/work/close', label: 'Mark complete', pendingLabel: 'Completing…', nextState: 'closed',
  });
  assert.deepEqual(workTransitionAction(local, 'closed'), {
    path: '/work/reopen', label: 'Reopen', pendingLabel: 'Reopening…', nextState: 'open',
  });
  assert.equal(workTransitionAction({ id: 'github:owner/repo#2', source: 'github' }, 'open'), null);
  assert.equal(workTransitionAction({ id: 'local:not-a-number', source: 'local' }, 'open'), null);
});

test('Open in Forge carries the stable work id and real task context', () => {
  assert.deepEqual(forgeWorkDetail({ id: 'local:3', title: 'Repair login', body: 'Keep existing sessions.' }), {
    workItemId: 'local:3',
    task: 'Repair login\n\nKeep existing sessions.',
  });
  assert.deepEqual(forgeWorkDetail({ id: 'local:4', title: 'Title only', body: '' }), {
    workItemId: 'local:4',
    task: 'Title only',
  });
});
