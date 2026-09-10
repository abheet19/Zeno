import { test } from 'node:test';
import assert from 'node:assert/strict';

interface ForgeContextModel {
  readonly DEFAULT_FORGE_MEMORY_ENABLED: boolean;
  newForgeContextState(): {
    memoryEnabled: boolean;
    contextPreview: unknown;
    contextPreviewKey: string;
  };
  forgeContextKey(task: string, memoryEnabled: boolean, skillIds: readonly string[]): string;
  forgeContextBody(task: string, memoryEnabled: boolean, skillIds: readonly string[]): {
    task: string;
    memoryEnabled: boolean;
    skillIds: string[];
  };
}

const moduleUrl = new URL('../../public/forge-context-model.js', import.meta.url).href;
const model = await import(moduleUrl) as ForgeContextModel;

test('each new Forge session enables durable Vault recall by default', () => {
  const first = model.newForgeContextState();
  const afterRendererReload = model.newForgeContextState();
  assert.equal(model.DEFAULT_FORGE_MEMORY_ENABLED, true);
  assert.equal(first.memoryEnabled, true);
  assert.equal(afterRendererReload.memoryEnabled, true);
  first.memoryEnabled = false;
  assert.equal(afterRendererReload.memoryEnabled, true, 'the per-session switch is not a global Vault switch');
});

test('Lens preflight and run use one explicit context wire shape', () => {
  const disabled = model.forgeContextBody('  fix receipts  ', false, ['review']);
  assert.deepEqual(disabled, {
    task: 'fix receipts',
    memoryEnabled: false,
    skillIds: ['review'],
  });
  assert.notEqual(
    model.forgeContextKey(disabled.task, false, disabled.skillIds),
    model.forgeContextKey(disabled.task, true, disabled.skillIds),
    'changing the memory switch invalidates the reviewed context binding',
  );
  assert.notEqual(
    model.forgeContextKey(disabled.task, false, disabled.skillIds),
    model.forgeContextKey(disabled.task, false, ['different']),
    'changing selected skills also invalidates it',
  );
});
