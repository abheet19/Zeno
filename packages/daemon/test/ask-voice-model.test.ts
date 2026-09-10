import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface DispatchToken {
  readonly id: number;
  readonly key: string;
}

interface DispatchGate {
  begin(key: string): DispatchToken | null;
  finish(token: DispatchToken): boolean;
  busy(): boolean;
  activeKey(): string | null;
}

interface InstalledVoice {
  readonly name: string;
  readonly voiceURI: string;
  readonly lang: string;
  readonly localService: boolean;
}

interface AskVoiceModel {
  createDispatchGate(limit?: number): DispatchGate;
  chooseSystemVoice(
    voices: readonly InstalledVoice[],
    savedVoiceUri: string,
    locale?: string,
  ): InstalledVoice | null;
  spokenReply(payload: unknown): string;
  captureOwnerLabel(owner: string): string;
}

const moduleUrl = new URL('../../public/ask-voice-model.js', import.meta.url).href;
const {
  captureOwnerLabel,
  chooseSystemVoice,
  createDispatchGate,
  spokenReply,
} = await import(moduleUrl) as AskVoiceModel;

test('dispatch gate admits one request and rejects a delivered voice capture replay', () => {
  const gate = createDispatchGate();
  const first = gate.begin('voice:7:0');
  assert.ok(first);
  assert.equal(gate.busy(), true);
  assert.equal(gate.activeKey(), 'voice:7:0');
  assert.equal(gate.begin('voice:8:0'), null, 'a second request cannot enter while one is active');
  assert.equal(gate.finish(first), true);
  assert.equal(gate.busy(), false);
  assert.equal(gate.begin('voice:7:0'), null, 'the same final-result delivery key cannot replay');

  const repeatedWords = gate.begin('typed:1');
  assert.ok(repeatedWords, 'typed submits use fresh action keys, so repeating text remains valid');
});

test('dispatch replay memory is bounded', () => {
  const gate = createDispatchGate(2);
  const first = gate.begin('capture-a');
  assert.ok(first);
  gate.finish(first);
  const second = gate.begin('capture-b');
  assert.ok(second);
  gate.finish(second);
  const third = gate.begin('capture-c');
  assert.ok(third);
  gate.finish(third);
  assert.ok(gate.begin('capture-a'), 'the oldest key is evicted instead of growing forever');
});

test('system voice selection honors the owner preference then a local locale match', () => {
  const voices: InstalledVoice[] = [
    { name: 'Remote UK', voiceURI: 'remote-uk', lang: 'en-GB', localService: false },
    { name: 'Local India', voiceURI: 'local-in', lang: 'en-IN', localService: true },
    { name: 'Local US', voiceURI: 'local-us', lang: 'en-US', localService: true },
  ];
  assert.equal(chooseSystemVoice(voices, 'remote-uk', 'en-IN')?.voiceURI, 'remote-uk');
  assert.equal(chooseSystemVoice(voices, '', 'en-IN')?.voiceURI, 'local-in');
  assert.equal(chooseSystemVoice([], '', 'en-IN'), null);
});

test('spoken replies preserve every owner-action boundary', () => {
  const hosted = spokenReply({
    answer: 'The repository is clean.',
    delegated: { needsConfirm: true, agentId: 'codex' },
  });
  assert.match(hosted, /has not started/i);
  assert.match(hosted, /on-screen button/i);
  assert.match(hosted, /Voice cannot start or approve/i);

  const proposal = spokenReply({ proposal: { relPath: 'README.md' } });
  assert.match(proposal, /waiting for your review/i);
  assert.match(proposal, /Voice cannot approve/i);

  const ungrounded = spokenReply({ flagged: 'unsupported' });
  assert.match(ungrounded, /could not verify/i);
});

test('capture labels are explicit and never imply speaker identity', () => {
  assert.equal(captureOwnerLabel('ask'), 'Ask Zeno voice conversation');
  assert.equal(captureOwnerLabel('counsel'), 'Counsel');
  assert.equal(captureOwnerLabel('command'), 'Command voice');
  assert.equal(captureOwnerLabel(''), 'another voice surface');
});

test('Ask voice wiring cannot approve and hosted work remains click-confirmed', () => {
  const source = readFileSync(new URL('../../public/ask.js', import.meta.url), 'utf8');
  assert.match(source, /fetch\('\/assistant\/ask'/);
  assert.doesNotMatch(source, /fetch\('\/approvals/);
  assert.match(source, /run\.addEventListener\('click', \(\) => void confirmHosted/);
  assert.match(source, /event\.detail\?\.requestedBy === 'Ask Zeno voice conversation'/);
  assert.ok(
    source.indexOf("document.body.dataset.zenoCapture = 'ask'") <
      source.indexOf("window.dispatchEvent(new CustomEvent('zeno:release-command-voice'"),
    'Ask reserves the microphone before asynchronous Command teardown',
  );
  assert.match(source, /SpeechRecognition/);
  assert.match(source, /speechSynthesis/);
  assert.match(source, /dataset\.zenoCapture = 'ask'/);
  assert.match(source, /Voice cannot approve/);
  assert.match(source, /Zeno does not identify who is speaking/);
  assert.match(source, /any clear speech near the microphone can become a turn/);
});

test('Command voice yields to every external microphone owner', () => {
  const source = readFileSync(new URL('../../public/voice.js', import.meta.url), 'utf8');
  assert.match(source, /function externalCaptureOwner\(\)/);
  assert.match(source, /owner !== '' && owner !== 'command'/);
  assert.match(source, /if \(externalCaptureOwner\(\)\)/);
  assert.match(source, /requestedBy/);
});

test('Command voice adds a spoken task only after the Work API proves the stored item', () => {
  const source = readFileSync(new URL('../../public/voice.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Add-task wiring is a later slice/);
  assert.match(source, /case 'add_task':\s+void addTask\(intent\)/);
  assert.match(source, /async function addTask\(intent\)[\s\S]*fetch\('\/work'/);
  assert.match(source, /headers: authHeaders\(\{ 'content-type': 'application\/json' \}\)/);
  assert.match(source, /String\(item\?\.title \|\| ''\) !== title/);
  assert.match(source, /new CustomEvent\('zeno:state'/);
});

test('Counsel only answers from saved meetings after active capture ends', () => {
  const source = readFileSync(new URL('../../public/counsel.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /askPrivately/);
  assert.match(source, /Live Q&A is off while this meeting is active/);
  assert.match(source, /S\.archive !== 'ok' \|\| CALL !== null/);
  assert.match(source, /input\.disabled = S\.asking \|\| S\.archive !== 'ok' \|\| CALL !== null/);
  assert.match(source, /requestedBy: 'Counsel'/);
  assert.match(source, /End and save the transcript first/);
});
