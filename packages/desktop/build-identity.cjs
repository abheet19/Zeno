'use strict';

const { join } = require('node:path');

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function validatedIdentity(value) {
  const sha = typeof value?.sha === 'string' ? value.sha.trim().toLowerCase() : '';
  const version = typeof value?.version === 'string' ? value.version.trim() : '';
  if (!COMMIT_PATTERN.test(sha) || !VERSION_PATTERN.test(version)) {
    throw new Error('The packaged Zeno build identity is invalid. Rebuild the installer from a Git checkout.');
  }
  return Object.freeze({ sha, version });
}

/**
 * Read identity produced by tools/stamp-build-identity.cjs.
 *
 * Development runs deliberately ignore the generated file: a stamp describes
 * the installer it was generated for, not later source edits in a checkout.
 * A packaged app fails closed when the stamp is absent or malformed rather
 * than presenting an installed binary as an anonymous development build.
 */
function loadEmbeddedBuildIdentity(options = {}) {
  if (!options.isPackaged) return null;
  const modulePath = options.modulePath ?? join(__dirname, 'build-info.generated.cjs');
  const load = options.load ?? (path => require(path));
  let value;
  try {
    value = load(modulePath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The packaged Zeno build identity is missing (${reason}). Rebuild the installer.`);
  }
  return validatedIdentity(value);
}

module.exports = { loadEmbeddedBuildIdentity, validatedIdentity };
