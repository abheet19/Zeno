import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../public/bind/lists/vault.js', import.meta.url), 'utf8');

test('Vault waits for the brief binder and preserves an existing snapshot during refresh', () => {
  assert.match(source, /await bindBrief\(screen\);/);
  assert.match(source, /if \(!hasSnapshot\) fill\(body, loadingEl\('Reading the brief…'\)\);/);
  assert.match(source, /body\.dataset\.zenoBriefRendered = '1';/);
});

test('only the newest brief request may paint the card', () => {
  assert.match(source, /body\.dataset\.zenoBriefGeneration = String\(generation\);/);
  assert.match(source, /Number\(body\.dataset\.zenoBriefGeneration\) !== generation/);
});

test('the UI does not present request time as a changing build age', () => {
  assert.doesNotMatch(source, /Built ['"]?\s*\+/);
  assert.doesNotMatch(source, /ageStr\(b\.at\)/);
});
