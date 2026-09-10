'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CANDIDATES,
  classifyMeetingTitle,
  createMeetingPresenceHandler,
  detectMeetingPresence,
} = require('../meeting-presence.cjs');

test('meeting titles are classified only when the title carries a call signal', () => {
  const positive = new Map([
    ['Zoom Meeting', 'Zoom'],
    ['Planning meeting - Zoom Workplace', 'Zoom'],
    ['Architecture review | Microsoft Teams meeting', 'Microsoft Teams'],
    ['Call with Priya | Microsoft Teams', 'Microsoft Teams'],
    ['Meet - abc-defg-hij', 'Google Meet'],
    ['Project sync - Google Meet', 'Google Meet'],
    ['Design huddle | Acme | Slack', 'Slack'],
    ['Voice call — Discord', 'Discord'],
    ['Quarterly meeting | Webex', 'Webex'],
  ]);
  for (const [title, provider] of positive) assert.equal(classifyMeetingTitle(title), provider, title);

  for (const title of [
    'Zoom Workplace',
    'Microsoft Teams',
    'Slack',
    'Discord',
    'Google Meet',
    'Meeting notes about Zoom in Visual Studio Code',
    'Call documentation - Google Chrome',
  ]) assert.equal(classifyMeetingTitle(title), null, title);
});

test('desktop detection requests names only and exposes no general window inventory', async () => {
  let options;
  const desktopCapturer = {
    async getSources(received) {
      options = received;
      return [
        { id: 'window:secret:1', name: 'Password Manager' },
        { id: 'window:secret:2', name: 'Zoom Meeting' },
        { id: 'window:secret:3', name: 'Zoom Meeting' },
        { id: 'window:secret:4', name: 'Design huddle | Slack' },
      ];
    },
  };
  const result = await detectMeetingPresence(desktopCapturer);
  assert.deepEqual(options, {
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  assert.equal(result.status, 'detected');
  assert.equal(result.candidates.length, 2, 'duplicate window titles are collapsed');
  assert.deepEqual(result.candidates.map((c) => c.provider), ['Zoom', 'Slack']);
  assert.doesNotMatch(JSON.stringify(result), /Password Manager|window:secret/);
  assert.ok(result.candidates.every((c) => /^[a-f0-9]{24}$/.test(c.key)));
});

test('candidate results are bounded and control characters are removed', async () => {
  const desktopCapturer = {
    async getSources() {
      return Array.from({ length: 30 }, (_, i) => ({ name: `\u0000Meet - room-${String(i).padStart(3, '0')}-call` }));
    },
  };
  const result = await detectMeetingPresence(desktopCapturer);
  assert.equal(result.candidates.length, MAX_CANDIDATES);
  assert.ok(result.candidates.every((candidate) => !/[\u0000-\u001F\u007F]/.test(candidate.title)));
});

test('a capturer failure is a truthful unavailable result with no diagnostic leak', async () => {
  const result = await detectMeetingPresence({
    async getSources() { throw new Error('private operating-system detail'); },
  });
  assert.equal(result.supported, false);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.candidates, []);
  assert.doesNotMatch(JSON.stringify(result), /private operating-system detail/);
});

test('the IPC handler refuses untrusted frames before enumerating windows', async () => {
  let calls = 0;
  const handler = createMeetingPresenceHandler({
    desktopCapturer: { async getSources() { calls += 1; return []; } },
    trustedFrame: () => false,
  });
  const result = await handler({});
  assert.equal(result.status, 'unavailable');
  assert.equal(calls, 0);
});
