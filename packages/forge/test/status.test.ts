/**
 * The one `git status --porcelain -z` parser. It decides what the gate is told
 * the agent changed, so its edges — renames, odd paths, empty output — are
 * tested as hard as the happy path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_ARGS, parsePorcelainZ } from '../src/status.js';

/** Build a `-z` stream: each record NUL-terminated, as git emits it. */
function z(...records: string[]): string {
  return records.map((r) => r + '\0').join('');
}

test('STATUS_ARGS is stable, NUL-delimited, and lists new files individually', () => {
  assert.deepEqual(STATUS_ARGS, ['status', '--porcelain', '-z', '-uall']);
});

test('parses modified, added and untracked records, sorted and de-duplicated', () => {
  const out = z(' M src/a.ts', 'A  src/b.ts', '?? src/c.ts', ' M src/a.ts');
  assert.deepEqual(parsePorcelainZ(out), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('empty output is an empty changeset, not an error', () => {
  assert.deepEqual(parsePorcelainZ(''), []);
  assert.deepEqual(parsePorcelainZ('\0'), [], 'a lone trailing NUL yields nothing');
});

test('a rename reports the DESTINATION and consumes the origin field', () => {
  // git -z rename: `R  <dest>` then the origin path as the next NUL field.
  const out = z('R  new/name.ts', 'old/name.ts') + z(' M other.ts');
  assert.deepEqual(
    parsePorcelainZ(out),
    ['new/name.ts', 'other.ts'],
    'the origin path is not mistaken for a changed file of its own',
  );
});

test('a path containing a space survives -z intact', () => {
  assert.deepEqual(parsePorcelainZ(z('?? a file with spaces.txt')), ['a file with spaces.txt']);
});

test('too-short fragments are skipped, never mis-sliced', () => {
  // `XY` with nothing after it, and a bare status with no path.
  assert.deepEqual(parsePorcelainZ(z('??', ' M')), []);
});
