/**
 * bind/lists/projects.js — PROJECTS screen: the repositories Zeno can
 * actually work in.
 *
 * Draws a plain `.card > .row-list[data-mount="projects-list"]`. This
 * daemon exposes no endpoint that lists more than one project — only `GET
 * /forge/status`, which reports the one sandbox repo Forge actually
 * operates in. That single repo is drawn as one row, real; there is no
 * `/projects` or `/repos` route anywhere in server.ts that lists more than
 * that one — checked directly against the router, not assumed — so the
 * absence of a real multi-project endpoint is stated plainly rather than
 * papered over with invented rows.
 */

import { getJSON, el, fill, screenEl } from '../../bind.js';
import { plural, clip, toast, lrowEl, emptyEl, loadingEl, unreadableEl, noteEl } from './shared.js';

export async function bindProjects() {
  const screen = screenEl('projects');
  if (!screen) return;
  const listEl = screen.querySelector('[data-mount="projects-list"]');
  if (!listEl) return;

  const addBtn = screen.querySelector('[data-projects-add]');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      toast('This daemon has no endpoint to register another project — Forge always works in the one sandbox repository below.');
    });
  }

  fill(listEl, loadingEl('Reading the sandbox repository…'));
  const st = await getJSON('/forge/status');
  const nodes = [];

  if (!st.ok) {
    nodes.push(unreadableEl('The sandbox repository', st.error));
  } else {
    const d = st.data || {};
    if (d.repo === false) {
      nodes.push(emptyEl('The sandbox is not a git repository.', String(d.note || '')));
    } else {
      const changed = Array.isArray(d.changed) ? d.changed.length : null;
      const meta = [
        d.branch ? 'branch ' + d.branch : null,
        d.head ? 'HEAD ' + String(d.head).slice(0, 12) : 'no commits yet',
        changed == null ? null : changed + ' ' + plural(changed, 'uncommitted file', 'uncommitted files'),
      ].filter(Boolean).join(' · ');
      const openBtn = el('button', 'laction cy', 'Open in Forge');
      openBtn.type = 'button';
      openBtn.setAttribute('data-product-go', 'forge');
      nodes.push(lrowEl('repo', clip(d.root || 'the sandbox', 90), meta, openBtn));
    }
  }

  nodes.push(noteEl('This daemon reports only the one sandbox repository Forge operates in — there is no '
    + '/projects or /repos endpoint that lists more than that, so nothing else is drawn here. Multiple, '
    + 'switchable projects are not a feature this daemon exposes yet.'));

  fill(listEl, ...nodes);
}
