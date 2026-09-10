'use strict';
const { mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { spawnSync } = require('node:child_process');

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

function readProjectPreference(path, inspect = inspectProject) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return inspect(value && value.path);
  } catch {
    return { ok: false, error: null };
  }
}

function writeProjectPreference(path, project) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ path: project }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

function clearProjectPreference(path) {
  try { unlinkSync(path); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
}

module.exports = { clearProjectPreference, inspectProject, readProjectPreference, writeProjectPreference };
