#!/usr/bin/env node
/* =============================================================================
   Zeno Glass — contrast budget
   packages/daemon/public/glass/contrast.mjs

   Dependency-free. Reads tokens.css, resolves every custom property (including
   nested var() and opaque color-mix(in srgb, …)), computes WCAG 2.x relative
   luminance, and asserts:

     4.5 : 1   text pairs                    (WCAG 1.4.3)
     3.0 : 1   control and graphic pairs     (WCAG 1.4.11)

   against the WORST-CASE graphite backdrop each token is permitted on.

   The state grammar is not hard-coded here: the twelve .state-* rules are
   parsed out of tokens.css, so this check tracks the stylesheet and cannot
   silently drift from it. Beyond the two WCAG thresholds it also asserts

     · every state chip's fill separates from the opaque payload plane
     · no two state fills collapse onto the same greyscale luminance
     · every glyph and every label is unique across the twelve
     · gold never appears as a status, and green appears only in `verified`
     · each declared exclusion is necessary — the forbidden pair really does
       fail, rather than being a rule nobody rechecked

   Exits non-zero on any failure.

     node packages/daemon/public/glass/contrast.mjs
     node packages/daemon/public/glass/contrast.mjs --verbose
     node packages/daemon/public/glass/contrast.mjs ./candidate-tokens.css
   ============================================================================= */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/* Defaults to the sibling tokens.css; an explicit path may be passed so the
   budget can be run against a candidate stylesheet before it is committed. */
const CSS_PATH = process.argv.slice(2).find((a) => a.endsWith('.css')) || join(HERE, 'tokens.css');
const VERBOSE = process.argv.includes('--verbose');

const TEXT_MIN = 4.5;   // WCAG 1.4.3 AA
const CTRL_MIN = 3.0;   // WCAG 1.4.11 non-text contrast
const FILL_DELTA_MIN = 1.10; // a state fill must separate from the payload plane
const LADDER_GAP_MIN = 0.0025; // min luminance step between any two state fills

/* --- the twelve canonical states, in lifecycle order ---------------------- */
const STATES = [
  'idle', 'listening', 'awaiting-approval', 'approved', 'committing', 'verified',
  'refused', 'denied', 'blocked', 'expired', 'stale', 'outcome-unknown',
];

const GRAPHITE = ['--g1', '--g2', '--g3', '--g4', '--g5', '--g6', '--g7'];
const WORST_GRAPHITE = '--g7'; // lightest neutral: worst case for light-on-dark

/* =============================================================================
   1. COLOUR
   ============================================================================= */

function hexToRgb(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not a hex colour: ${hex}`);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const rgbToHex = (rgb) =>
  '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0').toUpperCase()).join('');

/* WCAG 2.x relative luminance (sRGB → linear-light, Rec.709 weights). */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((c8) => {
    const c = c8 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/* =============================================================================
   2. CSS PARSING — enough of it, and no more.
   ============================================================================= */

const css = readFileSync(CSS_PATH, 'utf8');
/* strip comments so a hex inside prose is never mistaken for a declaration */
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Split "a, b(c, d), e" on top-level commas only. */
function splitTopLevel(str, sep = ',') {
  const out = [];
  let depth = 0, buf = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Every `selector { body }` pair. Nested at-rules degrade harmlessly. */
function ruleBlocks(text) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

function declarations(body) {
  const decls = {};
  for (const stmt of splitTopLevel(body, ';')) {
    const i = stmt.indexOf(':');
    if (i < 0) continue;
    const prop = stmt.slice(0, i).trim();
    const value = stmt.slice(i + 1).trim().replace(/\s*!important$/, '');
    if (prop) decls[prop] = value;
  }
  return decls;
}

const RULES = ruleBlocks(cssBare);

/* :root custom properties */
const ROOT = {};
for (const r of RULES) {
  if (!/^:root\b/.test(r.selector)) continue;
  for (const [prop, value] of Object.entries(declarations(r.body))) {
    if (prop.startsWith('--')) ROOT[prop] = value;
  }
}

/* =============================================================================
   3. VALUE RESOLUTION — var() and opaque color-mix(in srgb, …)
   ============================================================================= */

function resolve(value, seen = new Set()) {
  const v = String(value).trim();

  if (/^#[0-9a-f]{3,8}$/i.test(v)) return hexToRgb(v);

  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/i);
  if (varMatch) {
    const name = varMatch[1];
    if (seen.has(name)) throw new Error(`circular var(${name})`);
    if (ROOT[name] !== undefined) return resolve(ROOT[name], new Set([...seen, name]));
    if (varMatch[2] !== undefined) return resolve(varMatch[2], seen);
    throw new Error(`undefined custom property ${name}`);
  }

  const mixMatch = v.match(/^color-mix\(\s*in\s+srgb\s*,([\s\S]+)\)$/i);
  if (mixMatch) {
    const parts = splitTopLevel(mixMatch[1]);
    if (parts.length !== 2) throw new Error(`color-mix must take two colours: ${v}`);
    const parsed = parts.map((p) => {
      const pm = p.match(/^([\s\S]+?)\s+([\d.]+)%$/);
      return pm
        ? { color: pm[1].trim(), pct: parseFloat(pm[2]) }
        : { color: p.trim(), pct: null };
    });
    let [a, b] = parsed;
    if (a.pct === null && b.pct === null) { a.pct = 50; b.pct = 50; }
    else if (a.pct === null) a.pct = 100 - b.pct;
    else if (b.pct === null) b.pct = 100 - a.pct;
    const total = a.pct + b.pct;
    if (total === 0) throw new Error(`color-mix percentages sum to zero: ${v}`);
    const wa = a.pct / total, wb = b.pct / total;
    if (/\btransparent\b/i.test(v)) {
      throw new Error(`state fills must be opaque so contrast is computable: ${v}`);
    }
    const ca = resolve(a.color, seen);
    const cb = resolve(b.color, seen);
    /* CSS Color 4: `in srgb` interpolates gamma-encoded sRGB componentwise. */
    return [0, 1, 2].map((i) => ca[i] * wa + cb[i] * wb);
  }

  throw new Error(`cannot resolve colour value: ${v}`);
}

const tok = (name) => resolve(`var(${name})`);

/* =============================================================================
   4. THE STATE GRAMMAR, READ BACK OUT OF THE STYLESHEET
   ============================================================================= */

const stateBase = (() => {
  const r = RULES.find((x) => /(^|,)\s*\.state\s*$/.test(x.selector) && x.body.includes('--st-glyph'));
  return r ? declarations(r.body) : {};
})();

function stateDecls(name) {
  const wanted = new RegExp(`\\.state-${name}(?![\\w-])`);
  const rule = RULES.find((r) => wanted.test(r.selector) && r.body.includes('--st-fill'));
  if (!rule) return null;
  return { ...stateBase, ...declarations(rule.body) };
}

/** Turn a CSS string token — "\25CB" or "?" — into the character it renders. */
function unescapeCssString(v) {
  return String(v).trim().replace(/^["']|["']$/g, '')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

/* =============================================================================
   5. THE BUDGET
   ============================================================================= */

const rows = [];
let failures = 0;

function check({ group, pair, fg, bg, min, note = '' }) {
  let ratio = null, error = null;
  try {
    ratio = contrastRatio(resolve(fg), resolve(bg));
  } catch (e) {
    error = e.message;
  }
  const pass = error === null && ratio >= min;
  if (!pass) failures++;
  rows.push({ group, pair, ratio, min, pass, note: error ? `ERROR ${error}` : note });
  return pass;
}

/* An exclusion is only honest if it is necessary. This asserts the opposite
   direction: the pair tokens.css forbids must genuinely be BELOW threshold.
   If one of these starts passing, the exclusion is arbitrary and the rule in
   tokens.css should be relaxed rather than left as folklore. */
function exclusion({ pair, fg, bg, min, note = '' }) {
  let ratio = null, error = null;
  try {
    ratio = contrastRatio(resolve(fg), resolve(bg));
  } catch (e) {
    error = e.message;
  }
  const pass = error === null && ratio < min;
  if (!pass) failures++;
  rows.push({
    group: 'declared exclusions · verified necessary',
    pair, ratio, min, pass,
    note: error ? `ERROR ${error}` : (pass ? note : 'now clears threshold — relax the rule in tokens.css'),
  });
}

/* --- A. body text on every graphite step --------------------------------- */
for (const g of GRAPHITE) {
  check({
    group: 'text · ink on graphite',
    pair: `--ink on ${g}`,
    fg: 'var(--ink)', bg: `var(${g})`, min: TEXT_MIN,
    note: g === WORST_GRAPHITE ? 'worst case' : '',
  });
}

/* --- B. secondary and tertiary ink, at their DECLARED ceilings ------------
   tokens.css states the rule; this asserts it at the worst backdrop allowed. */
check({
  group: 'text · secondary ink',
  pair: '--ink-2 on --g6', fg: 'var(--ink-2)', bg: 'var(--g6)', min: TEXT_MIN,
  note: 'declared text ceiling: g1–g6',
});
check({
  group: 'text · tertiary ink',
  pair: '--ink-3 on --g3', fg: 'var(--ink-3)', bg: 'var(--g3)', min: CTRL_MIN,
  note: 'never text — 1.4.11 graphic threshold, ceiling g1–g3',
});

/* --- C. every channel colour as TEXT, at its declared ceiling ------------- */
check({
  group: 'text · channel colour at declared ceiling',
  pair: `--cyan on ${WORST_GRAPHITE}`, fg: 'var(--cyan)', bg: `var(${WORST_GRAPHITE})`,
  min: TEXT_MIN, note: 'cyan text: g1–g7',
});
check({
  group: 'text · channel colour at declared ceiling',
  pair: `--gold on ${WORST_GRAPHITE}`, fg: 'var(--gold)', bg: `var(${WORST_GRAPHITE})`,
  min: TEXT_MIN, note: 'gold text: g1–g7 — owner origin, never a status',
});
check({
  group: 'text · channel colour at declared ceiling',
  pair: '--amber on --g6', fg: 'var(--amber)', bg: 'var(--g6)',
  min: TEXT_MIN, note: 'amber text: g1–g6',
});
check({
  group: 'text · channel colour at declared ceiling',
  pair: '--green on --g6', fg: 'var(--green)', bg: 'var(--g6)',
  min: TEXT_MIN, note: 'green text: g1–g6 — only ever on a verified receipt',
});
check({
  group: 'text · channel colour at declared ceiling',
  pair: '--red on --g4', fg: 'var(--red)', bg: 'var(--g4)',
  min: TEXT_MIN, note: 'red text: g1–g4',
});

/* above the text ceiling a channel colour may still be a glyph or an edge */
check({
  group: 'graphic · channel colour above its text ceiling',
  pair: `--amber on ${WORST_GRAPHITE}`, fg: 'var(--amber)', bg: `var(${WORST_GRAPHITE})`,
  min: CTRL_MIN, note: 'glyph / edge only',
});
check({
  group: 'graphic · channel colour above its text ceiling',
  pair: `--green on ${WORST_GRAPHITE}`, fg: 'var(--green)', bg: `var(${WORST_GRAPHITE})`,
  min: CTRL_MIN, note: 'glyph / edge only',
});
check({
  group: 'graphic · channel colour above its text ceiling',
  pair: '--red on --g6', fg: 'var(--red)', bg: 'var(--g6)',
  min: CTRL_MIN, note: 'red glyph / edge ceiling: g1–g6',
});

/* --- C2. glass chrome. Glass has no fixed luminance; --gl-worst is its
   worst realistic case (tint white at ~8% over the lightest plane it may
   sit above), which is LIGHTER than --g7. ---------------------------------- */
check({
  group: 'text · on glass chrome',
  pair: '--ink on --gl-worst', fg: 'var(--ink)', bg: 'var(--gl-worst)', min: TEXT_MIN,
  note: 'the only text colour permitted directly on glass',
});
check({
  group: 'graphic · on glass chrome',
  pair: '--focus on --gl-worst', fg: 'var(--focus)', bg: 'var(--gl-worst)', min: CTRL_MIN,
  note: 'the focus border must survive the worst glass',
});
check({
  group: 'graphic · on glass chrome',
  pair: '--ink-2 on --gl-worst', fg: 'var(--ink-2)', bg: 'var(--gl-worst)', min: CTRL_MIN,
  note: 'mark or icon only on glass — never a sentence',
});

/* --- D. focus ring against every graphite step ---------------------------- */
for (const g of GRAPHITE) {
  check({
    group: 'graphic · focus ring (2px border)',
    pair: `--focus on ${g}`,
    fg: 'var(--focus)', bg: `var(${g})`, min: CTRL_MIN,
    note: g === WORST_GRAPHITE ? 'worst case' : '',
  });
}
/* the ring is offset 2px, so it can also land on a glass edge over any plane */
check({
  group: 'graphic · focus ring (2px border)',
  pair: '--focus on --g6 (glass edge)',
  fg: 'var(--focus)', bg: 'var(--g6)', min: CTRL_MIN,
});

/* --- E. controls ---------------------------------------------------------- */
check({
  group: 'graphic · controls',
  pair: '--cyan bar on --g5 track', fg: 'var(--cyan)', bg: 'var(--g5)', min: CTRL_MIN,
  note: 'determinate committing bar',
});
check({
  group: 'graphic · controls',
  pair: '--gold on --g5', fg: 'var(--gold)', bg: 'var(--g5)', min: CTRL_MIN,
  note: 'owner-origin mark (never a status)',
});
check({
  group: 'text · payload plane',
  pair: '--ink on --g2', fg: 'var(--ink)', bg: 'var(--g2)', min: TEXT_MIN,
  note: 'approval payload — fully opaque',
});
check({
  group: 'text · payload plane',
  pair: '--ink-2 on --g2', fg: 'var(--ink-2)', bg: 'var(--g2)', min: TEXT_MIN,
  note: 'payload metadata / hashes',
});

/* --- F. the twelve states ------------------------------------------------- */
const stateReport = [];
const glyphs = new Map(), labels = new Map();

for (const name of STATES) {
  const d = stateDecls(name);
  if (!d) {
    failures++;
    rows.push({
      group: 'state grammar', pair: `.state-${name}`, ratio: null, min: TEXT_MIN,
      pass: false, note: 'ERROR no .state- rule found in tokens.css',
    });
    continue;
  }

  const fill = d['--st-fill'], ink = d['--st-ink'], key = d['--st-key'];
  const glyph = d['--st-glyph'], label = d['--st-label'];

  check({
    group: 'state · label on fill (text)',
    pair: `${name}: --st-ink on --st-fill`, fg: ink, bg: fill, min: TEXT_MIN,
  });
  check({
    group: 'state · glyph + key bar on fill (graphic)',
    pair: `${name}: --st-key on --st-fill`, fg: key, bg: fill, min: CTRL_MIN,
  });

  /* fill delta: the chip must separate from the opaque payload plane with
     every colour channel stripped. */
  let delta = null;
  try { delta = contrastRatio(resolve(fill), tok('--g2')); } catch { /* reported above */ }
  const deltaPass = delta !== null && delta >= FILL_DELTA_MIN;
  if (!deltaPass) failures++;
  rows.push({
    group: 'state · fill delta vs --g2 plane',
    pair: `${name}: --st-fill vs --g2`,
    ratio: delta, min: FILL_DELTA_MIN, pass: deltaPass, note: 'greyscale separation',
  });

  /* redundancy: glyph and label must exist and be unique across the twelve */
  if (!glyph || !label) {
    failures++;
    rows.push({
      group: 'state grammar', pair: `${name}: glyph + label present`,
      ratio: null, min: 0, pass: false, note: 'ERROR missing --st-glyph or --st-label',
    });
  } else {
    if (glyphs.has(glyph)) {
      failures++;
      rows.push({
        group: 'state grammar', pair: `${name}: glyph unique`, ratio: null, min: 0,
        pass: false, note: `ERROR glyph ${glyph} collides with ${glyphs.get(glyph)}`,
      });
    } else glyphs.set(glyph, name);
    if (labels.has(label)) {
      failures++;
      rows.push({
        group: 'state grammar', pair: `${name}: label unique`, ratio: null, min: 0,
        pass: false, note: `ERROR label ${label} collides with ${labels.get(label)}`,
      });
    } else labels.set(label, name);
  }

  let fillRgb = null;
  try { fillRgb = resolve(fill); } catch { /* noop */ }
  stateReport.push({
    name,
    glyph: unescapeCssString(glyph || ''),
    label: unescapeCssString(label || ''),
    hex: fillRgb ? rgbToHex(fillRgb) : '—',
    lum: fillRgb ? relativeLuminance(fillRgb) : NaN,
  });
}

/* --- G. the greyscale ladder: no two state fills may collapse onto the same
   luminance, or the fill stops being a third channel and the chip falls back
   to glyph + label alone. ---------------------------------------------------- */
{
  const ladder = [...stateReport].filter((s) => !Number.isNaN(s.lum)).sort((a, b) => a.lum - b.lum);
  for (let i = 1; i < ladder.length; i++) {
    const gap = ladder[i].lum - ladder[i - 1].lum;
    const pass = gap >= LADDER_GAP_MIN;
    if (!pass) failures++;
    rows.push({
      group: 'state · greyscale ladder step',
      pair: `${ladder[i - 1].name} → ${ladder[i].name}`,
      ratio: gap, min: LADDER_GAP_MIN, pass, note: 'luminance step, not a ratio',
    });
  }
}

/* --- H. the exclusions tokens.css declares, proven necessary --------------- */
exclusion({
  pair: `--amber on ${WORST_GRAPHITE} as text`, fg: 'var(--amber)',
  bg: `var(${WORST_GRAPHITE})`, min: TEXT_MIN, note: 'why amber text stops at g6',
});
exclusion({
  pair: `--green on ${WORST_GRAPHITE} as text`, fg: 'var(--green)',
  bg: `var(${WORST_GRAPHITE})`, min: TEXT_MIN, note: 'why green text stops at g6',
});
exclusion({
  pair: `--red on ${WORST_GRAPHITE} as glyph`, fg: 'var(--red)',
  bg: `var(${WORST_GRAPHITE})`, min: CTRL_MIN, note: 'why the red glyph stops at g6',
});
exclusion({
  pair: '--red on --gl-worst as glyph', fg: 'var(--red)', bg: 'var(--gl-worst)',
  min: CTRL_MIN, note: 'why a channel colour never sits directly on glass',
});
exclusion({
  pair: '--ink-2 on --gl-worst as text', fg: 'var(--ink-2)', bg: 'var(--gl-worst)',
  min: TEXT_MIN, note: 'why glass text is --ink',
});
exclusion({
  pair: '--ink-3 on --g1 as text', fg: 'var(--ink-3)', bg: 'var(--g1)',
  min: TEXT_MIN, note: 'why --ink-3 is not a text colour anywhere',
});

/* gold must never appear as a state key — it is owner origin, not a status */
for (const name of STATES) {
  const d = stateDecls(name);
  if (d && /--gold/.test(`${d['--st-key']} ${d['--st-fill']} ${d['--st-ink']}`)) {
    failures++;
    rows.push({
      group: 'colour law', pair: `${name}: gold not used as status`,
      ratio: null, min: 0, pass: false, note: 'ERROR gold is owner origin only',
    });
  }
}
/* green must appear in exactly one state: verified */
{
  const greens = STATES.filter((n) => {
    const d = stateDecls(n);
    return d && /--green/.test(`${d['--st-key']} ${d['--st-fill']}`);
  });
  const ok = greens.length === 1 && greens[0] === 'verified';
  if (!ok) failures++;
  rows.push({
    group: 'colour law', pair: 'green appears only in `verified`',
    ratio: null, min: 0, pass: ok,
    note: ok ? 'a receipt exists' : `ERROR green in: ${greens.join(', ') || 'none'}`,
  });
}

/* =============================================================================
   6. OUTPUT
   ============================================================================= */

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const fmt = (r) => (r === null || Number.isNaN(r) ? '  —  ' : r.toFixed(2));

const W_PAIR = Math.max(38, ...rows.map((r) => r.pair.length));
const line = (ch) => ch.repeat(W_PAIR + 34);

console.log('');
console.log('  ZENO GLASS — CONTRAST BUDGET');
console.log(`  ${CSS_PATH}`);
console.log(`  text ${TEXT_MIN.toFixed(1)}:1 (WCAG 1.4.3) · graphic ${CTRL_MIN.toFixed(1)}:1 (WCAG 1.4.11) · fill delta ${FILL_DELTA_MIN.toFixed(2)}:1`);
console.log('');

/* group the rows, preserving first-appearance order of the groups themselves,
   so each heading prints once instead of once per state */
const grouped = new Map();
for (const r of rows) {
  if (!grouped.has(r.group)) grouped.set(r.group, []);
  grouped.get(r.group).push(r);
}

for (const [group, groupRows] of grouped) {
  console.log(line('-'));
  console.log(`  ${group.toUpperCase()}`);
  console.log(line('-'));
  console.log(`  ${pad('PAIR', W_PAIR)} ${padL('RATIO', 7)} ${padL('MIN', 7)}  RESULT`);
  for (const r of groupRows) {
    const verdict = r.pass ? 'PASS' : 'FAIL';
    const note = r.note ? `  ${r.note}` : '';
    const min = r.min ? (r.min < 0.1 ? r.min.toFixed(4) : r.min.toFixed(2)) : '—';
    const dp = r.min && r.min < 0.1 ? 4 : (group.startsWith('declared exclusions') ? 3 : 2);
    const val = r.ratio === null || Number.isNaN(r.ratio) ? '  —  ' : r.ratio.toFixed(dp);
    console.log(`  ${pad(r.pair, W_PAIR)} ${padL(val, 7)} ${padL(min, 7)}  ${verdict}${note}`);
  }
  console.log('');
}

/* --- the ramp ceiling: the lightest graphite each ink still clears --------- */
console.log('');
console.log(line('='));
console.log('  RAMP CEILING — deepest graphite each token clears (informational)');
console.log(line('='));
console.log(`  ${pad('TOKEN', 12)} ${GRAPHITE.map((g) => padL(g.replace('--', ''), 7)).join('')}   TEXT CEILING`);
for (const t of ['--ink', '--ink-2', '--ink-3', '--cyan', '--gold', '--amber', '--green', '--red', '--focus']) {
  const ratios = GRAPHITE.map((g) => contrastRatio(tok(t), tok(g)));
  let ceiling = 'none';
  for (let i = 0; i < GRAPHITE.length; i++) if (ratios[i] >= TEXT_MIN) ceiling = GRAPHITE[i];
  console.log(`  ${pad(t, 12)} ${ratios.map((r) => padL(r.toFixed(2), 7)).join('')}   ${ceiling === 'none' ? 'not a text colour' : `up to ${ceiling}`}`);
}

/* --- greyscale ladder: the twelve fills, ordered by luminance -------------- */
console.log('');
console.log(line('='));
console.log('  GREYSCALE LADDER — the twelve state fills with colour stripped');
console.log(line('='));
console.log(`  ${pad('GLYPH', 6)} ${pad('LABEL', 20)} ${pad('STATE', 20)} ${pad('FILL', 9)} ${padL('LUMINANCE', 10)}`);
for (const s of [...stateReport].sort((a, b) => a.lum - b.lum)) {
  console.log(`  ${pad(s.glyph, 6)} ${pad(s.label, 20)} ${pad(s.name, 20)} ${pad(s.hex, 9)} ${padL(s.lum.toFixed(4), 10)}`);
}

if (VERBOSE) {
  console.log('');
  console.log(line('='));
  console.log('  RESOLVED :root COLOUR TOKENS');
  console.log(line('='));
  for (const [name, value] of Object.entries(ROOT)) {
    try {
      const rgb = resolve(value);
      console.log(`  ${pad(name, 14)} ${pad(rgbToHex(rgb), 9)} L=${relativeLuminance(rgb).toFixed(4)}`);
    } catch { /* not a colour token */ }
  }
}

const total = rows.length;
const passed = rows.filter((r) => r.pass).length;
console.log('');
console.log(line('='));
if (failures === 0) {
  console.log(`  PASS — ${passed}/${total} pairs meet the budget.`);
  console.log(line('='));
  console.log('');
  process.exit(0);
} else {
  console.log(`  FAIL — ${failures} of ${total} pairs are below the budget:`);
  for (const r of rows.filter((x) => !x.pass)) {
    console.log(`         ${r.pair} — ${fmt(r.ratio)} (needs ${r.min.toFixed(2)}) ${r.note}`);
  }
  console.log(line('='));
  console.log('');
  process.exit(1);
}
