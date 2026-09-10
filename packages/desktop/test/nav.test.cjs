'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../../daemon/public/nav.js'), 'utf8');

class FakeElement {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle: () => {} };
    this.parentElement = null;
    this.textContent = '';
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatchEvent() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  closest() { return this.parentElement; }
  click() { this.listeners.get('click')?.({}); }
  focus() {}
}

function runNav(saved = null) {
  const navRoot = new FakeElement();
  const items = ['command', 'forge', 'counsel'].map(name => {
    const item = new FakeElement({ nav: name });
    item.parentElement = navRoot;
    return item;
  });
  const sections = ['command', 'forge', 'counsel'].map(name => new FakeElement({ surface: name }));
  const wordmark = new FakeElement();
  const root = new FakeElement();
  const document = {
    title: 'stale title',
    documentElement: root,
    activeElement: null,
    querySelectorAll(selector) {
      if (selector === '[data-nav]') return items;
      if (selector === '[data-surface]') return sections;
      return [];
    },
    querySelector(selector) { return selector === '.brand-word' ? wordmark : null; },
    addEventListener() {},
  };
  const context = {
    document,
    Element: FakeElement,
    CustomEvent: class CustomEvent {},
    console,
    localStorage: { getItem: () => saved, setItem() {} },
    window: {},
  };
  vm.runInNewContext(source, context);
  return { document, items, sections, wordmark, root };
}

test('the native title and visible compound mark follow the active product', () => {
  const h = runNav('forge');
  assert.equal(h.document.title, 'Zeno Forge');
  assert.equal(h.wordmark.textContent, 'Zeno Forge');
  assert.equal(h.root.attributes.get('data-zeno-surface'), 'forge');

  h.items.find(item => item.dataset.nav === 'counsel').click();
  assert.equal(h.document.title, 'Zeno Counsel');
  assert.equal(h.wordmark.textContent, 'Zeno Counsel');
  assert.equal(h.root.attributes.get('data-zeno-surface'), 'counsel');

  h.items.find(item => item.dataset.nav === 'command').click();
  assert.equal(h.document.title, 'Zeno Command');
  assert.equal(h.wordmark.textContent, 'Zeno Command');
});
