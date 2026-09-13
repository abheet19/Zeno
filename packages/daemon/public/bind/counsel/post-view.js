/**
 * bind/counsel/post-view.js — the post-meeting view (summary / transcript /
 * export / email tabs) for whichever call bind/counsel.js's `openMeetingById`
 * (see archive-list.js) has open. `makeRenderPost` is a factory rather than a
 * set of plain exports because every render needs the same stable `root`
 * (this product's DOM subtree) and a couple of bits of bind/counsel.js's live
 * state (the redaction note, and the ask-composer re-render) that only
 * bind/counsel.js's own `let`s can supply — see that file's header for why
 * those stay bare `let`s there instead of moving here too.
 */
import { $, el, fill, setText } from '../../bind.js';
import { pill, fmtDate, fmtMinutes, elapsedLabel, slugify } from './format.js';
import { downloadFile, callMarkdown, emailDraftText } from './transcript-export.js';

const LIFECYCLE = { proposed: '○', agreed: '◈', disputed: '⊘' };
const LIFECYCLE_PILL = { proposed: 'wt', agreed: 'gr', disputed: 'am' };

/**
 * @param {object} deps
 * @param {Element} deps.root
 * @param {Element} deps.postTitleEl
 * @param {Element|null} deps.postMetaP
 * @param {() => {lastRedactedId: string|null, lastRedactedCount: number}} deps.getRedacted
 * @param {() => void} deps.renderAskTab — re-render the ask composer, whose
 *   enabled state depends on whether a call is live/the archive is readable,
 *   not on which meeting is open here.
 */
export function makeRenderPost({ root, postTitleEl, postMetaP, getRedacted, renderAskTab }) {
  function clearTabs() {
    for (const k of ['summary', 'transcript', 'ask', 'export', 'email']) {
      const p = $(`.cnp[data-cntab="${k}"]`, root);
      if (p) fill(p);
    }
  }

  function citeChips(m, cites, lines) {
    const wrap = el('span');
    if (!cites || cites.length === 0) {
      wrap.append(el('span', null, 'no citation'));
      wrap.style.cssText = 'color:var(--ink-3);font-size:11px;font-style:italic';
      return wrap;
    }
    for (const id of cites) {
      const u = lines.get(id);
      const label = u ? (elapsedLabel(m, u.at) || u.id) : id;
      const chip = el('button', 'cite', `[${label}]`);
      chip.type = 'button';
      let quote = null;
      if (!u) {
        chip.disabled = true;
        chip.title = 'This id is not a line in this call’s transcript.';
      } else {
        chip.addEventListener('click', () => {
          if (quote) { quote.remove(); quote = null; return; }
          quote = el('div');
          quote.style.cssText = 'margin:6px 0;padding:8px 10px;border-left:2px solid var(--rule-2);font-size:12.5px;color:var(--ink-2)';
          quote.append(el('b', null, `${u.speaker || 'unknown'}: `), document.createTextNode(u.text));
          chip.insertAdjacentElement('afterend', quote);
        });
      }
      wrap.append(chip);
    }
    return wrap;
  }

  function summarySection(parent, label, items, lines, build) {
    const sec = el('div', 'cnsec');
    const h = el('div', 'cnsech');
    h.append(document.createTextNode(`${label} `), el('span', null, String((items && items.length) || 0)));
    sec.append(h);
    if (!items || items.length === 0) {
      sec.append(el('div', 'cnitem', `Nothing in this call was extracted as ${label.toLowerCase()}.`));
    } else {
      for (const it of items) sec.append(build(it));
    }
    parent.append(sec);
  }

  function renderSummaryTab(m) {
    const pane = $('.cnp[data-cntab="summary"]', root);
    if (!pane) return;
    const nodes = [];
    if (m.participants && m.participants.length) {
      const p = el('p', null, `With ${m.participants.join(', ')}.`);
      p.style.cssText = 'margin:0;font-size:12px;color:var(--ink-3)';
      nodes.push(p);
    }
    const lines = new Map((m.utterances || []).map((u) => [u.id, u]));
    const sum = el('div', 'cnsum');
    summarySection(sum, 'Key points', (m.summary || {}).keyPoints, lines, (k) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, k.text), citeChips(m, k.cites, lines));
      return it;
    });
    summarySection(sum, 'Decisions', (m.summary || {}).decisions, lines, (d) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, d.text), citeChips(m, d.cites, lines), pill(LIFECYCLE_PILL[d.lifecycle] || 'wt', `${LIFECYCLE[d.lifecycle] || '○'} ${d.lifecycle}`));
      return it;
    });
    summarySection(sum, 'Action items', (m.summary || {}).actions, lines, (a) => {
      const it = el('div', 'cnitem');
      it.append(el('b', null, a.text), el('span', 'who', a.owner || 'unknown'), pill('wt', `due: ${a.due || 'not said'}`), citeChips(m, a.cites, lines));
      return it;
    });
    summarySection(sum, 'Open questions', (m.summary || {}).questions, lines, (q) => {
      const it = el('div', 'cnitem');
      it.append(document.createTextNode(q.text), citeChips(m, q.cites, lines));
      return it;
    });
    nodes.push(sum);
    const fn = el('div', 'fnote', 'Every item above cites the transcript line it came from. Counsel extracts these deterministically, with no model in this step — an owner or a date that was not said stays "unknown", and an item with no citation cannot be produced.');
    nodes.push(fn);
    fill(pane, ...nodes);
  }

  function renderTranscriptTab(m) {
    const pane = $('.cnp[data-cntab="transcript"]', root);
    if (!pane) return;
    const utterances = m.utterances || [];
    if (utterances.length === 0) {
      fill(pane, el('div', 'cnitem', 'Nothing was transcribed in this call.'));
      return;
    }
    const wrap = el('div', 'cnlines static');
    for (const u of utterances) {
      const row = el('div', 'cnl');
      row.append(el('span', 'cnw', u.speaker || 'unknown'), el('span', 'cnt2', elapsedLabel(m, u.at) || ''), el('span', null, u.text));
      wrap.append(row);
    }
    fill(pane, wrap);
  }

  function renderExportTab(m) {
    const pane = $('.cnp[data-cntab="export"]', root);
    if (!pane) return;
    const status = el('p', null, '');
    status.style.cssText = 'font-size:12px;color:var(--ink-3);margin:6px 2px 0';
    const mkBtn = (label, run) => {
      const b = el('button', 'laction cy', label);
      b.type = 'button';
      b.addEventListener('click', () => {
        const ok = run();
        status.textContent = ok ? `Saved to your downloads as ${label.replace('Save ', '')}.` : 'The browser blocked the download — nothing was saved.';
      });
      return b;
    };
    const base = `${slugify(m.title)}-${String(m.id || '').slice(0, 8)}`;
    const mdBtn = mkBtn('Save .md', () => downloadFile(`${base}.md`, callMarkdown(m), 'text/markdown'));
    const jsonBtn = mkBtn('Save .json', () => downloadFile(`${base}.json`, JSON.stringify(m, null, 2), 'application/json'));
    const pdfBtn = el('button', 'laction', 'Save .pdf');
    pdfBtn.type = 'button';
    pdfBtn.disabled = true;
    pdfBtn.title = 'Not available — this daemon has no PDF renderer.';
    const mkCard = (title, sub, action) => {
      const c = el('div', 'lcard');
      c.append(el('div', 'lk', title), el('div', 'lm', sub));
      const r = el('div', 'lr');
      r.append(action);
      c.append(r);
      return c;
    };
    const cards = el('div', 'live-cards');
    cards.append(
      mkCard('Markdown', 'summary + transcript · human-readable', mdBtn),
      mkCard('JSON', 'structured · citations preserved', jsonBtn),
      mkCard('PDF', 'not available on this daemon', pdfBtn),
    );
    fill(pane, cards, status);
  }

  function renderEmailTab(m) {
    const pane = $('.cnp[data-cntab="email"]', root);
    if (!pane) return;
    const mailPre = pane.querySelector('.cnmail');
    if (mailPre) mailPre.textContent = emailDraftText(m);
    const toInput = pane.querySelector('input.cninput');
    if (toInput) toInput.value = '';
    // #cn-send / #cn-mailstate are left exactly as ui.js already renders them:
    // "not configured — no mail provider", disabling itself on click. That is
    // already the honest, real state — this daemon has no mail provider.
  }

  function renderPost(state) {
    if (state === 'loading') {
      setText(postTitleEl, 'Opening the call…');
      if (postMetaP) fill(postMetaP);
      return;
    }
    if (typeof state === 'string') {
      setText(postTitleEl, 'That call could not be opened.');
      if (postMetaP) fill(postMetaP, el('span', null, state));
      clearTabs();
      return;
    }
    const m = state;
    if (!m) return;
    setText(postTitleEl, m.title || '(untitled call)');
    if (postMetaP) {
      const durMs = Number.isFinite(Date.parse(m.endedAt)) && Number.isFinite(Date.parse(m.startedAt))
        ? new Date(m.endedAt) - new Date(m.startedAt) : null;
      const parts = [
        el('span', null, `${fmtDate(m.startedAt)}${durMs != null ? ' · ' + fmtMinutes(durMs) : ''}`),
        document.createTextNode(' · saved locally'),
      ];
      const { lastRedactedId, lastRedactedCount } = getRedacted();
      if (lastRedactedId === m.id && lastRedactedCount > 0) {
        parts.push(pill('gr', `${lastRedactedCount} identifier${lastRedactedCount === 1 ? '' : 's'} redacted on save`));
      }
      fill(postMetaP, ...parts);
    }
    renderSummaryTab(m);
    renderTranscriptTab(m);
    renderAskTab();
    renderExportTab(m);
    renderEmailTab(m);
  }

  return { renderPost };
}
