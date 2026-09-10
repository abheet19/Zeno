import { test } from 'node:test';
import assert from 'node:assert/strict';

interface TicketAction {
  readonly jump: string;
  readonly label: string;
  readonly tone: string;
}

interface FieldModel {
  pendingRepoEdge(id: string, forge: unknown): readonly [string, string] | null;
  ticketAction(node: { readonly receipt?: boolean; readonly work?: boolean }): TicketAction;
}

const moduleUrl = new URL('../../public/field-model.js', import.meta.url).href;
const { pendingRepoEdge, ticketAction } = await import(moduleUrl) as FieldModel;

test('pending repository edge is derived from the current Forge read', () => {
  assert.deepEqual(pendingRepoEdge('pend0', { repo: { branch: 'main' } }), ['pend0', 'repo']);
  assert.equal(pendingRepoEdge('pend0', { repo: null }), null);
  assert.equal(pendingRepoEdge('pend0', null), null);
});

test('ticket CTA routes each ticket-shaped node to its owning Command section', () => {
  assert.deepEqual(ticketAction({}), {
    jump: 'pending', label: 'Go to approvals', tone: 'p',
  });
  assert.deepEqual(ticketAction({ work: true }), {
    jump: 'desk', label: 'Find it on the desk', tone: 'p',
  });
  assert.deepEqual(ticketAction({ receipt: true }), {
    jump: 'timeline', label: 'Find it in the receipts', tone: 'g',
  });
});
