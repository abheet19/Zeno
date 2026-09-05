/**
 * Canonical hashing — the assumption every other guarantee rests on.
 *
 * The whole ledger design depends on one property: the hash of a record covers
 * EXACTLY the keys that record carries. If any key can be present in the data
 * and absent from the hash, then "any edit breaks the chain" is false and the
 * audit log proves nothing.
 *
 * These tests exist because that property was once broken, in a way no other
 * test could see: `{}` inherits `__proto__` as an accessor from
 * Object.prototype, so building the canonical object with a plain literal made
 * `out['__proto__'] = v` invoke a setter instead of creating an own key. The
 * key vanished from the serialization while remaining in the data — and
 * `JSON.parse` produces `__proto__` as an ordinary own key, so a single spliced
 * key in a receipt line on disk left the chain verifying as intact.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, Ledger, canonicalJSON, hashOf } from '../src/index.js';
import type { Receipt } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

test('a "__proto__" key is hashed, never silently dropped', () => {
  const parsed = JSON.parse('{"a":1,"__proto__":{"evil":1}}') as Record<string, unknown>;
  assert.ok(
    Object.prototype.hasOwnProperty.call(parsed, '__proto__'),
    'JSON.parse really does produce __proto__ as an ordinary own key',
  );
  assert.match(canonicalJSON(parsed), /__proto__/, 'the key must survive into the canonical form');
  assert.notEqual(
    hashOf(parsed),
    hashOf({ a: 1 }),
    'an object carrying extra content must never hash like one without it',
  );
});

test('a nested "__proto__" key is hashed too', () => {
  const clean = JSON.parse('{"outer":{"a":1}}');
  const smuggled = JSON.parse('{"outer":{"a":1,"__proto__":{"x":1}}}');
  assert.notEqual(hashOf(clean), hashOf(smuggled));
});

test('splicing a key into a receipt line breaks the chain at that index', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  for (let i = 0; i < 3; i++) {
    const pv = k.preview(buildRequest(world, { kind: 'read' }));
    await k.commit(pv.actionHash, okExecutor());
  }
  assert.equal(k.verifyChain().ok, true);

  const lines = k.ledgerJSONL().split('\n');
  // Exactly the attack: add content the hash must refuse to ignore.
  lines[1] = lines[1]!.replace('{"', '{"__proto__":{"smuggled":"payload"},"');
  const v = Ledger.fromJSONL(lines.join('\n')).verify();

  assert.equal(v.ok, false, 'a receipt carrying smuggled content must not verify');
  assert.equal(v.firstBreakAt, 1);
});

test('key order still does not matter (the canonical property itself)', () => {
  assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
  assert.equal(hashOf({ x: { p: 1, q: 2 } }), hashOf({ x: { q: 2, p: 1 } }));
});

test('array order DOES matter', () => {
  assert.notEqual(hashOf([1, 2]), hashOf([2, 1]));
});

test('the ledger written before this fix still verifies (no hash changed)', () => {
  // A receipt captured from a real pre-fix ledger. If the canonical form of an
  // ordinary object ever changes, this fails — which is exactly what it is for.
  const body = {
    id: 'id_000001',
    actionHash: 'abc123',
    outcome: 'verified' as const,
    reason: null,
    casBaseObserved: 'base_x',
    externalEffect: { effect: 'none' },
    prevReceipt: null,
    at: '2026-01-01T00:00:00.000Z',
  };
  assert.equal(
    canonicalJSON(body),
    '{"actionHash":"abc123","at":"2026-01-01T00:00:00.000Z","casBaseObserved":"base_x",' +
      '"externalEffect":{"effect":"none"},"id":"id_000001","outcome":"verified",' +
      '"prevReceipt":null,"reason":null}',
    'the canonical form of an ordinary receipt body is frozen',
  );
});

test('a receipt with no extra keys is unaffected by the fix', async () => {
  const world = new TestWorld();
  const k = new Kernel(world);
  const pv = k.preview(buildRequest(world, { kind: 'read' }));
  const r = await k.commit(pv.actionHash, okExecutor());
  const roundTripped = JSON.parse(JSON.stringify(r)) as Receipt;
  assert.equal(Ledger.fromJSONL(JSON.stringify(roundTripped)).verify().ok, true);
});
