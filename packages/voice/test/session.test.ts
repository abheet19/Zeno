/**
 * The session: wake -> grammar, and the injected recognizer. No audio is touched
 * — a fake recognizer replays fixed transcripts, which is the whole point of the
 * port. The front-end swaps in webkitSpeechRecognition and gets the same path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpret,
  VoiceSession,
  IDLE_NOT_ADDRESSED,
  EMPTY_COMMAND,
  type Recognizer,
  type Outcome,
} from '../src/index.js';

/** A recognizer that hands over a callback we can fire by hand. */
class FakeRecognizer implements Recognizer {
  private cb: ((text: string) => void) | null = null;
  onTranscript(cb: (text: string) => void): void {
    this.cb = cb;
  }
  say(text: string): void {
    assert.notEqual(this.cb, null, 'nothing subscribed to the recognizer');
    this.cb!(text);
  }
}

test('interpret — a full utterance becomes an intent outcome', () => {
  const out = interpret('zeno, add a card component');
  assert.equal(out.kind, 'intent');
  assert.equal(out.kind === 'intent' && out.intent.kind, 'propose_write');
});

test('interpret — no wake phrase is idle, with a reason', () => {
  const out = interpret('what a lovely day');
  assert.equal(out.kind, 'idle');
  assert.equal(out.kind === 'idle' && out.reason, IDLE_NOT_ADDRESSED);
});

test('interpret — a bare wake word is idle with the empty-command reason', () => {
  const out = interpret('zeno');
  assert.equal(out.kind, 'idle');
  assert.equal(out.kind === 'idle' && out.reason, EMPTY_COMMAND);
});

test('interpret — an unrecognized command is an INTENT outcome, not idle', () => {
  // "Zeno heard you but did not understand" is not the same as "not listening".
  const out = interpret('zeno, do a barrel roll');
  assert.equal(out.kind, 'intent');
  assert.equal(out.kind === 'intent' && out.intent.kind, 'unrecognized');
});

test('VoiceSession wires an injected recognizer to the pure pipeline', () => {
  const rec = new FakeRecognizer();
  const seen: Array<{ outcome: Outcome; text: string }> = [];
  new VoiceSession(rec, (outcome, text) => seen.push({ outcome, text }));

  rec.say('zeno, remind me to call the bank');
  rec.say('the cat is on the mat');

  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.outcome.kind, 'intent');
  const first = seen[0]!.outcome;
  assert.equal(first.kind === 'intent' && first.intent.kind, 'add_task');
  assert.equal(seen[0]!.text, 'zeno, remind me to call the bank', 'the raw transcript is handed back for display');
  assert.equal(seen[1]!.outcome.kind, 'idle');
});
