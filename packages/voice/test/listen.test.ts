/**
 * WAKE MODE — the pure half, under test.
 *
 * Two things are being pinned here, and they are different in kind.
 *
 * The first is BEHAVIOUR: the command window opens on a wake, is hard-bounded,
 * closes cheaply when nothing follows, and only ever acts on a settled
 * transcript. A machine that quietly stayed open, or acted on half a sentence,
 * would be listening in a way the indicator does not describe.
 *
 * The second is the RETENTION BOUND. Wake mode cannot claim the audio stays on
 * this machine — the browser ships it to its vendor to transcribe, and no test
 * here can change that. What it CAN claim is that Zeno holds at most the last
 * ~15 seconds of untriggered transcript, in memory, and drops it on disarm.
 * These tests are what make that claim checkable rather than a slogan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WakeListener,
  TranscriptRing,
  WAKE_WINDOW_MS,
  RETENTION_MS,
  RETENTION_MAX_ENTRIES,
  APPROVAL_BY_HAND,
  EMPTY_COMMAND,
  interpret,
  type Outcome,
} from '../src/index.js';

/** The intent kind behind an outcome, or the idle reason. Keeps the assertions
 * below readable without a cast at every call site. */
function kindOf(outcome: Outcome): string {
  return outcome.kind === 'idle' ? `idle:${outcome.reason}` : outcome.intent.kind;
}

// ---- the bounded retention buffer ------------------------------------------

test('RING — retains untriggered transcript and drops it past the window', () => {
  const ring = new TranscriptRing(1000);
  ring.push('the cat is on the mat', 0);
  ring.push('unrelated chatter', 500);
  assert.equal(ring.size(600), 2);
  assert.equal(ring.text(600), 'the cat is on the mat unrelated chatter');

  // At t=1001 the first line is older than the 1000ms window and is gone.
  assert.equal(ring.size(1001), 1);
  assert.equal(ring.text(1001), 'unrelated chatter');

  // Past the window entirely: nothing is retained.
  assert.equal(ring.size(2000), 0);
  assert.equal(ring.text(2000), '');
});

test('RING — a growing interim replaces its own prefix instead of piling up', () => {
  const ring = new TranscriptRing();
  ring.push('add', 0);
  ring.push('add a', 10);
  ring.push('add a card', 20);
  assert.equal(ring.size(20), 1, 'the same utterance growing must not become three retained lines');
  assert.equal(ring.text(20), 'add a card');

  // A genuinely new utterance is a new line.
  ring.push('what a day', 30);
  assert.equal(ring.size(30), 2);
});

test('RING — blank transcript is never retained', () => {
  const ring = new TranscriptRing();
  ring.push('   ', 0);
  ring.push('', 0);
  assert.equal(ring.size(0), 0);
});

test('RING — the entry cap bounds memory even inside the time window', () => {
  // Time alone is not a memory bound: an engine emitting many distinct partials
  // per second would grow the buffer without limit. The count cap is the floor.
  const ring = new TranscriptRing(RETENTION_MS, 3);
  for (let i = 0; i < 10; i += 1) ring.push(`line ${i}`, i);
  assert.equal(ring.size(10), 3);
  assert.equal(ring.text(10), 'line 7 line 8 line 9', 'the cap keeps the NEWEST lines');
});

test('RING — clear() drops everything', () => {
  const ring = new TranscriptRing();
  ring.push('something said in the room', 0);
  ring.clear();
  assert.equal(ring.size(0), 0);
  assert.equal(ring.text(0), '');
});

test('RING — the shipped defaults are the ones the disclosure names', () => {
  assert.equal(RETENTION_MS, 15_000, 'the panel tells the owner ~15 seconds');
  assert.equal(WAKE_WINDOW_MS, 8_000, 'the panel counts down about 8 seconds');
  assert.ok(RETENTION_MAX_ENTRIES > 0);
});

// ---- the state machine ------------------------------------------------------

test('STATE — a fresh listener is off, and being off means deaf', () => {
  const l = new WakeListener();
  assert.equal(l.state, 'off');
  // Even the wake word does nothing while off. There is no state in which Zeno
  // is listening without the indicator saying so, because there is no state
  // between off and armed.
  assert.deepEqual(l.hear('zeno add a card component', true, 0), { kind: 'none' });
  assert.equal(l.state, 'off');
});

test('STATE — armed retains untriggered speech and stays armed', () => {
  const l = new WakeListener();
  l.arm();
  assert.equal(l.state, 'armed');
  const ev = l.hear('the cat is on the mat', true, 0);
  assert.equal(ev.kind, 'retained');
  assert.equal(l.state, 'armed', 'untriggered speech must never open a command window');
  assert.equal(l.retained(0), 'the cat is on the mat');
  assert.equal(l.retainedCount(0), 1);
});

test('STATE — arm() is idempotent and does not reopen a window', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('zeno', true, 0);
  assert.equal(l.state, 'open');
  l.arm();
  assert.equal(l.state, 'open', 'arming again must not disturb an open window');
});

test('STATE — a bare wake opens the window, and the countdown is visible', () => {
  const l = new WakeListener({ windowMs: 8000 });
  l.arm();
  const ev = l.hear('hey zeno', true, 1000);
  assert.equal(ev.kind, 'woke');
  assert.equal(l.state, 'open');
  assert.equal(l.remainingMs(1000), 8000);
  assert.equal(l.remainingMs(5000), 4000);
  assert.equal(l.remainingMs(99_000), 0, 'the countdown never goes negative');
});

test('STATE — remainingMs is zero whenever no window is open', () => {
  const l = new WakeListener();
  assert.equal(l.remainingMs(0), 0);
  l.arm();
  assert.equal(l.remainingMs(0), 0);
});

test('STATE — the wake drops what was retained before it', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('something private said in the room', true, 0);
  assert.equal(l.retainedCount(0), 1);
  l.hear('zeno', true, 100);
  assert.equal(l.retained(100), '', 'pre-wake chatter has no reason to survive the wake');
});

test('STATE — wake and command in ONE final utterance acts immediately', () => {
  const l = new WakeListener();
  l.arm();
  const ev = l.hear('zeno, add a card component', true, 0);
  assert.equal(ev.kind, 'command');
  assert.equal(ev.kind === 'command' && kindOf(ev.outcome), 'propose_write');
  assert.equal(ev.kind === 'command' && ev.command, 'add a card component');
  assert.equal(l.state, 'armed', 'a settled command returns straight to armed');
});

test('STATE — an interim wake opens a window; the command lands on the final', () => {
  const l = new WakeListener();
  l.arm();
  // The engine hears the wake word first, as a partial.
  assert.equal(l.hear('zeno', false, 0).kind, 'woke');
  assert.equal(l.state, 'open');
  // Partials inside the window are shown, never acted on.
  const cap = l.hear('zeno add a card', false, 500);
  assert.equal(cap.kind, 'capturing');
  assert.equal(cap.kind === 'capturing' && cap.partial, 'add a card');
  assert.equal(l.state, 'open', 'a partial must never close the window');
  // The settled transcript, wake word repeated and all, is the command.
  const ev = l.hear('zeno add a card component', true, 1200);
  assert.equal(ev.kind, 'command');
  assert.equal(ev.kind === 'command' && ev.command, 'add a card component');
  assert.equal(l.state, 'armed');
});

test('STATE — a command with no wake word repeated inside the window still lands', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('zeno', true, 0);
  const ev = l.hear('remind me to call the bank', true, 900);
  assert.equal(ev.kind, 'command');
  assert.equal(ev.kind === 'command' && kindOf(ev.outcome), 'add_task');
});

test('STATE — a final that is only the wake word keeps the window open', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('zeno', true, 0);
  const ev = l.hear('zeno', true, 500);
  assert.equal(ev.kind, 'capturing', 'an empty command is not a command');
  assert.equal(l.state, 'open');
});

test('STATE — the window expires cheaply and returns to armed', () => {
  const l = new WakeListener({ windowMs: 8000 });
  l.arm();
  l.hear('zeno', true, 0);
  assert.deepEqual(l.tick(7999), { kind: 'none' });
  assert.equal(l.state, 'open');
  assert.deepEqual(l.tick(8000), { kind: 'expired' });
  assert.equal(l.state, 'armed', 'a misfire costs one visible countdown, nothing more');
  // Expiry fires exactly once — a second tick is silent.
  assert.deepEqual(l.tick(9000), { kind: 'none' });
});

test('STATE — tick is silent while off and while armed', () => {
  const l = new WakeListener();
  assert.deepEqual(l.tick(10_000), { kind: 'none' });
  l.arm();
  assert.deepEqual(l.tick(10_000), { kind: 'none' });
});

test('STATE — the window is HARD bounded; speech inside it does not extend it', () => {
  const l = new WakeListener({ windowMs: 8000 });
  l.arm();
  l.hear('zeno', true, 0);
  l.hear('um', false, 7000);
  assert.equal(l.remainingMs(7000), 1000, 'a partial must not buy more capture time');
  assert.deepEqual(l.tick(8000), { kind: 'expired' });
});

test('STATE — a transcript arriving after the deadline closes the window first', () => {
  // hear() and tick() must never disagree about the state, even if the UI's
  // interval is late. A late transcript is judged as armed, not as in-window.
  const l = new WakeListener({ windowMs: 8000 });
  l.arm();
  l.hear('zeno', true, 0);
  const ev = l.hear('the cat is on the mat', true, 9000);
  assert.equal(ev.kind, 'retained', 'the window had already run out; this is untriggered speech');
  assert.equal(l.state, 'armed');
});

test('STATE — blank transcripts are ignored in every state', () => {
  const l = new WakeListener();
  l.arm();
  assert.deepEqual(l.hear('   ', false, 0), { kind: 'none' });
  l.hear('zeno', true, 0);
  assert.deepEqual(l.hear('', true, 100), { kind: 'none' });
  assert.equal(l.state, 'open');
});

test('STATE — disarm returns to off and drops the retained transcript', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('a private conversation', true, 0);
  l.hear('zeno', true, 100);
  assert.equal(l.state, 'open');
  l.disarm();
  assert.equal(l.state, 'off');
  assert.equal(l.retained(100), '', 'disarm must drop what was held, not just stop adding');
  assert.equal(l.remainingMs(100), 0);
  // Idempotent.
  l.disarm();
  assert.equal(l.state, 'off');
});

test('STATE — an unrecognized command after a wake is reported, not swallowed', () => {
  const l = new WakeListener();
  l.arm();
  l.hear('zeno', true, 0);
  const ev = l.hear('do a barrel roll', true, 500);
  assert.equal(ev.kind === 'command' && kindOf(ev.outcome), 'unrecognized');
});

test('STATE — retention respects the configured window through the listener', () => {
  const l = new WakeListener({ retentionMs: 1000 });
  l.arm();
  l.hear('first thing said', true, 0);
  l.hear('second thing said', true, 900);
  assert.equal(l.retainedCount(900), 2);
  assert.equal(l.retainedCount(1500), 1, 'anything older than the window is gone');
  assert.equal(l.retained(1500), 'second thing said');
});

// ---- the law, on the wake path ---------------------------------------------

test('LAW — a spoken approval after a wake is refused by hand, not obeyed', () => {
  // THE test for this slice. Wake mode changes how an utterance STARTS. It must
  // not change what an utterance may DO. Every approval phrasing that the button
  // refuses must be refused identically here, with the same reason the owner
  // reads, or wake mode has quietly become a second, weaker door.
  const approvals = [
    'approve it',
    'approve the last one',
    'confirm it',
    'yes do it',
    'ship it',
    'commit it',
    'merge it',
    'go ahead',
    'lgtm',
    'you have my approval',
    'please approve',
  ];
  for (const phrase of approvals) {
    const l = new WakeListener();
    l.arm();
    l.hear('zeno', true, 0);
    const ev = l.hear(phrase, true, 500);
    assert.equal(ev.kind, 'command', `"${phrase}" must be heard and answered, not silently dropped`);
    if (ev.kind !== 'command') continue;
    assert.equal(ev.outcome.kind, 'intent');
    const intent = ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
    assert.equal(intent?.kind, 'unrecognized', `"${phrase}" produced an actionable intent after a wake`);
    assert.equal(
      intent?.kind === 'unrecognized' ? intent.reason : '',
      APPROVAL_BY_HAND,
      `"${phrase}" must carry the by-hand refusal on the wake path too`,
    );
  }
});

test('LAW — the same refusal holds when wake and approval arrive in one utterance', () => {
  const l = new WakeListener();
  l.arm();
  const ev = l.hear('zeno approve it now', true, 0);
  assert.equal(ev.kind, 'command');
  const intent = ev.kind === 'command' && ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
  assert.equal(intent?.kind, 'unrecognized');
  assert.equal(intent?.kind === 'unrecognized' ? intent.reason : '', APPROVAL_BY_HAND);
});

test('LAW — nothing the machine emits can be an approval, whatever is said', () => {
  // A fuzz across everyday speech and act-now language. The only kinds that may
  // ever come out are the closed union's — there is no approve member to reach.
  const allowed = new Set(['propose_write', 'add_task', 'read', 'cancel', 'unrecognized']);
  const utterances = [
    'zeno approve everything',
    'zeno yes',
    'zeno just do it',
    'zeno authorise the last change',
    'zeno what is waiting',
    'zeno cancel',
    'zeno make a login component',
    'zeno remind me to approve the budget',
    'zeno sign it off',
    'zeno green light it',
  ];
  for (const said of utterances) {
    const l = new WakeListener();
    l.arm();
    const ev = l.hear(said, true, 0);
    if (ev.kind !== 'command') continue;
    if (ev.outcome.kind !== 'intent') {
      assert.equal(ev.outcome.reason, EMPTY_COMMAND);
      continue;
    }
    assert.ok(allowed.has(ev.outcome.intent.kind), `"${said}" produced disallowed kind ${ev.outcome.intent.kind}`);
  }
});

// ---- LENS: approval by voice, attacked after a wake -------------------------
//
// The previous LAW test took eleven phrasings and proved wake mode refuses them
// the way the button does. That is the right shape, but eleven phrasings is not
// the attack — a person who wants the thing approved does not read the regex
// first. They hedge it ("just approve it"), ask politely ("can you approve it"),
// point at the control ("click approve", "hit confirm"), sign off on it, stack
// it with a conjunction ("do it and commit it"), or simply say "ok".
//
// None of those could ever ACT — the Intent union has no approve member, so the
// worst case was always `unrecognized`. What they could do, and did, is land on
// the GENERIC refusal ("that is not a command I recognize"), which reads to the
// owner exactly like a mis-hear. An owner who thinks they were misheard repeats
// themselves, louder and closer to the microphone, and learns nothing about the
// rule. The refusal has to NAME the rule, every time, or the rule lives only in
// the code and never reaches the person holding it.
const WAKE_APPROVAL_ATTACK = [
  // hedged and urged
  'just approve it', 'just confirm it', 'just commit it', 'just merge it',
  'just approve the last one', 'just go ahead', 'simply approve it',
  // the assent that used to be swallowed as filler
  'ok', 'okay', 'sure', 'fine', 'aye', 'affirmative', 'roger that', 'of course',
  // asked as a favour
  'can you approve it', 'could you approve that', 'would you confirm it',
  'will you approve this', 'i want you to approve it', 'i need you to approve it',
  'you can approve it', 'can you just approve it',
  // said as a plural nudge
  "let's do it", 'lets do it', "let's ship it", "let's approve it", 'let us approve it',
  // "go ahead and ..." — an assent with the act spelled out after it
  'go ahead and approve it', 'go ahead and commit', 'go ahead and do it', 'go ahead and ship it',
  // pointing at the control instead of naming the act
  'click approve', 'hit approve', 'press approve', 'tap approve',
  'click the approve button', 'push the approve button', 'click yes', 'hit confirm',
  // signing off
  'sign off on it', 'signed off', 'i sign off on it', 'sign it off',
  // stacked with a conjunction
  'do it and commit it', 'yes approve it and merge it', 'approve and commit everything',
  // blanket
  'yes to all', 'say yes to all', 'allow all', 'accept all', 'approve them all', 'do everything',
  // and the phrasings the first LAW test already covered, re-run on this path
  'approve it', 'yes do it', 'ship it', 'trust me', 'confirm and commit', 'lgtm',
];

test('LAW — the whole family of spoken approvals is refused BY NAME after a wake', () => {
  for (const phrase of WAKE_APPROVAL_ATTACK) {
    const l = new WakeListener();
    l.arm();
    l.hear('zeno', true, 0);
    const ev = l.hear(phrase, true, 500);
    assert.equal(ev.kind, 'command', `"${phrase}" must be heard and answered, not silently dropped`);
    if (ev.kind !== 'command') continue;
    assert.equal(ev.outcome.kind, 'intent', `"${phrase}" went idle instead of being answered`);
    const intent = ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
    assert.equal(intent?.kind, 'unrecognized', `"${phrase}" produced an actionable intent after a wake`);
    assert.equal(
      intent?.kind === 'unrecognized' ? intent.reason : '',
      APPROVAL_BY_HAND,
      `"${phrase}" fell through to the generic refusal — the owner is not told approval is by hand`,
    );
  }
});

test('LAW — the same family is refused when the wake and the approval share one utterance', () => {
  // The two shapes take DIFFERENT code paths inside `hear`: a wake with a final
  // command attached answers immediately without opening a window, while a bare
  // wake opens one and the next utterance is the command. A guarantee that holds
  // on one path and not the other is not a guarantee, so both are attacked.
  for (const phrase of WAKE_APPROVAL_ATTACK) {
    const l = new WakeListener();
    l.arm();
    const ev = l.hear(`zeno, ${phrase}`, true, 0);
    assert.equal(ev.kind, 'command', `"zeno, ${phrase}" must reach the grammar in one utterance`);
    if (ev.kind !== 'command') continue;
    const intent = ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
    assert.equal(intent?.kind, 'unrecognized', `"zeno, ${phrase}" produced an actionable intent`);
    assert.equal(
      intent?.kind === 'unrecognized' ? intent.reason : '',
      APPROVAL_BY_HAND,
      `"zeno, ${phrase}" must carry the by-hand refusal on the one-utterance path too`,
    );
  }
});

test('LAW — a bare assent after the wake word is not swallowed as filler', () => {
  // The regression this pins. "ok" and "okay" are in the wake layer's FILLER set
  // (so "zeno, ok add a card" works), and the filler skip used to run off the end
  // of the utterance when filler was ALL that followed — turning "zeno, ok" into
  // a wake with an empty command. The grammar never saw the word, so the owner
  // was told "I heard the wake word but no command followed": Zeno reporting
  // SILENCE at the exact moment someone tried to approve out loud. Worse, wake
  // mode answered it by opening an eight-second command window.
  for (const assent of ['ok', 'okay']) {
    const l = new WakeListener();
    l.arm();
    const ev = l.hear(`zeno, ${assent}`, true, 0);
    assert.equal(ev.kind, 'command', `"zeno, ${assent}" must be answered, not treated as an empty wake`);
    const intent = ev.kind === 'command' && ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
    assert.equal(
      intent?.kind === 'unrecognized' ? intent.reason : '',
      APPROVAL_BY_HAND,
      `"zeno, ${assent}" must be refused by name, not reported as silence`,
    );
    assert.equal(l.state, 'armed', 'an assent must not leave a command window hanging open');
  }
  // The filler skip itself is untouched: filler followed by a REAL command is
  // still stripped, and a genuinely bare wake is still an empty command.
  const l2 = new WakeListener();
  l2.arm();
  const real = l2.hear('zeno, ok remind me to call Bob', true, 0);
  assert.equal(
    real.kind === 'command' && real.outcome.kind === 'intent' && real.outcome.intent.kind,
    'add_task',
  );
  const l3 = new WakeListener();
  l3.arm();
  assert.equal(l3.hear('hey zeno', true, 0).kind, 'woke', 'a bare wake must still just open the window');
});

test('LAW — breadth costs nothing: real commands survive the widened guard', () => {
  // The guard above is broad, and breadth is only safe if it is precise. A real
  // command that shares the guard's words — an assent-shaped prefix, a commit
  // verb inside a task, the word "approve" as part of a component's NAME — must
  // come through the wake path with its real intent intact. If this fails, the
  // refusal has started eating the commands it was meant to sit beside.
  const survive: ReadonlyArray<readonly [string, string]> = [
    ['remind me to approve the budget on Friday', 'add_task'],
    ['remind me to commit the code', 'add_task'],
    ['add a task to merge the branch', 'add_task'],
    ['note to self sign off on the lease', 'add_task'],
    ['create an approve button component', 'propose_write'],
    ['build an approval banner component', 'propose_write'],
    ['make a login component', 'propose_write'],
    ['what is waiting', 'read'],
    ['read my receipts', 'read'],
    ['verify the chain', 'read'],
    ['cancel', 'cancel'],
    ['never mind', 'cancel'],
  ];
  for (const [phrase, want] of survive) {
    const l = new WakeListener();
    l.arm();
    l.hear('zeno', true, 0);
    const ev = l.hear(phrase, true, 500);
    assert.equal(ev.kind, 'command');
    const intent = ev.kind === 'command' && ev.outcome.kind === 'intent' ? ev.outcome.intent : null;
    assert.equal(intent?.kind, want, `"${phrase}" was eaten by the approval guard on the wake path`);
  }
});

test('LAW — the two modes give the SAME answer to the same words', () => {
  // The deepest version of the rule. Wake mode changes how an utterance STARTS;
  // it must not change what the utterance MEANS. So for every attack phrase, the
  // push-to-talk path ("zeno, X" in one breath), the wake path with the command
  // in a second utterance, and the wake path with both in one utterance must
  // agree — same intent kind, same reason. A divergence is a second door with a
  // different lock on it, which is exactly how the "ok" hole existed: it was
  // refused on one path and reported as silence on the other.
  // Unlike `kindOf`, this carries the REASON as well as the kind: two paths that
  // both say "unrecognized" while giving the owner different explanations have
  // still diverged, and that is precisely the bug being pinned.
  const answer = (o: Outcome): string =>
    o.kind === 'idle'
      ? `idle:${o.reason}`
      : `${o.intent.kind}:${o.intent.kind === 'unrecognized' ? o.intent.reason : ''}`;
  for (const phrase of WAKE_APPROVAL_ATTACK) {
    const ptt = interpret(`zeno, ${phrase}`);
    const l2 = new WakeListener();
    l2.arm();
    l2.hear('zeno', true, 0);
    const two = l2.hear(phrase, true, 500);
    const l1 = new WakeListener();
    l1.arm();
    const one = l1.hear(`zeno, ${phrase}`, true, 0);
    assert.equal(two.kind, 'command');
    assert.equal(one.kind, 'command');
    const want = answer(ptt);
    assert.equal(
      two.kind === "command" ? answer(two.outcome) : "none",
      want,
      `"${phrase}": wake mode (command in a second utterance) disagrees with push-to-talk`,
    );
    assert.equal(
      one.kind === "command" ? answer(one.outcome) : "none",
      want,
      `"${phrase}": wake mode (one utterance) disagrees with push-to-talk`,
    );
  }
});
