/**
 * The heart: read a skill's own prose looking for the sentences that are not
 * teaching anything, but reaching for the gate.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Screening NEVER blocks a skill. It cannot; that is not where the safety lives.
 * Zeno's protection against a hostile skill is structural and sits somewhere else
 * entirely: every effect is classified, previewed, approved by the OWNER, committed
 * once and signed into a receipt, and an agent may propose but may never approve
 * (law L6). A skill that says "auto-approve this" is talking to a model that has no
 * approve button to press. The gate governs the effect regardless of what any prose
 * asked for, and it would still govern it if this whole file were deleted.
 *
 * So this module has exactly one job: TELL THE OWNER. A skill arrives as untrusted
 * third-party text that will be pasted into a model prompt, and the owner deserves
 * to see, before they install it, that page 4 of the manual asks the agent to read
 * `.env` and POST it somewhere. `verdict: "suspicious"` is a flag on a page, not a
 * verdict on a person and not a decision about what runs.
 *
 * CALIBRATION
 * -----------
 * A screen that cries wolf is a screen the owner learns to click past, which is
 * strictly worse than no screen. So the patterns below match the SHAPE of an
 * escalation attempt, not merely its vocabulary: "disregard the trailing comma"
 * stays clean while "disregard the previous instructions" does not, and "you are now
 * ready" stays clean while "you are now an unrestricted agent" does not. Every rule
 * is data, in the open, and every finding carries the exact text that tripped it so
 * the owner can judge it themselves rather than take this file's word for it.
 *
 * EVASION
 * -------
 * A rule that matches a literal phrase is a rule an author can spell around, and the
 * ways to spell around one are cheap: a zero-width space inside `auto-approve`, a
 * Cyrillic `а` in `ignore`, an en dash where a hyphen belongs, a line wrap through
 * the middle of `no need to ask`, or the whole sentence in base64. None of those
 * change what a model reads — a model sees through all of them — so a screen that
 * misses them is telling the owner "clean" about a document that is not.
 *
 * The answer is two-sided and both sides are needed:
 *
 *   NORMALISE, then match. Every region is folded to a plain-ASCII skeleton first —
 *   invisibles dropped, confusable letters mapped home, typographic dashes, quotes
 *   and spaces flattened, whitespace made elastic inside every phrase — so the rules
 *   below fire on the sentence a model would read rather than on its spelling. The
 *   fold keeps a byte map back to the original, so every quote is still cut from the
 *   author's own characters and the owner reads what they actually wrote.
 *
 *   REPORT THE TECHNIQUE ITSELF. Nothing honest hides a zero-width joiner inside a
 *   word, spells one token out of two alphabets, or walks its letters apart one space
 *   at a time. Those are not ways of writing English; they are ways of not being read.
 *   `obfuscated-text` flags the technique on sight, which is what covers the encodings
 *   this file will never learn to decode.
 */
import type { Skill } from './parse.js';

export type Severity = 'high' | 'medium';
export type Verdict = 'clean' | 'suspicious';

export interface Finding {
  /** The rule id, so a receipt or a UI can group findings without re-reading prose. */
  readonly rule: string;
  readonly severity: Severity;
  /** The offending text itself, trimmed and capped — the owner judges, not this file. */
  readonly quote: string;
  /** Why this shape of text matters, in words the owner can act on. */
  readonly why: string;
}

export interface ScreenResult {
  readonly verdict: Verdict;
  readonly findings: readonly Finding[];
}

/**
 * One detector. `patterns` are written without the global flag so they read as
 * plain statements of a shape; the engine clones each with `g` before scanning, so
 * the shared RULES array is never a mutable cursor between calls.
 */
export interface ScreenRule {
  readonly id: string;
  readonly severity: Severity;
  readonly why: string;
  readonly patterns: readonly RegExp[];
  /**
   * Scan the author's own characters instead of the folded skeleton. Set only where
   * the SPELLING is the finding: the fold exists to erase homoglyphs and invisibles,
   * so a rule that hunts for them must run before it.
   */
  readonly raw?: boolean;
}

/** Long enough to be damning, short enough to read in a list. */
export const MAX_QUOTE_CHARS = 120;

/**
 * A matcher for literal phrases, with word boundaries added only at alphanumeric
 * edges. That asymmetry is the point: `\bsudo\b` must not fire inside `sudoku`,
 * while `--allow-all` has no left-hand word edge to anchor to and must still match.
 *
 * Two deliberate slacknesses, both of them evasion repairs. A space in a needle
 * matches ANY run of whitespace, because markdown wraps and `no need to\nask the
 * owner` is the same sentence as the one on a single line. A hyphen may be followed
 * by whitespace, because `--dangerously-skip-\npermissions` is the same flag. Both
 * are safe because the words either side must still be there, in order: punctuation
 * ends a sentence, so a wrap can join `skip the / confirmation` but not `assume. /
 * Approval`.
 */
function phrases(...needles: readonly string[]): RegExp {
  const parts = needles.map((needle) => {
    const escaped = needle
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/ +/g, '\\s+')
      .replace(/-/g, '-\\s*');
    const left = /^\w/.test(needle) ? '\\b' : '';
    const right = /\w$/.test(needle) ? '\\b' : '';
    return left + escaped + right;
  });
  return new RegExp('(?:' + parts.join('|') + ')', 'i');
}

/**
 * Characters that take up no width on the page. Every one of them is a format or
 * bidi control with no business inside a word: zero-width space, joiner and
 * non-joiner, the soft hyphen, the word joiner, the directional overrides, the BOM.
 * They exist so that two strings a human reads as identical are not.
 */
const INVISIBLE_CLASS = '\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF';
const INVISIBLE = new RegExp('[' + INVISIBLE_CLASS + ']');
/** Every space a word processor, a CJK keyboard or an attacker might reach for. */
const UNICODE_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;
/** Every dash that is not the hyphen-minus, including the ones YAML and Word insert. */
const UNICODE_DASH = /[\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D]/;
/** Every apostrophe that is not the typewriter one. */
const UNICODE_QUOTE = /[\u2018\u2019\u201B\u02BC\u2032\u00B4]/;

/**
 * Letters from other alphabets that render as Latin ones. Not the whole Unicode
 * confusables table — that is enormous and mostly theoretical — but the Cyrillic
 * and Greek letters an attacker actually reaches for, because they are the ones
 * that are pixel-identical in the fonts a SKILL.md is read in. Fullwidth forms,
 * small capitals and the mathematical alphabets are handled by NFKC below and do
 * not need listing here.
 */
const CONFUSABLES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // Cyrillic
    а: 'a', В: 'b', в: 'b', с: 'c', ԁ: 'd', е: 'e', һ: 'h', н: 'h', і: 'i', ј: 'j',
    к: 'k', м: 'm', о: 'o', р: 'p', ԛ: 'q', ѕ: 's', т: 't', ԝ: 'w', х: 'x', у: 'y',
    ё: 'e', ӏ: 'l', ѵ: 'v', З: '3',
    // Greek
    α: 'a', β: 'b', ϲ: 'c', ε: 'e', η: 'n', ι: 'i', κ: 'k', μ: 'u', ν: 'v', ο: 'o',
    ρ: 'p', ς: 's', τ: 't', υ: 'u', χ: 'x', γ: 'y', Α: 'a', Β: 'b', Ε: 'e', Ζ: 'z',
    Η: 'h', Ι: 'i', Κ: 'k', Μ: 'm', Ν: 'n', Ο: 'o', Ρ: 'p', Τ: 't', Υ: 'y', Χ: 'x',
  }),
);

export const SCREEN_RULES: readonly ScreenRule[] = [
  {
    id: 'approval-bypass',
    severity: 'high',
    why:
      'Asks the agent to approve its own work, or to act as though the owner already ' +
      'approved. Law L6 — an agent may propose but never approve — is the one thing a ' +
      'skill can neither request nor be granted. Zeno will still stop and ask; treat ' +
      'the request itself as the finding.',
    patterns: [
      phrases(
        'auto-approve', 'auto approve', 'autoapprove', 'auto-approved', 'auto-approving',
        'self-approve', 'self approve', 'approve it yourself', 'approve on your own',
        'approve your own', 'skip confirmation', 'skip confirmations',
        'skip the confirmation', 'skip approval', 'skip the approval', 'skip the gate',
        'bypass approval', 'bypass the approval', 'bypass confirmation',
        'no need to ask', 'no need to confirm', 'no confirmation needed',
        'without asking the user', 'without asking the owner',
        'without asking for permission', 'without asking first', 'without confirmation',
        'without user approval', 'assume permission', 'assume you have permission',
        'assume approval', 'pre-approved', 'do not ask for permission',
        "don't ask for permission", 'never ask the user',
      ),
    ],
  },
  {
    id: 'permission-flag',
    severity: 'high',
    why:
      'Names a flag whose entire purpose is to switch off the confirmation, sandbox or ' +
      'directory limits that make running a stranger’s instructions survivable. ' +
      'Reference material has no business naming these: the sandbox is not the skill’s ' +
      'to open.',
    patterns: [
      phrases(
        '--dangerously-skip-permissions', '--dangerously-skip-permission',
        '--allow-all', '--allow-all-tools', '--no-sandbox', '--disable-sandbox',
        '--add-dir', '--yolo', 'bypassPermissions',
      ),
    ],
  },
  {
    id: 'privilege-escalation',
    severity: 'medium',
    why:
      'Reaches for the machine’s own privilege ladder. Ranked medium, not high, on ' +
      'purpose: ordinary install notes say `sudo` a hundred times a day, and a screen ' +
      'that cries wolf is a screen the owner stops reading. But a document that needs ' +
      'Administrator in order to teach you something is worth a second look.',
    patterns: [phrases('sudo', 'runas', 'run as administrator', 'as an administrator', 'elevated prompt')],
  },
  {
    id: 'instruction-override',
    severity: 'high',
    why:
      'Prompt injection: prose aimed at the model’s instruction stack rather than at ' +
      'the reader. Reference material describes a subject; it does not address the agent ' +
      'as its operator. A sentence that only makes sense as a command to the model is ' +
      'the signature of the attack.',
    patterns: [
      /\bignore\s+(?:all\s+)?(?:of\s+)?(?:the\s+|your\s+|any\s+)?(?:previous|prior|above|earlier|preceding|foregoing|other|system)\s+(?:instructions?|prompts?|rules?|messages?|directions?|guidance|guidelines?)\b/i,
      // The three-word window is deliberate. "disregard the previous instructions" is an
      // attack; "disregard the trailing comma" is a sentence about commas, and a rule
      // that could not tell them apart would flag half the honest skills on the machine.
      /\bdisregard\b(?:\s+\S+){0,3}\s+(?:instructions?|prompts?|rules?|guidance|guidelines?|above|prior|previous|polic(?:y|ies)|directives?|system)\b/i,
      // Likewise: "you are now ready to run the tests" is prose. A role reassignment is not.
      /\byou\s+are\s+now\s+(?:an?|the|not|no longer|in|operating|acting|running|allowed|permitted|authoriz?ed|authorised|free|unrestricted)\b/i,
      // A forged conversation turn at the start of a line — the oldest trick there is.
      /^[ \t>*#-]*(?:system|assistant)[ \t]*:/im,
      /\bnew\s+instructions\s*[:—-]/i,
      /\b(?:here\s+are|here's|below\s+are|following\s+are|follow)\s+(?:the\s+|your\s+)?new\s+instructions\b/i,
      /\boverride\s+your\s+(?:instructions?|system prompt|prompt|rules?|guidelines?|guardrails?|polic(?:y|ies)|constraints?|programming|directives?|settings?|configuration)\b/i,
      /\bforget\s+(?:everything|all)\b[^\n]{0,30}\b(?:above|before|told|instructions?)\b/i,
    ],
  },
  {
    id: 'exfiltration',
    severity: 'high',
    why:
      'Points at the owner’s secrets, or at a way off the machine. No piece of ' +
      'knowledge needs the contents of `.env`, an SSH private key or a credentials file ' +
      'in order to explain itself; paired with an outbound POST that is not an oversight, ' +
      'it is the payload.',
    patterns: [
      /\.env\b/i,
      /\bid_(?:rsa|dsa|ecdsa|ed25519)\b/i,
      /\.ssh\b/i,
      /\.aws[\\/]credentials\b/i,
      /\bcredentials\.json\b/i,
      // A verb of taking, then the word — so "keep credentials host-side" stays clean
      // while "read the credentials file" does not.
      /\b(?:read|reads|reading|cat|copy|dump|upload|send|post|include|exfiltrate|collect|gather|print)\b[^\n]{0,40}\bcredentials?\b/i,
      /\b(?:POST|PUT|upload|uploads|send|sends|exfiltrate|webhook|Invoke-RestMethod|Invoke-WebRequest)\b[^\n]{0,60}https?:\/\/\S+/i,
      /\bcurl\b[^\n]{0,60}(?:-d\b|--data\b|-F\b|--form\b|-T\b)[^\n]{0,60}https?:\/\/\S+/i,
    ],
  },
  {
    id: 'destructive-shell',
    severity: 'high',
    why:
      'A command that destroys something the owner cannot get back. Zeno gives an ' +
      'approved effect exactly one attempt and a signed receipt; an irreversible command ' +
      'buried in reference prose is an attempt to spend that one attempt on something ' +
      'the owner never read.',
    patterns: [
      phrases(
        'rm -rf', 'rm -fr', 'rm -r -f', 'del /f', 'del /s', 'rmdir /s',
        'git push --force', 'git push -f', 'git reset --hard', 'git clean -fd',
        'DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE', 'Format-Volume', 'format c:',
      ),
      // Both switches, in either order, anywhere on the line — PowerShell does not care
      // about the order and neither does the directory that stops existing.
      /\bRemove-Item\b(?=[^\n]*-Recurse\b)(?=[^\n]*-Force\b)[^\n]*/i,
    ],
  },
  {
    id: 'obfuscated-text',
    severity: 'high',
    raw: true,
    why:
      'Text written so that a person and a model read two different documents. A ' +
      'zero-width character wedged inside a word, one token spelled out of two ' +
      'alphabets, or letters walked apart a space at a time are not ways of writing ' +
      'English — they are ways of getting a phrase past a reader who is looking for it. ' +
      'Honest prose has no use for any of them, so the technique is the finding, ' +
      'whatever the hidden words turn out to say.',
    patterns: [
      // An invisible control wedged BETWEEN two letters — the shape of an evasion,
      // rather than a stray BOM or a soft hyphen sitting harmlessly at a line end.
      new RegExp('[\\p{L}\\p{N}][' + INVISIBLE_CLASS + ']+[\\p{L}\\p{N}]', 'u'),
      // One word, two alphabets. Four characters minimum so that `Δt` and `Ωm` — real
      // notation in an honest maths or physics skill — are not mistaken for an attack.
      new RegExp(
        '(?<![\\p{L}\\p{N}])' +
          '(?=[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}]*[a-z])' +
          '(?=[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}]*[\\p{Script=Cyrillic}\\p{Script=Greek}])' +
          '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}]{4,}' +
          '(?![\\p{L}\\p{N}])',
        'iu',
      ),
      // s p a c e d  o u t. Four letters, because `s u d o` is four and the rule has to
      // reach it. Measured, not guessed: across the forty-five skills installed on this
      // machine a run of even THREE spaced letters occurs zero times, so four sits a
      // whole letter clear of anything honest prose was observed to produce.
      /(?<![\p{L}\p{N}])(?:[\p{L}][ \t]){3,}[\p{L}](?![\p{L}\p{N}])/u,
      // A bidi OVERRIDE, anywhere at all, neighbours irrelevant. Its only function is to
      // make the screen render text in an order the file does not store it in, which is
      // not something a document does by accident. Deliberately narrower than
      // INVISIBLE_CLASS: the marks and isolates (U+200E/200F, U+2066-2069) are how
      // genuine Hebrew and Arabic prose is punctuated, and flagging a skill for being
      // written right-to-left would be the purest kind of crying wolf.
      /[\u202D\u202E]/u,
    ],
  },
];

/**
 * The rule the encoded-payload pass reports under. It has no patterns of its own —
 * it re-runs every rule above against decoded text — so it lives here rather than in
 * SCREEN_RULES, where a pattern-less entry would be a lie about how detection works.
 */
const ENCODED_PAYLOAD: Omit<ScreenRule, 'patterns'> = {
  id: 'encoded-payload',
  severity: 'high',
  why:
    'A base64 run in the prose decodes to text that trips one of the rules above. ' +
    'Reference material explains itself in the open; a sentence that had to be encoded ' +
    'to reach the model was encoded to get past whoever was reading. The quote is the ' +
    'DECODED text, which is why it will not be found in the file as written.',
};

/**
 * Fold one code point towards the plain-ASCII skeleton a model reads anyway.
 * Returns the replacement, which may be empty (the character is dropped) or longer
 * than one character (`ﬁ` is two letters); the offset map in `fold` is what makes
 * either safe.
 */
function foldChar(ch: string): string {
  if (INVISIBLE.test(ch)) return '';
  if (UNICODE_SPACE.test(ch)) return ' ';
  if (UNICODE_DASH.test(ch)) return '-';
  if (UNICODE_QUOTE.test(ch)) return "'";
  const known = CONFUSABLES.get(ch);
  if (known !== undefined) return known;
  // NFKC is what turns the fullwidth, small-capital, circled and mathematical
  // alphabets back into letters, for free and without a table to maintain.
  const compat = ch.normalize('NFKC');
  if (compat !== ch && /^[\x20-\x7E]+$/.test(compat)) return compat;
  // A letter wearing an accent it does not need: `ígnore` reads as `ignore`.
  const decomposed = ch.normalize('NFD');
  if (decomposed.length > 1 && /^[A-Za-z]$/.test(decomposed[0]!) && /^[\u0300-\u036F]+$/.test(decomposed.slice(1))) {
    return decomposed[0]!;
  }
  return ch;
}

/** A region as the rules see it, plus the way back to the characters the author typed. */
interface Folded {
  readonly text: string;
  /**
   * `offsets[i]` is the index in the original where folded character `i` came from,
   * with one extra entry at the end holding the original's length. A match at folded
   * `[at, at + len)` is therefore original `[offsets[at], offsets[at + len])` — which
   * is how a finding can be detected on the skeleton and quoted from the real thing.
   */
  readonly offsets: readonly number[];
}

function fold(text: string): Folded {
  let out = '';
  const offsets: number[] = [];
  let at = 0;
  for (const ch of text) {
    const mapped = foldChar(ch);
    for (let k = 0; k < mapped.length; k += 1) offsets.push(at);
    out += mapped;
    at += ch.length;
  }
  offsets.push(text.length);
  return { text: out, offsets };
}

/** Every invisible character, named, because evidence nobody can see is not evidence. */
const INVISIBLE_GLOBAL = new RegExp('[' + INVISIBLE_CLASS + ']', 'gu');

/**
 * One line of evidence: the invisibles spelled out by codepoint, then whitespace
 * collapsed so a match spanning a wrap still reads. Naming comes first because
 * JavaScript counts U+FEFF as whitespace and would otherwise collapse the proof away.
 */
function quoteOf(text: string): string {
  const visible = text.replace(
    INVISIBLE_GLOBAL,
    (ch) => '‹U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0') + '›',
  );
  const flat = visible.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_QUOTE_CHARS ? flat : flat.slice(0, MAX_QUOTE_CHARS) + '…';
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1 };

/**
 * Base64 runs long enough to carry a sentence. Shorter runs are hashes, ids and
 * checksums; decoding those produces noise, and noise that never matches a rule is
 * the reason this pass reports nothing unless the plaintext is itself damning.
 */
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;

/**
 * Does this decode look like a SENTENCE, or like the bytes of something else?
 *
 * The guard has to be strict, and the reason is a measured one. Most long base64-ish
 * runs in a real skill are not base64 at all — they are sha256 digests, cache keys,
 * minified fragments and asset ids — and they decode to eight-bit noise. Noise is not
 * harmless: a byte sequence that happens to land a soft hyphen between two accented
 * letters looks, to the obfuscation rule, exactly like a smuggled zero-width control.
 * That is not hypothetical. Re-screening decoded garbage produced precisely one
 * finding across the forty-five skills installed on this machine, and it was that — a
 * digest inside a migration guide, reported to the owner as hidden text. One wolf per
 * forty-five honest documents is the rate at which owners stop reading findings.
 *
 * So a payload must read as English before it is screened as English: printable ASCII
 * nearly throughout, with real words and the spaces between them. An author encoding a
 * sentence to smuggle it past the screen passes this trivially, which is the point —
 * the guard costs the attacker nothing and costs the noise everything.
 */
function looksLikeProse(plain: string): boolean {
  if (plain.length < 12) return false;
  const printable = plain.replace(/[^\x20-\x7E\n\t]/g, '');
  if (printable.length < plain.length * 0.95) return false;
  return /[A-Za-z]{3}/.test(plain) && / /.test(plain);
}

/** The base64 payloads in a region, decoded, keeping only what came out as prose. */
function decodedPayloads(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(BASE64_RUN)) {
    const body = match[0].replace(/=+$/, '');
    let plain: string;
    try {
      // atob wants a length that is a multiple of four; a run clipped out of a longer
      // token often is not, and the tail quartet is not worth a throw.
      plain = atob(body.slice(0, Math.floor(body.length / 4) * 4));
    } catch {
      continue; // not base64 after all
    }
    if (looksLikeProse(plain)) out.push(plain);
  }
  return out;
}

/** A region of a skill that reaches a prompt, in both the author's spelling and ours. */
interface Region {
  readonly raw: string;
  readonly folded: Folded;
}

/**
 * Screen one skill and report what its prose asks for.
 *
 * EVERY field that reaches a model is scanned, not just the body. The description is
 * the line injected into a prompt to decide whether the skill applies at all, so it
 * reaches a model even when the body never does — and `name` and `license` are
 * printed in the prompt header beside it, which makes an unscreened `license:` a
 * perfectly good place to hide a paragraph.
 */
export function screen(skill: Skill): ScreenResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (rule: Pick<ScreenRule, 'id' | 'severity' | 'why'>, quote: string): void => {
    const key = rule.id + ' ' + quote.toLowerCase();
    if (seen.has(key)) return; // the same phrase forty times is one fact
    seen.add(key);
    findings.push({ rule: rule.id, severity: rule.severity, quote, why: rule.why });
  };

  const sources = [skill.name, skill.description, skill.license ?? '', skill.body];
  const regions: Region[] = sources.map((raw) => ({ raw, folded: fold(raw) }));

  for (const rule of SCREEN_RULES) {
    for (const pattern of rule.patterns) {
      const scanner = new RegExp(pattern.source, pattern.flags + 'g');
      for (const region of regions) {
        const hay = rule.raw === true ? region.raw : region.folded.text;
        for (const match of hay.matchAll(scanner)) {
          const at = match.index ?? 0;
          const span =
            rule.raw === true
              ? region.raw.slice(at, at + match[0].length)
              : region.raw.slice(
                  region.folded.offsets[at] ?? 0,
                  region.folded.offsets[at + match[0].length] ?? region.raw.length,
                );
          add(rule, quoteOf(span));
        }
      }
    }
  }

  // Second pass: anything the prose encoded rather than said. Decoded text is screened
  // by the very same rules, so this can only fire on a payload that would have been a
  // finding had its author written it out.
  //
  // The `raw` rules sit this pass out. They hunt for the SPELLING of a thing — an
  // invisible character, a mixed-script word — and a decode has no spelling of its own:
  // whatever bytes came out did not come out of anybody's keyboard. Asking "was this
  // obfuscated?" of text that arrived inside an obfuscation answers itself, and the one
  // thing it reliably finds is byte noise.
  for (const region of regions) {
    for (const plain of decodedPayloads(region.raw)) {
      const folded = fold(plain).text;
      for (const rule of SCREEN_RULES) {
        if (rule.raw === true) continue;
        for (const pattern of rule.patterns) {
          const scanner = new RegExp(pattern.source, pattern.flags + 'g');
          for (const match of folded.matchAll(scanner)) add(ENCODED_PAYLOAD, quoteOf(match[0]));
        }
      }
    }
  }

  // Stable sort by severity: the owner reads top-down and should meet the worst first,
  // with each severity band still in the order the text itself presents it.
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { verdict: findings.length === 0 ? 'clean' : 'suspicious', findings };
}
