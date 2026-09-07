#!/usr/bin/env node
/**
 * Register `com.zeno.chrome_bridge` with the owner's Chrome. Their machine,
 * their hand, once.
 *
 *     node packages/chrome-bridge/install/register-host.mjs <extension-id> [workspace]
 *
 * WHAT IT WRITES, AND NOTHING ELSE:
 *
 *   1. `host-config.json` beside `native-host.cjs`, naming the Zeno workspace so
 *      the host can find the daemon's address and run credential. It holds no
 *      secret of its own.
 *   2. `zeno-chrome-host.bat` beside it. Chrome requires the manifest's `path`
 *      to be an executable, and a `.cjs` is not one on Windows — the batch file
 *      is the smallest honest wrapper: it runs this machine's own `node` on the
 *      host script.
 *   3. `com.zeno.chrome_bridge.json`, the native-messaging manifest, whose
 *      `allowed_origins` names EXACTLY ONE extension id. That field is what
 *      stops any other extension in the browser from speaking to this host, and
 *      it is why the id is a required argument rather than something guessed.
 *   4. On Windows, the registry value Chrome reads to find (3):
 *      HKCU\Software\Google\Chrome\NativeMessagingHosts\com.zeno.chrome_bridge
 *      HKCU, never HKLM: this is one user's decision about one user's browser,
 *      and it needs no administrator.
 *      On macOS and Linux the manifest is copied into Chrome's own
 *      NativeMessagingHosts directory instead, which is the same decision.
 *
 * It does NOT install the extension. That is `chrome://extensions` → Developer
 * mode → "Load unpacked" → `packages/chrome-bridge/extension`, done by the owner
 * looking at their own browser. An automated install of an extension that can
 * act as them would be exactly the thing this product exists not to do.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.zeno.chrome_bridge';
const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');

const extensionId = (process.argv[2] ?? '').trim();
const workspace = resolve(process.argv[3] ?? process.env['ZENO_DIR'] ?? '.zeno');

if (!/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write(
    '\n  Usage: node packages/chrome-bridge/install/register-host.mjs <extension-id> [workspace]\n\n' +
      '  Load packages/chrome-bridge/extension unpacked in chrome://extensions first,\n' +
      '  then pass the 32-character id Chrome shows for it. The id is what stops every\n' +
      '  OTHER extension in your browser from talking to this host, so it is required.\n\n',
  );
  process.exit(1);
}

writeFileSync(join(pkg, 'host-config.json'), JSON.stringify({ workspace }, null, 2) + '\n', 'utf8');

const isWindows = platform() === 'win32';
const launcher = isWindows ? join(pkg, 'zeno-chrome-host.bat') : join(pkg, 'zeno-chrome-host.sh');
if (isWindows) {
  writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${join(pkg, 'native-host.cjs')}" %*\r\n`, 'utf8');
} else {
  writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${join(pkg, 'native-host.cjs')}" "$@"\n`, { mode: 0o755 });
}

const manifestPath = join(pkg, `${HOST_NAME}.json`);
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      name: HOST_NAME,
      description: 'Zeno — relays one owner-approved action at a time between Zeno and the Zeno extension.',
      path: launcher,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

if (isWindows) {
  execFileSync(
    'reg',
    ['add', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
    { stdio: 'inherit' },
  );
} else {
  const dir =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
      : join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  mkdirSync(dir, { recursive: true });
  copyFileSync(manifestPath, join(dir, `${HOST_NAME}.json`));
}

process.stdout.write(
  `\n  Registered ${HOST_NAME} for extension ${extensionId}.\n` +
    `    workspace  ${workspace}\n` +
    `    manifest   ${manifestPath}\n\n` +
    '  Zeno still needs ZENO_FORGE_CHROME=1 to publish the tools at all, and every\n' +
    '  origin still has to be on your allowlist before anything can be asked about it.\n\n',
);
