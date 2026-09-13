/*
 * capsule/dom.js — the two tiny DOM helpers every other capsule module is
 * built on: textContent only, never innerHTML with data.
 */

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

export function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
