import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface TicketAction {
  readonly jump: string;
  readonly label: string;
  readonly tone: string;
}

interface FieldModel {
  pendingRepoEdge(id: string, forge: unknown): readonly [string, string] | null;
  shouldAnimateField(input: {
    readonly surface: string | null;
    readonly visibilityState: string;
    readonly fieldList: boolean;
    readonly motion: boolean;
  }): boolean;
  ticketAction(node: { readonly receipt?: boolean; readonly work?: boolean }): TicketAction;
}

const moduleUrl = new URL('../../public/field-model.js', import.meta.url).href;
const { pendingRepoEdge, shouldAnimateField, ticketAction } = await import(moduleUrl) as FieldModel;

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

test('the Command field consumes frames only while its visible animated canvas is active', () => {
  const active = { surface: 'command', visibilityState: 'visible', fieldList: false, motion: true };
  assert.equal(shouldAnimateField(active), true);
  assert.equal(shouldAnimateField({ ...active, surface: 'forge' }), false);
  assert.equal(shouldAnimateField({ ...active, surface: 'counsel' }), false);
  assert.equal(shouldAnimateField({ ...active, visibilityState: 'hidden' }), false);
  assert.equal(shouldAnimateField({ ...active, fieldList: true }), false);
  assert.equal(shouldAnimateField({ ...active, motion: false }), false);
});

test('opening Command observes local models without starting the Ollama service', () => {
  const source = readFileSync(new URL('../../public/field.js', import.meta.url), 'utf8');
  assert.match(source, /getJSON\('\/forge\/agents\?passive=1'\)/);
});
