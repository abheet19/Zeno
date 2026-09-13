/**
 * `needsLiveLookup` decides one thing only: does a question name something
 * CURRENT or external that neither the snapshot nor a frozen local model could
 * ever honestly answer. These tests pin the narrow shape — real triggers fire,
 * and an ordinary question that merely contains a similar word does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsLiveLookup } from '../src/index.js';

test('a question naming something current triggers a live lookup', () => {
  for (const q of [
    "what's the latest on the React 19 release?",
    "what's today's weather in Seattle",
    'what is the current price of bitcoin',
    'search the web for zeno command center',
    'look up the changelog for this library',
  ]) {
    assert.equal(needsLiveLookup(q), true, q);
  }
});

test('a bare URL triggers a live lookup', () => {
  assert.equal(needsLiveLookup('summarize https://example.com/post'), true);
});

test('an ordinary question about local state does not trigger it', () => {
  for (const q of [
    'what is waiting on me?',
    'what did we decide about the release checklist?',
    'explain what a closure is',
    'what is in the sandbox right now?',
  ]) {
    assert.equal(needsLiveLookup(q), false, q);
  }
});

test('an empty question never triggers it', () => {
  assert.equal(needsLiveLookup(''), false);
  assert.equal(needsLiveLookup('   '), false);
});
