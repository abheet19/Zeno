/**
 * bind/lists/customize.js — CUSTOMIZE screen: what shapes a Forge run in the
 * selected repository. Rules and Skills, plus the informational local
 * extensions catalog. Nothing that reaches OUT of the machine lives here —
 * work sources, connectors, MCP servers and the model runtime are
 * Integrations' job (bind/lists/integrations.js), so the two screens no
 * longer draw the same catalog twice.
 *
 * Draws a plain `.card > .row-list[data-mount="customize-list"]`. Every row
 * is real:
 *   rules       GET /skills's `rules` (the files routes/forge-context.ts
 *               actually found) under "Yours"; GET /capabilities/conventions
 *               (the one list it scans) under "Discover". "+ Add" and "Edit"
 *               open the governed rule form in bind/lists/authoring.js, which
 *               POSTs /capabilities/rules — a HELD file-write proposal the
 *               owner approves in Approvals. Never a direct write.
 *   skills      GET /skills under "Yours" (a suspicious screening verdict
 *               shows "review findings", as it always has); GET
 *               /forge/extensions' global catalog under "Discover". "+ Add
 *               skill" opens the governed skill form (POST
 *               /capabilities/skills → .agents/skills/<id>/SKILL.md, held).
 *   extensions  GET /forge/extensions — built-ins, skill sources, editor
 *               snippets. Informational; there is no install route and the
 *               rows say so.
 *
 * The rule and skill managers keep module-level state so an open form and a
 * "proposed — waiting on you" status survive bind/live.js re-running this
 * binder on each state/receipt event — which is also how an approved file
 * shows up under "Yours": the binder re-reads GET /skills.
 */

import { getJSON, fill, token, screenEl } from '../../bind.js';
import {
  headingEl, noteEl, emptyEl, loadingEl, unreadableEl, lrowEl, pillEl, viewToggleEl, disableBtn,
  builtinFacts, snippetFacts, skillSourceLine,
} from './shared.js';
import { ruleConventionMatches, skillDiscoverNode, ruleDiscoverNode, ruleNode } from './discover.js';
import { createRuleAuthor, createSkillAuthor } from './authoring.js';

const YOURS_DISCOVER = [{ value: 'yours', label: 'Yours' }, { value: 'discover', label: 'Discover' }];

function skillRow(sk) {
  const meta = 'id ' + (sk.id || '?') + ' · ' + (sk.bytes || 0) + ' bytes';
  const susp = sk.verdict === 'suspicious';
  return lrowEl('SKL', sk.name || sk.id || 'skill', meta, pillEl(susp ? 'review findings' : 'screened', susp ? 'am' : 'gr'));
}
function builtinRow(b) {
  const f = builtinFacts(b);
  return lrowEl('EXT', f.name, f.meta, pillEl(f.pillText, f.pillCls));
}
function snippetRow(sn) {
  const f = snippetFacts(sn);
  return lrowEl('SNP', f.name, f.meta, pillEl(f.pillText, f.pillCls));
}

const rules = createRuleAuthor('lrow');
const skillsAuthor = createSkillAuthor('lrow');
// The Yours/Discover choice per section survives a live re-bind too.
const view = { rules: 'yours', skills: 'yours' };

export async function bindCustomize() {
  const screen = screenEl('customize');
  if (!screen) return;
  const listEl = screen.querySelector('[data-mount="customize-list"]');
  if (!listEl) return;

  const hasOwner = !!token();
  let skillsRes = null;
  let extensionsRes = null;

  // The screen's own header buttons open the same two forms the sections do.
  const addRuleBtn = screen.querySelector('[data-customize-add-rule]');
  const addSkillBtn = screen.querySelector('[data-customize-add-skill]');
  if (addRuleBtn && !addRuleBtn.dataset.bound) {
    addRuleBtn.dataset.bound = '1';
    if (!hasOwner) disableBtn(addRuleBtn, 'This window has no owner token, so it cannot propose a file write.');
    else addRuleBtn.addEventListener('click', () => { view.rules = 'yours'; rules.openFor({}); });
  }
  if (addSkillBtn && !addSkillBtn.dataset.bound) {
    addSkillBtn.dataset.bound = '1';
    if (!hasOwner) disableBtn(addSkillBtn, 'This window has no owner token, so it cannot propose a file write.');
    else addSkillBtn.addEventListener('click', () => { view.skills = 'yours'; skillsAuthor.open(); });
  }

  function render() {
    const nodes = [];
    const rulesList = (skillsRes && skillsRes.ok && skillsRes.data && Array.isArray(skillsRes.data.rules)) ? skillsRes.data.rules : [];
    const onEditRule = (r) => { view.rules = 'yours'; rules.openFor({ path: r.path, text: r.body }); };

    nodes.push(headingEl('rules'));
    nodes.push(viewToggleEl(YOURS_DISCOVER, view.rules, (v) => { view.rules = v; render(); }));
    if (view.rules === 'discover') {
      nodes.push(noteEl('The fixed set of rule-file conventions Forge scans in the selected repository — read from the '
        + 'daemon (routes/forge-context.ts), so this list and the run-time scan cannot disagree. "+ Add" opens a governed '
        + 'proposal: the file is written only after you approve it in Approvals.'));
      const convs = rules.conventions();
      if (!convs.length) nodes.push(unreadableEl('The rule conventions', 'GET /capabilities/conventions gave nothing back.'));
      convs.forEach((conv) => nodes.push(ruleDiscoverNode('lrow', conv, ruleConventionMatches(conv, rulesList), {
        hasOwner,
        onAdd: (c) => { view.rules = 'yours'; rules.openFor({ convention: c.path }); },
        onEdit: (c) => { const r = rulesList.find((x) => x && x.path === c.path); if (r) onEditRule(r); },
      })));
    } else {
      nodes.push(noteEl('Repository rule files Forge actually found and folds into a run’s prompt as repository '
        + 'constraints — never executed on their own. Adding or editing one is a governed file write you approve.'));
      nodes.push(rules.toggleNode(hasOwner));
      rules.nodes(hasOwner).forEach((n) => nodes.push(n));
      if (!skillsRes) nodes.push(loadingEl('Reading rules…'));
      else if (!skillsRes.ok) nodes.push(unreadableEl('Rules', skillsRes.error));
      else if (!rulesList.length) nodes.push(emptyEl('No rule files were found in this repository.', 'Add one above, or pick a convention under "Discover".'));
      else rulesList.forEach((r) => nodes.push(ruleNode('lrow', r, { hasOwner, onEdit: onEditRule })));
    }

    nodes.push(headingEl('skills'));
    nodes.push(viewToggleEl(YOURS_DISCOVER, view.skills, (v) => { view.skills = v; render(); }));
    if (view.skills === 'discover') {
      nodes.push(noteEl('Every Agent Skill Zeno can see anywhere on this machine — this repository and every '
        + 'known global source — with its provenance and whether it is installed in the selected repository. The '
        + 'catalog carries names and descriptions, not skill bodies, so nothing here can be added by click; write one '
        + 'under "Yours" or copy a folder into .agents/skills.'));
      if (!extensionsRes) {
        nodes.push(loadingEl('Reading the skill catalog…'));
      } else if (!extensionsRes.ok) {
        nodes.push(unreadableEl('The skill catalog', extensionsRes.error));
      } else {
        const entries = Array.isArray(extensionsRes.data && extensionsRes.data.skills) ? extensionsRes.data.skills : [];
        if (!entries.length) nodes.push(emptyEl('No skill sources were found.', ''));
        entries.slice(0, 20).forEach((e) => nodes.push(skillDiscoverNode('lrow', e)));
        if (entries.length > 20) nodes.push(noteEl('+ ' + (entries.length - 20) + ' more not shown.'));
      }
    } else {
      nodes.push(noteEl('Skills are catalogued read-only and never loaded ambiently; a skill acts only after it '
        + 'is installed into the repository and selected in Forge, and it grants no tool permission on its own. '
        + 'Adding one is a governed file write you approve.'));
      nodes.push(skillsAuthor.toggleNode(hasOwner));
      skillsAuthor.nodes(hasOwner).forEach((n) => nodes.push(n));
      if (!skillsRes) {
        nodes.push(loadingEl('Reading installed skills…'));
      } else if (!skillsRes.ok) {
        nodes.push(unreadableEl('Installed skills', skillsRes.error));
      } else {
        const installed = Array.isArray(skillsRes.data && skillsRes.data.skills) ? skillsRes.data.skills : [];
        const failed = Array.isArray(skillsRes.data && skillsRes.data.failed) ? skillsRes.data.failed : [];
        if (!installed.length) nodes.push(emptyEl('No repository skills are installed.', 'Add one above; it lands in .agents/skills/<id>/SKILL.md once you approve it.'));
        else installed.forEach((sk) => nodes.push(skillRow(sk)));
        if (failed.length) nodes.push(noteEl(failed.length + ' skill file(s) could not be loaded.'));
      }
    }

    nodes.push(headingEl('extensions'));
    nodes.push(noteEl('Zeno’s own local capability catalog — not the VS Code Marketplace, and not an installable '
      + 'extension host. These rows are informational; there is no install route.'));
    if (!extensionsRes) {
      nodes.push(loadingEl('Reading extensions…'));
    } else if (!extensionsRes.ok) {
      nodes.push(unreadableEl('Extensions', extensionsRes.error));
    } else {
      const data = extensionsRes.data || {};
      const builtins = Array.isArray(data.builtins) ? data.builtins : [];
      builtins.forEach((b) => nodes.push(builtinRow(b)));
      const snippets = Array.isArray(data.snippets) ? data.snippets : [];
      snippets.forEach((sn) => nodes.push(snippetRow(sn)));
      const sources = Array.isArray(data.skillSources) ? data.skillSources : [];
      if (sources.length) sources.forEach((s) => nodes.push(noteEl(skillSourceLine(s))));
    }

    fill(listEl, ...nodes);
  }

  rules.setRerender(render);
  skillsAuthor.setRerender(render);
  render();
  const [skills, extensions] = await Promise.all([
    getJSON('/skills'), getJSON('/forge/extensions'), rules.load(), skillsAuthor.load(),
  ]);
  skillsRes = skills; extensionsRes = extensions;
  render();
}
