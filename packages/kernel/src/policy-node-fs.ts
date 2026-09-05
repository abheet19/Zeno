/**
 * Reading `policy.json` off disk. Isolated here so `policy.ts` stays pure — it
 * takes a string, never a path.
 */
import { readFileSync } from 'node:fs';
import { loadPolicy, type Policy } from './policy.js';
import { PolicyError } from './types.js';

/**
 * Read a policy file.
 *
 * Returns `null` ONLY when there is no policy file, so the caller falls back to
 * `DEFAULT_POLICY`. Every other failure throws.
 *
 * That distinction is the whole point: a policy that exists but cannot be read
 * — locked, permission-denied, on a failing disk — must never be silently
 * replaced by the built-in one, because the unreadable file is very often the
 * STRICTER of the two. Failing open on a security policy is the one direction
 * this must never fail in.
 */
export function readPolicyFile(filePath: string): Policy | null {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PolicyError(
      'policy-schema-invalid',
      `A policy file exists at ${filePath} but cannot be read: ${(err as Error).message}`,
      'Fix the permissions on the file, or delete it deliberately to fall back to the built-in policy.',
    );
  }
  return loadPolicy(text);
}
