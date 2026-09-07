/**
 * The origin rules — the whole difference between this package and the
 * sandboxed window, so it is tested as the load-bearing thing it is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrigin, hostMatches, neverCategory, parseOrigin, NEVER_ORIGINS } from '../src/origins.js';

const ALLOW = { allowed: ['https://github.com', 'https://docs.example.com'] };

test('https only — every other scheme is refused before any capsule exists', () => {
  for (const bad of ['http://github.com', 'file:///C:/Users/abheet', 'data:text/html,x', 'chrome://settings', 'javascript:alert(1)']) {
    const v = decideOrigin(bad, ALLOW);
    assert.equal(v.ok, false, `${bad} must be refused`);
  }
  assert.equal(decideOrigin('https://github.com/anthropics/x', ALLOW).ok, true);
});

test('a credential in the URL is never put on a capsule', () => {
  const v = parseOrigin('https://user:secret@github.com');
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /username or password/);
});

test('an unparseable or empty origin is refused with a sentence, not a crash', () => {
  assert.equal(parseOrigin('   ').ok, false);
  assert.equal(parseOrigin('not a url').ok, false);
  assert.equal(parseOrigin('https://' + 'a'.repeat(3000) + '.com').ok, false);
});

test('an origin the owner has not allowlisted is refused, and the reason says adding one is THEIR act', () => {
  const v = decideOrigin('https://example.com', ALLOW);
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /not on your Chrome allowlist/);
  assert.match((v as { reason: string }).reason, /your own act/);
});

test('THE NEVER-LIST BEATS THE ALLOWLIST — an owner cannot allowlist their bank', () => {
  const permissive = { allowed: ['https://mail.google.com', 'https://paypal.com', 'https://console.aws.amazon.com'] };
  for (const origin of permissive.allowed) {
    const v = decideOrigin(origin, permissive);
    assert.equal(v.ok, false, `${origin} is on the never-list and the allowlist must not override it`);
    assert.match((v as { reason: string }).reason, /never-list/);
  }
});

test('the never-list matches subdomains on label boundaries, never as a substring', () => {
  assert.equal(neverCategory('www.paypal.com'), NEVER_ORIGINS[2]!.category);
  assert.equal(neverCategory('paypal.com'), NEVER_ORIGINS[2]!.category);
  assert.equal(neverCategory('notpaypal.com'), null, 'a substring is not a match');
  assert.equal(hostMatches('a.b.example.com', 'example.com'), true);
  assert.equal(hostMatches('badexample.com', 'example.com'), false);
});

test('a banking LABEL is caught without being named, and a word containing it is not', () => {
  assert.match(String(neverCategory('netbanking.example.co')), /banking or payments/);
  assert.match(String(neverCategory('bank.someregional.com')), /banking or payments/);
  assert.equal(neverCategory('burbank.com'), null, '"burbank" is not the label "bank"');
});

test('the owner can EXTEND the never-list, and their extension is honoured', () => {
  const policy = { allowed: ['https://intranet.acme.test'], neverExtra: ['acme.test', '  '] };
  const v = decideOrigin('https://intranet.acme.test', policy);
  assert.equal(v.ok, false);
  assert.match((v as { reason: string }).reason, /your own never-list/);
});

test('an allowlisted, non-never origin is allowed and comes back normalised', () => {
  const v = decideOrigin('https://github.com:443/some/path?q=1', ALLOW);
  assert.deepEqual(v, { ok: true, origin: 'https://github.com' });
});

test('a malformed entry in the owner\'s own allowlist grants nothing', () => {
  assert.equal(decideOrigin('https://example.com', { allowed: ['not a url', ''] }).ok, false);
});

test('a URL with no host is refused', () => {
  assert.equal(parseOrigin('https:').ok, false);
});

test('a policy with no neverExtra at all still decides', () => {
  assert.equal(decideOrigin('https://github.com', { allowed: ['https://github.com'] }).ok, true);
  assert.equal(neverCategory('github.com'), null);
});
