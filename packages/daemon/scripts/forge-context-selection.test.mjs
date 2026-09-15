import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeState, withContextSelection } from '../public/bind/forge/state.js';

test('Forge Lens, Plan and Run share the same skill/rule request selection', () => {
  const state = createForgeState();
  state.selectedSkillIds.add('verify');

  assert.deepEqual(withContextSelection(state, { task: 'inspect this repository' }), {
    task: 'inspect this repository',
    skillIds: ['verify'],
  });

  state.ruleSelectionExplicit = true;
  state.selectedRuleIds.add('claude-md');
  assert.deepEqual(withContextSelection(state, { task: 'inspect this repository' }), {
    task: 'inspect this repository',
    skillIds: ['verify'],
    ruleIds: ['claude-md'],
  });

  state.selectedRuleIds.clear();
  assert.deepEqual(withContextSelection(state, { task: 'inspect this repository' }), {
    task: 'inspect this repository',
    skillIds: ['verify'],
    ruleIds: [],
  });
});
