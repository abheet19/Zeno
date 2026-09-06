#!/usr/bin/env node
/**
 * Vendor Monaco Editor into the daemon's public directory.
 * =========================================================
 *
 * WHY THIS SCRIPT EXISTS AT ALL. Zeno advertises zero external RUNTIME
 * dependencies and CI proves it: `.github/workflows/ci.yml` reads every
 * every package.json under packages/, collects each `dependencies` key that is not
 * `@abheet19/*`, and fails the build if the list is not empty. That badge is
 * only worth something if nothing quietly falsifies it — so `monaco-editor` is
 * a devDependency of the ROOT workspace (beside `electron` and
 * `electron-builder`, which live there for exactly the same reason) and is
 * never listed in any package's `dependencies`. It is a BUILD input, not a
 * runtime import.
 *
 * WHAT IT DOES. Copies monaco's prebuilt AMD distribution — `min/vs`, the
 * bundle Microsoft ships for consumers with no bundler — into
 *
 *     packages/daemon/public/vendor/monaco/vs
 *
 * so the daemon serves every byte of the editor from its own loopback socket.
 * NO RUNTIME NETWORK EGRESS: after this copy there is no CDN, no unpkg, no
 * jsdelivr and no web font left to fetch. The codicon icon face is already a
 * data: URI inside monaco's own stylesheet, so it is not a network request
 * either. The output directory is gitignored — it is generated, not authored,
 * and a 14 MB minified vendor tree does not belong in this repository's history.
 *
 * WHAT IT DELIBERATELY LEAVES OUT, and how that was checked:
 *
 *   nls/lang/**   the non-English message bundles. `vs/nls.messages-loader.js`
 *                 only ever requires one of these when `availableLanguages` is
 *                 configured; the window never sets it, so nothing can ask.
 *   language/**   `min/vs/language/{css,html,json,typescript}/*.worker.js` are a
 *                 SECOND copy of the four language workers, kept for consumers
 *                 that resolve workers by path. The AMD build does not: each
 *                 mode calls `createWorker: () => new Worker(__worker_url_0__)`
 *                 and that url is computed by `require.toUrl` against
 *                 `vs/assets/*.worker-*.js`, which IS copied. Verified by
 *                 reading vs/tsMode-*.js, vs/cssMode-*.js, vs/jsonMode-*.js and
 *                 vs/htmlMode-*.js, and again in the browser's network log:
 *                 nothing requests /vendor/monaco/vs/language/.
 *   d.ts files    type declarations. A browser never asks for one.
 *
 * If any of that is ever wrong the failure is loud and local — a 404 on a
 * same-origin path, visible in the console — not a silent degradation.
 *
 * Idempotent: a stamp file records the monaco version that produced the tree,
 * and a matching stamp makes this a no-op, so `npm run build` stays fast.
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages', 'daemon', 'public', 'vendor', 'monaco');
const STAMP = join(OUT, 'vendored.json');

/**
 * Where npm put monaco-editor.
 *
 * `require.resolve('monaco-editor/package.json')` does not work: the package
 * publishes an `exports` map that does not expose its own manifest, and an
 * exports map is a wall. So resolve the package ENTRY — which the map does
 * expose — and walk up from it until a directory holding package.json appears.
 * The plain node_modules path is tried first because it is the answer in this
 * workspace and needs no resolution at all.
 */
function monacoRoot() {
  const direct = join(ROOT, 'node_modules', 'monaco-editor');
  if (existsSync(join(direct, 'package.json'))) return direct;
  const require = createRequire(import.meta.url);
  let dir;
  try {
    dir = dirname(require.resolve('monaco-editor', { paths: [ROOT] }));
  } catch {
    return null;
  }
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function main() {
  const src = monacoRoot();
  if (src === null) {
    process.stderr.write(
      '\n  monaco-editor is not installed, so the editor cannot be vendored.\n' +
        '  It is a devDependency of the root package: run `npm install` and build again.\n' +
        '  (It is deliberately NOT a runtime dependency of any package — see\n' +
        '   tools/vendor-monaco.mjs and the zero-dependency check in ci.yml.)\n\n',
    );
    process.exitCode = 1;
    return;
  }

  const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
  const from = join(src, 'min', 'vs');
  if (!existsSync(from)) {
    process.stderr.write(
      `\n  monaco-editor ${version} has no min/vs directory at ${from}.\n` +
        '  That is the prebuilt AMD bundle this project serves; without it there is\n' +
        '  nothing to vendor. Pin a monaco-editor version that ships min/vs.\n\n',
    );
    process.exitCode = 1;
    return;
  }

  if (existsSync(STAMP)) {
    try {
      const prev = JSON.parse(readFileSync(STAMP, 'utf8'));
      if (prev.version === version && existsSync(join(OUT, 'vs', 'loader.js'))) {
        process.stdout.write(`monaco ${version} already vendored — nothing to do\n`);
        return;
      }
    } catch {
      /* an unreadable stamp is treated as no stamp */
    }
  }

  // A partial tree from an interrupted copy is worse than none: remove first.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const skipped = [];
  cpSync(from, join(OUT, 'vs'), {
    recursive: true,
    filter: (s) => {
      const rel = relative(from, s);
      if (rel === '') return true;
      const parts = rel.split(sep);
      if (s.endsWith('.d.ts')) return false;
      if (parts[0] === 'nls' && parts[1] === 'lang') {
        if (parts.length === 2) skipped.push('nls/lang');
        return false;
      }
      if (parts[0] === 'language') {
        if (parts.length === 1) skipped.push('language');
        return false;
      }
      return true;
    },
  });

  writeFileSync(
    STAMP,
    JSON.stringify(
      {
        package: 'monaco-editor',
        version,
        source: 'min/vs',
        omitted: [...skipped, '**/*.d.ts'],
        note:
          'Generated by tools/vendor-monaco.mjs from the monaco-editor devDependency. ' +
          'Not committed; not a runtime dependency of any package. Served locally by the ' +
          'daemon so the window never reaches the network.',
        at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  process.stdout.write(`monaco ${version} vendored to packages/daemon/public/vendor/monaco/vs\n`);
}

main();
