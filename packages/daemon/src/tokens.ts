/**
 * Two capabilities, two tokens.
 *
 * This is the point of the whole daemon. In-process, `kernel.approve()` is a
 * method on an object, so "an agent must not approve its own work" is a rule
 * people agree to follow. Across a process boundary with separate tokens it
 * becomes something an agent physically cannot do: the proposer token is
 * rejected by the approval route, full stop. That is law L6 turned from a
 * comment into topology.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

export type Role = 'owner' | 'proposer';

export interface Tokens {
  /** May approve, and may propose. This is the human. */
  readonly owner: string;
  /** May propose, and read. Never approves. This is every agent. */
  readonly proposer: string;
  /** Which role a presented token carries, or null if it carries none. */
  roleOf(token: string | undefined | null): Role | null;
}

/** Constant-time compare, so a token cannot be recovered a byte at a time. */
function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function mintTokens(): Tokens {
  const owner = randomBytes(24).toString('hex');
  const proposer = randomBytes(24).toString('hex');
  return {
    owner,
    proposer,
    roleOf(token) {
      if (typeof token !== 'string' || token.length === 0) return null;
      if (sameSecret(token, owner)) return 'owner';
      if (sameSecret(token, proposer)) return 'proposer';
      return null;
    },
  };
}
