/** Pure shaping for Work controls. Kept DOM-free so the browser contract is testable. */

export function workTransitionAction(item, state) {
  if (!item || item.source !== 'local' || !/^local:[1-9][0-9]*$/.test(String(item.id || ''))) return null;
  return state === 'closed'
    ? { path: '/work/reopen', label: 'Reopen', pendingLabel: 'Reopening…', nextState: 'open' }
    : { path: '/work/close', label: 'Mark complete', pendingLabel: 'Completing…', nextState: 'closed' };
}

export function forgeWorkDetail(item) {
  const title = String(item && item.title || '').trim();
  const body = String(item && item.body || '').trim();
  return {
    workItemId: String(item && item.id || '').trim(),
    task: [title, body].filter(Boolean).join('\n\n'),
  };
}
