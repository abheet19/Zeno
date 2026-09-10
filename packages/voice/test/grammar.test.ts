/**
 * The grammar: every intent parsed from the way a person actually speaks, plus
 * the failure modes that must degrade to a legible `Unrecognized` rather than a
 * wrong action. The safety refusal has its own file (safety.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand,
  deriveRelPath,
  APPROVAL_BY_HAND,
  DELEGATE_NEEDS_A_TASK,
  NOT_A_COMMAND,
  NO_SAFE_NAME,
  type Intent,
} from '../src/index.js';

/** Narrow helper: assert an intent kind and return it typed. */
function expectKind<K extends Intent['kind']>(intent: Intent, kind: K): Extract<Intent, { kind: K }> {
  assert.equal(intent.kind, kind);
  return intent as Extract<Intent, { kind: K }>;
}

test('propose_write — "add a card component" derives a safe component path', () => {
  const i = expectKind(parseCommand('add a card component'), 'propose_write');
  assert.equal(i.relPath, 'src/components/Card.tsx');
  assert.equal(i.summary, 'add a card component');
  assert.equal(i.hint, '');
});

test('propose_write — a multi-word name PascalCases, and "that ..." becomes the hint', () => {
  const i = expectKind(
    parseCommand('create a user profile component that shows the avatar and name'),
    'propose_write',
  );
  assert.equal(i.relPath, 'src/components/UserProfile.tsx');
  assert.equal(i.hint, 'shows the avatar and name');
  assert.equal(i.summary, 'create a user profile component that shows the avatar and name');
});

test('propose_write — a "file" lands in src with a kebab name', () => {
  const i = expectKind(parseCommand('write a rate limiter file'), 'propose_write');
  assert.equal(i.relPath, 'src/rate-limiter.ts');
});

test('propose_write — the "called/named" phrasing is understood', () => {
  const i = expectKind(parseCommand('create a file called notes that lists open questions'), 'propose_write');
  assert.equal(i.relPath, 'src/notes.ts');
  assert.equal(i.hint, 'lists open questions');
});

test('propose_write — no article ("write config file") still parses', () => {
  const i = expectKind(parseCommand('write config file'), 'propose_write');
  assert.equal(i.relPath, 'src/config.ts');
});

test('add_task — "remind me to ..." keeps the title verbatim', () => {
  const i = expectKind(parseCommand('remind me to email the recruiter tomorrow'), 'add_task');
  assert.equal(i.title, 'email the recruiter tomorrow');
});

test('add_task — "add a task ..." and "new task ..." phrasings', () => {
  assert.equal(expectKind(parseCommand('add a task to review the PR'), 'add_task').title, 'review the PR');
  assert.equal(expectKind(parseCommand('new task book the flights'), 'add_task').title, 'book the flights');
  assert.equal(expectKind(parseCommand('remember to renew the domain'), 'add_task').title, 'renew the domain');
});

test('add_task WINS over propose_write when both could match', () => {
  // Ends in the word "component", but the explicit "task" keyword means the
  // owner wants a task, not a file proposal.
  const i = expectKind(parseCommand('add a task to build a login component'), 'add_task');
  assert.equal(i.title, 'build a login component');
});

test('read — the three targets from natural phrasings', () => {
  assert.equal(expectKind(parseCommand('what is waiting'), 'read').what, 'pending');
  assert.equal(expectKind(parseCommand('show pending approvals'), 'read').what, 'pending');
  assert.equal(expectKind(parseCommand("what's in my queue"), 'read').what, 'pending');
  assert.equal(expectKind(parseCommand('read my receipts'), 'read').what, 'receipts');
  assert.equal(expectKind(parseCommand('what have you done'), 'read').what, 'receipts');
  assert.equal(expectKind(parseCommand('verify the chain'), 'read').what, 'chain');
  assert.equal(expectKind(parseCommand('is the ledger intact'), 'read').what, 'chain');
});

test('navigate — opens a Zeno surface and accepts the selected-project phrasing', () => {
  assert.equal(expectKind(parseCommand('open Forge'), 'navigate').target, 'forge');
  assert.equal(expectKind(parseCommand('open porch'), 'navigate').target, 'forge');
  assert.equal(expectKind(parseCommand('go to the Counsel tab'), 'navigate').target, 'counsel');
  assert.equal(
    expectKind(parseCommand('open Forge and show the selected repository'), 'navigate').target,
    'forge',
  );
});

test('cancel — the ways a person backs out', () => {
  for (const phrase of ['never mind', 'nevermind', 'cancel', 'cancel that', 'forget it', 'scratch that', 'stop']) {
    expectKind(parseCommand(phrase), 'cancel');
  }
});

test('"cancel netflix" is NOT a cancel — the tail is not a backout word', () => {
  // Without a task keyword this is simply unrecognized, not a cancel of the queue.
  expectKind(parseCommand('cancel netflix'), 'unrecognized');
});

test('gibberish degrades to Unrecognized carrying the raw text — never silence', () => {
  const i = expectKind(parseCommand('the weather is nice today'), 'unrecognized');
  assert.equal(i.reason, NOT_A_COMMAND);
  assert.equal(i.text, 'the weather is nice today');
});

test('an empty command is Unrecognized, not a throw', () => {
  expectKind(parseCommand('   '), 'unrecognized');
});

// ---- relPath derivation is sandbox-safe by construction -------------------

test('deriveRelPath collapses arbitrary punctuation to a safe slug', () => {
  assert.equal(deriveRelPath('Card', 'component'), 'src/components/Card.tsx');
  assert.equal(deriveRelPath('user   profile', 'component'), 'src/components/UserProfile.tsx');
  assert.equal(deriveRelPath('rate limiter', 'file'), 'src/rate-limiter.ts');
});

test('deriveRelPath returns null when no usable name survives', () => {
  assert.equal(deriveRelPath('...', 'file'), null);
  assert.equal(deriveRelPath('   ', 'component'), null);
});

test('SANDBOX SAFETY — a spoken name that tries to traverse cannot escape src/', () => {
  const attacks: ReadonlyArray<readonly [string, 'component' | 'file']> = [
    ['../../etc/passwd', 'file'],
    ['/etc/shadow', 'file'],
    ['..\\..\\windows\\system32', 'file'],
    ['C: drive config', 'file'],
    ['foo/../bar', 'component'],
  ];
  for (const [name, kind] of attacks) {
    const rel = deriveRelPath(name, kind);
    assert.notEqual(rel, null, `${name} should still yield a path`);
    assert.equal(rel!.includes('..'), false, `${name} produced a traversal: ${rel}`);
    assert.equal(rel!.startsWith('/'), false, `${name} produced an absolute path: ${rel}`);
    assert.equal(/[\\:]/.test(rel!), false, `${name} produced a backslash or drive letter: ${rel}`);
    assert.ok(rel!.startsWith('src/'), `${name} left the src tree: ${rel}`);
  }
});

test('a traversal spoken as a component name still yields a proposal we can preview', () => {
  const i = expectKind(parseCommand('create a ../../secret component'), 'propose_write');
  assert.equal(i.relPath, 'src/components/Secret.tsx');
});

test('a name that is only punctuation is Unrecognized with the no-safe-name reason', () => {
  const i = expectKind(parseCommand('create a --- file'), 'unrecognized');
  assert.equal(i.reason, NO_SAFE_NAME);
});

// ---- LENS: mishearing & injection -----------------------------------------
// Speech-to-text is lossy and the transcript is untrusted: it can dictate a path
// traversal, smuggle in control characters, mis-hear a homophone, or hand over a
// very long ramble. None of that may escape the sandbox or corrupt a derived
// field, and nothing may crash.

/** True if the string holds any C0 control, DEL, or C1 control character. Built
 * from code points so this source file stays plain ASCII — no escape a tool
 * could mis-transcribe, and no raw control byte living in the test source. */
function hasControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

// The exact bytes a lossy recognizer might smuggle in, named for readability.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NUL = String.fromCharCode(0x00);
const BS = String.fromCharCode(0x08);

test('MISHEARING — a dictated traversal ("dot dot slash etc") slugs into src, not out of it', () => {
  // The recognizer spells the traversal out as words; the slug keeps it in src/.
  const i = expectKind(parseCommand('create a dot dot slash etc file'), 'propose_write');
  assert.equal(i.relPath, 'src/dot-dot-slash-etc.ts');
  assert.equal(i.relPath.includes('..'), false);
  assert.ok(i.relPath.startsWith('src/'));
});

test('INJECTION — control characters never survive into summary, hint, title or echoed text', () => {
  // An ANSI colour escape + BEL + NUL + backspace hidden in a spoken command.
  // \s+ does not fold these, so without the boundary cleanse they would ride the
  // proposal into a scaffold file and any terminal that later printed it.
  const dirty = 'create a card component that ' + ESC + '[31mturns red' + BEL + ' and ' + NUL + 'handles' + BS + ' input';
  const w = expectKind(parseCommand(dirty), 'propose_write');
  assert.equal(hasControl(w.summary), false, `summary carried a control char: ${JSON.stringify(w.summary)}`);
  assert.equal(hasControl(w.hint), false, `hint carried a control char: ${JSON.stringify(w.hint)}`);
  assert.equal(w.relPath, 'src/components/Card.tsx');

  // A task title carrying an OSC terminal-title escape is cleansed the same way; the
  // dangerous control bytes go even though harmless printable text remains.
  const t = expectKind(parseCommand('remind me to ' + ESC + ']0;pwned' + BEL + ' email the recruiter'), 'add_task');
  assert.equal(hasControl(t.title), false, `title carried a control char: ${JSON.stringify(t.title)}`);
  assert.ok(t.title.includes('email the recruiter'), `title lost its content: ${JSON.stringify(t.title)}`);

  // The echoed text of an unrecognized command is clean too.
  const u = expectKind(parseCommand('the ' + NUL + 'weather' + ESC + ' is nice today'), 'unrecognized');
  assert.equal(hasControl(u.text), false, `unrecognized text carried a control char: ${JSON.stringify(u.text)}`);
});

test('MISHEARING — a homophone stays non-actionable and cannot forge an unsafe path', () => {
  // Homophones a recognizer might emit for "approve"/"accept"/"aye". The Intent
  // union has no approve member, so the worst any of these can do is fall through
  // to a non-actionable outcome — never a task, a read, or a write.
  for (const phrase of ['a prove it', 'a sept the change', 'aye do it']) {
    const kind = parseCommand(phrase).kind;
    assert.ok(kind === 'unrecognized' || kind === 'cancel', `"${phrase}" produced actionable kind ${kind}`);
  }
  // A homophone sitting inside a component name is slugged like any other word.
  const i = expectKind(parseCommand('create a write right rite component'), 'propose_write');
  assert.equal(i.relPath, 'src/components/WriteRightRite.tsx');
});

test('MISHEARING — a very long ramble does not crash and yields a bounded, sandbox-safe path', () => {
  const ramble = 'really '.repeat(4000) + 'long';
  const c = expectKind(parseCommand(`create a ${ramble} component`), 'propose_write');
  assert.ok(c.relPath.startsWith('src/components/'), c.relPath);
  assert.equal(c.relPath.includes('..'), false);
  assert.ok(
    c.relPath.length <= 'src/components/'.length + 64 + '.tsx'.length,
    `component relPath not bounded: ${c.relPath.length} chars`,
  );

  const f = expectKind(parseCommand(`write a ${ramble} file`), 'propose_write');
  assert.ok(f.relPath.startsWith('src/'), f.relPath);
  assert.equal(/-\.ts$/.test(f.relPath), false, `dangling separator: ${f.relPath}`);
  assert.ok(f.relPath.length <= 'src/'.length + 64 + '.ts'.length, `file relPath not bounded: ${f.relPath}`);
});

// ---- delegate: the sentence that starts an agent ----------------------------
// The gap this closes: an owner could say "add a task" but not "build me a
// slugify utility". The first is a line on a list, the second is a job — too big
// for one scaffolded file and exactly what the governed coding agent is for.
// What follows pins both halves of that: the phrasings it must catch, and the
// narrower intents it must never steal.

test('delegate — "build me a ..." becomes a job, carrying the sentence as spoken', () => {
  const i = expectKind(parseCommand('build me a slugify utility'), 'delegate');
  assert.equal(i.task, 'build me a slugify utility');
});

test('delegate — every one of the five asking verbs is understood', () => {
  const phrasings = [
    'build a rate limiter with exponential backoff',
    'make a CSV export for the receipts page',
    'write a parser for the ledger format',
    'implement retry with backoff on the fetch helper',
    'create a slugify utility that handles unicode',
  ];
  for (const phrase of phrasings) {
    const i = expectKind(parseCommand(phrase), 'delegate');
    assert.equal(i.task, phrase, 'the task is the sentence, not a summary of it');
  }
});

test('delegate — trailing punctuation is trimmed off the task', () => {
  assert.equal(expectKind(parseCommand('build me a slugify utility.'), 'delegate').task, 'build me a slugify utility');
  assert.equal(expectKind(parseCommand('implement dark mode!'), 'delegate').task, 'implement dark mode');
});

test('delegate does NOT steal add_task — "add a task to build a login form" is still a task', () => {
  // The precedence that was already load-bearing, now with a third intent that
  // shares the word "build". `add_task` still wins.
  const i = expectKind(parseCommand('add a task to build a login form'), 'add_task');
  assert.equal(i.title, 'build a login form');
  // And the original component-shaped one, unchanged.
  assert.equal(expectKind(parseCommand('add a task to build a login component'), 'add_task').title, 'build a login component');
  assert.equal(expectKind(parseCommand('remind me to build the deck'), 'add_task').title, 'build the deck');
  assert.equal(expectKind(parseCommand('new task write the release notes'), 'add_task').title, 'write the release notes');
});

test('delegate does NOT steal propose_write — a named component or file is still one file', () => {
  const stay: ReadonlyArray<readonly [string, string]> = [
    ['create a card component', 'src/components/Card.tsx'],
    ['build a settings component', 'src/components/Settings.tsx'],
    ['make a login component', 'src/components/Login.tsx'],
    ['write a rate limiter file', 'src/rate-limiter.ts'],
    ['create a file called notes', 'src/notes.ts'],
  ];
  for (const [phrase, relPath] of stay) {
    const i = expectKind(parseCommand(phrase), 'propose_write');
    assert.equal(i.relPath, relPath, `"${phrase}" must stay a single-file proposal`);
  }
});

test('delegate does NOT steal the reads, the cancel, or the approval refusal', () => {
  expectKind(parseCommand('what is waiting'), 'read');
  expectKind(parseCommand('verify the chain'), 'read');
  expectKind(parseCommand('cancel'), 'cancel');
  // "make the change" is an approval idiom, and the approval guard runs first.
  const i = expectKind(parseCommand('make the change'), 'unrecognized');
  assert.equal(i.reason, APPROVAL_BY_HAND);
});

test('delegate — a verb with only a pronoun after it is refused, legibly', () => {
  for (const phrase of ['build it', 'make that', 'implement this', 'write me it']) {
    const i = expectKind(parseCommand(phrase), 'unrecognized');
    assert.equal(i.reason, DELEGATE_NEEDS_A_TASK, `"${phrase}" should say what is missing`);
  }
});

test('delegate — control characters never survive into the task an agent would read', () => {
  const dirty = 'build me a slugify utility that ' + ESC + '[31mstrips' + BEL + ' accents' + NUL;
  const i = expectKind(parseCommand(dirty), 'delegate');
  assert.equal(hasControl(i.task), false, `task carried a control char: ${JSON.stringify(i.task)}`);
  assert.ok(i.task.startsWith('build me a slugify utility'), i.task);
});

test('delegate — a non-command sentence that merely contains "build" is still unrecognized', () => {
  // The rule is anchored at the START of the utterance, so prose about building
  // does not become a job for an agent.
  const i = expectKind(parseCommand('the build is broken again'), 'unrecognized');
  assert.equal(i.reason, NOT_A_COMMAND);
});
