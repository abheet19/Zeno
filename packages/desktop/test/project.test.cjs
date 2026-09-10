'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { inspectProject, readProjectPreference, writeProjectPreference } = require('../project.cjs');

test('folder selection resolves a subfolder to the Git repository root without a shell', () => {
  let invocation;
  const result = inspectProject('C:\\repo\\src', (command, args, options) => {
    invocation = { command, args, options };
    return { status: 0, stdout: 'C:\\repo\r\n', stderr: '' };
  }, value => value);
  assert.deepEqual(result, { ok: true, path: 'C:\\repo' });
  assert.equal(invocation.command, 'git');
  assert.deepEqual(invocation.args, ['-C', 'C:\\repo\\src', 'rev-parse', '--show-toplevel']);
  assert.equal(invocation.options.shell, false);
});

test('folder selection refuses a non-repository with a useful next step', () => {
  const result = inspectProject('C:\\notes', () => ({ status: 128, stdout: '', stderr: 'not a repository' }), value => value);
  assert.equal(result.ok, false);
  assert.match(result.error, /existing Git repository/);
});

test('project preference round-trips and invalid JSON cannot select a path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-project-pref-'));
  const path = join(dir, 'forge-project.json');
  try {
    writeProjectPreference(path, 'D:\\Code\\Zeno');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).path, 'D:\\Code\\Zeno');
    assert.deepEqual(readProjectPreference(path, value => ({ ok: true, path: value })), { ok: true, path: 'D:\\Code\\Zeno' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('folder selection canonicalizes both the chosen folder and Git root', () => {
  const canonicalized = [];
  const result = inspectProject(' D:\\repo\\src ', () => ({ status: 0, stdout: 'D:\\REPO\r\n' }), value => {
    canonicalized.push(value);
    return value.toLowerCase();
  });
  assert.deepEqual(result, { ok: true, path: 'd:\\repo' });
  assert.deepEqual(canonicalized, ['D:\\repo\\src', 'D:\\REPO']);
});

test('folder selection contains Git launch failures and unreadable roots', () => {
  const failed = inspectProject('D:\\repo', () => { throw new Error('git missing'); }, value => value);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Git could not inspect/);

  let calls = 0;
  const unreadable = inspectProject('D:\\repo', () => ({ status: 0, stdout: 'D:\\repo\r\n' }), value => {
    calls += 1;
    if (calls === 2) throw new Error('gone');
    return value;
  });
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.error, /repository root.*cannot be read/i);
});

test('stale and malformed saved projects are never returned as usable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-project-stale-'));
  const path = join(dir, 'forge-project.json');
  try {
    writeProjectPreference(path, 'D:\\deleted-repository');
    assert.deepEqual(readProjectPreference(path, () => ({ ok: false, error: 'That folder cannot be read.' })), { ok: false, error: 'That folder cannot be read.' });
    require('node:fs').writeFileSync(path, '{not-json', 'utf8');
    assert.deepEqual(readProjectPreference(path), { ok: false, error: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
