/*
 * capsule/refused.js — the drift-refused state.
 *
 * Compare-and-swap refused the commit: the base moved between the preview the
 * owner read and the moment of commit. Shows BOTH hashes, states plainly that
 * nothing was applied, and offers a re-preview.
 */

import { el, add } from './dom.js';
import { chip, na, unresolved } from './widgets.js';
import { fmtClock } from './format.js';
import { kvList, kvAdd } from './util.js';
import { ensureStyles } from './styles.js';

/**
 * @param {object} receipt  a Receipt with outcome 'refused'
 * @param {object} [preview] the Preview that was approved — supplies the base
 *                           the owner actually approved (the receipt does not carry it)
 */
export function renderRefused(receipt, preview) {
  ensureStyles();
  const root = el('section', 'zn-caps');
  root.dataset.state = 'refused';
  root.dataset.actionHash = String(receipt?.actionHash ?? preview?.actionHash ?? '');
  root.setAttribute('role', 'group');
  const body = el('div', 'zn-body');
  add(body, refusedBlock(receipt, preview, {}, root));
  add(root, body);
  root.destroy = () => {};
  return root;
}

export function refusedBlock(receipt, preview, opts, root) {
  const box = el('div', 'zn-outcome');
  box.dataset.ch = 'red';

  const seal = el('div', 'zn-seal zn-draw');
  seal.dataset.ch = 'red';
  add(
    seal,
    el('span', null, '✕'),
    el('span', null, `refused · base drifted · ${fmtClock(receipt?.at)}`),
  );

  const nothing = el('div', 'zn-nothing');
  add(nothing, el('span', null, '■'), el('span', null, 'Nothing was applied.'));

  const approvedBase = preview?.binding?.baseHash;
  const observedBase = receipt?.casBaseObserved;

  const drift = el('dl', 'zn-drift');
  add(drift, el('dt', null, 'base you approved'));
  if (approvedBase) {
    add(drift, el('dd', null, String(approvedBase)));
  } else {
    const dd = el('dd', null);
    add(
      dd,
      na(
        'the receipt does not carry the base that was approved — only the one observed. Pass the Preview to renderRefused to show both.',
      ),
    );
    add(drift, dd);
  }
  add(drift, el('dt', null, 'base actually observed'));
  add(drift, el('dd', null, String(observedBase ?? '')));
  if (!observedBase) {
    drift.lastChild.textContent = '';
    add(drift.lastChild, unresolved('the receipt carries no casBaseObserved'));
  }
  add(drift, el('dt', null, 'target'));
  add(drift, el('dd', null, String(receipt?.targetRef ?? preview?.binding?.targetRef ?? '(not carried)')));

  const effect = receipt?.externalEffect?.effect;
  const evidence = el('div', 'zn-hashrow');
  if (effect === 'none') {
    add(
      evidence,
      chip(
        '□',
        'external effect · none',
        null,
        'The receipt records effect: none. That is the evidence for "nothing was applied" — not an assumption.',
      ),
    );
  } else if (effect === undefined || effect === null) {
    add(evidence, chip('▲', 'external effect · not recorded', 'amber', 'The receipt carries no effect proof.'));
  } else {
    // A refusal that claims an effect contradicts itself. Say so loudly.
    add(
      evidence,
      chip(
        '✕',
        `external effect · ${String(effect)} — CONTRADICTS THIS REFUSAL`,
        'red',
        'A refused commit must record effect: none. This receipt does not. Do not trust the "nothing applied" line above it — inspect the ledger and the provider directly.',
      ),
    );
  }

  const kv = kvList();
  kvAdd(kv, 'reason', receipt?.reason ?? '(none recorded)');
  kvAdd(kv, 'action hash', receipt?.actionHash ?? preview?.actionHash ?? '(not carried)');
  kvAdd(kv, 'receipt id', receipt?.id ?? '(not carried)');
  kvAdd(kv, 'self hash', receipt?.selfHash ?? '(not carried)');
  kvAdd(kv, 'prev receipt', receipt?.prevReceipt ?? 'null · genesis entry');
  kvAdd(kv, 'at', receipt?.at ?? '(not carried)');

  add(
    box,
    seal,
    nothing,
    el(
      'div',
      'zn-note',
      'Compare-and-swap re-read the target immediately before commit and found a different base than the one you approved. The commit was refused rather than applied, and your approval was not spent — but it is bound to the old base, so it can never commit against the new one. Approving a snapshot of a world that has moved is the failure this check exists to prevent.',
    ),
    drift,
    evidence,
    kv,
    rePreviewBtn(preview, opts, root),
  );
  return box;
}

export function rePreviewBtn(preview, opts, root) {
  const b = el('button', 'zn-repreview', '↻  Re-preview against the current base');
  b.type = 'button';
  b.addEventListener('click', () => {
    const detail = {
      actionHash: preview?.actionHash ?? null,
      targetRef: preview?.binding?.targetRef ?? null,
    };
    if (typeof opts?.onRePreview === 'function') opts.onRePreview(detail);
    (root || b).dispatchEvent(new CustomEvent('zeno:re-preview', { detail, bubbles: true }));
  });
  const wrap = el('div');
  add(
    wrap,
    b,
    el(
      'div',
      'zn-note',
      'Asks the proposing agent for a fresh preview against the base that is actually there. That produces a new payload, a new hash and a new decision — it never carries this approval forward.',
    ),
  );
  return wrap;
}
