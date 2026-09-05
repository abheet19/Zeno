/**
 * The detector rules — one named regex per shape of secret, in PRIORITY order.
 *
 * Order is load-bearing. When two rules match the same span the sanitizer keeps
 * the LONGEST match, and breaks a length tie by taking the rule that appears
 * EARLIER in this array. So the specific, high-confidence shapes come first and
 * the broad `high-entropy` last-resort catch comes dead last: a 40-char AWS
 * secret should be labelled `aws-secret`, not the anonymous `high-entropy` net
 * that also happens to cover it.
 *
 * Every rule is data — a regex, an id, a human label, and a class. There is no
 * imperative detection code here; the engine in `sanitize.ts` is what runs them.
 * A rule may name a capture GROUP to redact (so `KEY=<secret>` keeps the key and
 * loses only the value) and may carry a secondary `filter` predicate for the one
 * case a regex cannot decide on its own (entropy).
 */

/**
 * The category a finding belongs to. Coarser than the ruleId and meant for
 * humans and policy: "an env secret leaked" is a decision; "rule dotenv-secret
 * fired" is an implementation detail.
 */
export type SecretClass =
  | 'cloud-credential'
  | 'vcs-token'
  | 'ai-provider-key'
  | 'chat-token'
  | 'jwt'
  | 'private-key'
  | 'bearer-token'
  | 'connection-string'
  | 'env-secret'
  | 'high-entropy';

/**
 * One detector. `regex` is written with only the flags it needs to read well;
 * the engine clones it with the global + indices flags before running, so a rule
 * is never a shared mutable cursor and the same RULES array is safe to reuse
 * across calls and threads.
 *
 * `redactGroup` (default 0, the whole match) names the sub-span to replace, so a
 * `DATABASE_URL=...` line can keep everything but the credential. `filter`, when
 * present, must return true for a candidate to survive — it is how the
 * high-entropy net rejects a long-but-boring run without a second regex.
 *
 * `fallback` marks a LAST-RESORT rule (the high-entropy net). A fallback finding
 * yields to any overlapping specific finding regardless of length: because the
 * entropy regex greedily swallows a key name and its `=` along with the value
 * (`_` and `=` are in its alphabet), its raw span is often LONGER than the named
 * rule's — and plain longest-wins would then mislabel a curated `aws-secret` as
 * the anonymous `high-entropy` catch. The whole reason the specific rules exist
 * is to name what they find, so they win the overlap and the net only fills the
 * gaps nothing named could explain.
 */
export interface Rule {
  readonly id: string;
  readonly label: string;
  readonly klass: SecretClass;
  readonly regex: RegExp;
  readonly redactGroup?: number;
  readonly filter?: (secret: string) => boolean;
  readonly fallback?: boolean;
}

/**
 * Shannon entropy in bits per character — the ORDER-0 entropy of the symbol
 * distribution alone. It knows nothing of order or of dictionary words: it reads
 * only how evenly the characters are spread. A truly random base64 run approaches
 * 6.0 and a 62-symbol secret sits well above 5.0.
 *
 * What this number does NOT do is separate a secret from every long non-secret.
 * A 64-char hex CONTENT HASH sits near 4.0, and 35 letters of concatenated
 * English (`getUserAuthenticationTokenFromCache`) sit near 4.0 too — both far
 * above any floor that still admits real secrets, because order-0 entropy is high
 * for anything drawing on a wide-ish alphabet, secret or not. (The famous "~1 bit
 * per character of English" is the ORDER-N figure with context; per character in
 * isolation, prose is not low.) So the last-resort net pairs this with alphabet
 * gates (see {@link looksHighEntropy}) that reject the two shapes entropy cannot:
 * a run confined to hex (a sha, a uuid, a digest) and a run that is all letters
 * (an identifier). Those gates, not the floor, are what keep the net from crying
 * wolf on the hashes Zeno itself prints in every receipt.
 */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * How many of {lowercase, uppercase, digit} appear. A run that draws on only one
 * class — a SCREAMING_CONSTANT, a lowercase identifier — is almost never a
 * secret, so the last-resort net demands at least two. Symbols (+ / = _ -) count
 * toward neither, on purpose: "====……" is not a credential.
 */
export function classDiversity(text: string): number {
  let lower = 0;
  let upper = 0;
  let digit = 0;
  for (const ch of text) {
    if (ch >= 'a' && ch <= 'z') lower = 1;
    else if (ch >= 'A' && ch <= 'Z') upper = 1;
    else if (ch >= '0' && ch <= '9') digit = 1;
  }
  return lower + upper + digit;
}

/** The bar the high-entropy last-resort net must clear to fire. */
const ENTROPY_FLOOR = 3.0;

/**
 * A run confined to the hexadecimal alphabet (optionally broken by `-`, as a
 * UUID is) is a DIGEST or IDENTIFIER, not a secret: a git commit sha (40 hex),
 * an md5 (32), a sha-256 CONTENT HASH (64), a hex Ed25519 signature (128), a
 * UUID (`8-4-4-4-12`). Zeno stamps these into every receipt, ledger line and
 * approval capsule — `selfHash`, `prevReceipt` and the hex `signature` are all
 * of this shape — so a net that redacted them would corrupt the very artifact it
 * guards AND fire on every single record. That is precisely how a sanitizer
 * earns a reputation for crying wolf and gets switched off.
 *
 * A real random secret almost never confines itself to hex: base64 / base62 /
 * base32 encodings all reach into g–z, G–Z and `+ / = _`, so a live key reliably
 * carries a character outside this set. A secret that genuinely IS bare hex is,
 * by its shape alone, indistinguishable from a digest — and is still caught by a
 * NAMED rule, or by `dotenv-secret` when it appears beside its key. The
 * last-resort net deliberately yields it rather than redact every hash in sight.
 */
function isHexRun(secret: string): boolean {
  return /^[0-9a-fA-F]+(?:-[0-9a-fA-F]+)*$/.test(secret);
}

/**
 * A run of nothing but letters is an IDENTIFIER or concatenated prose — a
 * camelCase symbol lifted from a log line, a PascalCase type name,
 * `TheQuickBrownFox…` — not an encoded secret. Order-0 entropy cannot tell the
 * two apart (English letters carry ~4 bits/char), but the ALPHABET can: every
 * common secret encoding is digit-bearing, so a uniformly random 32-char key
 * omits digits with probability < 0.5% and a 40-char key with < 0.1%. A long run
 * with zero digits and zero symbols is therefore overwhelmingly a word, not a
 * key — and a letters-only secret would in any case be shape-identical to an
 * identifier, so the net yields it too.
 */
function isAlphaRun(secret: string): boolean {
  return /^[A-Za-z]+$/.test(secret);
}

/**
 * The last-resort net fires only on a run that clears every gate. The first two
 * reject the shapes a high entropy score CANNOT — a hex digest / uuid, and an
 * all-letters identifier — which is what stops the false-positive storm (the
 * hashes and ids Zeno prints everywhere, concatenated English) that gets a
 * sanitizer turned off. The last two are the original pair: a run is only a
 * secret if it is BOTH mixed (>= 2 character classes) and genuinely disordered
 * (entropy >= floor), which rejects a long single-class or repetitive run (a
 * `SCREAMING_CONSTANT`, `abababab…`).
 */
function looksHighEntropy(secret: string): boolean {
  if (isHexRun(secret)) return false;
  if (isAlphaRun(secret)) return false;
  return classDiversity(secret) >= 2 && shannonEntropy(secret) >= ENTROPY_FLOOR;
}

/**
 * The ordered rule set. Comments give the shape each regex is trying to catch and
 * the near-miss it is deliberately NOT catching, so the intent survives the next
 * person who edits the pattern.
 */
export const RULES: readonly Rule[] = [
  {
    // A PEM private-key block, header to footer. Whole block redacted — the
    // longest match in the file, so it always beats the base64 lines inside it.
    // NOT a CERTIFICATE or PUBLIC KEY block: those are not secret.
    id: 'pem-private-key',
    label: 'PEM private key block',
    klass: 'private-key',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    // AWS access key id: literal AKIA + 20 total. Fixed length, so `AKIASHORT`
    // is not one.
    id: 'aws-access-key-id',
    label: 'AWS access key id',
    klass: 'cloud-credential',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    // AWS secret access key: 40+ base64 chars, but ONLY when anchored to an
    // aws…secret / aws…private context — a bare 40-char base64 run is
    // meaningless and would fire on anything. The value (group 1) is redacted;
    // the key name stays. `aws_region = us-east-1` has no secret and no 40-run.
    //
    // The value is pinned to the delimiter that precedes it (`['"=:` or space)
    // and captured as a WHOLE run (`{40,}`, not `{40}`). Both halves matter:
    // without the delimiter the fixed window slides LEFT into the key name (its
    // letters and `=` are in the value's own class), capturing `key=` and the
    // first 36 secret bytes while the last 4 bytes LEAK; `{40,}` then guarantees
    // the whole contiguous secret is taken, never a 40-char prefix of a longer run.
    id: 'aws-secret',
    label: 'AWS secret access key',
    klass: 'cloud-credential',
    regex: /aws.{0,24}?(?:secret|private).{0,24}?['"=:\s]([A-Za-z0-9/+=]{40,})/gi,
    redactGroup: 1,
  },
  {
    // GitHub token: ghp_/gho_/ghs_/ghr_/gho_ classic (36 body chars) or a
    // github_pat_ fine-grained token. `ghp_tooshort` is below the length floor.
    id: 'github-token',
    label: 'GitHub token',
    klass: 'vcs-token',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g,
  },
  {
    // OpenAI / Anthropic key: sk- or sk-ant- followed by a long body. `sk-short`
    // never reaches the 20-char floor.
    id: 'llm-api-key',
    label: 'OpenAI/Anthropic API key',
    klass: 'ai-provider-key',
    regex: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    // Google API key: literal AIza + 35. `AIzaShort` is too short.
    id: 'google-api-key',
    label: 'Google API key',
    klass: 'cloud-credential',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    // Slack token: xox[b|a|p|r|s]- then a long body. `xoxo-…` has an out-of-set
    // fourth character and is not a token.
    id: 'slack-token',
    label: 'Slack token',
    klass: 'chat-token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    // A JWT, opening with eyJ (base64 of `{"`). Anchoring on eyJ keeps ordinary
    // `a.b.c` dotted text from matching. A JWS carries THREE base64url segments
    // and a JWE FIVE (header.encryptedKey.iv.ciphertext.tag) — so the whole token
    // is one-to-four dot-segments after the header. Matching only the first three
    // of a five-segment JWE would redact the header and leave the ciphertext and
    // tag (the sensitive halves) exposed in the output; `{2,4}` takes the token
    // whole so no trailing segment leaks.
    id: 'jwt',
    label: 'JSON Web Token',
    klass: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]{6,}){2,4}\b/g,
  },
  {
    // A bearer token carried in an Authorization header. `Bearer with me` never
    // reaches a 20-char token, so plain prose that starts with the word survives.
    //
    // The `i` flag is load-bearing, not cosmetic: the HTTP auth-scheme token is
    // case-INSENSITIVE (RFC 7235 §2.1), so real headers and logs carry `bearer`
    // and `BEARER` as freely as `Bearer`. Without `i`, a lowercased scheme slips
    // the rule, and a token under the 32-char entropy floor then has nothing else
    // to catch it and leaks whole. Case-insensitivity costs no false positives:
    // the 20-char unbroken-token requirement is what rejects prose, not the case.
    id: 'bearer-auth',
    label: 'Bearer token in Authorization header',
    klass: 'bearer-token',
    regex: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/gi,
    redactGroup: 1,
  },
  {
    // A URL with inline credentials: proto://user:pass@host. Only the user:pass
    // pair (group 2) is redacted, so the host stays legible. `postgres://host:5432/db`
    // has a port but no credentials and does not match.
    //
    // The password may itself contain an `@` (WHATWG parses the userinfo as
    // everything up to the LAST `@` before the host). The old class `[^\s:@/]`
    // stopped the password at the FIRST `@`, so `user:p@ss@host` redacted only
    // `user:p` and leaked `@ss` — the tail of the password — into the host slot.
    // Group 2 now runs to the final `@` (host excludes `@`), taking the whole
    // credential; the userinfo classes drop `:`/`@` since the pair is redacted whole.
    id: 'url-credentials',
    label: 'URL with inline credentials',
    klass: 'connection-string',
    regex: /\b([a-z][a-z0-9+.-]*):\/\/([^\s/]+?:[^\s/]+)@([^\s@/]+)/gi,
    redactGroup: 2,
  },
  {
    // A dotenv-style assignment whose KEY names a secret. The value (group 2) is
    // redacted; the key stays so the leak is traceable. `PORT=3000` names nothing
    // secret and is left alone.
    //
    // A QUOTED value may contain spaces (`PASSWORD="correct horse battery"`). The
    // old value class `[^\s"']{4,}` stopped at the first inner space, redacting
    // only `correct` and LEAKING ` horse battery` — the rest of the secret — into
    // the clean output. Group 2 now prefers a fully quoted run (`"..."`/`'...'`,
    // spaces and all) and falls back to the original unquoted/quote-hugged run, so
    // the redaction covers the whole value and no tail survives. The surrounding
    // quotes are redacted with it (harmless over-reach; the key name is untouched).
    id: 'dotenv-secret',
    label: 'Secret-named environment assignment',
    klass: 'env-secret',
    regex:
      /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)[A-Za-z0-9_]*)\s*[:=]\s*("[^"]{4,}"|'[^']{4,}'|["']?[^\s"']{4,}["']?)/gi,
    redactGroup: 2,
  },
  {
    // Last resort: a 32+ char run that survives the {@link looksHighEntropy}
    // gates — not a hex digest/uuid, not an all-letters identifier, and both
    // mixed and disordered. `fallback: true` so it yields to any named rule it
    // overlaps — it explains only what nothing else could. The gates are what
    // stop a false-positive storm: a repeated or single-class run (`ababab…`, a
    // SCREAMING_CONSTANT), and — the ones that get a sanitizer switched off — a
    // git sha, a UUID, a sha-256 content hash (all hex, all printed in every
    // Zeno receipt), and a concatenated-English identifier are all rejected.
    id: 'high-entropy',
    label: 'High-entropy string',
    klass: 'high-entropy',
    regex: /[A-Za-z0-9+/=_-]{32,}/g,
    filter: looksHighEntropy,
    fallback: true,
  },
];
