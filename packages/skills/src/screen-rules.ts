/**
 * The rule vocabulary `screen()` matches against: the severities, the finding
 * and rule shapes, the phrase-matching helper, the confusable/invisible
 * character classes those phrases are folded through, and the rule list
 * itself.
 *
 * Split out of `screen.ts` so the thing most likely to be read, reviewed or
 * extended on its own — "what counts as suspicious, and in what words" — sits
 * in a file with nothing else in it. The engine that runs these rules against
 * a skill's text (folding, quoting, the encoded-payload second pass) lives in
 * `text-normalize.ts` and `screen.ts`; see those for CALIBRATION and EVASION,
 * the two design principles that shaped every pattern below.
 */

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
export const INVISIBLE_CLASS = '\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF';
export const INVISIBLE = new RegExp('[' + INVISIBLE_CLASS + ']');
/** Every space a word processor, a CJK keyboard or an attacker might reach for. */
export const UNICODE_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;
/** Every dash that is not the hyphen-minus, including the ones YAML and Word insert. */
export const UNICODE_DASH = /[\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D]/;
/** Every apostrophe that is not the typewriter one. */
export const UNICODE_QUOTE = /[\u2018\u2019\u201B\u02BC\u2032\u00B4]/;

/**
 * Letters from other alphabets that render as Latin ones. Not the whole Unicode
 * confusables table — that is enormous and mostly theoretical — but the Cyrillic
 * and Greek letters an attacker actually reaches for, because they are the ones
 * that are pixel-identical in the fonts a SKILL.md is read in. Fullwidth forms,
 * small capitals and the mathematical alphabets are handled by NFKC below and do
 * not need listing here.
 */
export const CONFUSABLES: ReadonlyMap<string, string> = new Map(
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
export const ENCODED_PAYLOAD: Omit<ScreenRule, 'patterns'> = {
  id: 'encoded-payload',
  severity: 'high',
  why:
    'A base64 run in the prose decodes to text that trips one of the rules above. ' +
    'Reference material explains itself in the open; a sentence that had to be encoded ' +
    'to reach the model was encoded to get past whoever was reading. The quote is the ' +
    'DECODED text, which is why it will not be found in the file as written.',
};
