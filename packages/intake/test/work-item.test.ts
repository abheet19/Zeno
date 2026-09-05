/**
 * The port's two pure functions.
 *
 * `dedupe` is what stops a five-minute poll from re-proposing the same task
 * twelve times an hour, and `toSummary` is the single line the owner reads before
 * they approve — so its failure modes are tested as hard as its happy path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, oneLine, toSummary, workItemKey } from '../src/work-item.js';
import type { WorkItem } from '../src/work-item.js';

const T1 = '2026-09-04T09:00:00.000Z';
const T2 = '2026-09-04T09:05:00.000Z';

function item(over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'local:1',
    source: 'local',
    title: 'Fix the flaky login test',
    body: 'It fails about one run in five on CI.',
    url: null,
    updatedAt: T1,
    labels: [],
    ...over,
  };
}

test('dedupe: a re-poll of an UNCHANGED item yields nothing new', () => {
  const batch = [item(), item({ id: 'local:2', title: 'Write the README' })];

  const first = dedupe(batch);
  assert.equal(first.fresh.length, 2, 'the first poll sees both');

  const second = dedupe(batch, first.seen);
  assert.deepEqual(second.fresh, [], 'the second poll sees nothing — this is the whole point');
  assert.equal(second.seen.size, 2, 'and remembers exactly the same two keys');
});

test('dedupe: a NEW updatedAt on the same id is fresh again', () => {
  const before = item();
  const first = dedupe([before]);

  const after = item({ updatedAt: T2, title: 'Fix the flaky login test (now blocking release)' });
  const second = dedupe([after], first.seen);

  assert.equal(second.fresh.length, 1, 'the item changed, so it is worth looking at again');
  assert.equal(second.fresh[0]!.title, after.title);
  assert.equal(second.seen.size, 2, 'both versions are now remembered');

  // ...and the changed version does not come back a second time either.
  assert.deepEqual(dedupe([after], second.seen).fresh, []);
});

test('dedupe: duplicates WITHIN one batch collapse, first occurrence wins', () => {
  const a = item({ title: 'first copy' });
  const b = item({ title: 'second copy' }); // same id + updatedAt
  const { fresh } = dedupe([a, b, item({ id: 'local:2' })]);

  assert.equal(fresh.length, 2);
  assert.equal(fresh[0]!.title, 'first copy', 'order is first-seen, not last-wins');
  assert.equal(fresh[1]!.id, 'local:2');
});

test('dedupe: neither argument is mutated — it is a function, not a queue', () => {
  const batch = [item()];
  const seen = new Set<string>(['pre-existing']);
  const result = dedupe(batch, seen);

  assert.equal(seen.size, 1, 'the caller’s set is untouched');
  assert.equal(result.seen.size, 2);
  assert.equal(batch.length, 1);
});

test('dedupe: an id cannot forge another item’s key', () => {
  // Naively joining id and updatedAt with a separator would make these two
  // items collide, and the second would be silently swallowed forever.
  const forger = item({ id: 'local:1', updatedAt: 'x' });
  const target = item({ id: 'local:1|x', updatedAt: '' });
  assert.notEqual(workItemKey(forger), workItemKey(target));
  assert.equal(dedupe([forger, target]).fresh.length, 2);
});

test('workItemKey is stable for the same (id, updatedAt) and only that', () => {
  assert.equal(workItemKey(item()), workItemKey(item({ title: 'a completely different title' })));
  assert.notEqual(workItemKey(item()), workItemKey(item({ updatedAt: T2 })));
  assert.notEqual(workItemKey(item()), workItemKey(item({ id: 'local:2' })));
});

test('GOLDEN — the capsule sentence, with labels and without', () => {
  assert.equal(
    toSummary(item({ labels: ['bug', 'ui'] })),
    'local:1 — "Fix the flaky login test" [bug, ui] (updated 2026-09-04T09:00:00.000Z)',
  );
  assert.equal(
    toSummary(item({ id: 'github:abheet19/zeno#12', source: 'github' })),
    'github:abheet19/zeno#12 — "Fix the flaky login test" (updated 2026-09-04T09:00:00.000Z)',
  );
});

test('toSummary is one line even when the item is not', () => {
  const nasty = item({ title: 'line one\nline two\r\nline three\tand a tab' });
  const summary = toSummary(nasty);
  assert.equal(summary.includes('\n'), false);
  assert.equal(summary.includes('\r'), false);
  assert.equal(summary.includes('\t'), false);
  assert.ok(summary.includes('line one line two line three and a tab'), summary);
});

test('toSummary strips bidi overrides — the capsule must read as it is written', () => {
  // A right-to-left override can make the rendered sentence say something other
  // than the string it contains. The owner approves what they READ.
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const summary = toSummary(item({ title: `delete${rlo} nothing${zwsp} important` }));
  assert.equal(summary.includes(rlo), false, 'no bidi override survives');
  assert.equal(summary.includes(zwsp), false, 'no zero-width character survives');
  assert.ok(summary.includes('delete nothing important'));
});

/**
 * The bidi-override test above proves ONE code point. This proves the contract.
 *
 * Without it the range list is a claim no test reads: narrowing
 * `isUnsafeCodePoint` to just C0 and U+202A–202E leaves every other test in this
 * file green, while U+2067 — the isolate form of exactly the same attack, and
 * the one Trojan Source actually uses — sails into the capsule the owner is
 * about to approve.
 */
test('the capsule strips EVERY class of invisible or reordering character', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [0x00, 'NUL, a C0 control'],
    [0x1f, 'the top of the C0 block'],
    [0x7f, 'DEL'],
    [0x85, 'NEL, a C1 control that some renderers treat as a line break'],
    [0x9f, 'the top of the C1 block'],
    [0x200b, 'zero-width space'],
    [0x200e, 'left-to-right mark'],
    [0x2028, 'LINE SEPARATOR — a line break by any other name'],
    [0x2029, 'PARAGRAPH SEPARATOR'],
    [0x202a, 'left-to-right embedding'],
    [0x202e, 'right-to-left override'],
    [0x2066, 'left-to-right isolate'],
    [0x2069, 'pop directional isolate'],
    [0xfeff, 'BOM / zero-width no-break space'],
  ];

  for (const [code, name] of cases) {
    const ch = String.fromCodePoint(code);
    const summary = toSummary(item({ title: `pay${ch} nobody` }));
    assert.equal(
      summary.includes(ch),
      false,
      `U+${code.toString(16).toUpperCase().padStart(4, '0')} (${name}) reached the capsule`,
    );
    assert.ok(summary.includes('pay nobody'), `the visible text survived losing ${name}`);
  }
});

test('a legitimate non-ASCII title is NOT mangled — stripping is narrow, not greedy', () => {
  // The rule above must cost nothing to ordinary text, or people turn it off.
  const summary = toSummary(item({ title: 'Corrige la programación — café, naïve, 日本語, Ω' }));
  assert.ok(summary.includes('Corrige la programación — café, naïve, 日本語, Ω'), summary);
});

test('the clip never splits a surrogate pair — half an emoji is not a character', () => {
  // TITLE_LIMIT counts UTF-16 code units and an astral character is two of
  // them, so a naive slice lands mid-pair and the capsule renders U+FFFD.
  const summary = toSummary(item({ title: '\u{1F642}'.repeat(60) }));
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.equal(lone.test(summary), false, `a lone surrogate reached the capsule: ${JSON.stringify(summary)}`);
  assert.ok(summary.includes('…'), 'it was still clipped');
});

test('toSummary is length-bounded — no item can push the capsule off the screen', () => {
  const summary = toSummary(item({ title: 'x'.repeat(500), labels: ['y'.repeat(500)] }));
  assert.ok(summary.length < 200, `bounded, got ${summary.length}`);
  assert.ok(summary.includes('…'), 'the clip is visible, not silent');
});

/**
 * EVERY field the capsule renders is foreign text, not just the title — and
 * every test above this one feeds the nasty input to `title` alone.
 *
 * That gap is not theoretical. `labels` is the field an UNTRUSTED caller can
 * set most directly: the daemon's `POST /work` is open to the proposer token,
 * and it validates labels as "an array of strings", which is the only true
 * thing there is to check about them. `updatedAt` is foreign in the same way
 * from the other adapter — `mapIssue` accepts any non-empty string, so whatever
 * answers for api.github.com chooses it. Strip `oneLine` from either and every
 * other test in this file stays green while a right-to-left override reorders
 * the sentence the owner is about to approve.
 */
test('EVERY field the capsule renders is stripped, not only the title', () => {
  const rlo = String.fromCharCode(0x202e);
  const summary = toSummary(
    item({
      id: `local${rlo}:1`,
      updatedAt: `2026-09-04${rlo}T09:00:00Z`,
      labels: [`bug${rlo}`, 'two\nlines'],
    }),
  );

  assert.equal(summary.includes(rlo), false, 'a bidi override in ANY field reorders the whole line');
  assert.equal(summary.includes('\n'), false, 'and any field can break the one-line contract');
  assert.ok(summary.includes('two lines'), 'the visible text of a label still survives');
});

/**
 * ...and the length bound is a bound on the SENTENCE, not on the title.
 *
 * With `id` and `updatedAt` unclipped the sentence had no upper bound at all:
 * one hand-edited `updatedAt` — and hand-editing this file is a supported way
 * to use the product — or one proxy answering for GitHub with a long enough
 * timestamp, and the capsule stops fitting on a screen. Which is to say the
 * owner stops being able to read the thing they are agreeing to.
 */
test('the bound holds when EVERY field is hostile, not just the title', () => {
  const summary = toSummary(
    item({
      id: 'z'.repeat(5000),
      title: 'x'.repeat(5000),
      updatedAt: '9'.repeat(5000),
      labels: ['y'.repeat(5000), 'w'.repeat(5000)],
    }),
  );
  assert.ok(summary.length < 400, `a capsule sentence has to fit on a screen, got ${summary.length}`);
  assert.equal(summary.includes('…'), true, 'and every clip is visible rather than silent');
});

test('toSummary degrades instead of throwing on an empty item', () => {
  const summary = toSummary(item({ id: '', title: '   ', updatedAt: '' }));
  assert.equal(summary, '(unidentified) — "(untitled)" (updated unknown)');
});

test('oneLine collapses runs of whitespace and trims', () => {
  assert.equal(oneLine('  a   b  \n  c  '), 'a b c');
  assert.equal(oneLine(''), '');
  assert.equal(oneLine('   '), '');
});
