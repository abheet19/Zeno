/**
 * The tests that make the tick mean something.
 *
 * Every secret here is a PLANTED fake — a non-functional test double shaped like
 * the real thing so the detectors can be exercised without ever handling a live
 * credential. Two properties are load-bearing and checked over and over: a secret
 * that IS present is redacted (and its raw bytes vanish from every part of the
 * result), and a near-miss that is NOT a secret stays untouched (no false-
 * positive storm). The rest — stable placeholders, longest-wins overlap, the
 * canary, determinism — is what stops the green tick from lying.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitize,
  hasSecret,
  assertClean,
  SecretLeakError,
  RULES,
  shannonEntropy,
  classDiversity,
  type Rule,
} from '../src/index.js';

/** The ruleIds present in a result, for compact assertions. */
function ids(text: string): string[] {
  return sanitize(text).findings.map((f) => f.ruleId);
}

// --- Planted fakes, one per rule -------------------------------------------

const PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOwIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu',
  'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJBAKj34GkxFhD90vcNLYLI',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

const AKIA = 'AKIAIOSFODNN7EXAMPLE';
const AWS_LINE = 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const AWS_SECRET_VALUE = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const GH_TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
const OPENAI = 'sk-proj-abcdEFGH1234ijklMNOP5678';
const ANTHROPIC = 'sk-ant-abc123XYZ789def456GHI012';
const GOOGLE = 'AIzaSyC1234567890abcdefGHIJKLMNOPQR_-xy';
const SLACK = 'xoxb-123456789012-abcdefABCDEF';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0';
const BEARER_TOKEN = 'abcDEF123456ghiJKL789mno';
const URL_CREDS = 'admin:s3cr3tpw';
const HIGH = 'Zk9xQ2p7Lw3nBvR8sT1uY6dH0aF4cX5eM2gN7iKoP';

// --- Rule 1: PEM private key ------------------------------------------------

test('pem-private-key: a PRIVATE KEY block is caught, whole', () => {
  const r = sanitize(`key follows\n${PEM}\ndone`);
  assert.deepEqual(
    r.findings.map((f) => f.ruleId),
    ['pem-private-key'],
    'the whole block is one finding — its inner base64 lines never surface separately',
  );
  assert.ok(!r.clean.includes('MIIBOwIBAAJBA'), 'the key body is gone from the output');
  assert.match(r.clean, /\[REDACTED:pem-private-key:[0-9a-f]{8}\]/);
});

test('pem-private-key near-miss: a short CERTIFICATE block is not a secret', () => {
  assert.equal(sanitize('-----BEGIN CERTIFICATE-----\nMIIBshort\n-----END CERTIFICATE-----').findings.length, 0);
});

// --- Rule 2: AWS access key id ---------------------------------------------

test('aws-access-key-id: AKIA... is caught', () => {
  assert.deepEqual(ids(`login uses ${AKIA} for access`), ['aws-access-key-id']);
});

test('aws-access-key-id near-miss: a short AKIA prefix is not one', () => {
  assert.equal(sanitize('AKIASHORT is not a key').findings.length, 0);
});

// --- Rule 3: AWS secret access key -----------------------------------------

test('aws-secret: a 40-char value in an aws/secret context is caught, key name kept', () => {
  const r = sanitize(AWS_LINE);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['aws-secret']);
  assert.ok(r.clean.startsWith('aws_secret_access_key='), 'the key name stays so the leak is traceable');
  assert.ok(!r.clean.includes(AWS_SECRET_VALUE), 'the value is gone');
  // Regression guard: a fixed-length window could slide left into the key and
  // drop the TAIL of the secret. Assert not one byte of the value survives.
  assert.ok(!r.clean.includes('EXAMPLEKEY'), 'the last bytes of the secret must not leak');
  assert.ok(!r.clean.includes('EKEY'), 'nor any suffix of it');
  assert.match(r.clean, /^aws_secret_access_key=\[REDACTED:aws-secret:[0-9a-f]{8}\]$/);
});

test('aws-secret near-miss: aws + secret words but no 40-char value', () => {
  assert.equal(sanitize('awssecret budget is fine').findings.length, 0);
});

// --- Rule 4: GitHub token --------------------------------------------------

test('github-token: ghp_ token is caught (and beats the entropy net on the tie)', () => {
  assert.deepEqual(ids(`credential is ${GH_TOKEN} keep safe`), ['github-token']);
});

test('github-token near-miss: ghp_ prefix below the length floor', () => {
  assert.equal(sanitize('ghp_tooshort not a token').findings.length, 0);
});

// --- Rule 5: OpenAI / Anthropic key ----------------------------------------

test('llm-api-key: both sk- and sk-ant- keys are caught', () => {
  const r = sanitize(`openai ${OPENAI} and anthropic ${ANTHROPIC}`);
  assert.equal(r.findings.filter((f) => f.ruleId === 'llm-api-key').length, 2);
  assert.ok(!r.clean.includes(OPENAI) && !r.clean.includes(ANTHROPIC));
});

test('llm-api-key near-miss: sk- below the length floor, and no word-internal match', () => {
  assert.equal(sanitize('sk-short and ask-me-anything please').findings.length, 0);
});

// --- Rule 6: Google API key ------------------------------------------------

test('google-api-key: AIza... is caught', () => {
  assert.deepEqual(ids(`maps ${GOOGLE} configured`), ['google-api-key']);
});

test('google-api-key near-miss: AIza prefix too short', () => {
  assert.equal(sanitize('AIzaShort here').findings.length, 0);
});

// --- Rule 7: Slack token ---------------------------------------------------

test('slack-token: xoxb-... is caught', () => {
  assert.deepEqual(ids(`slack ${SLACK} set`), ['slack-token']);
});

test('slack-token near-miss: xoxo- has an out-of-set marker char', () => {
  assert.equal(sanitize('xoxo-nope here').findings.length, 0);
});

// --- Rule 8: JWT -----------------------------------------------------------

test('jwt: a three-segment eyJ token is caught', () => {
  assert.deepEqual(ids(`auth ${JWT} ok`), ['jwt']);
});

test('jwt near-miss: ordinary dotted text is not a JWT', () => {
  assert.equal(sanitize('this.is.fine and not.a.jwt').findings.length, 0);
});

test('jwt: a five-segment JWE is redacted WHOLE — no ciphertext or tag tail leaks', () => {
  // LEAKAGE regression: a JWE is header.encryptedKey.iv.ciphertext.tag. Matching
  // only the first three segments would redact the header/iv and leave the
  // ciphertext and tag — the sensitive halves — sitting in the clean output.
  const iv = 'ivPART9990000iv';
  const ciphertext = 'CIPHERtext5551112223334445556667';
  const tag = 'authTAG777888999';
  const jwe = `eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0.encKEY0000aaa111.${iv}.${ciphertext}.${tag}`;
  const r = sanitize(`token ${jwe} end`);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['jwt'], 'the whole JWE is one finding');
  for (const raw of [iv, ciphertext, tag]) {
    assert.ok(!r.clean.includes(raw), `no JWE segment may survive (${raw})`);
  }
  assert.match(r.clean, /^token \[REDACTED:jwt:[0-9a-f]{8}\] end$/);
});

// --- Rule 9: Bearer token --------------------------------------------------

test('bearer-auth: a Bearer token is caught, the word "Bearer" kept', () => {
  const r = sanitize(`Authorization: Bearer ${BEARER_TOKEN}`);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['bearer-auth']);
  assert.ok(r.clean.includes('Bearer ') && !r.clean.includes(BEARER_TOKEN));
});

test('bearer-auth near-miss: prose starting with the word Bearer', () => {
  assert.equal(sanitize('Bearer with me for a moment').findings.length, 0);
});

test('bearer-auth: the scheme is case-insensitive, so bearer/BEARER leak nothing', () => {
  // BYPASS regression: the HTTP auth-scheme is case-insensitive (RFC 7235 §2.1),
  // so `bearer`/`BEARER` are just as real as `Bearer`. This token is 24 chars —
  // deliberately UNDER the 32-char high-entropy floor — so only the bearer rule
  // itself can catch it; if the scheme match is case-sensitive the token leaks whole.
  assert.ok(BEARER_TOKEN.length < 32, 'the fixture must dodge the entropy net to prove the point');
  for (const scheme of ['bearer', 'BEARER', 'BeArEr']) {
    const r = sanitize(`Authorization: ${scheme} ${BEARER_TOKEN}`);
    assert.deepEqual(r.findings.map((f) => f.ruleId), ['bearer-auth'], `${scheme} must be caught`);
    assert.ok(!r.clean.includes(BEARER_TOKEN), `${scheme}: the token must not survive`);
  }
});

test('bearer-auth near-miss: case-insensitivity does not fire on lowercase prose', () => {
  // The 20-char unbroken-token requirement, not the case, is what rejects prose —
  // so making the scheme case-insensitive adds no false positives here.
  assert.equal(sanitize('bearer of bad news today, nothing secret').findings.length, 0);
  assert.equal(sanitize('the BEARER carried a short note').findings.length, 0);
});

// --- Rule 10: URL with inline credentials ----------------------------------

test('url-credentials: proto://user:pass@host redacts only the credentials', () => {
  const r = sanitize(`db postgres://${URL_CREDS}@db.internal:5432/app`);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['url-credentials']);
  assert.ok(r.clean.includes('postgres://') && r.clean.includes('@db.internal:5432/app'));
  assert.ok(!r.clean.includes(URL_CREDS) && !r.clean.includes('s3cr3tpw'));
});

test('url-credentials near-miss: a URL with a port but no credentials', () => {
  assert.equal(sanitize('postgres://db.example.com:5432/app').findings.length, 0);
});

test('url-credentials: a password containing @ is redacted WHOLE — no tail leaks', () => {
  // LEAKAGE regression: WHATWG parses userinfo up to the LAST `@`, so the password
  // here is `p@ss@word`. A class that stopped at the FIRST `@` redacted only
  // `user:p` and leaked `@ss@word` into what looks like the host. The credential
  // must be taken whole and the real host preserved.
  const r = sanitize('conn mysql://user:p@ss@word@db.host:3306/app');
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['url-credentials']);
  assert.ok(r.clean.includes('mysql://') && r.clean.includes('@db.host:3306/app'), 'the host stays legible');
  for (const raw of ['p@ss@word', 'ss@word', '@word', 'word']) {
    assert.ok(!r.clean.includes(raw), `no fragment of the password may survive (${raw})`);
  }
});

// --- Rule 11: dotenv-style secret ------------------------------------------

test('dotenv-secret: a SECRET/PASSWORD-named assignment redacts the value', () => {
  const r = sanitize('DATABASE_PASSWORD=sup3rs3cr3tvalue');
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['dotenv-secret']);
  assert.ok(r.clean.startsWith('DATABASE_PASSWORD=') && !r.clean.includes('sup3rs3cr3tvalue'));
});

test('dotenv-secret near-miss: a benign PORT assignment', () => {
  assert.equal(sanitize('PORT=3000').findings.length, 0);
});

test('dotenv-secret: a QUOTED value with spaces is redacted WHOLE — no tail leaks', () => {
  // LEAKAGE regression: a quoted secret may hold spaces (`PASSWORD="a b c"`). A
  // value class that stopped at the first inner space redacted only the first
  // word and leaked the rest into the clean output. The whole quoted run must go.
  for (const q of ['"', "'"]) {
    const secret = `correct horse battery staple ${q === '"' ? "'" : '"'}mixed${q}`;
    // ^ the value even contains the OTHER quote char, to prove we take the run whole.
    const r = sanitize(`DB_PASSWORD=${q}${secret}${q}`);
    assert.deepEqual(r.findings.map((f) => f.ruleId), ['dotenv-secret'], `${q}: one finding`);
    assert.ok(r.clean.startsWith('DB_PASSWORD='), 'the key name is preserved, not swallowed');
    for (const word of ['correct', 'horse', 'battery', 'staple', 'mixed']) {
      assert.ok(!r.clean.includes(word), `${q}: no word of the value may survive (${word})`);
    }
  }
  // And the plain unquoted path is unchanged.
  const r = sanitize('API_TOKEN=sup3rs3cr3tvalue');
  assert.ok(r.clean.startsWith('API_TOKEN=') && !r.clean.includes('sup3rs3cr3tvalue'));
});

// --- Rule 12: high-entropy last resort -------------------------------------

test('high-entropy: a long mixed disordered run is caught as a last resort', () => {
  assert.deepEqual(ids(`blob ${HIGH} end`), ['high-entropy']);
});

test('high-entropy near-miss: a long but single-class / repetitive run is not', () => {
  assert.equal(sanitize(`pad ${'a'.repeat(48)} pad`).findings.length, 0, 'single-class → rejected');
  assert.equal(sanitize(`pad ${'ab'.repeat(24)} pad`).findings.length, 0, 'low-entropy → rejected');
});

// --- False positives the net must NOT redact: cry wolf and you get turned off --
//
// Each fixture below has classDiversity >= 2 AND order-0 entropy above the floor,
// so the OLD net (diversity + entropy alone) redacted every one of them. They are
// not secrets — they are the hashes, ids and identifiers Zeno prints in the very
// sinks the sanitizer guards (a receipt's selfHash, a git sha in a log line). The
// alphabet gates are what now let them through.

/** A deterministic, uniformly-distributed hex string of length n (entropy ~4.0,
 * two character classes) — the exact shape the net used to over-redact. */
const hex = (n: number): string =>
  Array.from({ length: n }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join('');

test('false-positive: a git commit sha (40 hex) is a digest, not a secret', () => {
  assert.equal(sanitize(`fix shipped in ${hex(40)} on main`).findings.length, 0);
});

test('false-positive: a sha-256 content hash — the kind in every Zeno receipt — is left intact', () => {
  // A receipt line carries selfHash + prevReceipt as bare 64-hex. The sanitizer
  // guards receipts, so it must not corrupt the hash chain it is asked to protect.
  const receipt = `{"selfHash":"${hex(64)}","prevReceipt":"${hex(64)}","summary":"approved"}`;
  const r = sanitize(receipt);
  assert.equal(r.findings.length, 0, 'the hash chain survives its own sanitizer');
  assert.equal(r.clean, receipt, 'and the receipt is returned byte-for-byte');
});

test('false-positive: a 128-hex Ed25519 signature is not redacted', () => {
  // Signed receipts store the detached signature as 128 hex chars — pure hex.
  assert.equal(sanitize(`{"signature":"${hex(128)}"}`).findings.length, 0);
});

test('false-positive: a plain UUID (hex + hyphens) is an identifier, not a secret', () => {
  assert.equal(sanitize('request 550e8400-e29b-41d4-a716-446655440000 accepted').findings.length, 0);
});

test('false-positive: a long camelCase identifier from a log line is not a secret', () => {
  // Order-0 entropy ~4.0 (letters carry several bits/char); the all-letters gate,
  // not the entropy floor, is what spares it.
  assert.equal(sanitize('at getUserAuthenticationTokenFromCache(cache.ts)').findings.length, 0);
});

test('false-positive: concatenated English (no digits, no symbols) is not a secret', () => {
  assert.equal(sanitize('note TheQuickBrownFoxJumpsOverTheLazyDog here').findings.length, 0);
});

test('the alphabet gates do not weaken a real key: mixed, digit-bearing runs still fire', () => {
  // Regression guard on the OTHER direction — HIGH has letters beyond f and carries
  // digits, so it is neither a hex run nor an all-letters run and must still redact.
  assert.deepEqual(ids(`blob ${HIGH} end`), ['high-entropy']);
});

test('high-entropy still rejects a single-class run once past the alphabet gates', () => {
  // Not hex (has `z`), not all-letters (has `+`), but one character class only.
  assert.equal(sanitize(`x ${'z+'.repeat(24)} y`).findings.length, 0, 'classDiversity < 2 → rejected');
});

test('high-entropy still rejects a mixed but low-entropy run once past the alphabet gates', () => {
  // Not hex (has `z`), not all-letters (has `1`); three classes clear diversity but
  // the repetition keeps entropy far below the floor.
  assert.equal(sanitize(`x ${'Az1'.repeat(16)} y`).findings.length, 0, 'entropy < floor → rejected');
});

// --- The rule list is what we say it is ------------------------------------

test('the rule set is the documented twelve, ids unique, entropy net last', () => {
  const ruleIds = RULES.map((r) => r.id);
  assert.deepEqual(ruleIds, [
    'pem-private-key',
    'aws-access-key-id',
    'aws-secret',
    'github-token',
    'llm-api-key',
    'google-api-key',
    'slack-token',
    'jwt',
    'bearer-auth',
    'url-credentials',
    'dotenv-secret',
    'high-entropy',
  ]);
  assert.equal(new Set(ruleIds).size, ruleIds.length, 'ids are unique');
  assert.equal(ruleIds.at(-1), 'high-entropy', 'the broad net is dead last');
});

// --- Stable placeholders ---------------------------------------------------

test('stable placeholders: the same secret redacts to the same token every time', () => {
  const r = sanitize(`a ${GH_TOKEN} b ${GH_TOKEN} c`);
  assert.equal(r.findings.length, 2, 'both occurrences are findings');
  assert.equal(r.placeholders.length, 1, 'but they collapse onto one placeholder');
  assert.equal(r.placeholders[0]!.count, 2);
  const token = r.placeholders[0]!.token;
  assert.equal(r.clean.split(token).length - 1, 2, 'the identical token appears twice');
});

test('different secrets get different placeholders', () => {
  const a = sanitize(`x ${GH_TOKEN} y`).placeholders[0]!.token;
  const b = sanitize(`x ${GH_TOKEN.replace('abcd', 'wxyz')} y`).placeholders[0]!.token;
  assert.notEqual(a, b);
});

// --- Raw bytes never survive -----------------------------------------------

test('the raw secret bytes are absent from every part of the result', () => {
  const r = sanitize(`credential is ${GH_TOKEN} keep safe`);
  assert.ok(!r.clean.includes(GH_TOKEN), 'not in clean');
  assert.ok(!JSON.stringify(r).includes(GH_TOKEN), 'not in findings/placeholders either');
});

// --- Overlaps resolve longest-first ----------------------------------------

test('overlapping matches: the longest span wins, regardless of rule order', () => {
  const rules: Rule[] = [
    { id: 'short', label: 'short', klass: 'high-entropy', regex: /abc/ },
    { id: 'long', label: 'long', klass: 'high-entropy', regex: /abcdefgh/ },
  ];
  const r = sanitize('abcdefgh', { rules });
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['long'], 'the longer match beats the earlier, shorter one');
});

test('overlapping matches of equal length: the earlier rule wins the tie', () => {
  const rules: Rule[] = [
    { id: 'first', label: 'first', klass: 'high-entropy', regex: /SECRET/ },
    { id: 'second', label: 'second', klass: 'high-entropy', regex: /SECRET/ },
  ];
  assert.deepEqual(sanitize('SECRET', { rules }).findings.map((f) => f.ruleId), ['first']);
});

test('the high-entropy net yields to a named rule even when its raw run is longer', () => {
  // The entropy regex greedily matches "DATABASE_PASSWORD=sup3rs3cr3tvalue"
  // whole (34 chars, `_` and `=` are in its alphabet) — longer than the dotenv
  // value span. It must still lose: a curated finding beats the anonymous net.
  const r = sanitize('DATABASE_PASSWORD=sup3rs3cr3tvalue');
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['dotenv-secret']);
  assert.ok(r.clean.startsWith('DATABASE_PASSWORD='), 'the non-secret key name is preserved, not swallowed');
});

// --- Multi-secret text redacts all -----------------------------------------

test('a document with several distinct secrets redacts every one', () => {
  const multi = [
    `aws key ${AKIA} for login`,
    `gh uses ${GH_TOKEN} today`,
    `llm ${ANTHROPIC} enabled`,
    'DATABASE_PASSWORD=sup3rs3cr3tvalue',
  ].join('\n');
  const r = sanitize(multi);
  assert.deepEqual(
    new Set(r.findings.map((f) => f.ruleId)),
    new Set(['aws-access-key-id', 'github-token', 'llm-api-key', 'dotenv-secret']),
  );
  for (const raw of [AKIA, GH_TOKEN, ANTHROPIC, 'sup3rs3cr3tvalue']) {
    assert.ok(!r.clean.includes(raw), `${raw} must not survive`);
  }
});

// --- The canary ------------------------------------------------------------

test('THE CANARY: assertClean throws, names the sink, and never echoes the value', () => {
  const canary = `here is ${GH_TOKEN} the planted secret`;
  assert.equal(hasSecret(canary), true);
  assert.throws(
    () => assertClean(canary, 'model-prompt'),
    (err: unknown) => {
      assert.ok(err instanceof SecretLeakError);
      assert.equal(err.where, 'model-prompt');
      assert.match(err.message, /model-prompt/);
      assert.ok(!err.message.includes(GH_TOKEN), 'the error must not leak the value it is protecting');
      assert.ok(err.findings.some((f) => f.ruleId === 'github-token'));
      return true;
    },
  );
  const result = sanitize(canary);
  assert.ok(!result.clean.includes(GH_TOKEN));
  assert.ok(!JSON.stringify(result).includes(GH_TOKEN), 'the raw value appears nowhere in the result');
});

test('assertClean stays silent on clean text; hasSecret agrees', () => {
  assert.doesNotThrow(() => assertClean('just an ordinary sentence, nothing to see', 'log'));
  assert.equal(hasSecret('just an ordinary sentence, nothing to see'), false);
});

// --- Determinism -----------------------------------------------------------

test('determinism: the same input yields an identical result twice', () => {
  const text = `${PEM}\n${AKIA}\n${GH_TOKEN}\n${JWT}\n${GOOGLE}`;
  assert.deepEqual(sanitize(text), sanitize(text));
});

// --- Engine edge behaviour (custom rules exercise the seams) ---------------

test('a rule whose redact group does not participate contributes nothing', () => {
  const rules: Rule[] = [{ id: 'opt', label: 'opt', klass: 'high-entropy', regex: /foo(bar)?/, redactGroup: 1 }];
  const r = sanitize('foo', { rules });
  assert.equal(r.findings.length, 0);
  assert.equal(r.clean, 'foo');
});

test('a rule whose redact group matches empty contributes nothing', () => {
  const rules: Rule[] = [{ id: 'empty', label: 'empty', klass: 'high-entropy', regex: /a(b*)/, redactGroup: 1 }];
  assert.equal(sanitize('a', { rules }).findings.length, 0);
});

test('hashLength option shortens the placeholder suffix deterministically', () => {
  const r = sanitize(`x ${GH_TOKEN} y`, { hashLength: 4 });
  assert.match(r.placeholders[0]!.token, /\[REDACTED:github-token:[0-9a-f]{4}\]/);
});

// --- The entropy helpers ---------------------------------------------------

test('shannonEntropy: empty is 0, uniform is low, disordered is high', () => {
  assert.equal(shannonEntropy(''), 0);
  assert.equal(shannonEntropy('aaaaaaaa'), 0, 'one repeated symbol carries no bits');
  assert.ok(shannonEntropy('abcdefgh') > 2.5, 'eight distinct symbols carry several bits');
  assert.ok(shannonEntropy(HIGH) > 3, 'a real high-entropy run clears the floor');
});

test('classDiversity: counts distinct character classes, ignoring symbols', () => {
  assert.equal(classDiversity('abcdef'), 1, 'lowercase only');
  assert.equal(classDiversity('ABCDEF'), 1, 'uppercase only');
  assert.equal(classDiversity('123456'), 1, 'digits only');
  assert.equal(classDiversity('abc123'), 2);
  assert.equal(classDiversity('abcXYZ123'), 3);
  assert.equal(classDiversity('++==//'), 0, 'symbols count toward nothing');
});
