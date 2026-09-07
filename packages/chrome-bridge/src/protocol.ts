/**
 * What one operation in the OWNER'S REAL CHROME is, on the wire — and what it
 * is allowed to be.
 *
 * WHY THIS PACKAGE EXISTS AT ALL, and why it is not a second copy of
 * `@abheet19/zeno-browse`.
 *
 * WHY AN EXTENSION AND NOT CDP. The obvious way to drive the owner's real
 * browser is `--remote-debugging-port`, and it is closed by design. Since
 * CHROME 136 those debugging switches are IGNORED when Chrome is running on the
 * default user-data-dir; they take effect only when paired with a non-default
 * `--user-data-dir`. A non-default profile directory uses a different
 * encryption key, so it holds none of the owner's real cookies, sessions or
 * logins. Google hardened this precisely because malware was abusing CDP to
 * attach to real profiles and exfiltrate their state. So there are exactly two
 * outcomes available from CDP: it does not work, or it works against a fresh
 * profile — and a fresh-profile CDP browser is a strictly worse duplicate of
 * `packages/browse`, which already owns that job with a window Zeno itself
 * starts and kills. Hence a Manifest V3 extension plus a native-messaging host:
 * the only supported path into the real profile, and the only one where the
 * owner installs the capability deliberately and can see it in their browser.
 *   Verified 2026-09: developer.chrome.com/blog/remote-debugging-port.
 *
 * WHY NATIVE MESSAGING AND NOT A SOCKET. The README claims Zeno has "no inbound
 * surface at all". A helper listening on a port — even a loopback one — would
 * make that sentence false, and would be a port any process on the machine
 * could reach. A native-messaging host is instead SPAWNED BY CHROME and spoken
 * to over its own stdin/stdout with Chrome's 4-byte-length framing. It opens
 * nothing. What it does open is an OUTBOUND long-poll to the daemon's existing
 * loopback address, which is a client connection and adds no listener.
 *   `packages/browse/src/host-node.ts` records that a stdin-based protocol was
 * killed on Windows because an Electron binary is GUI-subsystem and its stdin
 * closes the instant it starts (fixed there with Node IPC). That failure does
 * not apply here and it was checked rather than assumed: the native-messaging
 * host is a plain `node` console process, its stdin is a real pipe Chrome holds
 * open for the life of the port, and framed stdio is the only transport Chrome
 * offers a native host.
 *
 * WHAT IS DIFFERENT ABOUT EVERY OPERATION HERE. The sandboxed window has no
 * identity. This one is the owner. See `origins.ts` for the full argument; the
 * consequence for this file is that EVERY operation carries an explicit
 * `origin`, including the ones that act on a tab that is already open.
 *
 * WHY THE ORIGIN IS AN ARGUMENT AND NOT SOMETHING ZENO LOOKS UP. A capsule must
 * name the site before anything happens, and the classifier that writes the
 * capsule is a pure function of the tool call — it cannot go and ask Chrome what
 * tab is in front. So the agent must STATE the origin it intends, the capsule
 * shows the owner that stated origin, and the extension then refuses the
 * operation if the tab it is actually looking at is somewhere else. A lie costs
 * the agent the operation and produces no effect; it can never produce an effect
 * somewhere the capsule did not name.
 *
 * Pure and I/O-free. The native host is `native-host.cjs`, the extension is
 * `extension/`, and neither of them decides anything this file decides.
 */
import { decideOrigin, parseOrigin, type OriginPolicy } from './origins.js';

/** The operations Zeno will perform in the owner's Chrome. There is no other verb. */
export const CHROME_OPS = ['ping', 'navigate', 'read', 'click', 'type', 'screenshot'] as const;
export type ChromeOp = (typeof CHROME_OPS)[number];

/** Hard ceilings. Deliberately tighter than the sandboxed window's, not looser. */
export const MAX_SELECTOR_CHARS = 400;
export const MAX_TYPE_CHARS = 2000;
/** How much page text one `read` may return. */
export const MAX_PAGE_CHARS = 20_000;
/**
 * The biggest answer the native host may hand back to Chrome, in base64 chars.
 *
 * Chrome caps a single native-host→browser message at 1 MB and simply drops the
 * port when it is exceeded — a silent failure, which is the worst kind. The
 * screenshot is therefore a JPEG rather than a PNG and is bounded here, and an
 * answer over the cap is refused with a sentence instead of vanishing.
 */
export const MAX_IMAGE_CHARS = 700_000;

/** One request on the wire to the extension. `id` correlates the answer. */
export interface ChromeRequest {
  readonly id: number;
  readonly op: ChromeOp;
  /**
   * The origin this operation is for, always — `ping` excepted. The extension
   * compares it against the tab it is about to act on and refuses a mismatch.
   */
  readonly origin?: string;
  /** navigate only: the full URL, whose origin equals `origin`. */
  readonly url?: string;
  /** click / type: a CSS selector for the element. */
  readonly selector?: string;
  /** type: the literal text. The owner read this on the capsule. */
  readonly text?: string;
}

/** What the extension answers. Total: a failure is `ok: false`, never a dropped line. */
export interface ChromeResponse {
  readonly id: number;
  readonly ok: boolean;
  /** One human sentence: what happened, or why it did not. */
  readonly detail: string;
  /** The tab's URL after the operation. */
  readonly url?: string;
  readonly title?: string;
  /** `read`: the page's visible text, capped at MAX_PAGE_CHARS. */
  readonly text?: string;
  /** `screenshot`: a JPEG, base64. */
  readonly jpeg?: string;
  /** `ping`: the Chrome profile the extension is installed in, for the capsule and the proof. */
  readonly profile?: string;
}

/** A validated call, or the reason it is not one. Never both. */
export type ChromeCall =
  | { readonly ok: true; readonly request: Omit<ChromeRequest, 'id'> }
  | { readonly ok: false; readonly reason: string };

function str(input: unknown, name: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const v = (input as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : '';
}

/**
 * Turn a tool's arguments into a request the extension will accept, or refuse it.
 *
 * The origin policy is applied HERE, before any capsule can exist, in the same
 * place and for the same reason the sandboxed window refuses a `file:` URL: an
 * owner should never be asked to approve something that would then be rejected
 * downstream, and an origin off the allowlist is not a question, it is a no.
 */
export function parseChromeCall(op: string, input: unknown, policy: OriginPolicy): ChromeCall {
  if (!(CHROME_OPS as readonly string[]).includes(op)) {
    return { ok: false, reason: `"${op}" is not an operation Zeno's Chrome bridge has` };
  }
  const kind = op as ChromeOp;
  // `ping` is the liveness proof and touches no page — see `probe.ts`. It is the
  // one operation with no origin, because it asks the extension about ITSELF.
  if (kind === 'ping') return { ok: true, request: { op: kind } };

  const stated = kind === 'navigate' ? str(input, 'url') : str(input, 'origin');
  const decided = decideOrigin(stated, policy);
  if (!decided.ok) return { ok: false, reason: decided.reason };
  const origin = decided.origin;

  if (kind === 'navigate') {
    const full = parseOrigin(str(input, 'url'));
    // Unreachable in practice — `decideOrigin` already parsed the same string —
    // but the URL is rebuilt rather than re-derived so the request carries the
    // exact address the capsule showed, path and query included.
    if (!full.ok) return { ok: false, reason: full.reason };
    return { ok: true, request: { op: kind, origin, url: new URL(str(input, 'url').trim()).toString() } };
  }
  if (kind === 'click' || kind === 'type') {
    const selector = str(input, 'selector').trim();
    if (selector === '') return { ok: false, reason: 'no element was named — give a CSS selector' };
    if (selector.length > MAX_SELECTOR_CHARS) {
      return { ok: false, reason: `the selector is longer than ${MAX_SELECTOR_CHARS} characters` };
    }
    if (kind === 'click') return { ok: true, request: { op: kind, origin, selector } };
    const text = str(input, 'text');
    if (text.length > MAX_TYPE_CHARS) {
      return { ok: false, reason: `the text is longer than ${MAX_TYPE_CHARS} characters` };
    }
    return { ok: true, request: { op: kind, origin, selector, text } };
  }
  return { ok: true, request: { op: kind, origin } };
}
