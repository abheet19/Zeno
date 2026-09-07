/**
 * WHICH ORIGINS THE OWNER'S REAL CHROME MAY BE DRIVEN AGAINST.
 *
 * This is the file that carries the whole weight of the difference between
 * `@abheet19/zeno-browse` and this package, so it is worth saying the difference
 * out loud before any code:
 *
 *   The browse package's window has NO IDENTITY. Fresh session, no profile, no
 *   cookies, no logins. The worst it can do on a page is what a stranger with a
 *   brand-new browser can do. That is why a `read` there is honestly rated as
 *   "untrusted bytes arriving".
 *
 *   The owner's Chrome is the exact opposite. Every request carries the owner's
 *   cookies. An agent acting there acts AS THE OWNER on every site the owner is
 *   signed into — it can read their mail, move their money, delete their repos,
 *   accept terms in their name. There is no tier and no wording that makes that
 *   equivalent to a sandboxed window, so nothing here is rated as if it were.
 *
 * Three rules decide whether an origin may be touched at all, and they are
 * checked in this order, because the order IS the argument:
 *
 *   1. HTTPS ONLY. Stricter than the sandboxed window, which allows `http:`
 *      too. A plaintext page in the authenticated profile means the owner's
 *      session cookie is on the wire, and an agent should not be the reason for
 *      that. `file:`, `data:`, `chrome:`, `chrome-extension:` and `javascript:`
 *      are refused for the reasons `browse/src/protocol.ts` already gives.
 *
 *   2. THE NEVER-LIST WINS OVER EVERYTHING, including the owner's own allowlist.
 *      Banking, mail, cloud consoles, identity providers and password managers
 *      are refusable outright and cannot be talked out of it in the moment. That
 *      is the point: a rule that an agent can persuade the owner to relax, on
 *      the one afternoon the agent is being clever, is not a rule. An owner who
 *      genuinely wants their bank driven by an agent does not want it, and there
 *      is no capsule wording that makes it safe.
 *
 *   3. AN ORIGIN NOT ON THE OWNER'S ALLOWLIST IS REFUSED BEFORE A CAPSULE
 *      EXISTS, exactly as a `file:` URL is refused in the sandboxed window
 *      today. Consent is per-origin and it is granted OUT OF BAND — the owner
 *      adds an origin from the Zeno window, which is an owner-token route, not
 *      something an agent can ask for mid-run. An agent that could request its
 *      own allowlist entry would have turned a standing decision into one more
 *      capsule in a stream of capsules, which is how a gate gets clicked
 *      through.
 *
 * Pure and I/O-free, in the manner of `kernel/src/risk.ts` and `forge/src/
 * tools.ts`. The file that holds the owner's list lives in `allowlist-node.ts`;
 * nothing here reads a disk.
 */

/** Schemes the owner's authenticated Chrome may be driven to. One, deliberately. */
export const CHROME_SCHEMES: readonly string[] = ['https:'];

/** A hard ceiling on a URL, matching the sandboxed window's. */
export const MAX_URL_CHARS = 2048;

/**
 * Origins that are never driven, whatever is on the owner's allowlist.
 *
 * Kept SHORT, GROUPED and READABLE on purpose, in the spirit of the kernel's
 * `SENSITIVE_PATHS` and the shell rules in `forge/src/tools.ts`: a rule you
 * cannot hold in your head is a rule you cannot audit. Each entry is a HOST
 * SUFFIX matched on label boundaries — `paypal.com` covers `www.paypal.com` and
 * `paypal.com` and does not cover `notpaypal.com`.
 *
 * It is not, and does not claim to be, an exhaustive index of the world's banks.
 * It is the set of categories where "the agent acted as me" is unrecoverable,
 * and it is deliberately paired with an owner-editable extension (see
 * `OriginPolicy.neverExtra`) so the owner can name their own bank without anyone
 * pretending this list already knew it. The category travels into the refusal
 * so the sentence the owner reads says WHY, not merely "no".
 */
export const NEVER_ORIGINS: readonly { readonly category: string; readonly suffixes: readonly string[] }[] = [
  {
    category: 'an identity provider — a session here is every other session',
    suffixes: [
      'accounts.google.com',
      'login.microsoftonline.com',
      'login.live.com',
      'appleid.apple.com',
      'okta.com',
      'onelogin.com',
      'auth0.com',
      'duosecurity.com',
      'id.atlassian.com',
    ],
  },
  {
    category: 'mail — the account every password reset is sent to',
    suffixes: [
      'mail.google.com',
      'outlook.office.com',
      'outlook.office365.com',
      'outlook.live.com',
      'mail.yahoo.com',
      'mail.proton.me',
      'app.fastmail.com',
      'mail.zoho.com',
    ],
  },
  {
    category: 'banking or payments — money moves and does not move back',
    suffixes: [
      'paypal.com',
      'wise.com',
      'revolut.com',
      'coinbase.com',
      'binance.com',
      'chase.com',
      'americanexpress.com',
      'hdfcbank.com',
      'icicibank.com',
      'axisbank.com',
      'onlinesbi.sbi',
      'kotak.com',
      'razorpay.com',
      'dashboard.stripe.com',
    ],
  },
  {
    category: 'a cloud console — one click here bills, deletes or exposes infrastructure',
    suffixes: [
      'console.aws.amazon.com',
      'signin.aws.amazon.com',
      'portal.azure.com',
      'console.cloud.google.com',
      'dash.cloudflare.com',
      'vercel.com',
      'app.netlify.com',
      'app.digitalocean.com',
    ],
  },
  {
    category: 'a password manager — the keys to everything else',
    suffixes: ['1password.com', 'lastpass.com', 'bitwarden.com', 'dashlane.com', 'keepersecurity.com'],
  },
];

/**
 * The one heuristic beside the list, and the only one.
 *
 * A host with a `bank`, `banking` or `netbanking` LABEL is treated as banking
 * without being named. It is a label match, not a substring match, so
 * `bankofamerica.com` is caught by its own label and `databank.example.com` is
 * caught too — a false positive here costs the owner one refusal they can read,
 * and that is the right side to be wrong on. `burbank.com` is NOT caught,
 * because `burbank` is not the label `bank`.
 */
export const BANKING_LABELS: readonly string[] = ['bank', 'banking', 'netbanking'];

/** What the owner has decided. Both lists are theirs; only the first can widen. */
export interface OriginPolicy {
  /**
   * Exact origins the owner has added, e.g. `https://github.com`. Exact, never a
   * pattern: `*.example.com` would be one wildcard away from an origin the owner
   * never pictured, and the owner is supposed to be able to read this list and
   * know what it means.
   */
  readonly allowed: readonly string[];
  /** Extra host suffixes the owner considers never-list. Added to, never subtracted from, the built-in. */
  readonly neverExtra?: readonly string[];
}

/** The verdict on one origin. Never both branches; never a "probably". */
export type OriginVerdict =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

/** True when `host` is `suffix` or a subdomain of it. Label-boundary, never substring. */
export function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase();
  return h === s || h.endsWith('.' + s);
}

/** The never-list category this host falls in, or null. Built-in first, then the owner's. */
export function neverCategory(host: string, extra: readonly string[] = []): string | null {
  for (const group of NEVER_ORIGINS) {
    if (group.suffixes.some((s) => hostMatches(host, s))) return group.category;
  }
  if (host.toLowerCase().split('.').some((label) => BANKING_LABELS.includes(label))) {
    return 'banking or payments — money moves and does not move back';
  }
  if (extra.some((s) => s.trim() !== '' && hostMatches(host, s.trim()))) {
    return 'an origin you put on your own never-list';
  }
  return null;
}

/**
 * Normalise a URL or an origin string to a bare `https://host[:port]` origin.
 *
 * Exported because THREE places must agree on what an origin is — the
 * classifier that writes the capsule, the daemon that checks the allowlist, and
 * the extension that compares the active tab against what the capsule claimed.
 * Two places answering this differently is how a capsule ends up naming
 * `https://example.com` for an action that happened somewhere else.
 */
export function parseOrigin(raw: string): OriginVerdict {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'no origin was given' };
  if (trimmed.length > MAX_URL_CHARS) return { ok: false, reason: `that is longer than ${MAX_URL_CHARS} characters` };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'that is not a URL Zeno can parse, so it cannot say on the capsule which site it means' };
  }
  if (!CHROME_SCHEMES.includes(parsed.protocol)) {
    return {
      ok: false,
      reason:
        `"${parsed.protocol}" is not a scheme Zeno will drive your real Chrome to — https only, ` +
        'because every request from that profile carries your session cookies and they do not belong on a plaintext wire',
    };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'the URL carries a username or password, and Zeno will not put a credential on a capsule' };
  }
  if (parsed.hostname === '') return { ok: false, reason: 'that URL has no host' };
  return { ok: true, origin: parsed.origin };
}

/**
 * The whole decision: may Zeno drive the owner's authenticated Chrome here?
 *
 * The refusal sentences are written to be read by the OWNER, not by the agent,
 * because the owner is the one who will be asked "why did nothing happen?".
 */
export function decideOrigin(raw: string, policy: OriginPolicy): OriginVerdict {
  const parsed = parseOrigin(raw);
  if (!parsed.ok) return parsed;
  const host = new URL(parsed.origin).hostname;

  // The never-list is checked BEFORE the allowlist, and that ordering is the
  // rule. An origin on both lists is refused.
  const never = neverCategory(host, policy.neverExtra ?? []);
  if (never !== null) {
    return {
      ok: false,
      reason:
        `${parsed.origin} is on Zeno's never-list (${never}). ` +
        'This is the one list your allowlist cannot override — an agent acting in your signed-in Chrome acts as you, ' +
        'and here that is not recoverable. Do it yourself in your own window.',
    };
  }

  const allowed = policy.allowed.some((entry) => {
    const e = parseOrigin(entry);
    return e.ok && e.origin === parsed.origin;
  });
  if (!allowed) {
    return {
      ok: false,
      reason:
        `${parsed.origin} is not on your Chrome allowlist, so Zeno refused it without asking you anything. ` +
        'Adding an origin is your own act, done from the Zeno window — not something an agent can request mid-run.',
    };
  }
  return { ok: true, origin: parsed.origin };
}
