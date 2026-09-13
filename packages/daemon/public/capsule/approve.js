/*
 * capsule/approve.js — the footer: the Approve control, the completeness-
 * driven sync of its state, the committing strip, the receipt/outcome
 * renderers, and the one write this whole component makes (the click
 * handler's POST /approvals, or opts.onApprove).
 */

import { el, add } from './dom.js';
import { nextId } from './widgets.js';
import { truncHash, fmtClock } from './format.js';
import { kvList, kvAdd, readMetaToken } from './util.js';
import { stopTimer } from './state.js';
import { refusedBlock, rePreviewBtn } from './refused.js';

/**
 * @returns {{foot: HTMLElement, syncApprove: Function, applyReceipt: Function}}
 */
export function buildFooter(ctx) {
  const foot = el('footer', 'zn-foot');
  const outcomeSlot = el('div', 'zn-outcomeslot');
  outcomeSlot.setAttribute('aria-live', 'polite');

  const approve = el('button', 'zn-approve');
  approve.type = 'button';
  const apLab = el('span', 'zn-aplab', '✓  Approve this exact hash');
  const apWhy = el('span', 'zn-apwhy', '');
  const whyId = nextId();
  apWhy.id = whyId;
  add(approve, apLab, apWhy);
  approve.setAttribute('aria-describedby', whyId);

  const absent = el(
    'div',
    'zn-absent',
    'Edit · Regenerate · Explain · Open source · Deny · Snooze · Dismiss · Do-not-draft-similar are not present in this slice: the only write the daemon offers this window is POST /approvals, and none of these map onto it. They are absent rather than shown inert — a control that cannot act is a lie about what is available.',
  );

  add(foot, outcomeSlot, approve, absent);

  /* ---- Approve state, recomputed from the blocker ledger ---- */
  function syncApprove() {
    if (ctx.spent) return; // once spent, nothing re-enables it
    const preview = ctx.preview;
    const reasons = Array.isArray(preview?.reasons) ? preview.reasons : [];
    // Fixed precedence: prohibited > auto > incomplete > expired.
    const denied = !!preview?.denied || preview?.tier === 'T4';
    if (denied) {
      approve.disabled = true;
      approve.dataset.blockkind = 'prohibited';
      apLab.textContent = '✕  Approve — unavailable';
      apWhy.textContent =
        'T4 · prohibited. There is no path to approve this action, and no setting that creates one. ' +
        (reasons.length ? reasons.join(' · ') : '');
      return;
    }
    if (preview?.auto || preview?.tier === 'T0') {
      approve.disabled = true;
      approve.dataset.blockkind = 'auto';
      apLab.textContent = '○  Approve — not owed';
      apWhy.textContent =
        'T0 · auto. Policy owes you no decision on this action, and clicking would grant nothing. It is still ' +
        'listed because the daemon is still holding it: this build commits only through POST /approvals, so an ' +
        'auto action waits here rather than committing on its own.';
      return;
    }
    if (ctx.blockers.size > 0) {
      const list = [...ctx.blockers.values()];
      const expired = list.find((b) => b.kind === 'expired');
      approve.disabled = true;
      approve.dataset.blockkind = expired ? 'expired' : 'incomplete';
      apLab.textContent = expired ? '◷  Approve — expired' : '▲  Approve — blocked';
      apWhy.textContent = expired
        ? `${expired.text} An approval must never outlive the preview it was taken on.`
        : `The preview is incomplete: ${list.map((b) => b.text).join(' · ')}. ` +
          'There is no expert mode and no toggle that approves over this.';
      return;
    }
    approve.disabled = false;
    approve.dataset.blockkind = 'ready';
    apLab.textContent = '✓  Approve this exact hash';
    apWhy.textContent = `single use · one attempt · bound to ${truncHash(preview?.actionHash)}`;
  }

  /* ---- committing: two truthful steps, no fabricated progress ---- */
  function renderCommitting() {
    outcomeSlot.textContent = '';
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'cyan';
    const strip = el('div', 'zn-steps');
    const s1 = el('div', 'zn-step');
    const s2 = el('div', 'zn-step');
    s1.dataset.on = '1';
    add(strip, s1, s2);
    const lab = el('div', 'zn-steplab', 'attempt 1 of 1 · request sent · awaiting receipt');
    add(box, strip, lab);
    add(outcomeSlot, box);
    ctx.root.dataset.state = 'committing';
    return {
      settle(channel, text) {
        s2.dataset.on = '1';
        s2.dataset.ch = channel;
        s1.dataset.ch = channel;
        lab.textContent = text;
      },
    };
  }

  /* ---- the seal: rendered only from a receipt, and only at the end ---- */
  function applyReceipt(receipt) {
    if (!receipt) return;
    const preview = ctx.preview;
    const root = ctx.root;
    // L-SEAL. A receipt seals THIS capsule only if it is provably about this
    // action. A receipt that carries no actionHash at all proves nothing about
    // any particular action, so it may not draw a seal here either — the old
    // guard let it through, and a missing hash is exactly the case where an
    // optimistic green would be indistinguishable from a proven one.
    if (preview?.actionHash && receipt.actionHash !== preview.actionHash) return;
    stopTimer(ctx);
    ctx.spent = true;
    approve.disabled = true;

    // Tell the window a receipt landed on this capsule, so the page can move it
    // out of "awaiting your decision" — a capsule showing a receipt is settled,
    // and leaving it in the pending group would be a lie about what is owed.
    // The window listens for this; nothing here depends on anyone doing so.
    try {
      root.dispatchEvent(
        new CustomEvent('zeno:receipt', { detail: { receipt }, bubbles: true }),
      );
    } catch {
      /* a listener that throws must never stop the receipt from rendering */
    }

    outcomeSlot.textContent = '';
    const outcome = receipt.outcome;

    if (outcome === 'verified') {
      root.dataset.state = 'verified';
      approve.dataset.blockkind = 'used';
      apLab.textContent = '✓  Approved — already used';
      apWhy.textContent = 'single-use: this approval is spent. A second commit on it is not permitted.';
      const box = el('div', 'zn-outcome');
      box.dataset.ch = 'green';
      const seal = el('div', 'zn-seal zn-draw');
      add(
        seal,
        el('span', null, '✓'),
        el('span', null, `verified · ${fmtClock(receipt.at)}`),
      );
      const kv = kvList();
      kvAdd(kv, 'receipt id', receipt.id);
      kvAdd(kv, 'external effect', receipt.externalEffect?.effect ?? '(none recorded)');
      kvAdd(kv, 'base observed', receipt.casBaseObserved);
      kvAdd(kv, 'self hash', receipt.selfHash);
      kvAdd(kv, 'prev receipt', receipt.prevReceipt ?? 'null · genesis entry');
      kvAdd(kv, 'policy hash', receipt.policyHash);
      add(box, seal, kv);
      add(outcomeSlot, box);
      return;
    }

    if (outcome === 'refused') {
      root.dataset.state = 'refused';
      approve.dataset.blockkind = 'refused';
      apLab.textContent = '✕  Refused — nothing was applied';
      apWhy.textContent = 'the base drifted between your preview and the commit. Re-preview to decide against what is actually there.';
      add(outcomeSlot, refusedBlock(receipt, preview, ctx.opts, root));
      return;
    }

    const map = {
      denied: {
        ch: 'red',
        glyph: '✕',
        label: 'denied',
        note: 'A recorded decision, not a dismissal. It is in the ledger with its reason.',
        state: 'denied',
      },
      expired: {
        ch: 'amber',
        glyph: '◷',
        label: 'expired',
        note: 'The approval lapsed before commit. Nothing was applied. Re-preview to decide again.',
        state: 'expired',
      },
      'outcome-unknown': {
        ch: 'amber',
        glyph: '▲',
        label: 'outcome unknown',
        note: 'The attempt happened and its result cannot be proven. Retry is FROZEN: a blind retry here is how a double-send is made. Inspect the provider directly, reconcile, or prepare a new action.',
        state: 'unknown',
      },
    };
    const m = map[outcome] || {
      ch: 'amber',
      glyph: '▲',
      label: String(outcome ?? 'unrecognised outcome'),
      note: 'This outcome is not one this UI knows how to render. Treat it as unresolved and inspect the ledger.',
      state: 'unknown',
    };
    root.dataset.state = m.state;
    apLab.textContent = `${m.glyph}  ${m.label}`;
    apWhy.textContent = receipt.reason || m.note;

    const box = el('div', 'zn-outcome');
    box.dataset.ch = m.ch;
    const seal = el('div', 'zn-seal zn-draw');
    seal.dataset.ch = m.ch;
    add(seal, el('span', null, m.glyph), el('span', null, `${m.label} · ${fmtClock(receipt.at)}`));
    const kv = kvList();
    kvAdd(kv, 'reason', receipt.reason ?? '(none recorded)');
    kvAdd(kv, 'external effect', receipt.externalEffect?.effect ?? '(none recorded)');
    kvAdd(kv, 'receipt id', receipt.id);
    kvAdd(kv, 'base observed', receipt.casBaseObserved);
    kvAdd(kv, 'self hash', receipt.selfHash);
    add(box, seal, el('div', 'zn-note', m.note), kv);
    add(outcomeSlot, box);
  }

  function renderPolicyError(e, status) {
    ctx.root.dataset.state = 'blocked';
    approve.dataset.blockkind = 'prohibited';
    apLab.textContent = '✕  Refused by policy';
    apWhy.textContent = `${e.code || status} · ${e.message || 'no message supplied'}`;
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'red';
    const seal = el('div', 'zn-seal');
    seal.dataset.ch = 'red';
    add(seal, el('span', null, '✕'), el('span', null, `blocked · ${e.code || `http ${status}`}`));
    const kv = kvList();
    kvAdd(kv, 'message', e.message ?? '(none)');
    kvAdd(kv, 'resolve', e.resolve ?? '(the daemon supplied no resolution)');
    add(
      box,
      seal,
      el('div', 'zn-note', 'No approval was issued and nothing was applied. This control stays spent — decide again on a fresh preview.'),
      kv,
      rePreviewBtn(ctx.preview, ctx.opts, ctx.root),
    );
    add(outcomeSlot, box);
  }

  function renderUnknown(text) {
    ctx.root.dataset.state = 'unknown';
    approve.dataset.blockkind = 'used';
    apLab.textContent = '▲  Outcome unknown — retry frozen';
    apWhy.textContent = text;
    const box = el('div', 'zn-outcome');
    box.dataset.ch = 'amber';
    const seal = el('div', 'zn-seal');
    seal.dataset.ch = 'amber';
    add(seal, el('span', null, '▲'), el('span', null, 'outcome unknown'));
    add(
      box,
      seal,
      el('div', 'zn-note', text),
      el(
        'div',
        'zn-note',
        'Retry is frozen deliberately: a second attempt is how one action becomes two effects. Inspect the provider directly, reconcile, or prepare a new action.',
      ),
    );
    add(outcomeSlot, box);
  }

  /* ---- the one write in this module ---- */
  approve.addEventListener('click', async () => {
    // L-ONCE, in this exact order: latch, then disable, then anything async.
    if (ctx.spent) return;
    if (approve.disabled) return;
    ctx.spent = true;
    approve.disabled = true;
    approve.dataset.blockkind = 'used';
    apLab.textContent = '◷  Approving — spent';
    apWhy.textContent = 'this control is single-use and is now permanently spent.';
    stopTimer(ctx);

    const step = renderCommitting();
    const preview = ctx.preview;

    try {
      let result;
      if (typeof ctx.opts.onApprove === 'function') {
        result = await ctx.opts.onApprove(preview);
      } else {
        const token = ctx.opts.ownerToken ?? readMetaToken();
        const res = await fetch(ctx.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-zeno-token': token } : {}),
          },
          body: JSON.stringify({ actionHash: preview.actionHash }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const e = data && data.error ? data.error : {};
          // 4xx and 409 are decided BEFORE the executor runs: postApproval
          // returns 400/401/403/404 before it calls the kernel at all, and the
          // only PolicyError paths that reach 409 are approve() and commit()'s
          // pre-exec checks. For those, "nothing was applied" is provably true.
          //
          // 5xx is NOT. The kernel writes the verified receipt deliberately
          // OUTSIDE the executor's catch, so a failure to RECORD a real effect
          // throws — and that throw arrives here as 500 `internal`. That is the
          // one response shape that means the effect may have happened and the
          // ledger did not capture it. Calling it "refused · nothing applied"
          // would be R1 run backwards: a terminal claim with no receipt behind
          // it. It is outcome-unknown, which is amber, and retry stays frozen.
          if (res.status >= 500) {
            step.settle('amber', `attempt 1 of 1 · no receipt · ${res.status}`);
            renderUnknown(
              `The daemon answered ${res.status} ${e.code || 'internal'} and returned no receipt${
                e.message ? `: ${e.message}` : '.'
              } An effect may or may not have been applied — the receipt that would say is exactly what is missing.${
                e.resolve ? ` ${e.resolve}` : ''
              }`,
            );
            return;
          }
          step.settle('red', `attempt 1 of 1 · refused by the daemon · ${res.status}`);
          renderPolicyError(e, res.status);
          return;
        }
        result = data;
      }
      const receipt = result && typeof result === 'object' ? result.receipt : null;
      if (!receipt || typeof receipt !== 'object') {
        step.settle('amber', 'attempt 1 of 1 · no receipt in the response');
        renderUnknown(
          'The daemon answered without a receipt. Nothing here can say whether an effect occurred.',
        );
      } else if (preview?.actionHash && receipt.actionHash !== preview.actionHash) {
        // The strip must not go green on a receipt that is not about this
        // action: applyReceipt would (correctly) refuse to draw the seal, and a
        // green bar over a capsule with no outcome is the exact optimism this
        // component exists to refuse.
        step.settle('amber', 'attempt 1 of 1 · receipt does not match this action');
        renderUnknown(
          `The daemon answered with a receipt carrying ${
            receipt.actionHash ? 'a different action hash' : 'no action hash at all'
          }, so it proves nothing about this one. Whether this action had an effect is unknown.`,
        );
      } else {
        step.settle(
          receipt.outcome === 'verified' ? 'green' : receipt.outcome === 'refused' ? 'red' : 'amber',
          `attempt 1 of 1 · receipt received`,
        );
        applyReceipt(receipt);
      }
    } catch (err) {
      // The request left this machine and no receipt came back. That is
      // outcome-unknown, not failure, and retry is frozen.
      step.settle('amber', 'attempt 1 of 1 · no receipt');
      renderUnknown(
        `The request left this machine and no receipt returned (${
          err && err.message ? err.message : 'network error'
        }). Whether an effect occurred is unknown.`,
      );
    }
  });

  return { foot, syncApprove, applyReceipt };
}
