/**
 * Wake detection: the strict half of the trade-off. A missed wake is a repeated
 * command; a false wake is noise the owner never addressed to Zeno. These tests
 * pin BOTH edges — the mangled wake words that must still trigger, and the
 * everyday sentences that must not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWake } from '../src/index.js';

test('the canonical wake strips the phrase and the trailing comma', () => {
  const wake = detectWake('zeno, add a card component');
  assert.notEqual(wake, null);
  assert.equal(wake!.command, 'add a card component');
});

test('casing and stray punctuation do not defeat the wake', () => {
  assert.equal(detectWake('ZENO! add a card component')!.command, 'add a card component');
  assert.equal(detectWake('  Zeno.  read my receipts ')!.command, 'read my receipts');
});

test('"zeno attend" is a wake and "attend" is stripped', () => {
  assert.equal(detectWake('zeno attend, verify the chain')!.command, 'verify the chain');
  // bare "zeno attend" is a real wake with no command — not null.
  const bare = detectWake('zeno attend');
  assert.notEqual(bare, null);
  assert.equal(bare!.command, '');
});

test('leading filler BEFORE the wake word is allowed', () => {
  assert.equal(detectWake('hey zeno, add a card component')!.command, 'add a card component');
  assert.equal(detectWake('um, ok zeno remind me to call Bob')!.command, 'remind me to call Bob');
});

test('leading filler AFTER the wake word is stripped from the command', () => {
  assert.equal(detectWake('zeno please remind me to water the plants')!.command, 'remind me to water the plants');
});

test('common mis-hearings of the wake word still trigger', () => {
  for (const heard of ['zeeno', 'xeno', 'zino', 'zenno', 'Zee-No', 'ZEENO']) {
    const wake = detectWake(`${heard}, add a card component`);
    assert.notEqual(wake, null, `"${heard}" should wake`);
    assert.equal(wake!.command, 'add a card component');
  }
});

test('the two-token split "zee no" is recognised as one wake', () => {
  assert.equal(detectWake('zee no, what is waiting')!.command, 'what is waiting');
  assert.equal(detectWake('zee know add a task to buy milk')!.command, 'add a task to buy milk');
});

test('a bare wake word yields an empty command, not null', () => {
  const wake = detectWake('zeno');
  assert.notEqual(wake, null);
  assert.equal(wake!.command, '');
});

test('FALSE TRIGGER — a mid-sentence mention of zeno is NOT a wake', () => {
  // The first content word is not the wake word, so none of these are addressed
  // to Zeno. This is the guard that keeps ordinary conversation from proposing.
  assert.equal(detectWake('I like zeno'), null);
  assert.equal(detectWake('tell zeno I said hi'), null);
  assert.equal(detectWake('the zeno project is local first'), null);
  assert.equal(detectWake('we should approve the zeno budget'), null);
});

test('FALSE TRIGGER — a content word before the wake blocks it even mid-filler', () => {
  // "so" is filler and skipped, but "I" is a content word, so this stops.
  assert.equal(detectWake('so I was telling zeno about it'), null);
});

test('"zee" alone, or with the wrong tail, is not a wake', () => {
  assert.equal(detectWake('zee whiz that was close'), null);
  assert.equal(detectWake('the letter zee no wait'), null);
});

test('an empty or whitespace transcript is null', () => {
  assert.equal(detectWake(''), null);
  assert.equal(detectWake('    '), null);
});
