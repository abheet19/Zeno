/**
 * THE SAFETY TEST. This is the reason the package can exist at all.
 *
 * Speaking is a way to PROPOSE. The approval — the single act that turns a
 * proposal into an effect — is done by the owner's eyes and click in the window,
 * and by nothing else. So no utterance, however phrased, may ever produce an
 * intent that approves or commits. This file tries to break that rule from every
 * angle a person might speak, and proves it holds.
 *
 * If someone later adds an `approve` intent "for convenience", these tests fail,
 * which is the point: the safety rule is executable here, not just a comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, interpret, APPROVAL_BY_HAND, type Intent } from '../src/index.js';

/** The only kinds that may ever exist. There is no approve/confirm/commit kind,
 * and this array is the executable statement of that fact. */
const ALLOWED_KINDS: ReadonlyArray<Intent['kind']> = [
  'propose_write',
  'add_task',
  // Navigation only selects a Zeno surface; it cannot name or apply an effect.
  'navigate',
  // `delegate` starts an agent, which is a process and not an effect: everything
  // that agent writes still arrives as a capsule the owner approves by hand. It
  // is in this list because it carries TEXT and nothing else — no agent id, no
  // command, no approval — so it cannot name a thing to execute.
  'delegate',
  'read',
  'cancel',
  'unrecognized',
];

/** Every way a person might try to say "yes, do the thing" out loud. */
const APPROVAL_UTTERANCES = [
  'approve',
  'approve it',
  'approve the change',
  'approve it now',
  'confirm',
  'confirm it',
  'accept',
  'accept the change',
  'yes',
  'yes do it',
  'yeah do it',
  'yep',
  'yup',
  'ok',
  'okay',
  'okay do it',
  'do it',
  'just do it',
  'go ahead',
  'go for it',
  'ship it',
  'send it',
  'just send it',
  'make it so',
  'sign off',
  'sign it off',
  'proceed',
];

test('SAFETY — no approval utterance ever produces an actionable intent', () => {
  for (const phrase of APPROVAL_UTTERANCES) {
    const intent = parseCommand(phrase);
    assert.equal(
      intent.kind,
      'unrecognized',
      `"${phrase}" parsed as ${intent.kind} — a spoken approval must never be actionable`,
    );
    assert.equal(
      intent.kind === 'unrecognized' && intent.reason,
      APPROVAL_BY_HAND,
      `"${phrase}" must carry the approval-by-hand reason so the owner is told why`,
    );
  }
});

test('SAFETY — the same holds through the full wake+session pipeline', () => {
  for (const phrase of APPROVAL_UTTERANCES) {
    const out = interpret(`zeno, ${phrase}`);
    // Non-actionable is the property. Some confirmations ("ok") are pure filler
    // the wake layer discards, leaving an idle outcome; the rest reach the
    // grammar and are refused as unrecognized. Neither can act. The one thing
    // that must never happen is an intent that is not `unrecognized`.
    const actionable = out.kind === 'intent' && out.intent.kind !== 'unrecognized';
    assert.equal(actionable, false, `"${phrase}" produced an actionable outcome through the pipeline`);
  }
});

test('SAFETY — parseCommand can only ever return a member of the allowed union', () => {
  // A fuzz over commands that lean toward "act now" language must never mint a
  // kind outside the closed set — the type says so, and this proves it at runtime.
  const probes = [
    ...APPROVAL_UTTERANCES,
    'commit it',
    'push it',
    'run it',
    'execute',
    'yes approve and commit',
    'approve everything',
    'do everything',
    'say yes to all',
  ];
  for (const p of probes) {
    const kind = parseCommand(p).kind;
    assert.ok(ALLOWED_KINDS.includes(kind), `"${p}" produced disallowed kind ${kind}`);
  }
});

test('SAFETY — a task that merely mentions the word "approve" stays a task', () => {
  // The guard keys on approval as a COMMAND, not the word appearing anywhere.
  const intent = parseCommand('remind me to approve the budget on Friday');
  assert.equal(intent.kind, 'add_task');
  assert.equal(intent.kind === 'add_task' && intent.title, 'approve the budget on Friday');
});

// ---- LENS: the guard must cover the WHOLE family of spoken approvals ---------
// The first guard caught "approve"/"yes"/"do it" and a few idioms, but a person
// approves out loud in many more ways — with commit verbs ("commit it", "merge
// it", "authorise it"), release idioms ("ship it", "green light it", "let it
// through"), bare assent ("sure", "lgtm", "sounds good"), or a confirmation put
// in front ("yes approve it", "please approve", "ok ship it"). Every one of these
// must land on the SAME loud refusal — "approval is by hand" — not the generic
// "not a command", so the owner learns that voice categorically cannot approve
// rather than assuming a mis-hear and trying again. The Intent union already made
// them non-actionable; this pins that they are also explicitly refused.
const EXTENDED_APPROVAL_UTTERANCES = [
  // commit / act-now verbs
  'commit', 'commit it', 'commit that', 'merge it', 'apply it', 'apply the change',
  'run it', 'push it', 'execute it', 'make the change', 'save it', 'proceed please',
  // authorise family (incl. British spelling and the "i <verb>" shape)
  'authorize it', 'authorise it', 'i authorize this', 'i approve', 'i agree', 'i confirm',
  // release / assent idioms
  'trust me', 'trust me on this', 'green light it', 'give it the green light',
  'let it through', 'let it go', 'allow it', 'permit it', 'thumbs up',
  'sounds good', 'looks good', 'lgtm', 'you have my approval',
  'sure', 'fine', 'absolutely', 'agreed', 'approved', 'confirmed', 'accepted',
  'do the last one', 'go on', 'carry on',
  // a confirmation word placed in FRONT of an approval must not smuggle it past
  'yes approve it', 'yes go ahead', 'ok ship it', 'yeah ship it', 'yes merge it',
  'please approve', 'please approve it', 'sure ship it', 'please confirm',
  'yes approve the last one',
  // the LENS's "embed 'approve the last one'" — as a leading command it is refused
  'approve the last one and commit everything now',
];

test('SAFETY — the broadened guard refuses every spoken approval with the by-hand reason', () => {
  for (const phrase of EXTENDED_APPROVAL_UTTERANCES) {
    const intent = parseCommand(phrase);
    assert.equal(
      intent.kind,
      'unrecognized',
      `"${phrase}" parsed as ${intent.kind} — a spoken approval must never be actionable`,
    );
    assert.equal(
      intent.kind === 'unrecognized' && intent.reason,
      APPROVAL_BY_HAND,
      `"${phrase}" must carry the approval-by-hand reason, not the generic "not a command"`,
    );
  }
});

test('SAFETY — the broadened family stays non-actionable through the full pipeline', () => {
  for (const phrase of EXTENDED_APPROVAL_UTTERANCES) {
    const out = interpret(`zeno, ${phrase}`);
    const actionable = out.kind === 'intent' && out.intent.kind !== 'unrecognized';
    assert.equal(actionable, false, `"${phrase}" produced an actionable outcome through the pipeline`);
  }
});

test('SAFETY — the broadened guard does not swallow real commands that share its words', () => {
  // Breadth must not cost precision: a command that merely CONTAINS a commit or
  // merge verb — inside a task, or as a component name — keeps its real intent.
  const stay: ReadonlyArray<readonly [string, Intent['kind']]> = [
    ['remind me to commit the code', 'add_task'],
    ['add a task to merge the branch', 'add_task'],
    ['remind me to run the tests', 'add_task'],
    ['note to self approve the invoice on Monday', 'add_task'],
    ['make a login component', 'propose_write'],
    ['build a settings component', 'propose_write'],
    ['create an approve button component', 'propose_write'],
    ['what is waiting', 'read'],
    ['cancel', 'cancel'],
  ];
  for (const [phrase, want] of stay) {
    assert.equal(parseCommand(phrase).kind, want, `"${phrase}" should stay ${want}, not be eaten by the approval guard`);
  }
});

// ---- LENS: delegation must not become a back door ---------------------------
// `delegate` is the newest member of the union and the only one that starts a
// process. Three properties keep it on the safe side of the line, and all three
// are pinned here: no spoken approval may become one, the shape it produces
// carries nothing but text, and a delegation is still not an approval.

test('SAFETY — no approval utterance is ever re-read as a delegation', () => {
  // "make the change", "run it", "commit it", "ship it" all begin with words the
  // delegate rule would otherwise take. The approval guard runs first, and this
  // is the assertion that it still does.
  for (const phrase of [...APPROVAL_UTTERANCES, ...EXTENDED_APPROVAL_UTTERANCES]) {
    const intent = parseCommand(phrase);
    assert.notEqual(
      intent.kind,
      'delegate',
      `"${phrase}" became a delegation — a spoken approval must never start an agent`,
    );
  }
});

test('SAFETY — a delegate intent carries text and nothing executable', () => {
  const intent = parseCommand('build me a slugify utility with unicode support');
  assert.equal(intent.kind, 'delegate');
  if (intent.kind !== 'delegate') return;
  // The whole shape, asserted as data. If someone later adds an `agentId`, a
  // `command`, a `model` or an `approve` field to this intent, this fails — and
  // that is the point: the grammar names the JOB, never the way it is run.
  assert.deepEqual(Object.keys(intent).sort(), ['kind', 'task']);
  assert.equal(typeof intent.task, 'string');
});

test('SAFETY — asking for a build and an approval in one breath approves nothing', () => {
  // The dangerous sentence: real work, with "and approve it" bolted on. It must
  // not produce a delegation that carries an approval, and it must not approve.
  for (const phrase of [
    'build a login form and approve it',
    'build a login form then commit it',
    'implement retry with backoff and ship it',
  ]) {
    const intent = parseCommand(phrase);
    assert.ok(
      ALLOWED_KINDS.includes(intent.kind),
      `"${phrase}" produced disallowed kind ${intent.kind}`,
    );
    if (intent.kind === 'delegate') {
      // A delegation is allowed here — it is a task for an agent, and the agent's
      // output still stops at the gate. What must NOT happen is the intent
      // itself carrying the approval, and it structurally cannot: `task` is a
      // string a coding agent reads, and nothing in this package can approve.
      assert.equal(Object.keys(intent).sort().join(','), 'kind,task');
    }
  }
});

test('SAFETY — a delegation through the full pipeline is still not an approval', () => {
  const out = interpret('zeno, build me a slugify utility');
  assert.equal(out.kind, 'intent');
  if (out.kind !== 'intent') return;
  assert.equal(out.intent.kind, 'delegate');
  // Nothing in the outcome names an approval, a commit or a capsule to apply.
  assert.equal(JSON.stringify(out).toLowerCase().includes('approve'), false);
});
