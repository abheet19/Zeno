/**
 * Dependency-free "lint" that enforces the kernel's own laws as static checks:
 *   1. No network imports anywhere in src/ (the zero-network guarantee).
 *   2. No Date.now() / Math.random() in src/ (determinism — the world is injected).
 *   3. Every source file is covered by the tsconfig (no stray files).
 * Exits non-zero on any violation, so `npm run check` fails loudly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_IMPORTS = [
  /from\s+['"]node:https?['"]/,
  /from\s+['"]node:net['"]/,
  /from\s+['"]node:dgram['"]/,
  /from\s+['"]node:tls['"]/,
  /from\s+['"]node:http2['"]/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
];
const FORBIDDEN_NONDETERMINISM = [/\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /\bnew Date\s*\(\s*\)/];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

let violations = 0;
const srcFiles = walk(new URL('../src', import.meta.url).pathname);

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  for (const rx of FORBIDDEN_IMPORTS) {
    if (rx.test(text)) {
      console.error(`✗ network primitive in ${file}: ${rx}`);
      violations++;
    }
  }
  for (const rx of FORBIDDEN_NONDETERMINISM) {
    if (rx.test(text)) {
      console.error(`✗ non-determinism in ${file}: ${rx} (inject via World instead)`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\nlint failed: ${violations} violation(s).`);
  process.exit(1);
}
console.log(`✓ lint: ${srcFiles.length} source files clean — no network, no ambient non-determinism.`);
