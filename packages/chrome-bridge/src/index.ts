/**
 * Zeno · Chrome — acting in the owner's OWN, signed-in browser. Public surface.
 *
 * The package in one sentence: a Forge run may, if the owner switched it on and
 * named the origin in advance, drive the Chrome they are actually logged into —
 * and every operation is an approval capsule that says the origin out loud and
 * says that this is the authenticated profile, not the throwaway window.
 *
 * READ `origins.ts` FIRST. It carries the whole argument for why this package is
 * not `@abheet19/zeno-browse` with a different transport: that window has no
 * identity and this one is the owner. Nothing exported here approves anything;
 * the strongest thing it can do is perform an operation somebody already
 * approved, at an origin the owner named before the run started.
 *
 *   origins.ts        — may Zeno touch this origin at all: https only, the
 *                       never-list (which the allowlist cannot override), then
 *                       the owner's allowlist. Pure.
 *   protocol.ts       — what an operation is and what it may be, plus the
 *                       recorded verification of WHY an extension and not CDP.
 *                       Pure.
 *   probe.ts          — the liveness proof. An extension that cannot be shown to
 *                       answer costs the run its Chrome TOOLS, not the guarantee.
 *   desk.ts           — one operation at a time, handed to a native host that
 *                       long-polls the daemon. Opens no listening port.
 *   allowlist-node.ts — the owner's consent, as one readable file.
 *
 *   native-host.cjs   — the native-messaging host Chrome spawns. The real edge.
 *   extension/        — the Manifest V3 extension, and the only thing here that
 *                       ever touches a page.
 *   install/register-host.mjs — registers the host with Chrome, on the owner's
 *                       own machine, by their own hand.
 */
export {
  BANKING_LABELS,
  CHROME_SCHEMES,
  MAX_URL_CHARS,
  NEVER_ORIGINS,
  decideOrigin,
  hostMatches,
  neverCategory,
  parseOrigin,
  type OriginPolicy,
  type OriginVerdict,
} from './origins.js';
export {
  CHROME_OPS,
  MAX_IMAGE_CHARS,
  MAX_PAGE_CHARS,
  MAX_SELECTOR_CHARS,
  MAX_TYPE_CHARS,
  parseChromeCall,
  type ChromeCall,
  type ChromeOp,
  type ChromeRequest,
  type ChromeResponse,
} from './protocol.js';
export {
  CHROME_PROVEN_NOTE,
  CHROME_UNPROVEN_NOTE,
  readChromeProbe,
  type ChromeProof,
} from './probe.js';
export {
  OPERATION_TIMEOUT_MS,
  POLL_PARK_MS,
  PROBE_TIMEOUT_MS,
  chromeDesk,
  type ChromeDesk,
  type ChromeDeskOptions,
} from './desk.js';
export {
  ALLOWLIST_FILE,
  addOrigin,
  hasAllowlist,
  readOriginPolicy,
  removeOrigin,
  type AddResult,
} from './allowlist-node.js';
