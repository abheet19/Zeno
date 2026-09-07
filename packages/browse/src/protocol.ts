/**
 * What one browser operation is, on the wire — and what it is allowed to be.
 *
 * WHY THIS PACKAGE EXISTS AT ALL. `forge/src/tools.ts` says of an MCP server
 * that it is "a process outside the worktree that Zeno neither started nor
 * bounds", and rates every call to one as egress on exactly that ground. A
 * browser Zeno starts IS a process Zeno bounds: this package is what makes that
 * sentence true rather than aspirational. It owns the window's lifetime, its
 * session, the schemes it may load and the operations that may be asked of it,
 * and it is a separate package from Forge because those are facts about a
 * BROWSER, not about a coding agent — Forge decides what an agent may ask for;
 * this decides what the browser will do when asked.
 *
 * Pure and I/O-free, in the manner of `kernel/src/risk.ts` and `forge/src/
 * tools.ts`: an operation and its arguments in, either a validated request or a
 * refusal out. The subprocess lives in `host-node.ts`, the window in
 * `session-main.cjs`, and neither of them decides anything this file decides.
 *
 * EVERY BOUND HERE FAILS CLOSED. An unrecognised operation, an unparseable URL,
 * a scheme that is not http(s), a selector longer than a selector has any reason
 * to be — each one is a refusal with a sentence, never a "best effort".
 */

/** The operations the window will perform. There is no other verb. */
export const BROWSE_OPS = ['ping', 'navigate', 'read', 'click', 'type', 'screenshot'] as const;
export type BrowseOp = (typeof BROWSE_OPS)[number];

/**
 * Schemes a Zeno-driven page may be loaded from.
 *
 * `file:` is the one that matters, and it is absent on purpose: a browser that
 * can be told to open `file:///C:/Users/…` is a second, ungoverned `Read` with a
 * root the worktree jail does not cover. `data:` and `javascript:` are absent
 * for the neighbouring reason — they are not fetches at all, they are code the
 * caller supplied, and a capsule reading "open this URL" would be describing the
 * wrong thing entirely.
 */
export const NAVIGABLE_SCHEMES: readonly string[] = ['http:', 'https:'];

/** Hard ceilings. A page is read, not ingested; a selector is a selector. */
export const MAX_URL_CHARS = 2048;
export const MAX_SELECTOR_CHARS = 400;
export const MAX_TYPE_CHARS = 2000;
/** How much page text one `read` may return. Past this it is truncated and says so. */
export const MAX_PAGE_CHARS = 20_000;
/** The longest edge of a returned screenshot, in CSS pixels. Keeps a PNG a page, not a payload. */
export const SCREENSHOT_WIDTH = 900;

/** One request on the stdio pipe to the window. `id` correlates the answer. */
export interface BrowseRequest {
  readonly id: number;
  readonly op: BrowseOp;
  /** navigate only. Already validated by `parseBrowseCall` before it gets here. */
  readonly url?: string;
  /** click / type: a CSS selector for the element. */
  readonly selector?: string;
  /** type: the literal text to enter. The owner read this on the capsule. */
  readonly text?: string;
}

/** What the window answers. Total: a failure is `ok: false`, never a dropped line. */
export interface BrowseResponse {
  readonly id: number;
  readonly ok: boolean;
  /** One human sentence: what happened, or why it did not. */
  readonly detail: string;
  /** The page's URL after the operation, when there is a page. */
  readonly url?: string;
  readonly title?: string;
  /** `read`: the page's visible text, capped at MAX_PAGE_CHARS. */
  readonly text?: string;
  /** `screenshot`: a PNG, base64. */
  readonly png?: string;
}

/** A validated call, or the reason it is not one. Never both. */
export type BrowseCall =
  | { readonly ok: true; readonly request: Omit<BrowseRequest, 'id'> }
  | { readonly ok: false; readonly reason: string };

function str(input: unknown, name: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const v = (input as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : '';
}

/**
 * Is this a URL Zeno's browser will open?
 *
 * Exported because the CLASSIFIER needs the same answer the window will give —
 * `forge/src/tools.ts` refuses a non-navigable URL outright rather than putting
 * a capsule in front of the owner for a navigation that would then be rejected
 * downstream. Two places asking the question is fine; two places ANSWERING it
 * differently is how a capsule ends up describing something that did not happen.
 */
export function navigableUrl(raw: string): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'no URL was given' };
  if (trimmed.length > MAX_URL_CHARS) {
    return { ok: false, reason: `the URL is longer than ${MAX_URL_CHARS} characters` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'that is not a URL Zeno can parse, so it cannot say on the capsule where it goes' };
  }
  if (!NAVIGABLE_SCHEMES.includes(parsed.protocol)) {
    return {
      ok: false,
      reason: `"${parsed.protocol}" is not a scheme Zeno's browser opens — only ${NAVIGABLE_SCHEMES.join(' and ')}`,
    };
  }
  // Credentials in the URL would be a secret travelling through a capsule, a
  // log line and a receipt summary. The owner should never be shown one, and
  // Zeno should never be the thing that wrote it down.
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'the URL carries a username or password, and Zeno will not put a credential on a capsule' };
  }
  return { ok: true, url: parsed.toString() };
}

/**
 * Turn a tool's arguments into a request the window will accept, or refuse it.
 *
 * `ping` takes nothing and is the liveness proof — see `probe.ts`. The others
 * carry exactly the fields their capsule named, and nothing else survives: a
 * caller cannot smuggle a second field past this function into the window.
 */
export function parseBrowseCall(op: string, input: unknown): BrowseCall {
  if (!(BROWSE_OPS as readonly string[]).includes(op)) {
    return { ok: false, reason: `"${op}" is not an operation Zeno's browser has` };
  }
  const kind = op as BrowseOp;
  if (kind === 'navigate') {
    const url = navigableUrl(str(input, 'url'));
    if (!url.ok) return { ok: false, reason: url.reason };
    return { ok: true, request: { op: kind, url: url.url } };
  }
  if (kind === 'click' || kind === 'type') {
    const selector = str(input, 'selector').trim();
    if (selector === '') return { ok: false, reason: 'no element was named — give a CSS selector' };
    if (selector.length > MAX_SELECTOR_CHARS) {
      return { ok: false, reason: `the selector is longer than ${MAX_SELECTOR_CHARS} characters` };
    }
    if (kind === 'click') return { ok: true, request: { op: kind, selector } };
    const text = str(input, 'text');
    if (text.length > MAX_TYPE_CHARS) {
      return { ok: false, reason: `the text is longer than ${MAX_TYPE_CHARS} characters` };
    }
    return { ok: true, request: { op: kind, selector, text } };
  }
  return { ok: true, request: { op: kind } };
}
