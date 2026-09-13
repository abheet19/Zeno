/**
 * bind/command-menu.js — the "/" command menu shared by every composer
 * (Command's Home chat, Forge's hero and session composers).
 *
 * Typing "/" as the very first character of an otherwise-empty composer opens
 * a small floating list, Cascade/Windsurf-style, above the textarea. It lists
 * only the REAL commands this composer can run right now — `getCommands()` is
 * re-evaluated every time the menu opens or the filter changes, so a command
 * whose target does not exist at this moment (no active session to reset, no
 * model picker on this screen) is simply left out, never listed and then a
 * no-op. Up/Down move the selection, Enter runs it, Escape closes the menu.
 *
 * This module owns only the menu and its keyboard grammar; each command's
 * `run()` calls straight into the real control it names (a click on the same
 * button the owner's own mouse would use), so there is exactly one code path
 * for "do the thing", whether it is reached by mouse, by typing, or by /command.
 */
import { el, fill } from '../bind.js';

/**
 * Wire a "/" command menu onto `ta` (a textarea).
 *
 *   getCommands(): () => [{ id, label, hint, run: () => void }]
 *
 * Returns `{ handleKeydown }` — call it from the SAME keydown listener that
 * already submits the composer on Enter, BEFORE that submit logic runs. It
 * returns true when it consumed the key (the caller must do nothing else).
 */
export function setupCommandMenu(ta, getCommands) {
  if (!ta) return { handleKeydown: () => false };
  let menuEl = null;
  let items = [];
  let active = 0;

  function close() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function run(c) {
    close();
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    c.run();
  }

  function paint() {
    if (!menuEl) return;
    const list = menuEl.querySelector('.cmdmenu-list');
    if (!items.length) { fill(list, el('div', 'cmdmenu-empty', 'No matching command.')); return; }
    fill(list, ...items.map((c, i) => {
      const row = el('button', `cmdmenu-row${i === active ? ' on' : ''}`);
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === active ? 'true' : 'false');
      row.append(el('span', 'cmdmenu-name', `/${c.id}`), el('span', 'cmdmenu-hint', c.hint || c.label || ''));
      row.addEventListener('mouseenter', () => { active = i; paint(); });
      row.addEventListener('mousedown', (e) => { e.preventDefault(); run(c); }); // mousedown: fires before the textarea's blur closes the menu
      return row;
    }));
  }

  function position() {
    if (!menuEl) return;
    const r = ta.getBoundingClientRect();
    menuEl.style.left = `${Math.round(r.left)}px`;
    menuEl.style.width = `${Math.round(Math.min(360, Math.max(220, r.width)))}px`;
    // Above the composer, Cascade-style — flip below only if there is truly no room above.
    const above = r.top > 220;
    menuEl.style.top = above ? 'auto' : `${Math.round(r.bottom + 6)}px`;
    menuEl.style.bottom = above ? `${Math.round(window.innerHeight - r.top + 6)}px` : 'auto';
  }

  function open(query) {
    const all = (getCommands() || []).filter(Boolean);
    items = query ? all.filter((c) => c.id.startsWith(query)) : all;
    active = 0;
    if (!menuEl) {
      menuEl = el('div', 'cmdmenu');
      menuEl.setAttribute('role', 'listbox');
      menuEl.append(el('div', 'cmdmenu-list'));
      document.body.appendChild(menuEl);
    }
    position();
    paint();
  }

  ta.addEventListener('input', () => {
    const v = ta.value;
    // Only at the very start, and only the bare "/word" shape — a "/" typed
    // mid-sentence, or with a space after the command name, is real text, not
    // a command invocation.
    const m = /^\/([a-z-]*)$/i.exec(v);
    if (m) open(m[1].toLowerCase()); else close();
  });
  ta.addEventListener('blur', () => setTimeout(close, 150)); // after a row's own mousedown fires
  window.addEventListener('resize', position);

  return {
    handleKeydown(e) {
      if (!menuEl) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, Math.max(items.length - 1, 0)); paint(); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); return true; }
      if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[active]) run(items[active]); return true; }
      return false;
    },
  };
}
