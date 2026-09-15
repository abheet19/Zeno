/*
 * Small, deterministic decisions shared by the Standing Field renderer.
 * Keeping them free of browser globals lets the node tests prove that first
 * render topology and ticket destinations do not depend on prior UI state.
 */

/** Return the current pending-to-repository edge, when this read reports one. */
export function pendingRepoEdge(pendingId, forge) {
  return forge && forge.repo ? [pendingId, 'repo'] : null;
}

/** Map each ticket-shaped node to the Command section that owns its details. */
export function ticketAction(node) {
  if (node && node.receipt) {
    return { jump: 'timeline', label: 'Find it in the receipts', tone: 'g' };
  }
  if (node && node.work) {
    return { jump: 'desk', label: 'Find it on the desk', tone: 'p' };
  }
  return { jump: 'pending', label: 'Go to approvals', tone: 'p' };
}

/** Decide whether the canvas may consume animation frames in the current shell. */
export function shouldAnimateField({ surface, visibilityState, fieldList, motion }) {
  return visibilityState !== 'hidden'
    && (!surface || surface === 'command')
    && !fieldList
    && Boolean(motion);
}

/** Resolve canvas motion from the explicit in-app choice. The Standing Field
 * rotates on first launch; Reduce motion remains an immediate, persistent
 * owner control. */
export function fieldMotionEnabled({ explicitReduction }) {
  if (explicitReduction === '1') return false;
  return true;
}
