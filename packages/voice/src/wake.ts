/**
 * Wake-phrase detection over a transcript. Pure — no audio, no clock, no I/O.
 *
 * The wake word is the whole gate between "the owner said something to Zeno" and
 * "someone in the room happened to say the word Zeno". Two failure modes matter,
 * and they pull in opposite directions:
 *
 *   - a MISSED wake is a command silently dropped (annoying, but safe); and
 *   - a FALSE wake is a sentence the owner never addressed to Zeno being handed
 *     to the grammar as if it were a command.
 *
 * A false wake can only ever produce a PROPOSAL — nothing here, and nothing the
 * grammar returns, can commit an effect — so a stray trigger is bounded by the
 * approval gate downstream. But it is still noise the owner has to dismiss, so
 * the rule is deliberately strict: the wake word must be the FIRST content word
 * of the utterance. Everything before it must be droppable filler ("hey zeno")
 * or nothing at all. A sentence that merely MENTIONS zeno in the middle ("I like
 * zeno", "tell zeno I said hi") is not a wake, because the first content word is
 * something else.
 *
 * Speech-to-text mangles the wake word constantly — "zeeno", "zee no", "xeno" —
 * so matching is done on a letters-only, lower-cased normal form, and a two-word
 * split ("zee no") is recognised as one wake.
 */

/** The result of a successful wake: the command with wake + filler stripped. */
export interface Wake {
  /** The utterance after the wake phrase, e.g. "add a card component". */
  readonly command: string;
}

/**
 * Single-token forms of the wake word we accept. These are the letters-only
 * normal form (see `normalize`), so "Zeno," "ZEENO" and "zee-no" all collapse
 * into one of these before the check. Kept tight on purpose: every extra entry
 * is another everyday word that could false-trigger.
 */
// `znote` and `cnote` are measured local-Whisper outputs for the spoken name
// "Zeno". They are accepted only as the first content token, preserving the
// no-mid-sentence-wake rule while avoiding a dropped command when either
// acoustic split wins.
const WAKE_SINGLE: ReadonlySet<string> = new Set(['zeno', 'zeeno', 'zeenoth', 'xeno', 'zino', 'zenno', 'znote', 'cnote']);

/**
 * The first half of a two-token mis-hearing ("zee no", "zee know"). "zee" on its
 * own is not a wake — it must be followed by one of `WAKE_PAIR_TAIL`.
 */
const WAKE_PAIR_HEAD: ReadonlySet<string> = new Set(['zee', 'ze']);
const WAKE_PAIR_TAIL: ReadonlySet<string> = new Set(['no', 'know', 'noh']);

/** The optional second word of the wake phrase itself: "zeno attend". */
const WAKE_TAIL = 'attend';

/**
 * Discourse filler that may appear BEFORE the wake word ("hey zeno …") or
 * between the wake word and the command ("zeno, please add …"). Only stripped
 * when it is leading — the same word in the middle of a command is left alone,
 * so "remind me to please call Bob" keeps its "please".
 */
const FILLER: ReadonlySet<string> = new Set([
  'hey', 'hi', 'hello', 'yo', 'ok', 'okay', 'um', 'umm', 'uhm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'so', 'well', 'please',
]);

interface Token {
  /** Letters-only, lower-cased form used for matching. */
  readonly norm: string;
  /** Offset of the token's first character in the ORIGINAL string. */
  readonly start: number;
}

/** Letters-only, lower-cased. Drops punctuation, digits and casing so a mangled
 * "Zee-No!" and a clean "zeno" compare equal. */
function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, '');
}

/** Split on whitespace, remembering each token's original start offset so the
 * command can be sliced back out of the untouched source (keeping its case and
 * internal punctuation). */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index;
    if (start === undefined) continue;
    tokens.push({ norm: normalize(m[0]), start });
  }
  return tokens;
}

/**
 * Detect the wake phrase and return the command that follows it, or null.
 *
 * null means "not addressed to Zeno" — an empty transcript, a sentence that only
 * mentions zeno in passing, or one whose first content word is not the wake
 * word. A non-null result may still carry an EMPTY command (a bare "zeno"); that
 * is a real wake with nothing after it, and the session layer decides what to do
 * with it rather than this function guessing.
 */
export function detectWake(text: string): Wake | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  // Walk from the start. Skip leading filler; the first non-filler token MUST be
  // the wake word or this is not a wake at all.
  let i = 0;
  let wakeEnd = -1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === undefined) break;
    if (WAKE_SINGLE.has(t.norm)) {
      wakeEnd = i + 1;
      break;
    }
    const next = tokens[i + 1];
    if (next !== undefined && WAKE_PAIR_HEAD.has(t.norm) && WAKE_PAIR_TAIL.has(next.norm)) {
      wakeEnd = i + 2;
      break;
    }
    if (FILLER.has(t.norm)) {
      i += 1;
      continue;
    }
    // A content word before any wake word: the owner is not talking to Zeno.
    return null;
  }
  if (wakeEnd < 0) return null;

  // Consume the optional "attend", then any filler, so the command starts at the
  // first real word the owner meant.
  let j = wakeEnd;
  const afterWake = tokens[j];
  if (afterWake !== undefined && afterWake.norm === WAKE_TAIL) j += 1;
  // Where the command would start if NOTHING were stripped. Kept because the
  // filler skip below is only ever meant to move PAST filler to a real word — it
  // must not be allowed to consume the whole utterance.
  const unstripped = j;
  while (j < tokens.length) {
    const t = tokens[j];
    if (t === undefined) break;
    if (!FILLER.has(t.norm)) break;
    j += 1;
  }
  // Filler ate everything after the wake word. That is NOT "a wake with no
  // command": the owner did say something, and some of the words in FILLER are
  // also bare assents ("ok", "okay") — i.e. an attempt to approve out loud. If
  // we returned an empty command here, "zeno, ok" would be reported as silence
  // and the grammar would never see the word, so it could never answer with the
  // approval-by-hand refusal — and, worse, the two modes would answer
  // differently, because in wake mode "ok" spoken as a SECOND utterance is not
  // adjacent to a wake word and so does reach the grammar. Hand the words back
  // instead and let the one grammar judge them.
  if (j >= tokens.length && unstripped < tokens.length) j = unstripped;

  const head = tokens[j];
  if (head === undefined) return { command: '' };
  // Slice from the untouched source so the command keeps its original casing and
  // internal punctuation, then shave any leading punctuation the wake comma left.
  const command = text.slice(head.start).replace(/^[\s,;:.!?–—-]+/, '').trim();
  return { command };
}
