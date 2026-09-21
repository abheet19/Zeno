import assert from 'node:assert/strict';
import test from 'node:test';
import { stripWholeFileMarkdownFence } from '../src/routes/forge-local-model.js';

test('a whole-file Python Markdown fence is removed from a FILE envelope body', () => {
  const fenced = '```python\nfrom __future__ import annotations\n\ndef answer() -> int:\n    return 42\n```';
  assert.equal(
    stripWholeFileMarkdownFence(fenced),
    'from __future__ import annotations\n\ndef answer() -> int:\n    return 42',
  );
});

test('unfenced file bytes and legitimate internal fences remain unchanged', () => {
  const unfenced = '# Guide\n\n```python\nprint("kept")\n```\n\nAfter the example.\n';
  assert.equal(stripWholeFileMarkdownFence(unfenced), unfenced);
});
