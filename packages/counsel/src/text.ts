/**
 * Small, dependency-free text utilities shared by Counsel's extractors.
 *
 * Nothing here reaches a network, a model or a dictionary. Counsel must be
 * deterministic — the same transcript in produces the same summary out — and
 * honest about being a pattern matcher, not an oracle. These helpers are the
 * pattern-matching floor everything else stands on.
 */

const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'of', 'to', 'in', 'on',
  'for', 'with', 'at', 'by', 'from', 'up', 'out', 'as', 'is', 'are', 'am', 'was',
  'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
  'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'there', 'here',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'not',
  'no', 'yes', 'ok', 'okay', 'just', 'about', 'into', 'over', 'than', 'too', 'very',
  'also', 'well', 'get', 'got', 'going', 'gonna', 'let', 'lets', 'one', 'all', 'any',
  'some', 'more', 'most', 'much', 'like', 'now', 'right',
]);

/** Lowercase and fold curly apostrophes, so cue phrases match typed and dictated text alike. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’ʼ`]/g, "'");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive matcher for a set of literal phrases, adding word
 * boundaries only at alphanumeric edges so `agreed` does not fire inside
 * `disagreed`. The returned RegExp carries no `g` flag, so `.test()` is stateless.
 */
export function phraseMatcher(needles: readonly string[]): RegExp {
  const parts = needles.map((n) => {
    const p = escapeRegExp(n);
    const left = /^[\w']/.test(n) ? '\\b' : '';
    const right = /[\w']$/.test(n) ? '\\b' : '';
    return left + p + right;
  });
  return new RegExp('(?:' + parts.join('|') + ')', 'i');
}

/** Split text into sentences, keeping terminal punctuation. Empty in, empty out. */
export function sentencesOf(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The first sentence of a line, or the whole trimmed line if it has no terminator. */
export function firstSentence(text: string): string {
  const parts = sentencesOf(text);
  return parts.length > 0 ? parts[0]! : text.trim();
}

/** Content keywords: lowercased word-ish tokens, minus stopwords and very short tokens. */
export function keywords(text: string): string[] {
  const raw = norm(text).match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  return raw.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
