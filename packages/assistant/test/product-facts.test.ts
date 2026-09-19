import assert from 'node:assert/strict';
import test from 'node:test';
import { answerProductQuestion, PRODUCT_FACTS_VERSION } from '../src/product-facts.js';

test('Forge has a deterministic, cited and honest product answer', () => {
  const result = answerProductQuestion('What is Forge?');
  assert.ok(result);
  assert.match(result.answer, /bounded repository context/);
  assert.match(result.answer, /Claude Code and Codex provide their own inner reasoning/);
  assert.match(result.answer, /local Ollama path is currently a single bounded/);
  assert.deepEqual(result.cited, [{ id: 'z-forge', source: `Zeno product facts ${PRODUCT_FACTS_VERSION}: Forge` }]);
});

test('all product surfaces are recognized without matching ordinary questions', () => {
  for (const product of ['Command', 'Counsel', 'Vault', 'Voice']) {
    assert.ok(answerProductQuestion(`How does ${product} work?`), product);
  }
  assert.equal(answerProductQuestion('How does a B-tree work?'), null);
  assert.equal(answerProductQuestion('Open Forge'), null);
});

test('compound product questions explain every named surface and their boundary', () => {
  const result = answerProductQuestion('What does Forge do, and how does it relate to Command?');
  assert.ok(result);
  assert.match(result.answer, /Command is Zeno’s local control plane/);
  assert.match(result.answer, /Forge is Zeno’s governed coding workspace/);
  assert.match(result.answer, /started through Forge’s own governed run path/);
  assert.deepEqual(result.cited.map((citation) => citation.id), ['z-command', 'z-forge']);
});

test('product facts state limitations instead of promoting unverified capabilities', () => {
  assert.match(answerProductQuestion('What is Counsel?')?.answer ?? '', /must be verified/);
  assert.match(answerProductQuestion('What is Voice?')?.answer ?? '', /Browser mode has no local speech bridge/);
  assert.match(answerProductQuestion('What is Vault?')?.answer ?? '', /context, not authority/);
});
