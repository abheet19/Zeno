'use strict';
const { realpathSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

/**
 * Validate a folder the owner picked for Forge: it must be readable and sit
 * inside a Git repository (every agent run is isolated in a git worktree).
 * A sub-folder resolves up to its repository root — git's own answer. This
 * is the desktop's half of the check; the daemon runs the same rule again
 * when the window hands it the path (POST /forge/project), which is also
 * where the choice is remembered.
 */
function inspectProject(input, run = spawnSync, canonical = realpathSync.native) {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, error: 'Choose a project folder.' };
  let chosen;
  try { chosen = canonical(input.trim()); }
  catch { return { ok: false, error: 'That folder cannot be read.' }; }
  let result;
  try {
    result = run('git', ['-C', chosen, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, timeout: 10_000,
    });
  } catch (error) {
    return { ok: false, error: `Git could not inspect that folder: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.trim() === '') {
    return { ok: false, error: 'Choose a folder inside an existing Git repository. Forge isolates every agent run with git worktrees.' };
  }
  try { return { ok: true, path: canonical(result.stdout.trim()) }; }
  catch { return { ok: false, error: 'Git found a repository root, but that path cannot be read.' }; }
}

module.exports = { inspectProject };
