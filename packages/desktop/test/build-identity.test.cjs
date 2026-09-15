'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEmbeddedBuildIdentity, validatedIdentity } = require('../build-identity.cjs');
const { assertTrackedCheckoutClean, renderBuildInfo } = require('../../../tools/stamp-build-identity.cjs');
const { createDaemonEnvironment } = require('../lifecycle.cjs');

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('development runs stay truthfully unstamped even if an old generated module exists', () => {
  let loads = 0;
  const identity = loadEmbeddedBuildIdentity({
    isPackaged: false,
    load: () => { loads += 1; return { sha: SHA, version: '0.1.0' }; },
  });
  assert.equal(identity, null);
  assert.equal(loads, 0);
});

test('packaged builds require a valid embedded commit and semantic version', () => {
  assert.deepEqual(
    loadEmbeddedBuildIdentity({ isPackaged: true, load: () => ({ sha: SHA.toUpperCase(), version: '0.1.0' }) }),
    { sha: SHA, version: '0.1.0' },
  );
  assert.throws(
    () => loadEmbeddedBuildIdentity({ isPackaged: true, load: () => ({ sha: 'main', version: '0.1.0' }) }),
    /identity is invalid/,
  );
  assert.throws(
    () => loadEmbeddedBuildIdentity({ isPackaged: true, load: () => { throw new Error('not found'); } }),
    /identity is missing/,
  );
});

test('the generated module is deterministic data, not executable Git discovery', () => {
  const source = renderBuildInfo({ sha: SHA, version: '0.1.0' });
  assert.match(source, new RegExp(SHA));
  assert.match(source, /"version":"0\.1\.0"/);
  assert.doesNotMatch(source, /child_process|exec|spawn|rev-parse/);
  assert.equal(source, renderBuildInfo({ sha: SHA, version: '0.1.0' }));
});

test('packaging refuses a dirty tracked checkout rather than assigning it a false exact SHA', () => {
  assert.doesNotThrow(() => assertTrackedCheckoutClean('D:\\repo', () => Buffer.alloc(0)));
  assert.throws(
    () => assertTrackedCheckoutClean('D:\\repo', () => { throw new Error('git diff exit 1'); }),
    /tracked files differ from HEAD/,
  );
});

test('packaged desktop overrides ambient identity before launching the daemon', () => {
  const identity = validatedIdentity({ sha: SHA, version: '0.1.0' });
  const env = createDaemonEnvironment(
    { ZENO_BUILD_SHA: 'ffffffffffffffffffffffffffffffffffffffff', ZENO_VERSION: '9.9.9' },
    { isPackaged: true, workspacePath: 'C:\\profile\\workspace', buildIdentity: identity },
  );
  assert.equal(env.ZENO_BUILD_SHA, SHA);
  assert.equal(env.ZENO_VERSION, '0.1.0');
});
