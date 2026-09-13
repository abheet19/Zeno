/**
 * bind/forge/menu-context.js — CONTEXT PINS and the governed IMAGE UPLOAD.
 *
 * PINS. "Code Context Items" lets the owner pin the editor selection, a
 * file, or the last terminal output. Each becomes a chip under the composer
 * and its text is appended to the task when the next task is sent — task
 * first, then a clearly delimited "Pinned context" block, so the session's
 * title stays the task. This is client-side only: the daemon has no context
 * store, and the task text is what actually reaches the agent (session.js's
 * sendTask). The hook is a CAPTURE-phase listener on the composer's Enter
 * and Send: it rewrites the textarea's value before session.js's own
 * bubble-phase handler reads it, which is the one seam that works without
 * editing session.js (whose composer handlers are private).
 *
 * IMAGE. "Upload image" opens a native file picker; the chosen image is
 * PROPOSED as a write into .zeno/attachments/<name> through POST /previews —
 * the same kernel gate as every other write. The kernel's file write is
 * text-only, so a binary image is stored base64-encoded (MIME, 76-column
 * lines) as <name>.b64, and an SVG as itself; the tier is the kernel's own
 * verdict (a routine tiny file is receipted at once, anything past the line
 * budget is held for Command). The pin says plainly that the local model is
 * text-only and cannot see the image, while a hosted agent can read the
 * file once it exists.
 *
 * Registers `S.pinContext`, `S.pinContextPrompt`, `S.uploadImage`, `S.pins`.
 */
import { $, $$, el, fill, getJSON } from '../../bind.js';
import { add, disableCtl, postJSON, safeAsk } from './dom.js';

const PIN_TEXT_CAP = 8000;
const IMAGE_BYTES_CAP = 700_000; // the daemon's JSON body cap is 1 MB; base64 grows a file by a third

export function setupMenuContext(S) {
  const ide = S.ide;
  const pins = [];
  S.pins = pins;
  let seq = 0;

  /* ---- chips ------------------------------------------------------------ */
  function hostFor(sel) {
    const anchor = $(sel, ide);
    if (!anchor) return null;
    let host = anchor.previousElementSibling;
    if (!host || !host.dataset || !host.dataset.ctxPins) {
      host = el('div');
      host.dataset.ctxPins = '1';
      host.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:0 0 4px';
      anchor.insertAdjacentElement('beforebegin', host);
    }
    return host;
  }
  function renderPins() {
    for (const host of [hostFor('.sesscompose .composer .foot'), hostFor('.ag-composer .ag-foot')]) {
      if (!host) continue;
      host.hidden = pins.length === 0;
      fill(host, ...pins.map((p) => {
        const chip = el('span', 'pill wt');
        chip.dataset.ctxPin = p.kind;
        chip.title = `${p.note ? `${p.note}\n` : ''}${p.text.slice(0, 400)}`;
        const x = el('button', null, '×');
        x.type = 'button';
        x.title = 'Unpin';
        x.style.cssText = 'border:0;background:none;color:inherit;cursor:pointer;padding:0 0 0 4px;font:inherit';
        x.addEventListener('click', () => { pins.splice(pins.indexOf(p), 1); renderPins(); });
        add(chip, document.createTextNode(`${p.kind}: ${p.label}`), x);
        return chip;
      }));
    }
  }
  function pinContext(pin) {
    seq += 1;
    pins.push({ id: seq, kind: pin.kind || 'context', label: String(pin.label || '').slice(0, 80), text: String(pin.text || '').slice(0, PIN_TEXT_CAP), note: pin.note || '' });
    renderPins();
    return seq;
  }
  S.pinContext = pinContext;

  /* ---- the send hook: append pinned context to the task ----------------- */
  function withContext(task) {
    if (!pins.length || !task.trim()) return task;
    const block = pins.map((p) => `[${p.kind}] ${p.label}${p.note ? ` — ${p.note}` : ''}\n${p.text}`).join('\n\n');
    return `${task.trim()}\n\n--- Pinned context (from Forge) ---\n${block}`;
  }
  function inject(ta) {
    if (!ta || !pins.length) return;
    const next = withContext(ta.value);
    if (next !== ta.value) { ta.value = next; pins.length = 0; renderPins(); }
  }
  // Capture phase: runs before session.js's bubble-phase Enter/click handlers.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const ta = e.target;
    if (ta && (ta.id === 's-ta' || ta.id === 'ag-ta')) inject(ta);
  }, true);
  document.addEventListener('click', (e) => {
    const send = e.target.closest('#s-send, #ag-send');
    if (!send) return;
    inject($(send.id === 's-send' ? '#s-ta' : '#ag-ta', ide));
  }, true);

  /* ---- "Code Context Items": what to pin --------------------------------- */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  async function pinFile(path) {
    const rel = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel) return;
    const r = await getJSON(`/forge/file?path=${encodeURIComponent(rel)}`);
    if (!r.ok) { safeAsk(() => window.alert(`${rel} could not be read: ${r.error}`)); return; }
    if (r.data.binary) { safeAsk(() => window.alert(`${rel} is binary — only text can be pinned as context.`)); return; }
    const text = String(r.data.contents ?? '');
    pinContext({ kind: 'file', label: rel, text, note: text.length > PIN_TEXT_CAP ? `first ${PIN_TEXT_CAP} characters` : (r.data.truncated ? 'truncated on read' : '') });
  }
  function pinContextPrompt() {
    // Opened from another menu's click (the "+" row): let THAT click finish
    // bubbling first, or the outside-click listener below closes this menu in
    // the same tick it was created.
    setTimeout(openPinMenu, 0);
  }
  function openPinMenu() {
    closeMenu();
    menuEl = el('div', 'menu');
    menuEl.setAttribute('role', 'menu');
    menuEl.dataset.contextMenu = '1';
    const row = (label, run, disabledReason) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (disabledReason) disableCtl(b, disabledReason);
      else b.addEventListener('click', () => { closeMenu(); void run(); });
      add(menuEl, b);
    };
    const sel = S.selectionContext ? S.selectionContext() : null;
    row(sel ? `Pin the editor selection — ${sel.path}:${sel.startLine}${sel.endLine !== sel.startLine ? `–${sel.endLine}` : ''}` : 'Pin the editor selection',
      () => pinContext({ kind: 'selection', label: `${sel.path}:${sel.startLine}${sel.endLine !== sel.startLine ? `–${sel.endLine}` : ''}`, text: sel.text }),
      sel ? null : 'No file is open in the editor.');
    row('Pin a file…', () => {
      const p = safeAsk(() => window.prompt('Repository path of the file to pin:', S.currentFile || ''), null);
      if (p) void pinFile(p);
    });
    const anchor = $('#s-attach', ide) || $('#ag-plus', ide) || document.body;
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    menuEl.style.left = `${Math.max(8, r.left)}px`;
    menuEl.style.top = `${Math.max(8, r.top - menuEl.offsetHeight - 8)}px`;
  }
  S.pinContextPrompt = pinContextPrompt;
  document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('[data-context-menu]')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ---- "Upload image": a governed write, then a pin ---------------------- */
  function mimeBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    // RFC 2045 line wrapping; the kernel's routine-edit budget is counted in
    // lines, so anything past a few KB is a held proposal by the kernel's own rule.
    return btoa(bin).replace(/(.{76})/g, '$1\n');
  }
  async function proposeImage(file) {
    if (!S.OWNER) { safeAsk(() => window.alert('This window has no owner token, so it cannot propose a write.')); return; }
    if (file.size > IMAGE_BYTES_CAP) { safeAsk(() => window.alert(`${file.name} is ${Math.round(file.size / 1024)} kB — the daemon accepts proposals up to 1 MB of JSON, so images must be under ${Math.round(IMAGE_BYTES_CAP / 1024)} kB.`)); return; }
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '');
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(safeName);
    const relPath = `.zeno/attachments/${safeName}${isSvg ? '' : '.b64'}`;
    const contents = isSvg ? await file.text() : mimeBase64(new Uint8Array(await file.arrayBuffer()));
    const r = await postJSON('/previews', {
      relPath, contents,
      summary: `Forge: attach image ${file.name}${isSvg ? '' : ' (base64, MIME 76-column lines — the kernel’s file write is text-only)'}`,
      requestedBy: 'forge-editor',
    });
    if (!r.ok) { safeAsk(() => window.alert(`${file.name} could not be proposed: ${r.error}`)); return; }
    const held = !(r.data && r.data.receipt);
    const state = held
      ? `held for approval (tier ${r.data.preview ? r.data.preview.tier : '?'}) — it exists on disk only after you approve it in Command`
      : 'routine — receipted and written by the kernel';
    pinContext({
      kind: 'image', label: relPath,
      text: `Image attached at ${relPath} (${state}).${isSvg ? '' : ' Base64-encoded; decode with certutil -decode / base64 -d.'}`,
      note: 'The local qwen model is text-only and cannot see this image; a hosted agent (Claude Code / Codex) can read the file once it exists.',
    });
    void S.loadStatus();
  }
  function uploadImage() {
    for (const old of $$('input[data-forge-upload]')) old.remove();
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.dataset.forgeUpload = '1';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.remove(); if (f) void proposeImage(f); });
    document.body.appendChild(input);
    input.click();
  }
  S.uploadImage = uploadImage;

  renderPins();
}
