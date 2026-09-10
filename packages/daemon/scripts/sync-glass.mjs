#!/usr/bin/env node
/*
 * Publish the committed Glass token snapshot for Zeno's static server.
 *
 * A clean Zeno checkout must build without a sibling repository. The reviewed
 * source snapshot and its provenance live under assets/glass; this script
 * verifies the pinned digest before copying it to the ignored public build
 * directory. A changed snapshot cannot be served until its provenance digest
 * is deliberately updated in the same review.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const here = dirname(scriptPath);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function syncGlass({
  snapshot = resolve(here, '../assets/glass/tokens.css'),
  provenance = resolve(here, '../assets/glass/provenance.json'),
  destination = resolve(here, '../public/glass/vendor/glass-base.css'),
} = {}) {
  const source = readFileSync(snapshot);
  const metadata = JSON.parse(readFileSync(provenance, 'utf8'));
  const expected = String(metadata.sha256 ?? '').toLowerCase();
  const actual = sha256(source);

  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('sync-glass: provenance.json must contain a valid sha256 digest');
  }
  if (actual !== expected) {
    throw new Error(
      `sync-glass: snapshot integrity check failed (expected ${expected}, received ${actual})`,
    );
  }

  const revision = String(metadata.revision ?? 'unknown');
  const sourcePath = String(metadata.path ?? 'tokens.css');
  const banner =
    `/* AUTO-GENERATED from the committed @abheet19/glass snapshot ` +
    `${revision}:${sourcePath}; sha256 ${actual}. Do not edit directly. */\n`;

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.concat([Buffer.from(banner, 'utf8'), source]));

  console.log(`sync-glass: verified ${actual} and published ${destination}`);
  return { actual, destination, metadata };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    syncGlass();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
