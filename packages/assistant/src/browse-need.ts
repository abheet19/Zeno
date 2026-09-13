/**
 * Does this question need something the local snapshot and a frozen local
 * model's weights cannot possibly have — the live web, or a tool only Forge's
 * governed browse/MCP bridge can reach?
 *
 * Deliberately narrow, the same discipline `isActionableRequest` uses in
 * `actionable-request.ts`: a fixed set of phrases that show up ONLY when the
 * owner is asking about something CURRENT or plainly EXTERNAL — "latest",
 * "today's", a stock price, a bare URL — never a guess at intent from the
 * sentence's general shape. Getting this wrong in the permissive direction
 * would swap a real answer for a Forge hand-off the owner did not ask for;
 * getting it wrong in the strict direction just means one more question falls
 * through to the general-knowledge reply, which is still an honest answer.
 *
 * This produces a yes/no, never an intent: the caller decides what to do with
 * it, exactly as `intent.ts` keeps `fallbackDelegation` separate from the
 * judgment calls in `actionable-request.ts`.
 *
 * Pure: a string in, a boolean out.
 */
// NOTE: "right now" and "currently" were deliberately left OUT even though
// they sound live — "what's pending right now" and "what is currently in the
// sandbox" are both ordinary LOCAL-state questions the grounded snapshot
// already answers, and are common phrasings for exactly that. A trigger this
// file cannot tell apart from its own grounded questions is a false positive
// waiting to swap a real, cited answer for a Forge hand-off nobody asked for.
const LIVE_SIGNS = new RegExp(
  '\\b(?:' +
    [
      'latest', "today'?s?", 'this week', 'breaking news',
      'up[- ]to[- ]date', 'price of', 'stock price', 'weather (?:in|today|tomorrow)',
      'news (?:about|on)', 'search the web', 'browse (?:to|the)', 'look up', 'google it',
    ].join('|') +
    ')\\b',
  'i',
);
const URL_RE = /\bhttps?:\/\/\S+/i;

/**
 * True only when the question names something current, or a URL, that no
 * local snapshot and no offline model could ever have an honest answer for.
 */
export function needsLiveLookup(question: string): boolean {
  const q = question.trim();
  if (q === '') return false;
  return LIVE_SIGNS.test(q) || URL_RE.test(q);
}
