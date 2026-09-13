/**
 * RFC 8288 `Link`-header pagination, reduced to the one relation this adapter
 * needs. Split out of `github.ts` because "what does 'no more pages' mean, and
 * when is that unknowable rather than false" is a complete argument on its own,
 * distinct from the issue-mapping (`github-issue.ts`) and error vocabulary
 * (`github-errors.ts`) that sit alongside it.
 */
import { malformed, snippet } from './github-errors.js';

/** One `<uri>` optionally followed by `; params`, which is RFC 8288's grammar. */
const LINK_VALUE = /^\s*<([^>]*)>\s*(?:;\s*(.*))?$/;

/**
 * RFC 8288 `Link` header, reduced to the one relation pagination needs.
 *
 * NULL MEANS "GITHUB SAID THERE IS NO NEXT PAGE", and nothing else. The last
 * page of a real listing carries `rel="prev"` and `rel="first"` with no `next`,
 * so a header we can read and that has no `next` in it is the ordinary end of
 * the list. But a header we CANNOT read is a different fact, and returning null
 * for it would end pagination early and hand back the pages collected so far —
 * the one way left in this file to produce a plausible, quietly short backlog.
 * A caller acting on page one of five would never learn that four are missing.
 * So an unreadable `Link` is fatal, exactly like an unreadable body.
 */
export function nextPageUrl(header: string | null, url: string, status: number): string | null {
  if (header === null) return null;
  for (const part of header.split(',')) {
    // A trailing comma is sloppy, not unreadable; it says nothing either way.
    if (part.trim() === '') continue;
    const match = LINK_VALUE.exec(part);
    const target = match?.[1];
    if (match === null || target === undefined) {
      throw malformed(url, status, `its Link header is not RFC 8288 link values: "${snippet(header)}"`);
    }
    // `match[2]` is absent for a bare `<uri>` with no parameters, which the RFC
    // permits and which simply carries no relation — readable, just not `next`.
    const params = match[2];
    if (params !== undefined && /\brel\s*=\s*"?next"?/.test(params)) return target;
  }
  return null;
}
