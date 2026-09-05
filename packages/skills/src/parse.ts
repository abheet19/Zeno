/**
 * One SKILL.md in, one Skill out. Pure, total, and deliberately unimpressed.
 *
 * A skill is a folder someone else wrote, fetched by `npx skills add <owner/repo>`
 * from a public registry, and the installer itself warns that skills run with full
 * agent permissions. So this parser reads a SKILL.md the way a border officer reads
 * a document: TOLERANT about how the paper was typed, STRICT about what it must say.
 *
 * Tolerant, because the twenty skills already installed on this machine are all
 * CRLF, some quote their description, most fold it across a dozen lines with YAML's
 * `>` and one uses `|-`. Refusing those would be refusing reality.
 *
 * Strict, because a skill with no `name` or no `description` cannot be shown to the
 * owner as a named, described thing — and anything Zeno cannot NAME to the owner is
 * something the owner cannot meaningfully consent to. A file that fails comes back
 * with a reason a human can act on. It never throws: one malformed file in a library
 * of twenty must not take the other nineteen down with it (see loadLibrary).
 *
 * This is not a general YAML parser and must not become one. It reads exactly three
 * top-level keys out of the frontmatter block and treats everything else as prose.
 */

export interface Skill {
  /** The folder the skill was installed under — its address, not its claim. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Whatever `license` said, verbatim, or null when the file omits it. */
  readonly license: string | null;
  /** The markdown after the frontmatter — the part that reaches a model prompt. */
  readonly body: string;
  /**
   * Size of the WHOLE source document in UTF-8 bytes, BOM included. A fact about
   * the file on disk rather than about the parsed body: an owner deciding whether
   * to trust a skill wants to know how much of someone else's prose this is.
   */
  readonly bytes: number;
}

export type ParseResult =
  | { readonly ok: true; readonly skill: Skill }
  | { readonly ok: false; readonly reason: string };

/** A frontmatter delimiter: three or more dashes, trailing spaces forgiven. */
const DELIMITER = /^-{3,}[ \t]*$/;

/** `key: value` at some indentation. Group 1 the indent, 2 the key, 3 the rest. */
const KEY_LINE = /^([ \t]*)([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/;

/** A YAML block scalar header — `|` or `>`, with optional chomping and indent digits. */
const BLOCK_HEADER = /^([|>])[+-]?[0-9]*$/;

/**
 * Windows writes CRLF and some editors leave a BOM; neither is a defect in the
 * skill, so neither may change the parse. Normalising once here lets every rule
 * below assume plain `\n` and reason about column 0 honestly.
 */
function normalise(raw: string): string {
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return noBom.replace(/\r\n?/g, '\n');
}

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m === null ? 0 : m[0].length;
}

/**
 * The run of lines belonging to the key that opened at `parentIndent` — every blank
 * line, and every line indented FURTHER than that key — dedented by their own
 * minimum indent, plus the index of the first line that did not belong.
 *
 * Consuming this run is what stops a nested `name:` two levels down from being read
 * as the skill's name: a key only counts at the frontmatter's own indentation, and
 * everything beneath one is swallowed by the key that owns it.
 */
function readIndentedBlock(
  lines: readonly string[],
  start: number,
  parentIndent: number,
): { readonly text: readonly string[]; readonly next: number } {
  const taken: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() !== '' && indentOf(line) <= parentIndent) break;
    taken.push(line);
    i += 1;
  }
  while (taken.length > 0 && taken[taken.length - 1]!.trim() === '') taken.pop();
  // Folded by hand rather than `Math.min(...indents)`. Spreading an array into a call
  // pushes one V8 argument per element, and a frontmatter block of ~130k lines — which
  // a hostile skill can write and a generated one can reach by accident — overflows the
  // stack with a RangeError. That would escape parseSkill, which promises never to
  // throw, and take the whole library down with it. A loop has no such ceiling.
  let base = 0;
  let seen = false;
  for (const line of taken) {
    if (line.trim() === '') continue;
    const indent = indentOf(line);
    if (!seen || indent < base) base = indent;
    seen = true;
  }
  return { text: taken.map((l) => (l.trim() === '' ? '' : l.slice(base))), next: i };
}

/**
 * YAML's folded style: lines inside a paragraph join with a space, a blank line
 * starts a new one. The installed skills lean on this heavily — a folded description
 * that came back with hard newlines in it would be a different string from the one
 * the skill's author actually wrote.
 */
function fold(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      paragraphs.push(buf.join(' '));
      buf = [];
    } else {
      buf.push(line.trim());
    }
  }
  paragraphs.push(buf.join(' '));
  return paragraphs.join('\n').trim();
}

/**
 * Strip one layer of YAML quoting when — and only when — the value is quoted end to
 * end. A description that merely CONTAINS quotes ("how do I", "teach me") must
 * survive untouched, so a lone leading quote is left exactly where it was.
 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\/nrt])/g, (_all, ch: string) => {
      if (ch === 'n') return '\n';
      if (ch === 'r') return '\r';
      if (ch === 't') return '\t';
      return ch;
    });
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * The frontmatter, as a map of lowercased key to resolved value.
 *
 * The FIRST occurrence of a key wins. A second `name:` further down the block is not
 * a correction — it is a way to show one name to whoever skims the top of the file
 * and hand a different one to whatever parses it. Zeno takes what the reader takes.
 */
function readFrontmatter(lines: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const m = KEY_LINE.exec(line);
    if (m === null) continue; // a stray line is stepped over, never fatal
    const indent = m[1]!.length;
    const key = m[2]!.toLowerCase();
    const inline = m[3]!;

    const header = BLOCK_HEADER.exec(inline.trim());
    const block = readIndentedBlock(lines, i, indent);
    i = block.next;
    const value =
      header === null
        ? fold([inline, ...block.text])
        : header[1] === '|'
          ? block.text.join('\n').trim()
          : fold(block.text);
    if (!out.has(key)) out.set(key, unquote(value.trim()).trim());
  }
  return out;
}

/**
 * Parse one SKILL.md. `id` is the folder the file was found in, supplied by the
 * caller so this stays a pure string function with no idea what a filesystem is.
 */
export function parseSkill(raw: string, id: string): ParseResult {
  const text = normalise(raw);
  const bytes = new TextEncoder().encode(raw).length;
  const lines = text.split('\n');

  let open = 0;
  while (open < lines.length && lines[open]!.trim() === '') open += 1;
  if (open >= lines.length || !DELIMITER.test(lines[open]!)) {
    return {
      ok: false,
      reason:
        "no frontmatter: a SKILL.md must open with a '---' line followed by name and description.",
    };
  }

  let close = open + 1;
  while (close < lines.length && !DELIMITER.test(lines[close]!)) close += 1;
  if (close >= lines.length) {
    return {
      ok: false,
      reason: `frontmatter opened on line ${open + 1} and was never closed: add a '---' line after the keys.`,
    };
  }

  const front = readFrontmatter(lines.slice(open + 1, close));
  const required = [
    ['name', front.get('name') ?? ''],
    ['description', front.get('description') ?? ''],
  ] as const;
  for (const [key, value] of required) {
    if (value === '') {
      return {
        ok: false,
        reason: front.has(key)
          ? `frontmatter key '${key}' is present but empty: give it a value, or the skill cannot be shown to the owner by name.`
          : `frontmatter is missing required key '${key}': add '${key}: …' between the '---' lines.`,
      };
    }
  }

  const license = front.get('license') ?? '';
  return {
    ok: true,
    skill: {
      id,
      name: required[0][1],
      description: required[1][1],
      license: license === '' ? null : license,
      body: lines.slice(close + 1).join('\n').trim(),
      bytes,
    },
  };
}
