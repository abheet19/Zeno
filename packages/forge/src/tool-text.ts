/**
 * The two string-shaping helpers every classifier in this package needs to
 * turn a raw tool input into the sentence an owner reads on a capsule.
 *
 * Neither was ever exported from `tools.ts`, so pulling them out here changes
 * nothing about the package's public surface — it only gives the browse and
 * chrome classifiers a shared place to import them from instead of each
 * re-implementing the same two lines.
 */

/** Pull one string field out of an unknown tool input, or '' when it is absent. */
export function field(input: unknown, name: string): string {
  if (typeof input !== 'object' || input === null) return '';
  const v = (input as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : '';
}

/** One line, bounded — a capsule summary is read, not scrolled. */
export function oneLine(text: string, cap = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > cap ? flat.slice(0, cap) + '…' : flat;
}
