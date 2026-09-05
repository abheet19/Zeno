/**
 * A Vault note: one fact, one file, human-readable forever.
 *
 * The whole anti-lock-in promise of the Vault is that with every Zeno process
 * stopped, the memory is still just Markdown files you can open in Notepad. So a
 * note is exactly that — YAML-ish frontmatter and a body — and this module is the
 * pure, dependency-free parse/serialize pair. No database, no proprietary format,
 * nothing that needs Zeno running to be read.
 */

export interface Note {
  /** Stable id; also the filename stem. */
  readonly id: string;
  readonly title: string;
  /** Free-text tags, lower-cased, deduped. */
  readonly tags: readonly string[];
  /** ISO-8601. When the fact was recorded. */
  readonly createdAt: string;
  /** ISO-8601. When it was last touched. */
  readonly updatedAt: string;
  /**
   * Where this fact came from, so recall can CITE it. A memory you cannot trace
   * to a source is a rumour, and the Vault does not deal in rumours.
   */
  readonly source: string;
  /** The fact itself, as Markdown. */
  readonly body: string;
}

const FM = '---';

function esc(v: string): string {
  // Only quote when needed, and never let a value break the frontmatter block.
  return /[:#\n"]/.test(v) ? JSON.stringify(v) : v;
}

function unesc(v: string): string {
  const t = v.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** Serialize a note to Markdown-with-frontmatter — the on-disk form. */
export function serializeNote(n: Note): string {
  const head = [
    FM,
    `id: ${esc(n.id)}`,
    `title: ${esc(n.title)}`,
    `tags: [${n.tags.map(esc).join(', ')}]`,
    `createdAt: ${n.createdAt}`,
    `updatedAt: ${n.updatedAt}`,
    `source: ${esc(n.source)}`,
    FM,
    '',
  ].join('\n');
  return head + n.body.replace(/\s+$/, '') + '\n';
}

/**
 * Parse a note. Tolerant: a file a human hand-edited (reordered keys, added a
 * blank line, saved with a BOM or CRLF) still reads. Returns null only when
 * there is no frontmatter block at all — that is not a note.
 */
export function parseNote(text: string, fallbackId: string): Note | null {
  const clean = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n/g, '\n');
  if (!clean.startsWith(FM + '\n')) return null;
  const end = clean.indexOf('\n' + FM, FM.length);
  if (end < 0) return null;

  const front = clean.slice(FM.length + 1, end);
  const body = clean.slice(end + 1 + FM.length + 1).replace(/^\n/, '');

  const fields: Record<string, string> = {};
  for (const line of front.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const rawTags = fields['tags'] ?? '';
  const tags = rawTags
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => unesc(t).toLowerCase())
    .filter((t) => t.length > 0);

  const now = fields['createdAt'] ?? '';
  return {
    id: unesc(fields['id'] ?? '') || fallbackId,
    title: unesc(fields['title'] ?? '') || '(untitled)',
    tags: [...new Set(tags)],
    createdAt: now,
    updatedAt: fields['updatedAt'] ?? now,
    source: unesc(fields['source'] ?? '') || 'unknown',
    body: body.replace(/\s+$/, ''),
  };
}
