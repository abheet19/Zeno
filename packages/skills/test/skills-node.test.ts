/**
 * The fs adapter, against a real temporary library — and then against the twenty
 * skills actually installed on this machine.
 *
 * The real-library test is the one that matters. Everything else here is a fixture
 * this package wrote for itself; `.agents/skills` is twenty folders written by other
 * people, in CRLF, with folded YAML, quoted descriptions and one `|-` block. If the
 * parser only ever meets its own fixtures it is not a parser, it is a mirror. The
 * test skips cleanly when the directory is absent, because a machine with no skills
 * installed is a legitimate machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadLibrary, nodeSkillReader, SKILL_FILE } from '../src/index.js';

/** The library `npx skills add` writes into, four levels up from dist/test. */
const INSTALLED = fileURLToPath(new URL('../../../../.agents/skills', import.meta.url));

function tempLibrary(skills: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-skills-'));
  for (const [id, contents] of Object.entries(skills)) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, SKILL_FILE), contents, 'utf8');
  }
  return dir;
}

test('a missing directory is an empty library, not a crash', () => {
  const reader = nodeSkillReader(join(tmpdir(), 'zeno-skills-does-not-exist-4f2a'));
  assert.deepEqual(reader.list(), []);
  assert.deepEqual(loadLibrary(reader), { skills: [], failed: [] });
});

test('a path that is a file, not a directory, is also an empty library', () => {
  const dir = tempLibrary({ tidy: '---\nname: tidy\ndescription: d\n---\nBody.\n' });
  try {
    assert.deepEqual(nodeSkillReader(join(dir, 'tidy', SKILL_FILE)).list(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('it lists the folders that have a SKILL.md, sorted, and ignores the ones that do not', () => {
  const dir = tempLibrary({
    beta: '---\nname: beta\ndescription: Beta things.\n---\nBody.\n',
    alpha: '---\r\nname: alpha\r\ndescription: >\r\n  Alpha things,\r\n  folded.\r\n---\r\nBody.\r\n',
  });
  mkdirSync(join(dir, 'not-a-skill'), { recursive: true });
  try {
    const reader = nodeSkillReader(dir);
    assert.deepEqual(reader.list(), ['alpha', 'beta']);
    const library = loadLibrary(reader);
    assert.deepEqual(library.skills.map((s) => s.name), ['alpha', 'beta']);
    assert.equal(library.skills[0]?.description, 'Alpha things, folded.');
    assert.deepEqual(library.failed, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an id that is a path, not a folder name, is refused before it reads anything', () => {
  const dir = tempLibrary({ tidy: '---\nname: tidy\ndescription: d\n---\nBody.\n' });
  try {
    const reader = nodeSkillReader(dir);
    for (const id of ['../secrets', '..', '.', '', 'a/b', 'C:\\Windows']) {
      assert.throws(() => reader.read(id), /unsafe skill id/, `should have refused ${JSON.stringify(id)}`);
    }
    assert.equal(loadLibrary({ list: () => ['../secrets'], read: reader.read }).failed[0]?.reason.includes('unsafe skill id'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a SKILL.md that cannot be read fails that skill alone', () => {
  const dir = tempLibrary({ good: '---\nname: good\ndescription: d\n---\nBody.\n' });
  try {
    const reader = nodeSkillReader(dir);
    const library = loadLibrary({ list: () => [...reader.list(), 'ghost'], read: reader.read });
    assert.deepEqual(library.skills.map((s) => s.id), ['good']);
    assert.equal(library.failed[0]?.id, 'ghost');
    assert.match(library.failed[0]?.reason ?? '', /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a SKILL.md that is a directory is one named failure, not a crash', () => {
  // `existsSync` says yes to a directory called SKILL.md, so the guard that keeps this
  // folder out of the listing cannot be an existence check. The read is what fails, and
  // it must fail the way every other unreadable file does: one entry, with a reason.
  const dir = tempLibrary({ good: '---\nname: good\ndescription: d\n---\nBody.\n' });
  try {
    mkdirSync(join(dir, 'trap', SKILL_FILE), { recursive: true });
    const reader = nodeSkillReader(dir);
    assert.deepEqual(reader.list(), ['good', 'trap'], 'it looks like a skill from outside');
    const library = loadLibrary(reader);
    assert.deepEqual(library.skills.map((s) => s.id), ['good'], 'the healthy skill is untouched');
    assert.deepEqual(library.failed.map((f) => f.id), ['trap']);
    assert.match(library.failed[0]?.reason ?? '', /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty and a frontmatter-only SKILL.md are told apart, and neither is a crash', () => {
  const dir = tempLibrary({
    good: '---\nname: good\ndescription: d\n---\nBody.\n',
    hollow: '',
    header: '---\nname: header\ndescription: All header, no manual.\n---\n',
  });
  try {
    const library = loadLibrary(nodeSkillReader(dir));
    assert.deepEqual(library.skills.map((s) => s.id), ['good', 'header'], 'a header-only skill is still a skill');
    assert.equal(library.skills.find((s) => s.id === 'header')?.body, '');
    assert.deepEqual(library.failed.map((f) => f.id), ['hollow']);
    assert.match(library.failed[0]?.reason ?? '', /no frontmatter/i);
    assert.notDeepEqual(library, { skills: [], failed: [] }, 'a library with a broken file is not an empty library');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing directory and a directory of nothing but broken files are different answers', () => {
  const absent = loadLibrary(nodeSkillReader(join(tmpdir(), 'zeno-skills-does-not-exist-9c31')));
  const dir = tempLibrary({ broken: 'no frontmatter at all\n' });
  try {
    const broken = loadLibrary(nodeSkillReader(dir));
    assert.deepEqual(absent, { skills: [], failed: [] }, 'nothing installed reads as nothing installed');
    assert.deepEqual(broken.skills, []);
    assert.equal(broken.failed.length, 1, 'a broken install is not an empty one');
    assert.notDeepEqual(broken, absent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'the real installed library parses — every skill, no failures',
  { skip: existsSync(INSTALLED) ? false : `no skills installed at ${INSTALLED}` },
  () => {
    const library = loadLibrary(nodeSkillReader(INSTALLED));
    assert.deepEqual(library.failed, [], 'a real SKILL.md that will not parse is a parser bug, not a data bug');
    assert.ok(library.skills.length > 0, 'the directory exists, so it should hold skills');
    for (const skill of library.skills) {
      assert.ok(skill.name.length > 0, `${skill.id} has no name`);
      assert.ok(skill.description.length > 0, `${skill.id} has no description`);
      assert.ok(skill.body.length > 0, `${skill.id} has an empty body`);
      assert.ok(skill.bytes > 0);
      assert.doesNotMatch(skill.description, /^["'|>]/, `${skill.id}: YAML plumbing leaked into the description`);
      assert.doesNotMatch(skill.body, /\r/, `${skill.id}: a carriage return survived into the body`);
      assert.doesNotMatch(skill.description, /\r/, `${skill.id}: a carriage return survived into the description`);
      assert.doesNotMatch(skill.description, /\n[ \t]/, `${skill.id}: a block's own indentation leaked into the description`);
      assert.equal(skill.description.trim(), skill.description, `${skill.id}: the description was not trimmed`);
      assert.doesNotMatch(skill.body, /^---/, `${skill.id}: the frontmatter delimiter leaked into the body`);
      assert.ok(skill.bytes > skill.body.length, `${skill.id}: the body cannot be larger than the file it came from`);
      assert.equal(skill.license?.trim() ?? null, skill.license, `${skill.id}: the licence was not trimmed`);
    }
    // Both YAML styles the real library actually uses, pinned against the real files:
    // `claude-api` writes its description as a `|-` literal and needs its line breaks,
    // `academy-guide` writes one as `>` and must come back as a single folded run. A
    // parser that confused the two would read plausibly and still be wrong.
    const literal = library.skills.find((s) => s.id === 'claude-api');
    if (literal !== undefined) {
      assert.match(literal.description, /migration\.\nTRIGGER/, 'a literal block must keep its line breaks');
    }
    const folded = library.skills.find((s) => s.id === 'academy-guide');
    if (folded !== undefined) {
      assert.doesNotMatch(folded.description, /\n/, 'a folded block must come back as one run');
      assert.match(folded.description, /reply to a question about how to use Claude/, 'a folded block joins its lines with a space');
    }
  },
);
