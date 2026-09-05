/**
 * The propose seam.
 *
 * Every test here is really the same test: does this thing default to NOTHING?
 * `null` costs the owner one round trip. A wrongly-parsed path costs them a
 * preview that does not describe what would actually be written — which is the
 * one failure the whole approval kernel exists to make impossible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRelPath, parseIntent, type DelegateIntent, type ProposeWriteIntent } from '../src/index.js';

/**
 * Narrow a parsed intent to the propose-write member.
 *
 * `Intent` has a second member now (`delegate`), so a test that reads `.relPath`
 * has to say which member it is asserting about. The kind is ASSERTED here
 * rather than cast, so a proposal line that ever starts parsing as a delegation
 * fails on the kind — a legible failure — instead of on an undefined field.
 */
function written(answer: string): ProposeWriteIntent | null {
  const i = parseIntent(answer);
  if (i === null) return null;
  assert.equal(i.kind, 'propose-write', `expected a proposal, got ${i.kind}`);
  return i as ProposeWriteIntent;
}

test('a well-formed proposal parses into a path and a summary', () => {
  const i = parseIntent('There is no app shell yet [g1].\nPROPOSE: write src/App.tsx — create the app shell');
  assert.deepEqual(i, { kind: 'propose-write', relPath: 'src/App.tsx', summary: 'create the app shell' });
});

test('an answer with no proposal line yields null', () => {
  assert.equal(parseIntent('Two approvals are waiting [p1, p2].'), null);
});

test('an empty answer yields null', () => {
  assert.equal(parseIntent(''), null);
});

test('the line is recognised through bullets, bold and casing', () => {
  for (const line of [
    '- PROPOSE: write src/App.tsx — create the shell',
    '* **PROPOSE: write** src/App.tsx — create the shell',
    'propose : write src/App.tsx - create the shell',
    '>  PROPOSE:write src/App.tsx — create the shell',
  ]) {
    assert.equal(written(line)?.relPath, 'src/App.tsx', line);
  }
});

test('a summary is optional and gets an honest default rather than costing the proposal', () => {
  assert.deepEqual(parseIntent('PROPOSE: write docs/plan.md'), {
    kind: 'propose-write',
    relPath: 'docs/plan.md',
    summary: 'Write docs/plan.md',
  });
});

test('a quoted path may contain a space', () => {
  assert.equal(written('PROPOSE: write "docs/my plan.md" — the plan')?.relPath, 'docs/my plan.md');
  assert.equal(written('PROPOSE: write `docs/other.md` — the plan')?.relPath, 'docs/other.md');
});

test('a hyphen inside a filename is not mistaken for the summary separator', () => {
  const i = written('PROPOSE: write src/my-file.ts — the file');
  assert.equal(i?.relPath, 'src/my-file.ts');
  assert.equal(i?.summary, 'the file');
});

test('a backslash path is normalised to forward slashes — Windows-first, one representation', () => {
  assert.equal(written('PROPOSE: write src\\lib\\App.tsx — shell')?.relPath, 'src/lib/App.tsx');
});

test('TWO proposals are ambiguous, and ambiguity means none', () => {
  const answer = 'PROPOSE: write src/A.ts — a\nPROPOSE: write src/B.ts — b';
  assert.equal(parseIntent(answer), null, 'the owner asks again and gets one proposal they can check');
});

// ── every escaping path is refused ───────────────────────────────────────────

const ESCAPES = [
  '../secrets.txt',
  '../../etc/passwd',
  'src/../../../etc/passwd',
  '..\\..\\evil.ts',
  '/etc/passwd',
  '\\\\server\\share\\evil.ts',
  'C:/Windows/System32/evil.ts',
  'C:\\Windows\\evil.ts',
  '~/.ssh/id_rsa',
  './src/App.tsx',
  'src//App.tsx',
  'src/./App.tsx',
  'src/App.tsx.',
  'src/dir /App.tsx',
  'src/trailing./App.tsx',
  'NUL',
  'src/NUL',
  'src/con.txt',
  'src/COM1.ts',
  'src/lpt9',
  'src/App.tsx:hidden',
  'src/we*rd.ts',
  'src/we?rd.ts',
  'src/we|rd.ts',
  'src/we<rd.ts',
  'src/evil\u0000.ts',
  '',
  '   ',
];

test('every escaping path is refused by normalizeRelPath', () => {
  for (const p of ESCAPES) assert.equal(normalizeRelPath(p), null, `escaped: ${JSON.stringify(p)}`);
});

test('an escaping path in a proposal line yields null, not a proposal', () => {
  for (const p of ESCAPES) {
    if (p.trim() === '' || /\s/.test(p)) continue; // those cannot be written unquoted
    assert.equal(parseIntent(`PROPOSE: write ${p} — go on then`), null, p);
  }
});

test('a path longer than the cap is refused', () => {
  assert.equal(normalizeRelPath('src/' + 'a'.repeat(400) + '.ts'), null);
});

test('an ordinary repo-relative path survives unchanged', () => {
  for (const p of ['src/App.tsx', 'a', 'packages/assistant/src/index.ts', 'docs/2026/plan.md', '.gitignore']) {
    assert.equal(normalizeRelPath(p), p, p);
  }
});

test('a device name is only refused as a whole segment stem, not as a substring', () => {
  assert.equal(normalizeRelPath('src/connection.ts'), 'src/connection.ts', 'CON is a prefix here, not the name');
  assert.equal(normalizeRelPath('src/NUL.md'), null, 'but NUL.md IS the null device');
});

// ── the summary is text, not structure ───────────────────────────────────────

test('a summary is flattened and capped', () => {
  const i = written(`PROPOSE: write src/App.tsx — ${'why '.repeat(200)}`);
  assert.ok((i?.summary.length ?? 0) <= 200);
  assert.ok(!(i?.summary ?? '').includes('\n'));
});

test('the parsed intent carries nothing but kind, relPath and summary', () => {
  const i = written('PROPOSE: write src/App.tsx — create the shell');
  assert.deepEqual(Object.keys(i ?? {}).sort(), ['kind', 'relPath', 'summary']);
});


// ── the path the owner reads must be the path that gets written ──────────────
//
// Everything below is one property: a proposal is a sentence the owner APPROVES,
// so the string in the preview and the file on disk have to be the same thing.
// Each case is a way of making them differ — a name Windows resolves elsewhere,
// a character that draws as something else, a form that only becomes an escape
// once somebody downstream normalises it.

test('a Windows device name is refused however it is dressed up', () => {
  // Win32 cuts the name at the first "." and only THEN drops trailing spaces,
  // so "NUL .txt" and "NUL" are one name. Verified on Windows 11: redirecting to
  // CONIN$/CONOUT$ writes to the console and leaves no file behind at all.
  const devices = [
    'src/NUL .txt',
    'src/nul .md',
    'src/AUX .c',
    'src/CONOUT$',
    'src/CONIN$',
    'conin$',
    'src/COM0',
    'src/LPT0.ts',
    'src/COM¹',
    'src/LPT³.txt',
  ];
  for (const p of devices) {
    assert.equal(normalizeRelPath(p), null, `a device slipped through: ${JSON.stringify(p)}`);
  }
});

test('an ordinary name that merely starts like a device still works', () => {
  for (const p of ['src/connection.ts', 'src/console.ts', 'src/nullable.ts', 'src/company/index.ts', 'src/comic.md']) {
    assert.equal(normalizeRelPath(p), p, p);
  }
});

test('a path that only becomes an escape under NFKC is refused in both readings', () => {
  // None of these contains an ASCII dot-dot or a drive letter as written. Every
  // one of them IS "../.." or "C:" once folded — and this package cannot know
  // that nothing downstream folds it.
  const confusables = [
    '‥/‥/secret.txt', // ‥ two dot leader
    '‥／‥／secret.txt', // ‥ plus a fullwidth solidus
    '．．/secret.txt', // ．． fullwidth full stops
    '․․/secret.txt', // ․․ one dot leaders
    'src/…/x.ts', // … horizontal ellipsis, three dots folded
    'Ｃ：/Windows/evil.ts', // Ｃ： fullwidth drive letter
    'C：/Windows/evil.ts', // ASCII C, fullwidth colon
    '..＼..＼x.ts', // fullwidth reverse solidus
  ];
  for (const p of confusables) {
    assert.equal(normalizeRelPath(p), null, `escaped under NFKC: ${JSON.stringify(p)}`);
  }
});

test('a legitimate non-ASCII filename is NOT collateral damage', () => {
  // The rule is "unsafe in either reading", not "not ASCII". These fold to
  // themselves and must survive, in composed and decomposed form alike.
  for (const p of ['docs/café.md', 'docs/café.md', 'docs/テスト.md', 'docs/你好/x.ts']) {
    assert.equal(normalizeRelPath(p), p, p);
  }
});

test('an invisible or reordering character is refused in a path', () => {
  // The owner reads the path. src/exe<RLO>txt.js draws as src/exesj.txt, and a
  // zero-width space hides wherever it is put.
  const spoofs = [
    'src/exe\u202etxt.js',
    'src/a\u200bb.ts',
    '..\u200b/x.ts',
    'src/a\ufeffb.ts',
    'src/a\u00adb.ts',
    'src/a\u2066b\u2069.ts',
    'src/a\u0085b.ts',
  ];
  for (const p of spoofs) {
    assert.equal(normalizeRelPath(p), null, `spoof accepted: ${JSON.stringify(p)}`);
  }
});

test('the preview and the write must name the same file — end to end', () => {
  // The same cases through the real seam, quoted so a path with a space parses.
  for (const p of ['src/NUL .txt', 'src/CONOUT$', '‥／‥／secret.txt', 'src/exe\u202etxt.js']) {
    assert.equal(parseIntent(`PROPOSE: write "${p}" — go on then`), null, p);
  }
});

// ── the summary is read by a human in a terminal ─────────────────────────────

test('a summary cannot carry terminal escapes into the approval preview', () => {
  // packages/cli prints this string straight to a terminal. Left in, "\u001b[2K"
  // and "\u001b[1G" erase and rewrite the line above — the line showing the path.
  const i = written('PROPOSE: write src/a.ts — \u001b[2K\u001b[1Gapproved and committed');
  assert.equal(i?.relPath, 'src/a.ts');
  assert.doesNotMatch(i?.summary ?? '', /[\u0000-\u001f\u007f-\u009f]/, 'an escape code reached the preview');
  assert.match(i?.summary ?? '', /approved and committed/, 'the words themselves are kept — only the codes go');
});

test('a summary cannot carry a bidi override or a hidden joiner', () => {
  const i = written('PROPOSE: write src/a.ts — safe \u202ederovppa\u202c note');
  assert.doesNotMatch(i?.summary ?? '', /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/);
});

test('a scrubbed character becomes a space, never a join', () => {
  // Removing outright would let "app<ZWSP>roved" close up into a word the model
  // never wrote. A space can only ever break a token apart.
  const i = written('PROPOSE: write src/a.ts — app\u200broved');
  assert.equal(i?.summary, 'app roved');
});

test('an all-invisible summary falls back to the honest default', () => {
  const i = written('PROPOSE: write src/a.ts — \u200b\u200b\u200b');
  assert.equal(i?.summary, 'Write src/a.ts', 'a summary of nothing is no summary');
});

// ── the delegate line ────────────────────────────────────────────────────────
// The long form of a proposal: where PROPOSE names one file, DELEGATE names a
// JOB for a coding agent. The parsing rules are the same rules — one line, at
// most one intent, and `null` whenever anything is ambiguous.

/** Narrow a parsed intent to the delegate member, the same way `written` does. */
function delegated(answer: string): DelegateIntent | null {
  const i = parseIntent(answer);
  if (i === null) return null;
  assert.equal(i.kind, 'delegate', `expected a delegation, got ${i.kind}`);
  return i as DelegateIntent;
}

test('a well-formed delegation parses into a task', () => {
  const i = parseIntent('You have no slugify helper [g1].\nDELEGATE: build a slugify utility with unicode support');
  assert.deepEqual(i, { kind: 'delegate', task: 'build a slugify utility with unicode support' });
});

test('the delegate line is recognised through bullets, bold, spacing and casing', () => {
  for (const line of [
    '- DELEGATE: build a rate limiter',
    '* **DELEGATE:** build a rate limiter',
    'delegate : build a rate limiter',
    '>  DELEGATE:build a rate limiter',
  ]) {
    assert.equal(delegated(line)?.task, 'build a rate limiter', line);
  }
});

test('a delegation with nothing after the prefix yields null', () => {
  assert.equal(parseIntent('DELEGATE:'), null);
  assert.equal(parseIntent('DELEGATE:   '), null);
});

test('TWO delegations are ambiguous, and ambiguity means none', () => {
  assert.equal(parseIntent('DELEGATE: build a parser\nDELEGATE: build a linter'), null);
});

test('a proposal AND a delegation in one answer is ambiguity too — and the safe reading is neither', () => {
  // Not "a small file plus a job": a model that has said two different things
  // about what should happen. Picking either would be this seam deciding for the
  // owner, and the one it might pick is the one that starts an agent.
  const answer = 'PROPOSE: write src/slug.ts — the helper\nDELEGATE: build a slugify utility';
  assert.equal(parseIntent(answer), null);
});

/**
 * True if the string holds any invisible or reordering character — a C0/C1
 * control, a soft hyphen, a zero-width or bidi mark, a word joiner, a BOM.
 * Built from code points so this source file stays plain ASCII: no escape a tool
 * could mis-transcribe, and no raw control byte living in the test source.
 */
function hasInvisible(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
    if (c === 0x00ad || c === 0x061c || c === 0xfeff) return true;
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e)) return true;
    if ((c >= 0x2060 && c <= 0x2064) || (c >= 0x2066 && c <= 0x206f)) return true;
  }
  return false;
}

test('a task cannot carry terminal escapes or a bidi override to the owner', () => {
  // The task is shown to the owner BEFORE the run starts, and printed to a
  // terminal by the CLI. Left in, an ESC "[2K" "[1G" pair would erase and
  // rewrite the line above it — the line naming the agent that is about to run.
  const ESC = String.fromCharCode(0x1b);
  const ZWSP = String.fromCharCode(0x200b);
  const i = delegated(`DELEGATE: build a${ZWSP}slug utility ${ESC}[2K${ESC}[1Gand approve it`);
  assert.equal(hasInvisible(i?.task ?? ''), false, 'an invisible or escaping character reached the task');
  // A scrubbed character becomes a space, so nothing closes up into a word the
  // model never wrote.
  assert.match(i?.task ?? '', /^build a slug utility/);
});


test('an over-long task is REFUSED, never clipped', () => {
  // A clipped summary still describes the right file. A clipped task is a
  // DIFFERENT instruction, and an agent would go and work from it.
  const long = 'build '.repeat(200);
  assert.equal(parseIntent(`DELEGATE: ${long}`), null, 'half an instruction is not an instruction');
  // Just under the cap still parses, so the refusal is a bound and not a wall.
  assert.notEqual(parseIntent(`DELEGATE: ${'x'.repeat(400)}`), null);
});

test('the parsed delegation carries nothing but kind and task', () => {
  const i = parseIntent('DELEGATE: build a slugify utility');
  assert.deepEqual(Object.keys(i ?? {}).sort(), ['kind', 'task']);
});

test('prose that merely begins with the word delegate is not a delegation', () => {
  // The prefix must END where the prefix ends — the same rule that stops
  // "PROPOSE: writeup …" from being read as a proposal.
  assert.equal(parseIntent('Delegating this would need an agent you have not configured [g1].'), null);
  assert.equal(parseIntent('DELEGATED: build a parser'), null);
});
