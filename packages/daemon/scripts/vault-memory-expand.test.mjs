import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Vault memories expose their complete body through a persistent expand control', async () => {
  const source = await readFile(new URL('../public/bind/lists/vault.js', import.meta.url), 'utf8');
  assert.match(source, /vault-memory-detail/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /screen\._zenoVaultExpanded/);
  assert.match(source, /String\(n\.body/);
});
