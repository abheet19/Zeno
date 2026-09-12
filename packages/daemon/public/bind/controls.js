/*
 * bind/controls.js — the controls the design left inert.
 *
 * A CTA audit of the shipped markup found 225 interactive controls, of which six
 * had no handler on any path: two starters/attach on Home, attach + voice in the
 * Chats thread, and the working-folder chip + voice button in Forge's first-run
 * composer. The artifact is a design mock, so that is expected of it — but a
 * button that looks live and does nothing is a lie about what is available, and
 * this surface's own rule is that such a control is ABSENT rather than shown
 * inert (see capsule.js).
 *
 * So each one here is either given its real behaviour or removed with the reason
 * stated. Nothing is left pretending.
 */

import { $, $$, el } from '../bind.js';

/** Remove a control the app cannot honour, and say why where a user can see it. */
function retire(node, why) {
  if (!node) return;
  const host = node.closest('.row, .ag-row, .foot') || node.parentElement;
  node.remove();
  if (host && why && !host.querySelector('[data-retired-note]')) {
    const n = el('span', 'fnote', why);
    n.setAttribute('data-retired-note', '1');
    n.style.cssText = 'font-size:11px;opacity:.62';
    // Only annotate where there is room; icon rows stay clean.
    if (host.classList.contains('foot')) host.append(n);
  }
}

/** Focus a composer and, if given, seed it — used by the starter chips. */
function focusComposer(sel, seed) {
  const ta = $(sel);
  if (!ta) return false;
  if (seed && !ta.value) {
    ta.value = seed;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.focus();
  return true;
}

export async function bind() {
  /* ---- Home: "Start a Forge task" -------------------------------------
     The artifact only prefilled its own mock composer. Forge is where a task
     actually runs, so send the owner there and put the cursor in the real
     composer with their words already in it. */
  for (const b of $$('.starter')) {
    const label = (b.textContent || '').trim();
    if (!/start a forge task/i.test(label)) continue;
    if (b.dataset.wired) continue;
    b.dataset.wired = '1';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const typed = ($('#home-ta') && $('#home-ta').value.trim()) || '';
      const go = document.querySelector('[data-product="forge"]');
      if (go) go.click();
      setTimeout(() => {
        // Forge's first run uses #ag-ta; an open session uses #s-ta.
        if (!focusComposer('#ag-ta', typed)) focusComposer('#s-ta', typed);
      }, 60);
    });
  }

  /* ---- Voice buttons: hand them to the real recogniser ------------------
     voice.js owns the only real capture path in this product (local, push-to
     talk, disclosed). Command's hold-to-talk control is .zv-ptt. Rather than
     re-implement capture here — and risk a second, undisclosed microphone
     path — these buttons route to it. If it is not present, the button is
     retired instead of miming a recording state. */
  const ptt = document.querySelector('.zv-ptt');
  for (const mic of $$('.cbtn.mic, .ag-ic[title="Voice"], [title="Voice"]')) {
    if (mic.dataset.wired) continue;
    if (mic.id === 's-mic' || mic.id === 'home-mic') continue; // already wired by ui.js
    mic.dataset.wired = '1';
    if (ptt) {
      mic.title = 'Voice — opens Command’s hold-to-talk control';
      mic.addEventListener('click', (e) => {
        e.preventDefault();
        const go = document.querySelector('[data-product="command"]');
        if (go) go.click();
        setTimeout(() => { const p = document.querySelector('.zv-ptt'); if (p) p.focus(); }, 80);
      });
    } else {
      retire(mic, '');
    }
  }

  /* ---- Attach: Zeno has no attachment path ----------------------------
     Nothing in the daemon accepts an uploaded file from these composers, and a
     paperclip that opens nothing is worse than no paperclip. Forge's real
     context path is its "+" menu (files, directories, skills, rules), which is
     wired; these two are removed. */
  for (const a of $$('.cbtn.attach')) {
    if (a.closest('#sess')) continue; // Forge's own attach opens the real + menu
    retire(a, '');
  }

  /* ---- Forge: the working-folder chip ---------------------------------
     It should say which repository the run will touch, and be a real way to
     see it — not a decorative chip. Point it at the Explorer, which shows the
     actual sandbox, and label it from real status. */
  const proj = $('.ag-proj');
  if (proj && !proj.dataset.wired) {
    proj.dataset.wired = '1';
    proj.addEventListener('click', (e) => {
      e.preventDefault();
      const ex = document.querySelector('.vsact [data-vsview="explorer"]');
      if (ex) ex.click();
    });
    try {
      const res = await fetch('/forge/status', {
        headers: (document.querySelector('meta[name="zeno-token"]')?.getAttribute('content'))
          ? { 'x-zeno-token': document.querySelector('meta[name="zeno-token"]').getAttribute('content') } : {},
        cache: 'no-store',
      });
      if (res.ok) {
        const s = await res.json();
        // /forge/status reports `repo` as a BOOLEAN ("is this a repository"), not a
        // name — reading it as a label printed the literal "true · master" in the
        // chip. The name is the last segment of the real root path.
        const root = typeof s.root === 'string' ? s.root : '';
        const repo = root ? root.split(/[\\/]/).filter(Boolean).pop() : 'sandbox';
        const branch = s.branch ? ` · ${s.branch}` : '';
        const label = proj.querySelector('span') || proj;
        if (label === proj) {
          // keep the leading icon, replace only the trailing text node
          const last = [...proj.childNodes].reverse().find((n) => n.nodeType === 3);
          if (last) last.textContent = ` ${repo}${branch}`;
        } else {
          label.textContent = `${repo}${branch}`;
        }
        proj.title = 'The repository this run works in — opens the Explorer';
      }
    } catch { /* leave the chip's own label; it is not a claim about state */ }
  }
}
