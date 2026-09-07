/**
 * One operation on the wire: what survives validation, and what never does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME_OPS, MAX_SELECTOR_CHARS, MAX_TYPE_CHARS, parseChromeCall } from '../src/protocol.js';
import { readChromeProbe, CHROME_PROVEN_NOTE } from '../src/probe.js';

const ALLOW = { allowed: ['https://github.com'] };

test('every operation is one of six, and an invented verb is refused', () => {
  assert.deepEqual([...CHROME_OPS], ['ping', 'navigate', 'read', 'click', 'type', 'screenshot']);
  const v = parseChromeCall('evaluate', { origin: 'https://github.com' }, ALLOW);
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /not an operation/);
});

test('ping is the one operation with no origin — it asks the extension about itself', () => {
  assert.deepEqual(parseChromeCall('ping', {}, { allowed: [] }), { ok: true, request: { op: 'ping' } });
});

test('EVERY other operation carries an explicit origin, and it is origin-checked here', () => {
  for (const op of ['read', 'screenshot', 'click', 'type']) {
    const missing = parseChromeCall(op, { selector: 'button' }, ALLOW);
    assert.equal(missing.ok, false, `${op} without an origin must be refused`);
    const off = parseChromeCall(op, { origin: 'https://elsewhere.example', selector: 'button' }, ALLOW);
    assert.equal(off.ok, false, `${op} at a non-allowlisted origin must be refused before a capsule exists`);
  }
});

test('navigate takes the full URL and keeps path and query, with the origin beside it', () => {
  const v = parseChromeCall('navigate', { url: 'https://github.com/a/b?c=1' }, ALLOW);
  assert.deepEqual(v, { ok: true, request: { op: 'navigate', origin: 'https://github.com', url: 'https://github.com/a/b?c=1' } });
});

test('navigate to a never-listed origin is refused even when the owner allowlisted it', () => {
  const v = parseChromeCall('navigate', { url: 'https://mail.google.com/mail/u/0' }, { allowed: ['https://mail.google.com'] });
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /never-list/);
});

test('click and type need a selector, and the bounds are real', () => {
  assert.equal(parseChromeCall('click', { origin: 'https://github.com', selector: '  ' }, ALLOW).ok, false);
  assert.equal(
    parseChromeCall('click', { origin: 'https://github.com', selector: 'a'.repeat(MAX_SELECTOR_CHARS + 1) }, ALLOW).ok,
    false,
  );
  assert.equal(
    parseChromeCall('type', { origin: 'https://github.com', selector: '#q', text: 'x'.repeat(MAX_TYPE_CHARS + 1) }, ALLOW).ok,
    false,
  );
  assert.deepEqual(parseChromeCall('type', { origin: 'https://github.com', selector: '#q', text: 'hi' }, ALLOW), {
    ok: true,
    request: { op: 'type', origin: 'https://github.com', selector: '#q', text: 'hi' },
  });
  assert.deepEqual(parseChromeCall('click', { origin: 'https://github.com', selector: '#go' }, ALLOW), {
    ok: true,
    request: { op: 'click', origin: 'https://github.com', selector: '#go' },
  });
});

test('read and screenshot survive as bare origin-bearing requests', () => {
  for (const op of ['read', 'screenshot'] as const) {
    assert.deepEqual(parseChromeCall(op, { origin: 'https://github.com' }, ALLOW), { ok: true, request: { op, origin: 'https://github.com' } });
  }
});

test('a non-object input is refused rather than read as an empty one', () => {
  assert.equal(parseChromeCall('read', null, ALLOW).ok, false);
  assert.equal(parseChromeCall('read', 'https://github.com', ALLOW).ok, false);
});

test('THE PROOF — nothing but an unambiguous, profile-naming answer is live', () => {
  assert.equal(readChromeProbe(null).live, false);
  assert.equal(readChromeProbe({ ok: false, detail: 'no host' }).live, false);
  assert.equal(readChromeProbe({ ok: true }).live, false, 'an answer that cannot name the profile is not one to show on a capsule');
  assert.equal(readChromeProbe({ ok: true, profile: '   ' }).live, false);
  assert.deepEqual(readChromeProbe({ ok: true, profile: ' owner@example.com ' }), {
    live: true,
    note: CHROME_PROVEN_NOTE,
    profile: 'owner@example.com',
  });
});
