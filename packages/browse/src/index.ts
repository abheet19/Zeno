/**
 * Zeno · Browse — a browser Zeno starts, bounds, and kills. Public surface.
 *
 * The package in one sentence: a Forge run may be given a Chromium window that
 * belongs to it — fresh session, no profile, http(s) only, one operation at a
 * time — and every operation the agent asks for is still an approval capsule
 * against the kernel before it happens. Nothing exported here approves anything;
 * the strongest thing this package can do is drive a page the owner already
 * agreed to open.
 *
 *   protocol.ts  — what an operation is and what it may be. Pure: the schemes, the
 *                  ceilings, and the refusals. Both the classifier and the window
 *                  read their bounds from here so they cannot disagree.
 *   probe.ts     — the liveness proof. A browser that cannot be shown to work
 *                  costs the run its browser TOOLS, not the guarantee.
 *   host-node.ts — the subprocess: find the Electron already on this machine,
 *                  start one window for one run, and never throw.
 *   session-main.cjs (package root) — the window itself, and the full account of
 *                  what an agent-driven page can and cannot reach.
 */
export {
  BROWSE_OPS,
  MAX_PAGE_CHARS,
  MAX_SELECTOR_CHARS,
  MAX_TYPE_CHARS,
  MAX_URL_CHARS,
  NAVIGABLE_SCHEMES,
  SCREENSHOT_WIDTH,
  navigableUrl,
  parseBrowseCall,
  type BrowseCall,
  type BrowseOp,
  type BrowseRequest,
  type BrowseResponse,
} from './protocol.js';
export {
  BROWSER_PROVEN_NOTE,
  BROWSER_UNPROVEN_NOTE,
  readBrowserProbe,
  type BrowserProof,
} from './probe.js';
export {
  electronBinary,
  nodeBrowserHost,
  sessionEntryPath,
  type BrowseSession,
  type BrowserHost,
  type NodeBrowserHostOptions,
} from './host-node.js';
