/**
 * bind/forge/editor-highlight.js — the editor's degraded, non-Monaco view.
 *
 * Minimal syntax colouring for the handful of extensions the stylesheet
 * already has .kw/.st/.cm rules for (matches the real forge.js's own
 * tokenizer; duplicated here since it is not exported). Used ONLY while
 * Monaco is still loading, or failed to load — never a placeholder, an
 * honest degraded view of the same bytes /forge/file handed the caller.
 */
import { el, fill } from '../../bind.js';
import { add } from './dom.js';

const HL_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json']);
const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new',
  'class', 'extends', 'implements', 'interface', 'type', 'enum', 'namespace', 'declare',
  'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'async', 'await',
  'yield', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of',
  'delete', 'void', 'null', 'undefined', 'true', 'false', 'this', 'super', 'as',
]);

function highlightable(path) {
  const dot = String(path || '').lastIndexOf('.');
  return dot === -1 ? false : HL_EXT.has(path.slice(dot + 1).toLowerCase());
}

function tokenizeLine(line, st) {
  const out = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (!plain) return;
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let last = 0, m;
    while ((m = re.exec(plain)) !== null) {
      if (m.index > last) out.push(['', plain.slice(last, m.index)]);
      out.push([KEYWORDS.has(m[0]) ? 'kw' : '', m[0]]);
      last = m.index + m[0].length;
    }
    if (last < plain.length) out.push(['', plain.slice(last)]);
    plain = '';
  };
  while (i < line.length) {
    if (st.block) {
      const end = line.indexOf('*/', i);
      if (end === -1) { out.push(['cm', line.slice(i)]); i = line.length; }
      else { out.push(['cm', line.slice(i, end + 2)]); i = end + 2; st.block = false; }
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '//') { flush(); out.push(['cm', line.slice(i)]); i = line.length; continue; }
    if (two === '/*') { flush(); out.push(['cm', '/*']); st.block = true; i += 2; continue; }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      flush();
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) { j++; break; }
        j++;
      }
      out.push(['st', line.slice(i, j)]);
      i = j;
      continue;
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

function lineNode(text, colour, st) {
  const span = el('span', null);
  if (!colour) { span.textContent = text; return span; }
  for (const [cls, s] of tokenizeLine(text, st)) add(span, cls ? el('span', cls, s) : document.createTextNode(s));
  return span;
}

/** The hand-rolled tokeniser above, reused as an honest degraded view —
 *  never a placeholder — while monaco is still loading or could not load at
 *  all. It reads the same bytes /forge/file handed us; it is a worse
 *  editor, not a wrong one. */
export function plainFallbackNodes(path, data, banner) {
  const nodes = [el('div', 'vsnote', banner)];
  const pre = el('pre', 'fcode');
  pre.style.cssText = 'margin:0;flex:1;min-height:0;overflow:auto;';
  const kids = [];
  const lines = String(data.contents ?? '').split('\n');
  const colour = highlightable(path);
  const st = { block: false };
  lines.forEach((text, i) => {
    kids.push(el('span', 'ln', String(i + 1)));
    kids.push(lineNode(text === '' ? ' ' : text, colour, st));
    if (i < lines.length - 1) kids.push(document.createTextNode('\n'));
  });
  fill(pre, ...kids);
  nodes.push(pre);
  return nodes;
}
