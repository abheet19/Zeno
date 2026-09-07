/**
 * What the browser will and will not be told to do.
 *
 * Two things are proved here, and only one of them is "the parser works". The
 * other is the direction it fails in: an unknown operation, an unparseable URL,
 * a scheme that is not http(s) and a URL carrying a credential all end in a
 * refusal with a sentence. A bound that rounded down would produce a browser
 * that LOOKS bounded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_UNPROVEN_NOTE,
  MAX_SELECTOR_CHARS,
  MAX_TYPE_CHARS,
  MAX_URL_CHARS,
  navigableUrl,
  parseBrowseCall,
  readBrowserProbe,
} from '../src/index.js';

test('only http and https are navigable — file: is not a page, it is a second Read', () => {
  for (const bad of ['file:///C:/Users/abheet/.ssh/id_ed25519', 'data:text/html,<h1>hi', 'javascript:alert(1)']) {
    const v = navigableUrl(bad);
    assert.equal(v.ok, false, `${bad} must not be navigable`);
  }
  const good = navigableUrl('https://example.com/a?b=c');
  assert.equal(good.ok, true);
});

test('a URL Zeno cannot parse is refused rather than shown to the owner as-is', () => {
  assert.equal(navigableUrl('example.com').ok, false, 'no scheme is not a URL');
  assert.equal(navigableUrl('   ').ok, false);
  assert.equal(navigableUrl('https://x/' + 'a'.repeat(MAX_URL_CHARS)).ok, false);
});

test('a credential in the URL is refused — a capsule must never carry a secret', () => {
  const v = navigableUrl('https://user:hunter2@example.com/');
  assert.equal(v.ok, false);
  assert.match(v.ok === false ? v.reason : '', /credential/);
});

test('an operation the browser does not have is refused, not attempted', () => {
  const v = parseBrowseCall('download', { url: 'https://example.com' });
  assert.equal(v.ok, false);
  assert.match(v.ok === false ? v.reason : '', /not an operation/);
});

test('navigate carries exactly one field: the URL it was validated as', () => {
  const v = parseBrowseCall('navigate', { url: 'https://example.com', selector: 'body', extra: 'x' });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.deepEqual(Object.keys(v.request).sort(), ['op', 'url']);
    assert.equal(v.request.url, 'https://example.com/');
  }
});

test('click and type need an element, and both are bounded', () => {
  assert.equal(parseBrowseCall('click', {}).ok, false, 'no selector is not a click');
  assert.equal(parseBrowseCall('click', { selector: 'a'.repeat(MAX_SELECTOR_CHARS + 1) }).ok, false);
  assert.equal(parseBrowseCall('type', { selector: '#q', text: 'x'.repeat(MAX_TYPE_CHARS + 1) }).ok, false);
  const ok = parseBrowseCall('type', { selector: '#q', text: 'hello' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.request, { op: 'type', selector: '#q', text: 'hello' });
});

test('ping, read and screenshot take nothing', () => {
  for (const op of ['ping', 'read', 'screenshot']) {
    const v = parseBrowseCall(op, { url: 'file:///etc/passwd' });
    assert.equal(v.ok, true);
    if (v.ok) assert.deepEqual(v.request, { op });
  }
});

test('the liveness proof fails on silence, on a refusal, and on the wrong run', () => {
  assert.equal(readBrowserProbe('run-1', null).live, false);
  assert.equal(readBrowserProbe('run-1', { ok: false, detail: 'no window' }).live, false);
  const strayRun = readBrowserProbe('run-1', { ok: true, detail: 'up', title: 'run-2' });
  assert.equal(strayRun.live, false, 'a browser that belongs to another run is not this run’s browser');
  assert.equal(readBrowserProbe('run-1', { ok: true, detail: 'up', title: 'run-1' }).live, true);
});

test('the unproven note says the tools are absent, not merely refused', () => {
  assert.match(BROWSER_UNPROVEN_NOTE, /absent from the agent’s command line/);
});
