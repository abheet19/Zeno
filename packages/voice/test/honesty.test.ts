/**
 * THE HONESTY TEST — recognition locality.
 *
 * The pure core is scrupulous about the safety story (voice proposes, hands
 * approve). But the one honesty claim the pure core cannot make is about WHERE
 * the microphone audio goes, because that is the browser's engine, not this
 * code. That claim lives in the front-end panel (`public/voice.js`), and it is
 * exactly the kind of thing that rots into a comfortable half-truth: the
 * `webkitSpeechRecognition` / Web Speech API path in Chrome, Edge and Safari
 * does NOT transcribe on-device — it streams your audio to the browser maker's
 * servers. A "local-first" system telling the owner recognition merely "runs in
 * your browser" would be implying a locality it does not have.
 *
 * So this test reads the shipped front-end text and pins the honest contract:
 * the panel must not imply on-device recognition, and it must own the cloud hop
 * in words the owner can read. If someone later softens the note back into
 * "runs in your browser", this fails — which is the point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Compiled to dist/test/honesty.test.js at runtime, so the front-end sits two
// directories up under public/. Read the real shipped file, not a copy.
const FRONTEND = fileURLToPath(new URL('../../public/voice.js', import.meta.url));
// Normalize the source so assertions match the text the OWNER reads, not the
// author's line breaks: merge adjacent string literals ('a ' + 'b' -> 'a b') and
// collapse whitespace. Otherwise a phrase that renders fine but happens to span a
// concatenation boundary would falsely look absent.
const lower = readFileSync(FRONTEND, 'utf8')
  .replace(/['"`]\s*\+\s*['"`]/g, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

// The same source with comments stripped — the CODE, not the prose about it.
// A structural claim ("this file cannot reach /approvals") has to be checked
// against what actually runs, or a doc comment that merely names the endpoint
// would fail a test that a real call should fail.
const code = readFileSync(FRONTEND, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\r\n]*/gm, '$1 ')
  .toLowerCase();

test('HONESTY — the panel never implies on-device recognition', () => {
  // "runs in your browser" is the specific phrasing that reads as local
  // processing while the engine is actually a cloud service. It must be gone.
  assert.equal(
    lower.includes('runs in your browser'),
    false,
    'the front-end says recognition "runs in your browser", which implies on-device — it is a cloud engine',
  );
});

test('HONESTY — the panel owns the cloud hop in words the owner can read', () => {
  // It must name the real engine, admit the audio leaves the device, and say
  // plainly that it is not on-device.
  assert.ok(lower.includes('web speech api'), 'the note must name the real engine (Web Speech API)');
  assert.ok(
    lower.includes('servers'),
    'the note must tell the owner the audio is sent to the browser maker’s servers',
  );
  assert.ok(
    lower.includes('not on-device'),
    'the note must state plainly that recognition is not on-device',
  );
});

test('HONESTY — the structural safety claim still stands beside the locality caveat', () => {
  // The locality fix must not have quietly dropped the true, load-bearing claim
  // that voice only proposes and never approves.
  assert.ok(
    lower.includes('nothing is ever approved by voice'),
    'the note must still say nothing is ever approved by voice',
  );
});

// ---- WAKE MODE: the honesty a continuously-open microphone demands ----------
//
// Push-to-talk is honest almost by construction — the microphone is open only
// while a finger is on a button, and the owner can see their own hand. Wake mode
// removes that, so every claim the panel makes has to carry more weight, and the
// one claim it MUST NOT make is the comfortable one: that "always listening for
// a wake word" means the room is being matched locally. It is not. The engine is
// the browser's cloud recogniser, so while wake mode is on the room is streaming
// to the browser maker. That is exactly why acceptance criterion VOICE-AC-06 —
// untriggered audio living only in a disclosed local ring buffer — is NOT met by
// this implementation, and the panel has to say so rather than imply otherwise.
//
// These tests read the shipped front-end and pin the disclosure. They are here
// because the failure mode is drift, not a bug: the sentence that admits the
// cloud hop is the first thing a later edit "tightens" away.

test('WAKE — the disclosure states the three costs of switching it on', () => {
  // 1. The microphone stays open, for the whole room.
  assert.ok(
    lower.includes('the microphone stays on'),
    'the disclosure must say plainly that the microphone stays on',
  );
  assert.ok(
    lower.includes('listens to the whole room'),
    'it must say the room is listened to, not only speech addressed to Zeno',
  );
  // 2. The audio leaves the machine, and is named as such.
  assert.ok(
    lower.includes('not processed on this machine'),
    'the disclosure must say the audio is not processed on this machine',
  );
  assert.ok(
    lower.includes('browser maker’s servers'),
    'it must name where the audio goes',
  );
  // 3. It lasts until switched off — no timer, no auto-off.
  assert.ok(
    lower.includes('it keeps listening until you switch it off'),
    'the disclosure must say it listens until switched off',
  );
  assert.ok(lower.includes('no timer and no auto-off'), 'it must rule out an auto-off the owner might assume');
});

test('WAKE — the disclosure refuses the on-device story outright', () => {
  assert.ok(
    lower.includes('no on-device wake model'),
    'the panel must admit there is no on-device wake model rather than leaving it ambiguous',
  );
  assert.ok(
    lower.includes('will not pretend the room stays local'),
    'the panel must explicitly decline the local-processing implication',
  );
});

test('WAKE — the retention bound is labelled as retention, never as locality', () => {
  // The ring buffer is a real bound on what ZENO keeps. It is not, and must
  // never be sold as, a bound on where the audio went. Both halves must appear
  // together, or the claim reads as the one we cannot make.
  assert.ok(
    lower.includes('seconds of untriggered transcript, in memory only, never written to disk'),
    'the panel must state what is retained and that it is memory-only',
  );
  assert.ok(
    lower.includes('does not make the audio local'),
    'the retention claim must be paired with the disclaimer that it is not locality',
  );
  assert.ok(
    lower.includes('untriggered transcript'),
    'what is bounded is TRANSCRIPT — calling it audio would overstate the bound',
  );
});

test('WAKE — the indicator has a word for every state, not just a colour', () => {
  // A colour-only indicator is invisible to a colour-blind owner, a monochrome
  // screen and a screenshot. Each state must carry readable text.
  for (const word of ['wake mode off', 'listening for “zeno”', 'heard “zeno”']) {
    assert.ok(lower.includes(word), `the indicator must have the readable state "${word}"`);
  }
});

test('WAKE — the law is structural: the front-end has no path to /approvals', () => {
  // The one act that turns a proposal into an effect must be unreachable from a
  // microphone in EITHER mode. The simplest possible proof is that the endpoint
  // does not appear in the shipped file at all.
  //
  // The panel reaches three routes now — /previews for a single file, /delegate
  // for a job, /forge/run for a hosted job the owner confirmed — and every one
  // of them produces capsules that WAIT. Not one of them can apply a change, and
  // the route that could is still absent from this file entirely.
  assert.equal(
    code.includes('approvals'),
    false,
    'the voice front-end has code mentioning approvals — speaking may propose and delegate, never approve',
  );
  assert.ok(code.includes('/previews'), 'the proposal path must still be here');
  assert.ok(
    lower.includes('nothing is ever approved by voice, in either mode'),
    'the disclosure must carry the no-approval-by-voice claim into wake mode',
  );
});

// ---- WAKE: the INDICATOR, which is the string an owner actually trusts -------
//
// The disclosure is read once. The indicator is on screen the whole time, it is
// an `aria-live` region, and it is the line the panel teaches the owner to
// consult for "can this thing hear me right now". So it is held to the same
// standard as the disclosure: every state's detail must be true at the instant
// it renders, and must not be only the comfortable half of the truth.
//
// These assertions run against `code` — the source with COMMENTS STRIPPED —
// because a comment explaining a phrase we removed is not a phrase the panel can
// show, and the absence claims here are about what renders.

test('WAKE — the indicator never claims the microphone is shut', () => {
  // "The microphone is not open." was rendered for the `off` state. Wake mode
  // being off is not the microphone being closed: push-to-talk opens it, and the
  // indicator went on asserting it was shut while the owner held the button and
  // the engine streamed. An indicator that can be false about the microphone is
  // worse than no indicator, because it is the thing being trusted.
  assert.equal(
    code.includes('the microphone is not open'),
    false,
    'the indicator claims the microphone is not open — push-to-talk opens it while wake mode is off',
  );
  assert.ok(
    lower.includes('the microphone opens only while you hold the button'),
    'the off state must say what DOES open the microphone, not assert that nothing does',
  );
});

test('WAKE — the armed state carries its cost, not just its reassurance', () => {
  // "Nothing is being captured as a command" is the single most-shown string in
  // wake mode, and it leads with the reassurance. The qualifier does not undo
  // what a skimming owner reads. The armed state is precisely when the cost the
  // disclosure described is being PAID, so the indicator states it.
  assert.equal(
    code.includes('nothing is being captured'),
    false,
    'the armed indicator leads with "nothing is being captured" while the room is being uploaded',
  );
  assert.ok(
    lower.includes('the microphone is open and your browser is sending the room to its maker to be transcribed'),
    'the armed state must say the microphone is open and the room is being sent away',
  );
});

test('WAKE — the note does not soften the engine into something local', () => {
  // Two hedges did the softening. "built-in" reads as on-device; "in most
  // browsers" invites the owner to hope theirs is the exception, when every
  // browser that offers this API is one of the three named.
  assert.equal(code.includes('built-in web speech api'), false, '"built-in" reads as on-device');
  assert.equal(
    code.includes('in most browsers'),
    false,
    '"in most browsers" invites the owner to assume theirs is the local exception',
  );
});

test('WAKE — the retention bound is Zeno’s alone and says so about the audio', () => {
  // The buffer bounds what ZENO keeps. It says nothing about what the browser
  // maker keeps, and Zeno has no way to find out or to delete it. Stating the
  // bound without stating its edge is how a true sentence becomes a misleading
  // one.
  assert.ok(
    lower.includes('not zeno’s to bound'),
    'the retention label must say the browser maker’s copy is outside Zeno’s bound',
  );
  assert.ok(
    lower.includes('which zeno cannot see, limit or delete'),
    'the disclosure must say Zeno cannot see, limit or delete what the browser maker keeps',
  );
});

test('WAKE — the disclosure is actually delivered before the microphone opens', () => {
  // It used to call focus() on the confirm button, which is disabled until the
  // acknowledgement is ticked — and a disabled element cannot take focus, so the
  // call silently did nothing. The disclosure rendered, but a keyboard or
  // screen-reader owner was never moved to it and never heard it: a gate only in
  // the sighted-mouse case. Focus goes to the group, from the top.
  assert.equal(
    code.includes('ui.confirm.focus()'),
    false,
    'focus() on the disabled confirm button is a no-op — the disclosure is never delivered',
  );
  assert.ok(code.includes('ui.disclosure.focus()'), 'opening the disclosure must move focus into it');
  assert.ok(
    code.includes("disclosure.setattribute('tabindex', '-1')"),
    'the disclosure must be script-focusable, or focusing it is another silent no-op',
  );
});

test('WAKE — the copy the daemon actually serves has not drifted from this one', () => {
  // The front-end is authored here and MIRRORED into the daemon's public folder,
  // which is what a running Zeno serves. Every honesty assertion above reads the
  // copy in this package; if the served copy drifts, those assertions are
  // guarding a file nobody loads. Skipped when the daemon is not checked out
  // beside this package (a packaged build), asserted whenever it is.
  const served = fileURLToPath(new URL('../../../daemon/public/voice.js', import.meta.url));
  if (!existsSync(served)) return;
  assert.equal(
    readFileSync(served, 'utf8'),
    readFileSync(FRONTEND, 'utf8'),
    'packages/daemon/public/voice.js differs from packages/voice/public/voice.js — the served panel is not the audited one',
  );
});

test('WAKE — the pure core the browser imports has not drifted from the audited build', () => {
  // The drift guard above covers the panel. It does not cover the four modules
  // the panel IMPORTS — and those are where the law actually lives. Every safety
  // test in this package runs against `src/`; the browser runs hand-copied builds
  // of `dist/src/` sitting in the daemon's public folder. Nothing checked that
  // the two were the same file, so the entire proof could have been true of code
  // no browser ever loaded: `grammar.js` is where APPROVAL_BY_HAND is decided,
  // and a stale copy of it would refuse a narrower set of phrases than the tests
  // say it does, silently, on the only path a real owner uses.
  //
  // Skipped when the daemon is not checked out beside this package, or before a
  // build has produced dist — asserted whenever both are present.
  for (const mod of ['wake.js', 'grammar.js', 'listen.js', 'session.js']) {
    const built = fileURLToPath(new URL(`../src/${mod}`, import.meta.url));
    const served = fileURLToPath(new URL(`../../../daemon/public/${mod}`, import.meta.url));
    if (!existsSync(built) || !existsSync(served)) continue;
    assert.equal(
      readFileSync(served, 'utf8'),
      readFileSync(built, 'utf8'),
      `packages/daemon/public/${mod} differs from the compiled dist/src/${mod} — ` +
        'the browser is running a grammar these tests never checked',
    );
  }
});

// ---- DELEGATION: the honesty a spoken job demands ---------------------------
//
// Speaking can now start a coding agent. That is a bigger thing than proposing
// one file, and the two costs it can incur are exactly the ones a person cannot
// see: a hosted agent spends their money, and it sends their code off the
// machine. Neither is visible from the room, and neither is recoverable once
// spent — so the panel must say both BEFORE anything hosted runs, and must never
// start one from a sentence alone.
//
// These read the shipped front-end and pin that contract, for the same reason
// the wake-mode tests exist: the failure mode is drift. The sentence that names
// the cost is the first thing a later edit tidies away.

test('DELEGATE — the panel asks the daemon which agent would run BEFORE anything runs', () => {
  // `plan: true` is the call that starts nothing. Without it, the first thing
  // the owner learns about which agent heard them is the bill.
  assert.ok(code.includes('/delegate'), 'the delegation path must be here');
  assert.ok(
    code.includes('plan: true') || code.includes('plan:true'),
    'the panel must ask for a PLAN first — it is what lets it name the agent before it runs',
  );
});

test('DELEGATE — the panel never decides for itself which agent runs', () => {
  // The decision lives in the daemon. If this file worked it out from a model
  // list, a spoken delegation and a typed one could drift into disagreeing —
  // and the way that drift ends is a hosted agent starting because a browser
  // thought it was the local one.
  assert.equal(
    code.includes('/forge/agents'),
    false,
    'the panel reads the agent list to choose a rung itself — that decision belongs to the daemon',
  );
});

test('DELEGATE — a hosted agent is never started by speaking, and the panel says so', () => {
  assert.ok(
    lower.includes('a hosted agent is never started by voice') ||
      lower.includes('hosted agent waits behind a button'),
    'the panel must state that a hosted agent does not start from a spoken sentence',
  );
  // The confirmation must reach the owner with the cost in it. The daemon
  // supplies the reason; the panel must actually render it rather than dropping
  // it for a tidier button.
  assert.ok(
    lower.includes('will not run until you say so'),
    'the confirmation must say the run has not happened yet',
  );
  assert.ok(
    lower.includes('sends your code off this machine') || lower.includes('spends money and sends your code'),
    'the confirmation must name the egress, in the owner’s words',
  );
});

test('DELEGATE — a local run says where it runs and what it cannot do', () => {
  assert.ok(
    lower.includes('this runs on your machine'),
    'a local run must say it is local rather than leaving the owner to assume it',
  );
  assert.ok(
    lower.includes('your code does not leave it'),
    'and say what that means for their code',
  );
});

test('DELEGATE — what came back is described as WAITING, never as applied', () => {
  // The one sentence the whole chain exists to make true. A change an agent
  // wrote is a capsule; the verbs for it are "proposed" and "waiting".
  assert.ok(
    lower.includes('waiting for your approval'),
    'a finished run must say its changes are waiting for approval',
  );
  assert.ok(
    lower.includes('none of them has been applied'),
    'and must say plainly that nothing has been applied',
  );
  // No branch may claim otherwise. "applied"/"committed" may appear only inside
  // a sentence that denies it, which the two assertions above already pin — what
  // must never appear is the language of a completed effect.
  assert.equal(
    lower.includes('changes applied') || lower.includes('successfully applied') || lower.includes('committed to'),
    false,
    'the panel describes an agent’s output as applied — it is not, until the owner approves it',
  );
});
