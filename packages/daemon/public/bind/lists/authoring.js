/**
 * bind/lists/authoring.js — the two "make it real" forms on Customize: add or
 * edit a repository RULE, and add an Agent SKILL.
 *
 * Each POSTs routes/capabilities.ts (`/capabilities/rules`,
 * `/capabilities/skills`), which turns the text into an ordinary file-write
 * proposal through the daemon's one gate: jailed, risk-assessed, scanned for
 * secrets, HELD for the owner's approval in Approvals, then written and
 * receipted. Nothing here writes a file, and nothing here can approve one.
 *
 * Both are small stateful managers in the shape of bind/lists/mcp.js's
 * createMcpManager: module-level state, so the open form, its draft and the
 * "proposed — waiting on you" status survive bind/live.js re-running the
 * Customize binder on every state/receipt event. That same re-run is how an
 * approved rule or skill appears under "Yours" — the binder re-reads GET
 * /skills; nothing is added to the list optimistically.
 *
 * What became of a proposal is READ from /state on every load, never
 * remembered: still in `pending` → waiting; its hash on a receipt → approved
 * and written; neither → refused. The form never claims a file exists that
 * the daemon has not confirmed.
 */

import { getJSON, el } from '../../bind.js';
import {
  postJSON, toast, disableBtn, lrowEl, lcardOuter, pillEl,
  inputEl, textareaEl, selectEl, formBox, statusEl,
} from './shared.js';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NO_OWNER = 'This window has no owner token, so it cannot propose a file write.';

function outer(shape, tier, title, meta, right) {
  return shape === 'lcard' ? lcardOuter(title, meta, right) : lrowEl(tier, title, meta, right);
}

async function proposalFate(actionHash) {
  const st = await getJSON('/state');
  if (!st.ok) return 'unknown';
  const pending = Array.isArray(st.data && st.data.pending) ? st.data.pending : [];
  if (pending.some((p) => p && p.actionHash === actionHash)) return 'pending';
  const receipts = Array.isArray(st.data && st.data.receipts) ? st.data.receipts : [];
  if (receipts.some((r) => r && r.actionHash === actionHash)) return 'applied';
  return 'refused';
}

/** The row that reports the last proposal's fate, with a live jump to
 *  Approvals while it is still waiting (ui.js delegates `[data-screen-jump]`). */
function fateNode(shape, tier, last) {
  if (!last) return null;
  if (last.fate === 'pending') {
    const go = el('button', 'btn sm p', 'Open Approvals');
    go.type = 'button';
    go.setAttribute('data-screen-jump', 'approvals');
    return outer(shape, tier, 'Proposed ' + last.relPath,
      'Held at ' + (last.tier || 'T1') + ' — nothing is written until you approve it in Approvals.', go);
  }
  if (last.fate === 'applied') {
    return outer(shape, tier, 'Written ' + last.relPath, 'Approved and receipted — it is now listed under "Yours".', pillEl('written', 'gr'));
  }
  if (last.fate === 'refused') {
    return outer(shape, tier, 'Refused ' + last.relPath, 'The proposal was refused; nothing was written.', pillEl('refused', 'wt'));
  }
  return outer(shape, tier, 'Proposed ' + last.relPath, 'Its outcome could not be read from /state.', pillEl('unread', 'am'));
}

/* ---------------------------------------------------------------------- *
 * RULES — a file under one of the conventions GET /capabilities/conventions
 * reports (the same list routes/forge-context.ts scans at run time).
 * ---------------------------------------------------------------------- */
export function createRuleAuthor(shape) {
  let conventions = null;   // GET /capabilities/conventions
  let open = false;
  let draft = { convention: '', name: '', text: '' };
  let status = '';
  let last = null;          // { actionHash, relPath, tier, fate }
  let rerender = () => {};

  function list() {
    return conventions && conventions.ok && Array.isArray(conventions.data.conventions) ? conventions.data.conventions : [];
  }
  function current() { return list().find((c) => c.path === draft.convention) || list()[0] || null; }

  async function submit() {
    const conv = current();
    if (!conv) { status = 'The rule conventions could not be read, so there is nowhere to write.'; rerender(); return; }
    if (!draft.text.trim()) { status = 'Give the rule some text.'; rerender(); return; }
    if (conv.kind === 'dir' && !KEBAB.test(draft.name)) { status = 'A rule in a rule folder needs a kebab-case file name, e.g. "no-console-logs".'; rerender(); return; }
    const r = await postJSON('/capabilities/rules', { convention: conv.path, name: draft.name, text: draft.text });
    if (!r.ok) { status = 'Not proposed: ' + r.error; rerender(); return; }
    const preview = r.data.preview || {};
    last = { actionHash: preview.actionHash, relPath: r.data.relPath, tier: preview.tier, fate: r.data.receipt ? 'applied' : 'pending' };
    open = false; status = '';
    toast(r.data.receipt ? 'Rule written and receipted.' : 'Rule proposed — approve it in Approvals.');
    rerender();
  }

  return {
    setRerender(fn) { rerender = fn; },
    async load() {
      if (!conventions || !conventions.ok) conventions = await getJSON('/capabilities/conventions');
      if (last && last.actionHash) last.fate = await proposalFate(last.actionHash);
    },
    conventions: list,
    /** Open the form for a convention (Discover "+ Add") or an existing rule
     *  file (Yours "Edit": `path` is split back into convention + name). */
    openFor(opts) {
      opts = opts || {};
      let convention = opts.convention || '';
      let name = opts.name || '';
      if (opts.path) {
        const dir = list().find((c) => c.kind === 'dir' && opts.path.startsWith(c.path + '/'));
        if (dir) { convention = dir.path; name = opts.path.slice(dir.path.length + 1).replace(/\.(md|mdc)$/i, ''); }
        else convention = opts.path;
      }
      open = true; status = '';
      draft = { convention, name, text: opts.text || '' };
      rerender();
    },
    toggleNode(hasOwner) {
      const toggle = el('button', 'btn sm g', open ? 'Close' : '+ Add rule');
      toggle.type = 'button';
      toggle.addEventListener('click', () => { open = !open; status = ''; rerender(); });
      if (!hasOwner) disableBtn(toggle, NO_OWNER);
      return outer(shape, 'RUL', 'Add a rule', 'Written to the repository as a governed proposal you approve — never applied silently.', toggle);
    },
    canEdit() { return list().length > 0; },
    nodes(hasOwner) {
      const nodes = [];
      const fate = fateNode(shape, 'RUL', last);
      if (fate) nodes.push(fate);
      if (!open) return nodes;
      const box = formBox(shape);
      const conv = current();
      if (conv && conv.path !== draft.convention) draft.convention = conv.path;
      box.appendChild(selectEl(
        list().map((c) => ({ value: c.path, label: c.path + (c.kind === 'dir' ? '/<name>' + c.extension : '') + ' — ' + c.note })),
        draft.convention, (v) => { draft.convention = v; rerender(); }, 'Rule file convention',
      ));
      if (conv && conv.kind === 'dir') {
        box.appendChild(inputEl('file name (kebab-case) — e.g. no-console-logs', draft.name, (v) => { draft.name = v; }));
      }
      box.appendChild(textareaEl('The rule, as you would say it to a colleague. It is folded into every Forge run as a repository constraint.',
        draft.text, (v) => { draft.text = v; }, 8));
      const propose = el('button', 'btn sm p', 'Propose rule');
      propose.type = 'button';
      if (!hasOwner) disableBtn(propose, NO_OWNER);
      else propose.addEventListener('click', () => { propose.disabled = true; submit().finally(() => { propose.disabled = false; }); });
      box.appendChild(propose);
      box.appendChild(statusEl(status));
      nodes.push(box);
      return nodes;
    },
  };
}

/* ---------------------------------------------------------------------- *
 * SKILLS — `.agents/skills/<id>/SKILL.md`, front-matter name/description then
 * the instructions, parsed and screened by the daemon before it is proposed.
 * ---------------------------------------------------------------------- */
export function createSkillAuthor(shape) {
  let open = false;
  let draft = { id: '', name: '', description: '', instructions: '' };
  let status = '';
  let last = null;
  let rerender = () => {};

  async function submit() {
    if (!KEBAB.test(draft.id)) { status = 'The id must be kebab-case: lower-case letters, digits and single hyphens (it names the folder).'; rerender(); return; }
    if (!draft.name.trim()) { status = 'Give the skill a one-line name.'; rerender(); return; }
    if (!draft.description.trim()) { status = 'Give the skill a one-line description — it is what a task is matched against.'; rerender(); return; }
    if (!draft.instructions.trim()) { status = 'Give the skill its instructions.'; rerender(); return; }
    const r = await postJSON('/capabilities/skills', draft);
    if (!r.ok) { status = 'Not proposed: ' + r.error; rerender(); return; }
    const preview = r.data.preview || {};
    const screening = r.data.screening || {};
    last = {
      actionHash: preview.actionHash, relPath: r.data.relPath, tier: preview.tier, fate: r.data.receipt ? 'applied' : 'pending',
      verdict: screening.verdict, findings: Array.isArray(screening.findings) ? screening.findings.length : 0,
    };
    open = false; status = '';
    toast(last.verdict === 'suspicious'
      ? 'Skill proposed — screening found ' + last.findings + ' thing(s) to read before you approve.'
      : 'Skill proposed — approve it in Approvals.');
    rerender();
  }

  return {
    setRerender(fn) { rerender = fn; },
    async load() { if (last && last.actionHash) last.fate = await proposalFate(last.actionHash); },
    open() { open = true; status = ''; rerender(); },
    toggleNode(hasOwner) {
      const toggle = el('button', 'btn sm g', open ? 'Close' : '+ Add skill');
      toggle.type = 'button';
      toggle.addEventListener('click', () => { open = !open; status = ''; rerender(); });
      if (!hasOwner) disableBtn(toggle, NO_OWNER);
      return outer(shape, 'SKL', 'Add a skill', 'Writes .agents/skills/<id>/SKILL.md as a governed proposal you approve; screened for gate-reaching text first.', toggle);
    },
    nodes(hasOwner) {
      const nodes = [];
      const fate = fateNode(shape, 'SKL', last);
      if (fate) {
        if (last.verdict === 'suspicious') fate.appendChild(el('div', 'mm', 'Screening: ' + last.findings + ' finding(s) — read them in the approval before you allow it.'));
        nodes.push(fate);
      }
      if (!open) return nodes;
      const box = formBox(shape);
      box.appendChild(inputEl('id — kebab-case folder name, e.g. review-migrations', draft.id, (v) => { draft.id = v.trim(); }));
      box.appendChild(inputEl('name — one line', draft.name, (v) => { draft.name = v; }));
      box.appendChild(inputEl('description — one sentence saying when this skill applies', draft.description, (v) => { draft.description = v; }));
      box.appendChild(textareaEl('Instructions (markdown). A model reads this after the front-matter; it adds to what an agent knows, never to what it may do.',
        draft.instructions, (v) => { draft.instructions = v; }, 10));
      const propose = el('button', 'btn sm p', 'Propose skill');
      propose.type = 'button';
      if (!hasOwner) disableBtn(propose, NO_OWNER);
      else propose.addEventListener('click', () => { propose.disabled = true; submit().finally(() => { propose.disabled = false; }); });
      box.appendChild(propose);
      box.appendChild(statusEl(status));
      nodes.push(box);
      return nodes;
    },
  };
}
