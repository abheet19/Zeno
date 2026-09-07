/**
 * The desk: one operation at a time, and every failure an answer rather than a
 * throw. Also the allowlist file, which is the owner's whole standing consent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeDesk } from '../src/desk.js';
import { addOrigin, hasAllowlist, readOriginPolicy, removeOrigin } from '../src/allowlist-node.js';

const ALLOW = () => ({ allowed: ['https://github.com'] });
const fast = { policy: ALLOW, operationTimeoutMs: 200, probeTimeoutMs: 200, pollParkMs: 60 };

test('a refused origin never reaches the wire — no poll ever sees it', async () => {
  const desk = chromeDesk(fast);
  const answer = await desk.ask('read', { origin: 'https://elsewhere.example' });
  assert.equal(answer.ok, false);
  assert.match(answer.detail, /not on your Chrome allowlist/);
  assert.equal(await desk.take(), null, 'nothing was queued for the browser');
  desk.close();
});

test('an approved operation reaches a parked poll, and its answer comes back', async () => {
  const desk = chromeDesk(fast);
  const polled = desk.take();
  const asked = desk.ask('click', { origin: 'https://github.com', selector: '#go' });
  const request = await polled;
  assert.equal(request?.op, 'click');
  assert.equal(request?.origin, 'https://github.com');
  assert.equal(desk.settle({ id: request!.id, ok: true, detail: 'clicked #go' }), true);
  assert.deepEqual(await asked, { id: request!.id, ok: true, detail: 'clicked #go' });
  desk.close();
});

test('a poll that arrives AFTER the request still finds it', async () => {
  const desk = chromeDesk(fast);
  const asked = desk.ask('read', { origin: 'https://github.com' });
  const request = await desk.take();
  assert.equal(request?.op, 'read');
  desk.settle({ id: request!.id, ok: true, detail: 'read the page', text: 'hello' });
  assert.equal((await asked).text, 'hello');
  desk.close();
});

test('ONE AT A TIME — a second operation is refused, never queued behind the first', async () => {
  const desk = chromeDesk(fast);
  const first = desk.ask('read', { origin: 'https://github.com' });
  const second = await desk.ask('click', { origin: 'https://github.com', selector: '#x' });
  assert.equal(second.ok, false);
  assert.match(second.detail, /one operation at a time/);
  const request = await desk.take();
  desk.settle({ id: request!.id, ok: true, detail: 'done' });
  assert.equal((await first).ok, true);
  desk.close();
});

test('a browser that never answers is a timeout with a sentence, not a hang', async () => {
  const desk = chromeDesk(fast);
  const answer = await desk.ask('read', { origin: 'https://github.com' });
  assert.equal(answer.ok, false);
  assert.match(answer.detail, /did not answer/);
  desk.close();
});

test('a stray or late answer is not believed', async () => {
  const desk = chromeDesk(fast);
  assert.equal(desk.settle({ id: 99, ok: true, detail: 'from nowhere' }), false);
  desk.close();
});

test('an unanswered poll comes back empty, and attachment is remembered', async () => {
  const desk = chromeDesk(fast);
  assert.equal(desk.attached(), false, 'nothing has polled yet');
  assert.equal(await desk.take(), null);
  assert.equal(desk.attached(), true);
  desk.close();
});

test('THE PROOF fails when nothing answers, and succeeds naming the profile', async () => {
  const dead = chromeDesk(fast);
  assert.equal((await dead.prove()).live, false);
  dead.close();

  const live = chromeDesk(fast);
  const proving = live.prove();
  const request = await live.take();
  assert.equal(request?.op, 'ping');
  live.settle({ id: request!.id, ok: true, detail: 'live', profile: 'owner@example.com' });
  const proof = await proving;
  assert.equal(proof.live, true);
  assert.equal(proof.profile, 'owner@example.com');
  live.close();
});

test('a closed desk answers everything the same true sentence, and releases what was waiting', async () => {
  const desk = chromeDesk(fast);
  const pending = desk.ask('read', { origin: 'https://github.com' });
  desk.close();
  assert.match((await pending).detail, /has ended/);

  const idle = chromeDesk(fast);
  const parked = idle.take(); // nothing outstanding, so this poll waits
  idle.close();
  assert.equal(await parked, null, 'a poll parked over a closing desk is released, not stranded');
  idle.close();
  assert.match((await desk.ask('read', { origin: 'https://github.com' })).detail, /has ended/);
  assert.equal(await desk.take(), null);
  desk.close(); // idempotent
});

test('THE ALLOWLIST FILE — absent is empty, never "anything"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-chrome-'));
  const path = join(dir, 'chrome-origins.json');
  try {
    assert.deepEqual(readOriginPolicy(path), { allowed: [] });
    assert.equal(hasAllowlist(path), false);

    writeFileSync(path, 'not json', 'utf8');
    assert.deepEqual(readOriginPolicy(path), { allowed: [] });
    writeFileSync(path, '"a string"', 'utf8');
    assert.deepEqual(readOriginPolicy(path), { allowed: [] });
    writeFileSync(path, '{"allowed": "nope"}', 'utf8');
    assert.deepEqual(readOriginPolicy(path).allowed, []);

    const added = addOrigin(path, 'https://github.com/anthropics');
    assert.deepEqual(added, { ok: true, origin: 'https://github.com', policy: { allowed: ['https://github.com'] } });
    assert.equal(hasAllowlist(path), true);
    assert.deepEqual(addOrigin(path, 'https://github.com').ok, true, 'adding twice is not an error');
    assert.equal(readOriginPolicy(path).allowed.length, 1);

    assert.equal(addOrigin(path, 'http://github.com').ok, false, 'https only, here as well as at use');
    const banked = addOrigin(path, 'https://paypal.com');
    assert.equal(banked.ok, false);
    assert.match((banked as { reason: string }).reason, /never-list/);

    assert.deepEqual(removeOrigin(path, 'https://github.com').allowed, []);
    assert.deepEqual(removeOrigin(path, 'not a url').allowed, [], 'a nonsense removal changes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an owner-extended never-list survives a write and still refuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zeno-chrome-'));
  const path = join(dir, 'chrome-origins.json');
  try {
    writeFileSync(path, JSON.stringify({ allowed: [], neverExtra: ['acme.test'] }), 'utf8');
    assert.equal(addOrigin(path, 'https://intranet.acme.test').ok, false);
    assert.equal(addOrigin(path, 'https://ok.example').ok, true);
    assert.deepEqual(readOriginPolicy(path).neverExtra, ['acme.test'], 'their own never-list is not lost by a widening');
    assert.deepEqual(removeOrigin(path, 'https://ok.example').neverExtra, ['acme.test']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an answer bearing the WRONG id, while a real one is outstanding, is not believed', async () => {
  const desk = chromeDesk(fast);
  const asked = desk.ask('read', { origin: 'https://github.com' });
  const request = await desk.take();
  assert.equal(desk.settle({ id: request!.id + 500, ok: true, detail: 'not yours' }), false);
  desk.settle({ id: request!.id, ok: true, detail: 'yours' });
  assert.equal((await asked).detail, 'yours');
  desk.close();
});

test('closing an idle desk releases nothing and throws nothing', () => {
  const desk = chromeDesk({ policy: ALLOW });
  desk.close();
  assert.equal(desk.attached(), false);
});

test('the desk works on its own default timings, with no test overrides', async () => {
  const desk = chromeDesk({ policy: ALLOW });
  const proving = desk.prove();
  const request = await desk.take();
  desk.settle({ id: request!.id, ok: true, detail: 'live', profile: 'owner@example.com' });
  assert.equal((await proving).live, true);
  desk.close();
});
