/*
 * bind/settings/security.js — the Privacy & Security pane: Owner token,
 * Policy.
 *
 * Real state this file is grounded in: `token()` (the meta-tag bind.js
 * already reads) and GET /state (receipts[].policyHash off the newest
 * receipt — /state has no dedicated policy field; sections.js's real
 * dialog reads it the same way).
 */
import { getJSON, $, token } from '../../bind.js';
import { rowByLabel, setPill, mono } from './shared.js';

export async function bindSecurity(modal) {
  const pane = $('.set-pane[data-setpane="security"]', modal);
  if (!pane) return;

  const hasOwner = token() !== '';
  try {
    const row = rowByLabel(pane, 'Owner token');
    const pill = row && $('.pill', row);
    if (pill) setPill(pill, hasOwner ? 'good' : 'bad', hasOwner ? 'held' : 'absent — read-only window', true);
  } catch { /* skip quietly */ }

  try {
    const row = rowByLabel(pane, 'Policy');
    const pill = row && $('.pill', row);
    if (pill) {
      const state = await getJSON('/state');
      if (!state.ok) setPill(pill, 'bad', 'could not be read', false);
      else {
        const receipts = Array.isArray(state.data && state.data.receipts) ? state.data.receipts : [];
        const newest = receipts.length ? receipts[receipts.length - 1] : null;
        const hash = newest && newest.policyHash ? String(newest.policyHash) : '';
        if (hash) setPill(pill, 'flat', `${mono(hash)} · from the newest receipt`, false);
        else setPill(pill, 'warn', 'not recorded yet — no receipt to read it from', false);
      }
    }
  } catch { /* skip quietly */ }
  // Telemetry and Tier-4 rows are guarantees the kernel enforces in code
  // (no telemetry code path exists at all; Tier 4 has no approval route),
  // not values any daemon endpoint reports — left as the shipped copy.
}
