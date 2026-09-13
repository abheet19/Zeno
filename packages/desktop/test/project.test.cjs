'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { inspectProject } = require('../project.cjs');

test('switching projects does not start speech or reference the removed eager warm path', () => {
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.doesNotMatch(main, /\bwarmSpeech\b/);
});

test('the picker only validates and returns a path — the daemon switches and remembers it', () => {
  // A restart-on-switch would drop the session panel's state and keep a
  // second copy of the choice in the profile that could disagree with the
  // daemon's own <workspace>/project.json. Neither may come back.
  const main = readFileSync(join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.doesNotMatch(main, /forge-project\.json/);
  assert.doesNotMatch(main, /sessionProject|projectSwitching|writeProjectPreference/);
  assert.match(main, /ipcMain\.handle\('zeno:project:choose'[\s\S]*?return inspectProject\(answer\.filePaths\[0\]\);/);
});

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
