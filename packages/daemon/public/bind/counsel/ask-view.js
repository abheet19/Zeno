/**
 * bind/counsel/ask-view.js — the "ask your archive" composer and its answer
 * rendering (POST /counsel/ask, against the whole archive — not just
 * whichever call is open). `ask1` itself (the submit handler that refuses to
 * run while a call is live) stays in bind/counsel.js: it is extracted by name
 * by the desktop test (see that file's header), so `deps.ask1` here is just a
 * thin call-through to it.
 */
import { $, el, fill, getJSON } from '../../bind.js';
import { pill } from './format.js';

function lookupCite(cache, id) {
  for (const m of cache.values()) {
    if (m.id === id) return { meeting: m, line: null };
    for (const u of m.utterances || []) if (u.id === id) return { meeting: m, line: u };
  }
  return null;
}

/**
 * @param {object} deps
 * @param {Element} deps.root
 * @param {Map<string, object>} deps.cache
 * @param {() => {askThread: {question:string, node:Node}[], asking: boolean, archiveState: string, CALL: object|null}} deps.getState
 * @param {(question: string) => Promise<void>} deps.ask1
 */
export function makeAskView({ root, cache, getState, ask1 }) {
  async function warmCache(ids) {
    for (const id of ids) {
      if (!id || cache.has(id)) continue;
      const r = await getJSON(`/counsel/meetings/${encodeURIComponent(id)}`);
      if (r.ok && r.data && r.data.meeting) cache.set(id, r.data.meeting);
    }
  }

  function answerNode(d) {
    if (d.ok === false) {
      const wrap = el('div');
      wrap.append(el('p', null, `No answer: the local model is not available. ${d.note || 'The daemon could not reach a local model.'}`));
      wrap.append(el('p', null, 'Your calls are still on disk and still readable here. Nothing was sent anywhere.'));
      if (d.model) wrap.append(pill('am', `model: ${d.model}`));
      return wrap;
    }
    const hits = Array.isArray(d.hits) ? d.hits : [];
    if (hits.length === 0) {
      const wrap = el('div');
      wrap.append(el('p', null, d.answer || 'I could not find that in your meetings.'));
      wrap.append(el('p', null, d.note || 'No meeting in your archive matched that question, so nothing was sent to a model.'));
      return wrap;
    }
    const grounded = d.grounded !== false;
    const said = grounded ? d.answer : d.unverified;
    const wrap = el('div');
    wrap.append(el('p', null, said ? String(said) : 'The model returned nothing to quote here.'));
    if (!grounded) {
      wrap.append(el('p', null, d.note || 'Part of this carries no citation, so it is not supported by your meetings.'));
      if (Array.isArray(d.fabricated) && d.fabricated.length) {
        const ul = el('ul');
        for (const id of d.fabricated) ul.append(el('li', null, `cited "${id}" — no call of yours contains that id`));
        wrap.append(ul);
      }
      if (Array.isArray(d.ungrounded) && d.ungrounded.length) {
        const ul = el('ul');
        for (const c of d.ungrounded.slice(0, 6)) ul.append(el('li', null, `uncited: ${c}`));
        if (d.ungrounded.length > 6) ul.append(el('li', null, `+${d.ungrounded.length - 6} more uncited claims`));
        wrap.append(ul);
      }
      wrap.append(pill('am', 'NOT GROUNDED — shown as what the model said, not as an answer'));
      return wrap;
    }
    const cites = Array.isArray(d.cites) ? d.cites : [];
    const row = el('p');
    if (cites.length === 0) {
      row.append(document.createTextNode('cites: none'));
    } else {
      row.append(document.createTextNode('cites: '));
      for (const id of cites) {
        const found = lookupCite(cache, id);
        const chip = el('button', 'cite', id);
        chip.type = 'button';
        let quote = null;
        if (!found) {
          chip.disabled = true;
          chip.title = 'This id could not be resolved to a line in the archive from here.';
        } else {
          chip.addEventListener('click', () => {
            if (quote) { quote.remove(); quote = null; return; }
            quote = el('div');
            quote.style.cssText = 'margin:6px 0;padding:8px 10px;border-left:2px solid var(--rule-2);font-size:12.5px;color:var(--ink-2)';
            if (found.line) quote.append(el('b', null, `${found.line.speaker || 'unknown'}: `), document.createTextNode(found.line.text));
            else quote.append(el('b', null, 'call: '), document.createTextNode(found.meeting.title || found.meeting.id));
            chip.insertAdjacentElement('afterend', quote);
          });
        }
        row.append(chip, document.createTextNode(' '));
      }
    }
    wrap.append(row);
    wrap.append(pill('gr', d.model ? `GROUNDED · ${d.model} · local` : 'GROUNDED — every claim cites a line of a real call'));
    return wrap;
  }

  function renderAskTab() {
    const pane = $('.cnp[data-cntab="ask"]', root);
    if (!pane) return;
    const { askThread, asking, archiveState, CALL } = getState();
    const nodes = [];
    if (askThread.length === 0) {
      const p = el('p', null, "Nothing asked yet. Answers are read from your saved calls and every claim has to cite a real line — when it can't, you're told that instead.");
      p.style.cssText = 'font-size:13px;color:var(--ink-3)';
      nodes.push(p);
    } else {
      for (const t of askThread) {
        const you = el('div', 'turn you');
        const bt1 = el('div', 'bt');
        bt1.append(el('p', null, t.question));
        you.append(el('div', 'who', 'A'), bt1);
        nodes.push(you);
        const z = el('div', 'turn z');
        const bt2 = el('div', 'bt');
        bt2.append(t.node);
        z.append(el('div', 'who', 'Z'), bt2);
        nodes.push(z);
      }
    }
    const composer = el('div', 'composer');
    composer.style.width = '100%';
    const row = el('div', 'row');
    const textarea = el('textarea');
    textarea.rows = 1;
    textarea.placeholder = 'Ask about your saved calls — answers cite the transcript';
    const disabled = asking || archiveState !== 'ok' || !!CALL;
    textarea.disabled = disabled;
    textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask1(textarea.value); } });
    const sendBtn = el('button', 'cbtn send', '↑');
    sendBtn.type = 'button';
    sendBtn.disabled = disabled;
    sendBtn.addEventListener('click', () => void ask1(textarea.value));
    row.append(textarea, sendBtn);
    const foot = el('div', 'foot');
    foot.append(pill('gr', 'grounded in your saved calls only'), el('span', 'grow'), el('span', null, CALL ? 'off while a meeting is recording' : "when it isn't there, it says so"));
    composer.append(row, foot);
    nodes.push(composer);
    fill(pane, ...nodes);
  }

  return { renderAskTab, warmCache, answerNode };
}
