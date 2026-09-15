'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const repoRoot = resolve(__dirname, '..');
const outputPath = join(repoRoot, 'packages', 'desktop', 'build-info.generated.cjs');

function readCommit(root = repoRoot) {
  return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim().toLowerCase();
}

function readVersion(root = repoRoot) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
    throw new Error('The root package.json has no version.');
  }
  return manifest.version.trim();
}

function assertTrackedCheckoutClean(root = repoRoot, run = execFileSync) {
  try {
    run('git', ['diff', '--quiet', 'HEAD', '--'], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    throw new Error('tracked files differ from HEAD; commit or restore them before packaging so the embedded SHA is exact');
  }
}

function renderBuildInfo({ sha, version }) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error(`Invalid Git commit SHA: ${sha}`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
  return [
    "'use strict';",
    '',
    '// Generated at packaging time. Do not edit or commit.',
    `module.exports = Object.freeze(${JSON.stringify({ sha, version })});`,
    '',
  ].join('\n');
}

function stamp(root = repoRoot, destination = outputPath) {
  // A failed attempt must not leave an older, valid-looking identity available
  // for somebody who invokes electron-builder directly afterwards.
  rmSync(destination, { force: true });
  assertTrackedCheckoutClean(root);
  const identity = { sha: readCommit(root), version: readVersion(root) };
  writeFileSync(destination, renderBuildInfo(identity), 'utf8');
  return identity;
}

if (require.main === module) {
  try {
    const identity = stamp();
    process.stdout.write(`Stamped Zeno ${identity.version} at ${identity.sha}\n`);
  } catch (error) {
    process.stderr.write(`Unable to stamp Zeno build identity: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertTrackedCheckoutClean, readCommit, readVersion, renderBuildInfo, stamp };
