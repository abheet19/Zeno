/**
 * Risk assessment — deciding when to interrupt the owner.
 *
 * The failure mode being defended against is NOT "something risky slipped
 * through". It is "the owner was asked so often that they stopped reading". Both
 * directions are tested here: routine work must not interrupt, and the four
 * things that are never routine must always interrupt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kernel, assessWrite, isSensitivePath, ROUTINE_LINE_BUDGET } from '../src/index.js';
import { TestWorld, buildRequest, okExecutor } from './harness.js';

const SRC = 'src/components/Card.tsx';

test('a one-line edit to an ordinary file is ROUTINE — no approval owed', () => {
  const before = 'export const Card = () => <article />;\n';
  const after = 'export const Card = () => <article className="card" />;\n';
  const r = assessWrite(SRC, before, after);
  assert.equal(r.routine, true);
  assert.equal(r.kind, 'local.write');
  assert.ok(r.reasons.length > 0, 'even a routine decision explains itself');
});

test('creating an ordinary new source file is ROUTINE', () => {
  const r = assessWrite(SRC, null, 'export const Card = () => null;\n');
  assert.equal(r.routine, true);
  assert.equal(r.kind, 'local.write');
  assert.match(r.reasons[0]!, /creates/);
});

test('a rewrite wearing an edit\'s clothes is NOT routine', () => {
  const before = 'a\n';
  const after = Array.from({ length: ROUTINE_LINE_BUDGET + 10 }, (_, i) => `line ${i}`).join('\n');
  const r = assessWrite(SRC, before, after);
  assert.equal(r.routine, false);
  assert.equal(r.kind, 'patch.task');
  assert.match(r.reasons[0]!, /line budget|lines change/);
});

test('emptying a file is DESTRUCTIVE, however small the file', () => {
  const r = assessWrite(SRC, 'export const Card = () => null;\n', '   \n');
  assert.equal(r.kind, 'destructive');
  assert.equal(r.routine, false);
  assert.match(r.reasons[0]!, /emptied/);
});

test('gutting most of a file is DESTRUCTIVE even though it is still non-empty', () => {
  const before = 'x'.repeat(1000);
  const r = assessWrite(SRC, before, 'x'.repeat(50));
  assert.equal(r.kind, 'destructive');
  assert.match(r.reasons[0]!, /lose most of its content/);
});

test('SENSITIVE files are never routine, even for a one-character change', () => {
  const cases: readonly string[] = [
    'package.json',
    'package-lock.json',
    '.env',
    '.env.local',
    '.github/workflows/ci.yml',
    'Dockerfile',
    'tsconfig.json',
    'certs/server.key',
    'src/.git/config',
    'CLAUDE.md',
    '.npmrc',
  ];
  for (const path of cases) {
    assert.equal(isSensitivePath(path), true, `${path} must be sensitive`);
    const r = assessWrite(path, 'a\n', 'b\n');
    assert.equal(r.routine, false, `a one-line change to ${path} must still stop`);
    assert.equal(r.kind, 'patch.task');
  }
});

test('escalation only ever goes UP — a tiny edit to a sensitive file stays sensitive', () => {
  const tiny = assessWrite('src/App.tsx', 'a\n', 'b\n');
  assert.equal(tiny.routine, true, 'the same tiny edit elsewhere is routine');
  const sensitive = assessWrite('.env', 'a\n', 'b\n');
  assert.equal(sensitive.routine, false, 'so the path, not the size, is what escalated it');
});

test('destructive beats sensitive — the loudest reason wins', () => {
  const r = assessWrite('package.json', '{"a":1}'.repeat(60), '');
  assert.equal(r.kind, 'destructive', 'emptying a config file is destruction, not configuration');
});

test('END TO END — a routine edit auto-applies, a sensitive one waits for the owner', async () => {
  const world = new TestWorld();
  const kernel = new Kernel(world);

  const routine = assessWrite('src/Card.tsx', 'a\n', 'b\n');
  const routinePv = kernel.preview({ ...buildRequest(world, { kind: routine.kind }), kind: routine.kind });
  assert.equal(routinePv.tier, 'T0');
  assert.equal(routinePv.auto, true, 'ordinary work does not interrupt');
  assert.equal((await kernel.commit(routinePv.actionHash, okExecutor())).outcome, 'verified');

  const risky = assessWrite('.env', 'a\n', 'b\n');
  const riskyPv = kernel.preview({ ...buildRequest(world, { kind: risky.kind }), kind: risky.kind });
  assert.equal(riskyPv.tier, 'T1');
  assert.equal(riskyPv.auto, false, 'and the risky one still stops');
});

test('a routine action is still RECEIPTED — unattended is not unrecorded', async () => {
  const world = new TestWorld();
  const kernel = new Kernel(world);
  const pv = kernel.preview(buildRequest(world, { kind: 'local.write' }));
  assert.equal(pv.auto, true);
  const receipt = await kernel.commit(pv.actionHash, okExecutor());
  assert.equal(receipt.outcome, 'verified');
  assert.equal(kernel.receipts().length, 1, 'every routine change leaves a record');
  assert.equal(kernel.verifyChain().ok, true);
});
