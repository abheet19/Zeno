/*
 * Keep the daemon's shipped voice assets aligned with this audited package.
 * The shell is authored in public/; the pure TypeScript core comes from dist/.
 */
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const daemonPublic = join(packageRoot, '..', 'daemon', 'public');

copyFileSync(join(packageRoot, 'public', 'voice.js'), join(daemonPublic, 'voice.js'));
for (const moduleName of ['grammar.js', 'listen.js', 'session.js', 'wake.js']) {
  copyFileSync(join(packageRoot, 'dist', 'src', moduleName), join(daemonPublic, moduleName));
}

console.log('sync-public: vendored voice shell and 4 compiled core modules');
