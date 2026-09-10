'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWorkbenchZoom, nextLevel } = require('../zoom.cjs');

function harness(initial = 1) {
  const webContents = new EventEmitter();
  let zoom = initial;
  webContents.getZoomFactor = () => zoom;
  webContents.setZoomFactor = value => { zoom = value; };
  let prevented = 0;
  const key = (value, extra = {}) => webContents.emit(
    'before-input-event',
    { preventDefault: () => { prevented += 1; } },
    { type: 'keyDown', control: true, key: value, ...extra },
  );
  return { webContents, key, zoom: () => zoom, prevented: () => prevented };
}

test('Ctrl +/- changes workbench zoom and Ctrl 0 resets it', () => {
  const h = harness();
  installWorkbenchZoom(h.webContents);
  h.key('+');
  assert.equal(h.zoom(), 1.1);
  h.key('-');
  assert.equal(h.zoom(), 1);
  h.key('0');
  assert.equal(h.zoom(), 1);
  assert.equal(h.prevented(), 3);
});

test('zoom stays bounded and ignores unrelated or Alt-modified keys', () => {
  assert.equal(nextLevel(2, 1), 2);
  assert.equal(nextLevel(0.5, -1), 0.5);
  const h = harness(2);
  installWorkbenchZoom(h.webContents);
  h.key('+');
  h.key('x');
  h.key('-', { alt: true });
  assert.equal(h.zoom(), 2);
  assert.equal(h.prevented(), 1);
});

test('the returned disposer removes the shortcut listener', () => {
  const h = harness();
  const dispose = installWorkbenchZoom(h.webContents);
  dispose();
  h.key('+');
  assert.equal(h.zoom(), 1);
  assert.equal(h.prevented(), 0);
});
