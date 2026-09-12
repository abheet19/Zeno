/**
 * Command keeps every capability mounted, but shows one workspace at a time.
 * The left rail is navigation, so activating it changes the visible content
 * instead of dropping the owner halfway down one very long dashboard.
 */

const command = document.querySelector('[data-surface="command"]');
const main = command?.querySelector('.cmdmain');

function one(selector) {
  return command?.querySelector(selector) || null;
}

const groups = new Map([
  ['cmd-hero', [one('.hero'), one('.home-starters'), one('.cmdduo'), one('#cmd-status'), one('#cmd-desk')]],
  ['chats', [one('#chats')]],
  ['pending', [one('#pending')]],
  ['timeline', [one('#timeline')]],
  ['sec-workstation', [one('#sec-workstation')]],
  ['sec-vault', [one('#sec-vault')]],
  ['devices', [one('#devices')]],
  ['sec-integrations', [one('#sec-integrations')]],
  ['projects', [one('#projects')]],
  ['customize', [one('#customize')]],
]);

const managed = new Set([...groups.values()].flat().filter(Boolean));
const aliases = new Map([['desk', 'cmd-hero']]);

function destination(id) {
  return id === 'cmd-hero' ? one('.hero') : one('#' + id) || one(`[data-mount="${id}"]`);
}

function show(id, options = {}) {
  const requested = id;
  id = aliases.get(id) || id;
  const visible = groups.get(id);
  if (!visible) return false;
  const previous = command.dataset.commandPanel || null;
  for (const node of managed) node.hidden = !visible.includes(node);
  command.dataset.commandPanel = id;

  for (const item of command.querySelectorAll('.rail-n[data-jump]')) {
    const current = item.dataset.jump === id;
    if (current) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }

  main?.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
  const target = destination(requested);
  const disclosure = target?.closest?.('details');
  if (disclosure) disclosure.open = true;
  if (options.focus && target?.focus) target.focus({ preventScroll: true });
  if (previous && previous !== id && id !== 'cmd-hero') {
    const detail = { requestedBy: 'another Command section', waiters: [] };
    window.dispatchEvent(new CustomEvent('zeno:release-command-voice', { detail }));
  }
  window.dispatchEvent(new CustomEvent('zeno:command-panel', { detail: { id, requested, previous } }));
  return true;
}

for (const item of command?.querySelectorAll('.rail-n[data-jump]') || []) {
  const target = destination(item.dataset.jump);
  if (target?.id) item.setAttribute('aria-controls', target.id);
}

/* Capture first so the destination is visible before an existing CTA scrolls
   or focuses it. The original handlers still own their actions. */
document.addEventListener('click', event => {
  const hit = event.target instanceof Element
    ? event.target.closest('.rail-n[data-jump],.nodecard [data-jump],[data-goto],.skip')
    : null;
  if (!hit) return;
  let id = hit.matches('.skip') ? 'pending' : hit.getAttribute('data-jump') || hit.getAttribute('data-goto') || '';
  if (id.startsWith('#')) id = id.slice(1);
  if (!groups.has(id) && !aliases.has(id)) return;
  if (hit.matches('.skip')) {
    event.preventDefault();
    window.ZenoNav?.show('command');
  }
  show(id, { focus: hit.matches('.skip') });
}, true);

window.ZenoCommandPanels = { show, get current() { return command?.dataset.commandPanel || null; } };
show('cmd-hero', { instant: true });
