import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { sha256, syncGlass } from './sync-glass.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zeno-glass-'));
  const snapshot = join(root, 'tokens.css');
  const provenance = join(root, 'provenance.json');
  const destination = join(root, 'public', 'glass-base.css');
  const source = Buffer.from(':root { --glass-test: 1; }\n', 'utf8');
  writeFileSync(snapshot, source);
  writeFileSync(
    provenance,
    JSON.stringify({ revision: 'abc123', path: 'src/tokens.css', sha256: sha256(source) }),
  );
  return { root, snapshot, provenance, destination, source };
}

test('publishes a verified snapshot with its pinned provenance', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));

  const result = syncGlass(f);
  const output = readFileSync(f.destination);

  assert.equal(result.actual, sha256(f.source));
  assert.match(output.toString('utf8'), /abc123:src\/tokens\.css/);
  assert.ok(output.subarray(output.length - f.source.length).equals(f.source));
});

test('refuses a changed snapshot before publishing it', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  writeFileSync(f.snapshot, ':root { --glass-test: tampered; }\n');

  assert.throws(() => syncGlass(f), /snapshot integrity check failed/);
  assert.equal(existsSync(f.destination), false);
});

test('the repository snapshot is self-contained and hash-pinned', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'zeno-glass-repo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const destination = join(root, 'glass-base.css');
  const result = syncGlass({ destination });

  assert.equal(result.metadata.package, '@abheet19/glass');
  assert.match(result.metadata.revision, /^[a-f0-9]{40}$/);
  assert.equal(readFileSync(destination).length > 0, true);
});
