/**
 * The parser is tolerant about typing and strict about meaning. These tests pin
 * both halves — every shape the twenty installed skills actually use must parse,
 * and every way a file can fail must come back as an actionable sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill, type Skill } from '../src/index.js';

function ok(raw: string, id = 'sample'): Skill {
  const result = parseSkill(raw, id);
  assert.equal(result.ok, true, result.ok ? '' : `expected a parse, got: ${result.reason}`);
  assert.ok(result.ok);
  return result.skill;
}

function failure(raw: string, id = 'sample'): string {
  const result = parseSkill(raw, id);
  assert.equal(result.ok, false, 'expected this file to be refused');
  assert.ok(!result.ok);
  return result.reason;
}

test('a plain LF skill parses into id, name, description, licence and body', () => {
  const skill = ok('---\nname: tidy\ndescription: Tidies things.\nlicense: MIT\n---\n\n# Tidy\n\nBody text.\n', 'tidy');
  assert.equal(skill.id, 'tidy');
  assert.equal(skill.name, 'tidy');
  assert.equal(skill.description, 'Tidies things.');
  assert.equal(skill.license, 'MIT');
  assert.equal(skill.body, '# Tidy\n\nBody text.');
});

test('CRLF parses identically to LF — every skill on this machine is CRLF', () => {
  const lf = ok('---\nname: tidy\ndescription: Tidies things.\n---\n\nBody.\n');
  const crlf = ok('---\r\nname: tidy\r\ndescription: Tidies things.\r\n---\r\n\r\nBody.\r\n');
  assert.deepEqual({ ...crlf, bytes: 0 }, { ...lf, bytes: 0 });
  assert.equal(crlf.body, 'Body.', 'no stray carriage return survives into the body');
});

test('a UTF-8 BOM is not a parse error', () => {
  const skill = ok('\uFEFF---\nname: tidy\ndescription: Tidies things.\n---\n\nBody.\n');
  assert.equal(skill.name, 'tidy');
});

test('trailing spaces on delimiters and values are forgiven', () => {
  const skill = ok('---   \nname: tidy   \ndescription: Tidies things.  \n----  \n\nBody.\n');
  assert.equal(skill.name, 'tidy');
  assert.equal(skill.description, 'Tidies things.');
});

test('blank lines before the opening delimiter are forgiven', () => {
  assert.equal(ok('\n\n---\nname: tidy\ndescription: d\n---\nBody.\n').name, 'tidy');
});

test('a quoted description loses only the outer quotes', () => {
  const skill = ok('---\nname: docs\ndescription: "Use when the user says \'write a doc\'."\n---\nBody.\n');
  assert.equal(skill.description, "Use when the user says 'write a doc'.");
});

test("a single-quoted value is unwrapped, YAML's doubled apostrophe and all", () => {
  const skill = ok("---\nname: docs\ndescription: 'Use when the user''s table is ragged.'\n---\nBody.\n");
  assert.equal(skill.description, "Use when the user's table is ragged.");
});

test('escape sequences inside a double-quoted value are resolved', () => {
  const skill = ok('---\nname: docs\ndescription: "Line one.\\nLine \\"two\\", with a C:\\\\path."\n---\nBody.\n');
  assert.equal(skill.description, 'Line one.\nLine "two", with a C:\\path.');
});

test("a description that merely contains a quote keeps it", () => {
  const skill = ok('---\nname: docs\ndescription: Trigger on "how do I" and similar.\n---\nBody.\n');
  assert.equal(skill.description, 'Trigger on "how do I" and similar.');
});

test("YAML's folded style joins lines with spaces", () => {
  const raw = '---\r\nname: academy\r\ndescription: >\r\n  Stop and check this skill before\r\n  finishing any reply.\r\nlicense: Complete terms in LICENSE.txt\r\n---\r\n\r\nBody.\r\n';
  const skill = ok(raw);
  assert.equal(skill.description, 'Stop and check this skill before finishing any reply.');
  assert.equal(skill.license, 'Complete terms in LICENSE.txt');
});

test("YAML's literal style keeps the line breaks", () => {
  const skill = ok('---\nname: api\ndescription: |-\n  Reference for the API.\n  TRIGGER — read this first.\n---\nBody.\n');
  assert.equal(skill.description, 'Reference for the API.\nTRIGGER — read this first.');
});

test('a plain value continued on an indented line is folded in', () => {
  const skill = ok('---\nname: api\ndescription: Reference for the API,\n  continued here.\n---\nBody.\n');
  assert.equal(skill.description, 'Reference for the API, continued here.');
});

test('an omitted licence is null, not an empty string', () => {
  assert.equal(ok('---\nname: tidy\ndescription: d\n---\nBody.\n').license, null);
});

test('comments and stray lines inside the frontmatter are stepped over', () => {
  const skill = ok('---\n# installed by hand\nname: tidy\nthis line is not a key\ndescription: d\n---\nBody.\n');
  assert.equal(skill.name, 'tidy');
  assert.equal(skill.description, 'd');
});

test('the FIRST occurrence of a key wins — a later one is a second face, not a correction', () => {
  const skill = ok('---\nname: harmless-formatter\ndescription: Formats things.\nname: root-shell\n---\nBody.\n');
  assert.equal(skill.name, 'harmless-formatter', 'the name a human skimming the top would read');
});

test('a nested key is not mistaken for a top-level one', () => {
  const skill = ok('---\nname: outer\nmetadata:\n  name: inner\n  description: smuggled\ndescription: the real one\n---\nBody.\n');
  assert.equal(skill.name, 'outer');
  assert.equal(skill.description, 'the real one');
});

test('bytes is the size of the whole source document in UTF-8', () => {
  const raw = '---\nname: t\ndescription: d — em dash\n---\nBody.\n';
  assert.equal(ok(raw).bytes, Buffer.byteLength(raw, 'utf8'));
  assert.ok(ok(raw).bytes > raw.length, 'the em dash costs more than one byte');
});

test('a file with no frontmatter is refused with a reason naming the fix', () => {
  const reason = failure('# Just a readme\n\nNo frontmatter here.\n');
  assert.match(reason, /no frontmatter/i);
  assert.match(reason, /---/);
});

test('an unterminated frontmatter block is refused and says where it opened', () => {
  const reason = failure('---\nname: tidy\ndescription: d\n\nBody with no closing delimiter.\n');
  assert.match(reason, /never closed/i);
  assert.match(reason, /line 1/);
});

test('a missing required key is refused by name', () => {
  assert.match(failure('---\nname: tidy\n---\nBody.\n'), /missing required key 'description'/);
  assert.match(failure('---\ndescription: d\n---\nBody.\n'), /missing required key 'name'/);
});

test('a required key present but empty is refused differently from a missing one', () => {
  const reason = failure('---\nname:\ndescription: d\n---\nBody.\n');
  assert.match(reason, /'name' is present but empty/);
});

test('garbage never throws — it comes back as a refusal', () => {
  for (const raw of ['', '---', '\uFEFF', '---\n---\n', '::::', '\n\n\n']) {
    const result = parseSkill(raw, 'junk');
    assert.equal(result.ok, false);
  }
});

test('an empty file and a whitespace-only file are refused, not crashed through', () => {
  for (const raw of ['', '\n', '   \n\n\t\n', '﻿\r\n']) {
    const reason = failure(raw);
    assert.match(reason, /no frontmatter/i, `an empty document must say what is missing, got: ${reason}`);
  }
});

test('a frontmatter-only file parses with an empty body rather than failing', () => {
  // A skill that is all header and no prose is not malformed — it is a skill that
  // teaches nothing yet. It still has a name and a description, which is everything
  // the owner needs to see it in the list and decide about it, so refusing it would
  // hide a real installed folder behind a parse error that named the wrong problem.
  for (const raw of ['---\nname: t\ndescription: d\n---\n', '---\nname: t\ndescription: d\n---', '---\nname: t\ndescription: d\n---\n\n \n']) {
    const skill = ok(raw);
    assert.equal(skill.body, '');
    assert.equal(skill.name, 't');
    assert.ok(skill.bytes > 0, 'an empty body is not an empty file');
  }
});

test('a 10MB body is parsed whole and reported at its true size', () => {
  const body = 'ordinary prose about ordinary things\n'.repeat(280_000);
  const raw = `---\nname: huge\ndescription: A very long manual.\n---\n${body}`;
  assert.ok(Buffer.byteLength(raw, 'utf8') > 10_000_000, 'the fixture must actually be over 10MB');
  const skill = ok(raw, 'huge');
  assert.equal(skill.body, body.trim());
  assert.equal(skill.bytes, Buffer.byteLength(raw, 'utf8'));
});

test('a frontmatter block of 200,000 lines is parsed, not a stack overflow', () => {
  // Regression. The dedent used to take its base indent from `Math.min(...indents)`,
  // and spreading an array of that size into a call overflows V8's argument stack with
  // a RangeError — which escaped parseSkill, whose entire contract is that it does not
  // throw, and escaped loadLibrary with it. One hostile file, no library.
  const raw = `---\nname: wide\ndescription: >\n${'  filler line\n'.repeat(200_000)}---\nBody.\n`;
  const skill = ok(raw, 'wide');
  assert.equal(skill.name, 'wide');
  assert.match(skill.description, /^filler line filler line/, 'the folded block still folds');
  assert.equal(skill.body, 'Body.');
});
